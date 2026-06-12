import en from './en'
import type { LocaleStrings } from './en'
import es from './es'
import fr from './fr'
import de from './de'
import it from './it'
import pt from './pt'
import nl from './nl'
import sv from './sv'
import pl from './pl'
import tr from './tr'
import cs from './cs'
import ro from './ro'
import hu from './hu'
import vi from './vi'
import fi from './fi'
import no from './no'
import da from './da'
import id from './id'
import ca from './ca'
import sk from './sk'
import ja from './ja'
import ko from './ko'
import zh from './zh'
import ms from './ms'

let current: LocaleStrings = en

export function getLocale(): LocaleStrings {
  return current
}

export function setLocale(strings: LocaleStrings): void {
  current = strings
}

/** Full language names shown in the Settings UI. */
export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
  it: 'Italiano',
  pt: 'Português',
  nl: 'Nederlands',
  sv: 'Svenska',
  pl: 'Polski',
  tr: 'Türkçe',
  cs: 'Čeština',
  ro: 'Română',
  hu: 'Magyar',
  vi: 'Tiếng Việt',
  fi: 'Suomi',
  no: 'Norsk',
  da: 'Dansk',
  id: 'Bahasa Indonesia',
  ca: 'Català',
  sk: 'Slovenčina',
  ja: '日本語 (Rōmaji)',
  ko: '한국어 (Romaja)',
  zh: '中文 (Pīnyīn)',
  ms: 'Bahasa Melayu',
}

const CODE_TO_LOCALE: Record<string, LocaleStrings> = {
  en, es, fr, de, it, pt, nl, sv, pl, tr, cs, ro, hu, vi, fi, no, da, id, ca, sk, ja, ko, zh, ms,
}

export function localeFromCode(code: string): LocaleStrings {
  return CODE_TO_LOCALE[code] ?? en
}

export type { LocaleStrings }
