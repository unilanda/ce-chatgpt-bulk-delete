'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const {
  DEFAULT_DELETE_DELAY_MS,
  DEFAULT_DELETE_INTERVAL_SECONDS,
  MIN_DELETE_INTERVAL_SECONDS,
  deleteIntervalSecondsToMs,
  parseDeleteIntervalSeconds,
  preflightDeletion,
  runDeletionQueue
} = require('../deletion-core.js');

class MemoryConversationStore {
  constructor(records) {
    this.records = new Map(records.map(record => [record.id, structuredClone(record)]));
    this.deletedIds = [];
  }

  async getConversation(id) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async deleteConversation(id) {
    this.deletedIds.push(id);
    this.records.delete(id);
  }
}

function standalone(id) {
  return {
    id,
    title: `Synthetic ${id}`,
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };
}

function protectedRecord(id, classification = CLASSIFICATIONS.UNKNOWN) {
  return {
    id,
    title: `Protected ${id}`,
    classification,
    classification_evidence: 'search-only'
  };
}

function fakeResponse(status, headers = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders[name.toLowerCase()] ?? null;
      }
    }
  };
}

test('Delete preflight accepts a deduplicated all-standalone selection without mutation', async () => {
  const store = new MemoryConversationStore([
    standalone('conv-one'),
    standalone('conv-two')
  ]);

  const result = await preflightDeletion({
    ids: ['conv-one', 'conv-two', 'conv-one'],
    store
  });

  assert.equal(result.eligible, true);
  assert.deepEqual(result.eligible_ids, ['conv-one', 'conv-two']);
  assert.deepEqual(result.ineligible_ids, []);
  assert.deepEqual(result.missing_ids, []);
  assert.deepEqual(store.deletedIds, []);
});

test('Delete preflight rejects a mixed generic selection before any mutation', async () => {
  const store = new MemoryConversationStore([
    standalone('conv-standalone'),
    protectedRecord('conv-project', CLASSIFICATIONS.PROJECT),
    protectedRecord('conv-unknown', CLASSIFICATIONS.UNKNOWN)
  ]);

  const result = await preflightDeletion({
    ids: ['conv-standalone', 'conv-project', 'conv-unknown'],
    store
  });

  assert.equal(result.eligible, false);
  assert.deepEqual(result.eligible_ids, ['conv-standalone']);
  assert.deepEqual(result.ineligible_ids, ['conv-project', 'conv-unknown']);
  assert.deepEqual(result.missing_ids, []);
  assert.deepEqual(store.deletedIds, []);
});

test('Delete preflight reports missing records and rejects an empty selection', async () => {
  const store = new MemoryConversationStore([standalone('conv-present')]);

  const missing = await preflightDeletion({
    ids: ['conv-present', 'conv-missing'],
    store
  });
  assert.equal(missing.eligible, false);
  assert.deepEqual(missing.missing_ids, ['conv-missing']);

  const empty = await preflightDeletion({ ids: [], store });
  assert.equal(empty.eligible, false);
  assert.deepEqual(empty.eligible_ids, []);
});

for (const scenario of [
  {
    name: 'standalone plus Project',
    records: [
      standalone('conv-standalone'),
      protectedRecord('conv-project', CLASSIFICATIONS.PROJECT)
    ],
    ids: ['conv-standalone', 'conv-project']
  },
  {
    name: 'standalone plus custom GPT',
    records: [
      standalone('conv-standalone'),
      protectedRecord('conv-custom-gpt', CLASSIFICATIONS.CUSTOM_GPT)
    ],
    ids: ['conv-standalone', 'conv-custom-gpt']
  },
  {
    name: 'standalone plus unknown',
    records: [
      standalone('conv-standalone'),
      protectedRecord('conv-unknown', CLASSIFICATIONS.UNKNOWN)
    ],
    ids: ['conv-standalone', 'conv-unknown']
  },
  {
    name: 'Project only',
    records: [protectedRecord('conv-project', CLASSIFICATIONS.PROJECT)],
    ids: ['conv-project']
  },
  {
    name: 'unknown only',
    records: [protectedRecord('conv-unknown', CLASSIFICATIONS.UNKNOWN)],
    ids: ['conv-unknown']
  }
]) {
  test(`whole-selection preflight rejects ${scenario.name} with zero transport calls`, async () => {
    const store = new MemoryConversationStore(scenario.records);
    let requests = 0;

    const result = await runDeletionQueue({
      ids: scenario.ids,
      store,
      authToken: 'token',
      delayMs: 0,
      fetchImpl: async () => {
        requests += 1;
        return fakeResponse(200);
      }
    });

    assert.equal(requests, 0);
    assert.equal(result.state, 'stopped');
    assert.equal(result.stop_reason, 'protected_record');
    assert.equal(result.preflight_failed, true);
    assert.deepEqual(result.deleted_ids, []);
    assert.deepEqual(store.deletedIds, []);
    assert.deepEqual(Array.from(store.records.keys()), scenario.records.map(record => record.id));
  });
}

test('successful deletion removes local data only after remote confirmation', async () => {
  const store = new MemoryConversationStore([standalone('conv-success')]);
  let existedDuringRequest = false;
  const result = await runDeletionQueue({
    ids: ['conv-success'],
    store,
    authToken: 'test-token',
    fetchImpl: async () => {
      existedDuringRequest = store.records.has('conv-success');
      return fakeResponse(200);
    }
  });

  assert.equal(existedDuringRequest, true);
  assert.deepEqual(store.deletedIds, ['conv-success']);
  assert.equal(result.state, 'complete');
  assert.equal(result.completed, 1);
  assert.deepEqual(result.pending_ids, []);
});

test('the default inter-delete delay is exactly ten minutes', async () => {
  assert.equal(DEFAULT_DELETE_INTERVAL_SECONDS, 600);
  assert.equal(DEFAULT_DELETE_DELAY_MS, 600000);
  const store = new MemoryConversationStore([
    standalone('conv-first'),
    standalone('conv-second')
  ]);
  let currentTime = 1000;
  const waits = [];
  const result = await runDeletionQueue({
    ids: ['conv-first', 'conv-second'],
    store,
    authToken: 'token',
    now: () => currentTime,
    waitUntil: async (nextAt, { onTick }) => {
      waits.push(nextAt);
      onTick(nextAt - currentTime);
      currentTime = nextAt;
      onTick(0);
    },
    fetchImpl: async () => fakeResponse(200)
  });

  assert.deepEqual(waits, [601000]);
  assert.equal(result.completed, 2);
});

test('delete interval seconds convert once to milliseconds with a positive whole-second minimum', () => {
  assert.equal(MIN_DELETE_INTERVAL_SECONDS, 1);
  assert.equal(parseDeleteIntervalSeconds('1'), 1);
  assert.equal(deleteIntervalSecondsToMs('1'), 1000);
  assert.equal(parseDeleteIntervalSeconds('600'), 600);
  assert.equal(deleteIntervalSecondsToMs('600'), 600000);
  assert.equal(deleteIntervalSecondsToMs(120), 120000);
});

test('invalid delete interval input is rejected and safely falls back to ten minutes', () => {
  for (const value of ['', 'not-a-number', 0, -1, 59.9, NaN, Infinity, null]) {
    assert.equal(parseDeleteIntervalSeconds(value), null);
    assert.equal(deleteIntervalSecondsToMs(value), 600000);
  }
});

test('the configured delete interval controls queue scheduling', async () => {
  const store = new MemoryConversationStore([
    standalone('conv-first'),
    standalone('conv-second')
  ]);
  const waits = [];
  await runDeletionQueue({
    ids: ['conv-first', 'conv-second'],
    store,
    authToken: 'token',
    delayMs: deleteIntervalSecondsToMs(120),
    now: () => 5000,
    waitUntil: async (nextAt, { onTick }) => {
      waits.push(nextAt);
      onTick(nextAt - 5000);
    },
    fetchImpl: async () => fakeResponse(200)
  });

  assert.deepEqual(waits, [125000]);
});

test('no second request starts before the delay gate resolves', async () => {
  const store = new MemoryConversationStore([
    standalone('conv-first'),
    standalone('conv-second')
  ]);
  const requests = [];
  let releaseWait;
  const waitGate = new Promise(resolve => {
    releaseWait = resolve;
  });
  const queue = runDeletionQueue({
    ids: ['conv-first', 'conv-second'],
    store,
    authToken: 'token',
    now: () => 0,
    waitUntil: async () => waitGate,
    fetchImpl: async url => {
      requests.push(url);
      return fakeResponse(200);
    }
  });

  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, 1);
  releaseWait();
  const result = await queue;
  assert.equal(requests.length, 2);
  assert.equal(result.state, 'complete');
});

test('network errors preserve the local record and stop the queue', async () => {
  const store = new MemoryConversationStore([
    standalone('conv-network'),
    standalone('conv-pending')
  ]);
  const result = await runDeletionQueue({
    ids: ['conv-network', 'conv-pending'],
    store,
    authToken: 'token',
    fetchImpl: async () => {
      throw new Error('Synthetic offline error');
    }
  });

  assert.equal(result.state, 'stopped');
  assert.equal(result.stop_reason, 'network_error');
  assert.deepEqual(result.pending_ids, ['conv-network', 'conv-pending']);
  assert.equal(store.records.has('conv-network'), true);
  assert.equal(store.records.has('conv-pending'), true);
  assert.deepEqual(store.deletedIds, []);
});

for (const status of [400, 401, 403, 404, 500]) {
  test(`HTTP ${status} preserves local data and stops immediately`, async () => {
    const store = new MemoryConversationStore([
      standalone(`conv-${status}`),
      standalone('conv-not-requested')
    ]);
    let requests = 0;
    const result = await runDeletionQueue({
      ids: [`conv-${status}`, 'conv-not-requested'],
      store,
      authToken: 'token',
      fetchImpl: async () => {
        requests += 1;
        return fakeResponse(status);
      }
    });

    assert.equal(requests, 1);
    assert.equal(result.state, 'stopped');
    assert.equal(result.stop_reason, `http_${status}`);
    assert.equal(store.records.has(`conv-${status}`), true);
    assert.equal(store.records.has('conv-not-requested'), true);
    assert.deepEqual(store.deletedIds, []);
  });
}

test('HTTP 429 stops immediately and reports Retry-After without retrying', async () => {
  const store = new MemoryConversationStore([
    standalone('conv-rate-limited'),
    standalone('conv-pending')
  ]);
  let requests = 0;
  const result = await runDeletionQueue({
    ids: ['conv-rate-limited', 'conv-pending'],
    store,
    authToken: 'token',
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(429, { 'Retry-After': '300' });
    }
  });

  assert.equal(requests, 1);
  assert.equal(result.state, 'stopped');
  assert.equal(result.stop_reason, 'http_429');
  assert.equal(result.retry_after_ms, 300000);
  assert.equal(store.records.has('conv-rate-limited'), true);
  assert.equal(store.records.has('conv-pending'), true);
});

test('cancellation during the delay preserves every pending record', async () => {
  const store = new MemoryConversationStore([
    standalone('conv-completed'),
    standalone('conv-pending')
  ]);
  const controller = new AbortController();
  const result = await runDeletionQueue({
    ids: ['conv-completed', 'conv-pending'],
    store,
    authToken: 'token',
    signal: controller.signal,
    now: () => 0,
    waitUntil: async () => {
      controller.abort();
      const error = new Error('Cancelled');
      error.name = 'AbortError';
      throw error;
    },
    fetchImpl: async () => fakeResponse(200)
  });

  assert.equal(result.state, 'cancelled');
  assert.deepEqual(store.deletedIds, ['conv-completed']);
  assert.equal(store.records.has('conv-pending'), true);
  assert.deepEqual(result.pending_ids, ['conv-pending']);
});

test('cancellation during the eligibility lookup prevents the remote request', async () => {
  const controller = new AbortController();
  const record = standalone('conv-cancel-before-request');
  let requests = 0;
  const store = {
    async getConversation() {
      controller.abort();
      return record;
    },
    async deleteConversation() {
      throw new Error('must not delete locally');
    }
  };

  const result = await runDeletionQueue({
    ids: [record.id],
    store,
    authToken: 'token',
    signal: controller.signal,
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(200);
    }
  });

  assert.equal(requests, 0);
  assert.equal(result.state, 'cancelled');
  assert.deepEqual(result.pending_ids, [record.id]);
});

test('execution rejects a record that became protected after UI selection', async () => {
  const store = new MemoryConversationStore([
    protectedRecord('conv-stale-selection', CLASSIFICATIONS.PROJECT)
  ]);
  let requests = 0;
  const result = await runDeletionQueue({
    ids: ['conv-stale-selection'],
    store,
    authToken: 'token',
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(200);
    }
  });

  assert.equal(requests, 0);
  assert.equal(result.state, 'stopped');
  assert.equal(result.stop_reason, 'protected_record');
  assert.deepEqual(result.pending_ids, ['conv-stale-selection']);
  assert.equal(store.records.has('conv-stale-selection'), true);
});

for (const classification of [
  CLASSIFICATIONS.UNKNOWN,
  CLASSIFICATIONS.PROJECT,
  CLASSIFICATIONS.CUSTOM_GPT
]) {
  test(`execution rejects ${classification} before the deletion transport boundary`, async () => {
    const record = protectedRecord(`conv-${classification}`, classification);
    const store = new MemoryConversationStore([record]);
    let requests = 0;
    const result = await runDeletionQueue({
      ids: [record.id],
      store,
      authToken: 'token',
      fetchImpl: async () => {
        requests += 1;
        return fakeResponse(200);
      }
    });

    assert.equal(requests, 0);
    assert.equal(result.stop_reason, 'protected_record');
    assert.equal(store.records.has(record.id), true);
  });
}

test('progress reports completed/total and the visible next-at countdown', async () => {
  const store = new MemoryConversationStore([
    standalone('conv-first'),
    standalone('conv-second')
  ]);
  const progress = [];
  let currentTime = 5000;

  await runDeletionQueue({
    ids: ['conv-first', 'conv-second'],
    store,
    authToken: 'token',
    now: () => currentTime,
    waitUntil: async (nextAt, { onTick }) => {
      onTick(600000);
      currentTime = nextAt;
      onTick(0);
    },
    onProgress: event => progress.push(event),
    fetchImpl: async () => fakeResponse(200)
  });

  assert.deepEqual(
    progress.filter(event => event.phase === 'waiting').map(event => ({
      completed: event.completed,
      total: event.total,
      next_at: event.next_at,
      remaining_ms: event.remaining_ms
    })),
    [
      { completed: 1, total: 2, next_at: 605000, remaining_ms: 600000 },
      { completed: 1, total: 2, next_at: 605000, remaining_ms: 0 }
    ]
  );
  assert.equal(progress.at(-1).phase, 'complete');
  assert.equal(progress.at(-1).completed, 2);
  assert.equal(progress.at(-1).total, 2);
});
