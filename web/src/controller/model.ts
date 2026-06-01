import type { Chat, Id, Message, Topic } from '../types'

const TEXT_CONTAINER_BYTE_LIMIT = 999
const MESSAGE_ROW_BYTE_LIMIT = 120
const MESSAGE_ROW_CHAR_LIMIT = 44
const MESSAGE_VISIBLE_ROW_LIMIT = 8
const MESSAGE_BOX_WIDTH = 30
const MESSAGE_BOX_CONTENT_WIDTH = MESSAGE_BOX_WIDTH - 4
const MESSAGE_BOX_CONTENT_ROWS = MESSAGE_VISIBLE_ROW_LIMIT - 4
const MESSAGE_BOX_PAD = '\u00a0'
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
  | { screen: 'asleep'; chats: Chat[]; selectedIndex: number }
  | { screen: 'newMessage'; chat: Chat; topic?: Topic; message: string; chats: Chat[]; selectedIndex: number }
  | { screen: 'topics'; chat: Chat; topics: Topic[]; selectedIndex: number }
  | { screen: 'messages'; chat: Chat; topic?: Topic; messages: Message[]; cursor?: Id; scrollOffset?: number; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'recording'; chat: Chat; topic?: Topic; messages: Message[]; chunks: Uint8Array[]; startedAt: number; scrollOffset?: number; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'transcribing'; chat: Chat; topic?: Topic; messages: Message[]; scrollOffset?: number; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'confirm'; chat: Chat; topic?: Topic; messages: Message[]; transcript: string; selectedIndex: number; scrollOffset?: number; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'sending'; chat: Chat; topic?: Topic; messages: Message[]; transcript: string; scrollOffset?: number; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'sent'; chat: Chat; topic?: Topic; messages: Message[]; scrollOffset?: number; back?: RecoverableState; status?: string; newerPages?: Message[][]; isNewestPage?: boolean }
  | { screen: 'error'; message: string; previous?: RecoverableState }

export type RecoverableState = Extract<
  AppState,
  { screen: 'auth' | 'chats' | 'asleep' | 'newMessage' | 'topics' | 'messages' | 'confirm' | 'sent' }
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
    case 'asleep':
      return {
        kind: 'text',
        title: '',
        body: '',
      }
    case 'newMessage':
      return {
        kind: 'text',
        title: 'New Telegram',
        body: `${state.topic ? `${state.chat.title} / ${state.topic.title}` : state.chat.title}\n\n${state.message || 'New message'}\n\nClick to open.`,
        footer: 'Double click dismiss',
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
        body: formatMessages(state.messages, state.scrollOffset ?? 0),
        footer: footerText(state.status, 'Click record | Double click back'),
      }
    case 'recording':
      return {
        kind: 'text',
        title: 'Recording reply',
        body: formatMessages(state.messages, state.scrollOffset ?? 0),
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
        body: formatMessages(state.messages, state.scrollOffset ?? 0),
        footer: footerText(state.status, 'Click record | Double click back'),
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

function formatMessages(messages: Message[], scrollOffset = 0) {
  if (messages.length === 0) return trimUtf8Bytes('No messages yet.', TEXT_CONTAINER_BYTE_LIMIT)

  const blocks = messageDisplayBlocks(messages)
  const endExclusive = Math.max(1, Math.min(blocks.length, blocks.length - scrollOffset))
  const selected: string[] = []
  for (let index = endExclusive - 1; index >= 0; index -= 1) {
    if (lineCount(selected) >= MESSAGE_VISIBLE_ROW_LIMIT) break
    const candidate = [blocks[index], ...selected].join('\n')
    if (lineCount([blocks[index], ...selected]) > MESSAGE_VISIBLE_ROW_LIMIT) break
    if (utf8ByteLength(candidate) <= TEXT_CONTAINER_BYTE_LIMIT) {
      selected.unshift(blocks[index])
      continue
    }
    if (selected.length > 0) break

    selected.unshift(trimUtf8Bytes(blocks[index], TEXT_CONTAINER_BYTE_LIMIT))
    break
  }

  return selected.join('\n')
}

export function messageScrollUnitCount(messages: Message[]) {
  return messageDisplayBlocks(messages).length
}

function messageDisplayBlocks(messages: Message[]) {
  return messages.flatMap(formatMessageBlocks)
}

function formatMessageBlocks(message: Message) {
  const sender = message.outgoing ? 'Me' : message.sender || 'Unknown'
  const text = message.text || ''
  if (wordCount(text) > 10) return formatMessageBox(sender, text)

  const rows = splitDisplayRows(`${sender}: ${text}`, '')
  return rows.map((row, index) => index === 0 ? row : `  ${row}`)
}

function formatMessageBox(sender: string, text: string) {
  const topBorder = `+${'-'.repeat(MESSAGE_BOX_WIDTH - 2)}+`
  const midBorder = `+${'-'.repeat(MESSAGE_BOX_WIDTH - 2)}+`
  const bottomBorder = `+${'-'.repeat(MESSAGE_BOX_WIDTH - 2)}+`
  const rows = splitBoxRows(text)
  const pages: string[] = []
  for (let index = 0; index < rows.length; index += MESSAGE_BOX_CONTENT_ROWS) {
    const pageRows = rows.slice(index, index + MESSAGE_BOX_CONTENT_ROWS)
    const pageNumber = rows.length > MESSAGE_BOX_CONTENT_ROWS ? ` ${Math.floor(index / MESSAGE_BOX_CONTENT_ROWS) + 1}/${Math.ceil(rows.length / MESSAGE_BOX_CONTENT_ROWS)}` : ''
    pages.push([
      topBorder,
      boxLine(trimBoxText(`${sender}${pageNumber}`)),
      midBorder,
      ...pageRows.map((row) => boxLine(row)),
      bottomBorder,
    ].join('\n'))
  }
  return pages
}

function boxLine(value: string) {
  const padding = MESSAGE_BOX_PAD.repeat(Math.max(0, MESSAGE_BOX_CONTENT_WIDTH - value.length))
  return `| ${value}${padding} |`
}

function trimBoxText(value: string) {
  if (value.length <= MESSAGE_BOX_CONTENT_WIDTH) return value
  return `${value.slice(0, MESSAGE_BOX_CONTENT_WIDTH - 3)}...`
}

function splitBoxRows(value: string) {
  return splitDisplayRows(value, '', MESSAGE_BOX_CONTENT_WIDTH, MESSAGE_ROW_BYTE_LIMIT).map(trimBoxText)
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function lineCount(blocks: string[]) {
  return blocks.reduce((total, block) => total + block.split('\n').length, 0)
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

function splitDisplayRows(value: string, prefix: string, maxChars = MESSAGE_ROW_CHAR_LIMIT, maxBytes = MESSAGE_ROW_BYTE_LIMIT) {
  if (value.length === 0) return ['']
  const chunks: string[] = []
  let chunk = ''
  const byteLimit = Math.max(1, maxBytes - utf8ByteLength(prefix))
  const charLimit = Math.max(1, maxChars - prefix.length)
  for (const char of value) {
    const candidate = chunk + char
    if (chunk.length > 0 && (candidate.length > charLimit || utf8ByteLength(candidate) > byteLimit)) {
      chunks.push(chunk)
      chunk = char
      continue
    }
    chunk = candidate
  }
  if (chunk.length > 0) chunks.push(chunk)
  return chunks
}
