# Developer Documentation Index

Read in this order:

1. `../HANDOFF.md` — project state, non-negotiable invariants, and first tasks.
2. `ARCHITECTURE.md` — codebase/module map.
3. `CAPTURE_ENGINE.md` — ChatGPT virtualization, renderer detection, active scope, scanning, top certification, gaps, ordering, snapshots.
4. `ISSUES_AND_FIXES.md` — historical failures and why each fix exists.
5. `RICH_CONTENT_AND_OFFLINE_RENDERING.md` — KaTeX, code cards, tables, writing blocks, attachment chips.
6. `REGRESSION_TESTING.md` — required smoke/regression matrix.
7. `DEBUGGING_GUIDE.md` — how to diagnose a new ChatGPT breakage without destabilizing unrelated layers.
8. `KNOWN_LIMITATIONS.md` — intentionally unsupported or imperfect behavior.
9. `RELEASE_HISTORY.md` — condensed evolution to v1.4.0.
10. `GITHUB_DEVELOPMENT_GUIDE.md` — suggested Git/GitHub/Codex workflow.

## Stable baseline

v1.4.0 is the known-good baseline. The documented source packages add only Markdown documentation and do not alter runtime JavaScript, CSS, manifests, icons, or HTML.

The most important maintenance principle is to preserve the separation between:

- **conversation acquisition/completeness**, and
- **archive rendering/presentation**.

A CSS/code-card fix should not retune scrolling. A long-chat completeness fix should not touch KaTeX. A Firefox manifest warning should not alter capture logic.
