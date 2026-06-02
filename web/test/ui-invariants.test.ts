import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type Performance = {
  maxTransitionMs: number
  maxApiCallMs: number
  maxMessageLoadMs: number
  maxChatLoadMs: number
  maxSendRoundtripMs: number
  longRunningStates: string[]
}

type ScreenBlock = {
  state: { screen: string; mode?: string; focus?: string; selectedIndex?: number }
  render: { kind: 'text' | 'list' | 'sidebar'; title?: string; focus?: string }
  left?: { sidebarTitle?: string; sidebarItemsExact?: string[]; markerAtFromState?: string }
  right?: {
    panelTitle?: unknown
    panelBodyContains?: unknown
    panelBodyNotContains?: string[]
    panelFooterDefault?: string
    panelFooterContains?: string[]
    panelBox?: unknown
  }
  body?: { contains?: string[]; containsAny?: string[][]; containsFromState?: unknown }
  footer?: { contains?: string[] }
  transitions: Record<string, string>
  budgetMs: number
  apiCalls?: string[]
  bridgeCalls?: string[]
  eventMustEmit?: Array<{ event: string; kind: string }>
}

type Step = {
  name: string
  input: string | null
  target: string
  expect: Record<string, unknown>
  apiCalls?: string[]
  budgetMs: number
  expectToFail?: boolean
}

type Catalog = {
  version: number
  fixture: Record<string, unknown>
  performance: Performance
  blankDetection: Record<string, unknown>
  screens: Record<string, ScreenBlock>
  steps: Step[]
}

function loadCatalog(): Catalog {
  const file = path.resolve(__dirname, '..', '..', 'docs', 'UI_INVARIANTS.json')
  const raw = readFileSync(file, 'utf8')
  return JSON.parse(raw) as Catalog
}

const VALID_SCREEN_KINDS: Record<string, true> = {
  text: true,
  list: true,
  sidebar: true,
}

describe('UI_INVARIANTS catalog', () => {
  const catalog = loadCatalog()

  it('uses the current schema version', () => {
    expect(catalog.version).toBe(1)
  })

  it('declares every screen referenced by the test plan', () => {
    const declared = new Set(Object.keys(catalog.screens))
    for (const step of catalog.steps) {
      if (step.target && !declared.has(step.target)) {
        throw new Error(`Step ${step.name} references missing screen block: ${step.target}`)
      }
    }
  })

  it('enforces performance budgets that are reachable but tight', () => {
    expect(catalog.performance.maxTransitionMs).toBeLessThanOrEqual(1500)
    expect(catalog.performance.maxTransitionMs).toBeGreaterThanOrEqual(500)
    expect(catalog.performance.maxApiCallMs).toBeLessThanOrEqual(500)
    expect(catalog.performance.maxMessageLoadMs).toBeLessThanOrEqual(1500)
    expect(catalog.performance.maxChatLoadMs).toBeLessThanOrEqual(1500)
  })

  it('blank-detection rules match the LVGL selection-border green', () => {
    expect(catalog.blankDetection.maxUniqueColors).toBeLessThanOrEqual(10)
    expect(catalog.blankDetection.borderGreenChannelG).toBe(255)
    expect(catalog.blankDetection.borderGreenMaxDistance).toBeGreaterThan(0)
  })

  it('every sidebar-kind screen has left and right invariants', () => {
    for (const [name, block] of Object.entries(catalog.screens)) {
      if (block.render.kind !== 'sidebar') continue
      if (!block.left) throw new Error(`${name}: sidebar screen missing left invariants`)
      if (!block.right) throw new Error(`${name}: sidebar screen missing right invariants`)
      if (block.left.sidebarTitle === undefined) throw new Error(`${name}: sidebar screen missing left.sidebarTitle`)
    }
  })

  it('every render.kind is one of the supported values', () => {
    for (const [name, block] of Object.entries(catalog.screens)) {
      if (!VALID_SCREEN_KINDS[block.render.kind]) {
        throw new Error(`${name}: unsupported render.kind ${block.render.kind}`)
      }
    }
  })

  it('every test step has a budget and a target', () => {
    for (const step of catalog.steps) {
      if (!step.name) throw new Error('A test step is missing a name')
      if (!step.target) throw new Error(`${step.name}: test step missing target screen id`)
      if (typeof step.budgetMs !== 'number' || step.budgetMs <= 0) {
        throw new Error(`${step.name}: test step missing positive budgetMs`)
      }
    }
  })

  it('at least one step exercises each major state', () => {
    const targets = new Set(catalog.steps.map((step) => step.target))
    const required: string[] = [
      'sidebar.chats',
      'sidebar.topics.noPreview',
      'sidebar.messages.normal',
      'sidebarRecording',
      'sidebarTranscribing',
      'sidebarConfirm.send',
      'asleep',
    ]
    for (const requiredTarget of required) {
      if (!targets.has(requiredTarget)) {
        throw new Error(`No test step targets required screen: ${requiredTarget}`)
      }
    }
  })

  it('includes a latency-budget negative test', () => {
    const negative = catalog.steps.find((step) => step.expectToFail)
    if (!negative) throw new Error('No expectToFail step found; the harness cannot prove it enforces the latency budget')
    if (!negative.name.includes('perf-budget')) {
      throw new Error('The negative test should clearly look like a perf-budget test (perf-budget in name)')
    }
  })

  it('records long-message anchors in the fixture-driven steps', () => {
    const longMessageSteps = catalog.steps.filter((step) => {
      const needles = step.expect?.renderBodyContains
      if (!Array.isArray(needles)) return false
      return needles.some((needle) => typeof needle === 'string' && needle.includes('fixture-long'))
    })
    if (longMessageSteps.length < 2) {
      throw new Error(`Expected at least 2 long-message steps (chat + topic), found ${longMessageSteps.length}`)
    }
    const hasChat = longMessageSteps.some((step) => step.target === 'sidebar.messages.normal')
    const hasTopic = longMessageSteps.some((step) => step.target === 'sidebar.messages.topic')
    if (!hasChat) throw new Error('Missing long-message step for normal chat (target=sidebar.messages.normal)')
    if (!hasTopic) throw new Error('Missing long-message step for forum topic (target=sidebar.messages.topic)')
  })

  it('records a burst-scroll step that asserts no render events', () => {
    const burst = catalog.steps.find((step) => step.expect?.noRenderEvents === true)
    if (!burst) throw new Error('No burst-scroll step with noRenderEvents expectation found')
    if (typeof burst.expect?.maxPerSwipeMs !== 'number' || burst.expect.maxPerSwipeMs > 1000) {
      throw new Error('Burst-scroll step must set maxPerSwipeMs <= 1000ms')
    }
  })

  it('includes a pagination step that forces listMessages with beforeId', () => {
    const paginated = catalog.steps.find((step) => {
      const calls = step.expect?.apiCalls ?? step.apiCalls
      if (!Array.isArray(calls)) return false
      return calls.some((call) => String(call).includes('beforeId'))
    })
    if (!paginated) throw new Error('No step found that exercises listMessages with beforeId (older pagination)')
  })
})
