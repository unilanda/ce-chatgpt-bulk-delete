'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  conversationRecord,
  createDashboardHarness
} = require('./helpers/dashboard-harness.js');

async function openSelected(records, options = {}) {
  const harness = await createDashboardHarness({ records, ...options });
  await harness.awaitInitialization();
  await harness.selectAllRows();
  await harness.document.getElementById('delete-selected-btn').click();
  return harness;
}

test('all cached evidence advances Prepare to Review without creating a durable job', async () => {
  const harness = await openSelected([
    conversationRecord('standalone'),
    conversationRecord('project', 'project-protected')
  ]);

  assert.match(harness.document.getElementById('delete-stage-indicator').textContent, /2 Review/);
  assert.match(harness.document.getElementById('delete-review-standalone').textContent, /1/);
  assert.match(harness.document.getElementById('delete-review-project').textContent, /1/);
  assert.equal(
    harness.runtimeMessages.some(message =>
      ['delete_job:create_plan', 'delete_job:start_plan'].includes(message.type)
    ),
    false
  );
});

test('mixed cached and Unverified selection auto-prepares and persists discovered evidence', async () => {
  const harness = await openSelected([
    conversationRecord('cached'),
    conversationRecord('search-only', 'unknown-protected')
  ], {
    eligibilityResponses: {
      'search-only': { status: 200, body: { gizmo_id: null } }
    }
  });

  assert.match(harness.document.getElementById('delete-stage-indicator').textContent, /2 Review/);
  assert.match(harness.document.getElementById('delete-review-standalone').textContent, /2/);
  assert.equal(harness.fetchCalls.filter(call =>
    String(call[0]).includes('/backend-api/conversation/search-only')
  ).length, 1);
  assert.equal(
    harness.context.chatDB.db.records.get('search-only').classification,
    'standalone-safe'
  );
});

test('Review separates discovered Project and Custom GPT and exclusion preserves selection', async () => {
  const harness = await openSelected([
    conversationRecord('project-search', 'unknown-protected'),
    conversationRecord('custom-search', 'unknown-protected')
  ], {
    eligibilityResponses: {
      'project-search': { status: 200, body: { gizmo_id: 'g-p-synthetic' } },
      'custom-search': { status: 200, body: { gizmo_id: 'g-synthetic' } }
    }
  });

  assert.match(harness.document.getElementById('delete-review-project').textContent, /1/);
  assert.match(harness.document.getElementById('delete-review-custom-gpt').textContent, /1/);
  await harness.document.getElementById('exclude-custom-gpt-btn').click();
  assert.equal(harness.document.getElementById('selected-count-text').textContent, '2 selected');
  await harness.document.getElementById('approve-projects-btn').click();
  await harness.document.getElementById('delete-review-continue-btn').click();
  assert.match(harness.document.getElementById('delete-stage-indicator').textContent, /3 Start/);
});

test('429 preparation stops, exposes Retry verification, and creates no DeleteJob', async () => {
  const harness = await openSelected([
    conversationRecord('limited', 'unknown-protected'),
    conversationRecord('later', 'unknown-protected')
  ], {
    eligibilityResponses: {
      limited: { status: 429, body: {}, headers: { 'Retry-After': '90' } },
      later: { status: 200, body: { gizmo_id: null } }
    }
  });

  assert.equal(harness.document.getElementById('retry-unresolved-btn').hidden, false);
  assert.match(harness.document.getElementById('delete-preflight-status').textContent, /rate|retry/i);
  assert.equal(harness.fetchCalls.some(call => String(call[0]).endsWith('/later')), false);
  assert.equal(harness.currentJob, null);
});

test('session-unavailable preparation stops once and leaves later candidates protected', async () => {
  const harness = await openSelected([
    conversationRecord('first', 'unknown-protected'),
    conversationRecord('later', 'unknown-protected')
  ], { sessionAvailable: false });

  assert.equal(harness.document.getElementById('retry-unresolved-btn').hidden, false);
  assert.match(
    harness.document.getElementById('delete-preflight-status').textContent,
    /session is unavailable/i
  );
  assert.equal(harness.fetchCalls.filter(call =>
    String(call[0]).includes('/backend-api/conversation/')
  ).length, 0);
  assert.equal(harness.context.chatDB.db.records.get('first').classification, 'unknown-protected');
  assert.equal(harness.context.chatDB.db.records.get('later').classification, 'unknown-protected');
  assert.equal(harness.currentJob, null);
});

test('Retry verification resumes unresolved preparation without creating a job', async () => {
  let attempts = 0;
  const harness = await openSelected([
    conversationRecord('retry-me', 'unknown-protected')
  ], {
    eligibilityResponder: async id => {
      assert.equal(id, 'retry-me');
      attempts += 1;
      return attempts === 1
        ? { status: 429, body: {}, headers: { 'Retry-After': '1' } }
        : { status: 200, body: { gizmo_id: null } };
    }
  });

  await harness.document.getElementById('retry-unresolved-btn').click();

  assert.equal(attempts, 2);
  assert.match(harness.document.getElementById('delete-review-standalone').textContent, /1/);
  assert.equal(harness.currentJob, null);
});

test('Cancel preparation aborts an in-flight verification and leaves selection intact', async () => {
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const harness = await createDashboardHarness({
    records: [conversationRecord('slow', 'unknown-protected')],
    eligibilityResponder: async (_id, options) => new Promise((_resolve, reject) => {
      requestStarted();
      options.signal.addEventListener('abort', () => {
        const error = new Error('Synthetic cancellation');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });
  await harness.awaitInitialization();
  await harness.selectAllRows();

  const opening = harness.document.getElementById('delete-selected-btn').click();
  await started;
  await harness.document.getElementById('cancel-delete-confirm-btn').click();
  await opening;

  assert.equal(harness.document.getElementById('progress-modal').classList.contains('hidden'), true);
  assert.equal(harness.document.getElementById('selected-count-text').textContent, '1 selected');
  assert.equal(harness.currentJob, null);
});

test('one-second target is accepted with best-effort warning and Back returns to Review', async () => {
  const harness = await openSelected([conversationRecord('fast-one')]);
  const input = harness.document.getElementById('delete-interval-input');
  input.value = '1';

  await harness.document.getElementById('delete-review-continue-btn').click();

  assert.match(harness.document.getElementById('delete-stage-indicator').textContent, /3 Start/);
  assert.match(harness.document.getElementById('delete-plan-summary').textContent, /Target delay: 1 seconds/);
  assert.equal(harness.document.getElementById('delete-fast-timing-warning').hidden, false);
  assert.equal(harness.currentJob, null);

  await harness.document.getElementById('delete-start-back-btn').click();
  assert.equal(harness.document.getElementById('delete-review-panel').hidden, false);
  assert.equal(harness.runtimeMessages.some(message => message.type === 'delete_job:start_plan'), false);
});

test('Start summary formats a long exact estimate for humans', async () => {
  const records = Array.from({ length: 27 }, (_, index) =>
    conversationRecord(`duration-${index}`)
  );
  const harness = await openSelected(records);
  harness.document.getElementById('delete-interval-input').value = '150';

  await harness.document.getElementById('delete-review-continue-btn').click();

  const summary = harness.document.getElementById('delete-plan-summary').textContent;
  assert.match(summary, /Estimated minimum wait: ~1 hour 5 minutes/);
  assert.doesNotMatch(summary, /3900 seconds/);
});

test('successful Start transfers included IDs only and leaves excluded rows selected', async () => {
  const harness = await openSelected([
    conversationRecord('included'),
    conversationRecord('blocked-custom', 'custom-gpt-protected')
  ]);
  await harness.document.getElementById('exclude-custom-gpt-btn').click();
  await harness.document.getElementById('delete-review-continue-btn').click();
  await harness.document.getElementById('confirm-delete-btn').click();

  const startMessage = harness.runtimeMessages.find(message =>
    message.type === 'delete_job:start_plan'
  );
  assert.deepEqual(startMessage.ids, ['included']);
  assert.equal(startMessage.interval_seconds, 600);
  assert.deepEqual(startMessage.approved_project_ids, []);
  assert.equal(harness.document.getElementById('selected-count-text').textContent, '1 selected');
  const selectedCheckboxes = harness.document.querySelectorAll('.row-checkbox')
    .filter(checkbox => checkbox.checked)
    .map(checkbox => checkbox.value);
  assert.deepEqual(selectedCheckboxes, ['blocked-custom']);
});
