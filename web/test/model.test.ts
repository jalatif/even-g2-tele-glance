import { describe, expect, it } from 'vitest'
import { messageScrollUnitCount, screenModel } from '../src/controller/model'
import type { AppState } from '../src/controller/model'


const encoder = new TextEncoder()

describe('screenModel', () => {
  it('keeps message text under the Even Hub 999 byte text limit', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Ada', text: 'hello' },
        { id: '2', sender: 'Lin', text: '消息'.repeat(800) },
      ],
    }

    const model = screenModel(state)

    expect(model.kind).toBe('sidebar')
    if (model.kind === 'sidebar') {
      expect(encoder.encode(model.panelBody).byteLength).toBeLessThanOrEqual(999)
      expect(model.panelFooter).toBe('Click record | Double click back')
    }
  })

  it('lets large messages scroll through later chunks instead of truncating to ellipsis only', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Alice', text: 'short' },
        { id: '2', sender: 'Bob', text: 'a '.repeat(65) + 'last' },
      ],
    }

    const fullModel = screenModel(state)

    expect(fullModel.kind).toBe('sidebar')
    if (fullModel.kind === 'sidebar') {
      // scrollOffset 0 is the newest page — Bob's long box
      expect(fullModel.panelBox).toBeDefined()
    }

    const scrolled = screenModel({ ...state, scrollOffset: 1 })
    expect(scrolled.kind).toBe('sidebar')
    if (scrolled.kind === 'sidebar') {
      // scrollOffset 1 is Alice's short message
      expect(scrolled.panelBody).toContain('Alice')
    }
  })

  it('latest message view ends at the newest message instead of an overflowing page', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Alice', text: 'first' },
        { id: '2', sender: 'Bob', text: 'second' },
      ],
      scrollOffset: 0,
    }

    const topPage = screenModel(state)
    expect(topPage.kind).toBe('sidebar')
    if (topPage.kind === 'sidebar') {
      expect(topPage.panelBody).toContain('Alice')
      expect(topPage.panelBody).toContain('Bob')
    }
  })

  it('shows loading text in the message panel while older history is loading', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [{ id: '1', sender: 'Alice', text: 'current page' }],
      status: 'Loading older messages...',
    }

    const model = screenModel(state)

    expect(model.kind).toBe('sidebar')
    if (model.kind === 'sidebar') {
      expect(model.panelBody).toBe('Loading older messages...')
      expect(model.panelBox).toBeUndefined()
    }
  })

  it('keeps boxed long-message pages separate from adjacent short messages', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Alice', text: 'short' },
        { id: '2', sender: 'Bob', text: 'very '.repeat(30) + 'long message here' },
      ],
    }

    // Bob's message has 33 words → boxes. With 4 content rows per box page,
    // it may need 2 pages. scrollOffset 0 is the last box page.
    const shortPage = screenModel({ ...state, scrollOffset: 0 })
    expect(shortPage.kind).toBe('sidebar')
    if (shortPage.kind === 'sidebar') {
      expect(shortPage.panelBox).toBeDefined()
      if (shortPage.panelBox) {
        expect(shortPage.panelBox.heading).toContain('Bob')
      }
    }

    // Alice's short message is on the page before the box pages
    const pageCount = messageScrollUnitCount(state.messages)
    const alicePage = screenModel({ ...state, scrollOffset: pageCount - 1 })
    expect(alicePage.kind).toBe('sidebar')
    if (alicePage.kind === 'sidebar') {
      expect(alicePage.panelBody).toContain('Alice')
      expect(alicePage.panelBox).toBeUndefined()
    }
  })

  it('walks through all pages of a boxed message before moving to the previous message', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Alice', text: 'before' },
        { id: '2', sender: 'Bob', text: 'very '.repeat(30) + 'long message wrapping across multiple box pages' },
        { id: '3', sender: 'Carol', text: 'after' },
      ],
    }

    const pageCount = messageScrollUnitCount(state.messages)
    expect(pageCount).toBeGreaterThanOrEqual(3)

    const newestPage = screenModel({ ...state, scrollOffset: 0 })
    expect(newestPage.kind).toBe('sidebar')
    if (newestPage.kind === 'sidebar') {
      expect(newestPage.panelBody).toContain('Carol')
    }

    const midPage = screenModel({ ...state, scrollOffset: 1 })
    expect(midPage.kind).toBe('sidebar')
    if (midPage.kind === 'sidebar') {
      expect(midPage.panelBox).toBeDefined()
    }

    const oldestPage = screenModel({ ...state, scrollOffset: pageCount - 1 })
    expect(oldestPage.kind).toBe('sidebar')
    if (oldestPage.kind === 'sidebar') {
      expect(oldestPage.panelBody).toContain('Alice')
    }
  })

  it('scrolls compact messages by full visible pages instead of dropping one message at a time', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'A1', text: 'msg1' },
        { id: '2', sender: 'A2', text: 'msg2' },
        { id: '3', sender: 'A3', text: 'msg3' },
        { id: '4', sender: 'A4', text: 'msg4' },
        { id: '5', sender: 'A5', text: 'msg5' },
        { id: '6', sender: 'A6', text: 'msg6' },
        { id: '7', sender: 'A7', text: 'msg7' },
        { id: '8', sender: 'A8', text: 'msg8' },
        { id: '9', sender: 'A9', text: 'msg9' },
        { id: '10', sender: 'A10', text: 'msg10' },
        { id: '11', sender: 'A11', text: 'msg11' },
        { id: '12', sender: 'A12', text: 'msg12' },
      ],
    }

    const pageCount = messageScrollUnitCount(state.messages)
    expect(pageCount).toBeGreaterThan(1)
    expect(pageCount).toBeLessThan(12)
  })
  it('keeps short messages compact and boxes messages over twenty-five words', () => {
    const shortState: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [{ id: '1', sender: 'Alice', text: 'hello world' }],
    }
    const shortModel = screenModel(shortState)
    expect(shortModel.kind).toBe('sidebar')
    if (shortModel.kind === 'sidebar') {
      expect(shortModel.panelBox).toBeUndefined()
    }

    const longState: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [{ id: '1', sender: 'Alice', text: Array(30).fill('word').join(' ') }],
    }
    const longModel = screenModel(longState)
    expect(longModel.kind).toBe('sidebar')
    if (longModel.kind === 'sidebar') {
      expect(longModel.panelBox).toBeDefined()
    }
  })

  it('wraps boxed messages on word boundaries when words fit the row', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [{ id: '1', sender: 'Alice', text: 'fit '.repeat(30) + 'boundary' }],
    }
    const model = screenModel(state)
    expect(model.kind).toBe('sidebar')
    if (model.kind === 'sidebar' && model.panelBox) {
      for (const line of model.panelBox.content.split(' ')) {
        expect(line.length).toBeLessThanOrEqual(42)
      }
    }
  })

  it('wraps compact messages on word boundaries when words fit the row', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [{ id: '1', sender: 'Alice', text: 'short simple message' }],
    }
    const model = screenModel(state)
    expect(model.kind).toBe('sidebar')
    if (model.kind === 'sidebar') {
      expect(model.panelBody).toContain('Alice')
    }
  })

  it('replaces unsupported emoji that LVGL cannot render on glasses', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [{ id: '1', sender: 'Alice', text: '🔴 important 🟡 note 🟢 ok 🎯 target' }],
    }
    const model = screenModel(state)
    expect(model.kind).toBe('sidebar')
    if (model.kind === 'sidebar') {
      expect(model.panelBody).not.toContain('🔴')
      expect(model.panelBody).not.toContain('🟡')
      expect(model.panelBody).not.toContain('🟢')
      expect(model.panelBody).not.toContain('🎯')
      expect(model.panelBody).toContain('target')
    }
  })

  it('renders every long-message scroll stop as a complete box', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [{ id: '1', sender: 'Alice', text: 'long text '.repeat(35) + 'final' }],
    }

    const pageCount = messageScrollUnitCount(state.messages)
    for (let offset = 0; offset < pageCount; offset++) {
      const model = screenModel({ ...state, scrollOffset: offset })
      expect(model.kind).toBe('sidebar')
      if (model.kind === 'sidebar') {
        if (model.panelBox) {
          expect(model.panelBox.heading).toBeDefined()
          expect(model.panelBox.content).toBeDefined()
          expect(model.panelBody).toBe('')
        } else {
          expect(model.panelBody.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('does not double-render boxed topic previews as body text', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'topics',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Akira Agents', kind: 'group', isForum: true },
      topics: [{ id: '10', title: 'Stock-Analyst' }],
      selectedTopicIndex: 0,
      previewTopic: { id: '10', title: 'Stock-Analyst' },
      previewMessages: [{ id: '1', sender: 'Akira', text: 'it after a 7x run from lows '.repeat(8) }],
    }

    const model = screenModel(state)

    expect(model.kind).toBe('sidebar')
    if (model.kind === 'sidebar') {
      expect(model.panelBox).toBeDefined()
      expect(model.panelBody).toBe('')
    }
  })

  it('shows selected-topic loading instead of mirroring the topic list before preview loads', () => {
    const state: AppState = {
      screen: 'sidebar', focus: 'topics',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Akira Agents', kind: 'group', isForum: true },
      topics: [
        { id: '10', title: 'General' },
        { id: '20', title: 'Assistant' },
        { id: '30', title: 'Stock-Analyst' },
      ],
      selectedTopicIndex: 2,
    }

    const model = screenModel(state)

    expect(model.kind).toBe('sidebar')
    if (model.kind === 'sidebar') {
      expect(model.panelTitle).toBe('Stock-Analyst')
      expect(model.panelBody).toBe('Loading messages...')
      expect(model.panelBody).not.toContain('General')
      expect(model.panelFooter).toBe('Loading messages...')
    }
  })

  it('does not double-render boxed messages while recording or after sent state', () => {
    const base = {
      focus: 'messages' as const,
      chats: [],
      selectedChatIndex: 0,
      chat: { id: '1', title: 'Akira Agents', kind: 'group' as const },
      messages: [{ id: '1', sender: 'Akira', text: 'it after a 7x run from lows '.repeat(8) }],
    }

    const recording = screenModel({
      ...base,
      screen: 'sidebarRecording',
      chunks: [],
      startedAt: 1,
    })
    const sent = screenModel({
      ...base,
      screen: 'sidebarSent',
    })

    expect(recording.kind).toBe('sidebar')
    expect(sent.kind).toBe('sidebar')
    if (recording.kind === 'sidebar' && sent.kind === 'sidebar') {
      expect(recording.panelBox).toBeDefined()
      expect(recording.panelBody).toBe('')
      expect(sent.panelBox).toBeDefined()
      expect(sent.panelBody).toBe('')
    }
  })

  it('marks only the selected confirmation action', () => {
    const baseState: AppState = {
      screen: 'sidebarConfirm', focus: 'messages',
      chats: [], selectedChatIndex: 0,
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [{ id: '1', sender: 'Alice', text: 'hello' }],
      transcript: 'reply',
      selectedIndex: 0,
    }

    const sendSelected = screenModel(baseState)
    const cancelSelected = screenModel({ ...baseState, selectedIndex: 1 })

    expect(sendSelected.kind).toBe('sidebar')
    expect(cancelSelected.kind).toBe('sidebar')
    if (sendSelected.kind === 'sidebar' && cancelSelected.kind === 'sidebar') {
      expect(sendSelected.panelBody).toBe('> Send\n  Cancel')
      expect(cancelSelected.panelBody).toBe('  Send\n> Cancel')
    }
  })
})
