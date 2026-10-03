(function attachJobClient(root, factory) {
  const jobStore =
    typeof module === 'object' && module.exports
      ? require('./job-store.js')
      : root.JobStore;
  const api = factory(jobStore);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JobClient = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createJobClientModule(
  jobStore
) {
  'use strict';

  if (!jobStore) throw new Error('JobStore is required');

  class JobClientError extends Error {
    constructor(code) {
      super(code);
      this.name = 'JobClientError';
      this.code = code;
    }
  }

  function createJobClient({
    runtime,
    storage,
    storageKey = jobStore.JOB_STORAGE_KEY,
    validateJob = jobStore.validateDeleteJob,
    onChange = () => {}
  }) {
    if (!runtime || typeof runtime.sendMessage !== 'function') {
      throw new TypeError('runtime must provide sendMessage');
    }
    if (!storage?.onChanged?.addListener ||
        !storage?.onChanged?.removeListener) {
      throw new TypeError('storage.onChanged is required');
    }
    if (typeof validateJob !== 'function' || typeof onChange !== 'function') {
      throw new TypeError('validateJob and onChange must be functions');
    }

    let snapshot = null;
    let connected = false;

    function accept(value) {
      if (value === null || value === undefined) {
        snapshot = null;
        onChange(null);
        return null;
      }
      try {
        snapshot = validateJob(value);
      } catch (_error) {
        snapshot = null;
        onChange(null, { error_code: 'invalid_job_state' });
        throw new JobClientError('invalid_job_state');
      }
      onChange(structuredClone(snapshot));
      return structuredClone(snapshot);
    }

    function handleStorageChange(changes, areaName) {
      if (areaName !== 'local' || !changes?.[storageKey]) return;
      try {
        accept(changes[storageKey].newValue);
      } catch (_error) {
        // accept already published a sanitized fail-closed state.
      }
    }

    async function send(type, fields = {}) {
      const response = await runtime.sendMessage({ type, ...fields });
      if (!response?.ok) {
        throw new JobClientError(response?.error_code || 'internal_error');
      }
      return Object.prototype.hasOwnProperty.call(response, 'job')
        ? accept(response.job)
        : null;
    }

    async function connect() {
      if (!connected) {
        storage.onChanged.addListener(handleStorageChange);
        connected = true;
      }
      return send('delete_job:get');
    }

    function disconnect() {
      if (!connected) return;
      storage.onChanged.removeListener(handleStorageChange);
      connected = false;
    }

    return {
      approveProjects: () => send('delete_job:approve_projects'),
      cancel: () => send('delete_job:cancel'),
      connect,
      createPlan: ({ ids, intervalSeconds }) => send('delete_job:create_plan', {
        ids,
        interval_seconds: intervalSeconds
      }),
      disconnect,
      dismissTerminal: () => send('delete_job:dismiss_terminal'),
      getJob: () => send('delete_job:get'),
      getSnapshot: () => snapshot ? structuredClone(snapshot) : null,
      pause: () => send('delete_job:pause'),
      refreshPlan: () => send('delete_job:refresh_plan'),
      removeBlocked: () => send('delete_job:remove_blocked'),
      resume: () => send('delete_job:resume'),
      startPlan: ({ ids, intervalSeconds, approvedProjectIds }) =>
        send('delete_job:start_plan', {
          ids,
          interval_seconds: intervalSeconds,
          approved_project_ids: approvedProjectIds
        }),
      start: () => send('delete_job:start')
    };
  }

  return { JobClientError, createJobClient };
});
