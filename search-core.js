(function attachSearchCore(root, factory) {
  const timestampUtils =
    typeof module === 'object' && module.exports
      ? require('./timestamp-utils.js')
      : root.TimestampUtils;
  const api = factory(timestampUtils);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.SearchCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSearchCore(
  timestampUtils
) {
  'use strict';

  if (!timestampUtils) throw new Error('TimestampUtils is required');

  const SEARCH_ENDPOINT = 'https://chatgpt.com/backend-api/global/search';
  const DEFAULT_LIMIT = 10;
  const DEFAULT_MAX_PAGES = 50;
  const DEFAULT_PAGE_DELAY_MS = 750;
  const DEFAULT_RETRY_DELAY_MS = 2000;
  const DEFAULT_SOURCE_REQUESTS = Object.freeze([
    Object.freeze({ type: 'conversation' })
  ]);

  class SearchSchemaError extends Error {
    constructor(message) {
      super(message);
      this.name = 'SearchSchemaError';
    }
  }

  class SearchRequestError extends Error {
    constructor(message, {
      status = null,
      retryAfterMs = null,
      code = 'request_failed'
    } = {}) {
      super(message);
      this.name = 'SearchRequestError';
      this.status = status;
      this.retryAfterMs = retryAfterMs;
      this.code = code;
    }
  }

  function defaultQueryIdFactory() {
    if (!globalThis.crypto || typeof globalThis.crypto.randomUUID !== 'function') {
      throw new Error('crypto.randomUUID is required to create a search query session');
    }
    return globalThis.crypto.randomUUID();
  }

  function buildSearchRequest({
    query,
    queryId,
    cursor = null,
    limit = DEFAULT_LIMIT,
    sourceRequests = DEFAULT_SOURCE_REQUESTS
  }) {
    if (typeof query !== 'string' || query.trim() === '') {
      throw new TypeError('Search query must be a non-empty string');
    }
    if (typeof queryId !== 'string' || queryId.trim() === '') {
      throw new TypeError('queryId must be a non-empty string');
    }
    if (cursor !== null && typeof cursor !== 'string') {
      throw new TypeError('cursor must be null or an opaque string');
    }
    if (!Number.isInteger(limit) || limit < 1) {
      throw new TypeError('limit must be a positive integer');
    }
    if (!Array.isArray(sourceRequests) || sourceRequests.length === 0) {
      throw new TypeError('sourceRequests must be a non-empty array');
    }

    return {
      entrypoint: 'global_search',
      limit,
      query: query.trim(),
      query_id: queryId,
      cursor,
      source_requests: sourceRequests.map(source => ({ ...source }))
    };
  }

  function findConversationStatus(sourceStatuses) {
    if (Array.isArray(sourceStatuses)) {
      return sourceStatuses.find(status => {
        if (!status || typeof status !== 'object') return false;
        return [
          status.source_type,
          status.source_key,
          status.type,
          status.source
        ].includes('conversation');
      }) || null;
    }

    if (sourceStatuses && typeof sourceStatuses === 'object') {
      if (
        sourceStatuses.conversation &&
        typeof sourceStatuses.conversation === 'object'
      ) {
        return sourceStatuses.conversation;
      }
      return Object.values(sourceStatuses).find(status => {
        if (!status || typeof status !== 'object') return false;
        return [
          status.source_type,
          status.source_key,
          status.type,
          status.source
        ].includes('conversation');
      }) || null;
    }

    return null;
  }

  function parseSearchResponse(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new SearchSchemaError('Search response must be an object');
    }
    if (!Array.isArray(body.items)) {
      throw new SearchSchemaError('Search response items must be an array');
    }
    if (body.cursor !== null && body.cursor !== undefined && typeof body.cursor !== 'string') {
      throw new SearchSchemaError('Search response cursor must be null or an opaque string');
    }

    const conversationStatus = findConversationStatus(body.source_statuses);
    if (!conversationStatus || typeof conversationStatus.has_more !== 'boolean') {
      throw new SearchSchemaError(
        'Search response is missing a conversation source status with boolean has_more'
      );
    }

    return {
      items: body.items,
      cursor: body.cursor ?? null,
      conversationHasMore: conversationStatus.has_more,
      topLevelKeys: Object.keys(body).sort()
    };
  }

  function itemSourceType(item) {
    if (!item || typeof item !== 'object') return 'unknown';
    return item.source_type || item.source_key || item.payload?.kind || 'unknown';
  }

  function extractConversationHits(items) {
    const conversations = new Map();
    const warnings = [];
    const nonConversationSourceTypes = new Set();
    let hits = 0;

    for (const item of items) {
      const isConversation = Boolean(
        item &&
        item.source_type === 'conversation' &&
        item.source_key === 'conversation' &&
        item.payload &&
        item.payload.kind === 'conversation'
      );

      if (!isConversation) {
        nonConversationSourceTypes.add(itemSourceType(item));
        continue;
      }

      const id = item.payload.conversation_id;
      if (typeof id !== 'string' || id.trim() === '') {
        warnings.push('Conversation result missing conversation_id was ignored');
        continue;
      }

      hits += 1;
      const existing = conversations.get(id);
      const matchKind =
        typeof item.match_kind === 'string' && item.match_kind
          ? item.match_kind
          : 'unknown';
      const candidate = {
        id,
        title: typeof item.title === 'string' ? item.title : '',
        update_time:
          typeof item.update_time === 'string' ||
          typeof item.update_time === 'number'
            ? item.update_time
            : null,
        is_archived:
          typeof item.payload.is_archived === 'boolean'
            ? item.payload.is_archived
            : null,
        is_starred:
          typeof item.payload.is_starred === 'boolean'
            ? item.payload.is_starred
            : null,
        hit_count: 1,
        match_kinds: [matchKind]
      };

      if (!existing) {
        conversations.set(id, candidate);
        continue;
      }

      const candidateIsNewer = timestampUtils.isTimestampNewer(
        candidate.update_time,
        existing.update_time
      );
      if (candidateIsNewer) {
        existing.title = candidate.title || existing.title;
        existing.update_time = candidate.update_time;
        existing.is_archived = candidate.is_archived;
        existing.is_starred = candidate.is_starred;
      } else {
        existing.title = existing.title || candidate.title;
        existing.update_time = existing.update_time || candidate.update_time;
        existing.is_archived ??= candidate.is_archived;
        existing.is_starred ??= candidate.is_starred;
      }
      existing.hit_count += 1;
      if (!existing.match_kinds.includes(matchKind)) {
        existing.match_kinds.push(matchKind);
        existing.match_kinds.sort();
      }
    }

    return {
      conversations,
      hits,
      warnings,
      nonConversationSourceTypes
    };
  }

  function mergePageExtraction(target, pageExtraction) {
    target.hits += pageExtraction.hits;
    target.warnings.push(...pageExtraction.warnings);
    for (const sourceType of pageExtraction.nonConversationSourceTypes) {
      target.nonConversationSourceTypes.add(sourceType);
    }
    for (const [id, candidate] of pageExtraction.conversations) {
      const existing = target.conversations.get(id);
      if (!existing) {
        target.conversations.set(id, {
          ...candidate,
          match_kinds: [...candidate.match_kinds]
        });
        continue;
      }

      const candidateIsNewer = timestampUtils.isTimestampNewer(
        candidate.update_time,
        existing.update_time
      );
      if (candidateIsNewer) {
        existing.title = candidate.title || existing.title;
        existing.update_time = candidate.update_time;
        existing.is_archived = candidate.is_archived;
        existing.is_starred = candidate.is_starred;
      }
      existing.hit_count += candidate.hit_count;
      existing.match_kinds = Array.from(
        new Set([...existing.match_kinds, ...candidate.match_kinds])
      ).sort();
    }
  }

  function parseRetryAfterMs(value, now = Date.now()) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return Number(trimmed) * 1000;
    }
    const retryDate = Date.parse(trimmed);
    if (!Number.isFinite(retryDate)) return null;
    return Math.max(0, retryDate - now);
  }

  function abortError() {
    const error = new Error('Operation cancelled');
    error.name = 'AbortError';
    return error;
  }

  function throwIfAborted(signal) {
    if (signal?.aborted) throw abortError();
  }

  function defaultSleep(ms, signal) {
    if (ms <= 0) return Promise.resolve();
    return new Promise((resolve, reject) => {
      throwIfAborted(signal);
      const timeout = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(abortError());
        }, { once: true });
      }
    });
  }

  async function fetchSearchPage({
    body,
    authToken,
    fetchImpl,
    signal,
    maxRetries,
    retryDelayMs,
    sleep
  }) {
    let attempt = 0;
    while (true) {
      throwIfAborted(signal);
      let response;
      try {
        response = await fetchImpl(SEARCH_ENDPOINT, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body),
          signal
        });
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw abortError();
        if (attempt < maxRetries) {
          attempt += 1;
          await sleep(retryDelayMs, signal);
          continue;
        }
        throw new SearchRequestError('Search request failed', {
          code: 'network_error'
        });
      }

      if (response.ok) {
        let responseBody;
        try {
          responseBody = await response.json();
        } catch (_error) {
          throw new SearchSchemaError('Search response body is not valid JSON');
        }
        return {
          body: responseBody,
          httpStatus: response.status
        };
      }

      const retryAfterMs = parseRetryAfterMs(
        response.headers?.get?.('Retry-After')
      );
      if (response.status === 429) {
        throw new SearchRequestError('Search request was rate limited', {
          status: 429,
          retryAfterMs,
          code: 'http_429'
        });
      }
      if (response.status >= 500 && attempt < maxRetries) {
        attempt += 1;
        await sleep(retryDelayMs, signal);
        continue;
      }
      throw new SearchRequestError(`Search request failed with HTTP ${response.status}`, {
        status: response.status,
        retryAfterMs,
        code: `http_${response.status}`
      });
    }
  }

  function createResult(query, queryId) {
    return {
      query,
      query_id: queryId,
      state: 'complete',
      stop_reason: null,
      pages: 0,
      hits: 0,
      conversations: [],
      non_conversation_source_types: [],
      warnings: [],
      retry_after_ms: null
    };
  }

  async function runSearchQuery({
    query,
    authToken,
    fetchImpl = globalThis.fetch,
    queryIdFactory = defaultQueryIdFactory,
    sourceRequests = DEFAULT_SOURCE_REQUESTS,
    limit = DEFAULT_LIMIT,
    maxPages = DEFAULT_MAX_PAGES,
    pageDelayMs = DEFAULT_PAGE_DELAY_MS,
    maxRetries = 1,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    sleep = defaultSleep,
    signal = null,
    onProgress = null
  }) {
    const normalizedQuery = typeof query === 'string' ? query.trim() : '';
    const queryId = queryIdFactory();
    const result = createResult(normalizedQuery, queryId);
    const aggregate = {
      conversations: new Map(),
      hits: 0,
      warnings: [],
      nonConversationSourceTypes: new Set()
    };
    const seenCursors = new Set();
    let cursor = null;

    function finish(state, stopReason, error = null) {
      result.state = state;
      result.stop_reason = stopReason;
      result.hits = aggregate.hits;
      result.conversations = Array.from(aggregate.conversations.values());
      result.non_conversation_source_types = Array.from(
        aggregate.nonConversationSourceTypes
      ).sort();
      result.warnings = [...aggregate.warnings];
      if (error) {
        result.error = error.message;
        result.retry_after_ms = error.retryAfterMs ?? null;
      }
      return result;
    }

    try {
      if (!normalizedQuery) {
        throw new TypeError('Search query must be a non-empty string');
      }
      if (typeof fetchImpl !== 'function') {
        throw new TypeError('fetchImpl must be a function');
      }
      if (!Number.isInteger(maxPages) || maxPages < 1) {
        throw new TypeError('maxPages must be a positive integer');
      }

      while (result.pages < maxPages) {
        throwIfAborted(signal);
        const requestBody = buildSearchRequest({
          query: normalizedQuery,
          queryId,
          cursor,
          limit,
          sourceRequests
        });
        const pageResponse = await fetchSearchPage({
          body: requestBody,
          authToken,
          fetchImpl,
          signal,
          maxRetries,
          retryDelayMs,
          sleep
        });
        const parsed = parseSearchResponse(pageResponse.body);
        const extracted = extractConversationHits(parsed.items);
        mergePageExtraction(aggregate, extracted);
        result.pages += 1;

        if (typeof onProgress === 'function') {
          onProgress({
            query: normalizedQuery,
            pages: result.pages,
            hits: aggregate.hits,
            uniqueConversations: aggregate.conversations.size
          });
        }

        if (!parsed.conversationHasMore) {
          return finish('complete', null);
        }
        if (!parsed.cursor) {
          return finish('partial', 'missing_cursor');
        }
        if (parsed.cursor === cursor || seenCursors.has(parsed.cursor)) {
          return finish('partial', 'repeated_cursor');
        }
        seenCursors.add(parsed.cursor);
        cursor = parsed.cursor;

        if (result.pages >= maxPages) {
          return finish('partial', 'max_pages');
        }
        await sleep(pageDelayMs, signal);
      }

      return finish('partial', 'max_pages');
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) {
        return finish('cancelled', 'cancelled');
      }
      if (error instanceof SearchSchemaError) {
        return finish(
          result.pages > 0 ? 'partial' : 'failed',
          'malformed_response',
          error
        );
      }
      if (error instanceof SearchRequestError) {
        return finish(
          result.pages > 0 ? 'partial' : 'failed',
          error.code,
          error
        );
      }
      return finish(result.pages > 0 ? 'partial' : 'failed', 'invalid_input', error);
    }
  }

  function createDiagnosticReport({ httpStatus, body }) {
    const topLevelKeys =
      body && typeof body === 'object' && !Array.isArray(body)
        ? Object.keys(body).sort()
        : [];
    const items = Array.isArray(body?.items) ? body.items : [];
    const extracted = extractConversationHits(items);
    let conversationHasMore = null;
    const warnings = [...extracted.warnings];

    try {
      conversationHasMore = parseSearchResponse(body).conversationHasMore;
    } catch (error) {
      warnings.push(error.message);
    }

    return {
      http_status: httpStatus,
      top_level_response_keys: topLevelKeys,
      item_count: items.length,
      conversation_count: extracted.hits,
      non_conversation_source_types: Array.from(
        extracted.nonConversationSourceTypes
      ).sort(),
      cursor_present: Boolean(body?.cursor),
      conversation_has_more: conversationHasMore,
      schema_warnings: warnings
    };
  }

  async function runSearchDiagnostic({
    query,
    authToken,
    fetchImpl = globalThis.fetch,
    queryIdFactory = defaultQueryIdFactory,
    sourceRequests = DEFAULT_SOURCE_REQUESTS,
    limit = DEFAULT_LIMIT,
    maxPages = 1,
    pageDelayMs = DEFAULT_PAGE_DELAY_MS,
    sleep = defaultSleep,
    signal = null
  }) {
    const boundedMaxPages = Math.min(2, Math.max(1,
      Number.isFinite(maxPages) ? Math.floor(maxPages) : 1
    ));
    const report = {
      state: 'complete',
      stop_reason: null,
      pages: 0,
      http_status: null,
      page_http_statuses: [],
      top_level_response_keys: [],
      item_count: 0,
      conversation_count: 0,
      non_conversation_source_types: [],
      cursor_present: false,
      conversation_has_more: null,
      schema_warnings: [],
      retry_after_ms: null
    };
    const topLevelKeys = new Set();
    const nonConversationSourceTypes = new Set();
    const warnings = [];
    const seenCursors = new Set();
    let cursor = null;

    function finish(state, stopReason) {
      report.state = state;
      report.stop_reason = stopReason;
      report.top_level_response_keys = Array.from(topLevelKeys).sort();
      report.non_conversation_source_types = Array.from(
        nonConversationSourceTypes
      ).sort();
      report.schema_warnings = Array.from(new Set(warnings));
      return report;
    }

    try {
      const queryId = queryIdFactory();
      for (let page = 0; page < boundedMaxPages; page += 1) {
        const request = buildSearchRequest({
          query,
          queryId,
          cursor,
          limit,
          sourceRequests
        });
        const fetched = await fetchSearchPage({
          body: request,
          authToken,
          fetchImpl,
          signal,
          maxRetries: 0,
          retryDelayMs: 0,
          sleep
        });
        const pageReport = createDiagnosticReport({
          httpStatus: fetched.httpStatus,
          body: fetched.body
        });
        report.pages += 1;
        report.http_status = pageReport.http_status;
        report.page_http_statuses.push(pageReport.http_status);
        report.item_count += pageReport.item_count;
        report.conversation_count += pageReport.conversation_count;
        report.cursor_present = pageReport.cursor_present;
        report.conversation_has_more = pageReport.conversation_has_more;
        for (const key of pageReport.top_level_response_keys) topLevelKeys.add(key);
        for (const type of pageReport.non_conversation_source_types) {
          nonConversationSourceTypes.add(type);
        }
        warnings.push(...pageReport.schema_warnings);

        let parsed;
        try {
          parsed = parseSearchResponse(fetched.body);
        } catch (error) {
          warnings.push(error.message);
          return finish(report.pages > 1 ? 'partial' : 'failed', 'malformed_response');
        }
        if (!parsed.conversationHasMore) return finish('complete', null);
        if (!parsed.cursor) return finish('partial', 'missing_cursor');
        if (parsed.cursor === cursor || seenCursors.has(parsed.cursor)) {
          return finish('partial', 'repeated_cursor');
        }
        seenCursors.add(parsed.cursor);
        cursor = parsed.cursor;
        if (report.pages >= boundedMaxPages) {
          return finish('partial', 'diagnostic_page_limit');
        }
        await sleep(pageDelayMs, signal);
      }
      return finish('partial', 'diagnostic_page_limit');
    } catch (error) {
      if (error?.name === 'AbortError' || signal?.aborted) {
        return finish('cancelled', 'cancelled');
      }
      if (error instanceof SearchRequestError) {
        report.http_status = error.status;
        if (error.status !== null) report.page_http_statuses.push(error.status);
        report.retry_after_ms = error.retryAfterMs ?? null;
        return finish('failed', error.code);
      }
      if (error instanceof SearchSchemaError) {
        warnings.push(error.message);
        return finish('failed', 'malformed_response');
      }
      return finish('failed', 'invalid_input');
    }
  }

  return {
    DEFAULT_LIMIT,
    DEFAULT_MAX_PAGES,
    DEFAULT_SOURCE_REQUESTS,
    SEARCH_ENDPOINT,
    SearchRequestError,
    SearchSchemaError,
    buildSearchRequest,
    createDiagnosticReport,
    extractConversationHits,
    parseRetryAfterMs,
    parseSearchResponse,
    runSearchDiagnostic,
    runSearchQuery
  };
});
