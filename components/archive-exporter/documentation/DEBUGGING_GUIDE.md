# Debugging Guide

## 1. Start by classifying the symptom

### “Beginning of chat missing”
Look at:
- top boundary validation;
- hydration guard;
- selected scroll root;
- reversed timeline;
- runtime visibility/background throttling;
- checkpoint comparison.

### “Wrong messages / another chat included”
Look at:
- `conversationDetection.activeScope`;
- active root source/generation;
- legacy candidates inside vs outside scope;
- redesigned groups inside vs outside scope;
- mixed representation flags.

Do not first blame checkpoint storage; it stores metadata, not message bodies.

### “Turns out of order”
Look at:
- stable IDs;
- ordering graph;
- contradictory pairs;
- cycle breaks;
- certified top vs resolved first key;
- repeated observation snapshots.

### “Assistant answer is blank / only says ChatGPT said”
Inspect redesigned `[data-turn-key]` group and `selectRedesignedAssistantNode()` assumptions.

### “Math broken”
Do not touch scanner.
Compare live KaTeX markup with exported markup/CSS.
Check whether unscoped KaTeX CSS is present and unchanged.

### “Code is one blob”
Do not touch scanner.
Inspect:
- raw `<code>` text for physical newline characters;
- whether the node is recognized by `isCurrentChatGptCodeElement`;
- shell selected by `findCurrentCodeCardShell`;
- archive CSS whitespace/overflow rules.

### “Table missing”
First determine whether the entire message/turn is missing or only table presentation is missing.
Compare Markdown and stable IDs before changing table code.

### “HTML is much larger”
Check:
- embedded diagnostics;
- SVG/icon markup;
- computed CSS mode;
- self-contained vs external-assets mode;
- debug instrumentation.
Do not infer duplicate content from file size alone.

## 2. Minimal evidence collection

For every bug:
1. export HTML;
2. export Markdown;
3. export capture report;
4. note browser and extension version;
5. capture screenshot of live vs archive around the same turn;
6. identify one exact phrase from the missing/malformed region.

## 3. Compare in this order

1. Turn count.
2. First and last semantic turn.
3. Stable ID order/fingerprint.
4. Normalized Markdown text.
5. Per-turn HTML only for suspect turns.
6. CSS/DOM presentation.

This order prevents presentation issues from being misdiagnosed as data loss.

## 4. Avoid broad fixes

Bad response to a code-card bug:
- change scroll timing;
- change turn selectors;
- change KaTeX.

Bad response to a stale-DOM contamination bug:
- rewrite Markdown;
- change table CSS;
- change code highlighting.

Good response:
- patch one proven failure mechanism;
- explicitly freeze unrelated critical functions;
- rerun both standard regressions.

## 5. Instrumentation builds

Temporary diagnostic builds are useful, but do not promote them automatically.

RC3.1-debug is the example:
- repeated-sighting instrumentation;
- semantic hash/length;
- HTML length;
- timestamp presence;
- rich-element counts.

It answered a question, then was removed before stable.

Rule:
> Instrumentation is temporary unless it has clear long-term operational value.

## 6. Debugging ChatGPT renderer changes

When ChatGPT changes:
1. inspect current DOM manually;
2. identify stable wrappers and semantic attributes;
3. check whether old and new renderers coexist;
4. check visibility and active conversation root;
5. check scroll direction/coordinates;
6. avoid brittle class-name-only selectors when semantic data attributes exist;
7. preserve fallbacks for old renderer if still useful.

## 7. Browser-specific manifest/UI bugs

Keep these outside the ChatGPT adapter.

Example:
- Firefox `version_name` warning was fixed only in Firefox manifest.

Do not touch core capture code for packaging warnings.
