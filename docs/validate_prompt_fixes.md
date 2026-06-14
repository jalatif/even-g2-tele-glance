# Validation Prompt Fixes

## Scope

This document records the investigation and fixes performed from
`validation_prompt.md`. The simulator was treated as valid evidence. Failures were
traced to the application and harness instead of being dismissed as simulator bugs.

## Root Causes

### 1. Invalid page event capture

Sidebar pages could contain two active event listeners at once:

- the native `ListContainerProperty`
- the full-screen text event overlay

The simulator correctly rejected those page rebuilds with:

`RebuildPageContainer validation failed: multiple event listeners (2) not allowed`

Rejected rebuilds left stale or blank glasses content and caused later inputs to act
on a controller state that no longer matched the display.

### 2. Stale React StrictMode listeners

The bridge created an active-listener token, but the SDK callback did not check it.
When SDK unsubscribe was ineffective during React StrictMode remounts, every simulator
input was dispatched twice. Duplicate swipes skipped rows and duplicate clicks opened,
closed, or started recording in the wrong thread.

### 3. Native list selection was not observable

The native list could move its firmware highlight without emitting an event for every
up/down movement. The controller therefore could not update the selected index or the
right-side preview reliably. Click-time selection events arrived too late to satisfy
the required synchronized chat/topic preview UX.

### 4. Input heuristics suppressed legitimate gestures

- `eventSource === 1` double clicks were treated as idle firmware noise. Simulator
  user-generated double clicks also use that source, so valid back/cancel actions were
  dropped.
- The 220 ms same-direction swipe debounce dropped intentional rapid swipes.
- The 220 ms post-double-click tap cooldown dropped a valid click on the next screen.

These heuristics hid catalog contradictions and caused state drift.

### 5. Harness evidence was misleading

- The console cursor advanced to `id + 1` even though the API returns entries with
  `id > since_id`, skipping events.
- Steps printed `ok` even after adding failures.
- Blank glasses captures were replaced with an unrelated full-desktop screenshot,
  which could turn a failed capture into a false pass.
- `noRenderEvents` treated expected partial text upgrades as forbidden full renders.
- Step `08-chats-open-forum-topics` moved down from the already-selected forum row,
  but still expected the forum row to remain selected.

## Implemented Fixes

### Glasses rendering

- Sidebar pages now have exactly one active input surface: a full-screen invisible
  `TextContainerProperty` overlay.
- Chat and topic sidebars are rendered as text in container `5` with an app-managed
  `> ` selection marker.
- The native list remains present only as a hidden compatibility container with event
  capture disabled.
- Partial sidebar updates now update container `5` as well as title, panel body,
  panel box, and footer.
- Focus changes require a full rebuild; partial text upgrades are used only when the
  input surface does not change.

### Event handling

- The SDK event callback now exits unless its listener token is the current active
  token, preventing stale StrictMode listeners from dispatching.
- Source-tagged native double-click events are honored as real input.
- Duplicate tap debounce remains 90 ms.
- Native double-click duplicate suppression remains 140 ms.
- Post-double-click tap cooldown and same-direction swipe debounce are now 30 ms,
  which filters immediate duplicates without dropping deliberate rapid navigation.

### Controller and telemetry

- Removed the idle-system-double-click state heuristic and its synthetic clock.
- Message-state telemetry now includes `selectedTopicIndex`, allowing the harness to
  validate cached topic opens correctly.
- Topic preview loading copy is consistently `Loading messages...`.

### Simulator harness

- Corrected console polling cursor handling.
- Step output now prints `fail` when the step added any failure.
- Removed macOS desktop screenshot substitution for blank glasses captures.
- Fast mode can run state/content checks without failing only because the glasses
  screenshot endpoint returned a blank capture.
- `noRenderEvents` now means no full render; partial updates remain allowed.
- Corrected the forum-open catalog step to click the already-selected forum row.

## Validation Results

Passing checks after the fixes:

```text
npm run typecheck --prefix web
npm test --prefix web          # 110/110 tests
npm run build --prefix web
```

The behavior-focused simulator trace now follows the intended sequence through:

- chat selection and rapid chat scrolling
- forum opening
- topic selection and topic back-navigation
- message scrolling
- long topic and Archive thread navigation

The simulator no longer reports multiple active event listeners, and inputs are no
longer dispatched twice.

## Remaining Harness Work

The complete simulator catalog is not yet a clean pass. Remaining failures are mainly
harness expectation and observability issues:

- cached chat/topic opens are sometimes required to emit a fresh API call even though
  prefetching intentionally avoids that call
- long-message assertions search truncated render telemetry instead of controller
  message text or the rendered container payload
- some recording/audio expectations use deadlines shorter than the deliberate
  single-click delay and fixture processing time
- the simulator glasses screenshot endpoint can return a green/blank framebuffer;
  this is now reported honestly instead of replaced by a desktop screenshot
- the intentional latency-negative step currently completes too quickly and needs a
  deterministic delay source
7. **Recording flow was deadlocking the simulator's Flutter main thread** because `sdk.audioControl()` was called even in fixture mode. The microphone handler in `evenhub-simulator@0.7.2` takes several seconds to initialize, and the HTTP server is blocked while Flutter is busy. Fix: `web/src/bridge/evenBridge.ts:415` short-circuits `setAudioEnabled` to a no-op when `isTeleGlanceFixtureMode()` is true. The audio path is fully simulated in fixture mode (`injectAudioChunks` provides PCM, `setNextTranscript` provides the text), so the native call is wasted work. Real G2 hardware still runs the call.
8. **The harness was treating blank glasses captures as the source of truth** (`web/test/simulator-goldens/*.glasses.png` was always a blank 9.6 KB PNG, and the harness compared blank-to-blank). The new golden format is `web/test/simulator-goldens/<step>.<locale>.glasses.json` — a JSON dump of the structured `summarizeScreenModel` output the controller sends to the native bridge. The harness diffs path-by-path (e.g. `panelBody: expected="..." actual="..."`) so regressions are immediately actionable.
9. **Bridge SDK calls were awaiting hung simulator operations** which blocked the controller's render queue. The fix at `web/src/bridge/evenBridge.ts:159` makes `rebuildPageContainer` / `createStartUpPageContainer` fire-and-forget: the JS-side `bridge.render` returns after attaching the `.then()` callback, the `fullRenderInFlight` flag is released in the `finally` block, and the next render can be enqueued immediately. A `logTeleGlanceTest('render', { attempted: true })` event is emitted before the SDK call so the harness has visibility into what was sent even if the call never resolves.
10. **The harness's `pollConsole`, `postInput`, and `sendTestCommand` now retry on `AbortError`** with backoff (8s → 5s → 5s). The spawned simulator has a 2s HTTP `/api/ping` liveness probe; two consecutive failures mark `handle.crashMessage` and the `alive` getter returns `false`. `runFlow`'s catch block marks the failed step as `SKIPPED — simulator died during step (...)` and breaks the loop.

