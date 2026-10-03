'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const { prepareDeleteSelection } = require('../delete-preparation.js');

class MemoryStore {
  constructor(records) {
    this.records = new Map(records.map(record => [record.id, structuredClone(record)]));
    this.saved = [];
  }

  async getConversation(id) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async saveConversation(record) {
    this.saved.push(record.id);
    this.records.set(record.id, structuredClone(record));
  }
}

function record(id, classification, {
  evidence = 'history-sync',
  sources = ['history'],
  gizmoId = classification === CLASSIFICATIONS.STANDALONE
    ? null
    : classification === CLASSIFICATIONS.PROJECT
      ? `g-p-${id}`
      : classification === CLASSIFICATIONS.CUSTOM_GPT
        ? `g-${id}`
        : undefined
} = {}) {
  const value = {
    id,
    title: `Synthetic ${id}`,
    classification,
    classification_evidence: evidence,
    discovery_sources: sources
  };
  if (gizmoId !== undefined) value.gizmo_id = gizmoId;
  return value;
}

function unknown(id) {
  return record(id, CLASSIFICATIONS.UNKNOWN, {
    evidence: 'search-only',
    sources: ['search']
  });
}

function report(gizmoState, projectEvidence = 'unknown') {
  return {
    endpoint_kind: 'conversation-detail',
    http_status: 200,
    request_outcome: 'success',
    gizmo_state: gizmoState,
    project_membership_evidence: projectEvidence,
    schema_warnings: [],
    retry_after_ms: null
  };
}

test('cached canonical evidence partitions without a verification request', async () => {
  const records = [
    record('standalone', CLASSIFICATIONS.STANDALONE),
    record('project', CLASSIFICATIONS.PROJECT),
    record('custom', CLASSIFICATIONS.CUSTOM_GPT)
  ];
  const store = new MemoryStore(records);
  let requests = 0;

  const result = await prepareDeleteSelection({
    ids: records.map(item => item.id),
    store,
    verifyOne: async () => { requests += 1; throw new Error('must not run'); }
  });

  assert.equal(requests, 0);
  assert.equal(result.state, 'complete');
  assert.equal(result.already_verified, 3);
  assert.deepEqual(result.standalone_ids, ['standalone']);
  assert.deepEqual(result.project_ids, ['project']);
  assert.deepEqual(result.custom_gpt_ids, ['custom']);
  assert.deepEqual(result.unresolved_ids, []);
});

test('selected verification candidates run sequentially and partition reloaded truth', async () => {
  const store = new MemoryStore([unknown('one'), unknown('two'), unknown('three')]);
  const active = new Set();
  let maximumActive = 0;
  const waits = [];
  const requested = [];
  const outcomes = {
    one: report('null'),
    two: report('project-like', 'yes'),
    three: report('custom-gpt-like', 'no')
  };

  const result = await prepareDeleteSelection({
    ids: ['one', 'two', 'three'],
    store,
    delayMs: 25,
    wait: async milliseconds => waits.push(milliseconds),
    verifyOne: async item => {
      requested.push(item.id);
      active.add(item.id);
      maximumActive = Math.max(maximumActive, active.size);
      await Promise.resolve();
      active.delete(item.id);
      return outcomes[item.id];
    }
  });

  assert.deepEqual(requested, ['one', 'two', 'three']);
  assert.equal(maximumActive, 1);
  assert.deepEqual(waits, [25, 25]);
  assert.deepEqual(store.saved, ['one', 'two', 'three']);
  assert.deepEqual(result.standalone_ids, ['one']);
  assert.deepEqual(result.project_ids, ['two']);
  assert.deepEqual(result.custom_gpt_ids, ['three']);
  assert.deepEqual(result.unresolved_ids, []);
});

test('429 retains completed classifications, Retry-After, and unresolved remainder', async () => {
  const store = new MemoryStore([unknown('verified'), unknown('limited'), unknown('later')]);
  const requested = [];

  const result = await prepareDeleteSelection({
    ids: ['verified', 'limited', 'later'],
    store,
    delayMs: 0,
    wait: async () => {},
    verifyOne: async item => {
      requested.push(item.id);
      if (item.id === 'verified') return report('null');
      return {
        ...report('unknown'),
        http_status: 429,
        request_outcome: 'rate_limited',
        retry_after_ms: 90000
      };
    }
  });

  assert.deepEqual(requested, ['verified', 'limited']);
  assert.equal(result.state, 'rate-limited');
  assert.equal(result.stop_reason, 'http_429');
  assert.equal(result.retry_after_ms, 90000);
  assert.deepEqual(result.standalone_ids, ['verified']);
  assert.deepEqual(result.unresolved_ids, ['limited', 'later']);
});

test('cancelling preparation leaves returned evidence unresolved and creates no authority', async () => {
  const store = new MemoryStore([unknown('cancelled'), unknown('later')]);
  const controller = new AbortController();

  const result = await prepareDeleteSelection({
    ids: ['cancelled', 'later'],
    store,
    signal: controller.signal,
    verifyOne: async () => {
      controller.abort();
      return report('null');
    }
  });

  assert.equal(result.state, 'cancelled');
  assert.equal(result.stop_reason, 'cancelled');
  assert.deepEqual(store.saved, []);
  assert.deepEqual(result.unresolved_ids, ['cancelled', 'later']);
  assert.equal(Object.hasOwn(result, 'job'), false);
});

test('persisted preparation evidence is reused by the next plan', async () => {
  const store = new MemoryStore([unknown('cached')]);
  let requests = 0;
  const options = {
    ids: ['cached'],
    store,
    delayMs: 0,
    wait: async () => {},
    verifyOne: async () => {
      requests += 1;
      return report('null');
    }
  };

  const first = await prepareDeleteSelection(options);
  const second = await prepareDeleteSelection(options);

  assert.equal(requests, 1);
  assert.deepEqual(first.standalone_ids, ['cached']);
  assert.deepEqual(second.standalone_ids, ['cached']);
  assert.equal(second.already_verified, 1);
  assert.equal(second.verification_candidates, 0);
});
