# Glasses UI Harness Audit - 2026-06-10

## Executive result

The harness had several false-confidence paths. A catalog entry could declare an API
call or lifecycle event without the runner enforcing it, burst latency checks had an
empty sample array, and fuzzy UI-size checks referenced telemetry fields that no
longer existed. Random failures also could not be reproduced because no seed was
recorded.

The strict fixture run after enabling these contracts completed 56 catalog steps and
reported 91 assertion failures. These are not all application regressions. They are
evidence that the catalog, fixture timing, and current controller behavior have
drifted apart. The run is preserved under:

`artifacts/simulator-flow/2026-06-10T16-16-21-099Z`

## Fixed in this audit

- Every step inherits and enforces the target screen's state and render shape.
- Every API call declared by a step is checked, not merely one member of the list.
- `listMessages with beforeId` verifies the argument rather than only the call name.
- Step-level `eventMustEmit` lifecycle/recording declarations are enforced.
- Burst input latency now records every posted input and enforces `maxPerSwipeMs`.
- Step event windows use harness indexes, avoiding browser/host clock drift.
- Each step artifact now includes its event window and attributable failures.
- Timeout messages identify the missing state, render, API, bridge, or lifecycle contract.
- Render telemetry includes `fullWidth` and actual sidebar items.
- Fuzzy S3 checks now read the emitted telemetry fields instead of dead field names.
- Fuzzy runs accept and report `--seed`, and print an exact replay command.
- Fuzzy runs enforce input callback, state-work, and bridge queue bounds.
- The fuzzy console cursor no longer skips every immediately following event.
- Golden image mismatches are failures rather than warnings.
- Catalog validation rejects duplicate step names and unknown expectation keys.

## Repair pass status

The first repair pass classified and corrected the strict catalog failures caused by
stale cache/API assumptions, shared-deadline event scanning, unrealistic press timing,
long-message page expectations, fixture notification state, and recording injection.
Fixture PCM now enters through the controller command hook, so recording assertions no
longer depend on an unrelated gesture or simulator microphone timing.

Current validation evidence:

- Strict 56-step fixture catalog: zero unexpected failures at
  `artifacts/simulator-flow/2026-06-10T16-37-14-090Z`.
- Seeded 100-input fuzzy run: zero failures with seed `424242` at
  `artifacts/fuzzy-test/2026-06-10T16-37-53-768Z`.
- Frontend unit suite: 120 tests pass; TypeScript typecheck is clean.

The simulator still emits intermittent `TextContainerUpgrade failed: container 5/6
not found` warnings during lifecycle transitions. The current catalog records these,
but a later bridge-generation repair must eliminate them and promote any occurrence to
a release-gating failure.

## Highest-priority remaining gaps

### P0 - Make the fixture catalog clean and semantically current

The strict run exposes stale assumptions around cached API calls, preview timing,
recording progression, and the latency-negative fixture. Each failure must be
classified as one of: application bug, fixture bug, stale expectation, simulator
limitation, or performance regression. Do not raise budgets until the phase timing
shows which component consumed the time.

Historical validation documents still describe the earlier 48-step catalog. Active
testing instructions now treat the JSON catalog as the source of truth; generated
documentation tables/counts are still needed to prevent future drift.

### P0 - Add end-to-end input correlation

Current timing samples are separate streams. Add an `interactionId` at native event
receipt and carry it through:

`input.received -> input.mapped -> controller.dispatch -> state.commit -> render.enqueue -> bridge.start -> bridge.end -> visible confirmation`

Without correlation, percentile reports can identify slow events but cannot prove
which render or API operation belonged to a specific gesture.

Record p50/p95/p99 and maximum for each phase. Release gates should use p95 plus a
hard maximum, not averages.

### P0 - Validate actual bridge payloads

Screen-model telemetry is necessary but insufficient. Capture the complete sanitized
`PageContainer` and `TextContainerUpgrade` payloads and validate:

- container IDs are unique and stable across every transition;
- exactly one input-capturing container exists;
- geometry stays inside 576x288;
- hidden containers are truly hidden and contain no stale text;
- all text fields satisfy UTF-8 byte limits after sanitization;
- full/partial updates target containers owned by the current page generation;
- a partial update cannot arrive after a newer full rebuild.

Add a monotonically increasing page generation to reject and diagnose stale upgrades.

### P0 - Build a hardware telemetry ingestion path

Simulator timing is not a substitute for G2 timing. Add a command that consumes a
device `[TeleGlanceTest]` JSON dump and produces the same report and release gates as
the simulator run. Store device model, firmware, phone model, app version, package
version, backend route, and network class with every run.

### P1 - Replace random-only fuzzing with model-based sequences

Keep seeded fuzzing, but add a model that predicts the exact next state and selection
for every gesture. Generate boundary-biased sequences for:

- first/last chat and topic rows;
- newest/oldest message pages;
- press inside the double-click window;
- swipe during full and partial renders;
- back during API, transcription, send, poll, and read-ack work;
- notification/update arrival during every screen;
- remount/unmount while timers and bridge work are pending.

On failure, persist the full input sequence and automatically minimize it.

### P1 - Add deterministic race and failure injection

Fixture APIs need per-call controls for delay, rejection, timeout, malformed payload,
duplicate response, out-of-order completion, and cancellation. Use fake time where
possible. Required races include:

- preview A resolves after selection moved to B;
- older-page load resolves after back navigation;
- polling resolves during active swipes;
- send succeeds while a new update arrives;
- read acknowledgement fails after optimistic badge clearing;
- bridge partial update stalls while a full rebuild supersedes it;
- React StrictMode remount occurs with an active listener and queued render.

### P1 - Expand content and byte-boundary coverage

Generate cases at 0, 1, limit-1, limit, and limit+1 UTF-8 bytes for every text field.
Include multi-byte scripts, combining marks, RTL text, newlines, Telegram formatting
characters, unsupported glyphs, very long unbroken words, empty sender/title/text,
and 1/20/21 list items. Assert final bridge bytes, not JavaScript character counts.

### P1 - Add release-quality visual evidence

Keep blank glasses captures as a hard simulator capability signal. Add a separate
webview golden diff as secondary evidence, never as a replacement for the glasses
framebuffer. Produce diff images, changed-pixel percentage, bounding boxes, and a
baseline approval workflow. Do not auto-create missing goldens in a release run.

### P1 - Add coverage and soak gates

Reports should include screen, transition, gesture, API, bridge method, error path,
and race-scenario coverage. A release run should fail if required coverage is absent.

Add soak profiles for 10, 30, and 60 minutes that gate on:

- no listener/timer/poll growth;
- bounded event buffer and render queue depth;
- no duplicate API subscriptions;
- stable memory use;
- no input loss during sustained rapid navigation;
- no long-running state beyond its deadline.

## Recommended release matrix

1. Unit/model tests with fake time and exhaustive boundaries.
2. Strict fixture catalog with zero unexpected failures.
3. Seeded model-based fuzz runs using a fixed CI seed set plus one recorded random seed.
4. Simulator visual/bridge-payload validation.
5. Real-data simulator latency and API profile without content assertions.
6. Real G2 hardware smoke, latency, and 30-minute soak on the release package.

A release is high-confidence only when all six surfaces produce attributable artifacts
and the expected-failure/known-limitation allowlist is explicit, versioned, and empty
of broad wildcard exceptions.
