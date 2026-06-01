import { API_BASE_URL_STORAGE_KEY, defaultApiBaseUrl } from './api'

const DEBUG_EVENTS_STORAGE_KEY = 'evenTelegram.debugEventsEnabled'
const CHAT_POLL_STORAGE_KEY = 'evenTelegram.chatPollMs'
const MESSAGE_POLL_STORAGE_KEY = 'evenTelegram.messagePollMs'
const RECORDING_MIN_STORAGE_KEY = 'evenTelegram.recordingMinDurationMs'

export type FrontendConfig = {
  apiBaseUrl: string
  debugEventsEnabled: boolean
  chatPollMs: number
  messagePollMs: number
  recordingMinDurationMs: number
}

export const DEFAULT_FRONTEND_CONFIG: Omit<FrontendConfig, 'apiBaseUrl'> = {
  debugEventsEnabled: true,
  chatPollMs: 10000,
  messagePollMs: 8000,
  recordingMinDurationMs: 900,
}

export function loadFrontendConfig(): FrontendConfig {
  return {
    apiBaseUrl: defaultApiBaseUrl(),
    debugEventsEnabled: readBoolean(DEBUG_EVENTS_STORAGE_KEY, DEFAULT_FRONTEND_CONFIG.debugEventsEnabled),
    chatPollMs: readNumber(CHAT_POLL_STORAGE_KEY, DEFAULT_FRONTEND_CONFIG.chatPollMs, 1000, 60000),
    messagePollMs: readNumber(MESSAGE_POLL_STORAGE_KEY, DEFAULT_FRONTEND_CONFIG.messagePollMs, 1000, 60000),
    recordingMinDurationMs: readNumber(RECORDING_MIN_STORAGE_KEY, DEFAULT_FRONTEND_CONFIG.recordingMinDurationMs, 0, 5000),
  }
}

export function saveFrontendConfig(config: FrontendConfig) {
  const apiBaseUrl = config.apiBaseUrl.trim()
  if (apiBaseUrl) window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, apiBaseUrl)
  else window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY)
  window.localStorage.setItem(DEBUG_EVENTS_STORAGE_KEY, String(config.debugEventsEnabled))
  window.localStorage.setItem(CHAT_POLL_STORAGE_KEY, String(clamp(config.chatPollMs, 1000, 60000)))
  window.localStorage.setItem(MESSAGE_POLL_STORAGE_KEY, String(clamp(config.messagePollMs, 1000, 60000)))
  window.localStorage.setItem(RECORDING_MIN_STORAGE_KEY, String(clamp(config.recordingMinDurationMs, 0, 5000)))
}

export function resetFrontendConfig() {
  window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY)
  window.localStorage.removeItem(DEBUG_EVENTS_STORAGE_KEY)
  window.localStorage.removeItem(CHAT_POLL_STORAGE_KEY)
  window.localStorage.removeItem(MESSAGE_POLL_STORAGE_KEY)
  window.localStorage.removeItem(RECORDING_MIN_STORAGE_KEY)
}

function readBoolean(key: string, fallback: boolean) {
  const value = window.localStorage.getItem(key)
  if (value === 'true') return true
  if (value === 'false') return false
  return fallback
}

function readNumber(key: string, fallback: number, min: number, max: number) {
  const value = Number(window.localStorage.getItem(key))
  if (!Number.isFinite(value)) return fallback
  return clamp(value, min, max)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(Math.round(value), min), max)
}
