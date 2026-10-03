'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  conversationRecord,
  createDashboardHarness
} = require('./helpers/dashboard-harness.js');

function jobFactory(state) {
  return (context, records) => {
    const now = 1789487000000;
    const job = context.DeleteJob.buildDeletePlan({
      ids: records.map(record => record.id),
      records,
      intervalSeconds: 600,
      now,
      jobId: `initial-${state}`
    });
    if (state === 'draft' || state === 'ready') return job;
    const running = context.DeleteJob.startDeleteJob(job, { now: now + 1 });
    if (state === 'running') return running;
    const paused = context.DeleteJob.requestPause(running, { now: now + 2 });
    if (state === 'paused') return paused;
    const errorPaused = context.structuredClone(paused);
    errorPaused.state = context.DeleteJob.JOB_STATES.ERROR_PAUSED;
    errorPaused.last_error = context.structuredClone({ code: 'network_error' });
    errorPaused.updated_at = now + 3;
    return errorPaused;
  };
}

test('actual dashboard HTML and scripts initialize inventory, wiring, and Advanced in place', async () => {
  const record = conversationRecord('unknown-one', 'unknown-protected');
  const harness = await createDashboardHarness({ records: [record] });

  await harness.awaitInitialization();

  assert.equal(harness.scripts.at(-1), 'dashboard.js');
  assert.equal(
    harness.document.getElementById('runtime-build-marker').textContent,
    'ChatGPT Manager · manager-backbone-v3 · cm-runtime-20261002-mb3 · job schema 1'
  );
  assert.equal(harness.document.getElementById('inventory-count').textContent, '1 conversation');
  assert.equal(
    harness.document.getElementById('history-inventory-status').textContent,
    '1 conversation in local inventory'
  );
  assert.equal(
    harness.document.getElementById('history-status').textContent,
    'History has not been loaded in this tab.'
  );
  assert.equal(harness.document.querySelectorAll('.row-checkbox').length, 1);
  assert.equal(harness.document.querySelectorAll('.verify-btn').length, 1);
  assert.match(harness.document.getElementById('chat-list-body').children[0].innerHTML, /Unverified/);
  assert.equal(harness.document.getElementById('advanced-panel').hidden, true);

  await harness.document.getElementById('sort-title-header').click();
  assert.equal(harness.document.getElementById('sort-title-icon').textContent, '▲');

  await harness.document.getElementById('advanced-toggle-btn').click();
  assert.equal(harness.document.getElementById('advanced-panel').hidden, false);
  assert.equal(
    harness.document.getElementById('advanced-toggle-btn').getAttribute('aria-expanded'),
    'true'
  );
  await harness.document.getElementById('advanced-toggle-btn').click();
  assert.equal(harness.document.getElementById('advanced-panel').hidden, true);
  assert.equal('scrollIntoView' in harness.document.getElementById('advanced-panel'), false);
});

for (const state of ['draft', 'running', 'paused', 'error_paused']) {
  test(`jobClient.connect renders an initial ${state} job from actual dashboard wiring`, async () => {
    const classification = state === 'draft' ? 'unknown-protected' : 'standalone-safe';
    const records = [conversationRecord(`job-${state}`, classification)];
    const harness = await createDashboardHarness({
      records,
      initialJobFactory: jobFactory(state)
    });

    await harness.awaitInitialization();

    assert.equal(harness.storageListeners.length, 1);
    assert.equal(harness.document.getElementById('active-jobs-section').hidden, false);
    assert.match(
      harness.document.getElementById('active-job-title').textContent,
      /Deletion/
    );
    if (state === 'error_paused') {
      assert.match(
        harness.document.getElementById('active-job-error').textContent,
        /network error/i
      );
    }
  });
}

test('jobClient.connect renders no active job and a storage change renders a running job', async () => {
  const records = [conversationRecord('storage-running')];
  const harness = await createDashboardHarness({ records });
  await harness.awaitInitialization();
  assert.equal(harness.document.getElementById('active-jobs-section').hidden, true);

  const running = jobFactory('running')(harness.context, records);
  await harness.emitStorageJob(running);

  assert.equal(harness.document.getElementById('active-jobs-section').hidden, false);
  assert.equal(
    harness.document.getElementById('active-job-title').textContent,
    'Deletion running'
  );
});

const planCases = [
  ['1 Standalone', [conversationRecord('s-1')], /1 Standalone/, false],
  ['2 Standalone', [conversationRecord('s-1'), conversationRecord('s-2')], /2 Standalone/, false],
  ['17 Standalone', Array.from({ length: 17 }, (_, index) => conversationRecord(`s-${index}`)), /17 Standalone/, false],
  ['Standalone plus Project', [
    conversationRecord('standalone'),
    conversationRecord('project', 'project-protected')
  ], /1 Standalone · 1 Project/, true],
  ['17 mixed Standalone and Project', Array.from({ length: 17 }, (_, index) =>
    conversationRecord(`mixed-${index}`, index % 3 === 0
      ? 'project-protected'
      : 'standalone-safe')
  ), /17 total/, true],
  ['Unverified-containing', [
    conversationRecord('standalone'),
    conversationRecord('unverified', 'unknown-protected')
  ], /1 unresolved/i, false],
  ['Custom-GPT-containing', [
    conversationRecord('standalone'),
    conversationRecord('custom', 'custom-gpt-protected')
  ], /1 Custom GPT blocked/i, false]
];

for (const [label, records, expected, projectApproval] of planCases) {
  test(`${label} Delete click renders a deterministic plan with no deletion transport`, async () => {
    const harness = await createDashboardHarness({ records });
    await harness.awaitInitialization();
    await harness.selectAllRows();
    await harness.document.getElementById('delete-selected-btn').click();

    assert.equal(harness.document.getElementById('progress-modal').classList.contains('hidden'), false);
    assert.match(
      harness.document.getElementById('delete-plan-summary').textContent + ' ' +
        harness.document.getElementById('delete-preflight-status').textContent,
      expected
    );
    assert.equal(
      harness.runtimeMessages.filter(message => ['delete_job:create_plan', 'delete_job:start_plan'].includes(message.type)).length,
      0
    );
    assert.equal(
      harness.fetchCalls.some(([, options]) => options?.method === 'PATCH'),
      false
    );

    if (projectApproval) {
      assert.equal(harness.document.getElementById('approve-projects-btn').hidden, false);
      await harness.document.getElementById('approve-projects-btn').click();
      assert.equal(harness.document.getElementById('delete-review-continue-btn').disabled, false);
    }
  });
}

test('dashboard initialization failure is visible, logged with its Error, and handled', async () => {
  const unhandled = [];
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  try {
    const harness = await createDashboardHarness({ failDatabaseOpen: true });

    await assert.rejects(
      harness.awaitInitialization(),
      /Synthetic IndexedDB failure/
    );
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(
      harness.document.getElementById('history-status').textContent,
      'Dashboard initialization failed. Reload this extension page and check the dashboard console.'
    );
    const report = harness.consoleCalls.error.find(args =>
      args[0] === 'ChatGPT Manager dashboard initialization failed:'
    );
    assert.ok(report, 'initialization failure should have a dedicated console report');
    assert.equal(report[1] instanceof Error, true);
    assert.match(report[1].stack, /Synthetic IndexedDB failure/);
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});
