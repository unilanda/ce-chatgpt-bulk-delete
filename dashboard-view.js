(function attachDashboardView(root, factory) {
  const timestampUtils =
    typeof module === 'object' && module.exports
      ? require('./timestamp-utils.js')
      : root.TimestampUtils;
  const api = factory(timestampUtils);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.DashboardView = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createDashboardView(
  timestampUtils
) {
  'use strict';

  if (!timestampUtils) throw new Error('TimestampUtils is required');

  function number(value) {
    return Number.isFinite(value) ? value : 0;
  }

  function formatSearchProgress(progress = {}) {
    return [
      `Query: ${progress.current_query || '—'}`,
      `pages ${number(progress.pages)}`,
      `hits ${number(progress.hits)}`,
      `unique ${number(progress.unique_conversations)}`,
      `inserted ${number(progress.inserted)}`,
      `updated ${number(progress.updated)}`,
      `skipped ${number(progress.skipped)}`,
      `protected ${number(progress.protected)}`
    ].join(' · ');
  }

  function formatSearchSummary(summary) {
    const totalParts = [
      `Search Sync: ${summary.state}`,
      `pages ${number(summary.pages)}`,
      `hits ${number(summary.hits)}`,
      `unique ${number(summary.unique_conversations)}`,
      `inserted ${number(summary.inserted)}`,
      `updated ${number(summary.updated)}`,
      `skipped ${number(summary.skipped)}`,
      `protected ${number(summary.protected)}`
    ];
    if (Number.isFinite(summary.retry_after_ms)) {
      totalParts.push(
        `Retry-After ${Math.ceil(summary.retry_after_ms / 1000)} seconds`
      );
    }
    const totals = totalParts.join(' · ');
    const queries = (summary.queries || []).map(query => {
      const reason = query.stop_reason ? ` (${query.stop_reason})` : '';
      return `${query.query}: ${query.state}${reason} — pages ${number(query.pages)}, hits ${number(query.hits)}`;
    });
    if (summary.not_started_queries?.length) {
      queries.push(`Not started: ${summary.not_started_queries.join(', ')}`);
    }
    return [totals, ...queries].join('\n');
  }

  function formatHistoryStatus(summary = {}) {
    const fetched = number(summary.fetched);
    if (summary.state === 'complete') {
      return `History loaded — ${fetched} fetched · ${number(summary.inserted)} added · ` +
        `${number(summary.updated)} updated · ${number(summary.unchanged)} unchanged`;
    }
    if (summary.state === 'partial' && summary.stop_reason === 'http_429') {
      return `History partially loaded. ${fetched} conversations were fetched before ` +
        'ChatGPT temporarily stopped responding. Your existing conversations were kept. ' +
        'Retry later.';
    }
    if (summary.state === 'partial') {
      return `History partially loaded — ${fetched} fetched. ` +
        'Your existing conversations were kept. Retry later.';
    }
    if (summary.state === 'cancelled') {
      return `History loading stopped — ${fetched} fetched. ` +
        'Your existing conversations were kept.';
    }
    return 'History could not be loaded. Your existing conversations were kept.';
  }

  function formatHistoryDetails(summary = {}) {
    return `${number(summary.total_local)} conversations in local inventory`;
  }

  function retryAfterSuffix(summary = {}) {
    return Number.isFinite(summary.retry_after_ms)
      ? ` Retry-After ${Math.ceil(summary.retry_after_ms / 1000)} seconds.`
      : '';
  }

  function formatRebuildStatus(summary = {}) {
    const fetched = number(summary.fetched);
    if (summary.state === 'complete' && summary.complete_inventory) {
      return `Inventory rebuilt from ChatGPT — ${fetched} conversations loaded.`;
    }
    if (summary.state === 'partial') {
      const reason = summary.stop_reason === 'http_429'
        ? 'ChatGPT temporarily rate-limited History.'
        : 'History stopped before reaching the end.';
      return `Inventory rebuild is partial — ${fetched} conversations loaded. ` +
        reason + retryAfterSuffix(summary);
    }
    if (summary.state === 'cancelled') {
      return `Inventory rebuild stopped — ${fetched} conversations loaded so far.`;
    }
    return fetched > 0
      ? `Inventory rebuild stopped — ${fetched} conversations loaded so far.`
      : 'Inventory rebuild failed before any conversation was loaded. The local inventory is empty.' +
        retryAfterSuffix(summary);
  }

  function formatRebuildDetails(summary = {}) {
    if (summary.state === 'complete' && summary.complete_inventory) {
      return `${number(summary.total_local)} conversations in local inventory · complete History rebuild`;
    }
    return `${number(summary.total_local)} conversations in local inventory · partial/unknown coverage`;
  }

  function shouldOfferSearchRecovery(summary = {}) {
    return summary.state === 'partial' || summary.state === 'failed';
  }

  function formatSearchStatus(summary = {}, query = '') {
    const count = number(summary.unique_conversations);
    const noun = count === 1 ? 'conversation' : 'conversations';
    const label = String(query).trim();
    return label
      ? `${count} matching ${noun} found for “${label}”.`
      : `${count} matching ${noun} found.`;
  }

  function formatSelectionCount(count) {
    return `${number(count)} selected`;
  }

  function formatDeletionProgress(progress = {}) {
    const completed = number(progress.completed);
    const total = number(progress.total);
    const base = `${completed} of ${total} deleted`;
    if (progress.phase !== 'waiting') return base;

    const seconds = Math.max(0, Math.ceil(number(progress.remaining_ms) / 1000));
    const minutesPart = Math.floor(seconds / 60);
    const secondsPart = String(seconds % 60).padStart(2, '0');
    return `${base} · Next deletion in ${minutesPart}:${secondsPart}`;
  }

  function formatEligibilityProgress(progress = {}) {
    const parts = [
      `Eligibility: ${progress.state || progress.phase || 'running'}`,
      `progress ${number(progress.processed)}/${number(progress.queued)}`,
      `standalone ${number(progress.verified_standalone)}`,
      `Project ${number(progress.protected_project)}`,
      `Custom GPT ${number(progress.protected_custom_gpt)}`,
      `unknown ${number(progress.still_unknown)}`,
      `failed ${number(progress.failed)}`,
      `rate-limited ${number(progress.rate_limited)}`
    ];
    if (Number.isFinite(progress.retry_after_ms)) {
      parts.push(`Retry-After ${Math.ceil(progress.retry_after_ms / 1000)} seconds`);
    }
    return parts.join(' · ');
  }

  function formatConversationDate(value, {
    formatDateTime = milliseconds => {
      const date = new Date(milliseconds);
      return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })}`;
    }
  } = {}) {
    const milliseconds = timestampUtils.toEpochMilliseconds(value);
    return milliseconds === null ? 'Unknown' : formatDateTime(milliseconds);
  }

  function classificationLabel(classification) {
    switch (classification) {
      case 'standalone-safe':
        return 'Standalone';
      case 'project-protected':
        return 'Project';
      case 'custom-gpt-protected':
        return 'Custom GPT';
      case 'unknown-protected':
      default:
        return 'Unverified';
    }
  }

  function verificationLabel(classification) {
    return [
      'standalone-safe',
      'project-protected',
      'custom-gpt-protected'
    ].includes(classification)
      ? 'Verified'
      : 'Needs verification';
  }

  function verificationDescription(classification) {
    return [
      'standalone-safe',
      'project-protected',
      'custom-gpt-protected'
    ].includes(classification)
      ? null
      : 'Type not confirmed yet. Verify before destructive actions.';
  }

  return {
    classificationLabel,
    formatConversationDate,
    formatDeletionProgress,
    formatEligibilityProgress,
    formatHistoryDetails,
    formatHistoryStatus,
    formatRebuildDetails,
    formatRebuildStatus,
    formatSearchStatus,
    formatSelectionCount,
    formatSearchProgress,
    formatSearchSummary,
    shouldOfferSearchRecovery,
    verificationDescription,
    verificationLabel
  };
});
