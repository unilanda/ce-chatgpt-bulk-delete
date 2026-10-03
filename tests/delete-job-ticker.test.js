'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  conversationRecord,
  createDashboardHarness
} = require('./helpers/dashboard-harness.js');

const START_TIME = 1789487000000;

function runningJob(context, records) {
  const job = context.DeleteJob.startDeleteJob(context.DeleteJob.buildDeletePlan({
    ids: records.map(record => record.id),
    records,
    intervalSeconds: 150,
    now: START_TIME,
    jobId: 'ticker-job'
  }), { now: START_TIME });
  job.items[0].status = context.DeleteJob.ITEM_STATES.COMPLETED;
  job.items[0].requested_at = START_TIME;
  job.items[0].completed_at = START_TIME;
  job.counts.completed = 1;
  job.counts.pending = 1;
  job.next_run_at = START_TIME + 150000;
  return job;
}

test('display ticker advances without storage writes or deletion commands', async () => {
  const records = [conversationRecord('one'), conversationRecord('two')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory: runningJob,
    clockNow: START_TIME
  });
  await harness.awaitInitialization();

  const timing = harness.document.getElementById('fixed-job-timing');
  assert.match(timing.textContent, /Next in 02:30/);
  const messageCount = harness.runtimeMessages.length;

  harness.setNow(START_TIME + 1000);
  harness.runIntervals();
  assert.match(timing.textContent, /Next in 02:29/);

  harness.setNow(START_TIME + 60000);
  harness.runIntervals();
  assert.match(timing.textContent, /Next in 01:30/);
  assert.equal(harness.runtimeMessages.length, messageCount);
});

test('pause state stops ticker and distinguishes direct Resume from review-required Resume', async () => {
  const records = [conversationRecord('one'), conversationRecord('two')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory: runningJob,
    clockNow: START_TIME
  });
  await harness.awaitInitialization();
  assert.equal(harness.activeIntervalCount, 1);

  const paused = harness.context.DeleteJob.requestPause(harness.currentJob, {
    now: START_TIME + 1000
  });
  await harness.emitStorageJob(paused);
  assert.equal(harness.activeIntervalCount, 0);
  assert.equal(
    harness.document.getElementById('fixed-job-resume-btn').textContent,
    'Resume'
  );
  assert.equal(
    harness.document.getElementById('active-job-review-btn').hidden,
    false
  );

  const reviewRequired = harness.context.structuredClone(paused);
  reviewRequired.state = harness.context.DeleteJob.JOB_STATES.ERROR_PAUSED;
  reviewRequired.last_error = harness.context.structuredClone({ code: 'browser_restarted' });
  await harness.emitStorageJob(reviewRequired);
  assert.equal(
    harness.document.getElementById('fixed-job-resume-btn').textContent,
    'Review & Resume'
  );
  assert.equal(
    harness.document.getElementById('active-job-review-btn').hidden,
    true
  );
});

test('fixed job bar and selected-action banner coexist while a second plan stays disabled', async () => {
  const records = [conversationRecord('one'), conversationRecord('two')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory: runningJob,
    clockNow: START_TIME
  });
  await harness.awaitInitialization();
  await harness.selectAllRows();

  assert.equal(harness.document.getElementById('fixed-job-bar').hidden, false);
  assert.equal(
    harness.document.getElementById('action-banner').classList.contains('hidden'),
    false
  );
  assert.equal(harness.document.getElementById('delete-selected-btn').disabled, true);
});
