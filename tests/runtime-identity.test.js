'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const RuntimeIdentity = require('../runtime-identity.js');

test('runtime identity is stable, useful, and contains no local or private data', () => {
  assert.deepEqual(RuntimeIdentity.IDENTITY, {
    product: 'ChatGPT Manager',
    build_label: 'manager-backbone-v3',
    source_marker: 'cm-runtime-20261002-mb3',
    job_schema_version: 1
  });
  const serialized = JSON.stringify(RuntimeIdentity.IDENTITY);
  assert.doesNotMatch(
    serialized,
    /(?:\/home\/|\\Users\\|token|cookie|authorization|conversation_id)/i
  );
});

test('runtime identity formats one display/console marker', () => {
  assert.equal(
    RuntimeIdentity.formatMarker(),
    'ChatGPT Manager · manager-backbone-v3 · cm-runtime-20261002-mb3 · job schema 1'
  );
});
