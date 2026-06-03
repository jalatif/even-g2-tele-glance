# Tele-Glance Engineering Learnings

Durable lessons from the D7 / D8 / F / D9 fix rounds (2026-06-02/03).
Full context in `docs/harness-test-failures.md`; this file is the short,
opinionated summary for future contributors.

---

## 1. Enforce symmetric invariants across every screen-model branch

The chats focus branch of `screenModel` was setting `panelBody` and
`panelBox` simultaneously when a chat had a long preview, painting the
ASCII-bordered box text and the native bordered container at the same
`x=184, y=54, w=376, h=190` region — "ghost text everywhere" on real G2
hardware. The topics and messages focus branches already had the
`msg.box ? '' : msg.body` guard. **The chats branch forgot.**

**Rule:** when you have N branches in a switch that should all enforce
the same invariant, the test catalog must cover every branch, not just
the obvious ones. Add a regression test the moment you add a branch.

## 2. `summarizeScreenModel` truncation hides body-content bugs

The harness's `summarizeScreenModel` collapses `panelBody` to
`panelBodyLength` (an integer) for log events. The catalog's
`renderBodyContains` assertions look for body text in the JSON, so a
bug that leaks box text into the body shows up as
`"panelBodyLength": 343` — the test still sees a number, not the
leaked text. The D9 ghost-text bug was visible only on the actual
glasses, not in any test event.

**Rule:** for body-content assertions, either (a) include enough of
the body in the summary to match the catalog needles, or (b) cover
the body-content invariant with a `screenModel` unit test that
inspects the full model, not the summary.

## 3. Timestamp-based event filters, not index-based

The original harness captured `eventStartIndex = testEvents.length`
*immediately after* `await postInput(...)` returned. The controller's
reaction events are emitted asynchronously by the Vite app and got
polled into `testEvents` BEFORE `eventStartIndex` was captured. The
subsequent `testEvents.slice(eventStartIndex)` filter then excluded
the very events the assertions were looking for. Every step's
`latestRender` / `latestState` came back `null` and every `waitFor*
` call timed out, masking every other assertion in the catalog.

**Rule:** when the boundary is "events that happen after this input",
capture `Date.now()` AFTER `postInput` and filter by `event.ts >=
boundary`. Treat any `from` value above `1e12` as a millisecond
timestamp, anything below as a legacy index. The legacy path keeps
older callers honest.

## 4. Share a `stepDeadline` across all `waitForTestEvent` calls

A step with `state + renderBodyContains + bridgeCall + noRenderEvents`
checks was getting `budgetMs × 4` of wall time. A 500ms budget allowed
2 seconds of harness work even though the step's actual budget was
500ms.

**Rule:** compute `const stepDeadline = Date.now() + budgetMs` once per
step and thread it through every `waitForTestEvent` call. `waitForTestEvent`
accepts either an absolute deadline (preferred) or a legacy timeout-ms
for backward compat.

## 5. Steps with no input use `eventStartTime = 0`

Startup, injection, and `setMode` steps have no input to anchor against.
A `Date.now() - 100` boundary excludes the controller's reaction events
that were emitted before the harness even called `executeStep`. Those
events are still valid for the startup assertions.

**Rule:** for steps with no input, use `eventStartTime = 0` so the
controller's startup / injection events are still findable. For steps
with input, capture `Date.now()` AFTER the input posts so pre-input
events (e.g. an inactivity-sleep transition) don't pollute the filter.

## 6. Optimistic flag updates can race with async renders

The round-7 fix added `lastRenderedHasPanelBox` to track which panelBox
visibility the bridge has actually rendered. The flag was updated
*before* the `enqueueRender` deferred render completed. If a second
`setStateForListScroll` happened inside the 50ms render-defer window,
the partial-render path was taken because the flag already said "no
transition", but the bridge hadn't actually moved the box container
yet. The partial render only updates content, not position. Net
effect: a box at the visible position with empty content.

**This is NOT what the user's "all messages ghost text" report was
about** (that was D9, the missing `msg.box` guard in the chats
focus). But it's a latent issue worth fixing: update the flag AFTER
the render completes (use a `pendingFullRenderVisibility` shadow
state), or force a full render while one is in flight.

**Rule:** when a flag tracks "what the bridge has rendered", don't
update it optimistically. Either await the render, or maintain a
separate "last submitted" and "last rendered" pair.

## 7. `TextContainerUpgrade` only updates content, not position

`TextContainerUpgrade.content` is set, but the container's
`xPosition / yPosition / width / height / borderWidth` are NOT
updatable through the SDK. A container can only be repositioned by
`rebuildPageContainer`, which is a full page rebuild.

**Rule:** any time the panelBox visibility flips (`defined` ↔
`undefined`), a partial render is unsafe. The controller must call
`enqueueRender` (full rebuild) on the transition. The bridge-side
log of `rebuildPageContainer` makes this verifiable from the harness.

## 8. Real G2 firmware selection events can race with swipes

On real G2 hardware, a swipe can be followed by a list-selection event
with the same index. The dispatcher's auto-press path converts a
same-index `selectIndex` into a `press` after a 600ms arming window.
Without a swipe-aware debounce, the auto-press fired before the user
had a chance to intentionally tap.

**Rule:** track `lastSwipeAt` at the top of `dispatch()` and have the
auto-press path bail if `Date.now() - lastSwipeAt < 450ms`. Default
to 450ms — long enough to cover the firmware's post-swipe event burst,
short enough that intentional press-after-swipe still feels snappy.

## 9. `wordCount > 25` (not `>=`) is the box threshold

`formatMessageBlocks` calls `formatMessageBox` only when
`wordCount(text) > 25` (strict greater-than). A test text with exactly
25 words silently falls through to the compact path and gets
`{ text: '...', box: undefined }`. This bit me in D9's regression
test: the first iteration used `'lorem ipsum dolor sit amet '.repeat(5)`
which trims to exactly 25 words and bypasses the box.

**Rule:** for any box-format regression test, use a text that
unambiguously exceeds the threshold (e.g. `.repeat(6)` → 30 words
trimmed, comfortably `> 25`).

## 10. The simulator `renderBodyContains` catalog can't see body content

`simulator-flow.mjs` checks `JSON.stringify(model).includes(needle)`
against the harness's test events. `summarizeScreenModel` truncates
`panelBody` to `panelBodyLength`, so body-content assertions only
work if the needle is also a number, the string `null`, or a field
name in the summary. The catalog currently passes for `panelBox` and
`sidebarItemCount` and `panelFooter` etc., but not for body text.

**Rule:** regenerate the `renderBodyContains` needles to match summary
fields, or include the first ~80 chars of `panelBody` in the
summary. The first option is mechanical; the second is faster.

## 11. H. pre-existing failures: what the harness still can't catch

- **Summarized model fields** (point 10): `renderBodyContains` can't
  detect body-content regressions.
- **Controller `handleAsleep` wake-then-stale-state**: a `double_click`
  on the `asleep` state logs the `wake` lifecycle but `latestState`
  still reads `asleep` in the JSON. The `enqueueNotify` uses
  `setTimeout(0)` and likely races with whatever the input frame
  processed before it.
- **Latency budget recalibration**: most steps are over their 500ms
  budget because of capture overhead, not real slowness.

These are all follow-ups, not regressions from D7/D8/F/D9.

---

## D-series fix index

| ID | Round | Severity | Symptom | Root cause | Test that catches it |
|---|---|---|---|---|---|
| D7 | 7 | user-visible (CRITICAL) | Ghost text box after topic→topic swipe | Partial render updates content, not box container position | `forces a full rebuild when the topic-list panelBox visibility flips` (controller.test.ts) |
| D8 | 7 | user-visible | Scroll on real G2 fires a press | Native list-selection event after a swipe auto-triggers press | `suppresses the auto-press path on the same-index selection fired right after a swipe` (controller.test.ts) |
| F | 8 | harness | `latestRender: null` everywhere | `eventStartIndex` captured before controller events arrived; per-`waitForTestEvent` budget | N/A — harness-internal fix |
| D9 | 9 | user-visible (CRITICAL) | All messages showing ghost text on chats list | Chats focus screen-model branch missing `msg.box ? '' :` guard | `does not double-render boxed chat previews as body text` (model.test.ts) |

---

## Files touched across these rounds

- `web/src/controller/model.ts` — chats focus panelBox check (D9)
- `web/src/controller/appController.ts` — `lastRenderedHasPanelBox` and `lastSwipeAt` (D7/D8)
- `web/src/bridge/evenBridge.ts` — `rebuildPageContainer` / `createStartUpPageContainer` / `textContainerUpgrade` bridge logs (D7)
- `scripts/simulator-flow.mjs` — timestamp-based event filter, shared `stepDeadline`, no-input `eventStartTime=0` (F)
- `docs/UI_INVARIANTS.json` — new `19a-topics-box-to-no-box-swipe` step (D7)
- `web/test/model.test.ts` — chats panelBox regression test (D9)
- `web/test/controller.test.ts` — D7 and D8 tests
- `docs/harness-test-failures.md` — D7/D8/F/D9 entries with root cause, why-it-wasn't-caught analysis, and verification
