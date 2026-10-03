# ChatGPT Manager — Persistent Jobs Architecture V1

## Stable pipeline
**Discover → Inventory → Filter → Select → Plan Action → Execute Job**

Delete is the first implemented durable job. Future Save/Archive, Project, Export/Merge
and multi-chat actions must be able to reuse the job concepts without redesigning
inventory or selection. Do not implement those future actions now.

## Ownership and persistence
The extension background/service worker is the sole DeleteJob executor. Dashboards
are views/controllers only and must never become competing executors.

Use `chrome.storage.local` as durable job-state source of truth. Existing IndexedDB
remains canonical conversation inventory.

Use `chrome.alarms` for future delete steps; dashboard `setTimeout` must not own a
long job. This stage intentionally adds ONLY the narrow `alarms` permission:
`"permissions": ["storage", "alarms"]`. Existing ChatGPT host permission remains.

Never persist ChatGPT tokens/cookies/Authorization. At each destructive step acquire
the current authenticated browser session in memory, perform at most one request,
then discard authentication material. Session acquisition failure pauses safely.

## Job model
At most one non-terminal DeleteJob.

States:
`draft/preflight`, `ready`, `running`, `pause_requested`, `paused`,
`cancel_requested`, `error_paused`, `completed`, `cancelled`.

Use a versioned durable schema with semantics equivalent to:
- schema_version, job_id, type
- state
- created/updated/started/finished timestamps
- interval_seconds, next_run_at
- ordered item IDs with approved classification and item status
- project_subset_approved
- counts total/completed/pending/failed
- current_conversation_id
- pause_requested/cancel_requested
- sanitized last_error/http_status/retry_after_ms
- revision or equivalent race-control value

Do not persist titles/snippets/messages merely for job control. Join IDs to inventory
for display.

Item states should be explicit: pending, requesting, completed,
skipped_ineligible, failed.

## Selection → plan
Selection remains generic and may contain any type. Preflight partitions:
- verified Standalone: eligible
- verified Project conversation: eligible with one extra Project-subset approval
- verified Custom-GPT: blocked in V1
- Unverified/missing: blocked until verified or removed from this job

Mixed Standalone + Project is allowed. Do not destroy the user's selection because a
plan is blocked.

## Project approval
Project chats are conversation records, not Project objects. If the plan includes
Project conversations, show the entire Project subset and require ONE additional
approval for that subset before Start.

Warning must state that selected conversations will be permanently deleted and their
Projects themselves are not being deleted.

Approval is once per unchanged plan. If Project membership/items are added or
materially changed later, invalidate approval. Never prompt between delete steps.

## Final approval
All approvals happen before execution. Final screen summarizes:
- total
- Standalone count
- Project count + approved state
- delay
- estimated minimum duration based on intervals between items
- Pause/Cancel availability

After `Start deletion`, no further prompts occur between items.

## Execution step
Each background wake performs at most one deletion:
1. acquire execution guard;
2. reload durable job;
3. verify state permits work;
4. honor pause/cancel requests;
5. choose exactly one pending item;
6. reload/revalidate canonical inventory record;
7. acquire current session token in memory;
8. persist requesting/current state;
9. make exactly one remote delete;
10. reconcile response;
11. only after confirmed remote success remove/update local inventory and mark item complete;
12. persist;
13. if still running and pending, set `next_run_at` and schedule next alarm;
14. release guard.

No parallel delete requests. First item may run immediately. Subsequent
`next_run_at = previous confirmed completion + interval`. Default 600 sec, minimum 60.

Stored approval never overrides current eligibility. If eligibility changed, pause
without remote mutation.

## Pause
Pause means no NEW deletion request may start.
If none in flight: persist paused and clear/ignore alarm.
If one is in flight: persist `pause_requested`, reconcile that request, then pause.
Do not assume aborting fetch means server cancellation.

Resume reruns pending-item preflight. Preserve Project approval only if the approved
plan remains semantically unchanged.

## Cancel remaining
Require confirmation explaining completed deletions cannot be undone.
No new request starts. If one is in flight, reconcile it first, then terminal
`cancelled`. Pending conversations remain untouched/in inventory.

## Errors / 429
Network/non-2xx/429/session failure/eligibility mismatch:
- never remove locally without confirmed remote success;
- schedule nothing further;
- transition `error_paused`;
- preserve pending;
- store sanitized status and Retry-After;
- require explicit Review & Resume.
No automatic destructive retry loop.

## Lifecycle
Closing manager dashboard: job continues.
Opening another dashboard: same job is visible/controlable.
Multiple dashboards synchronize via storage changes and/or extension messages;
they never execute the job.

Chrome fully closed: nothing executes.
On `chrome.runtime.onStartup`, an interrupted running/pause-requested job must become
paused/interrupted and require Review & Resume. Do NOT confuse ordinary service-worker
sleep/restart with browser startup.

## Alarms and races
Use stable alarm identity mapped to active job. On alarm reload job and ignore stale,
terminal, paused, wrong-job or obsolete alarms. Clear alarms on pause/cancel/complete.

Implement execution guard plus durable state/revision checks. Pause twice, Cancel
twice and Resume-running must be idempotent. Repeated alarm delivery must not cause
two deletions.

## Inventory/selection
Completed deletion removes local inventory only after server success; dashboards
reconcile automatically. Pending/paused/error records remain.

Job membership is durable and independent of the original dashboard's in-memory
selection. Selection remains a workspace concept.

## Active job UI
Every dashboard shows the same compact active-job banner:
Running: `4 / 17 complete · 13 pending · Next in 07:21 [Pause] [View job]`
Paused: `[Review & Resume] [Cancel remaining] [View job]`
Error-paused: clear error + same controls.

Allowed while DeleteJob runs: browse/filter, History, Search, verify unrelated chats.
Disallow a second DeleteJob and conflicting destructive mutation of pending items.

## Future compatibility
Design a modest JobStore/JobController boundary reusable by a future second job type,
but do NOT build a speculative plugin framework.

## Security
Never persist auth material/raw responses/message content. Sanitize stored errors.

## Non-goals
No Save/archive implementation, Project mutation, Custom-GPT deletion, Firefox port,
repo rename, native daemon, execution while Chrome is fully closed, or automatic
destructive resume after browser restart.
