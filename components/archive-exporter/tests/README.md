# Archive Exporter regression baseline

This test-only baseline executes the real Chrome and Firefox ChatGPT adapter copies in a
local headless-Chrome DOM. The Node harness injects a test API into an in-memory copy at a
single stable marker, writes that instrumented copy only to a temporary directory, and
returns before the adapter's live capture/download path. Chrome runs with background
networking disabled and a disposable profile inside that same temporary directory. No
production source is modified, no provider endpoint is called, and no user browser profile
is used.

Run:

```sh
node --test components/archive-exporter/tests/*.test.js
```

The fixtures pin active-scope isolation, redesigned split turns, negative/reversed scroll
normalization, delayed top hydration, snapshot upgrades/downgrade protection, graph ordering
without numeric turn indexes, current code-card staticization, table/KaTeX preservation,
writing/output staticization, and visible attachment-chip preservation. The same suite runs
against both adapter copies; their normalized behavioral facts must match exactly. A separate
gate pins the frozen bundled KaTeX CSS bytes.

These fixtures do not replace the two manual release smokes:

1. Export a long, virtualized ChatGPT conversation and inspect completeness/order.
2. Export a small conversation containing a table, multiline code, an equation, and an
   attachment chip; inspect the offline archive and its print view.

The attachment fixture proves only that the visible filename/chip survives. It does **not**
claim that underlying attachment bytes are embedded in the archive.
