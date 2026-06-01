import { pcmChunksToWav } from '../audio/wav'
import type { TelegramApi } from '../api'
import type { Chat, Message, Topic } from '../types'
import type { AppInput, AppState, RecoverableState, ScreenModel } from './model'
import { messageScrollUnitCount, screenModel } from './model'

export interface GlassesBridge {
  render(model: ScreenModel): Promise<void>
  setAudioEnabled(enabled: boolean): Promise<void>
  showExitConfirmation?(): Promise<void>
  turnScreenOff?(): Promise<void>
}

const MESSAGE_PAGE_LIMIT = 50
const OLDER_PREFETCH_LOW_WATER = 35
const OLDER_PREFETCH_TARGET_MESSAGES = 220
const CHAT_LIST_LIMIT = 20

export class TelegramAppController {
  private state: AppState = { screen: 'loading', message: 'Starting...' }
  private messagePoll: ReturnType<typeof setInterval> | undefined
  private chatPoll: ReturnType<typeof setInterval> | undefined
  private pendingMessagePress: ReturnType<typeof setTimeout> | undefined
  private lastMessagePressAt = 0
  private chatFingerprints = new Map<string, string>()
  private olderPrefetch:
    | {
      key: string
      cursor: string
      promise: Promise<boolean>
    }
    | undefined

  constructor(
    private readonly api: TelegramApi,
    private readonly bridge: GlassesBridge,
    private readonly messagePressDelayMs = 260,
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
      this.cancelPendingMessagePress()
      if (this.state.screen === 'asleep') {
        await this.bridge.turnScreenOff?.()
        return
      }
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
      case 'asleep':
        await this.handleAsleep(state, input)
        return
      case 'newMessage':
        await this.handleNewMessage(state, input)
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
    if (input.type === 'doublePress') {
      this.rememberChats(state.chats)
      await this.setState({ screen: 'asleep', chats: state.chats, selectedIndex: state.selectedIndex })
      await this.bridge.turnScreenOff?.()
      return
    }
    if (input.type === 'swipeUp') {
      await this.setState({ ...state, selectedIndex: moveSelection(state.selectedIndex, state.chats.length, -1) })
      return
    }
    if (input.type === 'swipeDown') {
      await this.setState({ ...state, selectedIndex: moveSelection(state.selectedIndex, state.chats.length, 1) })
      return
    }
    if (input.type === 'selectIndex') {
      await this.setState({ ...state, selectedIndex: clamp(input.index, 0, state.chats.length - 1) })
      return
    }
    if (input.type !== 'press') return

    const selectedIndex = selectedInputIndex(input, state.selectedIndex, state.chats.length)
    const selectedState = { ...state, selectedIndex }
    const chat = selectedState.chats[selectedIndex]
    if (!chat) return
    await this.openChat(chat, selectedState)
  }

  private async handleAsleep(state: Extract<AppState, { screen: 'asleep' }>, input: AppInput) {
    if (input.type !== 'doublePress') {
      await this.bridge.turnScreenOff?.()
      return
    }
    await this.setState({ screen: 'chats', chats: state.chats, selectedIndex: state.selectedIndex })
  }

  private async handleNewMessage(state: Extract<AppState, { screen: 'newMessage' }>, input: AppInput) {
    if (input.type === 'doublePress') {
      this.rememberChats(state.chats)
      await this.setState({ screen: 'asleep', chats: state.chats, selectedIndex: state.selectedIndex })
      await this.bridge.turnScreenOff?.()
      return
    }
    if (input.type !== 'press') return
    await this.openMessages(state.chat, state.topic, {
      screen: 'chats',
      chats: state.chats,
      selectedIndex: state.selectedIndex,
    })
  }

  private async handleTopics(state: Extract<AppState, { screen: 'topics' }>, input: AppInput) {
    if (input.type === 'doublePress') {
      await this.loadChats()
      return
    }
    if (input.type === 'swipeUp') {
      await this.setState({ ...state, selectedIndex: moveSelection(state.selectedIndex, state.topics.length, -1) })
      return
    }
    if (input.type === 'swipeDown') {
      await this.setState({ ...state, selectedIndex: moveSelection(state.selectedIndex, state.topics.length, 1) })
      return
    }
    if (input.type === 'selectIndex') {
      await this.setState({ ...state, selectedIndex: clamp(input.index, 0, state.topics.length - 1) })
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
      this.cancelPendingMessagePress()
      await this.goBackFromMessages(state)
      return
    }
    if (input.type === 'swipeUp') {
      this.cancelPendingMessagePress()
      await this.loadOlderMessages(state)
      return
    }
    if (input.type === 'swipeDown') {
      this.cancelPendingMessagePress()
      await this.loadNewerMessages(state)
      return
    }
    if (input.type !== 'press') return

    await this.scheduleMessagePress(state)
  }

  private async scheduleMessagePress(state: Extract<AppState, { screen: 'messages' }>) {
    this.cancelPendingMessagePress()
    if (this.messagePressDelayMs <= 0) {
      await this.startRecordingFromMessages(state)
      return
    }
    const timeout = setTimeout(() => {
      this.pendingMessagePress = undefined
      const current = this.state
      if (current.screen !== 'messages') return
      void this.startRecordingFromMessages(current)
    }, this.messagePressDelayMs)
    const maybeNodeTimeout = timeout as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
    this.pendingMessagePress = timeout
  }

  private cancelPendingMessagePress() {
    if (!this.pendingMessagePress) return
    clearTimeout(this.pendingMessagePress)
    this.pendingMessagePress = undefined
  }

  private async startRecordingFromMessages(state: Extract<AppState, { screen: 'messages' }>) {
    this.lastMessagePressAt = Date.now()
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
      scrollOffset: state.scrollOffset,
      chunks: [],
      startedAt: this.lastMessagePressAt,
    })
  }

  private async handleRecording(state: Extract<AppState, { screen: 'recording' }>, input: AppInput) {
    if (input.type === 'doublePress') {
      await this.bridge.setAudioEnabled(false)
      if (Date.now() - state.startedAt < 900) {
        await this.goBackFromMessages({
          screen: 'messages',
          chat: state.chat,
          topic: state.topic,
          messages: state.messages,
          back: state.back,
          status: state.status,
          newerPages: state.newerPages,
          isNewestPage: state.isNewestPage,
          scrollOffset: state.scrollOffset,
        })
        return
      }
      await this.setState({
        screen: 'messages',
        chat: state.chat,
        topic: state.topic,
        messages: state.messages,
        back: state.back,
        status: state.status,
        newerPages: state.newerPages,
        isNewestPage: state.isNewestPage,
        scrollOffset: state.scrollOffset,
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
      scrollOffset: state.scrollOffset,
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
          scrollOffset: state.scrollOffset,
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
          scrollOffset: state.scrollOffset,
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
        scrollOffset: state.scrollOffset,
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
      await this.setState({ screen: 'messages', chat: state.chat, topic: state.topic, messages: state.messages, back: state.back, status: state.status, newerPages: state.newerPages, isNewestPage: state.isNewestPage, scrollOffset: state.scrollOffset })
      return
    }
    if (input.type !== 'press') return

    if (state.selectedIndex === 1) {
      await this.setState({ screen: 'messages', chat: state.chat, topic: state.topic, messages: state.messages, back: state.back, status: state.status, newerPages: state.newerPages, isNewestPage: state.isNewestPage, scrollOffset: state.scrollOffset })
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
      scrollOffset: state.scrollOffset,
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
        status: 'Sent',
        newerPages: [],
        isNewestPage: true,
        scrollOffset: 0,
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
      await this.setState({ screen: 'messages', chat: state.chat, topic: state.topic, messages, cursor: oldestMessageId(messages), back: state.back, newerPages: [], isNewestPage: true, scrollOffset: 0 })
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
      const chats = await this.api.listChats(CHAT_LIST_LIMIT)
      this.rememberChats(chats)
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
      const messages = await this.api.listMessages(chat.id, { topicId: topicThreadId(topic), limit: MESSAGE_PAGE_LIMIT })
      const normalized = normalizeMessagePage(messages)
      await this.setState({ screen: 'messages', chat, topic, messages: normalized, cursor: oldestMessageId(normalized), back: messageBackTarget(previous), newerPages: [], isNewestPage: true, scrollOffset: 0 })
      this.maybePrefetchOlder()
    }, previous)
  }

  private async loadOlderMessages(state: Extract<AppState, { screen: 'messages' }>) {
    const currentOffset = state.scrollOffset ?? 0
    const nextOffset = Math.min(currentOffset + 1, maxScrollOffset(state.messages))
    if (nextOffset > currentOffset) {
      await this.setState({
        ...state,
        scrollOffset: nextOffset,
        isNewestPage: nextOffset === 0,
        status: nextOffset === 0 ? undefined : 'Older messages',
      })
      this.maybePrefetchOlder()
      return
    }

    await this.run(async () => {
      await this.prefetchOlderMessages(state)
      const current = this.state
      if (current.screen !== 'messages') return
      const offset = Math.min((current.scrollOffset ?? 0) + 1, maxScrollOffset(current.messages))
      await this.setState({ ...current, scrollOffset: offset, status: 'Older messages', isNewestPage: false })
      this.maybePrefetchOlder()
    }, state)
  }

  private async loadNewerMessages(state: Extract<AppState, { screen: 'messages' }>) {
    const nextOffset = Math.max(0, (state.scrollOffset ?? 0) - 1)
    if (nextOffset === (state.scrollOffset ?? 0)) return
    await this.setState({
      ...state,
      scrollOffset: nextOffset,
      isNewestPage: nextOffset === 0,
      status: nextOffset === 0 ? undefined : 'Newer messages',
    })
    this.maybePrefetchOlder()
  }

  private async refreshLatestMessages(state: { chat: Chat; topic?: Topic }) {
    return normalizeMessagePage(await this.api.listMessages(state.chat.id, { topicId: topicThreadId(state.topic), limit: MESSAGE_PAGE_LIMIT }))
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
          status: hasNewIncoming ? 'New reply' : undefined,
          newerPages: [],
          isNewestPage: true,
          scrollOffset: 0,
        })
      } else if (current.screen === 'messages') {
        const messages = hasSent ? refreshed : normalizeMessagePage([...refreshed, sent])
        await this.setState({
          ...current,
          messages,
          cursor: oldestMessageId(messages),
          status: hasNewIncoming ? 'New reply' : undefined,
          newerPages: [],
          isNewestPage: true,
          scrollOffset: 0,
        })
      }
      if (hasSent && hasNewIncoming) return
    }
  }

  private maybePrefetchOlder() {
    const state = this.state
    if (state.screen !== 'messages') return
    const maxOffset = maxScrollOffset(state.messages)
    const remainingLoadedScroll = maxOffset - (state.scrollOffset ?? 0)
    if (remainingLoadedScroll > OLDER_PREFETCH_LOW_WATER && state.messages.length >= OLDER_PREFETCH_TARGET_MESSAGES) return
    void this.prefetchOlderMessages(state, { chain: true }).catch(() => undefined)
  }

  private async prefetchOlderMessages(state: Extract<AppState, { screen: 'messages' }>, options: { chain?: boolean } = {}) {
    if (state.cursor === undefined) return

    const key = messageThreadKey(state)
    const cursor = String(state.cursor)
    if (this.olderPrefetch?.key === key && this.olderPrefetch.cursor === cursor) {
      await this.olderPrefetch.promise
      return
    }

    const promise = this.fetchAndAppendOlderMessages(state, key, cursor)
    this.olderPrefetch = { key, cursor, promise }
    const added = await promise.finally(() => {
      if (this.olderPrefetch?.key === key && this.olderPrefetch.cursor === cursor) {
        this.olderPrefetch = undefined
      }
    })
    if (options.chain && added) this.continueOlderPrefetch(key)
  }

  private async fetchAndAppendOlderMessages(state: Extract<AppState, { screen: 'messages' }>, key: string, cursor: string): Promise<boolean> {
    const older = await this.api.listMessages(state.chat.id, {
      topicId: topicThreadId(state.topic),
      beforeId: state.cursor,
      limit: MESSAGE_PAGE_LIMIT,
    })
    if (older.length === 0) return false

    const current = this.state
    if (current.screen !== 'messages' || messageThreadKey(current) !== key || String(current.cursor) !== cursor) return false

    const messages = normalizeMessagePage([...older, ...current.messages])
    if (!hasMessageChanges(current.messages, messages)) return false

    await this.setState({
      ...current,
      messages,
      cursor: oldestMessageId(messages),
      status: current.scrollOffset === 0 ? current.status : 'Older messages',
    })
    return true
  }

  private continueOlderPrefetch(key: string) {
    const current = this.state
    if (current.screen !== 'messages' || messageThreadKey(current) !== key) return
    if (current.messages.length >= OLDER_PREFETCH_TARGET_MESSAGES) return
    void this.prefetchOlderMessages(current, { chain: true }).catch(() => undefined)
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
    this.syncChatPolling()
    await this.bridge.render(screenModel(state))
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

  private syncChatPolling() {
    const shouldPoll = this.state.screen === 'chats' || this.state.screen === 'asleep' || this.state.screen === 'newMessage'
    if (!shouldPoll) {
      this.stopChatPolling()
      return
    }
    if (this.chatPoll) return
    this.chatPoll = setInterval(() => {
      void this.refreshRootChats()
    }, 5000)
    const maybeNodeInterval = this.chatPoll as unknown as { unref?: () => void }
    maybeNodeInterval.unref?.()
  }

  private stopChatPolling() {
    if (!this.chatPoll) return
    clearInterval(this.chatPoll)
    this.chatPoll = undefined
  }

  private async refreshRootChats() {
    const state = this.state
    if (state.screen !== 'chats' && state.screen !== 'asleep' && state.screen !== 'newMessage') return
    const chats = await this.api.listChats(CHAT_LIST_LIMIT).catch(() => undefined)
    if (!chats) return

    const activity = this.findNewChatActivity(chats)
    this.rememberChats(chats)

    const current = this.state
    if (current.screen !== 'chats' && current.screen !== 'asleep' && current.screen !== 'newMessage') return

    const selectedIndex = clamp(current.selectedIndex, 0, Math.max(0, chats.length - 1))
    if (!activity) {
      if (current.screen === 'chats') await this.setState({ ...current, chats, selectedIndex })
      return
    }

    const topic = activity.chat.isForum ? await this.findUnreadTopic(activity.chat).catch(() => undefined) : undefined
    await this.setState({
      screen: 'newMessage',
      chat: activity.chat,
      topic,
      message: activity.chat.lastMessage ?? '',
      chats,
      selectedIndex,
    })
  }

  private findNewChatActivity(chats: Chat[]) {
    for (const chat of chats) {
      const key = String(chat.id)
      const previous = this.chatFingerprints.get(key)
      const current = chatFingerprint(chat)
      if (!previous) continue
      if (previous !== current && (chat.unreadCount ?? 0) > 0) return { chat }
    }
    return undefined
  }

  private rememberChats(chats: Chat[]) {
    this.chatFingerprints = new Map(chats.map((chat) => [String(chat.id), chatFingerprint(chat)]))
  }

  private async findUnreadTopic(chat: Chat) {
    const topics = await this.api.listTopics(chat.id)
    return topics.find((topic) => (topic.unreadCount ?? 0) > 0) ?? topics[0]
  }

  private async refreshVisibleMessages() {
    const state = this.state
    if (state.screen !== 'messages' && state.screen !== 'sent') return
    const messages = await this.refreshLatestMessages(state).catch(() => undefined)
    if (!messages || messages.length === 0) return
    const current = this.state
    if (current.screen !== 'messages' && current.screen !== 'sent') return

    const merged = normalizeMessagePage([...current.messages, ...messages])
    if (!hasMessageChanges(current.messages, merged)) return
    if (current.screen === 'messages') {
      await this.setState({ ...current, messages: merged, cursor: oldestMessageId(merged), status: hasIncomingChange(current.messages, merged) ? 'New reply' : undefined, newerPages: [], isNewestPage: true, scrollOffset: 0 })
      this.maybePrefetchOlder()
      return
    }
    await this.setState({ ...current, messages: merged, status: hasIncomingChange(current.messages, merged) ? 'New reply' : undefined, newerPages: [], isNewestPage: true, scrollOffset: 0 })
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

function maxScrollOffset(messages: Message[]) {
  return Math.max(0, messageScrollUnitCount(messages) - 1)
}

function messageThreadKey(state: { chat: Chat; topic?: Topic }) {
  return `${String(state.chat.id)}:${String(topicThreadId(state.topic) ?? '')}`
}

function chatFingerprint(chat: Chat) {
  return `${chat.unreadCount ?? 0}:${chat.lastMessage ?? ''}`
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
