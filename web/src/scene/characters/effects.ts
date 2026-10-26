import * as THREE from 'three'

// Screen-space sprites (sizeAttenuation off) keep their pixel size at any zoom: one scale unit = PX pixels
// at a 982 px tall viewport with the 30 degree FOV.
export const PX = Math.tan(Math.PI / 12) / 491
export const BUBBLE_PX = 52
export const BOUNCE_PX = 10
export const STAGGER_PX = 28 // odd slots raise their bubble so neighbours do not coincide
export const GEAR_PX = 24
export const GEAR_GAP = 0.7 // world units between head top and gear centre

/** Soft lavender-white glyph with a thin translucent outline, scaled to fill the canvas height (a "z" is as tall as "Z"). */
function glyphTexture(ch: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 96
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.font = '800 80px -apple-system, "Helvetica Neue", sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    const m = ctx.measureText(ch)
    const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent
    const k = h > 0 ? Math.min(2, 64 / h) : 1
    ctx.translate(48, 48)
    ctx.scale(k, k)
    ctx.translate(0, (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2)
    ctx.lineJoin = 'round'
    ctx.lineWidth = 9 / k
    ctx.strokeStyle = 'rgba(50,44,112,0.7)'
    ctx.strokeText(ch, 0, 0)
    ctx.fillStyle = '#e9e4ff'
    ctx.fillText(ch, 0, 0)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Eight-toothed gear with a dark outline and a hub hole. */
function gearTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.translate(64, 64)
    ctx.beginPath()
    for (let i = 0; i < 16; i++) {
      const a0 = (i / 16) * Math.PI * 2
      const a1 = ((i + 1) / 16) * Math.PI * 2
      const r = i % 2 === 0 ? 56 : 40
      // Each tooth/gap is a flat-topped segment.
      ctx.lineTo(Math.cos(a0 + 0.04) * r, Math.sin(a0 + 0.04) * r)
      ctx.lineTo(Math.cos(a1 - 0.04) * r, Math.sin(a1 - 0.04) * r)
    }
    ctx.closePath()
    ctx.lineJoin = 'round'
    ctx.lineWidth = 14
    ctx.strokeStyle = '#14304f'
    ctx.stroke()
    ctx.fillStyle = '#8fdcff'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(0, 0, 17, 0, Math.PI * 2)
    ctx.fillStyle = '#14304f'
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

const BUBBLE_W = 128
const BUBBLE_H = 144

/** Yellow speech bubble with a dark outline and an "!". */
function bubbleTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = BUBBLE_W
  c.height = BUBBLE_H
  const ctx = c.getContext('2d')
  if (ctx) {
    const shape = (): void => {
      ctx.beginPath()
      ctx.roundRect(14, 10, 100, 100, 30)
      ctx.moveTo(48, 104)
      ctx.lineTo(64, 138)
      ctx.lineTo(80, 104)
      ctx.closePath()
    }
    ctx.lineJoin = 'round'
    ctx.lineWidth = 14
    ctx.strokeStyle = '#4a2f00'
    shape()
    ctx.stroke()
    ctx.fillStyle = '#ffc400'
    shape()
    ctx.fill()
    ctx.fillStyle = '#4a2f00'
    ctx.beginPath()
    ctx.roundRect(54, 30, 20, 46, 8)
    ctx.fill()
    ctx.beginPath()
    ctx.arc(64, 91, 11, 0, Math.PI * 2)
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function haloTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  return new THREE.CanvasTexture(c)
}

export interface Bang {
  group: THREE.Group
  bubble: THREE.Sprite
  halo: THREE.Sprite
}

export const HALO_PX = 150

/** Materials shared by every person's head effects (gear, "!" bubble, green ring). */
export class Effects {
  readonly zTextures: [THREE.Texture, THREE.Texture] = [glyphTexture('z'), glyphTexture('Z')]
  private readonly halo = haloTexture()
  private readonly gearTex = gearTexture()
  // A gear needs its own material (the sprite spin is a material property); they all follow the night tint.
  private readonly gearMats = new Set<THREE.SpriteMaterial>()
  private readonly bubble = bubbleTexture()
  // Drawn on top and at a fixed screen size: the "!" must be the most visible thing wherever the person stands.
  private readonly bangMat = new THREE.SpriteMaterial({
    map: this.bubble, transparent: true, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false,
  })
  private readonly ringMat = new THREE.MeshBasicMaterial({
    color: 0x45ff80, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  })
  private readonly haloMat = new THREE.SpriteMaterial({
    map: this.halo, color: 0xffc928, transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.AdditiveBlending, fog: false, sizeAttenuation: false,
  })
  private readonly ringGeo = new THREE.RingGeometry(0.5, 0.78, 28).rotateX(-Math.PI / 2)
  private night = 0

  constructor() {
    this.setLightLevel(1)
  }

  /** Spinning gear: a screen-space sprite drawn on top (desks sit behind the storefront, which hides the head). */
  makeGear(): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({
      map: this.gearTex, transparent: true, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false,
    })
    mat.color.setScalar(1 + 0.4 * this.night)
    this.gearMats.add(mat)
    const s = new THREE.Sprite(mat)
    s.renderOrder = 5
    return s
  }

  freeGear(s: THREE.Sprite): void {
    this.gearMats.delete(s.material)
    s.material.dispose()
  }

  /** "!" speech bubble (bottom tip at the origin) over a glow sprite; Person animates the centres. */
  makeBang(): Bang {
    const group = new THREE.Group()
    const halo = new THREE.Sprite(this.haloMat)
    halo.scale.setScalar(HALO_PX * PX)
    halo.renderOrder = 1000
    const bubble = new THREE.Sprite(this.bangMat)
    bubble.scale.set(((BUBBLE_PX * BUBBLE_W) / BUBBLE_H) * PX, BUBBLE_PX * PX, 1)
    bubble.renderOrder = 1001
    group.add(halo, bubble)
    return { group, bubble, halo }
  }

  makeRing(): THREE.Mesh {
    return new THREE.Mesh(this.ringGeo, this.ringMat)
  }

  setLightLevel(level: number): void {
    this.night = 1 - level
    for (const m of this.gearMats) m.color.setScalar(1 + 0.4 * this.night)
    this.bangMat.color.setScalar(1 + 0.45 * this.night)
    this.ringMat.color.setHex(0x45ff80).multiplyScalar(1 + 0.8 * this.night)
  }

  update(timeMs: number): void {
    this.haloMat.opacity = (0.5 + 0.4 * this.night) * (0.85 + 0.15 * Math.sin(timeMs * 0.006))
    this.ringMat.opacity = 0.7 + 0.2 * Math.sin(timeMs * 0.004)
  }

  dispose(): void {
    for (const t of [...this.zTextures, this.halo, this.bubble, this.gearTex]) t.dispose()
    for (const m of [...this.gearMats, this.bangMat, this.ringMat, this.haloMat]) m.dispose()
    this.ringGeo.dispose()
  }
}

const FW_COUNT = 72
const FW_RISE = 650
const FW_LIFE = 3000
const FW_MAX = 6
const FW_PALETTES = [[0xff5a7a, 0xffd25a], [0x5ad1ff, 0xffffff], [0x7dff9a, 0xffe45a], [0xc27dff, 0xff9ae0]]

interface Firework {
  points: THREE.Points
  pos: THREE.BufferAttribute
  vel: Float32Array
  center: THREE.Vector3
  age: number
}

/** Small square-spark bursts (a rising spark, then a burst) that last about 3 seconds. */
export class Fireworks {
  private readonly items: Firework[] = []

  constructor(
    private readonly parent: THREE.Object3D,
    private readonly rng: () => number,
  ) {}

  spawn(center: THREE.Vector3): void {
    if (this.items.length >= FW_MAX) return
    const rng = this.rng
    const palette = FW_PALETTES[Math.floor(rng() * FW_PALETTES.length)]
    const vel = new Float32Array(FW_COUNT * 3)
    const col = new Float32Array(FW_COUNT * 3)
    const tmp = new THREE.Color()
    for (let i = 0; i < FW_COUNT; i++) {
      const u = rng() * 2 - 1
      const th = rng() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      const speed = 4 + rng() * 3.2
      vel.set([r * Math.cos(th) * speed, u * speed, r * Math.sin(th) * speed], i * 3)
      tmp.setHex(palette[i % 2]).multiplyScalar(2.2)
      col.set([tmp.r, tmp.g, tmp.b], i * 3)
    }
    const geo = new THREE.BufferGeometry()
    const pos = new THREE.BufferAttribute(new Float32Array(FW_COUNT * 3), 3)
    geo.setAttribute('position', pos)
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.setDrawRange(0, 1)
    const mat = new THREE.PointsMaterial({
      size: 0.85, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    })
    const points = new THREE.Points(geo, mat)
    points.frustumCulled = false
    this.parent.add(points)
    this.items.push({ points, pos, vel, center: center.clone(), age: 0 })
  }

  update(dtMs: number): void {
    for (let n = this.items.length - 1; n >= 0; n--) {
      const f = this.items[n]
      f.age += dtMs
      if (f.age >= FW_LIFE) {
        this.release(f)
        this.items.splice(n, 1)
        continue
      }
      const mat = f.points.material as THREE.PointsMaterial
      const { center: c, pos, vel } = f
      if (f.age < FW_RISE) {
        const u = f.age / FW_RISE
        pos.setXYZ(0, c.x, c.y - 3.5 * (1 - u) * (1 - u), c.z)
        mat.opacity = 1
      } else {
        const te = (f.age - FW_RISE) / 1000
        const k = 1.5
        const d = (1 - Math.exp(-k * te)) / k
        for (let i = 0; i < FW_COUNT; i++) {
          pos.setXYZ(i, c.x + vel[i * 3] * d, c.y + vel[i * 3 + 1] * d - 0.6 * te * te, c.z + vel[i * 3 + 2] * d)
        }
        f.points.geometry.setDrawRange(0, FW_COUNT)
        const p = te / ((FW_LIFE - FW_RISE) / 1000)
        mat.opacity = 1 - p * p
      }
      pos.needsUpdate = true
    }
  }

  dispose(): void {
    for (const f of this.items) this.release(f)
    this.items.length = 0
  }

  private release(f: Firework): void {
    this.parent.remove(f.points)
    f.points.geometry.dispose()
    ;(f.points.material as THREE.Material).dispose()
  }
}

const ZZ_CYCLE = 6400 // ms for one glyph to drift up and fade out
const ZZ_FADE_MS = 700
const ZZ_ALPHA = 0.8 // peak opacity: soft, so the "!" bubble stays the loudest thing in town
const ZZ_RISE_PX = 36 // screen-space drift per cycle, so the glyph spacing does not depend on the zoom
const ZZ_DRIFT_PX = 12 // sideways drift per cycle (up and to the right)
const ZZ_SWAY_PX = 3
const ZZ_SIZE_PX = [15, 20] // one entry per glyph (z, then Z, Z...): sprite size, of which the glyph fills 2/3; it grows 30 % while rising

/** Small drifting "z"/"Z" glyphs rising beside a sleeping window. */
export class SleepZ {
  alpha = 0
  dying = false
  window = 0
  private readonly sprites: THREE.Sprite[]

  constructor(
    private readonly parent: THREE.Object3D,
    textures: [THREE.Texture, THREE.Texture],
    private readonly phase: number,
  ) {
    this.sprites = ZZ_SIZE_PX.map((_, i) => {
      const map = textures[i === 0 ? 0 : 1]
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false, fog: false, sizeAttenuation: false }))
      parent.add(s)
      return s
    })
  }

  /** `base` = window centre, `outward` = unit vector away from the wall. Returns false once fully faded. */
  update(dtMs: number, timeMs: number, base: THREE.Vector3, outward: THREE.Vector3, scale: number): boolean {
    this.alpha = Math.min(1, Math.max(0, this.alpha + ((this.dying ? -1 : 1) * dtMs) / ZZ_FADE_MS))
    if (this.dying && this.alpha <= 0) return false
    this.sprites.forEach((s, i) => {
      const u = (((timeMs / ZZ_CYCLE + this.phase + i / this.sprites.length) % 1) + 1) % 1
      const px = ZZ_SIZE_PX[i] * (1 + 0.3 * u)
      s.position.set(base.x + outward.x * 0.45 * scale, base.y + 0.2 * scale, base.z + outward.z * 0.45 * scale)
      s.scale.setScalar(px * PX)
      // The drift is a screen-space offset: `center` moves the quad in units of the sprite size.
      const dx = 5 + u * ZZ_DRIFT_PX + Math.sin(u * Math.PI * 2 + i * 2) * ZZ_SWAY_PX
      const dy = 4 + u * ZZ_RISE_PX
      s.center.set(0.5 - dx / px, 0.5 - dy / px)
      s.material.opacity = ZZ_ALPHA * this.alpha * Math.sin(Math.PI * u)
    })
    return true
  }

  dispose(): void {
    for (const s of this.sprites) {
      this.parent.remove(s)
      s.material.dispose()
    }
  }
}
