import { t } from '../i18n'
import type { Locale } from '../i18n'

export interface ToolbarHandlers {
  onPreset(index: 0 | 1 | 2 | 3): void
  onReset(): void
  onCancel(): void
  onDone(): void
}

const CSS = `
.ptcam { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 20; box-sizing: border-box;
  max-width: calc(100vw - 32px); padding: 10px 12px 9px; border-radius: 16px; text-align: center;
  background: rgba(14, 18, 28, 0.72); border: 1px solid rgba(255, 255, 255, 0.14);
  -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  color: #eef1f7; font: 13px/1.3 -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; user-select: none; }
.ptcam-row { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; }
.ptcam-sep { width: 1px; align-self: stretch; margin: 2px 4px; background: rgba(255, 255, 255, 0.16); }
.ptcam button { padding: 5px 11px; border-radius: 9px; border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08); color: inherit; font: inherit; cursor: pointer; }
.ptcam button:hover { background: rgba(255, 255, 255, 0.18); }
.ptcam button:active { background: rgba(255, 255, 255, 0.26); }
.ptcam button:focus-visible { outline: 2px solid #7db4ff; outline-offset: 1px; }
.ptcam button.ptcam-primary { background: #3b82f6; border-color: #3b82f6; color: #fff; font-weight: 600; }
.ptcam button.ptcam-primary:hover { background: #5a96f8; }
.ptcam-help { margin-top: 8px; opacity: 0.72; font-size: 12px; }
`

export class CameraToolbar {
  private readonly panel = document.createElement('div')
  private readonly texts: Array<[HTMLElement, (locale: Locale) => string]> = []

  constructor(parent: HTMLElement, locale: Locale, h: ToolbarHandlers) {
    this.panel.className = 'ptcam'
    this.panel.setAttribute('role', 'toolbar')
    this.panel.setAttribute('data-testid', 'camera-toolbar')

    const style = document.createElement('style')
    style.textContent = CSS
    const row = document.createElement('div')
    row.className = 'ptcam-row'
    const button = (id: string, label: (locale: Locale) => string, onClick: () => void, primary = false) => {
      const b = document.createElement('button')
      b.type = 'button'
      this.texts.push([b, label])
      b.setAttribute('data-testid', `camera-${id}`)
      if (primary) b.className = 'ptcam-primary'
      b.addEventListener('click', () => {
        onClick()
        b.blur()
      })
      row.appendChild(b)
    }
    for (const i of [0, 1, 2, 3] as const) button(`preset-${i + 1}`, (l) => t(l, 'camera.preset', { n: i + 1 }), () => h.onPreset(i))
    const sep = document.createElement('div')
    sep.className = 'ptcam-sep'
    row.appendChild(sep)
    button('reset', (l) => t(l, 'camera.reset'), h.onReset)
    button('cancel', (l) => t(l, 'camera.cancel'), h.onCancel)
    button('done', (l) => t(l, 'camera.done'), h.onDone, true)

    const help = document.createElement('div')
    help.className = 'ptcam-help'
    this.texts.push([help, (l) => t(l, 'camera.help')])
    this.setLocale(locale)
    this.panel.append(style, row, help)
    parent.appendChild(this.panel)
  }

  setLocale(locale: Locale): void {
    for (const [el, label] of this.texts) el.textContent = label(locale)
  }

  dispose(): void {
    this.panel.remove()
  }
}
