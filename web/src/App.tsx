import { useEffect, useState } from 'react'
import { BACKEND_UNREACHABLE_MESSAGE } from './api'
import { APP_BUILD_VERSION } from './bridge/evenBridge'
import { AppProvider, useApp } from './contexts/AppContext'
import { ChatScreen } from './screens/ChatScreen'
import { SettingsScreen } from './screens/SettingsScreen'

type Route = 'chat' | 'settings'

function AppShell() {
  const { state, startupError, settings } = useApp()
  const needsSetup = state.screen === 'auth' && (!settings.backendSharedSecret.trim() || !settings.telegramApiId.trim() || !settings.telegramApiHash.trim())
  const setupBanner = setupBannerText(state, settings)
  const [route, setRoute] = useState<Route>(needsSetup ? 'settings' : 'chat')
  const isMessages = state.screen === 'sidebar' && state.focus === 'messages'
  const title = isMessages
    ? state.topic ? `${state.chat.title} / ${state.topic.title}` : state.chat.title
    : 'TeleGlance'

  useEffect(() => {
    if (needsSetup) setRoute('settings')
  }, [needsSetup])

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">TeleGlance</p>
          <h1>{route === 'settings' ? 'Settings' : title}</h1>
        </div>
        <button className="icon-button" type="button" onClick={() => setRoute(route === 'settings' ? 'chat' : 'settings')} aria-label={route === 'settings' ? 'Back to chat' : 'Open settings'}>
          {route === 'settings' ? 'Back' : 'Settings'}
        </button>
      </header>
      {startupError && <div className="error-banner">{startupError}</div>}
      {setupBanner && <div className="error-banner">{setupBanner}</div>}
      {route === 'settings' ? <SettingsScreen buildVersion={APP_BUILD_VERSION} /> : <ChatScreen />}
    </div>
  )
}

function setupBannerText(
  state: ReturnType<typeof useApp>['state'],
  settings: ReturnType<typeof useApp>['settings'],
) {
  if (!settings.apiBaseUrl.trim()) return BACKEND_UNREACHABLE_MESSAGE
  if (state.screen === 'error' && state.message === BACKEND_UNREACHABLE_MESSAGE) return BACKEND_UNREACHABLE_MESSAGE
  if (state.screen === 'auth' && (!settings.backendSharedSecret.trim() || !settings.telegramApiId.trim() || !settings.telegramApiHash.trim())) {
    return 'Backend shared secret, Telegram API ID, and Telegram API hash are required. Fill them in Settings using the setup instructions first.'
  }
  return null
}

export function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  )
}
