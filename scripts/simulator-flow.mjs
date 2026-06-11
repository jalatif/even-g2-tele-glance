#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

async function cleanOldArtifacts(kind) {
  const dir = path.join(repoRoot, 'artifacts', kind)
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch { return }
  const dirs = entries
    .filter(e => e.isDirectory())
    .map(e => ({ name: e.name, ts: e.name.replace(/T(\d+)-(\d+)-(\d+)-(\d+)Z$/, 'T$1:$2:$3.$4Z') }))
    .map(e => ({ name: e.name, mtime: new Date(e.ts).getTime() }))
    .filter(e => !isNaN(e.mtime))
    .sort((a, b) => b.mtime - a.mtime)
  // Keep the newest existing dir, remove the rest
  for (let i = 1; i < dirs.length; i++) {
    await rm(path.join(dir, dirs[i].name), { recursive: true, force: true }).catch(() => {})
  }
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.join(repoRoot, 'web')
const args = parseArgs(process.argv.slice(2))
const vitePort = Number(args['vite-port'] ?? process.env.VITE_PORT ?? 5173)
const automationPort = Number(args['automation-port'] ?? 9898)
const testHost = process.env.TELEGLANCE_TEST_HOST ?? 'localhost'
const updateGoldens = Boolean(args['update-goldens'])
const fastMode = Boolean(args['fast'])
const skipLatencyCheck = Boolean(args['skip-latency-check'])
const runMode = args['mode'] ?? 'fixture'
const isFixtureMode = runMode === 'fixture'
// --external-simulator: do NOT spawn a simulator subprocess; point simUrl at
// an instance the user started manually. Use this when the harness-spawned
// simulator crashes but the user's own instance is healthy, or when the
// user is iterating against a long-lived external simulator session.
// --simulator-url overrides the auto-derived simUrl (default
// http://localhost:9898/).
const externalSimulator = Boolean(args['external-simulator'])
const externalSimulatorUrl = args['simulator-url'] ?? null
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const artifactRoot = path.join(repoRoot, 'artifacts', 'simulator-flow', timestamp)
const framesDir = path.join(artifactRoot, 'frames')
const stepDir = path.join(artifactRoot, 'steps')
const goldenRoot = path.join(webRoot, 'test', 'simulator-goldens')
const testUrl = `http://${testHost}:${vitePort}/${isFixtureMode ? '?teleGlanceFixture=1' : ''}`
const simUrl = externalSimulatorUrl ?? `http://${testHost}:${automationPort}`
const children = []
let frameIndex = 0
let recording = true
let recorderBusy = false
let recorder
let consoleSinceId = 0
const consoleEntries = []
const containerFailures = []  // simulator 'TextContainerUpgrade failed' warnings, with step + ts
let currentPageGeneration = 0
const pageGenerationMismatches = []  // partial render events with wrong generation
const stalePartialRenderEvents = []  // render.partial.stale events

let currentStepName = null
// Map of process name -> handle returned by startProcess. Used by executeStep
// to detect when the simulator subprocess has died and skip the remaining
// catalog steps instead of emitting dozens of misleading timeout failures.
const processHandles = new Map()
let cleanupRan = false
function runSyncCleanup() {
  if (cleanupRan) return
  cleanupRan = true
  if (recorder) { try { clearInterval(recorder) } catch { /* ignore */ } }
  for (const handle of processHandles.values()) {
    if (handle?._probe) { try { clearInterval(handle._probe) } catch { /* ignore */ } }
  }
  for (const handle of [...processHandles.values()].reverse()) {
    try { stopProcessTree(handle) } catch { /* ignore */ }
  }
  // process.exit is sync; halts the event loop so children are not reaped
  // asynchronously and reparented to init.
  process.exit(130)
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  try { process.on(signal, runSyncCleanup) } catch { /* ignore on platforms without the signal */ }
}
process.on('uncaughtException', (error) => {
  console.error(`[harness] uncaughtException: ${error?.stack ?? error}`)
  runSyncCleanup()
})
const testEvents = []
const latencies = []
const failures = []
const warnings = []
const fixtureApiCalls = []
const fixtureLifecycle = []
const fixtureRecording = []
const fixturesSent = []
// Real-mode harness state. The catalog is fixture-shaped, so in real mode we cannot
// assert on chat titles, topic counts, or message text. Instead we track the latest
// observed app state and decompose step latency into the four phases the user cares
// about: input dispatch, state transition, native render, and capture.
let currentScreen = 'unknown'
let currentFocus = undefined
const asleepNoOps = []
const realModeApiTimings = []
const realModePerInputLatencies = []
const realModeRenderLatencies = []
const realModeStateTransitions = []
const realModeInputDispatchSamples = []
const realModeStateWorkSamples = []
const realModeQueueDepthSamples = []
let catalog = null
let testConsoleBridge = false

await cleanOldArtifacts('simulator-flow')
await mkdir(framesDir, { recursive: true })
await mkdir(stepDir, { recursive: true })
await mkdir(goldenRoot, { recursive: true })
catalog = await loadCatalog()
testConsoleBridge = true
try {
  const vite = startProcess('vite', 'npm', ['run', 'dev', '--', '--host', testHost, '--port', String(vitePort)], {
    cwd: webRoot,
    env: { ...process.env, ...(isFixtureMode ? { VITE_TELEGLANCE_FIXTURE: '1' } : {}) },
  })
  await waitForHttp(testUrl, 20_000)

  let simulator
  if (externalSimulator) {
    // External mode: the user started their own simulator. We verify the
    // URL is reachable, then register a synthetic handle so the per-step
    // "simulator alive?" guard in executeStep still has something to
    // inspect. The handle's /api/ping probe runs every 2s; on two
    // consecutive failures the handle is marked dead and remaining
    // steps are SKIPPED.
    await waitForHttp(`${simUrl}/api/ping`, 20_000, 'pong')
    console.log(`[harness] external simulator: ${simUrl}`)
    simulator = await registerExternalSimulatorHandle(simUrl)
  } else {
    simulator = startProcess('simulator', 'npx', [
      '@evenrealities/evenhub-simulator@0.7.2',
      '--automation-port',
      String(automationPort),
      testUrl,
    ], { cwd: repoRoot })
    await waitForHttp(`${simUrl}/api/ping`, 20_000, 'pong')
    await clearConsole()
  }

  recorder = setInterval(() => {
    void recordFrame().catch((error) => {
      warnings.push(`video frame capture failed: ${String(error)}`)
    })
  }, 1250)

  await runFlow()
} catch (error) {
  failures.push(`flow error: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  recording = false
  if (recorder) clearInterval(recorder)
  await recordFrame().catch((error) => warnings.push(`final frame capture failed: ${String(error)}`))
  await writeArtifacts().catch((error) => failures.push(`artifact write failed: ${String(error)}`))
  await writeReport().catch((error) => failures.push(`report write failed: ${String(error)}`))

  if (failures.length > 0) {
    console.error(`Simulator validation failed. Artifacts: ${artifactRoot}`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exitCode = 1
  } else {
    console.log(`Simulator validation completed. Artifacts: ${artifactRoot}`)
    if (warnings.length > 0) {
      console.log('Warnings:')
      for (const warning of warnings) console.log(`- ${warning}`)
    }
  }

  for (const handle of [...processHandles.values()].reverse()) {
    stopProcessTree(handle)
  }
}

async function loadCatalog() {
  const file = path.join(repoRoot, 'docs', 'UI_INVARIANTS.json')
  const raw = await readFile(file, 'utf8')
  return JSON.parse(raw)
}

async function runFlow() {
  // Drive the steps in order from the catalog. The catalog is the source of truth.
  for (let index = 0; index < catalog.steps.length; index += 1) {
    const step = catalog.steps[index]
    const url = `${testUrl}${index === 0 ? '' : `&step=${index}`}`
    await executeStep(step, url)
  }
}

async function executeStep(step, _url) {
  const failuresBeforeStep = failures.length
  currentStepName = step.name
  // If the simulator subprocess died earlier, every subsequent fetch / poll
  // would time out and produce a misleading "timed out waiting for
  // TeleGlanceTest event" failure. Skip the step with one clear, attributable
  // failure instead. The "skipped" marker is grep-friendly so the report
  // reader can see at a glance which steps were short-circuited.
  const simulatorHandle = processHandles.get('simulator')
  if (simulatorHandle && !simulatorHandle.alive) {
    failures.push(`${step.name}: SKIPPED — simulator subprocess already exited (${simulatorHandle.crashMessage ?? `code ${simulatorHandle.exitCode} signal ${simulatorHandle.signalCode}`})`)
    console.log(`[flow] skip ${step.name}: simulator dead`)
    return
  }
  const name = step.name
  const target = step.target
  const expect = step.expect ?? {}
  const budgetMs = step.budgetMs ?? 1000
  const targetContract = catalog.screens[target] ?? {}
  const expectedState = isFixtureMode
    ? { ...(targetContract.state ?? {}), ...(expect.state ?? {}) }
    : null
  const expectedRender = isFixtureMode ? targetContract.render ?? null : null
  const targetEventStart = expect.targetEventRequired === false ? 0 : undefined

  // Flush all events from the previous step before establishing this step's
  // boundary. Index boundaries are deterministic even when the browser and
  // harness clocks drift, which is common on phone hardware.
  await pollConsole()
  const eventStartIndex = testEvents.length

  if (step.input === 'testSlowChat') {
    await sendTestCommand({ kind: 'setMode', mode: 'slow' })
    await sendTestCommand({ kind: 'setSlowChats', ms: 1200 })
    await sendTestCommand({ kind: 'reinitialize' })
  }
  if (step.input === 'testError') {
    await sendTestCommand({ kind: 'setMode', mode: 'error' })
    await sendTestCommand({ kind: 'reinitialize' })
  }
  if (step.input === 'testNotify') {
    await sendTestCommand({ kind: 'setInjectedNotification', chatId: 'fixture-chat-0', message: 'New fixture message' })
  }
  if (step.input === 'audioChunk') {
    const pcm = await readFile(path.join(webRoot, 'test', 'fixtures', 'recording-sample.pcm'))
    await sendTestCommand({ kind: 'injectAudioChunks', pcmBase64: pcm.toString('base64') })
  }
  const perInputLatencies = []
  if (step.input === 'click' || step.input === 'double_click' || step.input === 'up' || step.input === 'down') {
    const dispatchStart = Date.now()
    await postInput(step.input, {})
    const dispatchMs = Date.now() - dispatchStart
    perInputLatencies.push({ action: step.input, ms: dispatchMs })
    if (!isFixtureMode) {
      realModePerInputLatencies.push({ name, action: step.input, ms: dispatchMs, screen: currentScreen })
      if (currentScreen === 'asleep' && step.input !== 'double_click') {
        asleepNoOps.push({ name, action: step.input, ts: Date.now() })
      }
    }
  }
  if (typeof step.input === 'string' && step.input.startsWith('pressSequence:')) {
    const tokens = step.input.slice('pressSequence:'.length).split(',')
    for (const token of tokens) {
      const mapped = token === 'click' ? 'click' : token === 'double_click' ? 'double_click' : token === 'down' ? 'down' : token === 'up' ? 'up' : null
      if (mapped) {
        const startedAt = Date.now()
        await postInput(mapped, {})
        const dispatchMs = Date.now() - startedAt
        perInputLatencies.push({ action: mapped, ms: dispatchMs })
        // A single click is deliberately delayed by the app while it waits for
        // a possible second click. Let it resolve before sending a gesture meant
        // for the next screen. Swipes remain rapid so burst/coalescing tests keep
        // exercising the hardware-rate path.
        await sleep(mapped === 'click' ? 380 : mapped === 'double_click' ? 100 : 60)
        if (!isFixtureMode) {
          realModePerInputLatencies.push({ name, action: mapped, ms: dispatchMs, screen: currentScreen })
          if (currentScreen === 'asleep' && mapped !== 'double_click') {
            asleepNoOps.push({ name, action: mapped, ts: Date.now() })
          }
        }
      }
    }
  }

  // Input and fixture-command steps use the deterministic event index captured
  // before the action. Observation-only steps use the full event history because
  // they intentionally validate async work started by the previous step.
  const stepHasInput = step.input !== null && step.input !== undefined
  const eventStartTime = stepHasInput ? eventStartIndex : 0
  const startedAt = Date.now()
  // All `waitForTestEvent` calls in this step share a single deadline so the
  // total step latency is bounded by `budgetMs` instead of `budgetMs * callCount`.
  const stepDeadline = Date.now() + budgetMs + (step.expectToFail ? 2_000 : 0)
  if (expectedState && Object.keys(expectedState).length > 0) {
    // Strict state predicates are fixture-shaped. In real mode, the catalog still
    // emits them so a no-op can be detected, but we do not fail the run if a real
    // chat/topic/message happens to be present.
    const predicate = makeStatePredicate(expectedState)
    await waitForTestEvent(`${name}: state ${JSON.stringify(expectedState)}`, predicate, stepDeadline, targetEventStart ?? eventStartTime)
  }
  if (expectedRender) {
    await waitForTestEvent(
      `${name}: render contract ${JSON.stringify(expectedRender)}`,
      (event) => event.event === 'render' && matchesRenderContract(event.model, expectedRender),
      stepDeadline,
      targetEventStart ?? eventStartTime,
    )
  }
  if (expect.renderBodyContains && isFixtureMode) {
    // The catalog renderBodyContains strings reference fixture-only chat/topic titles
    // and message bodies. Skipping in real mode keeps the harness useful for parity
    // checks without false negatives from the user's real Telegram data.
    await waitForTestEvent(
      `${name}: render contains ${expect.renderBodyContains.join(', ')}`,
      (event) => event.event === 'render' && expect.renderBodyContains.every((needle) => `${JSON.stringify(event.model ?? {})}`.includes(needle)),
      stepDeadline,
      eventStartTime,
    )
  }
  if (isFixtureMode && expect.renderBodyContainsAny) {
    // For multi-page scroll tests: every needle must appear in
    // SOME render during the step window. The fixture embeds
    // `topic-N-m<M>` anchors in each message so the harness can
    // assert "I saw message M of topic N" without parsing the
    // controller's state.messages structure. `stepDeadline` is
    // already an absolute future timestamp set by executeStep;
    // do not add `Date.now()` to it again.
    const seen = new Set()
    while (Date.now() < stepDeadline && seen.size < expect.renderBodyContainsAny.length) {
      for (const event of testEvents) {
        if (!eventMatchesFrom(event, eventStartTime)) continue
        if (event.event !== 'render') continue
        const haystack = JSON.stringify(event.model ?? {})
        for (const needle of expect.renderBodyContainsAny) {
          if (haystack.includes(needle)) seen.add(needle)
        }
      }
      if (seen.size >= expect.renderBodyContainsAny.length) break
      await sleep(80)
    }
    for (const needle of expect.renderBodyContainsAny) {
      if (!seen.has(needle)) failures.push(`${name}: expected render content "${needle}" not found in any render during the step window`)
    }
  }
  const expectedApiCalls = isFixtureMode
    ? [...new Set([...(step.apiCalls ?? []), ...(expect.apiCalls ?? [])])]
    : []
  for (const call of expectedApiCalls) {
    await waitForTestEvent(
      `${name}: api ${call}`,
      (event) => event.event === 'api' && matchesExpectedApiCall(event, call),
      stepDeadline,
      eventStartTime,
    )
  }
  if (isFixtureMode && expect.apiCall) {
    const { call, args } = expect.apiCall
    await waitForTestEvent(
      `${name}: api ${call}`,
      (event) => event.event === 'api' && event.call === call && (!args || matchesArgs(event.args, args)),
      stepDeadline,
      eventStartTime,
    )
  }
  if (expect.apiCallNotPresent) {
    const forbidden = expect.apiCallNotPresent
    await sleep(50)
    const seen = testEvents.some((event) => eventMatchesFrom(event, eventStartTime) && event.event === 'api' && event.call === forbidden)
    if (seen) failures.push(`${name}: forbidden api call ${forbidden} was made`)
  }
  if (isFixtureMode && expect.bridgeCall) {
    const expected = expect.bridgeCall
    await waitForTestEvent(
      `${name}: bridge ${expected.method}`,
      (event) => event.event === 'bridge' && event.method === expected.method && (expected.args === undefined || JSON.stringify(event.args) === JSON.stringify(expected.args)),
      stepDeadline,
      eventStartTime,
    )
  }
  if (expect.bridgeCallNotPresent) {
    const forbidden = expect.bridgeCallNotPresent
    await sleep(50)
    const seen = testEvents.some((event) => eventMatchesFrom(event, eventStartTime) && event.event === 'bridge' && event.method === forbidden)
    if (seen) failures.push(`${name}: forbidden bridge call ${forbidden} was made`)
  }
  for (const requiredEvent of step.eventMustEmit ?? []) {
    await waitForTestEvent(
      `${name}: event ${requiredEvent.event}${requiredEvent.kind ? `/${requiredEvent.kind}` : ''}`,
      (event) => event.event === requiredEvent.event
        && (requiredEvent.kind === undefined || event.kind === requiredEvent.kind)
        && (!requiredEvent.match || matchesArgs(event, requiredEvent.match)),
      stepDeadline,
      eventStartTime,
    )
  }
  if (isFixtureMode && expect.noRenderEvents) {
    const renderCount = testEvents.filter((event) => eventMatchesFrom(event, eventStartTime) && event.event === 'render' && !event.partial).length
    if (renderCount > 0) failures.push(`${name}: expected zero full render events during chat list scroll, saw ${renderCount}`)
  }
  if (isFixtureMode && expect.noLifecycles) {
    // The G2 simulator (and to a lesser extent the real G2 hardware) can fire
    // `doublePress` events from system-event sources (eventType: 3,
    // eventSource: 1) when nothing is happening. Each pair sends the
    // controller to `asleep` and back. On real G2 this happens once per
    // screen-timeout (~30s); on the simulator it fires every 4-9s. The user
    // perceives this as "scroll doesn't work" or "I select something and
    // something else opens up". This matcher asserts that NO matching
    // lifecycle events fired during the step's input window, so a regression
    // in the simulator's idle behavior (or in the controller's system-event
    // filtering) is caught.
    const forbiddenKinds = new Set(expect.noLifecycles)
    const seen = testEvents.filter((event) => eventMatchesFrom(event, eventStartTime)
      && event.event === 'lifecycle'
      && forbiddenKinds.has(event.kind))
    if (seen.length > 0) {
      const kinds = [...new Set(seen.map((event) => event.kind))]
      failures.push(`${name}: expected no ${kinds.join(', ')} lifecycle events during step, saw ${seen.length} (the simulator is firing idle doublePress events; the controller is bouncing to asleep and back)`)
    }
  }
  if (isFixtureMode && expect.maxPerSwipeMs && perInputLatencies.length > 0) {
    for (const item of perInputLatencies) {
      if (item.ms > expect.maxPerSwipeMs) failures.push(`${name}: per-input latency ${item.ms}ms exceeds ${expect.maxPerSwipeMs}ms (action=${item.action})`)
    }
  }
  await sleep(150)
  await pollConsole()
  const captureStartedAt = Date.now()
  const glasses = await captureStep(name, expect, { perInputLatencies, eventStartTime, failuresBeforeStep })
  const totalMs = Date.now() - startedAt
  const captureMs = Date.now() - captureStartedAt
  latencies.push({ name, totalMs, captureMs, budgetMs, perInputLatencies })
  if (isFixtureMode && step.expectToFail) {
    if (totalMs > budgetMs) {
      console.log(`[flow] EXPECTED FAIL: ${name} exceeded ${budgetMs}ms (actual ${totalMs}ms)`)
    } else {
      failures.push(`${name}: expected to exceed ${budgetMs}ms but only took ${totalMs}ms (the latency-budget negative test is broken)`)
    }
  } else if (!skipLatencyCheck && totalMs > budgetMs) {
    failures.push(`${name}: total ${totalMs}ms exceeds budget ${budgetMs}ms (latency budget violated)`)
  }
  if (glasses.blank && !fastMode) {
    // Blank screenshots are compared to their golden in validateGolden above.
    // If the golden also has minimal content the pixel diff will be small;
    // if the golden has real content the diff will trigger a failure there.
    // This downgrades the standalone blank-gate to a diagnostic-only warning.
    warnings.push(`${name}: glasses screenshot is blank (only ${glasses.uniqueColors} unique colors, all near selection-border green) — golden comparison used for pass/fail`)
  }
  const stepFailed = failures.length > failuresBeforeStep
  console.log(`[flow] ${stepFailed ? 'fail' : 'ok'} ${name}: ${totalMs}ms`)
  currentStepName = null
}

function makeStatePredicate(expected) {
  return (event) => {
    if (event.event !== 'state') return false
    for (const [key, value] of Object.entries(expected)) {
      if (event[key] !== value) return false
    }
    return true
  }
}

function matchesArgs(actual, expected) {
  if (!expected) return true
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(actual?.[key]) !== JSON.stringify(value)) return false
  }
  return true
}

function matchesExpectedApiCall(event, expected) {
  const spec = String(expected)
  const [call] = spec.split(' with ')
  if (event.call !== call) return false
  if (spec.includes('beforeId')) {
    const beforeId = event.args?.beforeId ?? event.args?.options?.beforeId
    return beforeId !== undefined && beforeId !== null
  }
  return true
}

function matchesRenderContract(model, expected) {
  if (!model) return false
  for (const key of ['kind', 'title', 'focus', 'fullWidth']) {
    if (expected[key] !== undefined && model[key] !== expected[key]) return false
  }
  return true
}

async function postInput(action, payload) {
  const response = await fetchWithTimeout(`${simUrl}/api/input`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  }, 3_000)
  if (!response.ok) failures.push(`simulator input ${action} returned ${response.status}`)
}

async function sendTestCommand(command) {
  const response = await fetchWithTimeout(`${vitePort ? `http://${testHost}:${vitePort}` : ''}/api/test/fixture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  }, 3_000)
  if (!response.ok) failures.push(`vite /api/test/fixture ${command.kind} returned ${response.status}`)
}

async function captureStep(name, expectations, extras = {}) {
  const eventStartTime = extras.eventStartTime ?? 0
  const glassesPath = path.join(stepDir, `${name}.glasses.png`)
  const webviewPath = path.join(stepDir, `${name}.webview.png`)
  await downloadWithRetry(`${simUrl}/api/screenshot/glasses`, glassesPath, 5)
  const webviewCaptured = await downloadWithRetry(`${simUrl}/api/screenshot/webview`, webviewPath, 5).catch((error) => {
    warnings.push(`${name}: webview screenshot unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return false
  })
  const glassesPng = await readPng(glassesPath)
  const analysis = analyzePng(glassesPng)
  let blank = isBlankScreenshot(analysis)
  await validateGolden(name, glassesPng, blank)
  // Do not substitute a desktop screenshot for the glasses surface. It can show
  // unrelated windows and turn a failed glasses capture into a false pass.
  const latestRender = latestTestEvent('render', eventStartTime)
  const latestState = latestTestEvent('state', eventStartTime)
  const contentMatches = isFixtureMode ? checkContentMatches(expectations, latestRender, latestState) : true
  if (isFixtureMode && expectations.renderBodyContains && latestRender) {
    for (const needle of expectations.renderBodyContains) {
      const haystack = JSON.stringify(latestRender.model ?? {})
      if (!haystack.includes(needle)) failures.push(`${name}: expected render content "${needle}" not found`)
    }
  }
  if (isFixtureMode && expectations.renderBodyNotContains && latestRender) {
    const haystack = JSON.stringify(latestRender.model ?? {})
    for (const needle of expectations.renderBodyNotContains) {
      if (haystack.includes(needle)) failures.push(`${name}: expected render model to NOT contain "${needle}" but it did (stale data leaking through)`)
    }
  }
  // Page-generation validation: partial render events must carry the same
  // generation as the most recent full render. A mismatch means a stale
  // enqueued or delayed partial update targeted a page that was rebuilt.
  const stepPageMismatches = pageGenerationMismatches.filter((m) => m.step === name)
  if (stepPageMismatches.length > 0) {
    for (const m of stepPageMismatches) {
      failures.push(`${name}: partial render carried generation ${m.eventGeneration} but current page is generation ${m.currentGeneration} — a full rebuild invalidated a queued partial update that was not discarded by the bridge`)
    }
  }
  // render.partial.stale events indicate the bridge correctly discarded a stale
  // partial update. In a healthy run these should not occur; each one means an
  // async controller operation (topic preview, poll, read-ack) built a model for
  // a page that was already replaced. Track them as warnings so the catalog can
  // be tightened over time.
  const stepStaleEvents = stalePartialRenderEvents.filter((e) => e.step === name)
  for (const e of stepStaleEvents) {
    warnings.push(`${name}: bridge discarded stale partial render (generation ${e.expectedGeneration} vs current ${e.currentGeneration}, reason: ${e.reason}) — async work produced a model for a replaced page`)
  }
  await writeFile(path.join(stepDir, `${name}.json`), JSON.stringify({
    name,
    expectations,
    latestRender,
    latestState,
    contentMatches,
    failures: failures.slice(extras.failuresBeforeStep ?? failures.length),
    events: testEvents.filter((event) => eventMatchesFrom(event, eventStartTime)),
    perInputLatencies: extras.perInputLatencies ?? [],
    glasses: {
      path: glassesPath,
      sha256: sha256(await readFile(glassesPath)),
      ...analysis,
      blank,
    },
    webview: {
      path: webviewCaptured ? webviewPath : null,
      sha256: webviewCaptured ? sha256(await readFile(webviewPath)) : null,
    },
  }, null, 2))
  return { blank, uniqueColors: analysis.uniqueColors }
}

function checkContentMatches(expectations, latestRender, latestState) {
  if (!expectations.renderBodyContains) return true
  const haystack = `${JSON.stringify(latestRender?.model ?? {})}\n${JSON.stringify(latestState ?? {})}`
  return expectations.renderBodyContains.every((needle) => haystack.includes(needle))
}

function isBlankScreenshot(analysis) {
  if (analysis.uniqueColors > 5) return false
  // Detect the "all-green" LVGL selection-border case from @evenrealities/evenhub-simulator@0.7.2
  let allGreenish = true
  for (const { r, g, b, a } of analysis.colors) {
    if (a === 0) continue
    if (Math.abs(r) > 30 || Math.abs(b) > 30) {
      allGreenish = false
      break
    }
  }
  return allGreenish
}

function latestTestEvent(eventName, from = 0) {
  // `from` may be a numeric index (legacy) or a millisecond timestamp; normalize to
  // a predicate so the caller can pick whichever is more convenient. The default of
  // 0 keeps the legacy "look at every event" behavior.
  const matches = (event) => {
    if (typeof from === 'number' && from > 1_000_000_000_000) return typeof event.ts === 'number' && event.ts >= from
    if (typeof from === 'number' && from > 0) return Number(event._harnessIndex) >= from
    return true
  }
  for (let i = testEvents.length - 1; i >= 0; i -= 1) {
    const event = testEvents[i]
    if (!matches(event)) continue
    if (event.event === eventName) return event
  }
  return undefined
}

function eventMatchesFrom(event, from) {
  if (typeof from === 'number' && from > 1_000_000_000_000) {
    return typeof event.ts === 'number' && event.ts >= from
  }
  if (typeof from === 'number' && from > 0) return Number(event._harnessIndex) >= from
  return true
}

async function validateGolden(name, actual, blank) {
  const goldenPath = path.join(goldenRoot, `${name}.glasses.png`)
  if (blank) return
  if (updateGoldens || !existsSync(goldenPath)) {
    const source = await readFile(path.join(stepDir, `${name}.glasses.png`))
    await writeFile(goldenPath, source)
    if (!updateGoldens) warnings.push(`${name}: golden did not exist; wrote initial golden`)
    return
  }
  const expected = await readPng(goldenPath)
  if (expected.width !== actual.width || expected.height !== actual.height) {
    warnings.push(`${name}: golden dimensions (${expected.width}x${expected.height}) differ from current (${actual.width}x${actual.height}); skipping comparison. Regenerate goldens with --update-goldens.`)
    return
  }
  const diff = pixelDiff(expected, actual)
  if (diff.differentPixels > 120) {
    failures.push(`${name}: golden mismatch (${diff.differentPixels} pixels changed; budget is 120)`)
  }
}

async function waitForTestEvent(label, predicate, deadlineOrTimeout, from = 0) {
  const deadline = deadlineOrTimeout > 1_000_000_000_000 ? deadlineOrTimeout : Date.now() + deadlineOrTimeout
  const findMatch = () => {
    for (let i = testEvents.length - 1; i >= 0; i -= 1) {
      const event = testEvents[i]
      if (!eventMatchesFrom(event, from)) break
      if (predicate(event)) return true
    }
    return false
  }
  if (findMatch()) return Date.now()
  while (Date.now() < deadline) {
    await pollConsole()
    if (findMatch()) return Date.now()
    await sleep(50)
  }
  // The final poll can complete just after the deadline. Scan once more so an
  // event emitted within the step is not reported missing merely because an
  // earlier assertion consumed the shared wait budget.
  await pollConsole()
  if (findMatch()) return Date.now()
  failures.push(`${label}: timed out waiting for expected TeleGlanceTest event`)
  return Date.now()
}

async function pollConsole() {
  const response = await fetchWithTimeout(`${simUrl}/api/console?since_id=${consoleSinceId}`, undefined, 3_000)
  if (!response.ok) throw new Error(`console poll failed: ${response.status}`)
  const payload = await response.json()
  const entries = payload.entries ?? []
  for (const entry of entries) {
    consoleSinceId = Math.max(consoleSinceId, Number(entry.id ?? 0))
    if (isConsoleError(entry)) failures.push(`console ${entry.level}: ${entry.message}`)
    captureContainerFailure(entry)
    const event = parseTestEvent(entry.message)
    if (event) {
      event._harnessIndex = testEvents.length
      testEvents.push(event)
      if (event.event === 'api') {
        fixtureApiCalls.push(event)
      } else if (event.event === 'api.timing') {
        realModeApiTimings.push(event)
      } else if (event.event === 'lifecycle') {
        fixtureLifecycle.push(event)
      } else if (event.event === 'recording') {
        fixtureRecording.push(event)
      } else if (event.event === 'state') {
        const previousScreen = currentScreen
        currentScreen = typeof event.screen === 'string' ? event.screen : currentScreen
        currentFocus = event.focus ?? undefined
        if (!isFixtureMode && previousScreen !== 'unknown' && previousScreen !== currentScreen) {
          realModeStateTransitions.push({ from: previousScreen, to: currentScreen, ts: event.ts ?? Date.now() })
        }
      } else if (event.event === 'render') {
        if (!isFixtureMode && typeof event.durationMs === 'number') {
          realModeRenderLatencies.push({ ts: event.ts ?? Date.now(), durationMs: event.durationMs, partial: Boolean(event.partial) })
        }
        // Track page generation: full renders set the current generation.
        // Partial updates are validated against the current generation.
        if (typeof event.generation === 'number') {
          if (!event.partial) {
            // Full render: update current page generation.
            currentPageGeneration = event.generation
          } else {
            // Partial render: validate against current page generation.
            if (event.generation !== currentPageGeneration) {
              pageGenerationMismatches.push({
                step: currentStepName,
                eventGeneration: event.generation,
                currentGeneration: currentPageGeneration,
                ts: Date.now(),
              })
            }
          }
        }
      } else if (event.event === 'render.partial.stale') {
        stalePartialRenderEvents.push({
          step: currentStepName,
          expectedGeneration: event.expectedGeneration,
          currentGeneration: event.currentGeneration,
          reason: event.reason,
          ts: Date.now(),
        })
      } else if (event.event === 'input.dispatch') {
        if (!isFixtureMode) {
          realModeInputDispatchSamples.push({ ts: event.ts ?? Date.now(), listenerMs: event.listenerMs, mappedKind: event.mappedKind, context: event.context })
        }
      } else if (event.event === 'state.work') {
        if (!isFixtureMode) {
          realModeStateWorkSamples.push({ ts: event.ts ?? Date.now(), kind: event.kind, syncMs: event.syncMs, screen: event.screen, focus: event.focus })
        }
      } else if (event.event === 'bridge.queueDepth') {
        if (!isFixtureMode) {
          realModeQueueDepthSamples.push({ ts: event.ts ?? Date.now(), reason: event.reason, partialInFlight: event.partialInFlight, partialPending: event.partialPending, fullRenderInFlight: event.fullRenderInFlight })
        }
      }
    }
    const storedEntry = sanitizeConsoleEntry(entry)
    if (storedEntry) consoleEntries.push(storedEntry)
  }
}

function sanitizeConsoleEntry(entry) {
  const message = String(entry.message ?? '')
  if (message.includes('[ShadowTimers]')) return undefined
  if (message.includes('"audioPcm"')) return undefined
  return {
    ...entry,
    message: message.length > 4000 ? `${message.slice(0, 4000)}... [truncated]` : message,
  }
}

function parseTestEvent(message) {
  if (typeof message !== 'string') return undefined
  const marker = '[TeleGlanceTest] '
  const index = message.indexOf(marker)
  if (index < 0) return undefined
  try {
    const parsed = JSON.parse(message.slice(index + marker.length))
    return parsed
  } catch {
    failures.push(`could not parse TeleGlanceTest log: ${message}`)
    return undefined
  }
}

function isConsoleError(entry) {
  const level = String(entry.level ?? '').toLowerCase()
  const message = String(entry.message ?? '')
  return level === 'error'
    || message.includes('[uncaught]')
    || message.includes('[unhandledrejection]')
    || message.includes('[fetch]')
    || message.includes('glyph dsc. not found')
}

// Match the simulator's "TextContainerUpgrade failed: container N not found"
// warning that the G2 simulator emits when the WebView calls textContainerUpgrade
// for a container ID the current page layout does not own. These are NOT marked
// as console errors by isConsoleError, so without this helper the harness would
// silently ignore them. They are a load-bearing signal: each warning means the
// panel body, panel box, or sidebar text did not update visually, which is the
// exact class of bug ("ghost text", "stale panel", "right-side not refreshing")
// the user can see on the glasses but the harness state checks cannot detect.
function captureContainerFailure(entry) {
  const message = String(entry?.message ?? '')
  const match = message.match(/TextContainerUpgrade failed: container (\d+) not found/)
  if (!match) return
  const containerId = Number(match[1])
  // Every TextContainerUpgrade failure is a release-gating bug. The bridge now
  // prevents stale partial updates via page-generation gating, so any occurrence
  // here means a real container-layout mismatch that must be fixed.
  failures.push(`${currentStepName ?? 'unknown'}: simulator rejected textContainerUpgrade for container ${containerId} — panel body / box / sidebar did not update visually`)
  containerFailures.push({
    step: currentStepName,
    containerId,
    level: entry.level,
    message,
    ts: Date.now(),
  })
}
async function recordFrame() {
  if (!recording || recorderBusy || fastMode) return
  recorderBusy = true
  try {
    const file = path.join(framesDir, `${String(frameIndex).padStart(5, '0')}.png`)
    await downloadWithRetry(`${simUrl}/api/screenshot/webview`, file, 2)
    frameIndex += 1
  } finally {
    recorderBusy = false
  }
}

async function makeVideo() {
  if (fastMode) return
  const frames = (await readdir(framesDir)).filter((name) => name.endsWith('.png')).sort()
  if (frames.length === 0) {
    warnings.push('no video frames captured')
    return
  }
  await runCommand('ffmpeg', [
    '-y',
    '-framerate',
    '4',
    '-i',
    path.join(framesDir, '%05d.png'),
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-pix_fmt',
    'yuv420p',
    path.join(artifactRoot, 'flow.mp4'),
  ])
}

async function writeArtifacts() {
  await pollConsole().catch((error) => {
    warnings.push(`final console poll failed: ${error instanceof Error ? error.message : String(error)}`)
  })
  await writeFile(path.join(artifactRoot, 'console.json'), JSON.stringify({ entries: consoleEntries, testEvents }, null, 2))
  await writeFile(path.join(artifactRoot, 'latency.json'), JSON.stringify({ latencies, warnings, failures, containerFailures, pageGeneration: {
    current: currentPageGeneration,
    mismatches: pageGenerationMismatches,
    staleEvents: stalePartialRenderEvents,
  }, realMode: {
    perInputLatencies: realModePerInputLatencies,
    renderLatencies: realModeRenderLatencies,
    apiTimings: realModeApiTimings,
    stateTransitions: realModeStateTransitions,
    asleepNoOps,
    inputDispatch: realModeInputDispatchSamples,
    stateWork: realModeStateWorkSamples,
    bridgeQueueDepth: realModeQueueDepthSamples,
    currentScreen,
  } }, null, 2))
}

async function writeReport() {
  const lines = [
    '# TeleGlance Simulator Flow',
    '',
    `- URL: ${testUrl}`,
    `- Mode: ${runMode}`,
    `- Fixture mode: ${isFixtureMode ? 'enabled' : 'disabled'}`,
    `- Failures: ${failures.length}`,
    `- Warnings: ${warnings.length}`,
    '',
    ...(processHandles.size > 0 ? [
      '## Subprocess health',
      '',
      '`External` indicates the harness did NOT spawn this process; it was supplied by the user via --external-simulator / --simulator-url. The PID is `n/a` because the harness never owned the process and cannot terminate it on shutdown.',
      '',
      '| Name | PID | External | Alive | Exited at | Exit code | Signal |',
      '| --- | ---: | :---: | :---: | --- | ---: | --- |',
      ...[...processHandles.values()].map((h) => {
        const alive = h.alive
        const exited = h.exitedAt ?? '-'
        const code = h.exitCode ?? '-'
        const signal = h.signalCode ?? '-'
        return `| ${h.name} | ${h.pid ?? 'n/a'} | ${h.external ? 'yes' : 'no'} | ${alive ? 'yes' : 'no'} | ${exited} | ${code} | ${signal} |`
      }),
    ] : []),
    '',
     '## Latency',
    '',
    '| Step | Total ms | Budget ms | Capture ms |',
    '| --- | ---: | ---: | ---: |',
    ...latencies.map((item) => `| ${item.name} | ${Math.round(item.totalMs)} | ${item.budgetMs} | ${Math.round(item.captureMs)} |`),
    '',
    ...(realModePerInputLatencies.length || realModeRenderLatencies.length ? [
      '## Real-mode latency buckets',
      '',
      `- Final observed screen: ${currentScreen}${currentFocus ? ` (focus=${currentFocus})` : ''}`,
      '',
      '| Action | Dispatch ms | Screen |',
      '| --- | ---: | --- |',
      ...realModePerInputLatencies.slice(-50).map((item) => `| ${item.action} | ${Math.round(item.ms)} | ${item.screen} |`),
      '',
      '| Render (last 50) | Duration ms | Partial |',
      '| --- | ---: | --- |',
      ...realModeRenderLatencies.slice(-50).map((item, idx) => `| render#${idx} | ${Math.round(item.durationMs)} | ${item.partial ? 'yes' : 'no'} |`),
    ] : []),
    '',
    ...(realModeInputDispatchSamples.length ? [
      '## Input dispatch latency',
      '',
      '`input.dispatch` events from the Even Hub SDK listener. `listenerMs` is the time spent inside the `onEvenHubEvent` callback before the coalesced dispatch. `pb` = prefetch active, `qi` = input quiet.',
      '',
      '| listenerMs | mappedKind | bgWork | inQuiet |',
      '| ---: | --- | --- | --- |',
      ...realModeInputDispatchSamples.slice(-50).map((item) => `| ${Math.round(item.listenerMs * 100) / 100} | ${item.mappedKind ?? '-'} | ${item.context?.backgroundWorkActive ? 'yes' : '-'} | ${item.context?.inputQuiet ? 'yes' : '-'} |`),
    ] : []),
    '',
    ...(realModeStateWorkSamples.length ? [
      '## setState sync work',
      '',
      '`state.work` events from the controller. `syncMs` is the time inside `setState*` (applyState + screenModel + bridge enqueue). Bucketed by kind.',
      '',
      '| Kind | syncMs | Screen |',
      '| --- | ---: | --- |',
      ...realModeStateWorkSamples.slice(-50).map((item) => `| ${item.kind} | ${Math.round(item.syncMs * 100) / 100} | ${item.screen}${item.focus ? `/${item.focus}` : ''} |`),
    ] : []),
    '',
    ...(realModeQueueDepthSamples.length ? [
      '## Bridge queue depth',
      '',
      '`bridge.queueDepth` snapshots. `pIF` = partial in‑flight, `pPend` = partial pending.',
      '',
      '| Reason | pIF | pPend | fullRF | dispatched | dropped | flushed |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...realModeQueueDepthSamples.slice(-30).map((item) => `| ${item.reason} | ${item.partialInFlight} | ${item.partialPending} | ${item.fullRenderInFlight} | ${item.dispatched ?? '-'} | ${item.dropped ?? '-'} | ${item.flushed ?? '-'} |`),
    ] : []),
    ...(asleepNoOps.length ? [
      '## Asleep no-op inputs',
      '',
      'Inputs sent while the screen was off that the controller is expected to drop. Real-mode only.',
      '',
      ...asleepNoOps.slice(-30).map((evt) => `- ${evt.name}: ${evt.action} at ${new Date(evt.ts).toISOString()}`),
    ] : []),
    ...(containerFailures.length ? [
      '## Container upgrade failures',
      '',
      'Simulator rejected `textContainerUpgrade` calls for a container the current page layout does not own. Each rejected call means the panel body, panel box, or sidebar text did not update visually on the glasses. These are exactly the bugs that look like "ghost text" or "right side not refreshing" on hardware but pass the state-only harness checks.',
      '',
      '| Step | Container ID | Level |',
      '| --- | ---: | --- |',
      ...containerFailures.slice(-50).map((evt) => `| ${evt.step ?? '-'} | ${evt.containerId} | ${evt.level} |`),
    ] : []),
    ...(pageGenerationMismatches.length ? [
      '## Page-generation mismatches',
      '',
      'Partial render events that carried a generation older than the current page. Each mismatch means the bridge allowed a stale partial update to target a rebuilt page — a bug in the bridge generation-gating logic.',
      '',
      '| Step | Event gen | Current gen |',
      '| --- | ---: | ---: |',
      ...pageGenerationMismatches.slice(-50).map((m) => `| ${m.step ?? '-'} | ${m.eventGeneration} | ${m.currentGeneration} |`),
    ] : []),
    ...(stalePartialRenderEvents.length ? [
      '## Stale partial render discards',
      '',
      'The bridge correctly discarded a stale partial update. Async controller work (topic preview, poll, read-ack) produced a model for a page that was already replaced.',
      '',
      '| Step | Expected gen | Current gen | Reason |',
      '| --- | ---: | ---: | --- |',
      ...stalePartialRenderEvents.slice(-50).map((e) => `| ${e.step ?? '-'} | ${e.expectedGeneration} | ${e.currentGeneration} | ${e.reason} |`),
    ] : []),
    '',
    ...(realModeApiTimings.length ? [
      '## Real-mode API timings',
      '',
      '`api.timing` events emitted by `InstrumentedTelegramApi` in real mode. No message text, no phone numbers, no session strings — only call name, ids, and durations.',
      '',
      ...realModeApiTimings.slice(-30).map((evt) => `- ${evt.call} ${JSON.stringify(evt.args ?? {})} (${evt.durationMs}ms, ok=${evt.ok})`),
    ] : []),
    '',
    ...(isFixtureMode ? [
      '## Fixture API calls',
      '',
      ...(fixtureApiCalls.length ? fixtureApiCalls.slice(-30).map((call) => `- ${call.call} ${JSON.stringify(call.args ?? {})} (${call.durationMs}ms, ok=${call.ok})`) : ['- None']),
    ] : ['## Mode', '', `- Real data mode: no fixture API calls tracked`]),
    '',
    '## Lifecycle events',
    '',
    ...(fixtureLifecycle.length ? fixtureLifecycle.map((evt) => `- ${evt.kind} ${JSON.stringify(evt)}`) : ['- None']),
    '',
    '## Recording flow',
    '',
    ...(fixtureRecording.length ? fixtureRecording.map((evt) => `- ${evt.kind} ${JSON.stringify(evt)}`) : ['- None']),
    '',
    '## Warnings',
    '',
    ...(warnings.length ? warnings.map((warning) => `- ${warning}`) : ['- None']),
    '',
    '## Failures',
    '',
    ...(failures.length ? failures.map((failure) => `- ${failure}`) : ['- None']),
    '',
    '## Artifacts',
    '',
    '- `flow.mp4`',
    '- `latency.json`',
    '- `console.json`',
    '- `fixture.json`',
    '- `steps/*.png`',
  ]
  await writeFile(path.join(artifactRoot, 'report.md'), `${lines.join('\n')}\n`)
}

async function clearConsole() {
  await fetchWithTimeout(`${simUrl}/api/console`, { method: 'DELETE' }, 3_000)
  consoleSinceId = 0
}

function startProcess(name, command, commandArgs, options) {
  const child = spawn(command, commandArgs, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  children.push(child)
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
  // Track subprocess liveness. Once it exits with a non-zero code or any
  // signal that is not SIGTERM, every subsequent step in the catalog is
  // guaranteed to fail with a timeout, a fetch error, or a stale state. We
  // surface the crash in the report and skip the remaining steps instead
  // of emitting dozens of misleading "timed out waiting for TeleGlanceTest
  // event" failures that hide the real cause.
  const handle = {
    name,
    pid: child.pid,
    child,
    get alive() {
      return child.exitCode === null && child.signalCode === null
    },
    exitCode: null,
    signalCode: null,
    exitedAt: undefined,
    crashMessage: undefined,
  }
  child.on('exit', (code, signal) => {
    handle.exitCode = code
    handle.signalCode = signal
    handle.exitedAt = new Date().toISOString()
    if (code !== 0 && signal !== 'SIGTERM') {
      const why = code !== null
        ? `exited with code ${code}`
        : `killed by signal ${signal}`
      handle.crashMessage = `${name} ${why}; every subsequent harness step will be skipped because the subprocess died. Common causes: tokio panic (look for "panicked at" in stderr above), OOM, or a port already in use.`
      failures.push(handle.crashMessage)
    }
  })
  processHandles.set(name, handle)
  return handle
}

// External-simulator handle: a thin adapter over a URL the user supplied.
// The `alive` flag is set false on two consecutive /api/ping failures so a
// sudden external-simulator crash surfaces the same way as a spawned
// subprocess crash (with a SKIPPED marker on remaining steps).
async function registerExternalSimulatorHandle(url) {
  let alive = true
  let exitCode = null
  let signalCode = null
  let exitedAt = undefined
  let crashMessage = undefined
  const handle = {
    name: 'simulator',
    pid: undefined,
    child: undefined,
    external: true,
    url,
    get alive() {
      return alive && exitCode === null && signalCode === null
    },
    exitCode: null,
    signalCode: null,
    exitedAt: undefined,
    crashMessage: undefined,
  }
  let consecutiveFailures = 0
  const probe = setInterval(() => {
    void fetchWithTimeout(`${url}/api/ping`, undefined, 1_000)
      .then(async (response) => {
        const text = await response.text().catch(() => '')
        const ok = response.ok && text.trim() === 'pong'
        if (!ok) {
          consecutiveFailures += 1
          if (consecutiveFailures >= 2 && alive) {
            alive = false
            exitCode = 1
            exitedAt = new Date().toISOString()
            crashMessage = `external simulator at ${url} stopped responding to /api/ping; remaining steps will be skipped`
            handle.exitCode = exitCode
            handle.signalCode = signalCode
            handle.exitedAt = exitedAt
            handle.crashMessage = crashMessage
            failures.push(crashMessage)
          }
        } else {
          consecutiveFailures = 0
        }
      })
      .catch(() => {
        consecutiveFailures += 1
        if (consecutiveFailures >= 2 && alive) {
          alive = false
          exitCode = 1
          exitedAt = new Date().toISOString()
          crashMessage = `external simulator at ${url} stopped responding to /api/ping; remaining steps will be skipped`
          handle.exitCode = exitCode
          handle.signalCode = signalCode
          handle.exitedAt = exitedAt
          handle.crashMessage = crashMessage
          failures.push(crashMessage)
        }
      })
  }, 2_000)
  handle._probe = probe
  processHandles.set('simulator', handle)
  return handle
}

function stopProcessTree(handle) {
  // External handles have no child process to terminate; the harness did not
  // spawn the simulator and the user owns the lifecycle. Just no-op.
  if (handle?.external) return
  const child = handle?.child ?? handle
  if (!child || child.killed) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}
async function waitForHttp(url, timeoutMs, expectedText) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(url, undefined, 3_000)
      const text = await response.text()
      if (response.ok && (expectedText === undefined || text.trim() === expectedText)) return
    } catch {
      // Retry until timeout.
    }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}`)
}


async function download(url, file) {
  const response = await fetchWithTimeout(url, undefined, 3_000)
  if (!response.ok) throw new Error(`download failed ${url}: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(file, bytes)
  return true
}

async function downloadWithRetry(url, file, attempts) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await download(url, file)
    } catch (error) {
      lastError = error
      await sleep(150)
    }
  }
  throw lastError
}

async function runCommand(command, commandArgs) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: 'inherit' })
    child.on('exit', (code) => {
      if (code === 0) resolve(undefined)
      else reject(new Error(`${command} exited ${code}`))
    })
  }).catch((error) => {
    warnings.push(String(error instanceof Error ? error.message : error))
  })
}

async function readPng(file) {
  const bytes = await readFile(file)
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`)
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  let bitDepth = 0
  const idat = []
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const data = bytes.subarray(dataStart, dataStart + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    offset = dataStart + length + 4
  }
  if (bitDepth !== 8 || colorType !== 6) throw new Error(`${file} must be 8-bit RGBA PNG`)
  const inflated = zlib.inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const pixels = Buffer.alloc(width * height * 4)
  let sourceOffset = 0
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset++]
    const row = inflated.subarray(sourceOffset, sourceOffset + stride)
    sourceOffset += stride
    const outOffset = y * stride
    unfilterRow(filter, row, pixels, outOffset, y === 0 ? undefined : pixels.subarray(outOffset - stride, outOffset), 4)
  }
  return { width, height, pixels }
}

function unfilterRow(filter, row, output, outOffset, previous, bpp) {
  for (let x = 0; x < row.length; x += 1) {
    const left = x >= bpp ? output[outOffset + x - bpp] : 0
    const up = previous ? previous[x] : 0
    const upLeft = previous && x >= bpp ? previous[x - bpp] : 0
    let value = row[x]
    if (filter === 1) value += left
    else if (filter === 2) value += up
    else if (filter === 3) value += Math.floor((left + up) / 2)
    else if (filter === 4) value += paeth(left, up, upLeft)
    else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`)
    output[outOffset + x] = value & 0xff
  }
}

function paeth(left, up, upLeft) {
  const p = left + up - upLeft
  const pa = Math.abs(p - left)
  const pb = Math.abs(p - up)
  const pc = Math.abs(p - upLeft)
  if (pa <= pb && pa <= pc) return left
  if (pb <= pc) return up
  return upLeft
}

function analyzePng(png) {
  const colors = new Set()
  const colorList = []
  let nonTransparentPixels = 0
  for (let i = 0; i < png.pixels.length; i += 4) {
    const r = png.pixels[i]
    const g = png.pixels[i + 1]
    const b = png.pixels[i + 2]
    const a = png.pixels[i + 3]
    if (a > 0) nonTransparentPixels += 1
    if (colors.size <= 256) {
      const key = `${r},${g},${b},${a}`
      if (!colors.has(key)) {
        colors.add(key)
        colorList.push({ r, g, b, a })
      }
    }
  }
  return { width: png.width, height: png.height, uniqueColors: colors.size, nonTransparentPixels, colors: colorList }
}

function pixelDiff(left, right) {
  if (left.width !== right.width || left.height !== right.height) {
    return { differentPixels: Number.POSITIVE_INFINITY }
  }
  let differentPixels = 0
  for (let i = 0; i < left.pixels.length; i += 4) {
    const delta = Math.abs(left.pixels[i] - right.pixels[i])
      + Math.abs(left.pixels[i + 1] - right.pixels[i + 1])
      + Math.abs(left.pixels[i + 2] - right.pixels[i + 2])
      + Math.abs(left.pixels[i + 3] - right.pixels[i + 3])
    if (delta > 16) differentPixels += 1
  }
  return { differentPixels }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
function fetchWithTimeout(url, init, timeoutMs) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...(init ?? {}), signal: controller.signal }).finally(() => clearTimeout(timeout))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(values) {
  const parsed = {}
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]
    if (!value.startsWith('--')) continue
    const key = value.slice(2)
    const next = values[index + 1]
    if (!next || next.startsWith('--')) parsed[key] = true
    else {
      parsed[key] = next
      index += 1
    }
  }
  return parsed
}
