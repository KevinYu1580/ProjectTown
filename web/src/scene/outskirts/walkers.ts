// People walking outside the town (the sidewalks of the town's roads where they leave it, the country lanes from the
// gates): the town's own people (characters/person.ts) in plain clothes, without names or symbols. Each paces its own
// part of one side to and fro and stands a moment at each end. Shared by both themes: the plan side is plain data
// (placement can be tested), the meshes are four instanced batches.
import * as THREE from 'three'
import { JOINTS, PersonParts, SKINS } from '../characters/person'
import { PAL } from '../palette'
import type { RoadExit } from '../street'
import { paint } from '../voxel'

/** A person pacing from (x0, z0) to (x1, z1) and back at height `y`, standing `rest` seconds at each end. */
export interface Walker {
  x0: number; z0: number; x1: number; z1: number; y: number; speed: number; rest: number; phase: number; s: number
  shirt: number; pants: number; skin: number // indices into PAL.bgShirt, PAL.bgPants and the town's skin tones
}
export interface WalkerPose { x: number; z: number; yaw: number; lift: number; swing: number }

/** Sidewalk centre beside a road line: half the asphalt, the kerb and half the sidewalk (street.ts). */
export const WALK_OFFSET = 1.5 + 0.2 + 1.5 / 2
export const SIDEWALK_TOP = 0.1
/** Room a person takes across (arms included) at lot scale 1: people keep this far apart. */
export const BODY = 0.9
// The town's people's gait (person.ts): stride cycle (radians per unit walked at lot scale 1), leg swing and bob.
const GAIT = 6
const SWING = 0.75
const BOB = 0.05
const TURN = 0.7 // seconds of the rest spent turning round
const HAIR = 1 // the town's brown hair: it darkens with the skin tone (see WalkerMeshes)

/** Where a walker is at animation time `t` (seconds): heading, step bob and leg swing. Writes into `out`. */
export function walkerPose(w: Walker, t: number, out: WalkerPose = { x: 0, z: 0, yaw: 0, lift: 0, swing: 0 }): WalkerPose {
  const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0)
  const leg = len / w.speed
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
  // A whole number of steps per leg, so the feet are together where the walker stops.
  const step = Math.sin(Math.PI * Math.max(1, Math.round((GAIT * len) / (Math.PI * w.s))) * f)
  out.swing = SWING * step
  out.lift = BOB * w.s * Math.abs(step)
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
 * `count` walkers spread over both sides of `lines` (too short ones are skipped). People sharing a side pace parts of
 * it of their own, a body apart, as two could not pass on a sidewalk. Where a lane crosses a sidewalk, its part
 * simply carries on across.
 */
export function planWalkers(lines: WalkLine[], count: number, s: number, rng: () => number): Walker[] {
  const sides = lines.filter((l) => Math.abs(l.b - l.a) >= 4).flatMap((l) => [-1, 1].map((side) => ({ l, at: l.at + side * l.offset })))
  const walkers: Walker[] = []
  for (let i = 0; i < count && sides.length > 0; i++) {
    const j = i % sides.length
    const { l, at } = sides[j]
    const n = Math.ceil((count - j) / sides.length) // people on this side
    const k = Math.floor(i / sides.length)
    const part = (l.b - l.a) / n
    const gap = Math.sign(part) * (BODY * s + 0.3) / 2
    const [p0, p1] = [l.a + part * k + gap, l.a + part * (k + 1) - gap]
    const ends = l.axis === 'z' ? { x0: at, z0: p0, x1: at, z1: p1 } : { x0: p0, z0: at, x1: p1, z1: at }
    const speed = (0.8 + 0.3 * rng()) * s
    const rest = 1.5 + 3 * rng()
    const leg = Math.abs(p1 - p0) / speed
    walkers.push({
      ...ends, y: l.y, speed, rest, phase: rng() * 2 * (leg + rest), s,
      shirt: Math.floor(rng() * PAL.bgShirt.length), pants: Math.floor(rng() * PAL.bgPants.length), skin: Math.floor(rng() * SKINS.length),
    })
  }
  return walkers
}

/** The walkers of one plan as instanced copies of the town's people: torso, head, arms and legs, posed every frame. */
export class WalkerMeshes {
  readonly group = new THREE.Group()
  private readonly torsos: THREE.InstancedMesh
  private readonly heads: THREE.InstancedMesh
  private readonly arms: THREE.InstancedMesh // two per walker: left, then right
  private readonly legs: THREE.InstancedMesh
  private readonly meshes: THREE.InstancedMesh[]
  // Scratch objects, reused every frame.
  private readonly body = new THREE.Matrix4()
  private readonly joint = new THREE.Matrix4()
  private readonly m = new THREE.Matrix4()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly size = new THREE.Vector3()
  private readonly up = new THREE.Vector3(0, 1, 0)
  private readonly pose: WalkerPose = { x: 0, z: 0, yaw: 0, lift: 0, swing: 0 }

  constructor(private readonly walkers: Walker[], mat: THREE.Material) {
    // The outskirts' material reads vertex colours and `sway` (0: people stand still in the wind).
    const parts = new PersonParts()
    const white = new THREE.Color(1, 1, 1)
    const head = parts.head(0, HAIR)
    head.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(head.getAttribute('position').count), 1))
    const n = walkers.length
    this.torsos = new THREE.InstancedMesh(paint(parts.torso, white), mat, n)
    this.heads = new THREE.InstancedMesh(head, mat, n)
    this.arms = new THREE.InstancedMesh(paint(parts.arm, white), mat, 2 * n)
    this.legs = new THREE.InstancedMesh(paint(parts.leg, white), mat, 2 * n)
    this.meshes = [this.torsos, this.heads, this.arms, this.legs]
    // Clothes are tinted per person; heads are built with the lightest skin and tinted to the person's own.
    const light = new THREE.Color(SKINS[0])
    const c = new THREE.Color()
    walkers.forEach((w, i) => {
      c.set(PAL.bgShirt[w.shirt])
      this.torsos.setColorAt(i, c)
      this.arms.setColorAt(2 * i, c)
      this.arms.setColorAt(2 * i + 1, c)
      c.set(PAL.bgPants[w.pants])
      this.legs.setColorAt(2 * i, c)
      this.legs.setColorAt(2 * i + 1, c)
      c.set(SKINS[w.skin])
      this.heads.setColorAt(i, c.setRGB(c.r / light.r, c.g / light.g, c.b / light.b))
    })
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
      this.body.compose(this.p.set(pose.x, w.y + pose.lift, pose.z), this.q.setFromAxisAngle(this.up, pose.yaw), this.size.setScalar(w.s))
      this.torsos.setMatrixAt(i, this.body)
      this.place(this.heads, i, 0, JOINTS.neck, 0)
      // Arms swing against the legs, as in the town (person.ts).
      this.place(this.arms, 2 * i, -JOINTS.shoulderX, JOINTS.shoulder, -0.8 * pose.swing)
      this.place(this.arms, 2 * i + 1, JOINTS.shoulderX, JOINTS.shoulder, 0.8 * pose.swing)
      this.place(this.legs, 2 * i, -JOINTS.hipX, JOINTS.hip, pose.swing)
      this.place(this.legs, 2 * i + 1, JOINTS.hipX, JOINTS.hip, -pose.swing)
    }
    for (const mesh of this.meshes) mesh.instanceMatrix.needsUpdate = true
  }

  /** Instance `i` of `mesh`: hung from (x, y) of the current body and turned `angle` about its X axis. */
  private place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, angle: number): void {
    mesh.setMatrixAt(i, this.m.multiplyMatrices(this.body, this.joint.makeRotationX(angle).setPosition(x, y, 0)))
  }
}
