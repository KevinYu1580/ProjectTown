import { en } from './en'
import { zhHant } from './zh-Hant'

export type MessageKey = keyof typeof en
export type Locale = 'zh-Hant' | 'en'

const dictionaries: Record<Locale, Record<MessageKey, string>> = { en, 'zh-Hant': zhHant }

/**
 * Looks up a message and fills `{name}` placeholders. When `params.n === 1` and a `<key>.one`
 * variant exists, that one is used (singular wording).
 */
export function t(locale: Locale, key: MessageKey, params?: Record<string, string | number>): string {
  const dict = dictionaries[locale]
  const oneKey = `${key}.one` as MessageKey
  const template = params?.n === 1 && oneKey in dict ? dict[oneKey] : dict[key]
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in params ? String(params[name]) : m))
}

const formatters = new Map<Locale, Intl.RelativeTimeFormat>()

/** "3 minutes ago" / "3 分鐘前"; under a minute (or a future timestamp) reads "now" / "現在". */
export function formatRelativeTime(locale: Locale, fromMs: number, nowMs: number): string {
  let fmt = formatters.get(locale)
  if (!fmt) {
    fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    formatters.set(locale, fmt)
  }
  const seconds = Math.max(0, Math.floor((nowMs - fromMs) / 1000))
  if (seconds < 60) return fmt.format(0, 'second')
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return fmt.format(-minutes, 'minute')
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return fmt.format(-hours, 'hour')
  return fmt.format(-Math.floor(hours / 24), 'day')
}
