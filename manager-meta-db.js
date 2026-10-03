(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports)
        module.exports = api;
    root.ManagerMetaDB = api.ManagerMetaDB;
    root.ManagerMetaStoreNames = api.STORE_NAMES;
    root.managerMetaDB = api.managerMetaDB;
})(globalThis, function () {
    'use strict';
    const DB_VERSION = 2;
    const STORE_NAMES = Object.freeze({
        collections: 'collections',
        memberships: 'collection_memberships',
        tags: 'tags',
        tagMemberships: 'tag_memberships',
        archives: 'archive_records',
        archiveRevisions: 'archive_revisions',
        artifacts: 'artifacts',
        artifactSources: 'artifact_sources',
        relationships: 'relationships',
        clusters: 'clusters',
        clusterMemberships: 'cluster_memberships'
    });
    const SCHEMA = Object.freeze({
        collections: {
            key: 'id',
            indexes: {
                name_key: ['name_key', true],
                updated_at: ['updated_at', false]
            }
        },
        collection_memberships: {
            key: 'key',
            indexes: {
                collection_id: ['collection_id', false],
                conversation_ref: ['conversation_ref', false]
            }
        },
        tags: {
            key: 'id',
            indexes: {
                name_key: ['name_key', true]
            }
        },
        tag_memberships: {
            key: 'key',
            indexes: {
                tag_id: ['tag_id', false],
                conversation_ref: ['conversation_ref', false]
            }
        },
        archive_records: {
            key: 'conversation_ref',
            indexes: {
                provider: ['provider', false]
            }
        },
        archive_revisions: {
            key: 'key',
            indexes: {
                conversation_ref: ['conversation_ref', false],
                capture_id: ['capture_id', true]
            }
        },
        artifacts: {
            key: 'id',
            indexes: {
                type: ['type', false],
                status: ['status', false]
            }
        },
        artifact_sources: {
            key: 'key',
            indexes: {
                artifact_id: ['artifact_id', false],
                conversation_ref: ['conversation_ref', false]
            }
        },
        relationships: {
            key: 'key',
            indexes: {
                source_ref: ['source_ref', false],
                target_ref: ['target_ref', false],
                type: ['type', false]
            }
        },
        clusters: {
            key: 'id',
            indexes: {
                source_artifact_id: ['source_artifact_id', false]
            }
        },
        cluster_memberships: {
            key: 'key',
            indexes: {
                cluster_id: ['cluster_id', false],
                conversation_ref: ['conversation_ref', false]
            }
        }
    });
    class ManagerMetaDB {
        constructor({ indexedDBImpl = globalThis.indexedDB, dbName = 'ConversationManager_Meta_DB', dbVersion = DB_VERSION, channelFactory = name => typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null } = {}) {
            this.indexedDB = indexedDBImpl;
            this.dbName = dbName;
            this.dbVersion = dbVersion;
            this.db = null;
            this.opening = null;
            this.listeners = new Set();
            this.channel = null;
            this.channelFactory = channelFactory;
        }
        init() {
            if (this.db)
                return Promise.resolve(this.db);
            if (this.opening)
                return this.opening;
            this.opening = new Promise((resolve, reject) => {
                if (!this.indexedDB?.open) {
                    reject(new Error('IndexedDB is unavailable'));
                    return;
                }
                let abandoned = false;
                const req = this.indexedDB.open(this.dbName, this.dbVersion);
                req.onerror = () => reject(req.error || new Error('Manager metadata database could not open'));
                req.onblocked = () => {
                    abandoned = true;
                    reject(new Error('Metadata upgrade blocked: close other Manager tabs and reopen'));
                };
                req.onupgradeneeded = event => {
                    const db = event.target.result;
                    for (const [name, spec] of Object.entries(SCHEMA)) {
                        const store = db.objectStoreNames.contains(name) ? req.transaction.objectStore(name) : db.createObjectStore(name, {
                            keyPath: spec.key
                        });
                        for (const [index, [keyPath, unique]] of Object.entries(spec.indexes)) {
                            if (!store.indexNames?.contains(index))
                                store.createIndex(index, keyPath, { unique });
                        }
                    }
                };
                req.onsuccess = event => {
                    const db = event.target.result;
                    if (abandoned) {
                        db.close();
                        return;
                    }
                    for (const name of Object.keys(SCHEMA)) {
                        if (!db.objectStoreNames.contains(name)) {
                            db.close();
                            reject(new Error(`Missing metadata store: ${name}`));
                            return;
                        }
                    }
                    this.db = db;
                    db.onversionchange = () => this.close();
                    db.onclose = () => {
                        this.db = null;
                    };
                    if (!this.channel) {
                        try {
                            this.channel = this.channelFactory(`${this.dbName}:committed`);
                            if (this.channel)
                                this.channel.onmessage = () => this._notify();
                        }
                        catch (_error) {
                            this.channel = null; /* Synchronization is optional; durable writes still work. */
                        }
                    }
                    resolve(db);
                };
            }).finally(() => {
                this.opening = null;
            });
            return this.opening;
        }
        close() {
            this.db?.close?.();
            this.db = null;
            this.channel?.close?.();
            this.channel = null;
        }
        subscribe(listener) {
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }
        _notify() {
            for (const listener of this.listeners) {
                try {
                    listener();
                }
                catch (_) { /* Notification cannot roll back a committed write. */ }
            }
        }
        _committed() {
            this._notify();
            try {
                this.channel?.postMessage({
                    kind: 'metadata_committed'
                });
            }
            catch (_) { /* Persisted state remains authoritative. */ }
        }
        /** work may await IDB requests from this transaction ONLY, never external work. */
        atomic(names, mode, work) {
            if (!this.db)
                return Promise.reject(new Error('ManagerMetaDB is not initialized'));
            names = [...new Set(names)];
            if (!names.length || names.some(n => !SCHEMA[n]))
                return Promise.reject(new Error('Unknown metadata store'));
            if (!['readonly', 'readwrite'].includes(mode))
                return Promise.reject(new Error('Invalid transaction mode'));
            return new Promise((resolve, reject) => {
                const tx = this.db.transaction(names, mode);
                let value, ready = false, reason;
                const request = req => new Promise((res, rej) => {
                    req.onsuccess = e => res(e.target.result);
                    req.onerror = e => rej(req.error || e.target.error || new Error('Metadata request failed'));
                });
                const store = name => {
                    if (!names.includes(name))
                        throw new Error('Store is outside transaction');
                    return tx.objectStore(name);
                };
                const io = {
                    get: (n, k) => request(store(n).get(k)),
                    all: (n, index, key) => request(index ? store(n).index(index).getAll(key) : store(n).getAll()),
                    put: (n, v) => request(store(n).put(v)),
                    add: (n, v) => request(store(n).add(v)),
                    delete: (n, k) => request(store(n).delete(k)),
                    clear: n => request(store(n).clear())
                };
                tx.oncomplete = () => {
                    if (!ready) {
                        reject(new Error('Metadata callback outlived its transaction'));
                        return;
                    }
                    if (mode === 'readwrite')
                        this._committed();
                    resolve(value);
                };
                tx.onabort = () => reject(reason || tx.error || new Error('Metadata transaction aborted'));
                tx.onerror = () => { };
                try {
                    Promise.resolve(work(io)).then(result => {
                        value = result;
                        ready = true;
                    }, error => {
                        reason = error;
                        try {
                            tx.abort();
                        }
                        catch (_) {
                            reject(error);
                        }
                    });
                }
                catch (error) {
                    reason = error;
                    try {
                        tx.abort();
                    }
                    catch (_) {
                        reject(error);
                    }
                }
            });
        }
        get(name, key) {
            return this.atomic([name], 'readonly', io => io.get(name, key));
        }
        getAll(name, index, key) {
            return this.atomic([name], 'readonly', io => io.all(name, index, key));
        }
        put(name, value) {
            return this.atomic([name], 'readwrite', io => io.put(name, value));
        }
        delete(name, key) {
            return this.atomic([name], 'readwrite', io => io.delete(name, key));
        }
        clear(name) {
            return this.atomic([name], 'readwrite', io => io.clear(name));
        }
    }
    const managerMetaDB = new ManagerMetaDB();
    return { DB_VERSION, SCHEMA, STORE_NAMES, ManagerMetaDB, managerMetaDB };
});
