'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CLASSIFICATIONS,
  isBulkDeletable
} = require('../conversation-policy.js');
const {
  DEFAULT_VERIFICATION_DELAY_MS,
  LIVE_STANDALONE_PROMOTION_ENABLED,
  classifyEligibilityEvidence,
  evidenceFromBody,
  runEligibilityDiagnostic,
  runEligibilityVerificationQueue
} = require('../eligibility-core.js');

class MemoryConversationStore {
  constructor(records) {
    this.records = new Map(records.map(record => [record.id, structuredClone(record)]));
    this.savedIds = [];
  }

  async getConversation(id) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async saveConversation(record) {
    this.savedIds.push(record.id);
    this.records.set(record.id, structuredClone(record));
  }
}

function unknownSearchRecord(id) {
  return {
    id,
    title: `Synthetic ${id}`,
    classification: CLASSIFICATIONS.UNKNOWN,
    classification_evidence: 'search-only',
    discovery_sources: ['search']
  };
}

function evidence(gizmoState, overrides = {}) {
  return {
    malformed: false,
    gizmo_state: gizmoState,
    project_membership_evidence: 'unknown',
    schema_warnings: [],
    ...overrides
  };
}

function fakeResponse(status, body, headers = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return normalizedHeaders[name.toLowerCase()] ?? null;
      }
    },
    async json() {
      return structuredClone(body);
    }
  };
}

test('live-validated own-null evidence promotes by default', () => {
  assert.equal(LIVE_STANDALONE_PROMOTION_ENABLED, true);
  assert.equal(
    classifyEligibilityEvidence(evidence('null')),
    CLASSIFICATIONS.STANDALONE
  );
});

test('detail evidence requires an own exact-null gizmo_id for standalone promotion', () => {
  const inheritedNull = Object.create({ gizmo_id: null });
  const cases = [
    ['missing', {}, 'absent'],
    ['inherited', inheritedNull, 'absent'],
    ['empty string', { gizmo_id: '' }, 'unknown'],
    ['wrong type', { gizmo_id: 0 }, 'unknown']
  ];

  const exactNull = evidenceFromBody({ gizmo_id: null });
  assert.equal(exactNull.gizmo_state, 'null');
  assert.equal(classifyEligibilityEvidence(exactNull), CLASSIFICATIONS.STANDALONE);

  for (const [name, body, expectedState] of cases) {
    const parsed = evidenceFromBody(body);
    assert.equal(parsed.gizmo_state, expectedState, name);
    assert.equal(
      classifyEligibilityEvidence(parsed),
      CLASSIFICATIONS.UNKNOWN,
      name
    );
  }
});

test('explicit Project and Custom-GPT evidence classify as protected', () => {
  assert.equal(
    classifyEligibilityEvidence(evidence('project-like', {
      project_membership_evidence: 'yes'
    })),
    CLASSIFICATIONS.PROJECT
  );
  assert.equal(
    classifyEligibilityEvidence(evidence('custom-gpt-like', {
      project_membership_evidence: 'no'
    })),
    CLASSIFICATIONS.CUSTOM_GPT
  );
});

test('missing fields, malformed evidence, and conflicts remain unknown-protected', () => {
  for (const item of [
    evidence('absent'),
    evidence('unknown'),
    evidence('absent', { project_membership_evidence: 'yes' }),
    evidence('unknown', { project_membership_evidence: 'yes' }),
    evidence('null', { malformed: true }),
    evidence('custom-gpt-like', { project_membership_evidence: 'yes' }),
    evidence('project-like', { project_membership_evidence: 'no' })
  ]) {
    assert.equal(
      classifyEligibilityEvidence(item, { allowStandalonePromotion: true }),
      CLASSIFICATIONS.UNKNOWN
    );
  }
});

test('network and non-2xx outcome metadata cannot promote standalone evidence', () => {
  for (const item of [
    evidence('null', { request_outcome: 'network_error' }),
    evidence('null', { request_outcome: 'http_error', http_status: 500 }),
    evidence('null', { request_outcome: 'rate_limited', http_status: 429 })
  ]) {
    assert.equal(
      classifyEligibilityEvidence(item, { allowStandalonePromotion: true }),
      CLASSIFICATIONS.UNKNOWN
    );
  }
});

test('conflicting positive Project and exact-null evidence remains unknown', () => {
  assert.equal(
    classifyEligibilityEvidence(evidence('null', {
      project_membership_evidence: 'yes'
    }), { allowStandalonePromotion: true }),
    CLASSIFICATIONS.UNKNOWN
  );
});

test('eligibility diagnostic performs one GET and returns sanitized evidence without an id or body', async () => {
  const requests = [];
  const report = await runEligibilityDiagnostic({
    conversationId: 'private-conversation-id',
    authToken: 'private-auth-token',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return fakeResponse(200, {
        gizmo_id: 'g-p-synthetic',
        title: 'private title',
        mapping: { private: 'message content' }
      });
    }
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'GET');
  assert.match(requests[0].url, /private-conversation-id$/);
  assert.equal(report.http_status, 200);
  assert.equal(report.endpoint_kind, 'conversation-detail');
  assert.deepEqual(report.evidence_fields_present, ['gizmo_id']);
  assert.equal(report.gizmo_state, 'project-like');
  assert.equal(report.project_membership_evidence, 'yes');
  assert.equal(report.classification_result, CLASSIFICATIONS.PROJECT);
  const copied = JSON.stringify(report);
  assert.doesNotMatch(copied, /private-conversation-id/);
  assert.doesNotMatch(copied, /private-auth-token/);
  assert.doesNotMatch(copied, /private title|message content|mapping/);
});

test('explicit own null is reported and promotes standalone by default', async () => {
  const report = await runEligibilityDiagnostic({
    conversationId: 'synthetic-id',
    authToken: 'synthetic-token',
    fetchImpl: async () => fakeResponse(200, { gizmo_id: null })
  });

  assert.equal(report.gizmo_state, 'null');
  assert.equal(report.classification_result, CLASSIFICATIONS.STANDALONE);
  assert.deepEqual(report.schema_warnings, []);
});

test('default verification persists live-validated standalone eligibility and makes it selectable', async () => {
  const record = unknownSearchRecord('live-validated-standalone');
  const store = new MemoryConversationStore([record]);
  const result = await runEligibilityVerificationQueue({
    ids: [record.id],
    store,
    delayMs: 0,
    wait: async () => {},
    verifyOne: async item => runEligibilityDiagnostic({
      conversationId: item.id,
      authToken: 'synthetic-token',
      fetchImpl: async () => fakeResponse(200, { gizmo_id: null })
    })
  });

  const stored = store.records.get(record.id);
  assert.equal(result.verified_standalone, 1);
  assert.equal(stored.classification, CLASSIFICATIONS.STANDALONE);
  assert.equal(stored.classification_evidence, 'eligibility-detail-v1');
  assert.equal(isBulkDeletable(stored), true);
});

test('missing, malformed, network, non-2xx, and 429 diagnostic outcomes remain unknown', async t => {
  const cases = [
    ['missing', async () => fakeResponse(200, { title: 'private' }), null],
    ['malformed', async () => fakeResponse(200, ['not-an-object']), null],
    ['network', async () => { throw new Error('private network details'); }, null],
    ['non-2xx', async () => fakeResponse(500, { private: 'body' }), null],
    ['rate-limit', async () => fakeResponse(429, { private: 'body' }, { 'Retry-After': '90' }), 90000]
  ];

  for (const [name, fetchImpl, retryAfterMs] of cases) {
    await t.test(name, async () => {
      const report = await runEligibilityDiagnostic({
        conversationId: 'private-id',
        authToken: 'private-token',
        fetchImpl,
        now: () => 0
      });
      assert.equal(report.classification_result, CLASSIFICATIONS.UNKNOWN);
      assert.equal(report.retry_after_ms, retryAfterMs);
      const copied = JSON.stringify(report);
      assert.doesNotMatch(copied, /private-id|private-token|private network details|body/);
    });
  }
});

test('verification runs sequentially, paces requests, persists positive results, and reports counters', async () => {
  const records = ['one', 'two', 'three'].map(unknownSearchRecord);
  const store = new MemoryConversationStore(records);
  const active = new Set();
  let maximumActive = 0;
  const waits = [];
  const progress = [];
  const outcomes = {
    one: evidence('null'),
    two: evidence('project-like', { project_membership_evidence: 'yes' }),
    three: evidence('custom-gpt-like', { project_membership_evidence: 'no' })
  };

  const result = await runEligibilityVerificationQueue({
    ids: records.map(record => record.id),
    store,
    delayMs: 2500,
    wait: async milliseconds => waits.push(milliseconds),
    allowStandalonePromotion: true,
    verifyOne: async record => {
      active.add(record.id);
      maximumActive = Math.max(maximumActive, active.size);
      await Promise.resolve();
      active.delete(record.id);
      return {
        ...outcomes[record.id],
        http_status: 200,
        endpoint_kind: 'conversation-detail',
        classification_result: classifyEligibilityEvidence(outcomes[record.id], {
          allowStandalonePromotion: true
        }),
        retry_after_ms: null
      };
    },
    onProgress: event => progress.push(event)
  });

  assert.equal(DEFAULT_VERIFICATION_DELAY_MS > 0, true);
  assert.equal(maximumActive, 1);
  assert.deepEqual(waits, [2500, 2500]);
  assert.equal(result.state, 'complete');
  assert.equal(result.queued, 3);
  assert.equal(result.verified_standalone, 1);
  assert.equal(result.protected_project, 1);
  assert.equal(result.protected_custom_gpt, 1);
  assert.equal(result.still_unknown, 0);
  assert.equal(store.records.get('one').classification, CLASSIFICATIONS.STANDALONE);
  assert.equal(store.records.get('two').classification, CLASSIFICATIONS.PROJECT);
  assert.equal(store.records.get('three').classification, CLASSIFICATIONS.CUSTOM_GPT);
  assert.equal(progress[0].state, 'running');
  assert.equal(progress.at(-1).processed, 3);
  assert.equal(progress.at(-1).state, 'complete');
});

test('partial failure remains unknown and later items can complete', async () => {
  const records = ['failed', 'success'].map(unknownSearchRecord);
  const store = new MemoryConversationStore(records);
  const result = await runEligibilityVerificationQueue({
    ids: records.map(record => record.id),
    store,
    delayMs: 0,
    wait: async () => {},
    allowStandalonePromotion: true,
    verifyOne: async record => {
      if (record.id === 'failed') throw new Error('Synthetic network failure');
      return {
        ...evidence('null'),
        http_status: 200,
        classification_result: CLASSIFICATIONS.STANDALONE,
        retry_after_ms: null
      };
    }
  });

  assert.equal(result.state, 'partial');
  assert.equal(result.failed, 1);
  assert.equal(result.still_unknown, 1);
  assert.equal(result.verified_standalone, 1);
  assert.equal(store.records.get('failed').classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(store.records.get('success').classification, CLASSIFICATIONS.STANDALONE);
});

test('a sanitized network-failure report is counted as failed and stays unknown', async () => {
  const record = unknownSearchRecord('network-report');
  const store = new MemoryConversationStore([record]);
  const result = await runEligibilityVerificationQueue({
    ids: [record.id],
    store,
    verifyOne: async () => ({
      ...evidence('unknown'),
      request_outcome: 'network_error',
      http_status: null,
      classification_result: CLASSIFICATIONS.UNKNOWN,
      retry_after_ms: null
    })
  });

  assert.equal(result.state, 'partial');
  assert.equal(result.failed, 1);
  assert.equal(result.still_unknown, 1);
  assert.equal(store.records.get(record.id).classification, CLASSIFICATIONS.UNKNOWN);
});

test('429 stops later verification and preserves pending records as unknown', async () => {
  const records = ['limited', 'later'].map(unknownSearchRecord);
  const store = new MemoryConversationStore(records);
  const called = [];
  const result = await runEligibilityVerificationQueue({
    ids: records.map(record => record.id),
    store,
    delayMs: 0,
    wait: async () => {},
    verifyOne: async record => {
      called.push(record.id);
      return {
        ...evidence('unknown'),
        http_status: 429,
        classification_result: CLASSIFICATIONS.UNKNOWN,
        retry_after_ms: 120000
      };
    }
  });

  assert.deepEqual(called, ['limited']);
  assert.equal(result.state, 'rate-limited');
  assert.equal(result.rate_limited, 1);
  assert.equal(result.retry_after_ms, 120000);
  assert.deepEqual(result.pending_ids, ['later']);
  assert.equal(store.records.get('limited').classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(store.records.get('later').classification, CLASSIFICATIONS.UNKNOWN);
});

test('session-unavailable exception stops verification immediately without walking the queue', async () => {
  const records = ['first', 'second', 'third'].map(unknownSearchRecord);
  const store = new MemoryConversationStore(records);
  const called = [];
  const waits = [];
  const result = await runEligibilityVerificationQueue({
    ids: records.map(record => record.id),
    store,
    delayMs: 2500,
    wait: async milliseconds => waits.push(milliseconds),
    verifyOne: async record => {
      called.push(record.id);
      const error = new Error('Session unavailable');
      error.code = 'session_unavailable';
      throw error;
    }
  });

  assert.deepEqual(called, ['first']);
  assert.deepEqual(waits, []);
  assert.equal(result.state, 'partial');
  assert.equal(result.stop_reason, 'session_unavailable');
  assert.equal(result.processed, 0);
  assert.deepEqual(result.pending_ids, ['first', 'second', 'third']);
});

test('HTTP 401 stops verification after the first attempted detail request', async () => {
  const records = ['expired', 'later'].map(unknownSearchRecord);
  const store = new MemoryConversationStore(records);
  const called = [];
  const result = await runEligibilityVerificationQueue({
    ids: records.map(record => record.id),
    store,
    delayMs: 0,
    wait: async () => {},
    verifyOne: async record => {
      called.push(record.id);
      return {
        ...evidence('unknown'),
        http_status: 401,
        request_outcome: 'http_error',
        classification_result: CLASSIFICATIONS.UNKNOWN,
        retry_after_ms: null
      };
    }
  });

  assert.deepEqual(called, ['expired']);
  assert.equal(result.state, 'partial');
  assert.equal(result.stop_reason, 'session_unavailable');
  assert.equal(result.processed, 1);
  assert.deepEqual(result.pending_ids, ['later']);
});

test('HTTP 403 remains a per-record failure and does not stop later verification', async () => {
  const records = ['forbidden', 'later'].map(unknownSearchRecord);
  const store = new MemoryConversationStore(records);
  const called = [];
  const result = await runEligibilityVerificationQueue({
    ids: records.map(record => record.id),
    store,
    delayMs: 0,
    wait: async () => {},
    verifyOne: async record => {
      called.push(record.id);
      return record.id === 'forbidden'
        ? {
            ...evidence('unknown'),
            http_status: 403,
            request_outcome: 'http_error',
            classification_result: CLASSIFICATIONS.UNKNOWN,
            retry_after_ms: null
          }
        : {
            ...evidence('null'),
            http_status: 200,
            classification_result: CLASSIFICATIONS.STANDALONE,
            retry_after_ms: null
          };
    }
  });

  assert.deepEqual(called, ['forbidden', 'later']);
  assert.equal(result.state, 'partial');
  assert.equal(result.stop_reason, null);
  assert.equal(result.failed, 1);
  assert.equal(result.verified_standalone, 1);
  assert.equal(store.records.get('forbidden').classification, CLASSIFICATIONS.UNKNOWN);
  assert.equal(store.records.get('later').classification, CLASSIFICATIONS.STANDALONE);
});

test('cancellation after completed evidence but before persistence cannot partially promote', async () => {
  const record = unknownSearchRecord('cancelled');
  const store = new MemoryConversationStore([record]);
  const controller = new AbortController();
  const result = await runEligibilityVerificationQueue({
    ids: [record.id],
    store,
    signal: controller.signal,
    allowStandalonePromotion: true,
    verifyOne: async () => {
      controller.abort();
      return {
        ...evidence('null'),
        http_status: 200,
        classification_result: CLASSIFICATIONS.STANDALONE,
        retry_after_ms: null
      };
    }
  });

  assert.equal(result.state, 'cancelled');
  assert.equal(store.records.get(record.id).classification, CLASSIFICATIONS.UNKNOWN);
  assert.deepEqual(store.savedIds, []);
});

test('re-verification is idempotent and only search-discovered unknown records are requested', async () => {
  const verified = {
    ...unknownSearchRecord('verified'),
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'eligibility-detail-v1'
  };
  const historyUnknown = {
    id: 'history-unknown',
    classification: CLASSIFICATIONS.UNKNOWN,
    classification_evidence: 'insufficient-history-metadata',
    discovery_sources: ['history']
  };
  const store = new MemoryConversationStore([verified, historyUnknown]);
  let requests = 0;
  const result = await runEligibilityVerificationQueue({
    ids: ['verified', 'history-unknown'],
    store,
    verifyOne: async () => {
      requests += 1;
      throw new Error('must not run');
    }
  });

  assert.equal(requests, 0);
  assert.equal(result.skipped, 2);
  assert.deepEqual(store.savedIds, []);
});

test('verification cannot downgrade an already protected record', async () => {
  const record = {
    ...unknownSearchRecord('protected'),
    raw_data: { id: 'protected', gizmo_id: 'g-p-synthetic' },
    classification: CLASSIFICATIONS.PROJECT,
    classification_evidence: 'history-sync',
    discovery_sources: ['history', 'search']
  };
  const store = new MemoryConversationStore([record]);
  let requests = 0;
  const result = await runEligibilityVerificationQueue({
    ids: [record.id],
    store,
    verifyOne: async () => {
      requests += 1;
      return { classification_result: CLASSIFICATIONS.STANDALONE };
    }
  });

  assert.equal(requests, 0);
  assert.equal(result.skipped, 1);
  assert.equal(store.records.get(record.id).classification, CLASSIFICATIONS.PROJECT);
});

test('verification batch is explicitly bounded', async () => {
  const records = Array.from({ length: 12 }, (_, index) => unknownSearchRecord(`id-${index}`));
  const store = new MemoryConversationStore(records);
  let requests = 0;
  const result = await runEligibilityVerificationQueue({
    ids: records.map(record => record.id),
    store,
    maxItems: 10,
    delayMs: 0,
    wait: async () => {},
    verifyOne: async () => {
      requests += 1;
      return {
        ...evidence('absent'),
        http_status: 200,
        classification_result: CLASSIFICATIONS.UNKNOWN,
        retry_after_ms: null
      };
    }
  });

  assert.equal(requests, 10);
  assert.equal(result.queued, 10);
  assert.deepEqual(result.not_queued_ids, ['id-10', 'id-11']);
});
