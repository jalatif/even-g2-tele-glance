import { describe, expect, it, vi } from 'vitest'
import { TelegramAppController, type GlassesBridge } from '../src/controller/appController'
import type { TelegramApi } from '../src/api'
import type { Chat, Message, Topic, TranscriptionResult } from '../src/types'
import type { ScreenModel } from '../src/controller/model'

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
    await flushAsync()
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
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 0 })
    const renderCount = vi.mocked(bridge.render).mock.calls.length

    await controller.dispatch({ type: 'swipeDown' })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 1 })
    expect(bridge.render).toHaveBeenCalledTimes(renderCount)

    await controller.dispatch({ type: 'swipeUp' })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 0 })
    expect(bridge.render).toHaveBeenCalledTimes(renderCount)
  })

  it('forces a full rebuild when the topic-list panelBox visibility flips', async () => {
    const longMessage: Message = {
      id: '200',
      sender: 'Long Sender',
      // > 25 words so formatMessageBox produces a panelBox.
      text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twenty-one twenty-two twenty-three twenty-four twenty-five twenty-six twenty-seven',
      sentAt: '2026-05-29T10:00:00Z',
    }
    const shortMessage: Message = { id: '210', sender: 'Short', text: 'hi', sentAt: '2026-05-29T10:01:00Z' }
    let activeTopicId = 'topic-long'
    const api = fakeApi({
      authorized: true,
      chats: [chats[0], chats[1]],
      topics: [
        { id: 'topic-long', title: 'Long', unreadCount: 0, lastMessage: 'long' },
        { id: 'topic-short', title: 'Short', unreadCount: 0, lastMessage: 'short' },
      ],
      latestMessages: () => Promise.resolve(activeTopicId === 'topic-long' ? [longMessage] : [shortMessage]),
    })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' }) // open topics list
    await flushAsync()
    // Manually fetch preview for the long topic (initial selection).
    await fetchTopicPreview(controller, chats[1], { id: 'topic-long', title: 'Long' })
    await flushAsync()
    const renderCountAfterLongPreview = vi.mocked(bridge.render).mock.calls.length
    const enqueueCountAfterLongPreview = vi.mocked(bridge.enqueueSidebarPanel ?? (() => undefined)).mock.calls.length

    // Swipe to the short topic; this must trigger a full render (not a partial enqueue)
    // because the panelBox visibility flipped from defined to undefined.
    activeTopicId = 'topic-short'
    await controller.dispatch({ type: 'swipeDown' })
    await flushAsync()
    expect(vi.mocked(bridge.render).mock.calls.length).toBeGreaterThan(renderCountAfterLongPreview)
    expect(vi.mocked(bridge.enqueueSidebarPanel ?? (() => undefined)).mock.calls.length).toBe(enqueueCountAfterLongPreview)
  })

  it('suppresses the auto-press path on the same-index selection fired right after a swipe', async () => {
    // Use a single non-forum chat so the prefetch runs in the background without
    // opening any extra message threads we have to track.
    const api = fakeApi({ authorized: true, chats: [chats[0]] })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    // Swipe the same-direction pair the harness records as a "scroll" so the
    // selection lands on the same row we will later synthesise a selectIndex for.
    await controller.dispatch({ type: 'swipeDown' })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 0 })
    const screenBefore = controller.snapshot.screen

    // Same-index selectIndex 50ms after the swipe must NOT auto-open the chat.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await controller.dispatch({ type: 'selectIndex', index: 0 })
    expect(controller.snapshot.screen).toBe(screenBefore)
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats' })

    // After the debounce window expires, the same selectIndex is treated as a press.
    await new Promise((resolve) => setTimeout(resolve, 600))
    await controller.dispatch({ type: 'selectIndex', index: 0 })
    expect(controller.snapshot.screen).toBe('sidebar')
    expect(controller.snapshot).toMatchObject({ focus: 'messages' })
  })

  it('keeps chat selection moving while glasses rendering is slow', async () => {
    const api = fakeApi({ authorized: true, chats: [chats[0], chats[1], { id: '3', title: 'Ops', kind: 'group' }] })
    const bridge = slowBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await flushAsync()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'swipeDown' })

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 2 })
    // The queued path is the production hot path: every list scroll must call
    // `enqueueSidebarPanel` exactly once. The legacy `renderSidebarPanel` is the
    // slow promise that must not be awaited by the input handler.
    expect(bridge.enqueueSidebarPanel).toHaveBeenCalled()
    const enqueueCalls = vi.mocked(bridge.enqueueSidebarPanel ?? (() => undefined)).mock.calls.length
    expect(enqueueCalls).toBeGreaterThanOrEqual(2)
  })

  it('reproduces the simulator firmware-reset desync: a click after a swipe-open cycle opens row 0, not the scrolled-to row', async () => {
    // This is a STATIC ANALYSIS harness for the user-reported bug. Real
    // reproduction requires a running simulator + captured `[TeleGlanceTest]`
    // console output. In a vitest unit test we can deterministically
    // construct the exact event sequence the simulator/real-G2 emit on a
    // typical "scroll down twice, then click" flow AFTER a full page rebuild.
    //
    // The bug: when a full `rebuildPageContainer` happens (e.g. user opened
    // a chat, scrolled the message thread, then backed out to the chat list),
    // the G2 firmware resets its tracked list-selection index to row 0. The
    // controller's own `state.selectedChatIndex` is preserved across the
    // rebuild (we don't touch the controller's state). The next user click
    // arrives with the firmware's payload — `currentSelectItemIndex: 0,
    // currentSelectItemName: <chat 0 name>` — even though the user's actual
    // highlight position is row 2 (the controller's state).
    //
    // The controller currently trusts the firmware's `input.index` (clamped
    // to 0) and ends up opening chat 0. The user perceives this as "I
    // scrolled, I clicked, and the wrong thing opened."
    //
    // This test pins down the exact event sequence that reproduces the bug
    // and asserts the controller's behavior given the firmware's broken
    // signal. A fix would require either the SDK to expose a way to set the
    // firmware's tracked index, or the firmware to preserve the index across
    // rebuilds. Neither is in scope for the WebView. See
    // `docs/SDK_BUG_NATIVE_LIST_SELECTION.md` for the SDK-level analysis.
    const api = fakeApi({ authorized: true, chats: [chats[0], chats[1], { id: '3', title: 'Ops', kind: 'group' }] })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)
    await controller.init()
    await flushAsync()

    // 1. User scrolls down twice. Controller's `selectedChatIndex` moves 0 → 2.
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'swipeDown' })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 2 })

    // 2. Simulate the firmware-reset desync: the WebView receives a `selectIndex`
    //    event from the firmware with `currentSelectItemIndex: 0` (the
    //    firmware's tracked index after a rebuild reset). The user is
    //    looking at row 2 but the firmware is now reporting row 0.
    await controller.dispatch({ type: 'selectIndex', index: 0, itemName: 'Alice' })

    // 3. The user clicks. The simulator/firmware sends a `press` with the
    //    post-rebuild state. Both `index` and `itemName` point to row 0
    //    consistently — the firmware is internally consistent, just
    //    inconsistent with the controller.
    await controller.dispatch({ type: 'press', index: 0, itemName: 'Alice' })

    // 4. Assert the controller's behaviour. The controller detects that
    //    the firmware's `index: 0` + `itemName: 'Alice'` both disagree with
    //    its own `selectedChatIndex: 2`, and trusts its own state instead.
    //    The user wanted chat 2, the controller opens chat 2. Before the
    //    fix, the controller used the firmware's index and opened chat 0.
    const snapshot = controller.snapshot as { focus?: string; topic?: unknown; selectedChatIndex?: number; chat?: { id?: string } }
    expect(snapshot.focus).toBe('messages')
    expect(snapshot.chat?.id).toBe('3')  // chat 2 (Ops) — the fix landed
    expect(snapshot.chat?.id).not.toBe('1')  // chat 0 (Alice) — would be the bug
  })

  it('opens the scrolled-to chat when the firmware does NOT reset (baseline, no desync)', async () => {
    // The companion to the previous test: when the firmware is internally
    // consistent with the controller's state, the click correctly opens the
    // scrolled-to row. This is the normal path; the previous test shows
    // what happens when the firmware is wrong.
    const api = fakeApi({ authorized: true, chats: [chats[0], chats[1], { id: '3', title: 'Ops', kind: 'group' }] })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)
    await controller.init()
    await flushAsync()

    // 1. User scrolls down twice. Controller's `selectedChatIndex` moves 0 → 2.
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'swipeDown' })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 2 })

    // 2. The firmware-tracked index moves with the controller (no rebuild
    //    happened). The `selectIndex` event is consistent: index 2, name 'Ops'.
    await controller.dispatch({ type: 'selectIndex', index: 2, itemName: 'Ops' })

    // 3. The user clicks. Firmware reports index 2, name 'Ops'. Controller
    //    opens chat 2. This is the correct, expected behavior.
    await controller.dispatch({ type: 'press', index: 2, itemName: 'Ops' })
    const snapshot = controller.snapshot as { focus?: string; topic?: unknown; selectedChatIndex?: number; chat?: { id?: string } }
    expect(snapshot.focus).toBe('messages')
    expect(snapshot.chat?.id).toBe('3')  // chat 2 (Ops) — correct
  })

  it('enqueues a sidebar panel for each chat scroll without awaiting the native render', async () => {
    const api = fakeApi({ authorized: true, chats: [chats[0], chats[1], { id: '3', title: 'Ops', kind: 'group' }] })
    const bridge = recordingEnqueueBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await flushAsync()
    const startCount = bridge.enqueueLog.length

    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'swipeDown' })

    expect(bridge.enqueueLog.length - startCount).toBe(2)
    expect(bridge.enqueueLog[bridge.enqueueLog.length - 1].selected).toBe(2)
  })
  it('does not repaint the native chat list for a no-activity background refresh', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await flushAsync()
    const renderCount = vi.mocked(bridge.render).mock.calls.length
    await controller.dispatch({ type: 'swipeDown' })
    clearInputQuiet(controller)
    await refreshRootChats(controller)

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 1 })
    expect(bridge.render).toHaveBeenCalledTimes(renderCount)
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

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats' })
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

    expect(api.listMessages).toHaveBeenCalledWith('1', { topicId: undefined, limit: 8 })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages', chat: expect.objectContaining({ id: '1' }) })
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
    expect(api.listMessages).toHaveBeenCalledWith('2', { topicId: '20', limit: 8 })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages', topic: expect.objectContaining({ id: '20' }) })
  })

  it('opens forum topics before message history', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })

    expect(api.listTopics).toHaveBeenCalledWith('2')
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'topics', selectedTopicIndex: 0 })
  })

  it('defers preview loading for the first topic while input is quiet', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })

    expect(api.listMessages).not.toHaveBeenCalledWith('2', { topicId: '10', limit: 8 })

    clearInputQuiet(controller)
    await fetchTopicPreview(controller, chats[1], topics[0])

    expect(api.listMessages).toHaveBeenCalledWith('2', { topicId: '10', limit: 8 })
  })

  it('does not repaint the native topic list after loading a preview', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    await flushAsync()
    const renderCount = vi.mocked(bridge.render).mock.calls.length
    clearInputQuiet(controller)
    await fetchTopicPreview(controller, chats[1], topics[0])

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'topics', previewTopic: topics[0] })
    expect(bridge.render).toHaveBeenCalledTimes(renderCount)
  })

  it('opens selected forum topic messages and renders a message screen', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press' })
    await flushAsync()

    expect(api.listMessages).toHaveBeenCalledWith('2', { topicId: '10', limit: 8 })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages', topic: topics[0] })
    // The messages-focus render may go through either the full render path (legacy)
    // or the partial path introduced by the list-selection-preservation fix.
    const messageRender = [
      ...(bridge.renderSidebarPanel as any).mock.calls.flat(),
      ...(bridge.render as any).mock.calls.flat(),
    ].find((m: any) => m?.kind === 'sidebar' && m?.title === 'Launch')
    expect(messageRender).toEqual(
      expect.objectContaining({
        kind: 'sidebar',
        title: 'Launch',
      }),
    )
  })

  it('opens the topic whose name matches the click event', async () => {
    // EXPERIMENT: with the firmware list-selection-reset workaround in
    // place, the controller prefers its own state over the firmware's
    // `index`. The firmware's `itemName` is the only signal that can
    // legitimately move the controller off its current row, and the
    // name must resolve to a different row. This test pins the contract:
    // a press with `itemName: 'Support'` opens the Support topic, even
    // if the controller's state was previously on the Launch topic.
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    // The press carries `itemName: 'Support'` so the name resolution
    // moves the controller off its current state (Launch) to Support.
    await controller.dispatch({ type: 'press', index: 1, itemName: 'Support' })

    expect(api.listMessages).toHaveBeenCalledWith('2', { topicId: '20', limit: 8 })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages', topic: topics[1] })
  })

  it('does not reuse stale topic preview after the selected topic changes', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    await fetchTopicPreview(controller, chats[1], topics[0])
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })

    expect(api.listMessages).toHaveBeenCalledWith('2', { topicId: '20', limit: 8 })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages', topic: topics[1] })
  })

  it('ignores an initial selection-only event emitted by the native list render', async () => {
    const api = fakeApi({ authorized: true, chats: [chats[1], chats[0]] })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    const topicCalls = vi.mocked(api.listTopics).mock.calls.length
    await controller.dispatch({ type: 'selectIndex', index: 0 })

    expect(api.listTopics).toHaveBeenCalledTimes(topicCalls)
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 0 })
  })

  it('opens the currently selected chat when the glasses emit an armed selection-only click event', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge(), { selectionOnlyPressDelayMs: 0 })

    await controller.init()
    await controller.dispatch({ type: 'selectIndex', index: 0 })

    expect(api.listMessages).toHaveBeenNthCalledWith(1, '1', { topicId: undefined, limit: 8 })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages' })
  })

  it('opens the chat named by the native list event when the index is missing', async () => {
    const api = fakeApi({ authorized: true, chats: [chats[0], chats[1], { id: '3', title: 'Ops', kind: 'group' }] })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press', itemName: 'Project' })

    expect(api.listTopics).toHaveBeenCalledWith('2')
    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      selectedChatIndex: 1,
      chat: expect.objectContaining({ id: '2' }),
    })
  })

  it('opens messages directly for normal chats', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })

    expect(api.listMessages).toHaveBeenNthCalledWith(1, '1', { topicId: undefined, limit: 8 })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages' })
  })

  it('shows loading immediately while opening a chat with slow messages', async () => {
    const messagePage = deferred<Message[]>()
    const api = fakeApi({ authorized: true, latestMessages: () => messagePage.promise })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    const opening = controller.dispatch({ type: 'press' })
    await flushAsync()

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
      status: 'Loading Alice...',
    })

    messagePage.resolve(messages)
    await opening

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages' })
  })

  it('can back out while a slow chat open is still loading', async () => {
    const messagePage = deferred<Message[]>()
    const api = fakeApi({ authorized: true, latestMessages: () => messagePage.promise })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    const opening = controller.dispatch({ type: 'press' })
    await flushAsync()
    await controller.dispatch({ type: 'doublePress' })

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats' })

    messagePage.resolve(messages)
    await opening

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats' })
  })

  it('shows loading immediately while opening a forum chat with slow topics', async () => {
    const topicPage = deferred<Topic[]>()
    const api = fakeApi({ authorized: true, topics: () => topicPage.promise })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    const opening = controller.dispatch({ type: 'press' })
    await flushAsync()

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
      status: 'Loading Project topics...',
      selectedChatIndex: 1,
    })
    await controller.dispatch({ type: 'doublePress' })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 1, status: undefined })

    topicPage.resolve(topics)
    await opening

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats', selectedChatIndex: 1, status: undefined })
  })

  it('marks normal chat messages read and clears the local unread badge when viewed', async () => {
    const unreadChats = [{ ...chats[0], unreadCount: 2 }, chats[1]]
    const api = fakeApi({ authorized: true, chats: unreadChats })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await flushAsync()
    flushReadAcks(controller)

    expect(api.markRead).toHaveBeenCalledWith('1', { topicId: undefined, maxId: 100 })
    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
      chat: expect.objectContaining({ unreadCount: 0 }),
      chats: [expect.objectContaining({ unreadCount: 0 }), expect.anything()],
    })
  })

  it('marks topic preview messages read and clears the topic and parent chat badge when viewed', async () => {
    const unreadTopics = [{ ...topics[0], unreadCount: 1 }, { ...topics[1], unreadCount: 0 }]
    const api = fakeApi({ authorized: true, chats: [chats[0], { ...chats[1], unreadCount: 5 }], topics: unreadTopics })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    clearInputQuiet(controller)
    await fetchTopicPreview(controller, chats[1], unreadTopics[0])
    await flushAsync()
    flushReadAcks(controller)

    expect(api.markRead).toHaveBeenCalledWith('2', { topicId: '10', maxId: 100 })
    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'topics',
      chat: expect.objectContaining({ unreadCount: 0 }),
      topics: [expect.objectContaining({ unreadCount: 0 }), expect.anything()],
    })
  })

  it('keeps the parent forum badge when other loaded topics remain unread', async () => {
    const unreadTopics = [{ ...topics[0], unreadCount: 2 }, { ...topics[1], unreadCount: 3 }]
    const api = fakeApi({ authorized: true, chats: [chats[0], { ...chats[1], unreadCount: 10 }], topics: unreadTopics })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    clearInputQuiet(controller)
    await fetchTopicPreview(controller, chats[1], unreadTopics[0])
    await flushAsync()
    flushReadAcks(controller)

    expect(api.markRead).toHaveBeenCalledWith('2', { topicId: '10', maxId: 100 })
    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'topics',
      chat: expect.objectContaining({ unreadCount: 3 }),
      chats: [expect.anything(), expect.objectContaining({ unreadCount: 3 })],
      topics: [expect.objectContaining({ unreadCount: 0 }), expect.objectContaining({ unreadCount: 3 })],
    })
  })

  it('does not acknowledge read topic previews just because the parent forum has unread elsewhere', async () => {
    const mixedTopics = [{ ...topics[0], unreadCount: 0 }, { ...topics[1], unreadCount: 3 }]
    const api = fakeApi({ authorized: true, chats: [chats[0], { ...chats[1], unreadCount: 3 }], topics: mixedTopics })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    await flushAsync()

    expect(api.markRead).not.toHaveBeenCalled()
    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'topics',
      chat: expect.objectContaining({ unreadCount: 3 }),
      topics: [expect.objectContaining({ unreadCount: 0 }), expect.objectContaining({ unreadCount: 3 })],
    })
  })

  it('updates the saved topic-list back target after marking a topic read', async () => {
    const api = fakeApi({ authorized: true })
    const controller = new TelegramAppController(api, fakeBridge())
    const previous = {
      screen: 'sidebar' as const,
      focus: 'topics' as const,
      chats: [chats[0], { ...chats[1], unreadCount: 10 }],
      selectedChatIndex: 1,
      chat: { ...chats[1], unreadCount: 10 },
      topics: [{ ...topics[0], unreadCount: 2 }, { ...topics[1], unreadCount: 3 }],
      selectedTopicIndex: 0,
    }

    await openMessages(controller, previous.chat, previous.topics[0], previous)
    await flushAsync()
    await controller.dispatch({ type: 'doublePress' })

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'topics',
      chat: expect.objectContaining({ unreadCount: 3 }),
      chats: [expect.anything(), expect.objectContaining({ unreadCount: 3 })],
      topics: [expect.objectContaining({ unreadCount: 0 }), expect.objectContaining({ unreadCount: 3 })],
    })
  })

  it('normalizes newest-first API messages into chronological display order', async () => {
    const api = fakeApi({ authorized: true, latestMessages: reversedMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
      messages: [...reversedMessages].reverse(),
      cursor: 100,
      isNewestPage: true,
    })
  })

  it('loads older messages into the same chronological buffer', async () => {
    const olderMessages: Message[] = [{ id: '80', sender: 'Alice', text: 'older page' }]
    const olderPage = deferred<Message[]>()
    const api = fakeApi({ authorized: true, olderMessages: () => olderPage.promise })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeUp' })

    expect(api.listMessages).toHaveBeenCalledWith('1', { topicId: undefined, beforeId: 100, limit: 8 })
    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
      messages,
      status: 'Loading older messages...',
    })

    olderPage.resolve(olderMessages)
    await flushAsync()

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
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

    expect(api.listMessages).not.toHaveBeenCalledWith('1', { topicId: undefined, beforeId: 100, limit: 8 })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages', messages, isNewestPage: true })
  })

  it('swipes down from older content one smooth step toward the newest message', async () => {
    const olderMessages: Message[] = [{ id: '80', sender: 'Alice', text: 'older page' }]
    const api = fakeApi({ authorized: true, latestMessages: reversedMessages, olderMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'swipeUp' })
    await flushAsync()
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'swipeDown' })

    expect(api.listMessages).toHaveBeenCalledWith('1', { topicId: undefined, beforeId: 100, limit: 8 })
    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
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
    await flushAsync()
    await controller.dispatch({ type: 'swipeUp' })
    await controller.dispatch({ type: 'swipeUp' })
    await refreshVisibleMessages(controller)

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
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
    await flushAsync()
    latestMessages = [newReply, ...reversedMessages]
    clearInputQuiet(controller)
    await refreshVisibleMessages(controller)

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
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
    clearInputQuiet(controller)
    await controller.handleTelegramUpdate({ type: 'message', chatId: '1', message: newReply })

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
      status: 'New reply',
      messages: [...reversedMessages, newReply].sort((left, right) => Number(left.id) - Number(right.id)),
    })
  })

  it('refreshes an active forum topic when an update carries the topic top-message id', async () => {
    const forumTopics: Topic[] = [{ id: '10', title: 'Launch', topMessageId: '101' }]
    let latestMessages = messages
    const newReply: Message = { id: '104', sender: 'Bob', text: 'forum streamed', sentAt: '2026-05-29T10:04:00Z' }
    const api = fakeApi({ authorized: true, topics: forumTopics, latestMessages: () => latestMessages })
    const controller = new TelegramAppController(api, fakeBridge())

    await controller.init()
    await controller.dispatch({ type: 'swipeDown' })
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press' })
    latestMessages = [newReply, ...messages]
    clearInputQuiet(controller)
    await controller.handleTelegramUpdate({ type: 'message', chatId: '2', topicId: '101', message: newReply })

    expect(controller.snapshot).toMatchObject({
      screen: 'sidebar',
      focus: 'messages',
      status: 'New reply',
      messages: [...messages, newReply].sort((left, right) => Number(left.id) - Number(right.id)),
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
    clearInputQuiet(controller)
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
    clearInputQuiet(controller)
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

    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'topics', selectedTopicIndex: 0 })
    expect(api.listMessages).toHaveBeenCalledWith('2', { topicId: '10', beforeId: 100, limit: 8 })
  })

  it('lets double press win before delayed recording starts', async () => {
    const api = fakeApi({ authorized: true })
    const bridge = fakeBridge()
    const controller = new TelegramAppController(api, bridge)

    await controller.init()
    await controller.dispatch({ type: 'press' })
    await controller.dispatch({ type: 'press' })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages' })

    await controller.dispatch({ type: 'doublePress' })

    expect(bridge.setAudioEnabled).not.toHaveBeenCalled()
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'chats' })
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
    expect(controller.snapshot).toMatchObject({ screen: 'sidebarConfirm', transcript: 'Reply text', selectedIndex: 0 })

    await controller.dispatch({ type: 'press' })
    expect(api.sendMessage).toHaveBeenCalledWith('1', { text: 'Reply text', topicId: undefined })
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages' })
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
      screen: 'sidebar',
      focus: 'messages',
      status: 'Sent',
      isNewestPage: true,
      scrollOffset: 0,
    })
    await flushAsync()
    expect(states).toContain('sidebar')
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
    expect(controller.snapshot).toMatchObject({ screen: 'sidebar', focus: 'messages' })
  })
})
function fakeApi(options: { authorized: boolean; transcription?: TranscriptionResult; latestMessages?: Message[] | (() => Message[] | Promise<Message[]>); olderMessages?: Message[] | (() => Message[] | Promise<Message[]>); chats?: Chat[] | (() => Chat[]); topics?: Topic[] | (() => Topic[] | Promise<Topic[]>) }): TelegramApi {
  const listMessages = vi.fn(async (_chatId, request) => {
    if (request?.beforeId !== undefined) {
      if (typeof options.olderMessages === 'function') return options.olderMessages()
      return options.olderMessages ?? []
    }
    if (typeof options.latestMessages === 'function') return options.latestMessages()
    return options.latestMessages ?? messages
  })

  return {
    authStatus: vi.fn(async () => ({ authorized: options.authorized })),
    startPhoneAuth: vi.fn(async (phone: string) => ({ phone, sent: true })),
    verifyPhoneAuth: vi.fn(async () => ({ authorized: options.authorized })),
    logout: vi.fn(async () => undefined),
    listChats: vi.fn(async () => typeof options.chats === 'function' ? options.chats() : options.chats ?? chats),
    listTopics: vi.fn(async () => typeof options.topics === 'function' ? options.topics() : options.topics ?? topics),
    listMessages,
    sendMessage: vi.fn(async (_chatId, request) => ({
      id: '101',
      sender: 'Me',
      text: request.text,
      sentAt: '2026-05-29T10:01:00Z',
      outgoing: true,
    })),
    markRead: vi.fn(async () => undefined),
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
    enqueueSidebarPanel: vi.fn(),
    renderSidebarPanel: vi.fn(async () => undefined),
  }
}

function slowBridge(): GlassesBridge {
  // `renderSidebarPanel` never resolves so the legacy partial-render path would hang.
  // The list-scroll path now goes through `enqueueSidebarPanel` and must remain synchronous.
  return {
    render: vi.fn(() => new Promise<void>(() => undefined)),
    setAudioEnabled: vi.fn(async () => undefined),
    showExitConfirmation: vi.fn(async () => undefined),
    turnScreenOff: vi.fn(async () => undefined),
    enqueueSidebarPanel: vi.fn(),
    renderSidebarPanel: vi.fn(() => new Promise<void>(() => undefined)),
  }
}

function recordingEnqueueBridge(): GlassesBridge & { enqueueLog: Array<{ ts: number; focus: string; selected: number }> } {
  const enqueueLog: Array<{ ts: number; focus: string; selected: number }> = []
  const enqueueSidebarPanel = vi.fn((model: Extract<ScreenModel, { kind: 'sidebar' }>) => {
    enqueueLog.push({ ts: Date.now(), focus: model.focus, selected: model.sidebarSelected })
  })
  return {
    render: vi.fn(async () => undefined),
    setAudioEnabled: vi.fn(async () => undefined),
    showExitConfirmation: vi.fn(async () => undefined),
    turnScreenOff: vi.fn(async () => undefined),
    enqueueSidebarPanel,
    renderSidebarPanel: vi.fn(async () => undefined),
    enqueueLog,
  }
}

function refreshVisibleMessages(controller: TelegramAppController) {
  return (controller as unknown as { refreshVisibleMessages: () => Promise<void> }).refreshVisibleMessages()
}

function refreshRootChats(controller: TelegramAppController) {
  return (controller as unknown as { refreshRootChats: () => Promise<void> }).refreshRootChats()
}

function fetchTopicPreview(controller: TelegramAppController, chat: Chat, topic: Topic) {
  return (controller as unknown as { fetchTopicPreview: (chat: Chat, topic: Topic) => Promise<void> }).fetchTopicPreview(chat, topic)
}

function openMessages(controller: TelegramAppController, chat: Chat, topic: Topic | undefined, previous: unknown) {
  return (controller as unknown as { openMessages: (chat: Chat, topic: Topic | undefined, previous: unknown) => Promise<void> }).openMessages(chat, topic, previous)
}

function clearInputQuiet(controller: TelegramAppController) {
  ;(controller as unknown as { inputQuietUntil: number }).inputQuietUntil = 0
}

function flushReadAcks(controller: TelegramAppController) {
  clearInputQuiet(controller)
  ;(controller as unknown as { flushReadAcks: () => void }).flushReadAcks()
}

function latestMessageCallCount(api: TelegramApi) {
  return vi.mocked(api.listMessages).mock.calls.filter(([, request]) => request?.beforeId === undefined).length
}

function flushAsync() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}
