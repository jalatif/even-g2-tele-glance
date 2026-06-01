import { describe, expect, it, vi } from 'vitest'
import { TelegramAppController, type GlassesBridge } from '../src/controller/appController'
import type { TelegramApi } from '../src/api'
import type { Chat, Message, Topic, TranscriptionResult } from '../src/types'

const chats: Chat[] = [
  { id: '1', title: 'Alice', kind: 'user' },
  { id: '2', title: 'Project', kind: 'group', isForum: true },
]
const topics: Topic[] = [
  { id: '10', title: 'Launch' },
  { id: '20', title: 'Support' },
]
const messages: Message[] = [{ id: '100', sender: 'Alice', text: 'hello', sentAt: '2026-05-29T10:00:00Z' }]
const reversedMessages: Message[] = [
  { id: '102', sender: 'Alice', text: 'latest', sentAt: '2026-05-29T10:02:00Z' },
  { id: '101', sender: 'Bob', text: 'middle', sentAt: '2026-05-29T10:01:00Z' },
  { id: '100', sender: 'Alice', text: 'oldest', sentAt: '2026-05-29T10:00:00Z' },
]

describe('TelegramAppController', () => {
  it('shows phone login prompt when no Telegram session exists', async () => {
    const api = fakeApi({ authorized: false })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    expect(controller.snapshot).toMatchObject({
      screen: 'auth',
      mode: 'signedOut',
      message: expect.stringContaining('phone number'),
    })

    await controller.dispatch({ type: 'press' })
    expect(controller.snapshot).toMatchObject({
      screen: 'auth',
      mode: 'signedOut',
      message: expect.stringContaining('phone number'),
    })
    expect(bridge.render).toHaveBeenCalled()
  })

  it('loads chats for an authorized session and moves list selection with swipes', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    expect(controller.snapshot).toMatchObject({ screen: 'chats', selectedIndex: 0 })
    const renderCount = vi.mocked(bridge.render).mock.calls.length

    await controller.dispatch({ type: 'swipeDown' })
    expect(controller.snapshot).toMatchObject({ screen: 'chats', selectedIndex: 1 })
    expect(bridge.render).toHaveBeenCalledTimes(renderCount + 1)

    await controller.dispatch({ type: 'swipeUp' })
    expect(controller.snapshot).toMatchObject({ screen: 'chats', selectedIndex: 0 })
    expect(bridge.render).toHaveBeenCalledTimes(renderCount + 2)
  })

  it('turns the screen off on double press from the chat list', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await controller.dispatch({ type: 'doublePress' })

    expect(bridge.turnScreenOff).toHaveBeenCalledOnce()
    expect(controller.snapshot).toMatchObject({ screen: 'asleep' })
  })

  it('only wakes the screen-off state with double press', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await controller.dispatch({ type: 'doublePress' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'foreground' })

    expect(controller.snapshot).toMatchObject({ screen: 'asleep' })
    expect(bridge.turnScreenOff).toHaveBeenCalledTimes(4)

    await controller.dispatch({ type: 'doublePress' })

    expect(controller.snapshot).toMatchObject({ screen: 'chats' })
  })

  it('wakes from screen-off state when a root chat receives a new message', async () => {
    let currentChats = chats
    const api = fakeApi({ authorized: true, chats: () => currentChats })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'doublePress' })
    currentChats = [{ ...chats[0], unreadCount: 1, lastMessage: 'wake up' }, chats[1]]
    await refreshRootChats(controller)

    expect(controller.snapshot).toMatchObject({
      screen: 'newMessage',
      chat: expect.objectContaining({ id: '1' }),
      message: 'wake up',
    })
  })

  it('opens the new-message target thread on press', async () => {
    let currentChats = chats
    const api = fakeApi({ authorized: true, chats: () => currentChats })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'doublePress' })
    currentChats = [{ ...chats[0], unreadCount: 1, lastMessage: 'wake up' }, chats[1]]
    await refreshRootChats(controller)
    await controller.dispatch({ type: 'press' })

    expect(api.listMessages).toHaveBeenCalledWith('1', { topicId: undefined, limit: 50 })
    expect(controller.snapshot).toMatchObject({ screen: 'messages', chat: expect.objectContaining({ id: '1' }) })
  })

  it('resolves unread forum topic before opening a new-message prompt', async () => {
    let currentChats = chats
    const unreadTopics = [{ ...topics[1], unreadCount: 1 }, topics[0]]
    const api = fakeApi({ authorized: true, chats: () => currentChats, topics: unreadTopics })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'doublePress' })
    currentChats = [chats[0], { ...chats[1], unreadCount: 1, lastMessage: 'topic ping' }]
    await refreshRootChats(controller)
    await controller.dispatch({ type: 'press' })

    expect(api.listTopics).toHaveBeenCalledWith('2')
    expect(api.listMessages).toHaveBeenCalledWith('2', { topicId: '20', limit: 50 })
    expect(controller.snapshot).toMatchObject({ screen: 'messages', topic: expect.objectContaining({ id: '20' }) })
  })

  it('opens forum topics before message history', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })

    expect(api.listTopics).toHaveBeenCalledWith('2')
    expect(controller.snapshot).toMatchObject({ screen: 'topics', selectedIndex: 0 })
  })

  it('opens selected forum topic messages and renders a message screen', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press' })

    expect(api.listMessages).toHaveBeenNthCalledWith(1, '2', { topicId: '10', limit: 50 })
    expect(controller.snapshot).toMatchObject({ screen: 'messages', topic: topics[0] })
    expect(bridge.render).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'text',
        title: 'Messages: Launch',
      }),
    )
  })

  it('opens the topic index included with the click event instead of a stale selected index', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press', index: 1 })

    expect(api.listMessages).toHaveBeenNthCalledWith(1, '2', { topicId: '20', limit: 50 })
    expect(controller.snapshot).toMatchObject({ screen: 'messages', topic: topics[1] })
  })

  it('opens the currently selected chat when the glasses emit a selection-only click event', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'selectIndex', index: 0 })

    expect(api.listMessages).toHaveBeenNthCalledWith(1, '1', { topicId: undefined, limit: 50 })
    expect(controller.snapshot).toMatchObject({ screen: 'messages' })
  })

  it('opens messages directly for normal chats', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })

    expect(api.listMessages).toHaveBeenNthCalledWith(1, '1', { topicId: undefined, limit: 50 })
    expect(controller.snapshot).toMatchObject({ screen: 'messages' })
  })

  it('normalizes newest-first API messages into chronological display order', async () => {
    const api = fakeApi({ authorized: true, latestMessages: reversedMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })

    expect(controller.snapshot).toMatchObject({
      screen: 'messages',
      messages: [...reversedMessages].reverse(),
      cursor: 100,
      isNewestPage: true,
    })
  })

  it('loads older messages into the same chronological buffer', async () => {
    const olderMessages: Message[] = [{ id: '80', sender: 'Alice', text: 'older page' }]
    const api = fakeApi({ authorized: true, olderMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeUp' })

    expect(api.listMessages).toHaveBeenCalledWith('1', { topicId: undefined, beforeId: 100, limit: 50 })
    expect(controller.snapshot).toMatchObject({
      screen: 'messages',
      messages: [...olderMessages, ...messages],
      cursor: 80,
      scrollOffset: 0,
    })
  })

  it('does not cycle when swiping down on the newest message page', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeDown' })

    expect(api.listMessages).toHaveBeenCalledWith('1', { topicId: undefined, beforeId: 100, limit: 50 })
    expect(controller.snapshot).toMatchObject({ screen: 'messages', messages, isNewestPage: true })
  })

  it('swipes down from older content one smooth step toward the newest message', async () => {
    const olderMessages: Message[] = [{ id: '80', sender: 'Alice', text: 'older page' }]
    const api = fakeApi({ authorized: true, latestMessages: reversedMessages, olderMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'swipeDown' })

    expect(api.listMessages).toHaveBeenCalledWith('1', { topicId: undefined, beforeId: 100, limit: 50 })
    expect(controller.snapshot).toMatchObject({
      screen: 'messages',
      messages: [...olderMessages, ...[...reversedMessages].reverse()],
      cursor: 80,
      scrollOffset: 0,
      isNewestPage: false,
    })
  })

  it('does not leave an older page when polling sees no newer message', async () => {
    const olderMessages: Message[] = [{ id: '80', sender: 'Alice', text: 'older page' }]
    const api = fakeApi({ authorized: true, latestMessages: reversedMessages, olderMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'swipeUp' })
    await refreshVisibleMessages(controller)

    expect(controller.snapshot).toMatchObject({
      screen: 'messages',
      messages: [...olderMessages, ...[...reversedMessages].reverse()],
      cursor: 80,
      isNewestPage: false,
    })
  })

  it('jumps from an older page to the newest page when a new reply arrives', async () => {
    const olderMessages: Message[] = [{ id: '80', sender: 'Alice', text: 'older page' }]
    let latestMessages = reversedMessages
    const newReply: Message = { id: '103', sender: 'Bob', text: 'new reply', sentAt: '2026-05-29T10:03:00Z' }
    const api = fakeApi({ authorized: true, latestMessages: () => latestMessages, olderMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeUp' })
    latestMessages = [newReply, ...reversedMessages]
    await refreshVisibleMessages(controller)

    expect(controller.snapshot).toMatchObject({
      screen: 'messages',
      messages: [...olderMessages, ...reversedMessages, newReply].sort((left, right) => Number(left.id) - Number(right.id)),
      cursor: 80,
      isNewestPage: true,
      status: 'New reply',
    })
  })

  it('refreshes the active message thread when a server update arrives', async () => {
    let latestMessages = reversedMessages
    const newReply: Message = { id: '103', sender: 'Bob', text: 'streamed reply', sentAt: '2026-05-29T10:03:00Z' }
    const api = fakeApi({ authorized: true, latestMessages: () => latestMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    latestMessages = [newReply, ...reversedMessages]
    await controller.handleTelegramUpdate({ type: 'message', chatId: '1', message: newReply })

    expect(controller.snapshot).toMatchObject({
      screen: 'messages',
      status: 'New reply',
      messages: [...reversedMessages, newReply].sort((left, right) => Number(left.id) - Number(right.id)),
    })
  })

  it('does not overlap slow message refreshes', async () => {
    let resolveLatest: ((messages: Message[]) => void) | undefined
    const latest = new Promise<Message[]>((resolve) => {
      resolveLatest = resolve
    })
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    const initialLatestCalls = latestMessageCallCount(api)
    vi.mocked(api.listMessages).mockImplementation(async (_chatId, request) => {
      if (request?.beforeId !== undefined) return []
      return latest
    })
    const first = refreshVisibleMessages(controller)
    const second = refreshVisibleMessages(controller)

    expect(latestMessageCallCount(api)).toBe(initialLatestCalls + 1)
    resolveLatest?.(reversedMessages)
    await first
    await second

    expect(latestMessageCallCount(api)).toBe(initialLatestCalls + 1)
  })

  it('refreshes root chats when a server update arrives on the chat list', async () => {
    let currentChats = chats
    const api = fakeApi({ authorized: true, chats: () => currentChats })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    currentChats = [{ ...chats[0], unreadCount: 1, lastMessage: 'streamed root' }, chats[1]]
    await controller.handleTelegramUpdate({ type: 'message', chatId: '1', message: { id: '200', sender: 'Alice', text: 'streamed root' } })

    expect(controller.snapshot).toMatchObject({
      screen: 'newMessage',
      chat: expect.objectContaining({ id: '1' }),
      message: 'streamed root',
    })
  })

  it('double press from topic messages returns to the topic list instead of paging older messages', async () => {
    const api = fakeApi({ authorized: true, olderMessages: [{ id: '80', sender: 'Alice', text: 'older page' }] })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'doublePress' })

    expect(controller.snapshot).toMatchObject({ screen: 'topics', selectedIndex: 0 })
    expect(api.listMessages).toHaveBeenCalledWith('2', { topicId: '10', beforeId: 100, limit: 50 })
  })

  it('lets double press win before delayed recording starts', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press' })
    expect(controller.snapshot).toMatchObject({ screen: 'messages' })

    await controller.dispatch({ type: 'doublePress' })

    expect(bridge.setAudioEnabled).not.toHaveBeenCalled()
    expect(controller.snapshot).toMatchObject({ screen: 'chats' })
  })

  it('records, transcribes, confirms, and sends a voice reply', async () => {
    const api = fakeApi({ authorized: true, transcription: { text: 'Reply text' } })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge, 0)

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'audioChunk', pcm: speechLikePcm() })
    await controller.dispatch({ type: 'press' })

    expect(bridge.setAudioEnabled).toHaveBeenNthCalledWith(1, true)
    expect(bridge.setAudioEnabled).toHaveBeenNthCalledWith(2, false)
    expect(api.transcribe).toHaveBeenCalledOnce()
    expect(controller.snapshot).toMatchObject({ screen: 'confirm', transcript: 'Reply text', selectedIndex: 0 })

    await controller.dispatch({ type: 'press' })
    expect(api.sendMessage).toHaveBeenCalledWith('1', { text: 'Reply text', topicId: undefined })
    expect(controller.snapshot).toMatchObject({ screen: 'messages' })
  })

  it('sends a typed phone reply to the active thread and resets to the newest message', async () => {
    const api = fakeApi({ authorized: true, latestMessages: reversedMessages })
    const controller = new TelegramAppController(api, fakeBridge())
    const states: string[] = []
    controller.subscribe((state) => states.push(state.screen))

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeUp' })
    await controller.sendTextFromPhone('typed from phone')

    expect(api.sendMessage).toHaveBeenCalledWith('1', { text: 'typed from phone', topicId: undefined })
    expect(controller.snapshot).toMatchObject({
      screen: 'messages',
      status: 'Sent',
      isNewestPage: true,
      scrollOffset: 0,
    })
    expect(states).toContain('messages')
  })

  it('rejects typed phone sends when no message thread is active', async () => {
    const controller = new TelegramAppController(fakeApi({ authorized: true }), fakeBridge())

    await controller.init()

    await expect(controller.sendTextFromPhone('not yet')).rejects.toThrow('Open a chat or topic before sending.')
  })

  it('cancels from confirmation when Cancel is selected', async () => {
    const api = fakeApi({ authorized: true, transcription: { text: 'Cancel me' } })
    const controller = new TelegramAppController(api, fakeBridge(), 0)

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'audioChunk', pcm: speechLikePcm() })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })

    expect(api.sendMessage).not.toHaveBeenCalled()
    expect(controller.snapshot).toMatchObject({ screen: 'messages' })
  })
})

function fakeApi(options: { authorized: boolean; transcription?: TranscriptionResult; latestMessages?: Message[] | (() => Message[]); olderMessages?: Message[]; chats?: Chat[] | (() => Chat[]); topics?: Topic[] }): TelegramApi {
  const listMessages = vi.fn(async (_chatId, request) => {
    if (request?.beforeId !== undefined) return options.olderMessages ?? []
    if (typeof options.latestMessages === 'function') return options.latestMessages()
    return options.latestMessages ?? messages
  })

  return {
    authStatus: vi.fn(async () => ({ authorized: options.authorized })),
    startPhoneAuth: vi.fn(async (phone: string) => ({ phone, sent: true })),
    verifyPhoneAuth: vi.fn(async () => ({ authorized: options.authorized })),
    logout: vi.fn(async () => undefined),
    listChats: vi.fn(async () => typeof options.chats === 'function' ? options.chats() : options.chats ?? chats),
    listTopics: vi.fn(async () => options.topics ?? topics),
    listMessages,
    sendMessage: vi.fn(async (_chatId, request) => ({
      id: '101',
      sender: 'Me',
      text: request.text,
      sentAt: '2026-05-29T10:01:00Z',
      outgoing: true,
    })),
    transcribe: vi.fn(async () => options.transcription ?? { text: '' }),
    subscribeUpdates: vi.fn(() => () => undefined),
  }
}

function speechLikePcm() {
  const pcm = new Uint8Array(3200)
  for (let index = 0; index < pcm.length; index += 2) {
    pcm[index] = 1
  }
  return pcm
}

function fakeBridge(): GlassesBridge {
  return {
    render: vi.fn(async () => undefined),
    setAudioEnabled: vi.fn(async () => undefined),
    showExitConfirmation: vi.fn(async () => undefined),
    turnScreenOff: vi.fn(async () => undefined),
  }
}

function refreshVisibleMessages(controller: TelegramAppController) {
  return (controller as unknown as { refreshVisibleMessages: () => Promise<void> }).refreshVisibleMessages()
}

function refreshRootChats(controller: TelegramAppController) {
  return (controller as unknown as { refreshRootChats: () => Promise<void> }).refreshRootChats()
}

function latestMessageCallCount(api: TelegramApi) {
  return vi.mocked(api.listMessages).mock.calls.filter(([, request]) => request?.beforeId === undefined).length
}
