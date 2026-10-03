'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { JOB_STORAGE_KEY } = require('../job-store.js');
const { createJobClient } = require('../job-client.js');

class FakeStorageChanges {
  constructor() { this.listeners = new Set(); }
  addListener(listener) { this.listeners.add(listener); }
  removeListener(listener) { this.listeners.delete(listener); }
  emit(changes, area = 'local') {
    for (const listener of this.listeners) listener(changes, area);
  }
}

function setup() {
  let job = { schema_version: 1, state: 'draft', revision: 1 };
  const messages = [];
  const changes = new FakeStorageChanges();
  const runtime = {
    async sendMessage(message) {
      messages.push(structuredClone(message));
      if (message.type === 'delete_job:get') return { ok: true, job: structuredClone(job) };
      if (message.type === 'delete_job:pause') {
        job = { ...job, state: 'paused', revision: job.revision + 1 };
        return { ok: true, job: structuredClone(job) };
      }
      if (message.type === 'delete_job:dismiss_terminal') {
        job = null;
        return { ok: true, job: null };
      }
      return { ok: false, error_code: 'unknown_command' };
    }
  };
  return {
    changes,
    messages,
    runtime,
    storage: { onChanged: changes },
    setJob(value) { job = value; }
  };
}

test('two dashboards reconstruct the same job and synchronize through storage changes', async () => {
  const context = setup();
  const observedA = [];
  const observedB = [];
  const clientA = createJobClient({
    runtime: context.runtime,
    storage: context.storage,
    storageKey: JOB_STORAGE_KEY,
    validateJob: value => structuredClone(value),
    onChange: value => observedA.push(value)
  });
  const clientB = createJobClient({
    runtime: context.runtime,
    storage: context.storage,
    storageKey: JOB_STORAGE_KEY,
    validateJob: value => structuredClone(value),
    onChange: value => observedB.push(value)
  });

  await clientA.connect();
  await clientB.connect();
  assert.deepEqual(observedA.at(-1), observedB.at(-1));

  const running = { schema_version: 1, state: 'running', revision: 2 };
  context.changes.emit({
    [JOB_STORAGE_KEY]: { oldValue: observedA.at(-1), newValue: running }
  });
  assert.deepEqual(observedA.at(-1), running);
  assert.deepEqual(observedB.at(-1), running);

  clientA.disconnect();
  clientB.disconnect();
  assert.equal(context.changes.listeners.size, 0);
});

test('commands go only through runtime messaging and update the local snapshot', async () => {
  const context = setup();
  const observed = [];
  const client = createJobClient({
    runtime: context.runtime,
    storage: context.storage,
    validateJob: value => structuredClone(value),
    onChange: value => observed.push(value)
  });
  await client.connect();

  const paused = await client.pause();

  assert.equal(paused.state, 'paused');
  assert.equal(client.getSnapshot().state, 'paused');
  assert.deepEqual(context.messages.map(message => message.type), [
    'delete_job:get',
    'delete_job:pause'
  ]);
  assert.equal(typeof context.storage.set, 'undefined');
});

test('invalid storage updates fail closed without exposing the corrupt snapshot', async () => {
  const context = setup();
  const events = [];
  const client = createJobClient({
    runtime: context.runtime,
    storage: context.storage,
    validateJob() { throw new Error('private corrupt detail'); },
    onChange: (job, metadata) => events.push({ job, metadata })
  });
  await assert.rejects(() => client.connect(), error => error.code === 'invalid_job_state');
  context.changes.emit({ [JOB_STORAGE_KEY]: { newValue: { token: 'secret' } } });

  assert.deepEqual(events.at(-1), {
    job: null,
    metadata: { error_code: 'invalid_job_state' }
  });
  assert.equal(JSON.stringify(events).includes('secret'), false);
});

test('terminal dismissal is sent through the background command boundary', async () => {
  const context = setup();
  const client = createJobClient({
    runtime: context.runtime,
    storage: context.storage,
    validateJob: value => structuredClone(value)
  });
  await client.connect();

  const result = await client.dismissTerminal();

  assert.equal(result, null);
  assert.equal(context.messages.at(-1).type, 'delete_job:dismiss_terminal');
});
