import { describe, expect, it } from 'vitest'
import { screenModel } from '../src/controller/model'
import type { AppState } from '../src/controller/model'

const encoder = new TextEncoder()

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
      expect(model.footer).toBe('Checking replies... | Click record | Double click back')
    }
  })
})
