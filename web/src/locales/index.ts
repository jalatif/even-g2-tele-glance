import en from './en'
import type { LocaleStrings } from './en'

let current: LocaleStrings = en

export function getLocale(): LocaleStrings {
  return current
}

export function setLocale(strings: LocaleStrings): void {
  current = strings
}

export type { LocaleStrings }
