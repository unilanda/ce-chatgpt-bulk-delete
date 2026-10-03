(function attachTimestampUtils(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.TimestampUtils = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createTimestampUtils() {
  'use strict';

  const MAX_DATE_MILLISECONDS = 8640000000000000;
  const NUMERIC_STRING = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

  function validEpochMilliseconds(value) {
    return Number.isFinite(value) && Math.abs(value) <= MAX_DATE_MILLISECONDS;
  }

  function toEpochMilliseconds(value) {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return null;
      const milliseconds = value * 1000;
      return validEpochMilliseconds(milliseconds) ? milliseconds : null;
    }

    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed || NUMERIC_STRING.test(trimmed)) return null;
    const milliseconds = Date.parse(trimmed);
    return validEpochMilliseconds(milliseconds) ? milliseconds : null;
  }

  function compareTimestamps(first, second) {
    const firstMilliseconds = toEpochMilliseconds(first);
    const secondMilliseconds = toEpochMilliseconds(second);
    if (firstMilliseconds === null && secondMilliseconds === null) return 0;
    if (firstMilliseconds === null) return -1;
    if (secondMilliseconds === null) return 1;
    if (firstMilliseconds < secondMilliseconds) return -1;
    if (firstMilliseconds > secondMilliseconds) return 1;
    return 0;
  }

  function isTimestampNewer(candidate, existing) {
    return compareTimestamps(candidate, existing) > 0;
  }

  function laterTimestampValue(first, second) {
    const comparison = compareTimestamps(first, second);
    if (comparison > 0) return first;
    if (comparison < 0) return second;
    return first ?? second ?? null;
  }

  return {
    compareTimestamps,
    isTimestampNewer,
    laterTimestampValue,
    toEpochMilliseconds
  };
});
