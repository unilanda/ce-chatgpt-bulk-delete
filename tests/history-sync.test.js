'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLASSIFICATIONS,
  historyItemToRecord
} = require('../conversation-policy.js');
const {
  buildHistoryUrl,
  parseMaximum,
  runHistorySync
} = require('../history-sync.js');

class MemoryConversationStore {
  constructor(records = []) {
    this.records = new Map(records.map(record => [record.id, structuredClone(record)]));
    this.savedIds = [];
    this.deletedIds = [];
  }

  async getConversation(id) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async saveConversation(record) {
    this.savedIds.push(record.id);
    this.records.set(record.id, structuredClone(record));
  }

  async deleteConversation(id) {
    this.deletedIds.push(id);
    this.records.delete(id);
  }

  async getAllConversations() {
    return Array.from(this.records.values(), record => structuredClone(record));
  }
}

function historyItem(index, overrides = {}) {
  return {
    id: `history-${index}`,
    title: `Synthetic history ${index}`,
    create_time: '2026-01-01T00:00:00.000Z',
    update_time: `2026-01-${String((index % 28) + 1).padStart(2, '0')}T00:00:00.000Z`,
    gizmo_id: null,
    ...overrides
  };
}

function historyPage(items, {
  total = items.length,
  limit = 20,
  offset = 0
} = {}) {
  return { items, total, limit, offset };
}

function fakeResponse(status, body, headers = {}) {
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
    },
    async json() {
      return structuredClone(body);
    }
  };
}

function requestFacts(url) {
  const parsed = new URL(url);
  return {
    pathname: parsed.pathname,
    excludeOrigin: parsed.searchParams.get('exclude_conversation_origin'),
    expand: parsed.searchParams.get('expand'),
    hideSnorlax: parsed.searchParams.get('hide_snorlax'),
    archived: parsed.searchParams.get('is_archived'),
    starred: parsed.searchParams.get('is_starred'),
    limit: Number(parsed.searchParams.get('limit')),
    order: parsed.searchParams.get('order'),
    offset: Number(parsed.searchParams.get('offset'))
  };
}

test('History maximum accepts explicit All or a positive integer only', () => {
  assert.equal(parseMaximum('All'), null);
  assert.equal(parseMaximum(' all '), null);
  assert.equal(parseMaximum(''), null);
  assert.equal(parseMaximum('20'), 20);
  assert.equal(parseMaximum(25), 25);
  for (const value of ['zero', 0, -1, 1.5, Infinity]) {
    assert.throws(() => parseMaximum(value), /All or a positive integer/);
  }
});

test('History URL matches the observed offset protocol', () => {
  assert.deepEqual(requestFacts(buildHistoryUrl({ offset: 40, limit: 20 })), {
    pathname: '/backend-api/conversations',
    excludeOrigin: 'tpp',
    expand: 'false',
    hideSnorlax: 'false',
    archived: 'false',
    starred: 'false',
    limit: 20,
    order: 'updated',
    offset: 40
  });
});

test('maximum 20 fetches and persists exactly 20 records rather than a 100-item page', async () => {
  const store = new MemoryConversationStore();
  const requests = [];
  const items = Array.from({ length: 20 }, (_, index) => historyItem(index));

  const summary = await runHistorySync({
    maximum: 20,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async url => {
      requests.push(requestFacts(url));
      return fakeResponse(200, historyPage(items, { total: 61 }));
    }
  });

  assert.deepEqual(requests.map(({ limit, offset }) => ({ limit, offset })), [
    { limit: 20, offset: 0 }
  ]);
  assert.equal(summary.state, 'complete');
  assert.equal(summary.stop_reason, 'maximum_reached');
  assert.equal(summary.fetched, 20);
  assert.equal(summary.inserted, 20);
  assert.equal(summary.updated, 0);
  assert.equal(summary.unchanged, 0);
  assert.equal(summary.total_local, 20);
  assert.equal(store.records.size, 20);
});

test('a maximum crossing the page boundary caps the final request and run exactly', async () => {
  const store = new MemoryConversationStore();
  const requests = [];
  const pages = [
    historyPage(Array.from({ length: 20 }, (_, index) => historyItem(index)), {
      total: 61,
      limit: 20,
      offset: 0
    }),
    historyPage(Array.from({ length: 5 }, (_, index) => historyItem(index + 20)), {
      total: 61,
      limit: 5,
      offset: 20
    })
  ];

  const summary = await runHistorySync({
    maximum: 25,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async url => {
      requests.push(requestFacts(url));
      return fakeResponse(200, pages.shift());
    }
  });

  assert.deepEqual(requests.map(({ limit, offset }) => ({ limit, offset })), [
    { limit: 20, offset: 0 },
    { limit: 5, offset: 20 }
  ]);
  assert.equal(summary.fetched, 25);
  assert.equal(summary.inserted, 25);
  assert.equal(summary.total_local, 25);
});

test('All follows 20-item offsets until the reported remote end', async () => {
  const store = new MemoryConversationStore();
  const requests = [];
  const pages = [
    historyPage(Array.from({ length: 20 }, (_, index) => historyItem(index)), {
      total: 21,
      offset: 0
    }),
    historyPage([historyItem(20)], {
      total: 21,
      offset: 20
    })
  ];

  const summary = await runHistorySync({
    maximum: null,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async url => {
      requests.push(requestFacts(url));
      return fakeResponse(200, pages.shift());
    }
  });

  assert.deepEqual(requests.map(({ limit, offset }) => ({ limit, offset })), [
    { limit: 20, offset: 0 },
    { limit: 20, offset: 20 }
  ]);
  assert.equal(summary.state, 'complete');
  assert.equal(summary.stop_reason, 'remote_end');
  assert.equal(summary.complete_inventory, true);
  assert.equal(summary.fetched, 21);
  assert.equal(summary.total_local, 21);
});

test('prepopulated inventory reports inserted updated unchanged and total-local separately', async () => {
  const unchangedItem = historyItem(1);
  const updatedOld = historyItemToRecord(historyItem(2, {
    title: 'Old title',
    update_time: '2026-01-01T00:00:00.000Z'
  }));
  const searchOnly = {
    id: 'search-only',
    title: 'Search only',
    classification: CLASSIFICATIONS.UNKNOWN,
    classification_evidence: 'search-only',
    discovery_sources: ['search']
  };
  const store = new MemoryConversationStore([
    historyItemToRecord(unchangedItem),
    updatedOld,
    searchOnly
  ]);

  const summary = await runHistorySync({
    maximum: 3,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async () => fakeResponse(200, historyPage([
      unchangedItem,
      historyItem(2, {
        title: 'New title',
        update_time: '2026-02-01T00:00:00.000Z'
      }),
      historyItem(3)
    ], { total: 61, limit: 3 }))
  });

  assert.equal(summary.fetched, 3);
  assert.equal(summary.inserted, 1);
  assert.equal(summary.updated, 1);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.total_local, 4);
  assert.equal(store.records.get('history-2').title, 'New title');
  assert.equal(store.records.has('search-only'), true);
});

test('completed run accounting reconciles exactly to fetched items', async () => {
  const unchangedItem = historyItem('unchanged');
  const oldItem = historyItemToRecord(historyItem('updated', {
    title: 'Old title',
    update_time: '2026-01-01T00:00:00.000Z'
  }));
  const store = new MemoryConversationStore([
    historyItemToRecord(unchangedItem),
    oldItem
  ]);

  const summary = await runHistorySync({
    maximum: 3,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async () => fakeResponse(200, historyPage([
      unchangedItem,
      historyItem('updated', {
        title: 'New title',
        update_time: '2026-02-01T00:00:00.000Z'
      }),
      historyItem('inserted')
    ], { total: 10, limit: 3 }))
  });

  assert.equal(summary.state, 'complete');
  assert.equal(summary.skipped, 0);
  assert.equal(
    summary.inserted + summary.updated + summary.unchanged,
    summary.fetched
  );
  assert.deepEqual(
    {
      fetched: summary.fetched,
      inserted: summary.inserted,
      updated: summary.updated,
      unchanged: summary.unchanged,
      total_local: summary.total_local
    },
    { fetched: 3, inserted: 1, updated: 1, unchanged: 1, total_local: 3 }
  );
});

test('duplicate canonical IDs within one History page produce one local record', async () => {
  const store = new MemoryConversationStore();
  const duplicate = historyItem('duplicate');

  const summary = await runHistorySync({
    maximum: 2,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async () => fakeResponse(200, historyPage(
      [duplicate, structuredClone(duplicate)],
      { total: 2, limit: 2 }
    ))
  });

  assert.equal(summary.fetched, 2);
  assert.equal(summary.inserted, 1);
  assert.equal(summary.updated, 0);
  assert.equal(summary.unchanged, 1);
  assert.equal(summary.total_local, 1);
  assert.deepEqual(Array.from(store.records.keys()), ['history-duplicate']);
});

test('rerunning the same bounded History load is idempotent', async () => {
  const store = new MemoryConversationStore();
  const items = [historyItem('first'), historyItem('second')];
  const run = () => runHistorySync({
    maximum: 2,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async () => fakeResponse(200, historyPage(items, {
      total: 5,
      limit: 2
    }))
  });

  const first = await run();
  const second = await run();

  assert.deepEqual(
    { inserted: first.inserted, updated: first.updated, unchanged: first.unchanged },
    { inserted: 2, updated: 0, unchanged: 0 }
  );
  assert.deepEqual(
    { inserted: second.inserted, updated: second.updated, unchanged: second.unchanged },
    { inserted: 0, updated: 0, unchanged: 2 }
  );
  assert.equal(first.total_local, 2);
  assert.equal(second.total_local, 2);
  assert.equal(store.records.size, 2);
});

test('mixed standalone and Project items are classified independently on one page', async () => {
  const store = new MemoryConversationStore();
  const summary = await runHistorySync({
    maximum: 2,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async () => fakeResponse(200, historyPage([
      historyItem('standalone', { gizmo_id: null }),
      historyItem('project', { gizmo_id: 'g-p-synthetic' })
    ], { total: 61, limit: 2 }))
  });

  assert.equal(summary.fetched, 2);
  assert.equal(
    store.records.get('history-standalone').classification,
    CLASSIFICATIONS.STANDALONE
  );
  assert.equal(
    store.records.get('history-project').classification,
    CLASSIFICATIONS.PROJECT
  );
});

test('later-page 429 keeps existing and successful records, stops partial, and exposes Retry-After', async () => {
  const existing = historyItemToRecord(historyItem('existing'));
  const stale = historyItemToRecord(historyItem('stale'));
  const store = new MemoryConversationStore([existing, stale]);
  let requests = 0;

  const summary = await runHistorySync({
    maximum: null,
    store,
    authToken: 'synthetic-token',
    now: () => 0,
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) {
        return fakeResponse(200, historyPage(
          Array.from({ length: 20 }, (_, index) => historyItem(index)),
          { total: 40 }
        ));
      }
      return fakeResponse(429, { private_error: 'not exposed' }, {
        'Retry-After': '90'
      });
    }
  });

  assert.equal(requests, 2);
  assert.equal(summary.state, 'partial');
  assert.equal(summary.stop_reason, 'http_429');
  assert.equal(summary.fetched, 20);
  assert.equal(summary.inserted + summary.updated + summary.unchanged, 20);
  assert.equal(summary.retry_after_ms, 90000);
  assert.equal(summary.complete_inventory, false);
  assert.equal(store.records.has('history-0'), true);
  assert.equal(store.records.has('history-19'), true);
  assert.equal(store.records.has('history-existing'), true);
  assert.equal(store.records.has('history-stale'), true);
  assert.deepEqual(store.deletedIds, []);
  assert.equal(JSON.stringify(summary).includes('private_error'), false);
});

test('a later non-429 failure is partial and never clears inventory', async () => {
  const stale = historyItemToRecord(historyItem('stale'));
  const store = new MemoryConversationStore([stale]);
  let requests = 0;

  const summary = await runHistorySync({
    maximum: null,
    store,
    authToken: 'synthetic-token',
    fetchImpl: async () => {
      requests += 1;
      return requests === 1
        ? fakeResponse(200, historyPage(
          Array.from({ length: 20 }, (_, index) => historyItem(index)),
          { total: 40 }
        ))
        : fakeResponse(500, { private_error: 'not exposed' });
    }
  });

  assert.equal(summary.state, 'partial');
  assert.equal(summary.stop_reason, 'http_500');
  assert.equal(store.records.has('history-stale'), true);
  assert.deepEqual(store.deletedIds, []);
});

test('only an unlimited run that reaches remote end may remove stale history records', async () => {
  const staleLimited = historyItemToRecord(historyItem('stale-limited'));
  const limitedStore = new MemoryConversationStore([staleLimited]);
  await runHistorySync({
    maximum: 1,
    store: limitedStore,
    authToken: 'synthetic-token',
    fetchImpl: async () => fakeResponse(200, historyPage(
      [historyItem('current-limited')],
      { total: 2, limit: 1 }
    ))
  });
  assert.equal(limitedStore.records.has('history-stale-limited'), true);
  assert.deepEqual(limitedStore.deletedIds, []);

  const staleAll = historyItemToRecord(historyItem('stale-all'));
  const allStore = new MemoryConversationStore([staleAll]);
  const summary = await runHistorySync({
    maximum: null,
    store: allStore,
    authToken: 'synthetic-token',
    fetchImpl: async () => fakeResponse(200, historyPage(
      [historyItem('current-all')],
      { total: 1 }
    ))
  });

  assert.equal(summary.complete_inventory, true);
  assert.deepEqual(allStore.deletedIds, ['history-stale-all']);
  assert.equal(summary.removed_stale, 1);
});
