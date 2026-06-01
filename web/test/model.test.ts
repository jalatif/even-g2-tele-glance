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

  it('keeps short messages compact and boxes messages over ten words', () => {
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
        { id: '2', sender: 'Lin', text: 'one two three four five six seven eight nine ten eleven' },
      ],
    }

    const shortModel = screenModel(shortState)
    const longModel = screenModel(longState)

    expect(shortModel.kind).toBe('text')
    expect(longModel.kind).toBe('text')
    if (shortModel.kind === 'text' && longModel.kind === 'text') {
      expect(shortModel.body).toContain('Ada: short note')
      expect(longModel.body).toContain(boxTop)
      expect(longModel.body).toContain('| Lin')
    }
  })

  it('wraps boxed messages on word boundaries when words fit the row', () => {
    const state: AppState = {
      screen: 'messages',
      chat: { id: '1', title: 'Project', kind: 'group' },
      messages: [
        { id: '1', sender: 'Ada', text: 'there are two hundred thirty commits behind available want me to run update' },
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
      }
    }
  })
})
