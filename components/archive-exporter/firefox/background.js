const JOB_KEY = "archiveExporterJobV12";
const CHECKPOINTS_KEY = "archiveExporterConversationCheckpointsV1";
const MAX_CHECKPOINTS = 200;

function detectAdapter(url = "") {
  try {
    const host = new URL(url).hostname;

    if (host === "chatgpt.com" || host.endsWith(".chatgpt.com")) {
      return "chatgpt";
    }

    if (host === "gemini.google.com") {
      return "gemini";
    }
  } catch {}

  return "generic";
}

function adapterFile(adapter) {
  if (adapter === "chatgpt") return "adapters/chatgpt_exporter.js";
  if (adapter === "gemini") return "adapters/gemini_exporter.js";
  return "adapters/generic_exporter.js";
}

async function storeJob(patch) {
  const stored = await browser.storage.session.get(JOB_KEY);
  const current = stored[JOB_KEY] || {};
  const now = new Date().toISOString();

  const next = {
    ...current,
    ...patch,
    updatedAt: now
  };

  if (patch.done === true && !next.completedAt) {
    next.completedAt = now;
  }

  await browser.storage.session.set({ [JOB_KEY]: next });
  return next;
}

async function getJob() {
  const stored = await browser.storage.session.get(JOB_KEY);
  return stored[JOB_KEY] || null;
}

async function getConversationCheckpoint(conversationKey) {
  const key = String(conversationKey || "").trim();
  if (!key) return null;

  const stored = await browser.storage.local.get(CHECKPOINTS_KEY);
  const checkpoints = stored[CHECKPOINTS_KEY] || {};
  return checkpoints[key] || null;
}

async function saveConversationCheckpoint(conversationKey, checkpoint) {
  const key = String(conversationKey || "").trim();
  if (!key || !checkpoint || typeof checkpoint !== "object") {
    throw new Error("Invalid conversation checkpoint");
  }

  const stored = await browser.storage.local.get(CHECKPOINTS_KEY);
  const checkpoints = stored[CHECKPOINTS_KEY] || {};
  const now = new Date().toISOString();

  checkpoints[key] = {
    conversationKey: key,
    knownFirstStableId: String(checkpoint.knownFirstStableId || ""),
    maxCapturedTurns: Math.max(0, Number(checkpoint.maxCapturedTurns || 0)),
    maxCapturedTextChars: Math.max(0, Number(checkpoint.maxCapturedTextChars || 0)),
    exporterVersion: String(checkpoint.exporterVersion || ""),
    updatedAt: now
  };

  const entries = Object.entries(checkpoints)
    .sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || "")));

  const compacted = Object.fromEntries(entries.slice(0, MAX_CHECKPOINTS));
  await browser.storage.local.set({ [CHECKPOINTS_KEY]: compacted });
  return compacted[key];
}

async function broadcastJob(job) {
  try {
    await browser.runtime.sendMessage({
      type: "ARCHIVE_JOB_BROADCAST",
      job
    });
  } catch {
    // No sidebar document may currently be open.
  }
}

async function injectBridge(tabId) {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ["bridge.js"]
    });
  } catch (error) {
    console.debug("Bridge injection skipped:", error);
  }
}

async function injectOptions(tabId, options) {
  await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (opts) => {
      window.__ARCHIVE_EXPORTER_OPTIONS__ = opts;
      window.__CHATGPT_FULL_CHAT_SAVER_OPTIONS__ = opts;
    },
    args: [options]
  });
}

async function startJob({ tabId, windowId, url, title, options }) {
  const adapter = detectAdapter(url);
  const jobId = crypto.randomUUID();

  const initial = await storeJob({
    jobId,
    tabId,
    windowId,
    url,
    title,
    adapter,
    running: true,
    done: false,
    completedAt: "",
    error: "",
    phase: `Starting ${adapter} adapter…`,
    hint: "",
    captured: 0,
    pass: 0,
    progress: 0,
    indeterminate: true,
    startedAt: new Date().toISOString(),
    autoCloseAfterSuccess: false
  });

  await broadcastJob(initial);
  await injectBridge(tabId);
  await injectOptions(tabId, {
    ...(options || {}),
    autoCloseAfterSuccess: false
  });

  await browser.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    files: [adapterFile(adapter)]
  });

  return initial;
}

async function controlJob(command) {
  const job = await getJob();

  if (!job?.tabId) {
    throw new Error("No active export job");
  }

  const results = await browser.scripting.executeScript({
    target: { tabId: job.tabId },
    world: "MAIN",
    func: (cmd) => {
      const control =
        window.__ARCHIVE_EXPORTER_CONTROL__ ||
        window.__CHATGPT_FULL_CHAT_SAVER_CONTROL__;

      if (!control) return null;
      if (cmd === "stop") return control.stopAndSave?.();
      if (cmd === "cancel") return control.cancel?.();
      return control.getStatus?.();
    },
    args: [command]
  });

  return results?.[0]?.result || null;
}

// The toolbar action is the user gesture that Firefox requires for opening or
// toggling an extension sidebar.
browser.action.onClicked.addListener(async () => {
  try {
    await browser.sidebarAction.toggle();
  } catch (error) {
    console.error("Could not toggle Archive Exporter sidebar:", error);
  }
});

browser.runtime.onMessage.addListener(async (message, sender) => {
  switch (message?.type) {
    case "DETECT_ADAPTER":
      return { adapter: detectAdapter(message.url) };

    case "GET_JOB":
      return { job: await getJob() };

    case "START_JOB": {
      try {
        const job = await startJob(message);
        return { ok: true, job };
      } catch (error) {
        const failed = await storeJob({
          running: false,
          done: true,
          error: String(error?.stack || error),
          phase: "Could not start exporter.",
          hint: "This page may be protected or permission was not granted.",
          indeterminate: false
        });

        await broadcastJob(failed);

        return {
          ok: false,
          error: failed.error,
          job: failed
        };
      }
    }

    case "CONTROL_JOB": {
      try {
        const status = await controlJob(message.command);
        return { ok: true, status };
      } catch (error) {
        return {
          ok: false,
          error: String(error?.message || error)
        };
      }
    }

    case "LOAD_CONVERSATION_CHECKPOINT": {
      try {
        return {
          ok: true,
          checkpoint: await getConversationCheckpoint(message.conversationKey)
        };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    }

    case "SAVE_CONVERSATION_CHECKPOINT": {
      try {
        return {
          ok: true,
          checkpoint: await saveConversationCheckpoint(
            message.conversationKey,
            message.checkpoint
          )
        };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    }

    case "ARCHIVE_JOB_STATUS": {
      const current = await getJob();

      const job = await storeJob({
        ...(message.status || {}),
        tabId: current?.tabId ?? sender.tab?.id,
        windowId: current?.windowId ?? sender.tab?.windowId
      });

      await broadcastJob(job);
      return { ok: true };
    }

    case "CLEAR_JOB":
      await browser.storage.session.remove(JOB_KEY);
      return { ok: true };

    default:
      return {
        ok: false,
        error: "Unknown message"
      };
  }
});
