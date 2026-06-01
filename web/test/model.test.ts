import { describe, expect, it } from 'vitest'
import { messageScrollUnitCount, screenModel } from '../src/controller/model'
import type { AppState } from '../src/controller/model'

const encoder = new TextEncoder()
const boxTop = `+${'-'.repeat(40)}+`
const boxMid = `+${'-'.repeat(40)}+`
const boxBottom = `+${'-'.repeat(40)}+`

describe('screenModel', () => {
  it('keeps message text under the Even Hub 999 byte text limit', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Ada', text: 'hello' },
        { id: '2', sender: 'Lin', text: '消息'.repeat(800) },
      ],
    }

    const model = screenModel(state)

    expect(model.kind).toBe('text')
    if (model.kind === 'text') {
      expect(encoder.encode(model.body).byteLength).toBeLessThanOrEqual(999)
      expect(model.footer).toBe('Click record | Double click back')
    }
  })

  it('lets large messages scroll through later chunks instead of truncating to ellipsis only', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '2', sender: 'Lin', text: 'abcdefghijklmnopqrstuvwxyz '.repeat(80) },
      ],
    }

    expect(messageScrollUnitCount(state.messages)).toBeGreaterThan(2)

    const latest = screenModel(state)
    const blockStart = screenModel({ ...state, scrollOffset: Math.max(0, messageScrollUnitCount(state.messages) - 2) })
    const older = screenModel({ ...state, scrollOffset: 4 })

    expect(latest.kind).toBe('text')
    expect(blockStart.kind).toBe('text')
    expect(older.kind).toBe('text')
    if (latest.kind === 'text' && blockStart.kind === 'text' && older.kind === 'text') {
      expect(encoder.encode(latest.body).byteLength).toBeLessThanOrEqual(999)
      expect(encoder.encode(blockStart.body).byteLength).toBeLessThanOrEqual(999)
      expect(encoder.encode(older.body).byteLength).toBeLessThanOrEqual(999)
      expect(latest.body.split('\n').length).toBeLessThanOrEqual(8)
      expect(older.body).not.toBe(latest.body)
      expect(older.body).not.toBe('...')
      expect(blockStart.body).toContain(boxTop)
      expect(blockStart.body).toContain('| Lin')
      expect(blockStart.body).toContain('\u00a0')
      expect(latest.body.endsWith(boxBottom)).toBe(true)
      expect(latest.box?.heading).toContain('Lin')
      expect(latest.box?.content).not.toContain(boxBottom)
      expect(latest.box?.content).not.toContain('|')
    }
  })

  it('latest message view ends at the newest message instead of an overflowing page', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Ada', text: 'older '.repeat(80) },
        { id: '2', sender: 'Lin', text: 'newest message' },
      ],
    }

    const model = screenModel(state)

    expect(model.kind).toBe('text')
    if (model.kind === 'text') {
      expect(model.body.split('\n').length).toBeLessThanOrEqual(8)
      expect(model.body).toContain('Lin: newest message')
      expect(model.body).toContain('newest message')
    }
  })

  it('keeps boxed long-message pages separate from adjacent short messages', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Ada', text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix' },
        { id: '2', sender: 'Lin', text: 'newest message' },
      ],
    }

    const latest = screenModel(state)
    const previous = screenModel({ ...state, scrollOffset: 1 })

    expect(latest.kind).toBe('text')
    expect(previous.kind).toBe('text')
    if (latest.kind === 'text' && previous.kind === 'text') {
      expect(latest.body).toBe('Lin: newest message')
      expect(latest.box).toBeUndefined()
      expect(previous.body).toContain(boxTop)
      expect(previous.box?.heading).toContain('Ada')
    }
  })

  it('walks through all pages of a boxed message before moving to the previous message', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Ada', text: 'previous message' },
        { id: '2', sender: 'Lin', text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty '.repeat(4) },
      ],
    }
    const total = messageScrollUnitCount([state.messages[1]])
    expect(total).toBeGreaterThan(2)

    for (let scrollOffset = 0; scrollOffset < total; scrollOffset += 1) {
      const model = screenModel({ ...state, scrollOffset })
      expect(model.kind).toBe('text')
      if (model.kind === 'text') {
        expect(model.box?.heading).toContain('Lin')
        expect(model.body).not.toContain('Ada: previous message')
      }
    }

    const previous = screenModel({ ...state, scrollOffset: total })
    expect(previous.kind).toBe('text')
    if (previous.kind === 'text') {
      expect(previous.box).toBeUndefined()
      expect(previous.body).toContain('Ada: previous message')
    }
  })

  it('scrolls compact messages by full visible pages instead of dropping one message at a time', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: Array.from({ length: 12 }, (_, index) => ({
        id: String(index + 1),
        sender: 'Ada',
        text: `message ${index + 1}`,
      })),
    }

    const latest = screenModel(state)
    const previous = screenModel({ ...state, scrollOffset: 1 })

    expect(latest.kind).toBe('text')
    expect(previous.kind).toBe('text')
    if (latest.kind === 'text' && previous.kind === 'text') {
      expect(latest.body).toContain('Ada: message 12')
      expect(latest.body).toContain('Ada: message 5')
      expect(previous.body).not.toContain('Ada: message 12')
      expect(previous.body).not.toContain('Ada: message 5')
      expect(previous.body).toContain('Ada: message 4')
    }
  })

  it('keeps short messages compact and boxes messages over twenty-five words', () => {
    const shortState: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Ada', text: 'short note' },
      ],
    }
    const longState: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '2', sender: 'Lin', text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone twentytwo twentythree twentyfour twentyfive twentysix' },
      ],
    }

    const shortModel = screenModel(shortState)
    const longModel = screenModel(longState)

    expect(shortModel.kind).toBe('text')
    expect(longModel.kind).toBe('text')
    if (shortModel.kind === 'text' && longModel.kind === 'text') {
      expect(shortModel.body).toContain('Ada: short note')
      expect(shortModel.box).toBeUndefined()
      expect(longModel.body).toContain(boxTop)
      expect(longModel.body).toContain('| Lin')
      expect(longModel.box?.heading).toContain('Lin')
      expect(longModel.box?.content).toContain('twentyfive')
    }
  })

  it('wraps boxed messages on word boundaries when words fit the row', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Ada', text: 'there are two hundred thirty commits behind available want me to run update while preserving smooth scrolling through every visible message page on glasses hardware' },
      ],
    }

    const model = screenModel(state)

    expect(model.kind).toBe('text')
    if (model.kind === 'text') {
      expect(model.body).not.toMatch(/commi\s*\n\s*ts/)
      expect(model.body).toContain('commits')
    }
  })

  it('renders every long-message scroll stop as a complete box', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Lin', text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty '.repeat(4) },
      ],
    }

    const total = messageScrollUnitCount(state.messages)
    expect(total).toBeGreaterThan(1)

    for (let scrollOffset = 0; scrollOffset < total; scrollOffset += 1) {
      const model = screenModel({ ...state, scrollOffset })
      expect(model.kind).toBe('text')
      if (model.kind === 'text') {
        expect(model.body.startsWith(boxTop)).toBe(true)
        expect(model.body).toContain(boxMid)
        expect(model.body.endsWith(boxBottom)).toBe(true)
        expect(model.box?.heading).toContain('Lin')
        expect(model.box?.content).not.toMatch(/^\+-+\+$/m)
        expect(model.box?.content).not.toContain('|')
      }
    }
  })
})
