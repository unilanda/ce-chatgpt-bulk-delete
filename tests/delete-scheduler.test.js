'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const {
  MIN_DELETE_INTERVAL_SECONDS,
  parseDeleteIntervalSeconds
} = require('../deletion-core.js');
const { buildDeletePlan, startDeleteJob } = require('../delete-job.js');
const { validateDeleteJob } = require('../job-store.js');
const {
  FAST_ALARM_MIN_DELAY_MS,
  deriveSchedule
} = require('../delete-job-executor.js');

function runningJob(intervalSeconds, { now = 1000 } = {}) {
  const record = {
    id: 'scheduler-one',
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };
  return startDeleteJob(buildDeletePlan({
    ids: [record.id],
    records: [record],
    intervalSeconds,
    now,
    jobId: `scheduler-${intervalSeconds}`
  }), { now });
}

test('delete interval parser accepts positive whole seconds without coercion', () => {
  assert.equal(MIN_DELETE_INTERVAL_SECONDS, 1);
  for (const value of [1, '1', 5, 29, 30, 60, 150, 600]) {
    assert.equal(parseDeleteIntervalSeconds(value), Number(value));
  }
  for (const value of [0, -1, 1.5, '29.5', '', 'nope', NaN, Infinity, null]) {
    assert.equal(parseDeleteIntervalSeconds(value), null);
  }
});

test('schema V1 preserves a one-second target and a 150-second target exactly', () => {
  assert.equal(validateDeleteJob(runningJob(1)).interval_seconds, 1);
  assert.equal(validateDeleteJob(runningJob(150)).interval_seconds, 150);
});

for (const intervalSeconds of [30, 60, 150]) {
  test(`${intervalSeconds}s derives one persistent alarm at the durable target`, () => {
    const job = runningJob(intervalSeconds);
    job.next_run_at = 1000 + intervalSeconds * 1000;
    job.updated_at = 1000;

    assert.deepEqual(deriveSchedule(job, 1000), {
      mode: 'alarm',
      alarm_time: job.next_run_at,
      fast_delay_ms: null
    });
  });
}

for (const intervalSeconds of [1, 5, 29]) {
  test(`${intervalSeconds}s derives a fast timer plus a platform-compatible backup`, () => {
    const job = runningJob(intervalSeconds);
    job.next_run_at = 1000 + intervalSeconds * 1000;
    job.updated_at = 1000;

    assert.deepEqual(deriveSchedule(job, 1000), {
      mode: 'fast_timer_with_backup',
      alarm_time: 1000 + FAST_ALARM_MIN_DELAY_MS,
      fast_delay_ms: intervalSeconds * 1000
    });
  });
}

test('an immediate first fast item retains a durable backup without delaying the timer', () => {
  const job = runningJob(1);

  assert.deepEqual(deriveSchedule(job, 1000), {
    mode: 'fast_timer_with_backup',
    alarm_time: 1000 + FAST_ALARM_MIN_DELAY_MS,
    fast_delay_ms: 0
  });
});
