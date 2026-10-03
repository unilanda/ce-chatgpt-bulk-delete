(function attachDeletePreparation(root, factory) {
  const policy = typeof module === 'object' && module.exports
    ? require('./conversation-policy.js') : root.ConversationPolicy;
  const eligibilityCore = typeof module === 'object' && module.exports
    ? require('./eligibility-core.js') : root.EligibilityCore;
  const api = factory(policy, eligibilityCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeletePreparation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDeletePreparation(
  conversationPolicy,
  eligibilityCore
) {
  'use strict';

  if (!conversationPolicy) throw new Error('ConversationPolicy is required');
  if (!eligibilityCore) throw new Error('EligibilityCore is required');

  function uniqueIds(ids) {
    if (!Array.isArray(ids)) throw new TypeError('ids must be an array');
    return Array.from(new Set(ids.map(value => {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError('Every conversation id must be a non-empty string');
      }
      return value.trim();
    })));
  }

  async function loadRecords(ids, store) {
    const records = new Map();
    for (const id of ids) records.set(id, await store.getConversation(id));
    return records;
  }

  function classificationOf(record) {
    if (!record) return conversationPolicy.CLASSIFICATIONS.UNKNOWN;
    try {
      return conversationPolicy.normalizeConversationRecord(record).classification;
    } catch (_error) {
      return conversationPolicy.CLASSIFICATIONS.UNKNOWN;
    }
  }

  function partition(ids, records) {
    const result = {
      standalone_ids: [],
      project_ids: [],
      custom_gpt_ids: [],
      unresolved_ids: []
    };
    for (const id of ids) {
      const classification = classificationOf(records.get(id));
      if (classification === conversationPolicy.CLASSIFICATIONS.STANDALONE) {
        result.standalone_ids.push(id);
      } else if (classification === conversationPolicy.CLASSIFICATIONS.PROJECT) {
        result.project_ids.push(id);
      } else if (classification === conversationPolicy.CLASSIFICATIONS.CUSTOM_GPT) {
        result.custom_gpt_ids.push(id);
      } else {
        result.unresolved_ids.push(id);
      }
    }
    return result;
  }

  async function prepareDeleteSelection({
    ids,
    store,
    verifyOne,
    signal = null,
    delayMs = eligibilityCore.DEFAULT_VERIFICATION_DELAY_MS,
    wait,
    onProgress = () => {}
  }) {
    if (!store || typeof store.getConversation !== 'function' ||
        typeof store.saveConversation !== 'function') {
      throw new TypeError('store must provide getConversation and saveConversation');
    }
    if (typeof verifyOne !== 'function') throw new TypeError('verifyOne must be a function');
    if (typeof onProgress !== 'function') throw new TypeError('onProgress must be a function');

    const selectedIds = uniqueIds(ids);
    const initialRecords = await loadRecords(selectedIds, store);
    const candidateIds = selectedIds.filter(id =>
      eligibilityCore.isVerificationCandidate(initialRecords.get(id))
    );
    const alreadyVerified = selectedIds.filter(id => {
      const classification = classificationOf(initialRecords.get(id));
      return classification !== conversationPolicy.CLASSIFICATIONS.UNKNOWN;
    }).length;
    const context = {
      selected: selectedIds.length,
      already_verified: alreadyVerified,
      verification_candidates: candidateIds.length
    };
    onProgress({ phase: 'inspecting', ...context, processed: 0 });

    let verification = {
      state: 'complete',
      stop_reason: null,
      processed: 0,
      retry_after_ms: null
    };
    if (candidateIds.length > 0) {
      verification = await eligibilityCore.runEligibilityVerificationQueue({
        ids: candidateIds,
        store,
        verifyOne,
        signal,
        delayMs,
        ...(typeof wait === 'function' ? { wait } : {}),
        maxItems: candidateIds.length,
        allowStandalonePromotion: eligibilityCore.LIVE_STANDALONE_PROMOTION_ENABLED,
        onProgress(progress) {
          onProgress({ ...context, ...progress });
        }
      });
    }

    const canonicalRecords = await loadRecords(selectedIds, store);
    const partitions = partition(selectedIds, canonicalRecords);
    const result = {
      state: verification.state,
      stop_reason: verification.stop_reason,
      selected_ids: selectedIds,
      already_verified: alreadyVerified,
      verification_candidates: candidateIds.length,
      processed: verification.processed,
      retry_after_ms: verification.retry_after_ms,
      ...partitions
    };
    onProgress({ phase: 'partitioned', ...result });
    return result;
  }

  function createDeleteReview(preparation) {
    if (!preparation || !Array.isArray(preparation.selected_ids)) {
      throw new TypeError('preparation result is required');
    }
    return {
      selected_ids: [...preparation.selected_ids],
      standalone_ids: [...preparation.standalone_ids],
      project_ids: [...preparation.project_ids],
      custom_gpt_ids: [...preparation.custom_gpt_ids],
      unresolved_ids: [...preparation.unresolved_ids],
      excluded_ids: [],
      approved_project_ids: [],
      preparation_state: preparation.state,
      retry_after_ms: preparation.retry_after_ms ?? null
    };
  }

  function excludeReviewCategory(review, category) {
    const source = category === 'unresolved'
      ? review.unresolved_ids
      : category === 'custom_gpt'
        ? review.custom_gpt_ids
        : null;
    if (!source) throw new TypeError('category must be unresolved or custom_gpt');
    const excluded = new Set([...review.excluded_ids, ...source]);
    return {
      ...review,
      excluded_ids: review.selected_ids.filter(id => excluded.has(id)),
      approved_project_ids: [...review.approved_project_ids]
    };
  }

  function approveProjectReview(review) {
    const excluded = new Set(review.excluded_ids);
    return {
      ...review,
      excluded_ids: [...review.excluded_ids],
      approved_project_ids: review.project_ids.filter(id => !excluded.has(id))
    };
  }

  function summarizeDeleteReview(review) {
    const excluded = new Set(review.excluded_ids);
    const includedIds = review.selected_ids.filter(id => !excluded.has(id));
    const includedProjects = review.project_ids.filter(id => !excluded.has(id));
    const approvalMatches = review.approved_project_ids.length === includedProjects.length &&
      includedProjects.every((id, index) => review.approved_project_ids[index] === id);
    const customBlocked = review.custom_gpt_ids.filter(id => !excluded.has(id)).length;
    const unresolvedBlocked = review.unresolved_ids.filter(id => !excluded.has(id)).length;
    return {
      selected: review.selected_ids.length,
      included_ids: includedIds,
      excluded_ids: review.selected_ids.filter(id => excluded.has(id)),
      standalone: review.standalone_ids.filter(id => !excluded.has(id)).length,
      project: includedProjects.length,
      custom_gpt_blocked: customBlocked,
      unresolved_blocked: unresolvedBlocked,
      approved_project_ids: [...review.approved_project_ids],
      project_approval_required: includedProjects.length > 0 && !approvalMatches,
      ready_for_start: includedIds.length > 0 &&
        customBlocked === 0 &&
        unresolvedBlocked === 0 &&
        (includedProjects.length === 0 || approvalMatches)
    };
  }

  return {
    approveProjectReview,
    createDeleteReview,
    excludeReviewCategory,
    prepareDeleteSelection,
    summarizeDeleteReview
  };
});
