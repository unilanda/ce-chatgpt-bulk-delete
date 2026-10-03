# ChatGPT Manager — UX / Human-Engineering Specification

## Objective

Normal UI describes user goals, not protocol internals.

Workflow:
**Discover → filter → select conversations → choose an action**

Protocol diagnostics, cursors, gizmo IDs, raw sync counters and developer concepts
belong under collapsed Advanced / Diagnostics.

## Product identity

Visible name: **ChatGPT Manager**.

Remove visible "Steve's Tools", "ChatGPT Bulk Delete", and prior-author
branding/attribution. No author line is needed. Change extension display name to
ChatGPT Manager. Do not rename repository/folders yet.

## Page hierarchy

1. Header
2. Discover conversations
3. Conversation workspace
4. Selection/action bar
5. Advanced / Diagnostics (collapsed)
6. transient progress/status

Avoid multiple equally prominent technical boxes.

## Header

Example:
ChatGPT Manager
Manage, find and act on your ChatGPT conversations.
[Load history] [Advanced ▾]

Keep copy concise.

## Discover conversations

One coherent area with two methods.

### History
Purpose: "Load or refresh your conversation history, newest first."

Controls:
Maximum conversations [All / numeric]
[Load history]

Do not use ambiguous "Max to sync (blank = all)" wording.

Status must separate current-run results from total local inventory, e.g.:
"History loaded — 20 fetched · 4 updated · 16 unchanged"
"427 conversations in local inventory"

For partial 429:
"History partially loaded. 40 conversations were fetched before ChatGPT temporarily
stopped responding. Your existing conversations were kept. [Retry later]"

No protocol jargon.

### Find by content
Purpose: "Find conversations containing words or phrases."

Input + [Find conversations].
Search is a first-class feature, not described merely as fallback.
Normal result can say "427 matching conversations found for 'rna'".
Technical pages/hits/inserted/skipped belong in details/Advanced.

## Conversation workspace

This is the main surface.

Header:
"427 conversations"
title search/filter, Type, Updated range, Status. Project filter later when names
are available.

Rows:
checkbox | linked title | Type | Updated | minimal contextual status/actions

Normal type labels:
Standalone / Project / Custom GPT / Unverified

Do not repeat the lowercase normalized title under the real title unless it has a
clear user purpose.

## Generic selection

Checkbox means generic selection.

Show "N selected". Delete is currently the only active action.

Future actions are Save, Project, Export/Merge, but do not clutter the UI with fake
functionality. Architecture/docs carry the future contract.

Never say "selected for deletion".

Select All/Deselect All semantics must be clear. Action eligibility is checked by
the action, not assumed by selection.

## Verification

Do not expose "Lazy eligibility verification" as a primary top-level concept.
Search-discovered rows needing evidence may show "Unverified" and a concise "Verify"
action. Batch verification/diagnostics may live under Advanced.

## Delete action

Delete acts on generic selection. Prefer confirmation UI:
"Delete 3 conversations?"
"This permanently deletes the selected standalone conversations from ChatGPT."
Delay between deletions [600] seconds.
"ChatGPT may temporarily rate-limit repeated requests. Deletion stops if a request
fails."
[Cancel] [Delete 3 conversations]

Progress:
"1 of 3 deleted — Next deletion in 09:42 — [Stop]"

Failure clearly says remaining conversations were not removed locally.

Avoid a dominant Delete button on every row if the selected-action flow can replace
it safely.

## Advanced / Diagnostics

Collapsed by default. Put protocol diagnostic, eligibility evidence diagnostic,
history diagnostic, raw sync details and developer repair controls here.

Normal usage must not require opening it.

## Clear local data

Rename ambiguous "Clear Data" to "Clear local manager data".
Explain: removes manager's local index/settings; does NOT delete ChatGPT
conversations. Require confirmation.

## Readability/accessibility

Short labels/help text, grouped controls, obvious primary action, no giant
explanatory paragraphs, no color-only safety state, semantic labels/keyboard access,
and avoid many per-row buttons.

## Visual smoke

Codex must provide explicit before/after expectations:
page-load hierarchy; Advanced collapsed; History status; Search status; selected
action bar; type labels; partial 429 state; delete confirmation/progress without
performing real deletion.
