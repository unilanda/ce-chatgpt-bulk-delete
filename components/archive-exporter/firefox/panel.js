const OPTIONS_KEY = "archiveExporterOptionsV12";

const el = Object.fromEntries(
  [
    "pageSummary", "phase", "hint", "captured", "pass", "adapter",
    "percentLabel", "progressTrack", "progressBar", "progressDetail", "statusDot",
    "preset", "downloadHtml", "downloadMarkdown", "downloadText",
    "packageAsZip", "gapGuardMode", "mathStyleMode", "embedTargetedMathCodeCssRules",
    "showInPageProgress", "presetSummary", "advancedOptions",
    "startBtn", "stopBtn", "cancelBtn", "closePanelBtn"
  ].map((id) => [id, document.getElementById(id)])
);

let panelWindowId = null;
let currentTab = null;
let activeJob = null;

const DEFAULTS = {
  preset: "recommended",
  downloadHtml: true,
  downloadMarkdown: true,
  downloadText: true,
  packageAsZip: true,
  gapGuardMode: "repair",
  mathStyleMode: "auto",
  embedTargetedMathCodeCssRules: true,
  showInPageProgress: false
};

function adapterLabel(value) {
  if (value === "chatgpt") return "ChatGPT";
  if (value === "gemini") return "Gemini";
  if (value === "generic") return "Generic page";
  return "—";
}

function canonicalPageUrl(value) {
  try {
    const url = new URL(value || "");
    url.hash = "";
    return url.href;
  } catch {
    return String(value || "").split("#")[0];
  }
}

function jobMatchesCurrentPage(job) {
  if (!job || !currentTab) return false;

  return (
    Number(job.tabId) === Number(currentTab.id) &&
    canonicalPageUrl(job.url) === canonicalPageUrl(currentTab.url)
  );
}

function visibleJobForCurrentPage(job) {
  if (!job) return null;

  // Keep the active job visible across tab switches in this Firefox window.
  if (job.running) return job;

  // Keep the completed result visible in the same Firefox window even if the
  // user switched tabs while the export was finishing. This does not close or
  // reopen the sidebar; it only keeps the finished status from disappearing.
  if (
    job.done &&
    Number(job.windowId) === Number(panelWindowId)
  ) {
    return job;
  }

  return jobMatchesCurrentPage(job) ? job : null;
}

function presetDefaultMath(preset) {
  if (preset === "small") return "inline";
  if (preset === "recommended") return "css";
  return "computed";
}

function effectiveMathStyle() {
  return el.mathStyleMode.value === "auto"
    ? presetDefaultMath(el.preset.value)
    : el.mathStyleMode.value;
}

function updatePresetSummary() {
  const summaries = {
    recommended:
      "ZIP with small HTML + external assets/archive.css + Markdown + TXT. Complete KaTeX layout CSS and original inline math. Remote fonts may require internet.",
    small:
      "ZIP with HTML + external assets/archive.css + Markdown + TXT. Minimal math styling and smallest HTML.",
    selfContained:
      "ZIP with one self-contained HTML plus Markdown + TXT. Portable, but computed math can make the HTML very large.",
    ctrlS:
      "ChatGPT only. Builds a static page, then Firefox Ctrl-S saves HTML and its asset folder. Highest visual fidelity."
  };

  el.presetSummary.textContent =
    summaries[el.preset.value] || summaries.recommended;
}

async function send(message) {
  return browser.runtime.sendMessage(message);
}

async function loadOptions() {
  const stored = await browser.storage.sync.get(OPTIONS_KEY);
  const options = {
    ...DEFAULTS,
    ...(stored[OPTIONS_KEY] || {})
  };

  for (const key of [
    "downloadHtml",
    "downloadMarkdown",
    "downloadText",
    "packageAsZip",
    "embedTargetedMathCodeCssRules",
    "showInPageProgress"
  ]) {
    el[key].checked = Boolean(options[key]);
  }

  el.preset.value = options.preset || "recommended";
  el.gapGuardMode.value = options.gapGuardMode || "repair";
  el.mathStyleMode.value = options.mathStyleMode || "auto";
  updatePresetSummary();
}

async function saveOptions() {
  await browser.storage.sync.set({
    [OPTIONS_KEY]: {
      preset: el.preset.value,
      downloadHtml: el.downloadHtml.checked,
      downloadMarkdown: el.downloadMarkdown.checked,
      downloadText: el.downloadText.checked,
      packageAsZip: el.packageAsZip.checked,
      gapGuardMode: el.gapGuardMode.value,
      mathStyleMode: el.mathStyleMode.value,
      embedTargetedMathCodeCssRules:
        el.embedTargetedMathCodeCssRules.checked,
      showInPageProgress: el.showInPageProgress.checked
    }
  });
}

function buildOptions() {
  const base = {
    downloadHtml: el.downloadHtml.checked,
    downloadMarkdown: el.downloadMarkdown.checked,
    downloadText: el.downloadText.checked,
    packageAsZip: true,
    gapGuardMode: el.gapGuardMode.value || "repair",
    mathStyleMode: effectiveMathStyle(),
    embedTargetedMathCodeCssRules:
      el.embedTargetedMathCodeCssRules.checked,
    showInPageProgress: el.showInPageProgress.checked,
    autoCloseAfterSuccess: false
  };

  switch (el.preset.value) {
    case "small":
      return {
        ...base,
        mode: "offline_assets_html",
        fastDelayMs: 25,
        slowDelayMs: 520,
        slowEveryNPasses: 60,
        scrollFactor: 0.85
      };

    case "selfContained":
      return {
        ...base,
        mode: "self_contained_html"
      };

    case "ctrlS":
      return {
        ...base,
        mode: "replace_page_then_ctrl_s",
        downloadHtml: false,
        showInPageProgress: true
      };

    default:
      return {
        ...base,
        mode: "offline_assets_html",
        fastDelayMs: 30,
        slowDelayMs: 650,
        slowEveryNPasses: 55,
        scrollFactor: 0.80
      };
  }
}

async function refreshCurrentTab() {
  const win = await browser.windows.getCurrent();
  panelWindowId = win.id;

  const [tab] = await browser.tabs.query({
    active: true,
    windowId: panelWindowId
  });

  currentTab = tab || null;

  if (!currentTab) {
    el.pageSummary.textContent = "No active tab.";
    return;
  }

  const response = await send({
    type: "DETECT_ADAPTER",
    url: currentTab.url || ""
  });

  const adapter = response?.adapter || "generic";

  el.pageSummary.textContent =
    `${adapterLabel(adapter)} · ${currentTab.title || "Untitled page"}`;
}

function render(rawJob) {
  const job = visibleJobForCurrentPage(rawJob);
  activeJob = job || null;

  const running = Boolean(job?.running);
  const done = Boolean(job?.done);
  const hasError = Boolean(job?.error);
  const progress = Math.max(
    0,
    Math.min(100, Number(job?.progress || 0))
  );

  el.phase.textContent = job?.phase || "Idle";
  el.hint.textContent = job?.hint || "Ready.";
  el.captured.textContent = String(job?.captured ?? 0);
  el.pass.textContent = String(job?.pass ?? 0);
  el.adapter.textContent = adapterLabel(job?.adapter);

  el.percentLabel.textContent = `${Math.round(progress)}%`;
  el.progressBar.style.width = `${progress}%`;

  const activityText = (() => {
    const source =
      `${job?.phase || ""} ${job?.hint || ""}`.toLowerCase();

    if (!running && done && hasError) return "failed";
    if (!running && done) return "finished";
    if (!running) return "idle";

    if (source.includes("paused")) {
      return "paused safely";
    }

    if (
      source.includes("wait") ||
      source.includes("render older") ||
      job?.indeterminate
    ) {
      return "waiting for page rendering";
    }

    if (
      source.includes("validat") ||
      source.includes("boundary")
    ) {
      return "validating";
    }

    if (
      source.includes("zip") ||
      source.includes("archive") ||
      source.includes("format")
    ) {
      return "building output";
    }

    return "fast capture";
  })();

  el.progressDetail.textContent =
    `Approx. ${Math.round(progress)}% complete · ${activityText}`;

  el.progressTrack.classList.toggle(
    "active",
    Boolean(running && (job?.indeterminate || progress > 0))
  );

  el.statusDot.className =
    "status-dot" + (
      hasError ? " error" :
      running ? " running" :
      done ? " done" : ""
    );

  el.startBtn.disabled = running || !currentTab?.id;
  el.stopBtn.disabled = !running;
  el.cancelBtn.disabled = !running;
}

async function restoreJob() {
  const response = await send({ type: "GET_JOB" });
  render(response?.job || null);
}

function optionalOriginPattern(urlValue) {
  try {
    const url = new URL(urlValue || "");

    if (url.protocol === "http:" || url.protocol === "https:") {
      return `${url.protocol}//${url.host}/*`;
    }

    if (url.protocol === "file:") {
      return "file:///*";
    }
  } catch {}

  return null;
}

async function ensurePagePermission(tab) {
  const adapterResponse = await send({
    type: "DETECT_ADAPTER",
    url: tab.url || ""
  });

  // Dedicated adapters already have explicit host permission.
  if (
    adapterResponse?.adapter === "chatgpt" ||
    adapterResponse?.adapter === "gemini"
  ) {
    return true;
  }

  const origin = optionalOriginPattern(tab.url);
  if (!origin) return true;

  const request = { origins: [origin] };

  if (await browser.permissions.contains(request)) {
    return true;
  }

  // This call occurs directly inside the Export button click handler, which
  // satisfies Firefox's user-action requirement for permission requests.
  return browser.permissions.request(request);
}

async function start() {
  await saveOptions();
  await refreshCurrentTab();

  if (!currentTab?.id) return;

  const permissionGranted = await ensurePagePermission(currentTab);

  if (!permissionGranted) {
    render({
      running: false,
      done: true,
      error: "Permission was not granted.",
      phase: "Permission required.",
      hint: "Allow access to this site to use the generic page exporter.",
      progress: 0,
      adapter: "generic"
    });
    return;
  }

  const options = buildOptions();

  el.phase.textContent = "Starting exporter…";
  el.hint.textContent =
    "The Firefox sidebar will remain available while the export runs.";

  const response = await send({
    type: "START_JOB",
    tabId: currentTab.id,
    windowId: panelWindowId,
    url: currentTab.url || "",
    title: currentTab.title || "",
    options
  });

  render(
    response?.job || {
      running: false,
      done: true,
      error: response?.error || "Could not start",
      phase: "Could not start exporter."
    }
  );
}

async function control(command) {
  await send({
    type: "CONTROL_JOB",
    command
  });
}

async function closeSidebar() {
  try {
    await browser.sidebarAction.close();
  } catch (error) {
    console.error("Could not close sidebar:", error);
  }
}

browser.runtime.onMessage.addListener((message) => {
  if (message?.type === "ARCHIVE_JOB_BROADCAST") {
    render(message.job);
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;

  const change = changes.archiveExporterJobV12;

  if (change) {
    render(change.newValue || null);
  }
});

browser.tabs.onActivated.addListener(async ({ windowId }) => {
  if (windowId !== panelWindowId) return;

  await refreshCurrentTab();
  await restoreJob();
});

browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (tabId !== currentTab?.id) return;
  if (!changeInfo.url && !changeInfo.title) return;

  await refreshCurrentTab();
  await restoreJob();
});

el.startBtn.addEventListener("click", start);
el.stopBtn.addEventListener("click", () => control("stop"));
el.cancelBtn.addEventListener("click", () => control("cancel"));
el.closePanelBtn.addEventListener("click", closeSidebar);

for (const node of [
  el.preset,
  el.downloadHtml,
  el.downloadMarkdown,
  el.downloadText,
  el.packageAsZip,
  el.gapGuardMode,
  el.mathStyleMode,
  el.embedTargetedMathCodeCssRules,
  el.showInPageProgress
]) {
  node.addEventListener("change", saveOptions);
}

el.preset.addEventListener("change", () => {
  updatePresetSummary();
  saveOptions();
});

(async () => {
  await loadOptions();
  await refreshCurrentTab();
  await restoreJob();
})();
