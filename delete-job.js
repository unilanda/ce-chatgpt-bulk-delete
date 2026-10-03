(function attachDeleteJob(root, factory) {
  const policy =
    typeof module === 'object' && module.exports
      ? require('./conversation-policy.js')
      : root.ConversationPolicy;
  const deletionCore =
    typeof module === 'object' && module.exports
      ? require('./deletion-core.js')
      : root.DeletionCore;
  const api = factory(policy, deletionCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeleteJob = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDeleteJob(
  conversationPolicy,
  deletionCore
) {
  'use strict';

  if (!conversationPolicy) throw new Error('ConversationPolicy is required');
  if (!deletionCore) throw new Error('DeletionCore is required');

  const JOB_STATES = Object.freeze({
    DRAFT: 'draft',
    READY: 'ready',
    RUNNING: 'running',
    PAUSE_REQUESTED: 'pause_requested',
    PAUSED: 'paused',
    CANCEL_REQUESTED: 'cancel_requested',
    ERROR_PAUSED: 'error_paused',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
  });

  const ITEM_STATES = Object.freeze({
    PENDING: 'pending',
    REQUESTING: 'requesting',
    COMPLETED: 'completed',
    SKIPPED_INELIGIBLE: 'skipped_ineligible',
    FAILED: 'failed'
  });

  const TERMINAL_STATES = new Set([
    JOB_STATES.COMPLETED,
    JOB_STATES.CANCELLED
  ]);

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function requireTimestamp(value, name = 'now') {
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`${name} must be a non-negative finite number`);
    }
    return value;
  }

  function uniqueIds(ids) {
    if (!Array.isArray(ids)) throw new TypeError('ids must be an array');
    const result = [];
    const seen = new Set();
    for (const value of ids) {
      if (typeof value !== 'string' || value.trim() === '') {
        throw new TypeError('Every conversation id must be a non-empty string');
      }
      const id = value.trim();
      if (!seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
    return result;
  }

  function recordsById(records) {
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    const result = new Map();
    for (const record of records) {
      if (record && typeof record.id === 'string' && record.id.trim() !== '') {
        result.set(record.id.trim(), record);
      }
    }
    return result;
  }

  function classifyRecord(record) {
    if (!record) {
      return { approved_classification: null, blocked_reason: 'missing' };
    }
    let normalized;
    try {
      normalized = conversationPolicy.normalizeConversationRecord(record);
    } catch (_error) {
      return { approved_classification: null, blocked_reason: 'unverified' };
    }
    if (normalized.classification === conversationPolicy.CLASSIFICATIONS.STANDALONE) {
      return {
        approved_classification: conversationPolicy.CLASSIFICATIONS.STANDALONE,
        blocked_reason: null
      };
    }
    if (normalized.classification === conversationPolicy.CLASSIFICATIONS.PROJECT) {
      return {
        approved_classification: conversationPolicy.CLASSIFICATIONS.PROJECT,
        blocked_reason: null
      };
    }
    if (normalized.classification === conversationPolicy.CLASSIFICATIONS.CUSTOM_GPT) {
      return { approved_classification: null, blocked_reason: 'custom_gpt' };
    }
    return { approved_classification: null, blocked_reason: 'unverified' };
  }

  function createPendingItem(id, record) {
    const classification = classifyRecord(record);
    return {
      conversation_id: id,
      approved_classification: classification.approved_classification,
      status: ITEM_STATES.PENDING,
      blocked_reason: classification.blocked_reason,
      requested_at: null,
      completed_at: null,
      error_code: null
    };
  }

  function projectIds(job) {
    return job.items
      .filter(item =>
        item.approved_classification === conversationPolicy.CLASSIFICATIONS.PROJECT
      )
      .map(item => item.conversation_id);
  }

  function arraysEqual(first, second) {
    return first.length === second.length &&
      first.every((value, index) => value === second[index]);
  }

  function deriveCounts(items) {
    const completed = items.filter(item => item.status === ITEM_STATES.COMPLETED).length;
    const failed = items.filter(item => item.status === ITEM_STATES.FAILED).length;
    return {
      total: items.length,
      completed,
      pending: items.length - completed,
      failed
    };
  }

  function hasBlockedItems(job) {
    return job.items.some(item =>
      item.status !== ITEM_STATES.COMPLETED && item.blocked_reason !== null
    );
  }

  function planningState(job) {
    const projects = projectIds(job);
    const approvalValid = projects.length === 0 ||
      (job.project_subset_approved &&
        arraysEqual(job.project_approval_ids, projects));
    return job.items.length > 0 && !hasBlockedItems(job) && approvalValid
      ? JOB_STATES.READY
      : JOB_STATES.DRAFT;
  }

  function updateDerived(job, now) {
    const updated = clone(job);
    updated.counts = deriveCounts(updated.items);
    updated.updated_at = requireTimestamp(now);
    return updated;
  }

  function buildDeletePlan({
    ids,
    records,
    intervalSeconds,
    now,
    jobId
  }) {
    const orderedIds = uniqueIds(ids);
    if (typeof jobId !== 'string' || jobId.trim() === '') {
      throw new TypeError('jobId must be a non-empty string');
    }
    const parsedInterval = deletionCore.parseDeleteIntervalSeconds(intervalSeconds);
    if (parsedInterval === null) {
      throw new TypeError('intervalSeconds must be a positive whole number');
    }
    const timestamp = requireTimestamp(now);
    const byId = recordsById(records);
    const job = {
      schema_version: 1,
      job_id: jobId.trim(),
      type: 'delete',
      state: JOB_STATES.DRAFT,
      created_at: timestamp,
      updated_at: timestamp,
      started_at: null,
      finished_at: null,
      interval_seconds: parsedInterval,
      next_run_at: null,
      items: orderedIds.map(id => createPendingItem(id, byId.get(id))),
      project_subset_approved: false,
      project_approval_ids: [],
      counts: {
        total: orderedIds.length,
        completed: 0,
        pending: orderedIds.length,
        failed: 0
      },
      current_conversation_id: null,
      pause_requested: false,
      cancel_requested: false,
      last_error: null,
      http_status: null,
      retry_after_ms: null,
      revision: 0
    };
    job.state = planningState(job);
    return clone(job);
  }

  function refreshDeletePlan(job, { records, now }) {
    const refreshed = clone(job);
    if (![JOB_STATES.DRAFT, JOB_STATES.READY, JOB_STATES.PAUSED,
      JOB_STATES.ERROR_PAUSED].includes(refreshed.state)) {
      throw new Error('DeleteJob cannot be refreshed from its current state');
    }
    const byId = recordsById(records);
    refreshed.items = refreshed.items.map(item => {
      if (item.status === ITEM_STATES.COMPLETED) return item;
      return createPendingItem(item.conversation_id, byId.get(item.conversation_id));
    });
    const currentProjectIds = projectIds(refreshed);
    const approvalStillValid = refreshed.project_subset_approved &&
      arraysEqual(refreshed.project_approval_ids, currentProjectIds);
    refreshed.project_subset_approved =
      currentProjectIds.length > 0 && approvalStillValid;
    refreshed.project_approval_ids = refreshed.project_subset_approved
      ? currentProjectIds
      : [];
    refreshed.current_conversation_id = null;
    refreshed.pause_requested = false;
    refreshed.cancel_requested = false;
    refreshed.last_error = null;
    refreshed.http_status = null;
    refreshed.retry_after_ms = null;
    refreshed.next_run_at = null;
    refreshed.finished_at = null;
    refreshed.state = planningState(refreshed);
    return updateDerived(refreshed, now);
  }

  function removeBlockedItems(job, { now }) {
    const updated = clone(job);
    if (![JOB_STATES.DRAFT, JOB_STATES.READY].includes(updated.state)) {
      throw new Error('Blocked items can only be removed while planning');
    }
    updated.items = updated.items.filter(item => item.blocked_reason === null);
    const currentProjectIds = projectIds(updated);
    const approvalStillValid = updated.project_subset_approved &&
      arraysEqual(updated.project_approval_ids, currentProjectIds);
    updated.project_subset_approved =
      currentProjectIds.length > 0 && approvalStillValid;
    updated.project_approval_ids = updated.project_subset_approved
      ? currentProjectIds
      : [];
    updated.state = planningState(updated);
    return updateDerived(updated, now);
  }

  function approveProjectSubset(job, { now }) {
    const updated = clone(job);
    if (![JOB_STATES.DRAFT, JOB_STATES.READY].includes(updated.state)) {
      throw new Error('Project conversations can only be approved while planning');
    }
    const projects = projectIds(updated);
    if (projects.length === 0) return updated;
    updated.project_subset_approved = true;
    updated.project_approval_ids = projects;
    updated.state = planningState(updated);
    return updateDerived(updated, now);
  }

  function startDeleteJob(job, { now }) {
    if (job.state === JOB_STATES.RUNNING) return clone(job);
    if (job.state !== JOB_STATES.READY || job.items.length === 0) {
      throw new Error('DeleteJob must be ready before it can start');
    }
    const timestamp = requireTimestamp(now);
    const updated = clone(job);
    updated.state = JOB_STATES.RUNNING;
    updated.started_at = updated.started_at ?? timestamp;
    updated.finished_at = null;
    updated.next_run_at = timestamp;
    updated.pause_requested = false;
    updated.cancel_requested = false;
    updated.last_error = null;
    updated.http_status = null;
    updated.retry_after_ms = null;
    return updateDerived(updated, timestamp);
  }

  function hasRequestInFlight(job) {
    if (!job.current_conversation_id) return false;
    return job.items.some(item =>
      item.conversation_id === job.current_conversation_id &&
      item.status === ITEM_STATES.REQUESTING
    );
  }

  function requestPause(job, { now }) {
    if ([JOB_STATES.PAUSED, JOB_STATES.PAUSE_REQUESTED].includes(job.state) ||
        TERMINAL_STATES.has(job.state)) {
      return clone(job);
    }
    if (job.state !== JOB_STATES.RUNNING) {
      throw new Error('Only a running DeleteJob can be paused');
    }
    const timestamp = requireTimestamp(now);
    const updated = clone(job);
    const inFlight = hasRequestInFlight(updated);
    updated.state = inFlight ? JOB_STATES.PAUSE_REQUESTED : JOB_STATES.PAUSED;
    updated.pause_requested = inFlight;
    updated.next_run_at = null;
    return updateDerived(updated, timestamp);
  }

  function requestCancel(job, { now }) {
    if ([JOB_STATES.CANCELLED, JOB_STATES.CANCEL_REQUESTED].includes(job.state) ||
        job.state === JOB_STATES.COMPLETED) {
      return clone(job);
    }
    const timestamp = requireTimestamp(now);
    const updated = clone(job);
    const inFlight = hasRequestInFlight(updated);
    if (inFlight) {
      updated.state = JOB_STATES.CANCEL_REQUESTED;
      updated.cancel_requested = true;
    } else {
      updated.state = JOB_STATES.CANCELLED;
      updated.cancel_requested = false;
      updated.finished_at = timestamp;
    }
    updated.next_run_at = null;
    return updateDerived(updated, timestamp);
  }

  function reviewAndResume(job, { records, now }) {
    if (job.state === JOB_STATES.RUNNING) return clone(job);
    if (![JOB_STATES.PAUSED, JOB_STATES.ERROR_PAUSED].includes(job.state)) {
      throw new Error('Only a paused DeleteJob can be reviewed and resumed');
    }
    const refreshed = refreshDeletePlan(job, { records, now });
    return refreshed.state === JOB_STATES.READY
      ? startDeleteJob(refreshed, { now })
      : refreshed;
  }

  function estimateMinimumDurationSeconds(total, intervalSeconds) {
    if (!Number.isInteger(total) || total < 0) {
      throw new TypeError('total must be a non-negative integer');
    }
    const parsedInterval = deletionCore.parseDeleteIntervalSeconds(intervalSeconds);
    if (parsedInterval === null) {
      throw new TypeError('intervalSeconds must be a positive whole number');
    }
    return Math.max(0, total - 1) * parsedInterval;
  }

  function summarizeDeleteJob(job) {
    const activeItems = job.items.filter(item => item.status !== ITEM_STATES.COMPLETED);
    const blockedItems = activeItems.filter(item => item.blocked_reason !== null);
    const counts = deriveCounts(job.items);
    const projectCount = activeItems.filter(item =>
      item.approved_classification === conversationPolicy.CLASSIFICATIONS.PROJECT
    ).length;
    return {
      total: counts.total,
      completed: counts.completed,
      pending: counts.pending,
      failed: counts.failed,
      standalone: activeItems.filter(item =>
        item.approved_classification === conversationPolicy.CLASSIFICATIONS.STANDALONE
      ).length,
      project: projectCount,
      blocked: blockedItems.length,
      blocked_unverified: blockedItems.filter(item =>
        item.blocked_reason === 'unverified'
      ).length,
      blocked_custom_gpt: blockedItems.filter(item =>
        item.blocked_reason === 'custom_gpt'
      ).length,
      blocked_missing: blockedItems.filter(item =>
        item.blocked_reason === 'missing'
      ).length,
      project_approval_required: projectCount > 0 && !job.project_subset_approved,
      project_subset_approved: job.project_subset_approved,
      estimated_minimum_seconds: estimateMinimumDurationSeconds(
        counts.pending,
        job.interval_seconds
      )
    };
  }

  return {
    ITEM_STATES,
    JOB_STATES,
    TERMINAL_STATES,
    approveProjectSubset,
    buildDeletePlan,
    estimateMinimumDurationSeconds,
    refreshDeletePlan,
    removeBlockedItems,
    requestCancel,
    requestPause,
    reviewAndResume,
    startDeleteJob,
    summarizeDeleteJob
  };
});
