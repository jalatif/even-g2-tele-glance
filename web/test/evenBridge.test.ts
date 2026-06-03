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
    const rebuilds: Array<{ selected: number; panelBody: string }> = []
    let resolveNext: (() => void) | undefined
    const blockRender = () => new Promise<void>((resolve) => { resolveNext = resolve })
    const bridge = new EvenHubGlassesBridge({
      async createStartUpPageContainer() { return 0 },
      async rebuildPageContainer(container: unknown) {
        const sidebar = (container as { listObject?: Array<{ itemContainer?: { itemName?: string[] } }> }).listObject?.[0]
        const items = sidebar?.itemContainer?.itemName ?? []
        // The full render carries the list with the current selection; we read it back to
        // confirm the queued model was applied. The container shape is opaque to the bridge
        // so this is a best-effort introspection.
        const text = (container as { textObject?: Array<{ content?: string }> }).textObject ?? []
        const panelBody = text.find((t) => t.content?.includes('bob-again') || t.content?.includes('carol') || t.content?.includes('bob'))?.content ?? ''
        rebuilds.push({ selected: items.length, panelBody })
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
    rebuilds.length = 0

    // Three rapid enqueues while a render is in flight. The slow native render
    // never resolves, so all three enqueues must be accepted and the second
    // and third must be coalesced into the in-flight render slot.
    bridge.enqueueSidebarPanel({ ...baseModel, sidebarSelected: 1, panelBody: 'bob' })
    bridge.enqueueSidebarPanel({ ...baseModel, sidebarSelected: 2, panelBody: 'carol' })
    bridge.enqueueSidebarPanel({ ...baseModel, sidebarSelected: 1, panelBody: 'bob-again' })
    const stats = bridge.getPartialRenderStats()
    expect(stats.dispatched).toBe(3)
    expect(stats.dropped).toBe(2)

    // The input handler must have returned by now (enqueue is synchronous).
    // Let the in-flight render complete so the trailing render slot is freed.
    resolveNext?.()
    await flushAsync(0)

    // After the in-flight render completes, the latest queued model must be flushed.
    resolveNext?.()
    await flushAsync(20)
    // We expect at least one rebuild; the final panelBody should be the latest queued.
    expect(rebuilds.length).toBeGreaterThan(0)
    const lastBody = rebuilds.at(-1)?.panelBody ?? ''
    expect(lastBody).toContain('bob-again')
  })
})
