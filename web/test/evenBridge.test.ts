import { describe, expect, it, vi } from 'vitest'
import { EvenHubGlassesBridge } from '../src/bridge/evenBridge'
import type { ScreenModel } from '../src/controller/model'

function flushAsync(ms = 0) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

describe('EvenHubGlassesBridge', () => {
  it('renders structured boxed text without sending ASCII box markers to the glasses box', async () => {
    let rendered: unknown
    const bridge = new EvenHubGlassesBridge({
      async createStartUpPageContainer(container: unknown) {
        rendered = container
        return 0
      },
      async rebuildPageContainer() {
        return true
      },
      async audioControl() {
        return undefined
      },
      onEvenHubEvent() {
        return undefined
      },
    })
    const markerBody = [
      '+----------------------------------------+',
      '| Ada                                    |',
      '+----------------------------------------+',
      '| there are 230 commits behind available |',
      '+----------------------------------------+',
    ].join('\n')
    const model: ScreenModel = {
      kind: 'text',
      title: 'Messages',
      body: markerBody,
      footer: 'Click record | Double click back',
      box: {
        heading: 'Ada 1/2',
        content: 'there are 230 commits behind available',
      },
    }

    await bridge.render(model)

    const output = JSON.stringify(rendered)
    expect(output).toContain('Ada 1/2')
    expect(output).toContain('there are 230 commits behind available')
    expect(output).not.toContain('+----------------------------------------+')
    expect(output).not.toContain('| Ada')
  })

  it('keeps the sidebar panel-box container stable when hiding boxed content', async () => {
    let rebuilt: unknown
    const bridge = new EvenHubGlassesBridge({
      async createStartUpPageContainer() {
        return 0
      },
      async rebuildPageContainer(container: unknown) {
        rebuilt = container
        return true
      },
      async audioControl() {
        return undefined
      },
      onEvenHubEvent() {
        return undefined
      },
    })

    await bridge.render({
      kind: 'sidebar',
      title: 'Topic',
      sidebarTitle: 'Topics',
      sidebarItems: ['Launch'],
      sidebarSelected: 0,
      panelTitle: '',
      panelBody: '',
      panelFooter: 'Click record',
      panelBox: { heading: 'Ada', content: 'Long message' },
      focus: 'panel',
    })
    await bridge.render({
      kind: 'sidebar',
      title: 'Topic',
      sidebarTitle: 'Topics',
      sidebarItems: ['Launch'],
      sidebarSelected: 0,
      panelTitle: '',
      panelBody: 'Short message',
      panelFooter: 'Click record',
      focus: 'panel',
    })

    const output = JSON.stringify(rebuilt)
    expect(output).toContain('"containerID":7')
    expect(output).toContain('"containerName":"panel-box"')
  })

  it('uses a visible event-capturing native list while the sidebar has focus', async () => {
    let rendered: unknown
    const bridge = new EvenHubGlassesBridge({
      async createStartUpPageContainer(container: unknown) {
        rendered = container
        return 0
      },
      async rebuildPageContainer() {
        return true
      },
      async audioControl() {
        return undefined
      },
      onEvenHubEvent() {
        return undefined
      },
    })

    await bridge.render({
      kind: 'sidebar',
      title: 'Telegram',
      sidebarTitle: 'Chats',
      sidebarItems: ['Alice', 'Project'],
      sidebarSelected: 0,
      panelTitle: 'Alice',
      panelBody: 'Preview',
      panelFooter: 'Swipe chats | Press open',
      focus: 'sidebar',
    })

    const output = JSON.stringify(rendered)
    expect(output).toContain('"containerName":"sidebar-list"')
    expect(output).toContain('"itemName":["Alice","Project"]')
    expect(output).toContain('"isItemSelectBorderEn":1')
    expect(output).toContain('"isEventCapture":1')
    expect(output).not.toContain('"containerName":"sidebar","content"')
  })

  it('uses text sidebar and panel event capture while messages have focus', async () => {
    let rendered: unknown
    const bridge = new EvenHubGlassesBridge({
      async createStartUpPageContainer(container: unknown) {
        rendered = container
        return 0
      },
      async rebuildPageContainer() {
        return true
      },
      async audioControl() {
        return undefined
      },
      onEvenHubEvent() {
        return undefined
      },
    })

    await bridge.render({
      kind: 'sidebar',
      title: 'Launch',
      sidebarTitle: 'Topics',
      sidebarItems: ['Launch', 'Support'],
      sidebarSelected: 1,
      panelTitle: '',
      panelBody: 'Message',
      panelFooter: 'Click record',
      focus: 'panel',
    })

    const output = JSON.stringify(rendered)
    expect(output).toContain('"containerName":"sidebar"')
    expect(output).toContain('Support')
    expect(output).toContain('"containerName":"event-overlay"')
    expect(output).not.toContain('"containerName":"sidebar-list"')
  })

  it('disposes the Even Hub event listener when available', () => {
    const unsubscribe = vi.fn()
    const bridge = new EvenHubGlassesBridge({
      async createStartUpPageContainer() {
        return 0
      },
      async rebuildPageContainer() {
        return true
      },
      async audioControl() {
        return undefined
      },
      onEvenHubEvent() {
        return unsubscribe
      },
    }, unsubscribe)

    bridge.dispose()
    bridge.dispose()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('coalesces rapid enqueueSidebarPanel calls into a single latest-wins render', async () => {
    const upgrades: Array<{ id: number; content: string }> = []
    let resolveNext: (() => void) | undefined
    const blockRender = () => new Promise<void>((resolve) => { resolveNext = resolve })
    const bridge = new EvenHubGlassesBridge({
      async createStartUpPageContainer() { return 0 },
      async rebuildPageContainer() { return true },
      async textContainerUpgrade(container: unknown) {
        const c = container as { containerID: number; content: string }
        upgrades.push({ id: c.containerID, content: c.content })
        // Slow native render — must not stall the input handler.
        await blockRender()
        return true
      },
      async audioControl() { return undefined },
      onEvenHubEvent() { return undefined },
    })

    const baseModel: Extract<ScreenModel, { kind: 'sidebar' }> = {
      kind: 'sidebar',
      title: 'Chats',
      focus: 'sidebar',
      sidebarTitle: 'Chats',
      sidebarItems: ['Alice', 'Bob', 'Carol'],
      sidebarSelected: 0,
      panelTitle: 'Alice',
      panelBody: 'preview',
      panelFooter: 'Click open',
    }
    await bridge.render(baseModel)
    upgrades.length = 0

    bridge.enqueueSidebarPanel({ ...baseModel, sidebarSelected: 1, panelBody: 'bob' })
    bridge.enqueueSidebarPanel({ ...baseModel, sidebarSelected: 2, panelBody: 'carol' })
    bridge.enqueueSidebarPanel({ ...baseModel, sidebarSelected: 1, panelBody: 'bob-again' })
    const stats = bridge.getPartialRenderStats()
    expect(stats.dispatched).toBe(3)
    expect(stats.dropped).toBe(2)

    // With the 150ms scroll-idle window, the flush timer hasn't fired yet.
    expect(upgrades.length).toBe(0)

    // Advance past the idle window. The timer fires the single coalesced flush.
    await flushAsync(160)
    // Resolve the blocked render cycle (4 textContainerUpgrade calls per flush).
    for (let i = 0; i < 4; i++) {
      resolveNext?.()
      await flushAsync(0)
    }
    // The final render cycle must have pushed the latest panel body.
    expect(upgrades.length).toBeGreaterThan(0)
    const lastBody = upgrades.filter((u) => u.id === 6).at(-1)
    expect(lastBody?.content).toContain('bob-again')
  })
})
