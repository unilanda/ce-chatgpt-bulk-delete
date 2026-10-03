(function attachChatDB(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ChatDB = api.ChatDB;
  root.chatDB = api.chatDB;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChatDBModule() {
  'use strict';

  // A lightweight Promise-wrapper for the extension origin's IndexedDB.
  class ChatDB {
    constructor({
      indexedDBImpl = globalThis.indexedDB,
      dbName = 'ChatGPT_BulkManager_DB',
      dbVersion = 1,
      storeName = 'conversations'
    } = {}) {
      this.indexedDB = indexedDBImpl;
      this.dbName = dbName;
      this.dbVersion = dbVersion;
      this.storeName = storeName;
      this.db = null;
    }

  // Initialize and open the database
  init() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        resolve(this.db);
        return;
      }

      if (!this.indexedDB || typeof this.indexedDB.open !== 'function') {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const request = this.indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error("IndexedDB error:", event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        // Create an object store for conversations with 'id' as the primary key
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
          // Create indices for fast sorting
          store.createIndex('update_time', 'update_time', { unique: false });
          store.createIndex('create_time', 'create_time', { unique: false });
        }
      };
    });
  }

  // Save or update a single conversation
  saveConversation(chat) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put(chat); // put() will insert or update

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  // Delete a conversation
  deleteConversation(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  // Get a single conversation
  getConversation(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(id);

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  // Clear all conversations
  clearAll() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  // Get all conversations (useful for in-memory filtering and full-text search)
  getAllConversations() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = (event) => reject(event.target.error);
    });
  }
  }

  // Dashboard and service-worker instances use this same extension-origin
  // database name; IndexedDB supplies the cross-context shared persistence.
  const chatDB = new ChatDB();

  return { ChatDB, chatDB };
});
