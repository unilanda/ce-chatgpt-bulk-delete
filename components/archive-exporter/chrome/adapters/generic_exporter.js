(async () => {
  "use strict";

  const OPTIONS = {
    downloadHtml: true,
    downloadMarkdown: true,
    downloadText: true,
    packageAsZip: true,
    ...(window.__ARCHIVE_EXPORTER_OPTIONS__ || {})
  };

  if (window.__GENERIC_ARCHIVE_EXPORTER_RUNNING__) return;
  window.__GENERIC_ARCHIVE_EXPORTER_RUNNING__ = true;

  const state = {
    cancelled: false,
    status: {
      running: true,
      done: false,
      adapter: "generic",
      phase: "Starting generic page capture…",
      hint: "",
      captured: 1,
      pass: 0,
      progress: 0,
      indeterminate: false
    }
  };

  const escapeHtml = (s) => String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function status(patch = {}) {
    state.status = {
      ...state.status,
      ...patch,
      running: Boolean(window.__GENERIC_ARCHIVE_EXPORTER_RUNNING__),
      cancelled: state.cancelled,
      adapter: "generic",
      updatedAt: new Date().toISOString()
    };
    window.__ARCHIVE_EXPORTER_STATUS__ = { ...state.status };
    try {
      window.postMessage({
        source: "chatgpt-archive-exporter-v1.2",
        type: "ARCHIVE_EXPORTER_STATUS",
        status: window.__ARCHIVE_EXPORTER_STATUS__
      }, "*");
    } catch {}
    return window.__ARCHIVE_EXPORTER_STATUS__;
  }

  window.__ARCHIVE_EXPORTER_CONTROL__ = {
    getStatus: () => status(),
    stopAndSave: () => status(),
    cancel: () => {
      state.cancelled = true;
      return status({ phase: "Cancel requested", hint: "Nothing will be saved." });
    }
  };

  function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  }

  const CRC32_TABLE = makeCrc32Table();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (const byte of bytes) c = CRC32_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function u16(n) { return new Uint8Array([n & 255, (n >>> 8) & 255]); }
  function u32(n) { return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]); }

  function concatBytes(parts) {
    const length = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function buildStoredZip(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = new Date();
    const year = Math.max(1980, now.getFullYear());
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((year - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const dataBytes = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data ?? ""));
      const crc = crc32(dataBytes);
      const size = dataBytes.length;
      const localHeader = concatBytes([
        u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), nameBytes
      ]);
      localParts.push(localHeader, dataBytes);

      const centralHeader = concatBytes([
        u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(dosTime), u16(dosDate),
        u32(crc), u32(size), u32(size), u16(nameBytes.length), u16(0), u16(0), u16(0),
        u16(0), u32(0), u32(offset), nameBytes
      ]);
      centralParts.push(centralHeader);
      offset += localHeader.length + dataBytes.length;
    }

    const local = concatBytes(localParts);
    const central = concatBytes(centralParts);
    const end = concatBytes([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(central.length), u32(local.length), u16(0)
    ]);
    return concatBytes([local, central, end]);
  }

  function downloadBlob(content, filename, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function safeName(value) {
    return String(value || "archive")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 110) || "archive";
  }

  function stamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
  }

  function absolutize(root) {
    const attrs = ["href", "src", "poster", "action"];
    root.querySelectorAll("*").forEach((el) => {
      for (const attr of attrs) {
        if (!el.hasAttribute(attr)) continue;
        const value = el.getAttribute(attr);
        if (!value || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("#")) continue;
        try { el.setAttribute(attr, new URL(value, location.href).href); } catch {}
      }

      if (el.hasAttribute("srcset")) {
        const next = el.getAttribute("srcset").split(",").map((item) => {
          const parts = item.trim().split(/\s+/);
          try { parts[0] = new URL(parts[0], location.href).href; } catch {}
          return parts.join(" ");
        }).join(", ");
        el.setAttribute("srcset", next);
      }
    });
  }

  function cleanPageClone() {
    const clone = document.documentElement.cloneNode(true);

    clone.querySelectorAll(
      "script, noscript, iframe, object, embed, meta[http-equiv='Content-Security-Policy'], #chatgpt-full-chat-saver-v4-overlay"
    ).forEach((el) => el.remove());

    clone.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    clone.querySelectorAll("button, input, textarea, select").forEach((el) => {
      if (el.matches("input[type='checkbox'], input[type='radio']")) {
        el.disabled = true;
      } else if (el.tagName === "BUTTON") {
        el.remove();
      }
    });

    absolutize(clone);

    let head = clone.querySelector("head");
    if (!head) {
      head = document.createElement("head");
      clone.prepend(head);
    }

    const baseEl = document.createElement("base");
    baseEl.href = location.href;
    head.prepend(baseEl);

    const safety = document.createElement("style");
    safety.textContent = `
      img,video,svg{max-width:100%;height:auto}
      pre,code{white-space:pre-wrap;overflow-wrap:anywhere}
      table{max-width:100%;overflow:auto}
      body{overflow:visible!important}
    `;
    head.appendChild(safety);

    return "<!doctype html>\n" + clone.outerHTML;
  }

  function markdownFromPage() {
    const main = document.querySelector("main, article, [role='main']") || document.body;
    return `# ${document.title || "Saved page"}\n\nSource: ${location.href}\n\n${main.innerText || main.textContent || ""}\n`;
  }

  function textFromPage() {
    const main = document.querySelector("main, article, [role='main']") || document.body;
    return `${document.title || "Saved page"}\nSource: ${location.href}\n\n${main.innerText || main.textContent || ""}\n`;
  }

  try {
    status({ progress: 10, phase: "Cloning loaded page…", hint: "Generic fallback saves the DOM currently loaded in this tab." });
    await new Promise((resolve) => setTimeout(resolve, 80));
    if (state.cancelled) {
      status({ running: false, done: true, phase: "Cancelled. Nothing saved.", progress: 0 });
      return;
    }

    const html = cleanPageClone();
    status({ progress: 72, phase: "Preparing generic archive…", hint: "Resolving links and removing active controls." });
    const folder = `${safeName(document.title || "saved_page")}_${stamp()}`;
    const files = [];

    if (OPTIONS.downloadHtml !== false) files.push({ name: `${folder}/page.html`, data: html });
    if (OPTIONS.downloadMarkdown !== false) files.push({ name: `${folder}/page.md`, data: markdownFromPage() });
    if (OPTIONS.downloadText !== false) files.push({ name: `${folder}/page.txt`, data: textFromPage() });
    files.push({
      name: `${folder}/README.txt`,
      data: `Generic best-effort page capture\nSource: ${location.href}\nOnly content loaded in the DOM can be saved.\n`
    });

    status({ progress: 94, indeterminate: true, phase: "Building ZIP…", hint: "Creating the generic page package." });
    downloadBlob(buildStoredZip(files), `${folder}.zip`, "application/zip");
    status({ running: false, done: true, progress: 100, indeterminate: false, phase: "Generic page saved.", hint: "Best-effort HTML/Markdown/TXT export completed." });
  } catch (error) {
    console.error("[ChatGPT Archive V1.2 Generic] Failed:", error);
    status({ running: false, done: true, error: String(error?.stack || error), phase: "Generic export failed.", hint: "This page may block extension injection." });
  } finally {
    window.__GENERIC_ARCHIVE_EXPORTER_RUNNING__ = false;
    status({ running: false });
  }
})();
