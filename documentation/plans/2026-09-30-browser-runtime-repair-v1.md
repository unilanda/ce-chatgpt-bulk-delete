# Browser Runtime Repair V1 Implementation Plan

> **Spec:** `documentation/design/CHATGPT_MANAGER_BROWSER_RUNTIME_REPAIR_ACCEPTANCE_V1.md`

## Goal

Close the live dashboard-initialization coverage gap, expose a non-sensitive runtime
identity for stale-asset diagnosis, and prove the actual dashboard and service-worker
wiring start safely without performing authenticated or destructive work.

## Global constraints

- Keep branch `search-safe-delete` at pinned HEAD
  `028b4b5d0a03fd264dfe5880ae58b92041afa005`; do not commit or alter history.
- Preserve all accumulated dirty campaign work.
- Do not make authenticated ChatGPT calls, perform deletion, expand permissions, or
  change persistent-job semantics.
- Use the actual `dashboard.html`, actual classic-script order, and actual
  `dashboard.js` in the integration harness.
- Fail closed for missing DOM and malformed durable job state.
- Package a complete sanitized review snapshot under `/home/didi/Downloads`.

## Task 1: Runtime identity and strict DOM contract

**Files:** `runtime-identity.js`, `manifest.json`, `dashboard.html`, `dashboard-dom.js`,
`background.js`, `tests/dashboard-dom.test.js`, `tests/manifest.test.js`

Write failing tests for a tracked non-sensitive identity loaded by both dashboard and
service worker, visible in Advanced, plus exact missing-ID failures for representative
critical nodes. Then add the smallest identity module/markup/wiring and retain one
central required-ID list.

**Verification:** `node --test tests/dashboard-dom.test.js tests/manifest.test.js`

## Task 2: Actual dashboard initialization harness

**Files:** `tests/helpers/dashboard-harness.js`,
`tests/dashboard-initialization.test.js`, `dashboard.js`

Build a deterministic browser fake from the actual HTML, execute the declared classic
scripts in order, capture unhandled async failures, and exercise initial inventory,
event wiring, Advanced open/close, History status, one Unverified row, job connect and
storage updates for no/draft/running/paused/error-paused jobs, and all required
Delete-plan compositions with zero deletion transport. First make the harness expose
the current opaque `init()` rejection; then add a narrow dashboard-only initialization
error reporter which preserves console stack information and renders a safe message.

**Verification:** `node --test tests/dashboard-initialization.test.js`

## Task 3: Actual background startup harness

**Files:** `tests/background-startup.test.js`, and only directly necessary runtime
source discovered by the failing test

Execute actual `background.js` with deterministic `importScripts`, IndexedDB,
`chrome.runtime`, storage, alarm, and tab fakes. Prove initialization does not throw,
listeners register once, no network call occurs during initialization, and malformed
stored job state fails closed without mutation or scheduling destructive work.

**Verification:** `node --test tests/background-startup.test.js`

## Task 4: Runtime audit and user smoke contract

**Files:** `MANUAL_SMOKE_TEST.md`, `documentation/reports/browser-runtime-repair-v1.md`

Document script provenance, every DOM-write classification, root-cause limits, the
expected runtime marker, separate dashboard/service-worker console inspection, old-tab
closure, and non-destructive planning checks. Do not require Network tooling.

**Verification:** focused documentation assertions in the new runtime tests and a
manual private-data/path scan.

## Task 5: Full gates and review package

Run the full Node suite, syntax-check every maintained JavaScript file, parse the
manifest and assert exact permissions/host permissions, run the bootstrap regression,
`git diff --check`, credential/private-data/persisted-auth/runtime-path/legacy-brand
scans, and generate the required sanitized ZIP containing source, cumulative diff,
Git state, test evidence, identity mechanism, smoke guide, and root-cause report.

## Review focus

- The integration harness must execute actual script wiring rather than restating IDs.
- No initialization path may trigger authenticated network or deletion transport.
- Static elements fail early with exact IDs; optional/dynamic targets are justified.
- Initialization error capture must not globally swallow errors or erase stack traces.
- The runtime marker must be useful yet contain no private path or identity data.
