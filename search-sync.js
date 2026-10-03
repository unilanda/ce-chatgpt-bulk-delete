(function attachSearchSync(root, factory) {
  const policy =
    typeof module === 'object' && module.exports
      ? require('./conversation-policy.js')
      : root.ConversationPolicy;
  const api = factory(policy);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.SearchSync = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSearchSync(policy) {
  'use strict';

  if (!policy) throw new Error('ConversationPolicy is required');

  function normalizeQueries(input) {
    const values = Array.isArray(input)
      ? input
      : typeof input === 'string'
        ? input.split(/[\n,]/)
        : [];
    const seen = new Set();
    const queries = [];
    for (const value of values) {
      if (typeof value !== 'string') continue;
      const query = value.trim();
      if (!query || seen.has(query)) continue;
      seen.add(query);
      queries.push(query);
    }
    return queries;
  }

  function mergeDiscovery(existing, hit, query) {
    const incoming = policy.searchHitToRecord(hit, query);
    if (!existing) return incoming;

    const merged = policy.mergeConversationRecords(existing, incoming);
    merged.search_metadata.hit_count =
      (existing.search_metadata?.hit_count || 0) +
      (incoming.search_metadata?.hit_count || 0);
    merged.search_metadata.queries = Array.from(new Set([
      ...(existing.search_metadata?.queries || []),
      query
    ])).sort();
    return merged;
  }

  function publicQueryOutcome(outcome) {
    return {
      query: outcome.query,
      state: outcome.state,
      stop_reason: outcome.stop_reason,
      pages: outcome.pages,
      hits: outcome.hits,
      unique_conversations: outcome.conversations.length,
      warnings: [...(outcome.warnings || [])],
      error: outcome.error || null,
      retry_after_ms: outcome.retry_after_ms ?? null
    };
  }

  async function runSearchSync({
    queries,
    store,
    runQuery,
    signal = null,
    onProgress = null
  }) {
    const normalizedQueries = normalizeQueries(queries);
    if (normalizedQueries.length === 0) {
      throw new TypeError('Search Sync requires at least one non-empty query');
    }
    if (!store || typeof store.getConversation !== 'function' || typeof store.saveConversation !== 'function') {
      throw new TypeError('Search Sync requires a conversation store');
    }
    if (typeof runQuery !== 'function') {
      throw new TypeError('Search Sync requires runQuery');
    }

    const summary = {
      state: 'complete',
      stop_reason: null,
      pages: 0,
      hits: 0,
      unique_conversations: 0,
      inserted: 0,
      updated: 0,
      skipped: 0,
      protected: 0,
      queries: [],
      not_started_queries: [],
      retry_after_ms: null
    };
    const discoveries = new Map();
    let stopIndex = normalizedQueries.length;

    for (let index = 0; index < normalizedQueries.length; index += 1) {
      const query = normalizedQueries[index];
      if (signal?.aborted) {
        summary.state = 'cancelled';
        summary.stop_reason = 'cancelled';
        stopIndex = index;
        break;
      }

      const outcome = await runQuery(query, {
        signal,
        onProgress(progress) {
          if (typeof onProgress === 'function') {
            onProgress({
              phase: 'query',
              current_query: query,
              ...progress,
              unique_conversations:
                progress.unique_conversations ?? progress.uniqueConversations ?? 0
            });
          }
        }
      });
      summary.queries.push(publicQueryOutcome(outcome));
      summary.pages += outcome.pages;
      summary.hits += outcome.hits;

      for (const hit of outcome.conversations) {
        discoveries.set(
          hit.id,
          mergeDiscovery(discoveries.get(hit.id), hit, query)
        );
      }

      if (outcome.state === 'cancelled') {
        summary.state = 'cancelled';
        summary.stop_reason = 'cancelled';
        stopIndex = index + 1;
        break;
      }
      if (outcome.stop_reason === 'http_429') {
        summary.state = index === 0 && discoveries.size === 0 ? 'failed' : 'partial';
        summary.stop_reason = 'http_429';
        summary.retry_after_ms = outcome.retry_after_ms ?? null;
        stopIndex = index + 1;
        break;
      }
    }

    summary.not_started_queries = normalizedQueries.slice(stopIndex);
    summary.unique_conversations = discoveries.size;

    for (const [id, discovered] of discoveries) {
      const existing = await store.getConversation(id);
      const merged = policy.mergeConversationRecords(existing, discovered);
      if (policy.isProtected(merged)) summary.protected += 1;

      if (!existing) {
        await store.saveConversation(merged);
        summary.inserted += 1;
      } else if (policy.recordsEqual(policy.normalizeConversationRecord(existing), merged)) {
        summary.skipped += 1;
      } else {
        await store.saveConversation(merged);
        summary.updated += 1;
      }

      if (typeof onProgress === 'function') {
        onProgress({
          phase: 'persist',
          unique_conversations: summary.unique_conversations,
          inserted: summary.inserted,
          updated: summary.updated,
          skipped: summary.skipped,
          protected: summary.protected
        });
      }
    }

    if (summary.state === 'complete') {
      const hasIncomplete = summary.queries.some(
        outcome => outcome.state !== 'complete'
      );
      if (hasIncomplete) {
        summary.state = 'partial';
        summary.stop_reason = 'query_incomplete';
      }
    }
    return summary;
  }

  return {
    normalizeQueries,
    runSearchSync
  };
});
