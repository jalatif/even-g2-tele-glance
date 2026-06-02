import type { AppState, ScreenModel } from './controller/model'

export const TELEGLANCE_TEST_LOG_PREFIX = '[TeleGlanceTest]'

export function isTeleGlanceFixtureMode() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TELEGLANCE_FIXTURE === '1') return true
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('teleGlanceFixture') === '1'
}

export function getFixtureTestOverrides(): {
  missingCredentials: boolean
  signedOut: boolean
  errorOnAuthStatus: boolean
  slowChats: boolean
  chatDelayMs: number
  injectedNotification: { chatId: string; message: string; topicId?: string | null } | null
  nextTranscript: string | null
} {
  if (typeof window === 'undefined') {
    return {
      missingCredentials: false,
      signedOut: false,
      errorOnAuthStatus: false,
      slowChats: false,
      chatDelayMs: 0,
      injectedNotification: null,
      nextTranscript: null,
    }
  }
  const params = new URLSearchParams(window.location.search)
  const chatDelayMs = Number(params.get('chatDelayMs') ?? '0') || 0
  const notify = params.get('teleGlanceNotify')
  const transcript = params.get('teleGlanceTranscript')
  return {
    missingCredentials: params.get('teleGlanceAuth') === 'missing',
    signedOut: params.get('teleGlanceAuth') === 'signed-out',
    errorOnAuthStatus: params.get('teleGlanceAuth') === 'error',
    slowChats: params.get('teleGlanceAuth') === 'slow',
    chatDelayMs,
    injectedNotification: notify
      ? {
          chatId: notify,
          message: params.get('teleGlanceNotifyText') ?? 'New message',
          topicId: params.get('teleGlanceNotifyTopic'),
        }
      : null,
    nextTranscript: transcript,
  }
}

function isTestLoggingEnabled() {
  if (typeof import.meta !== 'undefined' && import.meta.env?.PROD) return false
  return true
}

export function logTeleGlanceTest(event: string, payload: Record<string, unknown>) {
  if (!isTestLoggingEnabled()) return
  console.log(`${TELEGLANCE_TEST_LOG_PREFIX} ${JSON.stringify({ event, ts: Date.now(), ...payload })}`)
}

export function logApiEvent<T>(call: string, args: unknown, startedAt: number, endedAt: number, ok: boolean, result?: T, error?: unknown) {
  logTeleGlanceTest('api', {
    call,
    args,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    ok,
    error: error ? String(error) : undefined,
    resultPreview: ok ? previewApiResult(result) : undefined,
  })
}

function previewApiResult(result: unknown): unknown {
  if (result === undefined || result === null) return result
  if (Array.isArray(result)) return { __array: true, length: result.length, first: result[0] }
  if (typeof result === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      if (key === 'sessionString' || key === 'stringSession') {
        out[key] = '[redacted]'
      } else {
        out[key] = value
      }
    }
    return out
  }
  return result
}

export function logPrefetchEvent(kind: 'chat' | 'topic' | 'message' | 'older', key: string, startedAt: number, endedAt: number, ok: boolean, fromCache: boolean, error?: unknown) {
  logTeleGlanceTest('prefetch', {
    kind,
    key,
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    ok,
    fromCache,
    error: error ? String(error) : undefined,
  })
}

export function logLifecycleEvent(kind: 'start' | 'asleep' | 'wake' | 'newMessage' | 'error', payload: Record<string, unknown> = {}) {
  logTeleGlanceTest('lifecycle', { kind, ...payload })
}

export function logRecordingEvent(kind: 'start' | 'audioChunk' | 'stop' | 'transcribe.start' | 'transcribe.end' | 'confirm' | 'send.start' | 'send.end', payload: Record<string, unknown> = {}) {
  logTeleGlanceTest('recording', { kind, ...payload })
}

export function logRenderMetrics(sequence: number, stateChangedAt: number, renderStartedAt: number, renderEndedAt: number) {
  logTeleGlanceTest('render.metrics', {
    sequence,
    stateChangedAt,
    renderStartedAt,
    renderEndedAt,
    totalMs: renderEndedAt - stateChangedAt,
  })
}

export function summarizeAppState(state: AppState): Record<string, unknown> {
  switch (state.screen) {
    case 'sidebar':
      if (state.focus === 'chats') {
        return {
          screen: state.screen,
          focus: state.focus,
          chats: state.chats.map((chat) => chat.title),
          selectedChatIndex: state.selectedChatIndex,
          selectedChatTitle: state.chats[state.selectedChatIndex]?.title ?? null,
          status: state.status ?? null,
        }
      }
      if (state.focus === 'topics') {
        return {
          screen: state.screen,
          focus: state.focus,
          selectedChatIndex: state.selectedChatIndex,
          chatTitle: state.chat.title,
          topics: state.topics.map((topic) => topic.title),
          selectedTopicIndex: state.selectedTopicIndex,
          selectedTopicTitle: state.topics[state.selectedTopicIndex]?.title ?? null,
          previewTopicTitle: state.previewTopic?.title ?? null,
          previewMessageCount: state.previewMessages?.length ?? 0,
        }
      }
      return {
        screen: state.screen,
        focus: state.focus,
        selectedChatIndex: state.selectedChatIndex,
        chatTitle: state.chat.title,
        topicTitle: state.topic?.title ?? null,
        messageCount: state.messages.length,
        messageTexts: state.messages.map((message) => message.text),
        status: state.status ?? null,
        scrollOffset: state.scrollOffset ?? 0,
        isNewestPage: state.isNewestPage ?? null,
        cursor: state.cursor ?? null,
        back: state.back ? state.back.screen : null,
      }
    case 'sidebarRecording':
      return {
        screen: state.screen,
        focus: state.focus,
        chatTitle: state.chat.title,
        topicTitle: state.topic?.title ?? null,
        messageCount: state.messages.length,
        chunksLength: state.chunks.length,
        chunksTotalBytes: state.chunks.reduce((total, chunk) => total + chunk.byteLength, 0),
        startedAt: state.startedAt,
        back: state.back ? state.back.screen : null,
      }
    case 'sidebarTranscribing':
      return {
        screen: state.screen,
        focus: state.focus,
        chatTitle: state.chat.title,
        topicTitle: state.topic?.title ?? null,
        messageCount: state.messages.length,
        back: state.back ? state.back.screen : null,
      }
    case 'sidebarConfirm':
      return {
        screen: state.screen,
        focus: state.focus,
        chatTitle: state.chat.title,
        topicTitle: state.topic?.title ?? null,
        transcript: state.transcript,
        selectedIndex: state.selectedIndex,
        back: state.back ? state.back.screen : null,
      }
    case 'sidebarSending':
      return {
        screen: state.screen,
        focus: state.focus,
        chatTitle: state.chat.title,
        topicTitle: state.topic?.title ?? null,
        transcript: state.transcript,
        back: state.back ? state.back.screen : null,
      }
    case 'sidebarSent':
      return {
        screen: state.screen,
        focus: state.focus,
        chatTitle: state.chat.title,
        topicTitle: state.topic?.title ?? null,
        messageCount: state.messages.length,
        status: state.status ?? null,
        back: state.back ? state.back.screen : null,
      }
    case 'newMessage':
      return {
        screen: state.screen,
        chatTitle: state.chat.title,
        topicTitle: state.topic?.title ?? null,
        message: state.message,
        selectedChatIndex: state.selectedChatIndex,
        chatCount: state.chats.length,
      }
    case 'auth':
      return { screen: state.screen, mode: state.mode, message: state.message, phone: state.phone ?? null }
    case 'loading':
    case 'error':
      return { screen: state.screen, message: state.message }
    case 'asleep':
      return { screen: state.screen, selectedChatIndex: state.selectedChatIndex }
    default:
      return { screen: (state as { screen: string }).screen }
  }
}

export function summarizeScreenModel(model: ScreenModel): Record<string, unknown> {
  if (model.kind === 'sidebar') {
    return {
      kind: model.kind,
      title: model.title,
      focus: model.focus,
      sidebarTitle: model.sidebarTitle,
      sidebarItems: model.sidebarItems,
      sidebarSelected: model.sidebarSelected,
      selectedSidebarItem: model.sidebarItems[model.sidebarSelected] ?? null,
      panelTitle: model.panelTitle,
      panelBody: model.panelBody,
      panelFooter: model.panelFooter,
      panelBoxHeading: model.panelBox?.heading ?? null,
      panelBoxContent: model.panelBox?.content ?? null,
    }
  }
  if (model.kind === 'list') {
    return {
      kind: model.kind,
      title: model.title,
      items: model.items,
      selectedIndex: model.selectedIndex,
      selectedItem: model.items[model.selectedIndex] ?? null,
    }
  }
  return {
    kind: model.kind,
    title: model.title,
    body: model.body,
    footer: model.footer ?? null,
    boxHeading: model.box?.heading ?? null,
    boxContent: model.box?.content ?? null,
  }
}
