'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  REBUILD_CONFIRMATION,
  REBUILD_PAGE_DELAY_MS,
  REBUILD_PAGE_SIZE,
  rebuildInventory
} = require('../inventory-resync.js');
const { historyItemToRecord } = require('../conversation-policy.js');

class Store {
  constructor(records = []) {
    this.records = new Map(records.map(record => [record.id, structuredClone(record)]));
    this.clearCalls = 0;
  }
  async clearAll() { this.clearCalls += 1; this.records.clear(); }
  async getConversation(id) { return this.records.get(id); }
  async saveConversation(record) { this.records.set(record.id, structuredClone(record)); }
  async getAllConversations() {
    return [...this.records.values()].map(record => structuredClone(record));
  }
  async deleteConversation(id) { this.records.delete(id); }
}

function item(index) {
  return {
    id: `rebuild-${index}`,
    title: `Synthetic rebuild ${index}`,
    create_time: 1789486200,
    update_time: 1789486324.5,
    gizmo_id: null
  };
}

function response(status, body, retryAfter = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get(name) { return name.toLowerCase() === 'retry-after' ? retryAfter : null; } },
    async json() { return structuredClone(body); }
  };
}

test('rebuild contract names inventory-only clearing and conservative pacing', () => {
  assert.equal(REBUILD_PAGE_SIZE, 10);
  assert.equal(REBUILD_PAGE_DELAY_MS, 500);
  assert.match(REBUILD_CONFIRMATION, /clears only.*local conversation list/i);
  assert.match(REBUILD_CONFIRMATION, /settings and deletion-job state are preserved/i);
  assert.match(REBUILD_CONFIRMATION, /No ChatGPT conversation is deleted/i);
  assert.match(REBUILD_CONFIRMATION, /partial/i);
});

test('rebuild clears once and persists the first page before requesting the second', async () => {
  const store = new Store([historyItemToRecord(item('old'))]);
  const requests = [];
  let releasePacing;
  let pacingStarted;
  const pacingGate = new Promise(resolve => { releasePacing = resolve; });
  const pacingObserved = new Promise(resolve => { pacingStarted = resolve; });

  const rebuilding = rebuildInventory({
    store,
    authToken: 'synthetic',
    sleep: async milliseconds => {
      assert.equal(milliseconds, 500);
      pacingStarted();
      await pacingGate;
    },
    fetchImpl: async url => {
      const parsed = new URL(url);
      requests.push({
        limit: Number(parsed.searchParams.get('limit')),
        offset: Number(parsed.searchParams.get('offset'))
      });
      return requests.length === 1
        ? response(200, {
            items: Array.from({ length: 10 }, (_, index) => item(index)),
            total: 11,
            limit: 10,
            offset: 0
          })
        : response(200, {
            items: [item(10)],
            total: 11,
            limit: 10,
            offset: 10
          });
    }
  });

  await pacingObserved;
  assert.equal(store.clearCalls, 1);
  assert.equal(store.records.size, 10);
  assert.equal(store.records.has('rebuild-old'), false);
  assert.deepEqual(requests, [{ limit: 10, offset: 0 }]);

  releasePacing();
  const summary = await rebuilding;
  assert.deepEqual(requests, [
    { limit: 10, offset: 0 },
    { limit: 10, offset: 10 }
  ]);
  assert.equal(store.records.size, 11);
  assert.equal(summary.state, 'complete');
  assert.equal(summary.complete_inventory, true);
});

test('later 429 keeps the successful rebuilt page and Retry-After', async () => {
  const store = new Store([historyItemToRecord(item('old'))]);
  let call = 0;
  const summary = await rebuildInventory({
    store,
    authToken: 'synthetic',
    sleep: async () => {},
    now: () => 0,
    fetchImpl: async () => {
      call += 1;
      return call === 1
        ? response(200, {
            items: Array.from({ length: 10 }, (_, index) => item(index)),
            total: 30,
            limit: 10,
            offset: 0
          })
        : response(429, {}, '90');
    }
  });

  assert.equal(summary.state, 'partial');
  assert.equal(summary.stop_reason, 'http_429');
  assert.equal(summary.fetched, 10);
  assert.equal(summary.retry_after_ms, 90000);
  assert.equal(store.records.size, 10);
  assert.equal(store.records.has('rebuild-old'), false);
});

test('first-page 429 intentionally leaves the cleared inventory empty', async () => {
  const store = new Store([historyItemToRecord(item('old'))]);
  const summary = await rebuildInventory({
    store,
    authToken: 'synthetic',
    sleep: async () => {},
    fetchImpl: async () => response(429, {}, '30')
  });

  assert.equal(store.clearCalls, 1);
  assert.equal(store.records.size, 0);
  assert.equal(summary.state, 'failed');
  assert.equal(summary.stop_reason, 'http_429');
  assert.equal(summary.fetched, 0);
  assert.equal(summary.total_local, 0);
});
