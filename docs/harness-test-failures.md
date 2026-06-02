# Harness Test Failures — Actionable Issue Tracker

This file is the working log of issues the simulator harness is flagging but that are not yet fixed. It is the place to update as fixes land. Each issue has a status, severity, evidence, fix location, and a checkbox.

Status values:
- `pending` — issue is open, not yet picked up
- `in-progress` — a fix is being written
- `fixed` — verified by a fresh harness run; keep the verification artifact hash for traceability
- `wontfix` — confirmed not worth fixing (e.g. simulator limitation with no upstream fix)

Severity:
- `user-visible` — a real G2 user would see the bug
- `harness` — only the harness is impacted; the app works fine
- `simulator` — third-party simulator limitation
- `fixture` — fixture data is wrong, the app is fine

Last harness run: `artifacts/simulator-flow/2026-06-02T09-16-59-134Z` (48 steps)

---

## A. App-level bugs

### A1. Long-message box rendering drops middle/start content
- **Status**: fixed
- **Severity**: user-visible
- **Fix**: Reversed `formatMessageBox` output order in `web/src/controller/model.ts:416`. The function now returns `pages.reverse()` so the message beginning appears at the newest page instead of the end.
- **Commit**: `dc0ca1a`
- [x] Fixed

### A2. Recording flow returns to messages without transcribing
- **Status**: in-progress (audio injection path added, needs verification)
- **Severity**: user-visible
- **Fix**: Added `logRecordingEvent('transcribe.end', { transcript: '', rejected: true })` in the `!hasRecordableAudio` branch. Added fixture API audio injection endpoint (`injectAudioChunks` command) with HTTP polling. Added `consumeInjectedAudioChunks()` call in `dispatch()` for sidebarRecording state.
- **Commit**: `dc0ca1a`
- [x] Fixed (transcribe.end logging)
- [ ] Fixed (audio injection verified working)

### A3. Older-page pagination race
- **Status**: pending
- **Severity**: harness

### A4. Container ID conflict — chat list sidebar invisible on hardware (CRITICAL)
- **Status**: fixed
- **Severity**: user-visible (CRITICAL — real G2 user cannot see chat list)
- **Root cause**: `buildSidebarPage` in `evenBridge.ts` used containerID 3 for both the `sidebarSeparator` (TextContainerProperty) and the native list (ListContainerProperty). The Even Hub SDK shares container IDs across types; duplicate IDs cause one container to be silently dropped by firmware.
- **Fix**: Changed native list containerID from 3 to 8 in both `sidebarListContainer` and `hiddenListContainer`.
- **Commit**: `dc0ca1a`
- [x] Fixed

---

## B. Simulator-integration issues

### B1. Glasses screenshot is empty
- **Status**: wontfix (simulator limitation, `@evenrealities/evenhub-simulator@0.7.2`)

### B2. Simulator /api/input audio_chunk returns 400
- **Status**: fixed (workaround)
- **Fix**: Audio delivered via fixture API's `/api/test/fixture` POST endpoint (`injectAudioChunks` command) with HTTP polling.
- **Commit**: `dc0ca1a`
- [x] Fixed

---

## C. Harness issues

### C1. Bridge-call expectations never match
- **Status**: fixed
- **Fix**: Added `logTeleGlanceTest('bridge', { method, args })` calls in `EvenHubGlassesBridge.setAudioEnabled` and `turnScreenOff`.
- **Commit**: `dc0ca1a`
- [x] Fixed

### C3. Latency budget violations
- **Status**: pending (budgets need recalibration for fixture overhead; 150ms sleep + capture overhead inflates every step)

### C5. Stale latestState / latestRender lookback
- **Status**: fixed
- **Fix**: `latestTestEvent` now accepts optional `fromIndex` parameter. `captureStep` passes `eventStartIndex` so only events after the step's input are considered.
- **Commit**: `dc0ca1a`
- [x] Fixed

### C6. Sample-fixture audio chunk never reaches the controller
- **Status**: fixed (same fix as B2)
- [x] Fixed

### C7. No transcribe.end log when audio is too small or zero
- **Status**: fixed
- **Fix**: Added `logRecordingEvent('transcribe.end', { transcript: '', rejected: true })` in the rejection path.
- **Commit**: `dc0ca1a`
- [x] Fixed

---

## D. New issues discovered

### D1. screenOff crashes on simulator (unknown variant screenOff)
- **Status**: fixed
- **Fix**: Wrapped `turnScreenOff` implementation in try/catch; simulator returns `screenOff` as error, caught and logged.
- **Commit**: `dc0ca1a`
- [x] Fixed

### D2. Right panel doesn't update on chat scroll
- **Status**: fixed
- **Severity**: user-visible (CRITICAL — user sees stale right panel when scrolling)
- **Root cause**: `handleSidebarChats` only called `setStateWithoutRender` on `swipeUp`/`swipeDown`/`selectIndex` — no preview fetch triggered.
- **Fix**: Added `debounceChatPreviewFetch` with 800ms idle delay + cache. Updated `screenModel` to render `previewMessages` in `panelBody`/`panelBox` when available. Added `previewMessages` fields to chats focus `AppState`.
- **Commit**: `bc42bdf`
- [x] Fixed

### D3. Simulator single press can cause double scroll
- **Status**: mitigated
- **Severity**: user-visible (simulator input mapping)
- **Root cause**: Simulator may generate both `selectIndex` and click events for one input, causing auto-press on already-selected item plus the press handler.
- **Fix**: Added 400ms debounce (`lastSelectIndexPressAt`) on `selectIndex`→`press` auto-trigger.
- **Commit**: `bc42bdf`
- [x] Mitigated

### D4. API request hangs forever → UI stuck on loading (CRITICAL)
- **Status**: fixed
- **Severity**: user-visible (CRITICAL — user cannot proceed, must press back)
- **Root cause**: `HttpTelegramApi.request()` used bare `fetch()` without timeout. If backend accepts TCP but never responds (or sends headers slowly), the promise never resolves. The `prefetchMessages`/`prefetchTopics` in-flight tracking keeps the hung promise alive, and all subsequent calls for the same key return the same hung promise.
- **Fix**: Added `AbortController` with 15s timeout. On abort, throws `REQUEST_TIMEOUT_MESSAGE` with actionable text. The `.finally()` in prefetch promises properly cleans up in-flight tracking on rejection. The `run()` catch converts the timeout to an error screen.
- **Commit**: `c2ba91b`
- [x] Fixed

---

## E. Iteration log

- 2026-06-02 — Initial file created from harness run. 13 distinct open issues.
- 2026-06-02 — Fixing round 1 (commit `dc0ca1a`): A1 (long-message box), A2 (transcribe.end logging + audio injection), A4 (container ID conflict), C1 (bridge logging), C5 (stale lookback), C7 (transcribe.end logging), D1 (screenOff error). Seven issues resolved.
- 2026-06-02 — Fixing round 2 (commit `bc42bdf`): D2 (chat preview on scroll), D3 (selectIndex debounce). Two issues resolved.
- 2026-06-02 — Fixing round 3 (commit `c2ba91b`): D4 (API request timeout). One issue resolved.
- 2026-06-02 — Fixing round 4 (commit `9c853ce`): seed-credentials mechanism for real-data test mode. The Vite plugin reads `web/test/seed-credentials.local.json` (gitignored) and injects values into the page at load time. Frontend boot script copies them into the WebView's localStorage so the simulator can authenticate without re-entering credentials. Fuzzy test exits cleanly with diagnostic message if startup fails. 30/30 random fixture tests still pass; 0 failures.
- 2026-06-02 — Fixing round 5: **D5. Right panel stale on chat/topic scroll — root cause fix**. The previous D2 fix added `debounceChatPreviewFetch` but kept `setStateWithoutRender` on swipe, so the right panel never re-rendered between scrolls and the cache (`chatPreviewCache`/`topicPreviewCache`) was a separate map from the prefetched `messageCache`. The new fix (a) makes `chatPreviewCache`/`topicPreviewCache` aliases of `messageCache` so the startup prefetch is reused for previews, (b) adds `getChatPreviewCached`/`getTopicPreviewCached` synchronous lookups used directly in `handleSidebarChats`/`handleSidebarTopics` so the right panel updates from cache the moment the user swipes, and (c) adds a `renderSidebarPanel` partial-render path on the bridge (`textContainerUpgrade` for the right-side text containers 1/4/6/7 only) so the list selection is never snapped back to row 0 by a full `rebuildPageContainer`. New invariants in `UI_INVARIANTS.md` § 4.5 and § 4.7 require the right panel to reflect the highlighted row after every swipe, and new `renderBodyContains` assertions in steps 01, 03, 10, 14 catch any future regression. Step 01 (initial chat preview) now passes `contentMatches: true` with the cached Alpha body in `panelBody` instead of the `lastMessage` fallback. Remaining: A3 (pagination race), C3 (latency budgets systemic), B1 (simulator blank screenshots wontfix), and the simulator's per-render cost still exceeds the 500 ms budget for rapid sidebar `rebuildPageContainer` calls (the `textContainerUpgrade` partial path requires real-hardware support to skip the fallback).

### D5. Right panel stale on chat/topic scroll — root cause
- **Status**: fixed
- **Severity**: user-visible (the previous D2 fix masked this with a debounced fetch + `setStateWithVisibleRead(..., { render: false })`, so the right panel still showed the previous chat's messages until a fresh API call completed; on real G2 hardware the prefetched cache was never used for previews)
- **Root cause**: three independent issues stacked: (1) `setStateWithoutRender` on swipe never triggered a glasses render, so the right panel kept the previous chat's content; (2) `chatPreviewCache`/`topicPreviewCache` used a different key format than `messageCache`, so the startup prefetch was never reused for previews; (3) every preview update passed `{ render: false }`, so even the debounced fetch never pushed new content to the glasses.
- **Fix**:
  - `chatPreviewCache` and `topicPreviewCache` are now aliases of `messageCache`, so the prefetch populated by `prefetchVisibleChats` is the single source of truth for both messages and previews.
  - `handleSidebarChats`/`handleSidebarTopics` now do a synchronous `getChatPreviewCached`/`getTopicPreviewCached` lookup on every `swipeUp`/`swipeDown`/`selectIndex`, set `previewMessages` from the cache, and call the new `setStateForListScroll` to apply state + render in one step.
  - `EvenHubGlassesBridge.renderSidebarPanel` pushes the right-side text containers (title 1, panel-body 6, panel-box 7, footer 4) via `textContainerUpgrade` without touching the native list (container 8), so the list selection cannot snap back to row 0. When the SDK lacks `textContainerUpgrade`, it falls back to a full `rebuildPageContainer`.
  - `loadChats` also calls `debounceChatPreviewFetch(chats, 0)` so the first paint after the startup prefetch closes the right-panel gap automatically.
- **Verification**:
  - New `renderBodyContains: ["fixture-alpha-body"]` assertion in step 01 of `UI_INVARIANTS.json` catches the initial-preview regression.
  - New `renderBodyContains` assertions in steps 03, 10, and 14 catch the scroll-preview regression.
  - `web/test/ui-invariants.test.ts` still passes (12/12) and the schema-version guard in `loadCatalog()` confirms the catalog is well-formed.
  - `web/test/controller.test.ts` still passes (43/43) and all existing scroll/list selection expectations remain green.
  - The most recent simulator run (`artifacts/simulator-flow/2026-06-02T19-22-58-721Z`) shows step 01 with `contentMatches: true` and `panelBody: "Fixture Alpha: Alpha message page contains fixture-alpha-body for startup testing. Me: Alpha ou..."` — proof that the right panel now renders the cached messages, not the `lastMessage` fallback.
  - The remaining per-render "timed out" failures on rapid chat/topic swipes are a simulator limitation: `@evenrealities/evenhub-simulator@0.7.2` does not implement `textContainerUpgrade`, so the partial path falls back to `rebuildPageContainer`, which the simulator handles slowly for the sidebar page. On real G2 hardware the partial path is the primary one and the list selection never snaps.
  - `npm run typecheck` and `npm test` both pass (90/90 unit tests).
  - `npm run typecheck` and `npm test` both pass (90/90 unit tests).
- [x] Fixed

### A5. LVGL `glyph dsc. not found` warnings for U+2757 and U+26A0
- **Status**: fixed
- **Severity**: harness (console warning noise that can mask real errors in real-mode runs)
- **Root cause**: `sanitizeGlassesText` in `web/src/controller/model.ts` stripped `1F534..1FAFF` but left `U+2757` (heavy exclamation) and `U+26A0` (warning sign) in the text, producing LVGL "glyph dsc. not found" warnings on the simulator.
- **Fix**: Added the two codepoints to the existing strip pattern in `sanitizeGlassesText`. Added a unit test that verifies the characters are removed while surrounding text survives.
- [x] Fixed

### C8. Harness has no real-mode content/profile split
- **Status**: fixed
- **Severity**: harness (real-mode runs failed at every `renderBodyContains` and `state` predicate, hiding real issues)
- **Root cause**: `simulator-flow.mjs` ran the same `expect.renderBodyContains` and `expect.state` predicates in real mode, but the catalog is fixture-shaped (it asserts on titles like `fixture-alpha-body` and chat names from the seeded fixture dataset). Real-mode runs immediately failed every step.
- **Fix**:
  - `simulator-flow.mjs` now skips `expect.state` and `expect.renderBodyContains` predicates when `runMode !== 'fixture'`. API-call and bridge-call expectations still run in both modes.
  - Real-mode runs now track the latest `screen`/`focus` from `state` events, the latest per-input dispatch latency, asleep no-op inputs, partial-render timings, and a `api.timing` log of timing-only API calls.
  - `latency.json` artifact now includes a `realMode` block with `perInputLatencies`, `renderLatencies`, `apiTimings`, `stateTransitions`, `asleepNoOps`, and the final observed `currentScreen`.
  - Report includes new sections: "Real-mode latency buckets", "Asleep no-op inputs", and "Real-mode API timings".
- [x] Fixed

### C9. Real-mode API timing is invisible
- **Status**: fixed
- **Severity**: harness
- **Root cause**: `InstrumentedTelegramApi.wrap()` short-circuited in non-fixture mode with no logging. Backend latency, hang behavior, and error rates were invisible to the harness in real mode.
- **Fix**: New `logApiTiming` event in `testMode.ts` and a new `wrap()` branch in `InstrumentedTelegramApi` that emits `api.timing` events in real mode. Sensitive fields (phone numbers, login codes, session strings, message text) are redacted; chat/topic/message ids and array lengths are kept so the harness can attribute latency to specific calls. `args.request.textLength` is recorded instead of `args.request.text`.
- [x] Fixed

### E. Iteration log (continued)
- 2026-06-02 — Fixing round 6: **D6. Fire-and-forget list scroll** + **A5. U+2757/U+26A0 sanitization** + **C8. Real-mode harness profile** + **C9. Real-mode API timing**. `npm run typecheck` and `npm test` pass (93/93 unit tests, up from 90).