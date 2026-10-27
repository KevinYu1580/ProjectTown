// Ambient life that is never a person (people on screen only ever stand for sessions): the wind clock for plants
// and water, drifting cloud shadows, a small flock of birds by day, butterflies over the lot gardens, fireflies at
// night. Each kind is one or two instanced draw calls without shadows. Everything follows an animation clock that
// only advances with dt, so a frozen scene (dt = 0) always shows the same frame.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'
import type { TownLayout } from './layout'
import { PAL } from './palette'
import { paint, setClouds, setWindTime } from './voxel'

const T0 = 23.7 // seconds; the frame a frozen scene shows
const BIRDS = 7
const BIRD_ALT = 9.5 // the flight circle stays outside the town, so only trees are below
const MAX_BUTTERFLIES = 24
const MAX_FIREFLIES = 170
// Lot-local spots (before lot scaling) where butterflies and fireflies gather: the right-hand flower bed and the
// front corner planters face the default camera; the back garden comes last.
const GARDEN: Array<[number, number]> = [[5.7, -1.9], [6.1, 5.4], [-5.9, 5.6], [2.6, -5.5]]
const BUTTERFLY_COLORS = [0xf6d26e, 0xfaf6ea, 0xf4a8c4, 0xf3a65a, 0xb9a2e6]

const smooth01 = (lo: number, hi: number, v: number): number => THREE.MathUtils.smoothstep(v, lo, hi)

interface Flutter { x: number; z: number; p: number }

export class Ambient {
  private readonly root = new THREE.Group()
  private t = T0
  private level = 1
  private readonly birdBody: THREE.InstancedMesh
  private readonly birdWing: THREE.InstancedMesh
  private readonly fly: THREE.InstancedMesh
  private readonly bugs: THREE.Points
  private readonly bugPos = new Float32Array(MAX_FIREFLIES * 3)
  private readonly bugCol = new Float32Array(MAX_FIREFLIES * 3)
  private readonly glowTex = glowTexture()
  private flock = { x: 0, z: 0, r: 30 }
  private flutters: Flutter[] = []
  private glows: Flutter[] = []
  // Scratch objects, reused every frame.
  private readonly m = new THREE.Matrix4()
  private readonly w = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly e = new THREE.Euler()
  private readonly v = new THREE.Vector3()
  private readonly one = new THREE.Vector3(1, 1, 1)
  private readonly c = new THREE.Color()

  constructor(private readonly parent: THREE.Object3D) {
    // Small dark swallow-like birds: swept wings and no tailplane, so they never read as toy aeroplanes.
    const parts: Array<[number, number, number, number, number, number, number]> = [
      [0.14, 0.12, 0.38, 0, 0, 0, 0x5c6372], // body
      [0.12, 0.11, 0.12, 0, 0.02, 0.24, 0x4a505d], // head
      [0.08, 0.03, 0.18, 0, 0.01, -0.27, 0x4a505d], // tail
    ]
    const body = mergeGeometries(parts.map(([w, h, d, x, y, z, hex]) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), new THREE.Color(hex))))
    this.birdBody = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), BIRDS)
    const wing = new THREE.BoxGeometry(0.38, 0.03, 0.15).translate(0.19, 0, 0)
    this.birdWing = new THREE.InstancedMesh(wing, new THREE.MeshStandardMaterial({ color: 0x474e5c, roughness: 0.9 }), BIRDS * 2)
    const flyWing = new THREE.BoxGeometry(0.22, 0.015, 0.17).translate(0.11, 0, 0)
    this.fly = new THREE.InstancedMesh(flyWing, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), MAX_BUTTERFLIES * 2)
    this.fly.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_BUTTERFLIES * 2 * 3), 3)
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(this.bugPos, 3))
    g.setAttribute('color', new THREE.BufferAttribute(this.bugCol, 3))
    this.bugs = new THREE.Points(g, new THREE.PointsMaterial({
      map: this.glowTex, size: 0.9, vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, fog: false,
    }))
    for (const o of [this.birdBody, this.birdWing, this.fly, this.bugs]) o.frustumCulled = false
    this.root.add(this.birdBody, this.birdWing, this.fly, this.bugs)
    parent.add(this.root)
  }

  /**
   * Flight circle, garden spots and firefly spots for the current town (deterministic per layout); `waterside` adds
   * firefly spots over the river and ponds.
   */
  build(layout: TownLayout, waterside: Array<{ x: number; z: number }> = []): void {
    const { bounds, lots, lotScale } = layout
    const sx = bounds.maxX - bounds.minX
    const sz = bounds.maxZ - bounds.minZ
    this.flock = { x: (bounds.minX + bounds.maxX) / 2, z: (bounds.minZ + bounds.maxZ) / 2, r: Math.hypot(sx, sz) / 2 + 5 }
    const rng = createRng(fnv1a32(`ambient:${lots.length}`))
    const spots = lots.flatMap((l) => GARDEN.map(([x, z]) => ({ x: l.x + x * lotScale, z: l.z + z * lotScale, p: rng() * 100 })))
    // Two butterflies per lot (the most visible garden spots first), one per lot in large towns.
    this.flutters = lots.length <= MAX_BUTTERFLIES / 2 ? spots.filter((_, i) => i % 4 < 2) : spots.filter((_, i) => i % 4 === 0).slice(0, MAX_BUTTERFLIES)
    // Fireflies: around every garden spot, over the water nearby, plus a ring along the verge.
    const ring = Array.from({ length: 30 }, () => {
      const a = rng() * Math.PI * 2
      const k = 0.5 + 0.06 * rng()
      return { x: this.flock.x + Math.cos(a) * (sx * k + 4), z: this.flock.z + Math.sin(a) * (sz * k + 4), p: rng() * 100 }
    })
    const water = waterside.slice(0, 50).map((p) => ({ x: p.x, z: p.z, p: rng() * 100 }))
    this.glows = [...spots, ...water, ...ring].slice(0, MAX_FIREFLIES)
    this.fly.count = this.flutters.length * 2
    this.flutters.forEach((f, i) => {
      this.c.set(BUTTERFLY_COLORS[Math.floor(f.p) % BUTTERFLY_COLORS.length])
      this.fly.setColorAt(i * 2, this.c)
      this.fly.setColorAt(i * 2 + 1, this.c)
    })
    if (this.fly.instanceColor) this.fly.instanceColor.needsUpdate = true
    this.bugs.geometry.setDrawRange(0, this.glows.length)
    this.setLightLevel(this.level) // visibility depends on the new spots too
  }

  setLightLevel(level: number): void {
    this.level = level
    this.birdBody.visible = this.birdWing.visible = level > 0.35
    this.fly.visible = level > 0.45 && this.flutters.length > 0
    const night = 1 - smooth01(0.2, 0.45, level)
    this.bugs.visible = night > 0.01 && this.glows.length > 0
    ;(this.bugs.material as THREE.PointsMaterial).opacity = night
    this.pose()
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return
    this.t += dtMs / 1000
    this.pose()
  }

  dispose(): void {
    this.parent.remove(this.root)
    for (const o of [this.birdBody, this.birdWing, this.fly]) {
      o.geometry.dispose()
      ;(o.material as THREE.Material).dispose()
      o.dispose()
    }
    this.bugs.geometry.dispose()
    ;(this.bugs.material as THREE.Material).dispose()
    this.glowTex.dispose()
  }

  private pose(): void {
    const t = this.t
    setWindTime(t)
    // Clouds drift with the breeze (about 1 m/s); their shadows fade out toward dusk.
    setClouds(t * 0.9, t * 0.35, 0.16 * smooth01(0.45, 0.85, this.level))
    if (this.birdBody.visible) this.poseBirds(t)
    if (this.fly.visible) this.poseButterflies(t)
    if (this.bugs.visible) this.poseFireflies(t)
  }

  /** A loose V formation circling the town over the fields, flapping in short bursts. */
  private poseBirds(t: number): void {
    const { x: ox, z: oz } = this.flock
    const r = this.flock.r * (1 + 0.06 * Math.sin(t * 0.05))
    const a = t * ((Math.PI * 2) / 90)
    for (let i = 0; i < BIRDS; i++) {
      const row = Math.ceil(i / 2)
      const side = i === 0 ? 0 : i % 2 ? -1 : 1
      const back = row * 1.1
      const ang = a - back / r
      const rad = r + side * row * 0.9 + 0.25 * Math.sin(t * 0.7 + i)
      const x = ox + Math.cos(ang) * rad
      const z = oz + Math.sin(ang) * rad
      const y = BIRD_ALT + 0.6 * Math.sin(t * 0.9 + i * 1.7) - row * 0.2
      // Heading along the circle (counter-clockwise seen from above), banked into the turn.
      this.e.set(0.04 * Math.sin(t * 1.3 + i), -ang, 0.28, 'YXZ')
      this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.one)
      this.birdBody.setMatrixAt(i, this.m)
      const phase = (t * 0.23 + i * 0.37) % 1
      const flap = phase < 0.45 ? Math.sin(t * 15 + i) * 0.7 : 0.15
      for (let s = 0; s < 2; s++) {
        // Swept back, then flapped about the body axis (the left wing is the right one turned half round).
        this.e.set(0, 0.35, s === 0 ? flap : Math.PI - flap, 'ZYX')
        this.w.makeRotationFromEuler(this.e).setPosition(s === 0 ? 0.06 : -0.06, 0.03, 0.04)
        this.birdWing.setMatrixAt(i * 2 + s, this.w.premultiply(this.m))
      }
    }
    this.birdBody.instanceMatrix.needsUpdate = true
    this.birdWing.instanceMatrix.needsUpdate = true
  }

  /** Butterflies wander in small loops over the garden beds. */
  private poseButterflies(t: number): void {
    this.flutters.forEach((f, i) => {
      const u = t + f.p
      const x = f.x + 0.7 * Math.sin(u * 0.7) + 0.25 * Math.sin(u * 1.9)
      const z = f.z + 0.6 * Math.sin(u * 0.53 + 1.3)
      const y = 0.75 + 0.35 * Math.sin(u * 1.7) + 0.12 * Math.sin(u * 5.3)
      const heading = Math.atan2(0.49 * Math.cos(u * 0.7) + 0.475 * Math.cos(u * 1.9), 0.318 * Math.cos(u * 0.53 + 1.3))
      this.e.set(0, heading, 0, 'YXZ')
      this.m.compose(this.v.set(x, y, z), this.q.setFromEuler(this.e), this.one)
      const flap = 0.15 + 1.1 * Math.abs(Math.sin(u * 15))
      for (let s = 0; s < 2; s++) {
        this.w.makeRotationZ(s === 0 ? flap : Math.PI - flap).setPosition(s === 0 ? 0.01 : -0.01, 0, 0)
        this.fly.setMatrixAt(i * 2 + s, this.w.premultiply(this.m))
      }
    })
    this.fly.instanceMatrix.needsUpdate = true
  }

  /** Slow drifting glows that swell and fade on their own rhythm. */
  private poseFireflies(t: number): void {
    const base = this.c.set(PAL.firefly)
    this.glows.forEach((g, i) => {
      const u = t * 0.35 + g.p
      this.bugPos[i * 3] = g.x + 1.4 * Math.sin(u * 0.9) + 0.5 * Math.sin(u * 2.3)
      this.bugPos[i * 3 + 1] = 0.6 + 0.5 * Math.sin(u * 1.3) + 0.25 * Math.sin(u * 3.1)
      this.bugPos[i * 3 + 2] = g.z + 1.2 * Math.sin(u * 0.7 + 2) + 0.4 * Math.sin(u * 2.9)
      const glow = Math.max(0, Math.sin(t * 1.6 + g.p * 3)) ** 3 * 0.85 + 0.08
      this.bugCol[i * 3] = base.r * glow
      this.bugCol[i * 3 + 1] = base.g * glow
      this.bugCol[i * 3 + 2] = base.b * glow
    })
    const geo = this.bugs.geometry
    geo.getAttribute('position').needsUpdate = true
    geo.getAttribute('color').needsUpdate = true
  }
}

/** Soft round dot for the fireflies. */
function glowTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas')
  cv.width = cv.height = 64
  const ctx = cv.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.25, 'rgba(255,255,255,0.75)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  const tex = new THREE.CanvasTexture(cv)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
