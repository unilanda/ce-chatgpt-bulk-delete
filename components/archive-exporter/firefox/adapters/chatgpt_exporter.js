/**
 * ChatGPT Archive Exporter V1.4.0
 * Default mode: self-contained HTML + Markdown + TXT packaged in one ZIP.
 * Math CSS branch: Quick DOM speed + smaller HTML + targeted live KaTeX/code CSS.
 *
 * Use:
 * 1. Open the ChatGPT conversation page.
 * 2. Open Firefox DevTools Console if manual debugging is needed.
 * 3. This file is normally injected by the Firefox extension.
 *
 * Modes:
 * - self_contained_html       default; one portable HTML with embedded ChatGPT-like CSS
 * - native_like_html          preserves more ChatGPT DOM/classes and embeds accessible CSS
 * - replace_page_then_ctrl_s  creates a static full page in the current tab, then you press Ctrl-S
 */

(async function chatgptFullChatSaverV4() {
  "use strict";

  const CONFIG = {
    /**
     * Choose one:
     *   "offline_assets_html"   HTML + assets/archive.css in the ZIP
     *   "self_contained_html"  single portable but larger HTML
     *   "native_like_html"
     *   "replace_page_then_ctrl_s"
     */
    mode: "offline_assets_html",

    // Fast scan defaults. Increase scrollFactor for speed, lower it for safety.
    fastDelayMs: 30,
    slowDelayMs: 650,
    slowEveryNPasses: 55,
    // After a genuine aggregate stall, use a sparse 650 ms hydration checkpoint
    // instead of slowing every pass. MutationObserver-driven turn growth counts
    // as progress and resets this streak.
    adaptiveSlowAfterNoProgressPasses: 18,
    adaptiveSlowEveryNoProgressPasses: 4,
    scrollFactor: 0.80,
    maxPasses: 1400,
    topStablePassesToStop: 6,

    // Repair pass runs only if turn-index gaps are detected and you approve it.
    askRepairOnGaps: true,
    repairDelayMs: 650,
    repairScrollFactor: 0.75,
    repairMaxPasses: 350,

    // Exports. In replace_page_then_ctrl_s mode, HTML is not downloaded directly;
    // the page is replaced and you press Ctrl-S. MD/TXT backups can still download.
    downloadHtml: true,
    downloadMarkdown: true,
    downloadText: true,

    // Package outputs into one ZIP containing a folder. This is the only reliable
    // way a console script can save HTML/MD/TXT together in a folder-like bundle.
    packageAsZip: true,

    // Archive behavior.
    saveUserAsExpandedPlainText: true,
    preserveAssistantRenderedHtml: true,
    preserveDownloadCardsAndContentButtons: true,
    removeOnlyKnownControls: true,

    // Native-like mode options.
    embedAccessibleCssRules: false,
    includeStylesheetLinksInCtrlSMode: true,

    // V4.2: math formulas need layout-sensitive computed styles.
    // This fixes broken subscripts/superscripts/fractions/summation limits
    // when ChatGPT/KaTeX/MathJax CSS is not fully available offline.
    snapshotMathComputedStyles: true,

    // V4.2 Practical Fast Lite:
    // Avoid computed-style snapshots for code/table/link elements.
    // This makes HTML much smaller. Math snapshots stay enabled because they fix equations.
    snapshotNonMathComputedStyles: false,

    // Preserve syntax highlighting without copying the full computed layout of
    // every code element. Only color/font emphasis is stored on code tokens.
    snapshotCodeTokenColors: true,

    // Critical performance option:
    // First compute stable-id or role+text hash. If already collected, do not
    // clone/clean/style-process that turn again.
    skipDuplicateBeforeClone: true,

    // Size/fidelity tradeoff:
    // Remove most ChatGPT/Tailwind/data attributes from cloned fragments.
    // Keep math/code/file-chip classes, href/src/alt/title, and generic HTML structure.
    compactSelfContainedAttributes: true,

    // If true, report total HTML payload and largest turns in the capture report.
    includeHtmlSizeDiagnostics: true,

    // Fix duplicate visible lines caused by hidden accessibility/math layers
    // becoming visible after slimming CSS/classes.
    removeHiddenAccessibilityLayers: true,
    removeAdjacentDuplicateTextBlocks: true,

    // Replace full ChatGPT file-card DOM with one compact static pill.
    // This avoids huge/cluttered attachment tiles in self-contained exports.
    simplifyFileTilesBeforeClone: true,

    // Replace full ChatGPT citation/reference chip DOM with one compact static pill.
    // This fixes giant favicons/reference icons in saved HTML when Tailwind CSS is absent.
    simplifyCitationLinksBeforeClone: true,

    // Remove visible copy/table/control widgets that can render as giant broken icons.
    removeArchiveControlWidgets: true,

    // Targeted fidelity: copy only live math/code CSS from the current ChatGPT page.
    // This is much smaller than embedAccessibleCssRules: true, but preserves KaTeX
    // fonts/classes such as \mathcal{Z}, integral glyphs, fractions, and code tokens.
    embedTargetedMathCodeCssRules: true,
    targetedCssMaxChars: 450000,

    // Deterministic complete unscoped OpenAI KaTeX layout CSS.
    // This avoids relying on runtime CSSOM extraction, which can omit KaTeX
    // rules and produce broken limits, superscripts, fractions, and operators.
    useBundledKatexCss: true,

    // Quality math default for this branch.
    // If you need smaller/faster output, change to "inline".
    mathStyleMode: "computed",

    // Extension UX.
    // The extension popup is the launcher/controller. The in-page panel is optional.
    showInPageProgress: true,

    // Progressive-history boundary certification.
    // ChatGPT can now report scrollTop=0 for only the currently hydrated batch.
    // Before accepting "top", keep requesting upward history for ~4 seconds.
    enableTopBoundaryProbe: true,
    topBoundaryProbeRounds: 3,
    topBoundaryProbeCyclesPerRound: 12,
    topBoundaryProbeDelayMs: 250,
    topBoundaryRetriggerDelayMs: 180,
    topBoundaryNudgeFraction: 0.30,
    topBoundaryNudgeMaxPx: 320,

    // Background-tab robustness.
    // A selected tab may keep running when another app/window has focus.
    // We pause only if the document itself becomes hidden.
    pauseWhenDocumentHidden: true,
    resumeHydrationGraceMs: 900,
    schedulerStallFactor: 4,
    schedulerStallSlackMs: 650,

    // V1.4.0-alpha2 added a second DOM acquisition driver for ChatGPT's
    // redesigned virtualized timeline. The legacy adapter remains the primary path.
    alphaDiagnosticsEnabled: true,
    alphaCanonicalProbeEnabled: false,
    alphaCanonicalProbeTimeoutMs: 5000,

    // V1.4.0-alpha3: redesigned ChatGPT timelines can sit at a temporary
    // oldest boundary while an older history batch is still loading.  Watch
    // the renderer's own history spinner and dynamic timeline range before
    // allowing the generic fixed-duration top certification to begin.
    enableRedesignedTopHydrationGuard: true,
    redesignedTopHydrationPollMs: 500,
    redesignedTopHydrationNudgeDelayMs: 100,
    redesignedTopHydrationMaxMs: 60000,
    redesignedTopHydrationQuietPollsAfterSpinner: 3,
    redesignedTopHydrationQuietPollsWithoutSpinner: 4,
    redesignedTopHydrationNudgeViewports: 2,

    // V1.3.6 capture reliability. These are intentionally cheap on the normal
    // fast path; extra waits/backtracking occur only after suspicious evidence.
    gapGuardMode: "repair", // repair | warn | off
    gapGuardConfirmDelayMs: 80,
    gapGuardRecoveryDelayMs: 120,
    gapGuardRecoveryScrollFactor: 0.42,
    enableHydrationObserver: true,
    hydrationObserverDebounceMs: 60,
    enableRichBlockValidation: true,
    richBlockConfirmationDelayMs: 180,
    richBlockMaxConfirmationRounds: 2,
    enableKnownBoundaryCheckpoint: true,
    knownBoundaryMaxRetries: 2,
    knownBoundaryRetryDelayMs: 700,
    enableDeepTopChallenge: true,
    deepTopChallengeViewports: 2.2,
    deepTopChallengeDownDelayMs: 180,
    deepTopChallengeReturnDelayMs: 700,

    // V1.3.4: a conversation must have at least one real turn before the top
    // boundary can be certified. If the initial DOM exposes zero turns, perform
    // a short recovery that re-detects the scroll root and retries collection.
    zeroTurnRecoveryAttempts: 3,
    zeroTurnRecoveryDelayMs: 400,
    zeroTurnScrollCandidateLimit: 10,

    // Debug.
    verboseConsoleLog: false
  };

  // The side panel/service worker sets options before injecting this adapter.
  Object.assign(
    CONFIG,
    window.__ARCHIVE_EXPORTER_OPTIONS__ ||
    window.__CHATGPT_FULL_CHAT_SAVER_OPTIONS__ ||
    {}
  );

  const BUNDLED_KATEX_CSS = String.raw`.sr-only,.katex .katex-mathml{contain:strict;content-visibility:auto;contain-intrinsic-size:1px}
.\[\&_\.katex\]\:\!text-\[1em\] .katex{font-size:1em!important}
.\[\&_\.katex\]\:text-\[1\.45em\] .katex{font-size:1.45em}
.\[\&_\.katex\]\:text-\[1em\] .katex{font-size:1em}
.\[\&_\.katex\]\:text-inherit .katex{color:inherit}
.max-\[520px\]\:\[\&_\.katex\]\:text-\[1\.12em\] .katex{font-size:1.12em}
.\[\&\.katex\]\:text-\[1em\].katex{font-size:1em}
.result-streaming .katex-error{display:none}
@font-face{font-family:KaTeX_AMS;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_AMS-Regular-e1why8ff.woff2)format("woff2")}
@font-face{font-family:KaTeX_Caligraphic;font-style:normal;font-weight:700;src:url(https://chatgpt.com/cdn/assets/KaTeX_Caligraphic-Bold-n63xiolk.woff2)format("woff2")}
@font-face{font-family:KaTeX_Caligraphic;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Caligraphic-Regular-npwmqylf.woff2)format("woff2")}
@font-face{font-family:KaTeX_Fraktur;font-style:normal;font-weight:700;src:url(https://chatgpt.com/cdn/assets/KaTeX_Fraktur-Bold-ikhebgtj.woff2)format("woff2")}
@font-face{font-family:KaTeX_Fraktur;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Fraktur-Regular-i0egury6.woff2)format("woff2")}
@font-face{font-family:KaTeX_Main;font-style:normal;font-weight:700;src:url(https://chatgpt.com/cdn/assets/KaTeX_Main-Bold-ktk38ybk.woff2)format("woff2")}
@font-face{font-family:KaTeX_Main;font-style:italic;font-weight:700;src:url(https://chatgpt.com/cdn/assets/KaTeX_Main-BoldItalic-oj033t4i.woff2)format("woff2")}
@font-face{font-family:KaTeX_Main;font-style:italic;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Main-Italic-2p4bq1jf.woff2)format("woff2")}
@font-face{font-family:KaTeX_Main;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Main-Regular-hbkzldb8.woff2)format("woff2")}
@font-face{font-family:KaTeX_Math;font-style:italic;font-weight:700;src:url(https://chatgpt.com/cdn/assets/KaTeX_Math-BoldItalic-jdo1yxu8.woff2)format("woff2")}
@font-face{font-family:KaTeX_Math;font-style:italic;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Math-Italic-cz4b2ure.woff2)format("woff2")}
@font-face{font-family:KaTeX_SansSerif;font-style:normal;font-weight:700;src:url(https://chatgpt.com/cdn/assets/KaTeX_SansSerif-Bold-otxc8itm.woff2)format("woff2")}
@font-face{font-family:KaTeX_SansSerif;font-style:italic;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_SansSerif-Italic-k4kksncm.woff2)format("woff2")}
@font-face{font-family:KaTeX_SansSerif;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_SansSerif-Regular-ltw53ck4.woff2)format("woff2")}
@font-face{font-family:KaTeX_Script;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Script-Regular-oybd33cp.woff2)format("woff2")}
@font-face{font-family:KaTeX_Size1;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Size1-Regular-cjccv44r.woff2)format("woff2")}
@font-face{font-family:KaTeX_Size2;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Size2-Regular-onxq3bzc.woff2)format("woff2")}
@font-face{font-family:KaTeX_Size3;font-style:normal;font-weight:400;src:url(data:font/woff2;base64,d09GMgABAAAAAA4oAA4AAAAAHbQAAA3TAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAABmAAgRQIDgmcDBEICo1oijYBNgIkA14LMgAEIAWJAAeBHAyBHBvbGiMRdnO0IkRRkiYDgr9KsJ1NUAf2kILNxgUmgqIgq1P89vcbIcmsQbRps3vCcXdYOKSWEPEKgZgQkprQQsxIXUgq0DqpGKmIvrgkeVGtEQD9DzAO29fM9jYhxZEsL2FeURH2JN4MIcTdO049NCVdxQ/w9NrSYFEBKTDKpLKfNkCGDc1RwjZLQcm3vqJ2UW9Xfa3tgAHz6ivp6vgC2yD4/6352ndnN0X0TL7seypkjZlMsjmZnf0Mm5Q+JykRWQBKCVCVPbARPXWyQtb5VgLB6Biq7/Uixcj2WGqdI8tGSgkuRG+t910GKP2D7AQH0DB9FMDW/obJZ8giFI3Wg8Cvevz0M+5m0rTh7XDBlvo9Y4vm13EXmfttwI4mBo1EG15fxJhUiCLbiiyCf/ZA6MFAhg3pGIZGdGIVjtPn6UcMk9A/UUr9PhoNsCENw1APAq0gpH73e+M+0ueyHbabc3vkbcdtzcf/fiy+NxQEjf9ud/ELBHAXJ0nk4z+MXH2Ev/kWyV4k7SkvpPc9Qr38F6RPWnM9cN6DJ0AdD1BhtgABtmoRoFCvPsBAumNm6soZG2Gk5GyVTo2sJncSyp0jQTYoR6WDvTwaaEcHsxHfvuWhHA3a6bN7twRKtcGok6NsCi7jYRrM2jExsUFMxMQYuJbMhuWNOumEJy9hi29Dmg5zMp/A5+hhPG19j1vBrq8JTLr8ki5VLPmG/PynJHVul440bxg5xuymHUFPBshC+nA9I1FmwbRBTNHAcik3Oae0cxKoI3MOriM42UrPe51nsaGxJ+WfXubAsP84aabUlQSJ1IiE0iPETLUU4CATgfXSCSpuRFRmCGbO+wSpAnzaeaCYW1VNEysRtuXCEL1kUFUbbtMv3Tilt/1c11jt3Q5bbMa84cpWipp8Elw3MZhOHsOlwwVUQM3lAR35JiFQbaYCRnMF2lxAWoOg2gyoIV4PouX8HytNIfLhqpJtXB4vjiViUI8IJ7bkC4ikkQvKksnOTKICwnqWSZ9YS5f0WCxmpgjbIq7EJcM4aI2nmhLNY2JIUgOjXZFWBHb+x5oh6cwb0Tv1ackHdKi0I9OO2wE9aogIOn540CCCziyhN+IaejtgAONKznHlHyutPrHGwCx9S6B8kfS4Mfi4Eyv7OU730bT1SCBjt834cXsf43zVjPUqqJjgrjeGnBxSG4aYAKFuVbeCfkDIjAqMb6yLNIbCuvXhMH2/+k2vkNpkORhR59N1CkzoOENvneIosjYmuTxlhUzaGEJQ/iWqx4dmwpmKjrwTiTGTCVozNAYqk/zXOndWxuWSmJkQpJw3pK5KX6QrLt5LATMqpmPAQhkhK6PUjzHUn7E0gHE0kPE0iKkolgkUx9SZmVAdDgpffdyJKg3k7VmzYGCwVXGz/tXmkOIp+vcWs+EMuhhvN0h9uhfzWJziBQmCREGSIFmQIkgVpAnSBRmC//6hkLZwaVhwxlrJSOdqlFtOYxlau9F2QN5Y98xmIAsiM1HVp2VFX+DHHGg6Ecjh3vmqtidX3qHI2qycTk/iwxSt5UzTmEP92ZBnEWTk4Mx8Mpl78ZDokxg/KWb+Q0QkvdKVmq3TMW+RXEgrsziSAfNXFMhDc60N5N9jQzjfO0kBKpUZl0ZmwJ41j/B9Hz6wmRaJB84niNmQrzp9eSlQCDDzazGDdVi3P36VZQ+Jy4f9UBNp+3zTjqI4abaFAm+GShVaXlsGdF3FYzZcDI6cori4kMxUECl9IjJZpzkvitAoxKue+90pDMvcKRxLl53TmOKCmV/xRolNKSqqUxc6LStOETmFOiLZZptlZepcKiAzteG8PEdpnQpbOMNcMsR4RR2Bs0cKFEvSmIjAFcnarqwUL4lDhHmnVkwu1IwshbiCcgvOheZuYyOteufZZwlcTlLgnZ3o/WcYdzZHW/WGaqaVfmTZ1aWCceJjkbZqsfbkOtcFlUZM/jy+hXHDbaUobWqqXaeWobbLO99yG5N3U4wxco0rQGGcOLASFMXeJoham8M+/x6O2WywK2l4HGbq1CoUyC/IZikQhdq3SiuNrvAEj0AVu9x2x3lp/xWzahaxidezFVtdcb5uEnzyl0ZmYiuKI0exvCd4Xc9CV1KB0db00z92wDPde0kukbvZIWN6jUWFTmPIC/Y4UPCm8UfDTFZpZNon1qLFTkBhxzB+FjQRA2Q/YRJT8pQigslMaUpFyAG8TMlXigiqmAZX4xgijKjRlGpLE0GdplRfCaJo0JQaSxNBk6ZmMzcya0FmrcisDdn0Q3HI2sWSppYigmlM1XT/kLQZSNpMJG0WkjYbSZuDpM1F0uYhFc1HxU4m1QJjDK6iL0S5uSj5rgXc3RejEigtcRBtqYPQsiTskmO5vosV+q4VGIKbOkDg0jtRrq+Em1YloaTFar3EGr1EUC8R0kus1Uus00usL97ABr2BjXoDm/QGNhuWtMVBKOwg/i78lT7hBsAvDmwHc/ao3vmUbBmhjeYySZNWvGkfZAgISDSaDo1SVpzGDsAEkF8B+gEapViUoZgUWXcRIGFZNm6gWbAKk0bp0k1MHG9fLYtV4iS2SmLEQFARzRcnf9PUS0LVn05/J9MiRRBU3v2IrvW974v4N00L7ZMk0wXP1409CHo/an8zTRHD3eSJ6m8D4YMkZNl3M79sqeuAsr/m3f+8/yl7A50aiAEJgeBeMWzu7ui9UfUBCe2TIqZIoOd/3/udRBOQidQZUERzb2/VwZN1H/Sju82ew2H2Wfr6qvfVf3hqwDvAIpkQVFy4B9Pe9e4/XvPeceu7h3dvO56iJPf0+A6cqA2ip18ER+iFgggiuOkvj24bby0N9j2UHIkgqIt+sVgfodC4YghLSMjSZbH0VR/6dMDrYJeKHilKTemt6v6kvzvn3/RrdWtr0GoN/xL+Sex/cPYLUpepx9cz/D46UPU5KXgAQa+NDps1v6J3xP1i2HtaDB0M9aX2deA7SYff//+gUCovMmIK/qfsFcOk+4Y5ZN97XlG6zebqtMbKgeRFi51vnxTQYBUik2rS/Cn6PC8ADR8FGxsRPB82dzfND90gIcshOcYUkfjherBz53odpm6TP8txlwOZ71xmfHHOvq053qFF/MRlS3jP0ELudrf2OeN8DHvp6ZceLe8qKYvWz/7yp0u4dKPfli3CYq0O13Ih71mylJ80tOi10On8wi+F4+LWgDPeJ30msSQt9/vkmHq9/Lvo2b461mP801v3W4xTcs6CbvF9UDdrSt+A8OUbpSh55qAUFXWznBBfdeJ8a4d7ugT5tvxUza3h9m4H7ptTqiG4z0g5dc0X29OcGlhpGFMpQo9ytTS+NViZpNdvU4kWx+LKxNY10kQ1yqGXrhe4/1nvP7E+nd5A92TtaRplbHSqoIdOqtRWti+fkB5/n1+/VvCmz12pG1kpQWsfi1ftlBobm0bpngs16CHkbIwdLnParxtTV3QYRlfJ0KFskH7pdN/YDn+yRuSd7sNH3aO0DYPggk6uWuXrfOc+fa3VTxFVvKaNxHsiHmsXyCLIE5yuOeN3/Jdf8HBL/5M6shjyhxHx9BjB1O0+4NLOnjLLSxwO7ukN4jMbOIcD879KLSi6Pk61Oqm2377n8079PXEEQ7cy7OKEC9nbpet118fxweTafpt69x/Bt8UqGzNQt7aelpc44dn5cqhwf71+qKp/Zf/+a0zcizOUWpl/iBcSXip0pplkatCchoH5c5aUM8I7/dWxAej8WicPL1URFZ9BDJelUwEwTkGqUhgSlydVes95YdXvhh9Gfz/aeFWvgVb4tuLbcv4+wLdutVZv/cUonwBD/6eDlE0aSiKK/uoH3+J1wDE/jMVqY2ysGufN84oIXB0sPzy8ollX/LegY74DgJXJR57sn+VGza0x3DnuIgABFM15LmajjjsNlYj+JEZGbuRYcAMOWxFkPN2w6Wd46xo4gVWQR/X4lyI/R6K/YK0110GzudPRW7Y+UOBGTfNNzHeYT0fiH0taunBpq9HEW8OKSaBGj21L0MqenEmNRWBAWDWAk4CpNoEZJ2tTaPFgbQYj8HxtFilErs3BTRwT8uO1NXQaWfIotchmPkAF5mMBAliEmZiOGVgCG9LgRzpscMAOOwowlT3JhusdazXGSC/hxR3UlmWVwWHpOIKheqONvjyhSiTHIkVUco5bnji8m//zL7PKaT1Vl5I6UE609f+gkr6MZKVyKc7zJRmCahLsdlyA5fdQkRSan9LgnnLEyGSkaKJCJog0wAgvepWBt80+1yKln1bMVtCljfNWDueKLsWwaEbBSfSPTEmVRsUcYYMnEjcjeyCZzBXK9E9BYBXLKjOSpUDR+nEV3TFSUdQaz+ot98QxgXwx0GQ+EEUAKB2qZPkQQ0GqFD8UPFMqyaCHM24BZmSGic9EYMagKizOw9Hz50DMrDLrqqLkTAhplMictiCAx5S3BIUQdeJeLnBy2CNtMfz6cV4u8XKoFZQesbf9YZiIERiHjaNodDW6LgcirX/mPnJIkBGDUpTBhSa0EIr38D5hCIszhCM8URGBqImoWjpvpt1ebu/v3Gl3qJfMnNM+9V+kiRFyROTPHQWOcs1dNW94/ukKMPZBvDi55i5CttdeJz84DLngLqjcdwEZ87bFFR8CIG35OAkDVN6VRDZ7aq67NteYqZ2lpT8oYB2CytoBd6VuAx4WgiAsnuj3WohG+LugzXiQRDeM3XYXlULv4dp5VFYC)format("woff2")}
@font-face{font-family:KaTeX_Size4;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Size4-Regular-nv9nppzf.woff2)format("woff2")}
@font-face{font-family:KaTeX_Typewriter;font-style:normal;font-weight:400;src:url(https://chatgpt.com/cdn/assets/KaTeX_Typewriter-Regular-iqvr3vwu.woff2)format("woff2")}
.katex{text-rendering:auto;text-indent:0;direction:ltr;unicode-bidi:isolate;font:1.21em/1.2 KaTeX_Main,Times New Roman,serif}
.katex *{border-color:currentColor;-ms-high-contrast-adjust:none!important}
.katex .katex-version:after{content:"0.16.0"}
.katex .katex-mathml{clip:rect(1px, 1px, 1px, 1px);border:0;width:1px;height:1px;padding:0;position:absolute;overflow:hidden}
.katex .katex-html>.newline{display:block}
.katex .base{white-space:nowrap;width:min-content;position:relative}
.katex .base,.katex .strut{display:inline-block}
.katex .textbf{font-weight:700}
.katex .textit{font-style:italic}
.katex .textrm{font-family:KaTeX_Main}
.katex .textsf{font-family:KaTeX_SansSerif}
.katex .texttt{font-family:KaTeX_Typewriter}
.katex .mathnormal{font-family:KaTeX_Math;font-style:italic}
.katex .mathit{font-family:KaTeX_Main;font-style:italic}
.katex .mathrm{font-style:normal}
.katex .mathbf{font-family:KaTeX_Main;font-weight:700}
.katex .boldsymbol{font-family:KaTeX_Math;font-style:italic;font-weight:700}
.katex .amsrm,.katex .mathbb,.katex .textbb{font-family:KaTeX_AMS}
.katex .mathcal{font-family:KaTeX_Caligraphic}
.katex .mathfrak,.katex .textfrak{font-family:KaTeX_Fraktur}
.katex .mathtt{font-family:KaTeX_Typewriter}
.katex .mathscr,.katex .textscr{font-family:KaTeX_Script}
.katex .mathsf,.katex .textsf{font-family:KaTeX_SansSerif}
.katex .mathboldsf,.katex .textboldsf{font-family:KaTeX_SansSerif;font-weight:700}
.katex .mathitsf,.katex .textitsf{font-family:KaTeX_SansSerif;font-style:italic}
.katex .mainrm{font-family:KaTeX_Main;font-style:normal}
.katex .vlist-t{border-collapse:collapse;table-layout:fixed;display:inline-table}
.katex .vlist-r{display:table-row}
.katex .vlist{vertical-align:bottom;display:table-cell;position:relative}
.katex .vlist>span{height:0;display:block;position:relative}
.katex .vlist>span>span{display:inline-block}
.katex .vlist>span>.pstrut{width:0;overflow:hidden}
.katex .vlist-t2{margin-right:-2px}
.katex .vlist-s{vertical-align:bottom;width:2px;min-width:2px;font-size:1px;display:table-cell}
.katex .vbox{flex-direction:column;align-items:baseline;display:inline-flex}
.katex .hbox{width:100%}
.katex .hbox,.katex .thinbox{flex-direction:row;display:inline-flex}
.katex .thinbox{width:0;max-width:0}
.katex .msupsub{text-align:left}
.katex .mfrac>span>span{text-align:center}
.katex .mfrac .frac-line{border-bottom-style:solid;width:100%;display:inline-block}
.katex .hdashline,.katex .hline,.katex .mfrac .frac-line,.katex .overline .overline-line,.katex .rule,.katex .underline .underline-line{min-height:1px}
.katex .mspace{display:inline-block}
.katex .clap,.katex .llap,.katex .rlap{width:0;position:relative}
.katex .clap>.inner,.katex .llap>.inner,.katex .rlap>.inner{position:absolute}
.katex .clap>.fix,.katex .llap>.fix,.katex .rlap>.fix{display:inline-block}
.katex .llap>.inner{right:0}
.katex .clap>.inner,.katex .rlap>.inner{left:0}
.katex .clap>.inner>span{margin-left:-50%;margin-right:50%}
.katex .rule{border:0 solid;display:inline-block;position:relative}
.katex .hline,.katex .overline .overline-line,.katex .underline .underline-line{border-bottom-style:solid;width:100%;display:inline-block}
.katex .hdashline{border-bottom-style:dashed;width:100%;display:inline-block}
.katex .sqrt>.root{margin-left:.277778em;margin-right:-.555556em}
.katex .fontsize-ensurer.reset-size1.size1,.katex .sizing.reset-size1.size1{font-size:1em}
.katex .fontsize-ensurer.reset-size1.size2,.katex .sizing.reset-size1.size2{font-size:1.2em}
.katex .fontsize-ensurer.reset-size1.size3,.katex .sizing.reset-size1.size3{font-size:1.4em}
.katex .fontsize-ensurer.reset-size1.size4,.katex .sizing.reset-size1.size4{font-size:1.6em}
.katex .fontsize-ensurer.reset-size1.size5,.katex .sizing.reset-size1.size5{font-size:1.8em}
.katex .fontsize-ensurer.reset-size1.size6,.katex .sizing.reset-size1.size6{font-size:2em}
.katex .fontsize-ensurer.reset-size1.size7,.katex .sizing.reset-size1.size7{font-size:2.4em}
.katex .fontsize-ensurer.reset-size1.size8,.katex .sizing.reset-size1.size8{font-size:2.88em}
.katex .fontsize-ensurer.reset-size1.size9,.katex .sizing.reset-size1.size9{font-size:3.456em}
.katex .fontsize-ensurer.reset-size1.size10,.katex .sizing.reset-size1.size10{font-size:4.148em}
.katex .fontsize-ensurer.reset-size1.size11,.katex .sizing.reset-size1.size11{font-size:4.976em}
.katex .fontsize-ensurer.reset-size2.size1,.katex .sizing.reset-size2.size1{font-size:.833333em}
.katex .fontsize-ensurer.reset-size2.size2,.katex .sizing.reset-size2.size2{font-size:1em}
.katex .fontsize-ensurer.reset-size2.size3,.katex .sizing.reset-size2.size3{font-size:1.16667em}
.katex .fontsize-ensurer.reset-size2.size4,.katex .sizing.reset-size2.size4{font-size:1.33333em}
.katex .fontsize-ensurer.reset-size2.size5,.katex .sizing.reset-size2.size5{font-size:1.5em}
.katex .fontsize-ensurer.reset-size2.size6,.katex .sizing.reset-size2.size6{font-size:1.66667em}
.katex .fontsize-ensurer.reset-size2.size7,.katex .sizing.reset-size2.size7{font-size:2em}
.katex .fontsize-ensurer.reset-size2.size8,.katex .sizing.reset-size2.size8{font-size:2.4em}
.katex .fontsize-ensurer.reset-size2.size9,.katex .sizing.reset-size2.size9{font-size:2.88em}
.katex .fontsize-ensurer.reset-size2.size10,.katex .sizing.reset-size2.size10{font-size:3.45667em}
.katex .fontsize-ensurer.reset-size2.size11,.katex .sizing.reset-size2.size11{font-size:4.14667em}
.katex .fontsize-ensurer.reset-size3.size1,.katex .sizing.reset-size3.size1{font-size:.714286em}
.katex .fontsize-ensurer.reset-size3.size2,.katex .sizing.reset-size3.size2{font-size:.857143em}
.katex .fontsize-ensurer.reset-size3.size3,.katex .sizing.reset-size3.size3{font-size:1em}
.katex .fontsize-ensurer.reset-size3.size4,.katex .sizing.reset-size3.size4{font-size:1.14286em}
.katex .fontsize-ensurer.reset-size3.size5,.katex .sizing.reset-size3.size5{font-size:1.28571em}
.katex .fontsize-ensurer.reset-size3.size6,.katex .sizing.reset-size3.size6{font-size:1.42857em}
.katex .fontsize-ensurer.reset-size3.size7,.katex .sizing.reset-size3.size7{font-size:1.71429em}
.katex .fontsize-ensurer.reset-size3.size8,.katex .sizing.reset-size3.size8{font-size:2.05714em}
.katex .fontsize-ensurer.reset-size3.size9,.katex .sizing.reset-size3.size9{font-size:2.46857em}
.katex .fontsize-ensurer.reset-size3.size10,.katex .sizing.reset-size3.size10{font-size:2.96286em}
.katex .fontsize-ensurer.reset-size3.size11,.katex .sizing.reset-size3.size11{font-size:3.55429em}
.katex .fontsize-ensurer.reset-size4.size1,.katex .sizing.reset-size4.size1{font-size:.625em}
.katex .fontsize-ensurer.reset-size4.size2,.katex .sizing.reset-size4.size2{font-size:.75em}
.katex .fontsize-ensurer.reset-size4.size3,.katex .sizing.reset-size4.size3{font-size:.875em}
.katex .fontsize-ensurer.reset-size4.size4,.katex .sizing.reset-size4.size4{font-size:1em}
.katex .fontsize-ensurer.reset-size4.size5,.katex .sizing.reset-size4.size5{font-size:1.125em}
.katex .fontsize-ensurer.reset-size4.size6,.katex .sizing.reset-size4.size6{font-size:1.25em}
.katex .fontsize-ensurer.reset-size4.size7,.katex .sizing.reset-size4.size7{font-size:1.5em}
.katex .fontsize-ensurer.reset-size4.size8,.katex .sizing.reset-size4.size8{font-size:1.8em}
.katex .fontsize-ensurer.reset-size4.size9,.katex .sizing.reset-size4.size9{font-size:2.16em}
.katex .fontsize-ensurer.reset-size4.size10,.katex .sizing.reset-size4.size10{font-size:2.5925em}
.katex .fontsize-ensurer.reset-size4.size11,.katex .sizing.reset-size4.size11{font-size:3.11em}
.katex .fontsize-ensurer.reset-size5.size1,.katex .sizing.reset-size5.size1{font-size:.555556em}
.katex .fontsize-ensurer.reset-size5.size2,.katex .sizing.reset-size5.size2{font-size:.666667em}
.katex .fontsize-ensurer.reset-size5.size3,.katex .sizing.reset-size5.size3{font-size:.777778em}
.katex .fontsize-ensurer.reset-size5.size4,.katex .sizing.reset-size5.size4{font-size:.888889em}
.katex .fontsize-ensurer.reset-size5.size5,.katex .sizing.reset-size5.size5{font-size:1em}
.katex .fontsize-ensurer.reset-size5.size6,.katex .sizing.reset-size5.size6{font-size:1.11111em}
.katex .fontsize-ensurer.reset-size5.size7,.katex .sizing.reset-size5.size7{font-size:1.33333em}
.katex .fontsize-ensurer.reset-size5.size8,.katex .sizing.reset-size5.size8{font-size:1.6em}
.katex .fontsize-ensurer.reset-size5.size9,.katex .sizing.reset-size5.size9{font-size:1.92em}
.katex .fontsize-ensurer.reset-size5.size10,.katex .sizing.reset-size5.size10{font-size:2.30444em}
.katex .fontsize-ensurer.reset-size5.size11,.katex .sizing.reset-size5.size11{font-size:2.76444em}
.katex .fontsize-ensurer.reset-size6.size1,.katex .sizing.reset-size6.size1{font-size:.5em}
.katex .fontsize-ensurer.reset-size6.size2,.katex .sizing.reset-size6.size2{font-size:.6em}
.katex .fontsize-ensurer.reset-size6.size3,.katex .sizing.reset-size6.size3{font-size:.7em}
.katex .fontsize-ensurer.reset-size6.size4,.katex .sizing.reset-size6.size4{font-size:.8em}
.katex .fontsize-ensurer.reset-size6.size5,.katex .sizing.reset-size6.size5{font-size:.9em}
.katex .fontsize-ensurer.reset-size6.size6,.katex .sizing.reset-size6.size6{font-size:1em}
.katex .fontsize-ensurer.reset-size6.size7,.katex .sizing.reset-size6.size7{font-size:1.2em}
.katex .fontsize-ensurer.reset-size6.size8,.katex .sizing.reset-size6.size8{font-size:1.44em}
.katex .fontsize-ensurer.reset-size6.size9,.katex .sizing.reset-size6.size9{font-size:1.728em}
.katex .fontsize-ensurer.reset-size6.size10,.katex .sizing.reset-size6.size10{font-size:2.074em}
.katex .fontsize-ensurer.reset-size6.size11,.katex .sizing.reset-size6.size11{font-size:2.488em}
.katex .fontsize-ensurer.reset-size7.size1,.katex .sizing.reset-size7.size1{font-size:.416667em}
.katex .fontsize-ensurer.reset-size7.size2,.katex .sizing.reset-size7.size2{font-size:.5em}
.katex .fontsize-ensurer.reset-size7.size3,.katex .sizing.reset-size7.size3{font-size:.583333em}
.katex .fontsize-ensurer.reset-size7.size4,.katex .sizing.reset-size7.size4{font-size:.666667em}
.katex .fontsize-ensurer.reset-size7.size5,.katex .sizing.reset-size7.size5{font-size:.75em}
.katex .fontsize-ensurer.reset-size7.size6,.katex .sizing.reset-size7.size6{font-size:.833333em}
.katex .fontsize-ensurer.reset-size7.size7,.katex .sizing.reset-size7.size7{font-size:1em}
.katex .fontsize-ensurer.reset-size7.size8,.katex .sizing.reset-size7.size8{font-size:1.2em}
.katex .fontsize-ensurer.reset-size7.size9,.katex .sizing.reset-size7.size9{font-size:1.44em}
.katex .fontsize-ensurer.reset-size7.size10,.katex .sizing.reset-size7.size10{font-size:1.72833em}
.katex .fontsize-ensurer.reset-size7.size11,.katex .sizing.reset-size7.size11{font-size:2.07333em}
.katex .fontsize-ensurer.reset-size8.size1,.katex .sizing.reset-size8.size1{font-size:.347222em}
.katex .fontsize-ensurer.reset-size8.size2,.katex .sizing.reset-size8.size2{font-size:.416667em}
.katex .fontsize-ensurer.reset-size8.size3,.katex .sizing.reset-size8.size3{font-size:.486111em}
.katex .fontsize-ensurer.reset-size8.size4,.katex .sizing.reset-size8.size4{font-size:.555556em}
.katex .fontsize-ensurer.reset-size8.size5,.katex .sizing.reset-size8.size5{font-size:.625em}
.katex .fontsize-ensurer.reset-size8.size6,.katex .sizing.reset-size8.size6{font-size:.694444em}
.katex .fontsize-ensurer.reset-size8.size7,.katex .sizing.reset-size8.size7{font-size:.833333em}
.katex .fontsize-ensurer.reset-size8.size8,.katex .sizing.reset-size8.size8{font-size:1em}
.katex .fontsize-ensurer.reset-size8.size9,.katex .sizing.reset-size8.size9{font-size:1.2em}
.katex .fontsize-ensurer.reset-size8.size10,.katex .sizing.reset-size8.size10{font-size:1.44028em}
.katex .fontsize-ensurer.reset-size8.size11,.katex .sizing.reset-size8.size11{font-size:1.72778em}
.katex .fontsize-ensurer.reset-size9.size1,.katex .sizing.reset-size9.size1{font-size:.289352em}
.katex .fontsize-ensurer.reset-size9.size2,.katex .sizing.reset-size9.size2{font-size:.347222em}
.katex .fontsize-ensurer.reset-size9.size3,.katex .sizing.reset-size9.size3{font-size:.405093em}
.katex .fontsize-ensurer.reset-size9.size4,.katex .sizing.reset-size9.size4{font-size:.462963em}
.katex .fontsize-ensurer.reset-size9.size5,.katex .sizing.reset-size9.size5{font-size:.520833em}
.katex .fontsize-ensurer.reset-size9.size6,.katex .sizing.reset-size9.size6{font-size:.578704em}
.katex .fontsize-ensurer.reset-size9.size7,.katex .sizing.reset-size9.size7{font-size:.694444em}
.katex .fontsize-ensurer.reset-size9.size8,.katex .sizing.reset-size9.size8{font-size:.833333em}
.katex .fontsize-ensurer.reset-size9.size9,.katex .sizing.reset-size9.size9{font-size:1em}
.katex .fontsize-ensurer.reset-size9.size10,.katex .sizing.reset-size9.size10{font-size:1.20023em}
.katex .fontsize-ensurer.reset-size9.size11,.katex .sizing.reset-size9.size11{font-size:1.43981em}
.katex .fontsize-ensurer.reset-size10.size1,.katex .sizing.reset-size10.size1{font-size:.24108em}
.katex .fontsize-ensurer.reset-size10.size2,.katex .sizing.reset-size10.size2{font-size:.289296em}
.katex .fontsize-ensurer.reset-size10.size3,.katex .sizing.reset-size10.size3{font-size:.337512em}
.katex .fontsize-ensurer.reset-size10.size4,.katex .sizing.reset-size10.size4{font-size:.385728em}
.katex .fontsize-ensurer.reset-size10.size5,.katex .sizing.reset-size10.size5{font-size:.433944em}
.katex .fontsize-ensurer.reset-size10.size6,.katex .sizing.reset-size10.size6{font-size:.48216em}
.katex .fontsize-ensurer.reset-size10.size7,.katex .sizing.reset-size10.size7{font-size:.578592em}
.katex .fontsize-ensurer.reset-size10.size8,.katex .sizing.reset-size10.size8{font-size:.694311em}
.katex .fontsize-ensurer.reset-size10.size9,.katex .sizing.reset-size10.size9{font-size:.833173em}
.katex .fontsize-ensurer.reset-size10.size10,.katex .sizing.reset-size10.size10{font-size:1em}
.katex .fontsize-ensurer.reset-size10.size11,.katex .sizing.reset-size10.size11{font-size:1.19961em}
.katex .fontsize-ensurer.reset-size11.size1,.katex .sizing.reset-size11.size1{font-size:.200965em}
.katex .fontsize-ensurer.reset-size11.size2,.katex .sizing.reset-size11.size2{font-size:.241158em}
.katex .fontsize-ensurer.reset-size11.size3,.katex .sizing.reset-size11.size3{font-size:.281351em}
.katex .fontsize-ensurer.reset-size11.size4,.katex .sizing.reset-size11.size4{font-size:.321543em}
.katex .fontsize-ensurer.reset-size11.size5,.katex .sizing.reset-size11.size5{font-size:.361736em}
.katex .fontsize-ensurer.reset-size11.size6,.katex .sizing.reset-size11.size6{font-size:.401929em}
.katex .fontsize-ensurer.reset-size11.size7,.katex .sizing.reset-size11.size7{font-size:.482315em}
.katex .fontsize-ensurer.reset-size11.size8,.katex .sizing.reset-size11.size8{font-size:.578778em}
.katex .fontsize-ensurer.reset-size11.size9,.katex .sizing.reset-size11.size9{font-size:.694534em}
.katex .fontsize-ensurer.reset-size11.size10,.katex .sizing.reset-size11.size10{font-size:.833601em}
.katex .fontsize-ensurer.reset-size11.size11,.katex .sizing.reset-size11.size11{font-size:1em}
.katex .delimsizing.size1{font-family:KaTeX_Size1}
.katex .delimsizing.size2{font-family:KaTeX_Size2}
.katex .delimsizing.size3{font-family:KaTeX_Size3}
.katex .delimsizing.size4{font-family:KaTeX_Size4}
.katex .delimsizing.mult .delim-size1>span{font-family:KaTeX_Size1}
.katex .delimsizing.mult .delim-size4>span{font-family:KaTeX_Size4}
.katex .nulldelimiter{width:.12em;display:inline-block}
.katex .delimcenter,.katex .op-symbol{position:relative}
.katex .op-symbol.small-op{font-family:KaTeX_Size1}
.katex .op-symbol.large-op{font-family:KaTeX_Size2}
.katex .accent>.vlist-t,.katex .op-limits>.vlist-t{text-align:center}
.katex .accent .accent-body{position:relative}
.katex .accent .accent-body:not(.accent-full){width:0}
.katex .overlay{display:block}
.katex .mtable .vertical-separator{min-width:1px;display:inline-block}
.katex .mtable .arraycolsep{display:inline-block}
.katex .mtable .col-align-c>.vlist-t{text-align:center}
.katex .mtable .col-align-l>.vlist-t{text-align:left}
.katex .mtable .col-align-r>.vlist-t{text-align:right}
.katex .svg-align{text-align:left}
.katex svg{fill:currentColor;stroke:currentColor;fill-rule:nonzero;fill-opacity:1;stroke-width:1px;stroke-linecap:butt;stroke-linejoin:miter;stroke-miterlimit:4;stroke-dasharray:none;stroke-dashoffset:0;stroke-opacity:1;height:inherit;width:100%;display:block;position:absolute}
.katex svg path{stroke:none}
.katex img{border-style:none;min-width:0;max-width:none;min-height:0;max-height:none}
.katex .stretchy{width:100%;display:block;position:relative;overflow:hidden}
.katex .stretchy:after,.katex .stretchy:before{content:""}
.katex .hide-tail{width:100%;position:relative;overflow:hidden}
.katex .halfarrow-left{width:50.2%;position:absolute;left:0;overflow:hidden}
.katex .halfarrow-right{width:50.2%;position:absolute;right:0;overflow:hidden}
.katex .brace-left{width:25.1%;position:absolute;left:0;overflow:hidden}
.katex .brace-center{width:50%;position:absolute;left:25%;overflow:hidden}
.katex .brace-right{width:25.1%;position:absolute;right:0;overflow:hidden}
.katex .x-arrow-pad{padding:0 .5em}
.katex .cd-arrow-pad{padding:0 .55556em 0 .27778em}
.katex .mover,.katex .munder,.katex .x-arrow{text-align:center}
.katex .boxpad{padding:0 .3em}
.katex .fbox,.katex .fcolorbox{box-sizing:border-box;border:.04em solid}
.katex .cancel-pad{padding:0 .2em}
.katex .cancel-lap{margin-left:-.2em;margin-right:-.2em}
.katex .sout{border-bottom-style:solid;border-bottom-width:.08em}
.katex .angl{box-sizing:border-box;border-top:.049em solid;border-right:.049em solid;margin-right:.03889em}
.katex .anglpad{padding:0 .03889em}
.katex .eqn-num:before{content:"(" counter(katexEqnNo) ")";counter-increment:katexEqnNo}
.katex .mml-eqn-num:before{content:"(" counter(mmlEqnNo) ")";counter-increment:mmlEqnNo}
.katex .mtr-glue{width:50%}
.katex .cd-vert-arrow{display:inline-block;position:relative}
.katex .cd-label-left{text-align:left;display:inline-block;position:absolute;right:calc(50% + .3em)}
.katex .cd-label-right{text-align:right;display:inline-block;position:absolute;left:calc(50% + .3em)}
.katex-display{text-align:center;margin:1em 0;display:block}
.katex-display>.katex{text-align:center;white-space:nowrap;display:block}
.katex-display>.katex>.katex-html{display:block;position:relative}
.katex-display>.katex>.katex-html>.tag{position:absolute;right:0}
.katex-display.leqno>.katex>.katex-html>.tag{left:0;right:auto}
.katex-display.fleqn>.katex{text-align:left;padding-left:2em}`;

  function bundledKatexCss() {
    return CONFIG.useBundledKatexCss ? BUNDLED_KATEX_CSS : "";
  }


  if (window.__CHATGPT_FULL_CHAT_SAVER_V42_RUNNING__) {
    alert("ChatGPT Archive Exporter V1.4.0 is already running on this page.");
    return;
  }

  window.__CHATGPT_FULL_CHAT_SAVER_V42_RUNNING__ = true;

  const state = {
    stopAndSave: false,
    cancelled: false,
    startedAt: new Date(),
    currentPass: 0,
    collected: new Map(),
    renderer: {
      generation: "unknown",
      reversedTimeline: false,
      timelineDetected: false
    },

    // Chronology reconstructed from overlapping DOM snapshots.
    // orderVotes stores directed "A appeared before B" observations.
    ordering: {
      orderVotes: new Map(),
      observations: 0,
      certifiedTop: null,
      lastResolution: null
    },

    topBoundaryValidation: {
      stabilized: false,
      roundsRequired: CONFIG.topBoundaryProbeRounds,
      quietRoundsCompleted: 0,
      retriggersPerformed: 0,
      lastFailureReason: null,
      validatedAt: null,
      deepChallengePerformed: false,
      deepChallengeOlderHistoryObserved: false
    },

    runtimeVisibility: {
      currentState: document.visibilityState || "unknown",
      visibilityEpoch: 0,
      hiddenTransitions: 0,
      resumeCount: 0,
      hiddenDurationMs: 0,
      hiddenStartedAtPerf:
        document.visibilityState === "hidden" ? performance.now() : null,
      schedulerStallCount: 0,
      lastSchedulerStallMs: 0,
      topValidationRestarts: 0
    },

    lastMountedKeys: [],
    contentValidation: {
      snapshotUpgrades: 0,
      snapshotUpgradesFromMutationObserver: 0,
      downgradeSnapshotsIgnored: 0,
      messagesWithMultipleVariants: 0,
      variantKeys: new Set(),
      largestTextGrowthChars: 0,
      largestHtmlGrowthChars: 0,
      largestSnapshotUpgrades: []
    },
    hydrationObserver: {
      observer: null,
      timer: null,
      mutationBursts: 0,
      debouncedObservations: 0,
      newTurnsCaughtOutsideNormalPass: 0,
      richerSnapshotsCaughtOutsideNormalPass: 0
    },
    richBlockValidation: {
      candidatesDetected: 0,
      confirmationAttempts: 0,
      hydratedDuringConfirmation: 0,
      resolvedAfterConfirmation: 0,
      unresolvedCandidates: 0,
      disconnectedBeforeResolution: 0,
      confirmationWaitMs: 0,
      candidates: new Map(),
      candidateSamples: []
    },
    scanDiagnostics: {
      passesCompleted: 0,
      normalCollectionCalls: 0,
      mutationCollectionCalls: 0,
      richConfirmationCollectionCalls: 0,
      maxMountedTurns: 0,
      newTurnsFromNormalScan: 0,
      newTurnsFromMutationObserver: 0
    },
    collectionPerformance: {
      totalCollectionMs: 0,
      normalCollectionMs: 0,
      mutationCollectionMs: 0,
      richConfirmationCollectionMs: 0,
      signatureChecks: 0,
      signatureRichScanSkips: 0,
      entryBuilds: 0,
      entryBuildMs: 0,
      maxCollectionCallMs: 0,
      slowCollectionCalls: 0,
      slowestCalls: []
    },
    scanPacing: {
      fastWaitPasses: 0,
      periodicSlowWaitPasses: 0,
      adaptiveSlowWaitPasses: 0,
      fastWaitRequestedMs: 0,
      periodicSlowWaitRequestedMs: 0,
      adaptiveSlowWaitRequestedMs: 0,
      fastWaitActualMs: 0,
      periodicSlowWaitActualMs: 0,
      adaptiveSlowWaitActualMs: 0,
      slowModeEntries: 0,
      slowModeExits: 0,
      adaptiveSlowActive: false,
      normalScannerProgressPasses: 0,
      aggregateProgressPasses: 0,
      mutationOnlyProgressPasses: 0,
      maxNoNormalScannerProgressStreak: 0,
      maxNoAggregateProgressStreak: 0,
      currentNoNormalScannerProgressStreak: 0,
      currentNoAggregateProgressStreak: 0,
      turnGrowthWhileAdaptiveSlow: 0
    },
    scrollDiagnostics: {
      mainScanCommands: 0,
      movedPasses: 0,
      nearZeroMovementPasses: 0,
      mountedSetChangedPasses: 0,
      sameMountedSetPasses: 0,
      totalAbsScrollDeltaPx: 0
    },
    redesignedAssistantValidation: {
      assistantGroupsSeen: 0,
      assistantEntriesBuilt: 0,
      labelOnlyCandidates: 0,
      incompleteEntries: 0,
      prunedUserSubtrees: 0,
      prunedSemanticLabels: 0
    },
    richOutputFormatting: {
      writingBlocksStaticized: 0,
      codeEditorsStaticized: 0,
      codeCardsStaticized: 0,
      outputTabsStaticized: 0,
      richEditableNodesPreserved: 0,
      structuredMarkdownBlocks: 0
    },
    redesignedTopHydration: {
      attemptsStarted: 0,
      attemptsCompleted: 0,
      spinnerDetectedAttempts: 0,
      spinnerObservations: 0,
      spinnerCleared: 0,
      waitMs: 0,
      nudges: 0,
      captureGrowthEvents: 0,
      rangeGrowthEvents: 0,
      largestRangeGrowthPx: 0,
      firstKeyChanges: 0,
      timeouts: 0,
      pendingAtTimeout: 0,
      lastInitialRangePx: 0,
      lastFinalRangePx: 0,
      lastSpinnerSeen: false,
      lastResult: null
    },
    topValidationDiagnostics: {
      attemptsStarted: 0,
      attemptsCompleted: 0,
      successfulAttempts: 0,
      totalCycles: 0,
      totalValidationMs: 0,
      maxRoundReached: 0,
      retriggerAttempts: 0,
      deepChallenges: 0,
      geometryOnlySignals: 0,
      firstKeyOnlySignals: 0,
      invalidations: {
        captureGrowth: 0,
        visibility: 0,
        scheduler: 0,
        stopOrCancel: 0,
        zeroTurns: 0
      },
      recentSignals: []
    },
    conversationDetection: {
      sampledAt: null,
      documentReadyState: null,
      mainElements: 0,
      allArticles: 0,
      iframeCount: 0,
      sameOriginIframes: 0,
      selectorMatches: {
        conversationTurnTestId: 0,
        conversationTurnArticle: 0,
        dataTurnRole: 0,
        dataTurnId: 0,
        turnIdContainer: 0,
        turnKey: 0,
        conversationRole: 0,
        userMessageBubble: 0,
        agentTurnStart: 0,
        timelineScroll: 0,
        mainArticle: 0,
        messageAuthorRole: 0,
        messageId: 0
      },
      sameOriginFrameSelectorMatches: {
        conversationTurnTestId: 0,
        dataTurnRole: 0,
        dataTurnId: 0,
        messageAuthorRole: 0
      },
      openShadowRoots: 0,
      shadowSelectorMatches: {
        conversationTurnTestId: 0,
        dataTurnRole: 0,
        dataTurnId: 0,
        messageAuthorRole: 0,
        messageId: 0
      },
      shadowHosts: [],
      scrollCandidates: [],
      movableCandidates: 0,
      selectedScrollElement: null,
      activeScope: null,
      structuralInventory: null
    },
    alphaDiagnostics: {
      ran: false,
      ranAt: null,
      rendererProbe: {
        generation: "not-run",
        legacySignals: 0,
        redesignedSignals: 0,
        selectors: {},
        signedScrollProbe: null
      },
      canonicalProbe: {
        attempted: false,
        status: "not-run",
        conversationIdDetected: false,
        authSessionStatus: null,
        authorizationAvailable: false,
        httpStatus: null,
        format: null,
        mappingNodeCount: 0,
        messagesArrayCount: 0,
        currentNodePresent: false,
        activeBranchRawNodes: 0,
        visibleMessageNodes: 0,
        visibleRoleRuns: 0,
        userNodes: 0,
        assistantNodes: 0,
        contentChars: 0,
        firstRole: null,
        lastRole: null,
        branchCycleDetected: false,
        filteredHiddenNodes: 0,
        filteredNonConversationRoles: 0,
        filteredEmptyNodes: 0,
        error: null
      }
    },
    zeroTurnRecovery: {
      triggered: false,
      attempts: 0,
      waitMs: 0,
      scrollElementRedetections: 0,
      recovered: false,
      recoveredTurnCount: 0,
      finalReason: null,
      scrollProbeAttempts: 0,
      scrollProbeSuccesses: 0,
      rejectedImmovableCandidates: 0
    },
    gapGuard: {
      mode: CONFIG.gapGuardMode,
      transitionsChecked: 0,
      zeroOverlapSuspicions: 0,
      transientSuspicions: 0,
      recoveryAttempts: 0,
      recoveredGaps: 0,
      unresolvedGaps: 0,
      recoveryMs: 0
    },
    checkpointValidation: {
      conversationKey: null,
      checkpointAvailable: false,
      knownFirstStableId: null,
      knownMaxCapturedTurns: 0,
      knownMaxCapturedTextChars: 0,
      checkpointExporterVersion: null,
      reachedKnownFirstStableId: null,
      retryAttempts: 0,
      supersededByEarlierCapture: false,
      saved: false,
      storageError: null
    },
    captureWarnings: [],
    hadCaptureRepair: false,
    timing: {
      startedPerf: performance.now(),
      gapRecoveryMs: 0,
      topValidationMs: 0
    },

    scanInitialTop: 1,
    progressHighWater: 0,
    status: {
      running: true,
      done: false,
      error: "",
      phase: "Starting...",
      hint: "",
      pass: 0,
      captured: 0,
      mode: CONFIG.mode,
      adapter: "chatgpt",
      progress: 0,
      indeterminate: false,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  function updateExtensionStatus(patch = {}) {
    const requestedProgress = Number(
      patch.progress ?? state.status.progress ?? state.progressHighWater ?? 0
    );

    if (Number.isFinite(requestedProgress)) {
      state.progressHighWater = Math.max(
        state.progressHighWater || 0,
        Math.max(0, Math.min(100, requestedProgress))
      );
    }

    state.status = {
      ...state.status,
      ...patch,
      running: Boolean(window.__CHATGPT_FULL_CHAT_SAVER_V42_RUNNING__),
      stopAndSave: Boolean(state.stopAndSave),
      cancelled: Boolean(state.cancelled),
      pass: state.currentPass,
      captured: state.collected.size,
      mode: CONFIG.mode,
      adapter: "chatgpt",
      progress: state.progressHighWater,
      updatedAt: new Date().toISOString()
    };

    window.__CHATGPT_FULL_CHAT_SAVER_STATUS__ = { ...state.status };
    window.__ARCHIVE_EXPORTER_STATUS__ = { ...state.status };

    try {
      window.postMessage(
        {
          source: "chatgpt-archive-exporter-v1.2",
          type: "ARCHIVE_EXPORTER_STATUS",
          status: window.__ARCHIVE_EXPORTER_STATUS__
        },
        "*"
      );
    } catch {}

    return window.__ARCHIVE_EXPORTER_STATUS__;
  }

  window.__CHATGPT_FULL_CHAT_SAVER_CONTROL__ = {
    getStatus() {
      return updateExtensionStatus();
    },
    stopAndSave() {
      state.stopAndSave = true;
      return updateExtensionStatus({
        phase: "Stop & Save requested",
        hint: "Will stop after current wait and then save.",
        indeterminate: true
      });
    },
    cancel() {
      state.cancelled = true;
      return updateExtensionStatus({
        phase: "Cancel requested",
        hint: "Will cancel after current wait. Nothing will be saved.",
        indeterminate: true
      });
    }
  };

  window.__ARCHIVE_EXPORTER_CONTROL__ =
    window.__CHATGPT_FULL_CHAT_SAVER_CONTROL__;

  updateExtensionStatus();

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function runtimeVisibilityReport() {
    let hiddenDurationMs = state.runtimeVisibility.hiddenDurationMs;

    if (
      state.runtimeVisibility.currentState === "hidden" &&
      Number.isFinite(state.runtimeVisibility.hiddenStartedAtPerf)
    ) {
      hiddenDurationMs += Math.max(
        0,
        performance.now() - state.runtimeVisibility.hiddenStartedAtPerf
      );
    }

    return {
      currentState: document.visibilityState || state.runtimeVisibility.currentState,
      hiddenTransitions: state.runtimeVisibility.hiddenTransitions,
      resumeCount: state.runtimeVisibility.resumeCount,
      hiddenDurationMs: Math.round(hiddenDurationMs),
      schedulerStallCount: state.runtimeVisibility.schedulerStallCount,
      lastSchedulerStallMs: Math.round(
        state.runtimeVisibility.lastSchedulerStallMs || 0
      ),
      topValidationRestarts: state.runtimeVisibility.topValidationRestarts
    };
  }

  function onDocumentVisibilityChange() {
    const now = performance.now();
    const nextState = document.visibilityState || "unknown";
    const prevState = state.runtimeVisibility.currentState;

    if (nextState === prevState) return;

    state.runtimeVisibility.visibilityEpoch += 1;
    state.runtimeVisibility.currentState = nextState;

    if (nextState === "hidden") {
      state.runtimeVisibility.hiddenTransitions += 1;
      state.runtimeVisibility.hiddenStartedAtPerf = now;

      updateExtensionStatus({
        indeterminate: true,
        phase: "Paused — ChatGPT tab is hidden.",
        hint: "Return to this ChatGPT tab to continue safely."
      });

      return;
    }

    if (
      prevState === "hidden" &&
      Number.isFinite(state.runtimeVisibility.hiddenStartedAtPerf)
    ) {
      state.runtimeVisibility.hiddenDurationMs += Math.max(
        0,
        now - state.runtimeVisibility.hiddenStartedAtPerf
      );
      state.runtimeVisibility.hiddenStartedAtPerf = null;
      state.runtimeVisibility.resumeCount += 1;
    }

    updateExtensionStatus({
      indeterminate: true,
      phase: "Resuming export…",
      hint: "Revalidating page hydration before continuing."
    });
  }

  document.addEventListener("visibilitychange", onDocumentVisibilityChange);

  async function waitUntilVisible(overlay) {
    if (
      !CONFIG.pauseWhenDocumentHidden ||
      document.visibilityState !== "hidden"
    ) {
      return { resumed: false };
    }

    updateExtensionStatus({
      indeterminate: true,
      phase: "Paused — ChatGPT tab is hidden.",
      hint: "Return to this ChatGPT tab to continue safely."
    });

    overlay?.update?.({
      phase: "Paused — ChatGPT tab is hidden.",
      pass: state.currentPass,
      count: state.collected.size,
      hint: "Return to this ChatGPT tab to resume."
    });

    await new Promise((resolve) => {
      const handler = () => {
        if (document.visibilityState !== "hidden") {
          document.removeEventListener("visibilitychange", handler);
          resolve();
        }
      };

      document.addEventListener("visibilitychange", handler);

      // Close a race where the page became visible just before registration.
      if (document.visibilityState !== "hidden") {
        document.removeEventListener("visibilitychange", handler);
        resolve();
      }
    });

    return { resumed: true };
  }

  function schedulerDelayIsStalled(requestedMs, actualMs) {
    return actualMs > Math.max(
      requestedMs * CONFIG.schedulerStallFactor,
      requestedMs + CONFIG.schedulerStallSlackMs
    );
  }

  function log(...args) {
    if (CONFIG.verboseConsoleLog) {
      console.log("[ChatGPT Archive V1.4.0]", ...args);
    }
  }

  function normalizeText(s) {
    return String(s || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function compactText(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function hashString(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  function conversationCheckpointKey() {
    try {
      const url = new URL(location.href);
      const match = url.pathname.match(/\/c\/([^/?#]+)/);
      if (match?.[1]) return `chatgpt:${match[1]}`;
      return `chatgpt-path:${url.origin}${url.pathname}`;
    } catch {
      return `chatgpt-path:${String(location.href || "").split(/[?#]/)[0]}`;
    }
  }

  function addCaptureWarning(code, message, recommendedAction, evidence = {}) {
    const existing = state.captureWarnings.find((item) => item.code === code);
    if (existing) {
      existing.count += 1;
      existing.evidence = { ...existing.evidence, ...evidence };
      return existing;
    }

    const warning = {
      code,
      severity: "warning",
      count: 1,
      message,
      recommendedAction,
      evidence
    };
    state.captureWarnings.push(warning);
    return warning;
  }

  function captureHealthStatus() {
    if (state.captureWarnings.length) return "warning";
    if (state.hadCaptureRepair) return "repaired";
    return "clean";
  }

  function checkpointBridgeRequest(action, payload = {}) {
    return new Promise((resolve) => {
      const requestId = `archive-checkpoint-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timeout = setTimeout(() => {
        window.removeEventListener("message", onResponse);
        resolve({ ok: false, error: "checkpoint bridge timeout" });
      }, 1800);

      function onResponse(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (
          !data ||
          data.source !== "chatgpt-archive-exporter-bridge-v1.3" ||
          data.type !== "ARCHIVE_CHECKPOINT_RESPONSE" ||
          data.requestId !== requestId
        ) {
          return;
        }
        clearTimeout(timeout);
        window.removeEventListener("message", onResponse);
        resolve(data.result || { ok: false, error: "empty checkpoint response" });
      }

      window.addEventListener("message", onResponse);
      window.postMessage({
        source: "chatgpt-archive-exporter-v1.3-checkpoint",
        type: "ARCHIVE_CHECKPOINT_REQUEST",
        requestId,
        action,
        conversationKey: state.checkpointValidation.conversationKey,
        ...payload
      }, "*");
    });
  }

  async function loadConversationCheckpoint() {
    state.checkpointValidation.conversationKey = conversationCheckpointKey();
    if (!CONFIG.enableKnownBoundaryCheckpoint) return;

    const response = await checkpointBridgeRequest("load");
    if (!response?.ok) {
      state.checkpointValidation.storageError = response?.error || "checkpoint load failed";
      return;
    }

    const checkpoint = response.checkpoint || null;
    if (!checkpoint) return;

    state.checkpointValidation.checkpointAvailable = true;
    state.checkpointValidation.knownFirstStableId = checkpoint.knownFirstStableId || null;
    state.checkpointValidation.knownMaxCapturedTurns = Math.max(
      0,
      Number(checkpoint.maxCapturedTurns || 0)
    );
    state.checkpointValidation.knownMaxCapturedTextChars = Math.max(
      0,
      Number(checkpoint.maxCapturedTextChars || 0)
    );
    state.checkpointValidation.checkpointExporterVersion =
      checkpoint.exporterVersion || null;
  }

  async function saveConversationCheckpointIfEligible(entries) {
    if (!CONFIG.enableKnownBoundaryCheckpoint) return;
    if (state.captureWarnings.length) return;

    const firstStableId = entries?.[0]?.stableId || "";
    if (!firstStableId) return;

    const response = await checkpointBridgeRequest("save", {
      checkpoint: {
        knownFirstStableId: firstStableId,
        maxCapturedTurns: Math.max(
          entries.length,
          state.checkpointValidation.knownMaxCapturedTurns || 0
        ),
        maxCapturedTextChars: Math.max(
          entries.reduce((sum, entry) => sum + Number(entry.textLength || 0), 0),
          state.checkpointValidation.knownMaxCapturedTextChars || 0
        ),
        exporterVersion: "1.4.0"
      }
    });

    if (response?.ok) {
      state.checkpointValidation.saved = true;
      return;
    }

    state.checkpointValidation.storageError = response?.error || "checkpoint save failed";
  }

  function stableDiagnosticHash(value) {
    const text = String(value ?? "");
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function checkpointTextBaselineCompatible(version) {
    const value = String(version || "");
    return value === "1.3.1" || value === "1.3.2" || value === "1.3.3" || value === "1.3.4" || value === "1.3.5" || value === "1.3.6" || value === "1.4.0-alpha2" || value === "1.4.0-alpha3" || value === "1.4.0-alpha4" || value === "1.4.0-alpha5" || value === "1.4.0-rc1" || value === "1.4.0-rc2" || value === "1.4.0-rc3" || value === "1.4.0";
  }

  function classifyRichBlockCandidate(turn, role = detectRole(turn)) {
    const result = {
      candidate: false,
      suspiciousShell: false,
      semanticNodeCount: 0,
      controlHintCount: 0,
      maxRichNodeTextChars: 0,
      hints: []
    };
    if (!turn || role !== "assistant") return result;

    const semanticSelector = "[data-testid*='writing'], [data-testid*='artifact'], [data-testid*='canvas'], [class*='writing-block'], [class*='artifact']";
    let semanticNodes = [];
    let controls = [];
    try { semanticNodes = Array.from(turn.querySelectorAll(semanticSelector) || []); } catch {}
    try { controls = Array.from(turn.querySelectorAll("button, [role='button']") || []); } catch {}

    const controlLabels = controls
      .map((node) => String(node?.innerText || node?.textContent || node?.getAttribute?.("aria-label") || "").trim().toLowerCase())
      .filter(Boolean);
    const controlHints = controlLabels.filter((label) => /^(view|show more|edit|open)$/.test(label));

    result.semanticNodeCount = semanticNodes.length;
    result.controlHintCount = controlHints.length;
    result.maxRichNodeTextChars = semanticNodes.reduce((max, node) => {
      const len = String(node?.innerText || node?.textContent || "").trim().length;
      return Math.max(max, len);
    }, 0);

    if (semanticNodes.length) result.hints.push("semantic-node");
    if (controlHints.length) result.hints.push("rich-control");

    result.candidate = semanticNodes.length > 0 && controlHints.length > 0;
    result.suspiciousShell = result.candidate && result.maxRichNodeTextChars < 180;
    return result;
  }

  function noteRichBlockCandidate(turn, key, role) {
    if (!CONFIG.enableRichBlockValidation || !key || state.richBlockValidation.candidates.has(key)) return;
    const info = classifyRichBlockCandidate(turn, role);
    if (!info.candidate) return;

    state.richBlockValidation.candidatesDetected += 1;
    state.richBlockValidation.candidates.set(key, { key, turn, info, validated: !info.suspiciousShell, confirmedShell: false, resolved: !info.suspiciousShell });
    if (state.richBlockValidation.candidateSamples.length < 5) {
      state.richBlockValidation.candidateSamples.push({
        stableId: detectStableId(turn) || key,
        suspiciousShell: Boolean(info.suspiciousShell),
        semanticNodeCount: info.semanticNodeCount,
        controlHintCount: info.controlHintCount,
        richNodeTextChars: info.maxRichNodeTextChars,
        hints: info.hints.slice(0, 4)
      });
    }
  }

  function diagnosticFingerprintForEntries(entries) {
    const orderedStableIds = entries.map((entry) => entry.stableId || entry.key).join("\n");
    const orderedContent = entries.map((entry) => `${entry.stableId || entry.key}\u0000${entry.textHash}\u0000${entry.textLength}`).join("\n");
    const multiset = entries
      .map((entry) => `${entry.stableId || entry.key}\u0000${entry.textHash}\u0000${entry.textLength}`)
      .sort()
      .join("\n");
    return {
      orderedStableIdHash: stableDiagnosticHash(orderedStableIds),
      orderedContentHash: stableDiagnosticHash(orderedContent),
      contentMultisetHash: stableDiagnosticHash(multiset)
    };
  }

  async function validateRichBlockCandidates(overlay) {
    if (!CONFIG.enableRichBlockValidation || !state.richBlockValidation.candidates.size) return;

    let pending = [...state.richBlockValidation.candidates.values()]
      .filter((item) => !item.validated && item.info?.suspiciousShell && item.turn?.isConnected);
    if (!pending.length) return;

    for (let round = 0; round < CONFIG.richBlockMaxConfirmationRounds && pending.length; round++) {
      const started = performance.now();
      await waitWithCancellation(
        CONFIG.richBlockConfirmationDelayMs,
        overlay,
        "Confirming rich message hydration..."
      );
      state.richBlockValidation.confirmationWaitMs += Math.max(0, performance.now() - started);
      state.richBlockValidation.confirmationAttempts += pending.length;
      collectVisibleTurns(state.currentPass, "rich-confirmation");

      const stillPending = [];
      for (const item of pending) {
        if (!item.turn?.isConnected) {
          state.richBlockValidation.disconnectedBeforeResolution += 1;
          item.validated = true;
          continue;
        }
        const role = detectRole(item.turn);
        const info = classifyRichBlockCandidate(item.turn, role);
        item.info = info;
        if (info.candidate && info.suspiciousShell) {
          stillPending.push(item);
        } else {
          state.richBlockValidation.hydratedDuringConfirmation += 1;
          item.resolved = true;
          item.validated = true;
        }
      }
      pending = stillPending;
    }

    for (const item of pending) {
      if (!item.confirmedShell) {
        state.richBlockValidation.unresolvedCandidates += 1;
      }
      item.confirmedShell = true;
      item.validated = true;
    }
  }

  function makeTurnCaptureSignature(turn, role = detectRole(turn), previousSignature = null) {
    const contentNode = getBestMessageContentNode(turn, role) || turn;
    const textChars = String(contentNode.textContent || "").trim().length;
    const elementCount = Number(contentNode.childElementCount || 0);
    let richElementCount = 0;

    // V1.3.6 performance fast path. If text is already at least 9 chars
    // shorter than the richest saved snapshot, none of the richer-snapshot
    // rules can accept this DOM state, even with extra rich descendants.
    // Avoid a descendant query in that provable downgrade case.
    if (
      previousSignature &&
      Number.isFinite(previousSignature.textChars) &&
      textChars <= Number(previousSignature.textChars) - 9
    ) {
      state.collectionPerformance.signatureRichScanSkips += 1;
      richElementCount = Number(previousSignature.richElementCount || 0);
      return { textChars, elementCount, richElementCount };
    }

    try {
      // Text growth catches late writing blocks; this narrow semantic count
      // catches formatting hydration when text length itself barely changes.
      richElementCount = contentNode.querySelectorAll(
        "pre, code, table, blockquote, details, [role='table']"
      ).length;
    } catch {}

    return { textChars, elementCount, richElementCount };
  }

  function signatureDiffersMeaningfully(a, b) {
    if (!a || !b) return true;
    return (
      Math.abs(a.textChars - b.textChars) >= 24 ||
      Math.abs(a.elementCount - b.elementCount) >= 3 ||
      Math.abs(a.richElementCount - b.richElementCount) >= 1
    );
  }

  function signatureIsClearlyRicher(next, previous) {
    if (!previous) return true;
    if (!next) return false;

    const textGrowth = next.textChars - previous.textChars;
    const elementGrowth = next.elementCount - previous.elementCount;
    const richGrowth = next.richElementCount - previous.richElementCount;

    return (
      textGrowth >= Math.max(80, Math.round(previous.textChars * 0.035)) ||
      (textGrowth >= 16 && richGrowth >= 1) ||
      (textGrowth >= -8 && elementGrowth >= 8 && richGrowth >= 2)
    );
  }

  function markRichBlockResolved(key) {
    const item = state.richBlockValidation.candidates.get(key);
    if (!item || item.resolved) return;
    item.resolved = true;
    if (item.confirmedShell) {
      state.richBlockValidation.resolvedAfterConfirmation += 1;
      state.richBlockValidation.unresolvedCandidates = Math.max(0, state.richBlockValidation.unresolvedCandidates - 1);
    }
  }

  function recordSnapshotUpgrade(key, previous, next, source) {
    const textGrowth = Math.max(0, Number(next.textLength || 0) - Number(previous.textLength || 0));
    const htmlGrowth = Math.max(0, String(next.html || "").length - String(previous.html || "").length);

    state.contentValidation.snapshotUpgrades += 1;
    if (source === "mutation") {
      state.contentValidation.snapshotUpgradesFromMutationObserver += 1;
      state.hydrationObserver.richerSnapshotsCaughtOutsideNormalPass += 1;
    }
    state.contentValidation.variantKeys.add(key);
    state.contentValidation.messagesWithMultipleVariants = state.contentValidation.variantKeys.size;
    state.contentValidation.largestTextGrowthChars = Math.max(
      state.contentValidation.largestTextGrowthChars,
      textGrowth
    );
    state.contentValidation.largestHtmlGrowthChars = Math.max(
      state.contentValidation.largestHtmlGrowthChars,
      htmlGrowth
    );

    state.contentValidation.largestSnapshotUpgrades.push({
      stableId: next.stableId || key,
      oldTextChars: previous.textLength || 0,
      newTextChars: next.textLength || 0,
      textGrowth,
      htmlGrowth,
      source
    });
    state.contentValidation.largestSnapshotUpgrades.sort((a, b) => b.textGrowth - a.textGrowth || b.htmlGrowth - a.htmlGrowth);
    state.contentValidation.largestSnapshotUpgrades = state.contentValidation.largestSnapshotUpgrades.slice(0, 5);
    state.hadCaptureRepair = true;
    markRichBlockResolved(key);
  }

  function overlapCount(a, b) {
    if (!a?.length || !b?.length) return 0;
    const set = new Set(a);
    let count = 0;
    for (const key of b) if (set.has(key)) count += 1;
    return count;
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function textToHtml(s) {
    return escapeHtml(s)
      .replace(/\n{2,}/g, (m) => "<br>".repeat(Math.min(m.length, 3)))
      .replace(/\n/g, "<br>");
  }

  function sanitizeFilename(name) {
    return String(name || "chatgpt_conversation")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "chatgpt_conversation";
  }

  function timestampForFilename() {
    return new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .slice(0, 19);
  }

  let cachedConversationShadowRoots = [];

  function getComposedParentElement(el) {
    if (!el) return null;
    if (el.parentElement) return el.parentElement;
    try {
      const root = el.getRootNode?.();
      const host = root?.host;
      return host instanceof Element ? host : null;
    } catch {
      return null;
    }
  }

  function discoverOpenShadowRoots(root = document) {
    const out = [];
    const seen = new Set();
    const visit = (scope) => {
      let elements = [];
      try {
        elements = scope?.querySelectorAll?.("*") || [];
      } catch {
        return;
      }
      for (const el of elements) {
        let shadow = null;
        try {
          shadow = el?.shadowRoot || null;
        } catch {}
        if (!shadow || seen.has(shadow)) continue;
        seen.add(shadow);
        out.push(shadow);
        visit(shadow);
      }
    };
    visit(root);
    return out;
  }

  function getCachedConversationShadowRoots() {
    cachedConversationShadowRoots = cachedConversationShadowRoots.filter((root) => {
      try {
        return root?.host?.isConnected !== false;
      } catch {
        return false;
      }
    });
    return cachedConversationShadowRoots.slice();
  }

  function querySelectorAllAcrossOpenRoots(selector, options = {}) {
    const includeDocument = options.includeDocument !== false;
    const refreshShadows = Boolean(options.refreshShadows);
    const roots = [];
    if (includeDocument) roots.push(document);

    let shadowRoots = Array.isArray(options.roots)
      ? options.roots
      : getCachedConversationShadowRoots();
    if (!Array.isArray(options.roots) && (refreshShadows || shadowRoots.length === 0)) {
      shadowRoots = discoverOpenShadowRoots(document);
    }
    roots.push(...shadowRoots);

    const out = [];
    const seen = new Set();
    for (const root of roots) {
      let matches = [];
      try {
        matches = root?.querySelectorAll?.(selector) || [];
      } catch {
        continue;
      }
      for (const node of matches) {
        if (seen.has(node)) continue;
        seen.add(node);
        out.push(node);
      }
    }
    return out;
  }



  // V1.4.0: scope ChatGPT capture to the active conversation surface.
  // ChatGPT's SPA can keep stale/hidden turn DOM from another conversation
  // mounted elsewhere in the document. Whole-document turn queries can then
  // harvest unrelated messages. Prefer the visible redesigned timeline/thread;
  // otherwise restrict legacy capture to the active <main> element.
  let activeConversationScopeCache = null;

  function viewportIntersectionArea(rect) {
    if (!rect) return 0;
    const vw = Math.max(0, Number(window.innerWidth || document.documentElement?.clientWidth || 0));
    const vh = Math.max(0, Number(window.innerHeight || document.documentElement?.clientHeight || 0));
    const left = Math.max(0, Number(rect.left || 0));
    const right = Math.min(vw, Number(rect.right || 0));
    const top = Math.max(0, Number(rect.top || 0));
    const bottom = Math.min(vh, Number(rect.bottom || 0));
    return Math.max(0, right - left) * Math.max(0, bottom - top);
  }

  function activeScopeElementScore(el, kind = "generic") {
    if (!(el instanceof HTMLElement)) return -Infinity;

    let rect = null;
    let style = null;
    try { rect = el.getBoundingClientRect(); } catch {}
    try { style = getComputedStyle(el); } catch {}

    const hidden =
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.contentVisibility === "hidden" ||
      Number(style?.opacity || 1) === 0 ||
      Number(rect?.width || 0) <= 0 ||
      Number(rect?.height || 0) <= 0;
    const intersectionArea = viewportIntersectionArea(rect);
    const scrollRange = Math.max(0, Number(el.scrollHeight || 0) - Number(el.clientHeight || 0));

    let score = hidden ? -1_000_000 : 100_000;
    if (intersectionArea > 0) score += 1_000_000 + Math.min(intersectionArea, 1_000_000);
    if (el.closest?.("main")) score += 50_000;
    score += Math.min(scrollRange, 1_000_000) * 0.02;

    if (kind === "thread") {
      score += Math.min(el.querySelectorAll?.('[data-turn-key]')?.length || 0, 100) * 2_000;
      if (el.querySelector?.('[data-app-action-timeline-scroll]')) score += 100_000;
    } else if (kind === "timeline") {
      score += Math.min(el.querySelectorAll?.('[data-turn-key]')?.length || 0, 100) * 3_000;
    } else if (kind === "main") {
      score += Math.min(el.querySelectorAll?.('[data-testid^="conversation-turn-"], [data-turn-key], [data-message-author-role]')?.length || 0, 100) * 1_000;
    }

    return score;
  }

  function pickBestActiveElement(nodes, kind) {
    let best = null;
    let bestScore = -Infinity;
    for (const node of nodes || []) {
      if (!(node instanceof HTMLElement)) continue;
      const score = activeScopeElementScore(node, kind);
      if (score > bestScore) {
        best = node;
        bestScore = score;
      }
    }
    return best;
  }

  function getActiveConversationScope(options = {}) {
    const refresh = Boolean(options.refresh);
    if (!refresh && activeConversationScopeCache) {
      const rootConnected = activeConversationScopeCache.root === document || activeConversationScopeCache.root?.isConnected !== false;
      const timelineConnected = !activeConversationScopeCache.timeline || activeConversationScopeCache.timeline?.isConnected !== false;
      const threadConnected = !activeConversationScopeCache.thread || activeConversationScopeCache.thread?.isConnected !== false;
      if (rootConnected && timelineConnected && threadConnected) {
        return activeConversationScopeCache;
      }
    }

    const threadCandidates = [...document.querySelectorAll('[data-chatgpt-conversation-selection-target]')];
    const thread = pickBestActiveElement(threadCandidates, "thread");

    let timelineCandidates = [];
    if (thread) {
      timelineCandidates = [...thread.querySelectorAll('[data-app-action-timeline-scroll]')];
    }
    if (timelineCandidates.length === 0) {
      timelineCandidates = [...document.querySelectorAll('[data-app-action-timeline-scroll]')];
    }
    const timeline = pickBestActiveElement(timelineCandidates, "timeline");

    let root = null;
    let generation = "unknown";
    let source = null;
    let main = null;

    if (timeline) {
      root = thread && thread.contains(timeline) ? thread : timeline;
      generation = "redesigned";
      source = thread && thread.contains(timeline)
        ? "redesigned-thread"
        : "redesigned-timeline";
    } else if (thread) {
      root = thread;
      generation = "redesigned";
      source = "redesigned-thread";
    } else {
      const mainCandidates = [...document.querySelectorAll("main")];
      main = pickBestActiveElement(mainCandidates, "main");
      root = main || document;
      generation = "legacy-or-unknown";
      source = main ? "active-main" : "document-fallback";
    }

    const scope = {
      root,
      thread,
      timeline,
      main: main || root?.closest?.("main") || null,
      generation,
      source,
      threadCandidateCount: threadCandidates.length,
      timelineCandidateCount: timelineCandidates.length,
      mainCandidateCount: document.querySelectorAll("main").length
    };

    if (generation === "redesigned") {
      state.renderer.generation = "redesigned";
      state.renderer.timelineDetected = Boolean(timeline);
      if (timeline) {
        state.renderer.reversedTimeline = Boolean(getScrollPositionModel(timeline).reversed);
      }
    }

    activeConversationScopeCache = scope;
    return scope;
  }

  function summarizeActiveConversationScope(scope = getActiveConversationScope()) {
    const root = scope?.root || document;
    const legacySelector = [
      '[data-testid^="conversation-turn-"]',
      '[data-turn][data-turn-id]',
      'article[data-testid^="conversation-turn-"]',
      '[data-message-author-role]'
    ].join(",");

    const count = (node, selector) => {
      try { return node?.querySelectorAll?.(selector)?.length || 0; } catch { return 0; }
    };
    const docLegacy = count(document, legacySelector);
    const scopedLegacy = count(root, legacySelector);
    const docGroups = count(document, '[data-turn-key]');
    const scopedGroups = count(root, '[data-turn-key]');

    return {
      source: scope?.source || null,
      generation: scope?.generation || "unknown",
      threadCandidates: Number(scope?.threadCandidateCount || 0),
      timelineCandidates: Number(scope?.timelineCandidateCount || 0),
      mainCandidates: Number(scope?.mainCandidateCount || 0),
      rootTag: root === document ? "#document" : String(root?.tagName || "").toLowerCase() || null,
      rootId: root === document ? null : String(root?.id || "").slice(0, 120) || null,
      rootClassName: root === document || typeof root?.className !== "string"
        ? null
        : root.className.trim().split(/\s+/).slice(0, 8).join(" ").slice(0, 240) || null,
      legacyCandidatesDocument: docLegacy,
      legacyCandidatesInsideScope: scopedLegacy,
      redesignedGroupsDocument: docGroups,
      redesignedGroupsInsideScope: scopedGroups,
      rejectedLegacyOutsideScope: Math.max(0, docLegacy - scopedLegacy),
      rejectedRedesignedGroupsOutsideScope: Math.max(0, docGroups - scopedGroups),
      mixedRepresentationsInDocument: docLegacy > 0 && docGroups > 0
    };
  }
  function getScrollableAncestors(el) {
    const out = [];
    const seen = new Set();
    let cur = el;

    while (cur && cur !== document.body && cur !== document.documentElement && !seen.has(cur)) {
      seen.add(cur);
      let style = null;
      try {
        style = getComputedStyle(cur);
      } catch {}
      if (
        /(auto|scroll|overlay)/.test(style?.overflowY || "") &&
        Number(cur.scrollHeight || 0) > Number(cur.clientHeight || 0) + 100
      ) {
        out.push(cur);
      }
      cur = getComposedParentElement(cur);
    }

    out.push(document.scrollingElement || document.documentElement);
    return out;
  }

  const scrollPositionCache = new WeakMap();

  function scrollRootTo(scrollRoot, scrollTop) {
    scrollRoot.scrollTop = scrollTop;
    try {
      scrollRoot.dispatchEvent(new Event("scroll", { bubbles: true }));
    } catch {}
  }

  // Normalize both ChatGPT scroll systems to the same logical coordinates:
  // logical 0 = oldest/top; logical max = newest/bottom.
  // The redesigned renderer uses a reversed timeline where physical scrollTop
  // is 0 at the newest end and becomes negative as older history is requested.
  function createScrollPosition(scrollRoot) {
    const initialScrollTop = Number(scrollRoot?.scrollTop || 0);
    let reversed = false;
    try {
      scrollRoot.scrollTop = -1;
      reversed = initialScrollTop < 0 || Number(scrollRoot.scrollTop || 0) < 0;
      scrollRoot.scrollTop = initialScrollTop;
    } catch {}
    const max = () => Math.max(0, Number(scrollRoot?.scrollHeight || 0) - Number(scrollRoot?.clientHeight || 0));
    return {
      reversed,
      max,
      get: () => reversed ? Number(scrollRoot.scrollTop || 0) + max() : Number(scrollRoot.scrollTop || 0),
      set: (top) => {
        const bounded = Math.max(0, Math.min(max(), Number(top || 0)));
        scrollRootTo(scrollRoot, reversed ? bounded - max() : bounded);
      }
    };
  }

  function getScrollPositionModel(scrollEl) {
    let model = scrollPositionCache.get(scrollEl);
    if (!model) {
      const isRedesignedTimeline = Boolean(
        scrollEl?.matches?.('[data-app-action-timeline-scroll]')
      );
      if (isRedesignedTimeline) {
        model = createScrollPosition(scrollEl);
      } else {
        // Preserve legacy behavior: do not perform the temporary negative-scroll
        // probe on established ChatGPT scroll roots. Their coordinates are
        // conventional and probing would cause an unnecessary top/bottom jump.
        const max = () => Math.max(0, Number(scrollEl?.scrollHeight || 0) - Number(scrollEl?.clientHeight || 0));
        model = {
          reversed: false,
          max,
          get: () => Number(scrollEl?.scrollTop || 0),
          set: (top) => {
            const bounded = Math.max(0, Math.min(max(), Number(top || 0)));
            scrollRootTo(scrollEl, bounded);
          }
        };
      }
      scrollPositionCache.set(scrollEl, model);
    }
    return model;
  }

  function getScrollPosition(scrollEl) {
    return getScrollPositionModel(scrollEl).get();
  }

  function setScrollPosition(scrollEl, top) {
    getScrollPositionModel(scrollEl).set(top);
    return getScrollPosition(scrollEl);
  }

  function getScrollMax(scrollEl) {
    return getScrollPositionModel(scrollEl).max();
  }

  function findMainScrollElement() {
    // Use the same active-conversation scope as turn discovery so a stale hidden
    // timeline elsewhere in ChatGPT's SPA cannot become the scan root.
    const scope = getActiveConversationScope({ refresh: true });
    const redesignedTimeline = scope?.timeline;
    if (redesignedTimeline instanceof HTMLElement) {
      state.renderer.generation = "redesigned";
      state.renderer.timelineDetected = true;
      const model = getScrollPositionModel(redesignedTimeline);
      state.renderer.reversedTimeline = Boolean(model.reversed);
      return redesignedTimeline;
    }
    const firstTurn = findConversationTurns()[0] || null;
    const main = scope?.main || (scope?.root instanceof HTMLElement && scope.root.matches?.("main") ? scope.root : null);
    const anchor = firstTurn || main;
    const candidates = anchor
      ? getScrollableAncestors(anchor)
      : [document.scrollingElement || document.documentElement];

    let best = candidates[0];

    for (const el of candidates) {
      if (!el) continue;

      const elRange = Number(el.scrollHeight || 0) - Number(el.clientHeight || 0);
      const bestRange = best ? Number(best.scrollHeight || 0) - Number(best.clientHeight || 0) : 0;

      if (elRange > bestRange) {
        best = el;
      }
    }

    return best || document.scrollingElement || document.documentElement;
  }

  function probeScrollElementMovability(el) {
    const before = Number(el?.scrollTop || 0);
    const clientHeight = Math.max(0, Number(el?.clientHeight || 0));
    const scrollHeight = Math.max(0, Number(el?.scrollHeight || 0));
    const range = Math.max(0, scrollHeight - clientHeight);
    if (!el || range <= 2) {
      return {
        moved: false, before: Math.round(before), requested: Math.round(before),
        after: Math.round(before), restored: Math.round(before), delta: 0,
        range: Math.round(range), direction: null, reason: "no-scroll-range"
      };
    }

    const step = Math.min(96, Math.max(24, Math.round(range * 0.001)));
    let requested = before + step;
    let after = before;
    let restored = before;
    let direction = "positive";
    let reason = null;
    try {
      el.scrollTop = requested;
      after = Number(el.scrollTop || 0);
      if (Math.abs(after - before) < 2) {
        requested = before - step;
        direction = "negative";
        el.scrollTop = requested;
        after = Number(el.scrollTop || 0);
      }
      el.scrollTop = before;
      restored = Number(el.scrollTop || 0);
    } catch (err) {
      reason = String(err?.message || err || "scroll-probe-failed").slice(0, 160);
    }

    const delta = Math.abs(after - before);
    return {
      moved: delta >= 2, before: Math.round(before), requested: Math.round(requested),
      after: Math.round(after), restored: Math.round(restored), delta: Math.round(delta),
      range: Math.round(range), direction,
      reason: reason || (delta >= 2 ? "moved" : "scrollTop-unchanged")
    };
  }


  function describeScrollElement(el, scrollProbe = null) {
    if (!(el instanceof Element)) return null;
    const range = Math.max(0, Number(el.scrollHeight || 0) - Number(el.clientHeight || 0));
    let style = null;
    let rect = null;
    try {
      style = getComputedStyle(el);
    } catch {}
    try {
      const r = el.getBoundingClientRect?.();
      if (r) {
        rect = {
          top: Math.round(Number(r.top || 0)),
          bottom: Math.round(Number(r.bottom || 0)),
          width: Math.round(Number(r.width || 0)),
          height: Math.round(Number(r.height || 0))
        };
      }
    } catch {}
    return {
      tag: String(el.tagName || "").toLowerCase() || null,
      id: String(el.id || "").slice(0, 120) || null,
      ariaLabel: String(el.getAttribute?.("aria-label") || "").slice(0, 160) || null,
      clientHeight: Math.round(Number(el.clientHeight || 0)),
      scrollHeight: Math.round(Number(el.scrollHeight || 0)),
      scrollTop: Math.round(Number(el.scrollTop || 0)),
      scrollRange: Math.round(range),
      overflowY: String(style?.overflowY || "") || null,
      position: String(style?.position || "") || null,
      display: String(style?.display || "") || null,
      visibility: String(style?.visibility || "") || null,
      rect,
      childCount: Number(el.children?.length || 0),
      isDocumentScroller:
        el === document.scrollingElement ||
        el === document.documentElement ||
        el === document.body,
      isMain: el === document.querySelector("main"),
      insideMain: Boolean(document.querySelector("main")?.contains(el)),
      scrollProbe: scrollProbe ? { ...scrollProbe } : null
    };
  }

  function structuralDomInventory(root) {
    if (!root?.querySelectorAll) return null;
    let nodes = [];
    try {
      nodes = root.querySelectorAll("*");
    } catch {
      return null;
    }
    const limit = Math.min(nodes.length, 5000);
    const tagCounts = new Map();
    const roleCounts = new Map();
    const dataAttributeCounts = new Map();
    const classTokenCounts = new Map();
    let textBearingLeaves = 0;
    let substantialTextElements = 0;

    const bump = (map, key) => {
      if (!key) return;
      map.set(key, (map.get(key) || 0) + 1);
    };
    for (let i = 0; i < limit; i++) {
      const el = nodes[i];
      bump(tagCounts, String(el.tagName || "").toLowerCase());
      const role = el.getAttribute?.("role");
      if (role) bump(roleCounts, role);
      for (const attr of el.attributes || []) {
        if (String(attr.name || "").startsWith("data-")) bump(dataAttributeCounts, attr.name);
      }
      const className = typeof el.className === "string" ? el.className : "";
      for (const token of className.split(/\s+/).filter(Boolean).slice(0, 12)) {
        bump(classTokenCounts, token.slice(0, 80));
      }
      if ((el.children?.length || 0) === 0) {
        const textLen = compactText(el.textContent || "").length;
        if (textLen >= 2) textBearingLeaves += 1;
        if (textLen >= 120) substantialTextElements += 1;
      }
    }
    const top = (map, n) => [...map.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .slice(0, n)
      .map(([value, count]) => ({ value, count }));
    return {
      inspectedDescendants: limit,
      totalDescendants: nodes.length,
      directChildren: Number(root.children?.length || 0),
      markdownNodes: countSelector(root, ".markdown, [class*='markdown']"),
      dirAutoNodes: countSelector(root, '[dir="auto"]'),
      buttons: countSelector(root, "button, [role='button']"),
      preNodes: countSelector(root, "pre"),
      codeNodes: countSelector(root, "code"),
      textBearingLeaves,
      substantialTextElements,
      topTags: top(tagCounts, 16),
      topRoles: top(roleCounts, 16),
      topDataAttributes: top(dataAttributeCounts, 24),
      topClassTokens: top(classTokenCounts, 24)
    };
  }

  function findZeroTurnScrollCandidates() {
    const nodes = [];
    const seen = new Set();
    const push = (el) => {
      if (!(el instanceof HTMLElement) || seen.has(el)) return;
      seen.add(el);
      nodes.push(el);
    };

    push(document.scrollingElement || document.documentElement);
    push(document.documentElement);
    push(document.body);
    const main = document.querySelector("main");
    push(main);
    if (main) {
      for (const ancestor of getScrollableAncestors(main)) push(ancestor);
    }

    const roots = [main || document.body || document.documentElement, ...discoverOpenShadowRoots(document)];
    for (const scanRoot of roots) {
      const descendants = scanRoot?.querySelectorAll?.("div,section,main,article") || [];
      const maxInspect = Math.min(descendants.length, 2500);
      for (let i = 0; i < maxInspect; i++) {
        const el = descendants[i];
        if (!(el instanceof HTMLElement)) continue;
        const range = Number(el.scrollHeight || 0) - Number(el.clientHeight || 0);
        if (range <= 2) continue;
        let overflowY = "";
        try {
          overflowY = getComputedStyle(el).overflowY || "";
        } catch {}
        if (/(auto|scroll|overlay)/.test(overflowY) || range > 300) push(el);
      }
    }

    return nodes
      .map((el) => {
        const scrollProbe = probeScrollElementMovability(el);
        return { el, probe: scrollProbe, info: describeScrollElement(el, scrollProbe) };
      })
      .filter((item) => item.info)
      .sort((a, b) => {
        if (a.probe.moved !== b.probe.moved) return a.probe.moved ? -1 : 1;
        return b.info.scrollRange - a.info.scrollRange;
      });
  }

  function countSelector(root, selector) {
    try {
      return root?.querySelectorAll?.(selector)?.length || 0;
    } catch {
      return 0;
    }
  }

  function summarizeShadowHost(root) {
    const host = root?.host;
    if (!(host instanceof Element)) return null;
    return {
      tag: String(host.tagName || "").toLowerCase() || null,
      id: String(host.id || "").slice(0, 120) || null,
      className: typeof host.className === "string"
        ? host.className.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, 240) || null
        : null
    };
  }

  function updateConversationDetectionDiagnostics(scrollEl = null) {
    const selectorMatches = {
      conversationTurnTestId: countSelector(document, '[data-testid^="conversation-turn-"]'),
      conversationTurnArticle: countSelector(document, 'article[data-testid^="conversation-turn-"]'),
      dataTurnRole: countSelector(document, '[data-turn="user"], [data-turn="assistant"]'),
      dataTurnId: countSelector(document, "[data-turn-id]"),
      turnIdContainer: countSelector(document, "[data-turn-id-container]"),
      turnKey: countSelector(document, "[data-turn-key]"),
      conversationRole: countSelector(document, '[data-conversation-role="user"], [data-conversation-role="assistant"]'),
      userMessageBubble: countSelector(document, "[data-user-message-bubble]"),
      agentTurnStart: countSelector(document, "[data-chatgpt-agent-turn-start]"),
      timelineScroll: countSelector(document, "[data-app-action-timeline-scroll]"),
      mainArticle: countSelector(document, "main article"),
      messageAuthorRole: countSelector(document, "[data-message-author-role]"),
      messageId: countSelector(document, "[data-message-id]")
    };

    const shadowRoots = discoverOpenShadowRoots(document);
    const shadowSelectorMatches = {
      conversationTurnTestId: 0,
      dataTurnRole: 0,
      dataTurnId: 0,
      messageAuthorRole: 0,
      messageId: 0
    };
    for (const root of shadowRoots) {
      shadowSelectorMatches.conversationTurnTestId += countSelector(root, '[data-testid^="conversation-turn-"]');
      shadowSelectorMatches.dataTurnRole += countSelector(root, '[data-turn="user"], [data-turn="assistant"]');
      shadowSelectorMatches.dataTurnId += countSelector(root, "[data-turn-id]");
      shadowSelectorMatches.messageAuthorRole += countSelector(root, "[data-message-author-role]");
      shadowSelectorMatches.messageId += countSelector(root, "[data-message-id]");
    }

    let iframeCount = 0;
    let sameOriginIframes = 0;
    const sameOriginFrameSelectorMatches = {
      conversationTurnTestId: 0,
      dataTurnRole: 0,
      dataTurnId: 0,
      messageAuthorRole: 0
    };
    for (const frame of document.querySelectorAll("iframe")) {
      iframeCount += 1;
      try {
        const frameDoc = frame.contentDocument;
        if (!frameDoc) continue;
        sameOriginIframes += 1;
        sameOriginFrameSelectorMatches.conversationTurnTestId +=
          countSelector(frameDoc, '[data-testid^="conversation-turn-"]');
        sameOriginFrameSelectorMatches.dataTurnRole +=
          countSelector(frameDoc, '[data-turn="user"], [data-turn="assistant"]');
        sameOriginFrameSelectorMatches.dataTurnId +=
          countSelector(frameDoc, "[data-turn-id]");
        sameOriginFrameSelectorMatches.messageAuthorRole +=
          countSelector(frameDoc, "[data-message-author-role]");
      } catch {}
    }

    const candidateItems = findZeroTurnScrollCandidates();
    const scrollCandidates = candidateItems
      .slice(0, CONFIG.zeroTurnScrollCandidateLimit)
      .map((item) => item.info);
    const movableCandidates = candidateItems.filter((item) => item.probe.moved).length;
    const selectedProbe = scrollEl ? probeScrollElementMovability(scrollEl) : null;
    const selectedInfo = describeScrollElement(scrollEl, selectedProbe);

    const activeScope = getActiveConversationScope({ refresh: true });
    const activeScopeSummary = summarizeActiveConversationScope(activeScope);

    state.conversationDetection = {
      sampledAt: new Date().toISOString(),
      documentReadyState: document.readyState || null,
      mainElements: countSelector(document, "main"),
      allArticles: countSelector(document, "article"),
      iframeCount,
      sameOriginIframes,
      selectorMatches,
      sameOriginFrameSelectorMatches,
      openShadowRoots: shadowRoots.length,
      shadowSelectorMatches,
      shadowHosts: shadowRoots.slice(0, 12).map(summarizeShadowHost).filter(Boolean),
      scrollCandidates,
      movableCandidates,
      selectedScrollElement: selectedInfo,
      activeScope: activeScopeSummary,
      structuralInventory: state.collected.size === 0
        ? structuralDomInventory(scrollEl || document.querySelector("main") || document.body)
        : null
    };
    return state.conversationDetection;
  }

  function chooseZeroTurnRecoveryScrollElement(current) {
    const currentProbe = probeScrollElementMovability(current);
    state.zeroTurnRecovery.scrollProbeAttempts += 1;
    if (currentProbe.moved) {
      state.zeroTurnRecovery.scrollProbeSuccesses += 1;
      return current;
    }
    if (Number(currentProbe.range || 0) > 2) {
      state.zeroTurnRecovery.rejectedImmovableCandidates += 1;
    }

    const candidates = findZeroTurnScrollCandidates();
    for (const item of candidates) {
      state.zeroTurnRecovery.scrollProbeAttempts += 1;
      if (!item.probe.moved) {
        if (item.info.scrollRange > 2) state.zeroTurnRecovery.rejectedImmovableCandidates += 1;
        continue;
      }
      state.zeroTurnRecovery.scrollProbeSuccesses += 1;
      return item.el;
    }
    return current;
  }

  async function recoverZeroTurnDetection(scrollEl, overlay) {
    state.zeroTurnRecovery.triggered = true;
    updateConversationDetectionDiagnostics(scrollEl);

    let activeScrollEl = scrollEl;
    for (let attempt = 1; attempt <= CONFIG.zeroTurnRecoveryAttempts; attempt++) {
      if (state.cancelled || state.stopAndSave) break;
      state.zeroTurnRecovery.attempts = attempt;

      const candidate = chooseZeroTurnRecoveryScrollElement(activeScrollEl);
      if (candidate && candidate !== activeScrollEl) {
        state.zeroTurnRecovery.scrollElementRedetections += 1;
        activeScrollEl = candidate;
        stopHydrationObserver();
        startHydrationObserver(activeScrollEl);
      }

      try {
        setScrollPosition(activeScrollEl, getScrollMax(activeScrollEl));
      } catch {}

      overlay.update({
        phase: `Conversation detection recovery ${attempt}/${CONFIG.zeroTurnRecoveryAttempts}…`,
        pass: 0,
        count: state.collected.size,
        hint: "No message turns were detected yet; rechecking the page and scroll container."
      });

      const started = performance.now();
      const waited = await waitWithCancellation(
        CONFIG.zeroTurnRecoveryDelayMs,
        overlay,
        "Waiting for conversation DOM…",
        { detectSchedulerStall: true }
      );
      state.zeroTurnRecovery.waitMs += performance.now() - started;

      if (waited.visibilityInterrupted) {
        await recoverAfterVisibilityResume(activeScrollEl, overlay, 0);
      }

      collectVisibleTurns(0);
      updateConversationDetectionDiagnostics(activeScrollEl);
      if (state.collected.size > 0) {
        // If recovery found turns inside an open shadow root, refresh the observer
        // so later hydration within that root is visible too.
        if (getCachedConversationShadowRoots().length > 0) {
          stopHydrationObserver();
          startHydrationObserver(activeScrollEl);
        }
        state.zeroTurnRecovery.recovered = true;
        state.zeroTurnRecovery.recoveredTurnCount = state.collected.size;
        state.zeroTurnRecovery.finalReason = "turns-detected";
        return { recovered: true, scrollEl: activeScrollEl };
      }
    }

    state.zeroTurnRecovery.finalReason = state.cancelled
      ? "cancelled"
      : state.stopAndSave
        ? "stop-and-save"
        : "no-conversation-turns-detected";
    resetTopBoundaryValidation("no-conversation-turns-detected");
    addCaptureWarning(
      "NO_CONVERSATION_TURNS_DETECTED",
      "The page appears to be a ChatGPT conversation, but the exporter could not detect any conversation turns.",
      "Rerun the export. If this repeats, attach capture_report.json; this page may use a different ChatGPT conversation DOM or scroll container.",
      {
        attempts: state.zeroTurnRecovery.attempts,
        selectorMatches: { ...state.conversationDetection.selectorMatches },
        openShadowRoots: state.conversationDetection.openShadowRoots,
        shadowSelectorMatches: { ...state.conversationDetection.shadowSelectorMatches },
        sameOriginIframes: state.conversationDetection.sameOriginIframes,
        movableCandidates: state.conversationDetection.movableCandidates,
        scrollProbeAttempts: state.zeroTurnRecovery.scrollProbeAttempts,
        scrollProbeSuccesses: state.zeroTurnRecovery.scrollProbeSuccesses,
        rejectedImmovableCandidates: state.zeroTurnRecovery.rejectedImmovableCandidates,
        selectedScrollElement: state.conversationDetection.selectedScrollElement
      }
    );
    return { recovered: false, scrollEl: activeScrollEl };
  }

  function makeOverlay() {
    if (!CONFIG.showInPageProgress) {
      return {
        update({ phase, pass, count, hint }) {
          if (pass !== undefined) state.currentPass = pass;
          updateExtensionStatus({
            phase: phase ?? state.status.phase,
            hint: hint ?? state.status.hint,
            captured: count ?? state.collected.size
          });
        },
        remove() {}
      };
    }

    const root = document.createElement("div");
    root.id = "chatgpt-full-chat-saver-v4-overlay";
    root.style.position = "fixed";
    root.style.right = "16px";
    root.style.bottom = "16px";
    root.style.zIndex = "2147483647";
    root.style.width = "390px";
    root.style.maxWidth = "calc(100vw - 32px)";
    root.style.background = "rgba(0,0,0,0.92)";
    root.style.color = "white";
    root.style.border = "1px solid rgba(255,255,255,.18)";
    root.style.borderRadius = "10px";
    root.style.boxShadow = "0 6px 28px rgba(0,0,0,.35)";
    root.style.font = "13px system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    root.style.padding = "12px";

    root.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px;">ChatGPT Archive Exporter V1.4.0</div>
      <div data-line="mode" style="opacity:.75; margin-bottom:3px;">Mode: ${escapeHtml(CONFIG.mode)}</div>
      <div data-line="phase" style="opacity:.9; margin-bottom:3px;">Starting...</div>
      <div data-line="counts" style="opacity:.8; margin-bottom:3px;">Captured: 0 turns</div>
      <div data-line="pass" style="opacity:.8; margin-bottom:8px;">Pass: 0</div>
      <div style="display:flex; gap:8px;">
        <button data-action="stop-save"
          style="flex:1; cursor:pointer; border:0; border-radius:6px; padding:7px; font-weight:700;">
          Stop & Save Now
        </button>
        <button data-action="cancel"
          style="flex:1; cursor:pointer; border:0; border-radius:6px; padding:7px;">
          Cancel
        </button>
      </div>
      <div data-line="hint" style="font-size:11px; opacity:.65; margin-top:8px;">
        Fast scan. Repair pass runs only if gaps are detected.
      </div>
    `;

    document.documentElement.appendChild(root);

    const phaseEl = root.querySelector('[data-line="phase"]');
    const countsEl = root.querySelector('[data-line="counts"]');
    const passEl = root.querySelector('[data-line="pass"]');
    const hintEl = root.querySelector('[data-line="hint"]');

    root.querySelector('[data-action="stop-save"]').addEventListener("click", () => {
      state.stopAndSave = true;
      hintEl.textContent = "Stopping after current wait, then saving...";
    });

    root.querySelector('[data-action="cancel"]').addEventListener("click", () => {
      state.cancelled = true;
      hintEl.textContent = "Cancelling...";
    });

    return {
      update({ phase, pass, count, hint }) {
        if (pass !== undefined) state.currentPass = pass;

        updateExtensionStatus({
          phase: phase ?? state.status.phase,
          hint: hint ?? state.status.hint,
          captured: count ?? state.collected.size
        });

        if (phase !== undefined) phaseEl.textContent = phase;
        if (count !== undefined) countsEl.textContent = `Captured: ${count} turns`;
        if (pass !== undefined) passEl.textContent = `Pass: ${pass}`;
        if (hint !== undefined) hintEl.textContent = hint;
      },
      remove() {
        root.remove();
      }
    };
  }

  function classifyRendererGeneration(signals) {
    const redesignedSignals = Number(signals?.turnKey || 0) +
      Number(signals?.conversationRole || 0) +
      Number(signals?.userMessageBubble || 0) +
      Number(signals?.agentTurnStart || 0) +
      Number(signals?.selectionTarget || 0) +
      Number(signals?.timelineScroll || 0);
    const legacySignals = Number(signals?.conversationTurn || 0) +
      Number(signals?.messageAuthorRole || 0) +
      Number(signals?.dataTurnId || 0);

    if (redesignedSignals > 0) return "redesigned";
    if (legacySignals > 0) return "legacy";
    return "unknown";
  }

  function probeSignedScrollBehavior(el) {
    if (!(el instanceof HTMLElement)) {
      return {
        tested: false,
        initial: null,
        positiveAfter: null,
        negativeAfter: null,
        restored: null,
        positiveMoves: false,
        negativeMoves: false
      };
    }

    const initial = Number(el.scrollTop || 0);
    const range = Math.max(0, Number(el.scrollHeight || 0) - Number(el.clientHeight || 0));
    const step = Math.max(24, Math.min(96, Math.floor(Math.max(96, Number(el.clientHeight || 0)) * 0.08)));
    let positiveAfter = initial;
    let negativeAfter = initial;
    let restored = initial;

    try {
      el.scrollTop = initial + step;
      positiveAfter = Number(el.scrollTop || 0);
      el.scrollTop = initial;
      el.scrollTop = initial - step;
      negativeAfter = Number(el.scrollTop || 0);
      el.scrollTop = initial;
      restored = Number(el.scrollTop || 0);
    } catch {}

    return {
      tested: true,
      initial,
      range,
      step,
      positiveAfter,
      negativeAfter,
      restored,
      positiveMoves: Math.abs(positiveAfter - initial) >= 2,
      negativeMoves: Math.abs(negativeAfter - initial) >= 2
    };
  }

  function probeRendererGeneration(scrollEl) {
    const selectors = {
      conversationTurn: countSelector(document, '[data-testid^="conversation-turn-"]'),
      messageAuthorRole: countSelector(document, '[data-message-author-role]'),
      dataTurnId: countSelector(document, '[data-turn-id]'),
      turnKey: countSelector(document, '[data-turn-key]'),
      conversationRole: countSelector(document, '[data-conversation-role="user"], [data-conversation-role="assistant"]'),
      userMessageBubble: countSelector(document, '[data-user-message-bubble]'),
      agentTurnStart: countSelector(document, '[data-chatgpt-agent-turn-start]'),
      selectionTarget: countSelector(document, '[data-chatgpt-conversation-selection-target]'),
      searchMessageIds: countSelector(document, '[data-chatgpt-search-message-ids]'),
      timelineScroll: countSelector(document, '[data-app-action-timeline-scroll]')
    };

    const generation = classifyRendererGeneration(selectors);
    const timeline = document.querySelector('[data-app-action-timeline-scroll]');
    const signedScrollProbe = probeSignedScrollBehavior(
      timeline instanceof HTMLElement ? timeline : scrollEl
    );

    return {
      generation,
      legacySignals:
        selectors.conversationTurn + selectors.messageAuthorRole + selectors.dataTurnId,
      redesignedSignals:
        selectors.turnKey + selectors.conversationRole + selectors.userMessageBubble + selectors.agentTurnStart +
        selectors.selectionTarget + selectors.timelineScroll,
      selectors,
      signedScrollProbe,
      timelineElementFound: timeline instanceof HTMLElement
    };
  }

  function conversationIdFromLocation() {
    try {
      const match = String(location.pathname || "").match(/\/c\/([0-9a-f-]{20,})/i);
      return match?.[1] || "";
    } catch {
      return "";
    }
  }

  function diagnosticMessageTextLength(message) {
    const content = message?.content;
    if (!content || typeof content !== "object") return 0;
    const contentType = String(content.content_type || "");
    if (contentType === "thoughts" || contentType === "reasoning_recap") return 0;

    let total = 0;
    const add = (value) => {
      if (typeof value === "string") total += value.length;
      else if (value && typeof value === "object") {
        if (typeof value.text === "string") total += value.text.length;
        else if (typeof value.content === "string") total += value.content.length;
      }
    };

    if (Array.isArray(content.parts)) {
      for (const part of content.parts) add(part);
    } else {
      add(content.text);
    }
    return total;
  }

  function summarizeCanonicalConversation(data) {
    const result = {
      format: null,
      mappingNodeCount: 0,
      messagesArrayCount: Array.isArray(data?.messages) ? data.messages.length : 0,
      currentNodePresent: false,
      activeBranchRawNodes: 0,
      visibleMessageNodes: 0,
      visibleRoleRuns: 0,
      userNodes: 0,
      assistantNodes: 0,
      contentChars: 0,
      firstRole: null,
      lastRole: null,
      branchCycleDetected: false,
      filteredHiddenNodes: 0,
      filteredNonConversationRoles: 0,
      filteredEmptyNodes: 0
    };

    let pathMessages = [];
    const mapping = data?.mapping;
    if (mapping && typeof mapping === "object" && !Array.isArray(mapping)) {
      result.format = "mapping";
      result.mappingNodeCount = Object.keys(mapping).length;
      let current = String(data?.current_node || "");
      result.currentNodePresent = Boolean(current && mapping[current]);
      const seen = new Set();
      const path = [];
      while (current && mapping[current]) {
        if (seen.has(current)) {
          result.branchCycleDetected = true;
          break;
        }
        seen.add(current);
        const node = mapping[current];
        path.push(node);
        current = String(node?.parent || "");
      }
      path.reverse();
      result.activeBranchRawNodes = path.length;
      pathMessages = path.map((node) => node?.message).filter(Boolean);
    } else if (Array.isArray(data?.messages)) {
      result.format = "messages";
      result.activeBranchRawNodes = data.messages.length;
      pathMessages = data.messages;
      result.currentNodePresent = Boolean(data?.current_node);
    } else {
      result.format = "unknown";
    }

    const visibleRoles = [];
    for (const message of pathMessages) {
      const role = String(message?.author?.role || message?.role || "");
      const hidden = Boolean(message?.metadata?.is_visually_hidden_from_conversation);
      if (hidden) {
        result.filteredHiddenNodes += 1;
        continue;
      }
      if (role !== "user" && role !== "assistant") {
        result.filteredNonConversationRoles += 1;
        continue;
      }
      const chars = diagnosticMessageTextLength(message);
      if (chars <= 0) {
        result.filteredEmptyNodes += 1;
        continue;
      }
      visibleRoles.push(role);
      result.visibleMessageNodes += 1;
      result.contentChars += chars;
      if (role === "user") result.userNodes += 1;
      if (role === "assistant") result.assistantNodes += 1;
    }

    result.firstRole = visibleRoles[0] || null;
    result.lastRole = visibleRoles[visibleRoles.length - 1] || null;
    let previous = null;
    for (const role of visibleRoles) {
      if (role !== previous) result.visibleRoleRuns += 1;
      previous = role;
    }
    return result;
  }

  async function fetchJsonForAlphaProbe(url, options = {}, timeoutMs = 5000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(500, timeoutMs));
    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        ...options,
        signal: controller.signal
      });
      let data = null;
      if (response.ok) {
        try {
          data = await response.json();
        } catch {}
      }
      return { ok: response.ok, status: response.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  async function probeCanonicalConversation() {
    const result = {
      attempted: false,
      status: "not-run",
      conversationIdDetected: false,
      authSessionStatus: null,
      authorizationAvailable: false,
      httpStatus: null,
      format: null,
      mappingNodeCount: 0,
      messagesArrayCount: 0,
      currentNodePresent: false,
      activeBranchRawNodes: 0,
      visibleMessageNodes: 0,
      visibleRoleRuns: 0,
      userNodes: 0,
      assistantNodes: 0,
      contentChars: 0,
      firstRole: null,
      lastRole: null,
      branchCycleDetected: false,
      filteredHiddenNodes: 0,
      filteredNonConversationRoles: 0,
      filteredEmptyNodes: 0,
      error: null
    };

    const conversationId = conversationIdFromLocation();
    result.conversationIdDetected = Boolean(conversationId);
    if (!conversationId) {
      result.status = "no-conversation-id";
      return result;
    }

    result.attempted = true;
    const timeoutMs = Number(CONFIG.alphaCanonicalProbeTimeoutMs || 5000);
    try {
      let accessToken = "";
      try {
        const session = await fetchJsonForAlphaProbe("/api/auth/session", {}, Math.min(timeoutMs, 3500));
        result.authSessionStatus = session.status;
        accessToken = typeof session.data?.accessToken === "string" ? session.data.accessToken : "";
        result.authorizationAvailable = Boolean(accessToken);
      } catch (error) {
        result.authSessionStatus = null;
      }

      const headers = { Accept: "application/json" };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
      const response = await fetchJsonForAlphaProbe(
        `/backend-api/conversation/${encodeURIComponent(conversationId)}`,
        { headers },
        timeoutMs
      );
      result.httpStatus = response.status;
      if (!response.ok || !response.data) {
        result.status = `http-${response.status}`;
        return result;
      }

      Object.assign(result, summarizeCanonicalConversation(response.data));
      result.status = "ok";
      return result;
    } catch (error) {
      result.status = error?.name === "AbortError" ? "timeout" : "error";
      result.error = String(error?.message || error || "unknown error").slice(0, 240);
      return result;
    }
  }

  async function runAlphaDiagnostics(scrollEl) {
    if (!CONFIG.alphaDiagnosticsEnabled || state.alphaDiagnostics.ran) return;
    state.alphaDiagnostics.ran = true;
    state.alphaDiagnostics.ranAt = new Date().toISOString();
    state.alphaDiagnostics.rendererProbe = probeRendererGeneration(scrollEl);
    state.alphaDiagnostics.canonicalProbe = CONFIG.alphaCanonicalProbeEnabled
      ? await probeCanonicalConversation()
      : { ...state.alphaDiagnostics.canonicalProbe, attempted: false, status: "disabled-alpha2" };
  }

  function isRedesignedAssistantSemanticLabel(node) {
    if (!node) return false;
    const text = compactText(node.innerText || node.textContent || "");
    const containsContent = Boolean(node.querySelector?.(
      ".markdown, [data-markdown-text-style='assistant-message'], pre, code, table, img, svg, canvas, [data-testid*='writing'], [data-testid*='artifact'], [class*='writing-block'], [class*='artifact']"
    ));
    if (containsContent) return false;
    return text === "" || /^(chatgpt\s+said:?|assistant:?)$/i.test(text);
  }

  function pruneRedesignedAssistantClone(clone) {
    if (!clone?.querySelectorAll) return clone;

    const users = Array.from(clone.querySelectorAll('[data-user-message-bubble]'));
    for (const node of users) {
      node.remove();
      state.redesignedAssistantValidation.prunedUserSubtrees += 1;
    }

    const semantic = Array.from(clone.querySelectorAll(
      '[data-conversation-role="assistant"], [data-chatgpt-agent-turn-start]'
    ));
    for (const node of semantic) {
      if (!isRedesignedAssistantSemanticLabel(node)) continue;
      node.remove();
      state.redesignedAssistantValidation.prunedSemanticLabels += 1;
    }

    clone.querySelectorAll('.turn-action-controls').forEach((node) => node.remove());
    return clone;
  }

  function extractRedesignedAssistantText(group) {
    if (!group?.cloneNode) return "";
    const clone = group.cloneNode(true);
    pruneRedesignedAssistantClone(clone);
    clone.querySelectorAll?.("button, [role='button'], textarea, input, select, form")
      ?.forEach((node) => node.remove());
    clone.querySelectorAll?.("[contenteditable='true']")?.forEach((node) => {
      if (isKnownRichEditable(node)) {
        node.removeAttribute("contenteditable");
        node.removeAttribute("tabindex");
        node.removeAttribute("role");
        return;
      }
      node.remove();
    });
    return normalizeText(clone.innerText || clone.textContent || "");
  }

  function selectRedesignedAssistantNode(group) {
    if (!group?.querySelector) return null;
    const marker =
      group.querySelector('[data-conversation-role="assistant"]') ||
      group.querySelector('[data-chatgpt-agent-turn-start]') ||
      null;
    if (!marker) return null;

    // In the redesigned renderer the assistant semantic marker can contain only
    // "ChatGPT said:" while the rendered answer is a sibling elsewhere under
    // the stable data-turn-key wrapper. The wrapper is therefore the logical
    // assistant turn; export code prunes the user half from a clone.
    state.redesignedAssistantValidation.assistantGroupsSeen += 1;
    return group;
  }

  function findConversationTurns() {
    const legacySelectors = [
      '[data-testid^="conversation-turn-"]',
      '[data-turn][data-turn-id]',
      "article",
      "[data-message-author-role]"
    ];

    const scope = getActiveConversationScope();
    const queryRoot = scope?.root || document;
    const seen = new Set();
    const out = [];
    const scopeContains = (node) => {
      if (!node) return false;
      if (queryRoot === document) return node?.isConnected !== false;
      try { return queryRoot.contains(node); } catch { return false; }
    };
    const collectNodes = (nodes, { preserveNode = false } = {}) => {
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (!scopeContains(node)) continue;

        let turn = node;

        if (!preserveNode && !turn.matches('[data-testid^="conversation-turn-"]')) {
          const article = turn.closest('[data-testid^="conversation-turn-"], article');
          if (article instanceof HTMLElement && scopeContains(article)) {
            turn = article;
          }
        }

        if (seen.has(turn)) continue;

        const text = compactText(turn.innerText || turn.textContent || "");
        if (text.length < 2) continue;

        seen.add(turn);
        out.push(turn);
      }
    };

    const collectRedesignedGroups = (root) => {
      let groups = [];
      try { groups = root?.querySelectorAll?.('[data-turn-key]') || []; } catch {}
      for (const group of groups) {
        if (!(group instanceof HTMLElement)) continue;
        const user = group.querySelector('[data-user-message-bubble]');
        if (user instanceof HTMLElement) collectNodes([user], { preserveNode: true });
        const assistant = selectRedesignedAssistantNode(group);
        if (assistant instanceof HTMLElement) collectNodes([assistant], { preserveNode: true });
      }
    };

    const collectLegacy = (root) => {
      for (const selector of legacySelectors) {
        let nodes = [];
        try { nodes = root?.querySelectorAll?.(selector) || []; } catch {}
        collectNodes(nodes);
      }
    };

    // Redesigned ChatGPT is authoritative whenever the active conversation has
    // a redesigned thread/timeline. This prevents hidden stale legacy turns
    // elsewhere in the SPA document from winning the old document-wide fast path.
    if (scope?.generation === "redesigned") {
      collectRedesignedGroups(queryRoot);
      if (out.length > 0) {
        state.renderer.generation = "redesigned";
        return out;
      }
      // Transitional layouts can still expose legacy wrappers, but accept them
      // only when they are inside the selected active timeline/thread.
      collectLegacy(queryRoot);
      if (out.length > 0) return out;
    } else {
      // Legacy capture is now scoped to the active <main> rather than document.
      collectLegacy(queryRoot);
      if (out.length > 0) return out;
      // If redesigned groups appear inside the selected scope despite missing
      // the outer marker, use them before considering any shadow-root fallback.
      collectRedesignedGroups(queryRoot);
      if (out.length > 0) {
        state.renderer.generation = "redesigned";
        return out;
      }
    }

    const collectFromShadowRoots = (roots) => {
      for (const root of roots) {
        if (scope?.generation === "redesigned") collectRedesignedGroups(root);
        collectLegacy(root);
      }
    };

    // Search only shadow roots reachable from the active conversation scope.
    let shadowRoots = getCachedConversationShadowRoots();
    if (shadowRoots.length > 0) collectFromShadowRoots(shadowRoots);
    if (out.length === 0) {
      shadowRoots = discoverOpenShadowRoots(queryRoot);
      collectFromShadowRoots(shadowRoots);
    }

    if (out.length > 0) {
      const roots = [];
      const rootSeen = new Set();
      for (const turn of out) {
        let root = null;
        try {
          root = turn.getRootNode?.() || null;
        } catch {}
        if (!root?.host || rootSeen.has(root)) continue;
        rootSeen.add(root);
        roots.push(root);
      }
      cachedConversationShadowRoots = roots;
    }

    return out;
  }

  function detectExplicitRedesignedRole(turn) {
    if (!turn) return null;

    // Explicit assistant markers must win over the broad user-bubble ancestor.
    // In the redesigned renderer both logical roles live under one stable
    // [data-turn-key] group, and assistant content may still be nested inside
    // an ancestor that also contains the user's bubble.
    const selfConversationRole = turn?.getAttribute?.("data-conversation-role");
    if (selfConversationRole === "assistant" || selfConversationRole === "user") {
      return selfConversationRole;
    }
    if (turn?.matches?.('[data-chatgpt-agent-turn-start]')) return "assistant";
    if (turn?.matches?.('[data-user-message-bubble]')) return "user";

    const nestedAssistant = turn?.querySelector?.('[data-conversation-role="assistant"]');
    if (nestedAssistant) return "assistant";
    const nestedUser = turn?.querySelector?.('[data-conversation-role="user"]');
    if (nestedUser) return "user";

    if (turn?.closest?.('[data-user-message-bubble]')) return "user";
    return null;
  }

  function detectRole(turn) {
    // Redesigned renderer exposes two logical roles under one [data-turn-key]
    // group. Resolve its explicit role markers before any legacy/text fallback.
    const redesignedRole = detectExplicitRedesignedRole(turn);
    if (redesignedRole) return redesignedRole;

    const selfRole = turn?.getAttribute?.("data-message-author-role");
    if (selfRole) return selfRole;

    const dataTurnRole = turn?.getAttribute?.("data-turn");
    if (dataTurnRole === "user" || dataTurnRole === "assistant") return dataTurnRole;

    const roleNode = turn.querySelector?.("[data-message-author-role]");
    const role = roleNode?.getAttribute("data-message-author-role");
    if (role) return role;

    const dataTurnNode = turn.querySelector?.('[data-turn="user"], [data-turn="assistant"]');
    const nestedDataTurnRole = dataTurnNode?.getAttribute?.("data-turn");
    if (nestedDataTurnRole === "user" || nestedDataTurnRole === "assistant") {
      return nestedDataTurnRole;
    }

    const text = compactText(turn.innerText || turn.textContent || "").toLowerCase();
    if (
      text.startsWith("you\n") ||
      text.startsWith("you:") ||
      text.startsWith("user\n") ||
      text.startsWith("user:")
    ) {
      return "user";
    }

    return "assistant";
  }

  function detectStableId(turn) {
    const turnGroup = turn?.closest?.('[data-turn-key]');
    const turnKey = turnGroup?.getAttribute?.("data-turn-key") || "";
    if (turnKey) {
      const redesignedRole = detectExplicitRedesignedRole(turn);
      if (redesignedRole === "assistant") return `group:assistant:${turnKey}`;
      if (redesignedRole === "user") return `group:user:${turnKey}`;
    }

    const testId = turn?.getAttribute?.("data-testid");
    if (testId && /conversation-turn-|message/i.test(testId)) return testId;

    const dataTurnId = turn?.getAttribute?.("data-turn-id");
    if (dataTurnId) return dataTurnId;

    const nestedDataTurnId = turn.querySelector?.("[data-turn-id]")?.getAttribute?.("data-turn-id");
    if (nestedDataTurnId) return nestedDataTurnId;

    const selfMessageId = turn?.getAttribute?.("data-message-id");
    if (selfMessageId) return selfMessageId;

    const messageIdNode = turn.querySelector?.("[data-message-id]");
    if (messageIdNode) return messageIdNode.getAttribute("data-message-id") || "";

    return "";
  }

  function extractTurnIndex(stableId) {
    const m = String(stableId || "").match(/conversation-turn-(\d+)/);
    return m ? Number(m[1]) : null;
  }

  function getBestMessageContentNode(turn, role) {
    if (role === "assistant") {
      if (turn?.matches?.('[data-turn-key]')) {
        return turn;
      }
      if (turn?.matches?.('[data-conversation-role="assistant"]')) {
        return turn.querySelector?.(".markdown") || turn;
      }
      if (turn?.matches?.('[data-message-author-role="assistant"]')) {
        return turn.querySelector?.(".markdown") || turn;
      }

      return (
        turn.querySelector?.(".markdown") ||
        turn.querySelector?.('[data-message-author-role="assistant"]') ||
        turn
      );
    }

    if (role === "user") {
      if (turn?.matches?.('[data-user-message-bubble]')) {
        return turn;
      }
      if (turn?.matches?.('[data-message-author-role="user"]')) {
        return turn;
      }

      return (
        turn.querySelector?.('[data-message-author-role="user"]') ||
        turn
      );
    }

    return turn;
  }

  const CONTROL_LABEL_PATTERNS = [
    /^copy$/i,
    /^edit$/i,
    /^read aloud$/i,
    /^good response$/i,
    /^bad response$/i,
    /^regenerate$/i,
    /^try again$/i,
    /^share$/i,
    /^more$/i,
    /^open sidebar$/i,
    /^close$/i,
    /^new chat$/i,
    /^model selector$/i,
    /^voice$/i,
    /^stop streaming$/i
  ];

  function isKnownChromeOrChatControl(el) {
    const aria = el.getAttribute("aria-label") || "";
    const title = el.getAttribute("title") || "";
    const text = compactText(el.innerText || el.textContent || "");
    const testid = el.getAttribute("data-testid") || "";

    const joined = [aria, title, text, testid].filter(Boolean).join(" | ");

    if (!joined) return false;

    if (/copy-turn-action|good-response|bad-response|regenerate|voice|composer|sidebar/i.test(testid)) {
      return true;
    }

    return CONTROL_LABEL_PATTERNS.some((rx) => rx.test(aria) || rx.test(title) || rx.test(text));
  }

  function buttonLooksLikeContent(el) {
    const text = compactText(el.innerText || el.textContent || "");
    const aria = compactText(el.getAttribute("aria-label") || "");
    const href = el.getAttribute("href") || "";
    const label = text || aria;

    if (href) return true;
    if (/download|file|attachment|csv|pdf|txt|js|zip|docx|xlsx|pptx|open|sandbox/i.test(label)) return true;
    if (text.length > 3 && !isKnownChromeOrChatControl(el)) return true;

    return false;
  }

  function getContentButtonHref(el) {
    if (!el) return "";

    if (el instanceof HTMLAnchorElement && el.href) return el.href;

    const anchor = el.querySelector?.("a[href]");
    if (anchor?.href) return anchor.href;

    const closestAnchor = el.closest?.("a[href]");
    if (closestAnchor?.href) return closestAnchor.href;

    return "";
  }

  function staticizeContentButton(el) {
    let text = compactText(el.innerText || el.textContent || el.getAttribute("aria-label") || "Button");

    // ChatGPT file chips sometimes expose duplicated tooltip/control text.
    text = text
      .replace(/^download file\s*/i, "")
      .replace(/\s*download file$/i, "")
      .replace(/\s+/g, " ")
      .trim() || compactText(el.getAttribute("aria-label") || "File");

    const href = getContentButtonHref(el);

    const replacement = href
      ? document.createElement("a")
      : document.createElement("span");

    replacement.className = "saved-static-button saved-file-chip";
    replacement.textContent = text;

    if (href) {
      replacement.href = href;
      replacement.target = "_blank";
      replacement.rel = "noopener noreferrer";
    }

    return replacement;
  }

  const OUTPUT_TAB_LABELS = new Set([
    "plain text", "text", "html", "json", "markdown", "code", "preview",
    "javascript", "typescript", "python", "bash", "shell", "css", "xml", "yaml", "sql"
  ]);

  function normalizedUiLabel(el) {
    return compactText(
      el?.getAttribute?.("aria-label") ||
      el?.getAttribute?.("title") ||
      el?.innerText ||
      el?.textContent ||
      ""
    ).toLowerCase();
  }

  function isOutputFormatLabel(text) {
    return OUTPUT_TAB_LABELS.has(compactText(text || "").toLowerCase());
  }

  function outputFormatButtons(container) {
    if (!container?.querySelectorAll) return [];
    return Array.from(container.querySelectorAll(
      "button, [role='tab'], [data-state], [aria-selected]"
    )).filter((el) => isOutputFormatLabel(normalizedUiLabel(el)));
  }

  function richOutputLabels(container) {
    const seen = new Set();
    const labels = [];
    for (const el of outputFormatButtons(container)) {
      const label = compactText(el.innerText || el.textContent || el.getAttribute?.("aria-label") || "");
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }
    return labels;
  }

  function activeOutputLabel(container) {
    const buttons = outputFormatButtons(container);
    const active = buttons.find((el) =>
      el.getAttribute?.("aria-selected") === "true" ||
      el.getAttribute?.("aria-current") === "true" ||
      ["active", "selected", "checked"].includes(String(el.getAttribute?.("data-state") || "").toLowerCase())
    );
    const chosen = active || buttons[0] || null;
    return compactText(chosen?.innerText || chosen?.textContent || chosen?.getAttribute?.("aria-label") || "");
  }

  function formatLabelToLanguage(label) {
    const value = compactText(label || "").toLowerCase();
    if (!value) return "";
    if (value === "plain text" || value === "text") return "text";
    if (value === "markdown") return "markdown";
    if (value === "javascript") return "javascript";
    if (value === "typescript") return "typescript";
    if (value === "shell") return "bash";
    if (["html", "json", "python", "bash", "css", "xml", "yaml", "sql"].includes(value)) return value;
    return "";
  }

  function escapeCodeTextHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function highlightCodeTextForArchive(text, language) {
    const source = String(text || "");
    const lang = formatLabelToLanguage(language) || compactText(language || "").toLowerCase();
    const wrap = (cls, value) => `<span class="saved-syn-${cls}">${escapeCodeTextHtml(value)}</span>`;

    const generic = (regex, classify) => {
      let out = "";
      let last = 0;
      regex.lastIndex = 0;
      for (let match = regex.exec(source); match; match = regex.exec(source)) {
        out += escapeCodeTextHtml(source.slice(last, match.index));
        out += wrap(classify(match[0], match), match[0]);
        last = match.index + match[0].length;
      }
      out += escapeCodeTextHtml(source.slice(last));
      return out;
    };

    if (lang === "json") {
      const tokenRe = /"(?:\\.|[^"\\])*"|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b|\b(?:true|false|null)\b|[{}\[\],:]/g;
      let out = "";
      let last = 0;
      for (let match = tokenRe.exec(source); match; match = tokenRe.exec(source)) {
        out += escapeCodeTextHtml(source.slice(last, match.index));
        const token = match[0];
        let cls = "punctuation";
        if (token.startsWith('"')) {
          cls = /^\s*:/.test(source.slice(tokenRe.lastIndex)) ? "property" : "string";
        } else if (/^(?:true|false|null)$/.test(token)) {
          cls = "constant";
        } else if (/^-?\d/.test(token)) {
          cls = "number";
        }
        out += wrap(cls, token);
        last = match.index + token.length;
      }
      out += escapeCodeTextHtml(source.slice(last));
      return out;
    }

    if (lang === "html" || lang === "xml") {
      const tagRe = /<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*?>/g;
      let out = "";
      let last = 0;
      for (let match = tagRe.exec(source); match; match = tagRe.exec(source)) {
        out += escapeCodeTextHtml(source.slice(last, match.index));
        const token = match[0];
        if (token.startsWith("<!--")) {
          out += wrap("comment", token);
        } else {
          const tm = token.match(/^(<\/?)([A-Za-z][\w:-]*)([\s\S]*?)(\/?>)$/);
          if (!tm) {
            out += wrap("tag", token);
          } else {
            out += escapeCodeTextHtml(tm[1]) + wrap("tag", tm[2]);
            const attrs = tm[3];
            const attrRe = /([^\s=/>]+)(\s*=\s*)("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s>]+)/g;
            let attrLast = 0;
            for (let am = attrRe.exec(attrs); am; am = attrRe.exec(attrs)) {
              out += escapeCodeTextHtml(attrs.slice(attrLast, am.index));
              out += wrap("attribute", am[1]);
              out += wrap("operator", am[2]);
              out += wrap("string", am[3]);
              attrLast = am.index + am[0].length;
            }
            out += escapeCodeTextHtml(attrs.slice(attrLast));
            out += escapeCodeTextHtml(tm[4]);
          }
        }
        last = match.index + token.length;
      }
      out += escapeCodeTextHtml(source.slice(last));
      return out;
    }

    if (lang === "javascript" || lang === "typescript") {
      return generic(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*|`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:async|await|break|case|catch|class|const|continue|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|while|yield|true|false|null|undefined)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
        (token) => token.startsWith("//") || token.startsWith("/*") ? "comment" :
          /^["'`]/.test(token) ? "string" :
          /^(?:true|false|null|undefined)$/.test(token) ? "constant" :
          /^-?\d/.test(token) ? "number" : "keyword"
      );
    }

    if (lang === "python") {
      return generic(
        /#[^\n]*|'''[\s\S]*?'''|"""[\s\S]*?"""|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\b(?:and|as|assert|async|await|break|class|continue|def|del|elif|else|except|False|finally|for|from|global|if|import|in|is|lambda|None|nonlocal|not|or|pass|raise|return|True|try|while|with|yield)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g,
        (token) => token.startsWith("#") ? "comment" :
          /^(?:'''|"""|['"])/.test(token) ? "string" :
          /^(?:True|False|None)$/.test(token) ? "constant" :
          /^-?\d/.test(token) ? "number" : "keyword"
      );
    }

    if (lang === "css") {
      return generic(
        /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|--?[A-Za-z_][\w-]*(?=\s*:)|#[0-9A-Fa-f]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms|deg)?\b/g,
        (token) => token.startsWith("/*") ? "comment" :
          /^["']/.test(token) ? "string" :
          /^--?[A-Za-z_]/.test(token) ? "property" : "number"
      );
    }

    if (lang === "bash") {
      return generic(
        /#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|\b(?:case|do|done|elif|else|esac|fi|for|function|if|in|select|then|time|until|while)\b|-?\b\d+(?:\.\d+)?\b/g,
        (token) => token.startsWith("#") ? "comment" :
          /^["']/.test(token) ? "string" :
          token.startsWith("$") ? "variable" :
          /^-?\d/.test(token) ? "number" : "keyword"
      );
    }

    if (lang === "sql") {
      return generic(
        /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|\b(?:SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP|BY|ORDER|HAVING|INSERT|INTO|UPDATE|DELETE|CREATE|ALTER|DROP|TABLE|VALUES|SET|AS|AND|OR|NOT|NULL|TRUE|FALSE|LIMIT|OFFSET)\b|-?\b\d+(?:\.\d+)?\b/gi,
        (token) => token.startsWith("--") || token.startsWith("/*") ? "comment" :
          /^["']/.test(token) ? "string" :
          /^(?:NULL|TRUE|FALSE)$/i.test(token) ? "constant" :
          /^-?\d/.test(token) ? "number" : "keyword"
      );
    }

    if (lang === "yaml") {
      return generic(
        /#[^\n]*|"(?:\\.|[^"\\])*"|'(?:''|[^'])*'|^[ \t-]*[A-Za-z0-9_.-]+(?=\s*:)|\b(?:true|false|null|yes|no)\b|-?\b\d+(?:\.\d+)?\b/gim,
        (token) => token.trimStart().startsWith("#") ? "comment" :
          /^["']/.test(token.trimStart()) ? "string" :
          /^(?:true|false|null|yes|no)$/i.test(token.trim()) ? "constant" :
          /^\s*-?\d/.test(token) ? "number" : "property"
      );
    }

    return escapeCodeTextHtml(source);
  }

  function isCurrentChatGptCodeElement(code) {
    if (!(code instanceof Element) || code.tagName !== "CODE") return false;
    if (code.closest("pre, .cm-editor, [data-testid='writing-block-container']")) return false;
    const cls = String(code.getAttribute("class") || "");
    if (/CodeContent/i.test(cls)) return true;
    if (/whitespace-pre/i.test(cls) && /(?:^|\s)block(?:\s|$)/.test(cls)) return true;
    return Boolean(code.getAttribute("data-language") && code.parentElement?.getAttribute("dir") === "ltr");
  }

  function findCurrentCodeCardShell(code) {
    if (!isCurrentChatGptCodeElement(code)) return null;
    let child = code.parentElement;
    for (let depth = 0; child && depth < 3; depth += 1) {
      const candidate = child.parentElement;
      if (!(candidate instanceof Element)) break;
      const currentCodes = Array.from(candidate.querySelectorAll("code")).filter(isCurrentChatGptCodeElement);
      const hasSibling = Array.from(candidate.children).some((node) => node !== child && !node.contains(code));
      if (currentCodes.length === 1 && currentCodes[0] === code && hasSibling) return candidate;
      child = candidate;
    }
    return code.parentElement;
  }

  function currentCodeCardLabel(code) {
    if (!isCurrentChatGptCodeElement(code)) return "";
    const direct = compactText(code.getAttribute("data-language") || "");
    if (direct) return direct;
    const shell = findCurrentCodeCardShell(code);
    if (!(shell instanceof Element)) return "";
    const accepted = /^(plain text|text|html|json|markdown|code|javascript|typescript|python|bash|shell|css|xml|yaml|sql)$/i;
    for (const child of Array.from(shell.children)) {
      if (child === code || child.contains(code)) continue;
      const candidates = [child, ...child.querySelectorAll("div, span, label")];
      for (const node of candidates) {
        const label = compactText(node.innerText || node.textContent || "");
        if (label && label.length <= 24 && accepted.test(label)) return label;
      }
    }
    return "";
  }

  function staticizeCurrentCodeCards(root) {
    if (!root?.querySelectorAll) return;
    const codes = Array.from(root.querySelectorAll("code")).filter(isCurrentChatGptCodeElement);
    for (const code of codes) {
      if (!(code instanceof HTMLElement) || !root.contains(code) || code.closest(".saved-code-card")) continue;
      const shell = findCurrentCodeCardShell(code);
      if (!(shell instanceof HTMLElement) || !root.contains(shell)) continue;

      const label = currentCodeCardLabel(code) || "Code";
      let language = formatLabelToLanguage(label);
      if (!language) {
        const dataLanguage = compactText(code.getAttribute("data-language") || "");
        if (dataLanguage) language = formatLabelToLanguage(dataLanguage) || dataLanguage.toLowerCase();
      }
      if (!language) {
        const classLanguage = String(code.getAttribute("class") || "").match(/(?:^|\s)language-([a-z0-9_+-]+)/i);
        if (classLanguage) language = classLanguage[1].toLowerCase();
      }

      const rawText = String(code.textContent || "").replace(/\r\n?/g, "\n");
      const card = document.createElement("div");
      card.className = "saved-code-card";
      if (language) card.setAttribute("data-language", language);

      const header = document.createElement("div");
      header.className = "saved-code-card-header";
      const labelNode = document.createElement("span");
      labelNode.className = "saved-code-card-label";
      labelNode.textContent = label;
      header.appendChild(labelNode);

      const pre = document.createElement("pre");
      pre.className = "saved-code-card-scroll";
      const staticCode = document.createElement("code");
      staticCode.className = `saved-code-card-code${language ? ` language-${language}` : ""}`;

      const tokenNodes = Array.from(code.querySelectorAll("span, [class], [style]"));
      const hasPreservedSyntax =
        code.querySelectorAll("span").length > 1 ||
        tokenNodes.filter((node) => {
          const cls = String(node.getAttribute?.("class") || "");
          return /(?:hljs|token|tok-)/i.test(cls) || Boolean(node.getAttribute?.("style")?.match(/(?:^|;)\s*color\s*:/i));
        }).length > 1;

      if (hasPreservedSyntax) {
        staticCode.innerHTML = code.innerHTML;
      } else {
        staticCode.innerHTML = highlightCodeTextForArchive(rawText, language || label);
      }

      pre.appendChild(staticCode);
      card.appendChild(header);
      card.appendChild(pre);
      shell.replaceWith(card);
      state.richOutputFormatting.codeCardsStaticized += 1;
    }
  }

  function inferRichOutputLanguage(container) {
    if (!container) return "";
    const direct = compactText(container.getAttribute?.("data-language") || "");
    if (direct) return formatLabelToLanguage(direct) || direct.toLowerCase();
    const nested = container.querySelector?.("[data-language]")?.getAttribute?.("data-language") || "";
    if (nested) return formatLabelToLanguage(nested) || compactText(nested).toLowerCase();
    const cls = String(container.getAttribute?.("class") || "");
    const m = cls.match(/(?:^|\s)language-([a-z0-9_+-]+)/i);
    if (m) return m[1].toLowerCase();
    return formatLabelToLanguage(activeOutputLabel(container));
  }

  function writingBlockLooksPreformatted(container) {
    if (!container) return false;
    const labels = richOutputLabels(container).map((x) => x.toLowerCase());
    return labels.some((x) => [
      "plain text", "text", "html", "json", "markdown", "code",
      "javascript", "typescript", "python", "bash", "shell", "css", "xml", "yaml", "sql"
    ].includes(x));
  }

  function isKnownRichEditable(el) {
    if (!(el instanceof Element)) return false;
    return Boolean(
      el.closest?.('[data-testid="writing-block-container"], .writing-block-editor, .cm-editor, [data-code-block], [data-testid*="code-block"]')
    );
  }

  function removeViewportClippingStyles(el) {
    if (!(el instanceof HTMLElement)) return;
    for (const prop of ["height", "max-height", "min-height", "overflow", "overflow-x", "overflow-y"]) {
      el.style.removeProperty(prop);
    }
  }

  function staticizeOutputFormatTabs(root) {
    if (!root?.querySelectorAll) return;
    const seen = new Set();
    const scopes = [
      ...root.querySelectorAll('[data-testid="writing-block-header-surface"]'),
      ...root.querySelectorAll('[data-code-block], [data-testid*="code-block"], [class*="code-block"]')
    ];
    for (const scope of scopes) {
      if (!(scope instanceof Element) || seen.has(scope)) continue;
      seen.add(scope);
      for (const el of outputFormatButtons(scope)) {
        const label = compactText(el.innerText || el.textContent || el.getAttribute?.("aria-label") || "");
        if (!label) continue;
        const span = document.createElement("span");
        span.className = "saved-output-tab";
        span.textContent = label;
        if (
          el.getAttribute?.("aria-selected") === "true" ||
          el.getAttribute?.("aria-current") === "true" ||
          ["active", "selected", "checked"].includes(String(el.getAttribute?.("data-state") || "").toLowerCase())
        ) {
          span.setAttribute("data-active", "true");
        }
        el.replaceWith(span);
        state.richOutputFormatting.outputTabsStaticized += 1;
      }
    }
  }

  function staticizeRichOutputBlocks(root) {
    if (!root?.querySelectorAll) return;
    staticizeOutputFormatTabs(root);

    for (const container of root.querySelectorAll('[data-testid="writing-block-container"]')) {
      if (!(container instanceof HTMLElement)) continue;
      container.classList.add("saved-writing-block");
      const header = container.querySelector('[data-testid="writing-block-header-surface"]');
      if (header instanceof HTMLElement) header.classList.add("saved-writing-block-header");
      const editor = container.querySelector(".writing-block-editor");
      if (editor instanceof HTMLElement) {
        editor.classList.add("saved-writing-block-editor");
        removeViewportClippingStyles(editor);
      }
      const content = container.querySelector(".writing-block-editor .ProseMirror, .writing-block-editor [contenteditable='true']");
      if (content instanceof HTMLElement) {
        content.classList.add("saved-writing-block-content");
        if (writingBlockLooksPreformatted(container)) content.classList.add("saved-output-preformatted");
        content.removeAttribute("contenteditable");
        content.removeAttribute("tabindex");
        content.removeAttribute("role");
        state.richOutputFormatting.richEditableNodesPreserved += 1;
      }
      state.richOutputFormatting.writingBlocksStaticized += 1;
    }

    for (const editor of root.querySelectorAll(".cm-editor")) {
      if (!(editor instanceof HTMLElement)) continue;
      editor.classList.add("saved-code-editor");
      removeViewportClippingStyles(editor);
      const shell = editor.closest('[data-code-block], [data-testid*="code-block"], [class*="code-block"]');
      if (shell instanceof HTMLElement) shell.classList.add("saved-code-panel");
      const scroller = editor.querySelector(".cm-scroller");
      if (scroller instanceof HTMLElement) {
        scroller.classList.add("saved-code-scroller");
        removeViewportClippingStyles(scroller);
      }
      const content = editor.querySelector(".cm-content");
      if (content instanceof HTMLElement) {
        content.classList.add("saved-code-content");
        removeViewportClippingStyles(content);
        content.removeAttribute("contenteditable");
        content.removeAttribute("tabindex");
      }
      for (const line of editor.querySelectorAll(".cm-line")) {
        if (line instanceof HTMLElement) line.classList.add("saved-code-line");
      }
      state.richOutputFormatting.codeEditorsStaticized += 1;
    }

    staticizeCurrentCodeCards(root);
  }

  function isMathElement(el) {
    if (!(el instanceof Element)) return false;

    return Boolean(
      el.matches(
        [
          ".katex",
          ".katex-display",
          ".katex-html",
          ".katex-mathml",
          "mjx-container",
          "math",
          "svg[data-mml-node]",
          "[class*='katex']",
          "[class*='MathJax']",
          "[class*='math']",
          "[data-mathml]",
          "[data-testid*='math']"
        ].join(",")
      ) ||
      el.closest(
        [
          ".katex",
          ".katex-display",
          ".katex-html",
          ".katex-mathml",
          "mjx-container",
          "math",
          "[class*='katex']",
          "[class*='MathJax']",
          "[class*='math']",
          "[data-mathml]",
          "[data-testid*='math']"
        ].join(",")
      )
    );
  }

  function isCodeLikeElement(el) {
    if (!(el instanceof Element)) return false;

    return Boolean(
      el.matches(
        [
          "pre",
          "code",
          "[class*='hljs']",
          "[class*='token']",
          "[class*='cm-']",
          "[class*='code']",
          "[data-testid*='code']"
        ].join(",")
      ) ||
      el.closest("pre, code, [class*='hljs'], [class*='token'], [class*='cm-'], [class*='code'], [data-testid*='code']")
    );
  }

  function shouldKeepInlineStyle(el) {
    return isMathElement(el) || isCodeLikeElement(el);
  }

  function cleanFileTileLabel(text) {
    const raw = compactText(text || "");

    if (!raw) return "File";

    const parts = raw
      .split(/\s+(?=PDF$|DOCX$|TXT$|MD$|CSV$|TSV$|XLSX$|PPTX$|ZIP$|JS$|HTML$)/i)
      .map((x) => compactText(x))
      .filter(Boolean);

    let label = raw
      .replace(/\b(PDF|DOCX|TXT|MD|CSV|TSV|XLSX|PPTX|ZIP|JS|HTML)\b\s*$/i, "")
      .replace(/\s+/g, " ")
      .trim();

    // If the card contains duplicated filename and file type, prefer the first
    // meaningful filename-looking piece.
    const filenameMatch = raw.match(/[^\n\r]+?\.(?:pdf|docx|txt|md|csv|tsv|xlsx|pptx|zip|js|html)/i);
    if (filenameMatch) label = filenameMatch[0].trim();

    return label || parts[0] || "File";
  }

  function staticizeFileTile(el) {
    const replacement = document.createElement("span");
    replacement.className = "saved-static-button saved-file-chip";
    replacement.textContent = cleanFileTileLabel(el.innerText || el.textContent || el.getAttribute("aria-label") || "File");

    const href = getContentButtonHref(el);
    if (href) {
      const a = document.createElement("a");
      a.className = replacement.className;
      a.textContent = replacement.textContent;
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    }

    return replacement;
  }

  function simplifyFileTiles(root) {
    if (!CONFIG.simplifyFileTilesBeforeClone) return;

    root.querySelectorAll('[class*="file-tile"]').forEach((el) => {
      if (!(el instanceof Element)) return;
      if (el.closest(".saved-file-chip")) return;

      el.replaceWith(staticizeFileTile(el));
    });
  }

  function hostnameLabelFromHref(href) {
    try {
      const url = new URL(href);
      const host = url.hostname.replace(/^www\./, "");

      if (host.includes("arxiv.org")) return "arXiv";
      if (host.includes("nature.com")) return "Nature";
      if (host.includes("biorxiv.org")) return "bioRxiv";
      if (host.includes("pubmed.ncbi.nlm.nih.gov")) return "PubMed";
      if (host.includes("ncbi.nlm.nih.gov")) return "NCBI";
      if (host.includes("rnaglib")) return "Rnaglib";
      if (host.includes("pdbbind")) return "PDBbind+";

      return host.split(".")[0].replace(/^\w/, (c) => c.toUpperCase());
    } catch {
      return "source";
    }
  }

  function cleanCitationLabel(a) {
    const raw = compactText(a.innerText || a.textContent || "");

    const cleaned = raw
      .replace(/\+\d+$/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleaned && cleaned.length <= 40) return cleaned;

    const title = compactText(a.getAttribute("aria-label") || a.getAttribute("title") || "");
    if (title && title.length <= 40) return title;

    return hostnameLabelFromHref(a.href || a.getAttribute("href") || "");
  }

  function isChatGPTCitationChip(a) {
    if (!(a instanceof HTMLAnchorElement)) return false;

    const href = a.href || "";
    if (!href || href.startsWith("javascript:")) return false;

    const cls = String(a.getAttribute("class") || "");
    const text = compactText(a.innerText || a.textContent || "");
    const hasFavicon = Boolean(a.querySelector('img[src*="google.com/s2/favicons"], img[src*="favicon"]'));

    if (hasFavicon) return true;
    if (cls.includes("rounded-xl") && cls.includes("text-[9px]")) return true;
    if (cls.includes("select-none") && cls.includes("text-token-text-secondary") && text.length <= 50) return true;

    return false;
  }

  function simplifyCitationLinks(root) {
    if (!CONFIG.simplifyCitationLinksBeforeClone) return;

    root.querySelectorAll("a[href]").forEach((a) => {
      if (!(a instanceof HTMLAnchorElement)) return;
      if (a.classList.contains("saved-citation-chip")) return;
      if (!isChatGPTCitationChip(a)) return;

      const replacement = document.createElement("a");
      replacement.className = "saved-citation-chip";
      replacement.href = a.href;
      replacement.target = "_blank";
      replacement.rel = "noopener noreferrer";
      replacement.textContent = cleanCitationLabel(a);

      a.replaceWith(replacement);
    });
  }

  function removeArchiveControlWidgets(root) {
    if (!CONFIG.removeArchiveControlWidgets) return;

    const selectors = [
      'button[aria-label*="Copy" i]',
      'button[aria-label*="copy" i]',
      'button[aria-label*="Copied" i]',
      '[data-testid*="copy" i]',
      '[data-testid*="Copy" i]',
      '[class*="copy-button" i]',
      '[class*="table" i] button[aria-label*="Copy" i]'
    ];

    root.querySelectorAll(selectors.join(",")).forEach((el) => {
      if (el.closest(".saved-file-chip")) return;
      el.remove();
    });

    root.querySelectorAll('svg use[href*="sprites-core"], svg use[xlink\\:href*="sprites-core"]').forEach((useEl) => {
      const svg = useEl.closest("svg");
      const button = useEl.closest("button, [role='button']");
      if (button && !button.closest(".saved-file-chip")) {
        button.remove();
      } else if (svg && !svg.closest(".katex")) {
        svg.remove();
      }
    });
  }

  function removeEventAndBadStyleAttributes(root) {
    const all = [root, ...root.querySelectorAll("*")];

    for (const el of all) {
      for (const attr of [...el.attributes]) {
        if (/^on/i.test(attr.name)) {
          el.removeAttribute(attr.name);
        }

        // V4.2 change:
        // Do not delete inline height/position styles from math/code. KaTeX/MathJax
        // depend on height/top/position/vertical-align for fractions, sums, limits,
        // subscripts and superscripts.
        if (attr.name === "style") {
          const style = attr.value || "";

          if (shouldKeepInlineStyle(el)) {
            continue;
          }

          // Remove only strong clipping from normal prose/card elements.
          // Do not remove all "height:" rules globally, because that breaks math.
          if (/max-height|overflow\s*:\s*hidden/i.test(style)) {
            el.removeAttribute("style");
          }
        }

        // Avoid hidden content from original app state.
        if (attr.name === "hidden" || attr.name === "inert") {
          el.removeAttribute(attr.name);
        }
      }
    }
  }

  function shouldSnapshotComputedStyle(el) {
    if (!(el instanceof Element)) return false;

    if (
      CONFIG.snapshotMathComputedStyles &&
      CONFIG.mathStyleMode === "computed" &&
      isMathElement(el)
    ) {
      return true;
    }

    if (!CONFIG.snapshotNonMathComputedStyles) return false;

    return isCodeLikeElement(el) || el.matches("a, table, th, td");
  }

  function applyComputedStyleSnapshot(originalRoot, cloneRoot) {
    try {
      const pairs = [[originalRoot, cloneRoot]];
      const originalWalker = document.createTreeWalker(originalRoot, NodeFilter.SHOW_ELEMENT);
      const cloneWalker = document.createTreeWalker(cloneRoot, NodeFilter.SHOW_ELEMENT);

      while (true) {
        const originalNext = originalWalker.nextNode();
        const cloneNext = cloneWalker.nextNode();
        if (!originalNext || !cloneNext) break;
        pairs.push([originalNext, cloneNext]);
      }

      const props = [
        // Text and colors.
        "color",
        "backgroundColor",
        "fontFamily",
        "fontSize",
        "fontWeight",
        "fontStyle",
        "fontVariant",
        "lineHeight",
        "letterSpacing",
        "wordSpacing",
        "textAlign",
        "textDecorationLine",
        "textDecorationColor",
        "textDecorationStyle",
        "whiteSpace",

        // Layout-critical for KaTeX/MathJax and code blocks.
        "display",
        "position",
        "verticalAlign",
        "boxSizing",
        "width",
        "height",
        "minWidth",
        "minHeight",
        "maxWidth",
        "maxHeight",
        "top",
        "right",
        "bottom",
        "left",
        "marginTop",
        "marginRight",
        "marginBottom",
        "marginLeft",
        "paddingTop",
        "paddingRight",
        "paddingBottom",
        "paddingLeft",
        "overflow",
        "overflowX",
        "overflowY",
        "transform",
        "transformOrigin",

        // Borders/fraction lines/code boxes.
        "borderTopWidth",
        "borderRightWidth",
        "borderBottomWidth",
        "borderLeftWidth",
        "borderTopStyle",
        "borderRightStyle",
        "borderBottomStyle",
        "borderLeftStyle",
        "borderTopColor",
        "borderRightColor",
        "borderBottomColor",
        "borderLeftColor",
        "borderRadius"
      ];

      for (const [original, clone] of pairs) {
        if (!(original instanceof Element) || !(clone instanceof HTMLElement)) continue;
        if (!shouldSnapshotComputedStyle(original)) continue;

        const cs = getComputedStyle(original);
        const mathLike = isMathElement(original);

        for (const prop of props) {
          const value = cs[prop];
          if (!value) continue;

          if (!mathLike) {
            if (value === "normal" && !["fontStyle", "fontWeight", "lineHeight"].includes(prop)) continue;
            if (value === "auto" && ["top", "right", "bottom", "left", "width", "height"].includes(prop)) continue;
            if (value === "none" && ["transform", "textDecorationLine"].includes(prop)) continue;
          }

          if (value === "rgba(0, 0, 0, 0)" && prop.toLowerCase().includes("background")) continue;

          clone.style[prop] = value;
        }
      }
    } catch (err) {
      log("computed-style snapshot skipped", err);
    }
  }

  function isCodeTokenElement(el) {
    if (!(el instanceof Element)) return false;

    return Boolean(
      el.matches(
        [
          "pre code",
          "pre code *",
          "pre [class*='hljs']",
          "pre [class*='token']",
          "[data-testid*='code'] code",
          "[data-testid*='code'] code *",
          "[class*='code-block'] code",
          "[class*='code-block'] code *",
          "code[class*='CodeContent']",
          "code[class*='CodeContent'] *",
          "code[class*='whitespace-pre']",
          "code[class*='whitespace-pre'] *",
          ".cm-line",
          ".cm-line *",
          ".cm-content",
          ".cm-content *",
          "[class*='tok-']"
        ].join(",")
      ) ||
      Boolean(
        el.closest?.('[data-testid="writing-block-container"]') &&
        writingBlockLooksPreformatted(el.closest('[data-testid="writing-block-container"]'))
      )
    );
  }

  function applyCodeColorSnapshot(originalRoot, cloneRoot) {
    if (!CONFIG.snapshotCodeTokenColors) return;

    try {
      const pairs = [[originalRoot, cloneRoot]];
      const originalWalker = document.createTreeWalker(
        originalRoot,
        NodeFilter.SHOW_ELEMENT
      );
      const cloneWalker = document.createTreeWalker(
        cloneRoot,
        NodeFilter.SHOW_ELEMENT
      );

      while (true) {
        const originalNext = originalWalker.nextNode();
        const cloneNext = cloneWalker.nextNode();
        if (!originalNext || !cloneNext) break;
        pairs.push([originalNext, cloneNext]);
      }

      for (const [original, clone] of pairs) {
        if (!(original instanceof Element) || !(clone instanceof HTMLElement)) continue;
        if (!isCodeTokenElement(original)) continue;

        const cs = getComputedStyle(original);

        if (cs.color) clone.style.color = cs.color;
        if (cs.fontWeight && cs.fontWeight !== "400" && cs.fontWeight !== "normal") {
          clone.style.fontWeight = cs.fontWeight;
        }
        if (cs.fontStyle && cs.fontStyle !== "normal") {
          clone.style.fontStyle = cs.fontStyle;
        }
        if (
          cs.backgroundColor &&
          cs.backgroundColor !== "rgba(0, 0, 0, 0)" &&
          cs.backgroundColor !== "transparent"
        ) {
          clone.style.backgroundColor = cs.backgroundColor;
        }
      }
    } catch (err) {
      log("code-color snapshot skipped", err);
    }
  }

  function classListContainsAny(el, needles) {
    const cls = String(el.getAttribute?.("class") || "");
    return needles.some((x) => cls.includes(x));
  }

  function shouldKeepClassAttribute(el) {
    if (!(el instanceof Element)) return false;

    if (isMathElement(el) || isCodeLikeElement(el)) return true;

    const cls = String(el.getAttribute("class") || "");

    if (!cls) return false;

    return (
      cls.includes("saved-") ||
      cls.includes("katex") ||
      cls.includes("MathJax") ||
      cls.includes("math") ||
      cls.includes("hljs") ||
      cls.includes("token") ||
      cls.includes("language-") ||
      cls.includes("markdown") ||
      cls.includes("writing-block") ||
      cls.includes("ProseMirror") ||
      cls.includes("tok-")
    );
  }

  function removeHiddenAccessibilityLayers(root) {
    if (!CONFIG.removeHiddenAccessibilityLayers) return;

    const selectors = [
      ".katex-mathml",
      "mjx-assistive-mml",
      ".sr-only",
      "[class*='sr-only']",
      "[class*='visually-hidden']",
      "[class*='screen-reader']",
      "[class*='ScreenReader']",
      "[data-testid*='screen-reader']",
      "[data-testid*='ScreenReader']"
    ];

    root.querySelectorAll(selectors.join(",")).forEach((el) => {
      // Do NOT remove .katex-html; it is visually rendered math even though
      // KaTeX marks it aria-hidden for screen readers.
      if (el.closest(".katex-html")) return;
      el.remove();
    });
  }

  function hasComplexContent(el) {
    return Boolean(
      el.querySelector?.(
        "pre, code, table, img, svg, canvas, math, mjx-container, .katex, .katex-display, .saved-file-chip, .saved-static-button"
      )
    );
  }

  function removeAdjacentDuplicateTextBlocks(root) {
    if (!CONFIG.removeAdjacentDuplicateTextBlocks) return;

    const containerSelectors = [
      ".saved-turn-body",
      "[data-message-author-role]",
      ".markdown",
      "main"
    ];

    const containers = [];

    for (const sel of containerSelectors) {
      root.querySelectorAll?.(sel)?.forEach((el) => containers.push(el));
    }

    if (!containers.length) containers.push(root);

    for (const container of containers) {
      const children = [...container.children];

      let prevText = "";
      let prevTag = "";

      for (const child of children) {
        if (!(child instanceof Element)) continue;

        const tag = child.tagName || "";
        const text = compactText(child.innerText || child.textContent || "");

        if (!text || text.length < 35 || hasComplexContent(child)) {
          prevText = "";
          prevTag = "";
          continue;
        }

        if (text === prevText && tag === prevTag) {
          child.remove();
          continue;
        }

        prevText = text;
        prevTag = tag;
      }
    }

    // Second pass: catch duplicate adjacent paragraphs/list items inside nested wrappers.
    const blocks = [...root.querySelectorAll("p, li, blockquote")];

    for (const el of blocks) {
      if (!(el instanceof Element) || !el.parentElement) continue;
      if (hasComplexContent(el)) continue;

      const prev = el.previousElementSibling;
      if (!prev || prev.tagName !== el.tagName || hasComplexContent(prev)) continue;

      const a = compactText(prev.innerText || prev.textContent || "");
      const b = compactText(el.innerText || el.textContent || "");

      if (a && b && a.length >= 35 && a === b) {
        el.remove();
      }
    }
  }

  function compactAttributesForSelfContained(root) {
    if (!CONFIG.compactSelfContainedAttributes) return;

    const all = [root, ...root.querySelectorAll("*")];

    for (const el of all) {
      if (!(el instanceof Element)) continue;

      const keepClass = shouldKeepClassAttribute(el);
      const keepStyle = shouldKeepInlineStyle(el);

      for (const attr of [...el.attributes]) {
        const name = attr.name;

        if (/^on/i.test(name)) {
          el.removeAttribute(name);
          continue;
        }

        if (name === "class" && !keepClass) {
          el.removeAttribute(name);
          continue;
        }

        if (name === "style" && !keepStyle) {
          el.removeAttribute(name);
          continue;
        }

        // These are useful for app behavior/accessibility, but not for a static archive.
        if (
          name === "id" ||
          name === "tabindex" ||
          name === "contenteditable" ||
          name === "spellcheck" ||
          name === "draggable" ||
          name === "role" ||
          name.startsWith("data-") ||
          name.startsWith("aria-")
        ) {
          // Keep essential display/link metadata.
          if (
            name === "aria-label" &&
            /^(a|img|button)$/i.test(el.tagName)
          ) {
            continue;
          }

          el.removeAttribute(name);
          continue;
        }
      }
    }
  }

  function removeMathContainerClipping(root) {
    const displaySelectors = [
      ".katex-display",
      "mjx-container[display='true']",
      "mjx-container[display='block']",
      "[data-testid*='math'][class*='overflow']"
    ].join(",");

    root.querySelectorAll(displaySelectors).forEach((el) => {
      if (!(el instanceof HTMLElement)) return;

      // These values came from the live viewport or generic scroll wrappers.
      // They are not part of KaTeX glyph layout and caused permanent scrollbars,
      // narrow clipped formulas, and truncated long equations in the archive.
      for (const prop of [
        "width",
        "min-width",
        "max-width",
        "overflow",
        "overflow-x",
        "overflow-y"
      ]) {
        el.style.removeProperty(prop);
      }
    });

    root.querySelectorAll(".katex-display > .katex").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      el.style.removeProperty("width");
      el.style.removeProperty("min-width");
      el.style.removeProperty("max-width");
      el.style.removeProperty("overflow");
      el.style.removeProperty("overflow-x");
      el.style.removeProperty("overflow-y");
    });
  }

  function cleanCloneForArchive(node, mode, options = {}) {
    const clone = node.cloneNode(true);

    applyComputedStyleSnapshot(node, clone);
    applyCodeColorSnapshot(node, clone);
    removeMathContainerClipping(clone);

    if (typeof options.pruneClone === "function") {
      options.pruneClone(clone);
    }

    staticizeRichOutputBlocks(clone);

    clone.querySelectorAll("script, iframe, noscript").forEach((el) => el.remove());

    const staticArchiveMode =
      mode === "self_contained_html" ||
      mode === "offline_assets_html";

    if (staticArchiveMode) {
      simplifyFileTiles(clone);
      simplifyCitationLinks(clone);
      removeArchiveControlWidgets(clone);
    }

    // Remove known controls, but preserve content buttons/cards/downloads.
    clone.querySelectorAll("button, [role='button']").forEach((el) => {
      if (CONFIG.preserveDownloadCardsAndContentButtons && buttonLooksLikeContent(el)) {
        const staticEl = staticizeContentButton(el);
        el.replaceWith(staticEl);
        return;
      }

      if (CONFIG.removeOnlyKnownControls && isKnownChromeOrChatControl(el)) {
        el.remove();
        return;
      }

      if (!CONFIG.removeOnlyKnownControls) {
        el.remove();
      }
    });

    // Forms/composer controls are not part of the saved conversation.
    clone.querySelectorAll("textarea, input, select, form").forEach((el) => el.remove());
    clone.querySelectorAll("[contenteditable='true']").forEach((el) => {
      if (isKnownRichEditable(el)) {
        el.removeAttribute("contenteditable");
        el.removeAttribute("tabindex");
        el.removeAttribute("role");
        state.richOutputFormatting.richEditableNodesPreserved += 1;
        return;
      }
      el.remove();
    });

    if (mode !== "native_like_html" && mode !== "replace_page_then_ctrl_s") {
      // In self-contained mode, remove embedded style tags from cloned fragments.
      clone.querySelectorAll("style").forEach((el) => el.remove());
    }

    if (staticArchiveMode) {
      removeHiddenAccessibilityLayers(clone);
      compactAttributesForSelfContained(clone);
      removeAdjacentDuplicateTextBlocks(clone);
    }

    removeEventAndBadStyleAttributes(clone);
    return clone;
  }

  function makeCheapTurnKey(turn) {
    const role = detectRole(turn);
    const stableId = detectStableId(turn);

    if (stableId) {
      return {
        key: stableId,
        role,
        stableId
      };
    }

    const contentNode = getBestMessageContentNode(turn, role);
    const text = compactText(contentNode?.innerText || turn.innerText || turn.textContent || "");

    if (!text) {
      return null;
    }

    return {
      key: `${role}:${hashString(`${role}:${text}`)}`,
      role,
      stableId: ""
    };
  }


  function directedOrderVoteKey(beforeKey, afterKey) {
    return `${beforeKey}\u0000${afterKey}`;
  }

  function addObservedOrderVote(beforeKey, afterKey) {
    if (!beforeKey || !afterKey || beforeKey === afterKey) return;

    const voteKey = directedOrderVoteKey(beforeKey, afterKey);
    state.ordering.orderVotes.set(
      voteKey,
      (state.ordering.orderVotes.get(voteKey) || 0) + 1
    );
  }

  function getOrderedTurnKeys(turns) {
    const orderedKeys = [];
    const seen = new Set();

    for (const turn of turns) {
      const cheap = makeCheapTurnKey(turn);
      const key = cheap?.key || "";

      if (!key || seen.has(key)) continue;
      seen.add(key);
      orderedKeys.push(key);
    }

    return orderedKeys;
  }

  function recordObservedDomOrder(turns) {
    const orderedKeys = getOrderedTurnKeys(turns);

    // Every currently mounted pair gives a direct chronological observation.
    // Pairwise observations are more robust than only adjacent edges when
    // ChatGPT virtualizes/removes middle messages between scroll passes.
    for (let i = 0; i < orderedKeys.length; i++) {
      for (let j = i + 1; j < orderedKeys.length; j++) {
        addObservedOrderVote(orderedKeys[i], orderedKeys[j]);
      }
    }

    if (orderedKeys.length > 1) {
      state.ordering.observations += 1;
    }

    return orderedKeys;
  }

  function firstMountedConversationIdentity() {
    const firstTurn = findConversationTurns()[0] || null;
    if (!firstTurn) return null;

    const cheap = makeCheapTurnKey(firstTurn);
    if (!cheap?.key) return null;

    return {
      key: cheap.key,
      stableId: cheap.stableId || "",
      role: cheap.role || detectRole(firstTurn)
    };
  }

  function certifyCurrentTopBoundary() {
    if (state.collected.size === 0) {
      state.ordering.certifiedTop = null;
      return null;
    }

    // Capture once more at the boundary so its DOM ordering participates in
    // final chronology even if the virtualizer changes immediately afterward.
    const turns = findConversationTurns();
    recordObservedDomOrder(turns);

    const first = firstMountedConversationIdentity();

    state.ordering.certifiedTop = first
      ? {
          ...first,
          pass: state.currentPass,
          certifiedAt: new Date().toISOString()
        }
      : null;

    return state.ordering.certifiedTop;
  }

  function fallbackEntryCompare(a, b) {
    const ai = a.turnIndex;
    const bi = b.turnIndex;

    if (Number.isFinite(ai) && Number.isFinite(bi) && ai !== bi) {
      return ai - bi;
    }
    if (Number.isFinite(ai) && !Number.isFinite(bi)) return -1;
    if (!Number.isFinite(ai) && Number.isFinite(bi)) return 1;

    // Only used for genuinely unconstrained/cyclic ties.
    // The observed DOM graph is the primary chronology source.
    if (a.pass !== b.pass) return b.pass - a.pass;
    if (a.domOrder !== b.domOrder) return a.domOrder - b.domOrder;
    return String(a.key).localeCompare(String(b.key));
  }

  function resolveObservedChronology(entries) {
    const entryByKey = new Map(entries.map((entry) => [entry.key, entry]));
    const keys = [...entryByKey.keys()];

    if (keys.length <= 1) {
      state.ordering.lastResolution = {
        nodeCount: keys.length,
        majorityEdges: 0,
        contradictoryPairs: 0,
        cycleBreaks: 0,
        ambiguousChoiceSteps: 0,
        maxZeroIndegreeChoices: 0,
        fallbackSelections: 0,
        certifiedTopKey: state.ordering.certifiedTop?.key || null
      };
      return entries.slice();
    }

    const outgoing = new Map(keys.map((key) => [key, new Map()]));
    const indegree = new Map(keys.map((key) => [key, 0]));
    let majorityEdges = 0;
    let contradictoryPairs = 0;

    // Convert directional observations into majority edges. If a pair was ever
    // seen in both directions, the stronger observation wins; ties are ignored.
    for (const [voteKey, forwardCount] of state.ordering.orderVotes.entries()) {
      const split = voteKey.indexOf("\u0000");
      if (split < 1) continue;

      const beforeKey = voteKey.slice(0, split);
      const afterKey = voteKey.slice(split + 1);

      if (!entryByKey.has(beforeKey) || !entryByKey.has(afterKey)) continue;

      const reverseCount =
        state.ordering.orderVotes.get(
          directedOrderVoteKey(afterKey, beforeKey)
        ) || 0;

      // Process each unordered pair once.
      if (beforeKey > afterKey) continue;

      let from = null;
      let to = null;
      let weight = 0;

      if (forwardCount > reverseCount) {
        from = beforeKey;
        to = afterKey;
        weight = forwardCount - reverseCount;
      } else if (reverseCount > forwardCount) {
        from = afterKey;
        to = beforeKey;
        weight = reverseCount - forwardCount;
      } else {
        if (forwardCount && reverseCount) contradictoryPairs += 1;
        continue;
      }

      if (forwardCount && reverseCount) contradictoryPairs += 1;

      if (!outgoing.get(from).has(to)) {
        outgoing.get(from).set(to, weight);
        indegree.set(to, indegree.get(to) + 1);
        majorityEdges += 1;
      }
    }

    // Numeric conversation-turn indexes, when ChatGPT exposes them, are
    // authoritative and supplement the DOM observations.
    const indexed = entries
      .filter((entry) => Number.isFinite(entry.turnIndex))
      .slice()
      .sort((a, b) => a.turnIndex - b.turnIndex);

    for (let i = 0; i + 1 < indexed.length; i++) {
      const from = indexed[i].key;
      const to = indexed[i + 1].key;

      if (
        from !== to &&
        !outgoing.get(from).has(to)
      ) {
        outgoing.get(from).set(to, Number.MAX_SAFE_INTEGER);
        indegree.set(to, indegree.get(to) + 1);
        majorityEdges += 1;
      }
    }

    // Once the progressive-history probe has certified the true top, its first
    // conversational DOM node is an explicit leading-boundary anchor.
    const certifiedTopKey = state.ordering.certifiedTop?.key || null;
    if (certifiedTopKey && entryByKey.has(certifiedTopKey)) {
      for (const key of keys) {
        if (key === certifiedTopKey) continue;
        if (outgoing.get(certifiedTopKey).has(key)) continue;

        outgoing.get(certifiedTopKey).set(key, Number.MAX_SAFE_INTEGER);
        indegree.set(key, indegree.get(key) + 1);
        majorityEdges += 1;
      }
    }

    const remaining = new Set(keys);
    const result = [];
    let cycleBreaks = 0;
    let ambiguousChoiceSteps = 0;
    let maxZeroIndegreeChoices = 0;
    let fallbackSelections = 0;

    const chooseByFallback = (candidateKeys) => {
      return candidateKeys
        .map((key) => entryByKey.get(key))
        .sort(fallbackEntryCompare)[0]?.key || null;
    };

    while (remaining.size) {
      const zeros = [...remaining].filter(
        (key) => (indegree.get(key) || 0) === 0
      );

      if (zeros.length > 1) {
        ambiguousChoiceSteps += 1;
        maxZeroIndegreeChoices = Math.max(maxZeroIndegreeChoices, zeros.length);
        fallbackSelections += 1;
      }

      let chosenKey = zeros.length
        ? chooseByFallback(zeros)
        : null;

      if (!chosenKey) {
        // Defensive cycle handling for transient contradictory DOM snapshots.
        // Pick the node with strongest net "before" evidence, then continue.
        cycleBreaks += 1;
        fallbackSelections += 1;

        const candidates = [...remaining].map((key) => {
          let outgoingWeight = 0;
          let incomingWeight = 0;

          for (const [to, weight] of outgoing.get(key) || []) {
            if (remaining.has(to)) outgoingWeight += weight;
          }

          for (const from of remaining) {
            if (from === key) continue;
            incomingWeight += outgoing.get(from)?.get(key) || 0;
          }

          return {
            key,
            net: outgoingWeight - incomingWeight,
            entry: entryByKey.get(key)
          };
        });

        candidates.sort((a, b) => {
          if (a.net !== b.net) return b.net - a.net;
          return fallbackEntryCompare(a.entry, b.entry);
        });

        chosenKey = candidates[0]?.key || null;
      }

      if (!chosenKey) break;

      remaining.delete(chosenKey);
      result.push(entryByKey.get(chosenKey));

      for (const to of outgoing.get(chosenKey)?.keys() || []) {
        if (!remaining.has(to)) continue;
        indegree.set(to, Math.max(0, (indegree.get(to) || 0) - 1));
      }
    }

    // Should never be needed, but never drop captured messages.
    if (result.length !== entries.length) {
      const emitted = new Set(result.map((entry) => entry.key));
      result.push(
        ...entries
          .filter((entry) => !emitted.has(entry.key))
          .sort(fallbackEntryCompare)
      );
    }

    state.ordering.lastResolution = {
      nodeCount: entries.length,
      majorityEdges,
      contradictoryPairs,
      cycleBreaks,
      ambiguousChoiceSteps,
      maxZeroIndegreeChoices,
      fallbackSelections,
      observationSnapshots: state.ordering.observations,
      certifiedTopKey,
      certifiedTopRole: state.ordering.certifiedTop?.role || null,
      resolvedFirstKey: result[0]?.key || null,
      resolvedFirstRole: result[0]?.role || null
    };

    return result;
  }

  function maxBacktickRun(text) {
    let max = 0;
    for (const m of String(text || "").matchAll(/`+/g)) max = Math.max(max, m[0].length);
    return max;
  }

  function fencedMarkdown(text, language = "") {
    const body = String(text || "").replace(/\s+$/g, "");
    const fence = "`".repeat(Math.max(3, maxBacktickRun(body) + 1));
    return `${fence}${language || ""}\n${body}\n${fence}`;
  }

  function codeMirrorText(container) {
    const lines = Array.from(container?.querySelectorAll?.(".cm-line") || []);
    if (lines.length) return lines.map((line) => line.textContent || "").join("\n");
    const content = container?.querySelector?.(".cm-content");
    return normalizeText(content?.innerText || content?.textContent || "");
  }

  function richBlockBodyText(container) {
    if (!container) return "";
    if (container.querySelector?.(".cm-editor")) return codeMirrorText(container);
    const editor = container.querySelector?.(".writing-block-editor .ProseMirror, .writing-block-editor [contenteditable='true'], .writing-block-editor");
    return normalizeText(editor?.innerText || editor?.textContent || "");
  }

  function richBlockMarkdown(container) {
    const currentCode = container?.matches?.("code") && isCurrentChatGptCodeElement(container)
      ? container
      : Array.from(container?.querySelectorAll?.("code") || []).find(isCurrentChatGptCodeElement);
    if (currentCode) {
      const label = currentCodeCardLabel(currentCode) || "Code";
      const language = formatLabelToLanguage(label);
      const body = String(currentCode.textContent || "").replace(/\r\n?/g, "\n").replace(/\s+$/g, "");
      if (!body) return "";
      return `**${label}**\n\n${fencedMarkdown(body, language || "text")}`;
    }

    const labels = richOutputLabels(container);
    const language = inferRichOutputLanguage(container);
    const body = richBlockBodyText(container);
    if (!body) return "";
    const labelLine = labels.length ? `**${labels.join(" · ")}**\n\n` : "";
    const preformatted = Boolean(container.querySelector?.(".cm-editor")) || writingBlockLooksPreformatted(container);
    return preformatted
      ? `${labelLine}${fencedMarkdown(body, language || "text")}`
      : `${labelLine}${body}`;
  }

  function detachedInnerText(node) {
    if (!node) return "";
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-100000px";
    host.style.top = "0";
    host.style.width = "800px";
    host.style.visibility = "hidden";
    host.style.pointerEvents = "none";
    host.appendChild(node);
    document.body.appendChild(host);
    try {
      return normalizeText(node.innerText || node.textContent || "");
    } finally {
      host.remove();
    }
  }

  function buildStructuredMarkdownFromTurn(turn, role, fallbackText) {
    if (role !== "assistant" || !turn?.cloneNode) return fallbackText || "";
    const clone = turn.cloneNode(true);

    if (clone.matches?.('[data-turn-key]')) {
      clone.querySelectorAll('[data-user-message-bubble]').forEach((node) => node.remove());
      clone.querySelectorAll('[data-conversation-role="assistant"], [data-chatgpt-agent-turn-start]').forEach((node) => {
        if (isRedesignedAssistantSemanticLabel(node)) node.remove();
      });
    }

    const blocks = [];
    const seen = new Set();
    for (const block of clone.querySelectorAll('[data-testid="writing-block-container"]')) {
      if (!(block instanceof Element) || seen.has(block)) continue;
      seen.add(block);
      blocks.push(block);
    }
    for (const editor of clone.querySelectorAll(".cm-editor")) {
      if (!(editor instanceof Element) || editor.closest('[data-testid="writing-block-container"]')) continue;
      const shell = editor.closest('[data-code-block], [data-testid*="code-block"], [class*="code-block"]') || editor;
      if (seen.has(shell)) continue;
      seen.add(shell);
      blocks.push(shell);
    }
    for (const code of clone.querySelectorAll("code")) {
      if (!isCurrentChatGptCodeElement(code)) continue;
      const shell = findCurrentCodeCardShell(code) || code;
      if (seen.has(shell)) continue;
      seen.add(shell);
      blocks.push(shell);
    }

    if (!blocks.length) return fallbackText || "";

    const replacements = [];
    blocks.forEach((block, index) => {
      const formatted = richBlockMarkdown(block);
      if (!formatted) return;
      const token = `ARCHIVE_RICH_BLOCK_${index}_${Date.now()}_TOKEN`;
      const placeholder = document.createElement("div");
      placeholder.textContent = token;
      block.replaceWith(placeholder);
      replacements.push({ token, formatted });
    });

    if (!replacements.length) return fallbackText || "";

    clone.querySelectorAll("button, [role='button'], textarea, input, select, form").forEach((node) => node.remove());
    let output = detachedInnerText(clone);
    for (const { token, formatted } of replacements) {
      output = output.replace(token, formatted);
    }
    state.richOutputFormatting.structuredMarkdownBlocks += replacements.length;
    return normalizeText(output) || fallbackText || "";
  }

  function makeEntryFromTurn(turn, pass, domOrder) {
    const role = detectRole(turn);
    const stableId = detectStableId(turn);
    const turnIndex = extractTurnIndex(stableId);
    const contentNode = getBestMessageContentNode(turn, role);
    const redesignedAssistantGroup = Boolean(
      role === "assistant" && turn?.matches?.('[data-turn-key]')
    );

    const fullText = redesignedAssistantGroup
      ? extractRedesignedAssistantText(turn)
      : normalizeText(contentNode?.innerText || turn.innerText || turn.textContent || "");
    const compact = compactText(fullText);

    if (!compact) {
      if (redesignedAssistantGroup) state.redesignedAssistantValidation.incompleteEntries += 1;
      return null;
    }

    if (redesignedAssistantGroup) {
      state.redesignedAssistantValidation.assistantEntriesBuilt += 1;
      if (/^(chatgpt\s+said:?|assistant:?)$/i.test(compact)) {
        state.redesignedAssistantValidation.labelOnlyCandidates += 1;
        state.redesignedAssistantValidation.incompleteEntries += 1;
      }
    }

    const textHash = hashString(`${role}:${compact}`);
    const key = stableId || `${role}:${textHash}`;
    const structuredMarkdown = buildStructuredMarkdownFromTurn(turn, role, fullText);

    let selfContainedHtml;
    let nativeHtml;

    if (role === "user" && CONFIG.saveUserAsExpandedPlainText) {
      selfContainedHtml = `<div class="saved-expanded-user-text">${textToHtml(fullText)}</div>`;
    } else if (role === "assistant" && CONFIG.preserveAssistantRenderedHtml) {
      const clone = cleanCloneForArchive(
        contentNode || turn,
        "self_contained_html",
        redesignedAssistantGroup ? { pruneClone: pruneRedesignedAssistantClone } : {}
      );
      selfContainedHtml = clone.outerHTML;
    } else {
      selfContainedHtml = `<div class="saved-expanded-text">${textToHtml(fullText)}</div>`;
    }

    if (CONFIG.mode === "native_like_html" || CONFIG.mode === "replace_page_then_ctrl_s") {
      const nativeClone = cleanCloneForArchive(
        turn,
        "native_like_html",
        redesignedAssistantGroup ? { pruneClone: pruneRedesignedAssistantClone } : {}
      );
      nativeHtml = nativeClone.outerHTML;
    } else {
      nativeHtml = "";
    }

    return {
      key,
      stableId,
      turnIndex,
      role,
      textHash,
      textLength: compact.length,
      pass,
      domOrder,
      preview: compact.slice(0, 180),
      text: fullText,
      markdown: structuredMarkdown,
      html: selfContainedHtml,
      nativeHtml,
      captureSignature: makeTurnCaptureSignature(turn, role)
    };
  }

  function buildEntryWithTiming(turn, pass, domOrder) {
    const started = performance.now();
    state.collectionPerformance.entryBuilds += 1;
    try {
      return makeEntryFromTurn(turn, pass, domOrder);
    } finally {
      state.collectionPerformance.entryBuildMs += Math.max(0, performance.now() - started);
    }
  }

  function recordCollectionPerformance(source, durationMs, mountedTurns, addedTurns) {
    const duration = Math.max(0, Number(durationMs || 0));
    state.collectionPerformance.totalCollectionMs += duration;
    state.collectionPerformance.maxCollectionCallMs = Math.max(
      state.collectionPerformance.maxCollectionCallMs,
      duration
    );
    if (source === "mutation") state.collectionPerformance.mutationCollectionMs += duration;
    else if (source === "rich-confirmation") state.collectionPerformance.richConfirmationCollectionMs += duration;
    else state.collectionPerformance.normalCollectionMs += duration;

    if (duration >= 100) {
      state.collectionPerformance.slowCollectionCalls += 1;
      state.collectionPerformance.slowestCalls.push({
        source,
        durationMs: Math.round(duration),
        mountedTurns: Number(mountedTurns || 0),
        addedTurns: Number(addedTurns || 0)
      });
      state.collectionPerformance.slowestCalls.sort((a, b) => b.durationMs - a.durationMs);
      if (state.collectionPerformance.slowestCalls.length > 8) {
        state.collectionPerformance.slowestCalls.length = 8;
      }
    }
  }

  function collectVisibleTurns(pass, source = "scan") {
    const collectionStarted = performance.now();
    const before = state.collected.size;
    const turns = findConversationTurns();

    state.scanDiagnostics.passesCompleted = Math.max(state.scanDiagnostics.passesCompleted, Number(pass || 0));
    state.scanDiagnostics.maxMountedTurns = Math.max(state.scanDiagnostics.maxMountedTurns, turns.length);
    if (source === "mutation") state.scanDiagnostics.mutationCollectionCalls += 1;
    else if (source === "rich-confirmation") state.scanDiagnostics.richConfirmationCollectionCalls += 1;
    else state.scanDiagnostics.normalCollectionCalls += 1;

    // Ordering must be observed even for already-captured turns. Rich-content
    // confirmations, like mutation observations, never add chronology votes.
    const orderedKeys = source === "mutation" || source === "rich-confirmation"
      ? getOrderedTurnKeys(turns)
      : recordObservedDomOrder(turns);
    if (source !== "mutation") {
      state.lastMountedKeys = orderedKeys;
    }

    turns.forEach((turn, domOrder) => {
      const cheap = makeCheapTurnKey(turn);
      if (!cheap) return;

      const existing = state.collected.get(cheap.key);

      if (existing && CONFIG.skipDuplicateBeforeClone) {
        // Rich snapshots: first snapshot no longer wins forever. Do only a cheap
        // signature check on repeats; clone again only when the mounted DOM is
        // clearly richer (for example, a late-hydrated writing block).
        if (cheap.stableId) {
          state.collectionPerformance.signatureChecks += 1;
          const previousSignature = existing.captureSignature || {
            textChars: existing.textLength || 0,
            elementCount: 0,
            richElementCount: 0
          };
          const nextSignature = makeTurnCaptureSignature(turn, cheap.role, previousSignature);

          if (signatureIsClearlyRicher(nextSignature, previousSignature)) {
            const upgraded = buildEntryWithTiming(turn, pass, domOrder);
            if (
              upgraded &&
              upgraded.key === existing.key &&
              (
                upgraded.textLength > existing.textLength ||
                String(upgraded.html || "").length > String(existing.html || "").length
              )
            ) {
              // Preserve the first-capture chronology provenance. A later richer
              // rendering must not perturb fallback ordering for this stable ID.
              upgraded.pass = existing.pass;
              upgraded.domOrder = existing.domOrder;
              state.collected.set(existing.key, upgraded);
              recordSnapshotUpgrade(existing.key, existing, upgraded, source);
              return;
            }
          } else if (signatureDiffersMeaningfully(nextSignature, previousSignature)) {
            state.contentValidation.downgradeSnapshotsIgnored += 1;
            state.contentValidation.variantKeys.add(existing.key);
            state.contentValidation.messagesWithMultipleVariants =
              state.contentValidation.variantKeys.size;
          }
        }
        return;
      }

      const entry = buildEntryWithTiming(turn, pass, domOrder);
      if (!entry) return;

      noteRichBlockCandidate(turn, entry.key, entry.role);

      if (!existing) {
        state.collected.set(entry.key, entry);
        if (source === "mutation") {
          state.hydrationObserver.newTurnsCaughtOutsideNormalPass += 1;
          state.scanDiagnostics.newTurnsFromMutationObserver += 1;
        } else if (source === "scan") {
          state.scanDiagnostics.newTurnsFromNormalScan += 1;
        }
      }
    });

    const added = state.collected.size - before;
    recordCollectionPerformance(
      source,
      performance.now() - collectionStarted,
      turns.length,
      added
    );
    return added;
  }

  function startHydrationObserver(scrollEl) {
    if (!CONFIG.enableHydrationObserver || !scrollEl || typeof MutationObserver === "undefined") {
      return;
    }

    const observer = new MutationObserver((mutations) => {
      if (state.cancelled || !window.__CHATGPT_FULL_CHAT_SAVER_V42_RUNNING__) return;

      let relevant = false;
      for (const mutation of mutations) {
        const targetEl = mutation.target instanceof Element
          ? mutation.target
          : mutation.target?.parentElement;
        if (targetEl?.closest?.("#chatgpt-full-chat-saver-v4-overlay")) continue;
        if (mutation.type === "childList" || mutation.type === "characterData") {
          relevant = true;
          break;
        }
      }
      if (!relevant) return;

      state.hydrationObserver.mutationBursts += 1;
      if (state.hydrationObserver.timer) {
        clearTimeout(state.hydrationObserver.timer);
      }

      state.hydrationObserver.timer = setTimeout(() => {
        state.hydrationObserver.timer = null;
        if (
          state.cancelled ||
          document.visibilityState === "hidden" ||
          !window.__CHATGPT_FULL_CHAT_SAVER_V42_RUNNING__
        ) {
          return;
        }

        state.hydrationObserver.debouncedObservations += 1;
        collectVisibleTurns(state.currentPass, "mutation");
      }, CONFIG.hydrationObserverDebounceMs);
    });

    const observerOptions = {
      childList: true,
      subtree: true,
      characterData: true
    };
    const activeScope = getActiveConversationScope();
    const observerRoot = activeScope?.root === document
      ? (activeScope?.main || scrollEl)
      : (activeScope?.root || scrollEl);
    try {
      observer.observe(observerRoot, observerOptions);
    } catch {}
    for (const root of getCachedConversationShadowRoots()) {
      try {
        observer.observe(root, observerOptions);
      } catch {}
    }
    state.hydrationObserver.observer = observer;
  }

  function stopHydrationObserver() {
    if (state.hydrationObserver.timer) {
      clearTimeout(state.hydrationObserver.timer);
      state.hydrationObserver.timer = null;
    }
    try {
      state.hydrationObserver.observer?.disconnect();
    } catch {}
    state.hydrationObserver.observer = null;
  }

  function getSortedEntries() {
    return resolveObservedChronology([...state.collected.values()]);
  }

  function analyzeTurnIndexScheme(indexes) {
    const unique = [...new Set((indexes || []).filter((x) => Number.isFinite(x)))].sort((a, b) => a - b);
    if (!unique.length) {
      return {
        base: null,
        contiguous: false,
        leadingMissingIndexCount: 0,
        leadingBoundaryByIndex: "index-evidence-unavailable"
      };
    }

    const contiguous = unique.every((value, i) => i === 0 || value === unique[i - 1] + 1);
    if (contiguous && unique[0] === 0) {
      return { base: 0, contiguous: true, leadingMissingIndexCount: 0, leadingBoundaryByIndex: "starts-at-turn-0" };
    }
    if (contiguous && unique[0] === 1) {
      return { base: 1, contiguous: true, leadingMissingIndexCount: 0, leadingBoundaryByIndex: "starts-at-turn-1" };
    }

    return {
      base: null,
      contiguous,
      // Current ChatGPT commonly numbers turns from 1. Treat indexes above 1
      // as potential leading omissions, while leaving top certification as the
      // primary boundary proof.
      leadingMissingIndexCount: Math.max(0, unique[0] - 1),
      leadingBoundaryByIndex: unique[0] > 1
        ? "earliest-index-greater-than-1"
        : "index-base-unresolved"
    };
  }

  function analyzeCapture(entries) {
    const indexes = entries
      .map((e) => e.turnIndex)
      .filter((x) => Number.isFinite(x))
      .sort((a, b) => a - b);

    const firstEntry = entries[0] || null;
    const firstUserEntry = entries.find((e) => e.role === "user") || null;
    const turnZeroEntry = entries.find((e) => e.turnIndex === 0) || null;
    const indexScheme = analyzeTurnIndexScheme(indexes);

    const report = {
      capturedTurns: entries.length,
      capturedTextChars: entries.reduce(
        (sum, entry) => sum + Number(entry.textLength || 0),
        0
      ),
      indexedTurns: indexes.length,
      firstTurnIndex: indexes.length ? indexes[0] : null,
      lastTurnIndex: indexes.length ? indexes[indexes.length - 1] : null,
      possibleMissingTurnIndexes: [],
      duplicateIndexes: [],
      canValidateByTurnIndexes: indexes.length >= Math.max(3, Math.floor(entries.length * 0.5)),

      // Separate leading-boundary validation. The old validator only checked
      // gaps *between* firstTurnIndex and lastTurnIndex.
      turnIndexBase: indexScheme.base,
      turnIndexesContiguous: indexScheme.contiguous,
      leadingMissingIndexCount: indexScheme.leadingMissingIndexCount,
      leadingBoundaryByIndex: indexScheme.leadingBoundaryByIndex,
      hasTurnZero: Boolean(turnZeroEntry),
      turnZeroRole: turnZeroEntry?.role || null,
      firstSortedEntry: firstEntry
        ? {
            role: firstEntry.role || "unknown",
            turnIndex: Number.isFinite(firstEntry.turnIndex) ? firstEntry.turnIndex : null,
            stableId: firstEntry.stableId || null
          }
        : null,
      firstUserEntry: firstUserEntry
        ? {
            turnIndex: Number.isFinite(firstUserEntry.turnIndex) ? firstUserEntry.turnIndex : null,
            stableId: firstUserEntry.stableId || null
          }
        : null,
      startsWithUserQuery: firstEntry?.role === "user",
      firstQueryBoundaryLooksComplete:
        Boolean(firstEntry?.role === "user") &&
        (!indexes.length || indexScheme.leadingMissingIndexCount === 0),

      certifiedTopBoundary: state.ordering.certifiedTop
        ? {
            stableId: state.ordering.certifiedTop.stableId || null,
            role: state.ordering.certifiedTop.role || null,
            key: state.ordering.certifiedTop.key || null
          }
        : null,
      exportedFirstKey: firstEntry?.key || null,
      exportedFirstMatchesCertifiedTop:
        Boolean(
          state.ordering.certifiedTop?.key &&
          firstEntry?.key === state.ordering.certifiedTop.key
        ),
      orderResolution: state.ordering.lastResolution
        ? { ...state.ordering.lastResolution }
        : null,

      topBoundaryValidation: {
        stabilized: Boolean(state.topBoundaryValidation.stabilized),
        quietRoundsCompleted: state.topBoundaryValidation.quietRoundsCompleted,
        roundsRequired: state.topBoundaryValidation.roundsRequired,
        retriggersPerformed: state.topBoundaryValidation.retriggersPerformed,
        lastFailureReason: state.topBoundaryValidation.lastFailureReason,
        validatedAt: state.topBoundaryValidation.validatedAt,
        deepChallengePerformed: Boolean(state.topBoundaryValidation.deepChallengePerformed),
        deepChallengeOlderHistoryObserved: Boolean(
          state.topBoundaryValidation.deepChallengeOlderHistoryObserved
        )
      },

      gapGuard: {
        mode: state.gapGuard.mode,
        transitionsChecked: state.gapGuard.transitionsChecked,
        zeroOverlapSuspicions: state.gapGuard.zeroOverlapSuspicions,
        transientSuspicions: state.gapGuard.transientSuspicions,
        recoveryAttempts: state.gapGuard.recoveryAttempts,
        recoveredGaps: state.gapGuard.recoveredGaps,
        unresolvedGaps: state.gapGuard.unresolvedGaps,
        recoveryMs: Math.round(state.gapGuard.recoveryMs)
      },

      contentValidation: {
        snapshotUpgrades: state.contentValidation.snapshotUpgrades,
        snapshotUpgradesFromMutationObserver:
          state.contentValidation.snapshotUpgradesFromMutationObserver,
        downgradeSnapshotsIgnored: state.contentValidation.downgradeSnapshotsIgnored,
        messagesWithMultipleVariants:
          state.contentValidation.messagesWithMultipleVariants,
        largestTextGrowthChars: state.contentValidation.largestTextGrowthChars,
        largestHtmlGrowthChars: state.contentValidation.largestHtmlGrowthChars,
        largestSnapshotUpgrades: state.contentValidation.largestSnapshotUpgrades.slice()
      },

      hydrationObserver: {
        mutationBursts: state.hydrationObserver.mutationBursts,
        debouncedObservations: state.hydrationObserver.debouncedObservations,
        newTurnsCaughtOutsideNormalPass:
          state.hydrationObserver.newTurnsCaughtOutsideNormalPass,
        richerSnapshotsCaughtOutsideNormalPass:
          state.hydrationObserver.richerSnapshotsCaughtOutsideNormalPass
      },

      richBlockValidation: {
        candidatesDetected: state.richBlockValidation.candidatesDetected,
        confirmationAttempts: state.richBlockValidation.confirmationAttempts,
        hydratedDuringConfirmation: state.richBlockValidation.hydratedDuringConfirmation,
        resolvedAfterConfirmation: state.richBlockValidation.resolvedAfterConfirmation,
        unresolvedCandidates: state.richBlockValidation.unresolvedCandidates,
        disconnectedBeforeResolution: state.richBlockValidation.disconnectedBeforeResolution,
        confirmationWaitMs: Math.round(state.richBlockValidation.confirmationWaitMs),
        candidateSamples: state.richBlockValidation.candidateSamples.slice()
      },

      redesignedAssistantValidation: {
        assistantGroupsSeen: state.redesignedAssistantValidation.assistantGroupsSeen,
        assistantEntriesBuilt: state.redesignedAssistantValidation.assistantEntriesBuilt,
        labelOnlyCandidates: state.redesignedAssistantValidation.labelOnlyCandidates,
        incompleteEntries: state.redesignedAssistantValidation.incompleteEntries,
        prunedUserSubtrees: state.redesignedAssistantValidation.prunedUserSubtrees,
        prunedSemanticLabels: state.redesignedAssistantValidation.prunedSemanticLabels
      },

      richOutputFormatting: {
        writingBlocksStaticized: state.richOutputFormatting.writingBlocksStaticized,
        codeEditorsStaticized: state.richOutputFormatting.codeEditorsStaticized,
        codeCardsStaticized: state.richOutputFormatting.codeCardsStaticized,
        outputTabsStaticized: state.richOutputFormatting.outputTabsStaticized,
        richEditableNodesPreserved: state.richOutputFormatting.richEditableNodesPreserved,
        structuredMarkdownBlocks: state.richOutputFormatting.structuredMarkdownBlocks
      },

      scanDiagnostics: {
        passesCompleted: state.scanDiagnostics.passesCompleted,
        normalCollectionCalls: state.scanDiagnostics.normalCollectionCalls,
        mutationCollectionCalls: state.scanDiagnostics.mutationCollectionCalls,
        richConfirmationCollectionCalls: state.scanDiagnostics.richConfirmationCollectionCalls,
        maxMountedTurns: state.scanDiagnostics.maxMountedTurns,
        newTurnsFromNormalScan: state.scanDiagnostics.newTurnsFromNormalScan,
        newTurnsFromMutationObserver: state.scanDiagnostics.newTurnsFromMutationObserver
      },

      collectionPerformance: {
        totalCollectionMs: Math.round(state.collectionPerformance.totalCollectionMs),
        normalCollectionMs: Math.round(state.collectionPerformance.normalCollectionMs),
        mutationCollectionMs: Math.round(state.collectionPerformance.mutationCollectionMs),
        richConfirmationCollectionMs: Math.round(state.collectionPerformance.richConfirmationCollectionMs),
        signatureChecks: state.collectionPerformance.signatureChecks,
        signatureRichScanSkips: state.collectionPerformance.signatureRichScanSkips,
        entryBuilds: state.collectionPerformance.entryBuilds,
        entryBuildMs: Math.round(state.collectionPerformance.entryBuildMs),
        maxCollectionCallMs: Math.round(state.collectionPerformance.maxCollectionCallMs),
        slowCollectionCalls: state.collectionPerformance.slowCollectionCalls,
        slowestCalls: state.collectionPerformance.slowestCalls.map((item) => ({ ...item }))
      },

      scanPacing: {
        fastWaitPasses: state.scanPacing.fastWaitPasses,
        periodicSlowWaitPasses: state.scanPacing.periodicSlowWaitPasses,
        adaptiveSlowWaitPasses: state.scanPacing.adaptiveSlowWaitPasses,
        fastWaitRequestedMs: Math.round(state.scanPacing.fastWaitRequestedMs),
        periodicSlowWaitRequestedMs: Math.round(state.scanPacing.periodicSlowWaitRequestedMs),
        adaptiveSlowWaitRequestedMs: Math.round(state.scanPacing.adaptiveSlowWaitRequestedMs),
        fastWaitActualMs: Math.round(state.scanPacing.fastWaitActualMs),
        periodicSlowWaitActualMs: Math.round(state.scanPacing.periodicSlowWaitActualMs),
        adaptiveSlowWaitActualMs: Math.round(state.scanPacing.adaptiveSlowWaitActualMs),
        slowModeEntries: state.scanPacing.slowModeEntries,
        slowModeExits: state.scanPacing.slowModeExits,
        normalScannerProgressPasses: state.scanPacing.normalScannerProgressPasses,
        aggregateProgressPasses: state.scanPacing.aggregateProgressPasses,
        mutationOnlyProgressPasses: state.scanPacing.mutationOnlyProgressPasses,
        maxNoNormalScannerProgressStreak:
          state.scanPacing.maxNoNormalScannerProgressStreak,
        maxNoAggregateProgressStreak:
          state.scanPacing.maxNoAggregateProgressStreak,
        currentNoNormalScannerProgressStreak:
          state.scanPacing.currentNoNormalScannerProgressStreak,
        currentNoAggregateProgressStreak:
          state.scanPacing.currentNoAggregateProgressStreak,
        turnGrowthWhileAdaptiveSlow: state.scanPacing.turnGrowthWhileAdaptiveSlow
      },

      scrollDiagnostics: {
        mainScanCommands: state.scrollDiagnostics.mainScanCommands,
        movedPasses: state.scrollDiagnostics.movedPasses,
        nearZeroMovementPasses: state.scrollDiagnostics.nearZeroMovementPasses,
        mountedSetChangedPasses: state.scrollDiagnostics.mountedSetChangedPasses,
        sameMountedSetPasses: state.scrollDiagnostics.sameMountedSetPasses,
        totalAbsScrollDeltaPx: Math.round(state.scrollDiagnostics.totalAbsScrollDeltaPx)
      },

      redesignedTopHydration: {
        attemptsStarted: state.redesignedTopHydration.attemptsStarted,
        attemptsCompleted: state.redesignedTopHydration.attemptsCompleted,
        spinnerDetectedAttempts: state.redesignedTopHydration.spinnerDetectedAttempts,
        spinnerObservations: state.redesignedTopHydration.spinnerObservations,
        spinnerCleared: state.redesignedTopHydration.spinnerCleared,
        waitMs: Math.round(state.redesignedTopHydration.waitMs),
        nudges: state.redesignedTopHydration.nudges,
        captureGrowthEvents: state.redesignedTopHydration.captureGrowthEvents,
        rangeGrowthEvents: state.redesignedTopHydration.rangeGrowthEvents,
        largestRangeGrowthPx: state.redesignedTopHydration.largestRangeGrowthPx,
        firstKeyChanges: state.redesignedTopHydration.firstKeyChanges,
        timeouts: state.redesignedTopHydration.timeouts,
        pendingAtTimeout: state.redesignedTopHydration.pendingAtTimeout,
        lastInitialRangePx: state.redesignedTopHydration.lastInitialRangePx,
        lastFinalRangePx: state.redesignedTopHydration.lastFinalRangePx,
        lastSpinnerSeen: state.redesignedTopHydration.lastSpinnerSeen,
        lastResult: state.redesignedTopHydration.lastResult
      },

      topValidationDiagnostics: {
        attemptsStarted: state.topValidationDiagnostics.attemptsStarted,
        attemptsCompleted: state.topValidationDiagnostics.attemptsCompleted,
        successfulAttempts: state.topValidationDiagnostics.successfulAttempts,
        totalCycles: state.topValidationDiagnostics.totalCycles,
        totalValidationMs: Math.round(state.topValidationDiagnostics.totalValidationMs),
        maxRoundReached: state.topValidationDiagnostics.maxRoundReached,
        retriggerAttempts: state.topValidationDiagnostics.retriggerAttempts,
        deepChallenges: state.topValidationDiagnostics.deepChallenges,
        geometryOnlySignals: state.topValidationDiagnostics.geometryOnlySignals,
        firstKeyOnlySignals: state.topValidationDiagnostics.firstKeyOnlySignals,
        invalidations: { ...state.topValidationDiagnostics.invalidations },
        recentSignals: state.topValidationDiagnostics.recentSignals.slice()
      },

      conversationDetection: {
        ...state.conversationDetection,
        selectorMatches: { ...state.conversationDetection.selectorMatches },
        sameOriginFrameSelectorMatches: {
          ...state.conversationDetection.sameOriginFrameSelectorMatches
        },
        shadowSelectorMatches: { ...state.conversationDetection.shadowSelectorMatches },
        shadowHosts: state.conversationDetection.shadowHosts.map((item) => ({ ...item })),
        scrollCandidates: state.conversationDetection.scrollCandidates.map((item) => ({
          ...item,
          rect: item.rect ? { ...item.rect } : null,
          scrollProbe: item.scrollProbe ? { ...item.scrollProbe } : null
        })),
        selectedScrollElement: state.conversationDetection.selectedScrollElement
          ? {
              ...state.conversationDetection.selectedScrollElement,
              rect: state.conversationDetection.selectedScrollElement.rect
                ? { ...state.conversationDetection.selectedScrollElement.rect }
                : null,
              scrollProbe: state.conversationDetection.selectedScrollElement.scrollProbe
                ? { ...state.conversationDetection.selectedScrollElement.scrollProbe }
                : null
            }
          : null,
        structuralInventory: state.conversationDetection.structuralInventory
          ? JSON.parse(JSON.stringify(state.conversationDetection.structuralInventory))
          : null
      },

      rendererRuntime: {
        generation: state.renderer.generation,
        timelineDetected: Boolean(state.renderer.timelineDetected),
        reversedTimeline: Boolean(state.renderer.reversedTimeline)
      },

      alphaDiagnostics: {
        ran: state.alphaDiagnostics.ran,
        ranAt: state.alphaDiagnostics.ranAt,
        rendererProbe: JSON.parse(JSON.stringify(state.alphaDiagnostics.rendererProbe)),
        canonicalProbe: JSON.parse(JSON.stringify(state.alphaDiagnostics.canonicalProbe))
      },

      zeroTurnRecovery: {
        triggered: state.zeroTurnRecovery.triggered,
        attempts: state.zeroTurnRecovery.attempts,
        waitMs: Math.round(state.zeroTurnRecovery.waitMs),
        scrollElementRedetections: state.zeroTurnRecovery.scrollElementRedetections,
        recovered: state.zeroTurnRecovery.recovered,
        recoveredTurnCount: state.zeroTurnRecovery.recoveredTurnCount,
        finalReason: state.zeroTurnRecovery.finalReason,
        scrollProbeAttempts: state.zeroTurnRecovery.scrollProbeAttempts,
        scrollProbeSuccesses: state.zeroTurnRecovery.scrollProbeSuccesses,
        rejectedImmovableCandidates: state.zeroTurnRecovery.rejectedImmovableCandidates
      },

      diagnosticFingerprint: diagnosticFingerprintForEntries(entries),

      checkpointValidation: {
        conversationKey: state.checkpointValidation.conversationKey,
        checkpointAvailable: state.checkpointValidation.checkpointAvailable,
        knownFirstStableId: state.checkpointValidation.knownFirstStableId,
        knownMaxCapturedTurns: state.checkpointValidation.knownMaxCapturedTurns,
        knownMaxCapturedTextChars:
          state.checkpointValidation.knownMaxCapturedTextChars,
        checkpointExporterVersion:
          state.checkpointValidation.checkpointExporterVersion,
        reachedKnownFirstStableId:
          state.checkpointValidation.reachedKnownFirstStableId,
        retryAttempts: state.checkpointValidation.retryAttempts,
        supersededByEarlierCapture:
          state.checkpointValidation.supersededByEarlierCapture,
        saved: state.checkpointValidation.saved,
        storageError: state.checkpointValidation.storageError
      },

      result: {
        completionStatus: captureHealthStatus(),
        rerunRecommended: state.captureWarnings.length > 0,
        warningCount: state.captureWarnings.length
      },

      timing: {
        totalMs: Math.round(performance.now() - state.timing.startedPerf),
        gapRecoveryMs: Math.round(state.timing.gapRecoveryMs),
        topValidationMs: Math.round(state.timing.topValidationMs)
      },

      orderingValidation: {
        startsWithUserQuery: firstEntry?.role === "user",
        exportedFirstMatchesStabilizedBoundary: Boolean(
          state.topBoundaryValidation.stabilized &&
          state.ordering.certifiedTop?.key &&
          firstEntry?.key === state.ordering.certifiedTop.key
        ),
        contradictoryPairs: state.ordering.lastResolution?.contradictoryPairs ?? null,
        cycleBreaks: state.ordering.lastResolution?.cycleBreaks ?? null,
        ambiguousChoiceSteps: state.ordering.lastResolution?.ambiguousChoiceSteps ?? null,
        maxZeroIndegreeChoices: state.ordering.lastResolution?.maxZeroIndegreeChoices ?? null,
        fallbackSelections: state.ordering.lastResolution?.fallbackSelections ?? null
      },

      runtimeVisibility: runtimeVisibilityReport()
    };

    if (indexes.length) {
      const seen = new Set();

      for (const idx of indexes) {
        if (seen.has(idx)) report.duplicateIndexes.push(idx);
        seen.add(idx);
      }

      for (let i = report.firstTurnIndex; i <= report.lastTurnIndex; i++) {
        if (!seen.has(i)) {
          report.possibleMissingTurnIndexes.push(i);
        }
      }
    }

    return report;
  }

  function collectAccessibleCssRules() {
    if (!CONFIG.embedAccessibleCssRules) return "";

    const chunks = [];

    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = Array.from(sheet.cssRules || []).map((r) => r.cssText).join("\n");
        if (rules) chunks.push(`/* stylesheet: ${sheet.href || "inline"} */\n${rules}`);
      } catch {
        // Cross-origin/protected stylesheet. Firefox Ctrl-S mode can still save linked CSS.
      }
    }

    return chunks.join("\n\n");
  }

  function absolutizeCssUrls(cssText, baseHref) {
    const base = baseHref || location.href;

    return String(cssText || "").replace(
      /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
      (match, quote, rawUrl) => {
        const url = String(rawUrl || "").trim();

        if (
          !url ||
          url.startsWith("data:") ||
          url.startsWith("blob:") ||
          url.startsWith("http://") ||
          url.startsWith("https://")
        ) {
          return match;
        }

        try {
          return `url("${new URL(url, base).href}")`;
        } catch {
          return match;
        }
      }
    );
  }

  function targetedCssRuleWanted(rule, cssText) {
    const s = String(cssText || "");
    const lower = s.toLowerCase();
    const selector = String(rule?.selectorText || "").toLowerCase();

    if (!CONFIG.useBundledKatexCss) {
      // Fallback only: collect live KaTeX/MathJax CSS when the deterministic
      // bundled KaTeX stylesheet is explicitly disabled.
      if (
        typeof CSSRule !== "undefined" &&
        rule?.type === CSSRule.FONT_FACE_RULE
      ) {
        return lower.includes("font-family:katex") ||
          lower.includes("font-family: katex") ||
          lower.includes("font-family:'katex") ||
          lower.includes('font-family:"katex');
      }

      if (
        selector.includes(".katex") ||
        selector.includes("mjx") ||
        selector.includes(".mathjax") ||
        selector.includes("mjx-container") ||
        lower.includes(".katex") ||
        lower.includes("katex_") ||
        lower.includes("mjx-container") ||
        lower.includes(".mathjax")
      ) {
        return true;
      }
    }

    // Code fidelity: syntax token/highlight selectors only, not the entire app CSS.
    if (
      selector.includes(".hljs") ||
      selector.includes(".token") ||
      selector.includes("language-") ||
      selector.includes(".cm-") ||
      selector.includes(".tok-") ||
      selector.includes("pre code") ||
      selector.includes("code[class") ||
      selector.includes(".prose pre") ||
      selector.includes(".markdown pre")
    ) {
      return true;
    }

    return false;
  }

  function cssRuleTextRecursive(rule, sheetHref, depth = 0) {
    if (!rule || depth > 6) return "";

    // Important: for @layer / @media / @supports groups, inspect children first.
    // The previous Math CSS build tested the parent cssText and accidentally
    // copied a huge ChatGPT @layer because one nested rule mentioned KaTeX.
    if (rule.cssRules) {
      const nested = Array.from(rule.cssRules)
        .map((r) => cssRuleTextRecursive(r, sheetHref, depth + 1))
        .filter(Boolean)
        .join("\n");

      if (!nested) return "";

      const ctor = rule.constructor?.name || "";
      const condition = rule.conditionText || "";

      if (ctor.includes("Media") && condition) {
        return `@media ${condition} {\n${nested}\n}`;
      }

      if (ctor.includes("Supports") && condition) {
        return `@supports ${condition} {\n${nested}\n}`;
      }

      // CSSLayerBlockRule: do not keep the whole @layer wrapper. The selected
      // nested rules are valid without it and this avoids pulling unrelated app CSS.
      return nested;
    }

    const cssText = absolutizeCssUrls(rule.cssText || "", sheetHref);

    if (!cssText) return "";

    if (targetedCssRuleWanted(rule, cssText)) {
      return cssText;
    }

    return "";
  }

  function collectTargetedMathCodeCssRules() {
    if (!CONFIG.embedTargetedMathCodeCssRules) return "";

    const chunks = [];
    const seen = new Set();
    let total = 0;

    for (const sheet of Array.from(document.styleSheets)) {
      let rules = [];

      try {
        rules = Array.from(sheet.cssRules || []);
      } catch {
        continue;
      }

      const picked = [];

      for (const rule of rules) {
        const text = cssRuleTextRecursive(rule, sheet.href || location.href);
        if (!text) continue;

        for (const part of text.split("\n")) {
          const trimmed = part.trim();
          if (!trimmed || seen.has(trimmed)) continue;

          if (total + trimmed.length > CONFIG.targetedCssMaxChars) {
            break;
          }

          seen.add(trimmed);
          picked.push(trimmed);
          total += trimmed.length;
        }

        if (total >= CONFIG.targetedCssMaxChars) break;
      }

      if (picked.length) {
        chunks.push(`/* targeted stylesheet: ${sheet.href || "inline"} */\n${picked.join("\n")}`);
      }

      if (total >= CONFIG.targetedCssMaxChars) break;
    }

    if (!chunks.length) return "";

    return `
/* Targeted live ChatGPT code CSS.
   KaTeX layout comes from the deterministic bundled stylesheet.
   Precise extractor:
   - keeps KaTeX @font-face rules
   - keeps .katex / MathJax selector rules
   - keeps syntax token rules
   - rewrites /cdn/assets/... font URLs to absolute https://chatgpt.com/... URLs
   - does not copy huge unrelated @layer blocks */
${chunks.join("\n\n")}
`;
  }

  function collectStylesheetLinks() {
    const links = [];

    document.querySelectorAll('link[rel~="stylesheet"][href]').forEach((link) => {
      const href = link.href;
      if (!href) return;
      links.push(`<link rel="stylesheet" href="${escapeHtml(href)}">`);
    });

    return links.join("\n");
  }

  function chatgptLikeCss() {
    return `
:root {
  color-scheme: dark;
  --saved-bg: #212121;
  --saved-surface: #303030;
  --saved-user: #2f2f2f;
  --saved-assistant: #212121;
  --saved-border: rgba(255,255,255,.12);
  --saved-text: #ececec;
  --saved-muted: #b4b4b4;
  --saved-code-bg: #0d0d0d;
  --saved-link: #8ab4f8;
}

html, body {
  margin: 0;
  padding: 0;
  background: var(--saved-bg);
  color: var(--saved-text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  font-size: 15.5px;
  line-height: 1.48;
}

.saved-header {
  position: static;
  padding: 10px 20px;
  background: #212121;
  border-bottom: 1px solid var(--saved-border);
}

.saved-header h1 {
  margin: 0 0 3px 0;
  font-size: 17px;
  font-weight: 700;
}

.saved-meta {
  font-size: 11px;
  line-height: 1.35;
  opacity: .72;
  word-break: break-word;
}

.saved-main {
  max-width: 860px;
  margin: 0 auto;
  padding: 14px 20px;
}

.saved-report {
  margin: 0 0 24px 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: #2b2b2b;
  border: 1px solid var(--saved-border);
  font-size: 13px;
}

.saved-report h2 {
  font-size: 16px;
  margin: 0 0 8px 0;
}

.saved-warning {
  border-left: 5px solid #f6c343;
}

.saved-turn {
  margin: 0 0 18px 0;
  padding: 0 0 16px 0;
  border-radius: 0;
  border: 0;
  background: transparent;
}

.saved-role-user {
  background: transparent;
  border-left: 3px solid #10a37f;
  padding-left: 14px;
}

.saved-role-assistant {
  background: transparent;
  border-left: 3px solid #ab68ff;
  padding-left: 14px;
}

.saved-turn-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 700;
  color: var(--saved-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
}

.saved-turn-body {
  overflow-wrap: anywhere;
}

.saved-turn-body > *:first-child {
  margin-top: 0;
}

.saved-turn-body > *:last-child {
  margin-bottom: 0;
}

.saved-expanded-user-text,
.saved-expanded-text {
  white-space: normal;
}

p {
  margin: 0 0 .75em 0;
}

ul, ol {
  margin-top: .5em;
  margin-bottom: 1em;
  padding-left: 1.45em;
}

li {
  margin: .25em 0;
}

h1, h2, h3, h4 {
  line-height: 1.3;
  margin: 1.2em 0 .55em;
}


/* V4.2 math preservation fallback. Inline computed styles are the primary
   protection; these rules provide a second layer when KaTeX/MathJax CSS was
   inaccessible. */
.katex,
.katex * {
  box-sizing: content-box;
}

.katex {
  font: normal 1.12em KaTeX_Main, "Times New Roman", Times, serif;
  line-height: 1.2;
  text-indent: 0;
  text-rendering: auto;
}

.katex-display {
  display: block;
  text-align: center;
  margin: .75em 0;
  overflow: visible;
  max-width: none;
}

.katex-display > .katex {
  display: inline-block;
  text-align: initial;
}

.katex .katex-html {
  white-space: nowrap;
}

.math,
.math-inline,
.math-display,
mjx-container,
.katex-display {
  max-width: 100%;
}

mjx-container {
  overflow: visible;
  max-width: none;
}

mjx-container[display="true"] {
  display: block;
  text-align: center;
  margin: .75em 0;
}

math {
  font-family: "Times New Roman", Times, serif;
}

/* Hide assistive/accessibility math layers in the static archive.
   Without this, KaTeX/MathJax can show both semantic MathML and visual math,
   producing duplicated lines/equations. */
.katex-mathml,
.katex .katex-mathml,
mjx-assistive-mml,
.sr-only,
[class*="sr-only"],
[class*="visually-hidden"],
[class*="screen-reader"],
[class*="ScreenReader"] {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  padding: 0 !important;
  margin: -1px !important;
  overflow: hidden !important;
  clip: rect(0, 0, 0, 0) !important;
  clip-path: inset(50%) !important;
  white-space: nowrap !important;
  border: 0 !important;
}

.katex .katex-html {
  display: inline-block;
}

.katex-display .katex .katex-html {
  display: inline-block;
  text-align: initial;
}

/* Internal KaTeX layout is supplied by the complete unscoped OpenAI
   KaTeX stylesheet below. Do not force generic display values on math atoms. */

a {
  color: var(--saved-link);
  text-decoration: underline;
  text-underline-offset: 2px;
}

pre {
  overflow-x: auto;
  padding: 11px 13px;
  border-radius: 10px;
  background: var(--saved-code-bg);
  border: 1px solid rgba(255,255,255,.1);
  line-height: 1.45;
  font-size: 13px;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: .875em;
}

:not(pre) > code {
  background: rgba(255,255,255,.09);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 5px;
  padding: .13em .35em;
}

pre code {
  background: transparent;
  border: 0;
  padding: 0;
  color: #f8f8f2;
}

.hljs-keyword, .token.keyword { color: #ff7b72; }
.hljs-string, .token.string { color: #a5d6ff; }
.hljs-number, .token.number { color: #79c0ff; }
.hljs-title, .token.function { color: #d2a8ff; }
.hljs-built_in, .token.builtin { color: #ffa657; }
.hljs-comment, .token.comment { color: #8b949e; font-style: italic; }
.hljs-variable, .token.variable { color: #ffa657; }
.hljs-attr, .token.attr-name, .token.property { color: #7ee787; }
.hljs-literal, .token.boolean, .token.constant { color: #79c0ff; }
.hljs-meta, .token.operator, .token.punctuation { color: #c9d1d9; }
.hljs-class .hljs-title, .token.class-name { color: #ffa657; }
.hljs-params, .token.parameter { color: #ffa657; }
.hljs-regexp, .token.regex { color: #a5d6ff; }
.hljs-tag, .token.tag { color: #7ee787; }
.hljs-name, .token.selector { color: #7ee787; }
.hljs-template-tag, .token.template-string { color: #a5d6ff; }

.saved-code-card {
  margin: 1em 0;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 12px;
  background: #202020;
  overflow: hidden;
  box-shadow: 0 1px 0 rgba(255,255,255,.025) inset;
}

.saved-code-card-header {
  display: flex;
  align-items: center;
  min-height: 34px;
  padding: 0 12px;
  background: #2a2a2a;
  border-bottom: 1px solid rgba(255,255,255,.09);
}

.saved-code-card-label {
  color: #f0f0f0;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  font-weight: 650;
  line-height: 1;
  text-transform: none;
}

.saved-code-card-scroll {
  box-sizing: border-box;
  display: block;
  width: 100%;
  max-width: 100%;
  max-height: 520px;
  margin: 0;
  padding: 13px 16px 15px;
  overflow: auto;
  overscroll-behavior: contain;
  background: #202020;
  border: 0;
  border-radius: 0;
  white-space: pre;
  tab-size: 2;
  scrollbar-color: rgba(255,255,255,.28) transparent;
  scrollbar-width: thin;
}

.saved-code-card-code {
  display: block;
  width: max-content;
  min-width: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #e6edf3;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.55;
  white-space: pre;
  overflow-wrap: normal;
  word-break: normal;
  text-shadow: none;
}

.saved-code-card-code .saved-syn-property { color: #e6edf3; }
.saved-code-card-code .saved-syn-string { color: #7ee787; }
.saved-code-card-code .saved-syn-number { color: #79c0ff; }
.saved-code-card-code .saved-syn-constant { color: #79c0ff; }
.saved-code-card-code .saved-syn-keyword { color: #ff7b72; }
.saved-code-card-code .saved-syn-comment { color: #8b949e; font-style: italic; }
.saved-code-card-code .saved-syn-tag { color: #58a6ff; }
.saved-code-card-code .saved-syn-attribute { color: #ffa657; }
.saved-code-card-code .saved-syn-variable { color: #e3b341; }
.saved-code-card-code .saved-syn-operator,
.saved-code-card-code .saved-syn-punctuation { color: #c9d1d9; }

@media (max-width: 700px) {
  .saved-code-card-scroll { max-height: 60vh; }
}

@media print {
  .saved-code-card-scroll {
    max-height: none !important;
    overflow: visible !important;
    white-space: pre-wrap !important;
  }
  .saved-code-card-code {
    width: auto !important;
    min-width: 0 !important;
    white-space: pre-wrap !important;
  }
}

.saved-writing-block,
.saved-code-panel {
  margin: 1em 0;
  border: 1px solid rgba(255,255,255,.14);
  border-radius: 12px;
  background: #171717;
  overflow: hidden;
}

.saved-writing-block-header,
.saved-code-panel > .code-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  background: #262626;
  border-bottom: 1px solid rgba(255,255,255,.10);
}

.saved-output-tab {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 2px 7px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.055);
  color: #bdbdbd;
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: .035em;
  text-transform: uppercase;
}

.saved-output-tab[data-active="true"] {
  color: #f2f2f2;
  background: rgba(255,255,255,.13);
  border-color: rgba(255,255,255,.20);
}

.saved-writing-block-editor,
.saved-code-editor,
.saved-code-scroller,
.saved-code-content {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow: visible !important;
  overflow-x: visible !important;
  overflow-y: visible !important;
}

.saved-writing-block-content {
  padding: 12px 14px;
  white-space: normal;
  overflow-wrap: anywhere;
}

.saved-writing-block-content > *:first-child { margin-top: 0; }
.saved-writing-block-content > *:last-child { margin-bottom: 0; }

.saved-output-preformatted,
.saved-code-content {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 13px;
  line-height: 1.5;
  white-space: pre-wrap !important;
  tab-size: 2;
}

.saved-output-preformatted { padding: 12px 14px; }

.saved-code-editor {
  padding: 10px 12px;
  background: var(--saved-code-bg);
  overflow-x: auto !important;
}

.saved-code-content {
  width: max-content;
  min-width: 100%;
  padding: 0;
}

.saved-code-line {
  display: block !important;
  min-height: 1.45em;
  white-space: pre !important;
}

.saved-static-button,
.saved-file-chip {
  display: inline-flex;
  align-items: center;
  max-width: 230px;
  min-height: 22px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,.10);
  border: 1px solid rgba(255,255,255,.16);
  color: var(--saved-text);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  margin: 0 3px 2px 3px;
  vertical-align: middle;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved-citation-chip {
  display: inline-flex;
  align-items: center;
  max-width: 120px;
  min-height: 18px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255,255,255,.10);
  border: 1px solid rgba(255,255,255,.16);
  color: var(--saved-link);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.25;
  margin: 0 2px;
  vertical-align: baseline;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.saved-citation-chip:hover {
  background: rgba(255,255,255,.14);
  text-decoration: underline;
}

/* Safety: if a ChatGPT favicon chip survives simplification, never let its raw
   width="128" / height="128" attributes take over the static page. */
.saved-turn-body a img[src*="google.com/s2/favicons"],
.saved-turn-body a img[src*="favicon"] {
  width: 12px !important;
  height: 12px !important;
  max-width: 12px !important;
  max-height: 12px !important;
  min-width: 12px !important;
  min-height: 12px !important;
  object-fit: contain !important;
  vertical-align: -2px !important;
  display: inline-block !important;
}

.saved-turn-body svg:not(.katex svg) {
  max-width: 1.25em;
  max-height: 1.25em;
}

img {
  max-width: 100%;
  height: auto;
}

table {
  border-collapse: collapse;
  max-width: 100%;
  display: block;
  overflow-x: auto;
  margin: 1em 0;
}

th, td {
  border: 1px solid rgba(255,255,255,.18);
  padding: 7px 9px;
}

blockquote {
  border-left: 3px solid rgba(255,255,255,.25);
  margin-left: 0;
  padding-left: 12px;
  opacity: .92;
}
`;
  }

  function nativeFallbackCss() {
    return `
html, body {
  margin: 0;
  background: #212121;
  color: #ececec;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.65;
}

.saved-header {
  position: sticky;
  top: 0;
  z-index: 10;
  padding: 14px 20px;
  background: rgba(33,33,33,.96);
  border-bottom: 1px solid rgba(255,255,255,.14);
}

.saved-header h1 { margin: 0 0 6px 0; font-size: 18px; }
.saved-meta { font-size: 12px; opacity: .78; word-break: break-all; }
.saved-main { max-width: 980px; margin: 0 auto; padding: 20px; }

.saved-report {
  margin: 0 0 24px 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: #2b2b2b;
  border: 1px solid rgba(255,255,255,.14);
  font-size: 13px;
}

.saved-warning { border-left: 5px solid #f6c343; }

.saved-native-turn {
  margin: 0 0 24px 0;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255,255,255,.08);
}

.saved-turn-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin: 0 0 8px 0;
  font-size: 12px;
  font-weight: 700;
  color: #b4b4b4;
  text-transform: uppercase;
}

.saved-static-button,
.saved-file-chip {
  display: inline-flex;
  align-items: center;
  max-width: 230px;
  min-height: 22px;
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(255,255,255,.10);
  border: 1px solid rgba(255,255,255,.16);
  color: #ececec;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  margin: 0 3px 2px 3px;
  vertical-align: middle;
  text-decoration: none;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

pre {
  overflow-x: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: #0d0d0d;
}
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }

/* V4.2 math preservation fallback. Inline computed styles are the primary
   protection; these rules provide a second layer when KaTeX/MathJax CSS was
   inaccessible. */
.katex,
.katex * {
  box-sizing: content-box;
}

.katex {
  font: normal 1.12em KaTeX_Main, "Times New Roman", Times, serif;
  line-height: 1.2;
  text-indent: 0;
  text-rendering: auto;
}

.katex-display {
  display: block;
  text-align: center;
  margin: .75em 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.katex-display > .katex {
  display: inline-block;
  text-align: initial;
}

.katex .katex-html {
  white-space: nowrap;
}

.math,
.math-inline,
.math-display,
mjx-container,
.katex-display {
  max-width: 100%;
}

mjx-container {
  overflow-x: auto;
  overflow-y: hidden;
  max-width: 100%;
}

mjx-container[display="true"] {
  display: block;
  text-align: center;
  margin: .75em 0;
}

math {
  font-family: "Times New Roman", Times, serif;
}

a { color: #8ab4f8; }
img { max-width: 100%; height: auto; }
table { border-collapse: collapse; max-width: 100%; display: block; overflow-x: auto; }
th, td { border: 1px solid rgba(255,255,255,.18); padding: 7px 9px; }
`;
  }

  function validationHtml(report, repaired) {
    const missing = report.possibleMissingTurnIndexes;
    const duplicates = report.duplicateIndexes;

    const missingText = !report.canValidateByTurnIndexes
      ? "Possible missing turn indexes: cannot validate because turn indexes were not exposed"
      : missing.length
        ? `Possible missing turn indexes: ${escapeHtml(missing.join(", "))}`
        : "Possible missing turn indexes: none detected";

    const dupText = duplicates.length
      ? `Duplicate turn indexes: ${escapeHtml(duplicates.join(", "))}`
      : "Duplicate turn indexes: none detected";

    const validationText = report.canValidateByTurnIndexes
      ? "Turn-index validation: available"
      : "Turn-index validation: unavailable; using scroll completion only";

    const repairedText = repaired
      ? "Repair pass: performed"
      : "Repair pass: not performed";

    const warnClass = missing.length ? " saved-warning" : "";

    return `
<section class="saved-report${warnClass}">
  <h2>Capture report</h2>
  <div>Captured turns: ${report.capturedTurns}</div>
  <div>Indexed turns: ${report.indexedTurns}</div>
  <div>First turn index: ${report.firstTurnIndex ?? "unknown"}</div>
  <div>Last turn index: ${report.lastTurnIndex ?? "unknown"}</div>
  <div>${validationText}</div>
  <div>${missingText}</div>
  <div>${dupText}</div>
  <div>${repairedText}</div>
  <div>Scan engine: V4.2 quick dom math css role fix</div>
  <div>Archive mode: ${escapeHtml(CONFIG.mode)}</div>
  ${report.totalHtmlPayloadChars ? `<div>HTML payload estimate: ${Math.round(report.totalHtmlPayloadChars / 1024)} KB before document/CSS wrapper</div>` : ""}
  ${report.largestHtmlTurns?.length ? `<details><summary>Largest HTML turns</summary>${
    report.largestHtmlTurns.map((x) =>
      `<div>#${x.index} ${escapeHtml(x.role)} — ${Math.round(x.chars / 1024)} KB — ${escapeHtml(x.preview.slice(0, 120))}</div>`
    ).join("")
  }</details>` : ""}
</section>`;
  }

  function commonHeaderHtml(entries, report, repaired) {
    const title = document.title || "ChatGPT conversation";
    const sourceUrl = location.href;
    const savedAt = new Date().toISOString();

    return `
<header class="saved-header">
  <h1>${escapeHtml(title)}</h1>
  <div class="saved-meta">Saved at: ${escapeHtml(savedAt)}</div>
  <div class="saved-meta">Source: ${escapeHtml(sourceUrl)}</div>
  <div class="saved-meta">Captured turns: ${entries.length}</div>
</header>

<main class="saved-main">
${validationHtml(report, repaired)}`;
  }

  function jsonBackupScript(entries, report, repaired) {
    const hiddenJson = {
      sourceTitle: document.title || "ChatGPT conversation",
      sourceUrl: location.href,
      savedAt: new Date().toISOString(),
      config: CONFIG,
      report,
      repairPassPerformed: repaired,
      turns: entries.map((e, i) => ({
        archiveIndex: i + 1,
        stableId: e.stableId,
        turnIndex: e.turnIndex,
        role: e.role,
        textHash: e.textHash,
        textLength: e.textLength,
        preview: e.preview,
        text: e.text
      }))
    };

    return `<script type="application/json" id="captured-turns-json">
${JSON.stringify(hiddenJson, null, 2).replace(/<\/script/gi, "<\\/script")}
</script>`;
  }

  function finalArchiveCssOverrides() {
    return `
/* Final static-archive overrides. Placed last on purpose. */
.saved-turn-body .katex,
.saved-turn-body .katex * {
  color: var(--saved-text) !important;
  border-color: currentColor !important;
  text-decoration-color: currentColor !important;
}

.saved-turn-body .katex svg,
.saved-turn-body .katex svg * {
  fill: currentColor !important;
  stroke: currentColor !important;
}

.saved-turn-body .katex .frac-line,
.saved-turn-body .katex .overline-line,
.saved-turn-body .katex .sqrt-line,
.saved-turn-body .katex .rule {
  border-color: currentColor !important;
  background-color: currentColor !important;
}

/* Display math must not inherit the live app's scroll wrappers or captured
   viewport widths. Long equations may extend into the page margin, but are not
   clipped and do not receive a scrollbar across the formula. */
.saved-turn-body .katex-display,
.saved-turn-body mjx-container[display="true"],
.saved-turn-body mjx-container[display="block"] {
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
  overflow: visible !important;
  overflow-x: visible !important;
  overflow-y: visible !important;
}

.saved-turn-body .katex-display > .katex {
  width: auto !important;
  min-width: 0 !important;
  max-width: none !important;
  overflow: visible !important;
}

/* Writing blocks and editable code/output panels are fully expanded in the
   static archive. ChatGPT may render them as internal scroll boxes; the archive
   keeps the entire already-captured body visible instead. */
.saved-turn-body .saved-writing-block-editor,
.saved-turn-body .saved-code-editor,
.saved-turn-body .saved-code-scroller,
.saved-turn-body .saved-code-content {
  height: auto !important;
  min-height: 0 !important;
  max-height: none !important;
  overflow-y: visible !important;
}

.saved-turn-body .saved-code-editor {
  overflow-x: auto !important;
}

/* Keep copied inline syntax colors visible inside static code boxes. */
.saved-turn-body pre code,
.saved-turn-body pre code * {
  text-shadow: none !important;
}

/* The actual token color is stored inline on each copied token; this fallback
   only handles common highlighter classes when inline color was unavailable. */
.saved-turn-body .hljs-keyword,
.saved-turn-body .token.keyword { color: #c678dd; }
.saved-turn-body .hljs-string,
.saved-turn-body .token.string { color: #98c379; }
.saved-turn-body .hljs-number,
.saved-turn-body .token.number { color: #d19a66; }
.saved-turn-body .hljs-title,
.saved-turn-body .token.function { color: #61afef; }
.saved-turn-body .hljs-comment,
.saved-turn-body .token.comment { color: #7f848e; font-style: italic; }
.saved-turn-body .hljs-meta,
.saved-turn-body .token.decorator { color: #56b6c2; }

/* Make role separation obvious when role detection succeeds. */
.saved-role-user {
  border-left-color: #10a37f;
}

.saved-role-assistant {
  border-left-color: #ab68ff;
}

.saved-role-user .saved-turn-body {
  background: rgba(255,255,255,.045);
  border: 1px solid rgba(255,255,255,.08);
  border-radius: 14px;
  padding: 10px 12px;
}

.saved-turn-body a img[src*="google.com/s2/favicons"],
.saved-turn-body a img[src*="favicon"] {
  width: 12px !important;
  height: 12px !important;
  max-width: 12px !important;
  max-height: 12px !important;
}

.saved-turn-body button[aria-label*="Copy" i],
.saved-turn-body [data-testid*="copy" i] {
  display: none !important;
}
`;
  }

  function buildArchiveCss() {
    return [
      collectAccessibleCssRules(),
      chatgptLikeCss(),
      bundledKatexCss(),
      collectTargetedMathCodeCssRules(),
      finalArchiveCssOverrides()
    ].filter(Boolean).join("\n\n");
  }

  function buildOfflineAssetsHtml(repaired) {
    const entries = getSortedEntries();
    const report = analyzeCapture(entries);
    const title = document.title || "ChatGPT conversation";

    const turnsHtml = entries.map((entry, i) => {
      const role = escapeHtml(entry.role || "unknown");
      return `
<section class="saved-turn saved-role-${role}" data-role="${role}" data-index="${i + 1}" data-turn-index="${entry.turnIndex ?? ""}">
  <div class="saved-turn-meta">
    <span>#${i + 1}</span>
    <span>${role}</span>
    ${Number.isFinite(entry.turnIndex) ? `<span>turn ${entry.turnIndex}</span>` : ""}
  </div>
  <div class="saved-turn-body">
    ${entry.html}
  </div>
</section>`;
    }).join("\n");

    return `<!doctype html>
<html lang="en-US" class="dark" data-chat-theme="default" style="color-scheme: dark;">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="assets/archive.css">
</head>
<body>
${commonHeaderHtml(entries, report, repaired)}
${turnsHtml}
</main>
${jsonBackupScript(entries, report, repaired)}
</body>
</html>`;
  }

  function buildSelfContainedHtml(repaired) {
    const entries = getSortedEntries();
    const report = analyzeCapture(entries);
    const title = document.title || "ChatGPT conversation";

    const turnsHtml = entries.map((entry, i) => {
      const role = escapeHtml(entry.role || "unknown");
      return `
<section class="saved-turn saved-role-${role}" data-role="${role}" data-index="${i + 1}" data-turn-index="${entry.turnIndex ?? ""}">
  <div class="saved-turn-meta">
    <span>#${i + 1}</span>
    <span>${role}</span>
    ${Number.isFinite(entry.turnIndex) ? `<span>turn ${entry.turnIndex}</span>` : ""}
  </div>
  <div class="saved-turn-body">
    ${entry.html}
  </div>
</section>`;
    }).join("\n");

    return `<!doctype html>
<html lang="en-US" class="dark" data-chat-theme="default" style="color-scheme: dark;">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
${collectAccessibleCssRules()}
</style>
<style>
${chatgptLikeCss()}
</style>
<style>
${bundledKatexCss()}
</style>
<style>
${collectTargetedMathCodeCssRules()}
</style>
<style>
${finalArchiveCssOverrides()}
</style>
</head>
<body>
${commonHeaderHtml(entries, report, repaired)}
${turnsHtml}
</main>
${jsonBackupScript(entries, report, repaired)}
</body>
</html>`;
  }

  function buildNativeLikeHtml(repaired, forCtrlS) {
    const entries = getSortedEntries();
    const report = analyzeCapture(entries);
    const title = document.title || "ChatGPT conversation";
    const accessibleCss = collectAccessibleCssRules();
    const stylesheetLinks = forCtrlS && CONFIG.includeStylesheetLinksInCtrlSMode
      ? collectStylesheetLinks()
      : "";

    const turnsHtml = entries.map((entry, i) => {
      const role = escapeHtml(entry.role || "unknown");
      return `
<section class="saved-native-turn saved-role-${role}" data-role="${role}" data-index="${i + 1}" data-turn-index="${entry.turnIndex ?? ""}">
  <div class="saved-turn-meta">
    <span>#${i + 1}</span>
    <span>${role}</span>
    ${Number.isFinite(entry.turnIndex) ? `<span>turn ${entry.turnIndex}</span>` : ""}
  </div>
  ${entry.nativeHtml}
</section>`;
    }).join("\n");

    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
${stylesheetLinks}
<style>
${accessibleCss}
</style>
<style>
${nativeFallbackCss()}
</style>
<style>
${bundledKatexCss()}
</style>
<style>
${collectTargetedMathCodeCssRules()}
</style>
<style>
${finalArchiveCssOverrides()}
</style>
</head>
<body>
${commonHeaderHtml(entries, report, repaired)}
${turnsHtml}
</main>
${jsonBackupScript(entries, report, repaired)}
</body>
</html>`;
  }

  function buildMarkdown() {
    const entries = getSortedEntries();
    const title = document.title || "ChatGPT conversation";
    const sourceUrl = location.href;
    const savedAt = new Date().toISOString();

    let out = `# ${title}\n\n`;
    out += `Saved at: ${savedAt}\n\n`;
    out += `Source: ${sourceUrl}\n\n`;
    out += `Captured turns: ${entries.length}\n\n`;

    entries.forEach((entry, i) => {
      out += `---\n\n`;
      out += `## ${i + 1}. ${entry.role || "unknown"}\n\n`;
      out += `${entry.markdown || entry.text || ""}\n\n`;
    });

    return out;
  }

  function buildText() {
    const entries = getSortedEntries();
    const title = document.title || "ChatGPT conversation";
    const sourceUrl = location.href;
    const savedAt = new Date().toISOString();

    let out = `${title}\n`;
    out += `Saved at: ${savedAt}\n`;
    out += `Source: ${sourceUrl}\n`;
    out += `Captured turns: ${entries.length}\n\n`;

    entries.forEach((entry, i) => {
      out += `==============================\n`;
      out += `${i + 1}. ${entry.role || "unknown"}\n`;
      out += `==============================\n\n`;
      out += `${entry.text || ""}\n\n`;
    });

    return out;
  }

  function makeCrc32Table() {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  }

  const CRC32_TABLE = makeCrc32Table();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const dosTime =
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      Math.floor(date.getSeconds() / 2);
    const dosDate =
      ((year - 1980) << 9) |
      ((date.getMonth() + 1) << 5) |
      date.getDate();
    return { dosDate, dosTime };
  }

  function u16(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255]);
  }

  function u32(n) {
    return new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, p) => sum + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function buildStoredZip(fileMap) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { dosDate, dosTime } = dosDateTime();

    for (const file of fileMap) {
      const nameBytes = encoder.encode(file.name.replace(/^\/+/, ""));
      const dataBytes = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data ?? ""));
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      const localHeader = concatBytes([
        u32(0x04034b50),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(dosTime),
        u16(dosDate),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0),
        nameBytes
      ]);

      localParts.push(localHeader, dataBytes);

      const centralHeader = concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(dosTime),
        u16(dosDate),
        u32(crc),
        u32(size),
        u32(size),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes
      ]);

      centralParts.push(centralHeader);
      offset += localHeader.length + dataBytes.length;
    }

    const centralDir = concatBytes(centralParts);
    const localData = concatBytes(localParts);
    const eocd = concatBytes([
      u32(0x06054b50),
      u16(0),
      u16(0),
      u16(fileMap.length),
      u16(fileMap.length),
      u32(centralDir.length),
      u32(localData.length),
      u16(0)
    ]);

    return concatBytes([localData, centralDir, eocd]);
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
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

  function buildHtmlForCurrentMode(repaired) {
    if (CONFIG.mode === "offline_assets_html") {
      return buildOfflineAssetsHtml(repaired);
    }

    if (CONFIG.mode === "native_like_html") {
      return buildNativeLikeHtml(repaired, false);
    }

    if (CONFIG.mode === "replace_page_then_ctrl_s") {
      return buildNativeLikeHtml(repaired, true);
    }

    return buildSelfContainedHtml(repaired);
  }

  function makeOutputFolderName() {
    return `${sanitizeFilename(document.title)}_${timestampForFilename()}`;
  }

  function finalizeCaptureWarnings(report) {
    for (const item of state.richBlockValidation.candidates.values()) {
      if (!item.confirmedShell || item.resolved) continue;
      addCaptureWarning(
        "UNRESOLVED_RICH_BLOCK",
        "A rich/writing block still looked like an incomplete shell after bounded hydration checks.",
        "Rerun the export; this rich message may not have fully hydrated.",
        {
          stableId: detectStableId(item.turn) || item.key,
          semanticNodeCount: item.info?.semanticNodeCount || 0,
          controlHintCount: item.info?.controlHintCount || 0,
          richNodeTextChars: item.info?.maxRichNodeTextChars || 0,
          confirmationRounds: CONFIG.richBlockMaxConfirmationRounds
        }
      );
    }
    if (state.redesignedAssistantValidation.incompleteEntries > 0) {
      addCaptureWarning(
        "REDESIGNED_ASSISTANT_CONTENT_INCOMPLETE",
        "One or more redesigned ChatGPT assistant turns did not expose substantive response content.",
        "Rerun the export; if this repeats, attach capture_report.json because ChatGPT may have changed the assistant-content DOM.",
        {
          assistantGroupsSeen: state.redesignedAssistantValidation.assistantGroupsSeen,
          assistantEntriesBuilt: state.redesignedAssistantValidation.assistantEntriesBuilt,
          labelOnlyCandidates: state.redesignedAssistantValidation.labelOnlyCandidates,
          incompleteEntries: state.redesignedAssistantValidation.incompleteEntries
        }
      );
    }

    if (report.possibleMissingTurnIndexes.length > 0) {
      addCaptureWarning(
        "TURN_INDEX_GAPS_DETECTED",
        "Available ChatGPT turn-index evidence contains one or more internal gaps.",
        "Rerun the export or use the slower repair pass if offered.",
        {
          count: report.possibleMissingTurnIndexes.length,
          sample: report.possibleMissingTurnIndexes.slice(0, 20)
        }
      );
    }

    if (
      report.capturedTurns > 0 &&
      (report.startsWithUserQuery === false ||
       report.exportedFirstMatchesCertifiedTop === false)
    ) {
      addCaptureWarning(
        "LEADING_ORDER_VALIDATION_FAILED",
        "The exported leading message did not match the stabilized leading conversation boundary.",
        "Rerun the export.",
        {
          startsWithUserQuery: report.startsWithUserQuery,
          exportedFirstMatchesCertifiedTop: report.exportedFirstMatchesCertifiedTop
        }
      );
    }

    if (report.capturedTurns > 0 && state.topBoundaryValidation.stabilized !== true) {
      addCaptureWarning(
        "TOP_BOUNDARY_UNRESOLVED",
        "The exporter could not fully stabilize the beginning of the conversation.",
        "Rerun the export.",
        {
          quietRoundsCompleted: state.topBoundaryValidation.quietRoundsCompleted,
          lastFailureReason: state.topBoundaryValidation.lastFailureReason
        }
      );
    }

    const knownMax = Number(state.checkpointValidation.knownMaxCapturedTurns || 0);
    if (
      state.checkpointValidation.checkpointAvailable &&
      knownMax > 0 &&
      report.capturedTurns < knownMax
    ) {
      addCaptureWarning(
        "CAPTURE_COUNT_BELOW_KNOWN_MAX",
        "This run captured fewer turns than a previous successful export of the same conversation.",
        "Rerun the export.",
        {
          capturedTurns: report.capturedTurns,
          knownMaxCapturedTurns: knownMax,
          difference: knownMax - report.capturedTurns
        }
      );
    }

    const knownTextChars = Number(
      state.checkpointValidation.knownMaxCapturedTextChars || 0
    );
    const currentTextChars = [...state.collected.values()].reduce(
      (sum, entry) => sum + Number(entry.textLength || 0),
      0
    );
    if (
      state.checkpointValidation.checkpointAvailable &&
      report.capturedTurns === knownMax &&
      checkpointTextBaselineCompatible(state.checkpointValidation.checkpointExporterVersion) &&
      knownTextChars > 0 &&
      currentTextChars + 64 < knownTextChars
    ) {
      addCaptureWarning(
        "CAPTURE_TEXT_BELOW_KNOWN_MAX",
        "This run captured the same number of turns as a previous successful export, but materially less message text.",
        "Rerun the export; a rich message may not have fully hydrated.",
        {
          capturedTextChars: currentTextChars,
          knownMaxCapturedTextChars: knownTextChars,
          difference: knownTextChars - currentTextChars
        }
      );
    }

    if (
      state.checkpointValidation.checkpointAvailable &&
      !state.checkpointValidation.supersededByEarlierCapture &&
      state.checkpointValidation.knownFirstStableId &&
      report.firstSortedEntry?.stableId !== state.checkpointValidation.knownFirstStableId &&
      !state.captureWarnings.some((warning) => warning.code === "KNOWN_TOP_NOT_REACHED")
    ) {
      addCaptureWarning(
        "KNOWN_TOP_NOT_REACHED",
        "The exported first message does not match the first message from a previous successful export.",
        "Rerun the export.",
        {
          knownFirstStableId: state.checkpointValidation.knownFirstStableId,
          exportedFirstStableId: report.firstSortedEntry?.stableId || null
        }
      );
    }
  }

  function captureWarningPayload() {
    if (!state.captureWarnings.length) return null;
    return {
      schemaVersion: 1,
      exporterVersion: "1.4.0",
      conversationKey: state.checkpointValidation.conversationKey,
      status: "warning",
      rerunRecommended: true,
      summary: "The exporter could not fully verify one or more parts of the conversation.",
      warnings: state.captureWarnings.map((warning) => ({ ...warning }))
    };
  }

  function readmeForPackage(repaired) {
    const entries = getSortedEntries();
    const report = analyzeCapture(entries);
    return `ChatGPT Archive Exporter V1.4.0 package

Title: ${document.title || "ChatGPT conversation"}
Source: ${location.href}
Saved at: ${new Date().toISOString()}
Mode: ${CONFIG.mode}
External archive CSS: ${CONFIG.mode === "offline_assets_html" ? "assets/archive.css" : "not used"}
Captured turns: ${entries.length}
Possible missing turn indexes: ${report.possibleMissingTurnIndexes.length ? report.possibleMissingTurnIndexes.join(", ") : "none detected"}
Repair pass performed: ${repaired ? "yes" : "no"}
Capture status: ${captureHealthStatus()}
Rerun recommended: ${state.captureWarnings.length ? "yes" : "no"}

Files:
- conversation.html: readable archive
- conversation.md: Markdown/plain backup
- conversation.txt: plain-text backup
- capture_report.json: compact capture/chronology/reliability diagnostics
- capture_warning.json: present only when unresolved capture uncertainty remains

Notes:
- This ZIP is used because a console script cannot reliably create a real local folder.
- Ctrl-S mode is controlled by Firefox, so the script cannot force the exact parent folder for Firefox's saved-page assets directory.
`;
  }

  function downloadOutputs(repaired) {
    const folder = makeOutputFolderName();
    const base = folder;

    if (CONFIG.packageAsZip && CONFIG.mode !== "replace_page_then_ctrl_s") {
      const files = [];

      if (CONFIG.downloadHtml) {
        files.push({
          name: `${folder}/conversation.html`,
          data: buildHtmlForCurrentMode(repaired)
        });

        if (CONFIG.mode === "offline_assets_html") {
          files.push({
            name: `${folder}/assets/archive.css`,
            data: buildArchiveCss()
          });
        }
      }

      if (CONFIG.downloadMarkdown) {
        files.push({ name: `${folder}/conversation.md`, data: buildMarkdown() });
      }

      if (CONFIG.downloadText) {
        files.push({ name: `${folder}/conversation.txt`, data: buildText() });
      }

      files.push({ name: `${folder}/README.txt`, data: readmeForPackage(repaired) });

      const compactCaptureReport = analyzeCapture(getSortedEntries());
      files.push({
        name: `${folder}/capture_report.json`,
        data: JSON.stringify({
          schemaVersion: 2,
          exporterVersion: "1.4.0",
          capturedTurns: state.collected.size,
          captureStatus: captureHealthStatus(),
          rerunRecommended: state.captureWarnings.length > 0,
          report: compactCaptureReport,
          certifiedTop: state.ordering.certifiedTop,
          topBoundaryValidation: compactCaptureReport.topBoundaryValidation,
          runtimeVisibility: runtimeVisibilityReport(),
          orderResolution: state.ordering.lastResolution,
          warnings: state.captureWarnings.map((warning) => ({ ...warning }))
        }, null, 2)
      });

      const warningPayload = captureWarningPayload();
      if (warningPayload) {
        files.push({
          name: `${folder}/capture_warning.json`,
          data: JSON.stringify(warningPayload, null, 2)
        });
      }

      const zipBytes = buildStoredZip(files);
      downloadBlob(zipBytes, `${folder}.zip`, "application/zip");
      return;
    }

    if (CONFIG.mode !== "replace_page_then_ctrl_s" && CONFIG.downloadHtml) {
      downloadBlob(buildHtmlForCurrentMode(repaired), `${base}.html`, "text/html;charset=utf-8");
    }

    if (CONFIG.downloadMarkdown) {
      downloadBlob(buildMarkdown(), `${base}.md`, "text/markdown;charset=utf-8");
    }

    if (CONFIG.downloadText) {
      downloadBlob(buildText(), `${base}.txt`, "text/plain;charset=utf-8");
    }
  }

  async function waitWithCancellation(
    ms,
    overlay,
    phase,
    { detectSchedulerStall = false } = {}
  ) {
    const chunk = 100;
    let waited = 0;
    let visibilityInterrupted = false;
    let schedulerStall = false;
    let largestSchedulerDelayMs = 0;

    while (waited < ms) {
      if (state.cancelled || state.stopAndSave) {
        return {
          visibilityInterrupted,
          schedulerStall,
          largestSchedulerDelayMs
        };
      }

      if (
        CONFIG.pauseWhenDocumentHidden &&
        document.visibilityState === "hidden"
      ) {
        await waitUntilVisible(overlay);
        visibilityInterrupted = true;

        // The old wait no longer counts as evidence after a hidden period.
        continue;
      }

      const requested = Math.min(chunk, ms - waited);
      const visibilityEpochBefore =
        state.runtimeVisibility.visibilityEpoch;
      const started = performance.now();

      await sleep(requested);

      const actual = performance.now() - started;

      if (
        state.runtimeVisibility.visibilityEpoch !== visibilityEpochBefore ||
        (
          CONFIG.pauseWhenDocumentHidden &&
          document.visibilityState === "hidden"
        )
      ) {
        if (
          CONFIG.pauseWhenDocumentHidden &&
          document.visibilityState === "hidden"
        ) {
          await waitUntilVisible(overlay);
        }

        visibilityInterrupted = true;

        // Retry this chunk after visibility is restored. Hidden/throttled time
        // is never counted toward hydration/top-boundary confidence.
        continue;
      }

      if (
        detectSchedulerStall &&
        schedulerDelayIsStalled(requested, actual)
      ) {
        schedulerStall = true;
        largestSchedulerDelayMs = Math.max(
          largestSchedulerDelayMs,
          actual
        );

        state.runtimeVisibility.schedulerStallCount += 1;
        state.runtimeVisibility.lastSchedulerStallMs = actual;

        updateExtensionStatus({
          indeterminate: true,
          phase: "Browser scheduling delay detected.",
          hint: "Discarding this top-boundary check and retrying safely."
        });

        return {
          visibilityInterrupted,
          schedulerStall,
          largestSchedulerDelayMs
        };
      }

      waited += requested;

      overlay.update({
        phase,
        pass: state.currentPass,
        count: state.collected.size
      });
    }

    return {
      visibilityInterrupted,
      schedulerStall,
      largestSchedulerDelayMs
    };
  }

  function scrollUpLikeUser(scrollEl, pixels) {
    const isDocumentScroller =
      scrollEl === document.scrollingElement ||
      scrollEl === document.documentElement ||
      scrollEl === document.body;
    const model = getScrollPositionModel(scrollEl);

    // Preserve the established legacy motion path exactly. Only the redesigned
    // reversed timeline uses logical-coordinate movement.
    if (!model.reversed) {
      try {
        const wheelEvent = new WheelEvent("wheel", {
          deltaY: -pixels,
          deltaX: 0,
          bubbles: true,
          cancelable: true,
          view: window
        });
        (isDocumentScroller ? document : scrollEl).dispatchEvent(wheelEvent);
      } catch {}

      if (isDocumentScroller) {
        window.scrollBy({ top: -pixels, left: 0, behavior: "auto" });
        const docEl = document.scrollingElement || document.documentElement;
        docEl.scrollTop = Math.max(0, docEl.scrollTop - pixels);
        window.dispatchEvent(new Event("scroll"));
        document.dispatchEvent(new Event("scroll", { bubbles: true }));
      } else {
        scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop - pixels);
        scrollEl.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
      return Number(scrollEl.scrollTop || 0);
    }

    try {
      const wheelEvent = new WheelEvent("wheel", {
        deltaY: -pixels,
        deltaX: 0,
        bubbles: true,
        cancelable: true,
        view: window
      });
      scrollEl.dispatchEvent(wheelEvent);
    } catch {}

    setScrollPosition(scrollEl, Math.max(0, getScrollPosition(scrollEl) - pixels));
    return getScrollPosition(scrollEl);
  }


  function firstMountedTurnKey() {
    const firstTurn = findConversationTurns()[0] || null;
    return firstTurn ? (makeCheapTurnKey(firstTurn)?.key || null) : null;
  }

  function resetTopBoundaryValidation(reason = null) {
    state.topBoundaryValidation.stabilized = false;
    state.topBoundaryValidation.quietRoundsCompleted = 0;
    state.topBoundaryValidation.retriggersPerformed = 0;
    state.topBoundaryValidation.lastFailureReason = reason;
    state.topBoundaryValidation.validatedAt = null;
    state.topBoundaryValidation.deepChallengePerformed = false;
    state.topBoundaryValidation.deepChallengeOlderHistoryObserved = false;
  }

  function restartTopBoundaryValidation(reason) {
    resetTopBoundaryValidation(reason);
    state.runtimeVisibility.topValidationRestarts += 1;
  }

  async function recoverAfterVisibilityResume(
    scrollEl,
    overlay,
    pass
  ) {
    restartTopBoundaryValidation("resumed-after-hidden");

    collectVisibleTurns(pass);

    const originalTop = getScrollPosition(scrollEl);
    const maxTop = getScrollMax(scrollEl);

    if (maxTop > 0) {
      const nudgePx = Math.max(
        120,
        Math.min(
          CONFIG.topBoundaryNudgeMaxPx,
          Math.round(
            Number(scrollEl.clientHeight || 0) *
            CONFIG.topBoundaryNudgeFraction
          )
        )
      );

      setScrollPosition(scrollEl, Math.min(maxTop, originalTop + nudgePx));
      await waitWithCancellation(
        CONFIG.topBoundaryRetriggerDelayMs,
        overlay,
        "Reactivating ChatGPT history loading…"
      );

      setScrollPosition(scrollEl, Math.min(originalTop, maxTop));
    }

    await waitWithCancellation(
      CONFIG.resumeHydrationGraceMs,
      overlay,
      "Waiting for ChatGPT to resume rendering…"
    );

    collectVisibleTurns(pass);

    updateExtensionStatus({
      indeterminate: false,
      phase: "Resumed.",
      hint: "History hydration re-primed; continuing upward scan."
    });
  }

  const REDESIGNED_THREAD_SELECTOR = '[data-chatgpt-conversation-selection-target]';
  const REDESIGNED_HISTORY_SPINNER_SELECTOR = ':scope > div > [role="status"]';

  function getRedesignedThreadElement() {
    const thread = getActiveConversationScope()?.thread;
    return thread instanceof HTMLElement ? thread : null;
  }

  function isRedesignedHistoryLoading() {
    const thread = getRedesignedThreadElement();
    if (!(thread instanceof HTMLElement)) return false;
    return Boolean(thread.querySelector(':scope > div > [role="status"]'));
  }

  function isSignificantRedesignedRangeGrowth(beforeRange, afterRange, clientHeight) {
    const delta = Number(afterRange || 0) - Number(beforeRange || 0);
    const threshold = Math.max(800, Math.round(Number(clientHeight || 0) * 0.75));
    return delta >= threshold;
  }

  async function guardRedesignedTopHydration(scrollEl, overlay, pass) {
    if (
      !CONFIG.enableRedesignedTopHydrationGuard ||
      state.renderer.generation !== "redesigned" ||
      !scrollEl?.matches?.('[data-app-action-timeline-scroll]')
    ) {
      return { skipped: true, olderHistoryObserved: false };
    }

    const diag = state.redesignedTopHydration;
    diag.attemptsStarted += 1;
    const started = performance.now();
    const initialCount = state.collected.size;
    const initialFirstKey = firstMountedTurnKey();
    const initialRange = getScrollMax(scrollEl);
    diag.lastInitialRangePx = Math.round(initialRange);

    let previousRange = initialRange;
    let spinnerEverSeen = false;
    let wasLoading = false;
    let quietPolls = 0;
    let lastFirstKey = initialFirstKey;

    try {
      while (performance.now() - started < CONFIG.redesignedTopHydrationMaxMs) {
        if (state.cancelled || state.stopAndSave) {
          diag.lastResult = state.cancelled ? "cancelled" : "stop-and-save";
          return { interrupted: true, olderHistoryObserved: false };
        }

        setScrollPosition(scrollEl, 0);
        collectVisibleTurns(pass);

        const currentRange = getScrollMax(scrollEl);
        const currentCount = state.collected.size;
        const currentFirstKey = firstMountedTurnKey();
        const rangeGrowth = currentRange - initialRange;

        if (currentFirstKey && lastFirstKey && currentFirstKey !== lastFirstKey) {
          diag.firstKeyChanges += 1;
        }
        lastFirstKey = currentFirstKey;

        if (currentCount > initialCount) {
          diag.captureGrowthEvents += 1;
          diag.lastFinalRangePx = Math.round(currentRange);
          diag.lastResult = "capture-growth";
          return { olderHistoryObserved: true, evidence: { captureChanged: true, capturedDelta: currentCount - initialCount, rangeGrowth } };
        }

        if (isSignificantRedesignedRangeGrowth(initialRange, currentRange, scrollEl.clientHeight)) {
          diag.rangeGrowthEvents += 1;
          diag.largestRangeGrowthPx = Math.max(diag.largestRangeGrowthPx, Math.round(rangeGrowth));
          diag.lastFinalRangePx = Math.round(currentRange);
          diag.lastResult = "range-growth";
          return { olderHistoryObserved: true, evidence: { redesignedRangeGrowth: true, rangeGrowth } };
        }

        const loading = isRedesignedHistoryLoading();
        if (loading) {
          diag.spinnerObservations += 1;
          if (!spinnerEverSeen) diag.spinnerDetectedAttempts += 1;
          spinnerEverSeen = true;
          diag.lastSpinnerSeen = true;
          quietPolls = 0;

          // Match the redesigned renderer's own loading behavior: if its range
          // is not growing, briefly move away from the sentinel and return to
          // the oldest boundary to retrigger another history request.
          if (!isSignificantRedesignedRangeGrowth(previousRange, currentRange, scrollEl.clientHeight)) {
            const nudge = Math.min(
              currentRange,
              Math.max(700, Math.round(Number(scrollEl.clientHeight || 0) * CONFIG.redesignedTopHydrationNudgeViewports))
            );
            if (nudge > 0) {
              diag.nudges += 1;
              setScrollPosition(scrollEl, nudge);
              const nudgeWait = await waitWithCancellation(
                CONFIG.redesignedTopHydrationNudgeDelayMs,
                overlay,
                "Older history is loading; retriggering the timeline…",
                { detectSchedulerStall: true }
              );
              if (nudgeWait.visibilityInterrupted || nudgeWait.schedulerStall) {
                return {
                  interrupted: true,
                  visibilityInterrupted: nudgeWait.visibilityInterrupted,
                  schedulerStall: nudgeWait.schedulerStall,
                  olderHistoryObserved: false
                };
              }
              setScrollPosition(scrollEl, 0);
            }
          }
        } else {
          if (wasLoading) {
            diag.spinnerCleared += 1;
          }
          if (spinnerEverSeen) {
            diag.lastSpinnerSeen = false;
          }
          quietPolls += 1;
          const requiredQuietPolls = spinnerEverSeen
            ? CONFIG.redesignedTopHydrationQuietPollsAfterSpinner
            : CONFIG.redesignedTopHydrationQuietPollsWithoutSpinner;
          if (quietPolls >= requiredQuietPolls) {
            diag.lastFinalRangePx = Math.round(currentRange);
            diag.lastResult = spinnerEverSeen ? "spinner-cleared-quiet" : "no-spinner-quiet";
            return { olderHistoryObserved: false, stabilizedForGenericProbe: true };
          }
        }

        wasLoading = loading;
        previousRange = currentRange;
        const pollWait = await waitWithCancellation(
          CONFIG.redesignedTopHydrationPollMs,
          overlay,
          loading
            ? "Waiting for ChatGPT to finish loading older history…"
            : "Checking whether older history is still arriving…",
          { detectSchedulerStall: true }
        );
        if (pollWait.visibilityInterrupted || pollWait.schedulerStall) {
          return {
            interrupted: true,
            visibilityInterrupted: pollWait.visibilityInterrupted,
            schedulerStall: pollWait.schedulerStall,
            olderHistoryObserved: false
          };
        }
      }

      diag.timeouts += 1;
      const stillLoading = isRedesignedHistoryLoading();
      if (stillLoading) diag.pendingAtTimeout += 1;
      diag.lastFinalRangePx = Math.round(getScrollMax(scrollEl));
      diag.lastSpinnerSeen = stillLoading;
      diag.lastResult = stillLoading ? "timeout-loading" : "timeout-quiet";
      return {
        olderHistoryObserved: false,
        hydrationPending: stillLoading,
        stabilizedForGenericProbe: !stillLoading
      };
    } finally {
      const elapsed = performance.now() - started;
      diag.waitMs += elapsed;
      diag.attemptsCompleted += 1;
    }
  }

  function topBoundaryEvidenceSnapshot(scrollEl) {
    return {
      firstKey: firstMountedTurnKey(),
      scrollHeight: Number(scrollEl.scrollHeight || 0),
      scrollTop: getScrollPosition(scrollEl),
      capturedCount: state.collected.size
    };
  }

  function nextNoAggregateProgressPasses(previousStreak, previousCount, currentCount) {
    return currentCount > previousCount ? 0 : previousStreak + 1;
  }

  function shouldUseAdaptiveSlowWait(
    noAggregateProgressPasses,
    threshold = CONFIG.adaptiveSlowAfterNoProgressPasses,
    interval = CONFIG.adaptiveSlowEveryNoProgressPasses
  ) {
    if (noAggregateProgressPasses < threshold) return false;
    const safeInterval = Math.max(1, Number(interval || 1));
    return (noAggregateProgressPasses - threshold) % safeInterval === 0;
  }

  function sameKeySequence(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function recordTopBoundarySignal(stage, evidence, extra = {}) {
    if (!evidence) return;
    if (evidence.geometryChanged && !evidence.captureChanged) {
      state.topValidationDiagnostics.geometryOnlySignals += 1;
    }
    if (evidence.firstDomChanged && !evidence.captureChanged) {
      state.topValidationDiagnostics.firstKeyOnlySignals += 1;
    }
    if (!evidence.weakEvidenceOnly) return;

    const sample = {
      stage,
      pass: Number(extra.pass ?? state.currentPass ?? 0),
      round: Number.isFinite(extra.round) ? extra.round : null,
      cycle: Number.isFinite(extra.cycle) ? extra.cycle : null,
      firstDomChanged: Boolean(evidence.firstDomChanged),
      geometryChanged: Boolean(evidence.geometryChanged),
      capturedDelta: Number(evidence.capturedDelta || 0),
      scrollHeightDelta: Number(evidence.scrollHeightDelta || 0),
      scrollTopAfter: Number(evidence.scrollTopAfter || 0)
    };
    state.topValidationDiagnostics.recentSignals.push(sample);
    if (state.topValidationDiagnostics.recentSignals.length > 12) {
      state.topValidationDiagnostics.recentSignals.shift();
    }
  }

  function hasOlderHistoryEvidence(before, after) {
    const firstDomChanged =
      Boolean(before.firstKey || after.firstKey) &&
      before.firstKey !== after.firstKey;

    const scrollHeightDelta = after.scrollHeight - before.scrollHeight;
    const geometryChanged =
      Math.abs(scrollHeightDelta) >= 20 ||
      after.scrollTop > 8;

    const capturedDelta = after.capturedCount - before.capturedCount;
    const captureChanged = capturedDelta > 0;
    const weakEvidenceOnly =
      !captureChanged && (firstDomChanged || geometryChanged);

    // A real newly hydrated older turn must increase the aggregate captured set.
    // ChatGPT virtualization may change scrollHeight, residual scrollTop, or the
    // first mounted known turn without exposing any new message. Those geometry
    // signals remain diagnostic but cannot independently restart top validation.
    return {
      olderHistoryObserved: captureChanged,
      firstDomChanged,
      geometryChanged,
      captureChanged,
      weakEvidenceOnly,
      capturedDelta,
      scrollHeightDelta,
      scrollTopAfter: after.scrollTop
    };
  }

  async function retriggerTopBoundary(scrollEl, overlay, pass) {
    state.topValidationDiagnostics.retriggerAttempts += 1;
    const maxTop = getScrollMax(scrollEl);

    if (maxTop <= 0) return { changed: false };

    const nudgePx = Math.max(
      120,
      Math.min(
        CONFIG.topBoundaryNudgeMaxPx,
        Math.round(
          Number(scrollEl.clientHeight || 0) * CONFIG.topBoundaryNudgeFraction
        )
      )
    );

    const before = topBoundaryEvidenceSnapshot(scrollEl);

    setScrollPosition(scrollEl, Math.min(nudgePx, maxTop));
    const waitDown = await waitWithCancellation(
      CONFIG.topBoundaryRetriggerDelayMs,
      overlay,
      "Rechecking top boundary…",
      { detectSchedulerStall: true }
    );

    if (waitDown.visibilityInterrupted || waitDown.schedulerStall) {
      return {
        changed: false,
        visibilityInterrupted: waitDown.visibilityInterrupted,
        schedulerStall: waitDown.schedulerStall
      };
    }

    collectVisibleTurns(pass);

    setScrollPosition(scrollEl, 0);
    const waitUp = await waitWithCancellation(
      CONFIG.topBoundaryRetriggerDelayMs,
      overlay,
      "Returning to top boundary…",
      { detectSchedulerStall: true }
    );

    if (waitUp.visibilityInterrupted || waitUp.schedulerStall) {
      return {
        changed: false,
        visibilityInterrupted: waitUp.visibilityInterrupted,
        schedulerStall: waitUp.schedulerStall
      };
    }

    collectVisibleTurns(pass);

    state.topBoundaryValidation.retriggersPerformed += 1;

    const after = topBoundaryEvidenceSnapshot(scrollEl);
    const evidence = hasOlderHistoryEvidence(before, after);
    recordTopBoundarySignal("retrigger", evidence, { pass });
    return { changed: evidence.olderHistoryObserved, evidence };
  }

  async function deepTopBoundaryChallenge(scrollEl, overlay, pass) {
    state.topValidationDiagnostics.deepChallenges += 1;
    if (!CONFIG.enableDeepTopChallenge) {
      return { changed: false, skipped: true };
    }

    state.topBoundaryValidation.deepChallengePerformed = true;
    const before = topBoundaryEvidenceSnapshot(scrollEl);
    const maxTop = getScrollMax(scrollEl);

    if (maxTop <= 0) return { changed: false };

    const deepPx = Math.min(
      maxTop,
      Math.max(
        700,
        Math.round(Number(scrollEl.clientHeight || 0) * CONFIG.deepTopChallengeViewports)
      )
    );

    setScrollPosition(scrollEl, deepPx);
    const downWait = await waitWithCancellation(
      CONFIG.deepTopChallengeDownDelayMs,
      overlay,
      "Deep top challenge: reactivating history loading…",
      { detectSchedulerStall: true }
    );

    if (downWait.visibilityInterrupted || downWait.schedulerStall) {
      return {
        changed: false,
        visibilityInterrupted: downWait.visibilityInterrupted,
        schedulerStall: downWait.schedulerStall
      };
    }

    collectVisibleTurns(pass);

    setScrollPosition(scrollEl, 0);
    const upWait = await waitWithCancellation(
      CONFIG.deepTopChallengeReturnDelayMs,
      overlay,
      "Deep top challenge: waiting for older history…",
      { detectSchedulerStall: true }
    );

    if (upWait.visibilityInterrupted || upWait.schedulerStall) {
      return {
        changed: false,
        visibilityInterrupted: upWait.visibilityInterrupted,
        schedulerStall: upWait.schedulerStall
      };
    }

    collectVisibleTurns(pass);
    const after = topBoundaryEvidenceSnapshot(scrollEl);
    const evidence = hasOlderHistoryEvidence(before, after);
    recordTopBoundarySignal("deep-challenge", evidence, { pass });
    state.topBoundaryValidation.deepChallengeOlderHistoryObserved =
      Boolean(evidence.olderHistoryObserved);
    return { changed: evidence.olderHistoryObserved, evidence };
  }

  function checkpointBoundaryMatchesCurrentTop() {
    const known = state.checkpointValidation.knownFirstStableId;
    if (!state.checkpointValidation.checkpointAvailable || !known) {
      state.checkpointValidation.reachedKnownFirstStableId = null;
      return true;
    }

    const current = firstMountedConversationIdentity();
    const matched = Boolean(current?.stableId && current.stableId === known);

    // A checkpoint can itself have been created from an older premature run.
    // We only supersede it when the current capture contains that previously
    // known first message *and* also has another message before it. This is
    // stronger than comparing counts, because the conversation may have grown.
    if (
      !matched &&
      current?.stableId &&
      state.collected.has(known)
    ) {
      state.checkpointValidation.supersededByEarlierCapture = true;
      state.checkpointValidation.reachedKnownFirstStableId = true;
      return true;
    }

    state.checkpointValidation.reachedKnownFirstStableId = matched;
    return matched;
  }

  async function retryKnownBoundary(scrollEl, overlay, pass) {
    if (checkpointBoundaryMatchesCurrentTop()) {
      return { matched: true, olderHistoryObserved: false };
    }

    for (let attempt = 1; attempt <= CONFIG.knownBoundaryMaxRetries; attempt++) {
      state.checkpointValidation.retryAttempts += 1;
      updateExtensionStatus({
        indeterminate: true,
        phase: `Known-boundary retry ${attempt}/${CONFIG.knownBoundaryMaxRetries}…`,
        hint: "A previous successful export reached an older first message; retrying history hydration."
      });

      const challenge = await deepTopBoundaryChallenge(scrollEl, overlay, pass);
      if (challenge.visibilityInterrupted || challenge.schedulerStall) {
        return { matched: false, interrupted: true, ...challenge };
      }
      if (challenge.changed) {
        return { matched: false, olderHistoryObserved: true, evidence: challenge.evidence };
      }
      if (checkpointBoundaryMatchesCurrentTop()) {
        return { matched: true, olderHistoryObserved: false };
      }

      const retryWait = await waitWithCancellation(
        CONFIG.knownBoundaryRetryDelayMs,
        overlay,
        "Waiting for known conversation boundary…",
        { detectSchedulerStall: true }
      );
      if (retryWait.visibilityInterrupted || retryWait.schedulerStall) {
        return { matched: false, interrupted: true, ...retryWait };
      }
      collectVisibleTurns(pass);
      if (checkpointBoundaryMatchesCurrentTop()) {
        return { matched: true, olderHistoryObserved: false };
      }
    }

    addCaptureWarning(
      "KNOWN_TOP_NOT_REACHED",
      "A previous successful export reached an older first message, but this run could not reach it.",
      "Rerun the export and keep the ChatGPT tab available until completion.",
      {
        knownFirstStableId: state.checkpointValidation.knownFirstStableId,
        observedFirstStableId: firstMountedConversationIdentity()?.stableId || null,
        retries: state.checkpointValidation.retryAttempts
      }
    );
    return { matched: false, olderHistoryObserved: false };
  }

  async function handleSuspiciousGap(scrollEl, overlay, pass, beforeTop, step, beforeKeys, afterKeys) {
    if (CONFIG.gapGuardMode === "off") return { handled: false, recovered: false };
    if (beforeKeys.length < 2 || afterKeys.length < 2) return { handled: false, recovered: false };

    state.gapGuard.transitionsChecked += 1;
    if (overlapCount(beforeKeys, afterKeys) > 0) {
      return { handled: false, recovered: false };
    }

    state.gapGuard.zeroOverlapSuspicions += 1;

    const confirmWait = await waitWithCancellation(
      CONFIG.gapGuardConfirmDelayMs,
      overlay,
      "Checking a possible virtualized gap…"
    );
    if (confirmWait.visibilityInterrupted) {
      return { handled: true, recovered: false, visibilityInterrupted: true };
    }

    collectVisibleTurns(pass);
    const confirmedKeys = [...state.lastMountedKeys];
    if (overlapCount(beforeKeys, confirmedKeys) > 0) {
      state.gapGuard.transientSuspicions += 1;
      return { handled: true, recovered: true, transient: true };
    }

    if (CONFIG.gapGuardMode === "warn") {
      state.gapGuard.unresolvedGaps += 1;
      addCaptureWarning(
        "UNRESOLVED_SCROLL_GAP",
        "A possible gap between adjacent virtualized conversation regions could not be verified.",
        "Rerun the export.",
        { pass, recoveryAttempts: 0 }
      );
      return { handled: true, recovered: false };
    }

    state.gapGuard.recoveryAttempts += 1;
    const started = performance.now();

    setScrollPosition(
      scrollEl,
      Math.min(getScrollMax(scrollEl), Math.max(0, Number(beforeTop || 0)))
    );
    const recoveryBackWait = await waitWithCancellation(
      CONFIG.gapGuardRecoveryDelayMs,
      overlay,
      "Repairing possible virtualized gap…"
    );
    if (recoveryBackWait.visibilityInterrupted) {
      return { handled: true, recovered: false, visibilityInterrupted: true };
    }
    collectVisibleTurns(pass);

    const smallerStep = Math.max(
      120,
      Math.floor(step * CONFIG.gapGuardRecoveryScrollFactor)
    );
    scrollUpLikeUser(scrollEl, smallerStep);
    const recoveryUpWait = await waitWithCancellation(
      CONFIG.gapGuardRecoveryDelayMs,
      overlay,
      "Rechecking repaired gap…"
    );
    if (recoveryUpWait.visibilityInterrupted) {
      return { handled: true, recovered: false, visibilityInterrupted: true };
    }
    collectVisibleTurns(pass);

    const recoveryKeys = [...state.lastMountedKeys];
    const recovered = overlapCount(beforeKeys, recoveryKeys) > 0;
    const elapsed = performance.now() - started;
    state.gapGuard.recoveryMs += elapsed;
    state.timing.gapRecoveryMs += elapsed;

    if (recovered) {
      state.gapGuard.recoveredGaps += 1;
      state.hadCaptureRepair = true;
      return { handled: true, recovered: true };
    }

    state.gapGuard.unresolvedGaps += 1;
    addCaptureWarning(
      "UNRESOLVED_SCROLL_GAP",
      "A possible gap between adjacent virtualized conversation regions could not be repaired.",
      "Rerun the export.",
      { pass, recoveryAttempts: 1 }
    );
    return { handled: true, recovered: false };
  }

  async function probeApparentTop(scrollEl, overlay, pass, step) {
    const validationStartedPerf = performance.now();
    if (state.collected.size === 0) {
      state.topValidationDiagnostics.invalidations.zeroTurns += 1;
      resetTopBoundaryValidation("no-conversation-turns-detected");
      return {
        olderHistoryObserved: false,
        stabilized: false,
        zeroTurns: true,
        interrupted: true
      };
    }
    if (state.renderer.generation === "redesigned") {
      const hydrationGuard = await guardRedesignedTopHydration(scrollEl, overlay, pass);
      if (hydrationGuard.visibilityInterrupted || hydrationGuard.schedulerStall) {
        restartTopBoundaryValidation(
          hydrationGuard.visibilityInterrupted ? "resumed-after-hidden" : "scheduler-stall"
        );
        return hydrationGuard;
      }
      if (hydrationGuard.olderHistoryObserved) {
        resetTopBoundaryValidation("older-history-observed-during-redesigned-hydration");
        return hydrationGuard;
      }
      if (hydrationGuard.hydrationPending) {
        resetTopBoundaryValidation("redesigned-history-still-loading");
        return hydrationGuard;
      }
    }

    state.topValidationDiagnostics.attemptsStarted += 1;
    resetTopBoundaryValidation();

    try {
      updateExtensionStatus({
        indeterminate: true,
        phase: "Apparent top reached.",
        hint: "Verifying the boundary across several independent quiet rounds…"
      });

      for (let round = 1; round <= CONFIG.topBoundaryProbeRounds; round++) {
        state.topValidationDiagnostics.maxRoundReached = Math.max(
          state.topValidationDiagnostics.maxRoundReached,
          round
        );

        overlay.update({
          phase: `Top validation round ${round}/${CONFIG.topBoundaryProbeRounds}…`,
          pass,
          count: state.collected.size,
          hint: "Waiting to see whether ChatGPT prepends older history."
        });

        let previous = topBoundaryEvidenceSnapshot(scrollEl);

        for (
          let cycle = 1;
          cycle <= CONFIG.topBoundaryProbeCyclesPerRound;
          cycle++
        ) {
          state.topValidationDiagnostics.totalCycles += 1;

          if (state.cancelled || state.stopAndSave) {
            state.topValidationDiagnostics.invalidations.stopOrCancel += 1;
            resetTopBoundaryValidation(
              state.cancelled ? "cancelled" : "stop-and-save"
            );
            return { olderHistoryObserved: false, interrupted: true };
          }

          scrollUpLikeUser(scrollEl, step);
          const probeWait = await waitWithCancellation(
            CONFIG.topBoundaryProbeDelayMs,
            overlay,
            `Top validation ${round}/${CONFIG.topBoundaryProbeRounds}…`,
            { detectSchedulerStall: true }
          );

          if (probeWait.visibilityInterrupted) {
            state.topValidationDiagnostics.invalidations.visibility += 1;
            restartTopBoundaryValidation("resumed-after-hidden");
            return {
              olderHistoryObserved: false,
              visibilityInterrupted: true,
              round,
              cycle
            };
          }

          if (probeWait.schedulerStall) {
            state.topValidationDiagnostics.invalidations.scheduler += 1;
            restartTopBoundaryValidation("scheduler-stall");
            return {
              olderHistoryObserved: false,
              schedulerStall: true,
              round,
              cycle,
              largestSchedulerDelayMs:
                probeWait.largestSchedulerDelayMs
            };
          }

          collectVisibleTurns(pass);

          const current = topBoundaryEvidenceSnapshot(scrollEl);
          const evidence = hasOlderHistoryEvidence(previous, current);
          recordTopBoundarySignal("probe", evidence, { pass, round, cycle });
          if (evidence.olderHistoryObserved) {
            state.topValidationDiagnostics.invalidations.captureGrowth += 1;
            resetTopBoundaryValidation("older-history-observed");
            return { olderHistoryObserved: true, round, cycle, evidence };
          }
          previous = current;
        }

        state.topBoundaryValidation.quietRoundsCompleted = round;

        if (round < CONFIG.topBoundaryProbeRounds) {
          updateExtensionStatus({
            indeterminate: true,
            phase: `Top validation ${round}/${CONFIG.topBoundaryProbeRounds} quiet.`,
            hint: "Retriggering the top sentinel before the next round…"
          });
          const retrigger = await retriggerTopBoundary(scrollEl, overlay, pass);

          if (retrigger.visibilityInterrupted) {
            state.topValidationDiagnostics.invalidations.visibility += 1;
            restartTopBoundaryValidation("resumed-after-hidden");
            return {
              olderHistoryObserved: false,
              visibilityInterrupted: true,
              round,
              retrigger: true
            };
          }

          if (retrigger.schedulerStall) {
            state.topValidationDiagnostics.invalidations.scheduler += 1;
            restartTopBoundaryValidation("scheduler-stall");
            return {
              olderHistoryObserved: false,
              schedulerStall: true,
              round,
              retrigger: true
            };
          }

          if (retrigger.changed) {
            state.topValidationDiagnostics.invalidations.captureGrowth += 1;
            resetTopBoundaryValidation("older-history-observed-after-retrigger");
            return {
              olderHistoryObserved: true,
              round,
              retrigger: true,
              evidence: retrigger.evidence
            };
          }
        }
      }

      const deepChallenge = await deepTopBoundaryChallenge(scrollEl, overlay, pass);
      if (deepChallenge.visibilityInterrupted) {
        state.topValidationDiagnostics.invalidations.visibility += 1;
        restartTopBoundaryValidation("resumed-after-hidden");
        return { olderHistoryObserved: false, visibilityInterrupted: true, deepChallenge: true };
      }
      if (deepChallenge.schedulerStall) {
        state.topValidationDiagnostics.invalidations.scheduler += 1;
        restartTopBoundaryValidation("scheduler-stall");
        return { olderHistoryObserved: false, schedulerStall: true, deepChallenge: true };
      }
      if (deepChallenge.changed) {
        state.topValidationDiagnostics.invalidations.captureGrowth += 1;
        resetTopBoundaryValidation("older-history-observed-after-deep-challenge");
        return {
          olderHistoryObserved: true,
          deepChallenge: true,
          evidence: deepChallenge.evidence
        };
      }

      state.topBoundaryValidation.stabilized = true;
      state.topBoundaryValidation.lastFailureReason = null;
      state.topBoundaryValidation.validatedAt = new Date().toISOString();
      state.topValidationDiagnostics.successfulAttempts += 1;

      return {
        olderHistoryObserved: false,
        stabilized: true,
        quietRoundsCompleted: state.topBoundaryValidation.quietRoundsCompleted
      };
    } finally {
      const elapsed = performance.now() - validationStartedPerf;
      state.timing.topValidationMs += elapsed;
      state.topValidationDiagnostics.totalValidationMs += elapsed;
      state.topValidationDiagnostics.attemptsCompleted += 1;
    }
  }

  async function fastScanUpward(scrollEl, overlay) {
    let lastCount = state.collected.size;
    let topStablePasses = 0;
    let noNewTurnsPasses = 0;

    for (let pass = 1; pass <= CONFIG.maxPasses; pass++) {
      if (state.cancelled || state.stopAndSave) break;

      state.currentPass = pass;

      const aggregateCountBaseline = lastCount;
      const normalTurnsBeforePass = state.scanDiagnostics.newTurnsFromNormalScan;
      const mutationTurnsBeforePass = state.scanDiagnostics.newTurnsFromMutationObserver;

      collectVisibleTurns(pass);
      await validateRichBlockCandidates(overlay);
      const beforeMountedKeys = [...state.lastMountedKeys];

      // MutationObserver/rich-confirmation capture is real progress even if the
      // synchronous polling call itself added nothing. Do not carry an adaptive
      // stall streak into the next wait after aggregate history has grown.
      if (state.collected.size > aggregateCountBaseline) {
        if (state.scanPacing.adaptiveSlowActive) {
          state.scanPacing.slowModeExits += 1;
          state.scanPacing.adaptiveSlowActive = false;
        }
        noNewTurnsPasses = 0;
      }

      const currentTopForProgress = getScrollPosition(scrollEl);
      const geometryFraction = 1 - (
        currentTopForProgress / Math.max(1, Number(state.scanInitialTop || 1))
      );
      const scanProgress = Math.min(
        88,
        Math.max(
          state.progressHighWater || 0,
          Math.round(Math.max(0, Math.min(1, geometryFraction)) * 88)
        )
      );

      updateExtensionStatus({
        progress: scanProgress,
        indeterminate: noNewTurnsPasses >= 5 && currentTopForProgress > 8
      });

      overlay.update({
        phase: `Scanning conversation… captured ${state.collected.size} turns`,
        pass,
        count: state.collected.size,
        hint: noNewTurnsPasses >= 5 && currentTopForProgress > 8
          ? "Waiting for ChatGPT to render older messages…"
          : `Approx. ${scanProgress}% complete.`
      });

      const beforeTop = getScrollPosition(scrollEl);
      const step = Math.max(
        250,
        Math.floor(scrollEl.clientHeight * CONFIG.scrollFactor)
      );

      state.scrollDiagnostics.mainScanCommands += 1;
      scrollUpLikeUser(scrollEl, step);

      const periodicSlowWait = pass % CONFIG.slowEveryNPasses === 0;
      const adaptiveSlowWait = shouldUseAdaptiveSlowWait(noNewTurnsPasses);

      let delay = CONFIG.fastDelayMs;
      let waitPhase = "Fast capture pass...";
      if (adaptiveSlowWait) {
        delay = CONFIG.slowDelayMs;
        waitPhase = "Adaptive hydration checkpoint...";
        state.scanPacing.adaptiveSlowWaitPasses += 1;
        state.scanPacing.adaptiveSlowWaitRequestedMs += delay;
      } else if (periodicSlowWait) {
        delay = CONFIG.slowDelayMs;
        waitPhase = "Brief periodic hydration checkpoint...";
        state.scanPacing.periodicSlowWaitPasses += 1;
        state.scanPacing.periodicSlowWaitRequestedMs += delay;
      } else {
        state.scanPacing.fastWaitPasses += 1;
        state.scanPacing.fastWaitRequestedMs += delay;
      }

      const scanWaitStartedPerf = performance.now();
      const scanWait = await waitWithCancellation(
        delay,
        overlay,
        waitPhase
      );
      const scanWaitActualMs = performance.now() - scanWaitStartedPerf;
      if (adaptiveSlowWait) {
        state.scanPacing.adaptiveSlowWaitActualMs += scanWaitActualMs;
      } else if (periodicSlowWait) {
        state.scanPacing.periodicSlowWaitActualMs += scanWaitActualMs;
      } else {
        state.scanPacing.fastWaitActualMs += scanWaitActualMs;
      }

      if (scanWait.visibilityInterrupted) {
        await recoverAfterVisibilityResume(
          scrollEl,
          overlay,
          pass
        );

        topStablePasses = 0;
        noNewTurnsPasses = 0;
        lastCount = state.collected.size;
        continue;
      }

      collectVisibleTurns(pass);
      const afterMountedKeys = [...state.lastMountedKeys];
      const gapResult = await handleSuspiciousGap(
        scrollEl,
        overlay,
        pass,
        beforeTop,
        step,
        beforeMountedKeys,
        afterMountedKeys
      );

      if (gapResult.visibilityInterrupted) {
        await recoverAfterVisibilityResume(scrollEl, overlay, pass);
        topStablePasses = 0;
        noNewTurnsPasses = 0;
        lastCount = state.collected.size;
        continue;
      }

      const currentCount = state.collected.size;
      const aggregateGrowth = Math.max(0, currentCount - aggregateCountBaseline);
      const normalAddedThisPass = Math.max(
        0,
        state.scanDiagnostics.newTurnsFromNormalScan - normalTurnsBeforePass
      );
      const mutationAddedThisPass = Math.max(
        0,
        state.scanDiagnostics.newTurnsFromMutationObserver - mutationTurnsBeforePass
      );

      const afterTop = getScrollPosition(scrollEl);
      const absScrollDelta = Math.abs(afterTop - Number(beforeTop || 0));
      state.scrollDiagnostics.totalAbsScrollDeltaPx += absScrollDelta;
      if (absScrollDelta < 3) state.scrollDiagnostics.nearZeroMovementPasses += 1;
      else state.scrollDiagnostics.movedPasses += 1;
      if (sameKeySequence(beforeMountedKeys, afterMountedKeys)) {
        state.scrollDiagnostics.sameMountedSetPasses += 1;
      } else {
        state.scrollDiagnostics.mountedSetChangedPasses += 1;
      }

      if (normalAddedThisPass > 0) {
        state.scanPacing.normalScannerProgressPasses += 1;
        state.scanPacing.currentNoNormalScannerProgressStreak = 0;
      } else {
        state.scanPacing.currentNoNormalScannerProgressStreak += 1;
        state.scanPacing.maxNoNormalScannerProgressStreak = Math.max(
          state.scanPacing.maxNoNormalScannerProgressStreak,
          state.scanPacing.currentNoNormalScannerProgressStreak
        );
      }

      if (aggregateGrowth > 0) {
        state.scanPacing.aggregateProgressPasses += 1;
        if (normalAddedThisPass === 0 && mutationAddedThisPass > 0) {
          state.scanPacing.mutationOnlyProgressPasses += 1;
        }
        if (state.scanPacing.adaptiveSlowActive) {
          state.scanPacing.turnGrowthWhileAdaptiveSlow += aggregateGrowth;
        }
      }

      noNewTurnsPasses = nextNoAggregateProgressPasses(
        noNewTurnsPasses,
        aggregateCountBaseline,
        currentCount
      );
      state.scanPacing.currentNoAggregateProgressStreak = noNewTurnsPasses;
      state.scanPacing.maxNoAggregateProgressStreak = Math.max(
        state.scanPacing.maxNoAggregateProgressStreak,
        noNewTurnsPasses
      );

      const adaptiveSlowActiveNow =
        noNewTurnsPasses >= CONFIG.adaptiveSlowAfterNoProgressPasses;
      if (!state.scanPacing.adaptiveSlowActive && adaptiveSlowActiveNow) {
        state.scanPacing.slowModeEntries += 1;
      } else if (state.scanPacing.adaptiveSlowActive && !adaptiveSlowActiveNow) {
        state.scanPacing.slowModeExits += 1;
      }
      state.scanPacing.adaptiveSlowActive = adaptiveSlowActiveNow;

      const nearTop = afterTop <= 5;
      const noNewTurns = currentCount === aggregateCountBaseline;
      const didNotMove = absScrollDelta < 3;

      if (nearTop && (noNewTurns || didNotMove)) {
        topStablePasses++;
      } else {
        topStablePasses = 0;
      }

      lastCount = currentCount;

      if (topStablePasses >= CONFIG.topStablePassesToStop) {
        if (CONFIG.enableTopBoundaryProbe) {
          const probe = await probeApparentTop(
            scrollEl,
            overlay,
            pass,
            step
          );

          if (probe.visibilityInterrupted) {
            await recoverAfterVisibilityResume(
              scrollEl,
              overlay,
              pass
            );

            topStablePasses = 0;
            noNewTurnsPasses = 0;
            lastCount = state.collected.size;
            continue;
          }

          if (probe.schedulerStall) {
            topStablePasses = 0;
            noNewTurnsPasses = 0;
            lastCount = state.collected.size;

            updateExtensionStatus({
              indeterminate: true,
              phase: "Browser scheduling delay detected.",
              hint: "Top validation was discarded and will be retried."
            });

            continue;
          }

          if (probe.hydrationPending) {
            topStablePasses = 0;
            noNewTurnsPasses = 0;
            lastCount = state.collected.size;

            updateExtensionStatus({
              indeterminate: true,
              phase: "Older history is still loading.",
              hint: "Top certification postponed until the redesigned timeline finishes hydrating."
            });

            continue;
          }

          if (probe.olderHistoryObserved) {
            // scrollTop=0 was only the top of the currently hydrated batch.
            topStablePasses = 0;
            noNewTurnsPasses = 0;
            lastCount = state.collected.size;

            updateExtensionStatus({
              indeterminate: false,
              phase: "Older history appeared.",
              hint: "Top validation reset; continuing upward through the newly hydrated batch…"
            });

            continue;
          }
        }

        const checkpointResult = await retryKnownBoundary(scrollEl, overlay, pass);
        if (checkpointResult.interrupted) {
          topStablePasses = 0;
          noNewTurnsPasses = 0;
          lastCount = state.collected.size;
          continue;
        }
        if (checkpointResult.olderHistoryObserved) {
          resetTopBoundaryValidation("older-history-observed-during-known-boundary-retry");
          topStablePasses = 0;
          noNewTurnsPasses = 0;
          lastCount = state.collected.size;
          continue;
        }

        const certifiedTop = certifyCurrentTopBoundary();

        updateExtensionStatus({
          progress: 90,
          indeterminate: false,
          phase: "Top boundary stabilized.",
          hint: certifiedTop?.role === "user"
            ? "Leading user query detected; validating archive order…"
            : "Top is stable; validating the leading conversation boundary…"
        });

        log("Fast scan stopped: multi-round top boundary stabilized", certifiedTop);
        break;
      }
    }
  }

  async function repairSweep(scrollEl, overlay) {
    overlay.update({
      phase: "Repair pass: slower downward sweep...",
      pass: state.currentPass,
      count: state.collected.size,
      hint: "Running only because gaps were detected."
    });

    for (let i = 0; i < CONFIG.repairMaxPasses; i++) {
      if (state.cancelled || state.stopAndSave) break;

      const before = getScrollPosition(scrollEl);
      state.currentPass += 1;

      collectVisibleTurns(state.currentPass);

      const step = Math.max(
        350,
        Math.floor(scrollEl.clientHeight * CONFIG.repairScrollFactor)
      );

      setScrollPosition(scrollEl, Math.min(getScrollMax(scrollEl), getScrollPosition(scrollEl) + step));

      await waitWithCancellation(
        CONFIG.repairDelayMs,
        overlay,
        "Repair pass: slower downward sweep..."
      );

      collectVisibleTurns(state.currentPass);

      if (Math.abs(getScrollPosition(scrollEl) - before) < 3) {
        break;
      }
    }
  }

  function replacePageThenCtrlS(repaired) {
    const html = buildHtmlForCurrentMode(repaired);

    // Download MD/TXT backups before replacing the page.
    const originalDownloadHtml = CONFIG.downloadHtml;
    CONFIG.downloadHtml = false;
    downloadOutputs(repaired);
    CONFIG.downloadHtml = originalDownloadHtml;

    document.open();
    document.write(html);
    document.close();

    setTimeout(() => {
      alert("Static full conversation is now loaded in this tab. Press Ctrl-S to save it with Firefox. Firefox controls the saved page location and companion assets in this mode.");
    }, 250);
  }


  try {
    const overlay = makeOverlay();
    let scrollEl = findMainScrollElement();
    const originalScrollTop = getScrollPosition(scrollEl);

    await loadConversationCheckpoint();
    startHydrationObserver(scrollEl);

    log("scroll element", scrollEl);

    overlay.update({
      phase: "Moving to bottom of chat...",
      pass: 0,
      count: 0,
      hint: "Starting from newest messages."
    });

    setScrollPosition(scrollEl, getScrollMax(scrollEl));
    const initialWait = await waitWithCancellation(
      CONFIG.slowDelayMs,
      overlay,
      "Waiting for bottom render..."
    );

    if (initialWait.visibilityInterrupted) {
      await recoverAfterVisibilityResume(
        scrollEl,
        overlay,
        0
      );
    }

    state.scanInitialTop = Math.max(
      1,
      getScrollPosition(scrollEl),
      getScrollMax(scrollEl)
    );
    updateExtensionStatus({
      progress: 2,
      indeterminate: false,
      phase: "Scanning from the newest message upward…",
      hint: "Progress is estimated from physical scroll distance."
    });

    collectVisibleTurns(0);
    updateConversationDetectionDiagnostics(scrollEl);

    if (state.collected.size === 0) {
      const zeroTurnResult = await recoverZeroTurnDetection(scrollEl, overlay);
      scrollEl = zeroTurnResult.scrollEl || scrollEl;
    }

    if (state.collected.size > 0) {
      await fastScanUpward(scrollEl, overlay);
    } else {
      overlay.update({
        phase: "No conversation turns detected.",
        pass: state.currentPass,
        count: 0,
        hint: "Saving diagnostics instead of certifying an empty conversation."
      });
    }

    let repaired = false;

    if (!state.cancelled && !state.stopAndSave && CONFIG.askRepairOnGaps) {
      const report = analyzeCapture(getSortedEntries());
      const missingCount = report.possibleMissingTurnIndexes.length;

      updateExtensionStatus({
        progress: 93,
        indeterminate: false,
        phase: "Validating capture…",
        hint: "Checking available message-index evidence."
      });

      overlay.update({
        phase: "Validating captured turn indexes...",
        pass: state.currentPass,
        count: state.collected.size,
        hint: missingCount ? `${missingCount} possible missing turn indexes detected.` : "No gaps detected."
      });

      if (missingCount > 0) {
        const sample = report.possibleMissingTurnIndexes.slice(0, 40).join(", ");
        const more = missingCount > 40 ? ` ... and ${missingCount - 40} more` : "";

        const runRepair = confirm(
          `Fast scan captured ${state.collected.size} turns, but detected ${missingCount} possible missing turn indexes:\n\n${sample}${more}\n\nRun a slower repair pass now?\n\nOK = repair pass\nCancel = save now anyway`
        );

        if (runRepair) {
          await repairSweep(scrollEl, overlay);
          repaired = true;
        }
      }
    }

    if (state.cancelled) {
      overlay.update({
        phase: "Cancelled. Nothing saved.",
        pass: state.currentPass,
        count: state.collected.size,
        hint: "Overlay will close."
      });
      updateExtensionStatus({
        running: false,
        done: true,
        phase: "Cancelled. Nothing saved.",
        hint: "Cancelled by user.",
        indeterminate: false
      });
      setTimeout(() => overlay.remove(), 1200);
      return;
    }

    updateExtensionStatus({
      progress: 96,
      indeterminate: true,
      phase: CONFIG.mode === "replace_page_then_ctrl_s"
        ? "Building static page for Ctrl-S…"
        : "Building archive package…",
      hint: "Formatting HTML/CSS and creating the output files."
    });

    overlay.update({
      phase: CONFIG.mode === "replace_page_then_ctrl_s"
        ? "Building static page for Ctrl-S..."
        : "Building and downloading archive...",
      pass: state.currentPass,
      count: state.collected.size,
      hint: "Almost done."
    });

    collectVisibleTurns(state.currentPass + 1);
    await validateRichBlockCandidates(overlay);

    // Alpha1 is observation-only: run after capture/validation so these probes
    // cannot change which turns the established adapter captures or orders.
    await runAlphaDiagnostics(scrollEl);

    if (CONFIG.mode === "replace_page_then_ctrl_s") {
      updateExtensionStatus({
        running: false,
        done: true,
        phase: "Static page built for Ctrl-S.",
        hint: "Use Firefox Ctrl-S to save HTML plus page assets.",
        progress: 100,
        indeterminate: false
      });
      overlay.remove();
      replacePageThenCtrlS(repaired);
      return;
    }

    const preDownloadEntries = getSortedEntries();
    const preDownloadReport = analyzeCapture(preDownloadEntries);
    finalizeCaptureWarnings(preDownloadReport);
    await saveConversationCheckpointIfEligible(preDownloadEntries);

    downloadOutputs(repaired);

    try {
      setScrollPosition(scrollEl, originalScrollTop);
    } catch {
      // Ignore restore errors.
    }

    const finalReport = analyzeCapture(getSortedEntries());
    const finalMissing = finalReport.possibleMissingTurnIndexes.length;
    const leadingBoundaryWarning =
      state.topBoundaryValidation.stabilized !== true ||
      finalReport.leadingMissingIndexCount > 0 ||
      finalReport.startsWithUserQuery === false ||
      finalReport.exportedFirstMatchesCertifiedTop === false;

    const captureStatus = captureHealthStatus();
    const finalPhase = captureStatus === "warning"
      ? `Saved with warning — ${state.collected.size} turns.`
      : captureStatus === "repaired"
        ? `Saved — repaired during capture (${state.collected.size} turns).`
        : `Saved ${state.collected.size} turns.`;
    const finalHint = captureStatus === "warning"
      ? "Rerun recommended. See capture_warning.json and capture_report.json inside the ZIP."
      : captureStatus === "repaired"
        ? "Capture anomalies were repaired. Details are in capture_report.json."
        : leadingBoundaryWarning
          ? "Warning: top stabilization or leading-order validation failed. Check capture_report.json."
          : finalMissing
            ? `Warning: ${finalMissing} possible internal missing turn indexes.`
            : "Boundary stabilized and archive ordering matches the observed leading conversation boundary.";

    overlay.update({
      phase: finalPhase,
      pass: state.currentPass,
      count: state.collected.size,
      hint: finalHint
    });

    updateExtensionStatus({
      running: false,
      done: true,
      phase: finalPhase,
      progress: 100,
      indeterminate: false,
      hint: finalHint,
      captureStatus,
      rerunRecommended: captureStatus === "warning"
    });

    setTimeout(() => overlay.remove(), 5000);
  } catch (err) {
    console.error("[ChatGPT Archive V1.4.0] Failed:", err);
    try {
      updateExtensionStatus({
        running: false,
        done: true,
        error: String(err && (err.stack || err.message) || err),
        phase: "Failed.",
        hint: "See DevTools Console for details."
      });
    } catch {}
    alert("ChatGPT Archive Exporter failed. See Console for details.");
  } finally {
    stopHydrationObserver();
    try {
      document.removeEventListener(
        "visibilitychange",
        onDocumentVisibilityChange
      );
    } catch {}

    window.__CHATGPT_FULL_CHAT_SAVER_V42_RUNNING__ = false;
    try {
      updateExtensionStatus({ running: false });
    } catch {}
  }
})();
