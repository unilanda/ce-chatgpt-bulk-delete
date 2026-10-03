'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSearchRequest,
  createDiagnosticReport,
  extractConversationHits,
  parseRetryAfterMs,
  parseSearchResponse,
  runSearchDiagnostic,
  runSearchQuery
} = require('../search-core.js');
const {
  conversationHit,
  libraryHit,
  projectHit,
  searchResponse
} = require('./fixtures/search-responses.js');

test('duplicate search hits select the newest numeric-second timestamp', () => {
  const extracted = extractConversationHits([
    conversationHit({
      title: 'Synthetic older title',
      update_time: 1789486324,
      match_kind: 'title'
    }),
    conversationHit({
      title: 'Synthetic newer title',
      update_time: 1789486324.789347,
      match_kind: 'content'
    })
  ]);

  const conversation = extracted.conversations.get('conv-synthetic-001');
  assert.equal(conversation.title, 'Synthetic newer title');
  assert.equal(conversation.update_time, 1789486324.789347);
  assert.deepEqual(conversation.match_kinds, ['content', 'title']);
});

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
      return body;
    }
  };
}

test('buildSearchRequest starts with a null cursor and explicit conversation source', () => {
  assert.deepEqual(
    buildSearchRequest({
      query: 'synthetic term',
      queryId: 'query-session-001'
    }),
    {
      entrypoint: 'global_search',
      limit: 10,
      query: 'synthetic term',
      query_id: 'query-session-001',
      cursor: null,
      source_requests: [{ type: 'conversation' }]
    }
  );
});

test('runSearchQuery chains the exact opaque cursor and keeps one query id', async () => {
  const requestBodies = [];
  const responses = [
    searchResponse({
      items: [conversationHit({
        title: 'Synthetic older page title',
        update_time: 1789486324
      })],
      cursor: 'opaque-cursor-A',
      hasMore: true
    }),
    searchResponse({
      items: [
        conversationHit({
          title: 'Synthetic newer page title',
          update_time: 1789486324.789347,
          match_kind: 'content',
          payload: { message_id: 'msg-synthetic-002' }
        })
      ],
      cursor: 'opaque-cursor-B',
      hasMore: false
    })
  ];

  const result = await runSearchQuery({
    query: 'synthetic term',
    authToken: 'test-token-never-reported',
    queryIdFactory: () => 'query-session-stable',
    pageDelayMs: 0,
    sleep: async () => {},
    fetchImpl: async (_url, options) => {
      requestBodies.push(JSON.parse(options.body));
      return fakeResponse(200, responses.shift());
    }
  });

  assert.equal(result.state, 'complete');
  assert.equal(result.pages, 2);
  assert.equal(result.hits, 2);
  assert.equal(result.conversations.length, 1);
  assert.equal(result.conversations[0].hit_count, 2);
  assert.equal(result.conversations[0].title, 'Synthetic newer page title');
  assert.equal(result.conversations[0].update_time, 1789486324.789347);
  assert.deepEqual(result.conversations[0].match_kinds, ['content', 'title']);
  assert.deepEqual(
    requestBodies.map(body => ({
      cursor: body.cursor,
      query_id: body.query_id
    })),
    [
      { cursor: null, query_id: 'query-session-stable' },
      { cursor: 'opaque-cursor-A', query_id: 'query-session-stable' }
    ]
  );
});

test('separate query runs receive separate query ids', async () => {
  const queryIds = ['query-session-one', 'query-session-two'];
  const observed = [];
  const fetchImpl = async (_url, options) => {
    observed.push(JSON.parse(options.body).query_id);
    return fakeResponse(200, searchResponse());
  };

  await runSearchQuery({
    query: 'first',
    fetchImpl,
    authToken: 'token',
    queryIdFactory: () => queryIds.shift()
  });
  await runSearchQuery({
    query: 'second',
    fetchImpl,
    authToken: 'token',
    queryIdFactory: () => queryIds.shift()
  });

  assert.deepEqual(observed, ['query-session-one', 'query-session-two']);
});

test('heterogeneous project and library results are ignored', async () => {
  const result = await runSearchQuery({
    query: 'mixed',
    authToken: 'token',
    queryIdFactory: () => 'query-mixed',
    fetchImpl: async () => fakeResponse(200, searchResponse({
      items: [projectHit(), conversationHit(), libraryHit()]
    }))
  });

  assert.equal(result.hits, 1);
  assert.equal(result.conversations.length, 1);
  assert.deepEqual(result.non_conversation_source_types, ['library', 'project']);
});

test('conversation-shaped items missing conversation_id are skipped with a warning', async () => {
  const result = await runSearchQuery({
    query: 'malformed item',
    authToken: 'token',
    queryIdFactory: () => 'query-malformed-item',
    fetchImpl: async () => fakeResponse(200, searchResponse({
      items: [conversationHit({ payload: { conversation_id: null } })]
    }))
  });

  assert.equal(result.hits, 0);
  assert.equal(result.conversations.length, 0);
  assert.match(result.warnings.join('\n'), /missing conversation_id/);
});

test('has_more false completes even when a cursor is present', async () => {
  let requests = 0;
  const result = await runSearchQuery({
    query: 'finished',
    authToken: 'token',
    queryIdFactory: () => 'query-finished',
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(200, searchResponse({
        cursor: 'unused-cursor',
        hasMore: false
      }));
    }
  });

  assert.equal(result.state, 'complete');
  assert.equal(requests, 1);
});

test('has_more true without a cursor stops partial instead of guessing', async () => {
  const result = await runSearchQuery({
    query: 'missing cursor',
    authToken: 'token',
    queryIdFactory: () => 'query-missing-cursor',
    fetchImpl: async () => fakeResponse(200, searchResponse({
      items: [conversationHit()],
      cursor: null,
      hasMore: true
    }))
  });

  assert.equal(result.state, 'partial');
  assert.equal(result.stop_reason, 'missing_cursor');
  assert.equal(result.pages, 1);
});

test('a repeated cursor stops pagination defensively', async () => {
  const responses = [
    searchResponse({ cursor: 'repeat-me', hasMore: true }),
    searchResponse({ cursor: 'repeat-me', hasMore: true })
  ];
  const result = await runSearchQuery({
    query: 'repeated cursor',
    authToken: 'token',
    queryIdFactory: () => 'query-repeat',
    pageDelayMs: 0,
    sleep: async () => {},
    fetchImpl: async () => fakeResponse(200, responses.shift())
  });

  assert.equal(result.state, 'partial');
  assert.equal(result.stop_reason, 'repeated_cursor');
  assert.equal(result.pages, 2);
});

test('the maximum page cap stops a still-open query as partial', async () => {
  let page = 0;
  const result = await runSearchQuery({
    query: 'bounded',
    authToken: 'token',
    queryIdFactory: () => 'query-bounded',
    maxPages: 2,
    pageDelayMs: 0,
    sleep: async () => {},
    fetchImpl: async () => {
      page += 1;
      return fakeResponse(200, searchResponse({
        cursor: `cursor-${page}`,
        hasMore: true
      }));
    }
  });

  assert.equal(result.state, 'partial');
  assert.equal(result.stop_reason, 'max_pages');
  assert.equal(result.pages, 2);
});

test('malformed top-level responses fail without yielding records', async () => {
  const result = await runSearchQuery({
    query: 'bad schema',
    authToken: 'token',
    queryIdFactory: () => 'query-bad-schema',
    fetchImpl: async () => fakeResponse(200, { cursor: null })
  });

  assert.equal(result.state, 'failed');
  assert.equal(result.stop_reason, 'malformed_response');
  assert.deepEqual(result.conversations, []);
});

test('429 stops immediately and preserves Retry-After', async () => {
  let requests = 0;
  const result = await runSearchQuery({
    query: 'rate limited',
    authToken: 'token',
    queryIdFactory: () => 'query-rate-limited',
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(429, {}, { 'Retry-After': '120' });
    }
  });

  assert.equal(requests, 1);
  assert.equal(result.state, 'failed');
  assert.equal(result.stop_reason, 'http_429');
  assert.equal(result.retry_after_ms, 120000);
});

test('5xx retries once with bounded pacing then succeeds', async () => {
  const sleeps = [];
  let requests = 0;
  const result = await runSearchQuery({
    query: 'transient server issue',
    authToken: 'token',
    queryIdFactory: () => 'query-server-retry',
    retryDelayMs: 2000,
    sleep: async ms => sleeps.push(ms),
    fetchImpl: async () => {
      requests += 1;
      if (requests === 1) return fakeResponse(503, {});
      return fakeResponse(200, searchResponse());
    }
  });

  assert.equal(result.state, 'complete');
  assert.equal(requests, 2);
  assert.deepEqual(sleeps, [2000]);
});

test('a persistent 5xx fails after the one bounded retry', async () => {
  let requests = 0;
  const result = await runSearchQuery({
    query: 'persistent server issue',
    authToken: 'token',
    queryIdFactory: () => 'query-server-fail',
    retryDelayMs: 0,
    sleep: async () => {},
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(500, {});
    }
  });

  assert.equal(requests, 2);
  assert.equal(result.state, 'failed');
  assert.equal(result.stop_reason, 'http_500');
});

test('an aborted signal cancels without making a request', async () => {
  const controller = new AbortController();
  controller.abort();
  let requests = 0;
  const result = await runSearchQuery({
    query: 'cancelled',
    authToken: 'token',
    signal: controller.signal,
    queryIdFactory: () => 'query-cancelled',
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(200, searchResponse());
    }
  });

  assert.equal(result.state, 'cancelled');
  assert.equal(requests, 0);
});

test('parseSearchResponse rejects missing conversation has_more status', () => {
  assert.throws(
    () => parseSearchResponse({
      items: [],
      cursor: null,
      source_statuses: []
    }),
    /conversation source status/
  );
});

test('Retry-After supports seconds, dates, and invalid values', () => {
  const now = Date.parse('2026-01-01T00:00:00.000Z');
  assert.equal(parseRetryAfterMs('7', now), 7000);
  assert.equal(
    parseRetryAfterMs('Thu, 01 Jan 2026 00:01:00 GMT', now),
    60000
  );
  assert.equal(parseRetryAfterMs('not-a-delay', now), null);
});

test('diagnostic reports only sanitized aggregate schema information', () => {
  const report = createDiagnosticReport({
    httpStatus: 200,
    body: searchResponse({
      items: [conversationHit(), projectHit()],
      cursor: 'private-opaque-cursor',
      hasMore: true,
      extra: { experimental_key: true }
    })
  });

  assert.deepEqual(report, {
    http_status: 200,
    top_level_response_keys: [
      'cursor',
      'experimental_key',
      'items',
      'source_statuses'
    ],
    item_count: 2,
    conversation_count: 1,
    non_conversation_source_types: ['project'],
    cursor_present: true,
    conversation_has_more: true,
    schema_warnings: []
  });
  assert.equal(JSON.stringify(report).includes('Synthetic planning chat'), false);
  assert.equal(JSON.stringify(report).includes('private-opaque-cursor'), false);
});

test('read-only diagnostic defaults to one page and excludes private values', async () => {
  let requests = 0;
  const report = await runSearchDiagnostic({
    query: 'private diagnostic query',
    authToken: 'private diagnostic token',
    queryIdFactory: () => 'private-query-session',
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(200, searchResponse({
        items: [conversationHit({ title: 'Private diagnostic title' })],
        cursor: 'private-diagnostic-cursor',
        hasMore: true
      }));
    }
  });

  assert.equal(requests, 1);
  assert.equal(report.state, 'partial');
  assert.equal(report.stop_reason, 'diagnostic_page_limit');
  assert.equal(report.pages, 1);
  assert.equal(report.http_status, 200);
  assert.equal(report.cursor_present, true);
  const serialized = JSON.stringify(report);
  for (const privateValue of [
    'private diagnostic query',
    'private diagnostic token',
    'private-query-session',
    'private-diagnostic-cursor',
    'Private diagnostic title',
    'conv-synthetic-001'
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('read-only diagnostic caps at two pages and chains the exact cursor internally', async () => {
  const bodies = [];
  const responses = [
    searchResponse({ cursor: 'opaque-one', hasMore: true }),
    searchResponse({ cursor: 'opaque-two', hasMore: false })
  ];
  const report = await runSearchDiagnostic({
    query: 'bounded diagnostic',
    authToken: 'token',
    maxPages: 99,
    pageDelayMs: 0,
    sleep: async () => {},
    queryIdFactory: () => 'stable-diagnostic-session',
    fetchImpl: async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return fakeResponse(200, responses.shift());
    }
  });

  assert.equal(report.state, 'complete');
  assert.equal(report.pages, 2);
  assert.deepEqual(bodies.map(body => ({
    cursor: body.cursor,
    query_id: body.query_id
  })), [
    { cursor: null, query_id: 'stable-diagnostic-session' },
    { cursor: 'opaque-one', query_id: 'stable-diagnostic-session' }
  ]);
});

test('read-only diagnostic reports 429 once without retry or private response data', async () => {
  let requests = 0;
  const report = await runSearchDiagnostic({
    query: 'rate diagnostic',
    authToken: 'token',
    fetchImpl: async () => {
      requests += 1;
      return fakeResponse(429, { private_error: 'do not expose' }, {
        'Retry-After': '45'
      });
    }
  });

  assert.equal(requests, 1);
  assert.equal(report.state, 'failed');
  assert.equal(report.stop_reason, 'http_429');
  assert.equal(report.http_status, 429);
  assert.equal(report.retry_after_ms, 45000);
  assert.equal(JSON.stringify(report).includes('do not expose'), false);
});
