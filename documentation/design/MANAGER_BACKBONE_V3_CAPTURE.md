# Manager backbone V3 — provider/browser/capture integration contract

## Architecture boundary

Providers and browsers are peer adapters, not a mandatory new call chain for all
existing code. Existing ChatGPT History/Search/Eligibility/Delete modules remain the
working implementation. `ProviderAdapters.createChatGPTAdapter` is an incremental
read/normalization shim, not a rewrite of those transports.

Provider responsibilities: conversation identity and URL, source observations,
capabilities, readiness and content acquisition. Browser responsibilities: tab/window
lifecycle, storage/alarms/messages/download interface and browser-specific semantics.
Shared responsibilities: selection, collections/tags, archive/payload publication,
provenance, action preparation, analysis requests and presentation.

## Browser adapter now

`createChromeAdapter(chromeImpl)` exposes a narrow promise facade over storage,
alarms, tabs, windows and downloads. Constructing it performs no work. Missing APIs
reject explicitly. Downloads remain unavailable without a declared permission;
this patch requests no new permission. Existing background code is not rerouted.
Firefox has a descriptor/contract only; it needs a validated runtime/background
adapter and the user's existing Firefox Save code before it becomes executable.

## Provider adapter now

ChatGPT observation normalization and canonical conversation URL identity are real.
The current wrapper can read existing inventory and accept History/Search functions.
Its `capture` slot is `null`. Claude's provider descriptor is contract-only with no
URL, transport, capture or mutation implementation. Local Collections can store a
Claude ref without claiming this build can fetch that conversation.

## TabRunner: actual reusable code, not yet enabled Save

`CaptureTabRunner.createTabRunner({browser})` implements owned leases:
- `acquire({mode, ref, provider, tabId?, allowFocus})`
- `assertCurrent(lease, {requiresFocus})`
- `release(lease)`

`current_tab` attaches to exactly one explicitly supplied tab. It never closes or
navigates that user tab. `managed_tab` creates a new provider tab, records ownership,
and can focus it only with explicit `allowFocus`. Creation may precede completed
navigation; identity is mandatory again after readiness and before capture/commit.

Focus-dependent capture requires both an active tab and a focused window through the
browser adapter. A change of focus or URL fails instead of claiming a complete
capture. On cleanup, only a still-owned tab with the expected conversation identity
is closed. A tab navigated elsewhere is retained. Duplicate release is harmless.
Foreground activation failure cleans up the owned lease.

These are permissioned adapter calls, not a guarantee that hidden/background capture
works. Readiness, hydrated turns and scroll completeness are provider/capture-engine
responsibilities. The real Save engine may require visible foreground operation.

## CaptureOrchestrator contract

`createOrchestrator({providers, tabRunner, payloadStore, archiveRegistry,
                  onCheckpoint, stageTimeoutMs, idFactory})`

`run({refs, mode, tabId?, allowFocus?, signal?, onProgress?})`

Validates the whole selection and required handlers before any side effect. A provider
without connected `capture.waitReady` and `capture.capture` causes an explicit error;
there is no fallback to an invented endpoint or incomplete DOM scrape.

Sequential per-conversation lifecycle:

```
checkpoint opening
→ acquire lease
→ waitReady(context, signal)
→ assert identity/focus
→ capture(context, signal)
→ validate returned ref + complete declared scope
→ assert identity/focus again
→ checkpoint persisting
→ payloadStore.persist(captured, {capture_id, signal})
→ require durable receipt
→ archiveRegistry.recordCapture(...receipt...)
→ checkpoint committed
→ close only owned matching tab
```

Readiness/capture time out; cancellation prevents later captures and commits. Tab
acquisition is awaited directly so a late-created tab is not orphaned by a timeout
race. A real browser adapter must settle tab creation; process interruption requires
the future durable host described below. Engines must honor AbortSignal; a late
completion after timeout is ignored rather than published.

A payload receipt has `{durable:true, payload_ref:{store,key}}`. Returned capture data
must supply the ArchiveRegistry fields, including hashes, scope/branch and engine
versions. The orchestrator stores no access token and does not render source HTML.
If the archive commit succeeded but a later checkpoint failed, it reports one
`captured_checkpoint_failed` item and preserves its successful revision, not two
conflicting item outcomes. Unfinished remaining refs are not counted as captured.

## What is deliberately NOT claimed

This orchestrator is tested with synthetic engines and stores; no live Save engine or
production payload store is installed. It is not registered in the UI, not an alarm
executor and not a durable CaptureJob. `durable_job_host:false` in its result makes
that distinction explicit. Current/current-tab acquisition is not itself a complete
capture implementation. No HTML/Markdown/TXT serializer is fabricated here.

## Future durable CaptureJob host

Before enabling Save, supply a host that persists owned-tab IDs, source account,
conversation identity, capture ID and phase. On worker/browser restart it must
reconcile those tabs/receipts, not assume completion and not close arbitrary user
tabs. A foreground capture may need to pause for visibility/focus rather than run
in a sleeping service worker. The host's journal is separate from transcript bytes.

The new `ManagerJobContracts` describes capture/analysis/move/export progress and
state transitions only. It does not migrate or replace the established DeleteJob,
its recovery barrier, alarms, approvals, timing, or interrupted-request policy.

## Save/Update prerequisites

A future Save handler should first observe the source, inspect the latest complete
snapshot, and explicitly decide capture/skip/unknown. Timestamp equality is only a
fast metadata hint; scope, branch, normalizer, availability and requested formats
also matter. Delta capture is postponed until edits/regeneration/branch invariants
can be proved. Full recapture with immutable revision is the safe initial policy.
Never skip merely because an old filename or message count exists.

## Permission and session boundary

This stage changes no manifest permissions. The new capture runner has no production
registration; capability remains disabled. When the user supplies Save code, review
actual content-script/host/script-injection/download needs explicitly. Do not infer
all required permissions from the existence of a `tabs` facade. Never copy browser
profiles or credential files for automated tests. Any source-context lookup stays
inside the authenticated browser when a future user-approved adapter runs.

## Required handoff from Save extensions

Provide both maintained Chrome/Firefox source snapshots, manifests, capture reports,
known hydration/scroll/message-box problems, serializers and sample sanitized outputs.
Review existing reliable behavior before extracting interfaces. Preserve math/code,
full-message content, cancellation and focus handling; do not replace mature capture
with a simpler invented reader. Integrate one tested provider/browser route at a time.
