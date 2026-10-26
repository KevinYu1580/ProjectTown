import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { SessionState } from '../../types'
import { hashToIndex } from '../../util/hash'
import { BOUNCE_PX, BUBBLE_PX, GEAR_GAP, GEAR_PX, HALO_PX, PX, STAGGER_PX, type Bang, type Effects } from './effects'
import { LABEL_PX, NameLabel } from './label'

// 12 pastel shirt colours, indexed by hashToIndex(sessionId, 12).
const SHIRTS = [
  0xf4a6a6, 0xf6c58e, 0xf3e08f, 0xb9e08f, 0x8fd9b2, 0x8fd6e0,
  0x9ebcf0, 0xb7a6ee, 0xdca3e8, 0xf0a3c8, 0xcfd3d9, 0xe8b894,
]
const SKINS = [0xf1c9a5, 0xe0ac86, 0xc68a62, 0x8d5a3b]
const HAIRS = [0x2b2118, 0x5a3a22, 0xa0722c, 0x161616, 0x6b6b72]
const PANTS = [0x39404f, 0x3b4a63, 0x4a4540, 0x2f3b3a]

const SKIN_GLOW = new THREE.Color(0x7a6558)
const HALF_PI = Math.PI / 2
const LEAVE_TOTAL_MS = 4000
const LEAVE_FADE_MS = 800
const LEAVE_SPEED = 3 // m/s

// Chibi proportions (big head), about 2.2 tall so people stay readable in the default town view.
const LEG = 0.6
const TORSO = 0.74
const HEAD = 0.78
const HEAD_TOP = LEG + TORSO + HEAD + 0.1
const LABEL_GAP = 0.12 // world units between head top and the label / bubble anchor
const GEAR_LIFT = (GEAR_PX + 10) / LABEL_PX // label rows above a running person's gear
const BANG_LIFT = (BUBBLE_PX + BOUNCE_PX + STAGGER_PX + 6) / LABEL_PX

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const ease = (u: number): number => u * u * (3 - 2 * u)
/** Mostly steady pace with a short ease at both ends (peak speed 1.25x the average). */
const gentle = (u: number): number => 0.5 * (u + ease(u))
const wrapPi = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))
/** Frame-rate independent smoothing factor; `rate` is per second, dt in ms. */
const smooth = (dtMs: number, rate: number): number => 1 - Math.exp((-dtMs * rate) / 1000)

export interface Target {
  pos: THREE.Vector3
  yaw: number
  sit: boolean
  inside: boolean
}
export type Route = Array<{ p: THREE.Vector3; inside: boolean }>
export type Mode = 'active' | 'hidden' | 'leaving'

interface Walk {
  pts: THREE.Vector3[]
  ins: boolean[]
  cum: number[]
  total: number
  dist: number
  t: number
  dur: number
  fixedSpeed: boolean
}

function colorBox(w: number, h: number, d: number, x: number, y: number, z: number, hex: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).translate(x, y, z)
  const c = new THREE.Color(hex)
  const n = g.getAttribute('position').count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return g
}

/** Body-part geometry shared by every person (heads are cached per skin/hair combination). */
export class PersonParts {
  readonly torso = new THREE.BoxGeometry(0.56, TORSO, 0.4).translate(0, LEG + TORSO / 2, 0)
  readonly arm = new THREE.BoxGeometry(0.16, 0.6, 0.18).translate(0, -0.3, 0)
  readonly leg = new THREE.BoxGeometry(0.26, LEG, 0.3).translate(0, -LEG / 2, 0)
  private readonly heads = new Map<string, THREE.BufferGeometry>()

  /** Head with hair and eyes baked in as vertex colours; origin at the neck. */
  head(skin: number, hair: number): THREE.BufferGeometry {
    const key = `${skin}-${hair}`
    let g = this.heads.get(key)
    if (!g) {
      const h = HEAD
      const parts = [
        colorBox(h, h, h, 0, h / 2, 0, SKINS[skin]),
        colorBox(h + 0.06, 0.2, h + 0.06, 0, h, 0, HAIRS[hair]),
        colorBox(h + 0.06, 0.56, 0.16, 0, h - 0.24, -(h / 2 - 0.06), HAIRS[hair]),
        colorBox(h + 0.02, 0.14, 0.08, 0, h - 0.17, h / 2 - 0.02, HAIRS[hair]),
        colorBox(0.11, 0.16, 0.04, -0.19, 0.36, h / 2 + 0.005, 0x1b1b22),
        colorBox(0.11, 0.16, 0.04, 0.19, 0.36, h / 2 + 0.005, 0x1b1b22),
        colorBox(0.14, 0.08, 0.03, -0.29, 0.22, h / 2 + 0.003, 0xf0948f),
        colorBox(0.14, 0.08, 0.03, 0.29, 0.22, h / 2 + 0.003, 0xf0948f),
      ]
      g = mergeGeometries(parts)
      for (const p of parts) p.dispose()
      this.heads.set(key, g)
    }
    return g
  }

  dispose(): void {
    for (const g of [this.torso, this.arm, this.leg, ...this.heads.values()]) g.dispose()
  }
}

/** One session's voxel person: pose, walking along a route, fading, head effects and name label. */
export class Person {
  readonly root = new THREE.Group()
  /** Logical position (feet); root.position adds the walking bob. */
  readonly pos = new THREE.Vector3()
  state: SessionState
  slot = 0
  mode: Mode = 'active'
  inside = false
  dead = false
  hiddenAt = 0

  private scale = 1
  private yaw = 0
  private yawTarget = 0
  private restYaw = 0
  private restSit = false
  private restInside = false
  private walk: Walk | null = null
  private cycle = 0
  private walkAmt = 0
  private sit = 0
  private typeAmt = 0
  private fade = 1
  private fadeTarget = 1
  private fadeRate = 0
  private leaveT = -1
  private gesture: { kind: 'stretch' | 'look'; t: number } | null = null
  private gestureWait: number
  private labelLift = 0
  private label: NameLabel | null = null
  private readonly fxCur = { gear: 0, bang: 0, ring: 0 }
  private readonly phase: number
  private readonly mats: THREE.MeshStandardMaterial[]
  private readonly legL: THREE.Mesh
  private readonly legR: THREE.Mesh
  private readonly armL: THREE.Mesh
  private readonly armR: THREE.Mesh
  private readonly torso: THREE.Mesh
  private readonly head: THREE.Mesh
  private readonly gear: THREE.Sprite
  private readonly bang: Bang
  private readonly fx: Effects
  private readonly ring: THREE.Mesh
  private readonly rng: () => number

  constructor(
    readonly id: string,
    readonly lotId: string,
    state: SessionState,
    parts: PersonParts,
    fx: Effects,
    rng: () => number,
  ) {
    this.state = state
    this.rng = rng
    this.fx = fx
    this.gestureWait = this.nextGestureWait()
    this.phase = (hashToIndex(`${id}:phase`, 1000) / 1000) * Math.PI * 2

    const mat = (color: number, vertexColors = false) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, transparent: true, vertexColors })
    const shirt = mat(SHIRTS[hashToIndex(id, SHIRTS.length)])
    const pants = mat(PANTS[hashToIndex(`${id}:pants`, PANTS.length)])
    const headMat = mat(0xffffff, true)
    this.mats = [shirt, pants, headMat]

    const part = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, 0)
      mesh.castShadow = true
      this.root.add(mesh)
      return mesh
    }
    this.legL = part(parts.leg, pants, -0.14, LEG)
    this.legR = part(parts.leg, pants, 0.14, LEG)
    this.torso = part(parts.torso, shirt, 0, 0)
    this.armL = part(parts.arm, shirt, -0.37, LEG + TORSO - 0.1)
    this.armR = part(parts.arm, shirt, 0.37, LEG + TORSO - 0.1)
    this.head = part(
      parts.head(hashToIndex(`${id}:skin`, SKINS.length), hashToIndex(`${id}:hair`, HAIRS.length)),
      headMat, 0, LEG + TORSO,
    )

    this.gear = fx.makeGear()
    this.bang = fx.makeBang()
    this.ring = fx.makeRing()
    this.ring.position.y = 0.04
    this.gear.position.y = HEAD_TOP + GEAR_GAP
    this.bang.group.position.y = HEAD_TOP + LABEL_GAP
    this.root.add(this.gear, this.bang.group, this.ring)
  }

  setScale(s: number): void {
    this.scale = s
    this.root.scale.setScalar(s)
    this.label?.setUnit(1 / s)
  }

  /** Slight self-lighting at night so people stay readable in the dark. */
  setNight(n: number): void {
    for (const m of this.mats) {
      m.emissive.copy(m.vertexColors ? SKIN_GLOW : m.color)
      m.emissiveIntensity = 0.4 * n
    }
  }

  /** Text of the name label, or null when names are hidden (debug). */
  get labelText(): string | null {
    return this.label?.content ?? null
  }

  setLabel(text: string | null): void {
    if (text === null) {
      if (!this.label) return
      this.root.remove(this.label.sprite)
      this.label.dispose()
      this.label = null
      return
    }
    if (!this.label) {
      this.label = new NameLabel()
      this.label.setUnit(1 / this.scale)
      this.labelLift = this.labelTarget()
      this.label.lift = this.labelLift
      this.label.sprite.position.y = HEAD_TOP + LABEL_GAP
      this.root.add(this.label.sprite)
    }
    this.label.setText(text)
  }

  /** ms <= 0 jumps straight to the target. */
  fadeTo(target: number, ms: number): void {
    this.fadeTarget = target
    if (ms <= 0) this.fade = target
    else this.fadeRate = 1 / ms
  }

  /** Place at the target without walking. */
  snapTo(t: Target, time: number): void {
    this.walk = null
    this.pos.copy(t.pos)
    this.yawTarget = this.restYaw = t.yaw
    this.restSit = t.sit
    this.restInside = this.inside = t.inside
    this.step(0, time, true)
  }

  /** Walk the route (from the current position) and settle at the target pose. */
  goTo(t: Target, route: Route): void {
    this.restYaw = t.yaw
    this.restSit = t.sit
    this.restInside = t.inside
    this.beginWalk(route, 0)
  }

  /** Walk the route at a steady pace, then fade out (about 4 s in total). No route: fade out in place. */
  startLeave(route: Route | null): void {
    this.mode = 'leaving'
    this.leaveT = 0
    if (route) this.beginWalk(route, LEAVE_SPEED)
    else {
      this.walk = null
      this.fadeTo(0, 300)
    }
  }

  update(dtMs: number, time: number): void {
    this.step(dtMs, time, false)
  }

  dispose(): void {
    this.setLabel(null)
    this.root.removeFromParent()
    this.fx.freeGear(this.gear)
    for (const m of this.mats) m.dispose()
  }

  /** Label rows above the head: clear of the state's effect; neighbours take different rows so labels never coincide. */
  private labelTarget(): number {
    const base = this.state === 'waiting' ? BANG_LIFT : this.state === 'running' ? GEAR_LIFT : 0.1
    return base + (this.slot % 3) * 1.4
  }

  private nextGestureWait(): number {
    return 10_000 + this.rng() * 20_000
  }

  private beginWalk(route: Route, speed: number): void {
    const pts = [this.pos.clone(), ...route.map((r) => r.p)]
    const ins = [this.inside, ...route.map((r) => r.inside)]
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const total = cum[cum.length - 1]
    if (total < 0.05) {
      this.walk = null
      this.pos.copy(pts[pts.length - 1])
      this.inside = ins[ins.length - 1]
      return
    }
    const dur = speed > 0 ? (total / speed) * 1000 : Math.min(2200, Math.max(700, (total / 4) * 1000))
    this.walk = { pts, ins, cum, total, dist: 0, t: 0, dur, fixedSpeed: speed > 0 }
  }

  private advanceWalk(dtMs: number): boolean {
    const w = this.walk
    if (!w) return false
    w.t += dtMs
    const dist = w.fixedSpeed ? Math.min(w.total, (LEAVE_SPEED * w.t) / 1000) : w.total * gentle(Math.min(1, w.t / w.dur))
    this.cycle += ((dist - w.dist) / this.scale) * 6
    w.dist = dist
    let i = 0
    while (i < w.pts.length - 2 && w.cum[i + 1] < dist) i++
    const len = w.cum[i + 1] - w.cum[i]
    this.pos.lerpVectors(w.pts[i], w.pts[i + 1], len > 1e-6 ? Math.min(1, (dist - w.cum[i]) / len) : 1)
    this.inside = w.ins[i]
    const dx = w.pts[i + 1].x - w.pts[i].x
    const dz = w.pts[i + 1].z - w.pts[i].z
    if (dx * dx + dz * dz > 1e-6) this.yawTarget = Math.atan2(dx, dz)
    if (dist >= w.total - 1e-4 && (w.fixedSpeed || w.t >= w.dur)) {
      this.walk = null
      this.inside = w.ins[w.ins.length - 1]
      if (this.mode !== 'leaving') this.yawTarget = this.restYaw
      return false
    }
    return true
  }

  private step(dtMs: number, time: number, snap: boolean): void {
    // Fade (and the 4 s leave timeline).
    if (this.leaveT >= 0) {
      this.leaveT += dtMs
      if (this.leaveT >= LEAVE_TOTAL_MS - LEAVE_FADE_MS && this.fadeTarget !== 0) this.fadeTo(0, LEAVE_FADE_MS)
    }
    const df = this.fadeTarget - this.fade
    this.fade = snap ? this.fadeTarget : this.fade + Math.sign(df) * Math.min(Math.abs(df), dtMs * this.fadeRate)
    if (this.mode === 'leaving' && this.fade <= 0) this.dead = true

    const moving = this.advanceWalk(dtMs)
    const active = this.mode === 'active'
    const k = (rate: number): number => (snap ? 1 : smooth(dtMs, rate))

    this.walkAmt = lerp(this.walkAmt, moving ? 1 : 0, k(10))
    const sitTarget = !moving && this.restSit ? 1 : 0
    this.sit = lerp(this.sit, sitTarget, k(9))
    this.typeAmt = lerp(this.typeAmt, this.state === 'running' && !moving && active ? 1 : 0, k(8))
    this.yaw += wrapPi(this.yawTarget - this.yaw) * k(12)

    // Idle gestures: only while seated and idle.
    if (!snap && this.state === 'idle' && !moving && this.sit > 0.95 && active) {
      if (!this.gesture) {
        this.gestureWait -= dtMs
        if (this.gestureWait <= 0) this.gesture = { kind: this.rng() < 0.5 ? 'stretch' : 'look', t: 0 }
      } else {
        this.gesture.t += dtMs
        if (this.gesture.t >= (this.gesture.kind === 'stretch' ? 1800 : 2400)) {
          this.gesture = null
          this.gestureWait = this.nextGestureWait()
        }
      }
    } else if (snap) this.gesture = null

    this.applyPose(time)
    this.applyEffects(dtMs, time, snap, active)
  }

  private applyPose(time: number): void {
    const swing = Math.sin(this.cycle) * 0.75 * this.walkAmt
    let armL = -swing * 0.8
    let armR = swing * 0.8
    this.legL.rotation.x = lerp(swing, -HALF_PI, this.sit)
    this.legR.rotation.x = lerp(-swing, -HALF_PI, this.sit)
    armL = lerp(armL, -0.45, this.sit)
    armR = lerp(armR, -0.45, this.sit)
    armL = lerp(armL, -1.25 + Math.sin(time * 0.017 + this.phase) * 0.1, this.typeAmt)
    armR = lerp(armR, -1.25 + Math.sin(time * 0.017 + this.phase + 2.4) * 0.1, this.typeAmt)

    let lean = 0
    let look = 0
    const g = this.gesture
    if (g) {
      const dur = g.kind === 'stretch' ? 1800 : 2400
      const kk = Math.sin(Math.PI * Math.min(1, g.t / dur))
      if (g.kind === 'stretch') {
        armL = lerp(armL, -3.05, kk)
        armR = lerp(armR, -3.05, kk)
        lean = -0.18 * kk
      } else look = Math.sin((g.t / dur) * Math.PI * 2) * 0.85 * kk
    }
    this.armL.rotation.x = armL
    this.armR.rotation.x = armR
    this.torso.rotation.x = lean
    this.head.rotation.y = look

    const bob = Math.abs(Math.sin(this.cycle)) * 0.05 * this.walkAmt
    this.root.position.set(this.pos.x, this.pos.y + bob * this.scale, this.pos.z)
    this.root.rotation.y = this.yaw
  }

  private applyEffects(dtMs: number, time: number, snap: boolean, active: boolean): void {
    const k = snap ? 1 : smooth(dtMs, 14)
    const want = (s: SessionState): number => (this.state === s && active ? 1 : 0)
    const cur = this.fxCur
    cur.gear = lerp(cur.gear, want('running'), k)
    cur.bang = lerp(cur.bang, want('waiting'), k)
    cur.ring = lerp(cur.ring, want('finished'), k)
    const f = this.fade

    // Screen-space sprites: divide out the lot scale so they keep their pixel size.
    const unit = 1 / this.scale
    const gear = cur.gear * f
    this.gear.visible = gear > 0.01
    this.gear.scale.setScalar(Math.max(gear, 0.001) * GEAR_PX * PX * unit)
    this.gear.material.rotation = time * 0.004 + this.phase

    const bang = cur.bang * f
    const bangGroup = this.bang.group
    bangGroup.visible = bang > 0.01
    bangGroup.scale.setScalar(Math.max(bang, 0.001) * unit)
    const hop = BOUNCE_PX * Math.abs(Math.sin(time * 0.0055 + this.phase)) + (this.slot % 2) * STAGGER_PX
    this.bang.bubble.center.set(0.5, 0.03 - hop / BUBBLE_PX)
    // The glow follows the bubble body.
    this.bang.halo.center.set(0.5, 0.5 - (hop + BUBBLE_PX * 0.55) / HALO_PX)

    const ring = cur.ring * f
    this.ring.visible = ring > 0.01
    this.ring.scale.setScalar(Math.max(ring, 0.001) * (1 + 0.05 * Math.sin(time * 0.004 + this.phase)))

    for (const m of this.mats) m.opacity = f
    this.root.visible = f > 0.002

    if (this.label) {
      const target = this.labelTarget()
      this.labelLift = snap ? target : lerp(this.labelLift, target, smooth(dtMs, 8))
      this.label.lift = this.labelLift
      this.label.opacity = f
    }
  }
}
