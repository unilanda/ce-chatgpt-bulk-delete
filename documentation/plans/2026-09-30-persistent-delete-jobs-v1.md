# Persistent Delete Jobs V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dashboard-owned deletion loop with one durable, background-owned DeleteJob that safely supports verified Standalone and Project conversations, explicit planning/approval, Pause/Resume/Cancel, browser lifecycle recovery, and synchronized dashboards.

**Architecture:** Pure UMD modules own the durable job schema and state transitions; a strict `chrome.storage.local` JobStore is the only job-state source of truth; a one-step executor joins IDs against the existing IndexedDB inventory and acquires authentication only in memory; a thin service-worker adapter owns alarms/messages; dashboards render and control jobs but never execute deletion. The existing conversation endpoint remains the only destructive transport.

**Tech Stack:** Chrome Manifest V3 service worker, `chrome.storage.local`, `chrome.alarms`, IndexedDB, browser JavaScript UMD modules, Node's built-in test runner.

**Spec:** `documentation/design/CHATGPT_MANAGER_PERSISTENT_JOBS_ARCHITECTURE_V1.md` and `documentation/design/CHATGPT_MANAGER_DELETE_JOB_STATE_UX_V1.md`

## Global Constraints

- Work only in `/home/didi/research/dev/tools/ce-chatgpt-bulk-delete_search_safe` on `search-safe-delete`; HEAD stays `028b4b5d0a03fd264dfe5880ae58b92041afa005`.
- Preserve the intentionally dirty accumulated implementation. Do not reset, restore, clean, commit, push, merge, or perform a live deletion/authenticated CLI call.
- The only permission delta is `alarms`: permissions must be exactly `["storage", "alarms"]`; host permissions remain `["https://chatgpt.com/*"]`.
- Background/service worker is the sole executor. Dashboards may plan/control/render only.
- `chrome.storage.local` is durable job truth; IndexedDB remains canonical conversation inventory. Do not duplicate inventory or persist titles/messages/snippets.
- Never persist token, cookie, Authorization, raw response, or raw private error/body data.
- At most one non-terminal DeleteJob; at most one request per wake; no parallel requests or automatic destructive retry/resume.
- Verified Standalone and verified Project conversations may execute; Project membership requires one extra approval for the unchanged subset. Custom GPT, Unverified, missing, corrupt, or changed eligibility fails closed.
- Default interval is 600 seconds, minimum 60; first step is immediate; later `next_run_at` is confirmed completion plus interval.
- Chrome `runtime.onStartup` pauses an interrupted job. Ordinary service-worker sleep/wake restores scheduling without being treated as browser restart.
- No Save/archive, Project mutation, Custom-GPT deletion, Firefox, repository rename, or Phase-2 action.
- Authoritative no-commit instruction overrides skill commit steps; task completion is recorded in the ignored execution ledger only.

## Review Focus

- A worker that disappears after persisting `requesting` must never blindly retry; the next worker must fail closed to `error_paused` for explicit review.
- A stale/duplicate alarm delivered after pause, resume, completion, or a prior successful step must not start an early or second request.
- Pause or Cancel arriving while fetch is in flight must reconcile that response exactly once, then settle paused/cancelled without starting another item.
- Corrupt, unknown-version, or auth-bearing stored state must remain unexecuted and surface only a sanitized invalid-state result.
- Remote success followed by local IndexedDB removal failure must not repeat the remote request and must pause with a sanitized reconciliation error.

---

### Task 1: Install contracts and implement the pure DeleteJob model

**Files:**
- Create: `documentation/design/CHATGPT_MANAGER_PERSISTENT_JOBS_ARCHITECTURE_V1.md`
- Create: `documentation/design/CHATGPT_MANAGER_DELETE_JOB_STATE_UX_V1.md`
- Create: `delete-job.js`
- Create: `tests/delete-job.test.js`

**Interfaces:**
- Consumes: `ConversationPolicy.normalizeConversationRecord`, `CLASSIFICATIONS`, and deletion interval parsing.
- Produces: `JOB_STATES`, `ITEM_STATES`, `TERMINAL_STATES`, `buildDeletePlan({ ids, records, intervalSeconds, now, jobId })`, `refreshDeletePlan(job, { records, now })`, `removeBlockedItems(job, { now })`, `approveProjectSubset(job, { now })`, `startDeleteJob(job, { now })`, `requestPause(job, { now })`, `requestCancel(job, { now })`, `reviewAndResume(job, { records, now })`, `estimateMinimumDurationSeconds(total, intervalSeconds)`, and `summarizeDeleteJob(job)`.
- Durable V1 shape: allowlisted fields `schema_version`, `job_id`, `type`, `state`, timestamps, `interval_seconds`, `next_run_at`, ordered `items`, `project_subset_approved`, `project_approval_ids`, counts, `current_conversation_id`, request flags, sanitized `last_error`, and `revision`. Item fields are `conversation_id`, `approved_classification`, `status`, and sanitized blocked/error/timestamp metadata; no display content.

- [ ] **Step 1: Install the two supplied design contracts byte-for-byte**

Use the supplied files under `/home/didi/Downloads/CHATGPT_MANAGER_PERSISTENT_DELETE_JOBS_STAGE_V1/` and verify with `cmp -s`.

- [ ] **Step 2: Write failing pure planning/state tests**

Cover literal composition cases: 1/2/17 Standalone ready; Standalone+Project and 17 mixed eligible but Project approval required; Unverified/missing/Custom GPT blocked; removing blocked edits plan membership only; approval covers the whole current Project subset and invalidates when that subset changes; Start is impossible until ready; estimated duration is `(total - 1) * interval`; pause/resume/cancel transitions and duplicate control calls are idempotent.

- [ ] **Step 3: Run the focused test and verify RED**

Run: `node --test tests/delete-job.test.js`

Expected: FAIL because `delete-job.js` or its exported model functions do not exist.

- [ ] **Step 4: Implement the minimal pure job model**

Use persisted states `draft`, `ready`, `running`, `pause_requested`, `paused`, `cancel_requested`, `error_paused`, `completed`, `cancelled`. Preserve ordered IDs, derive/reconcile counts, keep Project approval IDs explicit, and make every transition return a new validated-shape object without side effects.

- [ ] **Step 5: Run focused and policy regression tests**

Run: `node --test tests/delete-job.test.js tests/conversation-policy.test.js tests/deletion-core.test.js`

Expected: PASS with legacy page-queue safety tests unchanged; persistent Project eligibility exists only in the new job model.

### Task 2: Implement strict durable JobStore validation and migration

**Files:**
- Create: `job-store.js`
- Create: `tests/job-store.test.js`

**Interfaces:**
- Consumes: durable V1 shape and state constants from Task 1.
- Produces: `JOB_STORAGE_KEY`, `SCHEMA_VERSION`, `InvalidJobStateError`, `validateDeleteJob(value)`, `createJobStore({ storageArea, key })` with serialized `load()`, `save(job, { expectedRevision })`, `update(mutator)`, and `clear()` operations.
- Later tasks consume optimistic revision checking and the store's single in-worker update queue; dashboards never write raw job objects.

- [ ] **Step 1: Write failing JobStore tests with a complete fake `chrome.storage.local`**

Cover round-trip/reopen, revision increment and stale-write rejection, serialized concurrent updates, preservation of unrelated `delete_interval_seconds`, exact allowlist/schema validation, unknown future version, malformed item/count/state, and recursive rejection of token/cookie/authorization/raw-response fields or structures.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/job-store.test.js`

Expected: FAIL because `job-store.js` does not exist.

- [ ] **Step 3: Implement JobStore and fail-closed validation**

Validation returns a cloned normalized object only for schema V1. Invalid data throws `InvalidJobStateError`; it is never migrated by guessing and never executed. The update queue serializes storage read-modify-write operations and checks expected revision before setting.

- [ ] **Step 4: Run focused model/store tests**

Run: `node --test tests/job-store.test.js tests/delete-job.test.js`

Expected: PASS; serialized updates have monotonically increasing revisions and snapshots contain no authentication/private response material.

### Task 3: Extract one-request transport and build the background executor

**Files:**
- Modify: `deletion-core.js`
- Create: `delete-job-executor.js`
- Create: `tests/delete-job-executor.test.js`
- Modify: `db.js`
- Create: `tests/db.test.js`

**Interfaces:**
- Consumes: JobStore, pure model, `ConversationPolicy`, existing endpoint/Retry-After semantics, and inventory methods `init()`, `getConversation(id)`, `deleteConversation(id)`.
- Produces: `DeletionCore.deleteConversationRemote({ id, authToken, fetchImpl, signal, now })` returning only sanitized transport facts; a Node/browser-exported `ChatDB`; and `createDeleteJobExecutor({ jobStore, inventory, alarms, acquireSessionToken, fetchImpl, now, alarmName })` with `executeStep(alarm)`, `schedule(job)`, `clearSchedule()`, `ensureSchedule()`, `recoverInterruptedRequest()`, and `isExecuting()`.

- [ ] **Step 1: Write failing transport/executor/IndexedDB-adapter tests**

Cover exactly one request per step, first immediate/later completion-based schedule, remote success before local removal, non-2xx/network/429/session failure preserving local data, eligibility change before turn, Project using the conversation endpoint only, no parallel requests, duplicate/stale/early alarm, terminal/paused/wrong-job alarm, remote-success/local-delete failure without repeat, `requesting` recovery to `error_paused`, and service-worker access through the same DB name/store.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/delete-job-executor.test.js tests/db.test.js`

Expected: FAIL because executor/transport/export boundaries do not exist.

- [ ] **Step 3: Extract the one-request transport and implement the guarded executor**

The in-memory guard rejects concurrent delivery. Durable checks gate every start. Persist `requesting/current` before transport, reload current job during reconciliation so in-flight pause/cancel wins, remove local inventory only after remote confirmation, persist completion/error, then schedule at most one next alarm. A recovered `requesting` item becomes `error_paused` rather than retrying.

- [ ] **Step 4: Run executor plus legacy deletion tests**

Run: `node --test tests/delete-job-executor.test.js tests/db.test.js tests/deletion-core.test.js`

Expected: PASS; the legacy queue still uses the extracted transport without changed standalone-only behavior.

### Task 4: Add the job controller and Chrome service-worker adapter

**Files:**
- Create: `job-controller.js`
- Create: `background-runtime.js`
- Modify: `background.js`
- Modify: `manifest.json`
- Create: `tests/job-controller.test.js`
- Create: `tests/background-runtime.test.js`
- Modify: `tests/manifest.test.js`

**Interfaces:**
- Consumes: JobStore, inventory, executor, pure transitions, `chrome.alarms`, `chrome.runtime`, and in-memory session acquisition.
- Produces: `createDeleteJobController({ jobStore, inventory, executor, now, idFactory })` with `getJob`, `createPlan`, `refreshPlan`, `removeBlocked`, `approveProjects`, `start`, `pause`, `resume`, and `cancel`; and `createBackgroundRuntime({ chromeApi, controller, executor, openDashboard, acquireSessionToken })` with listener registration and startup/ordinary-wake recovery.
- Runtime message names are namespaced `delete_job:*`; responses contain validated job state or a sanitized error code only.

- [ ] **Step 1: Write failing controller/runtime tests with fake storage, alarms, runtime events, clock, inventory, and fetch**

Cover one active job, two dashboard clients creating/controlling one durable job, start scheduling exactly one immediate wake, pause idle/in-flight, resume preflight and duplicate-resume safety, cancel idle/in-flight and duplicate-cancel safety, stale alarms, dashboard closure irrelevance, ordinary worker recovery without startup semantics, and real `runtime.onStartup` pausing `running`/`pause_requested` and clearing scheduling.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/job-controller.test.js tests/background-runtime.test.js tests/manifest.test.js`

Expected: FAIL because the controller/runtime modules and `alarms` permission are absent.

- [ ] **Step 3: Implement background command ownership and service-worker wiring**

`background.js` imports the shared modules, initializes the same extension-origin IndexedDB, acquires `/api/auth/session` in memory with credentials included for each step, registers command/alarm/startup listeners, and restores scheduling on ordinary wake. It retains dashboard-opening behavior. Authentication is discarded after the request and never enters messages/storage.

- [ ] **Step 4: Run controller/runtime/manifest tests**

Run: `node --test tests/job-controller.test.js tests/background-runtime.test.js tests/manifest.test.js`

Expected: PASS; manifest permissions are exactly `storage, alarms`, and tests find no authentication material in durable snapshots.

### Task 5: Repair the real DOM contract and implement synchronized job UX

**Files:**
- Create: `dashboard-dom.js`
- Create: `delete-job-view.js`
- Create: `job-client.js`
- Modify: `dashboard-controls.js`
- Modify: `dashboard.html`
- Modify: `dashboard.css`
- Modify: `dashboard.js`
- Create: `tests/dashboard-dom.test.js`
- Create: `tests/delete-job-view.test.js`
- Create: `tests/job-client.test.js`
- Modify: `tests/dashboard-controls.test.js`
- Modify: `tests/dashboard-ux.test.js`
- Modify: `tests/dashboard-view.test.js`

**Interfaces:**
- Consumes: background `delete_job:*` commands, validated job snapshots, current inventory records for display joins, and storage-change notifications.
- Produces: `DashboardDom.REQUIRED_ELEMENT_IDS`, `bindDashboardElements(document)`, `DeleteJobView.renderPlan(elements, job, records)`, `renderActiveJob(elements, job, now)`, and `createJobClient({ runtime, storage, storageKey, onChange })`.
- `dashboard.js` keeps workspace selection independent, creates/views plans through JobClient, and never calls deletion transport or owns deletion timers/tokens.

- [ ] **Step 1: Write failing actual-HTML DOM contract and composition tests**

Read `dashboard.html`, extract real IDs, bind a document built from those IDs, and prove every static controller key—including `modal-title`—exists. Exercise rendering for 1/2/17 Standalone, Standalone+Project, 17 mixed, Unverified-containing, and Custom-GPT-containing plans; each must produce visible confirmation/approval/blocked state without exception or transport.

- [ ] **Step 2: Write failing Advanced/client/active-job tests**

Assert Advanced is physically before the conversation workspace, starts collapsed, toggles without `scrollIntoView`, and closing preserves position. Assert hover/focus tooltip behavior. Assert a second dashboard reconstructs the same draft/running job and responds to storage changes; active states expose the correct Pause or Review & Resume/Cancel/View controls.

- [ ] **Step 3: Run focused UI tests and verify RED**

Run: `node --test tests/dashboard-dom.test.js tests/delete-job-view.test.js tests/job-client.test.js tests/dashboard-controls.test.js tests/dashboard-ux.test.js tests/dashboard-view.test.js`

Expected: FAIL for the missing modal binding/modules/top placement and obsolete scroll/page-queue UI.

- [ ] **Step 4: Implement the real-HTML binding, planning dialog, active-job card, and synchronization**

Move Advanced adjacent to the header/discover area and remove the scroll workaround. Replace page queue controls with plan, Project-subset review/approval, blocked-resolution, final Start, Pause, Review & Resume, and confirmed Cancel remaining controls. Join titles from inventory only for display. Keep History/Search/filtering/verification usable, disallow a second job, preserve selection, and remove completed IDs from selection after inventory refresh.

- [ ] **Step 5: Run focused UI tests and full suite**

Run: `node --test tests/dashboard-dom.test.js tests/delete-job-view.test.js tests/job-client.test.js tests/dashboard-controls.test.js tests/dashboard-ux.test.js tests/dashboard-view.test.js`

Expected: PASS with deterministic visible output for every composition and no page-owned executor references.

Run: `node --test tests/*.test.js`

Expected: PASS, zero failures.

### Task 6: Documentation, static gates, final review, and review package

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `README.md`
- Modify: `PRIVACY.md`
- Modify: `MANUAL_SMOKE_TEST.md`
- Create outside repository: `/home/didi/Downloads/chatgpt_manager_persistent_jobs_review_<timestamp>.zip`

**Interfaces:**
- Consumes: final durable schema/state machine, background lifecycle behavior, permission delta, and complete dirty worktree.
- Produces: maintained operating/security documentation, no-deletion pre-smoke plus tightly bounded later destructive smoke, and a credential-free review artifact.

- [ ] **Step 1: Update maintained documentation**

Document the stable Plan Action → Execute Job pipeline, exact schema/states, Project conversation warning (Project object remains), background-only auth-in-memory execution, pause/cancel/restart behavior, `alarms` permission rationale, and no-token persistence. Update the manual smoke with Advanced in-place, 1/2/17 confirmation-only cancellation, mixed Project approval then cancellation, blocked Unverified, and a second dashboard; keep later destructive smoke to the supplied disposable one-item sequence.

- [ ] **Step 2: Run the complete automated and static gate**

Run `node --test tests/*.test.js`; `node --check` every maintained JS file; parse manifest; verify exact permissions/host permissions; `bash -n` maintained shell; Increment-0 bootstrap regression; `git diff --check`; credential/private-data, runtime-path, legacy-brand, and persisted-auth scans.

Expected: every command exits 0; no private/auth material; HEAD unchanged.

- [ ] **Step 3: Perform the final whole-change review**

Review the cumulative change against both new contracts and the five Review Focus cases. Because higher-priority session instructions prohibit subagent delegation unless the user explicitly requests it, use the executing-plans self-review fallback and record all rulings/deferred minors in the ledger.

- [ ] **Step 4: Build and integrity-test the review ZIP**

Include complete filtered maintained source, cumulative diff from pinned HEAD including untracked files, branch/HEAD/status/remotes/worktrees, full test/static outputs, supplied task, installed design contracts, smoke guide, and implementation report. Exclude `.git`, ignored local `AGENTS.md`/`.codex`/`.superpowers`, credentials, profiles, and raw private captures. Run privacy scan, `unzip -t`, and SHA-256.

- [ ] **Step 5: Verify final repository state**

Run: `pwd`, `git branch --show-current`, `git rev-parse HEAD`, `git status --short --branch`, `git diff --check`.

Expected: correct worktree/branch, pinned HEAD unchanged, intentionally dirty cumulative implementation preserved, no commit/push/live deletion.
