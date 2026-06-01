import type { Chat, Id, Message, Topic } from '../types'

const TEXT_CONTAINER_BYTE_LIMIT = 999
const MESSAGE_ROW_BYTE_LIMIT = 120
const MESSAGE_ROW_CHAR_LIMIT = 44
const MESSAGE_VISIBLE_ROW_LIMIT = 8
const MESSAGE_BOX_WIDTH = 42
const MESSAGE_BOX_CONTENT_WIDTH = MESSAGE_BOX_WIDTH - 4
const MESSAGE_BOX_CONTENT_ROWS = MESSAGE_VISIBLE_ROW_LIMIT - 4
const MESSAGE_BOX_PAD = '\u00a0'
const MESSAGE_BOX_WORD_THRESHOLD = 25
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
  | { kind: 'text'; title: string; body: string; footer?: string; box?: BoxedText }
  | { kind: 'list'; title: string; items: string[]; selectedIndex: number }

export type BoxedText = {
  heading: string
  content: string
}

export type AppState =
  | { screen: 'loading'; message: string }
  | { screen: 'auth'; mode: 'needsSetup' | 'signedOut' | 'phonePending'; message: string; phone?: string }
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
        title: state.mode === 'phonePending' ? 'Telegram Login' : 'Telegram',
        body: state.message,
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
        body: sanitizeGlassesText(`${state.topic ? `${state.chat.title} / ${state.topic.title}` : state.chat.title}\n\n${state.message || 'New message'}\n\nClick to open.`),
        footer: 'Double click dismiss',
      }
    case 'topics':
      return {
        kind: 'list',
        title: sanitizeGlassesText(`Topics: ${state.chat.title}`),
        items: state.topics.map(topicLabel),
        selectedIndex: state.selectedIndex,
      }
    case 'messages':
      return {
        kind: 'text',
        title: sanitizeGlassesText(state.topic ? `Messages: ${state.topic.title}` : `Messages: ${state.chat.title}`),
        ...formatMessages(state.messages, state.scrollOffset ?? 0),
        footer: footerText(state.status, 'Click record | Double click back'),
      }
    case 'recording':
      return {
        kind: 'text',
        title: 'Recording reply',
        ...formatMessages(state.messages, state.scrollOffset ?? 0),
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
        title: sanitizeGlassesText(`Reply: ${state.transcript}`),
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
        ...formatMessages(state.messages, state.scrollOffset ?? 0),
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
  return sanitizeGlassesText(`${chat.title}${unread}`)
}

function topicLabel(topic: Topic) {
  const unread = topic.unreadCount ? ` (${topic.unreadCount})` : ''
  return sanitizeGlassesText(`${topic.title}${unread}`)
}

function footerText(status: string | undefined, controls: string) {
  return sanitizeGlassesText(status ? `${status} | ${controls}` : controls)
}

function formatMessages(messages: Message[], scrollOffset = 0) {
  if (messages.length === 0) return { body: trimUtf8Bytes('No messages yet.', TEXT_CONTAINER_BYTE_LIMIT) }

  const pages = messageDisplayPages(messages)
  const pageIndex = Math.max(0, Math.min(pages.length - 1, pages.length - 1 - scrollOffset))
  return pages[pageIndex]
}

export function messageScrollUnitCount(messages: Message[]) {
  return messageDisplayPages(messages).length
}

function messageDisplayPages(messages: Message[]): MessageDisplayPage[] {
  const blocks = messageDisplayBlocks(messages)
  const pages: MessageDisplayPage[] = []
  let endExclusive = blocks.length

  while (endExclusive > 0) {
    const selected: MessageDisplayBlock[] = []
    let start = endExclusive

    for (let index = endExclusive - 1; index >= 0; index -= 1) {
      const block = blocks[index]
      if (block.box) {
        if (selected.length === 0) {
          selected.unshift(block)
          start = index
        }
        break
      }

      const candidate = [block, ...selected]
      if (lineCount(candidate) > MESSAGE_VISIBLE_ROW_LIMIT) break
      if (utf8ByteLength(candidate.map((item) => item.text).join('\n')) > TEXT_CONTAINER_BYTE_LIMIT) break

      selected.unshift(block)
      start = index
    }

    if (selected.length === 0) {
      selected.unshift({ text: trimUtf8Bytes(blocks[endExclusive - 1].text, TEXT_CONTAINER_BYTE_LIMIT) })
      start = endExclusive - 1
    }

    pages.unshift(formatPage(selected))
    endExclusive = start
  }

  return pages
}

type MessageDisplayPage = {
  body: string
  box?: BoxedText
}

function messageDisplayBlocks(messages: Message[]): MessageDisplayBlock[] {
  const blocks: MessageDisplayBlock[] = []
  for (let i = 0; i < messages.length; i++) {
    if (i > 0) blocks.push({ text: '', gap: true })
    blocks.push(...formatMessageBlocks(messages[i]))
  }
  return blocks
}

type MessageDisplayBlock = {
  text: string
  box?: BoxedText
  gap?: true
}

function formatMessageBlocks(message: Message): MessageDisplayBlock[] {
  const sender = sanitizeGlassesText(message.outgoing ? 'Me' : message.sender || 'Unknown')
  const text = sanitizeGlassesText(message.text || '')
  if (wordCount(text) > MESSAGE_BOX_WORD_THRESHOLD) return formatMessageBox(sender, text)

  return [{ text: formatCompactMessageRows(sender, text).join('\n') }]
}

function formatCompactMessageRows(sender: string, text: string) {
  const firstPrefix = `${sender}: `
  const firstRows = splitDisplayWordRows(
    text,
    Math.max(1, MESSAGE_ROW_CHAR_LIMIT - firstPrefix.length),
    Math.max(1, MESSAGE_ROW_BYTE_LIMIT - utf8ByteLength(firstPrefix)),
  )
  const [firstRow = '', ...rest] = firstRows
  const rows = [`${firstPrefix}${firstRow}`]
  for (const row of rest) {
    rows.push(...splitDisplayWordRows(row, MESSAGE_ROW_CHAR_LIMIT - 2, MESSAGE_ROW_BYTE_LIMIT - 2).map((part) => `  ${part}`))
  }
  return rows
}

function formatMessageBox(sender: string, text: string): MessageDisplayBlock[] {
  const topBorder = `+${'-'.repeat(MESSAGE_BOX_WIDTH - 2)}+`
  const midBorder = `+${'-'.repeat(MESSAGE_BOX_WIDTH - 2)}+`
  const bottomBorder = `+${'-'.repeat(MESSAGE_BOX_WIDTH - 2)}+`
  const rows = splitBoxRows(text)
  const pages: MessageDisplayBlock[] = []
  for (let index = 0; index < rows.length; index += MESSAGE_BOX_CONTENT_ROWS) {
    const pageRows = rows.slice(index, index + MESSAGE_BOX_CONTENT_ROWS)
    const pageNumber = rows.length > MESSAGE_BOX_CONTENT_ROWS ? ` ${Math.floor(index / MESSAGE_BOX_CONTENT_ROWS) + 1}/${Math.ceil(rows.length / MESSAGE_BOX_CONTENT_ROWS)}` : ''
    const heading = trimBoxText(`${sender}${pageNumber}`)
    const content = pageRows.join(' ')
    pages.push({
      text: [
        topBorder,
        boxLine(heading),
        midBorder,
        ...pageRows.map((row) => boxLine(row)),
        bottomBorder,
      ].join('\n'),
      box: {
        heading,
        content,
      },
    })
  }
  return pages
}

function sanitizeGlassesText(value: string) {
  return value
    .replace(/\u{1f534}/gu, '[red]')
    .replace(/\u{1f7e1}/gu, '[yellow]')
    .replace(/\u{1f7e2}/gu, '[green]')
    .replace(/\ufe0f/g, '')
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
  return splitDisplayWordRows(value, MESSAGE_BOX_CONTENT_WIDTH, MESSAGE_ROW_BYTE_LIMIT).map(trimBoxText)
}

function lineCount(blocks: MessageDisplayBlock[]) {
  return blocks.reduce((total, block) => total + (block.gap ? 0 : block.text.split('\n').length), 0)
}

function wordCount(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length
}

function formatPage(blocks: MessageDisplayBlock[]): MessageDisplayPage {
  const content = blocks.filter((block, i) => {
    if (!block.gap) return true
    return i > 0 && i < blocks.length - 1
  })
  return {
    body: content.map((block) => block.text).join('\n'),
    box: content.length === 1 ? content[0].box : undefined,
  }
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

function splitDisplayWordRows(value: string, maxChars: number, maxBytes: number) {
  const words = value.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const rows: string[] = []
  let row = ''
  for (const word of words) {
    if (row.length === 0) {
      if (word.length <= maxChars && utf8ByteLength(word) <= maxBytes) {
        row = word
      } else {
        const chunks = splitDisplayRows(word, '', maxChars, maxBytes)
        rows.push(...chunks.slice(0, -1))
        row = chunks[chunks.length - 1] ?? ''
      }
      continue
    }

    const candidate = `${row} ${word}`
    if (candidate.length <= maxChars && utf8ByteLength(candidate) <= maxBytes) {
      row = candidate
      continue
    }
    rows.push(row)
    if (word.length <= maxChars && utf8ByteLength(word) <= maxBytes) {
      row = word
    } else {
      const chunks = splitDisplayRows(word, '', maxChars, maxBytes)
      rows.push(...chunks.slice(0, -1))
      row = chunks[chunks.length - 1] ?? ''
    }
  }
  if (row.length > 0) rows.push(row)
  return rows
}
