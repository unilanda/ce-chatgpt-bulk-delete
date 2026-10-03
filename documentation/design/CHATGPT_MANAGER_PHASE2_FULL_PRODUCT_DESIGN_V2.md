> Historical V2 draft. Implementation contracts are superseded by MANAGER_BACKBONE_V3.md and its linked storage/action/capture documents.

# ChatGPT Manager — Full Product Architecture V2

## 0. Purpose

ChatGPT Manager is no longer a bulk-deletion utility. It is a provider-aware conversation-management system whose core responsibilities are:

1. discover conversation metadata;
2. maintain a canonical local inventory;
3. organize conversations locally and, where validated, remotely;
4. capture/version full conversation content;
5. analyze relationships among conversations;
6. summarize and merge conversation knowledge;
7. execute explicit actions such as Save, Move, Export and Delete.

Chrome + ChatGPT are the first implementation targets. The architecture MUST preserve a clean path to Firefox and Claude without forcing a rewrite of Collections, Archive, analysis, or synthesis logic.

---

# 1. Layered architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                         UI / UX                             │
│ Discover · Collections · Archive · Analyze · Actions       │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    Application services                    │
│ Inventory · Collections · Archive · Analysis · Jobs        │
│ Action preparation · Synthesis · Export                    │
└───────────────┬──────────────────────────────┬──────────────┘
                │                              │
┌───────────────▼──────────────┐   ┌──────────▼───────────────┐
│ Provider-neutral data model │   │ Browser capability layer │
│ ConversationRef             │   │ runtime/storage/download │
│ Collection                  │   │ alarms/tabs/files         │
│ ArchiveRecord               │   └──────────┬───────────────┘
│ AnalysisArtifact            │              │
└───────────────┬──────────────┘      Chrome now / Firefox later
                │
┌───────────────▼──────────────────────────────────────────────┐
│ Provider adapters                                            │
│ ChatGPT now                         Claude later              │
│ history/search/classification       discovery/search          │
│ capture adapter                     capture adapter            │
│ project actions                     provider-specific actions  │
└───────────────────────────────────────────────────────────────┘
```

Rules:
- New Collection/archive/analysis code must not use raw ChatGPT IDs as its primary identity.
- New shared logic must not call `chrome.*` directly unless explicitly browser-facing.
- Provider-specific remote transports remain behind provider adapters/policies.
- Browser-specific differences must not fork the entire application.

---

# 2. Conversation identity

The existing ChatGPT inventory remains keyed by its proven `id` contract. Do NOT migrate it in this phase.

All new cross-provider metadata uses:

```text
ConversationRef = provider + provider_conversation_id
```

Canonical encoded example:

```text
chatgpt:<encoded-id>
claude:<encoded-id>
```

The combination is globally unique inside Manager metadata.

Current legacy ChatGPT records map to:

```text
provider = chatgpt
provider_conversation_id = record.provider_conversation_id || record.id
```

This boundary lets the existing ChatGPT-specific inventory stay stable while Collections, Archive, summaries and relationships become provider-neutral immediately.

---

# 3. Capability model

Capabilities must be explicit, not inferred ad hoc in UI code.

Current ChatGPT capability truth:

| Capability | Standalone | Project | Custom GPT |
|---|---:|---:|---:|
| Inventory / discovery | Yes | Yes | Yes |
| Verification / classification | Yes | Yes | Yes |
| Local Collection membership | Yes | Yes | Yes |
| Future Save / Archive | expected Yes | expected Yes | expected Yes |
| Future Summarize / Merge | Yes once archived | Yes once archived | Yes once archived |
| Delete | Yes | Yes with approval | **No until live-validated** |
| Move to Project | not yet validated | not applicable/current | unvalidated |

Custom GPT is a conversation classification, NOT a separate provider. Its current delete restriction must not block non-destructive Manager features.

---

# 4. Storage model

## 4.1 Existing inventory database

Keep current proven ChatGPT inventory database:

```text
ChatGPT_BulkManager_DB
  conversations
```

Purpose:
- current discovered conversation metadata;
- current classification evidence;
- current history/search discovery observations.

It is a cache/inventory and may be rebuilt from provider discovery.

## 4.2 Provider-neutral Manager metadata database

Introduce now, before significant user metadata exists:

```text
ConversationManager_Meta_DB
  collections
  collection_memberships
  archive_records
```

This database is intentionally independent from inventory rebuild/clear.

Future schema versions may add:

```text
archive_revisions
analysis_artifacts
conversation_relationships
clusters
synthesis_artifacts
local_tags
```

Do not add those stores until the feature needing them is implemented.

## 4.3 Full archive payload

Full messages are NOT stored in `chrome.storage.local` and are not added to the metadata DB in Foundation V2.

When Save Chat is integrated, use a dedicated archive payload layer capable of storing normalized messages and revision payloads. Exact backend is chosen after reviewing the user's mature Chrome + Firefox Save Chat implementations.

---

# 5. Inventory semantics

Inventory and archive are distinct:

```text
Inventory: what conversations are currently known from the provider?
Archive:   which full conversations have we captured locally, and at what revision?
```

Therefore:
- Refresh History merges/upserts.
- Rebuild inventory may clear current provider inventory.
- Collections/archive metadata survive inventory rebuild.
- When a conversation is rediscovered, its provider-neutral ref reconnects to Collections/archive state.

Search remains query-dependent recovery/discovery, not a guaranteed full-account enumerator.

---

# 6. Collections

Collections are local Manager organization only.

Properties:
- zero/many Collections per conversation;
- one Collection may mix ChatGPT Standalone, Project, Custom GPT, and later Claude;
- membership persists even if inventory temporarily disappears;
- deleting a Collection deletes only Collection metadata;
- no remote ChatGPT mutation;
- no eligibility classification is required to add a conversation to a Collection.

Required operations:
- create;
- rename service API;
- list + count;
- add refs idempotently;
- remove refs;
- delete Collection + memberships atomically;
- list Collections for a conversation;
- filter current workspace by Collection.

Foundation UI implements create/add/filter/remove/delete. Rename UI can follow later without schema changes.

---

# 7. Archive registry

Archive registry stores metadata only:

```text
conversation_ref
provider
provider_conversation_id
capture_status       current | stale | failed
source_updated_at
last_captured_at
content_hash
normalized_hash
message_count
formats[]
revision
last_error_code
updated_at
```

No full messages, HTML, Markdown body, access token, cookies, or raw server responses.

Initial Save/Update policy once capture exists:

1. no archive record -> capture;
2. source metadata unchanged and archive current -> skip;
3. source changed -> recapture complete normalized conversation;
4. successful recapture -> increment revision;
5. capture failure -> retain last successful capture metadata + sanitized failure state.

Do NOT implement delta capture first. Edited prompts, regenerated answers and branches make naive append-only deltas unsafe. Full recapture + comparison is the safe initial policy.

---

# 8. Capture architecture — next stage after Save Chat handoff

The user's mature Save Chat Chrome + Firefox extensions are authoritative implementation sources for capture behavior.

Do not reinvent their hydration/scrolling logic before reviewing them.

Target interface:

```text
ProviderCaptureAdapter
  canCapture(conversationRef)
  capture(conversationRef, options, progress, signal)
      -> NormalizedConversation

NormalizedConversation
  conversation_ref
  provider
  title
  source_created_at
  source_updated_at
  captured_at
  messages[]
  branch/provenance metadata where available

ArchivePayloadStore
  writeRevision(normalizedConversation)
  readLatest(conversationRef)
  readRevision(conversationRef, revision)

Serializers
  HTML
  Markdown
  TXT
```

Provider-specific acquisition and browser-specific mechanics must remain separate from normalization and archive versioning.

---

# 9. Save / Update job

Once capture is integrated, generic selection exposes:

```text
Save / Update selected
```

Preparation:
- map selected inventory records to ConversationRefs;
- inspect archive freshness;
- partition current / stale / never / unavailable;
- skip current by default;
- create sequential capture plan.

Execution:
- one conversation at a time;
- progress persisted enough to recover safely;
- failed capture does not corrupt prior successful revision;
- cancellation stops future captures;
- archive registry updates after payload commit succeeds.

No remote destructive semantics are involved.

---

# 10. Action-preparation framework

Standalone `Verify selected` remains an optional maintenance utility.

Normal actions should acquire their own prerequisites:

```text
Selection
  -> Action preparation
       -> reuse cached evidence
       -> obtain missing evidence/data
       -> partition ready / needs approval / blocked
  -> Review
  -> Execute
```

Examples:
- Delete -> auto-verify classification, discover Project subset, request one approval.
- Save -> inspect archive freshness and capture support.
- Summarize -> ensure archives are current enough.
- Merge -> ensure source payloads are available.
- Move to Project -> verify provider/action eligibility.

Users should not be forced through manual prerequisite workflows when the action can safely prepare itself.

---

# 11. Similarity / clustering / duplicate / superseded analysis

Do not send hundreds of full raw chats directly to a model.

Use hierarchical analysis:

### Stage A — candidate discovery
Cheap metadata/search/Collection candidates:
- title similarity;
- explicit content-search query groups;
- Project/Collection membership;
- later local summary fingerprints.

### Stage B — archive candidates
Bring relevant chats current locally.

### Stage C — per-chat structured extraction
For each chat produce a compact artifact:

```text
main_topics
decisions
implemented_changes
open_questions
important_facts
superseded_decisions
artifacts/files
timeline
```

### Stage D — cluster relationship analysis
Relationship edges:
- similar_to;
- duplicate_of;
- supersedes;
- branch_of;
- complements.

### Stage E — selective full comparison
Only inspect full source payloads where a relationship requires exact evidence.

AI classifications are advisory. They must never automatically delete a conversation.

---

# 12. Summarize

Summarize is a first-class action, distinct from Merge.

Inputs:
- selected conversations;
- Collection;
- cluster;
- Project-derived candidate set.

Modes:
- executive summary;
- technical summary;
- timeline;
- decision log;
- open questions;
- implementation status;
- research handoff;
- custom prompt.

Every result should retain source provenance at conversation level and, where feasible, message/range provenance in the archive payload.

---

# 13. Merge

Merge must expose explicit modes because they solve different problems.

## 13.1 Raw archival merge
Concatenate normalized chats with source boundaries. No semantic deletion.

## 13.2 Structured lossless merge
Deduplicate repeated material while retaining every unique fact/decision and source provenance.

## 13.3 Canonical semantic merge
Produce the best current knowledge state. Older/superseded decisions move into explicit historical sections rather than silently disappearing.

Canonical output should be suitable for:
- a project handoff document;
- continuation context;
- a new canonical chat;
- export.

---

# 14. Projects

Collections are local and provider-neutral. Projects are provider-specific remote organization.

Move-to-Project is not implemented until the actual ChatGPT browser transport is captured and validated.

Future action:

```text
Selection / Collection / Cluster
  -> Move to Project
  -> provider-specific eligibility/preflight
  -> review
  -> sequential/bounded action job
```

Do not infer or invent private endpoints.

---

# 15. Browser architecture

Chrome is first, Firefox later.

Do not clone the Manager into two products.

Shared modules should cover:
- conversation refs;
- Collections;
- archive registry/payload model;
- analysis artifacts;
- synthesis;
- provider capabilities;
- action plans where browser-neutral.

Browser adapters later cover only differences such as:
- runtime messaging;
- storage APIs;
- alarms/background lifecycle;
- downloads;
- tabs;
- manifest format.

The Save Chat Chrome + Firefox source handoff should determine the actual adapter boundary from real differences, not speculation.

---

# 16. Provider architecture

ChatGPT is first. Claude later plugs into the same local organization/archive/analysis layers.

A future Collection may contain:

```text
17 ChatGPT conversations
6 Claude conversations
```

Then local actions such as Archive status, Summarize, Merge and clustering operate on normalized provider-neutral content.

Remote actions stay capability-gated by provider.

---

# 17. UI information architecture

Long-term Manager surfaces:

```text
Discover
  History / Search / provider filters

Organize
  Collections / tags / Projects

Archive
  Save / Update / freshness / revisions

Analyze
  Similar / Clusters / Duplicate / Superseded

Synthesize
  Summarize / Merge / Handoff / Canonical context

Actions
  Move / Export / Delete

Jobs / Recent activity
  running work and terminal summaries
```

Generic conversation selection remains independent from action-job membership.

---

# 18. Safety and provenance

- No AI analysis automatically deletes chats.
- No provider mutation without explicit user action/review.
- Destructive transports remain separately validated.
- Auth material is never persisted.
- Archive payload and metadata are clearly separated.
- Inventory rebuild must never erase user-created Collections/archive data.
- Synthesis must retain source provenance.

---

# 19. Implementation sequence

1. Core Inventory Cleanup + Delete V2 stable.
2. **Foundation V2 now:** ConversationRef, provider capabilities, independent metadata DB, Collections, archive registry.
3. Checkpoint.
4. Handoff/review Save Chat Chrome + Firefox extensions.
5. Shared capture/normalization/archive payload layer.
6. Save/Update jobs + archive freshness UI.
7. Archive-aware Collections.
8. Per-chat structured summaries.
9. Similarity/clustering/relationship graph.
10. Summarize.
11. Merge modes + canonical synthesis.
12. Firefox Manager build from shared core.
13. Claude provider/capture adapter.
14. Capture/validate ChatGPT Move-to-Project transport.
15. Add Project organization action.
16. Custom-GPT deletion only after separate live validation.
