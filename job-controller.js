(function attachDeleteJobController(root, factory) {
  const deleteJob =
    typeof module === 'object' && module.exports
      ? require('./delete-job.js')
      : root.DeleteJob;
  const api = factory(deleteJob);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeleteJobController = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createControllerModule(
  deleteJob
) {
  'use strict';

  if (!deleteJob) throw new Error('DeleteJob is required');

  class DeleteJobControllerError extends Error {
    constructor(code) {
      super(code);
      this.name = 'DeleteJobControllerError';
      this.code = code;
    }
  }

  function createDeleteJobController({
    jobStore,
    inventory,
    executor,
    now = Date.now,
    idFactory = () => crypto.randomUUID()
  }) {
    if (!jobStore || typeof jobStore.load !== 'function' ||
        typeof jobStore.save !== 'function' ||
        typeof jobStore.update !== 'function' ||
        typeof jobStore.clear !== 'function') {
      throw new TypeError('jobStore must provide load, save, update, and clear');
    }
    if (!inventory || typeof inventory.init !== 'function' ||
        typeof inventory.getConversation !== 'function') {
      throw new TypeError('inventory must provide init and getConversation');
    }
    if (!executor || typeof executor.schedule !== 'function' ||
        typeof executor.clearSchedule !== 'function') {
      throw new TypeError('executor must provide schedule and clearSchedule');
    }
    if (typeof now !== 'function' || typeof idFactory !== 'function') {
      throw new TypeError('now and idFactory must be functions');
    }

    async function recordsForIds(ids) {
      await inventory.init();
      const records = [];
      for (const id of ids) {
        const record = await inventory.getConversation(id);
        if (record) records.push(record);
      }
      return records;
    }

    async function getJob() {
      return jobStore.load();
    }

    async function createPlan({ ids, intervalSeconds }) {
      const existing = await jobStore.load();
      if (existing && !deleteJob.TERMINAL_STATES.has(existing.state)) {
        throw new DeleteJobControllerError('active_job_exists');
      }
      const records = await recordsForIds(ids);
      const plan = deleteJob.buildDeletePlan({
        ids,
        records,
        intervalSeconds,
        now: now(),
        jobId: idFactory()
      });
      if (existing) await jobStore.clear();
      try {
        return await jobStore.save(plan, { expectedRevision: null });
      } catch (error) {
        if (/revision conflict/.test(error?.message || '')) {
          throw new DeleteJobControllerError('active_job_exists');
        }
        throw error;
      }
    }

    async function startPlan({ ids, intervalSeconds, approvedProjectIds = [] }) {
      const existing = await jobStore.load();
      if (existing && !deleteJob.TERMINAL_STATES.has(existing.state)) {
        throw new DeleteJobControllerError('active_job_exists');
      }
      if (!Array.isArray(approvedProjectIds)) {
        throw new DeleteJobControllerError('project_approval_required');
      }
      const records = await recordsForIds(ids);
      let plan = deleteJob.buildDeletePlan({
        ids,
        records,
        intervalSeconds,
        now: now(),
        jobId: idFactory()
      });
      if (plan.items.some(item => item.blocked_reason !== null)) {
        throw new DeleteJobControllerError('plan_not_ready');
      }
      const projectIds = plan.items
        .filter(item => item.approved_classification === 'project-protected')
        .map(item => item.conversation_id);
      const approvalMatches = approvedProjectIds.length === projectIds.length &&
        projectIds.every((id, index) => approvedProjectIds[index] === id);
      if (!approvalMatches) {
        throw new DeleteJobControllerError('project_approval_required');
      }
      if (projectIds.length > 0) {
        plan = deleteJob.approveProjectSubset(plan, { now: now() });
      }
      if (plan.state !== deleteJob.JOB_STATES.READY) {
        throw new DeleteJobControllerError('plan_not_ready');
      }
      if (existing) await jobStore.clear();
      let saved;
      try {
        saved = await jobStore.save(plan, { expectedRevision: null });
      } catch (error) {
        if (/revision conflict/.test(error?.message || '')) {
          throw new DeleteJobControllerError('active_job_exists');
        }
        throw error;
      }
      const running = await jobStore.update(current =>
        deleteJob.startDeleteJob(current, { now: now() })
      );
      await executor.schedule(running);
      return running;
    }

    async function refreshPlan() {
      const snapshot = await jobStore.load();
      if (!snapshot) throw new DeleteJobControllerError('no_active_job');
      const records = await recordsForIds(
        snapshot.items.map(item => item.conversation_id)
      );
      return jobStore.update(current =>
        deleteJob.refreshDeletePlan(current, { records, now: now() })
      );
    }

    async function removeBlocked() {
      const snapshot = await jobStore.load();
      if (!snapshot) throw new DeleteJobControllerError('no_active_job');
      return jobStore.update(current =>
        deleteJob.removeBlockedItems(current, { now: now() })
      );
    }

    async function approveProjects() {
      const snapshot = await jobStore.load();
      if (!snapshot) throw new DeleteJobControllerError('no_active_job');
      return jobStore.update(current =>
        deleteJob.approveProjectSubset(current, { now: now() })
      );
    }

    async function start() {
      const snapshot = await jobStore.load();
      if (!snapshot) throw new DeleteJobControllerError('no_active_job');
      if (snapshot.state === deleteJob.JOB_STATES.RUNNING) return snapshot;
      const running = await jobStore.update(current =>
        deleteJob.startDeleteJob(current, { now: now() })
      );
      await executor.schedule(running);
      return running;
    }

    async function pause() {
      const snapshot = await jobStore.load();
      if (!snapshot) throw new DeleteJobControllerError('no_active_job');
      if (
        snapshot.state === deleteJob.JOB_STATES.PAUSED ||
        snapshot.state === deleteJob.JOB_STATES.PAUSE_REQUESTED ||
        deleteJob.TERMINAL_STATES.has(snapshot.state)
      ) {
        return snapshot;
      }
      const paused = await jobStore.update(current =>
        deleteJob.requestPause(current, { now: now() })
      );
      await executor.clearSchedule();
      return paused;
    }

    async function resume() {
      const snapshot = await jobStore.load();
      if (!snapshot) throw new DeleteJobControllerError('no_active_job');
      if (snapshot.state === deleteJob.JOB_STATES.RUNNING) return snapshot;
      const records = await recordsForIds(
        snapshot.items.map(item => item.conversation_id)
      );
      const reviewed = await jobStore.update(current => {
        if (current.state === deleteJob.JOB_STATES.RUNNING) return current;
        return deleteJob.reviewAndResume(current, { records, now: now() });
      });
      if (reviewed.state === deleteJob.JOB_STATES.RUNNING) {
        await executor.schedule(reviewed);
      } else {
        await executor.clearSchedule();
      }
      return reviewed;
    }

    async function cancel() {
      const snapshot = await jobStore.load();
      if (!snapshot) throw new DeleteJobControllerError('no_active_job');
      if (
        snapshot.state === deleteJob.JOB_STATES.CANCELLED ||
        snapshot.state === deleteJob.JOB_STATES.CANCEL_REQUESTED ||
        snapshot.state === deleteJob.JOB_STATES.COMPLETED
      ) {
        return snapshot;
      }
      const cancelled = await jobStore.update(current =>
        deleteJob.requestCancel(current, { now: now() })
      );
      await executor.clearSchedule();
      return cancelled;
    }

    async function dismissTerminal() {
      return jobStore.update(current => {
        if (!deleteJob.TERMINAL_STATES.has(current.state)) {
          throw new DeleteJobControllerError('job_not_terminal');
        }
        return null;
      });
    }

    async function handleBrowserStartup() {
      const snapshot = await jobStore.load();
      if (!snapshot) {
        await executor.clearSchedule();
        return null;
      }
      const hasInterruptedRequest = snapshot.items.some(item =>
        item.status === deleteJob.ITEM_STATES.REQUESTING
      );
      if (hasInterruptedRequest &&
          typeof executor.recoverInterruptedRequest === 'function') {
        const result = await executor.recoverInterruptedRequest();
        return result.job || jobStore.load();
      }
      if (![
        deleteJob.JOB_STATES.RUNNING,
        deleteJob.JOB_STATES.PAUSE_REQUESTED
      ].includes(snapshot.state)) {
        await executor.clearSchedule();
        return snapshot;
      }
      const timestamp = now();
      const interrupted = await jobStore.update(current => {
        current.state = deleteJob.JOB_STATES.ERROR_PAUSED;
        current.updated_at = timestamp;
        current.next_run_at = null;
        current.pause_requested = false;
        current.cancel_requested = false;
        current.last_error = { code: 'browser_restarted' };
        current.http_status = null;
        current.retry_after_ms = null;
        return current;
      });
      await executor.clearSchedule();
      return interrupted;
    }

    return {
      approveProjects,
      cancel,
      createPlan,
      dismissTerminal,
      getJob,
      handleBrowserStartup,
      pause,
      refreshPlan,
      removeBlocked,
      resume,
      start,
      startPlan
    };
  }

  return {
    DeleteJobControllerError,
    createDeleteJobController
  };
});
