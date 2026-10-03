'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'dashboard.html'), 'utf8');

test('dashboard presents the ChatGPT Manager workflow and product identity', () => {
  assert.match(html, /<title>ChatGPT Manager<\/title>/);
  assert.match(html, />ChatGPT Manager<\/h1>/);
  assert.match(html, /Manage, find and act on your ChatGPT conversations\./);
  assert.match(html, />Discover conversations<\/h2>/);
  assert.match(html, />History<\/h3>/);
  assert.match(html, />Find by content<\/h3>/);
  assert.match(html, />Conversations<\/h2>/);
  assert.doesNotMatch(html, /Steve's Tools|ChatGPT Bulk Delete/);
});

test('History maximum and workspace filters use explicit human labels', () => {
  assert.match(html, /for="history-maximum-input"[^>]*>\s*Maximum conversations/);
  assert.match(html, /id="history-maximum-input"/);
  assert.match(html, /id="type-filter"/);
  assert.match(html, /id="updated-from"/);
  assert.match(html, /id="updated-to"/);
  assert.match(html, /id="status-filter"/);
});

test('History exposes distinct Refresh, Rebuild, and query-driven recovery actions', () => {
  assert.match(html, /id="sync-btn"[^>]*>Refresh history</);
  assert.match(html, /id="history-load-btn"[^>]*>Refresh history</);
  assert.match(html, /id="history-rebuild-btn"[^>]*>Rebuild from ChatGPT</);
  assert.match(html, /id="history-recover-search-btn"[^>]*>Recover with content search</);
  assert.match(html, /Refresh merges new\/changed records/i);
});

test('Advanced diagnostics are collapsed by default and clear-local copy is explicit', () => {
  assert.match(html, /id="advanced-panel"[^>]*hidden/);
  assert.match(html, />Clear local conversation inventory</);
  assert.match(html, /does not delete ChatGPT conversations/i);
  assert.match(html, /settings and deletion-job state are preserved/i);
  assert.match(html, /id="diagnostic-run-btn"/);
  assert.match(html, /id="eligibility-verify-batch-btn"/);
});

test('selection and deletion controls express generic selection and explicit confirmation', () => {
  assert.match(html, /id="selected-count-text">0 selected</);
  assert.match(html, /id="delete-selected-btn"[^>]*>Delete</);
  assert.match(html, /id="delete-confirm-panel"/);
  assert.match(html, /id="confirm-delete-btn"/);
  assert.match(html, /id="active-job-pause-btn"/);
  assert.doesNotMatch(html, /selected for deletion|Hide protected|Copy Classification|Diagnose evidence/);
});

test('inventory workspace helper loads before the dashboard controller', () => {
  const workspace = html.indexOf('src="inventory-workspace.js"');
  const controller = html.indexOf('src="dashboard.js"');
  assert.ok(workspace >= 0);
  assert.ok(controller > workspace);
});


test('Advanced is physically above the conversation workspace and never needs scroll repair', () => {
  const advanced = html.indexOf('id="advanced-panel"');
  const workspace = html.indexOf('class="surface workspace"');
  assert.ok(advanced >= 0 && workspace > advanced);
});

test('persistent job planning and active-job controls are present without page queue controls', () => {
  for (const id of [
    'active-jobs-section',
    'active-job-pause-btn',
    'active-job-resume-btn',
    'active-job-cancel-btn',
    'delete-plan-summary',
    'approve-projects-btn',
    'remove-blocked-btn'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.doesNotMatch(html, /id="stop-delete-btn"|id="delete-progress-panel"/);
});

test('job view and client helpers load before the dashboard controller', () => {
  for (const script of ['dashboard-dom.js', 'delete-job-view.js', 'job-client.js']) {
    const helper = html.indexOf(`src="${script}"`);
    const controller = html.indexOf('src="dashboard.js"');
    assert.ok(helper >= 0 && helper < controller);
  }
});

test('Needs verification help supports hover and keyboard focus', () => {
  assert.match(html, /dashboard.css/);
  const controller = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'dashboard.css'), 'utf8');
  assert.match(controller, /data-tooltip/);
  assert.match(css, /verification-help:hover/);
  assert.match(css, /verification-help:focus/);
});

test('dashboard never owns deletion transport or a destructive timer loop', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'dashboard.js'), 'utf8');
  assert.doesNotMatch(controller, /runDeletionQueue|deletionAbortController/i);
  assert.match(controller, /JobClient.createJobClient/);
});

test('Phase 2 foundation exposes local Collections as a generic selection action', () => {
  assert.match(html, />Collections<\/h2>/);
  assert.match(html, /id="new-collection-btn"/);
  assert.match(html, /id="collection-filter"/);
  assert.match(html, /id="add-to-collection-btn"/);
  assert.match(html, /id="remove-from-collection-btn"/);
  assert.match(html, /do not modify ChatGPT/i);
});

test('History inline controls size the Refresh button from its content instead of a fixed narrow column', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'dashboard.css'), 'utf8');
  assert.match(css, /\.inline-controls\s*\{[^}]*grid-template-columns:\s*minmax\(150px,\s*1fr\)\s+max-content/s);
});

test('provider-neutral foundation modules load before dashboard controller', () => {
  for (const script of [
    'conversation-ref.js',
    'provider-capabilities.js',
    'manager-meta-db.js',
    'collection-service.js',
    'archive-registry.js'
  ]) {
    const helper = html.indexOf(`src="${script}"`);
    const controller = html.indexOf('src="dashboard.js"');
    assert.ok(helper >= 0 && helper < controller, `${script} should load before dashboard.js`);
  }
});
