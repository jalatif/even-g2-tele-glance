export const BACKEND_URL_PLACEHOLDER = 'http://<BACKEND_URL>:8787'

const FIXED_WHITELIST_ENTRIES = new Set([
  'http://localhost:8787',
  'http://127.0.0.1:8787',
  BACKEND_URL_PLACEHOLDER,
  'https://my.telegram.org',
  'https://react.dev/errors/',
])

export function normalizeBackendOrigin(value) {
  try {
    return new URL(value).origin
  } catch {
    throw new Error(`Invalid backend origin: ${value}`)
  }
}

export function updateAppJsonNetworkWhitelist(appJson, backendOrigin) {
  const networkPermission = appJson.permissions?.find((permission) => permission.name === 'network')
  if (!networkPermission) {
    throw new Error('app.json is missing the network permission.')
  }

  const whitelist = [...(networkPermission.whitelist ?? [])]
  const placeholderIndex = whitelist.indexOf(BACKEND_URL_PLACEHOLDER)
  if (placeholderIndex !== -1) {
    whitelist[placeholderIndex] = backendOrigin
  } else {
    const existingIndex = whitelist.findIndex((value) => shouldReplaceWhitelistEntry(value, backendOrigin))
    if (existingIndex !== -1) {
      whitelist[existingIndex] = backendOrigin
    } else if (!whitelist.includes(backendOrigin)) {
      throw new Error(`app.json network whitelist is missing a backend slot. Restore ${BACKEND_URL_PLACEHOLDER} and rerun the configurator.`)
    }
  }

  networkPermission.whitelist = unique(whitelist)
  return appJson
}

function shouldReplaceWhitelistEntry(value, backendOrigin) {
  if (value === backendOrigin) return false
  if (FIXED_WHITELIST_ENTRIES.has(value)) return false
  return /^https?:\/\/[^/]+(?::\d+)?$/.test(value)
}

function unique(values) {
  return [...new Set(values)]
}
