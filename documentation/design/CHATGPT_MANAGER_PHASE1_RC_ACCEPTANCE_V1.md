# ChatGPT Manager — Phase 1 Release-Candidate Acceptance Contract

## Scope

This document closes the current Phase 1 foundation only.

Phase 1 provides:
- broad History/Recent inventory;
- content-query discovery;
- canonical inventory merge/deduplication;
- Standalone / Project / Custom GPT / Unverified classification;
- generic conversation selection;
- Delete as the sole implemented action;
- safe verification and deletion boundaries;
- human-oriented ChatGPT Manager UX.

Phase 2 capabilities such as Save, archive/update, Project mutation, Export/Merge,
multi-chat summary/preparation, Firefox packaging, and repository restructuring are
explicitly out of scope for this release-candidate repair.

## Live smoke evidence already passed

### History
With local inventory already populated, user entered maximum `20` and clicked Load
history.

Observed:
- `20 fetched`
- `1 added`
- `6 updated`
- `13 unchanged`
- total local inventory changed from 452 to 453

Accounting invariant:
`1 + 6 + 13 = 20`

Interpretation:
- `20 fetched` describes only the current refresh;
- `453 local inventory` describes the persistent union accumulated across prior
  History/Search observations;
- a newly added ID is not inherently a duplicate or bug merely because no new chat
  was consciously created: Search queries are not complete account enumeration.

History maximum semantics therefore passed live smoke.

### Search
Query `rna`:
- first rerun: 427 unique, 0 inserted, 4 updated, 423 skipped
- second rerun: 427 unique, 0 inserted, 0 updated, 427 skipped

This passed live idempotence/deduplication smoke.

### Classification
Live inventory visibly contains:
- known Project conversations classified Project;
- known standalone conversations classified Standalone;
- Search-only/insufficient-evidence records classified Unverified.

Verification action was manually confirmed to work.

### Generic selection
Select, deselect and deselect-all were manually confirmed to work.

### UX
The redesigned Discover + Conversations workspace was manually judged clear and
substantially improved.

## Known defect

The `Advanced` control appears to do nothing in the live browser.

This is the primary runtime defect to repair.

## Required RC invariants

### Advanced
- collapsed by default;
- clicking expands the diagnostics area;
- clicking again collapses it;
- state/ARIA semantics are coherent;
- keyboard activation works through normal button semantics;
- diagnostics are not required for ordinary workflow.

### History accounting
For a completed run:
`added + updated + unchanged == fetched`
unless an explicitly documented additional outcome category exists.

For a partial run, counters must describe only successfully processed observations
and partial state must be explicit.

Repeated History observations of the same `conversation_id` must update/skip rather
than create duplicate canonical records.

### Delete preflight
Selection is generic and may contain any type.

Delete action must independently reject unsafe mixed selections before any remote
delete request.

At minimum:
- Standalone-safe only selection may proceed to confirmation;
- Project in selection => no deletion transport;
- Custom GPT in selection => no deletion transport;
- Unverified/unknown in selection => no deletion transport;
- stale eligibility is rechecked at execution boundary.

All-or-nothing preflight is preferred for the current Delete action: do not silently
delete only the safe subset of a mixed selection.

### History 429
Mocked later-page 429 must:
- preserve prior inventory;
- preserve successful pages from the current run;
- report partial state;
- not interpret 429 as end-of-history;
- not prune unseen History records;
- not hammer retries;
- preserve Retry-After information when available.

### Unverified wording
Normal UI should communicate:
`Type not confirmed yet. Verify before destructive actions.`

Avoid protocol jargon in the main workspace.

## Destructive smoke gate

NO real deletion belongs in this Codex stage.

After independent review of the RC package, the next manual destructive smoke will
use exactly one explicitly disposable, verified Standalone conversation.

Success criteria for that later smoke:
1. record is verified Standalone before selection;
2. confirmation identifies exactly one conversation;
3. only one remote delete request is made;
4. local record is removed only after confirmed remote success;
5. conversation is actually absent from ChatGPT afterward;
6. failure/non-2xx would instead preserve the local record and stop.

## Future direction retained

After Phase 1 passes destructive smoke and is checkpointed:
1. commit/push/merge;
2. rename repository/root to `chatgpt-manager`;
3. establish future Chrome/Firefox layout (`ce-chatgpt-manager`,
   `fe-chatgpt-manager`) with shared core;
4. ingest/review the existing Save Chat Chrome/Firefox extension;
5. implement Phase 2 on top of the generic Discover → Inventory → Filter → Select →
   Action architecture.
