'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const { buildDeletePlan, startDeleteJob } = require('../delete-job.js');
const { createJobStore } = require('../job-store.js');
const {
  DEFAULT_ALARM_NAME,
  createDeleteJobExecutor
} = require('../delete-job-executor.js');

class MemoryStorage {
  constructor() { this.data = {}; }
  async get(key) {
    return Object.hasOwn(this.data, key) ? { [key]: structuredClone(this.data[key]) } : {};
  }
  async set(values) { Object.assign(this.data, structuredClone(values)); }
  async remove(key) { delete this.data[key]; }
}

class MemoryInventory {
  constructor(records) {
    this.records = new Map(records.map(item => [item.id, structuredClone(item)]));
    this.deleted = [];
  }
  async init() {}
  async getConversation(id) {
    const value = this.records.get(id);
    return value ? structuredClone(value) : undefined;
  }
  async deleteConversation(id) {
    this.deleted.push(id);
    this.records.delete(id);
  }
}

class FakeAlarms {
  constructor() { this.created = []; this.cleared = []; }
  async create(name, options) { this.created.push({ name, ...options }); }
  async clear(name) { this.cleared.push(name); return true; }
}

class FakeTimers {
  constructor() { this.nextId = 1; this.entries = new Map(); }
  set(callback, delay) {
    const id = this.nextId++;
    this.entries.set(id, { callback, delay, cleared: false });
    return id;
  }
  clear(id) {
    const entry = this.entries.get(id);
    if (entry) entry.cleared = true;
  }
  latest() { return [...this.entries.entries()].at(-1); }
  run(id, { force = false } = {}) {
    const entry = this.entries.get(id);
    if (!entry || (entry.cleared && !force)) throw new Error('timer is not runnable');
    return entry.callback();
  }
}

function record(id) {
  return {
    id,
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };
}

function response(status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null }
  };
}

async function setup({ intervalSeconds, fetchImpl = async () => response() }) {
  const records = [record('one'), record('two')];
  const storage = new MemoryStorage();
  const jobStore = createJobStore({ storageArea: storage });
  let job = startDeleteJob(buildDeletePlan({
    ids: records.map(item => item.id),
    records,
    intervalSeconds,
    now: 1000,
    jobId: `fast-${intervalSeconds}`
  }), { now: 1000 });
  job = await jobStore.save(job, { expectedRevision: null });
  const inventory = new MemoryInventory(records);
  const alarms = new FakeAlarms();
  const timers = new FakeTimers();
  let clock = 1000;
  const executor = createDeleteJobExecutor({
    jobStore,
    inventory,
    alarms,
    acquireSessionToken: async () => 'synthetic-token',
    fetchImpl,
    now: () => clock,
    setTimeoutImpl: (callback, delay) => timers.set(callback, delay),
    clearTimeoutImpl: id => timers.clear(id)
  });
  return {
    alarms,
    executor,
    inventory,
    job,
    jobStore,
    timers,
    setNow(value) { clock = value; }
  };
}

test('150 seconds remains exact from completion through durable target and alarm', async () => {
  const context = await setup({ intervalSeconds: 150 });

  await context.executor.executeStep({ name: DEFAULT_ALARM_NAME, scheduledTime: 1000 });
  const job = await context.jobStore.load();

  assert.equal(job.interval_seconds, 150);
  assert.equal(job.next_run_at, 151000);
  assert.deepEqual(context.alarms.created.at(-1), {
    name: DEFAULT_ALARM_NAME,
    when: 151000
  });
  assert.equal(context.timers.entries.size, 0);
});

test('fast scheduling installs one target timer and one 30-second backup alarm', async () => {
  const context = await setup({ intervalSeconds: 5 });

  const audit = await context.executor.schedule(context.job);
  const [, timer] = context.timers.latest();

  assert.deepEqual(audit, {
    mode: 'fast_timer_with_backup',
    alarm_time: 31000,
    fast_delay_ms: 0
  });
  assert.equal(timer.delay, 0);
  assert.deepEqual(context.alarms.created.at(-1), {
    name: DEFAULT_ALARM_NAME,
    when: 31000
  });
});

test('fast timer winning a backup race cannot authorize a duplicate or stale next item', async () => {
  let releaseFetch;
  const fetchGate = new Promise(resolve => { releaseFetch = resolve; });
  let requests = 0;
  const context = await setup({
    intervalSeconds: 1,
    fetchImpl: async () => {
      requests += 1;
      await fetchGate;
      return response();
    }
  });
  await context.executor.schedule(context.job);
  const [firstTimerId] = context.timers.latest();

  const timerExecution = context.timers.run(firstTimerId);
  await new Promise(resolve => setImmediate(resolve));
  const racingBackup = await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 31000
  });
  assert.equal(racingBackup.outcome, 'busy');

  context.setNow(1100);
  releaseFetch();
  await timerExecution;
  assert.equal(requests, 1);
  const staleBackup = await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 31000
  });
  assert.equal(staleBackup.outcome, 'stale_alarm');
  assert.equal(requests, 1);
});

test('backup winning after a lost worker timer invalidates that obsolete timer callback', async () => {
  let requests = 0;
  const context = await setup({
    intervalSeconds: 1,
    fetchImpl: async () => { requests += 1; return response(); }
  });
  await context.executor.schedule(context.job);
  const [lostTimerId] = context.timers.latest();

  context.setNow(31000);
  const backup = await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 31000
  });
  const obsoleteTimer = await context.timers.run(lostTimerId, { force: true });

  assert.equal(backup.outcome, 'completed_item');
  assert.equal(obsoleteTimer.outcome, 'stale_timer');
  assert.equal(requests, 1);
});

test('clearing a fast schedule invalidates both timer and durable alarm paths', async () => {
  const context = await setup({ intervalSeconds: 29 });
  await context.executor.schedule(context.job);
  const [timerId] = context.timers.latest();

  await context.executor.clearSchedule();

  assert.equal(context.timers.entries.get(timerId).cleared, true);
  assert.equal(context.alarms.cleared.at(-1), DEFAULT_ALARM_NAME);
});
