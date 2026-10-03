'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const { JOB_STATES } = require('../delete-job.js');
const { createJobStore } = require('../job-store.js');
const { createDeleteJobController } = require('../job-controller.js');

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
  }
  async init() {}
  async getConversation(id) {
    const value = this.records.get(id);
    return value ? structuredClone(value) : undefined;
  }
}

function record(id, classification) {
  return {
    id,
    classification,
    classification_evidence:
      classification === CLASSIFICATIONS.UNKNOWN ? 'search-only' : 'history-sync'
  };
}

function setup(records) {
  const jobStore = createJobStore({ storageArea: new MemoryStorage() });
  const executor = {
    scheduled: [],
    async schedule(job) { this.scheduled.push(structuredClone(job)); },
    async clearSchedule() {}
  };
  const controller = createDeleteJobController({
    jobStore,
    inventory: new MemoryInventory(records),
    executor,
    now: () => 5000,
    idFactory: () => 'atomic-start-job'
  });
  return { controller, executor, jobStore };
}

test('reviewed Standalone and exact Project subset start atomically with the exact interval', async () => {
  const records = [
    record('standalone', CLASSIFICATIONS.STANDALONE),
    record('project', CLASSIFICATIONS.PROJECT)
  ];
  const context = setup(records);

  const running = await context.controller.startPlan({
    ids: ['standalone', 'project'],
    intervalSeconds: 150,
    approvedProjectIds: ['project']
  });

  assert.equal(running.state, JOB_STATES.RUNNING);
  assert.equal(running.interval_seconds, 150);
  assert.deepEqual(running.project_approval_ids, ['project']);
  assert.equal(running.next_run_at, 5000);
  assert.equal(context.executor.scheduled.length, 1);
  assert.deepEqual(await context.jobStore.load(), running);
});

for (const classification of [CLASSIFICATIONS.UNKNOWN, CLASSIFICATIONS.CUSTOM_GPT]) {
  test(`${classification} cannot leave an abandoned durable draft during atomic Start`, async () => {
    const context = setup([record('blocked', classification)]);

    await assert.rejects(
      () => context.controller.startPlan({
        ids: ['blocked'],
        intervalSeconds: 150,
        approvedProjectIds: []
      }),
      error => error.code === 'plan_not_ready'
    );

    assert.equal(await context.jobStore.load(), null);
    assert.equal(context.executor.scheduled.length, 0);
  });
}

test('Project authority must match the complete unchanged included subset', async () => {
  const context = setup([
    record('project-one', CLASSIFICATIONS.PROJECT),
    record('project-two', CLASSIFICATIONS.PROJECT)
  ]);

  await assert.rejects(
    () => context.controller.startPlan({
      ids: ['project-one', 'project-two'],
      intervalSeconds: 150,
      approvedProjectIds: ['project-one']
    }),
    error => error.code === 'project_approval_required'
  );
  assert.equal(await context.jobStore.load(), null);
});

test('atomic Start still rejects a second non-terminal DeleteJob', async () => {
  const context = setup([record('one', CLASSIFICATIONS.STANDALONE)]);
  await context.controller.startPlan({
    ids: ['one'],
    intervalSeconds: 150,
    approvedProjectIds: []
  });

  await assert.rejects(
    () => context.controller.startPlan({
      ids: ['one'],
      intervalSeconds: 150,
      approvedProjectIds: []
    }),
    error => error.code === 'active_job_exists'
  );
});
