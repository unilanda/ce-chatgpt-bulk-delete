# ChatGPT Manager Phase 1 RC Repair V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the live Advanced-control visibility defect and close the specified Phase 1 safety, accounting, wording, and release-candidate regression gaps without changing established UX or architecture.

**Architecture:** Add one small browser/CommonJS dashboard-control boundary so expansion and local-clear interactions can be exercised as behavior in Node. Keep Delete eligibility in `deletion-core.js`, strengthen its transport boundary with whole-selection preflight, and add characterization tests around the already-working History state machine.

**Tech Stack:** Chrome Manifest V3, vanilla HTML/CSS/JavaScript, IndexedDB, Node built-in test runner.

**Spec:** `documentation/design/CHATGPT_MANAGER_PHASE1_RC_ACCEPTANCE_V1.md`, `documentation/design/CHATGPT_MANAGER_CORE_ARCHITECTURE_V1.md`, and `documentation/design/CHATGPT_MANAGER_UX_SPEC_V1.md`.

## Global Constraints

- Preserve branch `search-safe-delete`, HEAD `028b4b5d0a03fd264dfe5880ae58b92041afa005`, and all accumulated dirty Phase-1 work.
- Do not commit, push, merge, reset, restore, clean, rename, broaden permissions, implement Phase 2, make authenticated CLI ChatGPT calls, or perform a real deletion.
- Preserve the Discover → Inventory → Filter → Select → Action architecture and current approved UX.
- Unknown/Project/custom-GPT records remain protected for Delete.
- Package the final dirty source and evidence even if a late gate fails.

## Review Focus

- Advanced opens below a long inventory: opening must put the controlled region visibly in the viewport, while closing remains non-disruptive.
- Any protected record anywhere in a Delete queue must prevent every transport call, even when a standalone record appears first.
- An execution-time classification change after successful preflight must still stop before that record's transport.
- Completed History accounting must reconcile current-run outcomes without conflating persistent inventory.
- Later-page 429 must stop immediately, retain all prior/current successful records, skip pruning, and preserve Retry-After.

---

### Task 1: Install the RC contract and repair Advanced behavior

**Files:**
- Create: `documentation/design/CHATGPT_MANAGER_PHASE1_RC_ACCEPTANCE_V1.md`
- Create: `dashboard-controls.js`
- Create: `tests/dashboard-controls.test.js`
- Modify: `dashboard.html`
- Modify: `dashboard.js`

**Interfaces:**
- Produces: `DashboardControls.bindAdvancedToggle({button, panel}) -> dispose()`.
- Produces: `DashboardControls.clearLocalManagerData({confirmImpl, store, settings, settingKey}) -> Promise<Result>`.

- [ ] Copy the supplied RC acceptance contract byte-for-byte and verify it with `cmp`.
- [ ] Write a failing behavioral test that binds a collapsed button/region pair, expands on click, updates `aria-expanded`/`aria-controls`, scrolls the distant region into view, and collapses on the second click.
- [ ] Run `node --test tests/dashboard-controls.test.js`; expect module-not-found.
- [ ] Implement the smallest dashboard-control module and wire it before `dashboard.js`.
- [ ] Add behavioral clear-local tests proving decline makes no change and confirmation copy says ChatGPT conversations are not deleted.
- [ ] Run the focused dashboard-control and markup tests.

### Task 2: Enforce whole-selection Delete safety at transport

**Files:**
- Modify: `deletion-core.js`
- Modify: `tests/deletion-core.test.js`

**Interfaces:**
- Consumes: existing `preflightDeletion({ids, store})`.
- Produces: `runDeletionQueue` that preflights the complete queue before its first fetch, then retains per-record execution-time checks.

- [ ] Add table-driven failing queue tests for standalone+Project, standalone+custom-GPT, standalone+unknown, Project-only, and unknown-only selections; every case asserts zero fetches and zero local removals.
- [ ] Run the focused test and verify the unsafe standalone-first case fails because one transport call occurs.
- [ ] Preflight the whole queue inside `runDeletionQueue` before its request loop, preserving existing stop reasons and execution-time rechecks.
- [ ] Add/retain accepted tests for one and multiple standalone records.
- [ ] Run all Delete tests.

### Task 3: Close History and wording regression coverage

**Files:**
- Modify: `tests/history-sync.test.js`
- Modify: `dashboard-view.js`
- Modify: `tests/dashboard-view.test.js`
- Modify: `dashboard.js`
- Modify: `MANUAL_SMOKE_TEST.md`

**Interfaces:**
- Produces: `DashboardView.verificationDescription(classification) -> string|null`.

- [ ] Add History characterization tests for completed accounting, duplicate IDs, separate inventory count, and a second identical idempotent run.
- [ ] Strengthen the later-page 429 test with exact no-third-request and successful-page merge assertions.
- [ ] Add a failing view test for the exact low-clutter Unverified explanation.
- [ ] Implement the description formatter and use it as tooltip/accessibility copy on Unverified rows.
- [ ] Add the bounded RC visual smoke with exact Advanced and Delete-cancel expectations.
- [ ] Run History, view, dashboard, and full tests.

### Task 4: Final gates and review package

**Files:**
- Create outside repository: `/home/didi/Downloads/chatgpt_manager_phase1_rc_review_<timestamp>.zip`

- [ ] Run the full Node suite and `node --check` on every maintained JavaScript file.
- [ ] Parse the manifest, compare permissions against HEAD, run shell syntax and Increment-0 bootstrap checks, and run `git diff --check`.
- [ ] Run credential/private-data, runtime-path, visible-brand, and captured-ID/cursor scans.
- [ ] Perform a final requirement/diff review and record remaining uncertainty.
- [ ] Package complete filtered source, cumulative diff, repository context, full test output, installed contracts, smoke guide, and implementation report.
- [ ] Integrity-test the ZIP and verify branch/HEAD/status remain unchanged.
