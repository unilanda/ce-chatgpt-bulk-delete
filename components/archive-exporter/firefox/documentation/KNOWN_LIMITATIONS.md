# Known Limitations

## Attachments
Only the visible attachment chip/name/icon is archived. The underlying uploaded file is not fetched or embedded.

## Background throttling
Very long captures are most reliable while the source tab remains active/focused. Browsers can throttle background tabs.

## ChatGPT DOM instability
The exporter depends on observed DOM behavior, not an official stable DOM API. Future ChatGPT UI changes can break selectors or semantics.

## No private canonical ChatGPT API dependency
The stable exporter does not rely on a private ChatGPT conversation endpoint. A historical/experimental canonical probe is disabled.

## Numeric turn indexes may be unavailable
The redesigned renderer may expose stable IDs without old numeric turn indexes. Completeness/order then rely on scanner/top/order evidence.

## Timestamps are not a completeness guarantee
ChatGPT may suppress or group timestamp labels. Missing a timestamp label is not automatically missing message content.

## Transient UI chrome
Spinners/loading placeholders may vary between observations and archives. Semantic message text is prioritized.

## Fidelity vs file size
Self-contained/computed-style modes can be very large. Recommended mode uses external archive CSS inside the ZIP.

## Remote typography
Some typography may depend on fonts not embedded in the archive. Core content, code, and math layout remain the priority.

## Current scope
The project has dedicated adapters for ChatGPT and Gemini plus a generic webpage fallback. ChatGPT receives the deepest regression coverage.
