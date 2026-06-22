/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatScreen } from '../src/screens/ChatScreen'
import type { AppState } from '../src/controller/model'

const sendText = vi.fn<[(text: string) => Promise<void>]>()
Element.prototype.scrollIntoView = vi.fn()

vi.mock('../src/contexts/AppContext', () => ({
  useApp: () => ({
    state: currentState,
    sendText,
    dispatch: vi.fn(),
    startPhoneLogin: vi.fn(),
    verifyPhoneLogin: vi.fn(),
    localeVersion: 0,
  }),
}))

let currentState: AppState

describe('ChatScreen', () => {
  afterEach(() => {
    sendText.mockReset()
  })

  it('re-enables the composer after a phone send completes', async () => {
    currentState = {
      screen: 'sidebar',
      focus: 'messages',
      chats: [{ id: '1', title: 'Akira', kind: 'user' }],
      selectedChatIndex: 0,
      chat: { id: '1', title: 'Akira', kind: 'user' },
      messages: [{ id: 'm1', sender: 'Akira', text: 'ready' }],
    }
    sendText.mockResolvedValueOnce(undefined)

    render(<ChatScreen />)

    const textarea = screen.getByPlaceholderText('Type a Telegram reply...')
    fireEvent.change(textarea, { target: { value: 'hello' } })
    fireEvent.submit(textarea.closest('form') as HTMLFormElement)

    expect((screen.getByRole('button', { name: 'Sending...' }) as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy()
      expect((screen.getByPlaceholderText('Type a Telegram reply...') as HTMLTextAreaElement).disabled).toBe(false)
    })
    expect(sendText).toHaveBeenCalledWith('hello')
  })
})
