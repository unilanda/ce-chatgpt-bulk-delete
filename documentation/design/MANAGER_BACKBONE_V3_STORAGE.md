# Manager backbone V3 — storage, commits, versions and provenance

## 1. Storage ownership

| Layer | Store | This patch |
|---|---|---|
| Existing provider inventory | `ChatGPT_BulkManager_DB`, version 1, `conversations` | Unchanged; native provider IDs remain keys. |
| Existing deletion job and setting | `chrome.storage.local` | Unchanged keys, schema and executor. |
| Manager metadata | `ConversationManager_Meta_DB`, version 2 | New/additive, provider-neutral. |
| Full archived payloads | Injected payload-store interface | No production store connected yet. |
| Generated artifact payloads | Payload-store interface | No AI/output engine connected yet. |

Do not put full transcripts in extension settings storage. A payload reference is an
opaque `{store, key}` pair, not an inferred Downloads path and not an authorization
token. The registry does not claim that an arbitrary filename is readable.

## 2. Canonical identity

`ConversationRef.encode(provider, providerId)` produces a lowercase provider plus a
strict percent-encoded native ID. Example: `chatgpt:example-id`. A Claude ID with the
same text is different: `claude:example-id`. IDs containing colons, percent signs or
Unicode are encoded, not concatenated ambiguously. Decoding rejects non-canonical
aliases such as `ChatGPT:x`, `%78` for `x`, and unescaped separators.

Inventory migration is deliberately avoided. `encodeInventoryRecord` derives a ref
at the adapter/UI boundary. Local membership can outlive an inventory observation.
A missing inventory row means “not currently in this index,” NOT “remotely deleted.”

Source account/workspace context is a separate future acquisition concern. This
patch does not retrofit account isolation into the old inventory. A real Save or
Claude integration must establish native-ID uniqueness and bind the authenticated
source context before enabling account operations. Provider refs are not an account
sync service, and Chrome/Firefox profiles do not become one shared remote database.

## 3. Metadata schema v2

All indexes below are non-unique unless marked unique. Stores are separate even when
they use the same internal repository helper.

| Store | Primary key | Indexes / purpose |
|---|---|---|
| `collections` | `id` | unique `name_key`, `updated_at`; curated named groups |
| `collection_memberships` | `key` | `collection_id`, `conversation_ref` |
| `tags` | `id` | unique `name_key`; lightweight labels |
| `tag_memberships` | `key` | `tag_id`, `conversation_ref` |
| `archive_records` | `conversation_ref` | `provider`; head and last attempt |
| `archive_revisions` | `key` | `conversation_ref`, unique `capture_id`; immutable snapshots |
| `artifacts` | `id` | `type`, `status`; producer/config/output record |
| `artifact_sources` | `key` | `artifact_id`, `conversation_ref`; ordered pinned inputs |
| `relationships` | `key` | `source_ref`, `target_ref`, `type` |
| `clusters` | `id` | `source_artifact_id`; analytical grouping |
| `cluster_memberships` | `key` | `cluster_id`, `conversation_ref` |

Membership keys combine a validated local group ID with a canonical ref. Archive
revision keys combine canonical ref and positive revision. Relationship keys encode
an ordered JSON tuple rather than an ambiguous delimiter format.

## 4. Transaction contract

`ManagerMetaDB.atomic(storeNames, mode, work)` resolves ONLY after `transaction.complete`.
Request success is insufficient: a later write or quota/constraint error may abort
the transaction. Errors retain their original cause; listeners are notified only
after commit. Tests explicitly simulate success-then-abort and assert no notification.

Inside `work(io)`, await only `io.get/all/put/add/delete/clear` for that transaction.
Never fetch, hash content, await a timer, or call a provider inside a live IndexedDB
transaction. Validate/hash inputs first, then enter a short transaction.

Atomic operations include create-group-plus-initial-members, add-members with parent
existence check, rename with optimistic revision, parent delete plus its memberships,
archive head plus revision, artifact record plus sources, and cluster plus members.
Cross-tab read/write serialization and unique indexes arbitrate conflicts. Optional
`expectedRevision` rejects stale edits instead of silently overwriting another tab.

`BroadcastChannel` publishes only `metadata_committed`, after commit; the receiving
view rereads its own database. It is invalidation, not a second source of truth. A
missing channel does not roll back committed writes. Such a view can reopen/refresh;
live cross-tab invalidation is an additional native-browser acceptance gate.

## 5. Upgrade and failure behavior

Version 1 from the earlier foundation draft may already contain Collections,
memberships and legacy archive metadata. Upgrade creates missing stores/indexes
without clearing those records. Legacy archive entries without a committed complete
snapshot remain `unknown`, never silently `current`. No fake revision/payload is
fabricated from legacy metadata.

`versionchange` closes the old connection. A blocked upgrade reports “close other
Manager tabs and reopen”; it does not delete the DB. A database newer than this code
is rejected by IndexedDB; do not retry at a lower version or reset. Legacy duplicate
normalized names that violate a new unique index require explicit review, not an
automatic delete/dedupe migration.

The existing inventory, settings and DeleteJob have no schema migration in this patch.
Metadata initialization failure leaves History and the existing Delete wizard usable;
new local organization controls remain unavailable with an explanation.

## 6. Collections and Tags

Both are local, many-to-many, and accept canonical refs of any provider/type. They
are NOT ChatGPT Projects. A Project chat or Custom-GPT chat can be tagged or grouped
without making it eligible for deletion.

Names are Unicode-normalized, whitespace-normalized and case-normalized for uniqueness
within their own store. A Collection and a Tag may share the same name. Duplicate
membership adds do not duplicate rows or rewrite their original `added_at`.
Deleting a group cascades only to its own membership rows. It never removes inventory,
archives, artifacts, provider chats, or membership in another group type.

## 7. Archive record and immutable snapshot

`archive_records` points at a latest snapshot and separately records `last_attempt`.
A failed update does not destroy the last good snapshot. `markStale` sets invalidation
without changing the source timestamp of a historical capture.

A capture input includes:
- canonical `conversation_ref`, unique `capture_id`;
- source update timestamp (legacy seconds or ISO are normalized at the boundary);
- optional source version, completeness, selected-branch/whole-tree scope and branch key;
- capture-engine version and normalizer version;
- content hash and normalized hash, canonical SHA-256 format;
- message count and available formats;
- a committed payload receipt/reference.

A repeated `capture_id` with identical capture fields is idempotent. Reusing it for
different content or a different conversation is an error. Revisions are immutable.
An optional expected head revision prevents a stale capture from winning silently.

“Complete” means complete for the declared scope; a fully captured selected branch
is not proof that every branch of the provider conversation tree was captured.

## 8. Freshness and physical availability

`ArchiveFreshness.evaluate` returns state, basis and reason:
- `never_saved`: no capture record or completed snapshot;
- `current`: matching version or matching timestamp for a complete committed snapshot;
- `stale`: explicit invalidation or changed observed version/timestamp;
- `unknown`: unavailable metadata, incomplete/legacy receipt, or insufficient evidence.

Timestamp equality means **up to date by metadata**, not a new live content comparison.
An equal message count/size is never proof of equal content. Hash comparisons apply
to actually captured payloads. Planning that needs current archives treats unknown
freshness as unresolved rather than silently proceeding.

The production payload reader has not been connected. A future Save adapter must
persist bytes first, obtain a durable receipt, then publish the archive revision/head.
Cross-store publication is not one atomic transaction: a failed metadata commit may
leave an orphan payload, which is safer than a head pointing to missing bytes. A
future durable capture host must journal receipt/capture IDs and reconcile or garbage
collect only demonstrably unreferenced payloads. Do not delete the previous archive on
an interrupted attempt. Do not report successful capture before both commits.

## 9. Artifacts and staleness

`ArtifactService.create` validates that every source points to an existing complete,
committed archive revision. It atomically creates a draft plus ordered provenance.
Producer ID/version and configuration/instruction hash identify how it was produced.
`commit` requires an output payload reference and unchanged pinned source hashes.
Ready artifacts are immutable; regeneration creates a new artifact.

Source rows pin conversation ref, revision, raw/normalized hashes, normalizer version,
scope, branch and ordinal. Currentness compares them with present archive heads;
source changes make the result stale without rewriting its historical provenance.
Raw merge uses raw content hashes; semantic outputs use normalized hashes, with scope
and normalizer changes still significant. Missing/corrupt provenance yields unknown.
Remote observations may additionally be supplied; without them the basis is explicitly
`archived_sources`, not a promise that the remote account is current.

Producer/config versions are recorded now. A later engine must invalidate/recompute
artifacts when its requested recipe differs. Source spans/message IDs can be added
when the real normalized Save model is known; this pass does not invent them.

## 10. Relationships and Clusters

`similar_to`, `duplicate_of`, `complements` canonicalize symmetric endpoint order.
`supersedes` and `branch_of` remain directed. Confidence is optional and bounded.
Assertions identify user/model/import origin. Model/import assertions require a
ready provenance artifact. These are knowledge assertions, NEVER delete permissions.

A Cluster requires a ready `cluster_report` and members represented in its provenance.
It is not a Collection; conversion later will create a user-curated Collection with
explicit consent. Removing a Cluster leaves its report and source archives intact.

## 11. Testing boundary

Node tests cover repository contracts with isolated transactional memory fixtures,
real HTML initialization with synthetic IDB, and controlled IDB event commit/abort
ordering. Offline Chromium tests exercise real DOM/CSS with injected storage/runtime.
Native IndexedDB upgrade/rollback/two-connection behavior has a separate supplied
browser suite and must run on Codex's host before release. In this ChatGPT container,
page navigation was blocked by environment policy; that gate was not passed here.
