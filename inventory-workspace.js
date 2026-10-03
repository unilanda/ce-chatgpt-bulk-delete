(function attachInventoryWorkspace(root, factory) {
  const policy =
    typeof module === 'object' && module.exports
      ? require('./conversation-policy.js')
      : root.ConversationPolicy;
  const timestampUtils =
    typeof module === 'object' && module.exports
      ? require('./timestamp-utils.js')
      : root.TimestampUtils;
  const api = factory(policy, timestampUtils);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.InventoryWorkspace = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createInventoryWorkspace(
  conversationPolicy,
  timestampUtils
) {
  'use strict';

  if (!conversationPolicy) throw new Error('ConversationPolicy is required');
  if (!timestampUtils) throw new Error('TimestampUtils is required');

  const TYPE_CLASSIFICATIONS = Object.freeze({
    standalone: conversationPolicy.CLASSIFICATIONS.STANDALONE,
    project: conversationPolicy.CLASSIFICATIONS.PROJECT,
    'custom-gpt': conversationPolicy.CLASSIFICATIONS.CUSTOM_GPT,
    unverified: conversationPolicy.CLASSIFICATIONS.UNKNOWN
  });

  function filterRecords(records, {
    title = '',
    type = 'all',
    status = 'all',
    updatedFrom = null,
    updatedTo = null
  } = {}) {
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    const titleQuery = typeof title === 'string' ? title.trim().toLowerCase() : '';
    const typeClassification = TYPE_CLASSIFICATIONS[type] || null;
    const fromMilliseconds = timestampUtils.toEpochMilliseconds(updatedFrom);
    const toMilliseconds = timestampUtils.toEpochMilliseconds(updatedTo);

    return records.filter(record => {
      if (!record || typeof record !== 'object') return false;
      if (
        titleQuery &&
        !(typeof record.title === 'string' &&
          record.title.toLowerCase().includes(titleQuery))
      ) {
        return false;
      }
      if (type !== 'all' && record.classification !== typeClassification) {
        return false;
      }
      const unverified =
        record.classification === conversationPolicy.CLASSIFICATIONS.UNKNOWN;
      if (status === 'verified' && unverified) return false;
      if (status === 'unverified' && !unverified) return false;

      if (fromMilliseconds !== null || toMilliseconds !== null) {
        const updatedMilliseconds =
          timestampUtils.toEpochMilliseconds(record.update_time);
        if (updatedMilliseconds === null) return false;
        if (
          fromMilliseconds !== null &&
          updatedMilliseconds < fromMilliseconds
        ) {
          return false;
        }
        if (
          toMilliseconds !== null &&
          updatedMilliseconds > toMilliseconds
        ) {
          return false;
        }
      }
      return true;
    });
  }

  function validRecordIds(records) {
    if (!Array.isArray(records)) throw new TypeError('records must be an array');
    return new Set(records.flatMap(record =>
      typeof record?.id === 'string' && record.id.trim() !== ''
        ? [record.id.trim()]
        : []
    ));
  }

  function reconcileSelection(ids, records) {
    if (!ids || typeof ids[Symbol.iterator] !== 'function') {
      throw new TypeError('ids must be iterable');
    }
    const availableIds = validRecordIds(records);
    const selected = new Set();
    for (const id of ids) {
      if (typeof id !== 'string') continue;
      const normalized = id.trim();
      if (availableIds.has(normalized)) selected.add(normalized);
    }
    return selected;
  }

  function selectVisibleIds(records) {
    return validRecordIds(records);
  }

  return {
    filterRecords,
    reconcileSelection,
    selectVisibleIds
  };
});
