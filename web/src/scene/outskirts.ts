// Background neighbourhood around the town (placement in outskirtsPlan.ts): lanes, garden plots, houses, trees and
// allotments in one vertex-coloured mesh that is tinted at night like the countryside, sparse warm windows in one
// additive mesh, and small cars on the lanes (instanced). It never casts shadows, and nothing here is a person or carries a sign:
// people stand for sessions and signs for projects. Cars follow an animation clock that only advances with dt, so a
// frozen scene (dt = 0) always shows the same frame and never needs redrawing.
import * as THREE from 'three'
import {
  ASPHALT_HALF, LANE_EDGE, LANE_W, MAIN_HALF, carPose, type CarPose, type Facing, type House, type OutskirtsPlan, type Plot, type Tree,
} from './outskirtsPlan'
import { PAL } from './palette'
import { makeVoxelMaterial } from './voxel'

const T0 = 41.3 // seconds; the frame a frozen scene shows
const GROUND = -0.02 // block lawns: 0.03 above the plate's grass, below the road tops (y = 0)
const PATH_Y = GROUND + 0.015
const SHADOW_Y = GROUND + 0.032
const TREE_SWAY = 0.03
// The neighbourhood sinks a little deeper into the night than the countryside, so the town's light stays the focus.
const NIGHT_TINT = new THREE.Color(0.34, 0.4, 0.6)
const WHITE = new THREE.Color(1, 1, 1)
// Far houses fade toward this haze (aerial perspective); the night tint darkens it with everything else.
const HAZE = new THREE.Color(0xc4cfd6)
// The sun (and moon) shine from -X, +Z (sky.ts), so baked contact shadows fall toward +X, -Z.
const SHADOW_DIR = { x: 0.63, z: -0.77 }

const col = (hex: number): THREE.Color => new THREE.Color(hex)
const smooth = (lo: number, hi: number, v: number): number => THREE.MathUtils.smoothstep(v, lo, hi)

/** Writes axis-aligned boxes (no bottom face: nothing is seen from below) and flat quads into one vertex-coloured geometry. */
class Batch {
  private readonly pos: number[] = []
  private readonly nor: number[] = []
  private readonly rgb: number[] = []
  private readonly sw: number[] = []
  private readonly idx: number[] = []

  get empty(): boolean {
    return this.idx.length === 0
  }

  /**
   * (x, y, z) = bottom centre. `top` null leaves the top face out (it is covered); `foot` darkens the lower edge of the
   * walls; `sway` bends with the wind above `swayBase`.
   */
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: THREE.Color, top: THREE.Color | null = c, foot = 1, sway = 0, swayBase = y): void {
    const x0 = x - w / 2
    const x1 = x + w / 2
    const y1 = y + h
    const z0 = z - d / 2
    const z1 = z + d / 2
    const k = (yy: number) => (sway > 0 ? sway * Math.max(0, yy - swayBase) : 0)
    if (top) this.quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], 0, 1, 0, top, top, k(y1), k(y1))
    this.quad([x0, y, z1, x1, y, z1, x1, y1, z1, x0, y1, z1], 0, 0, 1, c, c, k(y), k(y1), foot)
    this.quad([x1, y, z0, x0, y, z0, x0, y1, z0, x1, y1, z0], 0, 0, -1, c, c, k(y), k(y1), foot)
    this.quad([x1, y, z1, x1, y, z0, x1, y1, z0, x1, y1, z1], 1, 0, 0, c, c, k(y), k(y1), foot)
    this.quad([x0, y, z0, x0, y, z1, x0, y1, z1, x0, y1, z0], -1, 0, 0, c, c, k(y), k(y1), foot)
  }

  /** Long low strip (hedge, kerb) along X or Z: top and the two long sides only (its ends are too small to see). */
  strip(x0: number, z0: number, x1: number, z1: number, y: number, h: number, c: THREE.Color, top: THREE.Color): void {
    const y1 = y + h
    this.quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], 0, 1, 0, top, top, 0, 0)
    if (x1 - x0 >= z1 - z0) {
      this.quad([x0, y, z1, x1, y, z1, x1, y1, z1, x0, y1, z1], 0, 0, 1, c, c, 0, 0)
      this.quad([x1, y, z0, x0, y, z0, x0, y1, z0, x1, y1, z0], 0, 0, -1, c, c, 0, 0)
    } else {
      this.quad([x1, y, z1, x1, y, z0, x1, y1, z0, x1, y1, z1], 1, 0, 0, c, c, 0, 0)
      this.quad([x0, y, z0, x0, y, z1, x0, y1, z1, x0, y1, z0], -1, 0, 0, c, c, 0, 0)
    }
  }

  /** Horizontal rectangle facing up; with `atZ0` the colour runs from `c` along the z1 edge to `atZ0` along z0. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, c: THREE.Color, atZ0 = c): void {
    this.quad([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], 0, 1, 0, c, atZ0, 0, 0)
  }

  /** Vertical rectangle centred at (x, y, z) on a wall facing `f`, `w` wide along the wall. */
  wall(x: number, y: number, z: number, w: number, h: number, f: Facing, c: THREE.Color): void {
    const a = w / 2
    const y0 = y - h / 2
    const y1 = y + h / 2
    if (f === 'z+') this.quad([x - a, y0, z, x + a, y0, z, x + a, y1, z, x - a, y1, z], 0, 0, 1, c, c, 0, 0)
    else if (f === 'z-') this.quad([x + a, y0, z, x - a, y0, z, x - a, y1, z, x + a, y1, z], 0, 0, -1, c, c, 0, 0)
    else if (f === 'x+') this.quad([x, y0, z + a, x, y0, z - a, x, y1, z - a, x, y1, z + a], 1, 0, 0, c, c, 0, 0)
    else this.quad([x, y0, z - a, x, y0, z + a, x, y1, z + a, x, y1, z - a], -1, 0, 0, c, c, 0, 0)
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.rgb, 3))
    g.setAttribute('sway', new THREE.Float32BufferAttribute(this.sw, 1))
    g.setIndex(this.idx)
    g.computeBoundingSphere()
    return g
  }

  /** Four corners counter-clockwise seen from the front; the first two are the lower edge (shaded by `foot`). */
  private quad(p: number[], nx: number, ny: number, nz: number, lo: THREE.Color, hi: THREE.Color, swLo: number, swHi: number, foot = 1): void {
    const base = this.pos.length / 3
    this.pos.push(...p)
    for (let i = 0; i < 4; i++) {
      this.nor.push(nx, ny, nz)
      const c = i < 2 ? lo : hi
      const k = i < 2 ? foot : 1
      this.rgb.push(c.r * k, c.g * k, c.b * k)
      this.sw.push(i < 2 ? swLo : swHi)
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}

// House-local frame per facing: front (f) and right (r) directions in the XZ plane, and which way the side walls face.
const FRAME: Record<Facing, { fx: number; fz: number; rx: number; rz: number; right: Facing; left: Facing }> = {
  'z+': { fx: 0, fz: 1, rx: 1, rz: 0, right: 'x+', left: 'x-' },
  'z-': { fx: 0, fz: -1, rx: -1, rz: 0, right: 'x-', left: 'x+' },
  'x+': { fx: 1, fz: 0, rx: 0, rz: -1, right: 'z-', left: 'z+' },
  'x-': { fx: -1, fz: 0, rx: 0, rz: 1, right: 'z+', left: 'z-' },
}

/** Palette colours, scaled by `k` and faded toward the haze with distance; cached (a few hundred per plan). */
class Tones {
  private readonly cache = new Map<string, THREE.Color>()

  get(hex: number, haze: number, k = 1): THREE.Color {
    const key = `${hex}|${haze.toFixed(2)}|${k}`
    let c = this.cache.get(key)
    if (!c) {
      c = col(hex).multiplyScalar(k).lerp(HAZE, haze)
      this.cache.set(key, c)
    }
    return c
  }
}

export class Outskirts {
  private readonly root = new THREE.Group()
  private readonly mat = makeVoxelMaterial(0.9)
  private readonly glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })
  private readonly carMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0 })
  private readonly lampMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })
  private readonly tint = new THREE.Color()
  private content: THREE.Group | null = null
  private glow: THREE.Mesh | null = null
  private cars: THREE.InstancedMesh | null = null
  private lamps: THREE.InstancedMesh | null = null
  private plan: OutskirtsPlan | null = null
  private t = T0
  private level = 1
  // Scratch objects, reused every frame.
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly one = new THREE.Vector3(1, 1, 1)
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly pose: CarPose = { x: 0, z: 0, yaw: 0 }

  constructor(private readonly parent: THREE.Object3D) {
    parent.add(this.root)
  }

  build(plan: OutskirtsPlan): void {
    this.clear()
    this.plan = plan
    const content = new THREE.Group()
    const solid = new Batch()
    const glow = new Batch()
    const tones = new Tones()
    const { reach, scale: s } = plan
    const hazeAt = (x: number, z: number): number => Math.round((0.05 + 0.27 * smooth(0.35, 1.15, Math.hypot(x, z) / reach)) * 20) / 20

    for (const b of plan.blocks) {
      const haze = hazeAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)
      // Home blocks are tiled by their garden plots; the pond park keeps the plate's meadow grass.
      if (b.kind !== 'pond' && b.kind !== 'homes' && b.kind !== 'terrace') solid.flat(b.x0, b.z0, b.x1, b.z1, GROUND, tones.get(PAL.bgLawn[b.tone % PAL.bgLawn.length], haze))
      if (b.kind === 'park') this.parkPaths(solid, b, tones.get(PAL.bgPath, haze), s)
      if (b.kind === 'allotment' && !plan.lite) this.allotment(solid, b, tones, haze, s)
    }
    for (const p of plan.plots) this.plot(solid, p, tones, hazeAt((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2), s)
    this.lanes(solid, plan, tones, hazeAt)
    for (const h of plan.houses) this.house(solid, glow, h, tones, hazeAt(h.x, h.z), s, plan.reach)
    for (const t of plan.trees) this.tree(solid, t, tones, hazeAt(t.x, t.z))

    const mesh = new THREE.Mesh(solid.build(), this.mat)
    mesh.receiveShadow = true
    content.add(mesh)
    if (!glow.empty) {
      this.glow = new THREE.Mesh(glow.build(), this.glowMat)
      this.glow.renderOrder = 2
      content.add(this.glow)
    }

    // Cars: moving ones first (their lamps share the first instance slots), then the parked ones.
    const total = plan.cars.length + plan.parked.length
    if (total > 0) {
      this.cars = new THREE.InstancedMesh(carGeometry(s, plan.lite), this.carMat, total)
      this.cars.frustumCulled = false
      const c = new THREE.Color()
      plan.cars.forEach((car, i) => this.cars!.setColorAt(i, c.set(PAL.bgCar[car.color % PAL.bgCar.length])))
      plan.parked.forEach((car, i) => {
        const k = plan.cars.length + i
        this.cars!.setColorAt(k, c.set(PAL.bgCar[car.color % PAL.bgCar.length]))
        this.m.compose(this.p.set(car.x, GROUND, car.z), this.q.setFromAxisAngle(this.up, car.yaw), this.one)
        this.cars!.setMatrixAt(k, this.m)
      })
      content.add(this.cars)
      if (!plan.lite && plan.cars.length > 0) {
        this.lamps = new THREE.InstancedMesh(lampGeometry(s), this.lampMat, plan.cars.length)
        this.lamps.frustumCulled = false
        this.lamps.renderOrder = 2
        content.add(this.lamps)
      }
    }
    this.content = content
    this.root.add(content)
    this.poseCars()
    this.setLightLevel(this.level)
  }

  setLightLevel(level: number): void {
    this.level = level
    this.tint.copy(NIGHT_TINT).lerp(WHITE, smooth(0, 0.6, level))
    this.mat.color.copy(this.tint)
    this.carMat.color.copy(this.tint)
    // Windows and car lamps come on through dusk and stay well below the bloom threshold (background, not focus).
    const a = 1 - smooth(0.18, 0.5, level)
    this.glowMat.color.setScalar(a)
    this.lampMat.color.setScalar(a)
    if (this.glow) this.glow.visible = a > 0.01
    if (this.lamps) this.lamps.visible = a > 0.01
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return
    this.t += dtMs / 1000
    this.poseCars()
  }

  dispose(): void {
    this.clear()
    this.parent.remove(this.root)
    for (const m of [this.mat, this.glowMat, this.carMat, this.lampMat]) m.dispose()
  }

  /** Every frame while the clock runs: no allocations. */
  private poseCars(): void {
    const plan = this.plan
    const cars = this.cars
    if (!plan || !cars) return
    for (let i = 0; i < plan.cars.length; i++) {
      const car = plan.cars[i]
      const pose = carPose(plan.routes[car.route], car, this.t, this.pose)
      this.m.compose(this.p.set(pose.x, 0, pose.z), this.q.setFromAxisAngle(this.up, pose.yaw), this.one)
      cars.setMatrixAt(i, this.m)
      this.lamps?.setMatrixAt(i, this.m)
    }
    cars.instanceMatrix.needsUpdate = true
    if (this.lamps) this.lamps.instanceMatrix.needsUpdate = true
  }

  private clear(): void {
    if (this.content) {
      this.root.remove(this.content)
      this.content.traverse((o) => {
        if (o instanceof THREE.Mesh) o.geometry.dispose()
        if (o instanceof THREE.InstancedMesh) o.dispose()
      })
    }
    this.content = null
    this.glow = null
    this.cars = null
    this.lamps = null
  }

  /** A small house: walls with a shaded foot, a stepped roof, door, windows and chimney up close; lit windows glow at night. */
  private house(b: Batch, glow: Batch, h: House, tones: Tones, haze: number, s: number, reach: number): void {
    const F = FRAME[h.facing]
    const { w, d, lod } = h
    // Local box: centre (u, v) across / along the front direction, bottom at y.
    const box = (u: number, y: number, v: number, bw: number, bh: number, bd: number, c: THREE.Color, top: THREE.Color | null = c, foot = 1) => {
      const along = F.fx === 0
      b.box(h.x + u * F.rx + v * F.fx, y, h.z + u * F.rz + v * F.fz, along ? bw : bd, bh, along ? bd : bw, c, top, foot)
    }
    // Point on a wall: 'front', 'back' or a side ('right' / 'left'), `u` along it, lifted a hair off the surface.
    const onWall = (face: 'front' | 'right' | 'left', u: number, lift: number): { x: number; z: number; f: Facing } => {
      if (face === 'front') return { x: h.x + u * F.rx + (d / 2 + lift) * F.fx, z: h.z + u * F.rz + (d / 2 + lift) * F.fz, f: h.facing }
      const sgn = face === 'right' ? 1 : -1
      return { x: h.x + sgn * (w / 2 + lift) * F.rx + u * F.fx, z: h.z + sgn * (w / 2 + lift) * F.rz + u * F.fz, f: face === 'right' ? F.right : F.left }
    }

    const wall = tones.get(PAL.bgWall[h.wall % PAL.bgWall.length], haze)
    const wallTop = tones.get(PAL.bgWall[h.wall % PAL.bgWall.length], haze, 0.92)
    const roofHex = PAL.bgRoof[h.roofTone % PAL.bgRoof.length]
    const roof = tones.get(roofHex, haze)
    const roofDark = tones.get(roofHex, haze, 0.78)
    const roofLight = tones.get(roofHex, haze, 1.14)
    const T = 0.3 * s

    // Baked contact shadow on the lawn, toward +X / -Z.
    const fx = h.facing[0] === 'z' ? w : d
    const fz = h.facing[0] === 'z' ? d : w
    const o = Math.min(1.1 * s, 0.32 * h.h)
    const ox = h.x + SHADOW_DIR.x * o
    const oz = h.z + SHADOW_DIR.z * o
    b.flat(ox - fx / 2, oz - fz / 2 - 0.2 * s, ox + fx / 2 + 0.2 * s, oz + fz / 2, SHADOW_Y, tones.get(PAL.bgLawn[0], haze, 0.62))

    // Front path to the road and a low hedge on either side of it (close up only).
    if (lod < 2) {
      const pw = 0.7 * s
      const doorU = this.doorU(h, s)
      const p0 = onWall('front', doorU, 0)
      const dist = Math.abs(h.front - (h.facing[0] === 'z' ? p0.z : p0.x))
      const along = F.fx === 0
      const cx = p0.x + F.fx * dist / 2
      const cz = p0.z + F.fz * dist / 2
      b.flat(cx - (along ? pw / 2 : dist / 2), cz - (along ? dist / 2 : pw / 2), cx + (along ? pw / 2 : dist / 2), cz + (along ? dist / 2 : pw / 2), PATH_Y, tones.get(PAL.bgPath, haze))
      if (lod === 0 && !h.attached && dist > 1.2 * s) {
        const hedge = tones.get(PAL.hedge[1], haze)
        const hedgeTop = tones.get(PAL.hedge[2], haze)
        // Only across the house front, so a drive beside the house stays open.
        const v = d / 2 + dist - 0.35 * s
        const half = (w / 2 - (doorU + pw / 2 + 0.1 * s)) / 2
        const half2 = (doorU - pw / 2 - 0.1 * s + w / 2) / 2
        if (half > 0.3 * s) box(doorU + pw / 2 + 0.1 * s + half, GROUND, v, 2 * half, 0.5 * s, 0.4 * s, hedge, hedgeTop)
        if (half2 > 0.3 * s) box(doorU - pw / 2 - 0.1 * s - half2, GROUND, v, 2 * half2, 0.5 * s, 0.4 * s, hedge, hedgeTop)
      }
    }

    if (lod === 0) box(0, GROUND, 0, w + 0.14 * s, 0.32 * s, d + 0.14 * s, tones.get(PAL.bgPlinth, haze))
    // The roof covers the top of the walls (a flat roof is its top face).
    const flatTop = tones.get(PAL.bgPlinth, haze)
    box(0, GROUND, 0, w, h.h, d, wall, h.roof === 'flat' && lod === 2 ? flatTop : null, 0.8)

    // Roof: an overhanging eave course and stepped tiers (a gable ridge runs along the front; a hip steps all round).
    // Far away (small, and blurred by the tilt-shift) the eave course alone reads as the roof.
    const top = GROUND + h.h
    if (h.roof === 'flat') {
      if (lod < 2) box(0, top, 0, w + 0.12 * s, 0.24 * s, d + 0.12 * s, wallTop, flatTop)
      if (lod === 0) box(-w * 0.18, top + 0.24 * s, -d * 0.1, w * 0.3, 0.5 * s, d * 0.34, wall, wallTop)
    } else {
      const ew = w + (h.attached ? 0 : 0.36 * s)
      const ed = d + 0.44 * s
      const hip = h.roof === 'hip'
      box(0, top, 0, ew, T, ed, roofDark, roof)
      if (lod < 2) {
        box(0, top + T, 0, hip ? ew * 0.68 : ew - 0.12 * s, T, ed * 0.62, roofDark, roof)
        box(0, top + 2 * T, 0, hip ? ew * 0.36 : ew - 0.24 * s, T * 0.9, ed * 0.26, roof, roofLight)
        if (h.chimney) box(w * 0.27, top, -d * 0.16, 0.42 * s, 3 * T + 0.45 * s, 0.42 * s, tones.get(PAL.bgChimney, haze), tones.get(PAL.bgChimney, haze, 0.8))
      }
    }

    // Openings: door, windows on the front (both floors) and one per free side wall.
    const slots = this.windows(h, s)
    if (lod < 2) {
      const glass = tones.get(PAL.bgGlass, haze)
      const dU = this.doorU(h, s)
      const door = onWall('front', dU, 0.02 * s)
      b.wall(door.x, GROUND + 0.62 * s, door.z, 0.62 * s, 1.2 * s, door.f, tones.get(PAL.bgDoor, haze))
      for (const sl of slots) {
        const pt = onWall(sl.face, sl.u, 0.02 * s)
        b.wall(pt.x, sl.y, pt.z, sl.w, sl.h, pt.f, glass)
      }
    }
    // Night: a few windows lit and now and then a porch lamp, dimmer the farther away. Additive and below the bloom
    // threshold, so the town's own windows, signs and the "!" stay the brightest things in the scene.
    const dim = 0.85 - 0.35 * smooth(0.4, 1.2, Math.hypot(h.x, h.z) / reach)
    if (h.lights > 0 && slots.length > 0) {
      for (let i = 0; i < h.lights; i++) {
        const sl = slots[Math.floor(h.v * 97 + i * 3) % slots.length]
        const pt = onWall(sl.face, sl.u, 0.05 * s)
        const c = col(PAL.bgGlow).multiplyScalar(dim * (i % 2 === 0 ? 1 : 0.86))
        glow.wall(pt.x, sl.y, pt.z, sl.w * 0.92, sl.h * 0.92, pt.f, c)
      }
    }
    if (lod < 2 && h.v > 0.6) {
      const dU = this.doorU(h, s)
      const lamp = onWall('front', dU + (dU > 0 ? -0.5 : 0.5) * s, 0.05 * s)
      glow.wall(lamp.x, GROUND + 1.45 * s, lamp.z, 0.16 * s, 0.2 * s, lamp.f, col(PAL.bgGlow).multiplyScalar(dim * 0.9))
    }
  }

  /**
   * Lanes: lighter asphalt with a low kerb strip each side, open where another street joins on that side. They stop at
   * the town roads' asphalt (whose sidewalks open for them, street.ts) and reach half a lane past the outermost ring's
   * centrelines to close its corners.
   */
  private lanes(b: Batch, plan: OutskirtsPlan, tones: Tones, hazeAt: (x: number, z: number) => number): void {
    const out = (a: number, c: number, cuts: number[][]): number[][] => {
      const pieces: number[][] = []
      let from = a
      for (const [g0, g1] of [...cuts].sort((p, q) => p[0] - q[0])) {
        if (g1 <= a || g0 >= c) continue
        if (g0 > from + 0.25) pieces.push([from, g0])
        from = Math.max(from, g1)
      }
      if (c > from + 0.25) pieces.push([from, c])
      return pieces
    }
    const half = LANE_W / 2
    for (const l of plan.lanes) {
      const alongX = l.axis === 'x'
      const mains = alongX ? plan.mains.x : plan.mains.z
      // Rect across the lane from `o0` to `o1` (offsets from the centreline), between a and c along it.
      const rect = (a: number, c: number, o0: number, o1: number): [number, number, number, number] =>
        alongX ? [a, l.at + o0, c, l.at + o1] : [l.at + o0, a, l.at + o1, c]
      for (const [a, c] of out(l.from - half, l.to + half, mains.map((m) => [m - ASPHALT_HALF, m + ASPHALT_HALF]))) {
        const haze = hazeAt(alongX ? (a + c) / 2 : l.at, alongX ? l.at : (a + c) / 2)
        const [x0, z0, x1, z1] = rect(a, c, -half, half)
        b.flat(x0, z0, x1, z1, 0, tones.get(PAL.bgLane, haze))
      }
      if (plan.lite) continue
      const crossing = plan.lanes.filter((o) => o.axis !== l.axis)
      for (const sgn of [-1, 1]) {
        // A crossing lane opens this side only if it continues to this side (lanes end at the outermost ring).
        const joins = crossing.filter((o) => (sgn < 0 ? o.from < l.at - 1e-6 : o.to > l.at + 1e-6)).map((o) => [o.at - half, o.at + half])
        const cuts = [...joins, ...mains.map((m) => [m - MAIN_HALF, m + MAIN_HALF])]
        for (const [a, c] of out(l.from - half - LANE_EDGE, l.to + half + LANE_EDGE, cuts)) {
          const haze = hazeAt(alongX ? (a + c) / 2 : l.at, alongX ? l.at : (a + c) / 2)
          const [x0, z0, x1, z1] = rect(a, c, sgn < 0 ? -half - LANE_EDGE : half, sgn < 0 ? -half : half + LANE_EDGE)
          b.strip(x0, z0, x1, z1, -0.02, 0.1, tones.get(PAL.bgKerb, haze, 0.86), tones.get(PAL.bgKerb, haze))
        }
      }
    }
  }

  /** Garden plot: its own lawn tone, and close up a low hedge on the back edge and between it and the previous plot. */
  private plot(b: Batch, p: Plot, tones: Tones, haze: number, s: number): void {
    b.flat(p.x0, p.z0, p.x1, p.z1, GROUND, tones.get(PAL.bgLawn[p.tone % PAL.bgLawn.length], haze))
    if (p.lod === 2) return
    const hedge = tones.get(PAL.hedge[1], haze)
    const top = tones.get(PAL.hedge[2], haze)
    const h = 0.42 * s
    const t = 0.28 * s
    const alongX = p.facing[0] === 'z' // the row runs along X
    if (p.back) {
      if (alongX) {
        const z = p.facing === 'z+' ? p.z0 : p.z1
        b.strip(p.x0, z - t / 2, p.x1, z + t / 2, GROUND, h, hedge, top)
      } else {
        const x = p.facing === 'x+' ? p.x0 : p.x1
        b.strip(x - t / 2, p.z0, x + t / 2, p.z1, GROUND, h, hedge, top)
      }
    }
    if (p.start) {
      // From the back edge to just short of the street.
      const inset = 0.5 * s
      if (alongX) {
        const z0 = p.facing === 'z+' ? p.z0 : p.z0 + inset
        const z1 = p.facing === 'z+' ? p.z1 - inset : p.z1
        b.strip(p.x0 - t / 2, z0, p.x0 + t / 2, z1, GROUND, h, hedge, top)
      } else {
        const x0 = p.facing === 'x+' ? p.x0 : p.x0 + inset
        const x1 = p.facing === 'x+' ? p.x1 - inset : p.x1
        b.strip(x0, p.z0 - t / 2, x1, p.z0 + t / 2, GROUND, h, hedge, top)
      }
    }
  }

  /** Door position along the front: an outer third on wide houses, a quarter on narrow ones. */
  private doorU(h: House, s: number): number {
    const side = h.v < 0.5 ? -1 : 1
    return h.w >= 3.6 * s ? (side * h.w) / 3 : (side * h.w) / 4
  }

  /** Window slots: front (each floor, skipping the door), then one centred on each free side wall. */
  private windows(h: House, s: number): Array<{ face: 'front' | 'right' | 'left'; u: number; y: number; w: number; h: number }> {
    const out: Array<{ face: 'front' | 'right' | 'left'; u: number; y: number; w: number; h: number }> = []
    const door = this.doorU(h, s)
    const wide = h.w >= 3.6 * s
    const us = wide ? [-h.w / 3, 0, h.w / 3] : [-h.w / 4, h.w / 4]
    const ww = 0.62 * s
    const wh = 0.7 * s
    const yLow = GROUND + 1.45 * s
    const yHigh = GROUND + h.h - 1.05 * s
    for (const u of us) if (Math.abs(u - door) > 0.5 * s) out.push({ face: 'front', u, y: yLow, w: ww, h: wh })
    if (h.storeys === 2) for (const u of wide ? [-h.w / 3, h.w / 3] : us) out.push({ face: 'front', u, y: yHigh, w: ww, h: wh })
    if (!h.attached) {
      const y = h.storeys === 2 ? yHigh : yLow
      out.push({ face: 'right', u: 0, y, w: 0.7 * s, h: wh }, { face: 'left', u: 0, y, w: 0.7 * s, h: wh })
    }
    return out
  }

  private tree(b: Batch, t: Tree, tones: Tones, haze: number): void {
    const s = t.s
    const y = GROUND
    b.flat(t.x - 0.9 * s + SHADOW_DIR.x * 0.9 * s, t.z - 0.9 * s + SHADOW_DIR.z * 0.9 * s, t.x + 0.9 * s + SHADOW_DIR.x * 0.9 * s, t.z + 0.9 * s + SHADOW_DIR.z * 0.9 * s, SHADOW_Y, tones.get(PAL.bgLawn[0], haze, 0.62))
    if (t.kind === 'cone') {
      const [dk, mid, lt] = PAL.pine.map((c) => tones.get(c, haze))
      b.box(t.x, y, t.z, 0.3 * s, 0.8 * s, 0.3 * s, tones.get(PAL.trunk[0], haze))
      b.box(t.x, y + 0.7 * s, t.z, 2.1 * s, 0.7 * s, 2.1 * s, dk, mid, 1, TREE_SWAY, y)
      b.box(t.x, y + 1.35 * s, t.z, 1.5 * s, 0.7 * s, 1.5 * s, mid, lt, 1, TREE_SWAY, y)
      if (t.lod < 2) b.box(t.x, y + 2.0 * s, t.z, 0.9 * s, 0.6 * s, 0.9 * s, mid, lt, 1, TREE_SWAY, y)
      if (t.lod === 0) b.box(t.x, y + 2.55 * s, t.z, 0.4 * s, 0.4 * s, 0.4 * s, lt, lt, 1, TREE_SWAY, y)
      return
    }
    const ramp = t.v < 0.12 ? PAL.golden : PAL.leaf
    const [dk, mid, lt] = ramp.map((c) => tones.get(c, haze))
    b.box(t.x, y, t.z, 0.34 * s, 1.3 * s, 0.34 * s, tones.get(PAL.trunk[1], haze))
    b.box(t.x, y + 1.1 * s, t.z, 1.8 * s, 1.35 * s, 1.8 * s, dk, mid, 1, TREE_SWAY, y)
    if (t.lod === 0) b.box(t.x, y + 1.35 * s, t.z, 2.4 * s, 0.8 * s, 1.2 * s, dk, mid, 1, TREE_SWAY, y)
    if (t.lod < 2) b.box(t.x + (t.v < 0.5 ? 0.3 : -0.3) * s, y + 2.45 * s, t.z - 0.15 * s, 1.1 * s, 0.45 * s, 1.1 * s, mid, lt, 1, TREE_SWAY, y)
  }

  private parkPaths(b: Batch, r: { x0: number; x1: number; z0: number; z1: number }, c: THREE.Color, s: number): void {
    const cx = (r.x0 + r.x1) / 2
    const cz = (r.z0 + r.z1) / 2
    const pw = 0.9 * s
    b.flat(r.x0, cz - pw / 2, r.x1, cz + pw / 2, PATH_Y, c)
    b.flat(cx - pw / 2, r.z0, cx + pw / 2, r.z1, PATH_Y, c)
  }

  /** Allotment beds: rows of dark soil with a low crop in a muted colour, a narrow path between rows. */
  private allotment(b: Batch, r: { x0: number; x1: number; z0: number; z1: number }, tones: Tones, haze: number, s: number): void {
    const crops = [PAL.lawn[0], PAL.golden[1], PAL.hedge[2], PAL.blossom[0], PAL.leaf[1], PAL.sand[1]]
    const soil = tones.get(PAL.soil[1], haze)
    const step = 1.3 * s
    let i = 0
    for (let z = r.z0 + 0.9 * s; z + 0.8 * s < r.z1 - 2.6 * s; z += step, i++) {
      b.flat(r.x0 + 0.8 * s, z, r.x1 - 0.8 * s, z + 0.8 * s, PATH_Y, soil)
      const crop = tones.get(crops[(i * 7 + Math.abs(Math.round(r.x0 + r.z0))) % crops.length], haze)
      b.box((r.x0 + r.x1) / 2, PATH_Y, z + 0.4 * s, r.x1 - r.x0 - 2.2 * s, 0.24 * s, 0.4 * s, crop, crop)
    }
  }
}

/** Small voxel car, nose toward +Z; white parts take the instance colour. A dark contact shadow sits under it. */
function carGeometry(s: number, lite: boolean): THREE.BufferGeometry {
  const b = new Batch()
  const body = col(0xffffff)
  const glass = col(0x3a4250)
  const tyre = col(0x24272d)
  b.flat(-0.52 * s, -0.95 * s, 0.52 * s, 0.95 * s, 0.012, col(0x2a2e36))
  b.box(0, 0.14 * s, 0, 0.84 * s, 0.36 * s, 1.64 * s, body, body, 0.85)
  b.box(0, 0.5 * s, -0.12 * s, 0.72 * s, 0.26 * s, 0.92 * s, glass)
  b.box(0, 0.76 * s, -0.12 * s, 0.76 * s, 0.07 * s, 0.98 * s, body)
  if (!lite) for (const x of [-0.36, 0.36]) for (const z of [-0.5, 0.5]) b.box(x * s, 0, z * s, 0.15 * s, 0.28 * s, 0.32 * s, tyre)
  return b.build()
}

/** Head- and tail-lamps of a car (additive, night only), plus a faint pool of light on the lane ahead. */
function lampGeometry(s: number): THREE.BufferGeometry {
  const b = new Batch()
  const head = col(0xfff0d2).multiplyScalar(0.9)
  const tail = col(0xff5a48).multiplyScalar(0.7)
  for (const x of [-0.27, 0.27]) {
    b.wall(x * s, 0.36 * s, 0.83 * s, 0.16 * s, 0.1 * s, 'z+', head)
    b.wall(x * s, 0.38 * s, -0.83 * s, 0.16 * s, 0.09 * s, 'z-', tail)
  }
  // The pool on the lane ahead fades out with distance from the nose.
  b.flat(-0.55 * s, 0.9 * s, 0.55 * s, 2.8 * s, 0.02, new THREE.Color(0, 0, 0), col(0xffe2b0).multiplyScalar(0.05))
  return b.build()
}
