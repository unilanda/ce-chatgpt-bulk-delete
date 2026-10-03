# Browser Runtime Repair — Acceptance Notes V1

## Why this repair exists

The Persistent Delete Jobs implementation passed a large automated suite, but the
real Chrome dashboard still emitted:

`TypeError: Cannot set properties of undefined (setting 'textContent')`

Therefore source-level unit coverage is not sufficient. Release acceptance now
requires a real-dashboard initialization contract using the actual HTML and actual
wiring.

## Acceptance principle

A browser extension UI must never depend on a hand-maintained test DOM that can drift
from `dashboard.html`.

Static required elements are a contract:
`dashboard.html ↔ DashboardDom ↔ dashboard.js/controllers/views`

Any mismatch must fail early with the exact missing element ID.

## Runtime identity

Because unpacked extensions can remain open across Reload and old tabs can execute
stale extension documents, each testable build should expose a non-sensitive runtime
marker.

The marker is for provenance only. It must not contain:
- filesystem path;
- username;
- token;
- conversation ID;
- Git remote credentials.

After extension Reload, close/reopen old Manager pages and verify the marker.

## Next live smoke after this repair

No destructive action initially.

1. Reload extension.
2. Close all old Manager dashboard tabs.
3. Open a new Manager dashboard.
4. Verify runtime marker.
5. Confirm dashboard console has no initialization exception.
6. Open/close Advanced in place.
7. Open Delete plan for 1 Standalone; Cancel.
8. Open plan for ~17 Standalone; Cancel.
9. Open mixed Standalone+Project plan; inspect Project approval; Cancel.
10. Only after independent review and clean browser smoke test one single-item
    persistent background DeleteJob.

The older page-owned implementation has already deleted multi-item batches live.
The next destructive test is specifically about the NEW background executor, not
about proving that ChatGPT's delete endpoint works in general.
