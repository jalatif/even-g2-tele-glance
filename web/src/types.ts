export type Id = string | number

export type AuthStatus = {
  configured?: boolean
  authorized: boolean
  qrLoginAvailable?: boolean
}

export type QrAuthStart = {
  token: string
  url?: string
  expiresAt?: string
}

export type QrAuthStatus = {
  authorized: boolean
  expired?: boolean
  message?: string | null
}

export type Chat = {
  id: Id
  title: string
  kind: 'user' | 'group' | 'channel'
  unreadCount?: number
  isForum?: boolean
  lastMessage?: string | null
}

export type Topic = {
  id: Id
  title: string
  topMessageId?: Id
  unreadCount?: number
}

export type Message = {
  id: Id
  sender?: string | null
  text: string
  sentAt?: string | null
  outgoing?: boolean
}

export type TelegramUpdate = {
  type: 'message'
  chatId: Id
  topicId?: Id | null
  message: Message
}

export type SendMessageRequest = {
  text: string
  topicId?: Id
}

export type SendMessageResponse = {
  id: Id
  status: 'sent'
}

export type TranscriptionResult = {
  text: string
}
