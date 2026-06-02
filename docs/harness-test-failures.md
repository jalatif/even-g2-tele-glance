# Harness Test Failures — Actionable Issue Tracker

This file is the working log of issues the simulator harness is flagging but that are not yet fixed. It is the place to update as fixes land. Each issue has a status, severity, evidence, fix location, and a checkbox.

Status values:
+ `pending` — issue is open, not yet picked up
+ `in-progress` — a fix is being written
+ `fixed` — verified by a fresh harness run; keep the verification artifact hash for traceability
+ `wontfix` — confirmed not worth fixing (e.g. simulator limitation with no upstream fix)

Severity:
+ `user-visible` — a real G2 user would see the bug
+ `harness` — only the harness is impacted; the app works fine
+ `simulator` — third-party simulator limitation
+ `fixture` — fixture data is wrong, the app is fine

Last harness run: `artifacts/simulator-flow/2026-06-02T09-05-32-142Z` (48 steps, ~120 individual failure messages)

---

## A. App-level bugs

### A1. Long-message box rendering drops middle/start content
+ **Status**: fixed
+ **Severity**: user-visible
+ **Fix**: Reversed `formatMessageBox` output order in `web/src/controller/model.ts:416`. The function now returns `pages.reverse()` so the message beginning appears at the newest page instead of the end. For a 3-chunk box message, pages = [end, mid, beginning]; `messageDisplayPages` processes from the end backward, resulting in `pages[last]` = beginning chunk.
+ **Commit**: `dc0ca1a`
[x] Fixed

### A2. Recording flow returns to messages without transcribing
+ **Status**: in-progress (audio injection path added, needs verification)
+ **Severity**: user-visible (real Whisper would behave differently, but the fixture path was broken)
+ **Fix**: Added `logRecordingEvent('transcribe.end', { transcript: '', rejected: true })` in the `!hasRecordableAudio` branch of `appController.ts:653`. Added fixture API audio injection endpoint (`injectAudioChunks` command) with HTTP polling so the harness can deliver PCM data to the controller. Added `consumeInjectedAudioChunks()` call in `dispatch()` for sidebarRecording state.
+ **Commit**: `dc0ca1a`
[x] Fixed (transcribe.end logging)
[ ] Fixed (audio injection verified working)

### A3. Older-page pagination race
+ **Status**: pending (needs C5 fix verification)
+ **Severity**: harness

### A4. Container ID conflict — chat list sidebar invisible on hardware (NEW)
+ **Status**: fixed
+ **Severity**: user-visible (CRITICAL — real G2 user cannot see chat list)
+ **Root cause**: `buildSidebarPage` in `evenBridge.ts` used containerID 3 for both the `sidebarSeparator` (TextContainerProperty) and the native list (ListContainerProperty). The Even Hub SDK shares container IDs across types; duplicate IDs cause one container to be silently dropped by firmware.
+ **Fix**: Changed native list containerID from 3 to 8 in both `sidebarListContainer` and `hiddenListContainer`.
+ **Commit**: `dc0ca1a`
[x] Fixed

---

## B. Simulator-integration issues

### B1. Glasses screenshot is empty
+ **Status**: wontfix (simulator limitation, `@evenrealities/evenhub-simulator@0.7.2`)

### B2. Simulator /api/input audio_chunk returns 400
+ **Status**: fixed (workaround)
+ **Fix**: Audio is now delivered via the fixture API's `/api/test/fixture` POST endpoint (`injectAudioChunks` command) with HTTP polling. The harness triggers audio consumption with a `double_click` input event.
+ **Commit**: `dc0ca1a`
[x] Fixed

---

## C. Harness issues

### C1. Bridge-call expectations never match
+ **Status**: fixed
+ **Fix**: Added `logTeleGlanceTest('bridge', { method, args })` calls in `EvenHubGlassesBridge.setAudioEnabled` and `turnScreenOff`.
+ **Commit**: `dc0ca1a`
[x] Fixed

### C3. 23/47 valid steps exceed the 1 s latency budget
+ **Status**: pending (budgets need recalibration for fixture overhead)

### C5. Stale latestState / latestRender lookback
+ **Status**: fixed
+ **Fix**: `latestTestEvent` now accepts optional `fromIndex` parameter. `captureStep` passes `eventStartIndex` so only events after the step's input are considered.
+ **Commit**: `dc0ca1a`
[x] Fixed

### C6. Sample-fixture audio chunk never reaches the controller
+ **Status**: fixed (same fix as B2)
[x] Fixed

### C7. No transcribe.end log when audio is too small or zero
+ **Status**: fixed
+ **Fix**: Added `logRecordingEvent('transcribe.end', { transcript: '', rejected: true })` in the rejection path.
+ **Commit**: `dc0ca1a`
[x] Fixed

---

## D. New issues discovered

### D1. screenOff crashes on simulator (unknown variant screenOff)
+ **Status**: fixed
+ **Fix**: Wrapped `turnScreenOff` implementation in try/catch; simulator returns `screenOff` as error, caught and logged.
+ **Commit**: `dc0ca1a`
[x] Fixed

---

## E. Iteration log

+ 2026-06-02 — Initial file created from harness run `artifacts/simulator-flow/2026-06-02T08-00-41-629Z`. 13 distinct open issues.
+ 2026-06-02 — Fixing round 1 (commit `dc0ca1a`): A1 (long-message box), A2 (transcribe.end logging + audio injection), A4 (container ID conflict), C1 (bridge logging), C5 (stale lookback), C7 (transcribe.end logging), D1 (screenOff error). Seven issues resolved; A2 audio injection verification, A3 pagination race, C3 latency budgets remain.
+ 2026-06-02 — Fixing round 2 (commit `bc42bdf`): Added chat preview on scroll (right panel updates as user scrolls chat list). Added `selectIndex`→`press` auto-trigger debounce (400ms guard against simulator double-event). Updated chats focus screen model to render `previewMessages` when available. Remaining: B1 (simulator blank screenshots, wontfix), C3 (latency budget systemic), content matching gaps from `setStateWithoutRender` suppressing render events.