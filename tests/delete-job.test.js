'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const {
  ITEM_STATES,
  JOB_STATES,
  TERMINAL_STATES,
  approveProjectSubset,
  buildDeletePlan,
  estimateMinimumDurationSeconds,
  refreshDeletePlan,
  removeBlockedItems,
  requestCancel,
  requestPause,
  reviewAndResume,
  startDeleteJob,
  summarizeDeleteJob
} = require('../delete-job.js');

function record(id, classification) {
  return {
    id,
    title: `Synthetic ${id}`,
    classification,
    classification_evidence:
      classification === CLASSIFICATIONS.UNKNOWN ? 'search-only' : 'history-sync'
  };
}

function standalone(id) {
  return record(id, CLASSIFICATIONS.STANDALONE);
}

function project(id) {
  return record(id, CLASSIFICATIONS.PROJECT);
}

function customGpt(id) {
  return record(id, CLASSIFICATIONS.CUSTOM_GPT);
}

function unknown(id) {
  return record(id, CLASSIFICATIONS.UNKNOWN);
}

function build(records, ids = records.map(item => item.id), overrides = {}) {
  return buildDeletePlan({
    ids,
    records,
    intervalSeconds: 600,
    now: 1000,
    jobId: 'delete-job-synthetic',
    ...overrides
  });
}

for (const count of [1, 2, 17]) {
  test(`${count} verified Standalone conversation(s) produce a ready plan`, () => {
    const records = Array.from({ length: count }, (_, index) =>
      standalone(`standalone-${index}`)
    );
    const job = build(records);
    const summary = summarizeDeleteJob(job);

    assert.equal(job.state, JOB_STATES.READY);
    assert.equal(summary.total, count);
    assert.equal(summary.standalone, count);
    assert.equal(summary.project, 0);
    assert.equal(summary.blocked, 0);
    assert.equal(job.project_subset_approved, false);
    assert.deepEqual(job.items.map(item => item.status), Array(count).fill(ITEM_STATES.PENDING));
  });
}

test('mixed Standalone and Project membership is eligible but requires one subset approval', () => {
  const job = build([
    standalone('standalone-one'),
    project('project-one')
  ]);
  const before = summarizeDeleteJob(job);

  assert.equal(job.state, JOB_STATES.DRAFT);
  assert.deepEqual(before, {
    total: 2,
    completed: 0,
    pending: 2,
    failed: 0,
    standalone: 1,
    project: 1,
    blocked: 0,
    blocked_unverified: 0,
    blocked_custom_gpt: 0,
    blocked_missing: 0,
    project_approval_required: true,
    project_subset_approved: false,
    estimated_minimum_seconds: 600
  });

  const approved = approveProjectSubset(job, { now: 1100 });
  assert.equal(approved.state, JOB_STATES.READY);
  assert.equal(approved.project_subset_approved, true);
  assert.deepEqual(approved.project_approval_ids, ['project-one']);
});

test('seventeen mixed verified Standalone and Project records remain one ordered plan', () => {
  const records = [
    ...Array.from({ length: 12 }, (_, index) => standalone(`standalone-${index}`)),
    ...Array.from({ length: 5 }, (_, index) => project(`project-${index}`))
  ];
  const job = build(records);

  assert.equal(job.state, JOB_STATES.DRAFT);
  assert.equal(job.items.length, 17);
  assert.deepEqual(job.items.map(item => item.conversation_id), records.map(item => item.id));
  assert.deepEqual(summarizeDeleteJob(job), {
    total: 17,
    completed: 0,
    pending: 17,
    failed: 0,
    standalone: 12,
    project: 5,
    blocked: 0,
    blocked_unverified: 0,
    blocked_custom_gpt: 0,
    blocked_missing: 0,
    project_approval_required: true,
    project_subset_approved: false,
    estimated_minimum_seconds: 9600
  });
});

test('Unverified, Custom GPT, and missing records are blocked without losing membership', () => {
  const records = [
    standalone('standalone-one'),
    unknown('unknown-one'),
    customGpt('custom-one')
  ];
  const job = build(records, [
    'standalone-one',
    'unknown-one',
    'custom-one',
    'missing-one'
  ]);

  assert.equal(job.state, JOB_STATES.DRAFT);
  assert.deepEqual(
    job.items.map(item => [item.conversation_id, item.blocked_reason]),
    [
      ['standalone-one', null],
      ['unknown-one', 'unverified'],
      ['custom-one', 'custom_gpt'],
      ['missing-one', 'missing']
    ]
  );
  const summary = summarizeDeleteJob(job);
  assert.equal(summary.blocked, 3);
  assert.equal(summary.blocked_unverified, 1);
  assert.equal(summary.blocked_custom_gpt, 1);
  assert.equal(summary.blocked_missing, 1);
});

test('removing blocked items edits only the job plan and can make it ready', () => {
  const original = build([
    standalone('standalone-one'),
    unknown('unknown-one')
  ]);
  const updated = removeBlockedItems(original, { now: 1200 });

  assert.deepEqual(original.items.map(item => item.conversation_id), [
    'standalone-one',
    'unknown-one'
  ]);
  assert.deepEqual(updated.items.map(item => item.conversation_id), ['standalone-one']);
  assert.equal(updated.state, JOB_STATES.READY);
});

test('Project approval is invalidated when refreshed Project membership changes', () => {
  const original = approveProjectSubset(build([
    standalone('becomes-project'),
    project('project-one')
  ]), { now: 1100 });
  assert.equal(original.project_subset_approved, true);

  const refreshed = refreshDeletePlan(original, {
    records: [
      project('becomes-project'),
      project('project-one')
    ],
    now: 1200
  });

  assert.equal(refreshed.state, JOB_STATES.DRAFT);
  assert.equal(refreshed.project_subset_approved, false);
  assert.deepEqual(refreshed.project_approval_ids, []);
});

test('Project approval survives refresh when the approved subset is unchanged', () => {
  const original = approveProjectSubset(build([
    standalone('standalone-one'),
    project('project-one')
  ]), { now: 1100 });

  const refreshed = refreshDeletePlan(original, {
    records: [
      standalone('standalone-one'),
      project('project-one')
    ],
    now: 1200
  });

  assert.equal(refreshed.state, JOB_STATES.READY);
  assert.equal(refreshed.project_subset_approved, true);
  assert.deepEqual(refreshed.project_approval_ids, ['project-one']);
});

test('Start is allowed only for a non-empty ready plan and initializes execution once', () => {
  const ready = build([standalone('standalone-one')]);
  const running = startDeleteJob(ready, { now: 2000 });

  assert.equal(running.state, JOB_STATES.RUNNING);
  assert.equal(running.started_at, 2000);
  assert.equal(running.next_run_at, 2000);
  assert.equal(running.pause_requested, false);
  assert.equal(running.cancel_requested, false);
  assert.throws(
    () => startDeleteJob(build([unknown('unknown-one')]), { now: 2000 }),
    /ready/
  );
});

test('estimated duration counts only intervals between items', () => {
  assert.equal(estimateMinimumDurationSeconds(0, 600), 0);
  assert.equal(estimateMinimumDurationSeconds(1, 600), 0);
  assert.equal(estimateMinimumDurationSeconds(2, 600), 600);
  assert.equal(estimateMinimumDurationSeconds(15, 600), 8400);
});

test('Pause is immediate while idle and requested while an item is in flight', () => {
  const running = startDeleteJob(build([standalone('standalone-one')]), {
    now: 2000
  });
  const paused = requestPause(running, { now: 2100 });
  assert.equal(paused.state, JOB_STATES.PAUSED);
  assert.equal(paused.next_run_at, null);
  assert.deepEqual(requestPause(paused, { now: 2200 }), paused);

  const requesting = structuredClone(running);
  requesting.current_conversation_id = 'standalone-one';
  requesting.items[0].status = ITEM_STATES.REQUESTING;
  const pauseRequested = requestPause(requesting, { now: 2100 });
  assert.equal(pauseRequested.state, JOB_STATES.PAUSE_REQUESTED);
  assert.equal(pauseRequested.pause_requested, true);
  assert.deepEqual(requestPause(pauseRequested, { now: 2200 }), pauseRequested);
});

test('Cancel is terminal while idle and waits for in-flight reconciliation', () => {
  const running = startDeleteJob(build([standalone('standalone-one')]), {
    now: 2000
  });
  const cancelled = requestCancel(running, { now: 2100 });
  assert.equal(cancelled.state, JOB_STATES.CANCELLED);
  assert.equal(cancelled.finished_at, 2100);
  assert.equal(TERMINAL_STATES.has(cancelled.state), true);
  assert.deepEqual(requestCancel(cancelled, { now: 2200 }), cancelled);

  const requesting = structuredClone(running);
  requesting.current_conversation_id = 'standalone-one';
  requesting.items[0].status = ITEM_STATES.REQUESTING;
  const cancelRequested = requestCancel(requesting, { now: 2100 });
  assert.equal(cancelRequested.state, JOB_STATES.CANCEL_REQUESTED);
  assert.equal(cancelRequested.cancel_requested, true);
  assert.deepEqual(requestCancel(cancelRequested, { now: 2200 }), cancelRequested);
});

test('Review and Resume reruns preflight and resumes only when still ready', () => {
  const records = [
    standalone('standalone-one'),
    project('project-one')
  ];
  const approved = approveProjectSubset(build(records), { now: 1100 });
  const running = startDeleteJob(approved, { now: 2000 });
  const paused = requestPause(running, { now: 2100 });

  const resumed = reviewAndResume(paused, { records, now: 2200 });
  assert.equal(resumed.state, JOB_STATES.RUNNING);
  assert.equal(resumed.project_subset_approved, true);
  assert.equal(resumed.next_run_at, 2200);

  const pausedAgain = requestPause(resumed, { now: 2300 });
  const blocked = reviewAndResume(pausedAgain, {
    records: [
      unknown('standalone-one'),
      project('project-one')
    ],
    now: 2400
  });
  assert.equal(blocked.state, JOB_STATES.DRAFT);
  assert.equal(summarizeDeleteJob(blocked).blocked, 1);
  assert.equal(blocked.next_run_at, null);
});
