import type {
  AuthStatus,
  Chat,
  Id,
  MarkReadRequest,
  Message,
  PhoneAuthStart,
  PhoneAuthStatus,
  SendMessageRequest,
  SendMessageResponse,
  Topic,
  TelegramUpdate,
  TranscriptionResult,
} from './types'
import { decryptJsonPayload, encryptedTelegramAuthHeader, encryptJsonPayload } from './secureAuth'

export interface TelegramApi {
  authStatus(): Promise<AuthStatus>
  startPhoneAuth(phone: string): Promise<PhoneAuthStart>
  verifyPhoneAuth(phone: string, code: string): Promise<PhoneAuthStatus>
  logout(): Promise<void>
  listChats(limit?: number): Promise<Chat[]>
  listTopics(chatId: Id): Promise<Topic[]>
  listMessages(chatId: Id, options?: { topicId?: Id; beforeId?: Id; limit?: number }): Promise<Message[]>
  sendMessage(chatId: Id, request: SendMessageRequest): Promise<Message>
  markRead(chatId: Id, request: MarkReadRequest): Promise<void>
  transcribe(wav: Blob): Promise<TranscriptionResult>
  subscribeUpdates(onUpdate: (update: TelegramUpdate) => void, onError?: (error: Event | Error) => void): () => void
}

export type TelegramAuthConfig = {
  telegramApiId?: string
  telegramApiHash?: string
  telegramSession?: string
  backendSharedSecret?: string
  sttBaseUrl?: string
}

export function defaultApiBaseUrl() {
  return localApiBaseUrl() ?? 'http://localhost:8787'
}

export const API_BASE_URL_STORAGE_KEY = 'teleGlance.apiBaseUrl'
export const G2_TELE_API_BASE_URL_STORAGE_KEY = 'g2Tele.apiBaseUrl'
export const LEGACY_API_BASE_URL_STORAGE_KEY = 'evenTelegram.apiBaseUrl'
export const BACKEND_UNREACHABLE_MESSAGE = 'Backend is not reachable. Fill Backend URL in Settings and make sure the backend server is running.'

function localApiBaseUrl() {
  if (typeof window === 'undefined') return undefined
  const value = (
    window.localStorage.getItem(API_BASE_URL_STORAGE_KEY)
    ?? window.localStorage.getItem(G2_TELE_API_BASE_URL_STORAGE_KEY)
    ?? window.localStorage.getItem(LEGACY_API_BASE_URL_STORAGE_KEY)
  )?.trim()
  if (value) return value
  try {
    const cookies = document.cookie.split(';')
    for (const cookie of cookies) {
      const eq = cookie.indexOf('=')
      if (eq === -1) continue
      const rawKey = cookie.slice(0, eq).trim()
      if (decodeURIComponent(rawKey) === API_BASE_URL_STORAGE_KEY) {
        return decodeURIComponent(cookie.slice(eq + 1).trim())
      }
    }
  } catch { /* cookies unavailable */ }
  return undefined
}

export class HttpTelegramApi implements TelegramApi {
  constructor(
    private readonly baseUrl = defaultApiBaseUrl(),
    private readonly authConfig: () => TelegramAuthConfig = () => ({}),
  ) {}

  async authStatus(): Promise<AuthStatus> {
    return this.get('/api/session/status')
  }

  async startPhoneAuth(phone: string): Promise<PhoneAuthStart> {
    return this.post('/api/session/phone/start', { phone })
  }

  async verifyPhoneAuth(phone: string, code: string): Promise<PhoneAuthStatus> {
    return this.post('/api/session/phone/verify', { phone, code })
  }

  async logout(): Promise<void> {
    await this.post('/api/session/logout')
  }

  async listChats(limit = 5): Promise<Chat[]> {
    return this.get(`/api/chats?limit=${encodeURIComponent(String(limit))}`)
  }

  async listTopics(chatId: Id): Promise<Topic[]> {
    return this.get(`/api/chats/${encodeURIComponent(String(chatId))}/topics`)
  }

  async listMessages(chatId: Id, options: { topicId?: Id; beforeId?: Id; limit?: number } = {}): Promise<Message[]> {
    const params = new URLSearchParams()
    if (options.topicId) params.set('topic_id', String(options.topicId))
    if (options.beforeId) params.set('before_id', String(options.beforeId))
    params.set('limit', String(options.limit ?? 8))
    return this.get(`/api/chats/${encodeURIComponent(String(chatId))}/messages?${params.toString()}`)
  }

  async sendMessage(chatId: Id, request: SendMessageRequest): Promise<Message> {
    const response = await this.post<SendMessageResponse>(`/api/chats/${encodeURIComponent(String(chatId))}/messages`, {
      text: request.text,
      topicId: request.topicId,
    })
    return {
      id: response.id,
      sender: 'Me',
      text: request.text,
      outgoing: true,
    }
  }

  async markRead(chatId: Id, request: MarkReadRequest): Promise<void> {
    await this.post(`/api/chats/${encodeURIComponent(String(chatId))}/read`, {
      topicId: request.topicId,
      maxId: request.maxId,
    })
  }

  async transcribe(wav: Blob): Promise<TranscriptionResult> {
    const form = new FormData()
    form.append('audio', wav, 'reply.wav')
    const sttBaseUrl = this.sttBaseUrl()
    return this.request('/api/transcribe', { method: 'POST', body: form }, sttBaseUrl, sttBaseUrl === this.baseUrl)
  }

  subscribeUpdates(onUpdate: (update: TelegramUpdate) => void, onError?: (error: Event | Error) => void) {
    if (typeof fetch === 'undefined' || typeof AbortController === 'undefined') return () => undefined
    const controller = new AbortController()
    void this.streamUpdates(controller.signal, onUpdate).catch((error) => {
      if (!controller.signal.aborted) onError?.(error instanceof Error ? error : new Error('Update stream failed'))
    })
    return () => controller.abort()
  }

  private get<T>(path: string): Promise<T> {
    return this.request(path, { method: 'GET' })
  }

  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request(path, {
      method: 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }

  private async request<T>(path: string, init: RequestInit, baseUrl = this.baseUrl, includeTelegramAuth = true): Promise<T> {
    const headers = await this.withTelegramHeaders(init.headers, includeTelegramAuth)
    const requestInit = await this.withEncryptedJsonBody(init, headers, includeTelegramAuth)
    let response: Response
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...requestInit,
        headers,
      })
    } catch (error) {
      throw new Error(BACKEND_UNREACHABLE_MESSAGE)
    }
    const text = await this.responseText(response, includeTelegramAuth)
    if (!response.ok) throw new Error(readableErrorText(response.status, text))
    return JSON.parse(text) as T
  }

  private async streamUpdates(
    signal: AbortSignal,
    onUpdate: (update: TelegramUpdate) => void,
  ) {
    const headers = await this.withTelegramHeaders(undefined, true)
    let response: Response
    try {
      response = await fetch(`${this.baseUrl}/api/updates`, {
        headers,
        signal,
      })
    } catch {
      throw new Error(BACKEND_UNREACHABLE_MESSAGE)
    }
    if (!response.ok) throw new Error(readableErrorText(response.status, await this.responseText(response, true)))
    if (!response.body) throw new Error('Update stream is unavailable')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (!signal.aborted) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''
      for (const event of events) {
        const lines = event.split('\n')
        const eventName = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() || 'message'
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (!data) continue
        const decodedData = await this.decryptEventData(data)
        if (eventName === 'message') {
          onUpdate(JSON.parse(decodedData) as TelegramUpdate)
        } else if (eventName === 'error') {
          const payload = JSON.parse(decodedData) as { detail?: string }
          throw new Error(payload.detail || 'Update stream failed')
        }
      }
    }
  }

  private async withTelegramHeaders(headers: HeadersInit | undefined, includeTelegramAuth: boolean) {
    const merged = new Headers(headers)
    if (!includeTelegramAuth) return merged
    const config = this.authConfig()
    if (!config.backendSharedSecret?.trim()) {
      throw new Error('Backend shared secret is required. Set it in TeleGlance Settings and in backend .env as TELEGLANCE_SHARED_SECRET.')
    }
    const encryptedAuth = await encryptedTelegramAuthHeader(config)
    if (!encryptedAuth) {
      throw new Error('Encrypted auth requires Backend shared secret, Telegram API ID, and Telegram API hash in TeleGlance Settings.')
    }
    merged.set('X-TeleGlance-Auth', encryptedAuth)
    return merged
  }

  private async withEncryptedJsonBody(init: RequestInit, headers: Headers, includeTelegramAuth: boolean): Promise<RequestInit> {
    const sharedSecret = this.authConfig().backendSharedSecret?.trim()
    const contentType = headers.get('Content-Type') ?? headers.get('content-type') ?? ''
    if (!includeTelegramAuth || !sharedSecret || typeof init.body !== 'string' || !contentType.startsWith('application/json')) {
      return init
    }
    const encryptedPayload = await encryptJsonPayload(init.body, sharedSecret)
    return {
      ...init,
      body: JSON.stringify({ encryptedPayload }),
    }
  }

  private async responseText(response: Response, includeTelegramAuth: boolean) {
    const text = await response.text()
    if (!includeTelegramAuth || response.headers.get('X-TeleGlance-Encrypted') !== '1') return text
    const sharedSecret = this.authConfig().backendSharedSecret?.trim()
    if (!sharedSecret) throw new Error('Backend shared secret is required to decrypt backend response.')
    const envelope = JSON.parse(text) as { encryptedPayload?: unknown }
    if (typeof envelope.encryptedPayload !== 'string') throw new Error('Encrypted backend response is malformed')
    return decryptJsonPayload(envelope.encryptedPayload, sharedSecret)
  }

  private async decryptEventData(data: string) {
    const payload = JSON.parse(data) as { encryptedPayload?: unknown }
    if (typeof payload.encryptedPayload !== 'string') return data
    const sharedSecret = this.authConfig().backendSharedSecret?.trim()
    if (!sharedSecret) throw new Error('Backend shared secret is required to decrypt update stream.')
    return decryptJsonPayload(payload.encryptedPayload, sharedSecret)
  }

  private sttBaseUrl() {
    return this.authConfig().sttBaseUrl?.trim() || this.baseUrl
  }
}

function readableErrorText(status: number, text: string) {
  if (!text) return `Request failed with ${status}`
  try {
    const payload = JSON.parse(text) as { detail?: unknown }
    if (typeof payload.detail === 'string') return payload.detail
  } catch {
    return text
  }
  return text
}
