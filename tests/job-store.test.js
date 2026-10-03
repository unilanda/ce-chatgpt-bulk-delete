'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const { buildDeletePlan, startDeleteJob } = require('../delete-job.js');
const {
  JOB_STORAGE_KEY,
  SCHEMA_VERSION,
  InvalidJobStateError,
  createJobStore,
  validateDeleteJob
} = require('../job-store.js');

class FakeStorageArea {
  constructor(initial = {}) {
    this.data = structuredClone(initial);
    this.setCalls = [];
    this.removeCalls = [];
  }

  async get(key) {
    return Object.prototype.hasOwnProperty.call(this.data, key)
      ? { [key]: structuredClone(this.data[key]) }
      : {};
  }

  async set(values) {
    this.setCalls.push(structuredClone(values));
    Object.assign(this.data, structuredClone(values));
  }

  async remove(key) {
    this.removeCalls.push(key);
    delete this.data[key];
  }
}

function standalone(id = 'standalone-one') {
  return {
    id,
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };
}

function jobFixture() {
  return buildDeletePlan({
    ids: ['standalone-one'],
    records: [standalone()],
    intervalSeconds: 600,
    now: 1000,
    jobId: 'delete-job-store-test'
  });
}

test('JobStore round-trips a validated V1 job and increments revision', async () => {
  const storage = new FakeStorageArea();
  const store = createJobStore({ storageArea: storage });

  assert.equal(await store.load(), null);
  const saved = await store.save(jobFixture(), { expectedRevision: null });
  const reopened = createJobStore({ storageArea: storage });

  assert.equal(SCHEMA_VERSION, 1);
  assert.equal(JOB_STORAGE_KEY, 'chatgpt_manager_active_delete_job_v1');
  assert.equal(saved.revision, 1);
  assert.deepEqual(await reopened.load(), saved);
  assert.notStrictEqual(await reopened.load(), storage.data[JOB_STORAGE_KEY]);
});

test('stale expected revisions are rejected without overwriting durable state', async () => {
  const storage = new FakeStorageArea();
  const store = createJobStore({ storageArea: storage });
  const saved = await store.save(jobFixture(), { expectedRevision: null });
  const changed = structuredClone(saved);
  changed.updated_at = 2000;

  await assert.rejects(
    store.save(changed, { expectedRevision: 0 }),
    /revision/i
  );
  assert.deepEqual(await store.load(), saved);
  assert.equal(storage.setCalls.length, 1);
});

test('serialized updates observe the preceding revision and never lose an update', async () => {
  const storage = new FakeStorageArea();
  const store = createJobStore({ storageArea: storage });
  await store.save(jobFixture(), { expectedRevision: null });
  const observed = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => {
    releaseFirst = resolve;
  });

  const first = store.update(async current => {
    observed.push(`first:${current.revision}`);
    await firstGate;
    current.updated_at = 2000;
    return current;
  });
  const second = store.update(current => {
    observed.push(`second:${current.revision}`);
    current.updated_at = 3000;
    return current;
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(observed, ['first:1']);
  releaseFirst();
  const [firstSaved, secondSaved] = await Promise.all([first, second]);

  assert.equal(firstSaved.revision, 2);
  assert.equal(secondSaved.revision, 3);
  assert.deepEqual(observed, ['first:1', 'second:2']);
  assert.equal((await store.load()).updated_at, 3000);
});

test('saving and clearing a job preserves the existing deletion interval setting', async () => {
  const storage = new FakeStorageArea({ delete_interval_seconds: 900 });
  const store = createJobStore({ storageArea: storage });

  await store.save(jobFixture(), { expectedRevision: null });
  await store.clear();

  assert.equal(storage.data.delete_interval_seconds, 900);
  assert.equal(storage.data[JOB_STORAGE_KEY], undefined);
  assert.deepEqual(storage.removeCalls, [JOB_STORAGE_KEY]);
});

test('validation returns a defensive clone for the exact V1 schema', () => {
  const job = jobFixture();
  const validated = validateDeleteJob(job);

  assert.deepEqual(validated, job);
  assert.notStrictEqual(validated, job);
  validated.items[0].conversation_id = 'changed';
  assert.equal(job.items[0].conversation_id, 'standalone-one');
});

for (const [name, mutate] of [
  ['future schema', job => { job.schema_version = 2; }],
  ['unknown top-level field', job => { job.authorization = 'Bearer synthetic'; }],
  ['unknown item field', job => { job.items[0].raw_response = { private: true }; }],
  ['unknown error structure', job => { job.last_error = { code: 'http_error', body: {} }; }],
  ['invalid state', job => { job.state = 'mystery'; }],
  ['malformed item status', job => { job.items[0].status = 'maybe'; }],
  ['inconsistent counts', job => { job.counts.pending = 0; }],
  ['invalid interval', job => { job.interval_seconds = 0; }],
  ['duplicate item IDs', job => { job.items.push(structuredClone(job.items[0])); job.counts.total = 2; job.counts.pending = 2; }]
]) {
  test(`validation fails closed for ${name}`, () => {
    const job = jobFixture();
    mutate(job);

    assert.throws(
      () => validateDeleteJob(job),
      error => error instanceof InvalidJobStateError
    );
  });
}

test('validation rejects a running job without a scheduled turn', () => {
  const job = startDeleteJob(jobFixture(), { now: 1000 });
  job.next_run_at = null;
  assert.throws(() => validateDeleteJob(job), InvalidJobStateError);
});

test('validation rejects forged executable Project authority', () => {
  const project = {
    id: 'project-one',
    classification: CLASSIFICATIONS.PROJECT,
    classification_evidence: 'history-sync'
  };
  const job = buildDeletePlan({
    ids: [project.id],
    records: [project],
    intervalSeconds: 600,
    now: 1000,
    jobId: 'forged-project-job'
  });
  job.state = 'running';
  job.started_at = 1000;
  job.next_run_at = 1000;

  assert.throws(() => validateDeleteJob(job), InvalidJobStateError);
});

test('validation rejects blocked membership in a ready state', () => {
  const job = jobFixture();
  job.items[0].approved_classification = null;
  job.items[0].blocked_reason = 'unverified';
  assert.throws(() => validateDeleteJob(job), InvalidJobStateError);
});

test('validation rejects request flags and requesting items that disagree with state', () => {
  const flagged = jobFixture();
  flagged.pause_requested = true;
  assert.throws(() => validateDeleteJob(flagged), InvalidJobStateError);

  const requesting = startDeleteJob(jobFixture(), { now: 1000 });
  requesting.items[0].status = 'requesting';
  requesting.items[0].requested_at = 1000;
  requesting.current_conversation_id = requesting.items[0].conversation_id;
  requesting.state = 'paused';
  requesting.next_run_at = null;
  assert.throws(() => validateDeleteJob(requesting), InvalidJobStateError);
});

test('validation rejects completed state while pending work remains', () => {
  const job = jobFixture();
  job.state = 'completed';
  job.finished_at = 1000;
  assert.throws(() => validateDeleteJob(job), InvalidJobStateError);
});

test('invalid durable state is not rewritten or executed by load', async () => {
  const invalid = jobFixture();
  invalid.token = 'synthetic-secret-that-must-not-persist';
  const storage = new FakeStorageArea({ [JOB_STORAGE_KEY]: invalid });
  const store = createJobStore({ storageArea: storage });

  await assert.rejects(
    store.load(),
    error => error instanceof InvalidJobStateError
  );
  assert.equal(storage.setCalls.length, 0);
  assert.equal(storage.data[JOB_STORAGE_KEY].token, invalid.token);
});

test('durable snapshots contain no authentication or private response fields', async () => {
  const storage = new FakeStorageArea();
  const store = createJobStore({ storageArea: storage });
  await store.save(jobFixture(), { expectedRevision: null });
  const serialized = JSON.stringify(storage.data[JOB_STORAGE_KEY]).toLowerCase();

  for (const forbidden of [
    'accesstoken',
    'authorization',
    'cookie',
    'raw_response',
    'message_content'
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
