import { describe, expect, it } from 'vitest'
import { EvenHubGlassesBridge } from '../src/bridge/evenBridge'
import type { ScreenModel } from '../src/controller/model'

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
})
