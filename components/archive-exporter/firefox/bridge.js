(() => {
  "use strict";

  if (window.__CHATGPT_ARCHIVE_BRIDGE_V13__) return;
  window.__CHATGPT_ARCHIVE_BRIDGE_V13__ = true;

  const CHECKPOINT_SOURCE = "chatgpt-archive-exporter-v1.3-checkpoint";
  const CHECKPOINT_RESPONSE_SOURCE = "chatgpt-archive-exporter-bridge-v1.3";

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;

    if (
      data &&
      data.source === "chatgpt-archive-exporter-v1.2" &&
      data.type === "ARCHIVE_EXPORTER_STATUS"
    ) {
      browser.runtime.sendMessage({
        type: "ARCHIVE_JOB_STATUS",
        status: data.status
      }).catch(() => {});
      return;
    }

    if (
      !data ||
      data.source !== CHECKPOINT_SOURCE ||
      data.type !== "ARCHIVE_CHECKPOINT_REQUEST" ||
      !data.requestId
    ) {
      return;
    }

    const action = data.action === "save" ? "SAVE_CONVERSATION_CHECKPOINT" :
      data.action === "load" ? "LOAD_CONVERSATION_CHECKPOINT" : null;

    if (!action) return;

    browser.runtime.sendMessage({
      type: action,
      conversationKey: data.conversationKey || "",
      checkpoint: data.checkpoint || null
    }).then((result) => {
      window.postMessage({
        source: CHECKPOINT_RESPONSE_SOURCE,
        type: "ARCHIVE_CHECKPOINT_RESPONSE",
        requestId: data.requestId,
        result: result || null
      }, "*");
    }).catch((error) => {
      window.postMessage({
        source: CHECKPOINT_RESPONSE_SOURCE,
        type: "ARCHIVE_CHECKPOINT_RESPONSE",
        requestId: data.requestId,
        result: {
          ok: false,
          error: String(error?.message || error)
        }
      }, "*");
    });
  });
})();
