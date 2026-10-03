# Manager backbone V3 — actions, UX and product flows

## Product distinctions

Inventory is a discovered index. An Archive is content captured at a specific scope
and revision. A Collection is user-curated. A Tag is a label. A Project belongs to a
provider. A Cluster is analytical output. An Artifact is a provenance-pinned result.
A Job is execution state. These are distinct models, not one generic “group”.

## Capability-driven actions

`ManagerActions.REGISTRY` is a static internal registry, not a plugin platform.
An action has ID, label, implementation status, kind and prerequisites. `evaluate`
returns enabled/code/reason, not just a Boolean. `plan` snapshots canonical refs and
inspectable prerequisites. `createRunner` can sequence:

`availability → prepare → acquire_prerequisites → review → execute → result`.

The selected IDs are frozen for one operation. Later checkbox changes do not silently
change the plan being reviewed. Cancellation can stop before execution. A local
review refusal does not mutate storage. Missing handlers and missing implementations
throw explicit errors; they do not return pretend-success objects.

Delete remains the existing wizard and background executor. The registry says it may
open preparation, not that every selected item is authorized for deletion. Its current
classification, Project approval, Custom-GPT blocking and one-active-job policy remain
in the existing code. No generic action can grant permission to that executor.

## Implemented action/UI matrix

| Action | This build | Reason for unavailable state |
|---|---|---|
| Add to Collection | Real local create/add/rename/remove/delete/filter | Local DB unavailable or no selection |
| Tag | Real local create/add/rename/remove/delete/filter | Local DB unavailable or no selection |
| Delete | Existing real workflow, not rewritten | Existing job/provider/verification policy |
| Save / Update | Visible disabled | Capture engine not connected |
| Analyze / Similar / Cluster / Duplicate / Superseded | Contracts and repositories | Analysis engine not connected; complete archives also required |
| Summarize | Modes, pinned-input request contract | Summary engine not connected |
| Merge raw | Source-preserving export request contract | Payload reader/exporter not connected |
| Merge structured | Deduplicated-with-provenance contract | Merge engine not connected |
| Merge canonical | Current-knowledge contract | Merge engine not connected |
| Synthesis / handoff | Artifact and request contracts | Synthesis engine not connected |
| Move to Project | Provider capability/operation contract | Transport not validated |

Future operations stay disabled even when a test inserts archive metadata. Archive
availability is a prerequisite, not an implementation. No live AI call is made.

## Prerequisite planning

`ManagerPrerequisites.inspect` classifies missing/stale/unknown archive refs and
whether a requirement is satisfied. Complete archives can support a deliberately
historical raw export. Current archives additionally need version/timestamp evidence.
It returns remediation descriptors such as `archive.save`, never starts a hidden job.
Future installed handlers can acquire prerequisites and rerun this inspection before
review. The existing Delete preparation continues to bulk-verify selected unknowns.

## Workspace behavior

Discover/History/Search, Active Jobs, Recent activity and the existing table remain.
Collections and Tags have compact local organization panels. Each shows total
membership and how many members are present in the current inventory. A Collection
with no currently discovered rows remains visible and can reconnect after rebuild.

The table adds View, Collection and Tag filters and an Archive/Tags cell. All filters
combine with existing title/type/date/status filters. `Projects` means known Project
conversations, not a fabricated project-name directory. `Archived` requires a committed
snapshot receipt. `Needs update` shows known stale archives. `Clusters` is visible as
unavailable; there is no fake sample cluster. Empty archive views explain the missing
capture engine rather than suggesting the user has already saved content.

The selected-action bar exposes Save/Update, Collection, Tag, Analyze, Summarize,
Merge, Move and Delete. Future buttons use actual `disabled`. A keyboard-focusable
wrapper and associated text explain the reason; the explanation is not dependent on
hovering a disabled element. An informational disclosure lists future analysis/merge
modes. It is help, not a hidden operation.

No new modal changes the user's provider chats. Names render through text/escaping,
not trusted HTML. Organization modals focus their name input, support Escape and
Tab cycling, and return focus on close. Errors remain in the modal and do not clear
the selection. Local delete confirmations explicitly distinguish group removal from
remote conversation deletion.

## Collection and Tag examples

**Research collection:** select one Standalone, one Project and one Custom-GPT chat;
choose Collection; create “RNA switch research” while adding. All three refs become
members in one atomic operation. Nothing moves in ChatGPT.

**Reading tag:** with the same three selected, choose Tag, create “Read next”. Rename
it to “Important”. Rename changes the label, not its ID or memberships. Delete the
Collection: the Tag remains. Remove selected Tag members: the conversations remain
selected and in the inventory.

**Rebuild:** inventory becomes empty/partial, metadata remains. The Collection may
show “3 members · 0 in inventory”. Rediscovered refs reappear automatically; no manual
membership restoration is required. Rebuild is not a metadata garbage collector.

## Future corpus-to-knowledge flow

1. History plus explicit content searches produce a candidate set. Search terms do
   not prove a semantic cluster or exhaustive account coverage.
2. User saves the set as a Collection/Tags.
3. Save preparation checks the archive registry for missing/stale/unknown content.
4. A connected capture adapter updates required snapshots and commits actual bytes.
5. Analysis pins those snapshots into an immutable input corpus.
6. Per-chat extraction can precede relationship/cluster analysis; full-content
   comparisons resolve uncertain overlaps rather than relying only on titles.
7. Summarize/Merge/Synthesis produce artifacts with exact source revisions and recipes.
8. User reviews results. A later Move action may organize provider Projects using
   validated transport. Redundancy labels never authorize automatic deletion.

## Summary and merge meaning

Summary modes: general, technical, timeline, decision log, open questions, handoff.
Merge raw preserves source ordering/content; it is not a semantic rewrite. Structured
merge attempts deduplication with retained provenance. Canonical merge selects a
current coherent representation while retaining sources and conflicts. Semantic
“lossless” is a goal to evaluate, not a guarantee that an LLM preserved every fact.
The request contract labels semantic losslessness `not-guaranteed` and raw mode
`source-preserving-only`. All source archives remain independently available.

## Analysis privacy and authority

Source chats are data, not instructions to execute. A future analysis engine must
isolate corpus text from operator instructions, show which content will be uploaded,
and obtain consent for remote processing. Do not use saved tokens/headers, infer
access from a filesystem path, or automate ChatGPT's private prompt/file endpoints
without a separate validated integration. The first practical analysis integration
may export a user-reviewed corpus/package and import a reviewed result; this build
has no such engine or transport.

## Not changed here

No repository rename, Chrome/Firefox packaging split, manifest permission expansion,
new provider endpoint, job schema migration, save serializer, embedding, clustering
algorithm, summary model, Project mutation or conversation-creation transport.
