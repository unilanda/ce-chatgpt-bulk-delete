'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  conversationRecord,
  createDashboardHarness
} = require('./helpers/dashboard-harness.js');

function errorPausedJob(context, records) {
  const now = 1789487000000;
  const ready = context.DeleteJob.buildDeletePlan({
    ids: records.map(record => record.id),
    records,
    intervalSeconds: 150,
    now,
    jobId: 'review-required-job'
  });
  const running = context.DeleteJob.startDeleteJob(ready, { now });
  const paused = context.DeleteJob.requestPause(running, { now: now + 1 });
  paused.state = context.DeleteJob.JOB_STATES.ERROR_PAUSED;
  paused.last_error = context.structuredClone({ code: 'network_error' });
  paused.updated_at = now + 2;
  return paused;
}

test('review-required pause shows reason and pending plan before sending Resume', async () => {
  const records = [conversationRecord('one'), conversationRecord('two')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory: errorPausedJob
  });
  await harness.awaitInitialization();

  await harness.document.getElementById('fixed-job-resume-btn').click();

  assert.equal(
    harness.runtimeMessages.some(message => message.type === 'delete_job:resume'),
    false
  );
  assert.equal(
    harness.document.getElementById('progress-modal').classList.contains('hidden'),
    false
  );
  assert.match(
    harness.document.getElementById('delete-preflight-status').textContent,
    /network error/i
  );
  assert.equal(harness.document.getElementById('confirm-delete-btn').hidden, false);
  assert.equal(
    harness.document.getElementById('confirm-delete-btn').textContent,
    'Resume deletion'
  );

  await harness.document.getElementById('confirm-delete-btn').click();

  assert.equal(
    harness.runtimeMessages.filter(message => message.type === 'delete_job:resume').length,
    1
  );
  assert.equal(harness.currentJob.state, harness.context.DeleteJob.JOB_STATES.RUNNING);
  assert.equal(
    harness.document.getElementById('progress-modal').classList.contains('hidden'),
    true
  );
});

test('ordinary user pause still resumes directly without the review modal', async () => {
  const records = [conversationRecord('one')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory(context, initialRecords) {
      const now = 1789487000000;
      const ready = context.DeleteJob.buildDeletePlan({
        ids: initialRecords.map(record => record.id),
        records: initialRecords,
        intervalSeconds: 150,
        now,
        jobId: 'manual-pause-job'
      });
      return context.DeleteJob.requestPause(
        context.DeleteJob.startDeleteJob(ready, { now }),
        { now: now + 1 }
      );
    }
  });
  await harness.awaitInitialization();

  await harness.document.getElementById('fixed-job-resume-btn').click();

  assert.equal(
    harness.runtimeMessages.filter(message => message.type === 'delete_job:resume').length,
    1
  );
  assert.equal(
    harness.document.getElementById('progress-modal').classList.contains('hidden'),
    true
  );
});

test('interrupted request is never resumed until explicit outcome-unknown review', async () => {
  const records = [conversationRecord('uncertain'), conversationRecord('later')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory(context, initialRecords) {
      const now = 1789487000000;
      const ready = context.DeleteJob.buildDeletePlan({
        ids: initialRecords.map(record => record.id),
        records: initialRecords,
        intervalSeconds: 150,
        now,
        jobId: 'interrupted-review-job'
      });
      const interrupted = context.DeleteJob.startDeleteJob(ready, { now });
      interrupted.state = context.DeleteJob.JOB_STATES.ERROR_PAUSED;
      interrupted.items[0].status = context.DeleteJob.ITEM_STATES.FAILED;
      interrupted.items[0].requested_at = now + 1;
      interrupted.items[0].error_code = 'interrupted_request';
      interrupted.current_conversation_id = null;
      interrupted.next_run_at = null;
      interrupted.last_error = context.structuredClone({ code: 'interrupted_request' });
      interrupted.counts.failed = 1;
      interrupted.updated_at = now + 2;
      return interrupted;
    }
  });
  await harness.awaitInitialization();

  assert.equal(
    harness.runtimeMessages.some(message => message.type === 'delete_job:resume'),
    false
  );
  await harness.document.getElementById('fixed-job-resume-btn').click();

  assert.equal(
    harness.runtimeMessages.some(message => message.type === 'delete_job:resume'),
    false
  );
  const warning = harness.document.getElementById('delete-preflight-status').textContent;
  assert.match(warning, /remote outcome is unknown/i);
  assert.match(warning, /resume.*attempt.*again/i);

  await harness.document.getElementById('confirm-delete-btn').click();

  assert.equal(
    harness.runtimeMessages.filter(message => message.type === 'delete_job:resume').length,
    1
  );
  assert.equal(harness.currentJob.state, harness.context.DeleteJob.JOB_STATES.RUNNING);
  assert.equal(harness.currentJob.items[0].status, harness.context.DeleteJob.ITEM_STATES.PENDING);
});
