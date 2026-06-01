import type { Chat, Id, Message, Topic } from '../types'

const TEXT_CONTAINER_BYTE_LIMIT = 999
const encoder = new TextEncoder()

export type AppInput =
  | { type: 'press'; index?: number }
  | { type: 'doublePress'; index?: number }
  | { type: 'swipeUp' }
  | { type: 'swipeDown' }
  | { type: 'selectIndex'; index: number }
  | { type: 'audioChunk'; pcm: Uint8Array }
  | { type: 'foreground' }

export type ScreenModel =
  | { kind: 'text'; title: string; body: string; footer?: string; qrImageUrl?: string }
  | { kind: 'list'; title: string; items: string[]; selectedIndex: number }

export type AppState =
  | { screen: 'loading'; message: string }
  | { screen: 'auth'; mode: 'signedOut' | 'qrPending'; message: string; qrToken?: string; qrUrl?: string }
  | { screen: 'chats'; chats: Chat[]; selectedIndex: number }
  | { screen: 'topics'; chat: Chat; topics: Topic[]; selectedIndex: number }
  | { screen: 'messages'; chat: Chat; topic?: Topic; messages: Message[]; cursor?: Id; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'recording'; chat: Chat; topic?: Topic; messages: Message[]; chunks: Uint8Array[]; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'transcribing'; chat: Chat; topic?: Topic; messages: Message[]; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'confirm'; chat: Chat; topic?: Topic; messages: Message[]; transcript: string; selectedIndex: number; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'sending'; chat: Chat; topic?: Topic; messages: Message[]; transcript: string; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'sent'; chat: Chat; topic?: Topic; messages: Message[]; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'error'; message: string; previous?: RecoverableState }

export type RecoverableState = Extract<
  AppState,
  { screen: 'auth' | 'chats' | 'topics' | 'messages' | 'confirm' | 'sent' }
>

export function screenModel(state: AppState): ScreenModel {
  switch (state.screen) {
    case 'loading':
      return { kind: 'text', title: 'Telegram', body: state.message }
    case 'auth':
      return {
        kind: 'text',
        title: state.mode === 'qrPending' ? 'Telegram Login' : 'Telegram',
        body: state.message,
        qrImageUrl: state.mode === 'qrPending' ? `/api/auth/qr/image?t=${encodeURIComponent(state.qrToken ?? state.qrUrl ?? '')}` : undefined,
      }
    case 'chats':
      return {
        kind: 'list',
        title: 'Chats',
        items: state.chats.map(chatLabel),
        selectedIndex: state.selectedIndex,
      }
    case 'topics':
      return {
        kind: 'list',
        title: `Topics: ${state.chat.title}`,
        items: state.topics.map(topicLabel),
        selectedIndex: state.selectedIndex,
      }
    case 'messages':
      return {
        kind: 'text',
        title: state.topic ? `Messages: ${state.topic.title}` : `Messages: ${state.chat.title}`,
        body: formatMessages(state.messages),
        footer: footerText(state.status ?? 'Checking replies...', 'Click record | Double click back'),
      }
    case 'recording':
      return {
        kind: 'text',
        title: 'Recording reply',
        body: formatMessages(state.messages),
        footer: footerText(state.status, 'Click stop | Double click cancel'),
      }
    case 'transcribing':
      return {
        kind: 'text',
        title: 'Transcribing reply',
        body: 'Converting voice reply...',
      }
    case 'confirm':
      return {
        kind: 'list',
        title: `Reply: ${state.transcript}`,
        items: ['Send', 'Cancel'],
        selectedIndex: state.selectedIndex,
      }
    case 'sending':
      return {
        kind: 'text',
        title: 'Sending reply',
        body: state.transcript,
      }
    case 'sent':
      return {
        kind: 'text',
        title: 'Reply sent',
        body: formatMessages(state.messages),
        footer: footerText(state.status ?? 'Checking replies...', 'Click record | Double click back'),
      }
    case 'error':
      return {
        kind: 'text',
        title: 'Error',
        body: `${state.message}\n\nPress to retry. Double press back.`,
      }
  }
}

function chatLabel(chat: Chat) {
  const unread = chat.unreadCount ? ` (${chat.unreadCount})` : ''
  return `${chat.title}${unread}`
}

function topicLabel(topic: Topic) {
  const unread = topic.unreadCount ? ` (${topic.unreadCount})` : ''
  return `${topic.title}${unread}`
}

function footerText(status: string | undefined, controls: string) {
  return status ? `${status} | ${controls}` : controls
}

function formatMessages(messages: Message[]) {
  if (messages.length === 0) return trimUtf8Bytes('No messages yet.', TEXT_CONTAINER_BYTE_LIMIT)

  const lines = messages.map(formatMessage)
  const selected: string[] = []
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const candidate = [lines[index], ...selected].join('\n')
    if (utf8ByteLength(candidate) <= TEXT_CONTAINER_BYTE_LIMIT) {
      selected.unshift(lines[index])
      continue
    }
    if (selected.length > 0) break

    selected.unshift(trimUtf8Bytes(lines[index], TEXT_CONTAINER_BYTE_LIMIT))
    break
  }

  return selected.join('\n')
}

function formatMessage(message: Message) {
  return `${message.outgoing ? 'Me' : message.sender || 'Unknown'}: ${message.text}`
}

function utf8ByteLength(value: string) {
  return encoder.encode(value).byteLength
}

function trimUtf8Bytes(value: string, maxBytes: number) {
  if (maxBytes <= 0) return ''
  if (utf8ByteLength(value) <= maxBytes) return value

  const suffix = '...'
  const contentLimit = Math.max(0, maxBytes - utf8ByteLength(suffix))
  let output = ''
  for (const char of value) {
    const candidate = output + char
    if (utf8ByteLength(candidate) > contentLimit) break
    output = candidate
  }
  return `${output}${suffix}`
}
