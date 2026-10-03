# ChatGPT Manager — Core Inventory / Job UX Cleanup V1

## Status

This is a bounded cleanup increment after Delete Workflow V2 Repair 1 and before the
larger Archive / Save / Collections / Analysis architecture.

It intentionally does **not** add Save, Archive, clustering, summarization, merge,
Firefox, Claude, or Move-to-Project behavior.

The purpose is to make the current inventory lifecycle and terminal-job UX trustworthy
before higher-level features depend on them.

---

## 1. Current local-state boundary

The current implementation has distinct local state that should no longer be described
as one undifferentiated "manager data" bucket:

1. **Conversation inventory** — IndexedDB `conversations` store.
2. **Manager settings** — e.g. deletion interval in `chrome.storage.local`.
3. **Durable DeleteJob state** — `chatgpt_manager_active_delete_job_v1` in
   `chrome.storage.local`.
4. **Future archive/capture stores** — not implemented yet, but the APIs introduced
   now must not assume that "clear inventory" means "delete the entire database".

The old Advanced action labelled `Clear local manager data` was misleading: in the
reviewed Repair-1 source it cleared the conversation store and reset the delete-delay
setting, while the durable DeleteJob was separate.

V1 cleanup should make the boundary explicit.

---

## 2. Two different History operations

The UI must distinguish **Refresh** from **Rebuild**.

### 2.1 Refresh history

Purpose: normal everyday synchronization.

Behavior:

- obeys `Maximum conversations` (`10`, `20`, `All`, etc.);
- merges/upserts returned History records into existing local inventory;
- preserves stronger canonical evidence according to the existing conversation policy;
- does not clear inventory before the request;
- persists successful pages immediately;
- if a later page fails/429s, keeps prior local inventory and every page already
  persisted;
- only an unlimited run that truly reaches remote end may perform the existing stale
  History-record pruning.

Preferred button text: **Refresh history**.

The top shortcut button should use the same language.

### 2.2 Rebuild from ChatGPT

Purpose: explicit user-requested resync from zero.

Preferred button: **Rebuild from ChatGPT**.

This is deliberately different from Refresh:

1. refuse to run while a non-terminal DeleteJob exists;
2. ask for explicit confirmation;
3. clear **only the local conversation inventory**;
4. preserve Manager settings;
5. preserve durable deletion-job state (terminal job may remain as Recent activity);
6. preserve future archive/capture stores by construction;
7. start History at offset 0 with `maximum = All`;
8. persist every successful page immediately;
9. if History later fails/429s, keep the successfully rebuilt partial inventory;
10. report honestly that coverage is partial/unknown;
11. never automatically invent a Search query as a substitute for full History.

Confirmation copy should explicitly say that no ChatGPT conversation is deleted and
that a failed remote History run can leave a partial or empty rebuilt inventory.

---

## 3. Conservative rebuild pagination

Live observation showed that the normal `All` path using a 20-record History request
could fail while a 10-record History request succeeded.

The first-draft implementation therefore uses a conservative rebuild policy:

- page size: **10**;
- inter-page pacing: **500 ms**;
- no hidden destructive retry loop;
- stop on 429 and preserve `Retry-After`;
- successful pages remain persisted.

These numbers are a conservative UX heuristic, **not a claim about a guaranteed safe
ChatGPT rate**. Codex may polish the internal implementation if necessary, but it must
preserve the key contract: smaller bounded pages, bounded pacing, no hammering, and
partial persistence.

Normal Refresh behavior can keep its existing default History page size unless there
is a concrete integration reason to share the conservative setting.

---

## 4. Failure semantics for a true rebuild

Because the user explicitly asked to discard the previous local list and regenerate
from zero, a confirmed Rebuild clears inventory before remote enumeration.

Therefore:

### First page fails

Truthful result:

> Inventory rebuild failed before any conversation was loaded. The local inventory is
> empty.

Offer retry and **Recover with content search**.

Do not restore the pre-rebuild inventory behind the user's back.

### Some pages succeed, later page fails

Example:

> Inventory rebuild is partial — 30 conversations loaded. ChatGPT temporarily
> rate-limited History.

Those 30 records remain available immediately.

Do not prune them and do not represent them as a complete account inventory.

### Reaches remote end

Report complete History rebuild and the resulting local count.

---

## 5. Recover with content search

Search remains a query-driven recovery/discovery mechanism, not a full enumerator.

When History Refresh/Rebuild stops partially or fails, reveal:

**Recover with content search**

Clicking it should:

- bring/focus the existing `Find by content` query field;
- explain that one or more explicit words/phrases are required;
- explain that Search will add matching chats to the local inventory;
- explicitly state that Search cannot guarantee complete account coverage.

It must **not** silently run a guessed blank/wildcard query.

Search results continue to merge into the canonical inventory using the existing
Search Sync contract.

---

## 6. Advanced clear-local action

Rename the misleading action to:

**Clear local conversation inventory** / **Clear local inventory**

New semantics:

- clear only the conversation IndexedDB store;
- preserve settings;
- preserve DeleteJob storage;
- preserve future archive/capture storage;
- never touch ChatGPT remotely;
- refuse while a non-terminal DeleteJob exists.

This becomes a low-level repair/maintenance action. Normal users should use **Rebuild
from ChatGPT** for a clean resync.

---

## 7. Terminal DeleteJob UX

`Active Jobs` must mean active/non-terminal work.

### Non-terminal states

Continue to render under **Active Jobs** and in the fixed viewport bar according to
existing V2/Repair-1 behavior.

### Terminal states

`completed` and `cancelled` must no longer remain under `Active Jobs`.

Render one compact **Recent activity** / last-job card instead.

Examples:

```text
Recent activity

Deletion complete
48 / 48 deleted
Finished: 21:37:28 · Target delay: 150 seconds
[Dismiss]
```

or

```text
Deletion cancelled
9 deleted · 39 not deleted
Finished: ...
[Dismiss]
```

The fixed job bar remains hidden for terminal jobs.

### Dismiss

Dismiss is local-only cleanup of the persisted terminal DeleteJob record.

Rules:

- only `completed` or `cancelled` may be dismissed;
- a non-terminal job must fail closed with `job_not_terminal`;
- Dismiss performs no remote request;
- Dismiss does not affect conversation inventory;
- Dismiss does not undo completed deletions;
- a future job may replace a terminal job even if the user never dismisses it.

Do not add job-history persistence in this increment; `Recent activity` represents the
single retained terminal DeleteJob only.

---

## 8. Existing Delete V2 behavior to preserve

Do not regress:

- Select → Delete → automatic bulk verification → Review → Project approval if needed
  → Start.
- No manual Verify prerequisite.
- Selected Unverified conversations may resolve to Standalone/Project/Custom GPT.
- Project discovery leads to one Review approval before Start.
- Custom GPT remains blocked until separately validated.
- Active-job membership is separate from generic workspace selection after Start.
- background-only destructive executor;
- server-success-before-local-removal;
- durable pause/recovery semantics from Repair 1.

This cleanup increment is not a reason to rewrite the Delete state machine.

---

## 9. Future architecture constraints

This is still the Chrome + ChatGPT implementation, but the next major phase will add
shared capture/archive infrastructure and later Firefox / Claude adapters.

Therefore:

- inventory clearing must target a named conversation inventory store, not delete all
  extension-origin storage;
- do not couple Rebuild to future archive payload deletion;
- Search recovery should remain a provider-specific discovery action behind a small
  boundary rather than contaminating future archive/analysis logic;
- `Recent activity` should remain action/job UI, not conversation metadata.

No large provider/browser abstraction is required in this bounded increment.

---

## 10. First-draft implementation prepared in ChatGPT

The accompanying patch was drafted against the exact independently reviewed source
from:

`chatgpt_manager_delete_workflow_v2_repair1_review_20261002_135522.zip`

It implements the design above as a starting point, including:

- `inventory-resync.js`;
- optional History page-size/pacing parameters;
- Refresh/Rebuild/Search-recovery UI;
- truthful Advanced clear-local behavior;
- Recent activity terminal-job rendering;
- terminal-job Dismiss command/controller/client path;
- runtime marker bump;
- unit/regression tests.

The patch is **not** an instruction to overwrite blindly. Codex must reconcile it with
the current dirty worktree, independently review the design, strengthen actual-dashboard
coverage, and correct anything that is weaker than the existing architecture.

Draft verification against the reviewed Repair-1 source:

- full Node suite: **326 passed, 0 failed**;
- JavaScript syntax check: passed for all maintained/test JS;
- `git diff --check`: passed.

---

## 11. Acceptance criteria

The increment is accepted only when all of the following hold:

1. UI clearly distinguishes Refresh vs Rebuild.
2. Rebuild clears conversation inventory only.
3. Settings and job state survive Rebuild.
4. Rebuild starts at History offset 0 and seeks remote end.
5. Every successful page is visible/persisted before later pages finish.
6. Later 429 leaves a partial rebuilt inventory, never zeroes successful pages.
7. First-page failure honestly leaves the intentionally cleared inventory empty.
8. Search recovery is explicit/query-driven and does not claim completeness.
9. Completed/cancelled jobs are not displayed under Active Jobs.
10. Terminal job can be dismissed locally; non-terminal job cannot.
11. No new host permissions or Chrome permissions.
12. No new ChatGPT endpoint.
13. No destructive live action from Codex.
14. All Delete V2 / Repair-1 regression tests remain green.
