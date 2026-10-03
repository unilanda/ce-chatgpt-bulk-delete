'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  REQUIRED_ELEMENT_IDS,
  bindDashboardElements
} = require('../dashboard-dom.js');
const { CLASSIFICATIONS } = require('../conversation-policy.js');
const { buildDeletePlan } = require('../delete-job.js');
const { renderPlan } = require('../delete-job-view.js');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');
const controller = fs.readFileSync(path.join(root, 'dashboard.js'), 'utf8');
const htmlIds = new Set(Array.from(
  html.matchAll(/\sid=["']([^"']+)["']/g),
  match => match[1]
));
const staticReferences = new Set(Array.from(
  controller.matchAll(/elements\[['"]([^'"]+)['"]\]/g),
  match => match[1]
));

test('real dashboard HTML contains every required and statically referenced element', () => {
  for (const id of REQUIRED_ELEMENT_IDS) {
    assert.equal(htmlIds.has(id), true, `missing required HTML id ${id}`);
  }
  for (const id of staticReferences) {
    assert.equal(htmlIds.has(id), true, `controller references missing HTML id ${id}`);
    assert.equal(REQUIRED_ELEMENT_IDS.includes(id), true, `registry omits ${id}`);
  }
  assert.equal(htmlIds.has('modal-title'), true);
});

test('binding the IDs extracted from real HTML produces a complete controller registry', () => {
  const nodes = new Map(Array.from(htmlIds, id => [id, { id }]));
  const bound = bindDashboardElements({
    getElementById(id) { return nodes.get(id) || null; }
  });

  assert.equal(bound['modal-title'].id, 'modal-title');
  assert.deepEqual(Object.keys(bound), REQUIRED_ELEMENT_IDS);
});

test('accepted and blocked plans render through the IDs instantiated from real HTML', () => {
  const nodes = new Map(Array.from(htmlIds, id => [id, {
    id,
    textContent: '',
    hidden: false,
    disabled: false,
    classList: { toggle() {} }
  }]));
  const bound = bindDashboardElements({
    getElementById(id) { return nodes.get(id) || null; }
  });
  const standalone = {
    id: 'standalone',
    classification: CLASSIFICATIONS.STANDALONE,
    classification_evidence: 'history-sync'
  };
  const unknown = {
    id: 'unknown',
    classification: CLASSIFICATIONS.UNKNOWN,
    classification_evidence: 'search-only'
  };
  const ready = buildDeletePlan({
    ids: [standalone.id],
    records: [standalone],
    intervalSeconds: 600,
    now: 1000,
    jobId: 'real-html-ready'
  });
  const blocked = buildDeletePlan({
    ids: [standalone.id, unknown.id],
    records: [standalone, unknown],
    intervalSeconds: 600,
    now: 1000,
    jobId: 'real-html-blocked'
  });

  assert.doesNotThrow(() => renderPlan(bound, ready, [standalone]));
  assert.equal(bound['confirm-delete-btn'].disabled, false);
  assert.doesNotThrow(() => renderPlan(bound, blocked, [standalone, unknown]));
  assert.equal(bound['confirm-delete-btn'].disabled, true);
  assert.match(bound['delete-preflight-status'].textContent, /Needs verification/);
});

for (const missingId of [
  'history-status',
  'advanced-toggle-icon',
  'runtime-build-marker',
  'sort-title-header',
  'sort-title-icon',
  'sort-type-header',
  'sort-type-icon',
  'sort-updated-header',
  'sort-updated-icon',
  'modal-title',
  'active-job-status'
]) {
  test(`binding fails closed with the exact missing critical ID: ${missingId}`, () => {
    const nodes = new Map(Array.from(htmlIds, id => [id, { id }]));
    nodes.delete(missingId);
    assert.throws(
      () => bindDashboardElements({ getElementById: id => nodes.get(id) || null }),
      new Error(`Missing required dashboard element: ${missingId}`)
    );
  });
}
