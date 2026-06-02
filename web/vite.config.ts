import { readFileSync } from 'fs'
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

const fixtureBridgeScript = `
(() => {
  if (typeof window === 'undefined') return
  const fixture = window.__teleGlanceFixture
  if (!fixture) return
  const onReady = () => {
    window.__teleGlanceFixtureReady = true
  }
  if (fixture) onReady()
})();
`

function teleGlanceFixtureBridge(): Plugin {
  return {
    name: 'teleGlance-fixture-bridge',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        '</head>',
        `<script>${fixtureBridgeScript}</script></head>`,
      )
    },
    configureServer(server) {
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
