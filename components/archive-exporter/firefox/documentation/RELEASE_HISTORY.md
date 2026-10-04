# Release History and Problem Evolution

This is a condensed engineering history, not a public marketing changelog.

## Early scanner iterations
- Initial console/extension capture established repeated scroll-and-harvest for virtualized ChatGPT history.
- Fixed waits evolved into adaptive pacing.
- Browser focus/background throttling was identified as an operational constraint.

## v1.2.5
**Math milestone**
- complete unscoped KaTeX CSS adopted after scoped/minimal math CSS failed offline.

## v1.2.6–v1.2.9
**Long-history reliability**
- diagnostics expanded;
- ordering handling improved;
- multi-round top validation added;
- v1.2.9 became the mature old-renderer baseline.

## v1.3.x
**Adaptive scanner / robustness**
- mutation-driven progress;
- adaptive slow waits;
- geometry-only changes no longer falsely reset top;
- shadow/scroll-root diagnostics expanded.

## v1.4.0 alpha series
**Redesigned ChatGPT renderer**
- recognized current `[data-turn-key]` / timeline architecture;
- reversed timeline support;
- redesigned top hydration work;
- assistant logical-turn fix: whole stable group rather than marker-only extraction.

## v1.4.0 RC1
**Rich-content preservation**
- unified newer capture logic;
- writing/output/static rich content work;
- redesigned assistant pruning behavior.

## v1.4.0 RC2
**Current code-card presentation**
- multiline code normalization;
- exact whitespace;
- dark static code-card UI;
- bounded screen scroll;
- print expansion;
- deterministic syntax highlighting.

During RC2 review, a broad code-card shell replacement path was flagged as sensitive and should remain regression-tested.

## v1.4.0 RC3
**Active conversation boundary / contamination fix**
- added `getActiveConversationScope()`;
- scoped turn discovery;
- scoped scroll-root selection;
- scoped MutationObserver;
- redesigned renderer authoritative in redesigned active scope;
- stale hidden legacy DOM can no longer suppress the active redesigned conversation.

This addressed the RC1 mixed-conversation Voth/NucleicNet contamination discovered during archive comparison.

## v1.4.0 RC3.1-debug
**Instrumentation only**
- recorded repeated per-turn sightings;
- semantic hashes/lengths;
- HTML length changes;
- timestamp presence;
- rich-element signatures.

Finding:
- no semantic variants;
- no late rich-content variants;
- no late timestamp appearance;
- one transient raw-HTML-only variation.

Instrumentation was removed before stable.

## v1.4.0 stable
Promoted:
- RC2 rich-formatting baseline;
- RC3 active-scope integrity fix.

Not promoted:
- RC3.1 debug instrumentation.

Packaging:
- Chrome manifest internal `1.4.0.9`, display `1.4.0`;
- Firefox `1.4.0`, no `version_name`.

Final validation:
- 40-turn Voth long-chat clean;
- rich table + JSON/code + equation smoke good;
- attachment chip preserved as visible representation.
