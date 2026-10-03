# ChatGPT Manager — DeleteJob State Machine, UX and Examples V1

## State machine

```text
preflight --blocked--> resolve/remove/verify --> preflight
preflight --ready--> ready --Start--> running

running --Pause--> pause_requested --after in-flight reconcile--> paused
running --Cancel--> cancel_requested --after in-flight reconcile--> cancelled
running --failure/429/session/eligibility mismatch--> error_paused
running --all complete--> completed

paused/error_paused --Review & Resume--> preflight --> ready --> running
paused/error_paused --Cancel remaining--> cancelled
```

No remote mutation is allowed before `running`.

## Planning example: mixed selection

```text
17 selected

Deletion plan
12 Standalone conversations        Ready
 3 Project conversations           Approval required
 2 Unverified conversations        Blocked

[Verify blocked] [Remove blocked from this job] [Review Project conversations]
```

Selection itself remains intact. "Remove blocked from this job" edits the job plan,
not necessarily the user's workspace selection.

After blocked items are resolved/removed:

```text
15 ready to delete
12 Standalone
3 Project conversations

Project conversations require extra approval.
[Review 3 Project conversations]
```

Project review shows titles from inventory for human review but does not persist
those titles into the job merely for execution.

Approval copy:
"These conversations belong to ChatGPT Projects. Deleting them permanently removes
the selected conversations. Their Projects are not being deleted."

[Back] [Approve 3 Project conversations]

Then final confirmation:
"Delete 15 conversations?"
"12 Standalone · 3 Project conversations approved"
"Delay 600 seconds · estimated minimum duration ~2h 20m"
"No additional prompts will appear between conversations. You can Pause or Cancel
the remaining job at any time."
[Cancel] [Start deletion]
```

## Runtime controls

Running:
```text
Deletion running
4 / 15 complete · 11 pending
Next deletion in 07:21
[Pause] [View job]
```

Pause clicked while idle:
- state immediately paused;
- next alarm cleared/ignored.

Pause clicked while request in flight:
```text
Pause requested
Finishing the current request. No new deletion will start.
```
Reconcile that request, then paused.

Paused:
```text
Deletion paused
4 / 15 complete · 11 remaining
[Review & Resume] [Cancel remaining] [View job]
```

Cancel confirmation:
```text
Cancel remaining 11 deletions?
4 completed deletions cannot be undone.
The remaining conversations will not be deleted.
[Keep job] [Cancel remaining]
```

## Browser restart

On real browser startup only:
```text
Deletion paused because Chrome restarted.
4 / 15 completed · 11 remaining.
Review the pending job before continuing.
[Review & Resume] [Cancel remaining]
```

Never silently resume destructive deletion after browser restart.

## Multi-dashboard behavior

Dashboard A starts job. Dashboard B opens later:
- B immediately renders the same job.
- Pause in B updates durable state.
- A receives storage/message update and changes to Paused.
- neither dashboard performs deletion.
- background worker remains sole executor.

## Advanced panel placement

The current live defect was caused by diagnostics being physically after hundreds of
conversation rows. Do not "fix" this with scrolling.

Move the Advanced diagnostics panel in the DOM adjacent to the top/header/discover
area. It is collapsed by default. Opening it reveals diagnostics near the control;
closing it keeps the user's workspace position stable. Remove scroll-to-bottom
workaround.

## Delete modal DOM contract

The live browser reported:
`TypeError: Cannot set properties of undefined (setting 'textContent')`

The source uses `elements['modal-title']` during delete confirmation/rejection but the
central element registry did not include `modal-title`.

Fix the binding and add an automated REAL-HTML contract test:
- every statically referenced `elements['...']`/equivalent required ID exists in
  dashboard.html;
- critical modal/controller IDs are bound;
- accepted and rejected preflight paths render without exception.

Do not rely only on hand-built unit-test DOM mocks.

## Selection-size/composition browser contract

These must all produce a visible deterministic result, never "button does nothing":

1 Standalone -> confirmation
2 Standalone -> confirmation
17 Standalone -> confirmation
Standalone + Project -> mixed plan, Project approval flow
17 mixed Standalone+Project -> mixed plan
Any Unverified -> blocked plan with resolution options
Any Custom-GPT -> blocked in V1

No remote request occurs while merely planning/confirming.

## Project deletion safety

Project deletion is newly enabled in this stage only for positively verified Project
conversation records. It must use the same conversation deletion transport, never a
Project deletion endpoint.

The first later live smoke must use ONE disposable Project conversation and verify:
- conversation disappears;
- containing Project remains intact.

Codex must not perform that live smoke.

## Unverified help

`Needs verification` help should work on hover AND keyboard focus. If browser-native
`title` behavior is unreliable/slow, keep accessible label and optionally use a
small CSS/DOM tooltip. Do not add a giant explanation box.

## Jobs list

V1 needs a compact Active Jobs section. Since only one DeleteJob can be active, it
may render one card. Design names/APIs so a later list can contain Delete, Save,
Merge jobs.

Completed-job history can be minimal; do not build a large history UI now.
