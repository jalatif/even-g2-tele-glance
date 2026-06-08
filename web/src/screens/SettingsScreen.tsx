import { useEffect, useState } from 'react'
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

  const hasTelegramCredentials = Boolean(draft.telegramApiId.trim() && draft.telegramApiHash.trim())
  const hasBackendSecret = Boolean(draft.backendSharedSecret.trim())
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
        <h2>Telegram</h2>
        <dl className="info-list">
          <div><dt>Status</dt><dd>{isConnected ? 'Already connected' : 'Not connected'}</dd></div>
          <div><dt>Credentials</dt><dd>{hasTelegramCredentials ? 'Configured' : 'Required'}</dd></div>
          <div><dt>Shared secret</dt><dd>{hasBackendSecret ? 'Configured' : 'Required'}</dd></div>
          <div><dt>Session</dt><dd>{hasTelegramSession ? 'Stored on this phone only' : isConnected ? 'Backend session active' : 'Not logged in yet'}</dd></div>
        </dl>
        <p className="hint">{isConnected ? 'Setup details are hidden because Telegram is connected. Expand if you need to change credentials or reconnect.' : 'Expand setup details to add Telegram API credentials from my.telegram.org.'}</p>
        <details className="settings-details" open={!isConnected}>
          <summary>{isConnected ? 'Change Telegram setup' : 'Telegram setup instructions'}</summary>
          <p className="hint">First-time users need their own Telegram API credentials. TeleGlance encrypts them for the configured backend on each request and stores the login session on this phone only.</p>
          <ol className="setup-list">
            <li>Open <a href="https://my.telegram.org" target="_blank" rel="noreferrer">my.telegram.org</a> and sign in with your Telegram phone number.</li>
            <li>Open API development tools and create an app.</li>
            <li>Paste the app API ID and API hash below, then save.</li>
            <li>Create a backend shared secret, put the same value in backend root <code>.env</code> as <code>TELEGLANCE_SHARED_SECRET</code>, and paste it in Backend settings below.</li>
            <li>Return to Telegram and enter your mobile number with international code to receive a Telegram login code.</li>
          </ol>
          <label>
            <span>Telegram API ID</span>
            <input inputMode="numeric" value={draft.telegramApiId} onChange={(event) => update('telegramApiId', event.target.value)} placeholder="123456" />
          </label>
          <label>
            <span>Telegram API Hash</span>
            <input value={draft.telegramApiHash} onChange={(event) => update('telegramApiHash', event.target.value)} placeholder="0123456789abcdef0123456789abcdef" />
          </label>
        </details>
        {logoutError && <p className="field-error">{logoutError}</p>}
        <button type="button" className="secondary" disabled={isLoggingOut || (!hasTelegramSession && !isConnected)} onClick={() => void handleLogout()}>
          {isLoggingOut ? 'Disconnecting...' : 'Disconnect Telegram'}
        </button>
      </section>

      <section className="phone-panel settings-group">
        <h2>Backend</h2>
        <p className="hint">Current backend: {draft.apiBaseUrl}. Expand setup details if you need install or network instructions.</p>
        <details className="settings-details">
          <summary>Backend setup instructions</summary>
          <p className="hint">Run your own backend from this repo, then enter its reachable URL here. Repo link: <a href="https://github.com/jalatif/even-g2-tele-glance.git" target="_blank" rel="noreferrer">github.com/jalatif/even-g2-tele-glance</a>.</p>
          <pre className="command-block"><code>{`git clone https://github.com/jalatif/even-g2-tele-glance.git
cd even-g2-tele-glance
cd server
python3 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cd ..
scripts/start-backend.sh --reload`}</code></pre>
        </details>
        <label>
          <span>Backend URL</span>
          <input value={draft.apiBaseUrl} onChange={(event) => update('apiBaseUrl', event.target.value)} placeholder="<BACKEND_URL>:8787" />
        </label>
        <label>
          <span>Backend shared secret</span>
          <input type="password" value={draft.backendSharedSecret} onChange={(event) => update('backendSharedSecret', event.target.value)} placeholder="Required" />
        </label>
        <p className="hint">Required. Set the exact same value in backend root <code>.env</code> as <code>TELEGLANCE_SHARED_SECRET</code>. The secret is stored locally and used on both sides to encrypt backend API payloads; it is not sent as plaintext.</p>
        <p className="hint">Use a LAN or Tailscale URL that the phone running Even Realities can reach. Saving backend or Telegram changes reloads the app.</p>
      </section>

      <section className="phone-panel settings-group">
        <h2>Voice</h2>
        <label>
          <span>STT Server Url (Optional)</span>
          <input value={draft.sttBaseUrl} onChange={(event) => update('sttBaseUrl', event.target.value)} placeholder="Use backend URL" />
        </label>
        <p className="hint">Leave blank to use the backend URL. A custom STT server must expose the same <code>/api/transcribe</code> endpoint.</p>
        <label className="inline-setting">
          <span>Debug event logging</span>
          <input type="checkbox" checked={draft.debugEventsEnabled} onChange={(event) => update('debugEventsEnabled', event.target.checked)} />
        </label>
        <p className="hint">Leave debug logging off for normal use. When enabled, raw glasses input events are sent to the backend debug endpoint and may include message or gesture context.</p>
        <label>
          <span>Recording minimum duration (ms)</span>
          <input type="number" min="0" max="5000" step="100" value={draft.recordingMinDurationMs} onChange={(event) => update('recordingMinDurationMs', Number(event.target.value))} />
        </label>
        <details className="settings-details">
          <summary>Advanced refresh fallback</summary>
          <p className="hint">Telegram updates normally arrive from the backend event stream. These fallback timers recover missed events after backgrounding, network drops, or stream reconnects.</p>
          <label>
            <span>Chat fallback refresh (ms)</span>
            <input type="number" min="1000" max="60000" step="500" value={draft.chatPollMs} onChange={(event) => update('chatPollMs', Number(event.target.value))} />
          </label>
          <label>
            <span>Message fallback refresh (ms)</span>
            <input type="number" min="1000" max="60000" step="500" value={draft.messagePollMs} onChange={(event) => update('messagePollMs', Number(event.target.value))} />
          </label>
        </details>
      </section>

      <section className="phone-panel settings-group">
        <h2>Build</h2>
        <dl className="info-list">
          <div><dt>Build version</dt><dd>{buildVersion}</dd></div>
          <div><dt>Current API URL</dt><dd>{settings.apiBaseUrl}</dd></div>
        </dl>
      </section>

      <div className="settings-actions">
        <button type="button" onClick={() => {
          void saveSettings(draft)
          setSaved(true)
        }}>
          {saved ? 'Saved' : 'Save Settings'}
        </button>
        <button type="button" className="secondary" onClick={resetSettings}>Reset</button>
      </div>
    </main>
  )
}
