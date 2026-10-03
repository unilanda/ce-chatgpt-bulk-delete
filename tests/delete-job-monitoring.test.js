'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { CLASSIFICATIONS } = require('../conversation-policy.js');
const {
  JOB_STATES,
  buildDeletePlan,
  requestPause,
  startDeleteJob
} = require('../delete-job.js');
const {
  ACTIVE_JOB_ELEMENT_IDS,
  formatCountdown,
  renderActiveJob
} = require('../delete-job-view.js');

class ClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) {
    if (force) this.values.add(name);
    else this.values.delete(name);
  }
}

function elements() {
  const ids = new Set([
    ...ACTIVE_JOB_ELEMENT_IDS,
    'active-job-timing',
    'active-job-review-btn',
    'fixed-job-bar',
    'fixed-job-summary',
    'fixed-job-timing',
    'fixed-job-pause-btn',
    'fixed-job-resume-btn',
    'fixed-job-details-btn'
  ]);
  return Object.fromEntries([...ids].map(id => [id, {
    id,
    textContent: '',
    hidden: false,
    disabled: false,
    classList: new ClassList()
  }]));
}

function runningJob(intervalSeconds = 150) {
  const records = ['one', 'two'].map(id => ({
    id,
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  }));
  return startDeleteJob(buildDeletePlan({
    ids: records.map(record => record.id),
    records,
    intervalSeconds,
    now: 1000,
    jobId: 'monitoring-job'
  }), { now: 1000 });
}

test('countdown formatting ticks and distinguishes an overdue Chrome wake', () => {
  assert.equal(formatCountdown(151000, 1000), '02:30');
  assert.equal(formatCountdown(151000, 2000), '02:29');
  assert.equal(formatCountdown(151000, 61000), '01:30');
  assert.equal(formatCountdown(3601000, 1000), '1:00:00');
  assert.equal(formatCountdown(1000, 1000), 'Waiting for Chrome…');
  assert.equal(formatCountdown(null, 1000), '');
});

test('running details expose exact target, last completion, next target, and alarm mode', () => {
  const job = runningJob(150);
  job.items[0].status = 'completed';
  job.items[0].completed_at = 1000;
  job.counts.completed = 1;
  job.counts.pending = 1;
  job.next_run_at = 151000;
  const view = elements();

  renderActiveJob(view, job, 1000);

  assert.match(view['active-job-timing'].textContent, /Target delay: 150 seconds/);
  assert.match(view['active-job-timing'].textContent, /Last completed:/);
  assert.match(view['active-job-timing'].textContent, /Next target:/);
  assert.match(view['active-job-timing'].textContent, /Scheduler: Chrome alarm/);
  assert.match(view['active-job-next'].textContent, /02:30/);
  assert.match(view['fixed-job-summary'].textContent, /Deleting 1 \/ 2/);
  assert.match(view['fixed-job-timing'].textContent, /1 remaining · Target delay: 150s · Next in 02:30/);
});

test('manual pause offers direct Resume and Review remaining', () => {
  const view = elements();
  const paused = requestPause(runningJob(), { now: 2000 });

  renderActiveJob(view, paused, 2000);

  assert.equal(view['active-job-title'].textContent, 'Deletion paused');
  assert.equal(view['active-job-resume-btn'].textContent, 'Resume');
  assert.equal(view['active-job-review-btn'].hidden, false);
  assert.equal(view['fixed-job-resume-btn'].textContent, 'Resume');
  assert.match(view['fixed-job-summary'].textContent, /Deletion paused/);
});

test('error and restart pauses require review before Resume', () => {
  const view = elements();
  const paused = requestPause(runningJob(), { now: 2000 });
  paused.state = JOB_STATES.ERROR_PAUSED;
  paused.last_error = { code: 'browser_restarted' };

  renderActiveJob(view, paused, 2000);

  assert.equal(view['active-job-title'].textContent, 'Deletion paused — review required');
  assert.equal(view['active-job-resume-btn'].textContent, 'Review & Resume');
  assert.equal(view['active-job-review-btn'].hidden, true);
  assert.equal(view['fixed-job-resume-btn'].textContent, 'Review & Resume');
  assert.match(view['fixed-job-summary'].textContent, /review required/);
});

test('fixed bar is hidden for terminal jobs', () => {
  const view = elements();
  const completed = runningJob();
  completed.state = JOB_STATES.COMPLETED;
  completed.finished_at = 2000;
  completed.next_run_at = null;
  completed.items.forEach(item => {
    item.status = 'completed';
    item.completed_at = 2000;
  });
  completed.counts.completed = 2;
  completed.counts.pending = 0;

  renderActiveJob(view, completed, 2000);

  assert.equal(view['fixed-job-bar'].hidden, true);
});
