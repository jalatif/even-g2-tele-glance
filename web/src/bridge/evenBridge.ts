import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'
import type { GlassesBridge } from '../controller/appController'
import type { AppInput, ScreenModel } from '../controller/model'
import { defaultApiBaseUrl, type TelegramAuthConfig } from '../api'
import { encryptedTelegramAuthHeader, encryptJsonPayload } from '../secureAuth'
import {
  logBridgeQueueDepth,
  logInputDispatch,
  logTeleGlanceTest,
  nowMs,
  summarizeScreenModel,
  type BridgeQueueDepthReason,
} from '../testMode'
import { createInputCoalescer, mapEvenHubEvent } from './eventMapping'

const encoder = new TextEncoder()
export const APP_BUILD_VERSION: string = (typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0') as string

type DispatchContextSnapshot = { inputQuiet: boolean; backgroundWorkActive: boolean }
type EvenBridgeOptions = {
  debugEventsEnabled?: () => boolean
  authConfig?: () => TelegramAuthConfig
  /**
   * Snapshot of controller-side state captured at the moment an Even Hub SDK event
   * arrives. Used by `input.dispatch` to correlate input latency with background
   * work (prefetch, polling) and the input quiet window. Returning a fresh object
   * per call is intentional; the bridge logs it verbatim.
   */
  dispatchContextProvider?: () => DispatchContextSnapshot
}

let activeEventListenerToken: symbol | undefined

type EvenBridgeInstance = {
  createStartUpPageContainer(container: unknown): Promise<number>
  rebuildPageContainer(container: unknown): Promise<boolean>
  textContainerUpgrade?(container: unknown): Promise<boolean>
  audioControl(enabled: boolean): Promise<unknown>
  shutDownPageContainer?(exitMode?: number): Promise<boolean>
  callEvenApp?(method: string, payload: unknown): Promise<boolean>
  screenOff?(): Promise<boolean>
  turnScreenOff?(): Promise<boolean>
  getLocalStorage?(key: string): Promise<string>
  setLocalStorage?(key: string, value: string): Promise<boolean>
  onEvenHubEvent(listener: (event: unknown) => void): (() => void) | void
}

export class EvenHubGlassesBridge implements GlassesBridge {
  private hasRendered = false
  private renderSequence = 0
  private pendingPanelModel: Extract<ScreenModel, { kind: 'sidebar' }> | undefined
  private panelRenderInFlight = false
  private panelRenderQueuedAfter = false
  private fullRenderInFlight = false
  private partialRenderDispatched = 0
  private partialRenderDropped = 0
  private partialRenderFlushed = 0
  private panelRenderTimer: ReturnType<typeof setTimeout> | undefined
  // `panelRenderIdleMs` is the scroll-idle window for the partial-render queue. On real
  // G2 hardware each `textContainerUpgrade` call is a 150-400ms firmware roundtrip. If
  // we flush on every microtask boundary, rapid scrolling chains firmware calls and the
  // glasses feel sluggish. This delay holds the latest panel model until the user stops
  // scrolling, so 10 rapid swipes produce exactly one firmware roundtrip. The native
  // list (container ID 8) is firmware-managed and moves instantly regardless.
  private readonly panelRenderIdleMs = 150

  constructor(
    private readonly sdk: EvenBridgeInstance,
    private unsubscribeEvents?: () => void,
    private readonly listenerToken?: symbol,
  ) {}

  static async create(onInput: (input: AppInput) => void | Promise<void>, options: EvenBridgeOptions = {}) {
    const sdk = (await waitForEvenAppBridge()) as unknown as EvenBridgeInstance
    const dispatchInput = createInputCoalescer(onInput)
    let debugLogInFlight = false
    const listenerToken = Symbol('even-hub-listener')
    activeEventListenerToken = listenerToken
    const unsubscribeEvents = sdk.onEvenHubEvent((event) => {
      // `input.dispatch` event so the harness can attribute input latency to the
      // JS bridge callback rather than to the harness's automation roundtrip.
      const listenerStart = nowMs()
      const input = mapEvenHubEvent(event as Parameters<typeof mapEvenHubEvent>[0])
      if (input?.type !== 'audioChunk') {
        logTeleGlanceTest('input', {
          mapped: input ?? null,
          raw: summarizeForDebug(event),
        })
      }
      if ((options.debugEventsEnabled?.() ?? false) && input?.type !== 'audioChunk' && !debugLogInFlight) {
        debugLogInFlight = true
        setTimeout(() => {
          void logHardwareEvent(event, input, options.authConfig).finally(() => {
            debugLogInFlight = false
          })
        }, 0)
      }
      const listenerMs = nowMs() - listenerStart
      // Emit per-input timing telemetry for every non-audio event. The harness
      // correlates `input.dispatch` events with `bridge.queueDepth` events by
      // timestamp to reconstruct the queue state at input time. We intentionally
      // do NOT access bridge instance state here — the instance hasn't been
      // constructed yet (the listener is wired before the bridge is created).
      if (input?.type !== 'audioChunk') {
        logInputDispatch({
          listenerMs,
          queueDepth: 0,
          pendingModel: false,
          renderInFlight: false,
          mappedKind: input?.type ?? null,
          rawSummary: summarizeForDebug(event),
          context: options.dispatchContextProvider?.(),
        })
      }
      if (input) setTimeout(() => dispatchInput(input), 0)
    })
    return new EvenHubGlassesBridge(
      sdk,
      typeof unsubscribeEvents === 'function' ? unsubscribeEvents : undefined,
      listenerToken,
    )
  }

  private queueDepthSnapshot() {
    return {
      partialInFlight: this.panelRenderInFlight ? 1 : 0,
      partialPending: this.pendingPanelModel !== undefined ? 1 : 0,
      fullRenderInFlight: this.fullRenderInFlight ? 1 : 0,
    }
  }

  private emitQueueDepth(reason: BridgeQueueDepthReason) {
    const snap = this.queueDepthSnapshot()
    logBridgeQueueDepth({
      reason,
      partialInFlight: snap.partialInFlight,
      partialPending: snap.partialPending,
      fullRenderInFlight: snap.fullRenderInFlight,
      dispatched: this.partialRenderDispatched,
      dropped: this.partialRenderDropped,
      flushed: this.partialRenderFlushed,
    })
  }

  async render(model: ScreenModel) {
    const sequence = ++this.renderSequence
    this.fullRenderInFlight = true
    this.emitQueueDepth('full-render-start')
    try {
      if (this.hasRendered) {
        const container = buildPage(model, RebuildPageContainer)
        logTeleGlanceTest('bridge', { method: 'rebuildPageContainer', args: { sequence, hasPanelBox: model.kind === 'sidebar' ? Boolean(model.panelBox) : false } })
        await this.sdk.rebuildPageContainer(container)
        logTeleGlanceTest('render', { sequence, model: summarizeScreenModel(model) })
        return
      }
      const container = buildPage(model, CreateStartUpPageContainer)
      logTeleGlanceTest('bridge', { method: 'createStartUpPageContainer', args: { sequence, hasPanelBox: model.kind === 'sidebar' ? Boolean(model.panelBox) : false } })
      await this.sdk.createStartUpPageContainer(container)
      this.hasRendered = true
      logTeleGlanceTest('render', { sequence, model: summarizeScreenModel(model) })
    } finally {
      this.fullRenderInFlight = false
      this.emitQueueDepth('full-render-end')
    }
  }

  /**
   * Partial render that updates only the right-panel text containers (title, body, box, footer)
   * without rebuilding the native list container. This is the key to updating the right panel
   * after a chat/topic swipe without snapping the list selection back to row 0.
   *
   * The native list (container ID 8) is firmware-managed, so we leave it alone and only push
   * fresh text into the right-side containers. If `hasRendered` is false (first render) or the
   * SDK does not support `textContainerUpgrade`, we fall back to a full rebuild.
   */
  async renderSidebarPanel(model: Extract<ScreenModel, { kind: 'sidebar' }>) {
    const sequence = ++this.renderSequence
    if (!this.hasRendered || typeof this.sdk.textContainerUpgrade !== 'function') {
      // Fall back to a full render on first paint or when the SDK lacks partial updates.
      await this.render(model)
      return
    }
    const updates = buildSidebarPanelUpdates(model)
    logTeleGlanceTest('bridge', { method: 'textContainerUpgrade', args: { sequence, count: updates.length, hasPanelBox: Boolean(model.panelBox) } })
    for (const update of updates) {
      await this.sdk.textContainerUpgrade(update)
    }
    this.partialRenderFlushed += 1
    logTeleGlanceTest('render', { sequence, partial: true, model: summarizeScreenModel(model) })
  }

  /**
   * Fire-and-forget, latest-wins partial render for chat/topic list scrolls.
   *
   * The list-scroll input handler must return to the user as fast as possible. Awaiting
   * `textContainerUpgrade` calls here would couple native render latency to the input path
   * and would queue stale panel updates behind slow ones on real G2 hardware.
   *
   * Instead, this method:
   *   1. Stores the latest model in `pendingPanelModel`, overwriting any earlier queued model.
   *   2. Schedules a microtask flush if none is pending.
   *   3. While a flush is in flight, marks `panelRenderQueuedAfter` so the next idle tick
   *      re-renders once the in-flight call resolves.
   *   4. Counts both `partialRenderDispatched` and `partialRenderDropped` so the test
   *      harness can verify coalescing.
   *
   * The returned promise resolves when the queue has accepted the model, NOT when the
   * native render finishes. Callers must not `await` this for synchronous input handling.
   */
  enqueueSidebarPanel(model: Extract<ScreenModel, { kind: 'sidebar' }>): void {
    this.partialRenderDispatched += 1
    const previous = this.pendingPanelModel
    this.pendingPanelModel = model
    if (previous) this.partialRenderDropped += 1
    if (this.panelRenderInFlight) {
      this.panelRenderQueuedAfter = true
      logTeleGlanceTest('render.partial.enqueue', {
        dropped: previous ? 1 : 0,
        coalesced: previous ? 1 : 0,
        inFlight: true,
      })
      this.emitQueueDepth('enqueue')
      return
    }
    if (this.panelRenderTimer) {
      // Reset the idle deadline — each scroll pushes the flush further into the future
      // so that rapid scrolling never triggers a firmware roundtrip until the user stops.
      clearTimeout(this.panelRenderTimer)
      this.panelRenderTimer = setTimeout(() => {
        this.panelRenderTimer = undefined
        void this.flushPanelQueue()
      }, this.panelRenderIdleMs) as unknown as ReturnType<typeof setTimeout>
      const maybeNodeTimeout = this.panelRenderTimer as unknown as { unref?: () => void }
      maybeNodeTimeout.unref?.()
      logTeleGlanceTest('render.partial.enqueue', {
        dropped: previous ? 1 : 0,
        coalesced: previous ? 1 : 0,
        inFlight: false,
      })
      this.emitQueueDepth('enqueue')
      return
    }
    this.panelRenderTimer = setTimeout(() => {
      this.panelRenderTimer = undefined
      void this.flushPanelQueue()
    }, this.panelRenderIdleMs)
    const maybeNodeTimeout = this.panelRenderTimer as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
    logTeleGlanceTest('render.partial.enqueue', {
      dropped: previous ? 1 : 0,
      coalesced: previous ? 1 : 0,
      inFlight: false,
    })
    this.emitQueueDepth('enqueue')
  }

  /**
   * Drain the latest queued panel model through the partial-render path. If a newer model
   * arrives while we are rendering, the trailing flag is set so the queue re-renders once.
   */
  private async flushPanelQueue(): Promise<void> {
    if (this.panelRenderInFlight) return
    const model = this.pendingPanelModel
    if (!model) return
    this.pendingPanelModel = undefined
    this.panelRenderInFlight = true
    this.panelRenderQueuedAfter = false
    this.emitQueueDepth('flush-start')
    const startedAt = Date.now()
    try {
      await this.renderSidebarPanel(model)
    } catch {
      // Rendering failures must not stall the queue.
    } finally {
      const durationMs = Date.now() - startedAt
      logTeleGlanceTest('render.partial.flush', { durationMs })
      this.panelRenderInFlight = false
      this.emitQueueDepth('flush-end')
      if (this.pendingPanelModel) {
        this.panelRenderQueuedAfter = false
        this.panelRenderTimer = setTimeout(() => {
          this.panelRenderTimer = undefined
          void this.flushPanelQueue()
        }, this.panelRenderIdleMs)
        const maybeNodeTimeout = this.panelRenderTimer as unknown as { unref?: () => void }
        maybeNodeTimeout.unref?.()
      } else if (this.panelRenderQueuedAfter) {
        // Trailing flag with no fresh model means a stale coalesced drop was tracked but no
        // new data arrived. We deliberately do nothing here; the next enqueue will start fresh.
        this.panelRenderQueuedAfter = false
      }
    }
  }

  dispose() {
    if (this.listenerToken && activeEventListenerToken === this.listenerToken) {
      activeEventListenerToken = undefined
    }
    if (this.panelRenderTimer) {
      clearTimeout(this.panelRenderTimer)
      this.panelRenderTimer = undefined
    }
    this.pendingPanelModel = undefined
    this.panelRenderInFlight = false
    this.panelRenderQueuedAfter = false
    this.fullRenderInFlight = false
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = undefined
  }

  /** Test/debug introspection: returns counters of queued partial render activity. */
  getPartialRenderStats() {
    return {
      dispatched: this.partialRenderDispatched,
      dropped: this.partialRenderDropped,
      flushed: this.partialRenderFlushed,
    }
  }
  async setAudioEnabled(enabled: boolean) {
    logTeleGlanceTest('bridge', { method: 'setAudioEnabled', args: { enabled } })
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
    try {
      if (typeof this.sdk.screenOff === 'function') {
        await this.sdk.screenOff()
        logTeleGlanceTest('bridge', { method: 'turnScreenOff', args: { via: 'screenOff' } })
        return
      }
      if (typeof this.sdk.turnScreenOff === 'function') {
        await this.sdk.turnScreenOff()
        logTeleGlanceTest('bridge', { method: 'turnScreenOff', args: { via: 'turnScreenOff' } })
        return
      }
      await this.sdk.callEvenApp?.('screenOff', {})
      logTeleGlanceTest('bridge', { method: 'turnScreenOff', args: { via: 'callEvenApp' } })
    } catch {
      logTeleGlanceTest('bridge', { method: 'turnScreenOff', args: { error: 'not supported' } })
    }
  }

  async getLocalStorage(key: string) {
    return this.sdk.getLocalStorage?.(key) ?? ''
  }

  async setLocalStorage(key: string, value: string) {
    return this.sdk.setLocalStorage?.(key, value) ?? false
  }
}

type PageContainerClass = typeof CreateStartUpPageContainer | typeof RebuildPageContainer


function buildPage(model: ScreenModel, Container: PageContainerClass) {
  if (model.kind === 'sidebar') return buildSidebarPage(model, Container)
  if (model.kind === 'list') return buildListPage(model, Container)
  return buildTextPage(model, Container)
}

function buildSidebarPage(model: Extract<ScreenModel, { kind: 'sidebar' }>, Container: PageContainerClass) {
  const hasPanelBox = Boolean(model.panelBox)
  const sidebarHasFocus = model.focus === 'sidebar'

  const outerBorder = new TextContainerProperty({
    containerID: 0,
    containerName: 'outer',
    content: '',
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 2,
    borderColor: 8,
    paddingLength: 0,
    isEventCapture: 0,
  })
  const title = new TextContainerProperty({
    containerID: 1,
    containerName: 'title',
    content: trimForContainer(model.title, 100),
    xPosition: 2,
    yPosition: 2,
    width: 572,
    height: 36,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 4,
    isEventCapture: 0,
  })
  const overlay = new TextContainerProperty({
    containerID: 2,
    containerName: 'event-overlay',
    content: '',
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 0,
    isEventCapture: sidebarHasFocus ? 0 : 1,
  })
  const sidebarSeparator = new TextContainerProperty({
    containerID: 3,
    containerName: 'separator',
    content: '',
    xPosition: 168,
    yPosition: 38,
    width: 2,
    height: 206,
    borderWidth: 1,
    borderColor: 8,
    paddingLength: 0,
    isEventCapture: 0,
  })
  const panelBody = new TextContainerProperty({
    containerID: 6,
    content: trimForContainer(fillToContainer(model.panelBody || ' '), 999),
    xPosition: 170,
    yPosition: 38,
    width: 404,
    height: 206,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 4,
    isEventCapture: 0,
  })
  const panelBox = hasPanelBox
    ? new TextContainerProperty({
        containerID: 7,
        containerName: 'panel-box',
        content: trimForContainer(formatBoxContent(model.panelBox!), 999),
        xPosition: 184,
        yPosition: 54,
        width: 376,
        height: 190,
        borderWidth: 1,
        borderColor: 8,
        paddingLength: 8,
        isEventCapture: 0,
      })
    : new TextContainerProperty({
        containerID: 7,
        containerName: 'panel-box',
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
  const footer = new TextContainerProperty({
    containerID: 4,
    containerName: 'footer',
    content: trimForContainer(model.panelFooter, 120),
    xPosition: 2,
    yPosition: 248,
    width: 572,
    height: 38,
    borderWidth: 1,
    borderColor: 8,
    paddingLength: 4,
    isEventCapture: 0,
  })
  // Always include the native list at the chat-list position. Hiding the list on
  // focus='panel' (messages) would force a full rebuild for the focus change,
  // which resets the firmware-side list selection on real G2 hardware. Keeping
  // the list at the same position lets the partial-render path in `setState`
  // update the right-panel text containers without ever touching the list, so
  // the user-visible highlight stays on the row they selected.
  // the user-visible highlight stays on the row they selected.
  const list = sidebarListContainer(model)
  // The text-rendered sidebar (containerID 5) is deliberately excluded — the
  // native list is always visible now, and on the simulator the two would
  // overlap causing ghost text.
  const textObjects = [outerBorder, title, overlay, sidebarSeparator, panelBody, panelBox, footer]
  return new Container({
    containerTotalNum: textObjects.length + 1,
    textObject: textObjects,
    listObject: [list],
  })
}

/**
 * Build the right-panel `TextContainerUpgrade` payloads that the partial-render path
 * Build the right-panel `TextContainerUpgrade` payloads that the partial-render path
 * sends to the glasses. We mirror the trim rules used by `buildSidebarPage` so the
 * partial update looks identical to a full rebuild, but we never touch the native
 * list (container ID 8) or the left-side text containers (IDs 0/2/3/5) — the SDK
 * is instructed to keep them stable so the list selection does not snap.
 */
function buildSidebarPanelUpdates(model: Extract<ScreenModel, { kind: 'sidebar' }>): TextContainerUpgrade[] {
  const updates: TextContainerUpgrade[] = []
  updates.push(new TextContainerUpgrade({
    containerID: 1,
    containerName: 'title',
    content: trimForContainer(model.title, 100),
    contentOffset: 0,
    contentLength: trimForContainer(model.title, 100).length,
  }))
  updates.push(new TextContainerUpgrade({
    containerID: 6,
    containerName: 'panel-body',
    content: trimForContainer(fillToContainer(model.panelBody || ' '), 999),
    contentOffset: 0,
    contentLength: trimForContainer(fillToContainer(model.panelBody || ' '), 999).length,
  }))
  const boxContent = model.panelBox
    ? trimForContainer(formatBoxContent(model.panelBox), 999)
    : ''
  updates.push(new TextContainerUpgrade({
    containerID: 7,
    containerName: 'panel-box',
    content: boxContent,
    contentOffset: 0,
    contentLength: boxContent.length,
  }))
  updates.push(new TextContainerUpgrade({
    containerID: 4,
    containerName: 'footer',
    content: trimForContainer(model.panelFooter, 120),
    contentOffset: 0,
    contentLength: trimForContainer(model.panelFooter, 120).length,
  }))
  return updates
}
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
    containerID: 8,
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

function sidebarListContainer(model: Extract<ScreenModel, { kind: 'sidebar' }>) {
  const items = (model.sidebarItems.length ? model.sidebarItems : ['']).slice(0, 20).map((item) => trimForContainer(item, 64))
  return new ListContainerProperty({
    containerID: 8,
    containerName: 'sidebar-list',
    xPosition: 2,
    yPosition: 38,
    width: 166,
    height: 206,
    borderWidth: 0,
    borderColor: 8,
    paddingLength: 4,
    itemContainer: new ListItemContainerProperty({
      itemCount: items.length,
      itemWidth: 0,
      itemName: items,
      isItemSelectBorderEn: 1,
    }),
    isEventCapture: 1,
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

async function logHardwareEvent(raw: unknown, mapped: AppInput | undefined, authConfig?: () => TelegramAuthConfig) {
  try {
    const config = authConfig?.()
    const encryptedAuth = config ? await encryptedTelegramAuthHeader(config) : null
    if (!encryptedAuth || !config?.backendSharedSecret?.trim()) return
    const body = JSON.stringify({
      source: 'even-hub',
      buildVersion: APP_BUILD_VERSION,
      raw: summarizeForDebug(raw),
      mapped: mapped ?? null,
    })
    const encryptedPayload = await encryptJsonPayload(body, config.backendSharedSecret)
    await fetch(`${defaultApiBaseUrl()}/api/debug/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-TeleGlance-Auth': encryptedAuth },
      body: JSON.stringify({ encryptedPayload }),
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

const CONTAINER_FILL_BYTES = 990

function fillToContainer(content: string) {
  const currentBytes = encoder.encode(content).byteLength
  if (currentBytes >= CONTAINER_FILL_BYTES) return content
  const padBytes = CONTAINER_FILL_BYTES - currentBytes
  return content + ' '.repeat(padBytes)
}
