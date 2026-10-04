"use strict";

(async () => {
  const api = window.__ARCHIVE_EXPORTER_TEST_API__;
  const fixtures = window.__ARCHIVE_EXPORTER_FIXTURES__;
  const results = [];

  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  function count(text, needle) {
    return String(text).split(needle).length - 1;
  }

  function reset(fixtureName) {
    api.resetHarnessState();
    document.body.innerHTML = fixtures[fixtureName];
  }

  function redesignedTurn(key, label) {
    return `<div data-turn-key="${key}"><div data-conversation-role="assistant">${label} answer</div></div>`;
  }

  async function wait(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function run(name, fn) {
    try {
      const facts = await fn();
      results.push({ name, ok: true, facts });
    } catch (error) {
      results.push({ name, ok: false, error: String(error && (error.stack || error.message) || error) });
    } finally {
      api.stopHydrationObserver();
    }
  }

  await run("active scope excludes stale SPA DOM and aligns scroll/observer roots", async () => {
    reset("active-scope-vs-stale");
    api.CONFIG.hydrationObserverDebounceMs = 1;
    const scope = api.getActiveConversationScope({ refresh: true });
    const scrollRoot = api.findMainScrollElement();
    const turns = api.findConversationTurns();
    const discoveredText = turns.map((node) => node.textContent).join("\n");
    assert(scope.generation === "redesigned", "active redesigned scope was not selected");
    assert(scrollRoot === scope.timeline, "scroll root diverged from active timeline");
    assert(!discoveredText.includes("STALE_A"), "stale hidden conversation contaminated discovery");
    assert(discoveredText.includes("Active B"), "active conversation was not discovered");

    api.startHydrationObserver(scrollRoot);
    document.querySelector("#stale-main article").append(" stale mutation");
    await wait(8);
    const afterStale = api.state.hydrationObserver.mutationBursts;
    scope.timeline.append(document.createElement("i"));
    await wait(8);
    const afterActive = api.state.hydrationObserver.mutationBursts;
    assert(afterStale === 0, "observer watched stale DOM outside active scope");
    assert(afterActive >= 1, "observer did not watch active scope");
    api.collectVisibleTurns(1);
    assert([...api.state.collected.values()].every((entry) => !entry.text.includes("STALE_A")), "stale turn was captured");
    return { generation: scope.generation, captured: api.state.collected.size, observerBursts: afterActive };
  });

  await run("redesigned split assistant exports sibling answer exactly once", async () => {
    reset("redesigned-assistant-split");
    const turns = api.findConversationTurns();
    const assistant = turns.find((turn) => api.detectRole(turn) === "assistant");
    assert(assistant, "logical assistant group was not discovered");
    const entry = api.makeEntryFromTurn(assistant, 1, 0);
    assert(entry, "assistant entry was not built");
    assert(count(entry.text, "The actual sibling answer.") === 1, "assistant answer was missing or duplicated");
    assert(!entry.text.includes("ChatGPT said"), "label-only semantic marker leaked into assistant text");
    assert(!entry.text.includes("Embedded prior user prompt"), "embedded user subtree leaked into assistant text");
    assert(count(entry.html, "The actual sibling answer.") === 1, "assistant HTML duplicated the answer");
    return { stableId: entry.stableId, role: entry.role, answerCopies: 1 };
  });

  await run("reversed timeline maps logical oldest to zero and newest to max", async () => {
    reset("reversed-negative-timeline");
    const timeline = document.querySelector("[data-app-action-timeline-scroll]");
    const model = api.createScrollPosition(timeline);
    const max = model.max();
    assert(max > 0, "synthetic reverse timeline has no scroll range");
    assert(model.reversed, "negative scroll convention was not detected");
    model.set(0);
    const physicalOldest = timeline.scrollTop;
    assert(Math.abs(model.get()) < 2, "logical oldest is not zero");
    assert(physicalOldest < 0, "logical oldest did not map to negative physical scrollTop");
    model.set(max);
    assert(Math.abs(model.get() - max) < 2, "logical newest is not max");
    assert(Math.abs(timeline.scrollTop) < 2, "logical newest did not map to physical zero");
    return { reversed: true, logicalOldest: 0, logicalNewest: Math.round(max) };
  });

  await run("progressive top hydration harvests late history before certification", async () => {
    reset("progressive-top-hydration");
    Object.assign(api.CONFIG, {
      hydrationObserverDebounceMs: 1,
      redesignedTopHydrationPollMs: 4,
      redesignedTopHydrationNudgeDelayMs: 1,
      redesignedTopHydrationMaxMs: 180,
      redesignedTopHydrationQuietPollsAfterSpinner: 2,
      redesignedTopHydrationQuietPollsWithoutSpinner: 2,
      topBoundaryProbeRounds: 2,
      topBoundaryProbeCyclesPerRound: 1,
      topBoundaryProbeDelayMs: 1,
      topBoundaryRetriggerDelayMs: 1,
      enableDeepTopChallenge: true,
      deepTopChallengeDownDelayMs: 1,
      deepTopChallengeReturnDelayMs: 1
    });
    const timeline = api.findMainScrollElement();
    api.collectVisibleTurns(1);
    api.startHydrationObserver(timeline);
    assert(api.state.topBoundaryValidation.stabilized === false, "apparent top was already certified");

    setTimeout(() => {
      timeline.querySelector("[role='status']")?.remove();
      timeline.insertAdjacentHTML("afterbegin", redesignedTurn("oldest-1", "Oldest"));
    }, 12);

    const hydration = await api.guardRedesignedTopHydration(timeline, { update() {} }, 2);
    assert(hydration.olderHistoryObserved === true, "delayed older history was not detected");
    assert(api.state.topBoundaryValidation.stabilized === false, "growth was certified as a stable top");
    assert([...api.state.collected.keys()].some((key) => key.includes("oldest-1")), "late older turn was not harvested");
    assert(api.state.hydrationObserver.mutationBursts >= 1, "delayed hydration mutation was not observed");

    const stable = await api.probeApparentTop(timeline, { update() {} }, 3, 40);
    assert(stable.stabilized === true, "quiet/challenge conditions did not stabilize top boundary");
    assert(api.state.topBoundaryValidation.deepChallengePerformed === true, "deep top challenge was not exercised");
    const certified = api.certifyCurrentTopBoundary();
    assert(certified?.key.includes("oldest-1"), "certified top is not the late oldest turn");
    return { lateHistoryDetected: true, stabilized: stable.stabilized, certifiedKey: certified.key };
  });

  await run("richer stable snapshot upgrades and later downgrade is ignored", async () => {
    reset("snapshot-richness");
    api.collectVisibleTurns(1);
    const initial = [...api.state.collected.values()][0];
    const answer = document.querySelector("#richness-answer");
    answer.innerHTML = `${answer.textContent}<blockquote>Hydrated explanation with meaningful extra detail.</blockquote><pre><code>const hydrated = true;</code></pre><table><tr><td>rich</td></tr></table>`;
    api.collectVisibleTurns(2, "mutation");
    const upgraded = api.state.collected.get(initial.key);
    assert(upgraded.html.includes("hydrated"), "richer snapshot did not replace the early snapshot");
    assert(api.state.contentValidation.snapshotUpgrades === 1, "snapshot upgrade was not recorded exactly once");
    const richHtml = upgraded.html;

    answer.textContent = "Transient short shell";
    api.collectVisibleTurns(3, "mutation");
    const finalEntry = api.state.collected.get(initial.key);
    assert(finalEntry.html === richHtml, "later downgrade replaced the richer snapshot");
    assert(api.state.contentValidation.downgradeSnapshotsIgnored >= 1, "downgrade was not diagnosed");
    return { upgrades: 1, downgradeIgnored: true, stableId: finalEntry.stableId };
  });

  await run("overlapping no-index windows resolve one deterministic chronology", async () => {
    reset("ordering-overlap-windows");
    const timeline = document.querySelector("#ordering-timeline");
    api.collectVisibleTurns(1);
    timeline.innerHTML = [redesignedTurn("a", "A"), redesignedTurn("b", "B"), redesignedTurn("c", "C")].join("");
    api.collectVisibleTurns(2);
    timeline.innerHTML = [redesignedTurn("c", "C"), redesignedTurn("d", "D"), redesignedTurn("e", "E")].join("");
    api.collectVisibleTurns(3);
    const sorted = api.getSortedEntries();
    const keys = sorted.map((entry) => entry.stableId.replace("group:assistant:", ""));
    assert(JSON.stringify(keys) === JSON.stringify(["a", "b", "c", "d", "e"]), `unexpected chronology: ${keys.join(",")}`);
    assert(new Set(sorted.map((entry) => entry.stableId)).size === 5, "stable identities were duplicated");
    assert(api.state.ordering.lastResolution.contradictoryPairs === 0, "supported windows produced contradictory pairs");
    assert(api.state.ordering.lastResolution.cycleBreaks === 0, "supported windows required a cycle break");
    return { keys, contradictions: 0, cycleBreaks: 0 };
  });

  await run("current multiline code cards preserve exact text and static CSS behavior", async () => {
    reset("rich-presentation");
    const source = document.querySelector("#rich-presentation-root");
    const expected = source.querySelector("code").textContent;
    const clone = api.cleanCloneForArchive(source, "offline_assets_html");
    const cards = clone.querySelectorAll(".saved-code-card");
    assert(cards.length === 2, "current code cards were not both staticized");
    assert(cards[0].querySelector("code").textContent === expected, "multiline JSON whitespace changed");
    assert(clone.textContent.includes("Prose before code.") && clone.textContent.includes("Prose between code cards."), "surrounding prose was swallowed");
    assert(cards[1].textContent.includes("opaque token"), "unknown language became unreadable");
    const css = api.chatgptLikeCss();
    assert(/\.saved-code-card-scroll[\s\S]*overflow:\s*auto/.test(css), "x/y scrolling CSS is absent");
    assert(/\.saved-code-card-scroll[\s\S]*max-height:\s*520px/.test(css), "bounded code height CSS is absent");
    assert(/@media print[\s\S]*overflow:\s*visible !important/.test(css), "print expansion CSS is absent");
    return { codeCards: 2, exactCharacters: expected.length, unknownLanguageReadable: true };
  });

  await run("table and KaTeX markup survive with bundled CSS enabled", async () => {
    reset("rich-presentation");
    const clone = api.cleanCloneForArchive(document.querySelector("#rich-presentation-root"), "offline_assets_html");
    const table = clone.querySelector("table");
    const math = clone.querySelector(".katex-display .katex .katex-html");
    assert(table?.rows.length === 2 && table.rows[1].cells[1].textContent === "42", "table structure/content changed");
    assert(math?.textContent.includes("x = 1"), "KaTeX presentation markup was lost");
    assert(api.CONFIG.useBundledKatexCss === true, "bundled KaTeX path is disabled");
    assert(api.bundledKatexCss() === api.BUNDLED_KATEX_CSS, "bundled KaTeX CSS path changed");
    assert(api.BUNDLED_KATEX_CSS.includes(".katex-display"), "bundled KaTeX CSS is incomplete");
    return { rows: table.rows.length, bundledKatexCssChars: api.BUNDLED_KATEX_CSS.length };
  });

  await run("writing/output content remains while controls become static", async () => {
    reset("rich-presentation");
    const clone = api.cleanCloneForArchive(document.querySelector("#rich-presentation-root"), "offline_assets_html");
    const block = clone.querySelector(".saved-writing-block");
    assert(block?.classList.contains("saved-writing-block"), "writing block was not staticized");
    assert(block.textContent.includes("Preserved heading") && block.textContent.includes("Preserved output body."), "semantic output content was lost");
    assert(!block.querySelector("button"), "interactive output control survived");
    assert(block.querySelector(".saved-output-tab")?.textContent === "Markdown", "format tab was not staticized");
    assert(!block.querySelector("[contenteditable]"), "editable state survived archive cleanup");
    return { contentPreserved: true, controlsRemoved: true, tabsStaticized: 1 };
  });

  await run("attachment chip remains visible without byte-archive claim", async () => {
    reset("rich-presentation");
    const clone = api.cleanCloneForArchive(document.querySelector("#rich-presentation-root"), "offline_assets_html");
    const chip = clone.querySelector(".saved-file-chip");
    assert(chip, "attachment chip was removed");
    assert(chip.textContent.includes("quarterly-results.csv"), "attachment filename was lost");
    assert(!clone.querySelector("#attachment-chip"), "interactive source file tile was not simplified");
    return { visibleName: "quarterly-results.csv", archivedBytesClaimed: false };
  });

  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ results }))));
  const meta = document.createElement("meta");
  meta.name = "archive-exporter-test-results";
  meta.content = payload;
  document.head.appendChild(meta);
})().catch((error) => {
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ fatal: String(error && (error.stack || error.message) || error) }))));
  const meta = document.createElement("meta");
  meta.name = "archive-exporter-test-results";
  meta.content = payload;
  document.head.appendChild(meta);
});
