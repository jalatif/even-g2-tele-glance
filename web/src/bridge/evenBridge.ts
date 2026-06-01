import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { GlassesBridge } from '../controller/appController'
import type { AppInput, ScreenModel } from '../controller/model'
import { createInputCoalescer, mapEvenHubEvent } from './eventMapping'

const encoder = new TextEncoder()

type EvenBridgeInstance = {
  createStartUpPageContainer(container: unknown): Promise<number>
  rebuildPageContainer(container: unknown): Promise<boolean>
  audioControl(enabled: boolean): Promise<unknown>
  onEvenHubEvent(listener: (event: unknown) => void): (() => void) | void
}

export class EvenHubGlassesBridge implements GlassesBridge {
  private hasRendered = false

  constructor(private readonly sdk: EvenBridgeInstance) {}

  static async create(onInput: (input: AppInput) => void | Promise<void>) {
    const sdk = (await waitForEvenAppBridge()) as unknown as EvenBridgeInstance
    const adapter = new EvenHubGlassesBridge(sdk)
    const dispatchInput = createInputCoalescer(onInput)
    sdk.onEvenHubEvent((event) => {
      const input = mapEvenHubEvent(event as Parameters<typeof mapEvenHubEvent>[0])
      if (input) dispatchInput(input)
    })
    return adapter
  }

  async render(model: ScreenModel) {
    if (this.hasRendered) {
      const container = model.kind === 'list' ? buildListPage(model, RebuildPageContainer) : buildTextPage(model, RebuildPageContainer)
      await this.sdk.rebuildPageContainer(container)
      return
    }
    const container = model.kind === 'list' ? buildListPage(model, CreateStartUpPageContainer) : buildTextPage(model, CreateStartUpPageContainer)
    await this.sdk.createStartUpPageContainer(container)
    this.hasRendered = true
  }

  async setAudioEnabled(enabled: boolean) {
    await this.sdk.audioControl(enabled)
  }
}

type PageContainerClass = typeof CreateStartUpPageContainer | typeof RebuildPageContainer

function buildTextPage(model: Extract<ScreenModel, { kind: 'text' }>, Container: PageContainerClass) {
  const hasFooter = Boolean(model.footer)
  const title = new TextContainerProperty({
    containerID: 1,
    containerName: 'title',
    content: trimForContainer(model.title, 120),
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 42,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 4,
    isEventCapture: 0,
  })
  const body = new TextContainerProperty({
    containerID: 2,
    containerName: 'body',
    content: trimForContainer(model.body, 999),
    xPosition: 0,
    yPosition: 42,
    width: 576,
    height: hasFooter ? 190 : 246,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 4,
    isEventCapture: 1,
  })
  const footer = new TextContainerProperty({
    containerID: 4,
    containerName: 'footer',
    content: trimForContainer(model.footer ?? '', 180),
    xPosition: 0,
    yPosition: 246,
    width: 576,
    height: 42,
    borderWidth: hasFooter ? 1 : 0,
    borderColor: 8,
    paddingLength: hasFooter ? 4 : 0,
    isEventCapture: 0,
  })
  const list = hiddenListContainer()
  return new Container({
    containerTotalNum: 4,
    textObject: [title, body, footer],
    listObject: [list],
  })
}

function buildListPage(model: Extract<ScreenModel, { kind: 'list' }>, Container: PageContainerClass) {
  const renderedItems = model.items.length > 0 ? model.items.slice(0, 20) : ['Empty']
  const title = new TextContainerProperty({
    containerID: 1,
    containerName: 'title',
    content: trimForContainer(model.title, 160),
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 44,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 4,
    isEventCapture: 0,
  })
  const list = new ListContainerProperty({
    containerID: 3,
    containerName: 'list',
    xPosition: 0,
    yPosition: 44,
    width: 576,
    height: 244,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 4,
    itemContainer: new ListItemContainerProperty({
      itemCount: renderedItems.length,
      itemWidth: 568,
      itemName: renderedItems.map((item) => trimForContainer(item, 64)),
      isItemSelectBorderEn: 1,
    }),
    isEventCapture: 1,
  })
  const body = hiddenTextContainer()
  const footer = hiddenFooterContainer()
  return new Container({
    containerTotalNum: 4,
    textObject: [title, body, footer],
    listObject: [list],
  })
}

function hiddenTextContainer() {
  return new TextContainerProperty({
    containerID: 2,
    containerName: 'body',
    content: '',
    xPosition: 0,
    yPosition: 287,
    width: 1,
    height: 1,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 0,
    isEventCapture: 0,
  })
}

function hiddenListContainer() {
  return new ListContainerProperty({
    containerID: 3,
    containerName: 'list',
    xPosition: 0,
    yPosition: 287,
    width: 1,
    height: 1,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 0,
    itemContainer: new ListItemContainerProperty({
      itemCount: 1,
      itemWidth: 1,
      itemName: [''],
      isItemSelectBorderEn: 0,
    }),
    isEventCapture: 0,
  })
}

function hiddenFooterContainer() {
  return new TextContainerProperty({
    containerID: 4,
    containerName: 'footer',
    content: '',
    xPosition: 0,
    yPosition: 287,
    width: 1,
    height: 1,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 0,
    isEventCapture: 0,
  })
}

function trimForContainer(value: string, maxLength: number) {
  if (encoder.encode(value).byteLength <= maxLength) return value

  const suffix = '...'
  const contentLimit = Math.max(0, maxLength - encoder.encode(suffix).byteLength)
  let output = ''
  for (const char of value) {
    const candidate = output + char
    if (encoder.encode(candidate).byteLength > contentLimit) break
    output = candidate
  }
  return `${output}${suffix}`
}
