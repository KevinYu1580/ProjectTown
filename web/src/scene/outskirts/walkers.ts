// People on the sidewalks of the town's roads where they leave the town: background life, small and muted next to the
// town's own people. Each paces a straight stretch of one sidewalk to and fro and stands a moment at each end. Shared
// by both themes: the plan side is plain data (placement can be tested), the meshes are two instanced batches.
import * as THREE from 'three'
import { PAL } from '../palette'
import type { RoadExit } from '../street'

/** A person pacing from (x0, z0) to (x1, z1) and back at height `y`, standing `rest` seconds at each end. */
export interface Walker { x0: number; z0: number; x1: number; z1: number; y: number; speed: number; rest: number; phase: number; s: number; shirt: number }
export interface WalkerPose { x: number; z: number; yaw: number; lift: number }

/** Sidewalk centre beside a road line: half the asphalt, the kerb and half the sidewalk (street.ts). */
export const WALK_OFFSET = 1.5 + 0.2 + 1.5 / 2
export const SIDEWALK_TOP = 0.1
const STRIDE = 0.42 // one step (x scale): the body bobs once per step
const TURN = 0.7 // seconds of the rest spent turning round

/** Where a walker is at animation time `t` (seconds), its heading and a small step bob. Writes into `out`. */
export function walkerPose(w: Walker, t: number, out: WalkerPose = { x: 0, z: 0, yaw: 0, lift: 0 }): WalkerPose {
  const leg = Math.hypot(w.x1 - w.x0, w.z1 - w.z0) / w.speed
  const half = leg + w.rest
  let u = (((t + w.phase) % (2 * half)) + 2 * half) % (2 * half)
  const back = u >= half
  if (back) u -= half
  const f = Math.min(u / leg, 1) // share of this leg walked
  const along = back ? 1 - f : f
  out.x = w.x0 + (w.x1 - w.x0) * along
  out.z = w.z0 + (w.z1 - w.z0) * along
  const yaw = Math.atan2(w.x1 - w.x0, w.z1 - w.z0) + (back ? Math.PI : 0)
  // Standing at the end of a leg: turn round during the last moments of the rest.
  const r = u - leg
  out.yaw = r > 0 ? yaw + Math.PI * THREE.MathUtils.smoothstep(r, w.rest - TURN, w.rest) : yaw
  out.lift = r < 0 ? 0.04 * w.s * Math.abs(Math.sin((Math.PI * u * w.speed) / (STRIDE * w.s))) : 0
  return out
}

/** Straight walkable line along X at z = `at` (or along Z at x = `at`) from `a` to `b`: people walk `offset` either side. */
export interface WalkLine { axis: 'x' | 'z'; at: number; a: number; b: number; offset: number; y: number }

/** The sidewalks of the town's roads where they leave it, from just outside the town out to `len` (or the road's end). */
export function sidewalkLines(exits: RoadExit[], len: number): WalkLine[] {
  return exits.map((e) => {
    const [near, far] = Math.abs(e.from) < Math.abs(e.to) ? [e.from, e.to] : [e.to, e.from]
    const dir = Math.sign(far - near)
    return { axis: e.axis, at: e.at, a: near + dir * 0.6, b: near + dir * Math.min(len, Math.abs(far - near) - 1), offset: WALK_OFFSET, y: SIDEWALK_TOP }
  })
}

/**
 * `count` walkers spread over both sides of `lines` (too short ones are skipped). Where a lane crosses a sidewalk, its
 * stretch simply carries on across.
 */
export function planWalkers(lines: WalkLine[], count: number, s: number, rng: () => number): Walker[] {
  const stretches = lines.filter((l) => Math.abs(l.b - l.a) >= 4).flatMap((l) => [-1, 1].map((side) => ({ l, at: l.at + side * l.offset })))
  const walkers: Walker[] = []
  for (let i = 0; i < count && stretches.length > 0; i++) {
    const { l, at: base } = stretches[i % stretches.length]
    // People sharing a stretch keep to different parts of its width, so they pass each other.
    const at = base + ((Math.floor(i / stretches.length) % 3) - 1) * 0.42
    const ends = l.axis === 'z' ? { x0: at, z0: l.a, x1: at, z1: l.b } : { x0: l.a, z0: at, x1: l.b, z1: at }
    const speed = (0.5 + 0.22 * rng()) * s
    const rest = 1.5 + 3 * rng()
    const leg = Math.abs(l.b - l.a) / speed
    walkers.push({ ...ends, y: l.y, speed, rest, phase: rng() * 2 * (leg + rest), s, shirt: Math.floor(rng() * PAL.bgShirt.length) })
  }
  return walkers
}

/** The walkers of one plan as two instanced meshes (shirts tinted per person, the rest as drawn); pose every frame. */
export class WalkerMeshes {
  readonly group = new THREE.Group()
  private readonly meshes: THREE.InstancedMesh[]
  // Scratch objects, reused every frame.
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly one = new THREE.Vector3(1, 1, 1)
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly pose: WalkerPose = { x: 0, z: 0, yaw: 0, lift: 0 }

  constructor(private readonly walkers: Walker[], s: number, mat: THREE.Material, shirt: (w: Walker) => THREE.Color) {
    const { shirts, rest } = personGeometry(s)
    this.meshes = [new THREE.InstancedMesh(shirts, mat, walkers.length), new THREE.InstancedMesh(rest, mat, walkers.length)]
    walkers.forEach((w, i) => this.meshes[0].setColorAt(i, shirt(w)))
    for (const mesh of this.meshes) {
      mesh.frustumCulled = false
      this.group.add(mesh)
    }
  }

  /** Every frame while the clock runs: no allocations. */
  update(t: number): void {
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i]
      const pose = walkerPose(w, t, this.pose)
      this.m.compose(this.p.set(pose.x, w.y + pose.lift, pose.z), this.q.setFromAxisAngle(this.up, pose.yaw), this.one)
      for (const mesh of this.meshes) mesh.setMatrixAt(i, this.m)
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true
  }
}

/** A person about half the height of the town's people, feet at the origin, facing +Z: shirt and arms, then the rest. */
function personGeometry(scale: number): { shirts: THREE.BufferGeometry; rest: THREE.BufferGeometry } {
  const s = 1.45 * scale // a little over life size next to the cars, so they read from the default view
  const shirts = new Boxes()
  const rest = new Boxes()
  const white = new THREE.Color(1, 1, 1)
  const [skin, hair, legs] = PAL.bgPerson.map((h) => new THREE.Color(h))
  for (const x of [-0.045, 0.045]) rest.box(x * s, 0, 0, 0.075 * s, 0.3 * s, 0.085 * s, legs)
  shirts.box(0, 0.29 * s, 0, 0.2 * s, 0.25 * s, 0.12 * s, white)
  for (const x of [-0.125, 0.125]) shirts.box(x * s, 0.31 * s, 0, 0.05 * s, 0.22 * s, 0.075 * s, white)
  rest.box(0, 0.545 * s, 0, 0.13 * s, 0.13 * s, 0.13 * s, skin)
  rest.box(0, 0.665 * s, -0.005 * s, 0.145 * s, 0.045 * s, 0.145 * s, hair)
  rest.box(0, 0.58 * s, -0.07 * s, 0.145 * s, 0.09 * s, 0.03 * s, hair)
  return { shirts: shirts.build(), rest: rest.build() }
}

/** Vertex-coloured boxes (no bottom faces), with the attributes the outskirts' materials read (`sway` stays 0). */
class Boxes {
  private readonly pos: number[] = []
  private readonly nor: number[] = []
  private readonly rgb: number[] = []
  private readonly idx: number[] = []

  /** (x, y, z) = bottom centre; the lower edge of the sides is a little darker. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, c: THREE.Color, foot = 0.82): void {
    const [x0, x1, y1, z0, z1] = [x - w / 2, x + w / 2, y + h, z - d / 2, z + d / 2]
    this.quad([x0, y1, z1, x1, y1, z1, x1, y1, z0, x0, y1, z0], 0, 1, 0, c, 1)
    this.quad([x0, y, z1, x1, y, z1, x1, y1, z1, x0, y1, z1], 0, 0, 1, c, foot)
    this.quad([x1, y, z0, x0, y, z0, x0, y1, z0, x1, y1, z0], 0, 0, -1, c, foot)
    this.quad([x1, y, z1, x1, y, z0, x1, y1, z0, x1, y1, z1], 1, 0, 0, c, foot)
    this.quad([x0, y, z0, x0, y, z1, x0, y1, z1, x0, y1, z0], -1, 0, 0, c, foot)
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.rgb, 3))
    g.setAttribute('sway', new THREE.Float32BufferAttribute(new Array<number>(this.pos.length / 3).fill(0), 1))
    g.setIndex(this.idx)
    g.computeBoundingSphere()
    return g
  }

  /** Four corners counter-clockwise seen from the front; the first two are the lower edge (shaded by `foot`). */
  private quad(p: number[], nx: number, ny: number, nz: number, c: THREE.Color, foot: number): void {
    const base = this.pos.length / 3
    this.pos.push(...p)
    for (let i = 0; i < 4; i++) {
      const k = i < 2 ? foot : 1
      this.nor.push(nx, ny, nz)
      this.rgb.push(c.r * k, c.g * k, c.b * k)
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
}
