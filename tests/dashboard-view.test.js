'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classificationLabel,
  formatConversationDate,
  formatDeletionProgress,
  formatEligibilityProgress,
  formatHistoryDetails,
  formatHistoryStatus,
  formatSearchStatus,
  formatSelectionCount,
  formatSearchProgress,
  formatSearchSummary,
  verificationDescription,
  verificationLabel
} = require('../dashboard-view.js');

test('conversation dates render numeric seconds and legacy ISO values consistently', () => {
  const formatDateTime = milliseconds => new Date(milliseconds).toISOString();

  assert.equal(
    formatConversationDate(1789486324.789347, { formatDateTime }),
    '2026-09-15T15:32:04.789Z'
  );
  assert.equal(
    formatConversationDate('2026-09-15T15:32:04.789Z', { formatDateTime }),
    '2026-09-15T15:32:04.789Z'
  );
  assert.equal(
    formatConversationDate('invalid', { formatDateTime }),
    'Unknown'
  );
  assert.equal(formatConversationDate(null, { formatDateTime }), 'Unknown');
});

test('Search Sync progress exposes current query and all required counters', () => {
  const text = formatSearchProgress({
    current_query: 'synthetic query',
    pages: 3,
    hits: 12,
    unique_conversations: 7,
    inserted: 2,
    updated: 1,
    skipped: 4,
    protected: 6
  });

  for (const expected of [
    'Query: synthetic query',
    'pages 3',
    'hits 12',
    'unique 7',
    'inserted 2',
    'updated 1',
    'skipped 4',
    'protected 6'
  ]) {
    assert.match(text, new RegExp(expected));
  }
});

test('Search Sync summary reports complete partial and failed queries honestly', () => {
  const text = formatSearchSummary({
    state: 'partial',
    pages: 4,
    hits: 9,
    unique_conversations: 5,
    inserted: 2,
    updated: 1,
    skipped: 2,
    protected: 4,
    queries: [
      { query: 'alpha', state: 'complete', pages: 2, hits: 5, stop_reason: null },
      { query: 'beta', state: 'partial', pages: 2, hits: 4, stop_reason: 'max_pages' },
      { query: 'gamma', state: 'failed', pages: 0, hits: 0, stop_reason: 'http_500' }
    ]
  });

  assert.match(text, /Search Sync: partial/);
  assert.match(text, /alpha: complete/);
  assert.match(text, /beta: partial \(max_pages\)/);
  assert.match(text, /gamma: failed \(http_500\)/);
});

test('Search Sync summary exposes Retry-After for rate limiting', () => {
  const text = formatSearchSummary({
    state: 'failed',
    stop_reason: 'http_429',
    pages: 0,
    hits: 0,
    unique_conversations: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    protected: 0,
    retry_after_ms: 90000,
    queries: []
  });

  assert.match(text, /Retry-After 90 seconds/);
});

test('normal conversation type and verification labels avoid action language', () => {
  assert.equal(classificationLabel('standalone-safe'), 'Standalone');
  assert.equal(classificationLabel('project-protected'), 'Project');
  assert.equal(classificationLabel('custom-gpt-protected'), 'Custom GPT');
  assert.equal(classificationLabel('unknown-protected'), 'Unverified');
  assert.equal(classificationLabel('unexpected'), 'Unverified');
  assert.equal(verificationLabel('standalone-safe'), 'Verified');
  assert.equal(verificationLabel('project-protected'), 'Verified');
  assert.equal(verificationLabel('unknown-protected'), 'Needs verification');
  assert.equal(verificationLabel('unexpected'), 'Needs verification');
});

test('Unverified rows have concise destructive-action guidance', () => {
  const expected = 'Type not confirmed yet. Verify before destructive actions.';

  assert.equal(verificationDescription('unknown-protected'), expected);
  assert.equal(verificationDescription('unexpected'), expected);
  assert.equal(verificationDescription('standalone-safe'), null);
  assert.equal(verificationDescription('project-protected'), null);
  assert.equal(verificationDescription('custom-gpt-protected'), null);
});

test('History status separates current-run counts from total local inventory', () => {
  const summary = {
    state: 'complete',
    fetched: 20,
    inserted: 4,
    updated: 0,
    unchanged: 16,
    total_local: 427
  };

  assert.equal(
    formatHistoryStatus(summary),
    'History loaded — 20 fetched · 4 added · 0 updated · 16 unchanged'
  );
  assert.equal(formatHistoryDetails(summary), '427 conversations in local inventory');
});

test('partial rate-limited History status is plain language and preserves inventory', () => {
  assert.equal(
    formatHistoryStatus({
      state: 'partial',
      stop_reason: 'http_429',
      fetched: 40
    }),
    'History partially loaded. 40 conversations were fetched before ChatGPT temporarily stopped responding. Your existing conversations were kept. Retry later.'
  );
});

test('normal Search status reports matching conversations without protocol counters', () => {
  assert.equal(
    formatSearchStatus({ unique_conversations: 7 }, 'rna'),
    '7 matching conversations found for “rna”.'
  );
});

test('selection count uses generic selection language', () => {
  assert.equal(formatSelectionCount(1), '1 selected');
  assert.equal(formatSelectionCount(12), '12 selected');
});

test('eligibility progress exposes bounded queue outcomes and current progress', () => {
  const text = formatEligibilityProgress({
    state: 'partial',
    queued: 10,
    processed: 6,
    verified_standalone: 2,
    protected_project: 1,
    protected_custom_gpt: 1,
    still_unknown: 2,
    failed: 1,
    rate_limited: 0,
    retry_after_ms: null
  });

  for (const expected of [
    'Eligibility: partial',
    'progress 6/10',
    'standalone 2',
    'Project 1',
    'Custom GPT 1',
    'unknown 2',
    'failed 1',
    'rate-limited 0'
  ]) {
    assert.match(text, new RegExp(expected));
  }
});

test('deletion wait progress shows completed count and visible countdown', () => {
  const text = formatDeletionProgress({
    phase: 'waiting',
    completed: 1,
    total: 2,
    next_at: Date.UTC(2026, 0, 2, 3, 4, 5),
    remaining_ms: 600000
  }, {
    formatTime: value => new Date(value).toISOString()
  });

  assert.equal(text, '1 of 2 deleted · Next deletion in 10:00');
});
