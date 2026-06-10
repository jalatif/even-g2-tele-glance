import { afterEach, describe, expect, it, vi } from 'vitest'
import { HttpTelegramApi, SHARED_BACKEND_URL, SHARED_BACKEND_TEST_SECRET } from '../src/api'
import { decryptJsonPayload } from '../src/secureAuth'

describe('HttpTelegramApi secret selection', () => {
  let capturedHeaders: Headers | undefined
  let capturedBody: string | undefined

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFetch() {
    capturedHeaders = undefined
    capturedBody = undefined
    const fetchStub = vi.fn(async (_url: string, init?: RequestInit & { body?: string }) => {
      capturedHeaders = init?.headers as Headers | undefined
      capturedBody = init?.body as string | undefined
      return new Response(JSON.stringify({ session: 'no_session' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchStub)
  }

  it('uses the test secret for the shared backend even when the user overrides the secret', async () => {
    stubFetch()
    const api = new HttpTelegramApi(
      SHARED_BACKEND_URL,
      () => ({
        telegramApiId: '123',
        telegramApiHash: 'abc',
        backendSharedSecret: 'user-typo-secret',
      }),
    )

    await api.authStatus()

    const authHeader = capturedHeaders?.get('X-TeleGlance-Auth')
    expect(authHeader).toBeTruthy()

    // Decrypt with the test secret — must succeed
    const decrypted = await decryptJsonPayload(authHeader!, SHARED_BACKEND_TEST_SECRET)
    const payload = JSON.parse(decrypted)
    expect(payload.apiId).toBe('123')
    expect(payload.apiHash).toBe('abc')

    // Decrypt with the user's typo secret — must fail (wrong key)
    await expect(decryptJsonPayload(authHeader!, 'user-typo-secret')).rejects.toThrow()
  })

  it('uses the user secret for a custom backend when set', async () => {
    stubFetch()
    const api = new HttpTelegramApi(
      'http://localhost:8787',
      () => ({
        telegramApiId: '123',
        telegramApiHash: 'abc',
        backendSharedSecret: 'user-secret',
      }),
    )

    await api.authStatus()

    const authHeader = capturedHeaders?.get('X-TeleGlance-Auth')
    expect(authHeader).toBeTruthy()

    // Decrypt with the user's secret — must succeed
    const decrypted = await decryptJsonPayload(authHeader!, 'user-secret')
    const payload = JSON.parse(decrypted)
    expect(payload.apiId).toBe('123')
    expect(payload.apiHash).toBe('abc')

    // Decrypt with the test secret — must fail (wrong key)
    await expect(decryptJsonPayload(authHeader!, SHARED_BACKEND_TEST_SECRET)).rejects.toThrow()
  })

  it('request bodies are encrypted with the effective secret for the shared backend', async () => {
    stubFetch()
    const api = new HttpTelegramApi(
      SHARED_BACKEND_URL,
      () => ({
        telegramApiId: '123',
        telegramApiHash: 'abc',
        backendSharedSecret: 'user-typo-secret',
      }),
    )

    await api.startPhoneAuth('+1234567890')

    // Body must be JSON with encryptedPayload
    expect(capturedBody).toBeTruthy()
    const body = JSON.parse(capturedBody!)
    expect(body).toEqual({ encryptedPayload: expect.any(String) })
    expect(body.encryptedPayload).toMatch(/^v1\./)

    // Decrypt under the test secret — must succeed and reveal the phone number
    const decrypted = await decryptJsonPayload(body.encryptedPayload, SHARED_BACKEND_TEST_SECRET)
    const payload = JSON.parse(decrypted)
    expect(payload.phone).toBe('+1234567890')

    // Decrypt under the user's typo secret — must fail
    await expect(decryptJsonPayload(body.encryptedPayload, 'user-typo-secret')).rejects.toThrow()
  })
})
