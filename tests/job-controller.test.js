'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const { ITEM_STATES, JOB_STATES } = require('../delete-job.js');
const { createJobStore } = require('../job-store.js');
const { createDeleteJobController } = require('../job-controller.js');

class FakeStorageArea {
  constructor() { this.data = {}; }
  async get(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key)
      ? { [key]: structuredClone(this.data[key]) }
      : {};
  }
  async set(values) { Object.assign(this.data, structuredClone(values)); }
  async remove(key) { delete this.data[key]; }
}

class MemoryInventory {
  constructor(records) {
    this.records = new Map(records.map(record => [record.id, structuredClone(record)]));
  }
  async init() {}
  async getConversation(id) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
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

function setup(records = [record('one'), record('two')]) {
  const storage = new FakeStorageArea();
  const jobStore = createJobStore({ storageArea: storage });
  const inventory = new MemoryInventory(records);
  const executor = {
    scheduled: [],
    cleared: 0,
    async schedule(job) { this.scheduled.push(structuredClone(job)); },
    async clearSchedule() { this.cleared += 1; },
    async recoverInterruptedRequest() {
      return { outcome: 'no_interrupted_request' };
    }
  };
  let currentTime = 1000;
  let nextId = 0;
  const create = () => createDeleteJobController({
    jobStore,
    inventory,
    executor,
    now: () => currentTime,
    idFactory: () => `job-${++nextId}`
  });
  return {
    create,
    executor,
    inventory,
    jobStore,
    setNow(value) { currentTime = value; }
  };
}

async function createReady(controller, ids = ['one', 'two']) {
  return controller.createPlan({ ids, intervalSeconds: 600 });
}

test('two controllers observe one durable plan and a second active job is rejected', async () => {
  const context = setup();
  const first = context.create();
  const second = context.create();

  const planned = await createReady(first);
  assert.equal(planned.state, JOB_STATES.READY);
  assert.deepEqual(await second.getJob(), planned);
  await assert.rejects(
    () => second.createPlan({ ids: ['two'], intervalSeconds: 600 }),
    error => error.code === 'active_job_exists'
  );
});

test('start schedules one immediate wake and duplicate start is idempotent', async () => {
  const context = setup();
  const controller = context.create();
  await createReady(controller);

  const running = await controller.start();
  const duplicate = await controller.start();

  assert.equal(running.state, JOB_STATES.RUNNING);
  assert.equal(running.next_run_at, 1000);
  assert.equal(duplicate.revision, running.revision);
  assert.equal(context.executor.scheduled.length, 1);
});

test('idle Pause and Cancel clear future work and duplicate controls are safe', async () => {
  const pauseContext = setup();
  const pauseController = pauseContext.create();
  await createReady(pauseController);
  await pauseController.start();
  const paused = await pauseController.pause();
  const pausedAgain = await pauseController.pause();
  assert.equal(paused.state, JOB_STATES.PAUSED);
  assert.equal(pausedAgain.revision, paused.revision);
  assert.equal(pauseContext.executor.cleared, 1);

  const cancelContext = setup();
  const cancelController = cancelContext.create();
  await createReady(cancelController);
  await cancelController.start();
  const cancelled = await cancelController.cancel();
  const cancelledAgain = await cancelController.cancel();
  assert.equal(cancelled.state, JOB_STATES.CANCELLED);
  assert.equal(cancelledAgain.revision, cancelled.revision);
  assert.equal(cancelContext.executor.cleared, 1);
});

test('in-flight Pause and Cancel persist requested states without starting another item', async () => {
  for (const action of ['pause', 'cancel']) {
    const context = setup();
    const controller = context.create();
    await createReady(controller);
    await controller.start();
    await context.jobStore.update(job => {
      job.items[0].status = ITEM_STATES.REQUESTING;
      job.items[0].requested_at = 1000;
      job.current_conversation_id = 'one';
      return job;
    });

    const updated = await controller[action]();
    assert.equal(
      updated.state,
      action === 'pause' ? JOB_STATES.PAUSE_REQUESTED : JOB_STATES.CANCEL_REQUESTED
    );
    assert.equal(context.executor.cleared, 1);
  }
});

test('Review & Resume revalidates pending inventory and fails closed on changed eligibility', async () => {
  const context = setup();
  const controller = context.create();
  await createReady(controller);
  await controller.start();
  await controller.pause();
  context.inventory.records.set('one', record('one', CLASSIFICATIONS.UNKNOWN));

  const reviewed = await controller.resume();

  assert.equal(reviewed.state, JOB_STATES.DRAFT);
  assert.equal(reviewed.items[0].blocked_reason, 'unverified');
  assert.equal(context.executor.scheduled.length, 1);
});

test('Review & Resume schedules once and duplicate resume while running is idempotent', async () => {
  const context = setup();
  const controller = context.create();
  await createReady(controller);
  await controller.start();
  await controller.pause();
  context.executor.scheduled = [];

  const resumed = await controller.resume();
  const duplicate = await controller.resume();

  assert.equal(resumed.state, JOB_STATES.RUNNING);
  assert.equal(duplicate.revision, resumed.revision);
  assert.equal(context.executor.scheduled.length, 1);
});

test('Project approval survives resume when the approved plan is unchanged', async () => {
  const context = setup([record('project-one', CLASSIFICATIONS.PROJECT)]);
  const controller = context.create();
  await controller.createPlan({ ids: ['project-one'], intervalSeconds: 600 });
  await controller.approveProjects();
  await controller.start();
  await controller.pause();

  const resumed = await controller.resume();

  assert.equal(resumed.state, JOB_STATES.RUNNING);
  assert.equal(resumed.project_subset_approved, true);
  assert.deepEqual(resumed.project_approval_ids, ['project-one']);
});

test('Project approval survives resume after one approved Project item completed', async () => {
  const context = setup([
    record('project-one', CLASSIFICATIONS.PROJECT),
    record('project-two', CLASSIFICATIONS.PROJECT)
  ]);
  const controller = context.create();
  await controller.createPlan({
    ids: ['project-one', 'project-two'],
    intervalSeconds: 600
  });
  await controller.approveProjects();
  await controller.start();
  await context.jobStore.update(job => {
    job.items[0].status = ITEM_STATES.COMPLETED;
    job.items[0].completed_at = 1100;
    job.counts.completed = 1;
    job.counts.pending = 1;
    job.state = JOB_STATES.PAUSED;
    job.next_run_at = null;
    return job;
  });

  const resumed = await controller.resume();

  assert.equal(resumed.state, JOB_STATES.RUNNING);
  assert.equal(resumed.project_subset_approved, true);
  assert.deepEqual(resumed.project_approval_ids, ['project-one', 'project-two']);
});

test('real browser startup pauses an idle running job and never schedules work', async () => {
  const context = setup();
  const controller = context.create();
  await createReady(controller);
  await controller.start();
  context.executor.scheduled = [];

  const interrupted = await controller.handleBrowserStartup();

  assert.equal(interrupted.state, JOB_STATES.ERROR_PAUSED);
  assert.equal(interrupted.last_error.code, 'browser_restarted');
  assert.equal(interrupted.next_run_at, null);
  assert.equal(context.executor.scheduled.length, 0);
  assert.equal(context.executor.cleared, 1);
});

test('terminal deletion job can be dismissed without inventory or executor effects', async () => {
  const context = setup();
  const controller = context.create();
  await createReady(controller);
  await controller.start();
  await controller.cancel();
  context.executor.scheduled = [];
  context.executor.cleared = 0;

  const dismissed = await controller.dismissTerminal();

  assert.equal(dismissed, null);
  assert.equal(await controller.getJob(), null);
  assert.equal(context.executor.scheduled.length, 0);
  assert.equal(context.executor.cleared, 0);
  assert.equal(context.inventory.records.size, 2);
});

test('terminal dismissal rechecks current state atomically and cannot clear a live job', async () => {
  const context = setup();
  const controller = context.create();
  await createReady(controller);

  await assert.rejects(
    () => controller.dismissTerminal(),
    error => error.code === 'job_not_terminal'
  );
  assert.equal((await controller.getJob()).state, JOB_STATES.READY);
});
