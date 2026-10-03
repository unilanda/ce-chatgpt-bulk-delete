# ChatGPT Manager — Delete Timing / Scheduler Contract V2

## 1. Why this exists

Live smoke:
- user configured 150 seconds;
- Active Job sometimes displayed `Next deletion in 1:00`;
- the display did not visibly tick, so it was impossible to tell whether scheduler or
  UI was wrong.

The next implementation must instrument and test timing end-to-end.

## 2. Source of truth

Durable job fields remain authoritative:

- `interval_seconds` = user requested target interval
- `next_run_at` = absolute target timestamp for next deletion

After confirmed completion at time C:
`next_run_at = C + interval_seconds * 1000`

Do not derive next schedule from the dashboard countdown.

## 3. Chrome alarms platform constraint

Packaged Chrome extensions generally cannot rely on alarms firing more often than
about every 30 seconds. Development/unpacked extensions may behave differently.

Therefore testing an unpacked extension with a 1-second alarm is NOT sufficient proof
for packaged behavior.

## 4. Scheduling modes

### Persistent alarm mode
For target intervals >= 30 seconds:
- create one-shot `chrome.alarms` alarm with `when: next_run_at`;
- retain all stale-alarm/revision guards;
- alarm may fire late, never interpret lateness as duplicate authorization.

### Fast best-effort mode
For target intervals 1–29 seconds:
- user input is allowed;
- schedule an in-memory service-worker timer for target `next_run_at`;
- ALSO schedule a durable backup alarm at an allowed fallback time (~30 seconds after
  the confirmed completion / no earlier than platform-compatible minimum);
- whichever path executes first must acquire the same idempotent execution guard;
- successful first execution clears/invalidates the backup path;
- if service worker is evicted and the fast timer is lost, the backup alarm may make
  the actual interval longer than requested, but must never make it shorter or cause
  duplicate deletion.

Normal UI wording:
`Target delay: 1 second`

Warning:
`Fast background timing is best-effort. Chrome may delay sub-30-second jobs if the
background worker sleeps. The job remains safe and will not double-delete.`

Do not falsely claim exact 1-second persistent execution.

## 5. First item

First item can execute immediately after Start.

For N executable items, minimum requested waiting time:
`max(0, N-1) * interval_seconds`.

## 6. Live countdown

Dashboard fixed bar should maintain a presentation timer once per second:

`remaining = max(0, next_run_at - Date.now())`

This timer:
- changes text only;
- never triggers deletion;
- never modifies job state;
- stops when `next_run_at` is null or job is not running;
- restarts/reconciles on job state change.

Format:
- under one hour: `MM:SS`
- >= one hour: `H:MM:SS`

If countdown reaches zero before delayed alarm fires:
`Waiting for Chrome…`
or equivalent rather than showing negative time.

## 7. Timing audit fields

For sanitized debug details/tests record/display:
- requested interval_seconds;
- last completed timestamp;
- next_run_at;
- alarm scheduledTime when available;
- scheduling mode (`alarm`, `fast_timer_with_backup`);
- no token/private data.

Do not persist unnecessary event logs indefinitely.

## 8. Tests

With fake clock:
- 150s completion → next_run_at exactly +150s;
- alarm scheduled for exact next_run_at;
- countdown starts near 02:30 then ticks 02:29, etc.;
- dashboard rerender at 90s remaining legitimately displays 01:30;
- 60s uses persistent alarm mode;
- 30s uses persistent alarm mode;
- 29/5/1s use fast best-effort + backup alarm;
- fast timer first => backup cannot double-delete;
- backup first/worker timer lost => only one deletion;
- duplicate alarm ignored;
- pause clears/invalidates both scheduling mechanisms;
- resume reschedules from controller policy;
- browser startup pauses and clears in-memory fast timing;
- service-worker normal restart does not create duplicate authorization.

## 9. User interval policy

UI parser accepts positive whole number >=1.
Default remains 600.

Warnings, not hard prohibition.

No promise that sub-30-second background execution is exact.
