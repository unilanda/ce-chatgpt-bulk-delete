# Architecture

## 1. Top-level components

### Browser shell

**Chrome**
- `manifest.json`
- `service_worker.js`
- `bridge.js`
- `panel.html`
- `panel.css`
- `panel.js`

**Firefox**
- `manifest.json`
- `background.js`
- `bridge.js`
- `panel.html`
- `panel.css`
- `panel.js`

The shell owns extension lifecycle, adapter selection/injection, options, job status, stop/cancel controls, and checkpoint persistence.

### Adapters

- `adapters/chatgpt_exporter.js` — complex ChatGPT-specific capture engine.
- `adapters/gemini_exporter.js` — Gemini conversation capture.
- `adapters/generic_exporter.js` — ordinary page capture.

ChatGPT is by far the most specialized adapter because of virtualized history, progressive hydration, renderer changes, math, and rich interactive message content.

## 2. Browser shell data flow

Conceptually:

```text
side panel
   ↓ options/start
background/service worker
   ↓ detects current site
inject bridge + adapter + options
   ↓
page-world adapter runs capture
   ↓ window.postMessage status/control
bridge
   ↓ runtime messaging
background/service worker
   ↓
side panel status
```

The background layer also stores lightweight per-conversation checkpoints.

## 3. Why `bridge.js` exists

The ChatGPT exporter runs in the page's main world so it can inspect the live application DOM.

The page script cannot directly use all extension APIs. `bridge.js` relays selected messages between the page and extension runtime, including:

- job/status updates;
- checkpoint load/save requests.

The bridge is not a conversation-content cache.

## 4. Checkpoint storage

Chrome uses local extension storage through `service_worker.js`; Firefox uses its analogous background script.

Stored checkpoint fields are intentionally small:

- `conversationKey`
- `knownFirstStableId`
- `maxCapturedTurns`
- `maxCapturedTextChars`
- `exporterVersion`
- `updatedAt`

The exporter uses this as historical validation context, not as a content source.

## 5. ChatGPT adapter internal layers

`chatgpt_exporter.js` can be understood as these layers:

### A. Configuration and state
Options, report counters, diagnostics, collected entry map, renderer state, cancellation/status.

### B. DOM/renderer discovery
Determines active conversation scope, renderer generation, scroll root, reversed timeline behavior, visible turn candidates.

### C. Turn semantics
Determines:
- user vs assistant;
- stable ID;
- logical content node;
- redesigned assistant group semantics.

### D. Capture signatures and snapshot selection
Avoids rebuilding identical snapshots and protects richer content from later DOM downgrades.

### E. Long-history scanner
Scrolls toward older history, waits adaptively, watches mutations, repairs suspicious gaps, probes/certifies the true top.

### F. Ordering
Uses repeated DOM observations and stable IDs to reconstruct a consistent chronological order when numeric turn indexes are unavailable.

### G. Clone cleanup / rich staticization
Converts transient/interactive ChatGPT UI into portable static archive DOM.

### H. Serialization
Builds:
- HTML;
- Markdown;
- TXT;
- capture report;
- optional ZIP/assets.

## 6. Stable renderer assumptions in v1.4.0

Current redesigned ChatGPT signals include:

- `[data-chatgpt-conversation-selection-target]`
- `[data-app-action-timeline-scroll]`
- `[data-turn-key]`
- `[data-conversation-role]`
- `[data-user-message-bubble]`
- `[data-chatgpt-agent-turn-start]`

These are implementation observations, not guaranteed APIs.

The stable code therefore uses scoring/fallback logic rather than assuming there is only one global matching node.

## 7. Chrome/Firefox parity

The ChatGPT adapter logic is intentionally nearly identical across Chrome and Firefox. Browser-specific differences should remain in:

- manifest;
- background/service-worker API surface;
- side panel/sidebar integration;
- browser messaging wrappers.

Avoid browser-specific divergence inside the scientific/core capture logic unless required by a reproduced browser-only bug.
