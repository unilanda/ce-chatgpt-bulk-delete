'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackgroundRuntime } = require('../background-runtime.js');

class FakeEvent {
  constructor() { this.listeners = []; }
  addListener(listener) { this.listeners.push(listener); }
}

function setup() {
  const chromeApi = {
    alarms: { onAlarm: new FakeEvent() },
    runtime: {
      onMessage: new FakeEvent(),
      onStartup: new FakeEvent()
    }
  };
  const calls = [];
  const controller = {
    async getJob() { calls.push(['getJob']); return { state: 'ready' }; },
    async createPlan(payload) { calls.push(['createPlan', payload]); return { state: 'draft' }; },
    async refreshPlan() { calls.push(['refreshPlan']); return { state: 'draft' }; },
    async removeBlocked() { calls.push(['removeBlocked']); return { state: 'ready' }; },
    async approveProjects() { calls.push(['approveProjects']); return { state: 'ready' }; },
    async start() { calls.push(['start']); return { state: 'running' }; },
    async pause() { calls.push(['pause']); return { state: 'paused' }; },
    async resume() { calls.push(['resume']); return { state: 'running' }; },
    async cancel() { calls.push(['cancel']); return { state: 'cancelled' }; },
    async dismissTerminal() { calls.push(['dismissTerminal']); return null; },
    async handleBrowserStartup() {
      calls.push(['handleBrowserStartup']);
      return { state: 'error_paused' };
    }
  };
  const executor = {
    async ensureSchedule() { calls.push(['ensureSchedule']); },
    async executeStep(alarm) { calls.push(['executeStep', alarm]); },
    async recoverInterruptedRequest() {
      calls.push(['recoverInterruptedRequest']);
      return { outcome: 'no_interrupted_request' };
    }
  };
  const openDashboard = async () => { calls.push(['openDashboard']); };
  const runtime = createBackgroundRuntime({
    chromeApi,
    controller,
    executor,
    openDashboard
  });
  return { calls, chromeApi, runtime };
}

async function send(chromeApi, request) {
  const listener = chromeApi.runtime.onMessage.listeners[0];
  return new Promise(resolve => {
    const keepAlive = listener(request, {}, resolve);
    assert.equal(keepAlive, true);
  });
}

test('register performs only targeted ordinary-worker interrupted-request recovery', async () => {
  const context = setup();
  await context.runtime.register();
  await context.runtime.register();

  assert.deepEqual(context.calls, [['recoverInterruptedRequest']]);
  assert.equal(context.chromeApi.alarms.onAlarm.listeners.length, 1);
  assert.equal(context.chromeApi.runtime.onStartup.listeners.length, 1);
  assert.equal(context.chromeApi.runtime.onMessage.listeners.length, 1);
});

test('alarm delivery is delegated only to the background executor', async () => {
  const context = setup();
  await context.runtime.register();
  context.calls.length = 0;
  const alarm = { name: 'chatgpt-manager-delete-job', scheduledTime: 1000 };

  await context.chromeApi.alarms.onAlarm.listeners[0](alarm);

  assert.deepEqual(context.calls, [['executeStep', alarm]]);
});

test('first message waits for ordinary-worker recovery and recovery runs once', async () => {
  const context = setup();
  let releaseRecovery;
  const recoveryGate = new Promise(resolve => { releaseRecovery = resolve; });
  context.runtime = createBackgroundRuntime({
    chromeApi: context.chromeApi,
    controller: {
      async getJob() { context.calls.push(['getJob']); return { state: 'ready' }; },
      async handleBrowserStartup() {}
    },
    executor: {
      async ensureSchedule() {},
      async executeStep() {},
      async recoverInterruptedRequest() {
        context.calls.push(['recoverInterruptedRequest']);
        await recoveryGate;
      }
    },
    openDashboard: async () => {}
  });
  await context.runtime.register();

  const responsePromise = send(context.chromeApi, { type: 'delete_job:get' });
  await Promise.resolve();
  assert.deepEqual(context.calls, [['recoverInterruptedRequest']]);

  releaseRecovery();
  assert.deepEqual(await responsePromise, { ok: true, job: { state: 'ready' } });
  assert.deepEqual(context.calls, [['recoverInterruptedRequest'], ['getJob']]);
});

test('first alarm waits for ordinary-worker recovery and recovery runs once', async () => {
  const context = setup();
  let releaseRecovery;
  const recoveryGate = new Promise(resolve => { releaseRecovery = resolve; });
  const alarm = { name: 'chatgpt-manager-delete-job', scheduledTime: 1000 };
  context.runtime = createBackgroundRuntime({
    chromeApi: context.chromeApi,
    controller: {
      async getJob() { return null; },
      async handleBrowserStartup() {}
    },
    executor: {
      async ensureSchedule() {},
      async executeStep(value) { context.calls.push(['executeStep', value]); },
      async recoverInterruptedRequest() {
        context.calls.push(['recoverInterruptedRequest']);
        await recoveryGate;
      }
    },
    openDashboard: async () => {}
  });
  await context.runtime.register();

  const alarmPromise = context.chromeApi.alarms.onAlarm.listeners[0](alarm);
  await Promise.resolve();
  assert.deepEqual(context.calls, [['recoverInterruptedRequest']]);

  releaseRecovery();
  await alarmPromise;
  assert.deepEqual(context.calls, [
    ['recoverInterruptedRequest'],
    ['executeStep', alarm]
  ]);
});

test('failed ordinary-worker recovery blocks job commands and alarms fail closed', async () => {
  const context = setup();
  const alarm = { name: 'chatgpt-manager-delete-job', scheduledTime: 1000 };
  context.runtime = createBackgroundRuntime({
    chromeApi: context.chromeApi,
    controller: {
      async getJob() { context.calls.push(['getJob']); return { state: 'ready' }; },
      async handleBrowserStartup() {}
    },
    executor: {
      async ensureSchedule() {},
      async executeStep(value) { context.calls.push(['executeStep', value]); },
      async recoverInterruptedRequest() {
        context.calls.push(['recoverInterruptedRequest']);
        throw new Error('private persisted state detail');
      }
    },
    openDashboard: async () => {}
  });
  await context.runtime.register();

  const response = await send(context.chromeApi, { type: 'delete_job:get' });
  await context.chromeApi.alarms.onAlarm.listeners[0](alarm);

  assert.deepEqual(response, { ok: false, error_code: 'internal_error' });
  assert.deepEqual(context.calls, [['recoverInterruptedRequest']]);
  assert.equal(JSON.stringify(response).includes('private'), false);
});

test('real onStartup interruption is distinct from ordinary schedule restoration', async () => {
  const context = setup();
  await context.runtime.register();
  context.calls.length = 0;

  await context.chromeApi.runtime.onStartup.listeners[0]();

  assert.deepEqual(context.calls, [['handleBrowserStartup']]);
});

test('namespaced messages invoke controller commands and return job snapshots', async () => {
  const context = setup();
  await context.runtime.register();
  context.calls.length = 0;

  const planned = await send(context.chromeApi, {
    type: 'delete_job:create_plan',
    ids: ['one'],
    interval_seconds: 600
  });
  const paused = await send(context.chromeApi, { type: 'delete_job:pause' });

  assert.deepEqual(planned, { ok: true, job: { state: 'draft' } });
  assert.deepEqual(paused, { ok: true, job: { state: 'paused' } });
  assert.deepEqual(context.calls, [
    ['createPlan', { ids: ['one'], intervalSeconds: 600 }],
    ['pause']
  ]);
});

test('legacy dashboard opening remains supported', async () => {
  const context = setup();
  await context.runtime.register();
  context.calls.length = 0;

  const response = await send(context.chromeApi, { action: 'open_dashboard' });

  assert.deepEqual(response, { ok: true });
  assert.deepEqual(context.calls, [['openDashboard']]);
});

test('terminal dismissal stays behind worker recovery and uses the controller boundary', async () => {
  const context = setup();
  await context.runtime.register();
  context.calls.length = 0;

  const response = await send(context.chromeApi, { type: 'delete_job:dismiss_terminal' });

  assert.deepEqual(response, { ok: true, job: null });
  assert.deepEqual(context.calls, [['dismissTerminal']]);
});

test('unknown commands and thrown private details return sanitized codes only', async () => {
  const context = setup();
  context.runtime = createBackgroundRuntime({
    chromeApi: context.chromeApi,
    controller: {
      async getJob() { throw new Error('private token-shaped detail'); },
      async handleBrowserStartup() {}
    },
    executor: {
      async ensureSchedule() {},
      async executeStep() {},
      async recoverInterruptedRequest() {}
    },
    openDashboard: async () => {}
  });
  await context.runtime.register();

  const failure = await send(context.chromeApi, { type: 'delete_job:get' });
  const unknown = await send(context.chromeApi, { type: 'delete_job:not_real' });

  assert.deepEqual(failure, { ok: false, error_code: 'internal_error' });
  assert.deepEqual(unknown, { ok: false, error_code: 'unknown_command' });
  assert.equal(JSON.stringify(failure).includes('private'), false);
});
