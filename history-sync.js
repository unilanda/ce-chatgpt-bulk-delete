(function attachHistorySync(root, factory) {
  const policy =
    typeof module === 'object' && module.exports
      ? require('./conversation-policy.js')
      : root.ConversationPolicy;
  const api = factory(policy);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HistorySync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createHistorySync(
  conversationPolicy
) {
  'use strict';

  if (!conversationPolicy) throw new Error('ConversationPolicy is required');

  const HISTORY_ENDPOINT = 'https://chatgpt.com/backend-api/conversations';
  const PAGE_SIZE = 20;

  function parseMaximum(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '' || trimmed.toLowerCase() === 'all') return null;
      value = Number(trimmed);
    }
    if (!Number.isInteger(value) || value < 1) {
      throw new TypeError('History maximum must be All or a positive integer');
    }
    return value;
  }

  function buildHistoryUrl({ offset, limit }) {
    if (!Number.isInteger(offset) || offset < 0) {
      throw new TypeError('History offset must be a non-negative integer');
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE) {
      throw new TypeError(`History limit must be between 1 and ${PAGE_SIZE}`);
    }
    const params = new URLSearchParams({
      exclude_conversation_origin: 'tpp',
      expand: 'false',
      hide_snorlax: 'false',
      is_archived: 'false',
      is_starred: 'false',
      limit: String(limit),
      order: 'updated',
      offset: String(offset)
    });
    return `${HISTORY_ENDPOINT}?${params.toString()}`;
  }

  function parseRetryAfterMs(value, nowMilliseconds) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const dateMilliseconds = Date.parse(value);
    if (!Number.isFinite(dateMilliseconds)) return null;
    return Math.max(0, dateMilliseconds - nowMilliseconds);
  }

  function createSummary(maximum) {
    return {
      state: 'running',
      stop_reason: null,
      requested_maximum: maximum,
      pages: 0,
      fetched: 0,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skipped: 0,
      removed_stale: 0,
      total_local: 0,
      remote_total: null,
      complete_inventory: false,
      retry_after_ms: null
    };
  }

  function validateStore(store) {
    for (const method of [
      'getConversation',
      'saveConversation',
      'getAllConversations',
      'deleteConversation'
    ]) {
      if (typeof store?.[method] !== 'function') {
        throw new TypeError(`History store must provide ${method}`);
      }
    }
  }

  function isAbort(error, signal) {
    return error?.name === 'AbortError' || signal?.aborted;
  }

  async function runHistorySync({
    maximum = null,
    store,
    authToken,
    fetchImpl = globalThis.fetch,
    signal = null,
    onProgress = () => {},
    now = Date.now,
    pageSize = PAGE_SIZE,
    pageDelayMs = 0,
    sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  }) {
    const requestedMaximum = parseMaximum(maximum);
    validateStore(store);
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('History Sync requires fetchImpl');
    }
    if (typeof onProgress !== 'function') {
      throw new TypeError('History Sync onProgress must be a function');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE) {
      throw new TypeError(`History pageSize must be between 1 and ${PAGE_SIZE}`);
    }
    if (!Number.isFinite(pageDelayMs) || pageDelayMs < 0) {
      throw new TypeError('History pageDelayMs must be a non-negative number');
    }
    if (typeof sleep !== 'function') {
      throw new TypeError('History Sync sleep must be a function');
    }

    const summary = createSummary(requestedMaximum);
    const seenIds = new Set();
    let offset = 0;

    async function finish(state, stopReason) {
      summary.state = state;
      summary.stop_reason = stopReason;
      summary.total_local = (await store.getAllConversations()).length;
      onProgress({ phase: 'complete', ...summary });
      return summary;
    }

    while (true) {
      if (signal?.aborted) return finish('cancelled', 'cancelled');
      const remaining = requestedMaximum === null
        ? pageSize
        : requestedMaximum - summary.fetched;
      if (remaining <= 0) return finish('complete', 'maximum_reached');
      const requestLimit = Math.min(pageSize, remaining);

      let response;
      try {
        response = await fetchImpl(buildHistoryUrl({
          offset,
          limit: requestLimit
        }), {
          method: 'GET',
          headers: { Authorization: `Bearer ${authToken}` },
          signal
        });
      } catch (error) {
        if (isAbort(error, signal)) return finish('cancelled', 'cancelled');
        return finish(summary.fetched > 0 ? 'partial' : 'failed', 'network_error');
      }

      const status = Number.isInteger(response?.status) ? response.status : null;
      if (!response?.ok) {
        if (status === 429) {
          summary.retry_after_ms = parseRetryAfterMs(
            response?.headers?.get?.('Retry-After'),
            now()
          );
        }
        return finish(
          summary.fetched > 0 ? 'partial' : 'failed',
          status === null ? 'http_error' : `http_${status}`
        );
      }

      let page;
      try {
        page = await response.json();
      } catch (_error) {
        return finish(
          summary.fetched > 0 ? 'partial' : 'failed',
          'malformed_response'
        );
      }
      if (!page || typeof page !== 'object' || !Array.isArray(page.items)) {
        return finish(
          summary.fetched > 0 ? 'partial' : 'failed',
          'malformed_response'
        );
      }

      const items = page.items.slice(0, remaining);
      if (Number.isFinite(page.total) && page.total >= 0) {
        summary.remote_total = page.total;
      }
      summary.pages += 1;
      summary.fetched += items.length;

      for (const item of items) {
        if (!item || typeof item.id !== 'string' || item.id.trim() === '') {
          summary.skipped += 1;
          continue;
        }
        seenIds.add(item.id);
        let incoming;
        try {
          incoming = conversationPolicy.historyItemToRecord(item);
        } catch (_error) {
          summary.skipped += 1;
          continue;
        }
        const existing = await store.getConversation(incoming.id);
        const merged = conversationPolicy.mergeConversationRecords(existing, incoming);
        if (!existing) {
          await store.saveConversation(merged);
          summary.inserted += 1;
        } else if (
          conversationPolicy.recordsEqual(
            conversationPolicy.normalizeConversationRecord(existing),
            merged
          )
        ) {
          summary.unchanged += 1;
        } else {
          await store.saveConversation(merged);
          summary.updated += 1;
        }
      }

      onProgress({ phase: 'page', ...summary });

      offset += items.length;
      if (requestedMaximum !== null && summary.fetched >= requestedMaximum) {
        return finish('complete', 'maximum_reached');
      }

      const reportedEnd =
        summary.remote_total !== null && offset >= summary.remote_total;
      const shortPage = items.length < requestLimit;
      if (items.length === 0 || reportedEnd || shortPage) {
        if (requestedMaximum === null) {
          summary.complete_inventory = true;
          const localRecords = await store.getAllConversations();
          for (const localRecord of localRecords) {
            const normalized =
              conversationPolicy.normalizeConversationRecord(localRecord);
            const cameFromHistory =
              normalized.discovery_sources.includes('history') ||
              normalized.raw_data !== undefined;
            if (cameFromHistory && !seenIds.has(normalized.id)) {
              await store.deleteConversation(normalized.id);
              summary.removed_stale += 1;
            }
          }
        }
        return finish('complete', 'remote_end');
      }
      if (pageDelayMs > 0) await sleep(pageDelayMs);
    }
  }

  return {
    HISTORY_ENDPOINT,
    PAGE_SIZE,
    buildHistoryUrl,
    parseMaximum,
    runHistorySync
  };
});
