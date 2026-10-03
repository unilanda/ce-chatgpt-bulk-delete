'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareTimestamps,
  laterTimestampValue,
  toEpochMilliseconds
} = require('../timestamp-utils.js');

test('integer Unix seconds normalize to epoch milliseconds', () => {
  assert.equal(toEpochMilliseconds(1789486324), 1789486324000);
});

test('fractional Unix seconds preserve the correct instant', () => {
  const actual = toEpochMilliseconds(1789486324.789347);
  assert.ok(Math.abs(actual - 1789486324789.347) < 0.001);
});

test('ISO timestamps remain backward compatible', () => {
  assert.equal(
    toEpochMilliseconds('2026-09-15T15:32:04.789Z'),
    1789486324789
  );
});

test('null missing non-finite and invalid values do not invent a timestamp', () => {
  for (const value of [
    null,
    undefined,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '',
    'not-a-date',
    '1789486324.789347',
    {},
    []
  ]) {
    assert.equal(toEpochMilliseconds(value), null, String(value));
  }
});

test('numeric-second timestamps compare in chronological order', () => {
  assert.equal(compareTimestamps(1789486324.25, 1789486324.5), -1);
  assert.equal(compareTimestamps(1789486324.5, 1789486324.25), 1);
  assert.equal(compareTimestamps(1789486324.5, 1789486324.5), 0);
  assert.equal(compareTimestamps('invalid', 1789486324.5), -1);
});

test('laterTimestampValue preserves the winning stored representation', () => {
  assert.equal(
    laterTimestampValue(1789486324.25, 1789486324.789347),
    1789486324.789347
  );
  assert.equal(
    laterTimestampValue(
      '2026-09-15T15:32:04.000Z',
      '2026-09-15T15:32:04.789Z'
    ),
    '2026-09-15T15:32:04.789Z'
  );
  assert.equal(laterTimestampValue(null, 'invalid'), 'invalid');
});
