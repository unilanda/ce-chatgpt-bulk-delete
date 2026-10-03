# Architecture

## Safety model

This Manifest V3 extension manages destructive conversation operations, so its
central invariant is:

> Uncertain classification is protected and never bulk deletable.

The UI is not the security boundary. Workspace selection is deliberately generic.
A versioned DeleteJob plan partitions the full selection before execution. Verified
Standalone records are eligible; verified Project conversation records require one
extra approval for the unchanged Project subset; Custom-GPT, unverified, missing, or
changed records fail closed. The background executor reloads and rechecks each record
immediately before its remote request.

ChatGPT's `/backend-api/*` endpoints are internal and unsupported. The implementation
therefore validates responses, bounds pagination/retries, reports incomplete work
honestly, and stops when an assumption no longer holds.

## Components

- `content.js` injects the draggable **ChatGPT Manager** entry point on ChatGPT.
- `background.js` wires the Manifest V3 service worker, shared IndexedDB adapter,
  durable job store/controller, alarm executor, in-memory session acquisition, and
  dashboard opening.
- `dashboard.html`, `dashboard.css`, and `dashboard.js` provide browser DOM,
  discovery/authenticated read operations, plan controls, and clipboard adapters.
  Dashboards never execute or schedule deletion requests; their once-per-second timer is
  presentation-only and renders the current durable `next_run_at`.
- `db.js` wraps the version-1 IndexedDB `conversations` store. The store is
  schemaless, so the added classification/search fields require no schema upgrade
  and older records remain readable.
- `timestamp-utils.js` is the single compatibility boundary for conversation
  timestamps: finite numbers are Unix seconds (including fractions), supported
  strings use existing date parsing, and consumers receive epoch milliseconds or
  an explicit invalid result.
- `search-core.js` constructs and runs Global Search protocol requests, validates
  pagination, filters heterogeneous results, and produces sanitized diagnostics.
- `search-sync.js` sequences explicit queries and merges deduplicated discoveries.
- `history-sync.js` owns exact maximum handling, 20-item offset pagination,
  current-run merge counters, partial outcomes, stale-cleanup eligibility, and
  optional bounded page/pacing parameters whose normal defaults remain unchanged.
- `inventory-resync.js` is the explicit rebuild boundary. It clears only the
  conversation store and invokes an unlimited, sequential History run with 10-item
  pages and 500 ms inter-page pacing.
- `inventory-workspace.js` owns action-independent filters, generic select-visible,
  and selection reconciliation.
- `eligibility-core.js` owns sanitized one-conversation detail evidence,
  fail-closed classification, and the sequential verification/persistence queue.
- `delete-preparation.js` snapshots a selection, reuses canonical evidence, verifies
  every remaining candidate sequentially, reloads canonical truth, and builds the
  ephemeral Review partitions. It never creates a DeleteJob or sends deletion.
- `conversation-policy.js` normalizes legacy/current records, merges metadata, and
  owns classification and deletion eligibility.
- `deletion-core.js` owns the existing standalone-only compatibility queue plus the
  one-request conversation deletion transport used by the background executor. It
  never reads a deletion response body.
- `delete-job.js` owns pure planning, Project-subset approval, state transitions,
  counts, and duration estimates.
- `job-store.js` validates and serializes the one versioned DeleteJob stored in
  `chrome.storage.local`; corrupt, future, or auth-bearing state fails closed.
- `delete-job-executor.js` derives persistent-alarm versus fast-timer-with-backup
  policy, sends timer and alarm paths through the same execution guard, revalidates
  IndexedDB, persists `requesting`, reconciles exactly once, and schedules from
  confirmed completion.
- `job-controller.js` owns plan/control commands and `background-runtime.js` owns
  namespaced runtime messages plus alarm/startup listener routing. Terminal-job
  dismissal is an atomic controller/store operation and never reaches transport or
  conversation inventory.
- `dashboard-dom.js`, `delete-job-view.js`, and `job-client.js` enforce the real
  HTML contract, render plans/jobs, and synchronize dashboards through validated
  messages and `chrome.storage.onChanged`.
- `dashboard-view.js` formats normal History/Search/selection status and conversation
  labels without protocol jargon in the primary UI.

The pure modules expose the same API to browser globals and CommonJS tests.

## Persistent storage boundaries

- Conversation inventory is the version-1 IndexedDB database
  `ChatGPT_BulkManager_DB`, object store `conversations`.
- The delete interval setting is `delete_interval_seconds` in
  `chrome.storage.local`.
- The one durable deletion job is stored separately in `chrome.storage.local` under
  `chatgpt_manager_active_delete_job_v1` with job schema version 1.
- No archive/capture/collection stores currently exist.

Refresh merges inventory. Rebuild clears and repopulates only `conversations`.
Search recovery merges explicit-query matches. Advanced Clear clears only
`conversations` and performs no network request. Neither inventory-clearing path uses
`indexedDB.deleteDatabase()`, broad storage clearing, or removal of settings/job state.

## Stored record model

IndexedDB remains at version 1. A current record may contain:

- stable conversation ID, title, create/update times, and lowercase title text;
- sanitized History Sync metadata limited to classification-relevant fields;
- `classification` and `classification_evidence`;
- `discovery_sources` (`history` and/or `search`);
- aggregate `search_metadata`: matched queries, hit count, match kinds, and boolean
  archived/starred flags.
- minimal `eligibility_metadata`: endpoint kind, HTTP status, request outcome,
  normalized gizmo/project states, and generic schema warnings.

Search snippets, message bodies, message IDs, raw search responses, cursors, query
session IDs, cookies, and authorization tokens are not stored. Existing records
without sufficient evidence normalize to `unknown-protected`.

Timestamp representations are not migrated or rewritten. Numeric Global Search
values remain Unix seconds and legacy ISO/date strings remain strings. Duplicate-hit
selection, record merge, dashboard sorting/filtering, and rendering all normalize at
the shared boundary; invalid/null/missing values never produce a fabricated instant.

## History Sync flow

History Sync is the normal primary synchronization path. Search Sync is an explicit
fallback/recovery tool rather than an automatic failover.

1. The dashboard obtains the current in-browser ChatGPT session token in memory.
2. It pages newest-first with the observed list parameters in requests capped at
   20. A numeric maximum bounds the final request exactly; All runs until remote end.
3. `conversation-policy.js` maps each item into sanitized metadata and classifies it:
   an explicit `gizmo_id` beginning with `g-p-` is Project-protected; another
   non-empty `gizmo_id` is custom-GPT-protected; an explicitly null/empty
   `gizmo_id` is standalone-safe; absent evidence is unknown-protected.
4. The incoming record is conservatively merged with IndexedDB. Known protection
   cannot be downgraded by weaker metadata.
5. A later-page 429, network error, malformed response, or non-2xx result ends the
   run as partial after retaining every successful page and the existing inventory.
   Retry-After is surfaced when available; there is no automatic request loop.
6. Only after an unlimited run reaches the end may stale history-origin records be
   removed locally. Search-only discoveries are preserved.

History Sync failures do not imply that missing history is deleted or safe.

The ordinary Refresh path keeps the 20-item default and obeys its configured maximum.
The explicit Rebuild wrapper instead clears the conversation store after confirmation,
then requests unlimited History from offset zero with sequential 10-item pages and a
500 ms delay after each successful non-terminal page. Every page is persisted before
the next request. A 429 is not retried: Retry-After is retained, successful pages stay
available, and coverage is reported partial. A first-page failure truthfully leaves an
empty rebuilt inventory. A non-terminal deletion job blocks Rebuild and Advanced Clear.

## Search Sync protocol and flow

For each explicit user query, `search-core.js` sends
`POST /backend-api/global/search` with `entrypoint`, `limit`, the query, one logical
query-session ID, a cursor, and an explicit conversation source request.

- The first cursor is null.
- Later requests reuse the same query-session ID and exact server cursor.
- Pagination depends on the conversation source's boolean `has_more`, not item count.
- Missing/repeated cursors and the page cap end the query as partial.
- Only items satisfying all three checks—`source_type == conversation`,
  `source_key == conversation`, and `payload.kind == conversation`—are candidates.
- Missing conversation IDs are warned about and ignored. Project, library, and other
  source families are counted for status but never treated as conversations.
- Duplicate message/title hits across pages and queries collapse by conversation ID.

`search-sync.js` runs queries sequentially, saves each globally unique conversation
once per campaign, and exposes current query, pages, hits, unique count, inserted,
updated, skipped, and protected counts. Search-only records are
`unknown-protected`; merging cannot downgrade Project/custom-GPT protection.
Search Sync never deletes local or remote data.

A network or 5xx search error gets at most one paced retry. A 429 is never retried
automatically and prevents later queries from starting. Completed discoveries may
still be saved when a later page/query stops; the reported outcome remains partial
or failed rather than being presented as complete coverage.

## Lazy eligibility verification

History Sync keeps its established list-item `gizmo_id` contract: explicit
null/empty is standalone, `g-p-` is Project, another non-empty string is custom
GPT, and missing/invalid evidence is unknown.

`runEligibilityDiagnostic` performs at most one user-chosen read-only GET to that
conversation-detail path. It immediately reduces any response to HTTP status,
endpoint kind, evidence-field presence, normalized gizmo/project states,
classification result, generic schema warnings, request outcome, and Retry-After.
It never returns the conversation ID or raw body and never writes storage.

Live browser evidence validated the detail contract independently: an own,
exact-null top-level `gizmo_id` is standalone, a non-empty `g-p-` string is
Project, and another supported non-empty string is custom GPT. The browser enables
promotion under that contract. Missing, inherited, empty, wrong-type, conflicting,
or malformed fields, plus network failures, non-2xx, and 429, always remain unknown.

The manual Advanced queue accepts only search-discovered unknown records, caps each
batch at 10, and reports each required outcome counter. Delete preparation instead
passes the complete selected candidate set through the same sequential queue and
persistence boundary. Both wait three seconds between requests, stop immediately on
429, surface Retry-After, and preserve completed classifications. Cancellation after
a response but before persistence cannot promote a record. A validated exact-null
response is persisted with `eligibility-detail-v1` evidence; Project/custom-GPT
protection cannot be downgraded. The version-1 schemaless inventory and conservative
ID merge require no database migration.

## Delete preparation and persistent execution

The stable action pipeline is **Discover → Inventory → Filter → Select → Prepare →
Review → Start → Monitor/Control**. IndexedDB is the canonical conversation inventory.
Preparation and Review are ephemeral dashboard state; `chrome.storage.local` receives
at most one durable DeleteJob only when atomic Start succeeds.

Prepare snapshots selected IDs, reuses sufficiently strong cached evidence, and
automatically verifies every selected candidate sequentially. Each successful
classification is persisted immediately. Canonical records are then reloaded and
partitioned into Standalone, Project, Custom GPT, and unresolved. A 429 or cancellation
creates no DeleteJob and sends no deletion request. Review exclusions change only the
prospective job; they do not deselect workspace rows. The exact current Project subset
requires one approval. Custom GPT and unresolved records cannot enter execution.

`startPlan` reloads canonical membership, rebuilds the plan, rejects any blocked item
or mismatched Project approval, persists, starts, and schedules the eligible subset as
one background command. Only its successful acknowledgement transfers included IDs
out of `selectedIds`; excluded/blocked and unrelated IDs remain selected. A non-terminal
job disables a second Delete action but leaves browsing, syncing, filtering, selection,
and unrelated verification available.

The exact durable schema remains version 1. Its existing states encode pause semantics:
`paused` is a user pause; `error_paused` plus sanitized `last_error.code` is a restart,
error, eligibility, session, or uncertain-request pause that requires review. This is
clear, durable, and backward compatible, so no job migration was added. Unknown or
invalid job schemas still fail closed. Job state never includes tokens, cookies,
Authorization values, raw bodies, titles, or snippets.

The first deletion may execute immediately. For every later step, a confirmed remote
completion at C sets `next_run_at = C + interval_seconds * 1000`. The parser accepts
positive whole seconds >=1 and keeps the 600-second default. `deriveSchedule` selects:

- `alarm` for targets >=30 seconds: one durable alarm exactly at `next_run_at`;
- `fast_timer_with_backup` for 1–29 seconds: an in-worker timer at `next_run_at` plus
  one durable alarm no earlier than the completion-compatible ~30-second fallback.

Both paths reload the same durable job and pass the same job/revision/target, early,
stale, state, and in-worker execution guards. Timer-first, alarm-first, duplicate,
pause, cancel, and startup paths therefore cannot authorize a second request. Worker
eviction can lose the fast timer and make a sub-30-second target late; the durable
backup preserves progress without promising exact fast background timing. Ordinary
service-worker restoration registers listeners and starts one memoized targeted
recovery barrier. The first job message/alarm waits for the barrier; it only recovers
an orphaned durable `requesting` item and otherwise leaves the job and existing alarm
byte-equivalent. It does not apply full startup semantics or create competing schedule
authority. A recovery error blocks job commands and alarms fail closed. Real browser
startup remains separate: it clears scheduling and converts running/in-flight
uncertainty into review-required state.

For an authorized step, the executor reloads and revalidates one IndexedDB record,
acquires the current browser session token only in service-worker memory, persists
`requesting`, and sends one `PATCH` to the conversation endpoint. Project conversations
use the same conversation endpoint. Only a confirmed 2xx permits local inventory
removal and item completion. Network/HTTP/429/session/eligibility failures preserve
pending data and pause without an automatic destructive retry. Remote success followed
by local reconciliation failure records completion before pausing, preventing repeat.

A user Pause clears both scheduling paths and offers direct Resume after normal pending
revalidation, plus optional Review remaining. `pause_requested` reconciles an in-flight
request once before settling. Error/restart/uncertain state shows the sanitized reason
and pending plan before the separate Resume confirmation. Cancel remaining similarly
reconciles any in-flight request, keeps completed work irreversible, and leaves pending
records untouched.

Multiple dashboards validate and render the same storage snapshot. The detailed card
and fixed viewport bar show requested delay, last confirmed completion, next target,
derived scheduler label, and a once-per-second countdown. That interval changes text
only, stops outside running/scheduled state, and never messages the executor.

Only non-terminal jobs render under Active Jobs or in the fixed job bar. The single
persisted completed/cancelled job renders under Recent activity with confirmed counts,
finish time, target delay, and Dismiss. Dismiss is routed through the background
controller, atomically rejects non-terminal state with `job_not_terminal`, and removes
only the terminal job storage key.

## Read-only diagnostic

`runSearchDiagnostic` shares request construction and parsing with Search Sync but
uses zero retries, one page by default, and a hard two-page cap. It does not call a
mutation endpoint or storage API. Each raw response is reduced immediately to a
sanitized aggregate report; cursor values and result records are discarded.

The dashboard retains only the sanitized report in memory for display/copy. Its
fields are status, page count, HTTP status(es), top-level keys, item/conversation
counts, non-conversation source types, cursor-present boolean, conversation
`has_more`, schema warnings, stop reason, and Retry-After milliseconds.

The separate eligibility diagnostic follows the same privacy rule but operates on
exactly one row and reports only normalized classification evidence. It does not
persist raw response data or include the conversation ID in its copied report.

## Compatibility and troubleshooting

The `source_requests` payload intentionally uses the smallest explicit
conversation-only shape currently available to this repository:
`[{"type":"conversation"}]`. Strict response filtering remains mandatory. Live
compatibility must be checked by the user through the read-only browser diagnostic;
mock tests prove local behavior, not ChatGPT's current private schema.

If the diagnostic reports a schema mismatch:

1. preserve the sanitized report;
2. compare only structural facts such as top-level keys/source types;
3. update synthetic fixtures and parsers before adapting production code;
4. retain unknown-as-protected and strict heterogeneous-result filtering;
5. do not paste raw responses, tokens, conversation IDs, titles, snippets, query IDs,
   or cursors into issues, fixtures, or commits.

The manifest requests exactly `storage` and `alarms`, plus the existing ChatGPT
host permission. `alarms` is used only for durable job scheduling. No analytics, telemetry, external service, or production dependency is
used.


## Additive Manager backbone V3

[Authoritative design](documentation/design/MANAGER_BACKBONE_V3.md): provider refs and
metadata repositories surround, rather than rewrite, the established History/Search/
Delete implementation. The old inventory DB and job storage keys remain unchanged.
New metadata uses `ConversationManager_Meta_DB` v2 with transaction-completion writes.

Collections/Tags are local curation; Projects are provider metadata; Clusters are
analytical results; Artifacts pin immutable archive sources. Future engines remain
unregistered/disabled. Capture orchestration has injectable tab/readiness/payload
adapters but no real Save engine or durable CaptureJob host.
