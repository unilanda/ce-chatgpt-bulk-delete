"use strict";

const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const TEST_API_MARKER = "\n\n  try {\n    const overlay = makeOverlay();";

const TEST_API_INJECTION = String.raw`

  window.__ARCHIVE_EXPORTER_TEST_API__ = {
    CONFIG,
    state,
    BUNDLED_KATEX_CSS,
    bundledKatexCss,
    chatgptLikeCss,
    cleanCloneForArchive,
    collectVisibleTurns,
    createScrollPosition,
    detectRole,
    findConversationTurns,
    findMainScrollElement,
    getActiveConversationScope,
    getScrollMax,
    getScrollPosition,
    getSortedEntries,
    guardRedesignedTopHydration,
    makeEntryFromTurn,
    probeApparentTop,
    recordObservedDomOrder,
    resolveObservedChronology,
    setScrollPosition,
    startHydrationObserver,
    stopHydrationObserver,
    certifyCurrentTopBoundary,
    resetHarnessState() {
      stopHydrationObserver();
      activeConversationScopeCache = null;
      cachedConversationShadowRoots = [];
      state.cancelled = false;
      state.stopAndSave = false;
      state.currentPass = 0;
      state.collected.clear();
      state.lastMountedKeys = [];
      state.renderer.generation = "unknown";
      state.renderer.reversedTimeline = false;
      state.renderer.timelineDetected = false;
      state.ordering.orderVotes.clear();
      state.ordering.observations = 0;
      state.ordering.certifiedTop = null;
      state.ordering.lastResolution = null;
      state.topBoundaryValidation.stabilized = false;
      state.topBoundaryValidation.quietRoundsCompleted = 0;
      state.topBoundaryValidation.retriggersPerformed = 0;
      state.topBoundaryValidation.lastFailureReason = null;
      state.topBoundaryValidation.validatedAt = null;
      state.contentValidation.snapshotUpgrades = 0;
      state.contentValidation.snapshotUpgradesFromMutationObserver = 0;
      state.contentValidation.downgradeSnapshotsIgnored = 0;
      state.contentValidation.messagesWithMultipleVariants = 0;
      state.contentValidation.variantKeys.clear();
      state.contentValidation.largestSnapshotUpgrades = [];
      state.hydrationObserver.mutationBursts = 0;
      state.hydrationObserver.debouncedObservations = 0;
      state.hydrationObserver.newTurnsCaughtOutsideNormalPass = 0;
      state.hydrationObserver.richerSnapshotsCaughtOutsideNormalPass = 0;
    }
  };
  if (window.__ARCHIVE_EXPORTER_TEST_MODE__) return;`;

function instrumentAdapter(source) {
  const markerCount = source.split(TEST_API_MARKER).length - 1;
  if (markerCount !== 1) {
    throw new Error(`Expected one exporter test-injection marker, found ${markerCount}`);
  }
  return source.replace(TEST_API_MARKER, `${TEST_API_INJECTION}${TEST_API_MARKER}`);
}

function fixturePayload(fixturesDir) {
  const names = [
    "active-scope-vs-stale",
    "redesigned-assistant-split",
    "reversed-negative-timeline",
    "progressive-top-hydration",
    "snapshot-richness",
    "ordering-overlap-windows",
    "rich-presentation"
  ];
  return Object.fromEntries(names.map((name) => [
    name,
    readFileSync(join(fixturesDir, `${name}.html`), "utf8")
  ]));
}

function runBrowserSuite({ adapterPath, suitePath, fixturesDir, chromeBinary = "google-chrome" }) {
  const tempDir = mkdtempSync(join(tmpdir(), "archive-exporter-regression-"));
  try {
    const adapterSource = readFileSync(adapterPath, "utf8");
    writeFileSync(join(tempDir, "adapter-under-test.js"), instrumentAdapter(adapterSource));
    writeFileSync(join(tempDir, "browser-suite.js"), readFileSync(suitePath, "utf8"));
    writeFileSync(
      join(tempDir, "fixtures.js"),
      `window.__ARCHIVE_EXPORTER_FIXTURES__ = ${JSON.stringify(fixturePayload(fixturesDir))};\n`
    );
    writeFileSync(join(tempDir, "index.html"), `<!doctype html>
<html><head><meta charset="utf-8"><title>Exporter regression harness</title></head>
<body>
<script>window.__ARCHIVE_EXPORTER_TEST_MODE__ = true; window.alert = () => {};<\/script>
<script src="fixtures.js"><\/script>
<script src="adapter-under-test.js"><\/script>
<script src="browser-suite.js"><\/script>
</body></html>`);

    const run = spawnSync(chromeBinary, [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
      "--no-default-browser-check",
      "--allow-file-access-from-files",
      `--user-data-dir=${join(tempDir, "chrome-profile")}`,
      "--virtual-time-budget=10000",
      "--dump-dom",
      pathToFileURL(join(tempDir, "index.html")).href
    ], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 30000 });

    if (run.error) throw run.error;
    if (run.status !== 0) {
      throw new Error(`Headless Chrome exited ${run.status}: ${String(run.stderr).slice(-2000)}`);
    }
    const match = run.stdout.match(/<meta name="archive-exporter-test-results" content="([A-Za-z0-9+/=]+)">/);
    if (!match) {
      throw new Error(`Browser did not emit regression results. stderr: ${String(run.stderr).slice(-2000)}`);
    }
    const result = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    if (result.fatal) throw new Error(`Browser fixture suite failed: ${result.fatal}`);
    return result;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

module.exports = { instrumentAdapter, runBrowserSuite };
