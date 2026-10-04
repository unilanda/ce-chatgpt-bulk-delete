# ChatGPT Capture Engine

## 1. The fundamental problem: virtualized history

Long ChatGPT conversations are not represented by one permanent DOM tree containing every message. Only a window of turns may be mounted. As the user scrolls, old nodes can be mounted and newer nodes recycled/unmounted.

Therefore the exporter is a **harvester over time**, not a one-shot DOM serializer.

High-level loop:

```text
detect active conversation
detect correct scroll root
collect currently mounted turns
scroll logically toward older history
wait for DOM changes
collect again
repeat
probe/certify oldest boundary
resolve order
serialize
```

## 2. Active conversation scope

### Why it exists

ChatGPT is a SPA. During navigation it can retain hidden/stale DOM belonging to a different conversation.

An earlier implementation queried legacy selectors across `document` and returned as soon as any legacy turns were found. That allowed stale nodes from another chat to suppress the active redesigned renderer.

### Stable v1.4.0 behavior

`getActiveConversationScope()`:

1. Finds candidate redesigned conversation/thread elements.
2. Scores candidates based on visibility, viewport intersection, location in `<main>`, scroll range, and turn count.
3. Finds the best timeline.
4. Chooses:
   - redesigned thread/timeline when available;
   - otherwise best active `<main>`;
   - document only as final fallback.

The same active scope must be used by:
- turn discovery;
- scroll-root selection;
- mutation observation.

If a future patch scopes only one of those, contamination can reappear indirectly.

## 3. Turn discovery and renderer arbitration

`findConversationTurns()` is renderer-aware.

### Redesigned active scope
When the active scope is redesigned:
1. collect `[data-turn-key]` groups inside the scope;
2. extract user bubble as logical user turn;
3. extract the entire group as logical assistant turn;
4. only if that fails, try legacy nodes **inside the same active scope**.

### Legacy/unknown active scope
1. collect legacy selectors inside active root;
2. if none, try redesigned groups inside that same root;
3. shadow-root fallback may be considered only afterward.

The key invariant is:

> Unrelated nodes outside the selected active conversation scope must never win renderer arbitration.

## 4. Redesigned assistant grouping

The assistant marker can be structurally separate from the rendered answer.

The stable logic:
- locates assistant semantic evidence in a `[data-turn-key]` group;
- returns the entire group as the logical assistant turn;
- later clones it;
- removes nested user bubble;
- removes label-only assistant semantic elements such as `ChatGPT said:`;
- removes action controls.

This avoids exporting only a label while losing the actual answer.

## 5. Reversed timeline normalization

The redesigned timeline can use negative physical scroll coordinates.

`createScrollPosition()` and `getScrollPositionModel()` normalize the timeline to logical coordinates:

```text
logical 0   = oldest/top
logical max = newest/bottom
```

Scanner code should use logical helpers, not direct assumptions about physical `scrollTop`.

When debugging:
- record physical scrollTop;
- record logical position;
- record scroll range;
- record whether the model is reversed.

## 6. Collection and identity

Each mounted logical turn is converted into an entry with:
- role;
- stable ID;
- text;
- cleaned/static HTML;
- pass/dom-order provenance;
- content signature.

Stable IDs are essential because DOM nodes themselves are recycled.

Do not key conversation state only by node identity or current DOM index.

## 7. MutationObserver

Long history can hydrate between normal scanner passes.

The MutationObserver catches:
- newly mounted turns;
- potentially richer snapshots.

In v1.4.0 the observer is attached to the active conversation scope/root, not the whole SPA document.

That scoping is part of the stale-DOM contamination fix.

## 8. Snapshot signatures and richer replacement

A logical turn may be observed repeatedly.

`makeTurnCaptureSignature()` tracks:
- text character count;
- direct element count;
- narrow rich-element count (`pre`, `code`, `table`, `blockquote`, `details`, `[role='table']`).

`signatureDiffersMeaningfully()` currently considers:
- text delta >= 24 chars;
- element delta >= 3;
- rich-element delta >= 1.

`signatureIsClearlyRicher()` is stricter about actually replacing the saved snapshot.

There is also a fast downgrade path that avoids expensive descendant scanning when current text is provably shorter than the richest saved snapshot.

### Important historical result

RC3.1 instrumentation repeatedly observed the final Voth conversation and found no semantic or rich-content late variants. Timestamp differences between earlier runs were not caused by a rejected small late snapshot.

Do not lower thresholds merely because a timestamp label differs across ChatGPT renderer states.

## 9. Gap guard

Virtualized scrolling can jump enough that adjacent mounted windows have little/no overlap.

`handleSuspiciousGap()` checks transitions and, in repair mode, can perform recovery attempts.

The capture report records:
- transitions checked;
- zero-overlap suspicions;
- recovery attempts;
- recovered/unresolved gaps.

Stable final Voth run had zero unresolved gaps.

## 10. Adaptive pacing

Browser/SPA loading speed varies.

The scanner combines:
- fast waits during normal progress;
- periodic slow waits;
- adaptive slow mode after stalls;
- mutation-based progress awareness.

Do not return to fixed long sleeps everywhere; that made captures unnecessarily slow. Do not remove slow fallback either; that made progressive history unreliable.

Background tabs may be throttled by the browser, so active/focused capture is still recommended.

## 11. Apparent top vs certified top

An apparent top can be only the top of currently hydrated history.

The stable process uses:
- redesigned top hydration guard;
- multiple quiet validation rounds;
- retriggers;
- a deep challenge;
- certification of the first stable turn.

The archive report stores:
- `certifiedTopBoundary`;
- `exportedFirstMatchesCertifiedTop`;
- top validation diagnostics.

A long-chat result should not be called complete merely because one scroll command stopped moving.

## 12. Ordering without exposed turn indexes

Current redesigned ChatGPT may not expose reliable numeric turn indexes.

The exporter therefore accumulates repeated order observations and resolves a graph/order relation.

Important report fields include:
- `majorityEdges`;
- `contradictoryPairs`;
- `cycleBreaks`;
- `ambiguousChoiceSteps`;
- `fallbackSelections`;
- certified/resolved first key.

For the final Voth regression:
- no contradictory pairs;
- no cycle breaks;
- first resolved key matched certified top.

Ambiguous choices alone are not necessarily an error when numeric indexes are unavailable; contradictions/cycles and wrong boundaries are more concerning.

## 13. Checkpoint validation

Checkpoint data can tell the exporter:
- a previously known first stable turn;
- previous maximum turns/text.

It is validation context across runs.

It must never become a source of archived message content.

## 14. Capture report is part of the product

When a bug report arrives, always request:
- `capture_report.json`;
- exported `.md`;
- exported `.html`;
- ideally source screenshot around the failure.

The report should be read before changing scan behavior. It can distinguish:
- wrong active scope;
- top not stabilized;
- gaps;
- ordering contradictions;
- rich snapshot upgrades;
- hidden-tab stalls;
- renderer generation.
