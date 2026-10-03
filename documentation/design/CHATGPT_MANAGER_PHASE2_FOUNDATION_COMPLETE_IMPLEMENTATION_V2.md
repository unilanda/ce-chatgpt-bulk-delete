> Historical V2 draft. Implementation contracts are superseded by MANAGER_BACKBONE_V3.md and its linked storage/action/capture documents.

# Phase 2 Foundation V2 — Complete First-Draft Implementation Contract

## Status

This package contains a complete first-draft implementation against the independently reviewed Core Inventory Cleanup V1 source. Codex is not being asked to invent the feature architecture. It should integrate this patch into the current dirty worktree, independently review it, fix any mismatch, strengthen tests where warranted, and package review evidence.

## Implemented production behavior

### Provider-neutral identity
New `conversation-ref.js` provides:
- normalized provider names;
- legacy ChatGPT inventory mapping;
- safe encoded ConversationRef round-trip;
- no inventory-key migration.

### Provider capability matrix
New `provider-capabilities.js` records ChatGPT capabilities explicitly. Custom GPT remains fully usable by local non-destructive features while destructive Delete remains disabled pending live validation.

### Independent Manager metadata database
New `manager-meta-db.js` uses:

```text
ConversationManager_Meta_DB
  collections
  collection_memberships
  archive_records
```

This is deliberately provider-neutral and independent of the legacy inventory DB.

### Collection service
New `collection-service.js` implements:
- normalized names;
- case-insensitive uniqueness;
- create;
- rename API;
- list with counts;
- idempotent add membership;
- remove membership;
- list member refs;
- list Collection IDs for a conversation;
- atomic Collection + membership deletion when backed by ManagerMetaDB.

### Collection UX
Dashboard implements:
- visible Collections surface;
- create empty Collection;
- add generic selected conversations to existing Collection;
- create Collection while adding;
- Collection filter;
- remove selected from current Collection;
- local Collection deletion with explicit non-destructive confirmation;
- Collection counts;
- Custom GPT membership exactly like other conversation classifications.

### Archive registry
New `archive-registry.js` implements metadata-only archive tracking:
- current/stale/failed state;
- capture revision increment;
- source update time;
- content/normalized hashes;
- message count;
- formats;
- sanitized error code.

No full message payload is implemented in this stage.

### History button fix
The fixed 104px History-button grid column is removed. Base layout uses content-sized button width, while existing mobile media rules still collapse to one column. This avoids the previous clipped `Refresh history` label without introducing another magic width.

### Runtime identity
Use a Foundation V2 marker selected by Codex after integration, e.g.:

`ChatGPT Manager · phase2-foundation-v2 · cm-runtime-20261002-p2f2 · job schema 1`

Codex may retain the V1 marker only if it deliberately treats this as the same foundation increment; otherwise bump consistently in dashboard/service-worker/tests/docs.

## Test harness improvement already implemented

The first V1 draft warned that the actual-dashboard fake IndexedDB modeled only one DB/store. This V2 draft fixes that itself.

The harness now models:
- multiple IndexedDB database names;
- independent object stores;
- key paths;
- indexes;
- multi-store transactions;
- cursor deletion for Collection cascade;
- per-store clear counters.

New actual-dashboard tests prove:
1. both inventory and Manager metadata DBs initialize independently;
2. Standalone + Project + Custom GPT can enter one local Collection;
3. Collection data survives inventory Clear and from-zero Rebuild;
4. rediscovered inventory reconnects to retained membership;
5. deleting a Collection makes no network request and mutates no conversation inventory;
6. archive registry writes metadata only.

## Explicitly not implemented yet

- full chat capture;
- Save/Update button;
- archive payload storage;
- summaries;
- Merge;
- similarity/clustering;
- Move-to-Project;
- Firefox Manager;
- Claude provider;
- Custom-GPT deletion.

These are not missing Foundation work. They depend on the next Save Chat source handoff or separate transport validation.

## Integration principle

Codex should prefer the supplied code unless it finds a concrete bug, worktree conflict, browser incompatibility or cleaner correction that preserves the contracts. It should not replace implemented modules with a new parallel design merely because another implementation is possible.
