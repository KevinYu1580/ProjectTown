// Urban theme: a background neighbourhood around the town (placement in urbanPlan.ts): lanes, garden plots, houses,
// terraces, shops, apartment blocks, workshops, a school and a church, open spaces, trees and allotments in one
// vertex-coloured mesh that is tinted at night like the countryside, sparse warm windows in one additive mesh, and small
// cars on the lanes (instanced). It never casts shadows, and nothing here is a person or carries a sign: people stand for
// sessions and signs for projects. Cars follow an animation clock that only advances with dt, so a frozen scene (dt = 0)
// always shows the same frame and never needs redrawing.
import * as THREE from 'three'
import { fnv1a32 } from '../../util/hash'
import { createRng } from '../../util/prng'
import { flower, voxelBush, voxelTree } from '../flora'
import { SIDEWALK_WIDTH, type TownLayout } from '../layout'
import { PAL } from '../palette'
import { ASPHALT_W, GRASS_TOP, GROUND_REACH, KERB_W, PLATE_H, type TownEdge } from '../street'
import { VoxelBuilder, makeVoxelMaterial, material } from '../voxel'
import {
  ASPHALT_HALF, LANE_EDGE, LANE_HALF, LANE_W, MAIN_HALF, STOREY, carPose, inHood, planOutskirts, roofTier, type CarPose, type Facing,
  type House, type OutskirtsPlan, type Pad, type Plot, type Tree,
} from './urbanPlan'
import { WalkerMeshes } from './walkers'

const T0 = 41.3 // seconds; the frame a frozen scene shows
const GROUND = -0.02 // block lawns: 0.03 above the plate's grass, below the road tops (y = 0)
const PATH_Y = GROUND + 0.015 // paths, aprons and open ground (never on top of each other)
const LINE_Y = GROUND + 0.025 // court and car park lines, tufts on bare lots
const SHADOW_Y = GROUND + 0.032
const TREE_SWAY = 0.03
// The neighbourhood sinks a little deeper into the night than the countryside, so the town's light stays the focus.
const NIGHT_TINT = new THREE.Color(0.34, 0.4, 0.6)
const WHITE = new THREE.Color(1, 1, 1)
// Far houses fade toward this haze (aerial perspective); the night tint darkens it with everything else.
const HAZE = new THREE.Color(0xc4cfd6)
// The sun (and moon) shine from -X, +Z (sky.ts), so baked contact shadows fall toward +X, -Z.
const SHADOW_DIR = { x: 0.63, z: -0.77 }

// The countryside past the neighbourhood (drawn into the street's surround): thin meadow layers sit on the grass at
// distinct heights (no z-fighting) and stay below the asphalt top (y = 0).
const MEADOW_H = [0.008, 0.016, 0.024]
const SHORE_TOP = GRASS_TOP + 0.03
const WATER_TOP = GRASS_TOP + 0.044
const CELL = 6 // outer tree jitter-grid cell size

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

// House-local frame per facing: front (f) and right (r) directions in the XZ plane, and which way the other walls face.
const FRAME: Record<Facing, { fx: number; fz: number; rx: number; rz: number; right: Facing; left: Facing; back: Facing }> = {
  'z+': { fx: 0, fz: 1, rx: 1, rz: 0, right: 'x+', left: 'x-', back: 'z-' },
  'z-': { fx: 0, fz: -1, rx: -1, rz: 0, right: 'x-', left: 'x+', back: 'z+' },
  'x+': { fx: 1, fz: 0, rx: 0, rz: -1, right: 'z-', left: 'z+', back: 'x-' },
  'x-': { fx: -1, fz: 0, rx: 0, rz: 1, right: 'z+', left: 'z-', back: 'x+' },
}

type Face = 'front' | 'back' | 'right' | 'left'
interface Slot { face: Face; u: number; y: number; w: number; h: number }

/**
 * Drawing in a building's own frame: `u` across the front (to its right), `v` toward the front (the front wall is at
 * v = d / 2). Boxes by their bottom centre; panels are openings on a face, `onWall` puts one on a wall `u` along it.
 */
function local(b: Batch, h: Pick<House, 'x' | 'z' | 'w' | 'd' | 'facing'>) {
  const F = FRAME[h.facing]
  const along = F.fx === 0
  const pt = (u: number, v: number) => ({ x: h.x + u * F.rx + v * F.fx, z: h.z + u * F.rz + v * F.fz })
  const box = (u: number, y: number, v: number, bw: number, bh: number, bd: number, c: THREE.Color, top: THREE.Color | null = c, foot = 1): void => {
    const p = pt(u, v)
    b.box(p.x, y, p.z, along ? bw : bd, bh, along ? bd : bw, c, top, foot)
  }
  const panel = (u: number, y: number, v: number, w: number, ht: number, face: Face, c: THREE.Color, out = b): void => {
    const p = pt(u, v)
    out.wall(p.x, y, p.z, w, ht, face === 'front' ? h.facing : F[face], c)
  }
  const onWall = (face: Face, u: number, y: number, w: number, ht: number, lift: number, c: THREE.Color, out = b): void => {
    if (face === 'front' || face === 'back') panel(u, y, (face === 'front' ? 1 : -1) * (h.d / 2 + lift), w, ht, face, c, out)
    else panel((face === 'right' ? 1 : -1) * (h.w / 2 + lift), y, u, w, ht, face, c, out)
  }
  return { pt, box, panel, onWall }
}
type Local = ReturnType<typeof local>

/** Stable pseudo-random value in [0, 1) for window `i` of a building with variation `v`. */
const hash01 = (i: number, v: number): number => {
  const x = Math.sin(i * 12.9898 + v * 78.233) * 43758.5453
  return x - Math.floor(x)
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
  private walkers: WalkerMeshes | null = null
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

  /** Plans and builds the neighbourhood around `layout`; the street draws the plate and countryside through `surround`. */
  build(layout: TownLayout, opts: { seed: number; lite: boolean }): TownEdge & { glows: Array<{ x: number; z: number }> } {
    const plan = planOutskirts(layout, opts)
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
    for (const p of plan.pads) this.pad(solid, p, tones, hazeAt((p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2), s)
    this.lanes(solid, plan, tones, hazeAt)
    for (const h of plan.houses) this.building(solid, glow, h, tones, hazeAt(h.x, h.z), s, plan.reach)
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
    if (plan.walkers.length > 0) {
      this.walkers = new WalkerMeshes(plan.walkers, this.mat)
      content.add(this.walkers.group)
    }
    this.content = content
    this.root.add(content)
    this.poseCars()
    this.walkers?.update(this.t)
    this.setLightLevel(this.level)
    return { exits: plan.exits, glows: [], surround: (outer, props, water) => surround(outer, props, water, plan) }
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
    // People are out by day and through dusk.
    if (this.walkers) this.walkers.group.visible = level > 0.3
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return
    this.t += dtMs / 1000
    this.poseCars()
    this.walkers?.update(this.t)
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
    this.walkers = null
  }

  /** One building: a baked contact shadow, then its kind's walls, roof and openings; a few lit windows glow at night. */
  private building(b: Batch, glow: Batch, h: House, tones: Tones, haze: number, s: number, reach: number): void {
    // Baked contact shadow on the ground, toward +X / -Z.
    const fx = h.facing[0] === 'z' ? h.w : h.d
    const fz = h.facing[0] === 'z' ? h.d : h.w
    const o = Math.min(1.1 * s, 0.32 * h.h)
    const ox = h.x + SHADOW_DIR.x * o
    const oz = h.z + SHADOW_DIR.z * o
    b.flat(ox - fx / 2, oz - fz / 2 - 0.2 * s, ox + fx / 2 + 0.2 * s, oz + fz / 2, SHADOW_Y, tones.get(PAL.bgLawn[0], haze, 0.62))
    // Night windows are dimmer the farther away. Additive and below the bloom threshold, so the town's own windows,
    // signs and the "!" stay the brightest things in the scene.
    const dim = 0.85 - 0.35 * smooth(0.4, 1.2, Math.hypot(h.x, h.z) / reach)
    if (h.kind === 'house' || h.kind === 'terrace') this.house(b, glow, h, tones, haze, s, dim)
    else if (h.kind === 'shop') this.shop(b, glow, h, tones, haze, s, dim)
    else if (h.kind === 'flats' || h.kind === 'school') this.block(b, glow, h, tones, haze, s, dim)
    else if (h.kind === 'works') this.works(b, glow, h, tones, haze, s, dim)
    else if (h.kind === 'church') this.church(b, glow, h, tones, haze, s, dim)
    else this.tower(b, h, tones, haze, s)
  }

  /** A house or terrace unit: walls with a shaded foot, a stepped roof, door, windows and chimney up close; a garage wing. */
  private house(b: Batch, glow: Batch, h: House, tones: Tones, haze: number, s: number, dim: number): void {
    const wallHex = PAL.bgWall[h.wall % PAL.bgWall.length]
    const wall = tones.get(wallHex, haze)
    const wallTop = tones.get(wallHex, haze, 0.92)
    const flatTop = tones.get(PAL.bgFlatRoof[Math.floor(h.v * 3)], haze)
    if (h.annex !== 0) {
      // Garage wing: low and flat-topped, flush with the front, a wide door; the house takes the rest of the width.
      const aw = Math.abs(h.annex)
      const au = (Math.sign(h.annex) * (h.w - aw)) / 2
      const ad = Math.min(h.d, 3.3 * s)
      const A = local(b, h)
      A.box(au, GROUND, (h.d - ad) / 2, aw, 2.2 * s, ad, wall, flatTop, 0.8)
      if (h.lod < 2) A.panel(au, GROUND + 0.78 * s, h.d / 2 + 0.02 * s, aw - 0.5 * s, 1.5 * s, 'front', tones.get(PAL.bgShedDoor, haze))
      const c = A.pt((-Math.sign(h.annex) * aw) / 2, 0)
      h = { ...h, w: h.w - aw, annex: 0, x: c.x, z: c.z }
    }
    const L = local(b, h)
    const { w, d, lod } = h

    // Front path to the road and a low hedge on either side of it (close up only).
    if (lod < 2) {
      const pw = 0.7 * s
      const doorU = this.doorU(h, s)
      const dist = this.apron(b, L, h, doorU - pw / 2, doorU + pw / 2, tones.get(PAL.bgPath, haze))
      if (lod === 0 && !h.attached && dist > 1.2 * s) {
        const hedge = tones.get(PAL.hedge[1], haze)
        const hedgeTop = tones.get(PAL.hedge[2], haze)
        // Only across the house front, so a drive beside the house stays open.
        const v = d / 2 + dist - 0.35 * s
        const half = (w / 2 - (doorU + pw / 2 + 0.1 * s)) / 2
        const half2 = (doorU - pw / 2 - 0.1 * s + w / 2) / 2
        if (half > 0.3 * s) L.box(doorU + pw / 2 + 0.1 * s + half, GROUND, v, 2 * half, 0.5 * s, 0.4 * s, hedge, hedgeTop)
        if (half2 > 0.3 * s) L.box(doorU - pw / 2 - 0.1 * s - half2, GROUND, v, 2 * half2, 0.5 * s, 0.4 * s, hedge, hedgeTop)
      }
    }

    if (lod === 0) L.box(0, GROUND, 0, w + 0.14 * s, 0.32 * s, d + 0.14 * s, tones.get(PAL.bgPlinth, haze))
    // The roof covers the top of the walls (a flat roof is its top face).
    L.box(0, GROUND, 0, w, h.h, d, wall, h.roof === 'flat' && lod === 2 ? flatTop : null, 0.8)
    const top = GROUND + h.h
    if (h.roof === 'flat') {
      // Attached units keep their parapets flush, so neighbours never overlap.
      if (lod < 2) L.box(0, top, 0, w + (h.attached ? 0 : 0.12 * s), 0.24 * s, d + 0.12 * s, wallTop, flatTop)
      if (lod === 0 && !h.attached) L.box(-w * 0.18, top + 0.24 * s, -d * 0.1, w * 0.3, 0.5 * s, d * 0.34, wall, wallTop)
    } else {
      this.roof(L, h, tones, haze, s, PAL.bgHouseRoof[h.roofTone % PAL.bgHouseRoof.length])
      const T = roofTier(h.kind) * s
      if (lod < 2 && h.chimney) L.box(w * 0.27, top, -d * 0.16, 0.42 * s, 3 * T + 0.45 * s, 0.42 * s, tones.get(PAL.bgChimney, haze), tones.get(PAL.bgChimney, haze, 0.8))
    }

    // Openings: door, windows on the front (every floor) and one per free side wall.
    const slots = this.windows(h, s)
    const dU = this.doorU(h, s)
    if (lod < 2) {
      const glass = tones.get(PAL.bgGlass, haze)
      L.onWall('front', dU, GROUND + 0.62 * s, 0.62 * s, 1.2 * s, 0.02 * s, tones.get(PAL.bgDoor, haze))
      for (const sl of slots) L.onWall(sl.face, sl.u, sl.y, sl.w, sl.h, 0.02 * s, glass)
    }
    // Night: a few windows lit and now and then a porch lamp.
    if (h.lights > 0 && slots.length > 0) {
      for (let i = 0; i < h.lights; i++) {
        const sl = slots[Math.floor(h.v * 97 + i * 3) % slots.length]
        L.onWall(sl.face, sl.u, sl.y, sl.w * 0.92, sl.h * 0.92, 0.05 * s, col(PAL.bgGlow).multiplyScalar(dim * (i % 2 === 0 ? 1 : 0.86)), glow)
      }
    }
    if (lod < 2 && h.v > 0.6) {
      L.onWall('front', dU + (dU > 0 ? -0.5 : 0.5) * s, GROUND + 1.45 * s, 0.16 * s, 0.2 * s, 0.05 * s, col(PAL.bgGlow).multiplyScalar(dim * 0.9), glow)
    }
  }

  /**
   * Stepped roof: an overhanging eave course, then tiers (a gable's ridge runs along the front, a cross gable's from front
   * to back, a hip steps all round, a shed roof rises to the back; a church's is steeper). Far away (small, and blurred by
   * the tilt-shift) the eave course alone reads as the roof.
   */
  private roof(L: Local, h: House, tones: Tones, haze: number, s: number, hex: number): void {
    const T = roofTier(h.kind) * s
    const roof = tones.get(hex, haze)
    const dark = tones.get(hex, haze, 0.78)
    const light = tones.get(hex, haze, 1.14)
    const ew = h.w + (h.attached ? 0 : 0.36 * s)
    const ed = h.d + 0.44 * s
    let y = GROUND + h.h
    L.box(0, y, 0, ew, T, ed, dark, roof)
    if (h.lod === 2) return
    // Tiers above it: width, depth, offset toward the front, height.
    const tiers: Array<[number, number, number, number]> =
      h.roof === 'gable' ? [[ew - 0.12 * s, ed * 0.62, 0, T], [ew - 0.24 * s, ed * 0.26, 0, 0.9 * T]]
        : h.roof === 'hip' ? [[ew * 0.68, ed * 0.62, 0, T], [ew * 0.36, ed * 0.26, 0, 0.9 * T]]
          : h.roof === 'shed' ? [[ew, ed * 0.66, -ed * 0.17, T], [ew, ed * 0.33, -ed * 0.335, 0.9 * T]]
            : h.kind === 'church' ? [[ew * 0.74, ed - 0.1 * s, 0, T], [ew * 0.48, ed - 0.2 * s, 0, T], [ew * 0.22, ed - 0.3 * s, 0, 0.9 * T]]
              : [[ew * 0.62, ed - 0.12 * s, 0, T], [ew * 0.26, ed - 0.24 * s, 0, 0.9 * T]]
    y += T
    tiers.forEach(([tw, td, tv, th], i) => {
      const last = i === tiers.length - 1
      L.box(0, y, tv, tw, th, td, last ? roof : dark, last ? light : roof)
      y += th
    })
  }

  /** Ground strip from the front wall to the street edge, `u0` to `u1` across the front; returns its length. */
  private apron(b: Batch, L: Local, h: House, u0: number, u1: number, c: THREE.Color): number {
    const p = L.pt(u0, h.d / 2)
    const q = L.pt(u1, h.d / 2)
    const alongX = h.facing[0] === 'z'
    const xs = alongX ? [p.x, q.x] : [p.x, h.front]
    const zs = alongX ? [p.z, h.front] : [p.z, q.z]
    b.flat(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), PATH_Y, c)
    return Math.abs(h.front - (alongX ? p.z : p.x))
  }

  /** Corner shop: a darker shop floor with wide windows round the corner under a muted awning, a paved front, flat roof. */
  private shop(b: Batch, glow: Batch, h: House, tones: Tones, haze: number, s: number, dim: number): void {
    const L = local(b, h)
    const { w, d, lod } = h
    const hex = PAL.bgWall[h.wall % PAL.bgWall.length]
    const wall = tones.get(hex, haze)
    const wallTop = tones.get(hex, haze, 0.92)
    const base = tones.get(hex, haze, 0.84)
    const flatTop = tones.get(PAL.bgFlatRoof[Math.floor(h.v * 3)], haze)
    const gH = (0.35 + STOREY) * s
    const top = GROUND + h.h
    L.box(0, GROUND, 0, w, gH, d, base, h.storeys === 1 && lod === 2 ? flatTop : null, 0.8)
    if (h.storeys > 1) L.box(0, GROUND + gH, 0, w, h.h - gH, d, wall, lod === 2 ? flatTop : null)
    const shopW = w - 1.0 * s
    const sideW = Math.min(1.5 * s, d - 1.2 * s)
    if (lod < 2) {
      const glass = tones.get(PAL.bgGlass, haze)
      const awning = PAL.bgAwning[h.roofTone % PAL.bgAwning.length]
      L.box(0, top, 0, w + 0.12 * s, 0.24 * s, d + 0.12 * s, wallTop, flatTop)
      L.onWall('front', 0, GROUND + 1.05 * s, shopW, 1.3 * s, 0.02 * s, glass)
      for (const side of ['right', 'left'] as const) L.onWall(side, d / 2 - 0.45 * s - sideW / 2, GROUND + 1.05 * s, sideW, 1.3 * s, 0.02 * s, glass)
      L.box(0, GROUND + 2.0 * s, d / 2 + 0.3 * s, w - 0.3 * s, 0.14 * s, 0.6 * s, tones.get(awning, haze, 0.8), tones.get(awning, haze))
      this.apron(b, L, h, -w / 2, w / 2, tones.get(PAL.bgPave[1], haze))
      // Flats above: windows on every upper floor.
      for (let k = 1; k < h.storeys; k++) {
        const y = GROUND + (0.35 + (k + 0.55) * STOREY) * s
        for (const u of w >= 4.6 * s ? [-w / 3, 0, w / 3] : [-w / 4, w / 4]) L.onWall('front', u, y, 0.62 * s, 0.75 * s, 0.02 * s, glass)
        for (const side of ['right', 'left'] as const) L.onWall(side, 0, y, 0.7 * s, 0.75 * s, 0.02 * s, glass)
        for (const u of [-w / 4, w / 4]) L.onWall('back', u, y, 0.62 * s, 0.75 * s, 0.02 * s, glass)
      }
      L.onWall('back', w / 4, GROUND + 1.45 * s, 0.62 * s, 0.7 * s, 0.02 * s, glass)
    }
    // Night: the shop window glows (when open), and a lit window or two upstairs.
    if (h.lights > 0) {
      L.onWall('front', 0, GROUND + 1.05 * s, shopW * 0.96, 1.2 * s, 0.05 * s, col(PAL.bgGlow).multiplyScalar(dim * 0.55), glow)
      for (let k = 1; k < h.lights; k++) {
        L.onWall('front', ((k % 2) - 0.5) * (w / 2), GROUND + (0.35 + (k + 0.55) * STOREY) * s, 0.57 * s, 0.7 * s, 0.05 * s, col(PAL.bgGlow).multiplyScalar(dim * 0.9), glow)
      }
    }
  }

  /**
   * Apartment block or school: a darker ground floor, rows of windows (one band per storey a little farther away),
   * an entrance with a canopy, a parapet with rooftop boxes or a hip roof; balconies on some blocks up close.
   */
  private block(b: Batch, glow: Batch, h: House, tones: Tones, haze: number, s: number, dim: number): void {
    const L = local(b, h)
    const { w, d, lod } = h
    const school = h.kind === 'school'
    const pal = school ? PAL.bgWall : PAL.bgFlats
    const hex = pal[h.wall % pal.length]
    const wall = tones.get(hex, haze)
    const wallTop = tones.get(hex, haze, 0.92)
    const flatTop = tones.get(PAL.bgFlatRoof[Math.floor(h.v * 3)], haze)
    const gH = (0.35 + STOREY) * s
    const top = GROUND + h.h
    if (lod === 0) L.box(0, GROUND, 0, w + 0.14 * s, 0.32 * s, d + 0.14 * s, tones.get(PAL.bgPlinth, haze))
    L.box(0, GROUND, 0, w, gH, d, tones.get(hex, haze, 0.86), null, 0.8)
    L.box(0, GROUND + gH, 0, w, h.h - gH, d, wall, h.roof === 'flat' && lod === 2 ? flatTop : null)
    if (h.roof !== 'flat') this.roof(L, h, tones, haze, s, PAL.bgHouseRoof[h.roofTone % PAL.bgHouseRoof.length])
    else if (lod < 2) {
      L.box(0, top, 0, w + 0.1 * s, 0.3 * s, d + 0.1 * s, wallTop, flatTop)
      if (!school) {
        // Stair and lift housing, and up close a water tank.
        L.box((h.v - 0.5) * (w - 3 * s), top + 0.3 * s, -d * 0.12, 1.8 * s, 0.8 * s, 1.5 * s, wall, wallTop)
        if (lod === 0) L.box((h.v < 0.5 ? 0.3 : -0.3) * w, top + 0.3 * s, d * 0.2, 0.8 * s, 0.55 * s, 0.8 * s, tones.get(PAL.bgShedRoof[1], haze, 0.9), tones.get(PAL.bgShedRoof[0], haze))
      }
    }
    const slots = this.grid(h, s)
    if (lod === 0) {
      const glass = tones.get(PAL.bgGlass, haze)
      for (const sl of slots) L.onWall(sl.face, sl.u, sl.y, sl.w, sl.h, 0.02 * s, glass)
    } else {
      // Farther away one band of glass per storey and face: a big block never reads as a blank box.
      const band = tones.get(PAL.bgGlass, haze, 1.12)
      for (let k = 0; k < h.storeys; k++) {
        const y = GROUND + (0.35 + (k + 0.55) * STOREY) * s
        for (const face of ['front', 'back', 'right', 'left'] as const) L.onWall(face, 0, y, (face === 'front' || face === 'back' ? w : d) - 1.0 * s, 0.6 * s, 0.02 * s, band)
      }
    }
    if (lod < 2) {
      if (!school && lod === 0 && h.v < 0.55) {
        // Balconies: a light slab with a parapet below each upper row of windows.
        const bal = tones.get(PAL.bgFlats[0], haze, 0.97)
        for (let k = 1; k < h.storeys; k++) L.box(0, GROUND + (0.3 + k * STOREY) * s, d / 2 + 0.3 * s, w * 0.84, 0.5 * s, 0.6 * s, bal, bal)
      }
      const door = school ? 1.6 * s : 1.0 * s
      L.onWall('front', 0, GROUND + 0.75 * s, door, 1.4 * s, 0.02 * s, tones.get(PAL.bgDoor, haze))
      L.box(0, GROUND + 1.6 * s, d / 2 + 0.35 * s, door + 0.8 * s, 0.14 * s, 0.7 * s, wallTop, flatTop)
      this.apron(b, L, h, -door / 2 - 0.2 * s, door / 2 + 0.2 * s, tones.get(PAL.bgPath, haze))
    }
    // Night: a scattering of lit windows.
    const n = Math.min(h.lights, slots.length)
    slots.forEach((sl, i) => {
      if (hash01(i, h.v) * slots.length >= n) return
      L.onWall(sl.face, sl.u, sl.y, sl.w * 0.92, sl.h * 0.92, 0.05 * s, col(PAL.bgGlow).multiplyScalar(dim * (i % 2 === 0 ? 1 : 0.84)), glow)
    })
  }

  /** Window grid of an apartment block or a school: every storey on all four walls, the entrance left clear. */
  private grid(h: House, s: number): Slot[] {
    const out: Slot[] = []
    const school = h.kind === 'school'
    const step = 1.6 * s
    const ww = (school ? 1.0 : 0.62) * s
    const wh = (school ? 0.95 : 0.8) * s
    const nf = Math.max(2, Math.floor((h.w - 0.8 * s) / step))
    const ns = Math.max(1, Math.floor((h.d - 0.8 * s) / step))
    for (let k = 0; k < h.storeys; k++) {
      const y = GROUND + (0.35 + (k + 0.55) * STOREY) * s
      for (let i = 0; i < nf; i++) {
        const u = (i - (nf - 1) / 2) * step
        if (k > 0 || Math.abs(u) > 1.0 * s) out.push({ face: 'front', u, y, w: ww, h: wh })
        out.push({ face: 'back', u, y, w: ww, h: wh })
      }
      for (let i = 0; i < ns; i++) {
        const u = (i - (ns - 1) / 2) * step
        out.push({ face: 'right', u, y, w: ww, h: wh }, { face: 'left', u, y, w: ww, h: wh })
      }
    }
    return out
  }

  /** Workshop or small warehouse: sheet-metal walls, a sawtooth, shallow gable or flat roof, a wide door, high windows. */
  private works(b: Batch, glow: Batch, h: House, tones: Tones, haze: number, s: number, dim: number): void {
    const L = local(b, h)
    const { w, d, lod } = h
    const wall = tones.get(PAL.bgShed[h.wall % PAL.bgShed.length], haze)
    const roofHex = PAL.bgShedRoof[Math.floor(h.v * 2)]
    const flatTop = tones.get(PAL.bgFlatRoof[Math.floor(h.v * 3)], haze)
    const top = GROUND + h.h
    const capped = h.roof === 'flat' || (h.roof === 'saw' && lod === 2)
    L.box(0, GROUND, 0, w, h.h, d, wall, capped ? (h.roof === 'flat' ? flatTop : tones.get(roofHex, haze)) : null, 0.8)
    if (h.roof === 'gable') this.roof(L, h, tones, haze, s, roofHex)
    else if (h.roof === 'flat' && lod < 2) L.box(0, top, 0, w + 0.1 * s, 0.22 * s, d + 0.1 * s, wall, flatTop)
    else if (h.roof === 'saw' && lod < 2) {
      // Sawtooth: teeth across the width, each stepping up to a glazed face.
      const n = Math.max(2, Math.round(w / (2.6 * s)))
      const tw = w / n
      const th = 0.36 * s
      const roof = tones.get(roofHex, haze)
      const dark = tones.get(roofHex, haze, 0.8)
      const glass = tones.get(PAL.bgGlass, haze, 1.1)
      for (let i = 1; i <= n; i++) {
        const u1 = -w / 2 + i * tw
        for (let k = 0; k < 3; k++) L.box(u1 - (tw * (3 - k)) / 6, top + k * th, 0, (tw * (3 - k)) / 3, th, d, dark, roof)
        L.panel(u1 + 0.02 * s, top + 2 * th, 0, d * 0.88, 1.6 * th, 'right', glass)
      }
    }
    const du = (h.v - 0.5) * Math.max(0, w - 4 * s)
    if (lod < 2) {
      L.onWall('front', du, GROUND + 1.3 * s, 2.8 * s, 2.6 * s, 0.02 * s, tones.get(PAL.bgShedDoor, haze))
      L.onWall('front', du + (du > 0 ? -2.3 : 2.3) * s, GROUND + 0.62 * s, 0.62 * s, 1.2 * s, 0.02 * s, tones.get(PAL.bgDoor, haze))
      const glass = tones.get(PAL.bgGlass, haze)
      for (const face of ['back', 'right', 'left'] as const) L.onWall(face, 0, top - 0.65 * s, (face === 'back' ? w : d) * 0.7, 0.4 * s, 0.02 * s, glass)
    }
    // Night: a lamp over the big door.
    if (h.lights > 0) L.onWall('front', du, GROUND + 2.9 * s, 0.5 * s, 0.18 * s, 0.06 * s, col(PAL.bgGlow).multiplyScalar(dim * 0.9), glow)
  }

  /** Church nave: pale stone, a steep slate roof, tall windows along both sides (two glow dimly at night). */
  private church(b: Batch, glow: Batch, h: House, tones: Tones, haze: number, s: number, dim: number): void {
    const L = local(b, h)
    const { d, lod } = h
    if (lod === 0) L.box(0, GROUND, 0, h.w + 0.14 * s, 0.32 * s, d + 0.14 * s, tones.get(PAL.bgPlinth, haze))
    L.box(0, GROUND, 0, h.w, h.h, d, tones.get(PAL.bgChurch[0], haze), null, 0.8)
    this.roof(L, h, tones, haze, s, PAL.bgChurch[1])
    const n = Math.max(2, Math.floor(d / (2.2 * s)))
    const glass = tones.get(PAL.bgGlass, haze)
    for (let i = 0; i < n; i++) {
      const u = (i - (n - 1) / 2) * (d / n)
      for (const side of ['right', 'left'] as const) {
        if (lod < 2) L.onWall(side, u, GROUND + 2.2 * s, 0.5 * s, 1.9 * s, 0.02 * s, glass)
        if (h.lights > 0 && (i + (side === 'right' ? 0 : 1)) % 3 === 0) {
          L.onWall(side, u, GROUND + 2.2 * s, 0.46 * s, 1.8 * s, 0.05 * s, col(PAL.bgGlow).multiplyScalar(dim * 0.55), glow)
        }
      }
    }
    if (lod < 2) L.onWall('back', 0, GROUND + h.h - 1.1 * s, 0.9 * s, 0.9 * s, 0.02 * s, glass)
  }

  /** Church tower: a stone shaft with belfry openings and a cornice, a stepped lead spire, the church door at its foot. */
  private tower(b: Batch, h: House, tones: Tones, haze: number, s: number): void {
    const L = local(b, h)
    const { w, d, lod } = h
    const stoneTop = tones.get(PAL.bgChurch[0], haze, 0.9)
    const lead = tones.get(PAL.bgChurch[2], haze, 0.85)
    const leadTop = tones.get(PAL.bgChurch[2], haze, 1.05)
    let y = GROUND + h.h
    if (lod === 0) L.box(0, GROUND, 0, w + 0.14 * s, 0.32 * s, d + 0.14 * s, tones.get(PAL.bgPlinth, haze))
    L.box(0, GROUND, 0, w, h.h, d, tones.get(PAL.bgChurch[0], haze), null, 0.8)
    L.box(0, y, 0, w + 0.2 * s, 0.3 * s, d + 0.2 * s, stoneTop, stoneTop)
    y += 0.3 * s
    const steps = lod === 2 ? [[0.7, 1.6], [0.3, 1.6]] : [[0.82, 0.8], [0.62, 0.85], [0.42, 0.9], [0.24, 0.9], [0.1, 0.45]]
    for (const [k, sh] of steps) {
      L.box(0, y, 0, w * k, sh * s, d * k, lead, leadTop)
      y += sh * s
    }
    if (lod < 2) {
      const dark = tones.get(PAL.bgDoor, haze, 0.7)
      for (const face of ['front', 'back', 'right', 'left'] as const) L.onWall(face, 0, GROUND + h.h - 1.0 * s, 0.6 * s, 1.0 * s, 0.02 * s, dark)
      L.onWall('front', 0, GROUND + 0.8 * s, 0.8 * s, 1.5 * s, 0.02 * s, tones.get(PAL.bgDoor, haze))
    }
  }

  /** Open ground: car park, sports court, playground, little square, works yard or bare lot; their details up close only. */
  private pad(b: Batch, p: Pad, tones: Tones, haze: number, s: number): void {
    const alongX = p.x1 - p.x0 >= p.z1 - p.z0
    const len = alongX ? p.x1 - p.x0 : p.z1 - p.z0 // along the long side (a), across it (c)
    const dep = alongX ? p.z1 - p.z0 : p.x1 - p.x0
    const flat = (a0: number, a1: number, c0: number, c1: number, y: number, c: THREE.Color): void =>
      alongX ? b.flat(p.x0 + a0, p.z0 + c0, p.x0 + a1, p.z0 + c1, y, c) : b.flat(p.x0 + c0, p.z0 + a0, p.x0 + c1, p.z0 + a1, y, c)
    const box = (a: number, c: number, y: number, bl: number, bh: number, bd: number, col: THREE.Color, top: THREE.Color = col): void =>
      alongX ? b.box(p.x0 + a, y, p.z0 + c, bl, bh, bd, col, top) : b.box(p.x0 + c, y, p.z0 + a, bd, bh, bl, col, top)
    const near = p.lod < 2
    const rng = createRng(fnv1a32(`pad:${p.x0.toFixed(1)},${p.z0.toFixed(1)}`))
    const line = tones.get(PAL.bgLine, haze)
    const t = 0.07 * s
    switch (p.kind) {
      case 'parking': {
        flat(0, len, 0, dep, PATH_Y, tones.get(PAL.bgLane, haze, 1.16))
        if (!near) break
        // Stalls along both long edges (one where it is narrow), a car in fewer than half of them.
        const sw = 1.3 * s
        const sd = Math.min(2.3 * s, dep / 2)
        const n = Math.floor((len - 0.4 * s) / sw)
        const a0 = (len - n * sw) / 2
        for (const c0 of dep >= 4.4 * s ? [0, dep - sd] : [0]) {
          for (let i = 0; i <= n; i++) flat(a0 + i * sw - t / 2, a0 + i * sw + t / 2, c0 + 0.15 * s, c0 + sd - 0.15 * s, LINE_Y, line)
          for (let i = 0; i < n; i++) {
            if (rng() > 0.45) continue
            const body = tones.get(PAL.bgCar[Math.floor(rng() * PAL.bgCar.length)], haze)
            box(a0 + (i + 0.5) * sw, c0 + sd / 2, GROUND, 0.84 * s, 0.5 * s, 1.64 * s, body, body)
            box(a0 + (i + 0.5) * sw, c0 + sd / 2, GROUND + 0.5 * s, 0.72 * s, 0.28 * s, 0.9 * s, tones.get(0x3a4250, haze), body)
          }
        }
        break
      }
      case 'court': {
        // Paving round a court of muted colour with light lines; a net or two hoops.
        const m = Math.min(1.0 * s, dep * 0.15)
        const pave = tones.get(PAL.bgPave[0], haze)
        flat(0, len, 0, m, PATH_Y, pave)
        flat(0, len, dep - m, dep, PATH_Y, pave)
        flat(0, m, m, dep - m, PATH_Y, pave)
        flat(len - m, len, m, dep - m, PATH_Y, pave)
        flat(m, len - m, m, dep - m, PATH_Y, tones.get(PAL.bgCourt[Math.floor(p.v * PAL.bgCourt.length)], haze))
        if (!near) break
        const [l0, l1, c0, c1] = [m + 0.3 * s, len - m - 0.3 * s, m + 0.3 * s, dep - m - 0.3 * s]
        flat(l0, l1, c0, c0 + t, LINE_Y, line)
        flat(l0, l1, c1 - t, c1, LINE_Y, line)
        flat(l0, l0 + t, c0 + t, c1 - t, LINE_Y, line)
        flat(l1 - t, l1, c0 + t, c1 - t, LINE_Y, line)
        flat(len / 2 - t / 2, len / 2 + t / 2, c0 + t, c1 - t, LINE_Y, line)
        const post = tones.get(PAL.bgShedDoor, haze)
        if (p.v < 0.5) box(len / 2, dep / 2, GROUND, 0.06 * s, 0.55 * s, c1 - c0, tones.get(PAL.bgLine, haze, 0.85))
        else {
          for (const [a, k] of [[l0 + 0.2 * s, 1], [l1 - 0.2 * s, -1]]) {
            box(a, dep / 2, GROUND, 0.1 * s, 1.6 * s, 0.1 * s, post)
            box(a + k * 0.15 * s, dep / 2, GROUND + 1.35 * s, 0.08 * s, 0.45 * s, 0.6 * s, line)
          }
        }
        break
      }
      case 'playground': {
        flat(0, len, 0, dep, PATH_Y, tones.get(PAL.bgSandpit, haze))
        if (!near) break
        const [frame, slide, deck] = PAL.bgPlay.map((c) => tones.get(c, haze))
        // A slide (a deck on a tower, a chute stepping down), and a swing frame.
        const a = len * (0.22 + 0.1 * p.v)
        const c = dep * 0.5
        box(a, c, GROUND, 0.8 * s, 1.0 * s, 0.8 * s, frame, deck)
        box(a, c, GROUND + 1.0 * s, 0.9 * s, 0.5 * s, 0.9 * s, deck, deck)
        for (let k = 0; k < 3; k++) box(a + (0.7 + 0.5 * k) * s, c, GROUND, 0.5 * s, (0.75 - 0.25 * k) * s, 0.45 * s, slide)
        const sa = len * 0.72
        for (const k of [-1, 1]) box(sa + k * 1.0 * s, c, GROUND, 0.1 * s, 1.5 * s, 0.1 * s, frame)
        box(sa, c, GROUND + 1.5 * s, 2.1 * s, 0.1 * s, 0.1 * s, frame)
        for (const k of [-0.45, 0.45]) box(sa + k * s, c, GROUND + 0.45 * s, 0.4 * s, 0.06 * s, 0.25 * s, slide)
        break
      }
      case 'plaza': {
        // Paving in large squares of two tones; a fountain in the middle and benches where there is room.
        const [dark, light] = PAL.bgPave.map((c) => tones.get(c, haze))
        const na = Math.max(1, Math.round(len / (2.2 * s)))
        const nc = Math.max(1, Math.round(dep / (2.2 * s)))
        for (let i = 0; i < na; i++) {
          for (let j = 0; j < nc; j++) flat((i * len) / na, ((i + 1) * len) / na, (j * dep) / nc, ((j + 1) * dep) / nc, PATH_Y, (i + j) % 2 ? light : dark)
        }
        if (!near || Math.min(len, dep) < 3.6 * s) break
        const stone = tones.get(PAL.bgChurch[0], haze, 0.92)
        if (p.v < 0.5) {
          // A fountain: a low basin of water with a spout.
          box(len / 2, dep / 2, GROUND, 2.0 * s, 0.4 * s, 2.0 * s, stone, tones.get(PAL.bgPool, haze))
          box(len / 2, dep / 2, GROUND + 0.4 * s, 0.3 * s, 0.5 * s, 0.3 * s, stone)
        } else {
          // A raised bed with a clipped shrub.
          box(len / 2, dep / 2, GROUND, 2.2 * s, 0.4 * s, 1.6 * s, stone, tones.get(PAL.soil[1], haze))
          box(len / 2, dep / 2, GROUND + 0.4 * s, 1.5 * s, 0.55 * s, 1.0 * s, tones.get(PAL.hedge[1], haze), tones.get(PAL.hedge[2], haze))
        }
        const bench = tones.get(PAL.wood[1], haze)
        for (const c of [0.5 * s, dep - 0.5 * s]) for (const a of [len * 0.25, len * 0.75]) box(a, c, GROUND, 1.2 * s, 0.35 * s, 0.4 * s, bench)
        break
      }
      case 'yard': {
        flat(0, len, 0, dep, PATH_Y, tones.get(PAL.bgPave[0], haze, 0.95))
        if (!near) break
        // A container at one end, a few crates and pallets.
        if (len > 6 * s && dep > 1.4 * s) {
          const hex = PAL.bgAwning[Math.floor(p.v * PAL.bgAwning.length)]
          box(len - 1.6 * s, dep / 2, GROUND, 2.6 * s, 1.1 * s, Math.min(1.0 * s, dep - 0.3 * s), tones.get(hex, haze, 0.85), tones.get(hex, haze))
        }
        const crate = tones.get(PAL.wood[1], haze)
        for (let i = 0; i < 3; i++) {
          if (rng() < 0.7) box((0.12 + 0.45 * rng()) * len, (0.3 + 0.4 * rng()) * dep, GROUND, 0.7 * s, (0.35 + 0.4 * rng()) * s, 0.6 * s, crate, tones.get(PAL.wood[2], haze))
        }
        break
      }
      case 'lot': {
        flat(0, len, 0, dep, PATH_Y, tones.get(PAL.bgEarth[Math.floor(p.v * PAL.bgEarth.length)], haze))
        if (!near) break
        // Tufts of grass and a shrub.
        const grass = tones.get(PAL.bgLawn[2], haze)
        for (let i = 0; i < 5; i++) {
          const a = (0.1 + 0.8 * rng()) * len
          const c = (0.1 + 0.8 * rng()) * dep
          flat(a - 0.35 * s, a + 0.35 * s, c - 0.25 * s, c + 0.25 * s, LINE_Y, grass)
        }
        box(len * (0.2 + 0.6 * p.v), dep * 0.5, GROUND, 0.9 * s, 0.6 * s, 0.8 * s, tones.get(PAL.hedge[1], haze), tones.get(PAL.hedge[2], haze))
        break
      }
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

  /**
   * Window slots: front (each floor, skipping the door), back (one or two per floor: the camera orbits, so backs are seen
   * as often as fronts), then one centred on each free side wall.
   */
  private windows(h: House, s: number): Slot[] {
    const out: Slot[] = []
    const door = this.doorU(h, s)
    const wide = h.w >= 3.6 * s
    const us = wide ? [-h.w / 3, 0, h.w / 3] : [-h.w / 4, h.w / 4]
    const ww = 0.62 * s
    const wh = 0.7 * s
    const yLow = GROUND + 1.45 * s
    const yHigh = GROUND + h.h - 1.05 * s
    for (const u of us) if (Math.abs(u - door) > 0.5 * s) out.push({ face: 'front', u, y: yLow, w: ww, h: wh })
    for (let k = 0; k < h.storeys; k++) {
      const y = h.storeys > 1 ? yLow + ((yHigh - yLow) * k) / (h.storeys - 1) : yLow
      if (k > 0) for (const u of wide ? [-h.w / 3, h.w / 3] : us) out.push({ face: 'front', u, y, w: ww, h: wh })
      for (const u of wide ? [-h.w / 4, h.w / 4] : [0]) out.push({ face: 'back', u, y, w: ww, h: wh })
    }
    if (!h.attached) {
      const y = h.storeys > 1 ? yHigh : yLow
      out.push({ face: 'right', u: 0, y, w: 0.7 * s, h: wh }, { face: 'left', u: 0, y, w: 0.7 * s, h: wh })
    }
    return out
  }

  private tree(b: Batch, t: Tree, tones: Tones, haze: number): void {
    const s = t.s
    const y = GROUND
    const r = (t.kind === 'column' ? 0.55 : 0.9) * s
    b.flat(t.x - r + SHADOW_DIR.x * r, t.z - r + SHADOW_DIR.z * r, t.x + r + SHADOW_DIR.x * r, t.z + r + SHADOW_DIR.z * r, SHADOW_Y, tones.get(PAL.bgLawn[0], haze, 0.62))
    if (t.kind === 'column') {
      // Poplar: a tall narrow crown.
      const [dk, mid, lt] = PAL.hedge.map((c) => tones.get(c, haze))
      b.box(t.x, y, t.z, 0.26 * s, 0.6 * s, 0.26 * s, tones.get(PAL.trunk[0], haze))
      b.box(t.x, y + 0.45 * s, t.z, 0.95 * s, 2.3 * s, 0.95 * s, dk, mid, 1, TREE_SWAY, y)
      if (t.lod < 2) b.box(t.x, y + 2.75 * s, t.z, 0.6 * s, 0.5 * s, 0.6 * s, mid, lt, 1, TREE_SWAY, y)
      return
    }
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

/**
 * The plate under the whole scene (every town road line runs on across it to the edge), the pond of the neighbourhood's
 * pond park, and the countryside between the neighbourhood and the plate edge: meadows, groves, shrubs, flower patches
 * and road-side avenues. Drawn into the street's surround, which shares the verge's night tint.
 */
function surround(outer: VoxelBuilder, outerProps: VoxelBuilder, water: THREE.BufferGeometry[], plan: OutskirtsPlan): void {
  const plate = plan.plate
  const plateW = plate.x1 - plate.x0
  const plateD = plate.z1 - plate.z0
  const midX = (plate.x0 + plate.x1) / 2
  const midZ = (plate.z0 + plate.z1) / 2
  const roads = plan.mains
  outer.box(midX, GRASS_TOP - 0.4, midZ, plateW, 0.4, plateD, material(PAL.grass[1]))
  outer.box(midX, GRASS_TOP - 1.9, midZ, plateW, 1.5, plateD, material(PAL.soil[1]))
  outer.box(midX, -PLATE_H, midZ, plateW, PLATE_H + GRASS_TOP - 1.9, plateD, material(PAL.rim))
  outer.box(0, GRASS_TOP - 0.02, 0, 2 * GROUND_REACH, 0.01, 2 * GROUND_REACH, material(PAL.grass[1]))
  const rng = createRng(fnv1a32(`surround:${plateW.toFixed(1)},${plateD.toFixed(1)}`))
  const between = (lo: number, hi: number): number => lo + (hi - lo) * rng()
  // The neighbourhood (town included) ends at its outermost lane; countryside stays clear of that lane too.
  const nearHood = (x: number, z: number, gap: number): boolean => inHood(plan, x, z, LANE_HALF + gap)
  const nearRoad = (x: number, z: number, w: number): boolean =>
    roads.x.some((l) => Math.abs(x - l) < w) || roads.z.some((l) => Math.abs(z - l) < w)
  const inside = (x: number, z: number, inset: number): boolean =>
    x > plate.x0 + inset && x < plate.x1 - inset && z > plate.z0 + inset && z < plate.z1 - inset

  // Pond in the neighbourhood's pond park, on the right of the default view.
  const pond = plan.pond ?? { x: 0, z: 0, rx: 0, rz: 0 }
  const inPond = (x: number, z: number, pad: number): boolean =>
    ((x - pond.x) / (pond.rx + pad)) ** 2 + ((z - pond.z) / (pond.rz + pad)) ** 2 < 1
  const hasPond = plan.pond !== null
  if (hasPond) {
    // Blocky ellipse: rows of water with a sandy, stepped shore.
    for (let dz = -pond.rz; dz <= pond.rz + 1e-6; dz += 0.7) {
      const half = pond.rx * Math.sqrt(Math.max(0, 1 - (dz / (pond.rz + 0.35)) ** 2))
      if (half < 0.5) continue
      const w = Math.round(half / 0.7) * 1.4
      outer.box(pond.x, SHORE_TOP - 0.06, pond.z + dz, w + 1.4, 0.06, 0.7, material(PAL.meadow[2]))
      water.push(new THREE.BoxGeometry(w, 0.05, 0.7).translate(pond.x, WATER_TOP - 0.025, pond.z + dz))
    }
    for (let i = 0; i < 5; i++) {
      const a = rng() * Math.PI * 2
      const k = 0.35 + rng() * 0.45
      outer.box(pond.x + Math.cos(a) * pond.rx * k, WATER_TOP, pond.z + Math.sin(a) * pond.rz * k, 0.6, 0.03, 0.6, material(PAL.lawn[2]))
    }
    for (let i = 0; i < 14; i++) {
      const a = rng() * Math.PI * 2
      const x = pond.x + Math.cos(a) * (pond.rx + 0.5)
      const z = pond.z + Math.sin(a) * (pond.rz + 0.5)
      outerProps.box(x, GRASS_TOP, z, 0.14, 0.7 + rng() * 0.5, 0.14, material(PAL.hedge[2]), 0.12, GRASS_TOP)
      outerProps.box(x + 0.2, GRASS_TOP, z + 0.1, 0.14, 0.5 + rng() * 0.4, 0.14, material(PAL.hedge[1]), 0.12, GRASS_TOP)
    }
  }
  const clear = (x: number, z: number, pad: number): boolean => !(hasPond && inPond(x, z, pad))

  // Meadow patches: blocky tone variations, each tone at its own height so overlaps never z-fight.
  const patchCount = Math.round((plateW * plateD) / 420)
  for (let i = 0; i < patchCount; i++) {
    const x = between(plate.x0, plate.x1)
    const z = between(plate.z0, plate.z1)
    const rx = between(3, 9)
    const rz = between(3, 9)
    const tone = Math.floor(rng() * 3)
    if (!inside(x, z, Math.max(rx, rz)) || nearHood(x, z, Math.max(rx, rz)) || !clear(x, z, Math.max(rx, rz))) continue
    const c = material([PAL.meadow[0], PAL.meadow[1], PAL.grass[2]][tone])
    outer.box(x, GRASS_TOP, z, rx * 2, MEADOW_H[tone], rz * 1.2, c)
    outer.box(x + rx * 0.3, GRASS_TOP, z + rz * 0.2, rx * 1.2, MEADOW_H[tone], rz * 2, c)
  }

  // Groves: trees follow a smooth density field; shrubs and flower patches fill the open meadow.
  const fieldAt = (x: number, z: number): number =>
    (Math.sin(x * 0.06 + 1.3) + Math.sin(z * 0.05 + 0.4) + Math.sin((x + z) * 0.037 + 2) + 3) / 6
  for (let x = plate.x0; x < plate.x1; x += CELL) {
    for (let z = plate.z0; z < plate.z1; z += CELL) {
      const px = x + CELL / 2 + between(-2.4, 2.4)
      const pz = z + CELL / 2 + between(-2.4, 2.4)
      const dense = THREE.MathUtils.smoothstep(fieldAt(px, pz), 0.55, 0.85)
      const roll = rng()
      const cone = rng() < 0.4
      const s = between(0.95, 1.5)
      const v = 0.2 + 0.8 * rng()
      if (roll < 0.02 + 0.75 * dense && inside(px, pz, 3) && !nearHood(px, pz, 2.4) && !nearRoad(px, pz, 6) && clear(px, pz, 3)) {
        voxelTree(outer, px, GRASS_TOP, pz, cone ? 'cone' : 'round', s, v)
      } else if (roll > 0.9 && dense < 0.3 && inside(px, pz, 4) && !nearHood(px, pz, 1.6) && !nearRoad(px, pz, 4) && clear(px, pz, 2)) {
        // Flower patch: a loose cluster of one or two colours.
        const c0 = PAL.flowers[Math.floor(rng() * PAL.flowers.length)]
        const c1 = PAL.flowers[Math.floor(rng() * PAL.flowers.length)]
        const n = 10 + Math.floor(rng() * 6)
        for (let i = 0; i < n; i++) flower(outer, px + between(-1.3, 1.3), GRASS_TOP, pz + between(-1.0, 1.0), i % 3 ? c0 : c1, 1.4)
      }
    }
  }
  for (let x = plate.x0; x < plate.x1; x += CELL * 0.7) {
    for (let z = plate.z0; z < plate.z1; z += CELL * 0.7) {
      const px = x + between(0, CELL * 0.7)
      const pz = z + between(0, CELL * 0.7)
      const s = between(0.8, 1.4)
      const v = rng()
      if (rng() < 0.16 && inside(px, pz, 2) && !nearHood(px, pz, 1) && !nearRoad(px, pz, 4.4) && clear(px, pz, 1.5)) {
        voxelBush(outer, px, GRASS_TOP, pz, s, v)
      }
    }
  }

  // Avenues: trees along the road lines that run out across the plate.
  const avenueOff = ASPHALT_W / 2 + KERB_W + SIDEWALK_WIDTH + 1.4
  const avenue = (x: number, z: number, seed: string): void => {
    if (!inside(x, z, 2) || nearHood(x, z, 2) || !clear(x, z, 2)) return
    const v = createRng(fnv1a32(seed))()
    voxelTree(outer, x, GRASS_TOP, z, v < 0.3 ? 'cone' : 'round', 0.95 + v * 0.25, v * 0.7 + 0.2)
  }
  for (const x of roads.x) {
    for (const s of [-1, 1]) for (let z = plate.z0 + 4; z < plate.z1 - 4; z += 9) avenue(x + s * avenueOff, z, `av:${x.toFixed(1)},${z.toFixed(1)},${s}`)
  }
  for (const z of roads.z) {
    for (const s of [-1, 1]) for (let x = plate.x0 + 4; x < plate.x1 - 4; x += 9) avenue(x, z + s * avenueOff, `av:${x.toFixed(1)},${z.toFixed(1)},${s}`)
  }
}
