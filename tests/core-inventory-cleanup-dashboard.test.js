'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  conversationRecord,
  createDashboardHarness
} = require('./helpers/dashboard-harness.js');

function historyItem(id) {
  return {
    id,
    title: `History ${id}`,
    create_time: 1789486200,
    update_time: 1789486324.5,
    gizmo_id: null
  };
}

function historyResponse(status, body = {}, headers = {}) {
  return { status, body, headers };
}

function terminalJobFactory(state = 'cancelled') {
  return (context, records) => {
    const now = 1789487000000;
    const ready = context.DeleteJob.buildDeletePlan({
      ids: records.map(record => record.id),
      records,
      intervalSeconds: 150,
      now,
      jobId: `terminal-${state}`
    });
    const running = context.DeleteJob.startDeleteJob(ready, { now: now + 1 });
    if (state === 'cancelled') {
      return context.DeleteJob.requestCancel(running, { now: now + 2 });
    }
    const completed = context.structuredClone(running);
    for (const [index, item] of completed.items.entries()) {
      item.status = context.DeleteJob.ITEM_STATES.COMPLETED;
      item.completed_at = now + 2 + index;
    }
    completed.counts.completed = completed.items.length;
    completed.counts.pending = 0;
    completed.state = context.DeleteJob.JOB_STATES.COMPLETED;
    completed.next_run_at = null;
    completed.finished_at = now + 3;
    completed.updated_at = now + 3;
    return completed;
  };
}

function runningJobFactory(context, records) {
  const now = 1789487000000;
  return context.DeleteJob.startDeleteJob(context.DeleteJob.buildDeletePlan({
    ids: records.map(record => record.id),
    records,
    intervalSeconds: 150,
    now,
    jobId: 'running-rebuild-block'
  }), { now: now + 1 });
}

function historyFetches(harness) {
  return harness.fetchCalls.filter(([url]) =>
    String(url).includes('/backend-api/conversations?')
  );
}

test('real dashboard loads inventory-resync before dashboard.js and binds cleanup controls', async () => {
  const harness = await createDashboardHarness();
  await harness.awaitInitialization();

  const resyncIndex = harness.scripts.indexOf('inventory-resync.js');
  assert.notEqual(resyncIndex, -1);
  assert.ok(resyncIndex < harness.scripts.indexOf('dashboard.js'));
  for (const id of [
    'history-rebuild-btn',
    'history-recover-search-btn',
    'recent-activity-section',
    'recent-job-dismiss-btn'
  ]) {
    assert.ok(harness.document.getElementById(id), id);
  }
  assert.deepEqual(harness.consoleCalls.error, []);
});

test('normal Refresh merges without clearing and hides Search recovery on completion', async () => {
  const harness = await createDashboardHarness({
    records: [conversationRecord('existing')],
    historyResponder: async url => {
      assert.equal(url.searchParams.get('limit'), '10');
      assert.equal(url.searchParams.get('offset'), '0');
      return historyResponse(200, {
        items: [historyItem('refreshed')],
        total: 1,
        limit: 10,
        offset: 0
      });
    }
  });
  await harness.awaitInitialization();
  harness.document.getElementById('history-maximum-input').value = '10';

  await harness.document.getElementById('history-load-btn').click();

  assert.equal(harness.inventoryClearCalls, 0);
  assert.equal(harness.context.chatDB.db.records.has('existing'), true);
  assert.equal(harness.context.chatDB.db.records.has('refreshed'), true);
  assert.equal(harness.document.getElementById('history-recover-search-btn').hidden, true);
});

test('partial Refresh preserves existing and successful records and offers Search recovery', async () => {
  let page = 0;
  const harness = await createDashboardHarness({
    records: [conversationRecord('existing')],
    historyResponder: async () => {
      page += 1;
      return page === 1
        ? historyResponse(200, {
            items: Array.from({ length: 20 }, (_, index) => historyItem(`refresh-${index}`)),
            total: 40,
            limit: 20,
            offset: 0
          })
        : historyResponse(429, {}, { 'Retry-After': '45' });
    }
  });
  await harness.awaitInitialization();

  await harness.document.getElementById('history-load-btn').click();

  assert.equal(harness.inventoryClearCalls, 0);
  assert.equal(harness.context.chatDB.db.records.has('existing'), true);
  assert.equal(harness.context.chatDB.db.records.has('refresh-0'), true);
  assert.equal(harness.document.getElementById('history-recover-search-btn').hidden, false);
  assert.match(harness.document.getElementById('history-status').textContent, /partially loaded/i);
});

test('declining Rebuild confirmation performs no clear and no History fetch', async () => {
  const prompts = [];
  const harness = await createDashboardHarness({
    records: [conversationRecord('existing')],
    confirmImpl(message) { prompts.push(message); return false; },
    historyResponder: async () => {
      throw new Error('History must not be fetched after decline');
    }
  });
  await harness.awaitInitialization();

  await harness.document.getElementById('history-rebuild-btn').click();

  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /No ChatGPT conversation is deleted/i);
  assert.equal(harness.inventoryClearCalls, 0);
  assert.equal(historyFetches(harness).length, 0);
  assert.equal(harness.context.chatDB.db.records.has('existing'), true);
});

test('complete Rebuild clears once, preserves setting and terminal job, and reports complete', async () => {
  const records = [conversationRecord('old')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory: terminalJobFactory('cancelled'),
    confirmImpl: () => true,
    historyResponder: async url => historyResponse(200, {
      items: [historyItem('new')],
      total: 1,
      limit: Number(url.searchParams.get('limit')),
      offset: Number(url.searchParams.get('offset'))
    })
  });
  await harness.awaitInitialization();
  const terminalJobId = harness.currentJob.job_id;

  await harness.document.getElementById('history-rebuild-btn').click();

  assert.equal(harness.inventoryClearCalls, 1);
  assert.deepEqual([...harness.context.chatDB.db.records.keys()], ['new']);
  assert.equal(harness.storageValues.delete_interval_seconds, 600);
  assert.equal(harness.currentJob.job_id, terminalJobId);
  assert.match(harness.document.getElementById('history-status').textContent, /rebuilt.*1 conversation/i);
  assert.match(harness.document.getElementById('history-inventory-status').textContent, /complete History rebuild/i);
  assert.equal(harness.document.getElementById('history-recover-search-btn').hidden, true);
});

test('non-terminal job blocks Rebuild before confirmation, clear, or fetch', async () => {
  let confirmations = 0;
  const records = [conversationRecord('active')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory: runningJobFactory,
    confirmImpl() { confirmations += 1; return true; },
    historyResponder: async () => {
      throw new Error('History must not be fetched while a job is active');
    }
  });
  await harness.awaitInitialization();

  await harness.document.getElementById('history-rebuild-btn').click();

  assert.equal(confirmations, 0);
  assert.equal(harness.inventoryClearCalls, 0);
  assert.equal(historyFetches(harness).length, 0);
  assert.match(harness.document.getElementById('history-status').textContent, /active deletion job/i);
});

test('first-page 429 leaves intentional empty inventory and offers Search recovery', async () => {
  const harness = await createDashboardHarness({
    records: [conversationRecord('old')],
    confirmImpl: () => true,
    historyResponder: async () => historyResponse(429, {}, { 'Retry-After': '30' })
  });
  await harness.awaitInitialization();

  await harness.document.getElementById('history-rebuild-btn').click();

  assert.equal(harness.inventoryClearCalls, 1);
  assert.equal(harness.context.chatDB.db.records.size, 0);
  assert.match(harness.document.getElementById('history-status').textContent, /failed before any conversation was loaded/i);
  assert.equal(harness.document.getElementById('history-recover-search-btn').hidden, false);
});

test('later 429 keeps the first rebuilt page and Search recovery focuses without running Search', async () => {
  let page = 0;
  const harness = await createDashboardHarness({
    records: [conversationRecord('old')],
    confirmImpl: () => true,
    historyResponder: async url => {
      page += 1;
      return page === 1
        ? historyResponse(200, {
            items: Array.from({ length: 10 }, (_, index) => historyItem(`page-${index}`)),
            total: 30,
            limit: 10,
            offset: 0
          })
        : historyResponse(429, {}, { 'Retry-After': '90' });
    }
  });
  await harness.awaitInitialization();

  await harness.document.getElementById('history-rebuild-btn').click();

  assert.equal(harness.context.chatDB.db.records.size, 10);
  assert.match(harness.document.getElementById('history-status').textContent, /partial.*10 conversations/i);
  assert.equal(harness.document.getElementById('history-recover-search-btn').hidden, false);
  const fetchCount = harness.fetchCalls.length;
  await harness.document.getElementById('history-recover-search-btn').click();
  assert.equal(harness.document.getElementById('search-queries-input').focused, true);
  assert.match(harness.document.getElementById('search-status').textContent, /cannot guarantee a complete account inventory/i);
  assert.equal(harness.fetchCalls.length, fetchCount);
});

test('Advanced Clear preserves settings and terminal job while clearing inventory only', async () => {
  const records = [conversationRecord('clear-me')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory: terminalJobFactory('cancelled'),
    confirmImpl: () => true
  });
  await harness.awaitInitialization();
  const terminalJobId = harness.currentJob.job_id;
  const fetchCount = harness.fetchCalls.length;

  await harness.document.getElementById('clear-db-btn').click();

  assert.equal(harness.inventoryClearCalls, 1);
  assert.equal(harness.context.chatDB.db.records.size, 0);
  assert.equal(harness.storageValues.delete_interval_seconds, 600);
  assert.equal(harness.currentJob.job_id, terminalJobId);
  assert.equal(harness.fetchCalls.length, fetchCount);
  assert.match(harness.document.getElementById('history-status').textContent, /settings and deletion-job state were preserved/i);
});

test('non-terminal job blocks Advanced Clear before confirmation or inventory mutation', async () => {
  let confirmations = 0;
  const harness = await createDashboardHarness({
    records: [conversationRecord('keep-active')],
    initialJobFactory: runningJobFactory,
    confirmImpl() { confirmations += 1; return true; }
  });
  await harness.awaitInitialization();
  const fetchCount = harness.fetchCalls.length;

  await harness.document.getElementById('clear-db-btn').click();

  assert.equal(confirmations, 0);
  assert.equal(harness.inventoryClearCalls, 0);
  assert.equal(harness.context.chatDB.db.records.has('keep-active'), true);
  assert.equal(harness.fetchCalls.length, fetchCount);
  assert.match(harness.document.getElementById('history-status').textContent, /active deletion job/i);
});

test('terminal job renders as Recent activity and Dismiss performs no fetch', async () => {
  const records = [conversationRecord('completed')];
  const harness = await createDashboardHarness({
    records,
    initialJobFactory: terminalJobFactory('completed')
  });
  await harness.awaitInitialization();

  assert.equal(harness.document.getElementById('active-jobs-section').hidden, true);
  assert.equal(harness.document.getElementById('recent-activity-section').hidden, false);
  assert.equal(harness.document.getElementById('fixed-job-bar').hidden, true);
  const fetchCount = harness.fetchCalls.length;

  await harness.document.getElementById('recent-job-dismiss-btn').click();

  assert.equal(harness.currentJob, null);
  assert.equal(harness.document.getElementById('recent-activity-section').hidden, true);
  assert.equal(harness.fetchCalls.length, fetchCount);
  assert.equal(
    harness.runtimeMessages.filter(message => message.type === 'delete_job:dismiss_terminal').length,
    1
  );
});
