# Delete Workflow V2 + Timing/Pause Debug Implementation Plan

> **Execution:** Use `superpowers:executing-plans` inline and TDD for every behavior change. The supplied V2 design contracts are the approved design gate. Do not commit: the authoritative task requires a dirty review boundary.

**Goal:** Deliver Select → Delete → Prepare → Review → Start with automatic cached verification, safe partition/exclusion/Project approval, selection transfer, clear pause semantics, a fixed ticking job bar, and a packaged-Chrome-safe hybrid scheduler down to a one-second requested target.

**Architecture:** A pure preparation controller reuses `EligibilityCore` and IndexedDB before any durable job exists. The dashboard owns only ephemeral wizard state and display timers. One atomic background `start_plan` command creates, approves, persists, and starts the reviewed eligible subset. Durable DeleteJob schema V1 remains unchanged because `paused` versus `error_paused` plus sanitized `last_error` already persists user versus review-required semantics. The background executor derives scheduling policy from `interval_seconds` and `next_run_at`: >=30 seconds uses a one-shot alarm; 1–29 seconds uses a guarded in-worker timer plus a ~30-second durable backup alarm.

**Specs:**
- `documentation/design/CHATGPT_MANAGER_DELETE_WORKFLOW_V2.md`
- `documentation/design/CHATGPT_MANAGER_DELETE_TIMING_SCHEDULER_V2.md`
- `documentation/design/CHATGPT_MANAGER_DELETE_WORKFLOW_PATCH_GUIDE_V2.md`
- all installed Core/UX/RC/Persistent Jobs/Browser Runtime contracts

## Global constraints

- Work only in the specified linked worktree on `search-safe-delete`; keep HEAD `028b4b5d0a03fd264dfe5880ae58b92041afa005`.
- Preserve all accumulated dirty work. No reset/restore/clean/commit/push/merge and no live authenticated calls or account mutations.
- Permissions remain exactly `storage, alarms`; host permission remains `https://chatgpt.com/*`.
- The service worker is the sole destructive executor. Dashboard timers are display-only; preparation performs read-only detail verification only after the user's Delete action.
- Custom GPT and unresolved records never enter an executable job. All Project approval is complete before Start. Execution revalidation remains mandatory.
- No tokens, cookies, Authorization values, snippets, titles, raw responses, or private error data enter durable job state or review artifacts.
- Remote PATCH success still precedes local inventory removal; no confirmation GET, automatic destructive retry, or automatic browser-startup resume.
- Authoritative no-commit instructions override any skill commit steps. Progress is recorded in the ignored execution ledger.

## Rulings established before Task 1

- The provided design contracts plus the explicit autonomous instruction constitute the approved design gate; no additional brainstorming approval pause is required.
- Keep durable schema V1. `paused` means ordinary user pause; `error_paused` plus `last_error.code` means review required. Cost if wrong: a later product requirement for richer pause analytics would require a deliberate schema V2, but no current destructive state is guessed or migrated.
- Derive scheduler mode and target display from durable interval/timestamps rather than persisting a new event log. Alarm `scheduledTime` is tested at the executor boundary and shown when available through current scheduling facts.
- Because session instructions prohibit unrequested delegation, final review uses the executing-plans self-review fallback rather than a subagent.

## Review focus

- A fast timer and its backup alarm racing must produce at most one remote request, and an obsolete backup must never authorize an early later item.
- Worker eviction may make sub-30-second work late, never early or duplicate. Browser startup pauses and clears every scheduling mechanism.
- Preparation cancellation/429 must leave zero DeleteJobs and zero PATCH requests while retaining classifications already persisted.
- Exclusion must not alter workspace selection; successful Start removes only included IDs and leaves blocked/excluded IDs selected.
- Cached strong evidence must prevent a repeated planning GET; execution revalidation must remain unchanged.
- A user pause must offer direct Resume, while every uncertain/error/restart pause requires review.

### Task 1: Install contracts and add the preparation controller

**Files:** create the three installed V2 contracts, `delete-preparation.js`, `tests/delete-preparation.test.js`; load the module in `dashboard.html`.

**Interfaces:** `prepareDeleteSelection({ ids, store, verifyOne, signal, delayMs, wait, onProgress })` returns selected/Standalone/Project/Custom-GPT/unresolved IDs, state, counts, stop reason, and Retry-After. It consumes the existing `EligibilityCore.isVerificationCandidate` and `runEligibilityVerificationQueue`; it reloads canonical records after the queue.

- [ ] Write focused tests for all-cached, mixed automatic sequential verification, Project, Custom GPT, unresolved, 429 partial stop, cancellation, and reload/cache reuse. Name the production mutation each catches.
- [ ] Run `node --test tests/delete-preparation.test.js` and verify RED because the module is absent.
- [ ] Implement the smallest controller that delegates verification/persistence to EligibilityCore and only partitions reloaded canonical truth.
- [ ] Run the focused test plus `tests/eligibility-core.test.js`; expect all pass.

### Task 2: Accept 1-second targets and implement scheduling policy/race guards

**Files:** modify `deletion-core.js`, `delete-job.js`, `job-store.js`, `delete-job-executor.js`; add/modify their focused tests.

**Interfaces:** `parseDeleteIntervalSeconds` accepts positive whole integers >=1. `deriveSchedule(job, now)` returns `mode`, `alarm_time`, and `fast_delay_ms`. Executor accepts injectable `setTimeoutImpl`/`clearTimeoutImpl`, owns one fast timer generation, and sends timer and alarm paths through the same `executeStep` guard.

- [ ] Write RED tests for integer-only 1/5/29/30/60/150 parsing; exact +150 `next_run_at`; 30+ exact alarm; sub-30 timer+backup; timer-first/backup-first/duplicate races; pause/cancel/startup/ordinary-worker recovery.
- [ ] Verify RED in the focused model/store/executor/controller/background tests.
- [ ] Implement minimum-1 validation, pure scheduling policy, timer cleanup/invalidation, exact expected-alarm checks, and shared execution guard. Keep completion-based targets and server-confirmation ordering.
- [ ] Run focused suites; expect no silent 150→60 conversion and all race cases pass.

### Task 3: Add atomic reviewed Start and selection transfer

**Files:** modify `job-controller.js`, `background-runtime.js`, `job-client.js`, `dashboard.js`, relevant focused tests/harness.

**Interfaces:** `controller.startPlan({ ids, intervalSeconds, approvedProjectIds })` reloads canonical records, builds a new plan only if no active job exists, requires every included item eligible, requires an exact Project approval subset, persists and starts it, then schedules. `jobClient.startPlan` invokes `delete_job:start_plan`.

- [ ] Write RED tests proving blocked/forged Project authority cannot start, exact reviewed subset can start, one active job is enforced, and 150 remains unchanged through message→controller→job→executor.
- [ ] Write actual-dashboard RED tests proving selection is unchanged throughout Prepare/Review, then successful Start removes included IDs only while excluded IDs remain selected and unrelated later selection remains independent.
- [ ] Implement the command and dashboard transfer only after successful acknowledgement.
- [ ] Run controller/runtime/client/dashboard focused tests.

### Task 4: Implement the explicit Prepare → Review → Start wizard

**Files:** modify `dashboard.html`, `dashboard.css`, `dashboard-dom.js`, `delete-job-view.js`, `dashboard.js`, `tests/dashboard-dom.test.js`, `tests/delete-job-view.test.js`, `tests/dashboard-initialization.test.js`, `tests/dashboard-ux.test.js`, harness.

**Interfaces:** ephemeral wizard snapshot owns original selected IDs, current partitions, exclusion sets, Project approval fingerprint, interval, AbortController, and stage. No durable job exists until Start. View helpers render preparation progress, review categories/actions, project titles/warning, and final counts/duration/warnings.

- [ ] Write actual-HTML RED cases for all cached, mixed Unverified auto-prep, discovered Project/Custom GPT, 429 partial, cancel prep, retry unresolved, category exclusions, Project approval invalidation, explicit stages, and zero PATCH/job creation before Start.
- [ ] Implement minimal stage DOM/view/controller behavior. Fast interval warning is visible but non-blocking. Back from Start returns to Review without leaving a durable draft.
- [ ] Run all focused UI/harness tests and mutation-check critical assertions.

### Task 5: Add pause semantics, fixed job bar, timing details, and ticker

**Files:** modify `delete-job-view.js`, `dashboard.html`, `dashboard.css`, `dashboard-dom.js`, `dashboard.js`, focused UI tests/harness.

**Interfaces:** `formatCountdown(nextRunAt, now)` yields `MM:SS`, `H:MM:SS`, or `Waiting for Chrome…`; detailed render exposes target delay, last completion, next target, and derived scheduler label. One dashboard `setInterval` re-renders current snapshots only and is stopped/restarted with job state.

- [ ] Write RED view and actual-dashboard tests for 02:30→02:29, legitimate rerender at 01:30, >=1h format, overdue wording, ticker cleanup, fixed bar, independent generic selection, manual `paused` → Resume/Review remaining, and `error_paused` → Review & Resume.
- [ ] Implement display-only ticker and fixed bar with CSS offset so it does not overlap the generic selection bar.
- [ ] Run UI and background-wiring tests; assert dashboard contains no alarm/deletion scheduling transport.

### Task 6: Documentation, regression gates, self-review, and package

**Files:** modify `README.md`, `ARCHITECTURE.md`, `PRIVACY.md` if needed, `MANUAL_SMOKE_TEST.md`; create `documentation/reports/delete-workflow-v2.md`; create review ZIP outside the repository.

- [ ] Document root-cause findings, hybrid scheduler truth/limitations, preparation cache, selection transfer, pause semantics, unchanged schema/security/permissions, and exact next user-run smoke.
- [ ] Run `node --test tests/*.test.js`; `node --check` every maintained JS; manifest parse; exact permission/host assertions; shell syntax and Increment-0 bootstrap regression; `git diff --check`; privacy/auth/path/legacy scans; runtime marker checks. Read every result.
- [ ] Build the executing-plans review package and conduct a separate self-review against the three V2 contracts and Review Focus. Fix Critical/Important findings test-first in one pass; ledger deferred minors/rulings.
- [ ] Build `/home/didi/Downloads/chatgpt_manager_delete_workflow_v2_review_<timestamp>.zip` with complete maintained source, cumulative diff/state/test evidence/design docs/smoke/report. Exclude `.git`, local ledgers, credentials, profiles, and private captures; run privacy scan, `unzip -t`, and SHA-256.
- [ ] Re-run final worktree/branch/HEAD/status/diff checks and report exact totals, Chrome uncertainty, package path, and explicit no commit/push/live deletion.
