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

Last harness run: `artifacts/simulator-flow/2026-06-02T08-00-41-629Z` (48 steps, 129 individual failure messages)

---

## A. App-level bugs

### A1. Long-message box rendering drops middle/start content
- **Status**: pending
- **Severity**: user-visible
- **Steps that catch it**: `18-topics-open-topic-three`, `18a-topic-long-message-verify`, `21c-archive-long-message`
- **Failure messages**:
  - `expected render content "fixture-long-topic-body-anchor" not found`
  - `expected render content "fixture-long-alpha-body-anchor" not found`
  - `expected render content "Fixture topic long message body" not found`
  - `expected render content "deliberately long fixture message" not found`
- **Evidence**: The render model for step 18 shows `panelBoxContent: '...this anchor, and that the visible substring of the first line is preserved.'` — the END of the long message. Anchors in the middle of the message are not visible.
- **Root cause**: `MESSAGE_BOX_CONTENT_ROWS = MESSAGE_VISIBLE_ROW_LIMIT - 4 = 8` rows of `MESSAGE_BOX_CONTENT_WIDTH = 38` chars = ~300 chars. The box is built by `formatMessageBlocks` / `splitBoxRows` in `web/src/controller/model.ts` and shows the LAST 8 lines of a long message.
- **Fix location**: `web/src/controller/model.ts` `formatMessageBlocks` and/or `MESSAGE_BOX_CONTENT_ROWS` constant.
- **Fix approach**: Truncate the BEGINNING of long content with a `…` prefix instead of the end. Or implement scroll-paginate within the box (multi-page box display).
- **Acceptance**: After fix, `panelBoxContent` for step 18 contains `fixture-long-topic-body-anchor` and step 21c contains `fixture-long-alpha-body-anchor`.
- [ ] Fixed

### A2. Recording flow returns to messages without transcribing
- **Status**: pending
- **Severity**: user-visible (real Whisper would behave differently, but the fixture path is broken)
- **Steps that catch it**: `27-alpha-record-stop`, `28-alpha-transcribe-done`, `29-alpha-confirm-send`
- **Failure messages**:
  - `28-alpha-transcribe-done: expected render content "> Send" not found`
  - `28-alpha-transcribe-done: timed out waiting for expected TeleGlanceTest event`
  - `29-alpha-confirm-send: timed out waiting for expected TeleGlanceTest event`
- **Evidence**: Step 28's `latestState` is `screen: 'sidebar', focus: 'messages'`, not `sidebarConfirm`. No `transcribe.end` event observed. The controller went through the `hasRecordableAudio === false` branch.
- **Root cause**: `hasRecordableAudio` in `web/src/controller/appController.ts:1860-1873` requires ≥ 3200 bytes AND > 20 non-zero samples. The 3200-byte chunks the harness injects appear to be all-zero PCM. The controller exits early without logging `transcribe.end` and without entering `sidebarConfirm`.
- **Fix approach**: Either (a) the harness injects a real 1 kHz tone instead of zero-filled PCM, or (b) the controller's `hasRecordableAudio` threshold is loosened in fixture mode.
- **Acceptance**: After fix, step 28's render contains `> Send`; step 28 emits `transcribe.end`; step 29 calls `sendMessage` with the transcript text.
- [ ] Fixed

### A3. Older-page pagination race
- **Status**: pending
- **Severity**: harness (the controller actually paginates correctly, the harness just can't see the final render in time)
- **Steps that catch it**: `21d-archive-paginate-older`
- **Failure messages**:
  - `expected render content "Older fixture" not found`
  - `expected render body content not found`
  - `timed out waiting for expected TeleGlanceTest event` (2x)
- **Evidence**: The controller sets `status: 'Loading older messages...'` first, then calls `loadOlderMessagesInBackground`, which fetches and merges older messages. The harness sees the intermediate state but misses the final merged render.
- **Root cause**: Harness's `pollConsole` loop in `executeStep` does not wait for a specific render event with `status: undefined`; it only waits for the first matching state.
- **Fix approach**: In `executeStep`, after a `swipeUp` pagination step, also wait for a `render` event whose `model.panelBody` contains the older message anchor.
- **Acceptance**: Step 21d's `latestRender.model.panelBody` contains `Older fixture`.
- [ ] Fixed

---

## B. Simulator-integration issues

### B1. Glasses screenshot is empty (the original user complaint)
- **Status**: pending
- **Severity**: simulator
- **Steps that catch it**: all 48/48
- **Failure messages**: `glasses screenshot is blank (only N unique colors, all near selection-border green)` where N ranges from 1 to 5.
- **Evidence**: The simulator's `/api/screenshot/glasses` endpoint returns a 576x288 PNG whose non-transparent pixels are all 100% green. The `webview` screenshot does render text correctly.
- **Root cause**: `@evenrealities/evenhub-simulator@0.7.2` does not render text in the LVGL framebuffer.
- **Fix approach**: Upgrade `@evenrealities/evenhub-simulator` to a version that renders text, or switch to a different simulator. Until then, the harness writes the webview PNG as the primary visual reference and the blank check is a known acceptable failure.
- **Acceptance**: After fix, `glasses` screenshots have `textLikePixelCount >= 200` and `uniqueColors > 5`.
- [ ] Fixed

### B2. Simulator `/api/input audio_chunk` returns 400
- **Status**: pending
- **Severity**: simulator
- **Steps that catch it**: `23-25-alpha-record-audio-1..3` (when harness sends audio)
- **Failure messages**: `simulator input audio_chunk returned 400` (3 occurrences in the run)
- **Evidence**: The simulator's input endpoint does not accept the `{ action: 'audio_chunk', pcm: '<base64>' }` payload. The harness's recording-flow tests cannot inject audio through the simulator.
- **Root cause**: Simulator limitation. The harness currently reads the 1 KiB fixture from `web/test/fixtures/recording-sample.pcm` but cannot deliver it to the controller.
- **Fix approach**: Either patch the simulator to accept `audio_chunk` or extend the fixture API to accept an `__fixture.injectAudioChunks` call from the harness via the Vite `/api/test/fixture` endpoint.
- **Acceptance**: After fix, the harness's `audioChunk` inputs reach the controller's `state.chunks` array, and `chunksLength` expectation passes.
- [ ] Fixed

---

## C. Harness issues (not app issues)

### C1. Bridge-call expectations never match
- **Status**: pending
- **Severity**: harness
- **Steps that catch it**: `22-alpha-record-start` (`setAudioEnabled true`), `26-alpha-record-stop` (`setAudioEnabled false`), `32-chats-back-to-forum` (`turnScreenOff`), `33-asleep-noop-press` (`turnScreenOff`)
- **Failure messages**: Steps are in the catalog as `bridgeCall` expectations, but the harness never sees a matching `bridge` event. The 4 affected steps currently pass budget checks but silently skip the bridge-call assertion.
- **Evidence**: `EvenHubGlassesBridge.setAudioEnabled` and `turnScreenOff` call the SDK directly, not through a `[TeleGlanceTest]` console logger.
- **Root cause**: Missing `logTeleGlanceTest('bridge', { method, args })` in `web/src/bridge/evenBridge.ts`.
- **Fix approach**: Add `logTeleGlanceTest('bridge', { method, args })` calls inside `EvenHubGlassesBridge.setAudioEnabled` and `turnScreenOff`. The harness's `bridgeCall` predicate already looks for these.
- **Acceptance**: Step 22's `bridgeCall: setAudioEnabled(true)` matches; step 33's `bridgeCall: turnScreenOff` matches.
- [ ] Fixed

### C2. No step exercises auth.needsSetup, auth.signedOut, auth.phonePending, newMessage.topic, sidebarSent, sidebar.messages.loading
- **Status**: pending
- **Severity**: harness (catalog completeness)
- **Steps that catch it**: none — these screens are documented in the catalog but have no step
- **Evidence**: 6 catalog screens and one transient loading state are documented, but the harness does not yet assert them directly.
- **Fix approach**: Add 6 steps:
  - `00a-auth-needs-setup` — query `?teleGlanceAuth=missing`, assert `screen === 'auth', mode === 'needsSetup'`
  - `00b-auth-signed-out` — query `?teleGlanceAuth=signed-out` (extend fixture), assert `mode === 'signedOut'`
  - `00c-auth-phone-pending` — call `startPhoneAuth`, assert `mode === 'phonePending'`
  - `11a-message-loading` — open a chat/topic with a deliberate slow path and assert `screen === 'sidebar', focus === 'messages', status === 'Loading ...'`
  - `35a-newmessage-topic-inject` — inject notification with `topicId`, assert `newMessage.topic` screen
  - `28a-sent-state` — after send, assert the brief `sidebarSent` state or document it as a transient
- **Acceptance**: vitest validator gains new "coverage" checks; the 6 screens/state transitions each have at least one step.
- [ ] Fixed

### C3. 23/47 valid steps exceed the 1 s latency budget
- **Status**: pending
- **Severity**: harness (fixture inflates the budget artificially)
- **Steps that catch it**: any step that waits for `listMessages` (80 ms fixture delay) plus 150 ms post-step sleep plus 332 ms screenshot capture.
- **Failure messages**: `total N ms exceeds budget 1000ms (latency budget violated)` for 23 steps.
- **Evidence**: Average latency is 1179 ms; max is 4305 ms (`28-transcribe-done`); min is 299 ms.
- **Root cause**: The fixture's `listMessages` 80 ms delay + post-step `sleep(150)` + screenshot capture (332 ms) consistently push message-load steps to 1500-2300 ms.
- **Fix approach**: Either reduce the post-step `sleep(150)` to `sleep(50)`, or raise the relevant step budgets to 2000 ms. The user asked for chat-load and message-load budgets to be 1 s on real hardware; the fixture-inflated latency is not representative of the real app.
- **Acceptance**: Steps with realistic API latency complete under their documented budget; only the `40-perf-budget-chat-list` step intentionally exceeds.
- [ ] Fixed

### C4. Webview-fallback content matcher not implemented
- **Status**: pending
- **Severity**: harness (documented in UI_INVARIANTS.md Section 7/8, not yet coded)
- **Steps that catch it**: every step, when glasses are blank
- **Failure messages**: no specific failure; the blank check fires instead.
- **Evidence**: `docs/UI_INVARIANTS.md` Section 8 describes a webview-region signature check. The `scripts/simulator-flow.mjs` writes the webview PNG but does not run the structural text-content check.
- **Root cause**: Missing `analyzeWebviewRegion(webviewPath)` in `scripts/simulator-flow.mjs`.
- **Fix approach**: Implement the region-crop + `textLikePixelCount >= 200` check described in UI_INVARIANTS.md. This lets the harness validate visual correctness even when the simulator's glasses framebuffer is empty.
- **Acceptance**: When the glasses screenshot is blank, the harness falls back to webview-region content checks. If the webview region also has `textLikePixelCount < 200`, the harness fails with a clear message.
- [ ] Fixed

### C5. Stale `latestState` / `latestRender` lookback
- **Status**: pending
- **Severity**: harness
- **Steps that catch it**: `09-topics-preview-loaded`, `30-chats-reload-ops`, `36-newmessage-inject`, `38-error-inject`
- **Failure messages**:
  - `09: expected render content "Topic zero warmup body" not found`
  - `30: expected render content "fixture-ops-body" not found`, `"Ops latency sample" not found`
  - `36: expected render content "New message" not found`
  - `38: expected render content "Error" not found`, `"Press to retry" not found`
- **Evidence**: The render model in `09` shows `panelBody: 'Loading messages...'` and `panelFooter: 'Loading messages...'`. The state is the intermediate `Loading…` state, not the final loaded state. Step 30's `panelBody` shows Fixture Alpha messages instead of Ops. Step 36 shows the Fixture Forum preview instead of the new message.
- **Root cause**: The harness's `latestState` and `latestRender` lookback is `testEvents.slice().reverse().find(...)` over the entire event log, not the post-event-start window. When the controller uses `setStateWithoutRender` (which emits no render event), the harness's `eventStartIndex` is correct but the lookback matches an old render.
- **Fix approach**: Change `latestTestEvent` to filter to events after the `eventStartIndex` AND after a wall-clock threshold. Or change `executeStep` to wait specifically for the matching `render` event after a state transition.
- **Acceptance**: Step 30's render shows Ops messages; step 36's render shows the new message; step 09's render shows topic 0 preview.
- [ ] Fixed

### C6. Sample-fixture audio chunk never reaches the controller
- **Status**: pending
- **Severity**: harness
- **Steps that catch it**: all audio-related steps
- **Failure messages**: indirectly causes A2 and B2
- **Evidence**: `web/test/fixtures/recording-sample.pcm` is 1024 bytes of a 440 Hz tone, but the harness injects audio via the simulator's `/api/input` which returns 400. The fixture file is never used.
- **Root cause**: Same as B2.
- **Fix approach**: Same as B2.
- [ ] Fixed

### C7. No `transcribe.end` log when audio is too small or zero
- **Status**: pending
- **Severity**: harness
- **Steps that catch it**: `28-alpha-transcribe-done` (event must be emitted but never is)
- **Failure messages**: indirectly causes A2 to fail with the wrong state
- **Evidence**: `logRecordingEvent('transcribe.end', ...)` is inside the `else` branch of `hasRecordableAudio`, so it never fires when audio is rejected. Only 1 `transcribe.start` event was observed; 0 `transcribe.end` events.
- **Root cause**: Missing log in the rejection path of `appController.ts:651-666`.
- **Fix approach**: Move the `logRecordingEvent('transcribe.end', { transcript: '' })` outside the `if (!hasRecordableAudio)` check so it always fires.
- **Acceptance**: Step 28's console.json contains 1 `transcribe.end` event even if the controller short-circuits.
- [ ] Fixed

---

## D. Performance characteristics (not bugs, observed for context)

- `listMessages` averages 453 ms in the fixture (over the 300 ms `maxApiCallMs` budget). Real Telethon would be slower.
- `setStateWithoutRender` correctly avoids re-renders on chat-list scroll: the burst-scroll step fires 5 swipes with 0 `render` events and 0-2 ms per-input latency. **This is the behavior the user asked us to verify, and it works.**
- Cancel flows (double-press during recording, swipe to Cancel + press on confirm) correctly skip `transcribe` and `sendMessage`. **This works.**
- Marked-vs-actual-selection tracking is correct: when the user swipes in the chat list, the controller's `state.selectedChatIndex` updates and the native list moves, but no `render` event fires. **This is correct.**

---

## E. Iteration log

Use this section to record when an issue moves from one status to another. Append, do not edit history.

- 2026-06-02 — Initial file created from harness run `artifacts/simulator-flow/2026-06-02T08-00-41-629Z`. 13 distinct open issues captured across app bugs (A1-A3), simulator issues (B1-B2), and harness issues (C1-C7).
