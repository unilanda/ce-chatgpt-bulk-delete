# Conversation management backbone V3 — design brief

## Authority and baseline
This implements the user's approved additive architecture. Baseline is the reviewed
Core Inventory Cleanup source ZIP (SHA-256
`ce514eaa8b1122cb11924ef61f659f851cb071319c5503c90d08bec12f94c1a5`).
The earlier Phase-2 V2 ZIP is a draft patch, not an integrated repository checkpoint.
This patch supersedes it and retains its Collections UI/dual-database harness where
sound. No code touches the user's workstation or remote repository here.

## Decisions
Keep the existing inventory IndexedDB, remote transports, auth, alarms and DeleteJob
schema/executor unchanged. Add domain services in classic-script/CommonJS modules,
matching this small extension. Browser/provider adapters are peer dependencies of
services, not a chain through which every existing request must be rewritten.

Metadata lives in `ConversationManager_Meta_DB` version 2. Collections and Tags are
functional. Archive revisions, Artifact provenance, Relationships and Clusters have
real repositories, validation and tests but no fabricated capture/AI producers.
Every future action is shown disabled with an honest implementation reason; an
archive's existence alone never enables a missing summarizer or capture engine.

All new metadata writes settle on transaction completion. Parent checks, membership
updates, cascade deletion, archive head/revision writes and artifact/source writes
are atomic. No fetch, crypto computation, timers or arbitrary external await occurs
inside a metadata transaction. Cross-dashboard metadata notifications occur only
after commit. Version-change closes old DB connections; blocked upgrades fail visibly
rather than wiping data. Prior v1 Collection/Archive metadata is retained; unproven
legacy archive receipts are not promoted to complete saved content.

Canonical refs are `provider:percent-encoded-provider-id`. Parsing is strict and
round-trips exactly. Existing inventory keys are not migrated. Multi-account session
isolation is not introduced into the old inventory by this change; new capture and
analysis integrations must bind source context before enabling account operations.
The reference format is provider-neutral, not a promise of account synchronization.

Archive capture state, latest attempt and freshness are separate. Captured snapshots
are immutable and include normalized source timestamps, capture scope/branch,
normalizer/capture versions, hashes, count and committed payload references. A failed
update retains the last good snapshot. A timestamp equality is only metadata-based
freshness evidence, not proof that the server content was inspected. No content in
chrome.storage.local; payload store implementations remain adapters for the Save
handoff. Capture completeness is explicit, and partial/unknown captures cannot
satisfy analysis prerequisites.

Artifacts pin source revision/hash/scope and producer identity/version. Ready artifacts
require real sources and a payload reference. Source records are immutable; freshness
is evaluated against current heads/observations. Missing inventory after a rebuild is
unknown, not proof of remote deletion. Semantic merges are never advertised as
provably lossless: only raw/source-preserving exports can make that guarantee.

Relationships are assertions with evidence and optional confidence, never deletion
instructions. Symmetric relations canonicalize endpoints; supersedes/branch_of remain
directed. Clusters are analytical outputs, Collections curated, Tags labels, Projects
provider-owned. No AI relationship is inferred by a metadata write.

Actions have one static registry and availability/prerequisite planner. Local
Collection/Tag actions are executable now. Delete delegates to the existing wizard;
new metadata failure must not disable existing history/delete functionality. Future
Summarize/Merge/Analyze/Move/Capture return explicit unsupported states until real
handlers and provider/browser capabilities are installed.

Capture orchestration is implemented against injected dependencies and tested with
synthetic engines only. Current-tab mode never closes/navigates a user tab. Managed
tab leases close only tabs created by this run, after identity/readiness checks,
capture and durable payload+metadata commit. Navigation/focus loss/cancel/worker
restart is not capture success. No engine means no tab or network side effect.
No scheduler or persistent CaptureJob is wired into production yet. The future job
host must journal/checkpoint capture phases before enabling the Save action.

UI: retain Discover, active/recent jobs and current workspace. Add compact organization
controls, Collections/Tags, view filter, archive status and visible disabled future
actions. Preserve generic selection and existing Delete transfer. The user can manage
local groups containing Project/Custom-GPT/Standalone/Unverified records. Empty and
unavailable states tell the truth. All data-derived text is escaped/textContent.

## Detailed specifications
- [Storage and provenance](MANAGER_BACKBONE_V3_STORAGE.md)
- [Actions, UX and flows](MANAGER_BACKBONE_V3_ACTIONS_UX.md)
- [Capture/provider/browser interfaces](MANAGER_BACKBONE_V3_CAPTURE.md)
- [Module map and implementation status](../development/MANAGER_BACKBONE_V3_IMPLEMENTATION.md)

## Public API facts checked for this implementation
The transaction boundary follows MDN's `IDBTransaction.complete` contract. Metadata
upgrade handling follows its IndexedDB versionchange/blocked guidance. The tab
facade follows Chrome's Tabs API; it does not assume creating/activating a tab grants
all script/download permissions. Firefox's background execution differs from Chrome
service workers; its adapter remains a separate later implementation. These external
documents inform new contracts, not claims about undocumented provider endpoints.

- https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event
- https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB
- https://developer.chrome.com/docs/extensions/reference/api/tabs
- https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background

Checked 2026-10-02. No new private provider endpoint was researched or called.
