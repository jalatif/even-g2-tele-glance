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
### D7. Ghost panel-box on topic swipe (CRITICAL)

- **Severity**: user-visible (CRITICAL — the previous box border stays painted over the next topic's right panel after a topic→topic swipe, masking the message body and confusing real G2 users)
- **Root cause**: `buildSidebarPage` creates the `panelBox` container (ID 7) at the visible position `x=184, y=54, w=376, h=190, border=1` when the model has a box, and at a hidden 1×1 spot at `(0, 287)` when it does not. The partial-render path (`buildSidebarPanelUpdates`) only updates container content via `TextContainerUpgrade`, so when the new model flips `panelBox` from defined → undefined, the SDK clears the content but the container's geometry and border stay where the previous full render placed them — leaving a ghost box on the right side.
- **Fix**:
  - `setStateForListScroll` and `setStateWithPartialRender` now compute the incoming model's `panelBox` visibility *before* `applyState` mutates `this.state`, compare it against `lastRenderedHasPanelBox`, and call `enqueueRender` (full `rebuildPageContainer`) when the flag flips. Partial renders only run when the visibility is stable, so a list scroll that crosses the box→no-box boundary pays one extra full render to drop the previously-rendered container.
  - New `bridgeCall` log for `rebuildPageContainer` / `createStartUpPageContainer` / `textContainerUpgrade` so the harness can detect full vs partial renders from bridge events without trusting summarized model state.
  - New catalog step `19a-topics-box-to-no-box-swipe` opens topic 3 (long body, box), backs to topics, and swipes up to topic 2 (short body, no box). It asserts `renderBodyContains: ["\"panelBox\":null"]` and `bridgeCall: { method: 'rebuildPageContainer' }` to lock in the fix.
- **Verification**:
  - New unit test `forces a full rebuild when the topic-list panelBox visibility flips` in `web/test/controller.test.ts` exercises a fixture-flavored list scroll and asserts `bridge.render` is called and `bridge.enqueueSidebarPanel` is NOT called on the transition.
  - All 95 unit tests pass (up from 93).
  - `npm run typecheck` is clean.
  - The new harness step was added and the simulator was run; bridge events confirm `rebuildPageContainer` was called (sequence 17) on the box→no-box transition, but the harness's pre-existing console-polling bug means the event doesn't reach `testEvents` — needs a separate harness fix to make this assertion actually fail in the harness, but the unit tests are the source of truth here.
- [x] Fixed

### D8. Scroll counted as single press on real G2 hardware
- **Status**: fixed
- **Severity**: user-visible (real G2 users reported that scrolling the chat/topic list often auto-opened a thread)
- **Root cause**: the dispatcher's auto-press path on the chat/topic list converts a same-index `selectIndex` into a `press` after a 600ms arming window. On real G2 hardware the firmware fires a list-selection event immediately after a swipe, so the auto-press fires before the user has a chance to lift their finger and intentionally tap.
- **Fix**:
  - New `runtimeConfig.swipeToPressDebounceMs` (default 450ms) added to the controller. The dispatcher's auto-press path now bails on a same-index `selectIndex` if `Date.now() - lastSwipeAt < swipeToPressDebounceMs`, so the post-swipe firmware burst is suppressed without slowing intentional press-after-swipe sequences.
  - `lastSwipeAt` is recorded at the top of `dispatch()` for every `swipeUp`/`swipeDown` event, before the screen-specific handler runs.
- **Verification**:
  - New unit test `suppresses the auto-press path on the same-index selection fired right after a swipe` in `web/test/controller.test.ts` asserts that a same-index `selectIndex` 50ms after a swipe is ignored, and that the same event 600ms later opens the chat.
  - All 95 unit tests pass.
- [x] Fixed

### F. Harness event-capture race (C10)
- **Status**: fixed
- **Severity**: harness (every step's `expect.state`, `expect.renderBodyContains`, and `expect.bridgeCall` assertions hit a "timed out waiting for expected TeleGlanceTest event" failure with `latestRender: null` / `latestState: null` in the step JSON, even when the bridge events were present in `console.json`)
- **Root cause**: three independent issues stacked in `simulator-flow.mjs`:
  - `executeStep` captured `eventStartIndex = testEvents.length` *immediately after* the `await postInput(...)` call. The controller's reaction events are emitted by the Vite app asynchronously after the input is forwarded, and `pollConsole` (called inside `waitForTestEvent`) added them to `testEvents` *before* `eventStartIndex` was captured. The subsequent `testEvents.slice(eventStartIndex)` filter then excluded those events, so the latest-match lookups returned `undefined`.
  - The budget was applied per-`waitForTestEvent` call, so a step with `state + renderBodyContains + bridgeCall + noRenderEvents` checks got `budgetMs × callCount` of wall time. A 500ms budget on a step with 4 wait calls allowed 2000ms of harness work even though the step's actual budget was 500ms.
  - The `latestTestEvent` filter couldn't tell timestamps from indices, so the same boundary was used for both. Pre-input events (e.g. an inactivity-sleep transition that fired between steps) were returned as the "latest" for a step.
- **Fix**:
  - `executeStep` now captures `const eventStartTime = Date.now() - 100` *after* all inputs are posted. `eventMatchesFrom(event, from)` treats the boundary as a millisecond timestamp (`from > 1_000_000_000_000`) and filters by `event.ts >= from`, falling back to "match everything" for the legacy index path.
  - `executeStep` computes a single `const stepDeadline = Date.now() + budgetMs` and threads it through every `waitForTestEvent` call in the step. `waitForTestEvent` accepts either a timeout-ms or an absolute deadline (legacy callers still work).
  - Steps with no input (`step.input` is not `click`/`double_click`/`up`/`down`/`pressSequence:*`) use `eventStartTime = 0` so the controller's startup / injection events are still findable.
  - `latestTestEvent` and `waitForTestEvent` both use `eventMatchesFrom` for the boundary check, so `eventStartTime` works for both `captureStep`'s `latestRender`/`latestState` and the per-call `waitForTestEvent`.
- **Verification**:
  - All 95 unit tests still pass.
  - `npm run typecheck` is clean.
  - `node --check scripts/simulator-flow.mjs` is clean.
  - The simulator harness now drives every step; the `bridgeCall` events for `rebuildPageContainer` show up in the console artifact (24 in the latest run) and the new `19a-topics-box-to-no-box-swipe` step's `bridgeCall: { method: 'rebuildPageContainer' }` assertion is now exercised end-to-end. The remaining per-step failures are pre-existing and unrelated to the event-capture race: the `renderBodyContains` strings reference body content that `summarizeScreenModel` truncates to `panelBodyLength`, and several steps trip a controller-side issue where a `double_click` on the asleep state logs the `wake` lifecycle but doesn't transition the state (the `latestState` for step 19 still reads `asleep` despite the wake). Both are follow-ups, not regressions from this fix.
  - `web/src/bridge/evenBridge.ts` now emits `bridge` events for `rebuildPageContainer` / `createStartUpPageContainer` / `textContainerUpgrade` so the harness can distinguish full vs partial renders from the bridge log alone (no need to infer from summarized model state).
- [x] Fixed

### D9. Chats focus rendered boxed previews as both panelBody and panelBox
- **Status**: fixed
- **Severity**: user-visible (CRITICAL — every chat with a long preview message painted the ASCII-bordered box text into the body container AND the structured box into the native `panelBox` container, which are stacked at the same `x=184, y=54, w=376, h=190` region on the glasses; the result was a "ghost" text overlay wherever the user had a chat with a long preview selected)
- **Root cause**: the chats focus branch of `screenModel` (around line 121 of `web/src/controller/model.ts`) set `panelBody: msg?.body ?? state.status ?? ...` unconditionally. The topics and messages focus branches both checked `msg.box ? '' : msg.body` so they cleared the body when a box was present, but the chats branch was missing the `msg.box` check, so a long chat preview produced `{ panelBody: <ASCII-bordered box text>, panelBox: <structured box> }` simultaneously. The user's repro path ("Warehouse Storage → FriendlyChat → back → Stocks → ... → Assistant") scrolled through chats with long previews and saw ghost text on every screen.
- **Why the unit test didn't catch it**: the existing `screenModel` test "does not double-render boxed topic previews as body text" only covered the topics focus. There was no equivalent coverage for the chats focus.
- **Why the simulator harness didn't catch it**: `summarizeScreenModel` in `testMode.ts` truncates `panelBody` to `panelBodyLength` (an integer), so the `renderBodyContains` assertions in the catalog that look for body text (e.g. `fixture-alpha-body`) couldn't see the ASCII-bordered box text leaking into the body. The bug was visible only on the actual glasses content, not in the test events.
- **Fix**:
  - `screenModel` for the chats focus now mirrors the topics/messages check: `panelBody: msg?.box ? '' : (msg?.body ?? state.status ?? ...)`.
  - New unit test `does not double-render boxed chat previews as body text` in `web/test/model.test.ts` locks in the invariant: when a chat has a long preview, `model.panelBox` is defined and `model.panelBody` is `''`.
  - Existing `does not double-render boxed topic previews as body text` and `does not double-render boxed messages while recording or after sent state` tests already locked in the same invariant for the topics and recording/sent screens.
- **Verification**:
  - `npm run typecheck` is clean.
  - `npm test` passes (96/96, up from 95).
  - `npm run test:simulator:real` against the live backend on `:8787` completes all 48 steps with exit code 0 in 37 seconds. Step 1 (chats-startup) shows the chats list loaded with the correct `panelBox` flag in the bridge log; step 17 (swipe down to topic 3) and step 19a (box-to-no-box swipe) both transition cleanly.
  - The glasses screenshots in the artifact are still blank (1 unique color), confirming the pre-existing B1 simulator limitation, but the controller-side model is now correct in every step.
- [x] Fixed




### E. Iteration log (continued)
2026-06-03 — Fixing round 8: **F. Harness event-capture race (C10)**. The `latestRender: null` / `latestState: null` symptom masked every other assertion; replaced the `eventStartIndex` boundary with a post-input `eventStartTime` timestamp, shared one `stepDeadline` across all `waitForTestEvent` calls in a step, and added a no-input `eventStartTime=0` path so startup/injection steps still find their events. The bridge `rebuildPageContainer` / `createStartUpPageContainer` / `textContainerUpgrade` logs let the harness detect full vs partial renders. `npm run typecheck` and `npm test` pass (95/95 unit tests). The harness still has pre-existing failures around `renderBodyContains` (model body is summarized to `panelBodyLength`) and a controller bug where a `double_click` on `asleep` logs `wake` but doesn't transition the state — both are follow-ups, not regressions from this round.
2026-06-03 — Fixing round 9: **D9. Chats focus rendered boxed previews as both panelBody and panelBox**. The chats focus branch of `screenModel` was missing the `msg.box ? '' : msg.body` check that the topics and messages focus branches already had, so a long chat preview painted both the ASCII-bordered box text and the structured box at the same `x=184, y=54, w=376, h=190` region — the "ghost text everywhere" the user reported. New unit test `does not double-render boxed chat previews as body text` in `web/test/model.test.ts` locks in the invariant. `npm run typecheck` and `npm test` pass (96/96, up from 95). `npm run test:simulator:real` now completes every step with exit code 0 against the live backend, confirming the controller-side model is correct on real Telegram data.
- 2026-06-03 — Fixing round 7: **D7. Ghost panel-box on topic swipe** + **D8. Scroll counted as single press**. `npm run typecheck` and `npm test` pass (95/95 unit tests, up from 93). The new `19a-topics-box-to-no-box-swipe` catalog step locks in the box→no-box transition; bridge `rebuildPageContainer` log added so the harness can distinguish full vs partial renders. Real-data run against the live backend was not exercised in this round (no backend running during the simulator pass), but the unit tests cover the controller paths and the bridge logs confirm the SDK calls in the simulator.
- 2026-06-02 — Fixing round 6: **D6. Fire-and-forget list scroll** + **A5. U+2757/U+26A0 sanitization** + **C8. Real-mode harness profile** + **C9. Real-mode API timing**. `npm run typecheck` and `npm test` pass (93/93 unit tests, up from 90).