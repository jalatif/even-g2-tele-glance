import { pcmChunksToWav } from '../audio/wav'
import type { TelegramApi } from '../api'
import type { Chat, Id, Message, TelegramUpdate, Topic } from '../types'
import type { AppInput, AppState, RecoverableState, ScreenModel } from './model'
import { messageScrollUnitCount, screenModel } from './model'

export interface GlassesBridge {
  render(model: ScreenModel): Promise<void>
  setAudioEnabled(enabled: boolean): Promise<void>
  getLocalStorage?(key: string): Promise<string>
  setLocalStorage?(key: string, value: string): Promise<boolean>
  showExitConfirmation?(): Promise<void>
  turnScreenOff?(): Promise<void>
}

const MESSAGE_PAGE_LIMIT = 50
const OLDER_PREFETCH_LOW_WATER = 4
const CHAT_LIST_LIMIT = 20
const LOADING_OLDER_STATUS = 'Loading older messages...'
const RENDER_DEFER_MS = 0
const RENDER_COOLDOWN_MS = 120
const INPUT_QUIET_MS = 900
const TOPIC_PREVIEW_IDLE_MS = 1000
const DEFAULT_RUNTIME_CONFIG: ControllerRuntimeConfig = {
  messagePressDelayMs: 260,
  messagePollMs: 3000,
  chatPollMs: 5000,
  recordingMinDurationMs: 900,
  selectionOnlyPressDelayMs: 600,
}

export type ControllerRuntimeConfig = {
  messagePressDelayMs: number
  messagePollMs: number
  chatPollMs: number
  recordingMinDurationMs: number
  selectionOnlyPressDelayMs: number
}

type StateListener = (state: AppState) => void

export class TelegramAppController {
  private state: AppState = { screen: 'loading', message: 'Starting...' }
  private runtimeConfig: ControllerRuntimeConfig
  private listeners = new Set<StateListener>()
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
  private rootRefreshInFlight = false
  private messageRefreshInFlight = false
  private topicPreviewDebounce: ReturnType<typeof setTimeout> | undefined
  private deferredRootRefreshTimer: ReturnType<typeof setTimeout> | undefined
  private deferredMessageRefreshTimer: ReturnType<typeof setTimeout> | undefined
  private topicPreviewCache = new Map<string, { messages: Message[]; cursor?: Id }>()
  private topicPreviewInFlight = new Set<string>()
  private topicsCache = new Map<string, Topic[]>()
  private topicsPrefetchInFlight = new Map<string, Promise<Topic[]>>()
  private messageCache = new Map<string, { messages: Message[]; cursor?: Id }>()
  private messagePrefetchInFlight = new Map<string, Promise<Message[]>>()
  private readAckMaxIds = new Map<string, Id>()
  private pendingReadAcks = new Map<string, { chat: Chat; topic?: Topic; maxId: Id }>()
  private readAckFlushTimer: ReturnType<typeof setTimeout> | undefined
  private selectionOnlyPressReadyAt = 0
  private renderInFlight = false
  private pendingRenderState: AppState | undefined
  private renderTimer: ReturnType<typeof setTimeout> | undefined
  private notifyTimer: ReturnType<typeof setTimeout> | undefined
  private notifyPending = false
  private openRequestId = 0
  private inputQuietUntil = 0
  constructor(
    private readonly api: TelegramApi,
    private readonly bridge: GlassesBridge,
    options: Partial<ControllerRuntimeConfig> | number = {},
    private readonly onTelegramSession?: (session: string) => void,
    private readonly hasTelegramCredentials: () => boolean = () => true,
  ) {
    this.runtimeConfig = typeof options === 'number'
      ? { ...DEFAULT_RUNTIME_CONFIG, messagePressDelayMs: options }
      : { ...DEFAULT_RUNTIME_CONFIG, ...options }
  }

  get snapshot(): AppState {
    return this.state
  }

  subscribe(listener: StateListener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  updateRuntimeConfig(options: Partial<ControllerRuntimeConfig>) {
    const previousMessagePollMs = this.runtimeConfig.messagePollMs
    const previousChatPollMs = this.runtimeConfig.chatPollMs
    this.runtimeConfig = { ...this.runtimeConfig, ...options }
    if (this.messagePoll && previousMessagePollMs !== this.runtimeConfig.messagePollMs) {
      this.stopMessagePolling()
      this.syncMessagePolling()
    }
    if (this.chatPoll && previousChatPollMs !== this.runtimeConfig.chatPollMs) {
      this.stopChatPolling()
      this.syncChatPolling()
    }
  }

  async sendTextFromPhone(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    const thread = activeThreadState(this.state)
    if (!thread) throw new Error('Open a chat or topic before sending.')

    const ctx = sidebarContext(this.state)
    await this.run(async () => {
      const sent = await this.api.sendMessage(thread.chat.id, {
        text: trimmed,
        topicId: topicThreadId(thread.topic),
      })
      const refreshed = await this.refreshLatestMessages(thread).catch(() => [])
      const messages = refreshed.some((message) => String(message.id) === String(sent.id))
        ? refreshed
        : normalizeMessagePage([...refreshed, sent])
      await this.setState({
        screen: 'sidebar', focus: 'messages',
        chats: ctx.chats, selectedChatIndex: ctx.selectedChatIndex,
        chat: thread.chat,
        topic: thread.topic,
        messages,
        cursor: oldestMessageId(messages),
        back: thread.back,
        status: 'Sent',
        newerPages: [],
        isNewestPage: true,
        scrollOffset: 0,
      })
    }, thread.back)
  }

  async handleTelegramUpdate(update: TelegramUpdate) {
    if (this.isInputQuiet()) {
      this.deferTelegramUpdate(update)
      return
    }
    const state = this.state
    if (state.screen === 'sidebar' && state.focus === 'chats' || state.screen === 'asleep' || state.screen === 'newMessage') {
      await this.refreshRootChats()
      return
    }
    if (state.screen === 'sidebar' && state.focus === 'messages' && updateMatchesThread(update, state)) {
      await this.refreshVisibleMessages()
    }
  }

  async init() {
    await this.setState({ screen: 'loading', message: 'Checking Telegram session...' })
    await this.run(async () => {
      if (!this.hasTelegramCredentials()) {
        await this.setState({
          screen: 'auth',
          mode: 'needsSetup',
          message: 'Follow the instructions on the Settings page to connect Telegram and the backend server.',
        })
        return
      }
      const status = await this.api.authStatus()
      if (!status.authorized) {
        const hasFrontendCredentials = this.hasTelegramCredentials()
        await this.setState({
          screen: 'auth',
          mode: hasFrontendCredentials ? 'signedOut' : 'needsSetup',
          message: !hasFrontendCredentials || status.configured === false
            ? 'Telegram not connected. Please connect using the instructions in Settings on the phone.'
            : 'Telegram not connected. Enter your phone number in the phone UI to receive a Telegram login code.',
        })
        return
      }
      await this.loadChats()
    })
  }

  async dispatch(input: AppInput) {
    if (input.type !== 'audioChunk') this.noteUserInput()
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
      if (this.state.screen === 'sidebarRecording') {
        this.state = { ...this.state, chunks: [...this.state.chunks, input.pcm] }
      }
      return
    }

    const state = this.state
    if (state.screen === 'sidebar' && (state.focus === 'chats' || state.focus === 'topics') && input.type === 'selectIndex') {
      const idx = state.focus === 'chats'
        ? selectedChatInputIndex(input, state.selectedChatIndex, state.chats)
        : selectedTopicInputIndex(input, state.selectedTopicIndex, state.topics)
      const currentIndex = state.focus === 'chats' ? state.selectedChatIndex : state.selectedTopicIndex
      if (idx === currentIndex && Date.now() >= this.selectionOnlyPressReadyAt) {
        await this.dispatch({ type: 'press', index: idx, itemName: input.itemName })
        return
      }
    }
    if (state.screen === 'sidebarConfirm' && input.type === 'selectIndex' && input.index === state.selectedIndex) {
      await this.dispatch({ type: 'press', index: input.index })
      return
    }
    switch (state.screen) {
      case 'auth':
        await this.handleAuth(state, input)
        return
      case 'sidebar':
        await this.handleSidebar(state, input)
        return
      case 'asleep':
        await this.handleAsleep(state, input)
        return
      case 'newMessage':
        await this.handleNewMessage(state, input)
        return
      case 'sidebarRecording':
        await this.handleSidebarRecording(state, input)
        return
      case 'sidebarConfirm':
        await this.handleSidebarConfirm(state, input)
        return
      case 'sidebarSent':
        await this.handleSidebarSent(state, input)
        return
      case 'error':
        await this.handleError(state, input)
        return
      case 'loading':
      case 'sidebarTranscribing':
      case 'sidebarSending':
        return
    }
  }

  private async handleAuth(state: Extract<AppState, { screen: 'auth' }>, input: AppInput) {
    if (input.type !== 'press') return
    await this.run(async () => {
      if (state.mode === 'needsSetup') {
        await this.setState({
          ...state,
          message: 'Follow the instructions on the Settings page to connect Telegram and the backend server.',
        })
        return
      }
      if (state.mode === 'signedOut') {
        await this.setState({
          ...state,
          message: 'Enter your phone number in the phone UI to receive a Telegram login code.',
        })
        return
      }

      if (state.mode === 'phonePending') return
    }, state)
  }

  async startPhoneLogin(phone: string) {
    const trimmed = phone.trim()
    if (!trimmed) return
    await this.run(async () => {
      if (!this.hasTelegramCredentials()) {
        await this.setState({
          screen: 'auth',
          mode: 'needsSetup',
          message: 'Telegram not connected. Add Telegram API ID/hash in Settings on the phone first.',
        })
        return
      }
      const result = await this.api.startPhoneAuth(trimmed)
      await this.setState({
        screen: 'auth',
        mode: 'phonePending',
        phone: result.phone || trimmed,
        message: result.message ?? `Verification code sent to ${result.phone || trimmed}. Enter it on the phone.`,
      })
    }, this.state.screen === 'auth' ? this.state : undefined)
  }

  async verifyPhoneLogin(phone: string, code: string) {
    const trimmedPhone = phone.trim()
    const trimmedCode = code.trim()
    if (!trimmedPhone || !trimmedCode) return
    await this.run(async () => {
      const status = await this.api.verifyPhoneAuth(trimmedPhone, trimmedCode)
      if (status.authorized) {
        if (status.sessionString) this.onTelegramSession?.(status.sessionString)
        await this.loadChats()
        return
      }
      await this.setState({
        screen: 'auth',
        mode: 'phonePending',
        phone: trimmedPhone,
        message: status.message ?? 'Code was not accepted. Check the Telegram code and try again.',
      })
    }, this.state.screen === 'auth' ? this.state : undefined)
  }

  private async handleSidebar(
    state: Extract<AppState, { screen: 'sidebar' }>, input: AppInput
  ) {
    switch (state.focus) {
      case 'chats':
        await this.handleSidebarChats(state as Extract<AppState, { screen: 'sidebar'; focus: 'chats' }>, input)
        return
      case 'topics':
        await this.handleSidebarTopics(state as Extract<AppState, { screen: 'sidebar'; focus: 'topics' }>, input)
        return
      case 'messages':
        await this.handleSidebarMessages(state as Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>, input)
        return
    }
  }

  private async handleSidebarChats(
    state: Extract<AppState, { screen: 'sidebar'; focus: 'chats' }>, input: AppInput
  ) {
    if (input.type === 'doublePress') {
      this.rememberChats(state.chats)
      await this.setState({ screen: 'asleep', chats: state.chats, selectedChatIndex: state.selectedChatIndex })
      await this.bridge.turnScreenOff?.()
      return
    }
    if (input.type === 'swipeUp') {
      this.openRequestId += 1
      await this.setStateWithoutRender({ ...state, selectedChatIndex: moveSelection(state.selectedChatIndex, state.chats.length, -1), status: undefined })
      return
    }
    if (input.type === 'swipeDown') {
      this.openRequestId += 1
      await this.setStateWithoutRender({ ...state, selectedChatIndex: moveSelection(state.selectedChatIndex, state.chats.length, 1), status: undefined })
      return
    }
    if (input.type === 'selectIndex') {
      const selectedChatIndex = selectedChatInputIndex(input, state.selectedChatIndex, state.chats)
      if (selectedChatIndex !== state.selectedChatIndex) this.openRequestId += 1
      await this.setStateWithoutRender({ ...state, selectedChatIndex, status: undefined })
      return
    }
    if (input.type !== 'press') return

    const selectedChatIndex = selectedChatInputIndex(input, state.selectedChatIndex, state.chats)
    const selectedState = { ...state, selectedChatIndex }
    const chat = selectedState.chats[selectedChatIndex]
    if (!chat) return
    await this.openChat(chat, selectedState)
  }

  private async handleAsleep(state: Extract<AppState, { screen: 'asleep' }>, input: AppInput) {
    if (input.type !== 'doublePress') {
      await this.bridge.turnScreenOff?.()
      return
    }
    await this.setState({ screen: 'sidebar', focus: 'chats', chats: state.chats, selectedChatIndex: state.selectedChatIndex })
  }

  private async handleNewMessage(state: Extract<AppState, { screen: 'newMessage' }>, input: AppInput) {
    if (input.type === 'doublePress') {
      this.rememberChats(state.chats)
      await this.setState({ screen: 'asleep', chats: state.chats, selectedChatIndex: state.selectedChatIndex })
      await this.bridge.turnScreenOff?.()
      return
    }
    if (input.type !== 'press') return
    await this.openMessages(state.chat, state.topic, {
      screen: 'sidebar', focus: 'chats',
      chats: state.chats,
      selectedChatIndex: state.selectedChatIndex,
    })
  }

  private async handleSidebarTopics(
    state: Extract<AppState, { screen: 'sidebar'; focus: 'topics' }>, input: AppInput
  ) {
    if (input.type === 'doublePress') {
      this.cancelTopicDebounce()
      await this.setState({
        screen: 'sidebar', focus: 'chats',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
      })
      return
    }
    if (input.type === 'swipeUp' || input.type === 'swipeDown') {
      this.openRequestId += 1
      const delta = input.type === 'swipeUp' ? -1 : 1
      const newIndex = moveSelection(state.selectedTopicIndex, state.topics.length, delta)
      await this.setStateWithoutRender({ ...state, selectedTopicIndex: newIndex, ...emptyTopicPreview() })
      this.debounceTopicPreviewFetch(state.chat, state.topics, newIndex)
      return
    }
    if (input.type === 'selectIndex') {
      const newIndex = selectedTopicInputIndex(input, state.selectedTopicIndex, state.topics)
      if (newIndex !== state.selectedTopicIndex) this.openRequestId += 1
      await this.setStateWithoutRender({ ...state, selectedTopicIndex: newIndex, ...emptyTopicPreview() })
      this.debounceTopicPreviewFetch(state.chat, state.topics, newIndex)
      return
    }
    if (input.type !== 'press') return

    this.cancelTopicDebounce()
    const selectedIndex = selectedTopicInputIndex(input, state.selectedTopicIndex, state.topics)
    const topic = state.topics[selectedIndex]
    if (!topic) return
    const selectedState: Extract<AppState, { screen: 'sidebar'; focus: 'topics' }> = { ...state, selectedTopicIndex: selectedIndex }

    if (selectedState.previewMessages?.length && selectedState.previewTopic && String(selectedState.previewTopic.id) === String(topic.id)) {
      this.openRequestId += 1
      await this.setState({
        screen: 'sidebar', focus: 'messages',
        chats: selectedState.chats, selectedChatIndex: selectedState.selectedChatIndex,
        chat: selectedState.chat, topic,
        messages: selectedState.previewMessages,
        cursor: selectedState.previewCursor ?? oldestMessageId(selectedState.previewMessages),
        scrollOffset: selectedState.previewScrollOffset ?? 0,
        back: selectedState,
        newerPages: selectedState.previewNewerPages ?? [],
        isNewestPage: selectedState.previewIsNewestPage ?? true,
        topics: selectedState.topics,
        selectedTopicIndex: selectedIndex,
      })
      this.maybePrefetchOlder()
      return
    }

    await this.openMessages(selectedState.chat, topic, selectedState)
  }

  private async handleSidebarMessages(
    state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>, input: AppInput
  ) {
    if (input.type === 'doublePress') {
      this.openRequestId += 1
      this.cancelPendingMessagePress()
      await this.goBackFromMessages(state)
      return
    }
    if (state.messages.length === 0 && state.status?.startsWith('Loading')) return
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
  private debounceTopicPreviewFetch(chat: Chat, topics: Topic[], selectedTopicIndex: number) {
    const topic = topics[selectedTopicIndex]
    if (!topic) return
    this.cancelTopicDebounce()
    this.topicPreviewDebounce = setTimeout(() => {
      this.topicPreviewDebounce = undefined
      if (this.isInputQuiet()) {
        this.debounceTopicPreviewFetch(chat, topics, selectedTopicIndex)
        return
      }
      void this.fetchTopicPreview(chat, topic).catch(() => undefined)
    }, this.topicPreviewDelayMs())
    const maybeNodeTimeout = this.topicPreviewDebounce as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
  }

  private cancelTopicDebounce() {
    if (!this.topicPreviewDebounce) return
    clearTimeout(this.topicPreviewDebounce)
    this.topicPreviewDebounce = undefined
  }

  private async fetchTopicPreview(chat: Chat, topic: Topic) {
    const cacheKey = `${String(chat.id)}:${String(topic.id)}`
    const cached = this.topicPreviewCache.get(cacheKey)
    if (cached) {
      const state = this.state
      if (state.screen !== 'sidebar' || state.focus !== 'topics') return
      if (!topicMatchesSelection(state, topic)) return
      await this.setStateWithVisibleRead({
        ...state,
        previewTopic: topic,
        previewMessages: cached.messages,
        previewCursor: cached.cursor,
        previewScrollOffset: 0,
        previewIsNewestPage: true,
      }, chat, topic, cached.messages, { render: false })
      return
    }

    if (this.topicPreviewInFlight.has(cacheKey)) return
    this.topicPreviewInFlight.add(cacheKey)
    try {
      const messages = await this.api.listMessages(chat.id, {
        topicId: topic.id,
        limit: MESSAGE_PAGE_LIMIT,
      })
      const normalized = normalizeMessagePage(messages)
      this.topicPreviewCache.set(cacheKey, { messages: normalized, cursor: oldestMessageId(normalized) })
      const state = this.state
      if (state.screen !== 'sidebar' || state.focus !== 'topics') return
      if (!topicMatchesSelection(state, topic)) return
      await this.setStateWithVisibleRead({
        ...state,
        previewTopic: topic,
        previewMessages: normalized,
        previewCursor: oldestMessageId(normalized),
        previewScrollOffset: 0,
        previewIsNewestPage: true,
      }, chat, topic, normalized, { render: false })
    } finally {
      this.topicPreviewInFlight.delete(cacheKey)
    }
  }


  private async scheduleMessagePress(
    state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }> | Extract<AppState, { screen: 'sidebarSent' }>
  ) {
    this.cancelPendingMessagePress()
    const ctx = sidebarContext(state)
    if (this.runtimeConfig.messagePressDelayMs <= 0) {
      await this.startRecordingFromMessages(state as Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>, ctx)
      return
    }
    const timeout = setTimeout(() => {
      this.pendingMessagePress = undefined
      const current = this.state
      if (current.screen !== 'sidebar' || current.focus !== 'messages') return
      const currentCtx = sidebarContext(current)
      void this.startRecordingFromMessages(current as Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>, currentCtx)
    }, this.runtimeConfig.messagePressDelayMs)
    const maybeNodeTimeout = timeout as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
    this.pendingMessagePress = timeout
  }

  private cancelPendingMessagePress() {
    if (!this.pendingMessagePress) return
    clearTimeout(this.pendingMessagePress)
    this.pendingMessagePress = undefined
  }

  private async startRecordingFromMessages(
    state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>,
    ctx: { chats: Chat[]; selectedChatIndex: number },
  ) {
    this.lastMessagePressAt = Date.now()
    await this.setState({
      screen: 'sidebarRecording', focus: 'messages',
      chats: ctx.chats, selectedChatIndex: ctx.selectedChatIndex,
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
    void this.bridge.setAudioEnabled(true).catch(() => undefined)
  }

  private async handleSidebarRecording(
    state: Extract<AppState, { screen: 'sidebarRecording' }>, input: AppInput
  ) {
    if (input.type === 'doublePress') {
      void this.bridge.setAudioEnabled(false).catch(() => undefined)
      if (Date.now() - state.startedAt < this.runtimeConfig.recordingMinDurationMs) {
        await this.setState({
          screen: 'sidebar', focus: 'messages',
          chats: state.chats, selectedChatIndex: state.selectedChatIndex,
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
        screen: 'sidebar', focus: 'messages',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
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
    await this.setState({
      screen: 'sidebarTranscribing', focus: 'messages',
      chats: state.chats, selectedChatIndex: state.selectedChatIndex,
      chat: state.chat,
      topic: state.topic,
      messages: state.messages,
      back: state.back,
      status: state.status,
      newerPages: state.newerPages,
      isNewestPage: state.isNewestPage,
      scrollOffset: state.scrollOffset,
    })
    void this.bridge.setAudioEnabled(false).catch(() => undefined)
    await this.run(async () => {
      if (!hasRecordableAudio(state.chunks)) {
        await this.setState({
          screen: 'sidebar', focus: 'messages',
          chats: state.chats, selectedChatIndex: state.selectedChatIndex,
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
          screen: 'sidebar', focus: 'messages',
          chats: state.chats, selectedChatIndex: state.selectedChatIndex,
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
        screen: 'sidebarConfirm', focus: 'messages',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
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
      screen: 'sidebar', focus: 'messages',
      chats: state.chats, selectedChatIndex: state.selectedChatIndex,
      chat: state.chat,
      topic: state.topic,
      messages: state.messages,
      back: state.back,
      status: state.status,
      newerPages: state.newerPages,
      isNewestPage: state.isNewestPage,
    })
  }

  private async handleSidebarConfirm(
    state: Extract<AppState, { screen: 'sidebarConfirm' }>, input: AppInput
  ) {
    if (input.type === 'swipeUp' || input.type === 'swipeDown') {
      await this.setState({ ...state, selectedIndex: state.selectedIndex === 0 ? 1 : 0 })
      return
    }
    if (input.type === 'doublePress') {
      await this.setState({
        screen: 'sidebar', focus: 'messages',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
        chat: state.chat, topic: state.topic, messages: state.messages,
        back: state.back, status: state.status,
        newerPages: state.newerPages, isNewestPage: state.isNewestPage, scrollOffset: state.scrollOffset,
      })
      return
    }
    if (input.type !== 'press') return

    if (state.selectedIndex === 1) {
      await this.setState({
        screen: 'sidebar', focus: 'messages',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
        chat: state.chat, topic: state.topic, messages: state.messages,
        back: state.back, status: state.status,
        newerPages: state.newerPages, isNewestPage: state.isNewestPage, scrollOffset: state.scrollOffset,
      })
      return
    }

    await this.setState({
      screen: 'sidebarSending', focus: 'messages',
      chats: state.chats, selectedChatIndex: state.selectedChatIndex,
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
        screen: 'sidebar', focus: 'messages',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
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

  private async handleSidebarSent(
    state: Extract<AppState, { screen: 'sidebarSent' }>, input: AppInput
  ) {
    if (input.type === 'doublePress') {
      await this.setState({
        screen: 'sidebar', focus: 'chats',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
      })
      return
    }
    if (input.type === 'press') {
      const messages = await this.refreshLatestMessages(state)
      await this.setState({
        screen: 'sidebar', focus: 'messages',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
        chat: state.chat, topic: state.topic,
        messages, cursor: oldestMessageId(messages),
        back: state.back, newerPages: [], isNewestPage: true, scrollOffset: 0,
      })
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
      await this.setState({ screen: 'sidebar', focus: 'chats', chats, selectedChatIndex: 0 })
      this.prefetchVisibleChats(chats)
    }, previous)
  }

  private async openChat(chat: Chat, previous: RecoverableState) {
    const chats = previous.screen === 'sidebar' ? previous.chats : []
    const selectedChatIndex = previous.screen === 'sidebar' ? previous.selectedChatIndex : 0
    const requestId = ++this.openRequestId
    await this.run(async () => {
      if (!chat.isForum) {
        await this.openMessages(chat, undefined, previous, requestId)
        return
      }
      const cachedTopics = this.topicsCache.get(String(chat.id))
      if (!cachedTopics) {
        await this.setState({
          screen: 'sidebar', focus: 'messages',
          chats, selectedChatIndex,
          chat,
          messages: [],
          back: previous,
          status: `Loading ${chat.title} topics...`,
          newerPages: [],
          isNewestPage: true,
          scrollOffset: 0,
        })
      }
      const topics = cachedTopics ?? await this.prefetchTopics(chat)
      if (requestId !== this.openRequestId) return
      if (topics.length > 0) {
        await this.setState({
          screen: 'sidebar', focus: 'topics',
          chats, selectedChatIndex,
          chat, topics, selectedTopicIndex: 0,
        })
        this.debounceTopicPreviewFetch(chat, topics, 0)
        return
      }
      await this.openMessages(chat, undefined, previous, requestId)
    }, previous)
  }

  private async openMessages(chat: Chat, topic: Topic | undefined, previous: RecoverableState, requestId = ++this.openRequestId) {
    const chats = previous.screen === 'sidebar' ? previous.chats : []
    const selectedChatIndex = previous.screen === 'sidebar' ? previous.selectedChatIndex : 0
    const topics = topic && previous.screen === 'sidebar' && previous.focus === 'topics' ? previous.topics : undefined
    const selectedTopicIndex = topic && previous.screen === 'sidebar' && previous.focus === 'topics' ? previous.selectedTopicIndex : undefined
    await this.run(async () => {
      const cached = this.messageCache.get(messageThreadKey({ chat, topic }))
      if (cached) {
        await this.setStateWithVisibleRead({
          screen: 'sidebar', focus: 'messages',
          chats, selectedChatIndex,
          chat, topic,
          messages: cached.messages,
          cursor: cached.cursor,
          back: messageBackTarget(previous),
          newerPages: [],
          isNewestPage: true,
          scrollOffset: 0,
          topics,
          selectedTopicIndex,
        }, chat, topic, cached.messages)
        void this.refreshOpenMessagesInBackground(chat, topic, requestId)
        return
      }

      await this.setState({
        screen: 'sidebar', focus: 'messages',
        chats, selectedChatIndex,
        chat, topic,
        messages: [],
        back: messageBackTarget(previous),
        status: `Loading ${topic?.title ?? chat.title}...`,
        newerPages: [],
        isNewestPage: true,
        scrollOffset: 0,
        topics,
        selectedTopicIndex,
      })
      const messages = await this.prefetchMessages(chat, topic)
      if (requestId !== this.openRequestId || !this.isStillOpeningMessages(chat, topic, requestId)) return
      const normalized = normalizeMessagePage(messages)
      await this.setStateWithVisibleRead({
        screen: 'sidebar', focus: 'messages',
        chats, selectedChatIndex,
        chat, topic,
        messages: normalized,
        cursor: oldestMessageId(normalized),
        back: messageBackTarget(previous),
        newerPages: [],
        isNewestPage: true,
        scrollOffset: 0,
        topics,
        selectedTopicIndex,
      }, chat, topic, normalized)
      this.maybePrefetchOlder()
    }, previous)
  }

  private async refreshOpenMessagesInBackground(chat: Chat, topic: Topic | undefined, requestId: number) {
    const messages = normalizeMessagePage(await this.api.listMessages(chat.id, { topicId: topicThreadId(topic), limit: MESSAGE_PAGE_LIMIT }))
    this.cacheMessages(chat, topic, messages)
    if (requestId !== this.openRequestId || !this.isStillOpeningMessages(chat, topic, requestId)) return
    const state = this.state
    if (state.screen !== 'sidebar' || state.focus !== 'messages') return
    if (!hasMessageChanges(state.messages, messages)) return
    await this.setStateWithVisibleRead({
      ...state,
      messages,
      cursor: oldestMessageId(messages),
      newerPages: [],
      isNewestPage: true,
      scrollOffset: 0,
    }, chat, topic, messages)
    this.maybePrefetchOlder()
  }

  private async loadOlderMessages(state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>) {
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

    await this.setState({ ...state, status: LOADING_OLDER_STATUS, isNewestPage: false })
    void this.loadOlderMessagesInBackground(state).catch(() => undefined)
  }

  private async loadOlderMessagesInBackground(state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>) {
    const key = messageThreadKey(state)
    const cursor = String(state.cursor ?? '')
    await this.prefetchOlderMessages(state)
    const current = this.state
    if (current.screen !== 'sidebar' || current.focus !== 'messages' || messageThreadKey(current) !== key || String(current.cursor ?? '') === cursor) {
      if (current.screen === 'sidebar' && current.focus === 'messages' && messageThreadKey(current) === key && current.status === LOADING_OLDER_STATUS) {
        await this.setState({ ...current, status: 'No older messages' })
      }
      return
    }
    const offset = Math.min((current.scrollOffset ?? 0) + 1, maxScrollOffset(current.messages))
    await this.setState({ ...current, scrollOffset: offset, status: 'Older messages', isNewestPage: false })
    this.maybePrefetchOlder()
  }

  private async loadNewerMessages(state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>) {
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
    const messages = normalizeMessagePage(await this.api.listMessages(state.chat.id, { topicId: topicThreadId(state.topic), limit: MESSAGE_PAGE_LIMIT }))
    this.cacheMessages(state.chat, state.topic, messages)
    return messages
  }

  private async refreshAfterSend(state: Extract<AppState, { screen: 'sidebarConfirm' }>, sent: Message) {
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
      if (current.screen === 'sidebarSent') {
        const messages = hasSent ? refreshed : normalizeMessagePage([...refreshed, sent])
        await this.setState({
          ...current,
          messages,
          status: hasNewIncoming ? 'New reply' : undefined,
          newerPages: [],
          isNewestPage: true,
          scrollOffset: 0,
        })
      } else if (current.screen === 'sidebar' && current.focus === 'messages') {
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
    if (state.screen !== 'sidebar' || state.focus !== 'messages') return
    if (this.isInputQuiet()) return
    const maxOffset = maxScrollOffset(state.messages)
    const remainingLoadedScroll = maxOffset - (state.scrollOffset ?? 0)
    if (remainingLoadedScroll > OLDER_PREFETCH_LOW_WATER) return
    void this.prefetchOlderMessages(state).catch(() => undefined)
  }

  private prefetchVisibleChats(chats: Chat[]) {
    void this.prefetchVisibleChatsInBackground(chats.slice(0, 5)).catch(() => undefined)
  }

  private async prefetchVisibleChatsInBackground(chats: Chat[]) {
    for (const chat of chats) {
      if (chat.isForum) {
        const topics = await this.prefetchTopics(chat).catch(() => [])
        for (const topic of topics.slice(0, 5)) {
          await this.prefetchMessages(chat, topic).catch(() => [])
          await sleep(25)
        }
      } else {
        await this.prefetchMessages(chat, undefined).catch(() => [])
      }
      await sleep(25)
    }
  }

  private async prefetchTopics(chat: Chat): Promise<Topic[]> {
    const key = String(chat.id)
    const cached = this.topicsCache.get(key)
    if (cached) return cached
    const inFlight = this.topicsPrefetchInFlight.get(key)
    if (inFlight) return inFlight
    const promise = this.api.listTopics(chat.id)
      .then((topics) => {
        this.topicsCache.set(key, topics)
        return topics
      })
      .finally(() => {
        this.topicsPrefetchInFlight.delete(key)
      })
    this.topicsPrefetchInFlight.set(key, promise)
    return promise
  }

  private async prefetchMessages(chat: Chat, topic: Topic | undefined): Promise<Message[]> {
    const key = messageThreadKey({ chat, topic })
    const cached = this.messageCache.get(key)
    if (cached) return cached.messages
    const inFlight = this.messagePrefetchInFlight.get(key)
    if (inFlight) return inFlight
    const promise = this.api.listMessages(chat.id, { topicId: topicThreadId(topic), limit: MESSAGE_PAGE_LIMIT })
      .then((messages) => {
        const normalized = normalizeMessagePage(messages)
        this.cacheMessages(chat, topic, normalized)
        return normalized
      })
      .finally(() => {
        this.messagePrefetchInFlight.delete(key)
      })
    this.messagePrefetchInFlight.set(key, promise)
    return promise
  }

  private cacheMessages(chat: Chat, topic: Topic | undefined, messages: Message[]) {
    this.messageCache.set(messageThreadKey({ chat, topic }), {
      messages,
      cursor: oldestMessageId(messages),
    })
  }

  private async prefetchOlderMessages(state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>, options: { chain?: boolean } = {}) {
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

  private async fetchAndAppendOlderMessages(state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>, key: string, cursor: string): Promise<boolean> {
    const older = await this.api.listMessages(state.chat.id, {
      topicId: topicThreadId(state.topic),
      beforeId: state.cursor,
      limit: MESSAGE_PAGE_LIMIT,
    })
    if (older.length === 0) return false

    const current = this.state
    if (current.screen !== 'sidebar' || current.focus !== 'messages' || messageThreadKey(current) !== key || String(current.cursor) !== cursor) return false

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
    if (current.screen !== 'sidebar' || current.focus !== 'messages' || messageThreadKey(current) !== key) return
    const maxOffset = maxScrollOffset(current.messages)
    const remainingLoadedScroll = maxOffset - (current.scrollOffset ?? 0)
    if (remainingLoadedScroll > OLDER_PREFETCH_LOW_WATER) return
    void this.prefetchOlderMessages(current, { chain: true }).catch(() => undefined)
  }

  private async goBackFromMessages(state: Extract<AppState, { screen: 'sidebar'; focus: 'messages' }>) {
    this.openRequestId += 1
    if (state.back) {
      await this.setState(state.back)
      return
    }
    if (state.topic) {
      const topics = await this.api.listTopics(state.chat.id)
      await this.setState({
        screen: 'sidebar', focus: 'topics',
        chats: state.chats, selectedChatIndex: state.selectedChatIndex,
        chat: state.chat,
        topics,
        selectedTopicIndex: 0,
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

  private isStillOpeningMessages(chat: Chat, topic: Topic | undefined, requestId: number) {
    const current = this.state
    return requestId === this.openRequestId
      && current.screen === 'sidebar'
      && current.focus === 'messages'
      && String(current.chat.id) === String(chat.id)
      && String(topicThreadId(current.topic) ?? '') === String(topicThreadId(topic) ?? '')
  }

  private async setState(state: AppState) {
    this.applyState(state, true)
    this.enqueueRender(state)
  }

  private async setStateWithoutRender(state: AppState) {
    this.applyState(state, false)
  }

  private applyState(state: AppState, armSelectionOnlyPress: boolean) {
    this.state = state
    if (armSelectionOnlyPress && state.screen === 'sidebar' && (state.focus === 'chats' || state.focus === 'topics')) {
      this.selectionOnlyPressReadyAt = Date.now() + this.runtimeConfig.selectionOnlyPressDelayMs
    }
    this.syncMessagePolling()
    this.syncChatPolling()
    this.enqueueNotify()
  }

  private enqueueRender(state: AppState) {
    this.pendingRenderState = state
    this.scheduleRenderFlush(RENDER_DEFER_MS)
  }

  private scheduleRenderFlush(delayMs: number) {
    if (this.renderInFlight || this.renderTimer) return
    this.renderTimer = setTimeout(() => {
      this.renderTimer = undefined
      this.renderInFlight = true
      void this.flushRenderQueue()
    }, delayMs)
    const maybeNodeTimeout = this.renderTimer as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
  }

  private async flushRenderQueue() {
    try {
      const state = this.pendingRenderState
      this.pendingRenderState = undefined
      if (state) await this.bridge.render(screenModel(state))
    } catch {
      // Rendering failures should not block controller state/input handling.
    } finally {
      this.renderInFlight = false
      if (this.pendingRenderState) this.scheduleRenderFlush(RENDER_COOLDOWN_MS)
    }
  }

  private enqueueNotify() {
    this.notifyPending = true
    if (this.notifyTimer) return
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = undefined
      if (!this.notifyPending) return
      this.notifyPending = false
      this.notify()
    }, 0)
    const maybeNodeTimeout = this.notifyTimer as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
  }

  private notify() {
    for (const listener of this.listeners) listener(this.state)
  }

  private syncMessagePolling() {
    const state = this.state
    const shouldPoll = (state.screen === 'sidebar' && state.focus === 'messages') || state.screen === 'sidebarSent'
    if (!shouldPoll) {
      this.stopMessagePolling()
      return
    }
    if (this.messagePoll) return
    this.messagePoll = setInterval(() => {
      void this.refreshVisibleMessages({ background: true })
    }, this.runtimeConfig.messagePollMs)
    const maybeNodeInterval = this.messagePoll as unknown as { unref?: () => void }
    maybeNodeInterval.unref?.()
  }

  private stopMessagePolling() {
    if (!this.messagePoll) return
    clearInterval(this.messagePoll)
    this.messagePoll = undefined
  }

  private syncChatPolling() {
    const state = this.state
    const shouldPoll = (state.screen === 'sidebar' && state.focus === 'chats') || state.screen === 'asleep' || state.screen === 'newMessage'
    if (!shouldPoll) {
      this.stopChatPolling()
      return
    }
    if (this.chatPoll) return
    this.chatPoll = setInterval(() => {
      void this.refreshRootChats({ background: true })
    }, this.runtimeConfig.chatPollMs)
    const maybeNodeInterval = this.chatPoll as unknown as { unref?: () => void }
    maybeNodeInterval.unref?.()
  }

  private stopChatPolling() {
    if (!this.chatPoll) return
    clearInterval(this.chatPoll)
    this.chatPoll = undefined
  }

  private async refreshRootChats(options: { background?: boolean } = {}) {
    if (this.rootRefreshInFlight) return
    if (options.background && this.isInputQuiet()) {
      this.deferRootRefresh()
      return
    }
    const state = this.state
    if ((state.screen !== 'sidebar' || state.focus !== 'chats') && state.screen !== 'asleep' && state.screen !== 'newMessage') return
    this.rootRefreshInFlight = true
    try {
      const chats = await this.api.listChats(CHAT_LIST_LIMIT).catch(() => undefined)
      if (!chats) return

      const activity = this.findNewChatActivity(chats)
      this.rememberChats(chats)

      const current = this.state
      if ((current.screen !== 'sidebar' || current.focus !== 'chats') && current.screen !== 'asleep' && current.screen !== 'newMessage') return

      const selectedChatIndex = clamp(
        current.screen === 'sidebar' ? current.selectedChatIndex : current.selectedChatIndex,
        0, Math.max(0, chats.length - 1),
      )
      if (!activity) {
        if (current.screen === 'sidebar' && current.focus === 'chats') {
          await this.setStateWithoutRender({ ...current, chats, selectedChatIndex })
        }
        return
      }

      const topic = activity.chat.isForum ? await this.findUnreadTopic(activity.chat).catch(() => undefined) : undefined
      await this.setState({
        screen: 'newMessage',
        chat: activity.chat,
        topic,
        message: activity.chat.lastMessage ?? '',
        chats,
        selectedChatIndex,
      })
    } finally {
      this.rootRefreshInFlight = false
    }
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

  private async refreshVisibleMessages(options: { background?: boolean } = {}) {
    if (this.messageRefreshInFlight) return
    if (options.background && this.isInputQuiet()) {
      this.deferMessageRefresh()
      return
    }
    const state = this.state
    if ((state.screen !== 'sidebar' || state.focus !== 'messages') && state.screen !== 'sidebarSent') return
    this.messageRefreshInFlight = true
    try {
      const messages = await this.refreshLatestMessages(state).catch(() => undefined)
      if (!messages || messages.length === 0) return
      const current = this.state
      if ((current.screen !== 'sidebar' || current.focus !== 'messages') && current.screen !== 'sidebarSent') return

      const merged = normalizeMessagePage([...current.messages, ...messages])
      if (!hasMessageChanges(current.messages, merged)) return
      const hasIncoming = hasIncomingChange(current.messages, merged)
      if (current.screen === 'sidebar' && current.focus === 'messages') {
        await this.setStateWithVisibleRead({ ...current, messages: merged, cursor: oldestMessageId(merged), status: hasIncoming ? 'New reply' : undefined, newerPages: [], isNewestPage: true, scrollOffset: 0 }, current.chat, current.topic, merged, { forceAck: hasIncoming })
        this.maybePrefetchOlder()
        return
      }
      await this.setStateWithVisibleRead({ ...current, messages: merged, status: hasIncoming ? 'New reply' : undefined, newerPages: [], isNewestPage: true, scrollOffset: 0 }, current.chat, current.topic, merged, { forceAck: hasIncoming })
    } finally {
      this.messageRefreshInFlight = false
    }
  }

  private async setStateWithVisibleRead(
    state: AppState,
    chat: Chat,
    topic: Topic | undefined,
    messages: Message[],
    options: { forceAck?: boolean; render?: boolean } = {},
  ) {
    const maxId = newestMessageId(messages)
    if (maxId === undefined) {
      if (options.render === false) {
        await this.setStateWithoutRender(state)
      } else {
        await this.setState(state)
      }
      return
    }
    const hasUnread = hasUnreadForThread(state, chat, topic)
    const next = hasUnread ? clearUnreadForThread(state, chat, topic) : state
    const shouldAck = (hasUnread || options.forceAck === true) && this.shouldSendReadAck(chat, topic, maxId)
    if (options.render === false) {
      await this.setStateWithoutRender(next)
    } else {
      await this.setState(next)
    }
    if (shouldAck) this.sendReadAck(chat, topic, maxId)
  }

  private shouldSendReadAck(chat: Chat, topic: Topic | undefined, maxId: Id) {
    const key = messageThreadKey({ chat, topic })
    const previous = this.readAckMaxIds.get(key)
    return previous === undefined || !idAtOrAfter(previous, maxId)
  }

  private sendReadAck(chat: Chat, topic: Topic | undefined, maxId: Id) {
    const key = messageThreadKey({ chat, topic })
    this.readAckMaxIds.set(key, maxId)
    this.pendingReadAcks.set(key, { chat, topic, maxId })
    this.scheduleReadAckFlush()
  }

  isInputQuiet() {
    return Date.now() < this.inputQuietUntil
  }

  private noteUserInput() {
    this.inputQuietUntil = Math.max(this.inputQuietUntil, Date.now() + INPUT_QUIET_MS)
  }

  private msUntilQuiet() {
    return Math.max(0, this.inputQuietUntil - Date.now())
  }

  private topicPreviewDelayMs() {
    return Math.max(TOPIC_PREVIEW_IDLE_MS, this.msUntilQuiet() + TOPIC_PREVIEW_IDLE_MS)
  }

  private deferTelegramUpdate(update: TelegramUpdate) {
    const state = this.state
    if (state.screen === 'sidebar' && state.focus === 'messages' && updateMatchesThread(update, state)) {
      this.deferMessageRefresh()
      return
    }
    this.deferRootRefresh()
  }

  private deferRootRefresh() {
    if (this.deferredRootRefreshTimer) return
    this.deferredRootRefreshTimer = setTimeout(() => {
      this.deferredRootRefreshTimer = undefined
      void this.refreshRootChats()
    }, this.msUntilQuiet())
    const maybeNodeTimeout = this.deferredRootRefreshTimer as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
  }

  private deferMessageRefresh() {
    if (this.deferredMessageRefreshTimer) return
    this.deferredMessageRefreshTimer = setTimeout(() => {
      this.deferredMessageRefreshTimer = undefined
      void this.refreshVisibleMessages()
    }, this.msUntilQuiet())
    const maybeNodeTimeout = this.deferredMessageRefreshTimer as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
  }

  private scheduleReadAckFlush() {
    if (this.readAckFlushTimer) return
    this.readAckFlushTimer = setTimeout(() => {
      this.readAckFlushTimer = undefined
      this.flushReadAcks()
    }, this.msUntilQuiet())
    const maybeNodeTimeout = this.readAckFlushTimer as unknown as { unref?: () => void }
    maybeNodeTimeout.unref?.()
  }

  private flushReadAcks() {
    if (this.isInputQuiet()) {
      this.scheduleReadAckFlush()
      return
    }
    const pending = Array.from(this.pendingReadAcks.values())
    this.pendingReadAcks.clear()
    for (const ack of pending) {
      void this.api.markRead(ack.chat.id, { topicId: topicThreadId(ack.topic), maxId: ack.maxId }).catch(() => undefined)
    }
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

function selectedChatInputIndex(input: { index?: number; itemName?: string }, currentIndex: number, chats: Chat[]) {
  const byIndex = selectedInputIndex(input, currentIndex, chats.length)
  if (typeof input.index === 'number') return byIndex
  return selectedNamedIndex(input.itemName, currentIndex, chats, chatSelectionLabel)
}

function selectedTopicInputIndex(input: { index?: number; itemName?: string }, currentIndex: number, topics: Topic[]) {
  const byIndex = selectedInputIndex(input, currentIndex, topics.length)
  if (typeof input.index === 'number') return byIndex
  return selectedNamedIndex(input.itemName, currentIndex, topics, topicSelectionLabel)
}

function selectedNamedIndex<T>(itemName: string | undefined, currentIndex: number, items: T[], label: (item: T) => string) {
  if (!itemName) return currentIndex
  const normalizedName = normalizeSelectionLabel(itemName)
  const exact = items.findIndex((item) => normalizeSelectionLabel(label(item)) === normalizedName)
  if (exact >= 0) return exact
  const loose = items.findIndex((item) => {
    const itemLabel = normalizeSelectionLabel(label(item))
    return itemLabel.includes(normalizedName) || normalizedName.includes(itemLabel)
  })
  return loose >= 0 ? loose : currentIndex
}

function chatSelectionLabel(chat: Chat) {
  const unread = chat.unreadCount ? ` (${chat.unreadCount})` : ''
  return `${chat.title}${unread}`
}

function topicSelectionLabel(topic: Topic) {
  const unread = topic.unreadCount ? ` (${topic.unreadCount})` : ''
  return `${topic.title}${unread}`
}

function normalizeSelectionLabel(value: string) {
  return value.replace(/\s+\(\d+\)$/, '').trim().toLowerCase()
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

function updateMatchesThread(update: TelegramUpdate, state: { chat: Chat; topic?: Topic }) {
  if (String(update.chatId) !== String(state.chat.id)) return false
  const stateTopic = topicThreadId(state.topic)
  if (stateTopic === undefined) return update.topicId === undefined || update.topicId === null
  if (update.topicId === undefined || update.topicId === null) return true
  if (String(update.topicId) === String(stateTopic)) return true
  if (state.topic?.topMessageId !== undefined && String(update.topicId) === String(state.topic.topMessageId)) return true
  return true
}

function idAtOrAfter(previous: Id, next: Id) {
  const previousNumber = Number(previous)
  const nextNumber = Number(next)
  if (Number.isFinite(previousNumber) && Number.isFinite(nextNumber)) return previousNumber >= nextNumber
  return String(previous) === String(next)
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

function activeThreadState(state: AppState):
  | {
    chat: Chat
    topic?: Topic
    back?: RecoverableState
  }
  | undefined {
  if (state.screen === 'sidebar' && state.focus === 'messages') {
    return { chat: state.chat, topic: state.topic, back: state.back }
  }
  switch (state.screen) {
    case 'sidebarRecording':
    case 'sidebarTranscribing':
    case 'sidebarConfirm':
    case 'sidebarSending':
    case 'sidebarSent':
      return { chat: state.chat, topic: state.topic, back: state.back }
    default:
      return undefined
  }
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

function messageBackTarget(previous: RecoverableState): RecoverableState | undefined {
  if (previous.screen === 'sidebar' && previous.focus === 'messages') return previous.back
  return previous
}

function sidebarContext(state: AppState): { chats: Chat[]; selectedChatIndex: number } {
  if (state.screen === 'sidebar' || state.screen === 'sidebarRecording' || state.screen === 'sidebarTranscribing' ||
    state.screen === 'sidebarConfirm' || state.screen === 'sidebarSending' || state.screen === 'sidebarSent') {
    return { chats: state.chats, selectedChatIndex: state.selectedChatIndex }
  }
  if (state.screen === 'newMessage' || state.screen === 'asleep') {
    return { chats: state.chats, selectedChatIndex: state.selectedChatIndex }
  }
  return { chats: [], selectedChatIndex: 0 }
}

function emptyTopicPreview() {
  return {
    previewTopic: undefined,
    previewMessages: undefined,
    previewCursor: undefined,
    previewScrollOffset: undefined,
    previewNewerPages: undefined,
    previewIsNewestPage: undefined,
  }
}

function topicMatchesSelection(state: Extract<AppState, { screen: 'sidebar'; focus: 'topics' }>, topic: Topic) {
  return String(state.topics[state.selectedTopicIndex]?.id ?? '') === String(topic.id)
}

function clearUnreadForThread(state: AppState, chat: Chat, topic: Topic | undefined): AppState {
  const remainingTopicUnread = topic ? remainingUnreadForOtherTopics(state, topic) : undefined
  let changed = false
  const updateBack = (back: RecoverableState | undefined) => {
    if (!back) return back
    const nextBack = clearUnreadForThread(back, chat, topic) as RecoverableState
    if (nextBack !== back) changed = true
    return nextBack
  }
  const updateChat = (item: Chat) => {
    if (String(item.id) !== String(chat.id)) return item
    if (!item.unreadCount) return item
    if (!topic) {
      changed = true
      return { ...item, unreadCount: 0 }
    }
    const nextUnread = remainingTopicUnread ?? 0
    if (item.unreadCount === nextUnread) return item
    changed = true
    return { ...item, unreadCount: nextUnread }
  }
  const updateTopic = (item: Topic) => {
    if (String(item.id) !== String(topic?.id) || !item.unreadCount) return item
    changed = true
    return { ...item, unreadCount: 0 }
  }
  const maybePreviewTopic = (item: Topic | undefined) => {
    if (!item || String(item.id) !== String(topic?.id) || !item.unreadCount) return item
    changed = true
    return { ...item, unreadCount: 0 }
  }

  let next: AppState
  switch (state.screen) {
    case 'sidebar':
      if (state.focus === 'topics') {
        next = {
          ...state,
          chats: state.chats.map(updateChat),
          chat: updateChat(state.chat),
          topics: state.topics.map(updateTopic),
          previewTopic: maybePreviewTopic(state.previewTopic),
        }
        break
      }
      if (state.focus === 'messages') {
        next = {
          ...state,
          chats: state.chats.map(updateChat),
          chat: updateChat(state.chat),
          topic: maybePreviewTopic(state.topic),
          topics: state.topics?.map(updateTopic),
          back: updateBack(state.back),
        }
        break
      }
      next = { ...state, chats: state.chats.map(updateChat) }
      break
    case 'asleep':
      next = { ...state, chats: state.chats.map(updateChat) }
      break
    case 'newMessage':
      next = { ...state, chats: state.chats.map(updateChat), chat: updateChat(state.chat), topic: maybePreviewTopic(state.topic) }
      break
    case 'sidebarRecording':
    case 'sidebarTranscribing':
    case 'sidebarConfirm':
    case 'sidebarSending':
    case 'sidebarSent':
      next = {
        ...state,
        chats: state.chats.map(updateChat),
        chat: updateChat(state.chat),
        topic: maybePreviewTopic(state.topic),
        back: updateBack(state.back),
      }
      break
    default:
      return state
  }
  return changed ? next : state
}

function hasUnreadForThread(state: AppState, chat: Chat, topic: Topic | undefined) {
  if (topic) return unreadForTopic(state, topic) > 0
  return unreadForChat(state, chat) > 0
}

function unreadForChat(state: AppState, chat: Chat) {
  const values: number[] = []
  const collect = (item: Chat | undefined) => {
    if (item && String(item.id) === String(chat.id)) values.push(Number(item.unreadCount ?? 0) || 0)
  }
  switch (state.screen) {
    case 'sidebar':
      state.chats.forEach(collect)
      if (state.focus === 'topics' || state.focus === 'messages') collect(state.chat)
      break
    case 'asleep':
      state.chats.forEach(collect)
      break
    case 'newMessage':
      state.chats.forEach(collect)
      collect(state.chat)
      break
    case 'sidebarRecording':
    case 'sidebarTranscribing':
    case 'sidebarConfirm':
    case 'sidebarSending':
    case 'sidebarSent':
      state.chats.forEach(collect)
      collect(state.chat)
      break
    default:
      break
  }
  return Math.max(0, ...values)
}

function unreadForTopic(state: AppState, topic: Topic) {
  const values: number[] = []
  const collect = (item: Topic | undefined) => {
    if (item && String(item.id) === String(topic.id)) values.push(Number(item.unreadCount ?? 0) || 0)
  }
  if (state.screen === 'sidebar' && state.focus === 'topics') {
    state.topics.forEach(collect)
    collect(state.previewTopic)
  }
  if (state.screen === 'sidebar' && state.focus === 'messages') {
    state.topics?.forEach(collect)
    collect(state.topic)
  }
  if (
    state.screen === 'newMessage' ||
    state.screen === 'sidebarRecording' ||
    state.screen === 'sidebarTranscribing' ||
    state.screen === 'sidebarConfirm' ||
    state.screen === 'sidebarSending' ||
    state.screen === 'sidebarSent'
  ) {
    collect(state.topic)
  }
  return Math.max(0, ...values)
}

function remainingUnreadForOtherTopics(state: AppState, topic: Topic) {
  const topics = state.screen === 'sidebar' && (state.focus === 'topics' || state.focus === 'messages')
    ? state.topics
    : undefined
  if (!topics) return undefined
  return topics
    .filter((item) => String(item.id) !== String(topic.id))
    .reduce((total, item) => total + Math.max(0, Number(item.unreadCount ?? 0) || 0), 0)
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
