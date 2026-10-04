# ChatGPT Archive Exporter v1.4.0 — Firefox

Stable v1.4.0 promotes the validated RC3 capture boundary and RC2 rich-formatting work.

## Included fixes

- ChatGPT capture is scoped to the active conversation/thread surface so stale SPA DOM from another conversation cannot be harvested into the current archive.
- Redesigned ChatGPT assistant-turn extraction keeps the full logical assistant turn while pruning user-bubble/semantic-label artifacts.
- Long-chat progressive-history scanning/top certification, reversed-timeline handling, gap repair, checkpoint validation, and adaptive pacing are retained.
- Current ChatGPT code cards keep exact whitespace/newlines, bounded internal scrolling, deterministic syntax highlighting fallback, and print expansion.
- Established unscoped OpenAI KaTeX CSS/math handling is retained unchanged.
- Markdown/TXT backups remain available alongside HTML and capture diagnostics.

## Validation before stable promotion

The Voth long-conversation regression captured 40 turns cleanly from the correct first message, with no ordering contradictions, gaps, or cross-conversation contamination. RC3.1 debug instrumentation found no semantic-content variants or late rich-content variants across repeated sightings; that debug instrumentation is not included in this stable build.

## Notes

- Firefox omits Chrome-only `version_name`, eliminating the manifest warning seen in RC2/RC3.
- Chrome uses manifest build version `1.4.0.9` so it is upgrade-safe from the RC builds while displaying stable version `1.4.0`.

## Primary smoke tests

1. Re-export a long redesigned ChatGPT conversation and verify the correct first message and chronology.
2. Export a small chat containing a table, code/JSON block, equation, and attachment chip to verify rich-formatting presentation.

## Developer documentation

For GitHub maintenance and project handoff, read `HANDOFF.md` and `documentation/README.md` before changing the ChatGPT capture engine.
