# ChatGPT Manager — Core Architecture Contract

## Stable product pipeline

**Discover → Inventory → Filter → Select → Action**

Delete is the only implemented action in this stage. Future actions include Save,
archive/update, Add/Move to Project where safely supported, Export/Merge, multi-chat
preparation/summarization, and other actions. Do not implement those now, but do not
make inventory/filter/selection delete-specific.

## Discovery

### History / Recent
Primary broad inventory source.

Observed request:
`GET /backend-api/conversations?exclude_conversation_origin=tpp&expand=false&hide_snorlax=false&is_archived=false&is_starred=false&limit=20&order=updated&offset=<N>`

Observed successful pages contain both standalone (`gizmo_id:null`) and Project
(`gizmo_id:"g-p-..."`) conversations. The same request has intermittently returned
429 and later 200. 429 is partial/transient failure, not end-of-history.

### Content Search
First-class query-based discovery and selection source, AND fallback/recovery when
History is temporarily rate-limited/incomplete. Search is query-dependent and is not
guaranteed complete account enumeration.

Future sources (Project-specific enumeration, archive registry/import, etc.) must feed
the same inventory.

## Canonical inventory

One semantic record per `conversation_id`. Observations from History, Search, detail
verification, and future sources enrich that one record.

Conceptually:

ConversationRecord:
- identity: conversation_id
- metadata: title, timestamps, archive/star state where known
- classification: standalone/project/custom-gpt/unknown
- classification evidence/verification state
- discovery provenance: history/search/future
- project/gizmo metadata where known
- future archive/save metadata (not implemented now)

Merge by conversation_id. Preserve stronger classification evidence. Search must not
weaken History/detail evidence. Use canonical timestamp comparison.

## Classification

Live-validated:
- own gizmo_id === null → standalone
- own non-empty g-p-* → Project
- other supported own non-empty gizmo string → Custom GPT
- missing/inherited/wrong-type/malformed/conflicting/error → unknown

Unknown is protected for destructive actions. Sidebar/Recent placement is never
classification evidence.

## Filtering

Filtering is action-independent. Foundation filters: title text, date, type,
verification/protection status. Future: Project, provenance, archive state, etc.

## Generic selection

Selection is `SelectionSet<conversation_id>` conceptually. A checkbox means only
"selected conversation", never "selected for deletion". Avoid delete-specific
selection state/naming.

## Actions

Conceptual boundary:
Action = id, label, eligibility(record), preflight(selection/options),
execute(selection/options), progress, result.

Do NOT build a heavyweight plugin framework. Establish clean generic boundaries and
naming.

Current implemented action: Delete.
Future: Save/Update archive, Project operations, Export/Merge, summaries, etc.

Delete owns its eligibility policy:
- only standalone-safe executes;
- recheck persisted current state at execution;
- protected/unknown never reach transport;
- remote success before local removal;
- non-2xx/network/429 stops safely;
- no parallel deletes;
- configurable interval seconds, default 600, minimum 60.

## Partial discovery

History uses offset pagination. If a later page 429s, keep existing inventory and
successful pages, report partial, and allow later retry. Never interpret 429 as end.

A requested maximum caps the current run, not total local inventory. Status should
distinguish fetched/inserted/updated/unchanged/total-local.

## Future repository/browser structure

Later, after a clean checkpoint:
- repository/root: chatgpt-manager
- Chrome: ce-chatgpt-manager
- Firefox: fe-chatgpt-manager
- maximize shared core; browser adapters/manifests only where necessary.

Do NOT perform that restructure in this stage.

## Non-goals now

No Save engine, archive registry, merge/summary, Project mutation, Firefox port,
repository rename, or speculative Project APIs. Design boundaries so these can be
added without replacing the core.
