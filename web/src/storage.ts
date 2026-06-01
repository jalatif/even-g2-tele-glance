import { API_BASE_URL_STORAGE_KEY, G2_TELE_API_BASE_URL_STORAGE_KEY, LEGACY_API_BASE_URL_STORAGE_KEY, defaultApiBaseUrl } from './api'

const DEBUG_EVENTS_STORAGE_KEY = 'teleGlance.debugEventsEnabled'
const CHAT_POLL_STORAGE_KEY = 'teleGlance.chatPollMs'
const MESSAGE_POLL_STORAGE_KEY = 'teleGlance.messagePollMs'
const RECORDING_MIN_STORAGE_KEY = 'teleGlance.recordingMinDurationMs'
const STT_BASE_URL_STORAGE_KEY = 'teleGlance.sttBaseUrl'
const BACKEND_SHARED_SECRET_STORAGE_KEY = 'teleGlance.backendSharedSecret'
const TELEGRAM_API_ID_STORAGE_KEY = 'teleGlance.telegramApiId'
const TELEGRAM_API_HASH_STORAGE_KEY = 'teleGlance.telegramApiHash'
const TELEGRAM_SESSION_STORAGE_KEY = 'teleGlance.telegramSession'
const G2_TELE_DEBUG_EVENTS_STORAGE_KEY = 'g2Tele.debugEventsEnabled'
const G2_TELE_CHAT_POLL_STORAGE_KEY = 'g2Tele.chatPollMs'
const G2_TELE_MESSAGE_POLL_STORAGE_KEY = 'g2Tele.messagePollMs'
const G2_TELE_RECORDING_MIN_STORAGE_KEY = 'g2Tele.recordingMinDurationMs'
const G2_TELE_STT_BASE_URL_STORAGE_KEY = 'g2Tele.sttBaseUrl'
const G2_TELE_BACKEND_SHARED_SECRET_STORAGE_KEY = 'g2Tele.backendSharedSecret'
const G2_TELE_TELEGRAM_API_ID_STORAGE_KEY = 'g2Tele.telegramApiId'
const G2_TELE_TELEGRAM_API_HASH_STORAGE_KEY = 'g2Tele.telegramApiHash'
const G2_TELE_TELEGRAM_SESSION_STORAGE_KEY = 'g2Tele.telegramSession'
const LEGACY_DEBUG_EVENTS_STORAGE_KEY = 'evenTelegram.debugEventsEnabled'
const LEGACY_CHAT_POLL_STORAGE_KEY = 'evenTelegram.chatPollMs'
const LEGACY_MESSAGE_POLL_STORAGE_KEY = 'evenTelegram.messagePollMs'
const LEGACY_RECORDING_MIN_STORAGE_KEY = 'evenTelegram.recordingMinDurationMs'

const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export type FrontendConfig = {
  apiBaseUrl: string
  telegramApiId: string
  telegramApiHash: string
  telegramSession: string
  debugEventsEnabled: boolean
  chatPollMs: number
  messagePollMs: number
  recordingMinDurationMs: number
  sttBaseUrl: string
  backendSharedSecret: string
}

export const DEFAULT_FRONTEND_CONFIG: Omit<FrontendConfig, 'apiBaseUrl'> = {
  telegramApiId: '',
  telegramApiHash: '',
  telegramSession: '',
  debugEventsEnabled: false,
  chatPollMs: 10000,
  messagePollMs: 8000,
  recordingMinDurationMs: 900,
  sttBaseUrl: '',
  backendSharedSecret: '',
}

export function loadFrontendConfig(): FrontendConfig {
  return {
    apiBaseUrl: defaultApiBaseUrl(),
    telegramApiId: readString(TELEGRAM_API_ID_STORAGE_KEY, G2_TELE_TELEGRAM_API_ID_STORAGE_KEY),
    telegramApiHash: readString(TELEGRAM_API_HASH_STORAGE_KEY, G2_TELE_TELEGRAM_API_HASH_STORAGE_KEY),
    telegramSession: readString(TELEGRAM_SESSION_STORAGE_KEY, G2_TELE_TELEGRAM_SESSION_STORAGE_KEY),
    debugEventsEnabled: readBoolean(DEBUG_EVENTS_STORAGE_KEY, DEFAULT_FRONTEND_CONFIG.debugEventsEnabled, G2_TELE_DEBUG_EVENTS_STORAGE_KEY, LEGACY_DEBUG_EVENTS_STORAGE_KEY),
    chatPollMs: readNumber(CHAT_POLL_STORAGE_KEY, DEFAULT_FRONTEND_CONFIG.chatPollMs, 1000, 60000, G2_TELE_CHAT_POLL_STORAGE_KEY, LEGACY_CHAT_POLL_STORAGE_KEY),
    messagePollMs: readNumber(MESSAGE_POLL_STORAGE_KEY, DEFAULT_FRONTEND_CONFIG.messagePollMs, 1000, 60000, G2_TELE_MESSAGE_POLL_STORAGE_KEY, LEGACY_MESSAGE_POLL_STORAGE_KEY),
    recordingMinDurationMs: readNumber(RECORDING_MIN_STORAGE_KEY, DEFAULT_FRONTEND_CONFIG.recordingMinDurationMs, 0, 5000, G2_TELE_RECORDING_MIN_STORAGE_KEY, LEGACY_RECORDING_MIN_STORAGE_KEY),
    sttBaseUrl: readString(STT_BASE_URL_STORAGE_KEY, G2_TELE_STT_BASE_URL_STORAGE_KEY),
    backendSharedSecret: readString(BACKEND_SHARED_SECRET_STORAGE_KEY, G2_TELE_BACKEND_SHARED_SECRET_STORAGE_KEY),
  }
}

export function saveFrontendConfig(config: FrontendConfig) {
  const apiBaseUrl = config.apiBaseUrl.trim()
  writeString(API_BASE_URL_STORAGE_KEY, apiBaseUrl)
  safeLsRemoveItem(G2_TELE_API_BASE_URL_STORAGE_KEY)
  safeLsRemoveItem(LEGACY_API_BASE_URL_STORAGE_KEY)
  writeString(TELEGRAM_API_ID_STORAGE_KEY, config.telegramApiId)
  writeString(TELEGRAM_API_HASH_STORAGE_KEY, config.telegramApiHash)
  writeString(TELEGRAM_SESSION_STORAGE_KEY, config.telegramSession)
  safeLsSetItem(DEBUG_EVENTS_STORAGE_KEY, String(config.debugEventsEnabled))
  safeLsSetItem(CHAT_POLL_STORAGE_KEY, String(clamp(config.chatPollMs, 1000, 60000)))
  safeLsSetItem(MESSAGE_POLL_STORAGE_KEY, String(clamp(config.messagePollMs, 1000, 60000)))
  safeLsSetItem(RECORDING_MIN_STORAGE_KEY, String(clamp(config.recordingMinDurationMs, 0, 5000)))
  writeString(STT_BASE_URL_STORAGE_KEY, config.sttBaseUrl)
  writeString(BACKEND_SHARED_SECRET_STORAGE_KEY, config.backendSharedSecret)
}

export function resetFrontendConfig() {
  safeLsRemoveItem(API_BASE_URL_STORAGE_KEY)
  safeLsRemoveItem(LEGACY_API_BASE_URL_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_API_BASE_URL_STORAGE_KEY)
  safeLsRemoveItem(TELEGRAM_API_ID_STORAGE_KEY)
  safeLsRemoveItem(TELEGRAM_API_HASH_STORAGE_KEY)
  safeLsRemoveItem(TELEGRAM_SESSION_STORAGE_KEY)
  safeLsRemoveItem(DEBUG_EVENTS_STORAGE_KEY)
  safeLsRemoveItem(CHAT_POLL_STORAGE_KEY)
  safeLsRemoveItem(MESSAGE_POLL_STORAGE_KEY)
  safeLsRemoveItem(RECORDING_MIN_STORAGE_KEY)
  safeLsRemoveItem(STT_BASE_URL_STORAGE_KEY)
  safeLsRemoveItem(BACKEND_SHARED_SECRET_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_TELEGRAM_API_ID_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_TELEGRAM_API_HASH_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_TELEGRAM_SESSION_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_DEBUG_EVENTS_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_CHAT_POLL_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_MESSAGE_POLL_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_RECORDING_MIN_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_STT_BASE_URL_STORAGE_KEY)
  safeLsRemoveItem(G2_TELE_BACKEND_SHARED_SECRET_STORAGE_KEY)
  safeLsRemoveItem(LEGACY_DEBUG_EVENTS_STORAGE_KEY)
  safeLsRemoveItem(LEGACY_CHAT_POLL_STORAGE_KEY)
  safeLsRemoveItem(LEGACY_MESSAGE_POLL_STORAGE_KEY)
  safeLsRemoveItem(LEGACY_RECORDING_MIN_STORAGE_KEY)
  removeCookie(TELEGRAM_API_ID_STORAGE_KEY)
  removeCookie(TELEGRAM_API_HASH_STORAGE_KEY)
  removeCookie(TELEGRAM_SESSION_STORAGE_KEY)
  removeCookie(BACKEND_SHARED_SECRET_STORAGE_KEY)
  removeCookie(STT_BASE_URL_STORAGE_KEY)
  removeCookie(API_BASE_URL_STORAGE_KEY)
}

// --- Safe localStorage wrappers ---



function safeLsGetItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeLsSetItem(key: string, value: string) {
  try {
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
}

function safeLsRemoveItem(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch { /* storage unavailable */ }
}

// --- Cookie fallback for critical string settings ---

function readCookie(key: string): string | null {
  try {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${encodeURIComponent(key)}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

function writeCookie(key: string, value: string) {
  try {
    const encodedKey = encodeURIComponent(key)
    if (value) {
      const encodedValue = encodeURIComponent(value)
      document.cookie = `${encodedKey}=${encodedValue};max-age=${COOKIE_MAX_AGE_SECONDS};path=/;SameSite=Lax`
    } else {
      document.cookie = `${encodedKey}=;max-age=0;path=/;SameSite=Lax`
    }
  } catch { /* cookies unavailable */ }
}

function removeCookie(key: string) {
  writeCookie(key, '')
}

// --- Storage readers with cookie fallback ---

function readString(key: string, ...legacyKeys: string[]) {
  for (const candidate of [key, ...legacyKeys]) {
    const value = safeLsGetItem(candidate)?.trim()
    if (value) return value
  }
  const cookieValue = readCookie(key)?.trim()
  if (cookieValue) return cookieValue
  return ''
}

function writeString(key: string, value: string) {
  const trimmed = value.trim()
  safeLsSetItem(key, trimmed)
  writeCookie(key, trimmed)
}
function readBoolean(key: string, fallback: boolean, ...legacyKeys: string[]) {
  const value = readRaw(key, legacyKeys)
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function readNumber(key: string, fallback: number, min: number, max: number, ...legacyKeys: string[]) {
  const raw = readRaw(key, legacyKeys)
  if (raw === null || raw.trim() === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return clamp(value, min, max)
}

function readRaw(key: string, legacyKeys: string[]) {
  for (const candidate of [key, ...legacyKeys]) {
    const value = safeLsGetItem(candidate)
    if (value !== null) return value
  }
  return null
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max)
}
