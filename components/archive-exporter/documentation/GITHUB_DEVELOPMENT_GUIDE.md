# GitHub Development Guide

## 1. First commit strategy

The first GitHub commit should be the **known-good v1.4.0 baseline plus documentation**, not a refactor.

Suggested sequence:

1. `baseline: import stable v1.4.0 Chrome and Firefox`
2. `docs: add architecture, regressions, and historical issue rationale`
3. `tests: add deterministic ChatGPT DOM fixtures`
4. only then begin cleanup/refactor/features.

This makes future `git bisect` and diffs meaningful.

## 2. Suggested repository structure

```text
/
├── HANDOFF.md
├── documentation/
├── chrome/
└── firefox/
```

Later, after regression tests exist, shared code may move to a common source tree with browser build steps.

## 3. Do not deduplicate too early

Chrome and Firefox currently contain nearly mirrored ChatGPT adapter logic.

A shared-source refactor is attractive, but it can easily:
- change injection timing;
- change browser-world semantics;
- accidentally drift manifests/background behavior;
- obscure whether a regression came from refactor or feature change.

Add fixtures first.

## 4. Branch discipline

For any risky ChatGPT renderer change:
- create a focused branch;
- keep the diff narrow;
- include a failing fixture or captured regression evidence;
- do not combine with unrelated CSS/manifest cleanup.

Examples:
- `fix/active-thread-scope`
- `fix/redesigned-assistant-group`
- `fix/code-card-shell`
- `test/reversed-timeline-fixtures`

## 5. Codex task format

Give Codex:
- exact bug evidence;
- exact files/functions in scope;
- explicit functions/subsystems that must not change;
- required regression fixture;
- required static validation;
- expected artifact/report fields.

Example guard:

```text
Scope: code-card DOM normalization only.
Do not change scanner pacing, active conversation scope, turn discovery,
role detection, top validation, ordering, checkpoint logic, or KaTeX.
```

This style prevented broad regressions during v1.4.0 development.

## 6. Required pre-merge checks

- JS syntax validation.
- Manifest JSON validation.
- Chrome + Firefox parity check.
- Long-chat regression.
- Rich-content regression.
- Diff review of critical functions.
- ZIP/XPI integrity check.

If a change touches scanner/top logic, add a deterministic DOM/scroll fixture.

## 7. Capture artifacts in issues

For GitHub bug reports, create an issue template requesting:
- exporter version;
- browser/version;
- page URL type (ChatGPT/Gemini/generic);
- capture report;
- MD export;
- HTML export;
- screenshots;
- whether source tab stayed focused;
- exact missing/malformed phrase.

Do not require users to publish private conversation content in a public issue. Provide a private/redacted option.

## 8. Release tagging

Recommended:
- tag stable `v1.4.0`;
- preserve original stable artifacts/checksums;
- use `v1.4.1` for narrowly scoped fixes;
- use pre-release tags for renderer experiments.

Do not reuse `v1.4.0` after modifying runtime code.

## 9. Security/privacy principles

- archival output is local-first;
- avoid sending conversation content to third-party services;
- keep checkpoint storage metadata-only unless a future feature explicitly changes the privacy model;
- document any future network access clearly.

## 10. Suggested next engineering work

Priority order:

1. deterministic regression harness for ChatGPT DOM fixtures;
2. automate Chrome/Firefox parity checks;
3. add source-level tests around active scope and redesigned assistant extraction;
4. add rich-content fixture tests;
5. only then consider shared-source build refactor.

Feature work should come after the regression harness because ChatGPT DOM changes are the dominant maintenance risk.
