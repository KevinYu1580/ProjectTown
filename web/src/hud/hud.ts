import type { SessionState, TownState } from '../types'
import { t } from '../i18n'
import type { Locale } from '../i18n'
import './hud.css'

const MAX_ROWS = 8
const GLYPHS: Array<[SessionState, string]> = [
  ['running', '⚙'], ['waiting', '!'], ['finished', '✓'], ['idle', '…'], ['sleeping', 'zZ'],
]

function el(tag: string, cls: string, text?: string, testid?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  if (text !== undefined) e.textContent = text
  if (testid) e.setAttribute('data-testid', testid)
  return e
}

/** DOM overlay, bottom-left. Re-rendered wholesale; the panel is tiny. */
export class Hud {
  private readonly panel = el('div', 'hud', undefined, 'hud')

  constructor(root: HTMLElement) {
    this.panel.hidden = true
    root.appendChild(this.panel)
  }

  render(state: TownState, opts: { locale: Locale; visible: boolean }): void {
    this.panel.hidden = !opts.visible
    const { locale } = opts
    const children: HTMLElement[] = []

    if (!state.dataSourceOk) children.push(el('div', 'hud-error', t(locale, 'hud.dataSourceError'), 'hud-error'))

    const total = state.projects.reduce((n, p) => n + p.sessions.length, 0)
    const head = el('div', 'hud-head')
    head.append(el('span', 'hud-title', 'ProjectTown'), el('span', 'hud-total', t(locale, 'hud.sessionCount', { n: total }), 'hud-total'))
    children.push(head)

    // Over 8 projects: list only those with sessions; still over 8: first 8 plus a "more" line.
    const listed = state.projects.length > MAX_ROWS ? state.projects.filter((p) => p.sessions.length > 0) : state.projects
    const shown = listed.slice(0, MAX_ROWS)
    for (const p of shown) {
      const row = el('div', p.sessions.length ? 'hud-row' : 'hud-row is-empty', undefined, 'hud-row')
      const dot = el('span', 'hud-dot')
      dot.style.background = p.color
      const counts = el('span', 'hud-counts')
      for (const [s, glyph] of GLYPHS) {
        const n = p.sessions.filter((x) => x.state === s).length
        if (n > 0) {
          const c = el('span', `hud-count s-${s}`, `${glyph} ${n}`)
          c.setAttribute('aria-label', `${t(locale, `state.${s}`)} ${n}`)
          counts.appendChild(c)
        }
      }
      row.append(dot, el('span', 'hud-name', p.name), counts)
      children.push(row)
    }
    const more = listed.length - shown.length
    if (more > 0) children.push(el('div', 'hud-more', t(locale, 'hud.moreProjects', { n: more }), 'hud-more'))

    this.panel.replaceChildren(...children)
  }

  dispose(): void {
    this.panel.remove()
  }
}
