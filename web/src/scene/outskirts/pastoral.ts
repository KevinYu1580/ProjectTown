// Pastoral theme: countryside around the town (placement in pastoralPlan.ts). Static parts go into one vertex-coloured mesh that is
// tinted at night: the terrace fence with its gates, lanes, meadows with wildflowers, patchwork fields with crop rows,
// hedgerows, the river banks and bridges, the railway and its tunnel portals, farms and cottages, windmill towers,
// woods, animals and the hills.
// The river and the pond use the water material; sparse warm windows and lanterns share one additive mesh. Moving
// parts: a train that passes now and then, windmill sails and tractors (by day). Nothing here casts shadows, is a
// person or carries a sign: people stand for sessions and signs for projects. Moving parts follow an animation clock
// that only advances with dt, so a frozen scene (dt = 0) always shows the same frame and never needs redrawing.
import * as THREE from 'three'
import { fnv1a32 } from '../../util/hash'
import { createRng } from '../../util/prng'
import type { TownLayout } from '../layout'
import { PAL } from '../palette'
import { GROUND_REACH, PLATE_H, makeWaterMaterial, type TownEdge } from '../street'
import { makeVoxelMaterial } from '../voxel'
import { WalkerMeshes } from './walkers'
import {
  BANK, COUNTRY_Y, FIELD_H, FROZEN_T, LEVEL_H, RAMP, TERRACE_Y, TRAIN, animalPose, hillTierRadius, planOutskirts, riverX, tractorPose,
  trainPose, type Animal, type AnimalKind, type Bridge, type Cottage, type Facing, type Farm, type Field, type Hill, type OutskirtsPlan, type Rect, type TrainPose, type Tree, type Windmill,
} from './pastoralPlan'

const GROUND = COUNTRY_Y
const LANE_Y = GROUND + 0.03
const BANK_Y = GROUND + 0.016
const WATER_Y = GROUND + 0.034
const BALLAST_TOP = GROUND + 0.3
const TREE_SWAY = 0.03
const ROW_SWAY = 0.22
// The countryside sinks a little deeper into the night than the town's own verge, and loses most of its colour (as
// under moonlight), so the lit town stays the focus.
const NIGHT_TINT = new THREE.Color(0.23, 0.28, 0.44)
const NIGHT_GREY = 0.4
const WHITE = new THREE.Color(1, 1, 1)
// Far things fade toward this haze (aerial perspective); the night tint darkens it with everything else.
const HAZE = new THREE.Color(0xc4cfd6)
// The sun (and moon) shine from -X, +Z (sky.ts), so baked contact shadows fall toward +X, -Z.
const SHADOW_DIR = { x: 0.63, z: -0.77 }

const col = (hex: number): THREE.Color => new THREE.Color(hex)
const smooth = (lo: number, hi: number, v: number): number => THREE.MathUtils.smoothstep(v, lo, hi)
type C = THREE.Color

/** Writes axis-aligned boxes (no bottom face: nothing is seen from below) and quads into one vertex-coloured geometry. */
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
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: C, top: C | null = c, foot = 1, sway = 0, swayBase = y): void {
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

  /** Long low strip (hedge, crop row, rail) along X or Z: top and the two long sides only (its ends are too small to see). */
  strip(x0: number, z0: number, x1: number, z1: number, y: number, h: number, c: C, top: C, sway = 0): void {
    const y1 = y + h
    const s = sway * h
    this.quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], 0, 1, 0, top, top, s, s)
    if (x1 - x0 >= z1 - z0) {
      this.quad([x0, y, z1, x1, y, z1, x1, y1, z1, x0, y1, z1], 0, 0, 1, c, c, 0, s)
      this.quad([x1, y, z0, x0, y, z0, x0, y1, z0, x1, y1, z0], 0, 0, -1, c, c, 0, s)
    } else {
      this.quad([x1, y, z1, x1, y, z0, x1, y1, z0, x1, y1, z1], 1, 0, 0, c, c, 0, s)
      this.quad([x0, y, z0, x0, y, z1, x0, y1, z1, x0, y1, z0], -1, 0, 0, c, c, 0, s)
    }
  }

  /** Horizontal rectangle facing up. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, c: C): void {
    this.quad([x0, y, z1, x1, y, z1, x1, y, z0, x0, y, z0], 0, 1, 0, c, c, 0, 0)
  }

  /** Vertical rectangle centred at (x, y, z) on a wall facing `f`, `w` wide along the wall. */
  wall(x: number, y: number, z: number, w: number, h: number, f: Facing, c: C): void {
    const a = w / 2
    const y0 = y - h / 2
    const y1 = y + h / 2
    if (f === 'z+') this.quad([x - a, y0, z, x + a, y0, z, x + a, y1, z, x - a, y1, z], 0, 0, 1, c, c, 0, 0)
    else if (f === 'z-') this.quad([x + a, y0, z, x - a, y0, z, x - a, y1, z, x + a, y1, z], 0, 0, -1, c, c, 0, 0)
    else if (f === 'x+') this.quad([x, y0, z + a, x, y0, z - a, x, y1, z - a, x, y1, z + a], 1, 0, 0, c, c, 0, 0)
    else this.quad([x, y0, z - a, x, y0, z + a, x, y1, z + a, x, y1, z - a], -1, 0, 0, c, c, 0, 0)
  }

  /**
   * Slope rising along X from (xa, ya) to (xb, yb) over z0..z1 (or along Z when `alongZ`, with x0..x1 across), with its
   * two side faces down to the ground.
   */
  slope(xa: number, ya0: number, xb: number, yb0: number, c0: number, c1: number, top: C, side: C, alongZ = false): void {
    // Always build from the lower coordinate a to the higher bb along the slope.
    const [a, ya, bb, yb] = xa <= xb ? [xa, ya0, xb, yb0] : [xb, yb0, xa, ya0]
    const m = (yb - ya) / (bb - a)
    const n = 1 / Math.hypot(m, 1)
    if (!alongZ) {
      this.quad([a, ya, c1, bb, yb, c1, bb, yb, c0, a, ya, c0], -m * n, n, 0, top, top, 0, 0)
      this.quad([a, GROUND, c1, bb, GROUND, c1, bb, yb, c1, a, ya, c1], 0, 0, 1, side, side, 0, 0)
      this.quad([bb, GROUND, c0, a, GROUND, c0, a, ya, c0, bb, yb, c0], 0, 0, -1, side, side, 0, 0)
    } else {
      this.quad([c0, yb, bb, c1, yb, bb, c1, ya, a, c0, ya, a], 0, n, -m * n, top, top, 0, 0)
      this.quad([c1, GROUND, bb, c1, GROUND, a, c1, ya, a, c1, yb, bb], 1, 0, 0, side, side, 0, 0)
      this.quad([c0, GROUND, a, c0, GROUND, bb, c0, yb, bb, c0, ya, a], -1, 0, 0, side, side, 0, 0)
    }
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
  private quad(p: number[], nx: number, ny: number, nz: number, lo: C, hi: C, swLo: number, swHi: number, foot = 1): void {
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

/** Palette colours, scaled by `k` and faded toward the haze with distance; cached (a few hundred per plan). */
class Tones {
  private readonly cache = new Map<string, C>()

  get(hex: number, haze: number, k = 1): C {
    const key = `${hex}|${haze.toFixed(2)}|${k}`
    let c = this.cache.get(key)
    if (!c) {
      c = col(hex).multiplyScalar(k).lerp(HAZE, haze)
      this.cache.set(key, c)
    }
    return c
  }
}

type Paint = (hex: number, k?: number) => C

// Local frame per facing: outward direction (f) and the direction to its right (r) in the XZ plane.
const FRAME: Record<Facing, { fx: number; fz: number; rx: number; rz: number; right: Facing; left: Facing }> = {
  'z+': { fx: 0, fz: 1, rx: 1, rz: 0, right: 'x+', left: 'x-' },
  'z-': { fx: 0, fz: -1, rx: -1, rz: 0, right: 'x-', left: 'x+' },
  'x+': { fx: 1, fz: 0, rx: 0, rz: -1, right: 'z-', left: 'z+' },
  'x-': { fx: -1, fz: 0, rx: 0, rz: 1, right: 'z+', left: 'z-' },
}

/** The voxel material with its vertex colours pulled toward grey by `grey.value` (0 = full colour). */
function countryMaterial(grey: { value: number }): THREE.MeshStandardMaterial {
  const m = makeVoxelMaterial(0.9)
  const voxel = m.onBeforeCompile
  m.onBeforeCompile = (shader, renderer) => {
    voxel.call(m, shader, renderer)
    shader.uniforms.uGrey = grey
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGrey;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb = diffuse * mix(vColor.rgb, vec3(dot(vColor.rgb, vec3(0.299, 0.587, 0.114))), uGrey);',
      )
  }
  return m
}

export class Outskirts {
  private readonly root = new THREE.Group()
  private readonly grey = { value: 0 }
  private readonly mat = countryMaterial(this.grey)
  private readonly waterMat = makeWaterMaterial()
  private readonly waterBase = new THREE.Color(PAL.water[1])
  private readonly glowMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })
  private readonly tint = new THREE.Color()
  private content: THREE.Group | null = null
  private glow: THREE.Mesh | null = null
  private train: THREE.Group | null = null
  private trainGlow: THREE.Mesh | null = null
  private sails: THREE.InstancedMesh | null = null
  private tractors: THREE.InstancedMesh | null = null
  private herds: Array<{ mesh: THREE.InstancedMesh; animals: Animal[] }> = []
  private walkers: WalkerMeshes | null = null
  private plan: OutskirtsPlan | null = null
  private t = FROZEN_T
  private level = 1
  // Scratch objects, reused every frame.
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly q2 = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly one = new THREE.Vector3(1, 1, 1)
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly fwd = new THREE.Vector3(0, 0, 1)
  private readonly pose = { x: 0, z: 0, yaw: 0 }
  private readonly graze = { x: 0, z: 0, yaw: 0, lift: 0 }
  private readonly trainAt: TrainPose = { head: 0, dir: 1, visible: false }
  private tractorY: number[] = []

  constructor(private readonly parent: THREE.Object3D) {
    parent.add(this.root)
  }

  /** Plans and builds the countryside around `layout`; the street draws the gate roads across the terrace. */
  build(layout: TownLayout, opts: { seed: number; lite: boolean }): TownEdge & { glows: Array<{ x: number; z: number }> } {
    const plan = planOutskirts(layout, opts)
    this.clear()
    this.plan = plan
    const content = new THREE.Group()
    const solid = new Batch()
    const glow = new Batch()
    const water = new Batch()
    const tones = new Tones()
    const { reach } = plan
    const hazeAt = (x: number, z: number): number => Math.round((0.03 + 0.2 * smooth(0.4, 1.2, Math.hypot(x, z) / reach)) * 20) / 20
    const at = (x: number, z: number): Paint => {
      const haze = hazeAt(x, z)
      return (hex, k = 1) => tones.get(hex, haze, k)
    }

    // The diorama's base plate (its top is the countryside ground) and the town's terrace with stone sides.
    const { plate, terrace } = plan
    const base = at(0, 0)
    const px = (plate.x0 + plate.x1) / 2
    const pz = (plate.z0 + plate.z1) / 2
    const pw = plate.x1 - plate.x0
    const pd = plate.z1 - plate.z0
    solid.box(px, GROUND - 0.4, pz, pw, 0.4, pd, base(PAL.grass[0], 1.08))
    solid.box(px, GROUND - 1.9, pz, pw, 1.5, pd, base(PAL.soil[1]), null)
    solid.box(px, -PLATE_H, pz, pw, PLATE_H + GROUND - 1.9, pd, base(PAL.rim), null)
    solid.flat(-GROUND_REACH, -GROUND_REACH, GROUND_REACH, GROUND_REACH, GROUND - 0.01, base(PAL.grass[0], 1.08))
    const tx = (terrace.x0 + terrace.x1) / 2
    const tz = (terrace.z0 + terrace.z1) / 2
    const tw = terrace.x1 - terrace.x0
    const td = terrace.z1 - terrace.z0
    solid.box(tx, GROUND, tz, tw, TERRACE_Y - 0.02 - GROUND, td, base(PAL.bgStone[1]), null, 0.8)
    solid.box(tx, TERRACE_Y - 0.02, tz, tw, 0.02, td, base(PAL.lawn[1]))
    terraceEdge(solid, glow, plan, base)
    for (const h of plan.hills) hill(solid, h, plan.plate, at(h.x, h.z))
    for (const f of plan.fields) field(solid, f, plan, at((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2))
    for (const p of plan.ponds) pond(solid, water, p, GROUND + FIELD_H.pond, at(p.x, p.z))
    for (const h of plan.hedges) {
      const c = at((h.x0 + h.x1) / 2, (h.z0 + h.z1) / 2)
      solid.strip(h.x0, h.z0, h.x1, h.z1, GROUND, 0.85, c(PAL.hedge[1]), c(PAL.hedge[2]))
    }
    river(solid, water, plan, at)
    for (const br of plan.bridges) bridge(solid, br, plan, at((br.x0 + br.x1) / 2, (br.z0 + br.z1) / 2))
    railway(solid, plan, at)
    lanes(solid, plan, at)
    for (const f of plan.farms) farm(solid, glow, f, plan, at((f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2))
    for (const ck of plan.cottages) cottage(solid, glow, ck, plan, at((ck.x0 + ck.x1) / 2, (ck.z0 + ck.z1) / 2))
    for (const w of plan.windmills) windmill(solid, glow, w, at(w.x, w.z))
    for (const t of plan.trees) tree(solid, t, at(t.x, t.z))
    for (const bl of plan.bales) {
      const c = at(bl.x, bl.z)
      const s = bl.s
      solid.box(bl.x, bl.y, bl.z, 1.3 * s, 0.6 * s, 1.3 * s, c(PAL.bgHay[0]), c(PAL.bgHay[1]), 0.85)
      solid.box(bl.x, bl.y + 0.6 * s, bl.z, 0.95 * s, 0.4 * s, 0.95 * s, c(PAL.bgHay[1]), c(PAL.bgHay[2]))
      solid.box(bl.x, bl.y + 1.0 * s, bl.z, 0.5 * s, 0.22 * s, 0.5 * s, c(PAL.bgHay[2]), c(PAL.bgHay[2]))
    }

    const mesh = new THREE.Mesh(solid.build(), this.mat)
    mesh.receiveShadow = true
    content.add(mesh)
    if (!water.empty) {
      const w = new THREE.Mesh(water.build(), this.waterMat)
      w.receiveShadow = true
      content.add(w)
    }
    if (!glow.empty) {
      this.glow = new THREE.Mesh(glow.build(), this.glowMat)
      this.glow.renderOrder = 2
      content.add(this.glow)
    }

    // Train: one rigid mesh (the track is straight), its lit windows and lamp as a child.
    const tr = trainGeometry(plan.train.scale)
    this.train = new THREE.Group()
    this.train.add(new THREE.Mesh(tr.body, this.mat))
    this.trainGlow = new THREE.Mesh(tr.glow, this.glowMat)
    this.trainGlow.renderOrder = 2
    this.train.add(this.trainGlow)
    this.train.position.set(0, BALLAST_TOP + 0.12, plan.train.z)
    content.add(this.train)

    if (plan.windmills.length > 0) {
      this.sails = new THREE.InstancedMesh(sailGeometry(), this.mat, plan.windmills.length)
      this.sails.frustumCulled = false
      content.add(this.sails)
    }
    if (plan.tractors.length > 0) {
      this.tractors = new THREE.InstancedMesh(tractorGeometry(plan.scale), this.mat, plan.tractors.length)
      this.tractors.frustumCulled = false
      const c = new THREE.Color()
      plan.tractors.forEach((tc, i) => this.tractors!.setColorAt(i, c.set(PAL.bgTractor[tc.color % PAL.bgTractor.length])))
      // Each tractor works one field: it drives on that field's top.
      this.tractorY = plan.tractors.map((tc) => {
        const { x0, z0 } = tc.route.rect
        const f = plan.fields.find((fl) => fl.x0 <= x0 && x0 <= fl.x1 && fl.z0 <= z0 && z0 <= fl.z1)
        return GROUND + (f ? FIELD_H[f.crop] : 0.1)
      })
      content.add(this.tractors)
    }
    // Grazing animals: one instanced mesh per kind; each coat is tinted and faded with distance like the land.
    for (const kind of ['sheep', 'cow', 'pig'] as const) {
      const animals = plan.animals.filter((a) => a.kind === kind)
      if (animals.length === 0) continue
      const mesh = new THREE.InstancedMesh(animalGeometry(kind, plan.scale), this.mat, animals.length)
      mesh.frustumCulled = false
      animals.forEach((a, i) => mesh.setColorAt(i, at(a.x, a.z)(COAT[kind][a.tone])))
      content.add(mesh)
      this.herds.push({ mesh, animals })
    }
    if (plan.walkers.length > 0) {
      this.walkers = new WalkerMeshes(plan.walkers, this.mat)
      content.add(this.walkers.group)
    }
    this.content = content
    this.root.add(content)
    this.poseMoving()
    this.setLightLevel(this.level)
    return { exits: plan.exits, glows: plan.glows }
  }

  setLightLevel(level: number): void {
    this.level = level
    const day = smooth(0, 0.6, level)
    this.tint.copy(NIGHT_TINT).lerp(WHITE, day)
    this.mat.color.copy(this.tint)
    this.grey.value = NIGHT_GREY * (1 - day)
    // Water darkens more than the land at night so it never glows.
    this.waterMat.color.copy(this.waterBase).multiply(this.tint).multiplyScalar(THREE.MathUtils.lerp(0.45, 1, day))
    // Windows, lanterns and the train's lamps come on through dusk and stay well below the bloom threshold.
    const a = 1 - smooth(0.18, 0.5, level)
    this.glowMat.color.setScalar(a)
    if (this.glow) this.glow.visible = a > 0.01
    if (this.trainGlow) this.trainGlow.visible = a > 0.01
    // Tractors work by day; people are out by day and through dusk.
    if (this.tractors) this.tractors.visible = level > 0.35
    if (this.walkers) this.walkers.group.visible = level > 0.3
  }

  update(dtMs: number): void {
    if (dtMs <= 0) return
    this.t += dtMs / 1000
    this.poseMoving()
  }

  dispose(): void {
    this.clear()
    this.parent.remove(this.root)
    for (const m of [this.mat, this.waterMat, this.glowMat]) m.dispose()
  }

  /** Every frame while the clock runs: no allocations. */
  private poseMoving(): void {
    const plan = this.plan
    if (!plan) return
    const t = this.t
    if (this.train) {
      const pose = trainPose(plan.train, t, this.trainAt)
      this.train.visible = pose.visible
      this.train.position.x = pose.head
      this.train.rotation.y = pose.dir > 0 ? 0 : Math.PI
    }
    const sails = this.sails
    if (sails) {
      for (let i = 0; i < plan.windmills.length; i++) {
        const w = plan.windmills[i]
        this.q.setFromAxisAngle(this.fwd, w.phase + w.speed * t)
        this.m.compose(this.p.set(w.x, millHubY(w), w.z + millHubZ(w)), this.q, this.one)
        sails.setMatrixAt(i, this.m)
      }
      sails.instanceMatrix.needsUpdate = true
    }
    const tractors = this.tractors
    if (tractors) {
      for (let i = 0; i < plan.tractors.length; i++) {
        const pose = tractorPose(plan.tractors[i], t, this.pose)
        this.m.compose(this.p.set(pose.x, this.tractorY[i], pose.z), this.q2.setFromAxisAngle(this.up, pose.yaw), this.one)
        tractors.setMatrixAt(i, this.m)
      }
      tractors.instanceMatrix.needsUpdate = true
    }
    for (const { mesh, animals } of this.herds) {
      for (let i = 0; i < animals.length; i++) {
        const a = animals[i]
        const pose = animalPose(a, t, this.graze)
        this.m.compose(this.p.set(pose.x, a.y + pose.lift, pose.z), this.q2.setFromAxisAngle(this.up, pose.yaw), this.one)
        mesh.setMatrixAt(i, this.m)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
    this.walkers?.update(t)
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
    this.train = null
    this.trainGlow = null
    this.sails = null
    this.tractors = null
    this.herds = []
    this.walkers = null
  }
}

// Terrace fence sizes (m): chunky enough to read from the default view, where the near edges are out of focus.
const FENCE = {
  inset: 0.2, // fence line inside the terrace edge
  bay: 2.4, // post spacing
  post: 0.32,
  postH: 1.32,
  picket: 0.26,
  picketD: 0.1,
  picketH: 1.14,
  pitch: 0.4, // picket spacing
  rail: 0.14,
  railD: 0.08,
}

/**
 * Whitewashed picket fence along the terrace edge (the terrace's stone sides are its plinth), with pillared gates (a
 * lantern on each). Lite keeps the posts and rails and drops the pickets.
 */
function terraceEdge(b: Batch, glow: Batch, plan: OutskirtsPlan, c: Paint): void {
  const t = plan.terrace
  const stone = c(PAL.bgStone[1])
  const cap = c(PAL.bgStone[2])
  const open = 3.4 // half opening at a gate (the town road and its sidewalks)
  // Per side: its edge, which way is off the terrace, where its fence runs from and to (corner posts) and its gates.
  const inset = FENCE.inset
  const runs: Array<{ alongX: boolean; edge: number; out: number; from: number; to: number; gaps: number[] }> = [
    { alongX: true, edge: t.z0, out: -1, from: t.x0 + inset, to: t.x1 - inset, gaps: [] },
    { alongX: true, edge: t.z1, out: 1, from: t.x0 + inset, to: t.x1 - inset, gaps: plan.gates.filter((g) => g.axis === 'z').map((g) => g.x) },
    { alongX: false, edge: t.x0, out: -1, from: t.z0 + inset, to: t.z1 - inset, gaps: plan.gates.filter((g) => g.axis === 'x' && g.x <= t.x0 + 1e-6).map((g) => g.z) },
    { alongX: false, edge: t.x1, out: 1, from: t.z0 + inset, to: t.z1 - inset, gaps: plan.gates.filter((g) => g.axis === 'x' && g.x >= t.x1 - 1e-6).map((g) => g.z) },
  ]
  const paint = { side: c(PAL.bgTrim), top: c(PAL.bgTrim, 1.06) }
  const lantern = col(PAL.bgGlow).multiplyScalar(0.6)
  for (const r of runs) {
    const line = { alongX: r.alongX, at: r.edge - r.out * inset, out: r.out }
    const cuts = [...r.gaps].sort((a, d) => a - d)
    // Pieces from a corner post or gate pillar to the next; the gates stay open.
    let from = r.from
    for (const g of cuts) {
      terraceFence(b, line, from, g - open - 0.35, from !== r.from, true, paint, plan.lite)
      from = g + open + 0.35
    }
    terraceFence(b, line, from, r.to, from !== r.from, false, paint, plan.lite)
    // Gate pillars with a small lantern on top.
    const at = r.edge - r.out * 0.35
    for (const g of cuts) {
      for (const sg of [-1, 1]) {
        const u = g + sg * (open + 0.35)
        const x = r.alongX ? u : at
        const z = r.alongX ? at : u
        b.box(x, TERRACE_Y, z, 0.8, 1.3, 0.8, stone, cap, 0.85)
        b.box(x, TERRACE_Y + 1.3, z, 0.95, 0.14, 0.95, cap)
        b.box(x, TERRACE_Y + 1.44, z, 0.32, 0.34, 0.32, c(0xeadcb0), null)
        b.box(x, TERRACE_Y + 1.78, z, 0.42, 0.08, 0.42, c(PAL.frame))
        for (const f of ['x+', 'x-', 'z+', 'z-'] as const) {
          const o = 0.18
          glow.wall(x + (f === 'x+' ? o : f === 'x-' ? -o : 0), TERRACE_Y + 1.62, z + (f === 'z+' ? o : f === 'z-' ? -o : 0), 0.22, 0.24, f, lantern)
        }
      }
    }
  }
}

/**
 * One straight piece of the terrace fence from `a` to `d` along its line (`out` points off the terrace): posts at the
 * ends and every bay, two rails on the inner side and pickets between. A gate pillar (0.8 wide) stands in for an end post.
 */
function terraceFence(
  b: Batch, line: { alongX: boolean; at: number; out: number }, a: number, d: number, pillarA: boolean, pillarD: boolean,
  p: { side: C; top: C }, lite: boolean,
): void {
  const F = FENCE
  const box = (u: number, y: number, w: number, h: number, depth: number, side: C): void => {
    if (line.alongX) b.box(u, y, line.at, w, h, depth, side, p.top, 0.85)
    else b.box(line.at, y, u, depth, h, w, side, p.top, 0.85)
  }
  const n = Math.max(1, Math.round((d - a) / F.bay))
  const posts = Array.from({ length: n + 1 }, (_, k) => a + ((d - a) * k) / n)
  const pillar = (k: number): boolean => (k === 0 && pillarA) || (k === n && pillarD)
  const half = (k: number): number => (pillar(k) ? 0.4 : F.post / 2)
  const m = line.at - (line.out * (F.picketD + F.railD)) / 2
  for (const y of [0.3, 0.85]) {
    if (line.alongX) b.strip(a, m - F.railD / 2, d, m + F.railD / 2, TERRACE_Y + y, F.rail, p.side, p.top)
    else b.strip(m - F.railD / 2, a, m + F.railD / 2, d, TERRACE_Y + y, F.rail, p.side, p.top)
  }
  posts.forEach((u, k) => {
    if (pillar(k)) return
    box(u, TERRACE_Y, F.post, F.postH, F.post, p.side)
    box(u, TERRACE_Y + F.postH, F.post + 0.08, 0.08, F.post + 0.08, p.top)
  })
  if (lite) return
  // Pickets spread over each bay with equal gaps, the ones at its ends included.
  for (let k = 0; k < n; k++) {
    const u0 = posts[k] + half(k)
    const len = posts[k + 1] - half(k + 1) - u0
    const count = Math.max(1, Math.round((len - F.pitch + F.picket) / F.pitch))
    const gap = (len - count * F.picket) / (count + 1)
    for (let j = 0; j < count; j++) box(u0 + gap * (j + 1) + F.picket * (j + 0.5), TERRACE_Y, F.picket, F.picketH, F.picketD, p.side)
  }
}

/** Contour hill: plus-shaped tiers, each sitting on the one below, clipped to the plate with a soil cut face. */
function hill(b: Batch, h: Hill, plate: Rect, c: Paint): void {
  const k = h.kind === 'wood' ? 0.86 : h.kind === 'pasture' ? 1.02 : 0.95
  for (let i = 0; i < h.levels; i++) {
    const r = hillTierRadius(h, i)
    const arm = 0.62 * r
    const tone = PAL.bgHill[Math.min(i, PAL.bgHill.length - 1)]
    const top = c(tone, k)
    const side = c(tone, 0.72 * k)
    const y = GROUND + i * LEVEL_H
    for (const [hw, hd] of [[r, arm], [arm, r]]) {
      const x0 = Math.max(plate.x0, h.x - hw)
      const x1 = Math.min(plate.x1, h.x + hw)
      const z0 = Math.max(plate.z0, h.z - hd)
      const z1 = Math.min(plate.z1, h.z + hd)
      if (x1 - x0 < 0.5 || z1 - z0 < 0.5) continue
      b.box((x0 + x1) / 2, y, (z0 + z1) / 2, x1 - x0, LEVEL_H, z1 - z0, side, top, 0.88)
      cutFaces(b, x0, x1, z0, z1, y, LEVEL_H, plate, c)
    }
  }
}

/** Soil-coloured faces just outside the plate where a hill or tunnel is cut off by its edge. */
function cutFaces(b: Batch, x0: number, x1: number, z0: number, z1: number, y: number, h: number, plate: Rect, c: Paint): void {
  const soil = c(PAL.soil[1], 0.9)
  const ym = y + h / 2
  if (x1 >= plate.x1 - 1e-6) b.wall(plate.x1 + 0.02, ym, (z0 + z1) / 2, z1 - z0, h, 'x+', soil)
  if (x0 <= plate.x0 + 1e-6) b.wall(plate.x0 - 0.02, ym, (z0 + z1) / 2, z1 - z0, h, 'x-', soil)
  if (z1 >= plate.z1 - 1e-6) b.wall((x0 + x1) / 2, ym, plate.z1 + 0.02, x1 - x0, h, 'z+', soil)
  if (z0 <= plate.z0 + 1e-6) b.wall((x0 + x1) / 2, ym, plate.z0 - 0.02, x1 - x0, h, 'z-', soil)
}

/** Base tone of a field's top, varied a little per field. */
function fieldTop(f: Field): number {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(f.v * list.length) % list.length]
  switch (f.crop) {
    case 'wheat': return pick([PAL.bgWheat[1], PAL.bgWheat[0]])
    case 'barley': return PAL.bgBarley[1]
    case 'rapeseed': return PAL.bgRapeseed[1]
    case 'lavender': case 'tulips': return pick(PAL.bgSage)
    case 'sunflower': return PAL.bgVeg[0]
    case 'vegetables': case 'ploughed': return pick([PAL.bgSoil[1], PAL.bgSoil[2]])
    case 'hay': return PAL.bgHay[1]
    case 'pasture': return pick(PAL.bgPasture)
    case 'orchard': case 'pond': case 'meadow': case 'wildflowers': return pick(PAL.bgMeadow)
    case 'wood': return PAL.bgWoodFloor
  }
}

/** A field: a low slab in its crop's colour with rows on top (close up), a fence round pastures. */
function field(b: Batch, f: Field, plan: OutskirtsPlan, c: Paint): void {
  const h = FIELD_H[f.crop]
  const y = GROUND + h
  const top = c(fieldTop(f))
  if (f.crop === 'wood' || f.crop === 'meadow' || f.lod === 2) {
    b.flat(f.x0, f.z0, f.x1, f.z1, Math.max(y, GROUND + 0.012), top)
    return
  }
  {
    b.box((f.x0 + f.x1) / 2, GROUND, (f.z0 + f.z1) / 2, f.x1 - f.x0, h, f.z1 - f.z0, c(fieldTop(f), 0.78), top, 0.8)
  }
  const near = f.lod === 0
  // Rows across the field, at world-aligned positions so the strips of a field cut by the river line up.
  const rows = (spacing: number, width: number, height: number, paint: (i: number) => [C, C], sway = 0): void => {
    const a0 = (f.alongX ? f.z0 : f.x0) + 0.45
    const a1 = (f.alongX ? f.z1 : f.x1) - 0.45
    const u0 = (f.alongX ? f.x0 : f.z0) + 0.45
    const u1 = (f.alongX ? f.x1 : f.z1) - 0.45
    if (u1 - u0 < 1) return
    for (let m = Math.ceil((a0 + width / 2) / spacing) * spacing; m + width / 2 <= a1; m += spacing) {
      const [side, crown] = paint(Math.round(m / spacing))
      if (f.alongX) b.strip(u0, m - width / 2, u1, m + width / 2, y, height, side, crown, sway)
      else b.strip(m - width / 2, u0, m + width / 2, u1, y, height, side, crown, sway)
    }
  }
  const ramp = (r: readonly number[]): [C, C] => [c(r[0]), c(r[2])]
  switch (f.crop) {
    case 'wheat': rows(near ? 1.25 : 2.5, 0.7, 0.16, () => ramp(PAL.bgWheat), ROW_SWAY); break
    case 'barley': rows(near ? 1.2 : 2.4, 0.65, 0.14, () => ramp(PAL.bgBarley), ROW_SWAY); break
    case 'rapeseed': rows(near ? 1.3 : 2.6, 0.8, 0.2, () => [c(PAL.bgVeg[0]), c(PAL.bgRapeseed[2])], ROW_SWAY); break
    case 'lavender': rows(1.5, 0.85, 0.36, () => [c(PAL.bgLavender[0]), c(PAL.bgLavender[near ? 2 : 1])]); break
    case 'tulips': rows(1.15, 0.75, 0.2, (i) => { const k = c(PAL.bgTulips[((Math.floor(i / 2) % 4) + 4) % 4]); return [k, k] }); break
    case 'sunflower': rows(1.3, 0.6, 0.55, () => [c(PAL.bgSunflower[0]), c(PAL.bgSunflower[1])], ROW_SWAY); break
    case 'vegetables': rows(1.05, 0.55, 0.22, (i) => { const k = c(PAL.bgVeg[((i % 4) + 4) % 4]); return [c(PAL.bgVeg[((i % 4) + 4) % 4], 0.8), k] }); break
    case 'ploughed': rows(1.1, 0.5, 0.07, () => [c(PAL.bgSoil[0]), c(PAL.bgSoil[2])]); break
    case 'hay': rows(3.2, 1.5, 0.035, () => [c(PAL.bgHay[0]), c(PAL.bgHay[2])]); break
    case 'pasture': if (near && !plan.lite && (f.v * 7) % 1 < 0.55) fence(b, f, y, c); break // some are open grazing
    case 'wildflowers': if (near) wildflowers(b, f, y, c); break
    default: break
  }
}

/** Post-and-rail fence just inside a pasture's edge. */
function fence(b: Batch, f: Field, y: number, c: Paint): void {
  const wood = c(PAL.wood[1])
  const light = c(PAL.wood[2])
  const x0 = f.x0 + 0.35
  const x1 = f.x1 - 0.35
  const z0 = f.z0 + 0.35
  const z1 = f.z1 - 0.35
  for (const [a, d, along, at] of [[x0, x1, true, z0], [x0, x1, true, z1], [z0, z1, false, x0], [z0, z1, false, x1]] as const) {
    for (const ry of [0.35, 0.62]) {
      if (along) b.strip(a, at - 0.04, d, at + 0.04, y + ry, 0.07, wood, light)
      else b.strip(at - 0.04, a, at + 0.04, d, y + ry, 0.07, wood, light)
    }
    const n = Math.max(1, Math.round((d - a) / 2.4))
    for (let i = 0; i <= n; i++) {
      const u = a + ((d - a) * i) / n
      b.box(along ? u : at, y, along ? at : u, 0.13, 0.78, 0.13, wood, light)
    }
  }
}

// Wildflower drifts: a main colour and a few blooms of a second (indices into PAL.bgWildflower).
const FLOWER_PAIRS = [[1, 0], [4, 0], [2, 0], [0, 1], [3, 1], [2, 4]] as const

/**
 * Wildflowers in a meadow: a few drifts, each a rough round patch of low blooms on a voxel grid in two soft colours;
 * most are flat specks (they read as colour from afar), some stand a little taller.
 */
function wildflowers(b: Batch, f: Field, y: number, c: Paint): void {
  const r = createRng(fnv1a32(`flowers:${f.x0.toFixed(1)},${f.z0.toFixed(1)}`))
  const w = f.x1 - f.x0
  const d = f.z1 - f.z0
  if (w < 5 || d < 5) return
  const G = 0.45 // grid step
  for (let i = Math.min(9, Math.max(1, Math.round((w * d) / 45))); i > 0; i--) {
    const rad = Math.min(1.6 + 1.4 * r(), w / 2 - 1, d / 2 - 1)
    const cx = f.x0 + 1 + rad + r() * Math.max(0, w - 2 - 2 * rad)
    const cz = f.z0 + 1 + rad + r() * Math.max(0, d - 2 - 2 * rad)
    const tones = FLOWER_PAIRS[Math.floor(r() * FLOWER_PAIRS.length)].map((k) => c(PAL.bgWildflower[k]))
    for (let gx = -rad; gx <= rad; gx += G) {
      for (let gz = -rad; gz <= rad; gz += G) {
        if (Math.hypot(gx, gz) > rad * (0.7 + 0.3 * r()) || r() < 0.2) continue
        const k = tones[r() < 0.85 ? 0 : 1]
        const x = Math.round((cx + gx) / G) * G + (r() - 0.5) * 0.12
        const z = Math.round((cz + gz) / G) * G + (r() - 0.5) * 0.12
        const h = 0.11 + 0.07 * r() // half size
        if (r() < 0.15) b.box(x, y, z, 0.26, 0.16 + 0.12 * r(), 0.26, k, k, 1, 0.12, y)
        else b.flat(x - h, z - h, x + h, z + h, y + 0.025, k)
      }
    }
  }
}

/**
 * Cottage in the corner of a grass field by a lane: a small whitewashed house with a stepped roof and a chimney, its
 * kitchen garden beside it, a hedge round the back; a lit window at night.
 */
function cottage(b: Batch, glow: Batch, ck: Cottage, plan: OutskirtsPlan, c: Paint): void {
  const s = plan.scale
  const y = GROUND + FIELD_H.meadow
  const along = ck.facing[0] === 'z'
  const W = along ? ck.x1 - ck.x0 : ck.z1 - ck.z0
  const D = along ? ck.z1 - ck.z0 : ck.x1 - ck.x0
  const ox = ck.facing === 'x+' ? ck.x1 : ck.facing === 'x-' ? ck.x0 : (ck.x0 + ck.x1) / 2
  const oz = ck.facing === 'z+' ? ck.z1 : ck.facing === 'z-' ? ck.z0 : (ck.z0 + ck.z1) / 2
  const L = frame(ox, oz, ck.facing, b)
  b.flat(ck.x0, ck.z0, ck.x1, ck.z1, y + 0.012, c(PAL.lawn[1]))
  // House on the left, its door toward the lane down a dirt path.
  const hu = -0.22 * W
  const hv = 0.5 * D
  const hw = Math.min(4.6 * s, 0.42 * W)
  const hd = Math.min(3.6 * s, 0.4 * D)
  const hh = 2.6 * s
  const p0 = L.pt(hu - 0.25 * hw - 0.45 * s, -1.4)
  const p1 = L.pt(hu - 0.25 * hw + 0.45 * s, hv - hd / 2)
  b.flat(Math.min(p0.x, p1.x), Math.min(p0.z, p1.z), Math.max(p0.x, p1.x), Math.max(p0.z, p1.z), y + 0.02, c(PAL.bgDirt[2]))
  L.box(hu, hv, y, hw, hh, hd, c(PAL.bgFarmWall[Math.floor(ck.v * 3) % 3]), null, 0.82)
  roof(L, hu, hv, y + hh, hw, hd, PAL.bgRoof[Math.floor(ck.v * 5) % PAL.bgRoof.length], c, s)
  L.box(hu + 0.32 * hw, hv + 0.2 * hd, y + hh, 0.45 * s, 1.3 * s, 0.45 * s, c(PAL.bgChimney), c(PAL.bgChimney, 0.8))
  // Kitchen garden on the right: a soil bed with rows of greens.
  const gu = 0.26 * W
  const gw = 0.34 * W
  const gd = 0.6 * D
  L.box(gu, hv, y, gw, 0.06, gd, c(PAL.bgSoil[0]), c(PAL.bgSoil[1]))
  if (plan.lite) return
  L.face(b, hu, hv, hw / 2, hd / 2, 'front', -0.25 * hw, y + 0.65 * s, 0.7 * s, 1.3 * s, c(PAL.bgDoor))
  for (const [side, u] of [['front', 0.2 * hw], ['right', 0]] as const) L.face(b, hu, hv, hw / 2, hd / 2, side, u, y + 1.5 * s, 0.7 * s, 0.75 * s, c(PAL.bgGlass))
  L.face(glow, hu, hv, hw / 2 + 0.03, hd / 2 + 0.03, 'front', 0.2 * hw, y + 1.5 * s, 0.62 * s, 0.67 * s, col(PAL.bgGlow).multiplyScalar(0.75))
  for (let i = 0, n = Math.max(2, Math.floor(gw / (0.7 * s))); i < n; i++) {
    const tone = PAL.bgVeg[i % PAL.bgVeg.length]
    L.box(gu - gw / 2 + (i + 0.5) * (gw / n), hv, y + 0.06, 0.32 * s, 0.2, gd - 0.6 * s, c(tone, 0.8), c(tone))
  }
  // A low hedge round the back and sides; the front stays open to the lane.
  for (const [u0, v0, u1, v1] of [[-W / 2, D - 0.5, W / 2, D], [-W / 2, 0.6, -W / 2 + 0.5, D - 0.5], [W / 2 - 0.5, 0.6, W / 2, D - 0.5]]) {
    const a = L.pt(u0, v0)
    const e = L.pt(u1, v1)
    b.strip(Math.min(a.x, e.x), Math.min(a.z, e.z), Math.max(a.x, e.x), Math.max(a.z, e.z), y, 0.7, c(PAL.hedge[1]), c(PAL.hedge[2]))
  }
}

/** Blocky pond: rows of water (water mesh) inside a sandy shore, reeds round the edge. */
function pond(b: Batch, water: Batch, p: { x: number; z: number; rx: number; rz: number }, y: number, c: Paint): void {
  const sand = c(PAL.bgSand[1])
  const rows = (rx: number, rz: number, fn: (x0: number, z0: number, x1: number, z1: number) => void): void => {
    for (let dz = -rz; dz < rz - 1e-6; dz += 0.8) {
      const half = rx * Math.sqrt(Math.max(0, 1 - ((dz + 0.4) / rz) ** 2))
      if (half < 0.6) continue
      const w = Math.round(half / 0.8) * 0.8
      fn(p.x - w, p.z + dz, p.x + w, p.z + dz + 0.8)
    }
  }
  rows(p.rx + 0.8, p.rz + 0.8, (x0, z0, x1, z1) => b.flat(x0, z0, x1, z1, y + 0.012, sand))
  rows(p.rx, p.rz, (x0, z0, x1, z1) => water.flat(x0, z0, x1, z1, y + 0.03, WHITE))
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.3 * Math.sin(i * 7.1)
    const x = p.x + Math.cos(a) * (p.rx + 0.5)
    const z = p.z + Math.sin(a) * (p.rz + 0.5)
    b.box(x, y, z, 0.14, 0.7 + 0.25 * Math.sin(i * 3.3), 0.14, c(PAL.hedge[2]), c(PAL.golden[2]), 1, 0.12, y)
  }
}

/** River: blocky rows of water (water mesh) between sand banks, reeds here and there. */
function river(b: Batch, water: Batch, plan: OutskirtsPlan, at: (x: number, z: number) => Paint): void {
  const rv = plan.river
  const { plate } = plan
  const snapQ = (v: number): number => Math.round(v * 4) / 4
  for (let z = plate.z0; z < plate.z1 - 1e-6; z += 0.5) {
    const x = riverX(rv, z + 0.25)
    const c = at(x, z)
    const x0 = snapQ(x - rv.half)
    const x1 = snapQ(x + rv.half)
    water.flat(x0, z, x1, z + 0.5, WATER_Y, WHITE)
    const sand = c(PAL.bgSand[Math.floor(z / 3) % 2 === 0 ? 0 : 1])
    b.flat(x0 - BANK, z, x0, z + 0.5, BANK_Y, sand)
    b.flat(x1, z, x1 + BANK, z + 0.5, BANK_Y, sand)
    if (z % 1 !== 0) continue
    // Reeds on the banks, close to the town.
    const d = Math.hypot(x, z)
    if (d < 0.75 * plan.reach && !plan.lite && Math.sin(z * 1.7) > 0.55) {
      const side = Math.sin(z * 0.37) > 0 ? x0 - 0.35 : x1 + 0.35
      if (!plan.bridges.some((br) => z > br.z0 - 2 && z < br.z1 + 2)) {
        b.box(side, BANK_Y, z + 0.5, 0.14, 0.75, 0.14, c(PAL.hedge[2]), c(PAL.golden[2]), 1, 0.12, BANK_Y)
        b.box(side + 0.22, BANK_Y, z + 0.2, 0.12, 0.55, 0.12, c(PAL.hedge[1]), c(PAL.golden[1]), 1, 0.12, BANK_Y)
      }
    }
  }
}

/** Road bridge: a humpbacked stone arch; rail bridge: steel girders on stone piers. */
function bridge(b: Batch, br: Bridge, plan: OutskirtsPlan, c: Paint): void {
  const stone = c(PAL.bgStone[1])
  const dark = c(PAL.bgStone[0])
  const light = c(PAL.bgStone[2])
  const w = br.z1 - br.z0
  const zm = (br.z0 + br.z1) / 2
  const xm = (br.x0 + br.x1) / 2
  const arch = col(0x2c2a27)
  if (br.kind === 'road') {
    // Level with the town's road from the gate, over the water on a low arch, then a ramp down to the lane.
    const deck = 0.02
    const end = br.x1 - RAMP
    b.box((br.x0 + end) / 2, GROUND, zm, end - br.x0, deck - GROUND, w, stone, light, 0.85)
    b.slope(end, deck, br.x1, LANE_Y, br.z0, br.z1, c(PAL.bgDirt[1]), stone)
    const xw = riverX(plan.river, zm)
    for (const z of [br.z0, br.z1]) {
      b.box((br.x0 + end) / 2 + 0.15, deck, z, end - br.x0 - 0.3, 0.42, 0.32, stone, light)
      const f: Facing = z === br.z1 ? 'z+' : 'z-'
      const o = z === br.z1 ? 0.02 : -0.02
      const span = 2 * plan.river.half - 0.4
      b.wall(xw, WATER_Y + 0.17, z + o, span, 0.3, f, c(arch.getHex()))
      b.wall(xw, WATER_Y + 0.38, z + o, span * 0.62, 0.14, f, c(arch.getHex()))
      b.box(end - 0.25, deck, z, 0.5, 0.62, 0.5, stone, light)
    }
    return
  }
  const half = plan.rail.half
  b.box(xm, GROUND, zm, br.x1 - br.x0, BALLAST_TOP - GROUND, w, dark, c(PAL.bgBallast[1]), 0.8)
  for (const x of [br.x0 + 0.5, br.x1 - 0.5]) b.box(x, GROUND, zm, 1.2, BALLAST_TOP - GROUND + 0.05, w + 0.4, stone, light)
  const girder = c(PAL.bgGirder[0])
  const rib = c(PAL.bgGirder[1])
  for (const sg of [-1, 1]) {
    const z = plan.rail.z + sg * (half + 0.15)
    b.strip(br.x0 + 0.9, z - 0.12, br.x1 - 0.9, z + 0.12, BALLAST_TOP, 0.85, girder, rib)
    for (let x = br.x0 + 1.2; x < br.x1 - 1; x += 1.15) b.box(x, BALLAST_TOP, z + sg * 0.14, 0.12, 0.85, 0.06, rib, rib)
  }
}

/** Ballast bed, sleepers and rails between the tunnel portals; the tunnels' earth blocks with stone portals. */
function railway(b: Batch, plan: OutskirtsPlan, at: (x: number, z: number) => Paint): void {
  const { rail, plate } = plan
  const k = plan.scale < 0.8 ? 0.8 : plan.scale
  const z = rail.z
  const rb = plan.bridges.find((br) => br.kind === 'rail')
  const ends = [rail.x0 - 0.8, rail.x1 + 0.8]
  const spans: Array<[number, number]> = rb ? [[ends[0], rb.x0], [rb.x1, ends[1]]] : [[ends[0], ends[1]]]
  for (const [a, d] of spans) {
    for (let x = a; x < d - 1e-6; x += 24) {
      const e = Math.min(d, x + 24)
      const c = at((x + e) / 2, z)
      b.box((x + e) / 2, GROUND, z, e - x, BALLAST_TOP - GROUND, 2 * rail.half, c(PAL.bgBallast[0]), c(PAL.bgBallast[1]), 0.85)
    }
  }
  const sleeper = at(0, z)(PAL.bgSleeper)
  if (!plan.lite) {
    for (let x = Math.ceil(ends[0] / (0.8 * k)) * 0.8 * k; x < ends[1]; x += 0.8 * k) {
      if (Math.abs(x) > 0.8 * plan.reach) continue
      b.flat(x - 0.13 * k, z - 0.95 * k, x + 0.13 * k, z + 0.95 * k, BALLAST_TOP + 0.015, sleeper)
    }
  }
  const steel = at(0, z)(PAL.bgRail)
  for (const sg of [-1, 1]) b.strip(ends[0], z + sg * 0.55 * k - 0.05 * k, ends[1], z + sg * 0.55 * k + 0.05 * k, BALLAST_TOP, 0.12, steel, steel)

  for (const tn of plan.tunnels) {
    const c = at(tn.portal, z)
    const h = tn.levels * LEVEL_H
    const tone = PAL.bgHill[Math.min(tn.levels - 1, PAL.bgHill.length - 1)]
    b.box((tn.x0 + tn.x1) / 2, GROUND, (tn.z0 + tn.z1) / 2, tn.x1 - tn.x0, h, tn.z1 - tn.z0, c(tone, 0.8), c(tone, 0.9), 0.88)
    cutFaces(b, tn.x0, tn.x1, tn.z0, tn.z1, GROUND, h, plate, c)
    // Portal on the face toward the town: dark opening in a stone frame.
    const sg = Math.sign(tn.portal)
    const fx = tn.portal
    const f: Facing = sg > 0 ? 'x-' : 'x+'
    const stone = c(PAL.bgStone[1])
    const light = c(PAL.bgStone[2])
    b.wall(fx - sg * 0.03, BALLAST_TOP + 1.45 * k, z, 2.6 * k, 2.9 * k, f, col(0x1e1c1a))
    for (const o of [-1, 1]) b.box(fx - sg * 0.3, GROUND, z + o * 1.65 * k, 0.6, BALLAST_TOP - GROUND + 3.2 * k, 0.7 * k, stone, light, 0.85)
    b.box(fx - sg * 0.3, BALLAST_TOP + 2.9 * k, z, 0.6, 0.55 * k, 4 * k, stone, light)
  }
}

/** Dirt lanes with a grass crown, and the ramp down from a gate. */
function lanes(b: Batch, plan: OutskirtsPlan, at: (x: number, z: number) => Paint): void {
  for (const l of plan.lanes) {
    const c = at((l.x0 + l.x1) / 2, (l.z0 + l.z1) / 2)
    const dirt = c(PAL.bgDirt[1])
    const edge = c(PAL.bgDirt[0])
    const alongX = l.axis === 'x'
    // The lane's ramp climbs onto the terrace at its gate.
    let a = alongX ? l.x0 : l.z0
    let d = alongX ? l.x1 : l.z1
    const c0 = alongX ? l.z0 : l.x0
    const c1 = alongX ? l.z1 : l.x1
    if (l.ramp === 'x0' || l.ramp === 'z0') {
      b.slope(a + RAMP, LANE_Y, a, 0, c0, c1, dirt, edge, !alongX)
      a += RAMP
    } else if (l.ramp) {
      b.slope(d - RAMP, LANE_Y, d, 0, c0, c1, dirt, edge, !alongX)
      d -= RAMP
    }
    const pieces: Array<[number, number]> = [[a, d]]
    const mid = alongX ? (l.z0 + l.z1) / 2 : (l.x0 + l.x1) / 2
    for (const [p, q] of pieces) {
      if (alongX) {
        b.flat(p, l.z0, q, l.z1, LANE_Y, dirt)
        if (!plan.lite) b.flat(p + 0.5, mid - 0.22, q - 0.5, mid + 0.22, LANE_Y + 0.012, c(PAL.bgMeadow[0]))
      } else {
        b.flat(l.x0, p, l.x1, q, LANE_Y, dirt)
        if (!plan.lite) b.flat(mid - 0.22, p + 0.5, mid + 0.22, q - 0.5, LANE_Y + 0.012, c(PAL.bgMeadow[0]))
      }
    }
  }
}

/** Box helper in a local frame: `u` along the front (to its right), `v` back from it; bottom at y. */
function frame(ox: number, oz: number, facing: Facing, b: Batch) {
  const F = FRAME[facing]
  const along = F.fx === 0 // the front runs along X
  const pt = (u: number, v: number) => ({ x: ox + u * F.rx - v * F.fx, z: oz + u * F.rz - v * F.fz })
  return {
    pt,
    box(u: number, v: number, y: number, w: number, h: number, d: number, c: C, top: C | null = c, foot = 1): void {
      const p = pt(u, v)
      b.box(p.x, y, p.z, along ? w : d, h, along ? d : w, c, top, foot)
    },
    /** Quad on the wall facing `side` of a box centred at (u, v) with half size (hw, hd). */
    face(target: Batch, u: number, v: number, hw: number, hd: number, side: 'front' | 'back' | 'right' | 'left', at: number, y: number, w: number, h: number, c: C): void {
      const lift = 0.03
      const p = side === 'front' ? pt(u + at, v - hd - lift) : side === 'back' ? pt(u - at, v + hd + lift) : side === 'right' ? pt(u + hw + lift, v + at) : pt(u - hw - lift, v - at)
      const f: Facing = side === 'front' ? facing : side === 'back' ? opposite(facing) : side === 'right' ? F.right : F.left
      target.wall(p.x, y, p.z, w, h, f, c)
    },
  }
}

const opposite = (f: Facing): Facing => (f === 'x+' ? 'x-' : f === 'x-' ? 'x+' : f === 'z+' ? 'z-' : 'z+')

/** Farmstead: gravel yard, a farmhouse, a red barn, maybe a silo, hay; farmhouse windows lit at night. */
function farm(b: Batch, glow: Batch, f: Farm, plan: OutskirtsPlan, c: Paint): void {
  const s = plan.scale
  const along = f.facing[0] === 'z'
  const W = along ? f.x1 - f.x0 : f.z1 - f.z0
  const ox = f.facing === 'x+' ? f.x1 : f.facing === 'x-' ? f.x0 : (f.x0 + f.x1) / 2
  const oz = f.facing === 'z+' ? f.z1 : f.facing === 'z-' ? f.z0 : (f.z0 + f.z1) / 2
  const L = frame(ox, oz, f.facing, b)
  b.flat(f.x0, f.z0, f.x1, f.z1, LANE_Y, c(PAL.bgDirt[2]))
  const lite = plan.lite
  // Farmhouse: two storeys, whitewashed, with a stepped gable roof and a chimney.
  const hu = -0.22 * W
  const hv = 4.5 * s
  const hw = 5.2 * s
  const hd = 4.2 * s
  const hh = 4.3 * s
  const wall = c(PAL.bgFarmWall[Math.floor(f.v * 3) % 3])
  const roofHex = PAL.bgRoof[Math.floor(f.v * 7) % PAL.bgRoof.length]
  L.box(hu, hv, GROUND, hw, hh, hd, wall, null, 0.82)
  roof(L, hu, hv, GROUND + hh, hw, hd, roofHex, c, s)
  L.box(hu + 0.3 * hw, hv + 0.15 * hd, GROUND + hh, 0.5 * s, 1.5 * s, 0.5 * s, c(PAL.bgChimney), c(PAL.bgChimney, 0.8))
  if (!lite) {
    L.face(b, hu, hv, hw / 2, hd / 2, 'front', -0.25 * hw, GROUND + 0.7 * s, 0.75 * s, 1.35 * s, c(PAL.bgDoor))
    const wins: Array<['front' | 'right' | 'left', number, number]> = [
      ['front', 0.18 * hw, 1.5], ['front', 0.18 * hw, 3.2], ['front', -0.25 * hw, 3.2], ['right', 0, 2.2], ['left', 0, 3.2],
    ]
    L.face(glow, hu, hv, hw / 2 + 0.05, hd / 2 + 0.05, 'front', -0.25 * hw + 0.62 * s, GROUND + 1.55 * s, 0.18 * s, 0.24 * s, col(PAL.bgGlow).multiplyScalar(0.7))
    wins.forEach(([side, u, y], i) => {
      L.face(b, hu, hv, hw / 2, hd / 2, side, u, GROUND + y * s, 0.7 * s, 0.8 * s, c(PAL.bgGlass))
      if (i < f.lights) L.face(glow, hu, hv, hw / 2 + 0.03, hd / 2 + 0.03, side, u, GROUND + y * s, 0.62 * s, 0.72 * s, col(PAL.bgGlow).multiplyScalar(i === 0 ? 0.85 : 0.72))
    })
  }
  // Barn: long, red with white corner trim, a big door to the yard.
  const bu = 0.18 * W
  const bv = 9.75 * s
  const bw = 7.4 * s
  const bd = 5.4 * s
  const bh = 4.4 * s
  const red = c(PAL.bgBarn[f.v < 0.5 ? 0 : 1])
  L.box(bu, bv, GROUND, bw, bh, bd, red, null, 0.82)
  roof(L, bu, bv, GROUND + bh, bw, bd, PAL.bgRoof[1], c, s)
  if (!lite) {
    const trim = c(PAL.bgTrim)
    for (const su of [-1, 1]) for (const sv of [-1, 1]) L.box(bu + su * (bw / 2 - 0.08 * s), bv + sv * (bd / 2 - 0.08 * s), GROUND, 0.26 * s, bh, 0.26 * s, trim, trim)
    L.face(b, bu, bv, bw / 2, bd / 2, 'front', 0, GROUND + 1.35 * s, 2.5 * s, 2.7 * s, trim)
    L.face(b, bu, bv, bw / 2 + 0.02, bd / 2 + 0.02, 'front', 0, GROUND + 1.3 * s, 2.1 * s, 2.5 * s, c(PAL.wood[0]))
    L.face(b, bu, bv, bw / 2, bd / 2, 'front', 0, GROUND + 3.6 * s, 0.9 * s, 0.7 * s, c(0x3a2f28))
  }
  if (f.silo) {
    const su = 0.42 * W
    const sv = 5.3 * s
    const grey = c(PAL.bgSilo[0])
    const lightGrey = c(PAL.bgSilo[1])
    L.box(su, sv, GROUND, 2.2 * s, 6.2 * s, 1.4 * s, grey, lightGrey)
    L.box(su, sv, GROUND, 1.4 * s, 6.2 * s, 2.2 * s, grey, lightGrey)
    L.box(su, sv, GROUND + 6.2 * s, 1.5 * s, 0.45 * s, 1.5 * s, lightGrey, lightGrey)
    L.box(su, sv, GROUND + 6.65 * s, 0.7 * s, 0.3 * s, 0.7 * s, lightGrey, lightGrey)
  }
  // Two haystacks by the barn.
  for (const [u, v] of [[0.36 * W, 11.8 * s], [0.46 * W, 9.8 * s]]) {
    const p = L.pt(u, v)
    b.box(p.x, LANE_Y, p.z, 1.3 * s, 0.6 * s, 1.3 * s, c(PAL.bgHay[0]), c(PAL.bgHay[1]), 0.85)
    b.box(p.x, LANE_Y + 0.6 * s, p.z, 0.9 * s, 0.4 * s, 0.9 * s, c(PAL.bgHay[1]), c(PAL.bgHay[2]))
  }
}

/** Stepped gable roof along the front: an overhanging eave course and two narrower tiers. */
function roof(L: ReturnType<typeof frame>, u: number, v: number, y: number, w: number, d: number, hex: number, c: Paint, s: number): void {
  const T = 0.32 * s
  const ew = w + 0.4 * s
  const ed = d + 0.5 * s
  L.box(u, v, y, ew, T, ed, c(hex, 0.78), c(hex))
  L.box(u, v, y + T, ew - 0.14 * s, T, ed * 0.62, c(hex, 0.78), c(hex))
  L.box(u, v, y + 2 * T, ew - 0.28 * s, T * 0.9, ed * 0.26, c(hex), c(hex, 1.14))
}

const millTop = (w: Windmill): number => GROUND + 1.1 + 7.2 * w.s
const millHubY = (w: Windmill): number => millTop(w) + 0.55 * w.s
const millHubZ = (w: Windmill): number => 1.55 * w.s + 0.45 * w.s

/** Windmill: a low mound, a tapering whitewashed tower with a gallery, a dark cap and hub (the sails turn separately). */
function windmill(b: Batch, glow: Batch, w: Windmill, c: Paint): void {
  const s = w.s
  for (let i = 0; i < 2; i++) {
    const r = w.mound * (1 - 0.38 * i)
    for (const [hw, hd] of [[r, 0.7 * r], [0.7 * r, r]]) b.box(w.x, GROUND + 0.55 * i, w.z, 2 * hw, 0.55, 2 * hd, c(PAL.bgHill[i], 0.8), c(PAL.bgHill[i + 1]), 0.9)
  }
  const y0 = GROUND + 1.1
  const wall = c(PAL.bgMill[0])
  const widths = [3.4, 3.1, 2.8, 2.5]
  widths.forEach((ww, i) => b.box(w.x, y0 + i * 1.8 * s, w.z, ww * s, 1.8 * s, ww * s, wall, null, i === 0 ? 0.85 : 1))
  const dark = c(PAL.bgMill[1])
  b.box(w.x, y0 + 2.3 * s, w.z, 4.3 * s, 0.16 * s, 4.3 * s, dark, c(PAL.wood[1]))
  const top = millTop(w)
  b.box(w.x, top, w.z, 2.7 * s, 1.0 * s, 3.1 * s, dark, null, 0.9)
  b.box(w.x, top + 1.0 * s, w.z, 2.2 * s, 0.5 * s, 2.6 * s, dark, null)
  b.box(w.x, top + 1.5 * s, w.z, 1.3 * s, 0.4 * s, 1.8 * s, dark, c(PAL.bgMill[1], 1.25))
  b.box(w.x, millHubY(w) - 0.25 * s, w.z + 1.55 * s, 0.5 * s, 0.5 * s, 0.9 * s, dark)
  // Door and windows on the front (+z), one lit at night.
  const fz = w.z + 1.7 * s + 0.02
  b.wall(w.x, y0 + 0.7 * s, fz, 0.8 * s, 1.4 * s, 'z+', c(PAL.bgDoor))
  b.wall(w.x, y0 + 4.4 * s, w.z + 1.4 * s + 0.02, 0.55 * s, 0.7 * s, 'z+', c(PAL.bgGlass))
  b.wall(w.x + 0.6 * s, y0 + 6.2 * s, w.z + 1.25 * s + 0.02, 0.5 * s, 0.6 * s, 'z+', c(PAL.bgGlass))
  glow.wall(w.x, y0 + 4.4 * s, w.z + 1.4 * s + 0.05, 0.47 * s, 0.62 * s, 'z+', col(PAL.bgGlow).multiplyScalar(0.7))
}

/** Four sails round the hub in the XY plane (they turn about +Z): spars with a cloth panel on the trailing side. */
function sailGeometry(): THREE.BufferGeometry {
  const b = new Batch()
  const spar = col(PAL.bgSail[0])
  const cloth = col(PAL.bgSail[1])
  // One arm along +Y; the others are the same boxes turned by quarter turns about Z.
  const arm: Array<[number, number, number, number, number, number, C]> = [
    [0, 0.25, 0.1, 0.18, 4.4, 0.14, spar],
    [0.42, 1.0, 0.06, 0.62, 3.5, 0.05, cloth],
    [0.42, 1.6, 0.11, 0.66, 0.06, 0.04, spar],
    [0.42, 2.6, 0.11, 0.66, 0.06, 0.04, spar],
    [0.42, 3.6, 0.11, 0.66, 0.06, 0.04, spar],
  ]
  for (let k = 0; k < 4; k++) {
    for (const [x, y, z, w, h, d, cc] of arm) {
      // Centre of the box in the XY plane, turned by k quarter turns.
      let cx = x
      let cy = y + h / 2
      let hw = w
      let hh = h
      for (let i = 0; i < k; i++) {
        ;[cx, cy] = [-cy, cx]
        ;[hw, hh] = [hh, hw]
      }
      b.box(cx, cy - hh / 2, z, hw, hh, d, cc)
    }
  }
  b.box(0, -0.3, 0.05, 0.6, 0.6, 0.3, spar)
  return b.build()
}

/** Little steam train along +X from the head (x = 0) back: tank engine and three coaches; windows and lamp glow. */
function trainGeometry(s: number): { body: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const b = new Batch()
  const g = new Batch()
  const [locoHex, coachHex, bandHex, roofHex, chassisHex] = PAL.bgTrain
  const loco = col(locoHex)
  const chassis = col(chassisHex)
  const box = (x: number, y: number, w: number, h: number, d: number, c: C, top: C | null = c) => b.box(x * s, y * s, 0, w * s, h * s, d * s, c, top)
  box(-2, 0, 3.8, 0.45, 1.2, chassis)
  box(-2, 0.45, 4, 0.12, 1.55, chassis)
  box(-1.35, 0.57, 2.5, 1, 1.1, loco, col(locoHex).multiplyScalar(1.15))
  box(-0.22, 0.57, 0.3, 1, 1.12, chassis)
  box(-0.55, 1.57, 0.32, 0.55, 0.32, chassis)
  box(-1.45, 1.57, 0.42, 0.24, 0.42, col(PAL.gold))
  box(-3.25, 0.57, 1.45, 1.55, 1.45, loco)
  box(-3.25, 2.12, 1.7, 0.12, 1.62, chassis)
  box(-0.03, 0.2, 0.1, 0.32, 1.5, col(0xb04a3c))
  b.wall(0.03 * s, 1.15 * s, 0, 0.26 * s, 0.22 * s, 'x+', col(0xf2e6c8))
  g.wall(0.06 * s, 1.15 * s, 0, 0.3 * s, 0.26 * s, 'x+', col(0xfff0d2).multiplyScalar(0.6))
  for (const sg of [-1, 1]) b.wall(-3.25 * s, 1.75 * s, sg * 0.74 * s, 0.7 * s, 0.55 * s, sg > 0 ? 'z+' : 'z-', col(0x2a2d33))
  const coach = col(coachHex)
  const band = col(bandHex)
  const roofC = col(roofHex)
  const glass = col(0x30343c)
  const lit = col(PAL.bgGlow).multiplyScalar(0.8)
  for (let i = 0; i < TRAIN.coaches; i++) {
    const cx = -(TRAIN.loco + TRAIN.gap + i * (TRAIN.coach + TRAIN.gap) + TRAIN.coach / 2)
    box(cx, 0, 4.1, 0.4, 1.15, chassis)
    box(cx, 0.4, TRAIN.coach, 1.3, 1.42, coach, null)
    box(cx, 1.7, TRAIN.coach + 0.1, 0.14, 1.52, roofC)
    box(cx, 1.84, TRAIN.coach - 0.2, 0.12, 1.1, roofC, col(roofHex).multiplyScalar(1.15))
    for (const sg of [-1, 1]) {
      const f: Facing = sg > 0 ? 'z+' : 'z-'
      b.wall(cx * s, 1.3 * s, sg * 0.72 * s, (TRAIN.coach - 0.3) * s, 0.55 * s, f, band)
      for (let k = 0; k < 4; k++) {
        const wx = (cx - TRAIN.coach / 2 + 0.65 + k * 1.03) * s
        b.wall(wx, 1.3 * s, sg * 0.735 * s, 0.62 * s, 0.4 * s, f, glass)
        g.wall(wx, 1.3 * s, sg * 0.76 * s, 0.58 * s, 0.36 * s, f, lit)
      }
    }
  }
  return { body: b.build(), glow: g.build() }
}

/** Small tractor, nose toward +Z; white parts take the instance colour. */
function tractorGeometry(s: number): THREE.BufferGeometry {
  const b = new Batch()
  const body = col(0xffffff)
  const tyre = col(0x26292e)
  const dark = col(0x3a3d44)
  b.flat(-0.7 * s, -1.0 * s, 0.7 * s, 1.15 * s, 0.012, col(0x2a2e36))
  for (const x of [-0.56, 0.56]) b.box(x * s, 0, -0.42 * s, 0.34 * s, 0.95 * s, 0.95 * s, tyre)
  for (const x of [-0.47, 0.47]) b.box(x * s, 0, 0.72 * s, 0.24 * s, 0.56 * s, 0.56 * s, tyre)
  b.box(0, 0.3 * s, 0.38 * s, 0.68 * s, 0.55 * s, 1.25 * s, body, body, 0.85)
  b.box(0, 0.35 * s, -0.42 * s, 1.0 * s, 0.32 * s, 0.85 * s, body, body)
  for (const x of [-0.42, 0.42]) for (const z of [-0.78, -0.08]) b.box(x * s, 0.67 * s, z * s, 0.07 * s, 0.85 * s, 0.07 * s, dark)
  b.box(0, 1.52 * s, -0.43 * s, 1.0 * s, 0.08 * s, 0.85 * s, body, body)
  b.box(0.18 * s, 0.85 * s, 0.82 * s, 0.08 * s, 0.5 * s, 0.08 * s, dark)
  return b.build()
}

/** A sheep, cow or pig facing +Z, feet at the origin: coat parts white (each animal tints them), face and legs dark. */
function animalGeometry(kind: AnimalKind, s: number): THREE.BufferGeometry {
  const b = new Batch()
  const coat = col(0xffffff)
  if (kind === 'pig') {
    const [len, wid, leg, tall] = [0.9 * s, 0.55 * s, 0.16 * s, 0.42 * s]
    const shade = col(0xd4d4d4) // snout, ears, trotters and tail: a darker shade of the coat
    b.box(0, 0, 0, wid * 0.8, leg, len * 0.7, shade)
    b.box(0, leg, 0, wid, tall, len, coat, coat, 0.88)
    const hy = leg + tall * 0.25
    const hz = len / 2 + 0.11 * s
    b.box(0, hy, hz, 0.36 * s, 0.32 * s, 0.22 * s, coat)
    b.box(0, hy + 0.07 * s, hz + 0.14 * s, 0.17 * s, 0.13 * s, 0.07 * s, shade)
    for (const x of [-0.11, 0.11]) b.box(x * s, hy + 0.32 * s, hz - 0.03 * s, 0.09 * s, 0.07 * s, 0.07 * s, shade)
    b.box(0, leg + tall * 0.6, -len / 2 - 0.03 * s, 0.06 * s, 0.06 * s, 0.06 * s, shade)
    return b.build()
  }
  const sheep = kind === 'sheep'
  const len = (sheep ? 0.95 : 1.6) * s
  const wid = (sheep ? 0.62 : 0.72) * s
  const leg = (sheep ? 0.22 : 0.35) * s
  const tall = (sheep ? 0.55 : 0.75) * s
  const face = col(sheep ? PAL.bgWool[1] : PAL.bgCow[1])
  b.box(0, 0, 0, wid * 0.8, leg, len * 0.75, face)
  b.box(0, leg, 0, wid, tall, len, coat)
  if (!sheep) b.box(0.05 * s, leg + tall, -0.25 * s, wid * 0.7, 0.02, len * 0.35, face)
  b.box(0, leg + tall * 0.45, len / 2 + 0.12 * s, (sheep ? 0.34 : 0.44) * s, (sheep ? 0.34 : 0.42) * s, (sheep ? 0.3 : 0.4) * s, face)
  return b.build()
}

/** Coat palette per kind: an animal's `tone` indexes it. */
const COAT: Record<AnimalKind, readonly number[]> = { sheep: PAL.bgWool, cow: PAL.bgCow, pig: PAL.bgPig }

/** Trees by kind: round, cone (pine), fruit, poplar and willow, with a baked contact shadow close up. */
function tree(b: Batch, t: Tree, c: Paint): void {
  const s = t.s
  const y = t.y
  if (t.lod < 2) {
    const o = 0.9 * s
    b.flat(t.x - o + SHADOW_DIR.x * o, t.z - o + SHADOW_DIR.z * o, t.x + o + SHADOW_DIR.x * o, t.z + o + SHADOW_DIR.z * o, y + 0.022, c(PAL.leaf[0], 0.55))
  }
  const sway = TREE_SWAY
  switch (t.kind) {
    case 'cone': {
      const [dk, mid, lt] = PAL.pine.map((h) => c(h))
      b.box(t.x, y, t.z, 0.3 * s, 0.8 * s, 0.3 * s, c(PAL.trunk[0]))
      b.box(t.x, y + 0.7 * s, t.z, 2.1 * s, 0.7 * s, 2.1 * s, dk, mid, 1, sway, y)
      b.box(t.x, y + 1.35 * s, t.z, 1.5 * s, 0.7 * s, 1.5 * s, mid, lt, 1, sway, y)
      if (t.lod < 2) b.box(t.x, y + 2.0 * s, t.z, 0.9 * s, 0.6 * s, 0.9 * s, mid, lt, 1, sway, y)
      if (t.lod === 0) b.box(t.x, y + 2.55 * s, t.z, 0.4 * s, 0.4 * s, 0.4 * s, lt, lt, 1, sway, y)
      return
    }
    case 'poplar': {
      const [dk, mid, lt] = PAL.golden.map((h) => c(h))
      b.box(t.x, y, t.z, 0.26 * s, 0.9 * s, 0.26 * s, c(PAL.trunk[1]))
      b.box(t.x, y + 0.8 * s, t.z, 1.0 * s, 3.2 * s, 1.0 * s, dk, mid, 1, sway, y)
      b.box(t.x, y + 4.0 * s, t.z, 0.62 * s, 1.1 * s, 0.62 * s, mid, lt, 1, sway, y)
      return
    }
    case 'willow': {
      const [dk, mid, lt] = PAL.golden.map((h) => c(h))
      b.box(t.x, y, t.z, 0.4 * s, 1.5 * s, 0.4 * s, c(PAL.trunk[0]))
      b.box(t.x, y + 1.35 * s, t.z, 2.7 * s, 0.9 * s, 2.7 * s, dk, mid, 1, sway, y)
      b.box(t.x + 0.2 * s, y + 2.25 * s, t.z - 0.1 * s, 1.7 * s, 0.5 * s, 1.7 * s, mid, lt, 1, sway, y)
      if (t.lod < 2) {
        // Drooping fronds on all four sides.
        for (const [dx, dz, w, d] of [[1.3, 0, 0.25, 2.2], [-1.3, 0, 0.25, 2.2], [0, 1.3, 2.2, 0.25], [0, -1.3, 2.2, 0.25]]) {
          b.box(t.x + dx * s, y + 0.7 * s, t.z + dz * s, w * s, 0.75 * s, d * s, mid, mid, 1, sway * 1.5, y)
        }
      }
      return
    }
    case 'fruit': {
      const blossom = t.v < 0.22
      const [dk, mid, lt] = (blossom ? PAL.blossom : PAL.leaf).map((h) => c(h))
      b.box(t.x, y, t.z, 0.24 * s, 0.85 * s, 0.24 * s, c(PAL.trunk[1]))
      b.box(t.x, y + 0.7 * s, t.z, 1.55 * s, 1.1 * s, 1.55 * s, dk, mid, 1, sway, y)
      if (t.lod < 2) b.box(t.x, y + 1.8 * s, t.z, 0.95 * s, 0.4 * s, 0.95 * s, mid, lt, 1, sway, y)
      if (t.lod === 0 && !blossom) {
        const fruit = c(t.v < 0.6 ? 0xd2553f : 0xe39a3c)
        for (const [dx, dz] of [[0.79, 0.2], [-0.3, 0.79], [0.25, -0.79]]) b.box(t.x + dx * s, y + 1.25 * s, t.z + dz * s, 0.2 * s, 0.2 * s, 0.2 * s, fruit, fruit, 1, sway, y)
      }
      return
    }
    default: {
      const ramp = t.v < 0.1 ? PAL.golden : PAL.leaf
      const [dk, mid, lt] = ramp.map((h) => c(h))
      b.box(t.x, y, t.z, 0.34 * s, 1.3 * s, 0.34 * s, c(PAL.trunk[1]))
      b.box(t.x, y + 1.1 * s, t.z, 1.8 * s, 1.35 * s, 1.8 * s, dk, mid, 1, sway, y)
      if (t.lod === 0) b.box(t.x, y + 1.35 * s, t.z, 2.4 * s, 0.8 * s, 1.2 * s, dk, mid, 1, sway, y)
      if (t.lod < 2) b.box(t.x + (t.v < 0.5 ? 0.3 : -0.3) * s, y + 2.45 * s, t.z - 0.15 * s, 1.1 * s, 0.45 * s, 1.1 * s, mid, lt, 1, sway, y)
    }
  }
}
