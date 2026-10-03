# Manager backbone V3 — module map and integration status

## Provenance

Reviewed source baseline: `chatgpt_manager_core_inventory_cleanup_v1_review_20261002_153223.zip`
SHA-256: `ce514eaa8b1122cb11924ef61f659f851cb071319c5503c90d08bec12f94c1a5`.

The earlier Full Foundation V2 bundle was an unintegrated draft. This implementation
reuses its useful foundations, strengthens them and supersedes its patch. It is NOT
an incremental patch that requires V2 to have been applied first.

## Production modules

| Module | Responsibility |
|---|---|
| `conversation-ref.js` | Strict canonical provider refs, legacy inventory bridge |
| `provider-capabilities.js` | Implemented vs future provider/type capabilities |
| `manager-validation.js` | Metadata validation, safe fields, revisions and hashes |
| `manager-meta-db.js` | v2 schema, commit-boundary transactions and invalidation |
| `organization-repository.js` | Internal atomic named-entity/member primitives |
| `collection-service.js` / `tag-service.js` | Distinct public organization APIs |
| `archive-freshness.js` | Pure freshness state/basis/reason |
| `archive-registry.js` | Immutable captures, current head, attempts, invalidation |
| `artifact-service.js` | Draft/commit, exact sources, output receipt, stale evaluation |
| `analysis-repository.js` | Directed/symmetric evidence relationships and clusters |
| `manager-prerequisites.js` | Missing/stale/unknown prerequisite partition |
| `manager-actions.js` | Static registry, availability, plan and lifecycle runner |
| `analysis-contracts.js` | Summary/merge/analysis request modes; no fake engine |
| `manager-job-contracts.js` | Future job envelopes, progress and transitions |
| `provider-adapters.js` | Incremental ChatGPT read shim; Claude contract |
| `browser-runtime-adapter.js` | Lazy Chrome API facade; Firefox contract |
| `capture-tab-runner.js` | Current/owned managed tabs, identity/focus/cleanup |
| `capture-orchestrator.js` | Injected sequential lifecycle; no production Save host |
| `manager-workspace-ui.js` | Local organization UI, views, capability presentation |

The main dashboard delegates local metadata work rather than absorbing those domain
services. Static element IDs remain in DashboardDom and the actual HTML harness.
No transport, DeleteJob executor/controller/store, inventory database, or manifest
permission is changed. Runtime marker becomes:
`ChatGPT Manager · manager-backbone-v3 · cm-runtime-20261002-mb3 · job schema 1`.

## Public API examples (synthetic, not provider operations)

```js
await managerMetaDB.init();
const collections = CollectionService.createService({store: managerMetaDB});
const collection = await collections.createCollection('RNA switch research', {
  refs: ['chatgpt:example-one', 'claude:example-two']
});
await collections.renameCollection(collection.id, 'Switch research', {
  expectedRevision: collection.revision
});
const tags = TagService.createService({store: managerMetaDB});
await tags.createTag('Read next', {refs: ['chatgpt:example-one']});
```

```js
const availability = ManagerActions.evaluate('summarize', {
  refs: ['chatgpt:example-one'], metadataReady: true
});
// enabled === false; implementation_missing. Archive metadata alone is insufficient.
const requirements = ManagerPrerequisites.inspect(['current_archives'], {
  refs: ['chatgpt:example-one'], archives: {}, observations: {}
});
// Missing source ref plus remedy descriptor archive.save; no network side effect.
```

```js
// Only a future, connected capture writer may produce this real receipt.
const registry = ArchiveRegistry.createRegistry({store: managerMetaDB});
// recordCapture requires hashes, source scope, versions and durable payload ref.
// Do not seed fixture archive records into the user's production DB to enable UI.
```

## Implemented vs unimplemented

Fully usable now: local Collections/Tags (all types), metadata filters and selection,
strict refs, atomic metadata service implementations, archive/provenance data model,
relationships/cluster repositories, action/prerequisite planning, and injected tab
orchestration primitives. Existing History/Search/Delete remain the same routes.

Implemented libraries but not an end-user live operation: archive publication,
artifact output publication, relationship/cluster creation from validated evidence,
current/managed-tab orchestrator, future job envelopes.

Intentionally unavailable: production capture/Save, physical payload reader/writer,
serializers, embeddings, AI analysis/summaries/merges, Project transport, Claude remote
access, Firefox runtime, new durable CaptureJob host. Disabled UI explains these gaps.

## Test tiers

1. Baseline full Node suite is rerun on the reviewed source and on the candidate.
2. Domain tests cover canonical refs, metadata atomicity/CAS, archives/provenance,
   relations, prerequisites, capture lifecycle and capability rejection.
3. Actual HTML/script initialization tests use synthetic browser APIs and a separate
   metadata DB, with failure isolation and selection preservation checks.
4. Controlled production DB transaction tests distinguish request success from
   transaction completion/abort.
5. Offline real Chromium DOM/CSS uses injected storage/session/runtime fixtures;
   tests UI actions, disabled states and responsive widths. No live server request.
6. Native IndexedDB suite exercises rollback/upgrades/concurrent connections and
   actual BroadcastChannel. This gate is supplied but environment-blocked here;
   Codex must run it on a suitable local browser before claiming release readiness.

The memory/HTML harness is NOT a conformant IndexedDB replacement. Do not use its
success to infer native transaction durability or cross-connection behavior.

## Review findings addressed in this draft

Earlier draft request-success completion replaced with true commit completion;
legacy “current archive” no longer implies content; source revisions and branch scope
pinned; user-tab closure prevented; managed foreground failure cleans up; pending
navigation distinguished from capture readiness; checkpoint failure after a successful
archive yields one truthful result; missing artifact provenance fails unknown; future
buttons/programmatic handlers reject unsupported execution; local metadata failure
leaves the existing core operable.

## Integration constraints

Apply only after verifying exact file preimages. HEAD alone is insufficient because
the working tree contains a cumulative uncommitted campaign. Preserve all unrelated
changes. Do not apply this on top of V2 blindly; reconcile against included candidate
files and their after hashes. Keep metadata DB version 2 for this candidate; do not
silently rename a user's prior metadata DB or clear it to make tests pass.

Remaining required review: native DB gate, installed Chrome non-destructive smoke,
metadata multi-tab failure/reconnect behavior, and later Save account/payload/journal
integration. No deletion test is needed for the new local metadata features.
