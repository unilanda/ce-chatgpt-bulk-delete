'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  conversationRecord,
  createDashboardHarness
} = require('./helpers/dashboard-harness.js');

function getStore(harness, name) {
  const db = harness.managerMetaDatabase;
  assert.ok(db, 'manager metadata database should be open');
  const store = db.stores.get(name);
  assert.ok(store, `manager metadata store ${name} should exist`);
  return store;
}

async function addSelectedToNewCollection(harness, name) {
  await harness.selectAllRows();
  await harness.document.getElementById('add-to-collection-btn').click();
  harness.document.getElementById('collection-modal-name').value = name;
  await harness.document.getElementById('collection-modal-confirm-btn').click();
}

function historyResponse(id) {
  return {
    status: 200,
    body: {
      items: [{
        id,
        title: `History ${id}`,
        create_time: 1789486200,
        update_time: 1789486324.5,
        gizmo_id: null
      }],
      total: 1,
      limit: 10,
      offset: 0
    }
  };
}

test('actual dashboard initializes legacy inventory and provider-neutral manager metadata as separate IndexedDB databases', async () => {
  const harness = await createDashboardHarness({
    records: [conversationRecord('standalone')]
  });
  await harness.awaitInitialization();

  assert.deepEqual(
    [...harness.indexedDBState.databases.keys()].sort(),
    ['ChatGPT_BulkManager_DB', 'ConversationManager_Meta_DB'].sort()
  );
  assert.equal(harness.context.chatDB.db.records.size, 1);
  assert.equal(getStore(harness, 'collections').records.size, 0);
  assert.equal(getStore(harness, 'collection_memberships').records.size, 0);
  assert.equal(getStore(harness, 'archive_records').records.size, 0);
  assert.deepEqual(harness.consoleCalls.error, []);
});

test('actual dashboard can add Standalone, Project, and Custom GPT conversations to one local collection', async () => {
  const records = [
    conversationRecord('standalone', 'standalone-safe'),
    conversationRecord('project', 'project-protected'),
    conversationRecord('custom', 'custom-gpt-protected')
  ];
  const harness = await createDashboardHarness({ records });
  await harness.awaitInitialization();

  await addSelectedToNewCollection(harness, 'RNA research');

  const collections = [...getStore(harness, 'collections').records.values()];
  assert.equal(collections.length, 1);
  assert.equal(collections[0].name, 'RNA research');

  const memberships = [...getStore(harness, 'collection_memberships').records.values()];
  assert.equal(memberships.length, 3);
  assert.deepEqual(
    memberships.map(item => item.conversation_ref).sort(),
    ['chatgpt:custom', 'chatgpt:project', 'chatgpt:standalone']
  );
  assert.equal(harness.context.chatDB.db.records.size, 3, 'Collection membership must not mutate inventory');
  assert.match(harness.document.getElementById('collection-filter').innerHTML, /RNA research/);
});

test('collection metadata survives inventory clear and from-zero rebuild and reconnects to rediscovered conversation', async () => {
  const harness = await createDashboardHarness({
    records: [conversationRecord('same-chat')],
    confirmImpl: () => true,
    historyResponder: async () => historyResponse('same-chat')
  });
  await harness.awaitInitialization();
  await addSelectedToNewCollection(harness, 'Persistent collection');

  const collectionsStore = getStore(harness, 'collections');
  const membershipsStore = getStore(harness, 'collection_memberships');
  assert.equal(collectionsStore.records.size, 1);
  assert.equal(membershipsStore.records.size, 1);

  await harness.document.getElementById('clear-db-btn').click();
  assert.equal(harness.context.chatDB.db.records.size, 0);
  assert.equal(collectionsStore.records.size, 1, 'Inventory Clear must not clear collections');
  assert.equal(membershipsStore.records.size, 1, 'Inventory Clear must not clear memberships');

  await harness.document.getElementById('history-rebuild-btn').click();
  assert.equal(harness.context.chatDB.db.records.has('same-chat'), true);
  assert.equal(collectionsStore.records.size, 1);
  assert.equal(membershipsStore.records.size, 1);

  const collectionId = [...collectionsStore.records.keys()][0];
  harness.document.getElementById('collection-filter').value = collectionId;
  await harness.document.getElementById('collection-filter').dispatch('change');
  assert.equal(harness.document.querySelectorAll('.row-checkbox').length, 1);
});

test('deleting a local collection removes only collection metadata and makes no network request', async () => {
  const harness = await createDashboardHarness({
    records: [conversationRecord('keep-chat')],
    confirmImpl: () => true
  });
  await harness.awaitInitialization();
  await addSelectedToNewCollection(harness, 'Temporary');

  const fetchesBefore = harness.fetchCalls.length;
  const inventoryBefore = [...harness.context.chatDB.db.records.keys()];
  const deleteButton = harness.document.querySelectorAll('.collection-delete-btn')[0];
  assert.ok(deleteButton);
  await deleteButton.click();
  // deleteLocalCollection is invoked through a void listener; allow its awaits to settle.
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(getStore(harness, 'collections').records.size, 0);
  assert.equal(getStore(harness, 'collection_memberships').records.size, 0);
  assert.deepEqual([...harness.context.chatDB.db.records.keys()], inventoryBefore);
  assert.equal(harness.fetchCalls.length, fetchesBefore);
});

test('archive registry writes only metadata into the manager metadata database', async () => {
  const harness = await createDashboardHarness({ records: [conversationRecord('archivable')] });
  await harness.awaitInitialization();

  const registry = harness.context.ArchiveRegistry.createRegistry({
    store: harness.context.managerMetaDB,
    now: () => 2000
  });
  await registry.recordCapture({
    conversation_ref: 'chatgpt:archivable',
    capture_id:'capture-fixture',payload_ref:{store:'fixtures',key:'archive1'},completeness:'complete',
    scope:'selected_branch',branch_key:'main',capture_version:'v1',normalizer_version:'v1',
    source_updated_at: 100,
    content_hash: 'a'.repeat(64),
    normalized_hash: 'b'.repeat(64),
    message_count: 12,
    formats: ['md', 'html']
  });

  const records = [...getStore(harness, 'archive_records').records.values()];
  assert.equal(records.length, 1);
  assert.equal(records[0].conversation_ref, 'chatgpt:archivable');
  assert.equal(records[0].message_count, 12);
  for (const forbidden of ['messages', 'content', 'html', 'markdown', 'text', 'access_token']) {
    assert.equal(Object.hasOwn(records[0], forbidden), false, forbidden);
  }
});
