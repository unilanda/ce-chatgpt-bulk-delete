# Code Map — Where to Look First

This is a navigation guide for `adapters/chatgpt_exporter.js`. Function names are more stable than line numbers, so use search rather than relying on a specific line.

## Capture-state and diagnostics

Search for:
- `const state =`
- `contentValidation`
- `hydrationObserver`
- `richBlockValidation`
- `redesignedAssistantValidation`
- `scanDiagnostics`
- `scanPacing`
- `conversationDetection`
- `orderingValidation`

These report objects are not cosmetic. They are how a future bug is diagnosed without guessing.

## Active conversation / renderer

Search for:
- `activeConversationScopeCache`
- `activeScopeElementScore`
- `pickBestActiveElement`
- `getActiveConversationScope`
- `summarizeActiveConversationScope`
- `findMainScrollElement`

Reason: prevents stale SPA DOM from another conversation from being harvested.

## Scroll abstraction

Search for:
- `createScrollPosition`
- `getScrollPositionModel`
- `getScrollPosition`
- `setScrollPosition`
- `getScrollMax`

Reason: normalizes conventional and reversed/negative ChatGPT timelines.

## Turn discovery

Search for:
- `selectRedesignedAssistantNode`
- `findConversationTurns`
- `detectRole`
- `detectStableId`
- `getBestMessageContentNode`

Reason: maps current DOM into logical user/assistant turns.

## Snapshot/duplicate logic

Search for:
- `makeTurnCaptureSignature`
- `signatureDiffersMeaningfully`
- `signatureIsClearlyRicher`
- `recordSnapshotUpgrade`
- `collectVisibleTurns`

Reason: ChatGPT can show the same stable turn repeatedly while DOM richness changes.

## Rich-content confirmation

Search for:
- `classifyRichBlockCandidate`
- rich confirmation loop/state
- `markRichBlockResolved`

Reason: avoids prematurely saving suspiciously empty shells for writing/rich content.

## Archive clone cleanup

Search for:
- `pruneRedesignedAssistantClone`
- `cleanCloneForArchive`
- file/citation simplification helpers
- hidden accessibility layer cleanup

Reason: live ChatGPT DOM contains controls and duplicate accessibility layers that should not become visible offline.

## Code-card handling

Search for:
- `highlightCodeTextForArchive`
- `isCurrentChatGptCodeElement`
- `findCurrentCodeCardShell`
- `currentCodeCardLabel`
- `staticizeCurrentCodeCards`

Reason: current ChatGPT code blocks need static formatting and exact whitespace preservation.

## Entry construction

Search for:
- `makeEntryFromTurn`
- adjacent helper that can reuse a cheap signature before expensive clone work

Reason: this is the transition from live DOM turn to stored archive entry.

## Long-history scanning

Search for:
- `collectVisibleTurns`
- MutationObserver setup
- `guardRedesignedTopHydration`
- `handleSuspiciousGap`
- `probeApparentTop`
- `fastScanUpward`

Reason: completeness of long virtualized conversations.

## Ordering

Search for order-resolution functions around the report fields:
- `majorityEdges`
- `contradictoryPairs`
- `cycleBreaks`
- `observationSnapshots`

Reason: current renderer may not provide numeric turn indexes.

## Serialization

Search for:
- HTML document builders
- Markdown turn builders
- TXT builder
- ZIP builder
- `capture_report.json`

Reason: output formats should be changed separately from acquisition.

## Important source-header note

The historical file header may mention an older/default self-contained mode. The actual stable configuration and extension UI use the recommended `offline_assets_html` path by default. Treat the `CONFIG` object and side-panel preset behavior as authoritative, not stale prose in an old header comment.
