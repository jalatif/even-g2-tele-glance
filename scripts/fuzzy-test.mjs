#!/usr/bin/env node

/**
 * Fuzzy test runner for TeleGlance glasses UI.
 *
 * Starts Vite + Even Hub simulator, drives 100+ random input sequences
 * (up/down/click/double_click). After each input, validates structural
 * invariants (state machine, UI rendering, performance).
 *
 * Usage:
 *   node scripts/fuzzy-test.mjs [iterations]
 *   node scripts/fuzzy-test.mjs 200 --mode real
 *
 * Default iterations: 100
 * Default mode: fixture
 */

import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const webRoot = path.join(repoRoot, 'web')
const args = parseArgs(process.argv.slice(2))
const iterations = Math.max(1, Math.min(1000, Number(process.argv[2] ?? 100) || 100))
const vitePort = Number(args['vite-port'] ?? process.env.VITE_PORT ?? 5173)
const automationPort = Number(args['automation-port'] ?? 9899)
const runMode = args['mode'] ?? 'fixture'
const isFixtureMode = runMode === 'fixture'
const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
const artifactRoot = path.join(repoRoot, 'artifacts', 'fuzzy-test', timestamp)
const testHost = process.env.TELEGLANCE_TEST_HOST ?? 'localhost'
const testUrl = `http://${testHost}:${vitePort}/${isFixtureMode ? '?teleGlanceFixture=1' : ''}`
const simUrl = `http://${testHost}:${automationPort}`
const INPUT_TYPES = ['up', 'down', 'click', 'double_click']

const children = []
const testEvents = []
const failures = []
const warnings = []
const transitionsHistory = []
let consoleSinceId = 0
let inputCount = 0

// --- Valid states and transitions (summarized AppState format) ---

const VALID_AUTH_MODES = new Set(['needsSetup', 'signedOut', 'phonePending'])
const VALID_SIDEBAR_FOCUS = new Set(['chats', 'topics', 'messages'])
const VALID_SCREENS = new Set([
  'loading', 'auth', 'sidebar', 'asleep', 'newMessage',
  'sidebarRecording', 'sidebarTranscribing', 'sidebarConfirm',
  'sidebarSending', 'sidebarSent', 'error',
])

const VALID_TRANSITIONS = {
  loading: ['auth', 'sidebar', 'error'],
  auth: ['sidebar', 'error'],
  sidebar: ['sidebar', 'asleep', 'newMessage', 'sidebarRecording',
    'sidebarTranscribing', 'sidebarConfirm', 'sidebarSending', 'sidebarSent', 'error'],
  asleep: ['sidebar', 'asleep', 'error'],
  newMessage: ['sidebar', 'asleep', 'error'],
  sidebarRecording: ['sidebarRecording', 'sidebarTranscribing', 'sidebar', 'error'],
  sidebarTranscribing: ['sidebarConfirm', 'sidebar', 'error'],
  sidebarConfirm: ['sidebarSending', 'sidebar', 'error'],
  sidebarSending: ['sidebarSent', 'error'],
  sidebarSent: ['sidebar', 'error'],
  error: [...VALID_SCREENS],
}

function isValidState(state) {
  if (!state || typeof state !== 'object') return 'state is not an object'
  const screen = state.screen
  if (!VALID_SCREENS.has(screen)) return `unknown screen: ${screen}`

  if (screen === 'auth') {
    if (!VALID_AUTH_MODES.has(state.mode)) return `invalid auth mode: ${state.mode}`
    if (!state.message) return 'auth without message'
  }

  if (screen === 'sidebar') {
    if (!VALID_SIDEBAR_FOCUS.has(state.focus)) return `invalid sidebar focus: ${state.focus}`
    if (state.focus === 'chats') {
      if (!Array.isArray(state.chats) || state.chats.length === 0) return 'chats focus without valid chats'
      if (state.selectedChatIndex < 0 || state.selectedChatIndex >= state.chats.length)
        return `selectedChatIndex ${state.selectedChatIndex} out of range`
    }
    if (state.focus === 'topics') {
      if (!state.chatTitle) return 'topics focus without chatTitle'
      if (!Array.isArray(state.topics) || state.topics.length === 0) return 'topics focus without topics'
      if (state.selectedTopicIndex < 0 || state.selectedTopicIndex >= state.topics.length)
        return `selectedTopicIndex ${state.selectedTopicIndex} out of range`
    }
    if (state.focus === 'messages') {
      if (!state.chatTitle) return 'messages focus without chatTitle'
      if (typeof state.scrollOffset !== 'number' || state.scrollOffset < 0)
        return `invalid scrollOffset: ${state.scrollOffset}`
    }
  }

  if (['sidebarRecording', 'sidebarTranscribing'].includes(screen)) {
    if (!state.chatTitle) return `${screen} without chatTitle`
    if (state.focus !== 'messages') return `${screen} with focus !== messages`
  }

  if (['sidebarConfirm', 'sidebarSending'].includes(screen)) {
    if (!state.transcript) return `${screen} without transcript`
    if (state.focus !== 'messages') return `${screen} with focus !== messages`
  }

  if (screen === 'sidebarSent' && state.focus !== 'messages') return 'sidebarSent focus !== messages'
  if (screen === 'error' && !state.message) return 'error without message'
  if (screen === 'newMessage' && !state.chatTitle) return 'newMessage without chatTitle'
  return null
}

function isValidTransition(prev, next) {
  const allowed = prev ? VALID_TRANSITIONS[prev.screen] : null
  return allowed ? allowed.includes(next.screen) || next.screen === 'error' : false
}

// --- Utilities ---

function parseArgs(values) {
  const parsed = {}
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]
    if (!v.startsWith('--')) continue
    const key = v.slice(2)
    const next = values[i + 1]
    if (!next || next.startsWith('--')) { parsed[key] = true } else { parsed[key] = next; i += 1 }
  }
  return parsed
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function fetchWithTimeout(url, init, timeoutMs) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), timeoutMs)
  return fetch(url, { ...(init ?? {}), signal: c.signal }).finally(() => clearTimeout(t))
}

function startProcess(name, cmd, cmdArgs, opts) {
  const child = spawn(cmd, cmdArgs, { ...opts, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
  children.push(child)
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') failures.push(`${name} exited code ${code ?? signal}`)
  })
  return child
}

function stopProcessTree(child) {
  if (child.killed) return
  try { process.kill(-child.pid, 'SIGTERM') } catch { child.kill('SIGTERM') }
}

async function waitForHttp(url, timeoutMs, expectText) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetchWithTimeout(url, undefined, 3000)
      const t = await r.text()
      if (r.ok && (expectText === undefined || t.trim() === expectText)) return
    } catch { /* retry */ }
    await sleep(100)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function postInput(action) {
  const r = await fetchWithTimeout(`${simUrl}/api/input`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  }, 5000)
  if (!r.ok) failures.push(`input ${action} returned ${r.status}`)
}

async function pollConsole() {
  const r = await fetchWithTimeout(`${simUrl}/api/console?since_id=${consoleSinceId}`, undefined, 3000)
  if (!r.ok) return
  const p = await r.json()
  for (const entry of (p.entries ?? [])) {
    consoleSinceId = Math.max(consoleSinceId, Number(entry.id ?? 0) + 1)
    const marker = '[TeleGlanceTest] '
    const msg = String(entry.message ?? '')
    const idx = msg.indexOf(marker)
    if (idx >= 0) {
      try { testEvents.push(JSON.parse(msg.slice(idx + marker.length))) } catch { /* skip */ }
    }
  }
}

function extractLatestState() {
  for (let i = testEvents.length - 1; i >= 0; i -= 1) {
    if (testEvents[i].event === 'state') return testEvents[i]
  }
  return null
}

function extractLatestRender() {
  for (let i = testEvents.length - 1; i >= 0; i -= 1) {
    if (testEvents[i].event === 'render') return testEvents[i]
  }
  return null
}

function checkStructuralInvariants() {
  const issues = []
  const state = extractLatestState()
  const render = extractLatestRender()

  if (state) {
    const v = isValidState(state)
    if (v) issues.push(`S1: ${v}`)
  }

  if (state && render) {
    const m = render.model ?? {}
    if (m.title && Buffer.byteLength(m.title, 'utf8') > 120) issues.push('S3: title > 120 bytes')
    if (m.panelBody && Buffer.byteLength(m.panelBody, 'utf8') > 999) issues.push('S3: panelBody > 999 bytes')
    if (m.panelFooter && Buffer.byteLength(m.panelFooter, 'utf8') > 120) issues.push('S3: panelFooter > 120 bytes')
    if (Array.isArray(m.sidebarItems)) {
      if (m.sidebarItems.length > 20) issues.push(`S3: sidebarItems ${m.sidebarItems.length} > 20`)
      for (const it of m.sidebarItems) {
        if (Buffer.byteLength(String(it ?? ''), 'utf8') > 64) issues.push('S3: sidebarItem > 64 bytes')
      }
    }
  }

  if (state && state.status) {
    const st = String(state.status)
    if (st.startsWith('Loading') || st.startsWith('Transcribing')) {
      issues.push(`S4: in-progress: "${st.slice(0, 50)}"`)
    }
  }

  return issues
}

// --- Main ---

async function main() {
  await mkdir(artifactRoot, { recursive: true })

  console.log(`\n==> TeleGlance Fuzzy Test Runner <==`)
  console.log(`    Iterations: ${iterations}`)
  console.log(`    Mode:       ${runMode}\n`)

  console.log(`[fuzzy] Starting Vite on ${testHost}:${vitePort}...`)
  const vite = startProcess('vite', 'npm', [
    'run', 'dev', '--', '--host', testHost, '--port', String(vitePort),
  ], {
    cwd: webRoot,
    env: { ...process.env, ...(isFixtureMode ? { VITE_TELEGLANCE_FIXTURE: '1' } : {}) },
  })
  await waitForHttp(testUrl, 30000)

  console.log(`[fuzzy] Starting simulator on port ${automationPort}...`)
  startProcess('simulator', 'npx', [
    '@evenrealities/evenhub-simulator@0.7.2',
    '--automation-port', String(automationPort), testUrl,
  ], { cwd: repoRoot })
  await waitForHttp(`${simUrl}/api/ping`, 20000, 'pong')

  await fetchWithTimeout(`${simUrl}/api/console`, { method: 'DELETE' }, 3000)
  consoleSinceId = 0

  // Wait for non-loading state
  const deadline = Date.now() + 10000
  let firstState = null
  while (Date.now() < deadline) {
    await pollConsole()
    const s = extractLatestState()
    if (s && s.screen !== 'loading') { firstState = s; break }
    await sleep(100)
  }

  if (!firstState) {
    failures.push('App did not reach non-loading state in 10s (likely auth not configured or backend unreachable)')
    console.log(`[fuzzy] Startup timeout - no non-loading state within 10s`)
    console.log(`[fuzzy] Common causes: (1) seed-credentials.local.json not populated, (2) backend not running, (3) backend shared secret mismatch`)
    for (const child of children.reverse()) stopProcessTree(child)
    process.exit(1)
  }

  testEvents.length = 0

  console.log(`[fuzzy] Startup: ${firstState.screen}@${firstState.focus ?? '-'}`)
  console.log(`[fuzzy] Running ${iterations} random inputs...`)

  let prevState = firstState
  let consecutiveStuck = 0
  let structuralIssues = []

  for (let iter = 0; iter < iterations; iter += 1) {
    const inputType = INPUT_TYPES[Math.floor(Math.random() * INPUT_TYPES.length)]

    await postInput(inputType)
    inputCount += 1

    await sleep(60)
    await pollConsole()
    await sleep(20)
    await pollConsole()

    const currentState = extractLatestState()

    if (!currentState) {
      consecutiveStuck += 1
      if (consecutiveStuck > 30) {
        failures.push(`No state after ${consecutiveStuck} inputs (iter ${iter})`)
        break
      }
      continue
    }
    consecutiveStuck = 0

    if (prevState && !isValidTransition(prevState, currentState)) {
      failures.push(
        `Iter ${iter}: invalid transition ${prevState.screen}@${prevState.focus ?? '-'} -> ${currentState.screen}@${currentState.focus ?? '-'} via ${inputType}`,
      )
    }
    transitionsHistory.push({
      iter, from: prevState.screen, to: currentState.screen, via: inputType,
    })

    const violation = isValidState(currentState)
    if (violation) {
      failures.push(`Iter ${iter}: ${violation} [${inputType}] screen=${currentState.screen} focus=${currentState.focus ?? '-'}`)
    }

    structuralIssues = structuralIssues.concat(checkStructuralInvariants().map((i) => `Iter ${iter}: ${i}`))

    prevState = currentState

    if (iter > 0 && iter % 25 === 0) {
      console.log(`[fuzzy] ${iter}/${iterations} (${failures.length} failures)`)
    }
  }

  const finalState = extractLatestState()
  const uniqueStructural = [...new Set(structuralIssues)]
  if (uniqueStructural.length > 50) warnings.push(`${uniqueStructural.length} structural issues (top 50)`)

  await writeFile(path.join(artifactRoot, 'results.json'), JSON.stringify({
    iterations, inputCount, failures: failures.length, transitions: transitionsHistory.length,
  }, null, 2))
  await writeFile(path.join(artifactRoot, 'transitions.json'),
    JSON.stringify(transitionsHistory.slice(-200), null, 2))
  await writeFile(path.join(artifactRoot, 'structural-issues.json'),
    JSON.stringify(uniqueStructural.slice(0, 100), null, 2))

  console.log(`\n==> Results`)
  console.log(`    Iterations:       ${iterations}`)
  console.log(`    Total inputs:     ${inputCount}`)
  console.log(`    Failures:         ${failures.length}`)
  console.log(`    Structural:       ${uniqueStructural.length}`)
  console.log(`    Start: ${firstState.screen}@${firstState.focus ?? '-'}`)
  console.log(`    End:   ${finalState?.screen ?? '?'}@${finalState?.focus ?? '?'}`)
  console.log(`    Artifacts: ${artifactRoot}`)

  if (failures.length > 0) {
    console.log(`\nFailures (${failures.length}):`)
    for (const f of failures.slice(0, 30)) console.log(`  * ${f}`)
  }

  for (const child of children.reverse()) stopProcessTree(child)
  if (failures.length > 0) process.exitCode = 1
}

await main().catch((err) => {
  console.error(`[fuzzy] Fatal: ${err instanceof Error ? err.message : String(err)}`)
  for (const child of children.reverse()) stopProcessTree(child)
  process.exitCode = 1
})
