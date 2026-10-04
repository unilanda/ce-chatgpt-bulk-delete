# Rich Content and Offline Rendering

## 1. General philosophy

The archive should preserve the conversation as readable static content, not reproduce every interactive ChatGPT control.

Interactive controls are cloned only when they contribute meaningful content. Buttons, transient menus, action controls, and editing affordances are generally removed or staticized.

## 2. KaTeX / equations

Stable v1.4.0 keeps the established complete unscoped OpenAI KaTeX CSS.

Why:
- ChatGPT-generated math markup expects KaTeX layout classes globally.
- Earlier attempts to scope or minimize the CSS broke equation layout offline.
- The stable block was preserved unchanged across RC2, RC3, and stable.

Maintenance rule:
- never change math CSS as collateral work for scanner, code-card, or manifest bugs;
- reproduce a math-specific regression first.

Test cases:
- inline equation;
- display equation;
- fractions;
- superscripts/subscripts;
- boxed expression;
- long equation wrapping/overflow.

## 3. Code cards

Current ChatGPT code-card handling recognizes relevant `<code>` nodes outside:
- ordinary `<pre>` legacy paths;
- CodeMirror/editor internals;
- writing blocks where separate handling applies.

Staticized archive behavior:
- exact raw text is used;
- whitespace/newlines/indentation retained;
- language label inferred where possible;
- deterministic syntax tokenization/highlighting for common languages;
- safe escaped HTML;
- horizontal scroll;
- bounded vertical scroll in normal screen view;
- print CSS expands the full block.

Unknown language should remain readable in monochrome rather than fail.

Sensitive functions:
- `isCurrentChatGptCodeElement`
- `findCurrentCodeCardShell`
- `currentCodeCardLabel`
- `highlightCodeTextForArchive`
- `staticizeCurrentCodeCards`

## 4. Tables

Tables should remain HTML tables in the HTML archive.

A previous apparent “RC2 lost tables” report was disproven:
- the tables were inside unrelated messages accidentally harvested by RC1;
- overlapping correct Voth turns matched between RC1 and RC2.

Regression test:
- table immediately before/after normal prose;
- table near code block;
- table with inline math.

## 5. Writing blocks / artifact-like content

RC1 introduced richer preservation/staticization for current ChatGPT writing/output content.

The goal is:
- preserve the readable content;
- remove editing/interactivity requirements;
- avoid blank shells after export.

When adding support for a new rich component:
1. create a small isolated smoke chat;
2. inspect live DOM;
3. identify the smallest semantic container;
4. staticize only that container;
5. verify neighboring message prose survives;
6. verify Markdown fallback still contains meaningful text.

## 6. Attachment chips

The archive preserves visible attachment representation where available:
- filename;
- file type text;
- visible static chip/icon.

The archive does not fetch or embed the actual attachment bytes.

Do not claim an archived attachment is usable offline unless a future feature explicitly packages the file.

## 7. “Thought for…” / analysis UI

ChatGPT may render timing/status UI such as:
- `Thought for 13s`;
- `Analyzed`;
- transient spinner states.

Some of this visible UI can be preserved in HTML/text depending on the mounted snapshot.

It is not used as the primary semantic completeness signal.

## 8. Markdown vs HTML

HTML is the fidelity-oriented archive.

Markdown is a robust textual fallback and is especially useful for:
- diffing across exporter versions;
- checking turn count/order;
- checking whether semantic text disappeared even when HTML DOM differs.

A key debugging technique used during v1.4.0 stabilization was:
- compare Markdown text/turns first;
- then compare per-turn HTML only where Markdown differs or presentation is suspected.

## 9. Recommended archive mode

The default/recommended path is the small offline-assets HTML package with external `assets/archive.css` plus Markdown and TXT in the ZIP.

Self-contained computed-style HTML is available but can be very large.

## 10. Do not conflate payload size with semantic completeness

A larger HTML file may simply contain:
- more SVG icon markup;
- richer DOM;
- debug report payload;
- computed CSS.

A smaller Markdown file can still contain the same semantic conversation.

Always compare:
- turn count;
- stable IDs/fingerprint;
- normalized semantic text;
- rich-block counts;
before interpreting raw file size.
