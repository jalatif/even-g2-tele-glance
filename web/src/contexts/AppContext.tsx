import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { HttpTelegramApi, type TelegramApi } from '../api'
import { EvenHubGlassesBridge } from '../bridge/evenBridge'
import { TelegramAppController, type ControllerRuntimeConfig, type GlassesBridge } from '../controller/appController'
import type { AppInput, AppState, ScreenModel } from '../controller/model'
import { FixtureTelegramApi, bindFixtureApi } from '../fixtureApi'
import { InstrumentedTelegramApi } from '../instrumentedApi'
import {
  clearFrontendConfigFromAppStorage,
  loadFrontendConfig,
  loadFrontendConfigFromAppStorage,
  resetFrontendConfig,
  saveFrontendConfig,
  saveFrontendConfigToAppStorage,
  type AppStorageBridge,
  type FrontendConfig,
} from '../storage'
import { isTeleGlanceFixtureMode, logLifecycleEvent, logTeleGlanceTest, summarizeAppState } from '../testMode'

type AppContextValue = {
  state: AppState
  settings: FrontendConfig
  startupError: string | null
  dispatch: (input: AppInput) => Promise<void>
  sendText: (text: string) => Promise<void>
  startPhoneLogin: (phone: string) => Promise<void>
  verifyPhoneLogin: (phone: string, code: string) => Promise<void>
  saveSettings: (settings: FrontendConfig) => Promise<void>
  resetSettings: () => Promise<void>
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
  const apiRef = useRef<TelegramApi | null>(null)
  const appStorageRef = useRef<AppStorageBridge | undefined>(undefined)

  settingsRef.current = settings

  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    let unsubscribeUpdates: (() => void) | undefined
    let glasses: GlassesBridge | undefined
    let controller: TelegramAppController | undefined

    async function start() {
      try {
        glasses = await EvenHubGlassesBridge.create(
          (input) => controllerRef.current?.dispatch(input),
          {
            debugEventsEnabled: () => settingsRef.current.debugEventsEnabled,
            authConfig: () => settingsRef.current,
            dispatchContextProvider: () => controllerRef.current?.getDispatchContext() ?? { inputQuiet: false, backgroundWorkActive: false },
          },
        ).catch(() => fallbackBridge)
        if (!active) return
        appStorageRef.current = glasses
        const fixtureMode = isTeleGlanceFixtureMode()
        const restoredSettings = fixtureMode
          ? fixtureSettings(settingsRef.current)
          : await loadFrontendConfigFromAppStorage(appStorageRef.current, settingsRef.current)
        if (!active) return
        settingsRef.current = restoredSettings
        setSettings(restoredSettings)
        if (!fixtureMode) {
          saveFrontendConfig(restoredSettings)
          await saveFrontendConfigToAppStorage(appStorageRef.current, restoredSettings)
        }
        const baseApi: TelegramApi = fixtureMode
          ? new FixtureTelegramApi()
          : new HttpTelegramApi(
              restoredSettings.apiBaseUrl,
              () => settingsRef.current,
              () => controllerRef.current?.isInputQuiet() ?? false,
            )
        if (fixtureMode) bindFixtureApi(baseApi as FixtureTelegramApi)
        const api = new InstrumentedTelegramApi(baseApi)
        apiRef.current = api
        if (fixtureMode) logLifecycleEvent('start', {})
        const createdController = new TelegramAppController(
          api,
          glasses,
          runtimeConfig(settingsRef.current),
          (session) => {
            const next = { ...settingsRef.current, telegramSession: session }
            saveFrontendConfig(next)
            void saveFrontendConfigToAppStorage(appStorageRef.current, next)
            settingsRef.current = next
            if (active) setSettings(next)
          },
          () => fixtureMode || Boolean(settingsRef.current.backendSharedSecret.trim() && settingsRef.current.telegramApiId.trim() && settingsRef.current.telegramApiHash.trim()),
        )
        controller = createdController
        controllerRef.current = createdController
        unsubscribe = createdController.subscribe((next) => {
          logTeleGlanceTest('state', summarizeAppState(next))
          if (active) setState(next)
        })
        await createdController.init()
        unsubscribeUpdates = api.subscribeUpdates((update) => {
          void createdController.handleTelegramUpdate(update)
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
      controller?.dispose()
      glasses?.dispose?.()
      if (controllerRef.current === controller) controllerRef.current = null
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

  const handleSaveSettings = useCallback(async (next: FrontendConfig) => {
    const previous = settingsRef.current
    settingsRef.current = next
    saveFrontendConfig(next)
    await saveFrontendConfigToAppStorage(appStorageRef.current, next)
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

  const handleResetSettings = useCallback(async () => {
    resetFrontendConfig()
    await clearFrontendConfigFromAppStorage(appStorageRef.current)
    window.location.reload()
  }, [])

  const logoutTelegram = useCallback(async () => {
    await apiRef.current?.logout()
    const next = { ...settingsRef.current, telegramSession: '' }
    saveFrontendConfig(next)
    await saveFrontendConfigToAppStorage(appStorageRef.current, next)
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

function fixtureSettings(current: FrontendConfig): FrontendConfig {
  return {
    ...current,
    apiBaseUrl: current.apiBaseUrl.trim() || 'http://127.0.0.1:5174',
    backendSharedSecret: current.backendSharedSecret.trim() || 'fixture-shared-secret',
    telegramApiId: current.telegramApiId.trim() || '12345',
    telegramApiHash: current.telegramApiHash.trim() || 'fixture-hash',
    telegramSession: current.telegramSession.trim() || 'fixture-session',
    debugEventsEnabled: false,
  }
}

function runtimeConfig(config: FrontendConfig): Partial<ControllerRuntimeConfig> {
  return {
    chatPollMs: config.chatPollMs,
    messagePollMs: config.messagePollMs,
    recordingMinDurationMs: config.recordingMinDurationMs,
  }
}
