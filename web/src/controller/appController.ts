import { pcmChunksToWav } from '../audio/wav'
import type { TelegramApi } from '../api'
import type { Chat, Message, Topic } from '../types'
import type { AppInput, AppState, RecoverableState, ScreenModel } from './model'
import { screenModel } from './model'

export interface GlassesBridge {
  render(model: ScreenModel): Promise<void>
  setAudioEnabled(enabled: boolean): Promise<void>
}

export class TelegramAppController {
  private state: AppState = { screen: 'loading', message: 'Starting...' }
  private messagePoll: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly api: TelegramApi,
    private readonly bridge: GlassesBridge,
  ) {}

  get snapshot(): AppState {
    return this.state
  }

  async init() {
    await this.setState({ screen: 'loading', message: 'Checking Telegram session...' })
    await this.run(async () => {
      const status = await this.api.authStatus()
      if (!status.authorized) {
        await this.setState({
          screen: 'auth',
          mode: 'signedOut',
          message: 'Open Telegram login on the phone. Press to create QR login.',
        })
        return
      }
      await this.loadChats()
    })
  }

  async dispatch(input: AppInput) {
    if (input.type === 'foreground') {
      await this.init()
      return
    }

    if (input.type === 'audioChunk') {
      if (this.state.screen === 'recording') {
        this.state = { ...this.state, chunks: [...this.state.chunks, input.pcm] }
      }
      return
    }

    const state = this.state
    if ((state.screen === 'chats' || state.screen === 'topics') && input.type === 'selectIndex' && input.index === state.selectedIndex) {
      await this.dispatch({ type: 'press', index: input.index })
      return
    }
    switch (state.screen) {
      case 'auth':
        await this.handleAuth(state, input)
        return
      case 'chats':
        await this.handleChats(state, input)
        return
      case 'topics':
        await this.handleTopics(state, input)
        return
      case 'messages':
        await this.handleMessages(state, input)
        return
      case 'recording':
        await this.handleRecording(state, input)
        return
      case 'confirm':
        await this.handleConfirm(state, input)
        return
      case 'sent':
        await this.handleSent(state, input)
        return
      case 'error':
        await this.handleError(state, input)
        return
      case 'loading':
      case 'transcribing':
      case 'sending':
        return
    }
  }

  private async handleAuth(state: Extract<AppState, { screen: 'auth' }>, input: AppInput) {
    if (input.type !== 'press') return
    await this.run(async () => {
      if (state.mode === 'signedOut') {
        const qr = await this.api.startQrAuth()
        await this.setState({
          screen: 'auth',
          mode: 'qrPending',
          qrToken: qr.token,
          qrUrl: qr.url,
          message: qr.url
            ? `Scan QR in Telegram mobile.\n${qr.url}\n\nPress after login.`
            : 'QR login started. Scan in Telegram mobile, then press again.',
        })
        return
      }

      const status = await this.api.qrAuthStatus()
      if (status.authorized) {
        await this.loadChats()
      } else if (status.expired) {
        await this.setState({
          screen: 'auth',
          mode: 'signedOut',
          message: `${status.message ?? 'QR login expired.'} Press to create a new QR login.`,
        })
      } else {
        await this.setState({
          ...state,
          message: `${status.message ?? 'Still waiting for Telegram login.'} Press after scanning to check again.`,
        })
      }
    }, state)
  }

  private async handleChats(state: Extract<AppState, { screen: 'chats' }>, input: AppInput) {
    if (input.type === 'swipeUp') {
      this.updateStateOnly({ ...state, selectedIndex: moveSelection(state.selectedIndex, state.chats.length, -1) })
      return
    }
    if (input.type === 'swipeDown') {
      this.updateStateOnly({ ...state, selectedIndex: moveSelection(state.selectedIndex, state.chats.length, 1) })
      return
    }
    if (input.type === 'selectIndex') {
      this.updateStateOnly({ ...state, selectedIndex: clamp(input.index, 0, state.chats.length - 1) })
      return
    }
    if (input.type !== 'press') return

    const selectedIndex = selectedInputIndex(input, state.selectedIndex, state.chats.length)
    const selectedState = { ...state, selectedIndex }
    const chat = selectedState.chats[selectedIndex]
    if (!chat) return
    await this.openChat(chat, selectedState)
  }

  private async handleTopics(state: Extract<AppState, { screen: 'topics' }>, input: AppInput) {
    if (input.type === 'doublePress') {
      await this.loadChats()
      return
    }
    if (input.type === 'swipeUp') {
      this.updateStateOnly({ ...state, selectedIndex: moveSelection(state.selectedIndex, state.topics.length, -1) })
      return
    }
    if (input.type === 'swipeDown') {
      this.updateStateOnly({ ...state, selectedIndex: moveSelection(state.selectedIndex, state.topics.length, 1) })
      return
    }
    if (input.type === 'selectIndex') {
      this.updateStateOnly({ ...state, selectedIndex: clamp(input.index, 0, state.topics.length - 1) })
      return
    }
    if (input.type !== 'press') return

    const selectedIndex = selectedInputIndex(input, state.selectedIndex, state.topics.length)
    const selectedState = { ...state, selectedIndex }
    const topic = selectedState.topics[selectedIndex]
    if (!topic) return
    await this.openMessages(selectedState.chat, topic, selectedState)
  }

  private async handleMessages(state: Extract<AppState, { screen: 'messages' }>, input: AppInput) {
    if (input.type === 'doublePress') {
      await this.goBackFromMessages(state)
      return
    }
    if (input.type === 'swipeUp') {
      await this.loadOlderMessages(state)
      return
    }
    if (input.type === 'swipeDown') {
      await this.loadNewerMessages(state)
      return
    }
    if (input.type !== 'press') return

    await this.bridge.setAudioEnabled(true)
    await this.setState({
      screen: 'recording',
      chat: state.chat,
      topic: state.topic,
      messages: state.messages,
      back: state.back,
      status: state.status,
      newerPages: state.newerPages,
      isNewestPage: state.isNewestPage,
      chunks: [],
    })
  }

  private async handleRecording(state: Extract<AppState, { screen: 'recording' }>, input: AppInput) {
    if (input.type === 'doublePress') {
      await this.bridge.setAudioEnabled(false)
      await this.setState({
        screen: 'messages',
        chat: state.chat,
        topic: state.topic,
        messages: state.messages,
        back: state.back,
        status: state.status,
        newerPages: state.newerPages,
        isNewestPage: state.isNewestPage,
      })
      return
    }
    if (input.type !== 'press') return
    await this.bridge.setAudioEnabled(false)
    await this.setState({
      screen: 'transcribing',
      chat: state.chat,
      topic: state.topic,
      messages: state.messages,
      back: state.back,
      status: state.status,
      newerPages: state.newerPages,
      isNewestPage: state.isNewestPage,
    })
    await this.run(async () => {
      if (!hasRecordableAudio(state.chunks)) {
        await this.setState({
          screen: 'messages',
          chat: state.chat,
          topic: state.topic,
          messages: state.messages,
          back: state.back,
          status: state.status,
          newerPages: state.newerPages,
          isNewestPage: state.isNewestPage,
        })
        return
      }
      const result = await this.api.transcribe(pcmChunksToWav(state.chunks))
      const transcript = result.text.trim()
      if (transcript.length === 0) {
        await this.setState({
          screen: 'messages',
          chat: state.chat,
          topic: state.topic,
          messages: state.messages,
          back: state.back,
          status: state.status,
          newerPages: state.newerPages,
          isNewestPage: state.isNewestPage,
        })
        return
      }
      await this.setState({
        screen: 'confirm',
        chat: state.chat,
        topic: state.topic,
        messages: state.messages,
        transcript,
        selectedIndex: 0,
        back: state.back,
        status: state.status,
        newerPages: state.newerPages,
        isNewestPage: state.isNewestPage,
      })
    }, {
      screen: 'messages',
      chat: state.chat,
      topic: state.topic,
      messages: state.messages,
      back: state.back,
      status: state.status,
      newerPages: state.newerPages,
      isNewestPage: state.isNewestPage,
    })
  }

  private async handleConfirm(state: Extract<AppState, { screen: 'confirm' }>, input: AppInput) {
    if (input.type === 'swipeUp' || input.type === 'swipeDown') {
      await this.setState({ ...state, selectedIndex: state.selectedIndex === 0 ? 1 : 0 })
      return
    }
    if (input.type === 'doublePress') {
      await this.setState({ screen: 'messages', chat: state.chat, topic: state.topic, messages: state.messages, back: state.back, status: state.status, newerPages: state.newerPages, isNewestPage: state.isNewestPage })
      return
    }
    if (input.type !== 'press') return

    if (state.selectedIndex === 1) {
      await this.setState({ screen: 'messages', chat: state.chat, topic: state.topic, messages: state.messages, back: state.back, status: state.status, newerPages: state.newerPages, isNewestPage: state.isNewestPage })
      return
    }

    await this.setState({
      screen: 'sending',
      chat: state.chat,
      topic: state.topic,
      messages: state.messages,
      transcript: state.transcript,
      back: state.back,
      status: state.status,
      newerPages: state.newerPages,
      isNewestPage: state.isNewestPage,
    })
    await this.run(async () => {
      const sent = await this.api.sendMessage(state.chat.id, {
        text: state.transcript,
        topicId: topicThreadId(state.topic),
      })
      const refreshed = await this.refreshLatestMessages(state).catch(() => [])
      const messages = refreshed.some((message) => String(message.id) === String(sent.id))
        ? refreshed
        : normalizeMessagePage([...refreshed, sent])
      await this.setState({
        screen: 'messages',
        chat: state.chat,
        topic: state.topic,
        messages,
        cursor: oldestMessageId(messages),
        back: state.back,
        status: 'Sent. Checking replies...',
        newerPages: [],
        isNewestPage: true,
      })
      void this.refreshAfterSend(state, sent)
    }, state)
  }

  private async handleSent(state: Extract<AppState, { screen: 'sent' }>, input: AppInput) {
    if (input.type === 'doublePress') {
      await this.loadChats()
      return
    }
    if (input.type === 'press') {
      const messages = await this.refreshLatestMessages(state)
      await this.setState({ screen: 'messages', chat: state.chat, topic: state.topic, messages, cursor: oldestMessageId(messages), back: state.back, status: 'Checking replies...', newerPages: [], isNewestPage: true })
    }
  }

  private async handleError(state: Extract<AppState, { screen: 'error' }>, input: AppInput) {
    if (input.type === 'doublePress' && state.previous) {
      await this.setState(state.previous)
      return
    }
    if (input.type === 'press') {
      if (state.previous) await this.setState(state.previous)
      await this.init()
    }
  }

  private async loadChats(previous?: RecoverableState) {
    await this.run(async () => {
      const chats = await this.api.listChats(5)
      await this.setState({ screen: 'chats', chats, selectedIndex: 0 })
    }, previous)
  }

  private async openChat(chat: Chat, previous: RecoverableState) {
    await this.run(async () => {
      const topics = chat.isForum ? await this.api.listTopics(chat.id) : []
      if (topics.length > 0) {
        await this.setState({ screen: 'topics', chat, topics, selectedIndex: 0 })
        return
      }
      await this.openMessages(chat, undefined, previous)
    }, previous)
  }

  private async openMessages(chat: Chat, topic: Topic | undefined, previous: RecoverableState) {
    await this.run(async () => {
      const messages = await this.api.listMessages(chat.id, { topicId: topicThreadId(topic), limit: 8 })
      const normalized = normalizeMessagePage(messages)
      await this.setState({ screen: 'messages', chat, topic, messages: normalized, cursor: oldestMessageId(normalized), back: messageBackTarget(previous), status: 'Checking replies...', newerPages: [], isNewestPage: true })
    }, previous)
  }

  private async loadOlderMessages(state: Extract<AppState, { screen: 'messages' }>) {
    await this.run(async () => {
      const older = await this.api.listMessages(state.chat.id, {
        topicId: topicThreadId(state.topic),
        beforeId: state.cursor,
        limit: 8,
      })
      if (older.length === 0) return
      const normalized = normalizeMessagePage(older)
      await this.setState({
        ...state,
        messages: normalized,
        cursor: oldestMessageId(normalized),
        status: 'Older messages',
        newerPages: [...(state.newerPages ?? []), state.messages],
        isNewestPage: false,
      })
    }, state)
  }

  private async loadNewerMessages(state: Extract<AppState, { screen: 'messages' }>) {
    const newerPages = state.newerPages ?? []
    if (newerPages.length === 0 || state.isNewestPage) return

    const messages = newerPages[newerPages.length - 1]
    const remainingPages = newerPages.slice(0, -1)
    await this.setState({
      ...state,
      messages,
      cursor: oldestMessageId(messages),
      newerPages: remainingPages,
      isNewestPage: remainingPages.length === 0,
      status: remainingPages.length === 0 ? 'Checking replies...' : 'Newer messages',
    })
  }

  private async refreshLatestMessages(state: { chat: Chat; topic?: Topic }) {
    return normalizeMessagePage(await this.api.listMessages(state.chat.id, { topicId: topicThreadId(state.topic), limit: 8 }))
  }

  private async refreshAfterSend(state: Extract<AppState, { screen: 'confirm' }>, sent: Message) {
    const previousIds = new Set(state.messages.map((message) => String(message.id)))

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (attempt > 0) await sleep(1000)
      const refreshed = await this.refreshLatestMessages(state)
      if (refreshed.length === 0) continue

      const hasSent = refreshed.some((message) => String(message.id) === String(sent.id))
      const hasNewIncoming = refreshed.some(
        (message) => !previousIds.has(String(message.id)) && String(message.id) !== String(sent.id),
      )
      const current = this.state
      if (current.screen === 'sent') {
        const messages = hasSent ? refreshed : normalizeMessagePage([...refreshed, sent])
        await this.setState({
          ...current,
          messages,
          status: hasNewIncoming ? 'New reply' : 'Checking replies...',
          newerPages: [],
          isNewestPage: true,
        })
      } else if (current.screen === 'messages') {
        const messages = hasSent ? refreshed : normalizeMessagePage([...refreshed, sent])
        await this.setState({
          ...current,
          messages,
          cursor: oldestMessageId(messages),
          status: hasNewIncoming ? 'New reply' : 'Checking replies...',
          newerPages: [],
          isNewestPage: true,
        })
      }
      if (hasSent && hasNewIncoming) return
    }
  }

  private async goBackFromMessages(state: Extract<AppState, { screen: 'messages' }>) {
    if (state.back) {
      await this.setState(state.back)
      return
    }
    if (state.topic) {
      await this.setState({
        screen: 'topics',
        chat: state.chat,
        topics: await this.api.listTopics(state.chat.id),
        selectedIndex: 0,
      })
      return
    }
    await this.loadChats()
  }

  private async run(operation: () => Promise<void>, previous?: RecoverableState) {
    try {
      await operation()
    } catch (error) {
      await this.bridge.setAudioEnabled(false).catch(() => undefined)
      await this.setState({
        screen: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        previous,
      })
    }
  }

  private async setState(state: AppState) {
    this.state = state
    this.syncMessagePolling()
    await this.bridge.render(screenModel(state))
  }

  private updateStateOnly(state: AppState) {
    this.state = state
    this.syncMessagePolling()
  }

  private syncMessagePolling() {
    const shouldPoll = this.state.screen === 'messages' || this.state.screen === 'sent'
    if (!shouldPoll) {
      this.stopMessagePolling()
      return
    }
    if (this.messagePoll) return
    this.messagePoll = setInterval(() => {
      void this.refreshVisibleMessages()
    }, 3000)
    const maybeNodeInterval = this.messagePoll as unknown as { unref?: () => void }
    maybeNodeInterval.unref?.()
  }

  private stopMessagePolling() {
    if (!this.messagePoll) return
    clearInterval(this.messagePoll)
    this.messagePoll = undefined
  }

  private async refreshVisibleMessages() {
    const state = this.state
    if (state.screen !== 'messages' && state.screen !== 'sent') return
    const messages = await this.refreshLatestMessages(state).catch(() => undefined)
    if (!messages || messages.length === 0) return
    const current = this.state
    if (current.screen !== 'messages' && current.screen !== 'sent') return

    if (current.screen === 'messages' && current.isNewestPage === false) {
      const knownNewestId = newestKnownMessageId(current)
      const nextNewestId = newestMessageId(messages)
      if (knownNewestId !== undefined && nextNewestId !== undefined && Number(nextNewestId) <= Number(knownNewestId)) return
    }

    if (!hasMessageChanges(current.messages, messages)) return
    if (current.screen === 'messages') {
      await this.setState({ ...current, messages, cursor: oldestMessageId(messages), status: hasIncomingChange(current.messages, messages) ? 'New reply' : 'Checking replies...', newerPages: [], isNewestPage: true })
      return
    }
    await this.setState({ ...current, messages, status: hasIncomingChange(current.messages, messages) ? 'New reply' : 'Checking replies...', newerPages: [], isNewestPage: true })
  }
}

function moveSelection(index: number, count: number, delta: number) {
  if (count <= 0) return 0
  return clamp(index + delta, 0, count - 1)
}

function selectedInputIndex(input: { index?: number }, currentIndex: number, count: number) {
  if (typeof input.index !== 'number') return currentIndex
  return clamp(input.index, 0, count - 1)
}

function hasMessageChanges(current: Message[], next: Message[]) {
  if (current.length !== next.length) return true
  return current.some((message, index) => {
    const nextMessage = next[index]
    return !nextMessage || String(message.id) !== String(nextMessage.id) || message.text !== nextMessage.text
  })
}

function hasIncomingChange(current: Message[], next: Message[]) {
  const currentIds = new Set(current.map((message) => String(message.id)))
  return next.some((message) => !message.outgoing && !currentIds.has(String(message.id)))
}

function normalizeMessagePage(messages: Message[]) {
  return [...dedupeMessages(messages)].sort(compareMessages)
}

function dedupeMessages(messages: Message[]) {
  const byId = new Map<string, Message>()
  for (const message of messages) {
    byId.set(String(message.id), message)
  }
  return byId.values()
}

function compareMessages(left: Message, right: Message) {
  const leftId = Number(left.id)
  const rightId = Number(right.id)
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
    return leftId - rightId
  }

  const leftTime = left.sentAt ? Date.parse(left.sentAt) : Number.NaN
  const rightTime = right.sentAt ? Date.parse(right.sentAt) : Number.NaN
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime !== rightTime) {
    return leftTime - rightTime
  }

  return String(left.id).localeCompare(String(right.id))
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    const timeout = setTimeout(resolve, ms)
    const maybeNodeTimeout = timeout as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
  })
}

function topicThreadId(topic: Topic | undefined) {
  return topic?.id
}

function oldestMessageId(messages: { id: string | number }[]) {
  if (messages.length === 0) return undefined
  const numericIds = messages.map((message) => Number(message.id)).filter(Number.isFinite)
  if (numericIds.length === messages.length) return Math.min(...numericIds)
  return messages[messages.length - 1]?.id
}

function newestMessageId(messages: { id: string | number }[]) {
  if (messages.length === 0) return undefined
  const numericIds = messages.map((message) => Number(message.id)).filter(Number.isFinite)
  if (numericIds.length === messages.length) return Math.max(...numericIds)
  return messages[messages.length - 1]?.id
}

function newestKnownMessageId(state: Extract<AppState, { screen: 'messages' }>) {
  const newestKnownPage = state.newerPages?.[0] ?? state.messages
  return newestMessageId(newestKnownPage)
}

function messageBackTarget(previous: RecoverableState): RecoverableState | undefined {
  if (previous.screen === 'messages') return previous.back
  return previous
}

function hasRecordableAudio(chunks: Uint8Array[]) {
  const sampleBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  if (sampleBytes < 3200) return false

  let nonZeroSamples = 0
  for (const chunk of chunks) {
    for (let index = 0; index + 1 < chunk.length; index += 2) {
      if (chunk[index] !== 0 || chunk[index + 1] !== 0) {
        nonZeroSamples += 1
        if (nonZeroSamples > 20) return true
      }
    }
  }
  return false
}
