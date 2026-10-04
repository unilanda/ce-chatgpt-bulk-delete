# Regression Testing

## 1. Required release gates

Every ChatGPT-facing release should pass at least these two tests.

### Test A — Long virtualized redesigned conversation

Use a known long conversation with many large assistant turns.

For the established Voth regression, expected stable baseline was:
- 40 turns;
- first user message: `read voth book and core papers. say when ready`;
- correct chronology through the tutorial;
- no unrelated NucleicNet/VN-EGNN content;
- clean `captureStatus`;
- `rerunRecommended = false`;
- certified top matches exported first turn;
- no unresolved gaps;
- no contradictory pairs;
- no cycle breaks.

Also inspect:
- active scope source/generation;
- selected scroll element;
- reversed timeline flag;
- runtime visibility/stalls.

### Test B — Rich content smoke

Create/keep a tiny chat containing:
- Markdown table;
- multiline JSON code card;
- another language code block if convenient;
- display equation and inline equation;
- attachment chip;
- normal prose before and after each rich block.

Verify HTML visually:
- table is intact;
- code whitespace/indentation exact;
- code has usable scroll behavior;
- equation looks correct;
- attachment chip does not break neighboring text.

Verify Markdown:
- all turns present;
- prose preserved;
- code/text recognizable.

## 2. Synthetic DOM tests strongly recommended for GitHub

The current stable build relied heavily on real-page regression testing. The next development phase should add deterministic fixtures.

### Fixture 1 — stale legacy + active redesigned

DOM contains:
- hidden/outside-scope legacy conversation A;
- visible active redesigned conversation B.

Expected:
- `getActiveConversationScope()` chooses B;
- `findConversationTurns()` returns only B.

### Fixture 2 — redesigned assistant marker split

One `[data-turn-key]` group contains:
- user bubble;
- assistant marker text `ChatGPT said:`;
- answer content in sibling subtree.

Expected:
- one user turn;
- one assistant turn;
- assistant archive contains answer;
- assistant archive does not duplicate user bubble or label-only marker.

### Fixture 3 — reversed timeline

Mock scroll element accepts negative physical `scrollTop`.

Expected logical model:
- logical oldest = 0;
- logical newest = max;
- moving logically upward requests older content.

### Fixture 4 — late richer snapshot

Same stable ID observed twice:
1. plain partial text;
2. later text plus table/code.

Expected:
- later clearly richer snapshot replaces earlier;
- downgrade cannot replace richer snapshot afterward.

### Fixture 5 — code shell containment

Code card nested near prose/table.

Expected:
- staticization replaces only intended card;
- surrounding siblings survive.

### Fixture 6 — KaTeX

Archive representative KaTeX markup with stable CSS.

Expected:
- visual structure retained;
- CSS remains unscoped enough to apply.

## 3. Static validation

Before packaging:
- `node --check` every JavaScript file;
- parse both manifests as JSON;
- test ZIP/XPI integrity;
- verify Firefox has no `version_name`;
- verify Chrome user-facing `version_name` if desired;
- compare critical function hashes/diffs against previous stable when change scope is narrow.

## 4. Cross-browser parity

For a ChatGPT core change:
- run Chrome smoke;
- run Firefox smoke;
- compare `adapters/chatgpt_exporter.js` logic or function hashes;
- document any intentional divergence.

## 5. Failure archive contract

When a future run fails, do not discard evidence.

Save/upload:
- HTML;
- Markdown;
- `capture_report.json`;
- screenshot(s);
- extension version;
- browser/version;
- whether tab was focused;
- source conversation URL if safe/appropriate.

This diagnostic bundle is usually enough to determine whether the bug is acquisition or presentation.

## 6. Stable v1.4.0 final evidence

The final stable long-chat report recorded:
- exporter version `1.4.0`;
- 40 turns;
- clean status;
- top stabilized;
- gap guard with zero unresolved gaps;
- active redesigned timeline scope;
- no warning.

The separate rich-content smoke was manually reported as good by the user.

Treat this as the release baseline.
