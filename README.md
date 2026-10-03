# ChatGPT Manager

A local-first Chrome Manifest V3 extension for discovering, inventorying, filtering,
selecting, and acting on ChatGPT conversations.

This project uses ChatGPT's internal browser endpoints. Those endpoints are
unsupported and may change without notice. Review the classification and deletion
safety rules before using the extension.

## Features

- **Refresh history** is the normal primary discovery path. Its explicit **Maximum
  conversations** accepts All or a positive whole number and never fetches past
  that requested cap. Current-run added/updated/unchanged counts are reported
  separately from total local inventory.
- **Rebuild from ChatGPT** is a separately confirmed from-zero History enumeration.
  It clears only the conversation inventory, uses conservative 10-item sequential
  pages with 500 ms pacing, and preserves settings and durable deletion-job state.
  Partial or failed rebuilds remain visibly incomplete and offer query-driven Search
  recovery without running a guessed query.
- **Find by content** is a first-class discovery path. User-supplied words or
  phrases can find conversations that the ordinary history list may not currently
  enumerate. Each query is paginated independently.
- **Conservative classification** makes unknown and custom-GPT records blocked.
  Search-only discoveries start unknown. Verified Project conversations are eligible
  only inside an explicitly reviewed job with one extra approval for the unchanged
  Project subset.
- **Automatic Delete preparation** reuses cached evidence, sequentially verifies every
  selected search-discovered candidate, persists each successful classification, and
  partitions Standalone, Project, Custom GPT, and unresolved records before Start.
- **Generic selection and explicit review** can include every conversation type. The
  Prepare → Review → Start wizard creates no durable job and sends no deletion request
  until the reviewed eligible subset is acknowledged at Start.
- **Persistent deletion jobs** run only in the background service worker. They default
  to a 600-second target and accept positive whole seconds down to 1. Targets of 30
  seconds or more use durable one-shot alarms; faster targets use a best-effort worker
  timer plus a durable backup alarm. Jobs survive dashboard closure, synchronize across
  dashboards, and expose distinct direct Resume versus review-required controls. A
  local record is removed only after remote success; failures pause without automatic
  destructive retry.
- **Advanced / Diagnostics** is collapsed during normal use. Its read-only
  diagnostic runs one explicit search query for one page by default,
  with a hard maximum of two pages. Its copyable output contains aggregate schema
  facts only and is not persisted.
- **Local storage** keeps sanitized conversation metadata in browser IndexedDB.
  Search Sync does not store snippets, message bodies, message IDs, raw responses,
  authentication material, or opaque cursors.

## Install for development

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this repository directory.
4. If it was already loaded, choose **Reload** on the extension card.
5. Sign in at https://chatgpt.com, then use the injected **ChatGPT Manager** button.

The manifest requests only `storage` and `alarms`, plus
`https://chatgpt.com/*` host access. `alarms` provides the durable wake for
each DeleteJob step; a sub-30-second target may also use one guarded in-memory timer.

## Sync modes and coverage

### History

Refresh history reads the ordinary conversation list in newest-first pages of at most 20
using the observed bounded query contract. It merges returned metadata into
IndexedDB. A record is eligible for deletion only when history metadata
explicitly demonstrates a standalone conversation. Merely lacking usable metadata
is not evidence of safety.

When an unlimited History run reaches the actual end of the remote list, it may remove stale
local records that previously came from History Sync. It does not use a partial or
user-limited run to perform that cleanup, and it does not remove search-only records.
A later-page 429, network error, malformed response, or other non-success is
reported as partial; successful pages and the existing inventory are retained and
there is no automatic retry loop.

Rebuild from ChatGPT is intentionally distinct. After explicit confirmation it clears
only the IndexedDB conversation store, preserves settings and the durable DeleteJob,
and enumerates History from offset zero to remote end using sequential 10-item pages
with 500 ms between successful non-terminal pages. These values are conservative
heuristics, not a supported service guarantee. A first-page failure intentionally
leaves the rebuilt inventory empty; a later failure retains each successfully saved
page and labels coverage partial/unknown. Search recovery requires explicit terms,
merges only matching conversations, and cannot guarantee complete account coverage.

The Advanced **Clear local inventory** action is also inventory-only and local-only.
It preserves settings and job state and refuses to run while a non-terminal deletion
job is present. In the job UI, only non-terminal jobs appear under **Active Jobs**;
the one persisted completed/cancelled job appears under **Recent activity** and may
be dismissed without a network request or inventory change.

### Find by content

Find by content reads /backend-api/global/search for each comma- or newline-separated
query. It does not claim to enumerate complete history: a query such as `rna` only
covers results matched by that query. Use query terms you intentionally choose and
read the per-query outcome before drawing coverage conclusions.

For each logical query, the first request uses a null cursor and a newly generated
query ID. Later pages reuse that query ID and send the exact opaque cursor supplied
by the previous response. The cursor is never parsed, incremented, or persisted.
Pagination follows the conversation source's `has_more` signal, rejects repeated or
missing cursors, and has a defensive page cap. Project and library search results are
ignored rather than coerced into conversation records.

Global Search timestamps are numeric Unix seconds and may include fractional
seconds. They remain stored in that protocol representation; a shared compatibility
boundary converts them to JavaScript milliseconds only for comparison, sorting, and
display. Existing ISO/date-string timestamps remain supported, while invalid or
missing values display as unknown and do not become invented dates.

Search Sync is additive: it merges and deduplicates by conversation ID and never
deletes. A 429 stops the current campaign and exposes Retry-After when supplied.
A transient server or network failure receives at most one paced retry; outcomes
remain explicitly complete, partial, failed, or cancelled.

### Lazy eligibility verification

History Sync retains its established list-response contract: an own `gizmo_id`
field that is null/empty means standalone, a `g-p-` value means Project, another
non-empty string means custom GPT, and an absent/invalid field is unknown.

The live conversation-detail response has separately validated a stricter contract:
an own, exact-null top-level `gizmo_id` means standalone, a non-empty `g-p-`
string means Project, and another supported non-empty string means custom GPT.
Missing, inherited, empty, wrong-type, malformed, conflicting, network, non-2xx,
and 429 results remain unknown-protected.

For that reason, search-only unverified rows expose a concise **Verify** action.
Advanced tools expose only aggregate sanitized status and schema facts: they omit
the ID, token, title, messages, snippets, and raw response. The verification
queue is sequential, waits three seconds between requests, is capped at 10 per
button press, stops immediately on 429 or an unavailable session (including HTTP
401), and preserves unknown on every ambiguous or failed result. A record-specific
403 remains an ordinary per-record failure and does not imply that the whole session
is unavailable.

The explicit verification action may persist those live-validated classifications;
exact-null evidence becomes standalone-safe and Project/custom-GPT evidence remains
protected. Delete preparation uses the same persistence path automatically for every
selected candidate and stops immediately on 429. Running the one-item diagnostic
itself never persists any result.

## Protection and persistent deletion rules

Stored records use four classifications:

- `standalone-safe`: eligible with explicit evidence from an established
  classification contract.
- `project-protected`: eligible only in the persistent-job flow after the entire
  current Project-conversation subset is reviewed and approved once. The containing
  Projects are never deleted.
- `custom-gpt-protected`: selectable, but blocked from deletion in V1.
- `unknown-protected`: selectable, but blocked until verified or removed from the
  job plan.

Stronger protection survives later merges. Search-only metadata cannot promote a
record to standalone. Older IndexedDB records remain compatible; insufficient
evidence normalizes to protected unknown.

Delete snapshots the generic selection and runs three explicit in-memory stages:
Prepare, Review, and Start. Prepare reloads canonical evidence, automatically verifies
every selected candidate sequentially, and persists successful classifications. Review
shows Standalone, Project, Custom GPT, and unresolved categories; exclusions affect
only the candidate job, never workspace selection. The complete unchanged Project
subset requires one approval. Custom GPT and unresolved items cannot enter execution.

Only successful Start creates and runs the versioned job in `chrome.storage.local`.
The controller reloads canonical records and atomically rejects changed or blocked
membership and mismatched Project approval. After acknowledgement, included IDs leave
the generic selection while excluded/blocked IDs stay selected. The active job owns
its pending work; a second Delete action remains disabled.

Only the background service worker executes a running job. It reloads durable and
canonical state, rejects stale/early events, revalidates eligibility, acquires the
current browser session token in memory, persists `requesting`, and sends one guarded
conversation deletion request. It never uses a Project deletion endpoint and never
persists a token, cookie, Authorization value, title, snippet, or raw response in job
state. Successful remote deletion precedes local removal and durable completion.

Network errors and every non-2xx response—including 400, 401, 403, 404, 429, and
500—become review-required pauses that preserve local/pending data. A 429 stores only
sanitized status and Retry-After. There are no automatic destructive retries. Pause
and Cancel never start another item; an in-flight result is reconciled once. A manual
pause offers direct Resume plus optional review. Error, restart, eligibility, session,
and uncertain-request pauses show the reason and pending plan before Resume.

Closing a dashboard does not stop the job, and another dashboard reconstructs the
same state. A real Chrome startup pauses an interrupted running job for explicit
review. Each ordinary service-worker instance performs one targeted check for an
orphaned durable `requesting` item without applying full startup semantics or
rescheduling a healthy job. Recovered `requesting` state fails closed rather than
repeating an uncertain remote request. Review explicitly warns that the remote outcome
is unknown before a separately confirmed Resume can reattempt it. A fixed job bar and
once-per-second dashboard ticker display durable progress and `next_run_at`; the ticker
only changes text and never schedules or executes deletion.

The delete interval defaults to 600 seconds and accepts positive whole numbers >=1.
The first step is immediate. After each confirmed completion C, `next_run_at` is
exactly `C + interval_seconds * 1000`. Targets >=30 seconds use one durable alarm at
that instant. Targets 1–29 seconds use a guarded in-memory timer plus a durable backup
alarm no earlier than the platform-compatible fallback; Chrome may therefore make a
fast job late, but the shared guard prevents a shorter or duplicate step.

## Read-only protocol diagnostic

The dashboard diagnostic is intended for user-run compatibility checks in the
already authenticated browser. Enter exactly one query and choose one page (the
default) or two pages (the maximum). It calls only the search endpoint and never
persists results.

The report clearly contains HTTP status, conversation result count, whether a cursor
exists, the conversation `has_more` value, and schema warnings/errors, plus
aggregate compatibility facts. It does not contain the query text, auth
token, titles, conversation/message IDs, cursor value, snippets, or raw response.

If Search Sync stops with `malformed_response`, first run this diagnostic and copy
the sanitized report. A changed list of top-level keys, missing conversation
`has_more`, or unexpected source types usually means ChatGPT changed its internal
schema. Do not weaken classification or filtering to work around such a change.

## Development and tests

The extension uses vanilla HTML, CSS, and JavaScript. Protocol, policy, sync,
deletion, and view-formatting logic are browser/CommonJS modules so the safety
behavior can be tested without a browser account.

Run the synthetic test suite with:

```sh
node --test tests/*.test.js
```

Automated tests use fake fetch responses, clocks, timers, and in-memory storage.
They never call ChatGPT or delete a real conversation. See `MANUAL_SMOKE_TEST.md`
for the separate browser checklist.


## Manager backbone V3 (draft integration)

Local Collections and Tags now organize selected conversations without changing their
ChatGPT location. Both survive Clear/Rebuild inventory. A separate provider-neutral
metadata DB stores organization, archive-registry, artifact/provenance and analysis
metadata. The existing inventory and background DeleteJob are unchanged.

Save/Update, Analyze, Summarize, Merge and Move are visible but disabled with explicit
implementation reasons. This build does not capture full chats, call AI models or
move provider Projects. Their reusable interfaces/repositories are implemented for
the later Save Chat Chrome/Firefox handoff.

See [backbone architecture](documentation/design/MANAGER_BACKBONE_V3.md) and
[implemented versus future](documentation/development/MANAGER_BACKBONE_V3_IMPLEMENTATION.md).

Validation is tiered: `node --test tests/*.test.js`, offline real DOM rendering, and
a separate native IndexedDB browser gate. A passing synthetic suite is not a claim
that the native gate or authenticated browser smoke ran.
