import * as THREE from 'three'
import type { SessionState } from '../types'
import { DRAWN_ON_TOP } from './postfx'

export interface SignContent {
  name: string
  color: string
  counts: Record<SessionState, number>
  hiddenCount: number
  lit: boolean
}

// Order and glyphs follow HANDOFF 8.3. Colours are only for the glyph on the dark count strip.
const GLYPHS: Array<[SessionState, string, string]> = [
  ['running', '⚙', '#7fc4ff'],
  ['waiting', '!', '#ffd34d'],
  ['finished', '✓', '#6fe08f'],
  ['idle', '…', '#c9ced8'],
  ['sleeping', 'zZ', '#b6a4ff'],
]
const FONT = '-apple-system, "PingFang TC", "Helvetica Neue", Arial, sans-serif'
// Logical canvas size in CSS px at full size; the backing store is multiplied by the pixel ratio (and 2x oversampling).
const LW = 240
const LH = 56
const NAME_PX = 15
const COUNT_PX = 12
const COUNT_MIN_PX = 10
// Signs keep a constant screen size (sizeAttenuation off). Up to FULL_UNTIL projects they are full size, then they shrink
// to MIN_SCALE so a dense town does not pile signs on top of each other.
const FULL_UNTIL = 8
const MIN_SCALE = 0.7
const SHRINK_PER_PROJECT = 0.02
const live = new Set<Sign>()
const size = new THREE.Vector2()

// Name ink: white (with a shadow) while it keeps at least MIN_WHITE_CONTRAST against the plate, dark ink on lighter plates.
const MIN_WHITE_CONTRAST = 3 // WCAG large-text level; bold 15 px text with a shadow reads fine down to here
const INK_WHITE = '#ffffff'
const INK_DARK = '#1c2230'
// The overlay drawn over the plate of a lot without sessions (draw() paints it, nameInk() accounts for it).
const UNLIT_TINT = [8, 10, 18]
const UNLIT_ALPHA = 0.5

export interface NameInk {
  fill: string
  shadow: boolean
}

/** '#rgb' or '#rrggbb' (any case) as [r, g, b] 0-255; null for anything else. */
function parseHex(hex: string): number[] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
}

/** WCAG relative luminance of a hex colour: 0 (black) to 1 (white). Anything unparseable counts as black. */
export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex) ?? [0, 0, 0]
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two hex colours: 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** The project colour as painted on the name plate: darkened by the overlay when the lot has no sessions. */
function plateColor(color: string, lit: boolean): string {
  const rgb = parseHex(color)
  if (lit || !rgb) return color
  const mixed = rgb.map((v, i) => Math.round(v * (1 - UNLIT_ALPHA) + UNLIT_TINT[i] * UNLIT_ALPHA))
  return `#${mixed.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Text style for the project name on its plate: white with a shadow, or dark ink without one when white would be too faint. */
export function nameInk(color: string, lit: boolean): NameInk {
  const white = contrastRatio(INK_WHITE, plateColor(color, lit)) >= MIN_WHITE_CONTRAST
  return white ? { fill: INK_WHITE, shadow: true } : { fill: INK_DARK, shadow: false }
}

/** Billboard sprite (origin = bottom-centre) that always faces the camera. */
export class Sign {
  readonly object: THREE.Object3D
  lines: string[] = []
  private readonly sprite: THREE.Sprite
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private lit = false
  private plateLum = 0
  private key = ''
  private level = 1
  private lastUnit = 0

  constructor() {
    const scale = Math.max(1, Math.min(window.devicePixelRatio || 1, 2)) * 2
    this.canvas.width = LW * scale
    this.canvas.height = LH * scale
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 4
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, fog: false, transparent: true, sizeAttenuation: false, ...DRAWN_ON_TOP }))
    this.sprite.center.set(0.5, 0)
    this.sprite.frustumCulled = false // the world scale below is not the on-screen size
    this.sprite.onBeforeRender = (renderer, _scene, camera) => this.fitToScreen(renderer, camera)
    live.add(this)
    // Drawn over roof props (dish, stacks) so the counts and +N are never clipped.
    this.sprite.renderOrder = 3 // above the street glow, below people effects (labels 4, bubble 8)
    this.object = this.sprite
    this.applyGlow()
  }

  set(c: SignContent): void {
    const parts = GLYPHS.filter(([s]) => c.counts[s] > 0).map(([s, g, col]) => ({ text: `${g} ${c.counts[s]}`, col }))
    if (c.hiddenCount > 0) parts.push({ text: `+${c.hiddenCount}`, col: '#ffffff' })
    this.lines = parts.length ? [c.name, parts.map((p) => p.text).join('  ')] : [c.name]
    this.lit = c.lit
    this.plateLum = relativeLuminance(plateColor(c.color, c.lit))
    // Skip the redraw and texture upload when nothing visible changed.
    const key = JSON.stringify([c.name, c.color, c.lit, parts])
    if (key !== this.key) {
      this.key = key
      this.draw(c, parts)
    }
    this.applyGlow()
  }

  setLightLevel(level: number): void {
    this.level = level
    this.applyGlow()
  }

  dispose(): void {
    live.delete(this)
    this.texture.dispose()
    this.sprite.material.dispose()
  }

  /** With sizeAttenuation off, scale 1 spans 2 / projection[1][1] / viewportHeight CSS px per px; pick the scale for 1:1 pixels. */
  private fitToScreen(renderer: THREE.WebGLRenderer, camera: THREE.Camera): void {
    renderer.getSize(size)
    const k = Math.max(MIN_SCALE, Math.min(1, 1 - (live.size - FULL_UNTIL) * SHRINK_PER_PROJECT))
    const unit = (k * 2) / (camera.projectionMatrix.elements[5] * size.y)
    if (unit === this.lastUnit || !Number.isFinite(unit)) return
    this.lastUnit = unit
    this.sprite.scale.set(LW * unit, LH * unit, 1)
    this.sprite.updateMatrixWorld(true)
  }

  private applyGlow(): void {
    // Colour above 1 feeds the bloom pass: faint by day, strong at night. Unlit signs stay readable but dim.
    // A light plate stays at the bloom threshold (1.0) at most: its bloom would veil the dark name text.
    const boost = this.lit ? 1 + (1 - this.level) * 0.3 : 0.75 + (1 - this.level) * 0.1
    this.sprite.material.color.setScalar(Math.min(boost, 1 / Math.max(this.plateLum, 0.01)))
  }

  private draw(c: SignContent, parts: Array<{ text: string; col: string }>): void {
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const s = this.canvas.width / LW
    ctx.setTransform(s, 0, 0, s, 0, 0)
    ctx.clearRect(0, 0, LW, LH)
    ctx.textBaseline = 'middle'

    // Line 1: name on a project-colour block (darkened when the lot has no sessions); white, or dark ink on light colours.
    ctx.font = `700 ${NAME_PX}px ${FONT}`
    const name = fit(ctx, c.name, LW - 28)
    const nameW = Math.min(LW - 4, Math.max(72, ctx.measureText(name).width + 28))
    const top = parts.length ? 2 : LH - 29 // the sprite sits on its bottom edge, so a name-only sign drops to it
    ctx.fillStyle = c.color
    ctx.beginPath()
    ctx.roundRect((LW - nameW) / 2, top, nameW, 27, 6)
    ctx.fill()
    // Bevel: a lighter top lip and a darker base line make the board read as a physical sign.
    ctx.save()
    ctx.clip()
    ctx.fillStyle = 'rgba(255,255,255,0.24)'
    ctx.fillRect((LW - nameW) / 2, top, nameW, 2)
    ctx.fillStyle = 'rgba(0,0,0,0.16)'
    ctx.fillRect((LW - nameW) / 2, top + 24, nameW, 3)
    ctx.restore()
    if (!c.lit) {
      ctx.fillStyle = `rgba(${UNLIT_TINT.join(',')},${UNLIT_ALPHA})`
      ctx.fill()
    }
    const ink = nameInk(c.color, c.lit)
    ctx.fillStyle = ink.fill
    ctx.textAlign = 'center'
    if (ink.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.55)' // keeps white readable on mid-tone project colours
      ctx.shadowBlur = 3
      ctx.shadowOffsetY = 1
    }
    ctx.fillText(name, LW / 2, top + 14)
    ctx.shadowColor = 'transparent'

    // Line 2: counts on a dark strip, glyph colours per state.
    if (parts.length) {
      ctx.textAlign = 'left'
      // Shrink the font until every part fits on the strip.
      let px = COUNT_PX
      let gap = 8
      let widths: number[] = []
      let total = 0
      for (; px >= COUNT_MIN_PX; px--) {
        ctx.font = `700 ${px}px ${FONT}`
        gap = px * 0.7
        widths = parts.map((p) => ctx.measureText(p.text).width)
        total = widths.reduce((a, b) => a + b, 0) + gap * (parts.length - 1)
        if (total + 20 <= LW - 4) break
      }
      const w = Math.min(LW - 4, total + 20)
      ctx.fillStyle = 'rgba(10,13,22,0.9)'
      ctx.beginPath()
      ctx.roundRect((LW - w) / 2, 32, w, 22, 6)
      ctx.fill()
      let x = (LW - total) / 2
      parts.forEach((p, i) => {
        ctx.fillStyle = p.col
        ctx.fillText(p.text, x, 43.5)
        x += widths[i] + gap
      })
    }
    this.texture.needsUpdate = true
  }
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let t = text
  while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1)
  return t + '…'
}
