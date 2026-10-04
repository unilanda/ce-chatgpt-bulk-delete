# Stable v1.4.0 Verification Record

## Static packaging

Stable release lineage:
- RC2 rich-formatting/code-card baseline;
- RC3 active-conversation capture-boundary fix;
- RC3.1 used only as diagnostics and removed before stable.

Chrome:
- manifest internal version: `1.4.0.9`
- user-facing `version_name`: `1.4.0`

Firefox:
- manifest version: `1.4.0`
- `version_name`: intentionally omitted

Late-release verification included:
- JavaScript syntax checks;
- manifest JSON parsing;
- ZIP/XPI integrity;
- critical function comparison against RC3;
- stable KaTeX block unchanged from RC2/RC3.

## Final long-chat smoke

The final stable Voth capture reported:
- `exporterVersion = 1.4.0`
- `capturedTurns = 40`
- `captureStatus = clean`
- `rerunRecommended = false`
- correct user first turn;
- top boundary stabilized;
- exported first key matched certified top;
- zero unresolved gaps;
- zero contradictory ordering pairs;
- zero cycle breaks;
- active scope = redesigned timeline/thread surface;
- no warnings.

## Final rich-content smoke

User manually verified a separate chat containing:
- table;
- JSON/code block;
- equation.

The output looked good.

Attachment behavior was clarified:
- visible attachment chip representation is preserved;
- actual attachment file bytes are not archived.

## Release conclusion

This is sufficient to call **v1.4.0 stable**.

Future runtime modifications should advance the version rather than silently replacing the v1.4.0 baseline.
