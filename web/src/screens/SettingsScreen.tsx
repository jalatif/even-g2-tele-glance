import { useEffect, useState } from 'react'
import { SHARED_BACKEND_URL } from '../api'
import { getLocale, LANGUAGE_NAMES } from '../locales/index'
import { useApp } from '../contexts/AppContext'
import type { FrontendConfig } from '../storage'

export function SettingsScreen({ buildVersion }: { buildVersion: string }) {
  const { state, settings, saveSettings, resetSettings, logoutTelegram } = useApp()
  const [draft, setDraft] = useState<FrontendConfig>(settings)
  const [saved, setSaved] = useState(false)
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const [logoutError, setLogoutError] = useState<string | null>(null)

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  function update<K extends keyof FrontendConfig>(key: K, value: FrontendConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  const l = getLocale()
  const hasTelegramCredentials = Boolean(draft.telegramApiId.trim() && draft.telegramApiHash.trim())
  const hasBackendSecret = Boolean(draft.backendSharedSecret.trim())
  const isSharedBackend = draft.apiBaseUrl.startsWith(SHARED_BACKEND_URL)
  const hasTelegramSession = Boolean(draft.telegramSession.trim())
  const isConnected = state.screen !== 'auth' && state.screen !== 'loading' && state.screen !== 'error'

  async function handleLogout() {
    setIsLoggingOut(true)
    setLogoutError(null)
    try {
      await logoutTelegram()
    } catch (error) {
      setLogoutError(error instanceof Error ? error.message : 'Logout failed')
      setIsLoggingOut(false)
    }
  }

  return (
    <main className="settings-screen">
      <section className="phone-panel settings-group">
        <h2>{l.settingsTelegramSection}</h2>
        <dl className="info-list">
          <div><dt>{l.settingsStatusLabel}</dt><dd>{isConnected ? l.settingsStatusConnected : l.settingsStatusNotConnected}</dd></div>
          <div><dt>{l.settingsCredentialsLabel}</dt><dd>{hasTelegramCredentials ? l.settingsConfigured : l.settingsRequired}</dd></div>
          <div><dt>{l.settingsSharedSecretLabel}</dt><dd>{hasBackendSecret ? l.settingsConfigured : l.settingsRequired}</dd></div>
          <div><dt>{l.settingsSessionLabel}</dt><dd>{hasTelegramSession ? l.settingsStoredOnPhone : isConnected ? l.settingsBackendSession : l.settingsNotLoggedIn}</dd></div>
        </dl>
        <p className="hint">{isConnected ? l.settingsSetupHidden : l.settingsSetupExpand}</p>
        <details className="settings-details" open={!isConnected}>
          <summary>{isConnected ? l.settingsChangeSetup : l.settingsSetupInstructions}</summary>
          <p className="hint">{l.settingsSetupHint}</p>
          <ol className="setup-list">
            <li>{l.settingsSetupStep1}</li>
            <li>{l.settingsSetupStep2}</li>
            <li>{l.settingsSetupStep3}</li>
            <li>{l.settingsSetupStep4}</li>
            <li>{l.settingsSetupStep5}</li>
          </ol>
          <label>
            <span>{l.settingsTelegramApiId}</span>
            <input inputMode="numeric" value={draft.telegramApiId} onChange={(event) => update('telegramApiId', event.target.value)} placeholder="123456" />
          </label>
          <label>
            <span>{l.settingsTelegramApiHash}</span>
            <input value={draft.telegramApiHash} onChange={(event) => update('telegramApiHash', event.target.value)} placeholder="0123456789abcdef0123456789abcdef" />
          </label>
        </details>
        {logoutError && <p className="field-error">{logoutError}</p>}
        <button type="button" className="secondary" disabled={isLoggingOut || (!hasTelegramSession && !isConnected)} onClick={() => void handleLogout()}>
          {isLoggingOut ? l.settingsDisconnecting : l.settingsDisconnectTelegram}
        </button>
      </section>

      <section className="phone-panel settings-group">
        <h2>{l.settingsBackendSection}</h2>
        <details className="settings-details">
          <summary>{l.settingsBackendSetup}</summary>
          <p className="hint">{l.settingsBackendHint}<a href="https://github.com/jalatif/even-g2-tele-glance.git" target="_blank" rel="noreferrer">github.com/jalatif/even-g2-tele-glance</a>.</p>
          <pre className="command-block"><code>{`git clone https://github.com/jalatif/even-g2-tele-glance.git
cd even-g2-tele-glance
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cd ..
scripts/start-backend.sh --reload`}</code></pre>
        </details>
        <label>
          <span>{l.settingsBackendUrl}</span>
          <input value={draft.apiBaseUrl} onChange={(event) => update('apiBaseUrl', event.target.value)} placeholder={SHARED_BACKEND_URL} />
        </label>
        <label>
          <span>{l.settingsBackendSecret}</span>
          <input type="password" value={draft.backendSharedSecret} onChange={(event) => update('backendSharedSecret', event.target.value)} placeholder={isSharedBackend ? 'Not used for testing backend' : l.settingsBackendSecretPlaceholder} />
        </label>
        {isSharedBackend ? (
          <p className="testing-banner">
            <span className="asterisk">*</span> Use https://teleglance.akira-os.net only for testing (no secure-token needed). Testing url can be unstable so use only for testing and switch to your own backend and then set the exact same value in backend root <code>.env</code> as <code>TELEGLANCE_SHARED_SECRET</code>. The secret is stored locally and used on both sides to encrypt backend API payloads; it is not sent as plaintext.
          </p>
        ) : (
          <p className="hint">{l.settingsBackendSecretHint}</p>
        )}
      </section>

      <section className="phone-panel settings-group">
        <h2>{l.settingsVoiceSection}</h2>
        <label>
          <span>{l.settingsSttUrl}</span>
          <input value={draft.sttBaseUrl} onChange={(event) => update('sttBaseUrl', event.target.value)} placeholder="Use backend URL" />
        </label>
        <p className="hint">{l.settingsSttHint}</p>
        <label className="inline-setting">
          <span>{l.settingsDebugEvents}</span>
          <input type="checkbox" checked={draft.debugEventsEnabled} onChange={(event) => update('debugEventsEnabled', event.target.checked)} />
        </label>
        <p className="hint">{l.settingsDebugEventsHint}</p>
        <label>
          <span>{l.settingsRecMinDuration}</span>
          <input type="number" min="0" max="5000" step="100" value={draft.recordingMinDurationMs} onChange={(event) => update('recordingMinDurationMs', Number(event.target.value))} />
        </label>
        <details className="settings-details">
          <summary>{l.settingsAdvancedPolling}</summary>
          <p className="hint">{l.settingsAdvancedPollingHint}</p>
          <label>
            <span>{l.settingsChatPoll}</span>
            <input type="number" min="1000" max="60000" step="500" value={draft.chatPollMs} onChange={(event) => update('chatPollMs', Number(event.target.value))} />
          </label>
          <label>
            <span>{l.settingsMessagePoll}</span>
            <input type="number" min="1000" max="60000" step="500" value={draft.messagePollMs} onChange={(event) => update('messagePollMs', Number(event.target.value))} />
          </label>
        </details>
      </section>

      <section className="phone-panel settings-group">
        <h2>{l.settingsLanguageSection}</h2>
        <label>
          <span>{l.settingsLanguageLabel}</span>
          <select value={draft.language} onChange={(event) => update('language', event.target.value)}>
            {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select>
        </label>
        <p className="hint">{l.settingsLanguageHint}</p>
      </section>

      <section className="phone-panel settings-group">
        <h2>{l.settingsBuildSection}</h2>
        <dl className="info-list">
          <div><dt>{l.settingsBuildVersion}</dt><dd>{buildVersion}</dd></div>
          <div><dt>{l.settingsApiUrl}</dt><dd>{settings.apiBaseUrl}</dd></div>
        </dl>
      </section>

      <div className="settings-actions">
        <button type="button" onClick={() => {
          void saveSettings(draft)
          setSaved(true)
        }}>
          {saved ? l.settingsSaved : l.settingsSave}
        </button>
        <button type="button" className="secondary" onClick={resetSettings}>{l.settingsReset}</button>
      </div>
    </main>
  )
}
