import './style.css'
import { API_BASE_URL_STORAGE_KEY, defaultApiBaseUrl, HttpTelegramApi } from './api'
import { TelegramAppController } from './controller/appController'
import { screenModel } from './controller/model'
import { EvenHubGlassesBridge } from './bridge/evenBridge'

async function bootstrap() {
  const root = document.querySelector<HTMLElement>('#app')
  const api = new HttpTelegramApi()
  let controller: TelegramAppController

  const bridge = await EvenHubGlassesBridge.create((input) => controller.dispatch(input))
  controller = new TelegramAppController(api, {
    render: async (model) => {
      renderDebug(root, model, defaultApiBaseUrl())
      await bridge.render(model)
    },
    setAudioEnabled: (enabled) => bridge.setAudioEnabled(enabled),
  })

  await controller.init()
}

function renderDebug(root: HTMLElement | null, model: ReturnType<typeof screenModel>, apiBaseUrl: string) {
  if (!root) return
  const settings = renderSettings(apiBaseUrl)
  if (model.kind === 'list') {
    root.innerHTML = `${settings}<section><h1>${escapeHtml(model.title)}</h1><ol>${model.items
      .map((item, index) => `<li${index === model.selectedIndex ? ' aria-current="true"' : ''}>${escapeHtml(item)}</li>`)
      .join('')}</ol></section>`
    bindSettings(root)
    return
  }
  const qrImage = model.qrImageUrl
    ? `<img class="qr-code" alt="Telegram login QR" src="${escapeHtml(`${apiBaseUrl}${model.qrImageUrl}`)}" />`
    : ''
  const footer = model.footer ? `<footer>${escapeHtml(model.footer)}</footer>` : ''
  root.innerHTML = `${settings}<section><h1>${escapeHtml(model.title)}</h1>${qrImage}<pre>${escapeHtml(model.body)}</pre>${footer}</section>`
  bindSettings(root)
}

function renderSettings(apiBaseUrl: string) {
  return `<form class="phone-settings" id="phone-settings">
    <label>
      Backend URL
      <input id="api-base-url" value="${escapeHtml(apiBaseUrl)}" placeholder="http://100.x.x.x:8787" />
    </label>
    <button type="submit">Save</button>
    <button type="button" id="reset-api-base-url">Reset</button>
  </form>`
}

function bindSettings(root: HTMLElement) {
  const form = root.querySelector<HTMLFormElement>('#phone-settings')
  const input = root.querySelector<HTMLInputElement>('#api-base-url')
  const reset = root.querySelector<HTMLButtonElement>('#reset-api-base-url')
  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    const value = input?.value.trim() ?? ''
    if (value) window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, value)
    else window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY)
    window.location.reload()
  })
  reset?.addEventListener('click', () => {
    window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY)
    window.location.reload()
  })
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    }
    return entities[char]
  })
}

void bootstrap().catch((error) => {
  const root = document.querySelector<HTMLElement>('#app')
  if (root) root.textContent = error instanceof Error ? error.message : 'Startup failed'
  console.error(error)
})
