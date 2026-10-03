'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const { CLASSIFICATIONS } = require('../conversation-policy.js');
const { buildDeletePlan, startDeleteJob, ITEM_STATES, JOB_STATES } = require('../delete-job.js');
const JOB_STORAGE_KEY = 'chatgpt_manager_active_delete_job_v1';

class FakeEvent {
  constructor() {
    this.listeners = [];
  }

  addListener(listener) {
    this.listeners.push(listener);
  }
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function createBackgroundHarness({ storedJob } = {}) {
  const fetchCalls = [];
  const importedScripts = [];
  const storage = storedJob === undefined
    ? {}
    : { [JOB_STORAGE_KEY]: clone(storedJob) };
  const storageSetCalls = [];
  const storageRemoveCalls = [];
  const alarmCreateCalls = [];
  const alarmClearCalls = [];
  const consoleCalls = { info: [], warn: [], error: [] };
  const onMessage = new FakeEvent();
  const onStartup = new FakeEvent();
  const onAlarm = new FakeEvent();
  let context;

  const chrome = {
    alarms: {
      onAlarm,
      async create(...args) {
        alarmCreateCalls.push(clone(args));
      },
      async clear(...args) {
        alarmClearCalls.push(clone(args));
        return true;
      }
    },
    runtime: {
      lastError: null,
      onMessage,
      onStartup,
      getURL(resource) {
        return `chrome-extension://synthetic-extension/${resource}`;
      }
    },
    storage: {
      local: {
        async get(key) {
          const result = Object.prototype.hasOwnProperty.call(storage, key)
            ? { [key]: clone(storage[key]) }
            : {};
          return context.structuredClone(result);
        },
        async set(values) {
          storageSetCalls.push(clone(values));
          Object.assign(storage, clone(values));
        },
        async remove(key) {
          storageRemoveCalls.push(key);
          delete storage[key];
        }
      }
    },
    tabs: {
      query(_query, callback) { callback([]); },
      update() {},
      create() {}
    },
    windows: { update() {} }
  };

  const sandbox = {
    chrome,
    console: {
      info: (...args) => consoleCalls.info.push(args),
      warn: (...args) => consoleCalls.warn.push(args),
      error: (...args) => consoleCalls.error.push(args)
    },
    crypto: globalThis.crypto,
    fetch: async (...args) => {
      fetchCalls.push(args);
      throw new Error('Synthetic network boundary reached');
    },
    indexedDB: {
      open() {
        throw new Error('IndexedDB must not open during service-worker initialization');
      }
    },
    queueMicrotask,
    setTimeout,
    clearTimeout
  };
  sandbox.globalThis = sandbox;
  sandbox.importScripts = (...scripts) => {
    for (const script of scripts) {
      importedScripts.push(script);
      const source = fs.readFileSync(path.join(ROOT, script), 'utf8');
      vm.runInContext(source, context, { filename: script });
    }
  };
  context = vm.createContext(sandbox);
  vm.runInContext(
    'globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));',
    context
  );

  const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  assert.doesNotThrow(() => {
    vm.runInContext(source, context, { filename: 'background.js' });
  });

  return {
    alarmClearCalls,
    alarmCreateCalls,
    chrome,
    consoleCalls,
    fetchCalls,
    importedScripts,
    storage,
    storageRemoveCalls,
    storageSetCalls,
    async send(message) {
      const listener = onMessage.listeners[0];
      return new Promise(resolve => {
        assert.equal(listener(message, {}, resolve), true);
      });
    }
  };
}

test('actual background wiring initializes once without network or destructive work', async () => {
  const harness = createBackgroundHarness();

  assert.deepEqual(harness.importedScripts, [
    'runtime-identity.js',
    'timestamp-utils.js',
    'search-core.js',
    'conversation-policy.js',
    'deletion-core.js',
    'delete-job.js',
    'job-store.js',
    'db.js',
    'delete-job-executor.js',
    'job-controller.js',
    'background-runtime.js'
  ]);
  assert.equal(harness.chrome.runtime.onMessage.listeners.length, 1);
  assert.equal(harness.chrome.runtime.onStartup.listeners.length, 1);
  assert.equal(harness.chrome.alarms.onAlarm.listeners.length, 1);
  assert.deepEqual(harness.fetchCalls, []);
  assert.deepEqual(harness.alarmCreateCalls, []);
  assert.deepEqual(harness.alarmClearCalls, []);
  assert.match(harness.consoleCalls.info[0].join(' '), /cm-runtime-20261002-mb3/);

  const response = await harness.send({ type: 'delete_job:get' });
  assert.deepEqual(clone(response), { ok: true, job: null });
  assert.deepEqual(harness.storageSetCalls, []);
  assert.deepEqual(harness.storageRemoveCalls, []);
  assert.deepEqual(harness.alarmCreateCalls, []);
  assert.deepEqual(harness.alarmClearCalls, []);
  assert.deepEqual(harness.fetchCalls, []);

  await harness.chrome.runtime.onStartup.listeners[0]();
  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(harness.alarmClearCalls.length, 1);
});

test('actual background wiring accepts a valid stored draft without mutation', async () => {
  const record = {
    id: 'valid-stored-draft',
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };
  const job = buildDeletePlan({
    ids: [record.id],
    records: [record],
    intervalSeconds: 600,
    now: 1789487000000,
    jobId: 'valid-stored-draft'
  });
  const harness = createBackgroundHarness({ storedJob: job });

  const response = await harness.send({ type: 'delete_job:get' });

  assert.deepEqual(clone(response), { ok: true, job });
  assert.deepEqual(harness.storage[JOB_STORAGE_KEY], job);
  assert.deepEqual(harness.storageSetCalls, []);
  assert.deepEqual(harness.storageRemoveCalls, []);
  assert.deepEqual(harness.alarmCreateCalls, []);
  assert.deepEqual(harness.fetchCalls, []);
});

test('actual background wiring fails closed for malformed stored job state', async () => {
  const malformed = { schema_version: 999, state: 'running' };
  const harness = createBackgroundHarness({ storedJob: malformed });

  const response = await harness.send({ type: 'delete_job:get' });
  await harness.chrome.runtime.onStartup.listeners[0]();

  assert.deepEqual(clone(response), { ok: false, error_code: 'internal_error' });
  assert.deepEqual(harness.storage[JOB_STORAGE_KEY], malformed);
  assert.deepEqual(harness.storageSetCalls, []);
  assert.deepEqual(harness.storageRemoveCalls, []);
  assert.deepEqual(harness.alarmCreateCalls, []);
  assert.deepEqual(harness.fetchCalls, []);
  assert.equal(JSON.stringify(response).includes('schema_version'), false);
});

test('ordinary service-worker recreation fails closed for a durable requesting item', async () => {
  const record = {
    id: 'interrupted-request',
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };
  const planned = buildDeletePlan({
    ids: [record.id], records: [record], intervalSeconds: 150,
    now: 1789487000000, jobId: 'interrupted-request'
  });
  const running = startDeleteJob(planned, { now: 1789487001000 });
  running.items[0].status = ITEM_STATES.REQUESTING;
  running.items[0].requested_at = 1789487001500;
  running.current_conversation_id = record.id;
  running.updated_at = 1789487001500;

  const harness = createBackgroundHarness({ storedJob: running });
  const response = await harness.send({ type: 'delete_job:get' });

  assert.equal(response.ok, true);
  assert.equal(response.job.state, JOB_STATES.ERROR_PAUSED);
  assert.equal(response.job.items[0].status, ITEM_STATES.FAILED);
  assert.equal(response.job.items[0].error_code, 'interrupted_request');
  assert.equal(response.job.last_error.code, 'interrupted_request');
  assert.equal(response.job.current_conversation_id, null);
  assert.equal(response.job.next_run_at, null);
  assert.equal(harness.fetchCalls.length, 0);
  assert.equal(harness.alarmClearCalls.length, 1);
});

test('ordinary service-worker recreation leaves a healthy running scheduled job untouched', async () => {
  const record = {
    id: 'healthy-running',
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };
  const planned = buildDeletePlan({
    ids: [record.id], records: [record], intervalSeconds: 150,
    now: 1789487000000, jobId: 'healthy-running'
  });
  const running = startDeleteJob(planned, { now: 1789487001000 });
  const harness = createBackgroundHarness({ storedJob: running });

  const response = await harness.send({ type: 'delete_job:get' });

  assert.deepEqual(clone(response), { ok: true, job: running });
  assert.deepEqual(harness.storage[JOB_STORAGE_KEY], running);
  assert.deepEqual(harness.storageSetCalls, []);
  assert.deepEqual(harness.alarmCreateCalls, []);
  assert.deepEqual(harness.alarmClearCalls, []);
  assert.deepEqual(harness.fetchCalls, []);
});
