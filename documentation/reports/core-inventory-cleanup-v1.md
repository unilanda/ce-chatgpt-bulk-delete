# Core Inventory Cleanup V1 implementation report

## Scope and storage audit

This bounded increment distinguishes normal History refresh, an explicit from-zero
inventory rebuild, query-driven Search recovery, and local inventory clearing. It does
not change deletion transport, eligibility policy, endpoints, manifest permissions, or
the persisted job schema.

The audited persistent boundaries are:

- conversation inventory: IndexedDB `ChatGPT_BulkManager_DB`, version 1, object store
  `conversations`;
- delete interval setting: `delete_interval_seconds` in `chrome.storage.local`;
- durable deletion job: `chatgpt_manager_active_delete_job_v1` in
  `chrome.storage.local`, schema version 1;
- other persistent application stores: none. Archive/capture/collection storage has
  not been introduced.

Rebuild and Advanced Clear call only `ChatDB.clearAll()`, which issues `clear()` on the
`conversations` object store. They do not delete the database or clear/remove Chrome
storage. Terminal-job Dismiss removes only the durable job key through the background
controller.

## Implemented behavior

Refresh history keeps the existing merge/upsert behavior, honors Maximum, immediately
persists successful pages, retains existing data on partial failure, and permits stale
History pruning only after an unlimited run reaches remote end. Its defaults remain a
20-item page and no artificial delay.

Rebuild from ChatGPT is separately confirmed and blocked by a non-terminal deletion
job. Confirmation clears conversation inventory exactly once, then enumerates History
from offset zero with `maximum = All`, sequential 10-item pages, and 500 ms pacing
between successful non-terminal pages. These constants are conservative heuristics,
not a service guarantee. There is no 429 retry. Retry-After and successful pages are
retained. A first-page failure intentionally leaves an empty inventory; a later
failure leaves a truthful partial inventory; remote end is labelled complete.

Partial/failed Refresh or Rebuild reveals Recover with content search. The action only
focuses the existing query field and explains that explicit terms are required, matches
merge into inventory, and Search cannot guarantee complete account coverage. It does
not invent a query or start a request.

Advanced Clear is now Clear local inventory. It is local-only, preserves settings and
job state, and refuses while a non-terminal job exists.

Active Jobs and the fixed job bar now render only non-terminal jobs. The single stored
completed/cancelled job renders under Recent activity with confirmed completion count,
finish time, target delay, and Dismiss. Dismiss is a background-owned atomic job-store
update: terminal state removes only the job key; non-terminal state returns sanitized
`job_not_terminal`; no inventory or network API is involved.

Runtime identity is:

    ChatGPT Manager · core-inventory-cleanup-v1 · cm-runtime-20261002-core1 · job schema 1

## Review of the supplied first draft

The supplied patch was reconciled rather than blindly applied. Material differences:

- terminal Dismiss uses `showJobControlError`; the draft referenced a nonexistent
  `showJobError` function;
- terminal Dismiss uses the job store's serialized `update()` transaction instead of
  a separate load followed by unconditional clear, preventing a live job from being
  cleared after an intervening state change;
- cancelled Recent activity reports only `confirmed deleted` counts and does not claim
  uncertain interrupted items were definitely not deleted;
- rebuild 429 status includes sanitized Retry-After when present;
- an unexpected normal Refresh exception also reveals Search recovery;
- the draft's unrelated test reformatting was not adopted;
- actual `dashboard.html`/`dashboard.js` integration coverage was added for loading,
  binding, Refresh, Rebuild, recovery, Clear, terminal rendering, and Dismiss.

## Safety and compatibility

No new endpoint, permission, host permission, dependency, or database migration was
added. Search-only conversations remain protected. Delete V2/Repair 1 preparation,
Project approval, Custom GPT blocking, background execution, hybrid timing, recovery
barrier, uncertain-request review, and server-success-before-local-removal contracts
remain unchanged.

All automated network behavior in tests uses synthetic fakes. No authenticated live
ChatGPT request or account mutation was performed for this increment.

## Verification

- Required `node --test tests/*.test.js`: passed all 37 test files.
- Detailed no-isolation TAP run: 342 tests, 337 subtests, 0 failed, 0 cancelled,
  0 skipped, 0 todo.
- Focused cleanup/dashboard/runtime suite: 102 tests, 0 failed.
- `node --check`: all 64 maintained JavaScript files passed.
- Manifest parse and exact assertions passed: permissions `storage`, `alarms`; host
  permission `https://chatgpt.com/*`.
- `bash -n`: all 3 maintained shell files passed.
- Increment-0 bootstrap regression passed (generate, validate, conflict refusal,
  idempotence).
- `git diff --check`, runtime marker consistency, diagnostic-field assertions, and
  credential/private-data/persisted-auth/runtime-path/legacy-brand scans passed after
  review of the intentional synthetic-session fixture and negative auth assertion.
