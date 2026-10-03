'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const {
  ITEM_STATES,
  JOB_STATES,
  approveProjectSubset,
  buildDeletePlan,
  requestCancel,
  requestPause,
  startDeleteJob
} = require('../delete-job.js');
const {
  JOB_STORAGE_KEY,
  createJobStore
} = require('../job-store.js');
const {
  DEFAULT_ALARM_NAME,
  createDeleteJobExecutor
} = require('../delete-job-executor.js');

class FakeStorageArea {
  constructor() {
    this.data = {};
  }

  async get(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key)
      ? { [key]: structuredClone(this.data[key]) }
      : {};
  }

  async set(values) {
    Object.assign(this.data, structuredClone(values));
  }

  async remove(key) {
    delete this.data[key];
  }
}

class MemoryInventory {
  constructor(records) {
    this.records = new Map(records.map(item => [item.id, structuredClone(item)]));
    this.deletedIds = [];
    this.failDelete = false;
    this.initCalls = 0;
  }

  async init() {
    this.initCalls += 1;
  }

  async getConversation(id) {
    const value = this.records.get(id);
    return value ? structuredClone(value) : undefined;
  }

  async deleteConversation(id) {
    if (this.failDelete) throw new Error('Synthetic IndexedDB failure');
    this.deletedIds.push(id);
    this.records.delete(id);
  }
}

class FakeAlarms {
  constructor() {
    this.created = [];
    this.cleared = [];
  }

  async create(name, info) {
    this.created.push({ name, ...structuredClone(info) });
  }

  async clear(name) {
    this.cleared.push(name);
    return true;
  }
}

function record(id, classification = CLASSIFICATIONS.STANDALONE) {
  return {
    id,
    title: `Synthetic ${id}`,
    classification,
    classification_evidence:
      classification === CLASSIFICATIONS.UNKNOWN ? 'search-only' : 'history-sync'
  };
}

function response(status, headers = {}) {
  const values = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return values[name.toLowerCase()] ?? null;
      }
    },
    async text() {
      throw new Error('executor must not read private response bodies');
    }
  };
}

async function setup({
  records = [record('one'), record('two')],
  ids = records.map(item => item.id),
  now = 1000,
  fetchImpl = async () => response(200),
  acquireSessionToken = async () => 'synthetic-memory-token'
} = {}) {
  const storage = new FakeStorageArea();
  const jobStore = createJobStore({ storageArea: storage });
  let job = buildDeletePlan({
    ids,
    records,
    intervalSeconds: 600,
    now,
    jobId: 'delete-job-executor-test'
  });
  if (job.items.some(item =>
    item.approved_classification === CLASSIFICATIONS.PROJECT
  )) {
    job = approveProjectSubset(job, { now });
  }
  job = startDeleteJob(job, { now });
  job = await jobStore.save(job, { expectedRevision: null });
  const inventory = new MemoryInventory(records);
  const alarms = new FakeAlarms();
  let currentTime = now;
  const executor = createDeleteJobExecutor({
    jobStore,
    inventory,
    alarms,
    acquireSessionToken,
    fetchImpl,
    now: () => currentTime
  });
  return {
    alarms,
    executor,
    inventory,
    jobStore,
    setNow(value) {
      currentTime = value;
    },
    storage
  };
}

test('each alarm step performs exactly one deletion and schedules from confirmed completion', async () => {
  const urls = [];
  const context = await setup({
    fetchImpl: async url => {
      urls.push(url);
      const requestedId = decodeURIComponent(url.split('/').at(-1));
      assert.equal(context.inventory.records.has(requestedId), true);
      return response(200);
    }
  });

  const first = await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  const afterFirst = await context.jobStore.load();

  assert.equal(first.outcome, 'completed_item');
  assert.equal(urls.length, 1);
  assert.deepEqual(context.inventory.deletedIds, ['one']);
  assert.equal(afterFirst.items[0].status, ITEM_STATES.COMPLETED);
  assert.equal(afterFirst.items[1].status, ITEM_STATES.PENDING);
  assert.equal(afterFirst.state, JOB_STATES.RUNNING);
  assert.equal(afterFirst.next_run_at, 601000);
  assert.deepEqual(context.alarms.created.at(-1), {
    name: DEFAULT_ALARM_NAME,
    when: 601000
  });

  const duplicate = await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  assert.equal(duplicate.outcome, 'stale_alarm');
  assert.equal(urls.length, 1);

  context.setNow(601000);
  const second = await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 601000
  });
  const completed = await context.jobStore.load();
  assert.equal(second.outcome, 'completed_job');
  assert.equal(urls.length, 2);
  assert.deepEqual(context.inventory.deletedIds, ['one', 'two']);
  assert.equal(completed.state, JOB_STATES.COMPLETED);
  assert.equal(completed.finished_at, 601000);
  assert.equal(completed.next_run_at, null);
});

test('verified Project conversations use only the conversation deletion endpoint', async () => {
  const urls = [];
  const projectRecord = record('project-one', CLASSIFICATIONS.PROJECT);
  const context = await setup({
    records: [projectRecord],
    fetchImpl: async url => {
      urls.push(url);
      return response(200);
    }
  });

  await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });

  assert.deepEqual(urls, [
    'https://chatgpt.com/backend-api/conversation/project-one'
  ]);
  assert.equal(urls[0].includes('/project/'), false);
});

for (const scenario of [
  {
    name: 'HTTP failure',
    fetchImpl: async () => response(500),
    expectedCode: 'http_500',
    expectedStatus: 500
  },
  {
    name: 'rate limit',
    fetchImpl: async () => response(429, { 'Retry-After': '90' }),
    expectedCode: 'http_429',
    expectedStatus: 429,
    expectedRetry: 90000
  },
  {
    name: 'network failure',
    fetchImpl: async () => {
      throw new Error('Synthetic private network detail');
    },
    expectedCode: 'network_error',
    expectedStatus: null
  }
]) {
  test(`${scenario.name} pauses safely and preserves local inventory`, async () => {
    const context = await setup({ fetchImpl: scenario.fetchImpl });

    const result = await context.executor.executeStep({
      name: DEFAULT_ALARM_NAME,
      scheduledTime: 1000
    });
    const job = await context.jobStore.load();

    assert.equal(result.outcome, 'error_paused');
    assert.equal(job.state, JOB_STATES.ERROR_PAUSED);
    assert.equal(job.last_error.code, scenario.expectedCode);
    assert.equal(job.http_status, scenario.expectedStatus);
    assert.equal(job.retry_after_ms, scenario.expectedRetry ?? null);
    assert.equal(job.items[0].status, ITEM_STATES.FAILED);
    assert.equal(context.inventory.records.has('one'), true);
    assert.deepEqual(context.inventory.deletedIds, []);
    assert.equal(context.alarms.created.length, 0);
    assert.equal(JSON.stringify(job).includes('Synthetic private'), false);
  });
}

test('session acquisition failure pauses without starting transport', async () => {
  let requests = 0;
  const context = await setup({
    acquireSessionToken: async () => {
      throw new Error('Synthetic session details');
    },
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    }
  });

  await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  const job = await context.jobStore.load();

  assert.equal(requests, 0);
  assert.equal(job.state, JOB_STATES.ERROR_PAUSED);
  assert.equal(job.last_error.code, 'session_unavailable');
  assert.equal(context.inventory.records.has('one'), true);
  assert.equal(JSON.stringify(context.storage.data).includes('memory-token'), false);
});

test('eligibility changed before the turn pauses without transport', async () => {
  let requests = 0;
  const context = await setup({
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    }
  });
  context.inventory.records.set(
    'one',
    record('one', CLASSIFICATIONS.UNKNOWN)
  );

  await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  const job = await context.jobStore.load();

  assert.equal(requests, 0);
  assert.equal(job.state, JOB_STATES.ERROR_PAUSED);
  assert.equal(job.last_error.code, 'eligibility_changed');
  assert.equal(job.items[0].status, ITEM_STATES.SKIPPED_INELIGIBLE);
  assert.equal(context.inventory.records.has('one'), true);
});

test('execution guard prevents parallel requests from duplicate delivery', async () => {
  let releaseFetch;
  const fetchGate = new Promise(resolve => {
    releaseFetch = resolve;
  });
  let requests = 0;
  const context = await setup({
    fetchImpl: async () => {
      requests += 1;
      await fetchGate;
      return response(200);
    }
  });

  const first = context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.executor.isExecuting(), true);
  const duplicate = await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });

  assert.equal(duplicate.outcome, 'busy');
  assert.equal(requests, 1);
  releaseFetch();
  await first;
  assert.equal(context.executor.isExecuting(), false);
});

test('Pause requested in flight reconciles success then settles paused', async () => {
  let releaseFetch;
  const fetchGate = new Promise(resolve => {
    releaseFetch = resolve;
  });
  const context = await setup({
    fetchImpl: async () => {
      await fetchGate;
      return response(200);
    }
  });

  const execution = context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  await new Promise(resolve => setImmediate(resolve));
  await context.jobStore.update(job => requestPause(job, { now: 1100 }));
  releaseFetch();
  await execution;
  const job = await context.jobStore.load();

  assert.equal(job.state, JOB_STATES.PAUSED);
  assert.equal(job.items[0].status, ITEM_STATES.COMPLETED);
  assert.equal(job.items[1].status, ITEM_STATES.PENDING);
  assert.equal(job.next_run_at, null);
  assert.deepEqual(context.inventory.deletedIds, ['one']);
});

test('Cancel requested in flight reconciles success then cancels remaining', async () => {
  let releaseFetch;
  const fetchGate = new Promise(resolve => {
    releaseFetch = resolve;
  });
  const context = await setup({
    fetchImpl: async () => {
      await fetchGate;
      return response(200);
    }
  });

  const execution = context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  await new Promise(resolve => setImmediate(resolve));
  await context.jobStore.update(job => requestCancel(job, { now: 1100 }));
  releaseFetch();
  await execution;
  const job = await context.jobStore.load();

  assert.equal(job.state, JOB_STATES.CANCELLED);
  assert.equal(job.items[0].status, ITEM_STATES.COMPLETED);
  assert.equal(job.items[1].status, ITEM_STATES.PENDING);
  assert.deepEqual(context.inventory.deletedIds, ['one']);
});

test('remote success followed by local removal failure cannot repeat transport', async () => {
  let requests = 0;
  const context = await setup({
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    }
  });
  context.inventory.failDelete = true;

  await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  const failed = await context.jobStore.load();
  assert.equal(failed.state, JOB_STATES.ERROR_PAUSED);
  assert.equal(failed.last_error.code, 'local_reconcile_error');
  assert.equal(failed.items[0].status, ITEM_STATES.COMPLETED);
  assert.equal(context.inventory.records.has('one'), true);

  const ignored = await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  });
  assert.equal(ignored.outcome, 'state_not_executable');
  assert.equal(requests, 1);
});

test('wrong, early, paused, and terminal alarms are ignored', async () => {
  let requests = 0;
  const context = await setup({
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    }
  });

  assert.equal((await context.executor.executeStep({
    name: 'wrong-alarm',
    scheduledTime: 1000
  })).outcome, 'wrong_alarm');
  context.setNow(999);
  assert.equal((await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  })).outcome, 'early_alarm');
  await context.jobStore.update(job => requestPause(job, { now: 1000 }));
  context.setNow(1000);
  assert.equal((await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  })).outcome, 'state_not_executable');
  await context.jobStore.update(job => requestCancel(job, { now: 1100 }));
  assert.equal((await context.executor.executeStep({
    name: DEFAULT_ALARM_NAME,
    scheduledTime: 1000
  })).outcome, 'state_not_executable');
  assert.equal(requests, 0);
});

test('recovering a durable requesting item pauses without retrying', async () => {
  let requests = 0;
  const context = await setup({
    fetchImpl: async () => {
      requests += 1;
      return response(200);
    }
  });
  await context.jobStore.update(job => {
    job.current_conversation_id = 'one';
    job.items[0].status = ITEM_STATES.REQUESTING;
    job.items[0].requested_at = 1000;
    return job;
  });

  const recovered = await context.executor.recoverInterruptedRequest();
  const job = await context.jobStore.load();

  assert.equal(recovered.outcome, 'recovered_interrupted_request');
  assert.equal(job.state, JOB_STATES.ERROR_PAUSED);
  assert.equal(job.last_error.code, 'interrupted_request');
  assert.equal(job.items[0].status, ITEM_STATES.FAILED);
  assert.equal(job.current_conversation_id, null);
  assert.equal(requests, 0);
});

test('ensureSchedule recreates only the one current running alarm', async () => {
  const context = await setup();

  await context.executor.ensureSchedule();
  assert.deepEqual(context.alarms.created, [{
    name: DEFAULT_ALARM_NAME,
    when: 1000
  }]);
  await context.jobStore.update(job => requestPause(job, { now: 1100 }));
  await context.executor.ensureSchedule();
  assert.deepEqual(context.alarms.cleared, [DEFAULT_ALARM_NAME]);
  assert.equal(context.storage.data[JOB_STORAGE_KEY].state, JOB_STATES.PAUSED);
});
