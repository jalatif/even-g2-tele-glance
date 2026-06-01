import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backendPort = process.env.BACKEND_PORT ?? '8787'
const vitePort = process.env.VITE_PORT ?? '5173'

const ip = process.env.TAILSCALE_IP ?? detectTailscaleIp()
const backendOrigin = `http://${ip}:${backendPort}`
const frontendOrigin = `http://${ip}:${vitePort}`

const appJsonPath = join(repoRoot, 'app.json')
const appJson = JSON.parse(readFileSync(appJsonPath, 'utf8'))
const networkPermission = appJson.permissions?.find((permission) => permission.name === 'network')
if (!networkPermission) {
  throw new Error('app.json is missing the network permission.')
}
networkPermission.whitelist = unique([
  ...(networkPermission.whitelist ?? []),
  backendOrigin,
])
writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`)

console.log(`Tailscale backend URL: ${backendOrigin}`)
console.log(`Tailscale frontend URL: ${frontendOrigin}`)
console.log('Updated app.json network whitelist.')
console.log('Set this Backend URL in TeleGlance Settings if needed:')
console.log(backendOrigin)

function detectTailscaleIp() {
  try {
    return execFileSync('tailscale', ['ip', '-4'], { encoding: 'utf8' }).trim().split(/\s+/)[0]
  } catch (error) {
    throw new Error('Could not detect Tailscale IPv4 address. Install/login to Tailscale or set TAILSCALE_IP.')
  }
}

function unique(values) {
  return [...new Set(values)]
}
