# ChatGPT Archive Exporter v1.4.0 baseline import

Imported as an unchanged component baseline under:

`components/archive-exporter/`

Source archive SHA-256:

`b37af86ca4b45d1ce501ac700f08db0756bcefad81f94848f0087cfc8504b9da`

Manager checkpoint before import:

`aee9632acacdcf139c7ff586526e614ca8a32658`

Rules for the next stage:

- preserve the stable v1.4.0 runtime before regression fixtures exist;
- do not rewrite the ChatGPT scanner;
- keep acquisition/completeness separate from archive presentation;
- preserve active-conversation scope and top-certification behavior;
- preserve Chrome/Firefox capture parity unless a browser-specific difference is documented;
- add deterministic capture/rendering regression fixtures before shared-source refactoring;
- integrate through a CaptureEngine/result-output boundary rather than teaching the scanner about Manager Collections, clustering, or jobs.
