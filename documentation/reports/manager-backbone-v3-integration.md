# Manager backbone V3 — independent integration report

Date: 2026-10-02

## Source reconciliation

The V3 bundle SHA-256 was
`a05e6242abde5b785844e2e544ebcb4e361e494555c1a663e08641f32b8f76b2`.
Every bundled-file hash passed. The prior Core Inventory Cleanup review ZIP matched
its required SHA-256
`ce514eaa8b1122cb11924ef61f659f851cb071319c5503c90d08bec12f94c1a5`.
The supplied preimage checker reported `EXACT_BASELINE` for all 58 patch paths, and
`git apply --check` accepted the supplied patch. The candidate source was reconciled
file-by-file into the existing dirty worktree without resetting or replacing the
cumulative campaign.

The integrated V3 components are the separate metadata database and repositories,
canonical provider conversation refs, Collections and Tags, archive and artifact
provenance models, action/prerequisite contracts, provider/browser boundaries,
dependency-injected capture orchestration, and the actual dashboard integration.
Production Save, payload storage, AI, similarity, merge generation, Project
transport, Claude operations, Firefox runtime and durable CaptureJob execution remain
unimplemented and unavailable.

## Independent change to the supplied draft

One browser-lifecycle defect was reproduced and repaired. Chrome can report a newly
created managed tab with an empty `url` and the expected conversation only in
`pendingUrl`. The draft accepted that tab during acquisition but cleanup examined
only `url`, so cancellation during initial loading could retain an orphaned owned
tab. Conversely, an expected current `url` with a different pending destination
could be closed after the user had started navigating away.

Cleanup now treats an in-flight `pendingUrl` as the authoritative destination. It
closes an owned tab still loading the expected conversation, and retains it once a
navigation-away is pending. Two focused regressions failed before the repair and
pass afterward. No current user tab is ever closed.

## Storage and transaction findings

- Existing inventory stays in `ChatGPT_BulkManager_DB` version 1, store
  `conversations`; it was not migrated or cleared.
- Manager metadata uses separate `ConversationManager_Meta_DB` version 2 with the 11
  documented stores.
- Version 1 upgrades add stores/indexes and preserve earlier organization records.
  Legacy archive metadata without a committed complete payload remains `unknown`.
- A future schema version fails closed. A blocked upgrade tells the user to close
  other Manager tabs. `versionchange` closes the old connection.
- Repository mutations resolve only on IndexedDB transaction completion. Abort,
  uniqueness, parent/member, archive head/revision, artifact/source and cascade
  behavior were exercised with native IndexedDB.
- Collections and Tags are provider-neutral and distinct. Inventory replacement does
  not touch their database. Deleting one entity cascades only its own memberships.

## Archives, artifacts and capture boundary

Archive revisions require a committed payload reference, explicit raw and normalized
hashes, scope, branch, completeness and producer versions. Revisions are immutable;
capture-ID reuse is idempotent only for identical input; a failed recapture preserves
the last good snapshot. Artifact sources pin exact revision and provenance. Missing
or corrupted provenance is `unknown`, and changed sources make artifacts stale
without rewriting historical citations.

The capture orchestrator remains dependency-injected and inert without a real engine.
It enforces engine preflight, explicit foreground consent, readiness, identity/focus
rechecks, durable payload receipt before archive publication, cancellation/timeout,
truthful post-commit checkpoint reporting and conservative tab cleanup. It is not a
production Save feature or durable restart-capable job host.

## UX findings

The actual dashboard initializes the inventory and metadata databases independently.
Collections/Tags work for Standalone, Project and Custom-GPT rows and preserve generic
selection. Custom-GPT deletion remains protected by the existing Delete workflow.
Save/Analyze/Summarize/Merge/Move are visible disabled controls with explicit reasons;
programmatic execution also rejects missing implementations. Metadata-open failure
leaves History and the existing Delete wizard operable.

Offline Chromium rendering passed 7/7 checks at desktop and 760-pixel widths with no
external requests. Native Chrome/IndexedDB passed 24/24 checks, including schema,
rollback, concurrency, immutable archives, provenance, reopen persistence,
`versionchange`, two-dashboard invalidation, inventory-clear isolation, and responsive
actual-dashboard behavior. Chrome engine: 154.0.8037.57.

## Regression and static gates

- Baseline before V3: 342/342 Node tests passed.
- Supplied candidate before independent repair: 397/397 Node tests passed.
- Reconciled result: 399/399 Node tests passed (394 top-level subtests).
- Native Chrome/IndexedDB: 24/24 passed.
- Offline Chromium UI: 7/7 passed.
- `node --check`: 95 JavaScript files passed.
- `bash -n`: 3 maintained shell files passed.
- Bootstrap regression and `git diff --check` passed, including an explicit check of
  maintained untracked source.
- Manifest is MV3 with exactly `storage`, `alarms`, and host permission
  `https://chatgpt.com/*`.
- Runtime source contains no absolute user path or credential-shaped JWT literal.
- TypeScript was not installed, so no `tsc` syntax gate was run; the declaration file
  was reviewed as a design-time contract and adds no production dependency.

All protected inventory, History/Search, eligibility, deletion transport, DeleteJob,
background executor, settings and content-script files are byte-identical to the
reviewed Core Inventory Cleanup source. Runtime marker:
`ChatGPT Manager · manager-backbone-v3 · cm-runtime-20261002-mb3 · job schema 1`.

## Remaining boundaries

An installed unpacked-extension smoke is still user-run. Real payload availability,
journaling/reconciliation, authenticated account/workspace binding, real capture
completeness, AI engines, Project transport, Claude access and Firefox behavior remain
future integration work. No live account request, real capture, provider mutation,
deletion, commit or push occurred during this integration.
