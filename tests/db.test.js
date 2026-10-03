'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ChatDB, chatDB } = require('../db.js');

function requestWith(result) {
  const request = {};
  queueMicrotask(() => {
    request.onsuccess?.({ target: { result } });
  });
  return request;
}

class FakeDatabase {
  constructor() {
    this.records = new Map();
    this.hasStore = false;
    this.objectStoreNames = {
      contains: name => this.hasStore && name === 'conversations'
    };
  }

  createObjectStore() {
    this.hasStore = true;
    return {
      createIndex() {}
    };
  }

  transaction() {
    return {
      objectStore: () => ({
        put: value => {
          this.records.set(value.id, structuredClone(value));
          return requestWith(undefined);
        },
        get: id => requestWith(
          this.records.has(id) ? structuredClone(this.records.get(id)) : undefined
        ),
        getAll: () => requestWith(
          Array.from(this.records.values(), value => structuredClone(value))
        ),
        delete: id => {
          this.records.delete(id);
          return requestWith(undefined);
        },
        clear: () => {
          this.records.clear();
          return requestWith(undefined);
        }
      })
    };
  }
}

class FakeIndexedDB {
  constructor() {
    this.database = new FakeDatabase();
    this.openCalls = [];
    this.opened = false;
  }

  open(name, version) {
    this.openCalls.push({ name, version });
    const request = {};
    queueMicrotask(() => {
      if (!this.opened) {
        this.opened = true;
        request.onupgradeneeded?.({ target: { result: this.database } });
      }
      request.onsuccess?.({ target: { result: this.database } });
    });
    return request;
  }
}

test('dashboard and service-worker adapters share the same extension-origin inventory', async () => {
  const indexedDBImpl = new FakeIndexedDB();
  const dashboardStore = new ChatDB({ indexedDBImpl });
  const workerStore = new ChatDB({ indexedDBImpl });

  await dashboardStore.init();
  await dashboardStore.saveConversation({ id: 'shared-one', title: 'Shared' });
  await workerStore.init();

  assert.deepEqual(await workerStore.getConversation('shared-one'), {
    id: 'shared-one',
    title: 'Shared'
  });
  await workerStore.deleteConversation('shared-one');
  assert.equal(await dashboardStore.getConversation('shared-one'), undefined);
  assert.deepEqual(indexedDBImpl.openCalls, [
    { name: 'ChatGPT_BulkManager_DB', version: 1 },
    { name: 'ChatGPT_BulkManager_DB', version: 1 }
  ]);
});

test('default singleton retains the established database and store names', () => {
  assert.equal(chatDB.dbName, 'ChatGPT_BulkManager_DB');
  assert.equal(chatDB.dbVersion, 1);
  assert.equal(chatDB.storeName, 'conversations');
});
