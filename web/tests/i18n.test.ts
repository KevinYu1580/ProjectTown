import { describe, expect, it } from 'vitest'
import { en } from '../src/i18n/en'
import { formatRelativeTime, t } from '../src/i18n'
import { zhHant } from '../src/i18n/zh-Hant'

describe('dictionaries', () => {
  it('have exactly the same keys', () => {
    expect(Object.keys(zhHant).sort()).toEqual(Object.keys(en).sort())
  })

  it('have no empty strings and the same placeholders per key', () => {
    const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort()
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(en[key].length).toBeGreaterThan(0)
      expect(zhHant[key].length).toBeGreaterThan(0)
      expect(placeholders(zhHant[key])).toEqual(placeholders(en[key]))
    }
  })

  it('use the mandatory terminology', () => {
    const table: Array<[keyof typeof en, string, string]> = [
      ['state.running', '執行中', 'Running'],
      ['state.waiting', '等你回應', 'Needs you'],
      ['state.finished', '剛完成', 'Just finished'],
      ['state.idle', '閒置', 'Idle'],
      ['state.sleeping', '睡著', 'Sleeping'],
      ['session.unnamed', '(session 無名稱)', '(unnamed session)'],
    ]
    for (const [key, zh, enText] of table) {
      expect(t('zh-Hant', key)).toBe(zh)
      expect(t('en', key)).toBe(enText)
    }
  })
})

describe('t', () => {
  it('interpolates {n}', () => {
    expect(t('en', 'camera.preset', { n: 3 })).toBe('View 3')
    expect(t('zh-Hant', 'camera.preset', { n: 3 })).toBe('視角 3')
    expect(t('en', 'hud.moreProjects', { n: 4 })).toBe('4 more projects')
    expect(t('zh-Hant', 'hud.moreProjects', { n: 4 })).toBe('還有 4 個專案')
  })

  it('uses singular wording for n = 1 in English', () => {
    expect(t('en', 'hud.sessionCount', { n: 1 })).toBe('1 session')
    expect(t('en', 'hud.sessionCount', { n: 0 })).toBe('0 sessions')
    expect(t('en', 'hud.sessionCount', { n: 5 })).toBe('5 sessions')
    expect(t('en', 'hud.moreProjects', { n: 1 })).toBe('1 more project')
    expect(t('zh-Hant', 'hud.sessionCount', { n: 1 })).toBe('1 個 session')
    expect(t('zh-Hant', 'hud.sessionCount', { n: 5 })).toBe('5 個 session')
  })

  it('returns the contract strings for fixed messages', () => {
    expect(t('en', 'hud.dataSourceError')).toBe('Claude Code session data not found')
    expect(t('zh-Hant', 'hud.dataSourceError')).toBe('找不到 Claude Code 的 session 資料')
    expect(t('en', 'empty.hint')).toBe('Open Settings from the menu bar to add your first project')
    expect(t('zh-Hant', 'empty.hint')).toBe('從 menubar 開啟設定，新增你的第一個專案')
    expect(t('en', 'camera.help')).toBe('Drag to rotate · Scroll to zoom · Right-drag or two-finger drag to pan')
    expect(t('zh-Hant', 'camera.help')).toBe('拖曳旋轉・捲動縮放・右鍵或雙指拖曳平移')
    expect(t('zh-Hant', 'camera.reset')).toBe('重設')
    expect(t('zh-Hant', 'camera.cancel')).toBe('取消')
    expect(t('zh-Hant', 'camera.done')).toBe('完成')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(t('en', 'camera.preset', { x: 1 })).toBe('View {n}')
  })
})

describe('formatRelativeTime', () => {
  const now = 1_800_000_000_000
  const ago = (ms: number) => now - ms

  it('reads "now" under a minute (and for future timestamps)', () => {
    expect(formatRelativeTime('en', ago(0), now)).toBe('now')
    expect(formatRelativeTime('en', ago(59_000), now)).toBe('now')
    expect(formatRelativeTime('en', now + 5000, now)).toBe('now')
    expect(formatRelativeTime('zh-Hant', ago(30_000), now)).toBe('現在')
  })

  it('formats minutes, hours and days', () => {
    expect(formatRelativeTime('en', ago(3 * 60_000), now)).toBe('3 minutes ago')
    expect(formatRelativeTime('zh-Hant', ago(3 * 60_000), now)).toBe('3 分鐘前')
    expect(formatRelativeTime('en', ago(60_000), now)).toBe('1 minute ago')
    expect(formatRelativeTime('en', ago(59 * 60_000 + 59_000), now)).toBe('59 minutes ago')
    expect(formatRelativeTime('en', ago(2 * 3600_000), now)).toBe('2 hours ago')
    expect(formatRelativeTime('zh-Hant', ago(5 * 3600_000), now)).toBe('5 小時前')
    expect(formatRelativeTime('en', ago(3 * 86_400_000), now)).toBe('3 days ago')
    expect(formatRelativeTime('en', ago(86_400_000), now)).toBe('yesterday')
    expect(formatRelativeTime('zh-Hant', ago(3 * 86_400_000), now)).toBe('3 天前')
  })
})
