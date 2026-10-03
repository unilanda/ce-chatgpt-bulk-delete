# ChatGPT Manager — Delete Workflow V2 Repair 1

## Status and purpose

This is a narrow repair to Delete Workflow V2. It keeps the persistent DeleteJob
architecture, scheduler policy, schema version 1, IndexedDB schema, endpoint boundaries,
and Chrome permissions unchanged.

## Ordinary service-worker recovery

Every service-worker instance establishes one memoized recovery barrier after registering
its listeners. The barrier calls `recoverInterruptedRequest()` exactly once. The first job
message and the first alarm wait for it, so neither can overtake recovery. A recovery error
blocks job commands and alarms fail closed; opening the dashboard remains available for
inspection.

This is deliberately distinct from real `chrome.runtime.onStartup` handling. Ordinary
worker recreation does not call `handleBrowserStartup()`, recreate a healthy future alarm,
or rewrite a healthy running job. The required state behavior is:

| Durable state | Ordinary worker action |
| --- | --- |
| No job | No storage, alarm, or network mutation |
| Healthy `RUNNING`, no `REQUESTING` | No mutation or alarm recreation |
| A `REQUESTING` item | `ERROR_PAUSED`, item `FAILED`, `interrupted_request`, schedule cleared |
| `PAUSED`, `READY`, or terminal | No mutation |
| Malformed persisted job | Fail closed without execution |

`recoverInterruptedRequest()` no longer clears scheduling when no active job exists.
Explicit startup, pause, cancel, error, and scheduling paths continue to own their cleanup.
Recovery performs no ChatGPT request and does not initialize IndexedDB.

## Session-unavailable preparation

Session unavailability is a fatal verification-batch condition:

- a local no-token boundary throws a sanitized error whose code is
  `session_unavailable`;
- the queue stops on that first candidate without an inter-item wait and leaves that
  candidate and all remaining candidates pending and protected;
- an HTTP 401 detail result counts the attempted record as unresolved, stops before later
  candidates, and reports `stop_reason = session_unavailable`;
- HTTP 403 remains an ordinary per-record failure and is not treated as session-wide.

The Review UI explains that the ChatGPT session is unavailable and offers Retry after the
user logs in or reloads ChatGPT.

## Human-readable duration

`DeleteJobView.formatDurationSeconds()` is the shared presentation boundary used by both
the persisted-plan summary and the final Start summary. It renders:

- `0` as `No inter-item waiting needed`;
- `45` as `45 seconds`;
- `240` as `~4 minutes`;
- `3900` as `~1 hour 5 minutes`;
- `8400` as `~2 hours 20 minutes`.

The formatter does not alter the exact domain calculation
`max(0, item_count - 1) * interval_seconds`.

## Interrupted-request resume boundary

Worker recovery never retries an uncertain request. It records the item as `FAILED`, sets
`last_error.code = interrupted_request`, clears `current_conversation_id` and
`next_run_at`, and pauses in `ERROR_PAUSED`.

The existing controller deliberately resets non-completed items to pending only when it
receives an explicit `delete_job:resume` command. The dashboard does not send that command
when the user first chooses **Review & Resume**. It opens the remaining plan and states that
the prior remote outcome is unknown and that confirming will attempt the conversation again.
Only a separate **Resume deletion** confirmation sends the command. This is the meaningful
explicit user-review boundary; there is no automatic destructive retry.

## Runtime identity and unchanged invariants

The repaired runtime marker is:

    ChatGPT Manager · delete-workflow-v2-repair1 · cm-runtime-20261001-v2r1 · job schema 1

Unchanged safety invariants include: the worker is the sole destructive executor; the
dashboard ticker is display-only; successful remote PATCH precedes local removal; tokens
are never persisted; Project approval remains exact-subset authority; Custom GPT and
unknown conversations remain protected; 429 and errors pause fail-safe; one active job is
allowed; and the fast-timer plus durable-backup architecture is unchanged.
