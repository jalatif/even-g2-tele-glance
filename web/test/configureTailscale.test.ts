import { describe, expect, it } from 'vitest'
import { BACKEND_URL_PLACEHOLDER, updateAppJsonNetworkWhitelist } from '../../scripts/configure-tailscale-utils.mjs'

describe('configure-tailscale helper', () => {
  it('replaces the runtime placeholder and stays idempotent on repeated runs', () => {
    const appJson = {
      permissions: [
        {
          name: 'network',
          whitelist: [
            'http://localhost:8787',
            BACKEND_URL_PLACEHOLDER,
            'https://my.telegram.org',
            'https://react.dev/errors/',
            'https://teleglance.akira-os.net',
          ],
        },
      ],
    }

    updateAppJsonNetworkWhitelist(appJson, 'http://100.64.10.20:8787')
    expect(appJson.permissions?.[0]?.whitelist).toEqual([
      'http://localhost:8787',
      'http://100.64.10.20:8787',
      'https://my.telegram.org',
      'https://react.dev/errors/',
      'https://teleglance.akira-os.net',
    ])

    updateAppJsonNetworkWhitelist(appJson, 'http://100.64.10.20:8787')
    expect(appJson.permissions?.[0]?.whitelist).toEqual([
      'http://localhost:8787',
      'http://100.64.10.20:8787',
      'https://my.telegram.org',
      'https://react.dev/errors/',
      'https://teleglance.akira-os.net',
    ])
  })

  it('updates an already-substituted backend slot when the origin changes', () => {
    const appJson = {
      permissions: [
        {
          name: 'network',
          whitelist: [
            'http://localhost:8787',
            'http://100.64.10.20:8787',
            'https://my.telegram.org',
          ],
        },
      ],
    }

    updateAppJsonNetworkWhitelist(appJson, 'http://100.64.10.21:8787')
    expect(appJson.permissions?.[0]?.whitelist).toEqual([
      'http://localhost:8787',
      'http://100.64.10.21:8787',
      'https://my.telegram.org',
    ])
  })
})
