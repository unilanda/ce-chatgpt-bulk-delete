# Delete Workflow V2 — implementation and verification report

## Outcome

ChatGPT Manager now implements **Select → Delete → Prepare → Review → Start →
Monitor/Control** without weakening the persistent-job safety boundary. Preparation is
read-only, automatic, sequential, cache-aware, and ephemeral. Only one atomic Start
command can create destructive authority. The background worker remains the sole
deletion executor.

No authenticated ChatGPT request or account mutation was performed during this work.
All automated requests and clocks are synthetic.

## Timing root-cause findings

The full path was audited from the dashboard input through storage, atomic Start,
`DeleteJob.interval_seconds`, confirmed completion, `next_run_at`, scheduler policy,
Chrome alarm creation, job storage, and dashboard rendering.

There is no 150-to-60 coercion in the current path. Tests prove that a requested value
of 150 remains 150 through runtime messaging and durable job creation, a confirmed
completion at C produces `next_run_at = C + 150000`, and persistent-alarm mode requests
the exact `next_run_at` value.

The concrete UI defect was that the previous dashboard only rerendered its countdown
when a durable storage snapshot changed. It had no once-per-second presentation timer.
A screenshot showing `1:00` could therefore be a frozen observation made with 60
seconds remaining; it does not by itself prove scheduler coercion. The new detailed
view exposes the configured delay, last confirmed completion, absolute next target,
live countdown, and derived scheduler mode so a user-run smoke can distinguish target,
remaining time, and Chrome lateness.

## Scheduler implementation

The interval parser accepts positive whole seconds from 1 upward and retains the
600-second default. `deriveSchedule(job, now)` is the single policy boundary:

- targets of 30 seconds or more use one durable alarm at `next_run_at`;
- targets of 1–29 seconds use an in-worker timer at `next_run_at` plus a durable backup
  alarm no earlier than the completion-compatible 30-second fallback.

Both delivery paths enter the same executor guard and reload durable state. Fast timer
events carry job ID, revision, and target; alarms are checked against the current
derived scheduled time. Stale, early, duplicate, paused, cancelled, terminal, and
wrong-job deliveries cannot authorize a request. Pause, Cancel, startup handling, and
new scheduling invalidate the timer and alarm together.

The fast timer is not durable authority. If Chrome evicts the service worker, the
backup can make a sub-30-second target late. It must not make it early or duplicate a
deletion. Unpacked-extension timing remains insufficient evidence for packaged Chrome.

## Preparation, Review, and Start

`delete-preparation.js` delegates to the existing eligibility queue and persistence
logic rather than duplicating classification. It snapshots unique selected IDs,
reuses strong canonical evidence, verifies every selected candidate sequentially,
persists successful classifications immediately, and reloads canonical records before
partitioning Standalone, Project, Custom GPT, and unresolved IDs.

Cancellation and 429 stop preparation with no durable DeleteJob and no deletion
request. Completed classifications remain cached. Review offers Retry, explicit
Custom-GPT/unresolved exclusion, and one approval for the exact complete Project
subset. Exclusion never changes workspace selection.

The final Start command reloads canonical membership, rejects blocked or changed
items, requires an exact Project approval subset, then persists, starts, and schedules
the job atomically. Only a successful acknowledgement removes included IDs from
`selectedIds`; excluded, blocked, and unrelated IDs stay selected. A non-terminal job
disables a second Delete action while the rest of the Manager remains usable.

## Pause and review semantics

Durable schema version 1 was retained:

- `paused` represents an ordinary user pause and shows direct **Resume**, optional
  **Review remaining**, and **Cancel remaining**;
- `error_paused` plus sanitized `last_error.code` represents restart, error, session,
  eligibility, rate-limit, reconciliation, or uncertain-request review requirements.

The existing fields are explicit, durable, and backward compatible, so no migration
or speculative reinterpretation of running destructive state was necessary. Manual
Resume still performs normal pending-item revalidation. **Review & Resume** for an
error pause now opens the sanitized reason and pending plan first; only the separate
**Resume deletion** confirmation sends the resume command.

Pause and Cancel prevent a new request. If one is already in flight, its single result
is reconciled before the requested control state settles. Successful remote PATCH
still precedes local inventory removal. No confirmation GET or automatic destructive
retry was added.

## Monitoring UI

The top job card remains available. A fixed viewport bar now shows state, progress,
remaining count, requested target, live countdown, and Pause/Resume/Details controls.
It is vertically offset from the generic selection bar so independent new selection
can coexist without overlap.

One dashboard interval rerenders the current validated snapshot each second. It sends
no runtime message, creates no alarm, changes no job state, and stops whenever the job
is not running or lacks `next_run_at`. Countdown formats are `MM:SS`, `H:MM:SS`, and
`Waiting for Chrome…` after the target rather than negative time.

## Persistence, permissions, and privacy

IndexedDB and DeleteJob remain schema version 1; there is no migration. Conversation
timestamp representations remain unchanged. The manifest still requests exactly
`storage` and `alarms`, with host access exactly `https://chatgpt.com/*`.

Job state contains no token, cookie, Authorization value, title, snippet, raw response,
or private error. Automatic preparation stores only the existing normalized eligibility
evidence. Diagnostic output remains aggregate and clearly exposes HTTP status,
conversation count, cursor presence, conversation `has_more`, and schema warnings.

## Files changed for Delete Workflow V2

- Runtime/UI: `background-runtime.js`, `dashboard.css`, `dashboard.html`,
  `dashboard.js`, `dashboard-dom.js`, `delete-job-executor.js`, `delete-job-view.js`,
  `delete-job.js`, `delete-preparation.js`, `deletion-core.js`, `job-client.js`,
  `job-controller.js`, `job-store.js`, `runtime-identity.js`.
- Tests/harness: `tests/background-startup.test.js`,
  `tests/dashboard-initialization.test.js`, `tests/delete-job-fast-scheduler.test.js`,
  `tests/delete-job-monitoring.test.js`, `tests/delete-job-resume-review.test.js`,
  `tests/delete-job-ticker.test.js`, `tests/delete-preparation.test.js`,
  `tests/delete-review.test.js`, `tests/delete-scheduler.test.js`,
  `tests/delete-workflow-dashboard.test.js`, `tests/deletion-core.test.js`,
  `tests/helpers/dashboard-harness.js`, `tests/job-start-plan.test.js`,
  `tests/job-start-plan-wiring.test.js`, `tests/job-store.test.js`,
  `tests/runtime-identity.test.js`.
- Maintained documentation: `README.md`, `ARCHITECTURE.md`, `PRIVACY.md`,
  `MANUAL_SMOKE_TEST.md`, the three Delete Workflow V2 design contracts,
  `documentation/plans/2026-10-01-delete-workflow-v2.md`, and this report.

## Verification evidence

- `node --test tests/*.test.js` — 307 passed, 0 failed, 0 skipped.
- Focused monitoring/dashboard gate — 57 passed, 0 failed.
- Focused review-before-resume/dashboard/controller gate — 42 passed, 0 failed.
- Runtime identity/background/dashboard gate — 19 passed, 0 failed.
- `node --check` over every maintained JavaScript file — passed.
- `JSON.parse(manifest.json)` plus exact permission assertions — passed:
  `storage`, `alarms`; host `https://chatgpt.com/*`.
- `bash -n` for maintained shell files and the Increment-0 bootstrap regression —
  passed; bootstrap generated, validated, refused conflicts, and remained idempotent.
- `git diff --check` — passed.
- Credential/private-data, persisted-auth, runtime-path, legacy-brand, runtime-marker,
  and diagnostic-field scans — passed after review of intentional workflow-template,
  test-assertion, and linked-worktree metadata matches.

## Remaining browser evidence

Synthetic tests prove local policy and race behavior, not the timing behavior of the
user's packaged Chrome build or the current unsupported ChatGPT endpoints. The user
must Reload the unpacked extension, close old Manager tabs, open a new dashboard,
confirm the V2 runtime marker, run the non-destructive Prepare/cache/150-second/
1-second-warning checks, and run the existing sanitized read-only search diagnostic.

Any destructive smoke remains a later, independently approved user action using only
a tiny explicitly disposable set. The exact sequence is in `MANUAL_SMOKE_TEST.md`.
