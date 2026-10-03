# Implementation Patch Guide — Delete Workflow / Timing V2

This is implementation guidance, not a requirement to use exact filenames.

## A. Preparation controller

Prefer a module boundary similar to:

```js
prepareDeleteSelection({
  ids,
  store,
  verifyOne,
  signal,
  onProgress
}) -> {
  state,
  selected_ids,
  standalone_ids,
  project_ids,
  custom_gpt_ids,
  unresolved_ids,
  retry_after_ms
}
```

It should call the EXISTING EligibilityCore verification/persistence path rather than
re-implement classification.

Pseudo-flow:

```js
records = await store.getMany(ids)
candidates = records.filter(isVerificationCandidate)

for candidate sequentially:
  result = await verifyOne(candidate)
  if 429: stop
  if strong result: await store.mergeVerifiedEvidence(...)
  progress(...)

records = await store.getMany(ids) // reload canonical truth
return partition(records)
```

## B. Do not create durable DeleteJob too early

Preferred:
- preparation occurs before durable DeleteJob creation;
- only after Review exclusions/Project subset are known should controller create the
  durable draft/ready DeleteJob.

This avoids leaving abandoned durable draft jobs merely because verification was
cancelled.

If current architecture strongly favors an early draft, Codex may keep it only if
cleanup/state semantics are explicit and tested.

## C. Workspace selection transfer

On successful Start acknowledgement:

```js
for (const id of startedJobIncludedIds) {
  selectedIds.delete(id);
}
renderWorkspace();
```

Do NOT remove blocked/excluded IDs.

Do not rely on selection for job recovery.

## D. Pause reason

Prefer extending schema with:

```js
pause_reason: null | "user" | "browser_restart" | ...
```

If schema_version changes:
- bump version;
- fail closed on unknown future schema;
- migrate only safe non-running states automatically;
- do not silently reinterpret an old running destructive job.

If existing `last_error` and state can encode this cleanly, an alternative is allowed,
but UX must still distinguish manual pause from review-required pause.

## E. Fixed bar ticker

Conceptually:

```js
function startJobCountdownView() {
  clear old ticker
  render immediately
  if running && next_run_at:
     setInterval(renderFromCurrentDurableJob, 1000)
}
```

The ticker MUST NOT message the executor or create alarms.

Storage/message changes replace current durable job and rerender.

## F. Scheduler

Prefer encapsulating scheduling policy:

```js
scheduleNext(job, now) -> { mode, alarmTime, fastDelayMs }
```

Executor/controller owns actual timer/alarm handles.

For sub-30 target:
- in-memory timer calls the same guarded execution function;
- backup alarm is durable;
- both carry job/revision identity;
- execution guard/reload prevents duplicate.

## G. Timing debug

Detailed job UI should make this visually obvious:

```text
Target delay: 150 seconds
Last completed: 00:31:12
Next target: 00:33:42
Next in: 02:17
Scheduler: Chrome alarm
```

This can be in Details, not the compact bar.

## H. Server confirmation

Preserve current contract:
- remote PATCH must return successful HTTP response;
- only then local inventory removal/item completed.

Do not add a second verification GET merely for confirmation unless separately
justified, because it adds load/rate-limit pressure.
