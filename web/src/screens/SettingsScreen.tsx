import { useState } from 'react'
import { useApp } from '../contexts/AppContext'
import type { FrontendConfig } from '../storage'

export function SettingsScreen({ buildVersion }: { buildVersion: string }) {
  const { settings, saveSettings, resetSettings } = useApp()
  const [draft, setDraft] = useState<FrontendConfig>(settings)
  const [saved, setSaved] = useState(false)

  function update<K extends keyof FrontendConfig>(key: K, value: FrontendConfig[K]) {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  return (
    <main className="settings-screen">
      <section className="phone-panel settings-group">
        <h2>Backend</h2>
        <label>
          <span>Backend URL</span>
          <input value={draft.apiBaseUrl} onChange={(event) => update('apiBaseUrl', event.target.value)} placeholder="http://100.x.x.x:8787" />
        </label>
        <p className="hint">Saving a changed backend URL reloads the app so the API client and controller restart cleanly.</p>
      </section>

      <section className="phone-panel settings-group">
        <h2>Runtime</h2>
        <label className="inline-setting">
          <span>Debug event logging</span>
          <input type="checkbox" checked={draft.debugEventsEnabled} onChange={(event) => update('debugEventsEnabled', event.target.checked)} />
        </label>
        <label>
          <span>Chat polling interval (ms)</span>
          <input type="number" min="1000" max="60000" step="500" value={draft.chatPollMs} onChange={(event) => update('chatPollMs', Number(event.target.value))} />
        </label>
        <label>
          <span>Message polling interval (ms)</span>
          <input type="number" min="1000" max="60000" step="500" value={draft.messagePollMs} onChange={(event) => update('messagePollMs', Number(event.target.value))} />
        </label>
        <label>
          <span>Recording minimum duration (ms)</span>
          <input type="number" min="0" max="5000" step="100" value={draft.recordingMinDurationMs} onChange={(event) => update('recordingMinDurationMs', Number(event.target.value))} />
        </label>
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
          saveSettings(draft)
          setSaved(true)
        }}>
          {saved ? 'Saved' : 'Save Settings'}
        </button>
        <button type="button" className="secondary" onClick={resetSettings}>Reset</button>
      </div>
    </main>
  )
}
