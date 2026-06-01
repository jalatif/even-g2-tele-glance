import type {
  AuthStatus,
  Chat,
  Id,
  Message,
  QrAuthStart,
  QrAuthStatus,
  SendMessageRequest,
  SendMessageResponse,
  Topic,
  TranscriptionResult,
} from './types'

export interface TelegramApi {
  authStatus(): Promise<AuthStatus>
  startQrAuth(): Promise<QrAuthStart>
  qrAuthStatus(): Promise<QrAuthStatus>
  listChats(limit?: number): Promise<Chat[]>
  listTopics(chatId: Id): Promise<Topic[]>
  listMessages(chatId: Id, options?: { topicId?: Id; beforeId?: Id; limit?: number }): Promise<Message[]>
  sendMessage(chatId: Id, request: SendMessageRequest): Promise<Message>
  transcribe(wav: Blob): Promise<TranscriptionResult>
}

export function defaultApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? runtimeTailscaleApiBaseUrl() ?? 'http://localhost:8787'
}

function runtimeTailscaleApiBaseUrl() {
  if (typeof window === 'undefined') return undefined
  const hostname = window.location.hostname
  if (!isTailscaleIpv4(hostname)) return undefined
  return `http://${hostname}:8787`
}

function isTailscaleIpv4(hostname: string) {
  const parts = hostname.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

export class HttpTelegramApi implements TelegramApi {
  constructor(private readonly baseUrl = defaultApiBaseUrl()) {}

  async authStatus(): Promise<AuthStatus> {
    return this.get('/api/auth/status')
  }

  async startQrAuth(): Promise<QrAuthStart> {
    return this.post('/api/auth/qr/start')
  }

  async qrAuthStatus(): Promise<QrAuthStatus> {
    return this.get('/api/auth/qr/status')
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

  async transcribe(wav: Blob): Promise<TranscriptionResult> {
    const form = new FormData()
    form.append('audio', wav, 'reply.wav')
    return this.request('/api/transcribe', { method: 'POST', body: form })
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

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, init)
    if (!response.ok) {
      throw new Error(await readableError(response))
    }
    return response.json() as Promise<T>
  }
}

async function readableError(response: Response) {
  const text = await response.text().catch(() => '')
  if (!text) return `Request failed with ${response.status}`
  try {
    const payload = JSON.parse(text) as { detail?: unknown }
    if (typeof payload.detail === 'string') return payload.detail
  } catch {
    return text
  }
  return text
}
