# ChatGPT Manager — Delete Workflow V2

## Purpose

This specification supersedes the earlier Delete Preparation / Job UX V1 where they
conflict. It preserves Persistent Delete Jobs V1 and Browser Runtime Repair.

The desired human workflow is:

**Select → Delete → Prepare → Review → Start → Monitor/Control**

Delete is one action on the generic workspace selection.

## 1. Three-stage Delete wizard

Use one modal/panel with an explicit stage indicator:

1. Prepare
2. Review
3. Start

### Stage 1 — Prepare

The user should never manually verify selected Unverified rows as a prerequisite.

When Delete is requested:
- snapshot selected IDs;
- inspect canonical persisted evidence;
- use existing verified evidence immediately;
- automatically verify every selected verification candidate sequentially;
- persist successful classifications immediately;
- show progress;
- allow Cancel preparation;
- make ZERO delete requests.

Example:

```text
Delete selected conversations

1 Prepare  →  2 Review  →  3 Start

48 selected
31 already verified
Verifying 7 of 17 remaining…

[Cancel preparation]
```

If every selected record already has sufficient evidence, skip quickly to Review.

### Preparation results

Repartition after verification:

- verified Standalone
- verified Project
- verified Custom GPT
- unresolved/failed

Do not conflate unsupported Custom GPT with a network verification failure.

429:
- stop verification immediately;
- retain completed classifications;
- retain Retry-After;
- offer Retry verification;
- no delete job starts.

Successful evidence remains in IndexedDB across later dashboard/extension reloads.

## 2. Stage 2 — Review

Example:

```text
48 selected

39 Standalone                   Ready
6 Project conversations         Extra approval required
2 Custom GPT conversations      Deletion not enabled
1 Could not be verified         Unresolved
```

Actions:
- Retry unresolved
- Exclude unresolved from this job
- Exclude Custom GPT from this job
- Review Project conversations
- Cancel

Excluding from job does NOT deselect from the workspace.

### Project approval

One approval for the complete unchanged Project subset.

Copy:

> These conversations belong to ChatGPT Projects. Deleting them permanently removes
> the selected conversations. Their Projects are not being deleted.

List Project conversation titles from inventory for review; do not persist titles in
job state solely for execution.

If the Project subset changes after approval, invalidate approval.

No Project prompt is allowed after Start.

## 3. Stage 3 — Start

Only included eligible Standalone + approved Project items count.

Example:

```text
Delete 45 conversations?

39 Standalone
6 Project conversations — approved

Delay target: 150 seconds
Estimated minimum wait: ~1 hour 50 minutes

Once started, no further approval prompts will appear.
You can pause or cancel the remaining job at any time.

[Back] [Start deletion]
```

If interval is fast, show rate-limit/platform warning without preventing Start.

## 4. Selection transfer at Start

Before Start, the workspace selection remains intact.

When Start successfully creates/runs the durable job:
- remove INCLUDED job IDs from in-memory workspace `selectedIds`;
- leave excluded/blocked IDs selected;
- the active DeleteJob, not checkbox selection, now owns included pending work.

This prevents the misleading current state where the floating selection bar says
"39 selected" merely because 39 job items remain.

The generic selection bar may still appear later if the user selects unrelated chats
for other/future actions.

While a DeleteJob is active, starting another Delete job is disabled.

## 5. Pause semantics

Distinguish ordinary user pause from review-required pause.

### User pause

Running → Pause / Pause requested → Paused(user)

UI:

```text
Deletion paused
9 / 48 completed · 39 remaining

[Resume] [Review remaining] [Cancel remaining]
```

`Resume` resumes directly after the normal pending-item revalidation required by the
executor/controller. Do NOT misleadingly label this `Review & Resume` if no special
review is required.

### Review-required pause

Causes:
- browser restart
- error / 429
- lost session
- uncertain in-flight recovery
- eligibility changed

UI:

```text
Deletion paused — review required
9 / 48 completed · 39 remaining

[Review & Resume] [Cancel remaining]
```

Review shows reason and pending plan/preflight before resume.

Represent this explicitly using either:
- `pause_reason` on paused state; or
- another equally clear persisted field.

Do not proliferate redundant job states if a reason field is cleaner.

Suggested reasons:
`user`, `browser_restart`, `http_429`, `network_error`, `session_unavailable`,
`eligibility_changed`, `uncertain_request`.

## 6. Cancel remaining

Always means:
- completed deletions remain completed;
- no new deletion starts;
- reconcile any request already in flight;
- pending conversations remain in inventory.

Confirmation must state completed count cannot be undone.

## 7. Monitoring UX

Keep detailed Active Job card near top.

Add/retain a fixed viewport job bar at bottom while job is non-terminal.

Running example:

```text
Deleting 9 / 48
39 remaining · Delay 150s · Next in 02:17
[Pause] [Details]
```

Paused(user):

```text
Deletion paused · 9 / 48 complete · 39 remaining
[Resume] [Details]
```

Review-required:

```text
Deletion paused — review required · 39 remaining
[Review & Resume] [Details]
```

The bar is display/controller only. It never executes or schedules deletions.

The countdown MUST visibly tick each second from persisted `next_run_at`.

## 8. Detailed timing visibility

To debug and build trust, detailed job view should expose:

- configured/requested delay: e.g. `150 seconds`;
- job state;
- completed / pending;
- last confirmed completion time (human-readable) when available;
- next target deletion time;
- live countdown;
- scheduler mode when relevant, preferably under details/Advanced.

This prevents ambiguity such as "I entered 150 but see 1:00".

## 9. Workspace while job runs

Manager remains usable:
- History/Search/filter/browse allowed;
- verify unrelated chats allowed;
- new generic selection allowed;
- Delete action disabled while active DeleteJob exists.

Do not let the active job hijack the generic workspace selection.

## 10. Verification cache

Planning should not re-request detail for records with sufficiently strong canonical
evidence.

A successfully auto-verified record is reusable on later plans.

Execution-time revalidation remains independent and mandatory.

## 11. Custom GPT

Still blocked in V2 until separately live-validated.

Do not auto-delete Custom GPT chats.

## 12. No destructive retries

No change:
- 429/error pauses;
- remote success before local removal;
- uncertain request recovery fails closed;
- no automatic retry loop.
