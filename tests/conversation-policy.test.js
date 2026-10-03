'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLASSIFICATIONS,
  classifyHistoryItem,
  historyItemToRecord,
  isBulkDeletable,
  mergeConversationRecords,
  normalizeConversationRecord,
  recordsEqual,
  searchHitToRecord,
  selectEligibleIds
} = require('../conversation-policy.js');

test('historyItemToRecord stores explicit classification evidence without message content', () => {
  const record = historyItemToRecord({
    id: 'conv-history',
    title: 'Synthetic history title',
    create_time: '2025-01-01T00:00:00.000Z',
    update_time: '2026-01-01T00:00:00.000Z',
    gizmo_id: null,
    unexpected_message_body: 'must not become searchable text'
  });

  assert.equal(record.classification, CLASSIFICATIONS.STANDALONE);
  assert.equal(record.classification_evidence, 'history-sync');
  assert.equal(record.full_text, 'synthetic history title');
  assert.deepEqual(record.discovery_sources, ['history']);
  assert.equal(record.full_text.includes('message body'), false);
  assert.equal('unexpected_message_body' in record.raw_data, false);
});

test('search-only discoveries are unknown and protected', () => {
  const record = searchHitToRecord({
    id: 'conv-search-only',
    title: 'Synthetic search result',
    update_time: '2026-02-01T00:00:00.000Z',
    is_archived: false,
    is_starred: false,
    hit_count: 2,
    match_kinds: ['content', 'title']
  }, 'synthetic query');

  assert.equal(record.classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(isBulkDeletable(record), false);
  assert.equal('raw_data' in record, false);
  assert.deepEqual(record.search_metadata.queries, ['synthetic query']);
});

test('history classification requires explicit gizmo_id evidence', () => {
  assert.equal(
    classifyHistoryItem({ id: 'legacy-without-gizmo-field' }),
    CLASSIFICATIONS.UNKNOWN
  );
  assert.equal(
    classifyHistoryItem({ id: 'known-standalone', gizmo_id: null }),
    CLASSIFICATIONS.STANDALONE
  );
  assert.equal(
    classifyHistoryItem({ id: 'known-project', gizmo_id: 'g-p-synthetic' }),
    CLASSIFICATIONS.PROJECT
  );
  assert.equal(
    classifyHistoryItem({ id: 'known-custom-gpt', gizmo_id: 'g-synthetic' }),
    CLASSIFICATIONS.CUSTOM_GPT
  );
  assert.equal(
    classifyHistoryItem({ id: 'invalid-false-gizmo', gizmo_id: false }),
    CLASSIFICATIONS.UNKNOWN
  );
  assert.equal(
    classifyHistoryItem({ id: 'invalid-zero-gizmo', gizmo_id: 0 }),
    CLASSIFICATIONS.UNKNOWN
  );
});

test('an unsubstantiated stored standalone label normalizes to protected unknown', () => {
  const normalized = normalizeConversationRecord({
    id: 'conv-unsubstantiated',
    classification: CLASSIFICATIONS.STANDALONE
  });

  assert.equal(normalized.classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(isBulkDeletable(normalized), false);
});

test('project and custom GPT protection survives weaker search merges', () => {
  for (const [id, classification] of [
    ['conv-project', CLASSIFICATIONS.PROJECT],
    ['conv-custom', CLASSIFICATIONS.CUSTOM_GPT]
  ]) {
    const existing = {
      id,
      title: 'Strong history title',
      create_time: '2025-01-01T00:00:00.000Z',
      update_time: '2026-01-01T00:00:00.000Z',
      raw_data: { id, gizmo_id: classification === CLASSIFICATIONS.PROJECT ? 'g-p-safe' : 'g-safe' },
      classification,
      classification_evidence: 'history-sync',
      discovery_sources: ['history']
    };
    const incoming = searchHitToRecord({
      id,
      title: 'Weaker search title',
      update_time: '2026-02-01T00:00:00.000Z',
      hit_count: 1,
      match_kinds: ['title']
    }, 'query');

    const merged = mergeConversationRecords(existing, incoming);
    assert.equal(merged.classification, classification);
    assert.equal(isBulkDeletable(merged), false);
    assert.deepEqual(merged.raw_data, existing.raw_data);
    assert.equal(merged.create_time, existing.create_time);
    assert.equal(merged.title, existing.title);
  }
});

test('known standalone eligibility survives an unknown search merge', () => {
  const existing = normalizeConversationRecord({
    id: 'conv-standalone',
    title: 'History title',
    raw_data: { id: 'conv-standalone', gizmo_id: null },
    discovery_sources: ['history']
  });
  const merged = mergeConversationRecords(existing, searchHitToRecord({
    id: 'conv-standalone',
    title: 'Search title',
    update_time: '2026-02-01T00:00:00.000Z',
    hit_count: 1,
    match_kinds: ['content']
  }, 'query'));

  assert.equal(merged.classification, CLASSIFICATIONS.STANDALONE);
  assert.equal(isBulkDeletable(merged), true);
});

test('a later History observation refreshes mutable History metadata', () => {
  const existing = historyItemToRecord({
    id: 'conv-history-refresh',
    title: 'Old history title',
    create_time: '2025-01-01T00:00:00.000Z',
    update_time: '2026-01-01T00:00:00.000Z',
    gizmo_id: null
  });
  const incoming = historyItemToRecord({
    id: 'conv-history-refresh',
    title: 'Renamed history title',
    create_time: '2025-01-01T00:00:00.000Z',
    update_time: '2026-02-01T00:00:00.000Z',
    gizmo_id: null
  });

  const merged = mergeConversationRecords(existing, incoming);
  assert.equal(merged.title, 'Renamed history title');
  assert.equal(merged.full_text, 'renamed history title');
  assert.equal(merged.update_time, '2026-02-01T00:00:00.000Z');
  assert.equal(merged.classification, CLASSIFICATIONS.STANDALONE);
});

test('canonical record equality ignores object key order but detects value changes', () => {
  assert.equal(recordsEqual(
    { id: 'same', metadata: { first: 1, second: 2 } },
    { metadata: { second: 2, first: 1 }, id: 'same' }
  ), true);
  assert.equal(recordsEqual(
    { id: 'same', metadata: { first: 1 } },
    { id: 'same', metadata: { first: 2 } }
  ), false);
});

test('search discovery followed by history sync merges to one eligible record by id', () => {
  const searchRecord = searchHitToRecord({
    id: 'conv-search-then-history',
    title: 'Search title',
    update_time: 1789486324.25,
    hit_count: 1,
    match_kinds: ['content']
  }, 'synthetic query');
  const historyRecord = historyItemToRecord({
    id: 'conv-search-then-history',
    title: 'History title',
    update_time: '2026-09-15T15:32:04.789Z',
    gizmo_id: null
  });

  const merged = mergeConversationRecords(searchRecord, historyRecord);
  assert.equal(merged.id, 'conv-search-then-history');
  assert.equal(merged.classification, CLASSIFICATIONS.STANDALONE);
  assert.equal(isBulkDeletable(merged), true);
  assert.deepEqual(merged.discovery_sources, ['history', 'search']);
  assert.deepEqual(merged.raw_data, historyRecord.raw_data);
});

test('history discovery followed by newer search merges mixed timestamps without weakening protection', () => {
  const historyRecord = historyItemToRecord({
    id: 'conv-history-then-search',
    title: 'History title',
    update_time: '2026-09-15T15:32:04.000Z',
    gizmo_id: 'g-p-synthetic'
  });
  const searchRecord = searchHitToRecord({
    id: 'conv-history-then-search',
    title: 'Search title',
    update_time: 1789486324.789347,
    hit_count: 2,
    match_kinds: ['title']
  }, 'synthetic query');

  const merged = mergeConversationRecords(historyRecord, searchRecord);
  assert.equal(merged.update_time, 1789486324.789347);
  assert.equal(merged.classification, CLASSIFICATIONS.PROJECT);
  assert.equal(isBulkDeletable(merged), false);
  assert.deepEqual(merged.discovery_sources, ['history', 'search']);
  assert.deepEqual(merged.raw_data, historyRecord.raw_data);
});

test('record merge selects the newer numeric-second timestamp without rewriting it', () => {
  const existing = normalizeConversationRecord({
    id: 'conv-numeric-merge',
    title: 'Existing history title',
    update_time: 1789486324.25,
    raw_data: { id: 'conv-numeric-merge', gizmo_id: null },
    discovery_sources: ['history']
  });
  const incoming = searchHitToRecord({
    id: 'conv-numeric-merge',
    title: 'Incoming search title',
    update_time: 1789486324.789347,
    hit_count: 1,
    match_kinds: ['content']
  }, 'synthetic query');

  const merged = mergeConversationRecords(existing, incoming);
  assert.equal(merged.update_time, 1789486324.789347);
  assert.equal(merged.classification, CLASSIFICATIONS.STANDALONE);

  const reverseMerged = mergeConversationRecords(
    { ...existing, update_time: 1789486324.789347 },
    { ...incoming, update_time: 1789486324.25 }
  );
  assert.equal(reverseMerged.update_time, 1789486324.789347);
});

test('record merge keeps ISO timestamp ordering for stored backward compatibility', () => {
  const merged = mergeConversationRecords(
    {
      id: 'conv-iso-merge',
      update_time: '2026-09-15T15:32:04.000Z',
      classification: CLASSIFICATIONS.UNKNOWN,
      classification_evidence: 'search-only'
    },
    {
      id: 'conv-iso-merge',
      update_time: '2026-09-15T15:32:04.789Z',
      classification: CLASSIFICATIONS.UNKNOWN,
      classification_evidence: 'search-only'
    }
  );

  assert.equal(merged.update_time, '2026-09-15T15:32:04.789Z');
});

test('weaker standalone metadata cannot downgrade known protection', () => {
  const protectedRecord = normalizeConversationRecord({
    id: 'conv-protected',
    raw_data: { id: 'conv-protected', gizmo_id: 'g-p-synthetic' }
  });
  const claimedStandalone = {
    id: 'conv-protected',
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };

  const merged = mergeConversationRecords(protectedRecord, claimedStandalone);
  assert.equal(merged.classification, CLASSIFICATIONS.PROJECT);
  assert.equal(isBulkDeletable(merged), false);
});

test('legacy records normalize to protected unknown unless evidence is explicit', () => {
  const normalized = normalizeConversationRecord({
    id: 'conv-legacy',
    title: 'Legacy record',
    raw_data: { id: 'conv-legacy' }
  });

  assert.equal(normalized.classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(normalized.classification_evidence, 'insufficient-history-metadata');
});

test('select all returns eligible standalone IDs only', () => {
  const records = [
    {
      id: 'eligible',
      classification: CLASSIFICATIONS.STANDALONE,
      classification_evidence: 'history-sync'
    },
    {
      id: 'project',
      classification: CLASSIFICATIONS.PROJECT
    },
    {
      id: 'custom',
      classification: CLASSIFICATIONS.CUSTOM_GPT
    },
    {
      id: 'unknown',
      classification: CLASSIFICATIONS.UNKNOWN
    }
  ];

  assert.deepEqual(selectEligibleIds(records), ['eligible']);
});
