# ChatGPT Manager Core Stabilization and UX V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct bounded History discovery, establish action-independent inventory/filter/selection boundaries, and deliver the approved ChatGPT Manager UX V1 without weakening deletion safety.

**Architecture:** Add a pure History orchestration module and a small action-independent inventory workspace module. Keep canonical records and classification in `conversation-policy.js`; keep delete eligibility, preflight, execution, and progress in `deletion-core.js`; make `dashboard.js` a browser adapter over those modules and the approved view contract.

**Tech Stack:** Chrome Manifest V3, vanilla HTML/CSS/JavaScript, IndexedDB, `chrome.storage.local`, Node's built-in test runner.

**Spec:** `documentation/design/CHATGPT_MANAGER_CORE_ARCHITECTURE_V1.md` and `documentation/design/CHATGPT_MANAGER_UX_SPEC_V1.md`

## Global Constraints

- Preserve the intentionally dirty worktree, branch `search-safe-delete`, and HEAD `028b4b5d0a03fd264dfe5880ae58b92041afa005`.
- Do not commit, push, merge, reset, clean, restore, rename repositories/folders, or change sibling worktrees.
- Do not make authenticated CLI ChatGPT calls or perform real deletion.
- Do not implement Save, Merge, Project mutation, archive engines, Firefox, or a plugin framework.
- Manifest permissions remain exactly `storage` plus `https://chatgpt.com/*`.
- Unknown classification remains protected; sidebar/Recent location is never evidence.
- Delete retains execution-time persisted eligibility checks, sequential transport, remote-success-before-local-removal, stop-on-failure/429, default 600-second interval, and 60-second minimum.
- The authoritative task explicitly requires continuous native execution and no commits, overriding commit steps normally used by this skill.

## Review Focus

- A numeric History maximum smaller than, equal to, or crossing the 20-item page size must never over-fetch or over-write beyond the requested cap.
- A later-page 429/non-2xx must preserve pre-existing inventory and successful-page writes, expose a partial state and Retry-After, and never trigger stale cleanup.
- Generic selection must include protected/unverified records, while Delete preflight rejects any mixed/ineligible selection before transport and execution rechecks persisted state.
- Existing Search/detail evidence and numeric/ISO timestamp values must survive History merges without duplicate records or weaker classification.
- Advanced must be collapsed on load, primary statuses must remain human-readable, and no row may expose duplicate lowercase title text or a dominant per-row Delete action.

---

### Task 1: Install the approved durable contracts

**Files:**
- Create: `documentation/design/CHATGPT_MANAGER_CORE_ARCHITECTURE_V1.md`
- Create: `documentation/design/CHATGPT_MANAGER_UX_SPEC_V1.md`

**Interfaces:**
- Consumes: the user-supplied approved Markdown specifications.
- Produces: durable in-repository design contracts referenced by implementation and review artifacts.

- [ ] **Step 1:** Copy both approved contracts verbatim into `documentation/design/`.
- [ ] **Step 2:** Compare the maintained copies byte-for-byte with the supplied files.

### Task 2: Extract deterministic History discovery

**Files:**
- Create: `history-sync.js`
- Create: `tests/history-sync.test.js`
- Modify: `conversation-policy.js`
- Modify: `search-sync.js`
- Modify: `tests/conversation-policy.test.js`
- Modify: `dashboard.html`

**Interfaces:**
- Consumes: `ConversationPolicy.historyItemToRecord(item)`, `mergeConversationRecords(existing, incoming)`, `recordsEqual(first, second)`; store methods `getConversation`, `saveConversation`, `getAllConversations`, and `deleteConversation`.
- Produces: `HistorySync.parseMaximum(value) -> number|null`, `buildHistoryUrl({offset, limit}) -> string`, and `runHistorySync({maximum, store, authToken, fetchImpl, signal, onProgress, now}) -> Promise<HistorySummary>`.

- [ ] **Step 1:** Write failing History tests for max 20, max 25/page boundary, All, exact observed query parameters/offsets, prepopulated inserted-updated-unchanged totals, and mixed standalone/Project classification.
- [ ] **Step 2:** Run `node --test tests/history-sync.test.js`; expect failures because `history-sync.js` does not exist.
- [ ] **Step 3:** Export generic canonical `recordsEqual` from `conversation-policy.js` and use it from Search Sync.
- [ ] **Step 4:** Implement 20-item bounded offset pagination, per-record merge/counting, explicit All/numeric parsing, and total-local reporting in `history-sync.js`.
- [ ] **Step 5:** Add failing later-page 429/non-2xx tests asserting partial state, Retry-After, preserved successful writes, no cleanup, and a later independent retry path.
- [ ] **Step 6:** Implement fail-safe partial outcomes with no automatic retry/hammering; permit stale cleanup only after an unlimited run proves remote end.
- [ ] **Step 7:** Load `history-sync.js` before `dashboard.js`.
- [ ] **Step 8:** Run History, policy, and Search Sync tests; expect all to pass.

### Task 3: Establish action-independent workspace selection and Delete-owned preflight

**Files:**
- Create: `inventory-workspace.js`
- Create: `tests/inventory-workspace.test.js`
- Modify: `deletion-core.js`
- Modify: `tests/deletion-core.test.js`
- Modify: `dashboard.html`

**Interfaces:**
- Consumes: normalized Conversation records and `TimestampUtils.toEpochMilliseconds`.
- Produces: `InventoryWorkspace.filterRecords(records, filters) -> records`, `reconcileSelection(ids, records) -> Set<string>`, and `selectVisibleIds(records) -> Set<string>`.
- Produces: `DeletionCore.preflightDeletion({ids, store}) -> Promise<{eligible, eligible_ids, ineligible_ids, missing_ids}>`.

- [ ] **Step 1:** Write failing tests proving title/type/status/updated filters are action-independent and generic selection includes standalone, Project, custom-GPT, and unverified IDs.
- [ ] **Step 2:** Run `node --test tests/inventory-workspace.test.js`; expect module-not-found failure.
- [ ] **Step 3:** Implement the minimal pure filter/selection functions.
- [ ] **Step 4:** Write failing Delete preflight tests for all-standalone, mixed protected, missing records, deduplication, and zero transport calls.
- [ ] **Step 5:** Implement Delete-owned all-or-nothing preflight while preserving the queue's execution-time eligibility recheck.
- [ ] **Step 6:** Load `inventory-workspace.js` before `dashboard.js`.
- [ ] **Step 7:** Run workspace and deletion tests; expect all to pass.

### Task 4: Implement human-facing view models and DOM contracts

**Files:**
- Modify: `dashboard-view.js`
- Modify: `tests/dashboard-view.test.js`
- Create: `tests/dashboard-markup.test.js`
- Modify: `dashboard.html`

**Interfaces:**
- Consumes: History/Search/eligibility/deletion summaries and normalized classification values.
- Produces: `formatHistoryStatus(summary)`, `formatHistoryDetails(summary)`, `formatSearchStatus(summary)`, `typeLabel(classification)`, `verificationLabel(record)`, and existing diagnostic/progress formatters.

- [ ] **Step 1:** Write failing view tests for truthful History complete/partial status, inventory totals, simple Search status, required type labels, generic “N selected”, and deletion countdown language.
- [ ] **Step 2:** Write static markup tests for ChatGPT Manager identity, Discover/History/Find/workspace hierarchy, hidden Advanced, generic selection/action bar, clear-local wording, and absence of legacy branding.
- [ ] **Step 3:** Implement the formatters without exposing raw protocol counters in primary status.
- [ ] **Step 4:** Replace dashboard markup with the approved semantic hierarchy, collapsed Advanced, accessible labels, and confirmation/progress modal states.
- [ ] **Step 5:** Run view and markup tests; expect all to pass.

### Task 5: Wire the browser adapter and UX V1

**Files:**
- Modify: `dashboard.js`
- Modify: `dashboard.css`

**Interfaces:**
- Consumes: `HistorySync`, `SearchSync`, `InventoryWorkspace`, `EligibilityCore`, `DeletionCore`, `DashboardView`, and `chatDB`.
- Produces: browser-only orchestration for Discover → Inventory → Filter → Select → Delete.

- [ ] **Step 1:** Replace inline History pagination with `HistorySync.runHistorySync`; render separate run summary and total-local inventory.
- [ ] **Step 2:** Render Search primary status in goal language and retain technical detail under Advanced.
- [ ] **Step 3:** Replace delete-coupled checkbox filtering with generic selection reconciliation and visible-row select-all/indeterminate behavior.
- [ ] **Step 4:** Render linked title, required Type label, Updated value, concise verification state, and only a contextual Verify action when needed.
- [ ] **Step 5:** Route selected Delete through `preflightDeletion`; reject mixed/ineligible selections before confirmation, then preserve the queue's execution-time recheck.
- [ ] **Step 6:** Implement an in-page Delete confirmation state with editable interval, safety copy, Cancel/Delete buttons, and progress/Stop states without invoking transport during visual checks.
- [ ] **Step 7:** Move diagnostics, batch verification, technical details, and clear-local-data controls under Advanced; keep it hidden by default.
- [ ] **Step 8:** Make clear-local confirmation explicitly local-only, clear IndexedDB plus manager settings, and never call a ChatGPT mutation endpoint.
- [ ] **Step 9:** Replace existing CSS with a responsive, accessible hierarchy emphasizing Discover and the conversation workspace.
- [ ] **Step 10:** Run the full Node suite and `node --check dashboard.js`.

### Task 6: Product metadata and durable user documentation

**Files:**
- Modify: `manifest.json`
- Modify: `content.js`
- Modify: `README.md`
- Modify: `ARCHITECTURE.md`
- Modify: `PRIVACY.md`
- Modify: `MANUAL_SMOKE_TEST.md`

**Interfaces:**
- Consumes: the completed UX and runtime behavior.
- Produces: consistent ChatGPT Manager product identity and reviewer/user instructions.

- [ ] **Step 1:** Change manifest name/description/default title without changing permissions or host permissions.
- [ ] **Step 2:** Change the injected entry-point label and remove visible old-brand/bulk-delete naming.
- [ ] **Step 3:** Update README, Architecture, and Privacy wording for the stable pipeline, truthful History semantics, generic selection, and current Delete action.
- [ ] **Step 4:** Rewrite the visual smoke guide with before/after layout, load-visible controls, collapsed Advanced, max-20 status, Search expectations, mixed types, generic selection, partial 429, and Delete confirmation/progress without confirmation.
- [ ] **Step 5:** Scan maintained runtime and docs for unintended legacy visible branding.

### Task 7: Final verification and independent-review package

**Files:**
- Create outside repository: `/home/didi/Downloads/chatgpt_manager_core_ux_review_<timestamp>.zip`

**Interfaces:**
- Consumes: the final dirty worktree.
- Produces: a credential-free complete source/diff/evidence review artifact.

- [ ] **Step 1:** Run `node --test tests/*.test.js`.
- [ ] **Step 2:** Run `node --check` on every maintained JavaScript file, parse `manifest.json`, run shell syntax checks and the Increment-0 bootstrap regression.
- [ ] **Step 3:** Run `git diff --check`, credential/private-data scan, manifest-permission comparison, captured-ID/cursor review, and runtime worktree-path scan.
- [ ] **Step 4:** Capture branch/HEAD/status, sanitized remotes/worktrees, full diff from `028b4b5d0a03fd264dfe5880ae58b92041afa005`, tests, specs, smoke guide, and implementation report.
- [ ] **Step 5:** Create and integrity-test the required ZIP while excluding `.git`, local `.codex`, generated `AGENTS.md`, credentials, browser data, and raw private responses.
- [ ] **Step 6:** Confirm HEAD is unchanged, report the intentionally dirty status, and state that no commit, push, authenticated CLI account call, or real deletion occurred.
