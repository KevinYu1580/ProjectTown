import * as THREE from 'three'
import { DRAWN_ON_TOP } from '../postfx'
import { PX } from './effects'

const CSS_W = 440
const CSS_H = 44
const FONT_PX = 20
const PAD = 11
const MAX_TEXT = 410
/** On-screen height of the pill, in pixels (the label keeps this size at any zoom). */
export const LABEL_PX = 24
const FONT = '-apple-system, "PingFang TC", "Helvetica Neue", sans-serif'

/** Name + relative time pill above a head. Fixed-size canvas so the GPU texture is never re-allocated. */
export class NameLabel {
  readonly sprite: THREE.Sprite
  private readonly canvas = document.createElement('canvas')
  private readonly texture: THREE.CanvasTexture
  private text = ''

  constructor() {
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(CSS_W * scale)
    this.canvas.height = Math.round(CSS_H * scale)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: this.texture, transparent: true, fog: false, sizeAttenuation: false, ...DRAWN_ON_TOP }),
    )
    this.sprite.center.set(0.5, 0)
    this.setUnit(1)
    this.sprite.renderOrder = 4
  }

  /** `unit` compensates a scaled parent so the pill keeps its pixel size. */
  setUnit(unit: number): void {
    this.sprite.scale.set(((LABEL_PX * CSS_W) / CSS_H) * PX * unit, LABEL_PX * PX * unit, 1)
  }

  /** Raise the pill by `rows` pill-heights (screen space), e.g. above a bubble or a neighbour's label. */
  set lift(rows: number) {
    this.sprite.center.set(0.5, -rows)
  }

  set opacity(v: number) {
    this.sprite.material.opacity = v
  }

  get content(): string {
    return this.text
  }

  setText(text: string): void {
    if (text === this.text) return
    this.text = text
    const ctx = this.canvas.getContext('2d')
    if (!ctx) return
    const s = this.canvas.width / CSS_W
    ctx.setTransform(s, 0, 0, s, 0, 0)
    ctx.clearRect(0, 0, CSS_W, CSS_H)
    ctx.font = `600 ${FONT_PX}px ${FONT}`
    let shown = text
    while (shown.length > 1 && ctx.measureText(shown).width > MAX_TEXT) shown = shown.slice(0, -1)
    if (shown !== text) shown = `${shown.trimEnd()}…`
    const w = Math.ceil(ctx.measureText(shown).width) + PAD * 2
    const x = (CSS_W - w) / 2
    ctx.fillStyle = 'rgba(14, 18, 28, 0.78)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(x, 4, w, CSS_H - 8, (CSS_H - 8) / 2)
    ctx.fill()
    ctx.stroke()
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(shown, CSS_W / 2, CSS_H / 2 + 1)
    this.texture.needsUpdate = true
  }

  dispose(): void {
    this.texture.dispose()
    this.sprite.material.dispose()
  }
}
