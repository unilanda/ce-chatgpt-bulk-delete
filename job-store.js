(function attachJobStore(root, factory) {
  const deleteJob =
    typeof module === 'object' && module.exports
      ? require('./delete-job.js')
      : root.DeleteJob;
  const api = factory(deleteJob);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.JobStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createJobStoreModule(
  deleteJob
) {
  'use strict';

  if (!deleteJob) throw new Error('DeleteJob is required');

  const SCHEMA_VERSION = 1;
  const JOB_STORAGE_KEY = 'chatgpt_manager_active_delete_job_v1';
  const TOP_LEVEL_KEYS = new Set([
    'schema_version',
    'job_id',
    'type',
    'state',
    'created_at',
    'updated_at',
    'started_at',
    'finished_at',
    'interval_seconds',
    'next_run_at',
    'items',
    'project_subset_approved',
    'project_approval_ids',
    'counts',
    'current_conversation_id',
    'pause_requested',
    'cancel_requested',
    'last_error',
    'http_status',
    'retry_after_ms',
    'revision'
  ]);
  const ITEM_KEYS = new Set([
    'conversation_id',
    'approved_classification',
    'status',
    'blocked_reason',
    'requested_at',
    'completed_at',
    'error_code'
  ]);
  const COUNT_KEYS = new Set(['total', 'completed', 'pending', 'failed']);
  const ERROR_KEYS = new Set(['code']);
  const VALID_STATES = new Set(Object.values(deleteJob.JOB_STATES));
  const VALID_ITEM_STATES = new Set(Object.values(deleteJob.ITEM_STATES));
  const VALID_CLASSIFICATIONS = new Set([
    null,
    'standalone-safe',
    'project-protected'
  ]);
  const VALID_BLOCKED_REASONS = new Set([
    null,
    'unverified',
    'custom_gpt',
    'missing'
  ]);

  class InvalidJobStateError extends Error {
    constructor(message) {
      super(message);
      this.name = 'InvalidJobStateError';
    }
  }

  function fail(message) {
    throw new InvalidJobStateError(message);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' &&
      !Array.isArray(value) &&
      (Object.getPrototypeOf(value) === Object.prototype ||
        Object.getPrototypeOf(value) === null);
  }

  function assertExactKeys(value, allowed, path) {
    if (!isPlainObject(value)) fail(`${path} must be an object`);
    const keys = Object.keys(value);
    if (keys.length !== allowed.size || keys.some(key => !allowed.has(key))) {
      fail(`${path} has an unknown or missing field`);
    }
  }

  function assertString(value, path) {
    if (typeof value !== 'string' || value.trim() === '') {
      fail(`${path} must be a non-empty string`);
    }
  }

  function assertNullableTimestamp(value, path) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      fail(`${path} must be null or a non-negative finite timestamp`);
    }
  }

  function assertNonNegativeInteger(value, path) {
    if (!Number.isInteger(value) || value < 0) {
      fail(`${path} must be a non-negative integer`);
    }
  }

  function assertSanitizedCode(value, path) {
    if (
      typeof value !== 'string' ||
      !/^[a-z0-9_]{1,64}$/.test(value)
    ) {
      fail(`${path} must be a sanitized code`);
    }
  }

  function validateDeleteJob(value) {
    assertExactKeys(value, TOP_LEVEL_KEYS, 'job');
    if (value.schema_version !== SCHEMA_VERSION) {
      fail('Unsupported DeleteJob schema version');
    }
    assertString(value.job_id, 'job.job_id');
    if (value.type !== 'delete') fail('job.type must be delete');
    if (!VALID_STATES.has(value.state)) fail('job.state is invalid');
    assertNullableTimestamp(value.created_at, 'job.created_at');
    assertNullableTimestamp(value.updated_at, 'job.updated_at');
    assertNullableTimestamp(value.started_at, 'job.started_at');
    assertNullableTimestamp(value.finished_at, 'job.finished_at');
    if (!Number.isInteger(value.interval_seconds) || value.interval_seconds < 1) {
      fail('job.interval_seconds must be a positive whole number');
    }
    assertNullableTimestamp(value.next_run_at, 'job.next_run_at');
    if (!Array.isArray(value.items)) fail('job.items must be an array');

    const ids = new Set();
    let completed = 0;
    let failed = 0;
    let requesting = 0;
    const projectIds = [];
    for (const [index, item] of value.items.entries()) {
      const path = `job.items[${index}]`;
      assertExactKeys(item, ITEM_KEYS, path);
      assertString(item.conversation_id, `${path}.conversation_id`);
      if (ids.has(item.conversation_id)) fail('job item IDs must be unique');
      ids.add(item.conversation_id);
      if (!VALID_CLASSIFICATIONS.has(item.approved_classification)) {
        fail(`${path}.approved_classification is invalid`);
      }
      if (!VALID_ITEM_STATES.has(item.status)) {
        fail(`${path}.status is invalid`);
      }
      if (!VALID_BLOCKED_REASONS.has(item.blocked_reason)) {
        fail(`${path}.blocked_reason is invalid`);
      }
      if ((item.approved_classification === null) !== (item.blocked_reason !== null)) {
        fail(`${path} eligibility fields disagree`);
      }
      assertNullableTimestamp(item.requested_at, `${path}.requested_at`);
      assertNullableTimestamp(item.completed_at, `${path}.completed_at`);
      if (item.error_code !== null) {
        assertSanitizedCode(item.error_code, `${path}.error_code`);
      }
      if (item.status === deleteJob.ITEM_STATES.COMPLETED) completed += 1;
      if (item.status === deleteJob.ITEM_STATES.FAILED) failed += 1;
      if (item.status === deleteJob.ITEM_STATES.REQUESTING) requesting += 1;
      if (item.approved_classification === 'project-protected') {
        projectIds.push(item.conversation_id);
      }
    }
    if (requesting > 1) fail('Only one job item may be requesting');

    if (typeof value.project_subset_approved !== 'boolean') {
      fail('job.project_subset_approved must be boolean');
    }
    if (!Array.isArray(value.project_approval_ids)) {
      fail('job.project_approval_ids must be an array');
    }
    const approvalIds = new Set();
    for (const id of value.project_approval_ids) {
      assertString(id, 'job.project_approval_ids item');
      if (approvalIds.has(id) || !projectIds.includes(id)) {
        fail('job.project_approval_ids must be unique Project item IDs');
      }
      approvalIds.add(id);
    }
    if (
      value.project_subset_approved &&
      (projectIds.length === 0 ||
        projectIds.length !== value.project_approval_ids.length ||
        projectIds.some((id, index) => value.project_approval_ids[index] !== id))
    ) {
      fail('Approved Project subset does not match job membership');
    }
    if (!value.project_subset_approved && value.project_approval_ids.length !== 0) {
      fail('Unapproved job cannot retain Project approval IDs');
    }

    assertExactKeys(value.counts, COUNT_KEYS, 'job.counts');
    for (const key of COUNT_KEYS) {
      assertNonNegativeInteger(value.counts[key], `job.counts.${key}`);
    }
    if (
      value.counts.total !== value.items.length ||
      value.counts.completed !== completed ||
      value.counts.pending !== value.items.length - completed ||
      value.counts.failed !== failed
    ) {
      fail('job.counts do not match item state');
    }

    if (value.current_conversation_id !== null) {
      assertString(value.current_conversation_id, 'job.current_conversation_id');
      if (!ids.has(value.current_conversation_id)) {
        fail('job.current_conversation_id is not a job item');
      }
    }
    const requestingItem = value.items.find(item =>
      item.status === deleteJob.ITEM_STATES.REQUESTING
    );
    if (
      (requestingItem && value.current_conversation_id !== requestingItem.conversation_id) ||
      (!requestingItem && value.current_conversation_id !== null)
    ) {
      fail('job.current_conversation_id does not match requesting state');
    }
    if (typeof value.pause_requested !== 'boolean' ||
        typeof value.cancel_requested !== 'boolean') {
      fail('job request flags must be boolean');
    }
    if (value.last_error !== null) {
      assertExactKeys(value.last_error, ERROR_KEYS, 'job.last_error');
      assertSanitizedCode(value.last_error.code, 'job.last_error.code');
    }
    if (
      value.http_status !== null &&
      (!Number.isInteger(value.http_status) ||
        value.http_status < 100 ||
        value.http_status > 599)
    ) {
      fail('job.http_status is invalid');
    }
    if (
      value.retry_after_ms !== null &&
      (!Number.isFinite(value.retry_after_ms) || value.retry_after_ms < 0)
    ) {
      fail('job.retry_after_ms is invalid');
    }
    const executionAuthorityStates = new Set([
      deleteJob.JOB_STATES.READY,
      deleteJob.JOB_STATES.RUNNING,
      deleteJob.JOB_STATES.PAUSE_REQUESTED,
      deleteJob.JOB_STATES.PAUSED,
      deleteJob.JOB_STATES.CANCEL_REQUESTED,
      deleteJob.JOB_STATES.ERROR_PAUSED,
      deleteJob.JOB_STATES.COMPLETED
    ]);
    if (executionAuthorityStates.has(value.state)) {
      if (value.items.length === 0 || value.items.some(item =>
        item.blocked_reason !== null || item.approved_classification === null
      )) {
        fail('Executable job state contains blocked membership');
      }
      if (projectIds.length > 0 && !value.project_subset_approved) {
        fail('Executable Project job lacks subset approval');
      }
    }

    if (value.state === deleteJob.JOB_STATES.RUNNING) {
      if (value.next_run_at === null || value.started_at === null) {
        fail('Running job lacks schedule or start timestamp');
      }
    } else if (value.next_run_at !== null) {
      fail('Only a running job may retain next_run_at');
    }

    if (value.pause_requested !==
        (value.state === deleteJob.JOB_STATES.PAUSE_REQUESTED)) {
      fail('job.pause_requested disagrees with state');
    }
    if (value.cancel_requested !==
        (value.state === deleteJob.JOB_STATES.CANCEL_REQUESTED)) {
      fail('job.cancel_requested disagrees with state');
    }
    if (
      requestingItem &&
      ![
        deleteJob.JOB_STATES.RUNNING,
        deleteJob.JOB_STATES.PAUSE_REQUESTED,
        deleteJob.JOB_STATES.CANCEL_REQUESTED
      ].includes(value.state)
    ) {
      fail('Requesting item is incompatible with job state');
    }
    if (
      [
        deleteJob.JOB_STATES.PAUSE_REQUESTED,
        deleteJob.JOB_STATES.CANCEL_REQUESTED
      ].includes(value.state) && !requestingItem
    ) {
      fail('Requested control state lacks an in-flight item');
    }
    if (
      value.state === deleteJob.JOB_STATES.ERROR_PAUSED &&
      value.last_error === null
    ) {
      fail('Error-paused job lacks a sanitized error');
    }
    if (value.state === deleteJob.JOB_STATES.COMPLETED &&
        completed !== value.items.length) {
      fail('Completed job retains unfinished items');
    }
    const terminal = [
      deleteJob.JOB_STATES.COMPLETED,
      deleteJob.JOB_STATES.CANCELLED
    ].includes(value.state);
    if (terminal !== (value.finished_at !== null)) {
      fail('job.finished_at disagrees with terminal state');
    }

    assertNonNegativeInteger(value.revision, 'job.revision');
    return clone(value);
  }

  function createJobStore({
    storageArea,
    key = JOB_STORAGE_KEY
  }) {
    if (!storageArea ||
        typeof storageArea.get !== 'function' ||
        typeof storageArea.set !== 'function' ||
        typeof storageArea.remove !== 'function') {
      throw new TypeError('storageArea must provide get, set, and remove');
    }
    assertString(key, 'key');
    let operationQueue = Promise.resolve();

    function enqueue(operation) {
      const result = operationQueue.then(operation, operation);
      operationQueue = result.then(() => undefined, () => undefined);
      return result;
    }

    async function readCurrent() {
      const values = await storageArea.get(key);
      if (!Object.prototype.hasOwnProperty.call(values, key)) return null;
      return validateDeleteJob(values[key]);
    }

    async function saveCurrent(job, expectedRevision, shouldCheckRevision) {
      const validated = validateDeleteJob(job);
      const current = await readCurrent();
      if (shouldCheckRevision) {
        if (expectedRevision === null && current !== null) {
          throw new Error('DeleteJob revision conflict: job already exists');
        }
        if (
          expectedRevision !== null &&
          (!current || current.revision !== expectedRevision)
        ) {
          throw new Error('DeleteJob revision conflict');
        }
      }
      validated.revision = current ? current.revision + 1 : validated.revision + 1;
      const finalValue = validateDeleteJob(validated);
      await storageArea.set({ [key]: finalValue });
      return clone(finalValue);
    }

    function load() {
      return enqueue(readCurrent);
    }

    function save(job, options = {}) {
      const shouldCheckRevision =
        Object.prototype.hasOwnProperty.call(options, 'expectedRevision');
      return enqueue(() => saveCurrent(
        job,
        options.expectedRevision,
        shouldCheckRevision
      ));
    }

    function update(mutator) {
      if (typeof mutator !== 'function') {
        throw new TypeError('mutator must be a function');
      }
      return enqueue(async () => {
        const current = await readCurrent();
        if (!current) throw new Error('No active DeleteJob');
        const next = await mutator(clone(current));
        if (next === null) {
          await storageArea.remove(key);
          return null;
        }
        if (!next || typeof next !== 'object') {
          throw new TypeError('JobStore mutator must return a job or null');
        }
        return saveCurrent(next, current.revision, true);
      });
    }

    function clear() {
      return enqueue(async () => {
        await storageArea.remove(key);
      });
    }

    return {
      clear,
      load,
      save,
      update
    };
  }

  return {
    JOB_STORAGE_KEY,
    SCHEMA_VERSION,
    InvalidJobStateError,
    createJobStore,
    validateDeleteJob
  };
});
