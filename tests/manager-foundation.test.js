'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createService } = require('../collection-service.js');
const { createRegistry, CAPTURE_STATUSES } = require('../archive-registry.js');
const ProviderCapabilities = require('../provider-capabilities.js');

const STORE_NAMES = {
  collections: 'collections',
  memberships: 'collection_memberships',
  archives: 'archive_records'
};

const { MetadataMemoryStore: MemoryStore } = require('./helpers/metadata-memory-store.js');

test('collections are local, provider-neutral memberships and duplicate adds are idempotent', async () => {
  const store = new MemoryStore();
  let id = 0;
  const service = createService({ store, now: () => 1000, idFactory: () => `c${++id}` });
  const collection = await service.createCollection('  RNA   switches ');
  assert.equal(collection.name, 'RNA switches');
  assert.equal(await service.addConversationRefs(collection.id, [
    'chatgpt:one', 'chatgpt:one', 'claude:two'
  ]), 2);
  assert.deepEqual(await service.listConversationRefs(collection.id), [
    'chatgpt:one', 'claude:two'
  ]);
  assert.equal((await service.listCollections())[0].count, 2);
});

test('collection deletion cascades memberships atomically', async () => {
  const store = new MemoryStore();
  const service = createService({ store, now: () => 1000, idFactory: () => 'c1' });
  const collection = await service.createCollection('A');
  await service.addConversationRefs(collection.id, ['chatgpt:one']);
  await service.deleteCollection(collection.id);
  assert.deepEqual(await service.listCollections(), []);
  assert.deepEqual(await service.listConversationRefs(collection.id), []);
});

test('archive registry records capture versions and detects stale source metadata', async () => {
  const store = new MemoryStore();
  let now = 1000;
  const registry = createRegistry({ store, now: () => now });
  const first = await registry.recordCapture({
    conversation_ref: 'chatgpt:one',
    capture_id: `capture-${now}`, payload_ref: { store: 'fixtures', key: `payload-${now}` },
    completeness: 'complete', scope: 'selected_branch', branch_key: 'main', capture_version: 'fixture-v1', normalizer_version: 'fixture-v1',
    source_updated_at: 10,
    content_hash: 'a'.repeat(64),
    normalized_hash: 'a'.repeat(64),
    message_count: 8,
    formats: ['md', 'html']
  });
  assert.equal(first.revision, 1);
  assert.equal(await registry.evaluateFreshness('chatgpt:one', 10), CAPTURE_STATUSES.CURRENT);
  assert.equal(await registry.evaluateFreshness('chatgpt:one', 11), CAPTURE_STATUSES.STALE);
  now = 2000;
  const second = await registry.recordCapture({
    conversation_ref: 'chatgpt:one',
    capture_id: `capture-${now}`, payload_ref: { store: 'fixtures', key: `payload-${now}` },
    completeness: 'complete', scope: 'selected_branch', branch_key: 'main', capture_version: 'fixture-v1', normalizer_version: 'fixture-v1',
    source_updated_at: 11,
    content_hash: 'b'.repeat(64), normalized_hash: 'b'.repeat(64), message_count: 9
  });
  assert.equal(second.revision, 2);
  assert.equal(second.last_captured_at, 2000);
});

test('ChatGPT capability matrix keeps Custom GPT deletion explicitly unsupported', () => {
  const capabilities = ProviderCapabilities.requireProvider('chatgpt');
  assert.equal(capabilities.delete.standalone, true);
  assert.equal(capabilities.delete.project, true);
  assert.equal(capabilities.delete.custom_gpt, false);
  assert.match(capabilities.delete.custom_gpt_reason, /not been live-validated/i);
});
