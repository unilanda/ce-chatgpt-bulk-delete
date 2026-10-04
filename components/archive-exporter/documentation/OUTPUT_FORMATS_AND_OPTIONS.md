# Output Formats and Options

## User-facing modes

The extension UI exposes presets around these archive strategies.

### Recommended / offline assets
Primary stable path:
- HTML;
- external `assets/archive.css` in the ZIP;
- Markdown;
- TXT;
- capture report/diagnostics.

Advantages:
- much smaller than fully computed self-contained HTML;
- preserves stable archive styling;
- good default for long chats.

### Self-contained HTML
Single HTML with more embedded styling.

Advantages:
- one portable file.

Tradeoff:
- can become very large, especially when style snapshots are embedded.

### Ctrl-S/native-like path
ChatGPT-only path that builds a static page then relies on browser Save Page.

Useful when highest live-page visual fidelity is more important than compactness.

## Important ChatGPT CONFIG fields

The current stable adapter contains configuration for:

### Scanner
- `fastDelayMs`
- `slowDelayMs`
- `slowEveryNPasses`
- adaptive slow/stall thresholds
- `scrollFactor`
- `maxPasses`
- `topStablePassesToStop`

### Gap repair
- `askRepairOnGaps`
- repair delay/factor/pass limits

### Output
- `downloadHtml`
- `downloadMarkdown`
- `downloadText`
- `packageAsZip`

### Archive cleanup
- expanded user plain text;
- preserve assistant rendered HTML;
- simplify file tiles;
- simplify citation links;
- remove archive control widgets;
- remove hidden accessibility layers;
- remove adjacent duplicate text blocks.

### Math
- targeted math/code CSS extraction;
- bundled full KaTeX CSS;
- math style mode;
- math computed-style snapshots.

### Top certification
- top boundary probe enabled;
- validation rounds/cycles;
- retrigger/nudge timing.

### Background robustness
- pause when document hidden;
- resume grace;
- scheduler-stall diagnostics.

## Side-panel defaults

The panel currently defaults to:
- recommended preset;
- HTML + Markdown + TXT;
- ZIP packaging;
- gap guard repair;
- math style auto;
- targeted math/code CSS enabled;
- optional in-page progress disabled from the panel default;
- auto-close after success enabled.

## Capture report

Treat `capture_report.json` as a first-class output.

Important groups:
- overall capture status;
- top boundary;
- gap guard;
- content validation;
- hydration observer;
- rich-block validation;
- redesigned assistant validation;
- rich-output formatting;
- scan diagnostics/performance/pacing;
- scroll diagnostics;
- redesigned top hydration;
- conversation detection / active scope;
- renderer runtime;
- checkpoint validation;
- ordering validation;
- runtime visibility;
- warnings.

## Markdown and TXT role

Markdown/TXT are not only convenience exports.

Markdown is particularly valuable for:
- semantic diffing between versions;
- checking chronology;
- finding whether an entire turn is absent;
- separating acquisition bugs from HTML/CSS presentation bugs.
