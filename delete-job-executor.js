(function attachDeleteJobExecutor(root, factory) {
  const deleteJob =
    typeof module === 'object' && module.exports
      ? require('./delete-job.js')
      : root.DeleteJob;
  const conversationPolicy =
    typeof module === 'object' && module.exports
      ? require('./conversation-policy.js')
      : root.ConversationPolicy;
  const deletionCore =
    typeof module === 'object' && module.exports
      ? require('./deletion-core.js')
      : root.DeletionCore;
  const api = factory(deleteJob, conversationPolicy, deletionCore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeleteJobExecutor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createExecutorModule(
  deleteJob,
  conversationPolicy,
  deletionCore
) {
  'use strict';

  if (!deleteJob) throw new Error('DeleteJob is required');
  if (!conversationPolicy) throw new Error('ConversationPolicy is required');
  if (!deletionCore) throw new Error('DeletionCore is required');

  const DEFAULT_ALARM_NAME = 'chatgpt-manager-delete-job';
  const PERSISTENT_ALARM_THRESHOLD_SECONDS = 30;
  const FAST_ALARM_MIN_DELAY_MS = 30000;

  function deriveSchedule(job, timestamp) {
    if (!job || job.state !== deleteJob.JOB_STATES.RUNNING ||
        !Number.isFinite(job.next_run_at)) {
      return null;
    }
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError('timestamp must be a non-negative finite number');
    }
    if (job.interval_seconds >= PERSISTENT_ALARM_THRESHOLD_SECONDS) {
      return {
        mode: 'alarm',
        alarm_time: job.next_run_at,
        fast_delay_ms: null
      };
    }
    const completionTime = Number.isFinite(job.updated_at)
      ? job.updated_at
      : job.next_run_at - job.interval_seconds * 1000;
    return {
      mode: 'fast_timer_with_backup',
      alarm_time: Math.max(job.next_run_at, completionTime + FAST_ALARM_MIN_DELAY_MS),
      fast_delay_ms: Math.max(0, job.next_run_at - timestamp)
    };
  }

  function deriveCounts(items) {
    const completed = items.filter(item =>
      item.status === deleteJob.ITEM_STATES.COMPLETED
    ).length;
    const failed = items.filter(item =>
      item.status === deleteJob.ITEM_STATES.FAILED
    ).length;
    return {
      total: items.length,
      completed,
      pending: items.length - completed,
      failed
    };
  }

  function touch(job, timestamp) {
    job.counts = deriveCounts(job.items);
    job.updated_at = timestamp;
    return job;
  }

  function setErrorPaused(job, item, {
    code,
    timestamp,
    status = null,
    retryAfterMs = null,
    itemStatus = deleteJob.ITEM_STATES.FAILED
  }) {
    item.status = itemStatus;
    item.error_code = code;
    item.completed_at = null;
    job.state = deleteJob.JOB_STATES.ERROR_PAUSED;
    job.current_conversation_id = null;
    job.next_run_at = null;
    job.pause_requested = false;
    job.cancel_requested = false;
    job.last_error = { code };
    job.http_status = status;
    job.retry_after_ms = retryAfterMs;
    return touch(job, timestamp);
  }

  function createDeleteJobExecutor({
    jobStore,
    inventory,
    alarms,
    acquireSessionToken,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    alarmName = DEFAULT_ALARM_NAME,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout
  }) {
    if (!jobStore || typeof jobStore.load !== 'function' ||
        typeof jobStore.update !== 'function') {
      throw new TypeError('jobStore must provide load and update');
    }
    if (!inventory || typeof inventory.init !== 'function' ||
        typeof inventory.getConversation !== 'function' ||
        typeof inventory.deleteConversation !== 'function') {
      throw new TypeError('inventory must provide init, getConversation, and deleteConversation');
    }
    if (!alarms || typeof alarms.create !== 'function' ||
        typeof alarms.clear !== 'function') {
      throw new TypeError('alarms must provide create and clear');
    }
    if (typeof acquireSessionToken !== 'function') {
      throw new TypeError('acquireSessionToken must be a function');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    if (typeof now !== 'function') throw new TypeError('now must be a function');
    if (typeof setTimeoutImpl !== 'function' || typeof clearTimeoutImpl !== 'function') {
      throw new TypeError('timer functions are required');
    }
    if (typeof alarmName !== 'string' || alarmName.trim() === '') {
      throw new TypeError('alarmName must be a non-empty string');
    }

    let executing = false;
    let fastTimer = null;
    let fastTimerGeneration = 0;

    function clearFastTimer() {
      fastTimerGeneration += 1;
      if (fastTimer !== null) clearTimeoutImpl(fastTimer);
      fastTimer = null;
    }

    async function clearSchedule() {
      clearFastTimer();
      await alarms.clear(alarmName);
    }

    async function schedule(job) {
      clearFastTimer();
      const policy = deriveSchedule(job, now());
      if (!policy) {
        await clearSchedule();
        return null;
      }
      if (policy.mode === 'fast_timer_with_backup') {
        const generation = fastTimerGeneration;
        const event = {
          name: alarmName,
          source: 'fast_timer',
          jobId: job.job_id,
          revision: job.revision,
          scheduledTime: job.next_run_at
        };
        fastTimer = setTimeoutImpl(async () => {
          if (generation !== fastTimerGeneration) return { outcome: 'stale_timer' };
          fastTimer = null;
          try {
            return await executeStep(event);
          } catch (_error) {
            return { outcome: 'execution_error' };
          }
        }, policy.fast_delay_ms);
      }
      await alarms.create(alarmName, { when: policy.alarm_time });
      return policy;
    }

    async function pauseItemWithError(conversationId, options) {
      const updated = await jobStore.update(job => {
        const item = job.items.find(candidate =>
          candidate.conversation_id === conversationId
        );
        if (!item) throw new Error('DeleteJob item disappeared');
        return setErrorPaused(job, item, options);
      });
      await clearSchedule();
      return updated;
    }

    function normalizedClassification(record) {
      if (!record) return null;
      try {
        return conversationPolicy.normalizeConversationRecord(record).classification;
      } catch (_error) {
        return null;
      }
    }

    async function executeStep(alarm = {}) {
      if (alarm.name !== alarmName) return { outcome: 'wrong_alarm' };
      if (executing) return { outcome: 'busy' };
      executing = true;

      try {
        const job = await jobStore.load();
        if (!job || job.state !== deleteJob.JOB_STATES.RUNNING) {
          if (!job || job?.state !== deleteJob.JOB_STATES.RUNNING) {
            await clearSchedule();
          }
          return { outcome: 'state_not_executable' };
        }

        const startedAt = now();
        if (alarm.source === 'fast_timer') {
          if (
            alarm.jobId !== job.job_id ||
            alarm.revision !== job.revision ||
            alarm.scheduledTime !== job.next_run_at
          ) {
            return { outcome: 'stale_timer' };
          }
        } else {
          const expectedSchedule = deriveSchedule(job, startedAt);
          if (
            Number.isFinite(alarm.scheduledTime) &&
            alarm.scheduledTime !== expectedSchedule.alarm_time
          ) {
            return { outcome: 'stale_alarm' };
          }
        }
        if (Number.isFinite(job.next_run_at) && startedAt < job.next_run_at) {
          return { outcome: 'early_alarm' };
        }

        await inventory.init();
        const pendingItem = job.items.find(item =>
          item.status === deleteJob.ITEM_STATES.PENDING
        );
        if (!pendingItem) {
          const completed = await jobStore.update(current => {
            current.state = deleteJob.JOB_STATES.COMPLETED;
            current.finished_at = startedAt;
            current.next_run_at = null;
            current.pause_requested = false;
            current.cancel_requested = false;
            current.last_error = null;
            current.http_status = null;
            current.retry_after_ms = null;
            return touch(current, startedAt);
          });
          await clearSchedule();
          return { outcome: 'completed_job', job: completed };
        }

        const id = pendingItem.conversation_id;
        const record = await inventory.getConversation(id);
        if (
          normalizedClassification(record) !==
          pendingItem.approved_classification
        ) {
          const paused = await pauseItemWithError(id, {
            code: 'eligibility_changed',
            timestamp: now(),
            itemStatus: deleteJob.ITEM_STATES.SKIPPED_INELIGIBLE
          });
          return { outcome: 'error_paused', job: paused };
        }

        let authToken;
        try {
          authToken = await acquireSessionToken();
        } catch (_error) {
          authToken = null;
        }
        if (typeof authToken !== 'string' || authToken.trim() === '') {
          const paused = await pauseItemWithError(id, {
            code: 'session_unavailable',
            timestamp: now()
          });
          return { outcome: 'error_paused', job: paused };
        }

        const requesting = await jobStore.update(current => {
          const item = current.items.find(candidate =>
            candidate.conversation_id === id
          );
          if (
            current.state !== deleteJob.JOB_STATES.RUNNING ||
            !item || item.status !== deleteJob.ITEM_STATES.PENDING
          ) {
            return current;
          }
          const timestamp = now();
          item.status = deleteJob.ITEM_STATES.REQUESTING;
          item.requested_at = timestamp;
          item.completed_at = null;
          item.error_code = null;
          current.current_conversation_id = id;
          current.last_error = null;
          current.http_status = null;
          current.retry_after_ms = null;
          return touch(current, timestamp);
        });
        const requestingItem = requesting.items.find(item =>
          item.conversation_id === id
        );
        if (
          requesting.current_conversation_id !== id ||
          requestingItem?.status !== deleteJob.ITEM_STATES.REQUESTING
        ) {
          return { outcome: 'state_not_executable' };
        }

        const remote = await deletionCore.deleteConversationRemote({
          id,
          authToken,
          fetchImpl,
          now
        });
        authToken = null;

        if (!remote.ok) {
          const paused = await pauseItemWithError(id, {
            code: remote.error_code,
            timestamp: now(),
            status: remote.http_status,
            retryAfterMs: remote.retry_after_ms
          });
          return { outcome: 'error_paused', job: paused };
        }

        try {
          await inventory.deleteConversation(id);
        } catch (_error) {
          const timestamp = now();
          const paused = await jobStore.update(current => {
            const item = current.items.find(candidate =>
              candidate.conversation_id === id
            );
            if (!item) throw new Error('DeleteJob item disappeared');
            item.status = deleteJob.ITEM_STATES.COMPLETED;
            item.completed_at = timestamp;
            item.error_code = null;
            current.state = deleteJob.JOB_STATES.ERROR_PAUSED;
            current.current_conversation_id = null;
            current.next_run_at = null;
            current.pause_requested = false;
            current.cancel_requested = false;
            current.last_error = { code: 'local_reconcile_error' };
            current.http_status = null;
            current.retry_after_ms = null;
            return touch(current, timestamp);
          });
          await clearSchedule();
          return { outcome: 'error_paused', job: paused };
        }

        const completedAt = now();
        const updated = await jobStore.update(current => {
          const item = current.items.find(candidate =>
            candidate.conversation_id === id
          );
          if (!item) throw new Error('DeleteJob item disappeared');
          item.status = deleteJob.ITEM_STATES.COMPLETED;
          item.completed_at = completedAt;
          item.error_code = null;
          current.current_conversation_id = null;
          current.last_error = null;
          current.http_status = null;
          current.retry_after_ms = null;

          if (current.state === deleteJob.JOB_STATES.CANCEL_REQUESTED) {
            current.state = deleteJob.JOB_STATES.CANCELLED;
            current.cancel_requested = false;
            current.pause_requested = false;
            current.finished_at = completedAt;
            current.next_run_at = null;
          } else if (current.state === deleteJob.JOB_STATES.PAUSE_REQUESTED) {
            current.state = deleteJob.JOB_STATES.PAUSED;
            current.pause_requested = false;
            current.cancel_requested = false;
            current.next_run_at = null;
          } else if (current.items.every(candidate =>
            candidate.status === deleteJob.ITEM_STATES.COMPLETED
          )) {
            current.state = deleteJob.JOB_STATES.COMPLETED;
            current.finished_at = completedAt;
            current.pause_requested = false;
            current.cancel_requested = false;
            current.next_run_at = null;
          } else {
            current.state = deleteJob.JOB_STATES.RUNNING;
            current.next_run_at = completedAt + current.interval_seconds * 1000;
          }
          return touch(current, completedAt);
        });

        await schedule(updated);
        return {
          outcome: updated.state === deleteJob.JOB_STATES.COMPLETED
            ? 'completed_job'
            : 'completed_item',
          job: updated
        };
      } finally {
        executing = false;
      }
    }

    async function recoverInterruptedRequest() {
      const job = await jobStore.load();
      if (!job) {
        return { outcome: 'no_active_job' };
      }
      const requestingItem = job.items.find(item =>
        item.status === deleteJob.ITEM_STATES.REQUESTING
      );
      if (!requestingItem) return { outcome: 'no_interrupted_request' };

      const timestamp = now();
      const recovered = await jobStore.update(current => {
        const item = current.items.find(candidate =>
          candidate.status === deleteJob.ITEM_STATES.REQUESTING
        );
        if (!item) return current;
        return setErrorPaused(current, item, {
          code: 'interrupted_request',
          timestamp
        });
      });
      await clearSchedule();
      return { outcome: 'recovered_interrupted_request', job: recovered };
    }

    async function ensureSchedule() {
      const job = await jobStore.load();
      if (job?.items.some(item =>
        item.status === deleteJob.ITEM_STATES.REQUESTING
      )) {
        return recoverInterruptedRequest();
      }
      await schedule(job);
      return { outcome: job?.state === deleteJob.JOB_STATES.RUNNING
        ? 'scheduled'
        : 'not_scheduled' };
    }

    return {
      clearSchedule,
      ensureSchedule,
      executeStep,
      isExecuting: () => executing,
      recoverInterruptedRequest,
      schedule
    };
  }

  return {
    DEFAULT_ALARM_NAME,
    FAST_ALARM_MIN_DELAY_MS,
    PERSISTENT_ALARM_THRESHOLD_SECONDS,
    createDeleteJobExecutor,
    deriveSchedule
  };
});
