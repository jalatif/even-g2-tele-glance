import { readFileSync } from 'fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'

const appJson = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf-8')) as { version: string }

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
  ],
  test: {
    environment: 'node',
  },
})
