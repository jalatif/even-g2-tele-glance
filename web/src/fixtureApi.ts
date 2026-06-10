import type { TelegramApi } from './api'
import type { Chat, Id, Message, Topic, TelegramUpdate, TranscriptionResult } from './types'
import { getFixtureTestOverrides } from './testMode'

const fixtureChats: Chat[] = [
  {
    id: 'fixture-chat-0',
    title: 'Fixture Alpha',
    kind: 'user',
    lastMessage: 'Alpha preview baseline for startup selection.',
  },
  {
    id: 'fixture-chat-1',
    title: 'Fixture Forum',
    kind: 'group',
    isForum: true,
    unreadCount: 3,
    lastMessage: 'Forum preview: topic content is available.',
  },
  {
    id: 'fixture-chat-2',
    title: 'Fixture Ops',
    kind: 'group',
    lastMessage: 'Ops preview: deployment status green.',
  },
  {
    id: 'fixture-chat-3',
    title: 'Fixture Research',
    kind: 'channel',
    lastMessage: 'Research preview: visual validation sample.',
  },
  {
    id: 'fixture-chat-4',
    title: 'Fixture Archive',
    kind: 'group',
    lastMessage: 'Archive preview: older test data.',
  },
]

const fixtureTopics: Topic[] = [
  {
    id: 'fixture-topic-0',
    title: 'Fixture Topic Zero',
    topMessageId: 'fixture-topic-0-top',
    lastMessage: 'Topic zero warmup preview.',
  },
  {
    id: 'fixture-topic-1',
    title: 'Fixture Topic One',
    topMessageId: 'fixture-topic-1-top',
    unreadCount: 1,
    lastMessage: 'Topic one expected content preview.',
  },
  {
    id: 'fixture-topic-2',
    title: 'Fixture Topic Two',
    topMessageId: 'fixture-topic-2-top',
    unreadCount: 1,
    lastMessage: 'Topic two expected content preview.',
  },
  {
    id: 'fixture-topic-3',
    title: 'Fixture Topic Three',
    topMessageId: 'fixture-topic-3-top',
    unreadCount: 1,
    lastMessage: 'Topic three expected content preview.',
  },
  {
    id: 'fixture-topic-4',
    title: 'Fixture Topic Four',
    topMessageId: 'fixture-topic-4-top',
    lastMessage: 'Topic four expected content preview.',
  },
  {
    id: 'fixture-topic-5',
    title: 'Fixture Topic Five',
    topMessageId: 'fixture-topic-5-top',
    lastMessage: 'Topic five expected content preview.',
  },
  {
    id: 'fixture-topic-6',
    title: 'Fixture Topic Six',
    topMessageId: 'fixture-topic-6-top',
    lastMessage: 'Topic six expected content preview.',
  },
  // Anchor strings used by the simulator-driven scroll test
  // (scripts/simulator-topic-scroll.mjs). Each message in the
  // three new topics embeds its index in the body so the harness
  // can assert "I saw message N of topic T" without parsing the
  // structure of the controller's `state.messages` array.
]

const LONG_ALPHA_BODY = [
  'This is a deliberately long fixture message that is intended to exercise the long-message rendering pipeline including word wrapping, multi-line layout, and the page-byte-limit trim path. It is well past the fifty-word boundary so the harness can confirm the text container and panelBox branches handle overflow correctly. The harness must verify that the visible substring is preserved even when the total byte length exceeds the SDK cap. fixture-long-alpha-body-anchor appears near the end so the matcher has a unique string to look for. End of long message.',
].join(' ')

const LONG_TOPIC_BODY = [
  'Fixture topic long message body is intended to validate the box rendering path on real G2 hardware and the simulator. It contains more than fifty words on purpose, exercises the trimForContainer and formatBoxContent helpers, and includes the unique anchor fixture-long-topic-body-anchor so the harness can confirm the box did not silently drop text past the 999-byte cap. The catalog asserts that the heading and content both contain this anchor, and that the visible substring of the first line is preserved.',
].join(' ')

const messagePages = new Map<string, Message[]>([
  [threadKey('fixture-chat-0'), [
    msg(10, 'Fixture Alpha', 'Alpha message page contains fixture-alpha-body for startup testing.'),
    msg(11, 'Me', 'Alpha outgoing marker for visual validation.', true),
  ]],
  [threadKey('fixture-chat-2'), [
    msg(20, 'Fixture Ops', 'Ops message page contains fixture-ops-body for chat index two.'),
    msg(21, 'SRE', 'Ops latency sample message should remain readable.'),
  ]],
  [threadKey('fixture-chat-3'), [
    msg(30, 'Fixture Research', 'Research message page contains fixture-research-body for chat index three.'),
    msg(31, 'Analyst', 'Research sample confirms normal chat rendering.'),
  ]],
  [threadKey('fixture-chat-4'), [
    msg(40, 'Fixture Long', LONG_ALPHA_BODY),
    msg(41, 'Fixture Long', 'Short follow-up so pagination logic can detect an older page boundary below.'),
  ]],
  [threadKey('fixture-chat-1', 'fixture-topic-0'), [
    msg(100, 'Forum Bot', 'Topic zero warmup body appears before indexed topic validation.'),
  ]],
  [threadKey('fixture-chat-1', 'fixture-topic-1'), [
    msg(110, 'Topic One', 'Fixture topic one message body includes fixture-topic-one-body.'),
    msg(111, 'Reviewer', 'Topic one second message validates scrolling without reset.'),
  ]],
  [threadKey('fixture-chat-1', 'fixture-topic-2'), [
    msg(120, 'Topic Two', 'Fixture topic two message body includes fixture-topic-two-body.'),
    msg(121, 'Reviewer', 'Topic two second message validates rendering distinct content.'),
  ]],
  [threadKey('fixture-chat-1', 'fixture-topic-3'), [
    msg(130, 'Topic Three', LONG_TOPIC_BODY),
    msg(131, 'Reviewer', 'Topic three second message validates double-click back.'),
  ]],
  // simulator-driven scroll test
  // (`scripts/simulator-topic-scroll.mjs`) opens each topic
  // and exhaustively swipes to confirm every message renders.
  // The initial listMessages call returns 8 messages (the
  // controller's `MESSAGE_PAGE_LIMIT`); the remaining 4 require
  // the user to swipe up to trigger `loadOlderMessages`.
  // Each message body embeds a unique anchor of the form
  // `topic-N-m<M>` so the harness can assert "I saw message M
  // of topic N" without parsing `state.messages`.
  [threadKey('fixture-chat-1', 'fixture-topic-4'), [
    msg(140, 'Topic Four', 'topic-4-m1: First message of topic four.'),
    msg(141, 'Topic Four', 'topic-4-m2: Second message of topic four.'),
    msg(142, 'Topic Four', 'topic-4-m3: Third message of topic four.'),
    msg(143, 'Topic Four', 'topic-4-m4: Fourth message of topic four.'),
    msg(144, 'Topic Four', 'topic-4-m5: Fifth message of topic four.'),
    msg(145, 'Topic Four', 'topic-4-m6: Sixth message of topic four.'),
    msg(146, 'Topic Four', 'topic-4-m7: Seventh message of topic four.'),
    msg(147, 'Topic Four', 'topic-4-m8: Eighth message of topic four.'),
    msg(148, 'Topic Four', 'topic-4-m9: Ninth message of topic four.'),
    msg(149, 'Topic Four', 'topic-4-m10: Tenth message of topic four.'),
    msg(14, 'Topic Four', 'topic-4-m11: Eleventh message of topic four.'),
    msg(15, 'Topic Four', 'topic-4-m12: Twelfth message of topic four.'),
  ]],
  [threadKey('fixture-chat-1', 'fixture-topic-5'), [
    msg(150, 'Topic Five', 'topic-5-m1: First message of topic five.'),
    msg(151, 'Topic Five', 'topic-5-m2: Second message of topic five.'),
    msg(152, 'Topic Five', 'topic-5-m3: Third message of topic five.'),
    msg(153, 'Topic Five', 'topic-5-m4: Fourth message of topic five.'),
    msg(154, 'Topic Five', 'topic-5-m5: Fifth message of topic five.'),
    msg(155, 'Topic Five', 'topic-5-m6: Sixth message of topic five.'),
    msg(156, 'Topic Five', 'topic-5-m7: Seventh message of topic five.'),
    msg(157, 'Topic Five', 'topic-5-m8: Eighth message of topic five.'),
    msg(158, 'Topic Five', 'topic-5-m9: Ninth message of topic five.'),
    msg(159, 'Topic Five', 'topic-5-m10: Tenth message of topic five.'),
    msg(25, 'Topic Five', 'topic-5-m11: Eleventh message of topic five.'),
    msg(26, 'Topic Five', 'topic-5-m12: Twelfth message of topic five.'),
  ]],
  [threadKey('fixture-chat-1', 'fixture-topic-6'), [
    msg(160, 'Topic Six', 'topic-6-m1: First message of topic six.'),
    msg(161, 'Topic Six', 'topic-6-m2: Second message of topic six.'),
    msg(162, 'Topic Six', 'topic-6-m3: Third message of topic six.'),
    msg(163, 'Topic Six', 'topic-6-m4: Fourth message of topic six.'),
    msg(164, 'Topic Six', 'topic-6-m5: Fifth message of topic six.'),
    msg(165, 'Topic Six', 'topic-6-m6: Sixth message of topic six.'),
    msg(166, 'Topic Six', 'topic-6-m7: Seventh message of topic six.'),
    msg(167, 'Topic Six', 'topic-6-m8: Eighth message of topic six.'),
    msg(168, 'Topic Six', 'topic-6-m9: Ninth message of topic six.'),
    msg(169, 'Topic Six', 'topic-6-m10: Tenth message of topic six.'),
    msg(36, 'Topic Six', 'topic-6-m11: Eleventh message of topic six.'),
    msg(37, 'Topic Six', 'topic-6-m12: Twelfth message of topic six.'),
  ]],
])

export interface FixtureSentMessage {
  chatId: Id
  text: string
  topicId: Id | null
  sentAt: number
}

export class FixtureTelegramApi implements TelegramApi {
  private nextTranscript: string | null = null
  private sent: FixtureSentMessage[] = []
  private mode: 'normal' | 'missing' | 'signedOut' | 'error' | 'slow' = 'normal'
  private slowChatsMs = 0
  private subscribers = new Set<(update: TelegramUpdate) => void>()
  private injectedNotification: { chatId: Id; message: string; topicId?: Id | null } | null = null
  private chatOverrides = new Map<string, Partial<Chat>>()

  setMode(mode: 'normal' | 'missing' | 'signedOut' | 'error' | 'slow') {
    this.mode = mode
  }

  setSlowChats(ms: number) {
    this.slowChatsMs = ms
  }

  setNextTranscript(transcript: string | null) {
    this.nextTranscript = transcript
  }

  readSent(): FixtureSentMessage[] {
    return [...this.sent]
  }

  setInjectedNotification(value: { chatId: Id; message: string; topicId?: Id | null } | null) {
    this.injectedNotification = value
    if (!value || this.subscribers.size === 0) return
    const key = String(value.chatId)
    const current = fixtureChats.find((chat) => String(chat.id) === key)
    this.chatOverrides.set(key, {
      lastMessage: value.message,
      unreadCount: Math.max(1, Number(current?.unreadCount ?? 0) + 1),
    })
    this.injectedNotification = null
    const update: TelegramUpdate = {
      type: 'message',
      chatId: value.chatId,
      topicId: value.topicId ?? null,
      message: msg(Date.now(), 'Fixture Notifier', value.message, false),
    }
    for (const subscriber of this.subscribers) Promise.resolve().then(() => subscriber(update))
  }

  async authStatus() {
    if (this.mode === 'missing') return { configured: false, authorized: false }
    if (this.mode === 'signedOut') return { configured: true, authorized: false }
    if (this.mode === 'error') throw new Error('Fixture auth status error')
    return { configured: true, authorized: true }
  }

  async startPhoneAuth(phone: string) {
    return { phone, sent: true, message: 'Fixture login bypassed.' }
  }

  async verifyPhoneAuth() {
    return { authorized: true, sessionString: 'fixture-session' }
  }

  async logout() {
    return undefined
  }

  async listChats(limit = 20) {
    if (this.slowChatsMs > 0) await fixtureDelay(this.slowChatsMs)
    else await fixtureDelay(40)
    return fixtureChats.slice(0, limit).map((chat) => ({ ...chat, ...(this.chatOverrides.get(String(chat.id)) ?? {}) }))
  }

  async listTopics(chatId: Id) {
    await fixtureDelay(60)
    if (String(chatId) !== 'fixture-chat-1') return []
    return fixtureTopics.map((topic) => ({ ...topic }))
  }

  async listMessages(chatId: Id, options: { topicId?: Id; beforeId?: Id; limit?: number } = {}) {
    await fixtureDelay(80)
    if (options.beforeId !== undefined) {
      const before = Number(options.beforeId)
      return [
        msg(before - 2, 'Older Fixture', `Older fixture page before ${String(options.beforeId)}.`),
        msg(before - 1, 'Older Fixture', 'Older fixture content validates up-scroll loading.'),
      ].slice(0, options.limit ?? 50)
    }
    const messages = messagePages.get(threadKey(chatId, options.topicId)) ?? [
      msg(900, 'Fixture', `Fallback fixture message for ${String(chatId)}.`),
    ]
    return messages.slice(0, options.limit ?? 50).map((message) => ({ ...message }))
  }

  async sendMessage(chatId: Id, request: { text: string; topicId?: Id }) {
    if (this.mode === 'error') throw new Error('Fixture send error')
    const recorded: FixtureSentMessage = {
      chatId,
      text: request.text,
      topicId: request.topicId ?? null,
      sentAt: Date.now(),
    }
    this.sent.push(recorded)
    return msg(Date.now(), 'Me', request.text, true)
  }

  async markRead() {
    return undefined
  }

  async transcribe(): Promise<TranscriptionResult> {
    await fixtureDelay(20)
    if (this.nextTranscript !== null) {
      const text = this.nextTranscript
      this.nextTranscript = null
      return { text }
    }
    return { text: 'Fixture transcript' }
  }

  subscribeUpdates(onUpdate: (update: TelegramUpdate) => void) {
    this.subscribers.add(onUpdate)
    if (this.injectedNotification) {
      const injected = this.injectedNotification
      this.injectedNotification = null
      Promise.resolve().then(() => {
        onUpdate({
          type: 'message',
          chatId: injected.chatId,
          topicId: injected.topicId ?? null,
          message: msg(Date.now(), 'Fixture Notifier', injected.message, false),
        })
      })
    }
    return () => {
      this.subscribers.delete(onUpdate)
    }
  }
}

function threadKey(chatId: Id, topicId?: Id) {
  return topicId === undefined ? String(chatId) : `${String(chatId)}:${String(topicId)}`
}

function msg(id: Id, sender: string, text: string, outgoing = false): Message {
  return {
    id,
    sender,
    text,
    outgoing,
    sentAt: '2026-06-01T20:00:00Z',
  }
}

function fixtureDelay(ms: number) {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

let activeFixture: FixtureTelegramApi | null = null

export function bindFixtureApi(api: FixtureTelegramApi) {
  activeFixture = api
  const overrides = getFixtureTestOverrides()
  if (overrides.missingCredentials || overrides.signedOut || overrides.errorOnAuthStatus || overrides.slowChats) {
    if (overrides.missingCredentials) api.setMode('missing')
    else if (overrides.signedOut) api.setMode('signedOut')
    else if (overrides.errorOnAuthStatus) api.setMode('error')
    else if (overrides.slowChats) api.setMode('slow')
  }
  if (overrides.chatDelayMs > 0) api.setSlowChats(overrides.chatDelayMs)
  if (overrides.nextTranscript) api.setNextTranscript(overrides.nextTranscript)
  if (overrides.injectedNotification) api.setInjectedNotification(overrides.injectedNotification)
  startCommandPolling(api)
  if (typeof window !== 'undefined') {
    const debug = {
      setMode: (mode: 'normal' | 'missing' | 'signedOut' | 'error' | 'slow') => api.setMode(mode),
      setSlowChats: (ms: number) => api.setSlowChats(ms),
      setNextTranscript: (transcript: string | null) => api.setNextTranscript(transcript),
      setInjectedNotification: (value: { chatId: Id; message: string; topicId?: Id | null } | null) => api.setInjectedNotification(value),
      readSent: () => api.readSent(),
      getState: () => 'available' as const,
    }
    ;(window as unknown as { __teleGlanceFixture?: unknown }).__teleGlanceFixture = debug
  }
}

let commandPollTimer: ReturnType<typeof setInterval> | undefined
let injectedAudioChunks: Uint8Array[] = []
let fixtureCommandHandler: ((command: { kind: string } & Record<string, unknown>) => void | Promise<void>) | undefined

export function bindFixtureCommandHandler(
  handler: (command: { kind: string } & Record<string, unknown>) => void | Promise<void>,
) {
  fixtureCommandHandler = handler
  return () => {
    if (fixtureCommandHandler === handler) fixtureCommandHandler = undefined
  }
}

function startCommandPolling(api: FixtureTelegramApi) {
  if (commandPollTimer) return
  commandPollTimer = setInterval(async () => {
    try {
      const response = await fetch('/api/test/fixture-commands')
      if (!response.ok) return
      const data = await response.json() as { commands: Array<{ kind: string } & Record<string, unknown>> }
      if (!data.commands?.length) return
      for (const cmd of data.commands) {
        switch (cmd.kind) {
          case 'setMode':
            api.setMode(cmd.mode as 'normal' | 'missing' | 'error' | 'slow')
            break
          case 'setSlowChats':
            api.setSlowChats(cmd.ms as number)
            break
          case 'setNextTranscript':
            api.setNextTranscript(cmd.value as string | null)
            break
          case 'setInjectedNotification':
            api.setInjectedNotification(cmd as unknown as { chatId: string; message: string; topicId?: string | null })
            break
          case 'injectAudioChunks': {
            if (fixtureCommandHandler) await fixtureCommandHandler(cmd)
            else {
              const base64 = cmd.pcmBase64 as string
              const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
              injectedAudioChunks.push(bytes)
            }
            break
          }
          default:
            await fixtureCommandHandler?.(cmd)
        }
      }
    } catch {
      // endpoint not available in prod builds
    }
  }, 100)
  const maybeNodeInterval = commandPollTimer as unknown as { unref?: () => void }
  maybeNodeInterval.unref?.()
}

export function consumeInjectedAudioChunks(): Uint8Array[] {
  const chunks = injectedAudioChunks
  injectedAudioChunks = []
  return chunks
}

export function getActiveFixtureApi(): FixtureTelegramApi | null {
  return activeFixture
}
