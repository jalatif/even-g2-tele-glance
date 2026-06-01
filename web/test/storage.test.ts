import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveFrontendConfig } from '../src/storage'

describe('frontend settings storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not persist Telegram credentials, sessions, or shared secret to cookies', () => {
    const localStorage = memoryStorage()
    const cookieWrites: string[] = []
    vi.stubGlobal('window', { localStorage })
    vi.stubGlobal('document', {
      get cookie() {
        return cookieWrites.join(';')
      },
      set cookie(value: string) {
        cookieWrites.push(value)
      },
    })

    saveFrontendConfig({
      apiBaseUrl: 'http://100.64.0.1:8787',
      telegramApiId: '12345',
      telegramApiHash: 'hash-secret',
      telegramSession: 'string-session-secret',
      backendSharedSecret: 'backend-secret',
      sttBaseUrl: '',
      debugEventsEnabled: false,
      chatPollMs: 10000,
      messagePollMs: 8000,
      recordingMinDurationMs: 900,
    })

    expect(localStorage.getItem('teleGlance.telegramApiHash')).toBe('hash-secret')
    const cookieText = cookieWrites.join('\n')
    expect(cookieText).toContain('teleGlance.apiBaseUrl=')
    expect(cookieText).not.toContain('hash-secret')
    expect(cookieText).not.toContain('string-session-secret')
    expect(cookieText).not.toContain('backend-secret')
  })
})

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key: string) {
      return values.get(key) ?? null
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string) {
      values.delete(key)
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
  }
}
