'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  approveProjectReview,
  createDeleteReview,
  excludeReviewCategory,
  summarizeDeleteReview
} = require('../delete-preparation.js');

function preparation(overrides = {}) {
  return {
    state: 'complete',
    selected_ids: ['standalone', 'project', 'custom', 'unknown'],
    standalone_ids: ['standalone'],
    project_ids: ['project'],
    custom_gpt_ids: ['custom'],
    unresolved_ids: ['unknown'],
    retry_after_ms: null,
    ...overrides
  };
}

test('review blockers are separate categories and selected membership stays immutable', () => {
  const selected = preparation().selected_ids;
  const review = createDeleteReview(preparation());
  const summary = summarizeDeleteReview(review);

  assert.deepEqual(summary.included_ids, ['standalone', 'project', 'custom', 'unknown']);
  assert.equal(summary.custom_gpt_blocked, 1);
  assert.equal(summary.unresolved_blocked, 1);
  assert.equal(summary.project_approval_required, true);
  assert.equal(summary.ready_for_start, false);
  assert.deepEqual(review.selected_ids, selected);
});

test('category exclusion edits only the proposed job and never workspace selection', () => {
  const review = createDeleteReview(preparation());
  const afterUnknown = excludeReviewCategory(review, 'unresolved');
  const afterCustom = excludeReviewCategory(afterUnknown, 'custom_gpt');
  const approved = approveProjectReview(afterCustom);
  const summary = summarizeDeleteReview(approved);

  assert.deepEqual(summary.included_ids, ['standalone', 'project']);
  assert.deepEqual(summary.excluded_ids, ['custom', 'unknown']);
  assert.deepEqual(approved.selected_ids, ['standalone', 'project', 'custom', 'unknown']);
  assert.deepEqual(approved.approved_project_ids, ['project']);
  assert.equal(summary.ready_for_start, true);
});

test('a changed preparation result invalidates prior Project approval', () => {
  const approved = approveProjectReview(createDeleteReview(preparation({
    selected_ids: ['standalone', 'project'],
    custom_gpt_ids: [],
    unresolved_ids: []
  })));
  assert.equal(summarizeDeleteReview(approved).ready_for_start, true);

  const refreshed = createDeleteReview(preparation({
    selected_ids: ['standalone', 'project', 'project-two'],
    project_ids: ['project', 'project-two'],
    custom_gpt_ids: [],
    unresolved_ids: []
  }));

  assert.deepEqual(refreshed.approved_project_ids, []);
  assert.equal(summarizeDeleteReview(refreshed).project_approval_required, true);
  assert.equal(summarizeDeleteReview(refreshed).ready_for_start, false);
});
