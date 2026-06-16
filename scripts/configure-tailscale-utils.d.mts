export const BACKEND_URL_PLACEHOLDER: string

export function normalizeBackendOrigin(value: string): string

export function updateAppJsonNetworkWhitelist<T>(appJson: T, backendOrigin: string): T
