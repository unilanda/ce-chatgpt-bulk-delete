'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const {
  filterRecords,
  reconcileSelection,
  selectVisibleIds
} = require('../inventory-workspace.js');

const records = [
  {
    id: 'standalone',
    title: 'Alpha notes',
    update_time: 1789486200,
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  },
  {
    id: 'project',
    title: 'Beta project',
    update_time: '2026-09-15T15:32:04.000Z',
    classification: CLASSIFICATIONS.PROJECT,
    classification_evidence: 'history-sync'
  },
  {
    id: 'custom',
    title: 'Gamma assistant',
    update_time: '2026-09-16T00:00:00.000Z',
    classification: CLASSIFICATIONS.CUSTOM_GPT,
    classification_evidence: 'history-sync'
  },
  {
    id: 'unverified',
    title: 'Delta search result',
    update_time: null,
    classification: CLASSIFICATIONS.UNKNOWN,
    classification_evidence: 'search-only'
  }
];

test('title filtering is case-insensitive and action-independent', () => {
  assert.deepEqual(
    filterRecords(records, { title: 'PROJECT' }).map(record => record.id),
    ['project']
  );
});

test('type filtering uses normal conversation types without Delete eligibility', () => {
  const expectations = {
    standalone: ['standalone'],
    project: ['project'],
    'custom-gpt': ['custom'],
    unverified: ['unverified']
  };
  for (const [type, ids] of Object.entries(expectations)) {
    assert.deepEqual(
      filterRecords(records, { type }).map(record => record.id),
      ids,
      type
    );
  }
});

test('verification status filters verified and unverified records', () => {
  assert.deepEqual(
    filterRecords(records, { status: 'verified' }).map(record => record.id),
    ['standalone', 'project', 'custom']
  );
  assert.deepEqual(
    filterRecords(records, { status: 'unverified' }).map(record => record.id),
    ['unverified']
  );
});

test('updated range compares numeric seconds and legacy ISO timestamps canonically', () => {
  assert.deepEqual(
    filterRecords(records, {
      updatedFrom: '2026-09-15T15:31:00.000Z',
      updatedTo: '2026-09-15T23:59:59.999Z'
    }).map(record => record.id),
    ['project']
  );
});

test('select visible includes every conversation type rather than only deletable rows', () => {
  assert.deepEqual(
    [...selectVisibleIds(records)],
    ['standalone', 'project', 'custom', 'unverified']
  );
});

test('selection reconciliation keeps protected and unverified IDs while removing missing IDs', () => {
  assert.deepEqual(
    [...reconcileSelection(
      ['standalone', 'project', 'unverified', 'missing', 'project'],
      records
    )],
    ['standalone', 'project', 'unverified']
  );
});
