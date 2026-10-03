# Delete Workflow V2 Repair 1 — implementation report

## Outcome

The bounded repair adds ordinary service-worker interrupted-request recovery, stops bulk
preparation immediately when the ChatGPT session is unavailable, formats long wait
estimates for humans, and identifies the repaired runtime. DeleteJob schema version 1,
IndexedDB, permissions, host access, transport, and scheduling thresholds are unchanged.

No authenticated ChatGPT call, browser-profile access, or account mutation was performed.
All automated network and persistence evidence is synthetic.

## Worker recovery and healthy-running preservation

`background-runtime.js` creates one worker-local memoized recovery barrier. Listener
registration starts it, and the first job message or alarm awaits it. Ordinary recreation
calls only `recoverInterruptedRequest()` and never calls full browser-startup handling.
Failed recovery blocks job commands and alarms rather than permitting execution to continue.

The real background harness proves:

- no active job causes no storage write/removal, alarm create/clear, IndexedDB open, or
  network request;
- a healthy running job is byte-equivalent before and after recovery, with no storage or
  alarm mutation;
- a requesting item becomes failed/error-paused with `interrupted_request`, clears the
  schedule once, and performs zero fetches;
- malformed persisted state remains unchanged and unexecuted;
- real browser `onStartup` retains its separate interruption semantics.

`recoverInterruptedRequest()` no longer clears an alarm merely because no active job is
present. Cleanup remains in paths that own scheduling state.

## Interrupted-request resume audit

Recovery records the uncertain item as `FAILED` and the job as `ERROR_PAUSED`. The
controller's `resume()` path revalidates remaining inventory through
`reviewAndResume()`/`refreshDeletePlan()`, which would return the failed item to pending.
That transition is allowed only after a meaningful explicit user boundary:

1. ordinary recovery itself sends no resume command and performs no fetch;
2. **Review & Resume** opens a modal without sending `delete_job:resume`;
3. the modal states that the remote outcome is unknown and that resuming will attempt the
   conversation again;
4. only the separate **Resume deletion** confirmation sends exactly one resume command.

The dashboard harness proves this sequence. Therefore the uncertain request is never
automatically retried. No new schema was required.

## Verification, duration, and identity

A local no-token verification error uses only the sanitized code `session_unavailable` and
stops before waiting or inspecting a later candidate. An HTTP 401 detail result also stops
the batch; 403, ordinary network/malformed outcomes, 429, and cached evidence retain their
existing policies. The UI explains how to log in/reload and Retry.

`DeleteJobView.formatDurationSeconds()` is shared by persisted-plan and final Start
surfaces. Exact duration arithmetic remains in the DeleteJob domain and is unchanged.

Runtime identity is now:

    ChatGPT Manager · delete-workflow-v2-repair1 · cm-runtime-20261001-v2r1 · job schema 1

## Integration differences from the supplied draft

The supplied patch was reviewed hunk by hunk rather than blindly applied. The integrated
repair adds the following safeguards and evidence beyond the draft:

- recovery failures block job commands and alarm execution fail closed instead of being
  swallowed before normal execution continues;
- explicit deferred-promise tests prove the first message and first alarm cannot overtake
  recovery, and a recovery failure cannot reach either executor path;
- the no-job real harness awaits recovery before asserting zero side effects;
- the recovered item's own `error_code` is asserted;
- the interrupted-request modal explicitly describes the unknown remote outcome and the
  consequence of confirmation;
- actual dashboard tests cover session-unavailable UI/protection and the final Start
  duration surface.

## Manual evidence still required

After independent review, the user should reload the unpacked extension, close old Manager
tabs, open a new dashboard, verify the exact repaired marker, and run only the
non-destructive preparation/duration/timing checks in `MANUAL_SMOKE_TEST.md`. A real
deletion remains out of scope until separately approved with explicitly disposable data.
