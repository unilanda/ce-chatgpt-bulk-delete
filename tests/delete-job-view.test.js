'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const {
  JOB_STATES,
  approveProjectSubset,
  buildDeletePlan,
  requestPause,
  startDeleteJob
} = require('../delete-job.js');
const {
  PLAN_ELEMENT_IDS,
  ACTIVE_JOB_ELEMENT_IDS,
  formatDurationSeconds,
  renderPlan,
  renderActiveJob
} = require('../delete-job-view.js');

class ClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
  contains(name) { return this.values.has(name); }
}

function fakeElements(ids) {
  return Object.fromEntries(ids.map(id => [id, {
    id,
    textContent: '',
    hidden: false,
    disabled: false,
    classList: new ClassList()
  }]));
}

function record(id, classification = CLASSIFICATIONS.STANDALONE) {
  return {
    id,
    title: `Synthetic ${id}`,
    classification,
    classification_evidence:
      classification === CLASSIFICATIONS.UNKNOWN ? 'search-only' : 'history-sync'
  };
}

function plan(records) {
  return buildDeletePlan({
    ids: records.map(item => item.id),
    records,
    intervalSeconds: 600,
    now: 1000,
    jobId: 'view-test'
  });
}

for (const total of [1, 2, 17]) {
  test(`${total} Standalone conversations render a ready confirmation`, () => {
    const records = Array.from({ length: total }, (_, index) => record(`s-${index}`));
    const elements = fakeElements(PLAN_ELEMENT_IDS);
    const result = renderPlan(elements, plan(records), records);

    assert.equal(result.ready, true);
    assert.match(elements['modal-title'].textContent, new RegExp(`Delete ${total} conversation`));
    assert.match(elements['delete-plan-summary'].textContent, new RegExp(`${total} Standalone`));
    assert.equal(elements['confirm-delete-btn'].disabled, false);
  });
}

test('mixed Standalone and Project plans render one explicit Project approval', () => {
  const records = [record('standalone'), record('project', CLASSIFICATIONS.PROJECT)];
  const elements = fakeElements(PLAN_ELEMENT_IDS);
  const result = renderPlan(elements, plan(records), records);

  assert.equal(result.ready, false);
  assert.match(elements['delete-plan-summary'].textContent, /1 Standalone · 1 Project/);
  assert.match(elements['delete-project-warning'].textContent, /Projects themselves are not being deleted/i);
  assert.match(elements['delete-project-list'].textContent, /Synthetic project/);
  assert.equal(elements['approve-projects-btn'].hidden, false);
  assert.equal(elements['confirm-delete-btn'].disabled, true);
});

test('human-readable duration formatting covers seconds, minutes, and hours', () => {
  assert.equal(formatDurationSeconds(0), 'No inter-item waiting needed');
  assert.equal(formatDurationSeconds(45), '45 seconds');
  assert.equal(formatDurationSeconds(240), '~4 minutes');
  assert.equal(formatDurationSeconds(3900), '~1 hour 5 minutes');
  assert.equal(formatDurationSeconds(8400), '~2 hours 20 minutes');
});

test('plan summary uses human-readable duration instead of raw long seconds', () => {
  const records = Array.from({ length: 27 }, (_, index) => record(`duration-${index}`));
  const job = buildDeletePlan({
    ids: records.map(item => item.id),
    records,
    intervalSeconds: 150,
    now: 1000,
    jobId: 'duration-view'
  });
  const elements = fakeElements(PLAN_ELEMENT_IDS);

  renderPlan(elements, job, records);

  assert.match(elements['delete-plan-summary'].textContent, /~1 hour 5 minutes/);
  assert.doesNotMatch(elements['delete-plan-summary'].textContent, /3900 seconds/);
});

test('seventeen mixed eligible records render without exception or hidden transport', () => {
  const records = Array.from({ length: 17 }, (_, index) =>
    record(`mixed-${index}`, index % 3 === 0
      ? CLASSIFICATIONS.PROJECT
      : CLASSIFICATIONS.STANDALONE)
  );
  const job = approveProjectSubset(plan(records), { now: 1100 });
  const elements = fakeElements(PLAN_ELEMENT_IDS);

  const result = renderPlan(elements, job, records);

  assert.equal(result.ready, true);
  assert.match(elements['delete-plan-summary'].textContent, /17 total/);
  assert.equal(elements['confirm-delete-btn'].disabled, false);
});

for (const [classification, expected] of [
  [CLASSIFICATIONS.UNKNOWN, /Needs verification/i],
  [CLASSIFICATIONS.CUSTOM_GPT, /Custom GPT/i]
]) {
  test(`${classification} membership renders a blocked plan with resolution`, () => {
    const records = [record('standalone'), record('blocked', classification)];
    const elements = fakeElements(PLAN_ELEMENT_IDS);
    const result = renderPlan(elements, plan(records), records);

    assert.equal(result.ready, false);
    assert.match(elements['delete-preflight-status'].textContent, expected);
    assert.equal(elements['remove-blocked-btn'].hidden, false);
    assert.equal(elements['confirm-delete-btn'].disabled, true);
  });
}

test('active job controls reflect running, paused, and error-paused states', () => {
  const elements = fakeElements(ACTIVE_JOB_ELEMENT_IDS);
  const ready = plan([record('one'), record('two')]);
  const running = startDeleteJob(ready, { now: 1000 });

  renderActiveJob(elements, running, 1000);
  assert.equal(elements['active-job-pause-btn'].hidden, false);
  assert.equal(elements['active-job-resume-btn'].hidden, true);
  assert.equal(elements['active-job-status'].textContent.includes('0 / 2 complete · 2 pending'), true);

  const paused = requestPause(running, { now: 1100 });
  renderActiveJob(elements, paused, 1100);
  assert.equal(elements['active-job-pause-btn'].hidden, true);
  assert.equal(elements['active-job-resume-btn'].hidden, false);
  assert.equal(elements['active-job-cancel-btn'].hidden, false);

  const failed = structuredClone(paused);
  failed.state = JOB_STATES.ERROR_PAUSED;
  failed.last_error = { code: 'network_error' };
  renderActiveJob(elements, failed, 1200);
  assert.match(elements['active-job-error'].textContent, /network error/i);
  assert.equal(elements['active-job-resume-btn'].hidden, false);
});

test('completed and cancelled jobs render only as Recent activity', () => {
  const ready = plan([record('one'), record('two')]);
  const running = startDeleteJob(ready, { now: 1000 });
  const completed = structuredClone(running);
  for (const [index, item] of completed.items.entries()) {
    item.status = 'completed';
    item.completed_at = 1100 + index;
  }
  completed.counts.completed = 2;
  completed.counts.pending = 0;
  completed.state = JOB_STATES.COMPLETED;
  completed.next_run_at = null;
  completed.finished_at = 1200;

  const completedElements = fakeElements(ACTIVE_JOB_ELEMENT_IDS);
  const completedResult = renderActiveJob(completedElements, completed, 1300);
  assert.equal(completedResult.terminal, true);
  assert.equal(completedElements['active-jobs-section'].hidden, true);
  assert.equal(completedElements['recent-activity-section'].hidden, false);
  assert.equal(completedElements['recent-job-title'].textContent, 'Deletion complete');
  assert.match(completedElements['recent-job-status'].textContent, /2 \/ 2 deleted/);
  assert.equal(completedElements['fixed-job-bar'].hidden, true);

  const cancelled = requestPause(running, { now: 1100 });
  cancelled.state = JOB_STATES.CANCELLED;
  cancelled.finished_at = 1200;
  const cancelledElements = fakeElements(ACTIVE_JOB_ELEMENT_IDS);
  renderActiveJob(cancelledElements, cancelled, 1300);
  assert.equal(cancelledElements['active-jobs-section'].hidden, true);
  assert.equal(cancelledElements['recent-activity-section'].hidden, false);
  assert.equal(cancelledElements['recent-job-title'].textContent, 'Deletion cancelled');
  assert.match(cancelledElements['recent-job-status'].textContent, /0 \/ 2 confirmed deleted/);
  assert.equal(cancelledElements['fixed-job-bar'].hidden, true);
});

test('non-terminal jobs render only in Active Jobs and never in Recent activity', () => {
  for (const state of [JOB_STATES.RUNNING, JOB_STATES.PAUSED, JOB_STATES.ERROR_PAUSED]) {
    const elements = fakeElements(ACTIVE_JOB_ELEMENT_IDS);
    const running = startDeleteJob(plan([record(`state-${state}`)]), { now: 1000 });
    let job = running;
    if (state !== JOB_STATES.RUNNING) job = requestPause(running, { now: 1100 });
    if (state === JOB_STATES.ERROR_PAUSED) {
      job.state = JOB_STATES.ERROR_PAUSED;
      job.last_error = { code: 'network_error' };
    }

    renderActiveJob(elements, job, 1200);
    assert.equal(elements['active-jobs-section'].hidden, false, state);
    assert.equal(elements['recent-activity-section'].hidden, true, state);
  }
});
