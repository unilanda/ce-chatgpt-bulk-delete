# Manager backbone V3 implementation plan

Goal: implement the approved local management backbone with a tested concrete patch.
Execution: inline in isolated /mnt/data candidate; no user-worktree commit or mutation.
Spec: documentation/design/MANAGER_BACKBONE_V3.md.
Stack: existing vanilla JS/classic scripts, IndexedDB, Node test runner; native
Chromium/Playwright verification as an additional gate, not a production dependency.

## Global constraints
No live account calls; no new permissions; no DeleteJob migration; no invented AI or
capture results; previous draft is not assumed applied locally. Provide cumulative
patch and exact baseline hashes. Successful writes mean transaction commit.

## Review focus
Concurrent metadata writers/abort rollback; archive metadata without content; source
revision churn and stale artifacts; current versus owned capture tabs on cancellation;
disabled UI and programmatic no-op prevention. Pin these with unit and native IDB tests.

## Tasks
- [x] 1. Strict refs/provider descriptors + transaction-safe metadata v2; tests for
  migration, rollback, unique indexes, blocked upgrades and dual DB isolation.
- [x] 2. Atomic Collections and Tags repositories and working management UI.
- [x] 3. Archive revision/head/attempt contracts and conservative freshness;
  immutable artifact/source provenance; relationship and cluster repositories.
- [x] 4. Static action registry, prerequisite plans, future-service contracts,
  browser/provider boundaries, capture orchestrator and owned-tab lifecycle.
- [x] 5. Actual dashboard capability surface, view/archive/tag filters, error isolation
  and cross-dashboard metadata invalidation. No destructive controller rewrite.
- [x] 6. Fresh full Node/static/native Chromium gates, isolated self-review, source
  preimage manifest, patch apply/retest, documentation and Codex handoff package.

Each task: add tests, observe failures, implement, rerun focused tests. Final
verification covers every original test as well as the additive tests. Codex performs
an independent integration review later; this pass is not a fresh-agent review.

## Remaining release gate
- [ ] Run native IndexedDB/browser suite on a host that permits normal local test
  navigation. Current environment reports ERR_BLOCKED_BY_ADMINISTRATOR; no bypass.
- [ ] Independent Codex integration review and installed-Chrome local-metadata smoke.

Implementation and local/synthetic verification are complete for this draft. The
checkboxes above are not a claim that the blocked native gate passed. No user Git
commits, profile access, real provider calls or deployed extension installation.
