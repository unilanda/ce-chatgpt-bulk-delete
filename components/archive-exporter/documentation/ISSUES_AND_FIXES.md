# Issues and Fixes — Why the Current Code Looks the Way It Does

This document records the historical failures that motivated current behavior. It is intentionally explicit so future cleanup/refactors do not reintroduce old bugs.

## 1. Long chats exported only currently mounted messages

**Symptom:** beginning of long conversation missing.

**Cause:** ChatGPT virtualizes history; old turns are not all mounted at once.

**Fix:** repeated upward scanning + incremental harvesting keyed by stable turn identity.

**Do not regress by:** replacing scanner with one final DOM query.

---

## 2. Scanner too slow or unreliable due to fixed sleeps

**Symptom:** unnecessarily long runs, or missed progressive load when waits were too aggressive.

**Fix evolution:** adaptive pacing:
- fast passes during progress;
- periodic slow waits;
- slow mode after stalls;
- mutation arrivals count as progress.

**Why it matters:** ChatGPT loading behavior varies by browser, machine, conversation size, and foreground/background state.

---

## 3. Browser background throttling

**Symptom:** capture slows dramatically or seems to stop when tab/window loses focus.

**Cause:** browser timer/render throttling.

**Current position:** scanner is more resilient, but the most reliable workflow is still to keep the ChatGPT tab active during very long capture.

**Not a reason to:** add fake activity, hidden automation, or unsafe browser hacks.

---

## 4. Math looked good live but broke offline

**Symptom:** equations lost layout or appeared malformed after export.

**Cause:** incomplete/scoped math CSS did not match the offline cloned markup.

**Stable fix:** complete unscoped OpenAI KaTeX CSS.

**Regression guard:** KaTeX CSS block was kept byte-for-byte identical across late RCs and stable v1.4.0.

---

## 5. New renderer assistant answer disappeared

**Symptom:** assistant export could contain only a semantic label such as `ChatGPT said:` and miss the actual response.

**Cause:** current ChatGPT can place answer content as siblings of the assistant marker within the same `[data-turn-key]` group.

**Fix:** entire `[data-turn-key]` group is the logical assistant turn; prune nested user bubble and label-only semantic nodes from the cloned archive.

**Critical function:** `selectRedesignedAssistantNode()`.

---

## 6. Reversed/negative timeline broke scroll assumptions

**Symptom:** scanner moved in the wrong direction or misidentified top/bottom.

**Cause:** redesigned ChatGPT timeline can use negative physical scroll positions.

**Fix:** logical scroll coordinate abstraction where logical zero is the oldest/top boundary.

**Do not:** read/write raw `scrollTop` throughout scanner code.

---

## 7. Reaching scroll top did not guarantee full history

**Symptom:** exporter reached apparent top but older messages appeared later.

**Cause:** progressive history hydration.

**Fix:** top hydration guard + multiple quiet rounds + retriggers + deep challenge before certification.

**Validation:** `certifiedTopBoundary` must match exported first turn.

---

## 8. Cross-conversation contamination (major RC1-era data integrity bug)

**Observed failure:** an export from a Voth coarse-graining chat began with unrelated NucleicNet/RNA-protein turns, then jumped backward chronologically into the Voth conversation.

**Initial misleading visual:** tables visible in the contaminated RC1 archive appeared “missing” in RC2.

**Investigation result:**
- those tables belonged to entire unrelated turns present only in RC1;
- common Voth turns in RC1/RC2 matched byte-for-byte;
- RC2 did not strip those tables;
- RC1 had harvested the wrong DOM content.

**Root mechanism in old code:**
- `findConversationTurns()` queried legacy selectors across the entire `document`;
- if any legacy node existed, it returned that set before inspecting redesigned groups;
- ChatGPT SPA could retain stale/hidden conversation nodes.

**v1.4.0 fix:**
- `getActiveConversationScope()`;
- active redesigned thread/timeline chosen by visibility/score;
- queries restricted to active scope;
- redesigned representation authoritative inside redesigned scope;
- legacy fallback also scope-restricted;
- scroll root and MutationObserver share the same scope.

**Regression fixture that should be added in GitHub:**
- hidden stale legacy chat A outside active scope;
- visible redesigned chat B inside active scope;
- capture must return only B.

---

## 9. Current ChatGPT code block became one unbroken blob offline

**Symptom:** source live page had correct line breaks, exported HTML displayed code as a continuous blob/unstructured block.

**Cause:** archive presentation no longer preserved current code-card semantics/CSS well enough.

**RC2 fix:**
- recognize current code-card `<code>`;
- preserve raw text whitespace/newlines;
- create static card/header;
- bounded vertical scrolling;
- horizontal overflow;
- print expansion;
- lightweight deterministic syntax highlighting.

**Regression test:** multiline JSON, Bash, Python, and unknown-language code.

---

## 10. Concern: code-card shell replacement could be too broad

During RC2 review, `findCurrentCodeCardShell()` was identified as an area that deserves caution because it climbs ancestors to find a card shell and later replaces that shell.

The user’s “missing table” screenshots did **not** prove this bug; they were caused by contaminated RC1 turns.

Still, when changing code-card detection:
- test a code block embedded near ordinary prose/tables;
- ensure only the intended card shell is replaced;
- verify surrounding siblings remain.

Treat this as a sensitive area, not as a currently confirmed stable bug.

---

## 11. Missing timestamp labels raised concern about late hydration

**Symptom:** two assistant timestamp labels seen in RC2 were absent in RC3, while message content matched.

**Hypothesis:** a small late-hydrated timestamp might be ignored by snapshot richness threshold.

**Test:** RC3.1-debug recorded repeated sightings, semantic hashes, HTML lengths, timestamp presence, and rich-element counts.

**Result:**
- no late timestamp appearances;
- no semantic variants;
- no rich variants;
- timestamps were absent on every observation for those turns.

**Conclusion:** likely current ChatGPT renderer suppression/grouping behavior, not evidence of message loss. No snapshot-threshold change was made.

---

## 12. One raw HTML variant during RC3.1

**Observation:** one assistant turn changed raw HTML size while semantic text and rich-element counts stayed identical.

**Cause:** transient UI decoration/loading-spinnner/attachment placeholder differences.

**Conclusion:** volatile UI chrome is not semantic conversation content. Stable release did not add risky cleanup just to force byte-identical transient markup.

---

## 13. Firefox manifest warning

**Warning:**
`Warning processing version_name: An unexpected property was found in the WebExtension manifest.`

**Cause:** `version_name` is Chrome-specific.

**Fix:** omit `version_name` in Firefox stable manifest; retain it in Chrome.

---

## 14. Attachment misunderstanding

The archive can preserve:
- file name;
- visible chip;
- icon/label representation.

It does not preserve the actual uploaded file bytes.

This is currently a limitation, not a capture bug.

---

## 15. Why the capture report can say “turn indexes unavailable”

The redesigned renderer may not expose the old numeric conversation-turn indexes.

This does not automatically mean incomplete capture.

The exporter validates with:
- stable IDs;
- repeated order observations;
- top certification;
- gap diagnostics;
- conversation fingerprint.

Numeric index continuity is only one possible evidence source.
