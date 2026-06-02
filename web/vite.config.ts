import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf-8')) as { version: string }

type FixtureCommand =
  | { kind: 'setMode'; mode: 'normal' | 'missing' | 'error' | 'slow' }
  | { kind: 'setSlowChats'; ms: number }
  | { kind: 'setNextTranscript'; value: string | null }
  | { kind: 'setInjectedNotification'; chatId: string; message: string; topicId?: string | null }
  | { kind: 'injectAudioChunks'; pcmBase64: string }
  | { kind: 'reset' }

let pendingFixtureCommands: FixtureCommand[] = []

const SEED_KEYS = ['apiBaseUrl', 'backendSharedSecret', 'telegramApiId', 'telegramApiHash', 'telegramSession'] as const

function loadSeedCredentials(): Record<string, string> | null {
  const candidates = [
    resolve(__dirname, 'test/seed-credentials.local.json'),
    resolve(__dirname, 'test/seed-credentials.json'),
  ]
  for (const path of candidates) {
    if (existsSync(path)) {
      try {
        const raw = readFileSync(path, 'utf-8')
        const parsed = JSON.parse(raw) as Record<string, unknown>
        const out: Record<string, string> = {}
        for (const key of SEED_KEYS) {
          const value = parsed[key]
          if (typeof value === 'string' && value.length > 0) out[key] = value
        }
        if (Object.keys(out).length > 0) return out
      } catch (error) {
        console.warn(`[teleGlanceFixtureBridge] failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  return null
}

const seedBootScript = `
(() => {
  if (typeof window === 'undefined') return
  const seed = window.__teleGlanceSeedCredentials
  if (seed && typeof seed === 'object') {
    try {
      const applyIfEmpty = (key, value) => {
        if (typeof value !== 'string' || !value) return
        try {
          if (window.localStorage.getItem(key) === null) {
            window.localStorage.setItem(key, value)
          }
        } catch { /* localStorage unavailable */ }
      }
      if (window.localStorage.getItem('teleGlance.seedCredentialsApplied') !== '1') {
        applyIfEmpty('teleGlance.apiBaseUrl', seed.apiBaseUrl)
        applyIfEmpty('teleGlance.backendSharedSecret', seed.backendSharedSecret)
        applyIfEmpty('teleGlance.telegramApiId', seed.telegramApiId)
        applyIfEmpty('teleGlance.telegramApiHash', seed.telegramApiHash)
        applyIfEmpty('teleGlance.telegramSession', seed.telegramSession)
        try { window.localStorage.setItem('teleGlance.seedCredentialsApplied', '1') } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
})();
`

function teleGlanceFixtureBridge(): Plugin {
  let seedCredentials: Record<string, string> | null = null
  return {
    name: 'teleGlance-fixture-bridge',
    apply: 'serve',
    configResolved() {
      seedCredentials = loadSeedCredentials()
    },
    transformIndexHtml(html) {
      const injectParts: string[] = [seedBootScript]
      if (seedCredentials) {
        const escaped = JSON.stringify(seedCredentials).replace(/</g, '\\u003c')
        injectParts.push(`window.__teleGlanceSeedCredentials=${escaped};`)
      }
      return html.replace('</head>', `<script>${injectParts.join('')}</script></head>`)
    },
    configureServer(server) {
      server.middlewares.use('/api/test/seed-credentials', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ credentials: seedCredentials ?? null }))
      })
      server.middlewares.use('/api/test/fixture-commands', (_req, res) => {
        const commands = [...pendingFixtureCommands]
        pendingFixtureCommands = []
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ commands }))
      })
      server.middlewares.use('/api/test/fixture', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method not allowed')
          return
        }
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString('utf8')
        })
        req.on('end', () => {
          let command: FixtureCommand
          try {
            command = JSON.parse(body) as FixtureCommand
          } catch {
            res.statusCode = 400
            res.end('Invalid JSON')
            return
          }
          pendingFixtureCommands.push(command)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, command: command.kind }))
        })
      })
      server.middlewares.use('/api/test/console-marker', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, hasFixture: true }))
      })
    },
  }
}

export default defineConfig({
  envDir: '..',
  define: {
    __APP_VERSION__: JSON.stringify(appJson.version),
  },
  plugins: [
    react(),
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
    teleGlanceFixtureBridge(),
  ],
  test: {
    environment: 'node',
  },
})
