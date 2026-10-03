(function attachEligibilityCore(root, factory) {
  const policy = typeof module === 'object' && module.exports
    ? require('./conversation-policy.js') : root.ConversationPolicy;
  const searchCore = typeof module === 'object' && module.exports
    ? require('./search-core.js') : root.SearchCore;
  const api = factory(policy, searchCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.EligibilityCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createEligibilityCore(
  conversationPolicy,
  searchCore
) {
  'use strict';

  if (!conversationPolicy) throw new Error('ConversationPolicy is required');
  if (!searchCore) throw new Error('SearchCore is required');

  const CONVERSATION_DETAIL_ENDPOINT = 'https://chatgpt.com/backend-api/conversation';
  const DEFAULT_VERIFICATION_DELAY_MS = 3000;
  const DEFAULT_MAX_VERIFICATIONS = 10;
  const LIVE_STANDALONE_PROMOTION_ENABLED = true;

  function classifyEligibilityEvidence(evidence, {
    allowStandalonePromotion = LIVE_STANDALONE_PROMOTION_ENABLED
  } = {}) {
    const classes = conversationPolicy.CLASSIFICATIONS;
    if (!evidence || typeof evidence !== 'object' || evidence.malformed) {
      return classes.UNKNOWN;
    }
    if (
      evidence.request_outcome &&
      evidence.request_outcome !== 'success'
    ) {
      return classes.UNKNOWN;
    }
    if (
      Number.isInteger(evidence.http_status) &&
      (evidence.http_status < 200 || evidence.http_status >= 300)
    ) {
      return classes.UNKNOWN;
    }
    const gizmoState = evidence.gizmo_state;
    const projectEvidence = evidence.project_membership_evidence;
    if (projectEvidence === 'yes' && gizmoState !== 'project-like') {
      return classes.UNKNOWN;
    }
    if (projectEvidence === 'no' && gizmoState === 'project-like') {
      return classes.UNKNOWN;
    }
    if (projectEvidence === 'yes') return classes.PROJECT;
    if (gizmoState === 'project-like') return classes.PROJECT;
    if (gizmoState === 'custom-gpt-like') return classes.CUSTOM_GPT;
    if (gizmoState === 'null' && allowStandalonePromotion) return classes.STANDALONE;
    return classes.UNKNOWN;
  }

  function evidenceFromBody(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return {
        malformed: true,
        evidence_fields_present: [],
        gizmo_state: 'unknown',
        project_membership_evidence: 'unknown',
        schema_warnings: ['Conversation detail response was not an object']
      };
    }
    const hasGizmoId = Object.prototype.hasOwnProperty.call(body, 'gizmo_id');
    if (!hasGizmoId) {
      return {
        malformed: false,
        evidence_fields_present: [],
        gizmo_state: 'absent',
        project_membership_evidence: 'unknown',
        schema_warnings: ['Expected top-level gizmo_id evidence was absent']
      };
    }
    if (body.gizmo_id === null) {
      return {
        malformed: false,
        evidence_fields_present: ['gizmo_id'],
        gizmo_state: 'null',
        project_membership_evidence: 'unknown',
        schema_warnings: []
      };
    }
    if (body.gizmo_id === '') {
      return {
        malformed: false,
        evidence_fields_present: ['gizmo_id'],
        gizmo_state: 'unknown',
        project_membership_evidence: 'unknown',
        schema_warnings: ['Top-level gizmo_id was an unsupported empty string']
      };
    }
    if (typeof body.gizmo_id !== 'string') {
      return {
        malformed: false,
        evidence_fields_present: ['gizmo_id'],
        gizmo_state: 'unknown',
        project_membership_evidence: 'unknown',
        schema_warnings: ['Top-level gizmo_id had an unsupported type']
      };
    }
    const isProject = body.gizmo_id.startsWith('g-p-');
    return {
      malformed: false,
      evidence_fields_present: ['gizmo_id'],
      gizmo_state: isProject ? 'project-like' : 'custom-gpt-like',
      project_membership_evidence: isProject ? 'yes' : 'no',
      schema_warnings: []
    };
  }

  function baseReport(overrides = {}) {
    return {
      http_status: null,
      endpoint_kind: 'conversation-detail',
      evidence_fields_present: [],
      gizmo_state: 'unknown',
      project_membership_evidence: 'unknown',
      classification_result: conversationPolicy.CLASSIFICATIONS.UNKNOWN,
      schema_warnings: [],
      retry_after_ms: null,
      request_outcome: 'success',
      ...overrides
    };
  }

  async function runEligibilityDiagnostic({
    conversationId,
    authToken,
    fetchImpl = globalThis.fetch,
    signal = null,
    now = Date.now,
    allowStandalonePromotion = LIVE_STANDALONE_PROMOTION_ENABLED
  }) {
    if (typeof conversationId !== 'string' || conversationId.trim() === '') {
      throw new TypeError('conversationId must be a non-empty string');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    let response;
    try {
      response = await fetchImpl(
        `${CONVERSATION_DETAIL_ENDPOINT}/${encodeURIComponent(conversationId.trim())}`,
        { method: 'GET', headers: { Authorization: `Bearer ${authToken}` }, signal }
      );
    } catch (error) {
      return baseReport({
        request_outcome: 'network_error',
        schema_warnings: [error?.name === 'AbortError' || signal?.aborted
          ? 'Eligibility request was cancelled'
          : 'Eligibility request failed before an HTTP response']
      });
    }
    const status = Number.isInteger(response?.status) ? response.status : null;
    const retryAfterMs = status === 429
      ? searchCore.parseRetryAfterMs(response?.headers?.get?.('Retry-After'), now())
      : null;
    if (!response?.ok) {
      return baseReport({
        http_status: status,
        retry_after_ms: retryAfterMs,
        request_outcome: status === 429 ? 'rate_limited' : 'http_error',
        schema_warnings: [status === 429
          ? 'Eligibility request was rate-limited'
          : `Eligibility request returned HTTP ${status ?? 'unknown'}`]
      });
    }
    let body;
    try {
      body = await response.json();
    } catch (_error) {
      return baseReport({
        http_status: status,
        request_outcome: 'malformed',
        schema_warnings: ['Conversation detail response was not valid JSON']
      });
    }
    const evidence = evidenceFromBody(body);
    const classification = classifyEligibilityEvidence(evidence, { allowStandalonePromotion });
    const warnings = [...evidence.schema_warnings];
    if (evidence.gizmo_state === 'null' && !allowStandalonePromotion) {
      warnings.push('Standalone promotion was disabled for this diagnostic');
    }
    return baseReport({
      http_status: status,
      request_outcome: evidence.malformed ? 'malformed' : 'success',
      evidence_fields_present: evidence.evidence_fields_present,
      gizmo_state: evidence.gizmo_state,
      project_membership_evidence: evidence.project_membership_evidence,
      classification_result: classification,
      schema_warnings: warnings
    });
  }

  function isVerificationCandidate(record) {
    try {
      const normalized = conversationPolicy.normalizeConversationRecord(record);
      return normalized.classification === conversationPolicy.CLASSIFICATIONS.UNKNOWN &&
        normalized.discovery_sources.includes('search');
    } catch (_error) {
      return false;
    }
  }

  function uniqueIds(ids) {
    if (!Array.isArray(ids)) throw new TypeError('ids must be an array');
    return Array.from(new Set(ids.map(id => {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new TypeError('Every conversation id must be a non-empty string');
      }
      return id.trim();
    })));
  }

  function abortError() {
    const error = new Error('Operation cancelled');
    error.name = 'AbortError';
    return error;
  }

  function defaultWait(milliseconds, signal) {
    if (milliseconds <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const timer = setTimeout(resolve, milliseconds);
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    });
  }

  function minimalEligibilityMetadata(report) {
    return {
      endpoint_kind: report.endpoint_kind || 'conversation-detail',
      http_status: Number.isInteger(report.http_status) ? report.http_status : null,
      request_outcome: report.request_outcome || 'unknown',
      gizmo_state: report.gizmo_state || 'unknown',
      project_membership_evidence: report.project_membership_evidence || 'unknown',
      schema_warnings: Array.isArray(report.schema_warnings)
        ? [...report.schema_warnings] : []
    };
  }

  function createSummary(queue, notQueuedIds) {
    return {
      state: 'running', stop_reason: null, queued: queue.length, processed: 0,
      verified_standalone: 0, protected_project: 0, protected_custom_gpt: 0,
      still_unknown: 0, failed: 0, rate_limited: 0, skipped: 0,
      retry_after_ms: null, pending_ids: [], not_queued_ids: notQueuedIds
    };
  }

  async function runEligibilityVerificationQueue({
    ids,
    store,
    verifyOne,
    maxItems = DEFAULT_MAX_VERIFICATIONS,
    delayMs = DEFAULT_VERIFICATION_DELAY_MS,
    wait = defaultWait,
    signal = null,
    allowStandalonePromotion = LIVE_STANDALONE_PROMOTION_ENABLED,
    onProgress = () => {}
  }) {
    if (!store || typeof store.getConversation !== 'function' ||
        typeof store.saveConversation !== 'function') {
      throw new TypeError('store must provide getConversation and saveConversation');
    }
    if (typeof verifyOne !== 'function') throw new TypeError('verifyOne must be a function');
    if (!Number.isInteger(maxItems) || maxItems < 1) {
      throw new TypeError('maxItems must be a positive integer');
    }
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new TypeError('delayMs must be a non-negative number');
    }
    const allIds = uniqueIds(ids);
    const queue = allIds.slice(0, maxItems);
    const summary = createSummary(queue, allIds.slice(maxItems));
    const progress = (phase, extra = {}) => onProgress({ phase, ...summary, ...extra });
    progress('queued');

    let requestsMade = 0;
    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      if (signal?.aborted) {
        summary.state = 'cancelled'; summary.stop_reason = 'cancelled';
        summary.pending_ids = queue.slice(index); progress('cancelled'); return summary;
      }
      const record = await store.getConversation(id);
      if (!isVerificationCandidate(record)) {
        summary.skipped += 1; summary.processed += 1; progress('skipped'); continue;
      }
      if (requestsMade > 0 && delayMs > 0) {
        try {
          progress('waiting', { current: summary.processed + 1 });
          await wait(delayMs, signal);
        } catch (error) {
          if (error?.name === 'AbortError' || signal?.aborted) {
            summary.state = 'cancelled'; summary.stop_reason = 'cancelled';
            summary.pending_ids = queue.slice(index); progress('cancelled'); return summary;
          }
          summary.state = 'partial'; summary.stop_reason = 'wait_error';
          summary.failed += 1; summary.pending_ids = queue.slice(index);
          progress('stopped'); return summary;
        }
      }
      progress('requesting', { current: summary.processed + 1 });
      let report;
      try {
        report = await verifyOne(record, { signal, allowStandalonePromotion });
        requestsMade += 1;
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) {
          summary.state = 'cancelled'; summary.stop_reason = 'cancelled';
          summary.pending_ids = queue.slice(index); progress('cancelled'); return summary;
        }
        if (error?.code === 'session_unavailable') {
          summary.state = 'partial'; summary.stop_reason = 'session_unavailable';
          summary.pending_ids = queue.slice(index); progress('stopped'); return summary;
        }
        requestsMade += 1;
        summary.failed += 1; summary.still_unknown += 1; summary.processed += 1;
        summary.state = 'partial'; progress('unknown'); continue;
      }
      if (signal?.aborted) {
        summary.state = 'cancelled'; summary.stop_reason = 'cancelled';
        summary.pending_ids = queue.slice(index); progress('cancelled'); return summary;
      }
      if (report?.http_status === 401) {
        summary.state = 'partial'; summary.stop_reason = 'session_unavailable';
        summary.failed += 1; summary.still_unknown += 1; summary.processed += 1;
        summary.pending_ids = queue.slice(index + 1); progress('stopped'); return summary;
      }
      if (report?.http_status === 429) {
        summary.state = 'rate-limited'; summary.stop_reason = 'http_429';
        summary.rate_limited += 1; summary.still_unknown += 1; summary.processed += 1;
        summary.retry_after_ms = Number.isFinite(report.retry_after_ms)
          ? report.retry_after_ms : null;
        summary.pending_ids = queue.slice(index + 1); progress('rate-limited'); return summary;
      }
      const classification = classifyEligibilityEvidence(report, { allowStandalonePromotion });
      const incoming = {
        ...record,
        classification,
        classification_evidence: classification === conversationPolicy.CLASSIFICATIONS.UNKNOWN
          ? record.classification_evidence || 'search-only' : 'eligibility-detail-v1',
        eligibility_metadata: minimalEligibilityMetadata(report || {})
      };
      const merged = conversationPolicy.mergeConversationRecords(record, incoming);
      await store.saveConversation(merged);
      if (classification === conversationPolicy.CLASSIFICATIONS.STANDALONE) {
        summary.verified_standalone += 1;
      } else if (classification === conversationPolicy.CLASSIFICATIONS.PROJECT) {
        summary.protected_project += 1;
      } else if (classification === conversationPolicy.CLASSIFICATIONS.CUSTOM_GPT) {
        summary.protected_custom_gpt += 1;
      } else {
        summary.still_unknown += 1;
        const status = report?.http_status;
        if (
          (Number.isInteger(status) && (status < 200 || status >= 300)) ||
          ['network_error', 'http_error', 'malformed'].includes(report?.request_outcome) ||
          report?.malformed
        ) {
          summary.failed += 1; summary.state = 'partial';
        }
      }
      summary.processed += 1;
      progress('verified');
    }
    if (summary.state === 'running') summary.state = 'complete';
    progress('complete');
    return summary;
  }

  return {
    CONVERSATION_DETAIL_ENDPOINT,
    DEFAULT_MAX_VERIFICATIONS,
    DEFAULT_VERIFICATION_DELAY_MS,
    LIVE_STANDALONE_PROMOTION_ENABLED,
    classifyEligibilityEvidence,
    evidenceFromBody,
    isVerificationCandidate,
    runEligibilityDiagnostic,
    runEligibilityVerificationQueue
  };
});
