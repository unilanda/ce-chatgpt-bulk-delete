# Manager backbone V3 — author review / validation limits

This is an author implementation and self-review, not an independent reviewer pass.
Codex is asked to perform that independent integration review.

## Source boundary

Exact reviewed Core Inventory Cleanup ZIP was verified by SHA-256 and its complete
342-test suite was rerun. Previous Phase-2 V2 was used as draft material, not as a
fictional integrated user commit. V3 is cumulative against Core Cleanup. Per-file
before/after hashes and fresh-patch-application evidence are included in the handoff.

## Meaningful refinements made here

- Request-success promises replaced with transaction-completion results.
- Atomic group creation/membership and cascades; optimistic rename conflicts.
- Raw and normalized capture hashes required explicitly, not manufactured.
- Capture attempts separated from immutable snapshots; last good version retained.
- Legacy metadata-only captures remain unknown.
- Artifact inputs validated/pinned and source corruption/missing provenance detected.
- Semantic losslessness not falsely guaranteed.
- Foreground permission validated before tab work; active tab and focused window checked.
- Initial managed navigation separated from capture readiness.
- Failed focus activation closes only the owned matching tab.
- User/navigated tabs not closed; cancellation/timeout cannot publish a late capture.
- Post-commit checkpoint failure yields one truthful preserved item outcome.
- Disabled action capabilities enforced both in UI and in the runner.
- Metadata failure isolated from the existing inventory/Delete path.

## Verification performed

Complete Node suite and syntax/manifest/bootstrap gates, controlled DB event tests,
transactional repository fixtures, actual HTML/script initialization harness, and
real Chromium DOM/CSS with synthetic storage/runtime/session. No production account
or profile. Real DOM screenshots are fixture views, not user account captures.

## Native gate not passed here

Native IndexedDB browser tests were attempted through normal local-fixture navigation.
The environment returned ERR_BLOCKED_BY_ADMINISTRATOR. This is a test-environment
limitation, not evidence that native DB code is correct or incorrect. No policy was
disabled or bypassed. Offline DOM rendering uses a clearly separate synthetic IDB
adapter and must not substitute for native upgrade/rollback/concurrency validation.

Required before release: run tests/browser/run_manager_backbone_smoke.py normally on
an authorized developer host, then installed-Chrome non-destructive smoke. If it
cannot run, retain that explicit unresolved gate rather than claiming browser-ready.

## Remaining integration risks / deliberate boundaries

- Metadata v1 upgrade can be blocked by old dashboard connections; surface it, do not reset.
- Native cross-connection ordering and BroadcastChannel behavior still need the gate.
- Real payload availability/journal/account binding belongs to the later Save integration.
- The injected capture orchestrator is not a durable background CaptureJob.
- Chrome/Firefox and ChatGPT/Claude adapters are asymmetric intentionally: only the old
  ChatGPT/Chrome provider operations are executable in this product build.
- No production AI/capture/Move handler was registered, so no fake output can appear.
- Existing DeleteJob and remote-core files are byte-identical to the reviewed baseline.
