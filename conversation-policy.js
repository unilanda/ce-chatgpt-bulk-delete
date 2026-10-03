(function attachConversationPolicy(root, factory) {
  const timestampUtils =
    typeof module === 'object' && module.exports
      ? require('./timestamp-utils.js')
      : root.TimestampUtils;
  const api = factory(timestampUtils);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.ConversationPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createConversationPolicy(
  timestampUtils
) {
  'use strict';

  if (!timestampUtils) throw new Error('TimestampUtils is required');

  const CLASSIFICATIONS = Object.freeze({
    STANDALONE: 'standalone-safe',
    PROJECT: 'project-protected',
    CUSTOM_GPT: 'custom-gpt-protected',
    UNKNOWN: 'unknown-protected'
  });
  const VALID_CLASSIFICATIONS = new Set(Object.values(CLASSIFICATIONS));
  const PROTECTED_CLASSIFICATIONS = new Set([
    CLASSIFICATIONS.PROJECT,
    CLASSIFICATIONS.CUSTOM_GPT,
    CLASSIFICATIONS.UNKNOWN
  ]);
  const STANDALONE_EVIDENCE = new Set([
    'history-sync',
    'eligibility-detail-v1'
  ]);

  function classificationFromHistory(item) {
    if (!item || typeof item !== 'object') {
      return {
        classification: CLASSIFICATIONS.UNKNOWN,
        evidence: 'missing-history-metadata'
      };
    }
    if (!Object.prototype.hasOwnProperty.call(item, 'gizmo_id')) {
      return {
        classification: CLASSIFICATIONS.UNKNOWN,
        evidence: 'insufficient-history-metadata'
      };
    }
    if (item.gizmo_id === null || item.gizmo_id === '') {
      return {
        classification: CLASSIFICATIONS.STANDALONE,
        evidence: 'history-sync'
      };
    }
    if (typeof item.gizmo_id !== 'string') {
      return {
        classification: CLASSIFICATIONS.UNKNOWN,
        evidence: 'invalid-history-metadata'
      };
    }
    if (item.gizmo_id.startsWith('g-p-')) {
      return {
        classification: CLASSIFICATIONS.PROJECT,
        evidence: 'history-sync'
      };
    }
    return {
      classification: CLASSIFICATIONS.CUSTOM_GPT,
      evidence: 'history-sync'
    };
  }

  function classifyHistoryItem(item) {
    return classificationFromHistory(item).classification;
  }

  function historyItemToRecord(item) {
    if (!item || typeof item.id !== 'string' || item.id.trim() === '') {
      throw new TypeError('History item must have a non-empty conversation id');
    }
    const title = typeof item.title === 'string' ? item.title : '';
    const classification = classificationFromHistory(item);
    const safeRawData = {};
    for (const key of [
      'id',
      'title',
      'create_time',
      'update_time',
      'gizmo_id',
      'pinned_time'
    ]) {
      if (Object.prototype.hasOwnProperty.call(item, key)) {
        safeRawData[key] = item[key];
      }
    }
    return {
      id: item.id,
      title,
      create_time: item.create_time ?? null,
      update_time: item.update_time ?? null,
      full_text: title.toLowerCase(),
      raw_data: safeRawData,
      classification: classification.classification,
      classification_evidence: classification.evidence,
      discovery_sources: ['history']
    };
  }

  function chooseClassification(existing, incoming) {
    const existingClassification = existing.classification;
    const incomingClassification = incoming.classification;

    if (
      existingClassification === CLASSIFICATIONS.PROJECT ||
      existingClassification === CLASSIFICATIONS.CUSTOM_GPT
    ) {
      return {
        classification: existingClassification,
        evidence: existing.classification_evidence
      };
    }
    if (
      incomingClassification === CLASSIFICATIONS.PROJECT ||
      incomingClassification === CLASSIFICATIONS.CUSTOM_GPT
    ) {
      return {
        classification: incomingClassification,
        evidence: incoming.classification_evidence
      };
    }
    if (existingClassification === CLASSIFICATIONS.STANDALONE) {
      return {
        classification: CLASSIFICATIONS.STANDALONE,
        evidence: existing.classification_evidence
      };
    }
    if (incomingClassification === CLASSIFICATIONS.STANDALONE) {
      return {
        classification: CLASSIFICATIONS.STANDALONE,
        evidence: incoming.classification_evidence
      };
    }
    return {
      classification: CLASSIFICATIONS.UNKNOWN,
      evidence:
        existing.classification_evidence ||
        incoming.classification_evidence ||
        'unknown'
    };
  }

  function normalizeConversationRecord(record) {
    if (!record || typeof record !== 'object') {
      throw new TypeError('Conversation record must be an object');
    }
    if (typeof record.id !== 'string' || record.id.trim() === '') {
      throw new TypeError('Conversation record must have a non-empty id');
    }

    const normalized = {
      ...record,
      id: record.id.trim()
    };
    const explicitClassification = VALID_CLASSIFICATIONS.has(record.classification)
      ? record.classification
      : null;
    const derived = record.raw_data
      ? classificationFromHistory(record.raw_data)
      : {
          classification: CLASSIFICATIONS.UNKNOWN,
          evidence: 'no-classification-metadata'
        };

    const explicitProtected =
      explicitClassification === CLASSIFICATIONS.PROJECT ||
      explicitClassification === CLASSIFICATIONS.CUSTOM_GPT;
    const derivedProtected =
      derived.classification === CLASSIFICATIONS.PROJECT ||
      derived.classification === CLASSIFICATIONS.CUSTOM_GPT;

    if (derivedProtected) {
      normalized.classification = derived.classification;
      normalized.classification_evidence = derived.evidence;
    } else if (explicitProtected) {
      normalized.classification = explicitClassification;
      normalized.classification_evidence =
        record.classification_evidence || 'stored-protection';
    } else if (explicitClassification === CLASSIFICATIONS.UNKNOWN) {
      normalized.classification = CLASSIFICATIONS.UNKNOWN;
      normalized.classification_evidence =
        record.classification_evidence || derived.evidence;
    } else if (
      explicitClassification === CLASSIFICATIONS.STANDALONE &&
      STANDALONE_EVIDENCE.has(record.classification_evidence)
    ) {
      normalized.classification = CLASSIFICATIONS.STANDALONE;
      normalized.classification_evidence = record.classification_evidence;
    } else if (derived.classification === CLASSIFICATIONS.STANDALONE) {
      normalized.classification = CLASSIFICATIONS.STANDALONE;
      normalized.classification_evidence = derived.evidence;
    } else {
      normalized.classification = CLASSIFICATIONS.UNKNOWN;
      normalized.classification_evidence =
        explicitClassification === CLASSIFICATIONS.STANDALONE
          ? 'unsubstantiated-standalone'
          : derived.evidence;
    }

    normalized.discovery_sources = Array.from(
      new Set(Array.isArray(record.discovery_sources) ? record.discovery_sources : [])
    ).sort();
    return normalized;
  }

  function mergeSearchMetadata(existingMetadata, incomingMetadata) {
    if (!existingMetadata && !incomingMetadata) return undefined;
    const existing = existingMetadata || {};
    const incoming = incomingMetadata || {};
    return {
      queries: Array.from(new Set([
        ...(Array.isArray(existing.queries) ? existing.queries : []),
        ...(Array.isArray(incoming.queries) ? incoming.queries : [])
      ])).sort(),
      hit_count: Math.max(existing.hit_count || 0, incoming.hit_count || 0),
      match_kinds: Array.from(new Set([
        ...(Array.isArray(existing.match_kinds) ? existing.match_kinds : []),
        ...(Array.isArray(incoming.match_kinds) ? incoming.match_kinds : [])
      ])).sort(),
      is_archived:
        incoming.is_archived ?? existing.is_archived ?? null,
      is_starred:
        incoming.is_starred ?? existing.is_starred ?? null
    };
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
      );
    }
    return value;
  }

  function recordsEqual(first, second) {
    return JSON.stringify(canonicalize(first)) === JSON.stringify(canonicalize(second));
  }

  function mergeConversationRecords(existingRecord, incomingRecord) {
    if (!existingRecord) return normalizeConversationRecord(incomingRecord);
    if (!incomingRecord) return normalizeConversationRecord(existingRecord);

    const existing = normalizeConversationRecord(existingRecord);
    const incoming = normalizeConversationRecord(incomingRecord);
    if (existing.id !== incoming.id) {
      throw new TypeError('Cannot merge conversation records with different IDs');
    }

    const chosenClassification = chooseClassification(existing, incoming);
    const incomingHasHistory = incoming.discovery_sources.includes('history');
    const preferredMetadata = incomingHasHistory ? incoming : existing;
    const merged = {
      ...incoming,
      ...existing,
      id: existing.id,
      title: preferredMetadata.title || existing.title || incoming.title || '',
      create_time:
        preferredMetadata.create_time ??
        existing.create_time ??
        incoming.create_time ??
        null,
      update_time: timestampUtils.laterTimestampValue(
        existing.update_time,
        incoming.update_time
      ),
      full_text:
        preferredMetadata.full_text ||
        existing.full_text ||
        incoming.full_text ||
        (preferredMetadata.title || existing.title || incoming.title || '').toLowerCase(),
      classification: chosenClassification.classification,
      classification_evidence: chosenClassification.evidence,
      discovery_sources: Array.from(new Set([
        ...existing.discovery_sources,
        ...incoming.discovery_sources
      ])).sort()
    };

    if (
      incoming.raw_data !== undefined &&
      (
        existing.raw_data === undefined ||
        incoming.classification === chosenClassification.classification
      )
    ) {
      merged.raw_data = incoming.raw_data;
    } else if (existing.raw_data !== undefined) {
      merged.raw_data = existing.raw_data;
    } else {
      delete merged.raw_data;
    }

    const searchMetadata = mergeSearchMetadata(
      existing.search_metadata,
      incoming.search_metadata
    );
    if (searchMetadata) merged.search_metadata = searchMetadata;
    return merged;
  }

  function searchHitToRecord(hit, query) {
    if (!hit || typeof hit.id !== 'string' || hit.id.trim() === '') {
      throw new TypeError('Search hit must have a non-empty conversation id');
    }
    const title = typeof hit.title === 'string' ? hit.title : '';
    return {
      id: hit.id,
      title,
      create_time: null,
      update_time: hit.update_time ?? null,
      full_text: title.toLowerCase(),
      classification: CLASSIFICATIONS.UNKNOWN,
      classification_evidence: 'search-only',
      discovery_sources: ['search'],
      search_metadata: {
        queries: [query],
        hit_count: hit.hit_count || 0,
        match_kinds: Array.from(new Set(hit.match_kinds || [])).sort(),
        is_archived: hit.is_archived ?? null,
        is_starred: hit.is_starred ?? null
      }
    };
  }

  function isBulkDeletable(record) {
    try {
      const normalized = normalizeConversationRecord(record);
      return normalized.classification === CLASSIFICATIONS.STANDALONE;
    } catch (_error) {
      return false;
    }
  }

  function selectEligibleIds(records) {
    return records
      .filter(isBulkDeletable)
      .map(record => record.id);
  }

  function isProtected(record) {
    try {
      return PROTECTED_CLASSIFICATIONS.has(
        normalizeConversationRecord(record).classification
      );
    } catch (_error) {
      return true;
    }
  }

  return {
    CLASSIFICATIONS,
    classifyHistoryItem,
    historyItemToRecord,
    isBulkDeletable,
    isProtected,
    mergeConversationRecords,
    normalizeConversationRecord,
    recordsEqual,
    searchHitToRecord,
    selectEligibleIds
  };
});
