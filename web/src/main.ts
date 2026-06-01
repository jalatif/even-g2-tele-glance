import './style.css'
import { defaultApiBaseUrl, HttpTelegramApi } from './api'
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
  if (model.kind === 'list') {
    root.innerHTML = `<section><h1>${escapeHtml(model.title)}</h1><ol>${model.items
      .map((item, index) => `<li${index === model.selectedIndex ? ' aria-current="true"' : ''}>${escapeHtml(item)}</li>`)
      .join('')}</ol></section>`
    return
  }
  const qrImage = model.qrImageUrl
    ? `<img class="qr-code" alt="Telegram login QR" src="${escapeHtml(`${apiBaseUrl}${model.qrImageUrl}`)}" />`
    : ''
  const footer = model.footer ? `<footer>${escapeHtml(model.footer)}</footer>` : ''
  root.innerHTML = `<section><h1>${escapeHtml(model.title)}</h1>${qrImage}<pre>${escapeHtml(model.body)}</pre>${footer}</section>`
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
