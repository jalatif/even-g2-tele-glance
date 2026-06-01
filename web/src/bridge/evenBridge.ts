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
import { defaultApiBaseUrl } from '../api'
import { createInputCoalescer, mapEvenHubEvent } from './eventMapping'

const encoder = new TextEncoder()
export const APP_BUILD_VERSION: string = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') as string

type EvenBridgeOptions = {
  debugEventsEnabled?: () => boolean
}

type EvenBridgeInstance = {
  createStartUpPageContainer(container: unknown): Promise<number>
  rebuildPageContainer(container: unknown): Promise<boolean>
  audioControl(enabled: boolean): Promise<unknown>
  shutDownPageContainer?(exitMode?: number): Promise<boolean>
  callEvenApp?(method: string, payload: unknown): Promise<boolean>
  screenOff?(): Promise<boolean>
  turnScreenOff?(): Promise<boolean>
  onEvenHubEvent(listener: (event: unknown) => void): (() => void) | void
}

export class EvenHubGlassesBridge implements GlassesBridge {
  private hasRendered = false

  constructor(private readonly sdk: EvenBridgeInstance) {}

  static async create(onInput: (input: AppInput) => void | Promise<void>, options: EvenBridgeOptions = {}) {
    const sdk = (await waitForEvenAppBridge()) as unknown as EvenBridgeInstance
    const adapter = new EvenHubGlassesBridge(sdk)
    const dispatchInput = createInputCoalescer(onInput)
    sdk.onEvenHubEvent((event) => {
      const input = mapEvenHubEvent(event as Parameters<typeof mapEvenHubEvent>[0])
      if ((options.debugEventsEnabled?.() ?? true) && input?.type !== 'audioChunk') void logHardwareEvent(event, input)
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

  async showExitConfirmation() {
    if (typeof this.sdk.shutDownPageContainer === 'function') {
      await this.sdk.shutDownPageContainer(1)
      return
    }
    await this.sdk.callEvenApp?.('shutDownPageContainer', { exitMode: 1 })
  }

  async turnScreenOff() {
    if (typeof this.sdk.screenOff === 'function') {
      await this.sdk.screenOff()
      return
    }
    if (typeof this.sdk.turnScreenOff === 'function') {
      await this.sdk.turnScreenOff()
      return
    }
    await this.sdk.callEvenApp?.('screenOff', {})
  }
}

type PageContainerClass = typeof CreateStartUpPageContainer | typeof RebuildPageContainer

function buildTextPage(model: Extract<ScreenModel, { kind: 'text' }>, Container: PageContainerClass) {
  if (model.box && model.footer) return buildBoxedTextPage(model, model.box, Container)

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

function buildBoxedTextPage(model: Extract<ScreenModel, { kind: 'text' }>, boxedBody: BoxedBody, Container: PageContainerClass) {
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
  const overlay = new TextContainerProperty({
    containerID: 2,
    containerName: 'body-events',
    content: '',
    xPosition: 0,
    yPosition: 42,
    width: 576,
    height: 204,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 0,
    isEventCapture: 1,
  })
  const box = new TextContainerProperty({
    containerID: 5,
    containerName: 'msg-box',
    content: trimForContainer(formatBoxContent(boxedBody), 999),
    xPosition: 14,
    yPosition: 58,
    width: 548,
    height: 172,
    borderWidth: 1,
    borderColor: 8,
    paddingLength: 8,
    isEventCapture: 0,
  })
  const footer = new TextContainerProperty({
    containerID: 4,
    containerName: 'footer',
    content: trimForContainer(model.footer ?? '', 180),
    xPosition: 0,
    yPosition: 246,
    width: 576,
    height: 42,
    borderWidth: 1,
    borderColor: 8,
    paddingLength: 4,
    isEventCapture: 0,
  })
  const list = hiddenListContainer()
  return new Container({
    containerTotalNum: 5,
    textObject: [title, overlay, box, footer],
    listObject: [list],
  })
}

type BoxedBody = NonNullable<Extract<ScreenModel, { kind: 'text' }>['box']>

function buildListPage(model: Extract<ScreenModel, { kind: 'list' }>, Container: PageContainerClass) {
  const content = new TextContainerProperty({
    containerID: 5,
    containerName: 'menu',
    content: trimForContainer(formatListAsText(model), 999),
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 6,
    isEventCapture: 0,
  })
  const overlay = new TextContainerProperty({
    containerID: 2,
    containerName: 'event-overlay',
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 0,
    content: '',
    isEventCapture: 1,
  })
  const list = hiddenListContainer()
  const footer = hiddenFooterContainer()
  return new Container({
    containerTotalNum: 4,
    textObject: [overlay, content, footer],
    listObject: [list],
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

function formatBoxContent(boxedBody: BoxedBody) {
  return boxedBody.content ? `${boxedBody.heading}\n\n${boxedBody.content}` : boxedBody.heading
}

function formatListAsText(model: Extract<ScreenModel, { kind: 'list' }>) {
  const items = model.items.length > 0 ? model.items : ['Empty']
  const visible = visibleListWindow(items, model.selectedIndex, 8)
  const lines = [
    model.title,
    '---------------------------',
    ...visible.map((item, index) => {
      const itemIndex = visible.start + index
      const marker = itemIndex === model.selectedIndex ? '> ' : '  '
      return `${marker}${trimForContainer(item, 54)}`
    }),
  ]
  return lines.join('\n')
}

function visibleListWindow(items: string[], selectedIndex: number, maxVisible: number) {
  const clamped = Math.max(0, Math.min(selectedIndex, items.length - 1))
  const half = Math.floor(maxVisible / 2)
  const start = Math.max(0, Math.min(clamped - half, Math.max(0, items.length - maxVisible)))
  return Object.assign(items.slice(start, start + maxVisible), { start })
}

async function logHardwareEvent(raw: unknown, mapped: AppInput | undefined) {
  try {
    await fetch(`${defaultApiBaseUrl()}/api/debug/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'even-hub',
        buildVersion: APP_BUILD_VERSION,
        raw: summarizeForDebug(raw),
        mapped: mapped ?? null,
      }),
    })
  } catch {
    // Debug logging must never affect glasses input handling.
  }
}

function summarizeForDebug(value: unknown): unknown {
  if (value instanceof Uint8Array) return { type: 'Uint8Array', byteLength: value.byteLength, preview: Array.from(value.slice(0, 16)) }
  if (value instanceof ArrayBuffer) return { type: 'ArrayBuffer', byteLength: value.byteLength }
  if (Array.isArray(value)) return value.slice(0, 20).map(summarizeForDebug)
  if (typeof value !== 'object' || value === null) return value

  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (key.toLowerCase().includes('audiopcm')) {
      output[key] = summarizeForDebug(item)
      continue
    }
    output[key] = summarizeForDebug(item)
  }
  return output
}
