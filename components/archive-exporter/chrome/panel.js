const OPTIONS_KEY = "archiveExporterOptionsV12";

const el = Object.fromEntries(
  [
    "pageSummary", "phase", "hint", "captured", "pass", "adapter",
    "percentLabel", "progressTrack", "progressBar", "progressDetail", "statusDot",
    "preset", "downloadHtml", "downloadMarkdown", "downloadText",
    "packageAsZip", "gapGuardMode", "mathStyleMode", "embedTargetedMathCodeCssRules",
    "showInPageProgress", "autoCloseAfterSuccess",
    "presetSummary", "advancedOptions",
    "startBtn", "stopBtn", "cancelBtn", "closePanelBtn"
  ].map((id) => [id, document.getElementById(id)])
);

let panelWindowId = null;
let currentTab = null;
let activeJob = null;
let closeTimer = null;
let startedJobId = null;
let previousRenderedJob = null;
const autoCloseScheduledJobs = new Set();

const DEFAULTS = {
  preset: "recommended",
  downloadHtml: true,
  downloadMarkdown: true,
  downloadText: true,
  packageAsZip: true,
  gapGuardMode: "repair",
  mathStyleMode: "auto",
  embedTargetedMathCodeCssRules: true,
  showInPageProgress: false,
  autoCloseAfterSuccess: true
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

  // A running job stays visible even if the user temporarily changes tabs,
  // because Stop/Save and Cancel must remain available.
  if (job.running) return job;

  // A completed result is retained only on the exact page where it ran.
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
      "ChatGPT only. Builds a static page, then Chrome Ctrl-S saves HTML and its asset folder. Highest visual fidelity."
  };

  el.presetSummary.textContent =
    summaries[el.preset.value] || summaries.recommended;
}


async function send(message) {
  return chrome.runtime.sendMessage(message);
}

async function loadOptions() {
  const stored = await chrome.storage.sync.get(OPTIONS_KEY);
  const options = { ...DEFAULTS, ...(stored[OPTIONS_KEY] || {}) };

  for (const key of [
    "downloadHtml", "downloadMarkdown", "downloadText", "packageAsZip",
    "embedTargetedMathCodeCssRules", "showInPageProgress", "autoCloseAfterSuccess"
  ]) {
    el[key].checked = Boolean(options[key]);
  }

  el.preset.value = options.preset || "recommended";
  el.gapGuardMode.value = options.gapGuardMode || "repair";
  el.mathStyleMode.value = options.mathStyleMode || "auto";
  updatePresetSummary();
}

async function saveOptions() {
  await chrome.storage.sync.set({
    [OPTIONS_KEY]: {
      preset: el.preset.value,
      downloadHtml: el.downloadHtml.checked,
      downloadMarkdown: el.downloadMarkdown.checked,
      downloadText: el.downloadText.checked,
      packageAsZip: el.packageAsZip.checked,
      gapGuardMode: el.gapGuardMode.value,
      mathStyleMode: el.mathStyleMode.value,
      embedTargetedMathCodeCssRules: el.embedTargetedMathCodeCssRules.checked,
      showInPageProgress: el.showInPageProgress.checked,
      autoCloseAfterSuccess: el.autoCloseAfterSuccess.checked
    }
  });
}

function buildOptions() {
  const mathStyleMode = effectiveMathStyle();

  const base = {
    downloadHtml: el.downloadHtml.checked,
    downloadMarkdown: el.downloadMarkdown.checked,
    downloadText: el.downloadText.checked,
    packageAsZip: true,
    gapGuardMode: el.gapGuardMode.value || "repair",
    mathStyleMode,
    embedTargetedMathCodeCssRules: el.embedTargetedMathCodeCssRules.checked,
    showInPageProgress: el.showInPageProgress.checked,
    autoCloseAfterSuccess: el.autoCloseAfterSuccess.checked
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
  const win = await chrome.windows.getCurrent();
  panelWindowId = win.id;

  const [tab] = await chrome.tabs.query({ active: true, windowId: panelWindowId });
  currentTab = tab || null;

  if (!currentTab) {
    el.pageSummary.textContent = "No active tab.";
    return;
  }

  const response = await send({ type: "DETECT_ADAPTER", url: currentTab.url || "" });
  const adapter = response?.adapter || "generic";
  el.pageSummary.textContent = `${adapterLabel(adapter)} · ${currentTab.title || "Untitled page"}`;
}

function render(rawJob) {
  const job = visibleJobForCurrentPage(rawJob);
  activeJob = job || null;

  const running = Boolean(job?.running);
  const done = Boolean(job?.done);
  const hasError = Boolean(job?.error);
  const progress = Math.max(0, Math.min(100, Number(job?.progress || 0)));

  el.phase.textContent = job?.phase || "Idle";
  el.hint.textContent = job?.hint || "Ready.";
  el.captured.textContent = String(job?.captured ?? 0);
  el.pass.textContent = String(job?.pass ?? 0);
  el.adapter.textContent = adapterLabel(job?.adapter);

  // Keep the cumulative percentage visible during hydration/build waits.
  el.percentLabel.textContent = `${Math.round(progress)}%`;
  el.progressBar.style.width = `${progress}%`;

  const activityText = (() => {
    const source = `${job?.phase || ""} ${job?.hint || ""}`.toLowerCase();

    if (!running && done && hasError) return "failed";
    if (!running && done) return "finished";
    if (!running) return "idle";
    if (source.includes("paused")) return "paused safely";
    if (source.includes("wait") || source.includes("render older") || source.includes("hydrat") || job?.indeterminate) {
      return "waiting for page rendering";
    }
    if (source.includes("validat") || source.includes("boundary")) return "validating";
    if (source.includes("zip") || source.includes("archive") || source.includes("format")) {
      return "building output";
    }
    return "fast capture";
  })();

  el.progressDetail.textContent =
    `Approx. ${Math.round(progress)}% complete · ${activityText}`;

  // Activity is now a shimmer inside the cumulative filled area. The bar never
  // resets to a moving 36% segment.
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

  const previous = previousRenderedJob;
  const sameJob =
    Boolean(previous?.jobId) &&
    previous.jobId === job?.jobId;

  const completedTransition =
    sameJob &&
    previous.running === true &&
    running === false &&
    done === true &&
    !hasError &&
    !job?.cancelled &&
    progress >= 100;

  if (
    completedTransition &&
    job?.autoCloseAfterSuccess !== false &&
    el.autoCloseAfterSuccess.checked &&
    !autoCloseScheduledJobs.has(job.jobId)
  ) {
    autoCloseScheduledJobs.add(job.jobId);

    if (closeTimer) clearTimeout(closeTimer);

    closeTimer = setTimeout(async () => {
      // Preserve the completed job in session storage. Reopening on the same
      // page must show its final turns/pass counts without closing again.
      await send({
        type: "CLOSE_PANEL",
        windowId: job.windowId ?? panelWindowId
      });
      closeTimer = null;
    }, 2600);
  }

  previousRenderedJob = job
    ? {
        jobId: job.jobId,
        running,
        done,
        error: job.error || "",
        progress
      }
    : null;
}

async function restoreJob() {
  const response = await send({ type: "GET_JOB" });
  render(response?.job || null);
}

async function start() {
  await saveOptions();
  await refreshCurrentTab();

  if (!currentTab?.id) return;

  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }

  startedJobId = null;
  previousRenderedJob = null;

  const options = buildOptions();
  el.phase.textContent = "Starting exporter…";
  el.hint.textContent = "The side panel will remain available while the export runs.";

  const response = await send({
    type: "START_JOB",
    tabId: currentTab.id,
    windowId: panelWindowId,
    url: currentTab.url || "",
    title: currentTab.title || "",
    options
  });

  if (response?.job?.jobId) {
    startedJobId = response.job.jobId;
  }

  render(response?.job || {
    running: false,
    done: true,
    error: response?.error || "Could not start",
    phase: "Could not start exporter."
  });
}

async function control(command) {
  await send({ type: "CONTROL_JOB", command });
}

async function closePanel() {
  await send({ type: "CLOSE_PANEL", windowId: panelWindowId });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "ARCHIVE_JOB_BROADCAST") {
    render(message.job);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  const change = changes.archiveExporterJobV12;
  if (change) render(change.newValue || null);
});

chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  if (windowId !== panelWindowId) return;

  await refreshCurrentTab();
  const response = await send({ type: "GET_JOB" });
  render(response?.job || null);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (tabId !== currentTab?.id) return;
  if (!changeInfo.url && !changeInfo.title) return;

  await refreshCurrentTab();
  const response = await send({ type: "GET_JOB" });
  render(response?.job || null);
});

el.startBtn.addEventListener("click", start);
el.stopBtn.addEventListener("click", () => control("stop"));
el.cancelBtn.addEventListener("click", () => control("cancel"));
el.closePanelBtn.addEventListener("click", closePanel);

for (const node of [
  el.preset, el.downloadHtml, el.downloadMarkdown, el.downloadText,
  el.packageAsZip, el.mathStyleMode, el.embedTargetedMathCodeCssRules,
  el.showInPageProgress, el.autoCloseAfterSuccess
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
