# Manual Chrome smoke test

Run this checklist only after automated gates and independent review. Codex did not
perform authenticated browser calls or live deletions. All steps before “Later destructive smoke” are non-destructive when you always choose Cancel and never choose Start.

## Prove Chrome loaded Core Inventory Cleanup V1

1. Open `chrome://extensions`, locate **ChatGPT Manager**, verify its unpacked root is
   this review worktree, and choose **Reload**.
2. Fully close every previously open ChatGPT Manager dashboard tab. Refresh the
   ChatGPT tab and open a new dashboard from the injected **ChatGPT Manager** button.
3. Open **Advanced / Diagnostics** and confirm the visible marker is exactly:

       ChatGPT Manager · core-inventory-cleanup-v1 · cm-runtime-20261002-core1 · job schema 1

4. In the new dashboard DevTools Console, confirm the same marker follows
   `ChatGPT Manager dashboard:` and there is no dashboard initialization failure.
5. From the extension card, inspect the service worker Console and confirm the same
   marker follows `ChatGPT Manager service worker:`. If either marker differs, stop,
   close the dashboard, Reload the correct unpacked root, and reopen a new dashboard.

The marker contains no path, account identity, conversation ID, or authentication
material.

## Refresh, rebuild, recovery, and recent activity — no deletion

1. Set **Maximum conversations** to `10`, choose **Refresh history**, and confirm
   returned records merge into the existing local inventory rather than clearing it.
2. Choose **Rebuild from ChatGPT**. Read the confirmation: it must say only the local
   conversation list is cleared, settings/job state are preserved, no ChatGPT
   conversation is deleted, and a failure may leave partial or empty inventory.
3. Confirm and observe from-zero page-by-page repopulation. A complete run must say
   complete History rebuild. If the run stops, it must say partial/unknown (or empty
   before the first page) and must not restore the old list behind the scenes.
4. If recovery is offered, choose **Recover with content search**. Confirm the existing
   query field receives focus, no search starts automatically, and the explanation
   requires explicit terms and says matching results cannot guarantee a complete
   account inventory.
5. Open **Advanced / Diagnostics** and inspect **Clear local inventory** copy. It must
   say settings and deletion-job state are preserved. You do not need to confirm it.
6. If a completed or cancelled deletion job was already stored, confirm it appears
   under **Recent activity**, not **Active Jobs**, and no fixed job bar appears.
   Optionally choose **Dismiss**; this is local-only job-record cleanup.

No new destructive deletion is required for this cleanup smoke.

## Automatic Prepare and Review — always Cancel

Use real rows that you do not intend to delete. Do not choose **Start deletion**.

1. Select a small mix containing at least one cached verified Standalone and one
   search-discovered **Unverified** conversation. If available, include one known
   Project and one Custom GPT conversation.
2. Choose **Delete**. Confirm the modal visibly follows **1 Prepare → 2 Review →
   3 Start**, automatically verifies selected candidates sequentially, reports
   progress, and never asks you to press each row’s Verify button.
3. While Prepare is active, confirm **Cancel preparation** is available. If you test
   it, confirm the modal closes, the workspace selection remains, and no deletion job
   or deletion request starts. Choose Delete again to complete preparation.
4. In Review, confirm separate counts for Standalone, Project, Custom GPT, and
   unresolved. A 429 must stop later verification, retain completed classifications,
   and offer Retry or explicit unresolved exclusion.
5. If the current session is unavailable, start Prepare with more than one Unverified
   row and confirm it stops immediately after the first candidate, explains that the
   ChatGPT session is unavailable, leaves every unresolved row protected, and offers
   Retry. Do not deliberately invalidate a healthy session for this check; log in or
   reload ChatGPT before retrying only if the condition occurs naturally.
6. If Project conversations are present, inspect their titles and confirm the warning
   says the selected conversations are deleted but their containing Projects are not.
   Approve the complete Project subset once.
7. Confirm Custom GPT remains blocked. Exclude Custom GPT and/or unresolved as needed.
   Confirm those rows remain selected in the workspace; exclusion changes only the
   prospective job.
8. Continue to Start. Confirm included type counts, Project approval, requested delay,
   estimated minimum wait, Pause/Cancel availability, and the statement that no
   per-item prompts occur. Choose **Back** once to prove Review remains available,
   then choose **Cancel**. Do not Start.

## Prove cached verification is reused — always Cancel

1. Keep or recreate the same selection after the prior successful preparation.
2. Optionally clear the dashboard DevTools Network log and filter for read-only
   conversation-detail GETs. Do not copy or share request headers, URLs, IDs, or
   response bodies.
3. Choose **Delete** again. Previously classified rows should pass Prepare immediately
   without another detail GET; only still-unresolved candidates may be requested.
4. Confirm the same partition appears, then choose **Cancel**.

## Target timing screens — always Cancel

1. Set **Delay between deletions** to `150`. Prepare a small eligible selection and
   reach Start. Confirm the summary says **Target delay: 150 seconds**; it must not
   silently become 60. With multiple items, confirm the estimated minimum wait is
   human-readable rather than a large raw-seconds value. Choose Cancel.
2. Set the delay to `1`, prepare again, and reach Start. Confirm `1` is accepted and
   the warning says fast background timing is best-effort, Chrome may delay it if the
   worker sleeps, and the job will not double-delete. Choose Back, then Cancel.
3. Restore the conservative delay you intend to use before any later destructive
   smoke.

## Existing read-only search diagnostic

1. After Reload, open **Advanced / Diagnostics** and find **Read-only search
   diagnostic**.
2. Enter one non-sensitive query, leave **Page limit** at `1`, and choose **Run
   read-only diagnostic**.
3. Confirm the sanitized report clearly includes HTTP status, conversation result
   count, cursor-present, conversation `has_more`, and any schema warning/error.
4. Confirm it does not contain the query text, cookies, Authorization value, titles,
   conversation/message IDs, snippets, cursor value, or raw response. Use **Copy
   sanitized report** only if this privacy check passes.

## Discovery and workspace regression — no deletion

1. Load a bounded History page and run one non-sensitive Find-by-content query.
   Confirm current-run counts remain separate from total inventory and failures retain
   successful prior data without a rapid retry loop.
2. Confirm Title, Type, Updated range, and Status filters work, and select-all remains
   generic across all classifications.
3. Confirm **Clear local inventory** explains that it does not delete ChatGPT
   conversations and preserves settings/job state. Do not clear data while a
   non-terminal job exists.

## Later destructive smoke — only after independent approval

Use only explicitly disposable, independently reviewed conversations. Stop on the
first unexpected result; never use retained, unresolved, or Custom GPT conversations.

1. Create at least two disposable eligible conversations. Set the target to `150`,
   complete Prepare/Review, independently verify the exact final subset, and only then
   choose **Start deletion**.
2. Confirm only included job IDs leave workspace selection after Start; any excluded
   or unrelated selected row remains selected. While the job is active, new unrelated
   selection is allowed but another Delete action is disabled.
3. Confirm the fixed viewport bar is visible while scrolled, says **Target delay:
   150s**, and the detailed view says **150 seconds**, shows last confirmed completion,
   next target, and **Scheduler: Chrome alarm**.
4. After the first confirmed completion, confirm the countdown begins near `02:30`,
   visibly ticks to `02:29`, and may legitimately show `01:30` when 90 seconds remain.
   If Chrome wakes late, it must say **Waiting for Chrome…**, never a negative time.
5. Choose **Pause** before the next request. Confirm the user-paused UI offers direct
   **Resume**, **Review remaining**, and **Cancel remaining**. Choose direct Resume and
   confirm exactly one next step is scheduled after normal revalidation.
6. Open a second newly created dashboard tab. Confirm both dashboards show the same
   durable job and fixed-bar state. The active job must not hijack unrelated workspace
   selection.
7. In a separate disposable run, a browser restart/error/429/session/eligibility
   pause must show **Review & Resume**. Choosing it must first show the sanitized reason
   and remaining plan; only the separate **Resume deletion** confirmation may resume.
   For an interrupted request, the review must state that the remote outcome is unknown
   and that confirming Resume will attempt that conversation again.
8. After conservative timing passes, an optional disposable sub-30-second smoke may
   confirm the **Fast timer + backup alarm (best effort)** label. Do not treat unpacked
   Chrome timing as proof of packaged behavior; lateness is allowed, duplicate or early
   deletion is not.

Do not mass-delete conversations as a smoke test.


# Manager backbone V3 — new non-destructive acceptance

Use an isolated test profile or back up local metadata before an upgrade. Do not
reload while a destructive job is running. Do not clear production storage to hide
an upgrade failure. No live Delete or new provider operation is required here.

1. Reload the same unpacked root; close old Manager tabs and open a fresh dashboard.
2. Verify marker `manager-backbone-v3 · cm-runtime-20261002-mb3 · job schema 1`.
3. Select a Standalone, Project and Custom-GPT chat. Collection and Tag are available;
   Save/Analyze/Summarize/Merge/Move are disabled and their focus/hover reason appears.
4. Collection → name a new Collection → Add. It shows 3 members. Selection remains 3.
5. Tag → name a new Tag → Add. Labels appear in the table; rename the Tag.
6. Filter by Collection and Tag; remove selected membership. Rows may leave the filter
   but source chats and workspace selection are not deleted.
7. Delete the LOCAL Collection using its explicit confirmation. Tag metadata remains.
8. Open a second Manager dashboard, edit a Tag in the first, and confirm invalidation
   refreshes the second. A failure here is not equivalent to a lost committed write.
9. Only in an isolated fixture/profile, clear/rebuild inventory; verify groups persist
   with absent-member counts and reconnect when stable refs are rediscovered.
10. Projects view shows known Project chats; Archived/Needs update are honestly empty
    without real captures. Clusters remains unavailable. No fake summary or saved file.
11. Test keyboard Escape/Tab in organization modals and both wide/narrow layouts.
12. Confirm existing History/Search and Delete planning still render; Cancel, do not
    start deletion merely to test new local metadata.

Developer-native gate (local fixtures only, no credentials):
`python3 tests/browser/run_manager_backbone_smoke.py --output /tmp/manager-native-evidence`
Requires an already-authorized local Playwright/Chromium development environment.
The bundle author's container could not run this native gate. During the independent
V3 integration, it passed 24/24 checks with local Chrome 154.0.8037.57 in a fresh
synthetic context. This does not replace the installed-extension smoke above. Offline
renderer `render_manager_backbone.py` uses synthetic storage and is a different gate.
