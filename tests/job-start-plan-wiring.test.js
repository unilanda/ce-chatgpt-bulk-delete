'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createBackgroundRuntime } = require('../background-runtime.js');
const { createJobClient } = require('../job-client.js');

class FakeEvent {
  constructor() { this.listeners = []; }
  addListener(listener) { this.listeners.push(listener); }
  removeListener(listener) {
    this.listeners = this.listeners.filter(candidate => candidate !== listener);
  }
}

async function send(chromeApi, request) {
  return new Promise(resolve => {
    assert.equal(chromeApi.runtime.onMessage.listeners[0](request, {}, resolve), true);
  });
}

test('background start_plan command carries reviewed IDs, approval subset, and exact interval', async () => {
  const chromeApi = {
    alarms: { onAlarm: new FakeEvent() },
    runtime: {
      onMessage: new FakeEvent(),
      onStartup: new FakeEvent()
    }
  };
  const calls = [];
  const controller = {
    async getJob() { return null; },
    async startPlan(payload) {
      calls.push(payload);
      return { state: 'running', interval_seconds: payload.intervalSeconds };
    },
    async handleBrowserStartup() {}
  };
  const runtime = createBackgroundRuntime({
    chromeApi,
    controller,
    executor: {
      async ensureSchedule() {},
      async executeStep() {},
      async recoverInterruptedRequest() {}
    },
    openDashboard: async () => {}
  });
  await runtime.register();

  const response = await send(chromeApi, {
    type: 'delete_job:start_plan',
    ids: ['standalone', 'project'],
    interval_seconds: 150,
    approved_project_ids: ['project']
  });

  assert.deepEqual(calls, [{
    ids: ['standalone', 'project'],
    intervalSeconds: 150,
    approvedProjectIds: ['project']
  }]);
  assert.deepEqual(response, {
    ok: true,
    job: { state: 'running', interval_seconds: 150 }
  });
});

test('job client exposes one atomic start_plan message and accepts its snapshot', async () => {
  const messages = [];
  const runtime = {
    async sendMessage(message) {
      messages.push(structuredClone(message));
      return {
        ok: true,
        job: { schema_version: 1, state: 'running', revision: 2 }
      };
    }
  };
  const client = createJobClient({
    runtime,
    storage: { onChanged: new FakeEvent() },
    validateJob: value => structuredClone(value)
  });

  const job = await client.startPlan({
    ids: ['standalone', 'project'],
    intervalSeconds: 150,
    approvedProjectIds: ['project']
  });

  assert.equal(job.state, 'running');
  assert.deepEqual(messages, [{
    type: 'delete_job:start_plan',
    ids: ['standalone', 'project'],
    interval_seconds: 150,
    approved_project_ids: ['project']
  }]);
});
