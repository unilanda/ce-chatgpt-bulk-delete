(function attachDeletionCore(root, factory) {
  const policy =
    typeof module === 'object' && module.exports
      ? require('./conversation-policy.js')
      : root.ConversationPolicy;
  const searchCore =
    typeof module === 'object' && module.exports
      ? require('./search-core.js')
      : root.SearchCore;
  const api = factory(policy, searchCore);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.DeletionCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDeletionCore(
  conversationPolicy,
  searchCore
) {
  'use strict';

  const CONVERSATION_ENDPOINT = 'https://chatgpt.com/backend-api/conversation';
  const DEFAULT_DELETE_INTERVAL_SECONDS = 600;
  const MIN_DELETE_INTERVAL_SECONDS = 1;

  function parseDeleteIntervalSeconds(value) {
    if (
      (typeof value !== 'number' && typeof value !== 'string') ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      return null;
    }
    const seconds = Number(value);
    return Number.isFinite(seconds) &&
      Number.isInteger(seconds) &&
      seconds >= MIN_DELETE_INTERVAL_SECONDS
      ? seconds
      : null;
  }

  function deleteIntervalSecondsToMs(value, {
    fallbackSeconds = DEFAULT_DELETE_INTERVAL_SECONDS
  } = {}) {
    const seconds = parseDeleteIntervalSeconds(value) ??
      parseDeleteIntervalSeconds(fallbackSeconds) ??
      DEFAULT_DELETE_INTERVAL_SECONDS;
    return seconds * 1000;
  }

  const DEFAULT_DELETE_DELAY_MS = deleteIntervalSecondsToMs(
    DEFAULT_DELETE_INTERVAL_SECONDS
  );

  function abortError() {
    const error = new Error('Operation cancelled');
    error.name = 'AbortError';
    return error;
  }

  function defaultWaitUntil(nextAt, {
    signal,
    now = Date.now,
    onTick = () => {}
  } = {}) {
    return new Promise((resolve, reject) => {
      let timer = null;

      function cleanup() {
        if (timer !== null) clearTimeout(timer);
        signal?.removeEventListener('abort', handleAbort);
      }

      function handleAbort() {
        cleanup();
        reject(abortError());
      }

      function tick() {
        if (signal?.aborted) {
          handleAbort();
          return;
        }
        const remainingMs = Math.max(0, nextAt - now());
        onTick(remainingMs);
        if (remainingMs === 0) {
          cleanup();
          resolve();
          return;
        }
        timer = setTimeout(tick, Math.min(1000, remainingMs));
      }

      signal?.addEventListener('abort', handleAbort, { once: true });
      tick();
    });
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

  function createResult(state, stopReason, allIds, completedIds, extra = {}) {
    const completed = completedIds.length;
    return {
      state,
      stop_reason: stopReason,
      total: allIds.length,
      completed,
      deleted_ids: [...completedIds],
      pending_ids: allIds.slice(completed),
      ...extra
    };
  }

  async function deleteConversationRemote({
    id,
    authToken,
    fetchImpl = globalThis.fetch,
    signal,
    now = Date.now
  }) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('id must be a non-empty string');
    }
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetchImpl must be a function');
    }

    let response;
    try {
      response = await fetchImpl(
        `${CONVERSATION_ENDPOINT}/${encodeURIComponent(id.trim())}`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ is_visible: false }),
          signal
        }
      );
    } catch (error) {
      return {
        ok: false,
        error_code:
          error?.name === 'AbortError' || signal?.aborted
            ? 'cancelled'
            : 'network_error',
        http_status: null,
        retry_after_ms: null
      };
    }

    if (response?.ok) {
      return {
        ok: true,
        error_code: null,
        http_status: Number.isInteger(response.status) ? response.status : null,
        retry_after_ms: null
      };
    }

    const status = Number.isInteger(response?.status) ? response.status : null;
    return {
      ok: false,
      error_code: status ? `http_${status}` : 'invalid_response',
      http_status: status,
      retry_after_ms: searchCore.parseRetryAfterMs(
        response?.headers?.get?.('Retry-After'),
        now()
      )
    };
  }

  async function preflightDeletion({ ids, store }) {
    const queue = uniqueIds(ids);
    if (!store || typeof store.getConversation !== 'function') {
      throw new TypeError('store must provide getConversation');
    }

    const result = {
      eligible: false,
      eligible_ids: [],
      ineligible_ids: [],
      missing_ids: []
    };

    for (const id of queue) {
      const record = await store.getConversation(id);
      if (!record) {
        result.missing_ids.push(id);
      } else if (conversationPolicy.isBulkDeletable(record)) {
        result.eligible_ids.push(id);
      } else {
        result.ineligible_ids.push(id);
      }
    }

    result.eligible = queue.length > 0 &&
      result.ineligible_ids.length === 0 &&
      result.missing_ids.length === 0;
    return result;
  }

  async function runDeletionQueue({
    ids,
    store,
    authToken,
    fetchImpl = globalThis.fetch,
    delayMs = DEFAULT_DELETE_DELAY_MS,
    now = Date.now,
    waitUntil = defaultWaitUntil,
    signal,
    onProgress = () => {}
  }) {
    const queue = uniqueIds(ids);
    if (!store || typeof store.getConversation !== 'function' ||
        typeof store.deleteConversation !== 'function') {
      throw new TypeError('store must provide getConversation and deleteConversation');
    }
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new TypeError('delayMs must be a non-negative number');
    }

    const deletedIds = [];
    const progress = (phase, extra = {}) => onProgress({
      phase,
      completed: deletedIds.length,
      total: queue.length,
      ...extra
    });

    if (queue.length > 0) {
      const preflight = await preflightDeletion({ ids: queue, store });
      if (signal?.aborted) {
        const result = createResult('cancelled', 'cancelled', queue, deletedIds);
        progress('cancelled', { current_id: queue[0] });
        return result;
      }
      if (!preflight.eligible) {
        const failureId = queue.find(id =>
          preflight.ineligible_ids.includes(id) || preflight.missing_ids.includes(id)
        );
        const stopReason = preflight.missing_ids.includes(failureId)
          ? 'missing_record'
          : 'protected_record';
        const result = createResult('stopped', stopReason, queue, deletedIds, {
          failure_id: failureId,
          preflight_failed: true,
          ineligible_ids: [...preflight.ineligible_ids],
          missing_ids: [...preflight.missing_ids]
        });
        progress('stopped', {
          current_id: failureId,
          reason: result.stop_reason,
          preflight: true
        });
        return result;
      }
    }

    for (let index = 0; index < queue.length; index += 1) {
      const id = queue[index];
      if (signal?.aborted) {
        const result = createResult('cancelled', 'cancelled', queue, deletedIds);
        progress('cancelled', { current_id: id });
        return result;
      }

      const record = await store.getConversation(id);
      if (signal?.aborted) {
        const result = createResult('cancelled', 'cancelled', queue, deletedIds);
        progress('cancelled', { current_id: id });
        return result;
      }
      if (!record) {
        const result = createResult('stopped', 'missing_record', queue, deletedIds, {
          failure_id: id
        });
        progress('stopped', { current_id: id, reason: result.stop_reason });
        return result;
      }
      if (!conversationPolicy.isBulkDeletable(record)) {
        const result = createResult('stopped', 'protected_record', queue, deletedIds, {
          failure_id: id
        });
        progress('stopped', { current_id: id, reason: result.stop_reason });
        return result;
      }

      progress('requesting', { current_id: id });
      const remoteResult = await deleteConversationRemote({
        id,
        authToken,
        fetchImpl,
        signal,
        now
      });
      if (!remoteResult.ok) {
        const cancelled = remoteResult.error_code === 'cancelled';
        const result = createResult(
          cancelled ? 'cancelled' : 'stopped',
          remoteResult.error_code,
          queue,
          deletedIds,
          {
            failure_id: id,
            retry_after_ms: remoteResult.retry_after_ms
          }
        );
        progress(cancelled ? 'cancelled' : 'stopped', {
          current_id: id,
          reason: result.stop_reason,
          retry_after_ms: remoteResult.retry_after_ms
        });
        return result;
      }

      try {
        await store.deleteConversation(id);
      } catch (_error) {
        const result = createResult('stopped', 'local_delete_error', queue, deletedIds, {
          failure_id: id,
          remote_deleted: true
        });
        progress('stopped', {
          current_id: id,
          reason: result.stop_reason,
          remote_deleted: true
        });
        return result;
      }
      deletedIds.push(id);
      progress('deleted', { current_id: id });

      if (index < queue.length - 1) {
        const nextAt = now() + delayMs;
        try {
          await waitUntil(nextAt, {
            signal,
            now,
            onTick: remainingMs => progress('waiting', {
              next_at: nextAt,
              remaining_ms: remainingMs
            })
          });
        } catch (error) {
          if (error?.name === 'AbortError' || signal?.aborted) {
            const result = createResult('cancelled', 'cancelled', queue, deletedIds);
            progress('cancelled');
            return result;
          }
          const result = createResult('stopped', 'wait_error', queue, deletedIds);
          progress('stopped', { reason: result.stop_reason });
          return result;
        }
      }
    }

    const result = createResult('complete', null, queue, deletedIds);
    progress('complete');
    return result;
  }

  return {
    CONVERSATION_ENDPOINT,
    DEFAULT_DELETE_DELAY_MS,
    DEFAULT_DELETE_INTERVAL_SECONDS,
    MIN_DELETE_INTERVAL_SECONDS,
    defaultWaitUntil,
    deleteConversationRemote,
    deleteIntervalSecondsToMs,
    parseDeleteIntervalSeconds,
    preflightDeletion,
    runDeletionQueue
  };
});
