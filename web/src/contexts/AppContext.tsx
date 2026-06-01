import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HttpTelegramApi } from '../api'
import { EvenHubGlassesBridge } from '../bridge/evenBridge'
import { TelegramAppController, type ControllerRuntimeConfig, type GlassesBridge } from '../controller/appController'
import type { AppInput, AppState, ScreenModel } from '../controller/model'
import { loadFrontendConfig, resetFrontendConfig, saveFrontendConfig, type FrontendConfig } from '../storage'

type AppContextValue = {
  state: AppState
  settings: FrontendConfig
  startupError: string | null
  dispatch: (input: AppInput) => Promise<void>
  sendText: (text: string) => Promise<void>
  startPhoneLogin: (phone: string) => Promise<void>
  verifyPhoneLogin: (phone: string, code: string) => Promise<void>
  saveSettings: (settings: FrontendConfig) => void
  resetSettings: () => void
  logoutTelegram: () => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

const fallbackBridge: GlassesBridge = {
  render: async (_model: ScreenModel) => undefined,
  setAudioEnabled: async (_enabled: boolean) => undefined,
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(loadFrontendConfig)
  const [state, setState] = useState<AppState>({ screen: 'loading', message: 'Starting...' })
  const [startupError, setStartupError] = useState<string | null>(null)
  const settingsRef = useRef(settings)
  const controllerRef = useRef<TelegramAppController | null>(null)
  const apiRef = useRef<HttpTelegramApi | null>(null)

  settingsRef.current = settings

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let unsubscribeUpdates: (() => void) | undefined

    async function start() {
      try {
        const api = new HttpTelegramApi(settingsRef.current.apiBaseUrl, () => settingsRef.current)
        apiRef.current = api
        const glasses = await EvenHubGlassesBridge.create(
          (input) => {
            void controllerRef.current?.dispatch(input)
          },
          { debugEventsEnabled: () => settingsRef.current.debugEventsEnabled },
        ).catch(() => fallbackBridge)
        if (!active) return
        const controller = new TelegramAppController(
          api,
          glasses,
          runtimeConfig(settingsRef.current),
          (session) => {
            const next = { ...settingsRef.current, telegramSession: session }
            saveFrontendConfig(next)
            settingsRef.current = next
            if (active) setSettings(next)
          },
          () => Boolean(settingsRef.current.backendSharedSecret.trim() && settingsRef.current.telegramApiId.trim() && settingsRef.current.telegramApiHash.trim()),
        )
        controllerRef.current = controller
        unsubscribe = controller.subscribe((next) => {
          if (active) setState(next)
        })
        await controller.init()
        unsubscribeUpdates = api.subscribeUpdates((update) => {
          void controller.handleTelegramUpdate(update)
        })
      } catch (error) {
        if (active) setStartupError(error instanceof Error ? error.message : 'Startup failed')
      }
    }

    void start()
    return () => {
      active = false
      unsubscribe?.()
      unsubscribeUpdates?.()
    }
  }, [])

  const dispatch = useCallback(async (input: AppInput) => {
    await controllerRef.current?.dispatch(input)
  }, [])

  const sendText = useCallback(async (text: string) => {
    await controllerRef.current?.sendTextFromPhone(text)
  }, [])

  const startPhoneLogin = useCallback(async (phone: string) => {
    await controllerRef.current?.startPhoneLogin(phone)
  }, [])

  const verifyPhoneLogin = useCallback(async (phone: string, code: string) => {
    await controllerRef.current?.verifyPhoneLogin(phone, code)
  }, [])

  const handleSaveSettings = useCallback((next: FrontendConfig) => {
    const previous = settingsRef.current
    saveFrontendConfig(next)
    setSettings(next)
    controllerRef.current?.updateRuntimeConfig(runtimeConfig(next))
    if (
      next.apiBaseUrl.trim() !== previous.apiBaseUrl.trim()
      || next.telegramApiId.trim() !== previous.telegramApiId.trim()
      || next.telegramApiHash.trim() !== previous.telegramApiHash.trim()
      || next.telegramSession.trim() !== previous.telegramSession.trim()
      || next.backendSharedSecret.trim() !== previous.backendSharedSecret.trim()
      || next.sttBaseUrl.trim() !== previous.sttBaseUrl.trim()
    ) {
      window.location.reload()
    }
  }, [])

  const handleResetSettings = useCallback(() => {
    resetFrontendConfig()
    window.location.reload()
  }, [])

  const logoutTelegram = useCallback(async () => {
    await apiRef.current?.logout()
    const next = { ...settingsRef.current, telegramSession: '' }
    saveFrontendConfig(next)
    window.location.reload()
  }, [])

  const value = useMemo<AppContextValue>(() => ({
    state,
    settings,
    startupError,
    dispatch,
    sendText,
    startPhoneLogin,
    verifyPhoneLogin,
    saveSettings: handleSaveSettings,
    resetSettings: handleResetSettings,
    logoutTelegram,
  }), [dispatch, handleResetSettings, handleSaveSettings, logoutTelegram, sendText, settings, startPhoneLogin, startupError, state, verifyPhoneLogin])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}

function runtimeConfig(config: FrontendConfig): Partial<ControllerRuntimeConfig> {
  return {
    chatPollMs: config.chatPollMs,
    messagePollMs: config.messagePollMs,
    recordingMinDurationMs: config.recordingMinDurationMs,
  }
}
