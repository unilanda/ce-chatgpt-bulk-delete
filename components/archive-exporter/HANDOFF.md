# ChatGPT Archive Exporter v1.4.0 — Development Handoff

**Status:** stable v1.4.0  
**Primary purpose:** preserve long ChatGPT conversations locally as HTML, Markdown, and TXT while surviving ChatGPT virtualization/progressive history loading and keeping math/rich content readable offline.  
**Secondary adapters:** Gemini and generic webpages.

This handoff is intended for the next ChatGPT session, Codex agent, or human developer taking the project into GitHub. Read this file first, then `documentation/README.md`.

## 1. Current stable baseline

The stable release is **v1.4.0**.

Platform manifests:

- Chrome: internal manifest `version = 1.4.0.9`, user-facing `version_name = 1.4.0`.
  - The internal build number is intentionally higher than the RC builds so Chrome/Web Store upgrades remain monotonic.
- Firefox: manifest `version = 1.4.0`.
  - Firefox deliberately has **no `version_name`** because Firefox warns that it is an unexpected WebExtension manifest property.

The runtime source in the documented packages is the same stable runtime that passed the final smoke tests. The added `documentation/` folder is non-runtime documentation. Do not treat the documentation packaging as a new functional release.

## 2. Final validation state

The final long-chat regression used the Voth tutorial conversation.

Expected and observed baseline:

- 40 captured turns.
- Correct first turn: `read voth book and core papers. say when ready`.
- Clean capture status.
- Certified top boundary matched exported first turn.
- No unresolved gaps.
- No contradictory ordering pairs or cycle breaks.
- No rerun warning.
- Active redesigned ChatGPT conversation scope selected.
- No cross-conversation contamination.
- A separate rich-content smoke containing a table, JSON/code block, equation, and attachment chip rendered correctly.

Attachment note: the archive preserves the visible attachment chip/name/icon. It does **not** package the underlying uploaded file itself.

## 3. Most important architectural invariant

**Never mix acquisition fixes with presentation fixes unless a regression proves both are involved.**

There are two different systems inside the ChatGPT adapter:

1. **Acquisition / completeness**
   - conversation root selection;
   - renderer detection;
   - scroll-root detection;
   - virtualized upward scanning;
   - mutation observation;
   - top certification;
   - gap repair;
   - turn identity/order;
   - snapshot richness.

2. **Archive presentation**
   - clone cleanup;
   - KaTeX/math styling;
   - code-card staticization;
   - writing/output blocks;
   - table preservation;
   - Markdown/TXT extraction;
   - offline CSS.

The project was repeatedly stabilized by changing only the layer that was actually broken. Continue that discipline.

## 4. Critical functions: change only with a targeted regression test

In `adapters/chatgpt_exporter.js`, the most sensitive functions are:

### Acquisition
- `getActiveConversationScope`
- `findMainScrollElement`
- `findConversationTurns`
- `selectRedesignedAssistantNode`
- `detectRole`
- `detectStableId`
- `getBestMessageContentNode`
- `makeTurnCaptureSignature`
- `signatureDiffersMeaningfully`
- `signatureIsClearlyRicher`
- `collectVisibleTurns`
- `makeEntryFromTurn`
- `fastScanUpward`
- `handleSuspiciousGap`
- `guardRedesignedTopHydration`
- `probeApparentTop`

### Presentation / cloning
- `cleanCloneForArchive`
- `isCurrentChatGptCodeElement`
- `findCurrentCodeCardShell`
- `currentCodeCardLabel`
- `highlightCodeTextForArchive`
- `staticizeCurrentCodeCards`

Do not casually “simplify” these. Several exist because ChatGPT changed its renderer in ways that broke older assumptions.

## 5. The major bugs already solved

### A. Virtualized conversation history
ChatGPT does not keep the full conversation DOM mounted at once. The exporter must scroll upward and harvest turns as they become mounted.

**Do not replace this with one final `querySelectorAll` pass.**

### B. Redesigned reversed timeline
Current ChatGPT can use a reversed/negative scroll coordinate system. The exporter normalizes it so logical:

- `0 = oldest/top`
- `max = newest/bottom`

Do not assume physical `scrollTop = 0` means oldest history.

### C. Progressive top hydration
Reaching the apparent top is not enough. ChatGPT can load older history after a delay.

The exporter performs top validation / retriggers / a deep challenge and only certifies the top after quiet rounds.

### D. Redesigned assistant turn split
In the redesigned renderer, the semantic assistant marker can contain only a label such as `ChatGPT said:` while the actual answer is a sibling inside the same stable `[data-turn-key]` group.

Therefore the **whole `[data-turn-key]` group is the logical assistant turn**. `selectRedesignedAssistantNode()` intentionally returns the group, and the archive clone prunes the embedded user subtree and label-only assistant markers.

Do not revert to exporting only `[data-conversation-role="assistant"]`.

### E. Cross-conversation / stale SPA DOM contamination
A serious RC1-era failure captured unrelated NucleicNet/VN-EGNN messages into a Voth conversation.

Cause: document-wide legacy selectors could find stale hidden nodes left mounted by ChatGPT's SPA and return them before the active redesigned renderer was considered.

v1.4.0 fix:

- detect the **active conversation scope** first;
- prefer the visible redesigned thread/timeline;
- query turns only inside that scope;
- legacy fallback is also scoped;
- scroll-root selection and MutationObserver use the same scope.

This is why `getActiveConversationScope()` and scope-aware `findConversationTurns()` are release-critical.

### F. KaTeX/math styling
Earlier scoped CSS approaches did not reproduce ChatGPT math correctly offline.

The stable solution is the complete **unscoped OpenAI KaTeX CSS** used by the exporter. It was intentionally left byte-for-byte stable through the late RCs.

Do not “clean up,” scope, or replace KaTeX CSS unless a reproducible math regression demands it.

### G. Current ChatGPT code cards
Current ChatGPT code blocks physically contain correct newlines, but without archive normalization they could appear as an unreadable blob.

v1.4.0 preserves:

- exact text/newlines/indentation;
- monospace presentation;
- dark static code card;
- bounded vertical scroll;
- horizontal scrolling;
- print expansion;
- deterministic lightweight syntax highlighting;
- plain/monochrome fallback when language is unknown.

The stable code-card path was manually smoke-tested with JSON/code.

### H. Writing blocks / output-like rich content
RC1 introduced preservation/staticization for current rich/writing/output content so it remains readable after interactive ChatGPT UI controls are gone.

Keep rich-content handling independent from scanner logic.

### I. Firefox `version_name` warning
Firefox warned:

`Reading manifest: Warning processing version_name: An unexpected property was found in the WebExtension manifest.`

Stable Firefox v1.4.0 omits `version_name`. Chrome keeps it.

## 6. What the checkpoint cache does — and does not do

The extension has conversation checkpoints stored through the browser background layer.

The checkpoint stores metadata such as:

- conversation key;
- known first stable ID;
- maximum captured turn count;
- maximum captured text count;
- exporter version;
- update time.

**It does not cache or inject conversation message text/HTML.**

Therefore the earlier cross-conversation contamination was not caused by checkpoint content injection. It was a DOM scoping problem.

## 7. Snapshot richness / hydration lesson

The exporter can see the same logical turn multiple times as ChatGPT hydrates/recycles DOM.

Stable v1.4.0 keeps the existing richness rules:

- clearly richer later snapshots may replace earlier saved snapshots;
- provable downgrades are ignored;
- rich descendants such as `pre`, `code`, `table`, `blockquote`, `details`, and `[role='table']` influence the signature.

A temporary RC3.1 debug build instrumented repeated observations of the 40-turn Voth test. It found:

- no semantic-text variants;
- no rich-content variants;
- no late timestamps;
- one raw-HTML-only variant caused by transient ChatGPT UI/spinner markup while semantic content stayed identical.

Conclusion: do **not** change the snapshot threshold merely to chase timestamp-label differences. The missing timestamp labels were renderer behavior, not proven content loss.

## 8. Known limitations

- The actual bytes of user-uploaded attachments are not bundled into the archive; only visible attachment representation is preserved.
- ChatGPT can throttle background tabs. Keep the source tab focused for the most reliable/fast long capture.
- ChatGPT DOM is not a public stable API. Selector/renderer regressions are expected over time.
- Turn indexes may not be exposed by the redesigned renderer; the exporter then relies on scroll/top/order evidence rather than numeric index continuity.
- Rich transient UI chrome such as loading spinners can vary between DOM sightings. The exporter prioritizes semantic content.
- Recommended HTML mode can depend on remote fonts for exact typography; archive content remains readable without them.

## 9. Development rules for the next maintainer

1. Reproduce before changing.
2. Save the failing `capture_report.json`, HTML, and Markdown.
3. Classify the bug:
   - completeness/acquisition;
   - ordering;
   - role/turn extraction;
   - math;
   - code/rich content;
   - CSS only;
   - packaging/manifest.
4. Patch the narrowest subsystem.
5. Compare source/diff against the stable baseline.
6. Run JS syntax checks and manifest validation.
7. Re-run both regression classes:
   - long virtualized ChatGPT conversation;
   - small rich-content conversation.
8. If scanner/top logic changed, add a dedicated DOM fixture or synthetic regression before release.
9. Keep Chrome and Firefox ChatGPT adapter logic synchronized unless a browser-specific difference is necessary and documented.
10. Never use a private ChatGPT web API as a hidden dependency for canonical conversation retrieval. The stable path is DOM-based and `canonicalProbe` is intentionally disabled.

## 10. Recommended GitHub layout

A practical initial repository layout is:

```text
/
├── HANDOFF.md
├── documentation/
│   ├── README.md
│   ├── ARCHITECTURE.md
│   ├── CAPTURE_ENGINE.md
│   ├── ISSUES_AND_FIXES.md
│   ├── RICH_CONTENT_AND_OFFLINE_RENDERING.md
│   ├── REGRESSION_TESTING.md
│   ├── DEBUGGING_GUIDE.md
│   ├── RELEASE_HISTORY.md
│   ├── KNOWN_LIMITATIONS.md
│   └── GITHUB_DEVELOPMENT_GUIDE.md
├── chrome/
│   └── ...current Chrome extension...
└── firefox/
    └── ...current Firefox extension...
```

The supplied GitHub bundle uses this layout.

A future refactor may deduplicate shared Chrome/Firefox logic, but **do not make that the first GitHub change**. First commit the known-good v1.4.0 baseline and regression documentation. Refactor only after tests exist to prove behavior remains identical.

## 11. First task for the next ChatGPT/Codex session

Before writing new features:

1. Read this handoff and all files under `documentation/`.
2. Inspect both browser manifests and `adapters/chatgpt_exporter.js`.
3. Confirm the stable v1.4.0 source is committed unchanged.
4. Create regression fixtures/tests for:
   - active redesigned conversation + stale hidden legacy conversation;
   - redesigned assistant marker with answer in sibling nodes;
   - reversed timeline/top hydration;
   - code card with multiline JSON;
   - table + KaTeX equation.
5. Only then start new feature work.

## 12. Stable release identity

The stable release should continue to be referred to as:

**ChatGPT Archive Exporter v1.4.0**

Do not rename it to RC3.1. RC3.1 was diagnostic only and was deliberately not promoted.
