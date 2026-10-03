'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

class FakeClassList {
  constructor(value = '') {
    this.values = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  add(...names) {
    for (const name of names) this.values.add(name);
  }

  remove(...names) {
    for (const name of names) this.values.delete(name);
  }

  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }

  contains(name) {
    return this.values.has(name);
  }

  toString() {
    return [...this.values].join(' ');
  }
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.style = {};
    this.id = '';
    this.value = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.indeterminate = false;
    this.title = '';
    this._textContent = '';
    this._innerHTML = '';
    this.focused = false;
  }

  setAttribute(name, value) {
    const normalized = String(name).toLowerCase();
    const text = String(value);
    this.attributes.set(normalized, text);
    if (normalized === 'id') {
      this.id = text;
      this.ownerDocument?._registerId(this);
    } else if (normalized === 'class') {
      this.classList = new FakeClassList(text);
    } else if (normalized === 'value') {
      this.value = text;
    } else if (normalized === 'hidden') {
      this.hidden = true;
    } else if (normalized === 'disabled') {
      this.disabled = true;
    } else if (normalized === 'checked') {
      this.checked = true;
    } else if (normalized === 'title') {
      this.title = text;
    } else if (normalized.startsWith('data-')) {
      const key = normalized.slice(5).replace(/-([a-z])/g, (_, letter) =>
        letter.toUpperCase()
      );
      this.dataset[key] = text;
    }
  }

  getAttribute(name) {
    return this.attributes.get(String(name).toLowerCase()) ?? null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(type, listeners.filter(candidate => candidate !== listener));
  }

  async dispatch(type, fields = {}) {
    const event = {
      type,
      target: this,
      currentTarget: this,
      preventDefault() {},
      ...fields
    };
    const results = (this.listeners.get(type) || []).map(listener => listener(event));
    await Promise.all(results.filter(result => result?.then));
  }

  click() {
    return this.dispatch('click');
  }

  appendChild(child) {
    if (child?.isFragment) {
      for (const grandchild of [...child.children]) this.appendChild(grandchild);
      child.children.length = 0;
      return child;
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    return this.ownerDocument._query(selector, this.children);
  }

  set textContent(value) {
    this._textContent = String(value ?? '');
    if (this._textContent === '') this.children.length = 0;
  }

  get textContent() {
    if (this._textContent) return this._textContent;
    return this.children.map(child => child.textContent).join('');
  }

  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    this.children.length = 0;
    for (const child of this.ownerDocument._parseFragment(this._innerHTML)) {
      this.appendChild(child);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  setCustomValidity(message) {
    this.validationMessage = String(message);
  }

  reportValidity() {
    return !this.validationMessage;
  }

  focus() {
    this.focused = true;
  }
}

class FakeFragment {
  constructor() {
    this.isFragment = true;
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

function parseAttributes(source) {
  const attributes = [];
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes.push([match[1], match[2] ?? match[3] ?? match[4] ?? '']);
  }
  return attributes;
}

function matchesSelector(element, selector) {
  if (selector.startsWith('.')) return element.classList.contains(selector.slice(1));
  if (selector.startsWith('[') && selector.endsWith(']')) {
    return element.attributes.has(selector.slice(1, -1));
  }
  const [tagName, className] = selector.split('.');
  return element.tagName === tagName.toUpperCase() &&
    (!className || element.classList.contains(className));
}

class FakeDocument {
  constructor(html) {
    this.ids = new Map();
    this.root = new FakeElement('document-root', this);
    this._parseInto(html, this.root);
    this._initializeSelectValues();
  }

  _registerId(element) {
    if (element.id) this.ids.set(element.id, element);
  }

  _parseInto(html, root) {
    const stack = [root];
    const tokens = String(html).match(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g) || [];
    for (const token of tokens) {
      if (token.startsWith('<!--') || token.startsWith('<!')) continue;
      if (token.startsWith('</')) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (token.startsWith('<')) {
        const match = token.match(/^<\s*([\w-]+)([\s\S]*?)\/?\s*>$/);
        if (!match) continue;
        const element = new FakeElement(match[1], this);
        for (const [name, value] of parseAttributes(match[2])) {
          element.setAttribute(name, value);
        }
        stack.at(-1).appendChild(element);
        const selfClosing = /\/\s*>$/.test(token) ||
          VOID_ELEMENTS.has(match[1].toLowerCase());
        if (!selfClosing) stack.push(element);
        continue;
      }
      const text = token.replace(/\s+/g, ' ').trim();
      if (text) stack.at(-1)._textContent += text;
    }
  }

  _parseFragment(html) {
    const root = new FakeElement('fragment-root', this);
    this._parseInto(html, root);
    return root.children;
  }

  _initializeSelectValues() {
    for (const select of this.querySelectorAll('select')) {
      const options = select.children.filter(child => child.tagName === 'OPTION');
      const selected = options.find(option => option.attributes.has('selected')) || options[0];
      if (selected) select.value = selected.value;
    }
  }

  _walk(nodes, output = []) {
    for (const node of nodes) {
      output.push(node);
      this._walk(node.children, output);
    }
    return output;
  }

  _query(selector, roots = this.root.children) {
    return this._walk(roots, []).filter(element => matchesSelector(element, selector));
  }

  getElementById(id) {
    return this.ids.get(id) || null;
  }

  querySelectorAll(selector) {
    return this._query(selector);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  createDocumentFragment() {
    return new FakeFragment();
  }
}

function requestWith(result, transaction = null) {
  const request = {};
  transaction?._requestStarted();
  queueMicrotask(() => {
    try {
      request.onsuccess?.({ target: { result } });
    } finally {
      transaction?._requestFinished();
    }
  });
  return request;
}

class FakeTransaction {
  constructor(database, storeNames) {
    this.database = database;
    this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames];
    this.pending = 0;
    this.completed = false;
    this.oncomplete = null;
    this.onerror = null;
    this.onabort = null;
    queueMicrotask(() => this._maybeComplete());
  }

  abort() {
    if (this.completed) throw new Error('TransactionInactiveError');
    this.completed = true;
    this.error = new Error('AbortError');
    queueMicrotask(() => this.onabort?.({ target: this }));
  }

  objectStore(name) {
    if (!this.storeNames.includes(name)) throw new Error(`Store not in transaction: ${name}`);
    const store = this.database.stores.get(name);
    if (!store) throw new Error(`Unknown object store: ${name}`);
    return new FakeObjectStoreHandle(store, this);
  }

  _requestStarted() {
    this.pending += 1;
  }

  _requestFinished() {
    this.pending = Math.max(0, this.pending - 1);
    this._maybeComplete();
  }

  _maybeComplete() {
    if (this.completed || this.pending !== 0) return;
    setTimeout(() => {
      if (this.completed || this.pending !== 0) return;
      this.completed = true;
      this.oncomplete?.({ target: this });
    }, 0);
  }
}

class FakeObjectStoreData {
  constructor(name, { keyPath = 'id' } = {}) {
    this.name = name;
    this.keyPath = keyPath;
    this.records = new Map();
    this.indexes = new Map();
    this.clearCalls = 0;
  }
}

class FakeIndexHandle {
  constructor(storeData, keyPath, transaction) {
    this.storeData = storeData;
    this.keyPath = keyPath;
    this.transaction = transaction;
  }

  getAll(key) {
    return requestWith([...this.storeData.records.values()].filter(value =>
      key === undefined || value[this.keyPath] === key).map(value => structuredClone(value)), this.transaction);
  }

  openCursor(range = null) {
    const request = {};
    const entries = [...this.storeData.records.values()]
      .filter(value => {
        if (!range || range.type !== 'only') return true;
        return value?.[this.keyPath] === range.value;
      })
      .map(value => structuredClone(value));
    let index = 0;
    const tx = this.transaction;
    tx?._requestStarted();

    const emit = () => {
      queueMicrotask(() => {
        if (index >= entries.length) {
          try {
            request.onsuccess?.({ target: { result: null } });
          } finally {
            tx?._requestFinished();
          }
          return;
        }
        const value = entries[index];
        const key = value?.[this.storeData.keyPath];
        let continued = false;
        const cursor = {
          value: structuredClone(value),
          delete: () => {
            this.storeData.records.delete(key);
            return requestWith(undefined, tx);
          },
          continue: () => {
            if (continued) return;
            continued = true;
            index += 1;
            emit();
          }
        };
        request.onsuccess?.({ target: { result: cursor } });
      });
    };
    emit();
    return request;
  }
}

class FakeObjectStoreHandle {
  constructor(storeData, transaction = null) {
    this.storeData = storeData;
    this.transaction = transaction;
  }

  get indexNames() { return { contains: name => this.storeData.indexes.has(name) }; }

  add(value) {
    const key = value[this.storeData.keyPath];
    if (this.storeData.records.has(key)) throw new Error('ConstraintError');
    return this.put(value);
  }

  createIndex(name, keyPath, options = {}) {
    this.storeData.indexes.set(name, { keyPath, unique: Boolean(options.unique) });
    return this.index(name);
  }

  index(name) {
    const definition = this.storeData.indexes.get(name);
    if (!definition) throw new Error(`Unknown index: ${name}`);
    return new FakeIndexHandle(this.storeData, definition.keyPath, this.transaction);
  }

  put(value) {
    const copy = structuredClone(value);
    const key = copy?.[this.storeData.keyPath];
    if (key === undefined || key === null) throw new Error(`Missing keyPath ${this.storeData.keyPath}`);
    for (const definition of this.storeData.indexes.values()) {
      if (definition.unique && copy[definition.keyPath] !== undefined &&
        [...this.storeData.records].some(([other, row]) => other !== key && row[definition.keyPath] === copy[definition.keyPath])) {
        throw new Error('ConstraintError');
      }
    }
    this.storeData.records.set(key, copy);
    return requestWith(key, this.transaction);
  }

  get(key) {
    const value = this.storeData.records.get(key);
    return requestWith(value === undefined ? undefined : structuredClone(value), this.transaction);
  }

  getAll() {
    return requestWith(
      [...this.storeData.records.values()].map(record => structuredClone(record)),
      this.transaction
    );
  }

  delete(key) {
    this.storeData.records.delete(key);
    return requestWith(undefined, this.transaction);
  }

  clear() {
    this.storeData.clearCalls += 1;
    this.storeData.records.clear();
    return requestWith(undefined, this.transaction);
  }
}

class FakeDatabase {
  constructor(name) {
    this.name = name;
    this.stores = new Map();
    this.objectStoreNames = {
      contains: storeName => this.stores.has(storeName)
    };
  }

  createObjectStore(name, options = {}) {
    if (this.stores.has(name)) throw new Error(`Object store already exists: ${name}`);
    const data = new FakeObjectStoreData(name, options);
    this.stores.set(name, data);
    return new FakeObjectStoreHandle(data, null);
  }

  close() {}

  transaction(storeNames) {
    return new FakeTransaction(this, storeNames);
  }

  get records() {
    return this.stores.get('conversations')?.records || new Map();
  }

  get clearCalls() {
    return this.stores.get('conversations')?.clearCalls || 0;
  }
}

class FakeIndexedDB {
  constructor(records = [], { failOpen = false } = {}) {
    this.seedRecords = records.map(record => structuredClone(record));
    this.failOpen = failOpen;
    this.databases = new Map();
  }

  open(name = 'default') {
    const request = {};
    queueMicrotask(() => {
      if (typeof this.failOpen === 'function' ? this.failOpen(name) : this.failOpen) {
        request.onerror?.({ target: { error: new Error('Synthetic IndexedDB failure') } });
        return;
      }

      let database = this.databases.get(name);
      const isNew = !database;
      if (!database) {
        database = new FakeDatabase(name);
        this.databases.set(name, database);
      }

      if (isNew) {
        request.onupgradeneeded?.({ target: { result: database } });
        if (name === 'ChatGPT_BulkManager_DB' && database.stores.has('conversations')) {
          const store = database.stores.get('conversations');
          for (const record of this.seedRecords) {
            store.records.set(record.id, structuredClone(record));
          }
        }
      }
      request.onsuccess?.({ target: { result: database } });
    });
    return request;
  }

  getDatabase(name) {
    return this.databases.get(name) || null;
  }
}

function conversationRecord(id, classification = 'standalone-safe') {
  return {
    id,
    title: `Synthetic ${id}`,
    update_time: 1789486324.5,
    create_time: 1789486200,
    classification,
    classification_evidence:
      classification === 'unknown-protected' ? 'search-only' : 'history-sync',
    gizmo_id: classification === 'standalone-safe'
      ? null
      : classification === 'project-protected'
        ? `g-p-${id}`
        : classification === 'custom-gpt-protected'
          ? `g-${id}`
          : undefined,
    discovery_sources: classification === 'unknown-protected'
      ? ['search']
      : ['history']
  };
}

function cloneAcrossRealms(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

async function createDashboardHarness({
  records = [],
  initialJobFactory = null,
  failDatabaseOpen = false,
  failMetadataOpen = false,
  sessionAvailable = true,
  eligibilityResponses = {},
  eligibilityResponder = null,
  historyResponder = null,
  confirmImpl = () => false,
  clockNow = 1789487000000
} = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'dashboard.html'), 'utf8');
  const document = new FakeDocument(html);
  const storageListeners = [];
  const storageValues = { delete_interval_seconds: 600 };
  const runtimeMessages = [];
  const fetchCalls = [];
  const consoleCalls = { info: [], warn: [], error: [] };
  const intervalCallbacks = new Map();
  let nextIntervalId = 1;
  let currentTime = clockNow;
  let currentJob = null;
  let context;

  const chrome = {
    runtime: {
      async sendMessage(message) {
        runtimeMessages.push(cloneAcrossRealms(message));
        const now = 1789487000000 + runtimeMessages.length;
        if (message.type === 'delete_job:get') {
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:start_plan') {
          const inventory = [...context.chatDB.db.records.values()];
          currentJob = context.DeleteJob.buildDeletePlan({
            ids: [...message.ids],
            records: inventory,
            intervalSeconds: message.interval_seconds,
            now,
            jobId: `synthetic-job-${runtimeMessages.length}`
          });
          const projects = currentJob.items
            .filter(item => item.approved_classification === 'project-protected')
            .map(item => item.conversation_id);
          if (projects.length > 0) {
            if (JSON.stringify(projects) !== JSON.stringify(message.approved_project_ids)) {
              return { ok: false, error_code: 'project_approval_required' };
            }
            currentJob = context.DeleteJob.approveProjectSubset(currentJob, { now });
          }
          if (currentJob.state !== context.DeleteJob.JOB_STATES.READY) {
            currentJob = null;
            return { ok: false, error_code: 'plan_not_ready' };
          }
          currentJob = context.DeleteJob.startDeleteJob(currentJob, { now });
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:create_plan') {
          const inventory = [...context.chatDB.db.records.values()];
          currentJob = context.DeleteJob.buildDeletePlan({
            ids: [...message.ids],
            records: inventory,
            intervalSeconds: message.interval_seconds,
            now,
            jobId: `synthetic-job-${runtimeMessages.length}`
          });
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:approve_projects') {
          currentJob = context.DeleteJob.approveProjectSubset(currentJob, { now });
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:remove_blocked') {
          currentJob = context.DeleteJob.removeBlockedItems(currentJob, { now });
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:start') {
          currentJob = context.DeleteJob.startDeleteJob(currentJob, { now });
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:pause') {
          currentJob = context.DeleteJob.requestPause(currentJob, { now });
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:resume') {
          const inventory = [...context.chatDB.db.records.values()];
          currentJob = context.DeleteJob.reviewAndResume(currentJob, {
            records: inventory,
            now
          });
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:cancel') {
          currentJob = context.DeleteJob.requestCancel(currentJob, { now });
          return { ok: true, job: currentJob };
        }
        if (message.type === 'delete_job:dismiss_terminal') {
          if (currentJob && !context.DeleteJob.TERMINAL_STATES.has(currentJob.state)) {
            return { ok: false, error_code: 'job_not_terminal' };
          }
          currentJob = null;
          return { ok: true, job: null };
        }
        return { ok: false, error_code: 'unknown_command' };
      },
      getURL(resource) {
        return `chrome-extension://synthetic-extension/${resource}`;
      }
    },
    storage: {
      local: {
        async get(key) {
          return { [key]: storageValues[key] };
        },
        async set(values) {
          Object.assign(storageValues, cloneAcrossRealms(values));
        },
        async remove(key) {
          delete storageValues[key];
        }
      },
      onChanged: {
        addListener(listener) {
          storageListeners.push(listener);
        },
        removeListener(listener) {
          const index = storageListeners.indexOf(listener);
          if (index >= 0) storageListeners.splice(index, 1);
        }
      }
    }
  };

  const sandbox = {
    AbortController,
    URL,
    URLSearchParams,
    chrome,
    confirm: (...args) => confirmImpl(...args),
    console: {
      info: (...args) => consoleCalls.info.push(args),
      warn: (...args) => consoleCalls.warn.push(args),
      error: (...args) => consoleCalls.error.push(args)
    },
    crypto: globalThis.crypto,
    document,
    fetch: async (...args) => {
      fetchCalls.push(args);
      const url = String(args[0]);
      if (url.endsWith('/api/auth/session')) {
        return sessionAvailable
          ? { ok: true, status: 200, async json() { return { accessToken: 'synthetic-session' }; } }
          : { ok: false, status: 401, async json() { return {}; } };
      }
      if (url.includes('/backend-api/conversations?')) {
        if (typeof historyResponder !== 'function') {
          throw new Error('Unexpected synthetic History request');
        }
        const configured = await historyResponder(new URL(url), args[1] || {});
        const normalizedHeaders = Object.fromEntries(
          Object.entries(configured.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
        );
        return {
          ok: configured.status >= 200 && configured.status < 300,
          status: configured.status,
          headers: { get(name) { return normalizedHeaders[name.toLowerCase()] ?? null; } },
          async json() { return cloneAcrossRealms(configured.body); }
        };
      }
      if (url.includes('/backend-api/conversation/')) {
        const id = decodeURIComponent(url.split('/').at(-1));
        const configured = typeof eligibilityResponder === 'function'
          ? await eligibilityResponder(id, args[1] || {})
          : eligibilityResponses[id] || { status: 200, body: {} };
        const normalizedHeaders = Object.fromEntries(
          Object.entries(configured.headers || {}).map(([key, value]) => [key.toLowerCase(), value])
        );
        return {
          ok: configured.status >= 200 && configured.status < 300,
          status: configured.status,
          headers: { get(name) { return normalizedHeaders[name.toLowerCase()] ?? null; } },
          async json() { return cloneAcrossRealms(configured.body); }
        };
      }
      throw new Error('Unexpected synthetic fetch URL');
    },
    indexedDB: new FakeIndexedDB(records, { failOpen: name => failDatabaseOpen || (failMetadataOpen && name === 'ConversationManager_Meta_DB') }),
    IDBKeyRange: { only(value) { return { type: 'only', value }; } },
    navigator: { clipboard: { async writeText() {} } },
    queueMicrotask,
    setTimeout,
    clearTimeout,
    setInterval(callback) {
      const id = nextIntervalId++;
      intervalCallbacks.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervalCallbacks.delete(id);
    }
  };
  sandbox.globalThis = sandbox;
  context = vm.createContext(sandbox);
  vm.runInContext(
    'globalThis.structuredClone = value => JSON.parse(JSON.stringify(value));' +
      'globalThis.Date = class extends Date {' +
      'static now() { return globalThis.__syntheticNow; }' +
      '};',
    context
  );
  context.__syntheticNow = currentTime;

  const scripts = Array.from(
    html.matchAll(/<script\s+src=["']([^"']+)["']/g),
    match => match[1]
  );
  for (const script of scripts) {
    if (script === 'dashboard.js' && initialJobFactory) {
      currentJob = initialJobFactory(context, records);
    }
    const source = fs.readFileSync(path.join(ROOT, script), 'utf8');
    vm.runInContext(source, context, { filename: script });
  }

  return {
    chrome,
    consoleCalls,
    context,
    document,
    fetchCalls,
    get currentJob() { return currentJob; },
    get activeIntervalCount() { return intervalCallbacks.size; },
    get inventoryClearCalls() { return context.chatDB.db.clearCalls; },
    get indexedDBState() { return sandbox.indexedDB; },
    get managerMetaDatabase() { return sandbox.indexedDB.getDatabase('ConversationManager_Meta_DB'); },
    runtimeMessages,
    scripts,
    storageValues,
    storageListeners,
    setNow(value) {
      currentTime = value;
      context.__syntheticNow = currentTime;
    },
    runIntervals() {
      for (const callback of [...intervalCallbacks.values()]) callback();
    },
    async awaitInitialization() {
      const promise = context.__CHATGPT_MANAGER_DASHBOARD_INITIALIZATION__;
      if (!promise || typeof promise.then !== 'function') {
        throw new Error('Dashboard initialization promise is not exposed');
      }
      return promise;
    },
    async emitStorageJob(job) {
      currentJob = job;
      for (const listener of storageListeners) {
        listener({
          [context.JobStore.JOB_STORAGE_KEY]: { newValue: job }
        }, 'local');
      }
      await Promise.resolve();
    },
    async selectAllRows() {
      for (const checkbox of document.querySelectorAll('.row-checkbox')) {
        checkbox.checked = true;
        await checkbox.dispatch('change');
      }
    }
  };
}

module.exports = {
  FakeDocument,
  conversationRecord,
  createDashboardHarness
};
