import type { TelegramAuthConfig } from './api'

const AUTH_AAD = new TextEncoder().encode('teleglance-auth-v1')
const AUTH_SALT = new TextEncoder().encode('TeleGlance encrypted auth v1')
const AUTH_PBKDF2_ITERATIONS = 200000

export async function encryptedTelegramAuthHeader(config: TelegramAuthConfig): Promise<string | null> {
  const sharedSecret = config.backendSharedSecret?.trim()
  const apiId = config.telegramApiId?.trim()
  const apiHash = config.telegramApiHash?.trim()
  if (!sharedSecret || !apiId || !apiHash) return null
  if (!globalThis.crypto?.subtle) {
    throw new Error('Encrypted backend auth requires WebCrypto. Use the packaged app, localhost, HTTPS, or a browser with WebCrypto support.')
  }

  const key = await deriveKey(sharedSecret)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const payload = new TextEncoder().encode(JSON.stringify({
    apiId,
    apiHash,
    session: config.telegramSession?.trim() || '',
    ts: Math.floor(Date.now() / 1000),
  }))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: AUTH_AAD },
    key,
    payload,
  ))
  return `v1.${base64Url(nonce)}.${base64Url(ciphertext)}`
}

export async function encryptJsonPayload(json: string, sharedSecret: string): Promise<string> {
  const key = await deriveKeyOrThrow(sharedSecret)
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(json)
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: AUTH_AAD },
    key,
    plaintext,
  ))
  return `v1.${base64Url(nonce)}.${base64Url(ciphertext)}`
}

export async function decryptJsonPayload(encryptedPayload: string, sharedSecret: string): Promise<string> {
  const key = await deriveKeyOrThrow(sharedSecret)
  const parts = encryptedPayload.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('Encrypted backend response is malformed')
  const nonce = base64UrlToBytes(parts[1])
  const ciphertext = base64UrlToBytes(parts[2])
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: AUTH_AAD },
    key,
    ciphertext,
  )
  return new TextDecoder().decode(plaintext)
}

async function deriveKey(sharedSecret: string) {
  return deriveKeyOrThrow(sharedSecret)
}

async function deriveKeyOrThrow(sharedSecret: string) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Encrypted backend auth requires WebCrypto. Use the packaged app, localhost, HTTPS, or a browser with WebCrypto support.')
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(sharedSecret),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: AUTH_SALT,
      iterations: AUTH_PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}
