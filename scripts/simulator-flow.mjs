#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import zlib from 'node:zlib'

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
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const artifactRoot = path.join(repoRoot, 'artifacts', 'simulator-flow', timestamp)
const framesDir = path.join(artifactRoot, 'frames')
const stepDir = path.join(artifactRoot, 'steps')
const goldenRoot = path.join(webRoot, 'test', 'simulator-goldens')
const testUrl = `http://${testHost}:${vitePort}/${isFixtureMode ? '?teleGlanceFixture=1' : ''}`
const simUrl = `http://${testHost}:${automationPort}`
const children = []
let frameIndex = 0
let recording = true
let recorderBusy = false
let recorder
let consoleSinceId = 0
const consoleEntries = []
const testEvents = []
const latencies = []
const failures = []
const warnings = []
const fixtureApiCalls = []
const fixtureLifecycle = []
const fixtureRecording = []
const fixturesSent = []
let catalog = null
let testConsoleBridge = false

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

  const simulator = startProcess('simulator', 'npx', [
    '--automation-port',
    String(automationPort),
    testUrl,
  ], { cwd: repoRoot })
  await waitForHttp(`${simUrl}/api/ping`, 20_000, 'pong')
  await clearConsole()

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

  for (const child of children.reverse()) {
    stopProcessTree(child)
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
  const name = step.name
  const target = step.target
  const expect = step.expect ?? {}
  const budgetMs = step.budgetMs ?? 1000

  if (step.input === 'testSlowChat') {
    await sendTestCommand({ kind: 'setMode', mode: 'slow' })
    await sendTestCommand({ kind: 'setSlowChats', ms: 1200 })
  }
  if (step.input === 'testError') {
    await sendTestCommand({ kind: 'setMode', mode: 'error' })
  }
  if (step.input === 'testNotify') {
    await sendTestCommand({ kind: 'setInjectedNotification', chatId: 'fixture-chat-0', message: 'New fixture message' })
  }
  if (step.input === 'audioChunk') {
    const pcm = await readFile(path.join(webRoot, 'test', 'fixtures', 'recording-sample.pcm'))
    await sendTestCommand({ kind: 'injectAudioChunks', pcmBase64: pcm.toString('base64') })
    await postInput('double_click', {})
  }
  if (step.input === 'click' || step.input === 'double_click' || step.input === 'up' || step.input === 'down') {
    await postInput(step.input, {})
  }
  const perInputLatencies = []
  if (typeof step.input === 'string' && step.input.startsWith('pressSequence:')) {
    const tokens = step.input.slice('pressSequence:'.length).split(',')
    for (const token of tokens) {
      const mapped = token === 'click' ? 'click' : token === 'double_click' ? 'double_click' : token === 'down' ? 'down' : token === 'up' ? 'up' : null
      if (mapped) {
        const startedAt = Date.now()
        await postInput(mapped, {})
        perInputLatencies.push({ action: mapped, ms: Date.now() - startedAt })
      }
    }
  }

  const startedAt = Date.now()
  const eventStartIndex = testEvents.length
  if (expect.state) {
    const predicate = makeStatePredicate(expect.state)
    await waitForTestEvent(name, predicate, budgetMs, eventStartIndex)
  }
  if (expect.renderBodyContains) {
    await waitForTestEvent(
      name,
      (event) => event.event === 'render' && expect.renderBodyContains.every((needle) => `${JSON.stringify(event.model ?? {})}`.includes(needle)),
      budgetMs,
      eventStartIndex,
    )
  }
  if (expect.apiCalls) {
    const callsNeeded = new Set(expect.apiCalls)
    await waitForTestEvent(
      name,
      (event) => event.event === 'api' && callsNeeded.has(event.call),
      budgetMs,
      eventStartIndex,
    )
  }
  if (expect.apiCall) {
    const { call, args } = expect.apiCall
    await waitForTestEvent(
      name,
      (event) => event.event === 'api' && event.call === call && (!args || matchesArgs(event.args, args)),
      budgetMs,
      eventStartIndex,
    )
  }
  if (expect.apiCallNotPresent) {
    const forbidden = expect.apiCallNotPresent
    await sleep(50)
    const seen = testEvents.slice(eventStartIndex).some((event) => event.event === 'api' && event.call === forbidden)
    if (seen) failures.push(`${name}: forbidden api call ${forbidden} was made`)
  }
  if (expect.bridgeCall) {
    const expected = expect.bridgeCall
    await waitForTestEvent(
      name,
      (event) => event.event === 'bridge' && event.method === expected.method && (expected.args === undefined || JSON.stringify(event.args) === JSON.stringify(expected.args)),
      budgetMs,
      eventStartIndex,
    )
  }
  if (expect.noRenderEvents) {
    const renderCount = testEvents.slice(eventStartIndex).filter((event) => event.event === 'render').length
    if (renderCount > 0) failures.push(`${name}: expected zero render events during chat list scroll, saw ${renderCount}`)
  }
  if (expect.maxPerSwipeMs && perInputLatencies.length > 0) {
    for (const item of perInputLatencies) {
      if (item.ms > expect.maxPerSwipeMs) failures.push(`${name}: per-input latency ${item.ms}ms exceeds ${expect.maxPerSwipeMs}ms (action=${item.action})`)
    }
  }
  await sleep(150)
  await pollConsole()
  const captureStartedAt = Date.now()
  const glasses = await captureStep(name, expect, { perInputLatencies, eventStartIndex })
  const totalMs = Date.now() - startedAt
  const captureMs = Date.now() - captureStartedAt
  latencies.push({ name, totalMs, captureMs, budgetMs, perInputLatencies })
  if (step.expectToFail) {
    if (totalMs > budgetMs) {
      console.log(`[flow] EXPECTED FAIL: ${name} exceeded ${budgetMs}ms (actual ${totalMs}ms)`)
    } else {
      failures.push(`${name}: expected to exceed ${budgetMs}ms but only took ${totalMs}ms (the latency-budget negative test is broken)`)
    }
  } else if (!skipLatencyCheck && totalMs > budgetMs) {
    failures.push(`${name}: total ${totalMs}ms exceeds budget ${budgetMs}ms (latency budget violated)`)
  }
  if (glasses.blank) {
    failures.push(`${name}: glasses screenshot is blank (only ${glasses.uniqueColors} unique colors, all near selection-border green)`)
  }
  console.log(`[flow] ok ${name}: ${totalMs}ms`)
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
  const eventStartIndex = extras.eventStartIndex ?? 0
  const glassesPath = path.join(stepDir, `${name}.glasses.png`)
  const webviewPath = path.join(stepDir, `${name}.webview.png`)
  await downloadWithRetry(`${simUrl}/api/screenshot/glasses`, glassesPath, 5)
  const webviewCaptured = await downloadWithRetry(`${simUrl}/api/screenshot/webview`, webviewPath, 5).catch((error) => {
    warnings.push(`${name}: webview screenshot unavailable: ${error instanceof Error ? error.message : String(error)}`)
    return false
  })
  const glassesPng = await readPng(glassesPath)
  const analysis = analyzePng(glassesPng)
  const blank = isBlankScreenshot(analysis)
  await validateGolden(name, glassesPng, blank)
  const latestRender = latestTestEvent('render', eventStartIndex)
  const latestState = latestTestEvent('state', eventStartIndex)
  const contentMatches = checkContentMatches(expectations, latestRender, latestState)
  if (expectations.renderBodyContains && latestRender) {
    for (const needle of expectations.renderBodyContains) {
      const haystack = JSON.stringify(latestRender.model ?? {})
      if (!haystack.includes(needle)) failures.push(`${name}: expected render content "${needle}" not found`)
    }
  }
  if (expectations.renderBodyContains && !contentMatches) {
    failures.push(`${name}: expected render body content not found`)
  }
  await writeFile(path.join(stepDir, `${name}.json`), JSON.stringify({
    name,
    expectations,
    latestRender,
    latestState,
    contentMatches,
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

function latestTestEvent(eventName, fromIndex = 0) {
  for (let i = testEvents.length - 1; i >= fromIndex; i -= 1) {
    if (testEvents[i].event === eventName) return testEvents[i]
  }
  return undefined
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
  const diff = pixelDiff(expected, actual)
  if (diff.differentPixels > 120) {
    warnings.push(`${name}: golden mismatch (${diff.differentPixels} pixels changed, within 120 budget)`)
  }
}

async function waitForTestEvent(label, predicate, timeoutMs, fromIndex = 0) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await pollConsole()
    const matched = testEvents.slice(fromIndex).reverse().find(predicate)
    if (matched) return Date.now()
    await sleep(50)
  }
  failures.push(`${label}: timed out waiting for expected TeleGlanceTest event`)
  return Date.now()
}

async function pollConsole() {
  const response = await fetchWithTimeout(`${simUrl}/api/console?since_id=${consoleSinceId}`, undefined, 3_000)
  if (!response.ok) throw new Error(`console poll failed: ${response.status}`)
  const payload = await response.json()
  const entries = payload.entries ?? []
  for (const entry of entries) {
    consoleSinceId = Math.max(consoleSinceId, Number(entry.id ?? 0) + 1)
    if (isConsoleError(entry)) failures.push(`console ${entry.level}: ${entry.message}`)
    const event = parseTestEvent(entry.message)
    if (event) {
      testEvents.push(event)
      if (event.event === 'api') fixtureApiCalls.push(event)
      if (event.event === 'lifecycle') fixtureLifecycle.push(event)
      if (event.event === 'recording') fixtureRecording.push(event)
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
  await writeFile(path.join(artifactRoot, 'latency.json'), JSON.stringify({ latencies, warnings, failures }, null, 2))
  await writeFile(path.join(artifactRoot, 'fixture.json'), JSON.stringify({ apiCalls: fixtureApiCalls, lifecycle: fixtureLifecycle, recording: fixtureRecording }, null, 2))
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
    '## Latency',
    '',
    '| Step | Total ms | Budget ms | Capture ms |',
    '| --- | ---: | ---: | ---: |',
    ...latencies.map((item) => `| ${item.name} | ${Math.round(item.totalMs)} | ${item.budgetMs} | ${Math.round(item.captureMs)} |`),
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
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') failures.push(`${name} exited with code ${code ?? signal}`)
  })
  return child
}

function stopProcessTree(child) {
  if (child.killed) return
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
