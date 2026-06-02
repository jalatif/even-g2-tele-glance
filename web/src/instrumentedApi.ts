import type {
  AuthStatus,
  Chat,
  Id,
  MarkReadRequest,
  Message,
  PhoneAuthStart,
  PhoneAuthStatus,
  SendMessageRequest,
  TelegramUpdate,
  Topic,
  TranscriptionResult,
} from './types'
import type { TelegramApi } from './api'
import { isTeleGlanceFixtureMode, logApiEvent } from './testMode'

export class InstrumentedTelegramApi implements TelegramApi {
  constructor(private readonly inner: TelegramApi) {}

  async authStatus(): Promise<AuthStatus> {
    return this.wrap('authStatus', undefined, () => this.inner.authStatus())
  }

  async startPhoneAuth(phone: string): Promise<PhoneAuthStart> {
    return this.wrap('startPhoneAuth', { phone }, () => this.inner.startPhoneAuth(phone))
  }

  async verifyPhoneAuth(phone: string, code: string): Promise<PhoneAuthStatus> {
    return this.wrap('verifyPhoneAuth', { phone, code }, () => this.inner.verifyPhoneAuth(phone, code))
  }

  async logout(): Promise<void> {
    return this.wrap('logout', undefined, () => this.inner.logout())
  }

  async listChats(limit = 5): Promise<Chat[]> {
    return this.wrap('listChats', { limit }, () => this.inner.listChats(limit))
  }

  async listTopics(chatId: Id): Promise<Topic[]> {
    return this.wrap('listTopics', { chatId }, () => this.inner.listTopics(chatId))
  }

  async listMessages(chatId: Id, options: { topicId?: Id; beforeId?: Id; limit?: number } = {}): Promise<Message[]> {
    return this.wrap('listMessages', { chatId, options }, () => this.inner.listMessages(chatId, options))
  }

  async sendMessage(chatId: Id, request: SendMessageRequest): Promise<Message> {
    return this.wrap('sendMessage', { chatId, request }, () => this.inner.sendMessage(chatId, request))
  }

  async markRead(chatId: Id, request: MarkReadRequest): Promise<void> {
    return this.wrap('markRead', { chatId, request }, () => this.inner.markRead(chatId, request))
  }

  async transcribe(wav: Blob): Promise<TranscriptionResult> {
    return this.wrap('transcribe', { size: wav.size }, () => this.inner.transcribe(wav))
  }

  subscribeUpdates(onUpdate: (update: TelegramUpdate) => void, onError?: (error: Event | Error) => void): () => void {
    if (isTeleGlanceFixtureMode()) {
      const startedAt = Date.now()
      const unsubscribe = this.inner.subscribeUpdates(onUpdate, onError)
      logApiEvent('subscribeUpdates', undefined, startedAt, Date.now(), true)
      return () => {
        const stopAt = Date.now()
        unsubscribe()
        logApiEvent('unsubscribeUpdates', undefined, stopAt, Date.now(), true)
      }
    }
    return this.inner.subscribeUpdates(onUpdate, onError)
  }

  private async wrap<T>(call: string, args: unknown, fn: () => Promise<T>): Promise<T> {
    if (!isTeleGlanceFixtureMode()) return fn()
    const startedAt = Date.now()
    try {
      const result = await fn()
      logApiEvent(call, args, startedAt, Date.now(), true, result)
      return result
    } catch (error) {
      logApiEvent(call, args, startedAt, Date.now(), false, undefined, error)
      throw error
    }
  }
}
