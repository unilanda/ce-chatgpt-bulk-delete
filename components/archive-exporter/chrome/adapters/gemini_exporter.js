(async () => {
  "use strict";

  const OPTIONS = {
    mode: "offline_assets_html",
    downloadHtml: true,
    downloadMarkdown: true,
    downloadText: true,
    packageAsZip: true,
    showInPageProgress: false,
    autoCloseAfterSuccess: true,
    fastDelayMs: 45,
    checkpointDelayMs: 700,
    checkpointEvery: 45,
    scrollFactor: 0.85,
    maxPasses: 1200,
    topStablePasses: 6,
    ...(window.__ARCHIVE_EXPORTER_OPTIONS__ || {})
  };

  if (window.__GEMINI_ARCHIVE_EXPORTER_RUNNING__) return;
  window.__GEMINI_ARCHIVE_EXPORTER_RUNNING__ = true;

  const state = {
    cancelled: false,
    stopAndSave: false,
    pass: 0,
    entries: new Map(),
    initialTop: 1,
    progress: 0,
    status: {
      running: true,
      done: false,
      adapter: "gemini",
      phase: "Starting Gemini capture…",
      hint: "",
      captured: 0,
      pass: 0,
      progress: 0,
      indeterminate: false,
      mode: OPTIONS.mode
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const compact = (s) => String(s || "").replace(/\s+/g, " ").trim();
  const escapeHtml = (s) => String(s ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function status(patch = {}) {
    if (Number.isFinite(Number(patch.progress))) {
      state.progress = Math.max(state.progress, Math.max(0, Math.min(100, Number(patch.progress))));
    }

    state.status = {
      ...state.status,
      ...patch,
      running: Boolean(window.__GEMINI_ARCHIVE_EXPORTER_RUNNING__),
      cancelled: state.cancelled,
      stopAndSave: state.stopAndSave,
      adapter: "gemini",
      pass: state.pass,
      captured: state.entries.size,
      progress: state.progress,
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
    stopAndSave: () => {
      state.stopAndSave = true;
      return status({ phase: "Stop & Save requested", hint: "Saving captured messages after the current wait.", indeterminate: true });
    },
    cancel: () => {
      state.cancelled = true;
      return status({ phase: "Cancel requested", hint: "Nothing will be saved.", indeterminate: true });
    }
  };

  function roleOf(node) {
    const self = `${node.tagName || ""} ${node.getAttribute?.("data-test-id") || ""} ${node.className || ""}`.toLowerCase();
    const ancestors = [];
    let cur = node;
    for (let i = 0; cur && i < 5; i++, cur = cur.parentElement) {
      ancestors.push(`${cur.tagName || ""} ${cur.getAttribute?.("data-test-id") || ""} ${cur.className || ""}`.toLowerCase());
    }
    const joined = `${self} ${ancestors.join(" ")}`;

    if (/user-query|userquery|query-content|user-message|human/.test(joined)) return "user";
    if (/model-response|modelresponse|response-content|assistant|bard/.test(joined)) return "assistant";
    return "assistant";
  }

  function candidateNodes() {
    const selectors = [
      "user-query",
      "model-response",
      "message-content",
      '[data-test-id*="user-query"]',
      '[data-test-id*="model-response"]',
      '[data-test-id*="response"]',
      '[class*="user-query"]',
      '[class*="model-response"]',
      '[class*="query-content"]',
      '[class*="response-content"]'
    ];

    const raw = [];
    const seen = new Set();

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((node) => {
        if (!(node instanceof HTMLElement)) return;

        let turn = node.closest("user-query, model-response") || node;
        const text = compact(turn.innerText || turn.textContent || "");
        if (text.length < 2 || seen.has(turn)) return;
        seen.add(turn);
        raw.push(turn);
      });
    }

    // Remove nested duplicates: prefer the larger role container.
    return raw.filter((node) => !raw.some((other) => other !== node && other.contains(node)));
  }

  function cleanClone(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("script, noscript, iframe, button, [role='button'], svg").forEach((el) => el.remove());
    clone.querySelectorAll("[contenteditable]").forEach((el) => el.removeAttribute("contenteditable"));
    clone.querySelectorAll("img").forEach((img) => {
      img.style.maxWidth = "100%";
      img.style.height = "auto";
    });
    clone.querySelectorAll("a[href]").forEach((a) => {
      try { a.href = new URL(a.getAttribute("href"), location.href).href; } catch {}
      a.target = "_blank";
      a.rel = "noopener noreferrer";
    });
    return clone;
  }

  function collect() {
    let added = 0;
    for (const node of candidateNodes()) {
      const role = roleOf(node);
      const text = compact(node.innerText || node.textContent || "");
      if (!text) continue;
      const key = `${role}:${hash(text)}`;
      if (state.entries.has(key)) continue;
      state.entries.set(key, {
        role,
        text,
        html: cleanClone(node).outerHTML,
        order: state.entries.size
      });
      added++;
    }
    return added;
  }

  function findScroller() {
    const root = document.scrollingElement || document.documentElement;
    let best = root;
    let bestRange = Math.max(0, root.scrollHeight - root.clientHeight);

    document.querySelectorAll("main, div, section").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const range = Math.max(0, el.scrollHeight - el.clientHeight);
      if (range < 300) return;
      const style = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(style.overflowY || "") && range < 1000) return;
      if (range > bestRange) {
        best = el;
        bestRange = range;
      }
    });
    return best;
  }

  function scrollUp(scroller, amount) {
    const documentScroller =
      scroller === document.scrollingElement ||
      scroller === document.documentElement ||
      scroller === document.body;

    if (documentScroller) {
      const root = document.scrollingElement || document.documentElement;
      root.scrollTop = Math.max(0, root.scrollTop - amount);
      window.dispatchEvent(new Event("scroll"));
    } else {
      scroller.scrollTop = Math.max(0, scroller.scrollTop - amount);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
    }
  }

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

  function orderedEntries() {
    return [...state.entries.values()];
  }

  const ARCHIVE_CSS = `
:root{color-scheme:dark;--bg:#212121;--text:#ececec;--muted:#aaa;--line:rgba(255,255,255,.12)}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header,main{max-width:820px;margin:auto;padding:16px 20px}header{border-bottom:1px solid var(--line)}
.turn{margin:0 0 18px;padding:0 0 16px 14px;border-left:3px solid #ab68ff}.turn.user{border-color:#10a37f}
.meta{font-size:11px;color:var(--muted);text-transform:uppercase;font-weight:700;margin-bottom:7px}
img{max-width:100%;height:auto}pre{overflow:auto;background:#111;padding:12px;border-radius:10px}
a{color:#8ab4f8}table{display:block;overflow:auto;border-collapse:collapse}td,th{border:1px solid var(--line);padding:6px}
`;

  function buildHtml() {
    const turns = orderedEntries().map((entry, i) => `
<section class="turn ${entry.role}">
  <div class="meta">#${i + 1} ${escapeHtml(entry.role)}</div>
  <div>${entry.html}</div>
</section>`).join("\n");

    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${escapeHtml(document.title || "Gemini conversation")}</title>
<link rel="stylesheet" href="assets/archive.css"></head><body>
<header><h1>${escapeHtml(document.title || "Gemini conversation")}</h1>
<div>Source: ${escapeHtml(location.href)}</div><div>Captured turns: ${state.entries.size}</div></header>
<main>${turns}</main></body></html>`;
  }

  function buildMarkdown() {
    let out = `# ${document.title || "Gemini conversation"}\n\nSource: ${location.href}\n\n`;
    orderedEntries().forEach((entry, i) => {
      out += `---\n\n## ${i + 1}. ${entry.role}\n\n${entry.text}\n\n`;
    });
    return out;
  }

  function buildText() {
    let out = `${document.title || "Gemini conversation"}\nSource: ${location.href}\n\n`;
    orderedEntries().forEach((entry, i) => {
      out += `==============================\n${i + 1}. ${entry.role}\n==============================\n\n${entry.text}\n\n`;
    });
    return out;
  }

  function save() {
    const folder = `${safeName(document.title || "gemini_conversation")}_${stamp()}`;
    const files = [];

    if (OPTIONS.downloadHtml !== false) {
      files.push({ name: `${folder}/conversation.html`, data: buildHtml() });
      files.push({ name: `${folder}/assets/archive.css`, data: ARCHIVE_CSS });
    }
    if (OPTIONS.downloadMarkdown !== false) files.push({ name: `${folder}/conversation.md`, data: buildMarkdown() });
    if (OPTIONS.downloadText !== false) files.push({ name: `${folder}/conversation.txt`, data: buildText() });
    files.push({ name: `${folder}/README.txt`, data: `Gemini best-effort adapter\nSource: ${location.href}\nCaptured turns: ${state.entries.size}\n` });

    downloadBlob(buildStoredZip(files), `${folder}.zip`, "application/zip");
  }

  try {
    status({ progress: 2, phase: "Finding Gemini conversation…", hint: "Using the Gemini-specific best-effort adapter." });
    const scroller = findScroller();
    scroller.scrollTop = scroller.scrollHeight;
    await sleep(500);
    state.initialTop = Math.max(1, Number(scroller.scrollTop || 0), Number(scroller.scrollHeight || 0) - Number(scroller.clientHeight || 0));
    collect();

    let topStable = 0;
    let noNew = 0;

    for (let pass = 1; pass <= OPTIONS.maxPasses; pass++) {
      if (state.cancelled || state.stopAndSave) break;
      state.pass = pass;

      const before = state.entries.size;
      collect();

      const currentTop = Number(scroller.scrollTop || 0);
      const fraction = 1 - currentTop / Math.max(1, state.initialTop);
      const progress = Math.min(90, Math.round(Math.max(0, Math.min(1, fraction)) * 90));
      status({
        progress,
        indeterminate: noNew >= 5 && currentTop > 8,
        phase: "Scanning Gemini conversation…",
        hint: noNew >= 5 ? "Waiting for older Gemini content…" : `Captured ${state.entries.size} turns.`
      });

      const beforeTop = Number(scroller.scrollTop || 0);
      const step = Math.max(250, Math.floor((scroller.clientHeight || innerHeight || 800) * OPTIONS.scrollFactor));
      scrollUp(scroller, step);

      const delay = pass % OPTIONS.checkpointEvery === 0 ? OPTIONS.checkpointDelayMs : OPTIONS.fastDelayMs;
      await sleep(delay);
      collect();

      if (state.entries.size === before) noNew++; else noNew = 0;
      const nearTop = Number(scroller.scrollTop || 0) <= 5;
      const didNotMove = Math.abs(Number(scroller.scrollTop || 0) - beforeTop) < 3;
      if (nearTop && (noNew > 0 || didNotMove)) topStable++; else topStable = 0;
      if (topStable >= OPTIONS.topStablePasses) break;
    }

    if (state.cancelled) {
      status({ running: false, done: true, progress: state.progress, indeterminate: false, phase: "Cancelled. Nothing saved.", hint: "" });
      return;
    }

    // If selectors failed, save the loaded page as one best-effort entry.
    if (!state.entries.size) {
      const main = document.querySelector("main") || document.body;
      const text = compact(main.innerText || main.textContent || "");
      state.entries.set("generic", {
        role: "page",
        text,
        html: cleanClone(main).outerHTML,
        order: 0
      });
    }

    status({ progress: 96, indeterminate: true, phase: "Building Gemini archive…", hint: "Formatting HTML, Markdown and TXT." });
    save();
    status({ running: false, done: true, progress: 100, indeterminate: false, phase: `Saved ${state.entries.size} turns.`, hint: "Gemini export completed." });
  } catch (error) {
    console.error("[ChatGPT Archive V1.2 Gemini] Failed:", error);
    status({ running: false, done: true, error: String(error?.stack || error), phase: "Gemini export failed.", hint: "See DevTools Console." });
  } finally {
    window.__GEMINI_ARCHIVE_EXPORTER_RUNNING__ = false;
    status({ running: false });
  }
})();
