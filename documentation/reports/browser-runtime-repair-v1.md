# Browser Runtime Repair V1 — Root-cause and coverage report

## Live exception finding

The exact element that produced the previously observed live
`Cannot set properties of undefined (setting 'textContent')` exception cannot be
established from the retained source alone. At the start of this repair:

- the current `DashboardDom` registry already contained `modal-title`;
- every direct `elements['...']` reference in the current controller had a matching
  ID in the current `dashboard.html`;
- current `dashboard.js` line 691 was the `openDeleteConfirmation` declaration, not a
  `textContent` assignment;
- this worktree contained one dashboard script, no bundle, and no source map;
- the sibling canonical checkout had a different 456-line dashboard script, so it
  does not match the reported line near 691 either.

The evidence is most consistent with Chrome retaining an intermediate/older manager
tab or with a different unpacked root having been reloaded, but that remains a
diagnosis to prove in the user-run Chrome smoke. The repair does not claim the old
`modal-title` defect recurred without evidence.

The verified source-level weakness was the acceptance boundary: prior tests extracted
IDs and exercised render helpers but did not execute the actual dashboard controller.
The Advanced icon and sort icons were also queried as descendants and could drift
without the central required-ID check. They are now required static IDs.

## Runtime asset identity

`runtime-identity.js` is the first dashboard script and the first service-worker
import. Both contexts report the same tracked, non-sensitive marker:

`ChatGPT Manager · browser-runtime-repair-v1 · cm-runtime-20260930-v1 · job schema 1`

The dashboard displays it under Advanced and logs it to the dashboard console. The
service worker logs it to its separate console. It contains no path, username,
account/conversation identifier, token, cookie, Authorization value, or Git remote.

## DOM write audit

Class A — required static dashboard elements:

- all `elements['...']` writes in `dashboard.js`;
- runtime marker, History/Search/verification status, inventory, selection/action,
  modal, interval, and active-job targets;
- Advanced button, panel, and icon;
- all three sortable headers and their icons;
- every target used by `DeleteJobView`.

These are in `DashboardDom.REQUIRED_ELEMENT_IDS`. Binding is synchronous and throws
`Missing required dashboard element: <id>` before asynchronous initialization.
`DeleteJobView` also retains its renderer-specific required-element assertions.

Class B — intentionally conditional targets:

- `.row-checkbox` and `.verify-btn` query results may be empty when the rendered
  inventory has no rows or no verification candidates. Iterating an empty result is
  the intended behavior; missing static markup is not hidden.

Class C — created before use:

- conversation rows are created with `document.createElement('tr')`, populated, and
  appended before dynamic row controls are queried and wired;
- the injected ChatGPT-page manager button in `content.js` is created before its
  `innerHTML`, style, drag, and hover mutations.

No `scrollIntoView` workaround exists. Advanced remains adjacent to Discover and is
collapsed initially.

## Automated runtime boundaries

The dashboard harness parses the actual `dashboard.html`, executes every declared
classic script in order including the actual `dashboard.js`, and uses deterministic
browser/IndexedDB/fetch fakes. It covers initial inventory and History status, an
Unverified row, event wiring, sorting, Advanced open/close, no/draft/running/paused/
error-paused job connection, storage-driven job rendering, initialization failure
capture, and Delete planning for 1/2/17 Standalone, mixed Project selections,
17 mixed records, Unverified, and Custom GPT. Planning never invokes deletion
transport.

The background harness executes actual `background.js` and all `importScripts`
dependencies. It verifies one message/startup/alarm listener each, zero fetch during
initialization, no alarm scheduling during initialization, successful read-only load
of a valid stored draft, and fail-closed handling of malformed stored job state
without rewriting it.

## Remaining Chrome evidence

Automated tests cannot prove which unpacked root an already-running Chrome profile
loaded. After independent review, the user must Reload the extension, close all old
manager tabs, open a new dashboard, compare both runtime markers, and perform only the
non-destructive planning smoke in `MANUAL_SMOKE_TEST.md`. No authenticated Chrome call
or account mutation was performed during this repair.
