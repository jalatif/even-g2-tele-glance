import { useState } from 'react'
import { APP_BUILD_VERSION } from './bridge/evenBridge'
import { AppProvider, useApp } from './contexts/AppContext'
import { ChatScreen } from './screens/ChatScreen'
import { SettingsScreen } from './screens/SettingsScreen'

type Route = 'chat' | 'settings'

function AppShell() {
  const [route, setRoute] = useState<Route>('chat')
  const { state, startupError } = useApp()
  const title = state.screen === 'messages'
    ? state.topic ? `${state.chat.title} / ${state.topic.title}` : state.chat.title
    : 'Telegram'

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Even Telegram</p>
          <h1>{route === 'settings' ? 'Settings' : title}</h1>
        </div>
        <button className="icon-button" type="button" onClick={() => setRoute(route === 'settings' ? 'chat' : 'settings')} aria-label={route === 'settings' ? 'Back to chat' : 'Open settings'}>
          {route === 'settings' ? 'Back' : 'Settings'}
        </button>
      </header>
      {startupError && <div className="error-banner">{startupError}</div>}
      {route === 'settings' ? <SettingsScreen buildVersion={APP_BUILD_VERSION} /> : <ChatScreen />}
    </div>
  )
}

export function App() {
  return (
    <AppProvider>
      <AppShell />
    </AppProvider>
  )
}
