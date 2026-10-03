'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const {
  normalizeQueries,
  runSearchSync
} = require('../search-sync.js');

class MemoryConversationStore {
  constructor(records = []) {
    this.records = new Map(records.map(record => [record.id, structuredClone(record)]));
    this.savedIds = [];
    this.deleteCalls = 0;
  }

  async getConversation(id) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async saveConversation(record) {
    this.savedIds.push(record.id);
    this.records.set(record.id, structuredClone(record));
  }

  async deleteConversation() {
    this.deleteCalls += 1;
    throw new Error('Search Sync must never delete');
  }
}

function queryResult(query, overrides = {}) {
  return {
    query,
    query_id: `session-${query}`,
    state: 'complete',
    stop_reason: null,
    pages: 1,
    hits: 0,
    conversations: [],
    non_conversation_source_types: [],
    warnings: [],
    retry_after_ms: null,
    ...overrides
  };
}

function searchConversation(id, overrides = {}) {
  return {
    id,
    title: `Synthetic ${id}`,
    update_time: '2026-03-01T00:00:00.000Z',
    is_archived: false,
    is_starred: false,
    hit_count: 1,
    match_kinds: ['title'],
    ...overrides
  };
}

test('normalizeQueries accepts comma/newline lists and removes duplicates', () => {
  assert.deepEqual(
    normalizeQueries(' alpha, beta\nalpha\n gamma ,, '),
    ['alpha', 'beta', 'gamma']
  );
});

test('Search Sync dedupes conversations across queries before one persistence merge', async () => {
  const store = new MemoryConversationStore();
  const progress = [];
  const results = {
    alpha: queryResult('alpha', {
      pages: 2,
      hits: 2,
      conversations: [searchConversation('conv-shared', {
        hit_count: 2,
        match_kinds: ['content', 'title']
      })]
    }),
    beta: queryResult('beta', {
      hits: 2,
      conversations: [
        searchConversation('conv-shared'),
        searchConversation('conv-second')
      ]
    })
  };

  const summary = await runSearchSync({
    queries: ['alpha', 'beta'],
    store,
    runQuery: async (query, options) => {
      options.onProgress({
        pages: results[query].pages,
        hits: results[query].hits,
        uniqueConversations: results[query].conversations.length
      });
      return results[query];
    },
    onProgress: event => progress.push(event)
  });

  assert.equal(summary.state, 'complete');
  assert.equal(summary.pages, 3);
  assert.equal(summary.hits, 4);
  assert.equal(summary.unique_conversations, 2);
  assert.equal(summary.inserted, 2);
  assert.equal(summary.updated, 0);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.protected, 2);
  assert.equal(store.records.size, 2);
  assert.deepEqual(store.savedIds.sort(), ['conv-second', 'conv-shared']);
  assert.deepEqual(
    store.records.get('conv-shared').search_metadata.queries,
    ['alpha', 'beta']
  );
  assert.equal(store.records.get('conv-shared').search_metadata.hit_count, 3);
  assert.equal(store.deleteCalls, 0);
  assert.equal(progress[0].unique_conversations, 1);
});

test('Search Sync preserves stronger existing metadata and protection', async () => {
  const existing = {
    id: 'conv-project',
    title: 'History title',
    create_time: '2025-01-01T00:00:00.000Z',
    update_time: '2025-06-01T00:00:00.000Z',
    full_text: 'history title existing text',
    raw_data: { id: 'conv-project', gizmo_id: 'g-p-synthetic' },
    classification: CLASSIFICATIONS.PROJECT,
    classification_evidence: 'history-sync',
    discovery_sources: ['history']
  };
  const store = new MemoryConversationStore([existing]);

  const summary = await runSearchSync({
    queries: ['alpha'],
    store,
    runQuery: async query => queryResult(query, {
      hits: 1,
      conversations: [searchConversation('conv-project', {
        title: 'Search title',
        update_time: '2026-03-01T00:00:00.000Z'
      })]
    })
  });

  const saved = store.records.get('conv-project');
  assert.equal(summary.updated, 1);
  assert.equal(summary.protected, 1);
  assert.equal(saved.title, 'History title');
  assert.equal(saved.create_time, existing.create_time);
  assert.equal(saved.full_text, existing.full_text);
  assert.deepEqual(saved.raw_data, existing.raw_data);
  assert.equal(saved.classification, CLASSIFICATIONS.PROJECT);
});

test('repeating the same Search Sync is idempotent', async () => {
  const store = new MemoryConversationStore();
  const runQuery = async query => queryResult(query, {
    hits: 1,
    conversations: [searchConversation('conv-idempotent')]
  });

  const first = await runSearchSync({ queries: ['alpha'], store, runQuery });
  store.savedIds = [];
  const second = await runSearchSync({ queries: ['alpha'], store, runQuery });

  assert.equal(first.inserted, 1);
  assert.equal(second.inserted, 0);
  assert.equal(second.updated, 0);
  assert.equal(second.skipped, 1);
  assert.equal(store.records.size, 1);
  assert.deepEqual(store.savedIds, []);
});

test('partial and failed query outcomes remain honest while discovered records persist', async () => {
  const store = new MemoryConversationStore();
  const outcomes = {
    alpha: queryResult('alpha', {
      state: 'partial',
      stop_reason: 'max_pages',
      pages: 2,
      hits: 1,
      conversations: [searchConversation('conv-partial')]
    }),
    beta: queryResult('beta', {
      state: 'failed',
      stop_reason: 'http_500',
      error: 'Synthetic failure'
    }),
    gamma: queryResult('gamma')
  };

  const summary = await runSearchSync({
    queries: ['alpha', 'beta', 'gamma'],
    store,
    runQuery: async query => outcomes[query]
  });

  assert.equal(summary.state, 'partial');
  assert.deepEqual(
    summary.queries.map(item => [item.query, item.state]),
    [
      ['alpha', 'partial'],
      ['beta', 'failed'],
      ['gamma', 'complete']
    ]
  );
  assert.equal(summary.unique_conversations, 1);
  assert.equal(summary.inserted, 1);
  assert.equal(store.records.has('conv-partial'), true);
});

test('429 stops before later queries and reports the pause', async () => {
  const store = new MemoryConversationStore();
  const called = [];
  const summary = await runSearchSync({
    queries: ['alpha', 'beta'],
    store,
    runQuery: async query => {
      called.push(query);
      return queryResult(query, {
        state: 'failed',
        stop_reason: 'http_429',
        retry_after_ms: 90000
      });
    }
  });

  assert.deepEqual(called, ['alpha']);
  assert.equal(summary.state, 'failed');
  assert.equal(summary.stop_reason, 'http_429');
  assert.equal(summary.retry_after_ms, 90000);
  assert.deepEqual(summary.not_started_queries, ['beta']);
});

test('queries execute sequentially and cancellation stops the next query', async () => {
  const store = new MemoryConversationStore();
  let active = 0;
  let maximumActive = 0;
  const controller = new AbortController();
  const called = [];

  const summary = await runSearchSync({
    queries: ['alpha', 'beta'],
    store,
    signal: controller.signal,
    runQuery: async query => {
      called.push(query);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      controller.abort();
      return queryResult(query, {
        state: 'cancelled',
        stop_reason: 'cancelled'
      });
    }
  });

  assert.equal(maximumActive, 1);
  assert.deepEqual(called, ['alpha']);
  assert.equal(summary.state, 'cancelled');
  assert.deepEqual(summary.not_started_queries, ['beta']);
});
