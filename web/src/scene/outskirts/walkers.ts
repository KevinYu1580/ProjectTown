// People walking about (both themes): the town's own people (characters/person.ts) in plain clothes, without names or
// symbols. They roam one network of walks: the town's sidewalks and zebra crossings, joined to what the surroundings
// add (the sidewalks of the roads leaving town, the lanes to the farms). Each walks a round of its own and comes back
// to where it started: on to a few places picked at random, by the shortest way and keeping right, now and then
// standing at a kerb before crossing and turning round at a dead end. Every round takes the same time, so the crowd as
// a whole repeats with that period: the planner checks one period and leaves out a round that would bump into another
// (passing on opposite sides is fine). The plan side is plain data (placement can be tested), the meshes are four
// instanced batches.
import * as THREE from 'three'
import { JOINTS, PersonParts, SKINS } from '../characters/person'
import { ROAD_WIDTH, SIDEWALK_WIDTH, type TownLayout } from '../layout'
import { PAL } from '../palette'
import type { RoadExit } from '../street'
import { makeVoxelMaterial, paint } from '../voxel'

/**
 * A straight piece of walk from (x0, z0) to (x1, z1), rising from y0 to y1; people keep `side` to the right of it. `goal`
 * weighs how often people head for it (1 by default), `kerb` marks a road crossing.
 */
export interface WalkSeg { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; side: number; kerb?: boolean; goal?: number }
/** Pieces of walk, and spots that keep the walks around them clear (low tree crowns). */
export interface Walks { segs: WalkSeg[]; avoid: Array<{ x: number; z: number; r: number }> }

/** One piece of a round: walking from (x0, z0) to (x1, z1), or standing there (steps = 0) and turning by `turn`. */
export interface Leg {
  t0: number
  dur: number
  len: number
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number
  yaw: number // walking: the heading; standing: the way it faces before it turns
  turn: number // standing: how far it turns in its last moments
  prev: number; next: number // walking: how far the heading turns at its start and at its end (0 next to a stop)
  d0: number; run: number; steps: number // walking: how far into its run (the legs between two stops), the run's length, whole steps in it
}
/** A person walking a round of `legs` that takes `period` seconds, `phase` seconds into it at t = 0. */
export interface Walker {
  legs: Leg[]
  period: number
  phase: number
  speed: number
  s: number
  shirt: number; pants: number; skin: number // indices into PAL.bgShirt, PAL.bgPants and the town's skin tones
}
export interface WalkerPose { x: number; y: number; z: number; yaw: number; lift: number; swing: number }

/** Sidewalk centre beside a road line: half the asphalt, the kerb and half the sidewalk (street.ts). */
const WALK_OFFSET = 1.5 + 0.2 + 1.5 / 2
const SIDEWALK_TOP = 0.1
/** Room a person takes across (arms included) at lot scale 1. */
export const BODY = 0.9
/** Every round takes this long (seconds). */
export const PERIOD = 300
// The town's people's gait (person.ts): stride cycle (radians per unit walked at lot scale 1), leg swing and bob.
const GAIT = 6
const SWING = 0.75
const BOB = 0.05
const SPEED = [0.8, 1.1] // walking speeds at lot scale 1
const TURN = 0.7 // seconds of a stop spent turning
const CORNER = 0.35 // the heading turns over this far either side of a corner (at lot scale 1)
const DT = 0.2 // seconds between the planner's checks
const TRIES = 40 // rounds tried for a walker; if none fits, the walks are full
const HAIR = 1 // the town's brown hair: it darkens with the skin tone (see WalkerMeshes)

/** How far right of a sidewalk's middle people keep at lot scale `s`: as far as the sidewalk allows, so two can pass. */
export function sideFor(s: number): number {
  return Math.min(0.4, SIDEWALK_WIDTH / 2 - (BODY / 2) * s)
}

/** The town's walks: the sidewalk round every grid cell and round the town, and the zebra crossings between them. */
export function townWalks(layout: TownLayout): Walks {
  const { cols, rows, pitch, lotSize, bounds: b } = layout
  const side = sideFor(layout.lotScale)
  const y = SIDEWALK_TOP
  const segs: WalkSeg[] = []
  const ring = (x0: number, z0: number, x1: number, z1: number): void => {
    const c = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
    c.forEach(([xa, za], i) => {
      const [xb, zb] = c[(i + 1) % 4]
      segs.push({ x0: xa, y0: y, z0: za, x1: xb, y1: y, z1: zb, side })
    })
  }
  const d = lotSize / 2 + SIDEWALK_WIDTH / 2
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const x = (col - (cols - 1) / 2) * pitch
      const z = (row - (rows - 1) / 2) * pitch
      ring(x - d, z - d, x + d, z + d)
    }
  }
  const h = SIDEWALK_WIDTH / 2
  ring(b.minX + h, b.minZ + h, b.maxX - h, b.maxZ - h)
  // A crossing runs from the sidewalk on one side of the road to the one on the other, down on the asphalt between.
  const e = ROAD_WIDTH / 2 - h
  for (const c of layout.crosswalks) {
    const [dx, dz] = c.axis === 'z' ? [e, 0] : [0, e]
    segs.push(
      { x0: c.x - dx, y0: y, z0: c.z - dz, x1: c.x, y1: 0, z1: c.z, side, kerb: true },
      { x0: c.x, y0: 0, z0: c.z, x1: c.x + dx, y1: y, z1: c.z + dz, side, kerb: true },
    )
  }
  // Street trees stand on the sidewalks, with crowns too low to walk under.
  const avoid = layout.trees
    .filter((t) => t.x > b.minX && t.x < b.maxX && t.z > b.minZ && t.z < b.maxZ)
    .map((t) => ({ x: t.x, z: t.z, r: 1.3 * t.scale }))
  return { segs, avoid }
}

/**
 * The sidewalks of the town's roads where they leave it, out to `len` from the town (or the road's end), each joined to
 * the town's outer sidewalk. At the far end people go `on` across the road to the other sidewalk, or merge onto the
 * middle of the road a little further out, where the surroundings take over.
 */
export function exitWalks(exits: RoadExit[], bounds: TownLayout['bounds'], len: number, s: number, on: 'cross' | 'merge'): WalkSeg[] {
  const side = sideFor(s)
  const y = SIDEWALK_TOP
  const h = SIDEWALK_WIDTH / 2
  const segs: WalkSeg[] = []
  for (const e of exits) {
    const [near, far] = Math.abs(e.from) < Math.abs(e.to) ? [e.from, e.to] : [e.to, e.from]
    const dir = Math.sign(far - near)
    const end = near + dir * Math.min(len, Math.abs(far - near) - 1)
    const [lo, hi] = e.axis === 'z' ? [bounds.minX + h, bounds.maxX - h] : [bounds.minZ + h, bounds.maxZ - h]
    // Points by (across, along, height), where across is the coordinate off the road line.
    const seg = (a0: number, b0: number, y0: number, a1: number, b1: number, y1: number, kerb = false): WalkSeg =>
      e.axis === 'z'
        ? { x0: a0, y0, z0: b0, x1: a1, y1, z1: b1, side, kerb }
        : { x0: b0, y0, z0: a0, x1: b1, y1, z1: a1, side, kerb }
    // A sidewalk that would meet the town's outside its outer sidewalk (on the outer road lines) is left out: the
    // corner there is too tight for a body.
    const sides = [e.at - WALK_OFFSET, e.at + WALK_OFFSET].filter((c) => c >= lo && c <= hi)
    for (const c of sides) {
      segs.push(seg(c, near - dir * h, y, c, near, y), seg(c, near, y, c, end, y))
      if (on === 'merge') segs.push(seg(c, end, y, e.at, end + dir * 1.2, 0))
      else if (sides.length === 2) segs.push(seg(c, end, y, e.at, end, 0, true))
    }
  }
  return segs
}

interface Graph {
  x: number[]; y: number[]; z: number[]
  edges: Array<{ a: number; b: number; len: number; side: number; kerb: boolean; goal: number }>
  adj: number[][] // edges at each node
  main: number[] // the edges of the largest connected piece
}

/** The walks as a graph: pieces split wherever another piece ends on them, without those near an `avoid` spot. */
function walkGraph(walks: Walks, clear: number): Graph {
  const g: Graph = { x: [], y: [], z: [], edges: [], adj: [], main: [] }
  const ids = new Map<string, number>()
  const node = (x: number, y: number, z: number): number => {
    const key = `${Math.round(x * 1000)},${Math.round(z * 1000)}`
    let i = ids.get(key)
    if (i === undefined) {
      i = g.x.length
      ids.set(key, i)
      g.x.push(x)
      g.y.push(y)
      g.z.push(z)
      g.adj.push([])
    }
    return i
  }
  const ends = walks.segs.flatMap((s) => [[s.x0, s.z0], [s.x1, s.z1]])
  for (const s of walks.segs) {
    const dx = s.x1 - s.x0
    const dz = s.z1 - s.z0
    const cuts = [0, 1]
    for (const [x, z] of ends) {
      const f = ((x - s.x0) * dx + (z - s.z0) * dz) / (dx * dx + dz * dz)
      if (f > 1e-6 && f < 1 - 1e-6 && Math.hypot(s.x0 + f * dx - x, s.z0 + f * dz - z) < 1e-3) cuts.push(f)
    }
    cuts.sort((p, q) => p - q)
    for (let i = 0; i + 1 < cuts.length; i++) {
      const [f0, f1] = [cuts[i], cuts[i + 1]]
      if (f1 - f0 < 1e-6) continue
      const [xa, za, xb, zb] = [s.x0 + f0 * dx, s.z0 + f0 * dz, s.x0 + f1 * dx, s.z0 + f1 * dz]
      if (walks.avoid.some((p) => toSegment(p.x, p.z, xa, za, xb, zb) < p.r + clear + s.side)) continue
      const a = node(xa, s.y0 + f0 * (s.y1 - s.y0), za)
      const b = node(xb, s.y0 + f1 * (s.y1 - s.y0), zb)
      g.adj[a].push(g.edges.length)
      g.adj[b].push(g.edges.length)
      g.edges.push({ a, b, len: Math.hypot(xb - xa, zb - za), side: s.side, kerb: !!s.kerb, goal: s.goal ?? 1 })
    }
  }
  // People start only on the largest connected piece, so every round can wander and come home.
  const piece = new Int32Array(g.x.length).fill(-1)
  let best = -1
  let bestLen = 0
  for (let i = 0; i < g.x.length; i++) {
    if (piece[i] >= 0) continue
    let len = 0
    const stack = [i]
    piece[i] = i
    while (stack.length > 0) {
      for (const e of g.adj[stack.pop()!]) {
        len += g.edges[e].len / 2 // seen from both ends
        for (const v of [g.edges[e].a, g.edges[e].b]) {
          if (piece[v] < 0) {
            piece[v] = i
            stack.push(v)
          }
        }
      }
    }
    if (len > bestLen) [best, bestLen] = [i, len]
  }
  g.main = g.edges.flatMap((e, i) => (piece[e.a] === best ? [i] : []))
  return g
}

function other(g: Graph, e: number, n: number): number {
  return g.edges[e].a === n ? g.edges[e].b : g.edges[e].a
}

function toSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax
  const dz = bz - az
  const f = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)))
  return Math.hypot(ax + f * dx - px, az + f * dz - pz)
}

/** Shortest walks to `home` (Dijkstra): the distance from every node and the edge it takes first. */
function towards(g: Graph, home: number): { dist: Float64Array; via: Int32Array } {
  const dist = new Float64Array(g.x.length).fill(Infinity)
  const via = new Int32Array(g.x.length).fill(-1)
  dist[home] = 0
  const heap: Array<[number, number]> = [[0, home]]
  const swap = (i: number, j: number): void => {
    [heap[i], heap[j]] = [heap[j], heap[i]]
  }
  while (heap.length > 0) {
    const [d, u] = heap[0]
    const last = heap.pop()!
    if (heap.length > 0) {
      heap[0] = last
      for (let i = 0; ;) {
        const l = 2 * i + 1
        const m = l + 1 < heap.length && heap[l + 1][0] < heap[l][0] ? l + 1 : l
        if (m >= heap.length || heap[m][0] >= heap[i][0]) break
        swap(i, m)
        i = m
      }
    }
    if (d > dist[u]) continue
    for (const e of g.adj[u]) {
      const v = other(g, e, u)
      if (d + g.edges[e].len >= dist[v]) continue
      dist[v] = d + g.edges[e].len
      via[v] = e
      heap.push([dist[v], v])
      for (let i = heap.length - 1; i > 0 && heap[(i - 1) >> 1][0] > heap[i][0]; i = (i - 1) >> 1) swap(i, (i - 1) >> 1)
    }
  }
  return { dist, via }
}

/** A random node of the largest piece, picked by how much walk there is next to it times its goal weight. */
function anywhere(g: Graph, rng: () => number): number {
  let pick = rng() * g.main.reduce((a, e) => a + g.edges[e].len * g.edges[e].goal, 0)
  const e = g.main.find((i) => (pick -= g.edges[i].len * g.edges[i].goal) <= 0) ?? g.main[0]
  return rng() < 0.5 ? g.edges[e].a : g.edges[e].b
}

/**
 * A round of about `length` from `home`: on to places picked at random by the shortest way while there is time to
 * get there and back, then wandering without turning back (but at a dead end), then the shortest way home.
 */
function wander(g: Graph, home: number, length: number, rng: () => number): number[] {
  const back = towards(g, home)
  const route: number[] = []
  let cur = home
  let walked = 0
  let to: ReturnType<typeof towards> | null = null
  let goal = -1
  let goals = true
  const fits = (e: number): boolean => walked + g.edges[e].len + back.dist[other(g, e, cur)] <= length
  for (;;) {
    if (goal === cur) goal = -1
    for (let k = 0; goals && goal < 0 && k < 4; k++) {
      const n = anywhere(g, rng)
      const t = towards(g, n)
      if (n !== cur && walked + t.dist[cur] + back.dist[n] <= length) [goal, to] = [n, t]
    }
    goals &&= goal >= 0
    let e = goal >= 0 ? to!.via[cur] : -1
    if (e < 0) {
      const from = route.length > 0 ? route[route.length - 1] : -1
      let opts = g.adj[cur].filter((x) => x !== from && fits(x))
      if (opts.length === 0 && g.adj[cur].length === 1 && from >= 0 && fits(from)) opts = [from]
      if (opts.length === 0) break
      e = opts[Math.floor(rng() * opts.length)]
    }
    walked += g.edges[e].len
    cur = other(g, e, cur)
    route.push(e)
  }
  for (; cur !== home; cur = other(g, back.via[cur], cur)) route.push(back.via[cur])
  return route
}

/** Where people walk round a corner at `n`, coming in along `d1` and going on along `d2`, keeping right of both. */
function corner(n: { x: number; z: number }, d1: { x: number; z: number }, s1: number, d2: { x: number; z: number }, s2: number): Array<{ x: number; z: number }> {
  const a = { x: n.x - d1.z * s1, z: n.z + d1.x * s1 }
  const b = { x: n.x - d2.z * s2, z: n.z + d2.x * s2 }
  const cross = d1.x * d2.z - d1.z * d2.x
  if (Math.abs(cross) > 0.2) {
    const l = ((b.x - a.x) * d2.z - (b.z - a.z) * d2.x) / cross
    return [{ x: a.x + d1.x * l, z: a.z + d1.z * l }]
  }
  // Straight on (stepping across if the sides differ), or turning round: over to the other side.
  return Math.hypot(a.x - b.x, a.z - b.z) < 1e-6 ? [a] : [a, b]
}

const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))

/** The legs of walking `route` (edges from `home`, back to it) at speed 1, starting with a stop. */
function legsOf(g: Graph, home: number, route: number[], s: number, rng: () => number): Leg[] | null {
  const m = route.length
  if (m < 2) return null
  const nodes = [home]
  for (const e of route) nodes.push(other(g, e, nodes[nodes.length - 1]))
  const dirs = route.map((_, i) => {
    const [a, b] = [nodes[i], nodes[i + 1]]
    const l = Math.hypot(g.x[b] - g.x[a], g.z[b] - g.z[a])
    return { x: (g.x[b] - g.x[a]) / l, z: (g.z[b] - g.z[a]) / l }
  })
  // The path's corners, each with how long people stand there first.
  const pts: Array<{ x: number; y: number; z: number; stop: number }> = []
  for (let i = 0; i < m; i++) {
    const j = (i + m - 1) % m
    const [ein, eout] = [g.edges[route[j]], g.edges[route[i]]]
    const n = nodes[i]
    let stop = 0
    if (nodes[j] === nodes[i + 1]) stop = 1 + 2 * rng() // turning round
    else if (eout.kerb && !ein.kerb && rng() < 0.35) stop = 0.6 + 1.4 * rng() // waiting at the kerb
    corner({ x: g.x[n], z: g.z[n] }, dirs[j], ein.side, dirs[i], eout.side).forEach((p, k) => pts.push({ ...p, y: g.y[n], stop: k === 0 ? stop : 0 }))
  }
  const first = Math.max(0, pts.findIndex((p) => p.stop > 0))
  if (pts[first].stop === 0) pts[first].stop = 0.8
  pts.push(...pts.splice(0, first))
  const legs: Leg[] = []
  const leg = (a: (typeof pts)[number], b: (typeof pts)[number], walk: boolean): Leg => ({
    t0: 0, dur: walk ? 0 : a.stop, len: walk ? Math.hypot(b.x - a.x, b.z - a.z) : 0,
    x0: a.x, y0: a.y, z0: a.z, x1: b.x, y1: b.y, z1: b.z,
    yaw: Math.atan2(b.x - a.x, b.z - a.z), turn: 0, prev: 0, next: 0, d0: 0, run: 0, steps: 0,
  })
  pts.forEach((p, k) => {
    const q = pts[(k + 1) % pts.length]
    if (p.stop > 0) legs.push(leg(p, p, false))
    if (Math.hypot(q.x - p.x, q.z - p.z) > 1e-6) legs.push(leg(p, q, true))
  })
  // Headings: a stander faces the way it came and turns to the way it goes on; walking legs turn into each other.
  const walking = legs.filter((l) => l.len > 0)
  legs.forEach((l, k) => {
    const before = legs[(k + legs.length - 1) % legs.length]
    const after = legs[(k + 1) % legs.length]
    if (l.len === 0) {
      const last = walking[(walking.indexOf(after) + walking.length - 1) % walking.length]
      l.yaw = last.yaw
      l.turn = wrap(after.yaw - last.yaw)
    } else {
      if (before.len > 0) l.prev = wrap(l.yaw - before.yaw)
      if (after.len > 0) l.next = wrap(after.yaw - l.yaw)
    }
  })
  // Whole steps in every run, so the feet are together where people stop.
  for (let k = 0; k < legs.length; ) {
    let end = k + 1
    while (end < legs.length && legs[end].len > 0) end++
    const run = legs.slice(k + 1, end)
    const total = run.reduce((a, l) => a + l.len, 0)
    const steps = Math.max(1, Math.round((GAIT * total) / (Math.PI * s)))
    let d0 = 0
    for (const l of run) {
      Object.assign(l, { d0, run: total, steps })
      d0 += l.len
    }
    k = end
  }
  return legs
}

/** A random round for one walker, timed to take PERIOD, or null if it would need an unnatural pace. */
function roundOf(g: Graph, s: number, rng: () => number, home = anywhere(g, rng)): Walker | null {
  const legs = legsOf(g, home, wander(g, home, 0.92 * s * PERIOD, rng), s, rng)
  if (!legs) return null
  const walk = legs.reduce((a, l) => a + l.len, 0)
  const speed = walk / (PERIOD - legs.reduce((a, l) => a + (l.len > 0 ? 0 : l.dur), 0))
  if (speed < SPEED[0] * s || speed > SPEED[1] * s) return null
  let t = 0
  for (const l of legs) {
    if (l.len > 0) l.dur = l.len / speed
    l.t0 = t
    t += l.dur
  }
  return {
    legs, period: PERIOD, phase: rng() * PERIOD, speed, s,
    shirt: Math.floor(rng() * PAL.bgShirt.length), pants: Math.floor(rng() * PAL.bgPants.length), skin: Math.floor(rng() * SKINS.length),
  }
}

/** Where a walker is at animation time `t` (seconds): heading, step bob and leg swing. Writes into `out`. */
export function walkerPose(w: Walker, t: number, out: WalkerPose = { x: 0, y: 0, z: 0, yaw: 0, lift: 0, swing: 0 }): WalkerPose {
  const u = (((t + w.phase) % w.period) + w.period) % w.period
  let lo = 0
  for (let hi = w.legs.length - 1; lo < hi; ) {
    const mid = (lo + hi + 1) >> 1
    if (w.legs[mid].t0 <= u) lo = mid
    else hi = mid - 1
  }
  const l = w.legs[lo]
  const f = Math.min(1, (u - l.t0) / l.dur)
  out.x = l.x0 + (l.x1 - l.x0) * f
  out.y = l.y0 + (l.y1 - l.y0) * f
  out.z = l.z0 + (l.z1 - l.z0) * f
  if (l.len === 0) {
    out.yaw = l.yaw + l.turn * THREE.MathUtils.smoothstep(u - l.t0, Math.max(0, l.dur - TURN), l.dur)
    out.lift = out.swing = 0
    return out
  }
  const d = f * l.len
  const c = Math.min(CORNER * w.s, l.len / 2)
  out.yaw = l.yaw - (l.prev / 2) * Math.max(0, 1 - d / c) + (l.next / 2) * Math.max(0, 1 - (l.len - d) / c)
  const step = Math.sin((Math.PI * l.steps * (l.d0 + d)) / l.run)
  out.swing = SWING * step
  out.lift = BOB * w.s * Math.abs(step)
  return out
}

/** Positions and headings over one period, every DT seconds. */
function track(w: Walker): Float32Array {
  const n = Math.round(w.period / DT)
  const out = new Float32Array(3 * n)
  const p: WalkerPose = { x: 0, y: 0, z: 0, yaw: 0, lift: 0, swing: 0 }
  for (let k = 0; k < n; k++) {
    walkerPose(w, k * DT, p)
    out[3 * k] = p.x
    out[3 * k + 1] = p.z
    out[3 * k + 2] = p.yaw
  }
  return out
}

/** Whether two tracks ever come closer than `near`, other than passing on opposite sides at least `pass` apart. */
function clash(a: Float32Array, b: Float32Array, near: number, pass: number): boolean {
  for (let k = 0; k < a.length; k += 3) {
    const d2 = (a[k] - b[k]) ** 2 + (a[k + 1] - b[k + 1]) ** 2
    if (d2 >= near * near) continue
    if (Math.cos(a[k + 2] - b[k + 2]) < -0.9 && d2 >= pass * pass) continue
    return true
  }
  return false
}

/**
 * Up to `count` walkers on `walks`, each on a round of its own that never bumps into the others', while they fit. The
 * first rounds start from the walks nearest `homes` (spots that should always see someone), the others anywhere.
 */
export function planWalkers(walks: Walks, count: number, s: number, rng: () => number, homes: Array<{ x: number; z: number }> = []): Walker[] {
  const walkers: Walker[] = []
  if (count === 0) return walkers
  const g = walkGraph(walks, (BODY / 2) * s)
  if (g.main.length === 0) return walkers
  const tracks: Float32Array[] = []
  const near = (BODY + 0.25) * s
  const pass = 2 * sideFor(s) - 0.05
  const place = (w: Walker | null): boolean => {
    const tr = w && track(w)
    if (!w || !tr || tracks.some((o) => clash(tr, o, near, pass))) return false
    walkers.push(w)
    tracks.push(tr)
    return true
  }
  const ends = [...new Set(g.main.flatMap((e) => [g.edges[e].a, g.edges[e].b]))]
  for (const p of homes.slice(0, count)) {
    const home = ends.reduce((a, n) => (Math.hypot(g.x[n] - p.x, g.z[n] - p.z) < Math.hypot(g.x[a] - p.x, g.z[a] - p.z) ? n : a))
    for (let k = 0; k < TRIES && !place(roundOf(g, s, rng, home)); k++);
  }
  for (let k = 0; walkers.length < count && k < TRIES; k++) if (place(roundOf(g, s, rng))) k = -1
  return walkers
}

/** The walkers of one plan as instanced copies of the town's people: torso, head, arms and legs, posed every frame. */
export class WalkerMeshes {
  readonly group = new THREE.Group()
  // Not the surroundings' material (tinted or greyed at dusk): in town they must look like the town's people.
  private readonly mat = makeVoxelMaterial()
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
  private readonly pose: WalkerPose = { x: 0, y: 0, z: 0, yaw: 0, lift: 0, swing: 0 }

  constructor(private readonly walkers: Walker[]) {
    // The material reads vertex colours and `sway` (0: people stand still in the wind).
    const parts = new PersonParts()
    const white = new THREE.Color(1, 1, 1)
    const head = parts.head(0, HAIR)
    head.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(head.getAttribute('position').count), 1))
    const n = walkers.length
    this.torsos = new THREE.InstancedMesh(paint(parts.torso, white), this.mat, n)
    this.heads = new THREE.InstancedMesh(head, this.mat, n)
    this.arms = new THREE.InstancedMesh(paint(parts.arm, white), this.mat, 2 * n)
    this.legs = new THREE.InstancedMesh(paint(parts.leg, white), this.mat, 2 * n)
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
      mesh.castShadow = true
      this.group.add(mesh)
    }
  }

  /** Every frame while the clock runs: no allocations. */
  update(t: number): void {
    for (let i = 0; i < this.walkers.length; i++) {
      const w = this.walkers[i]
      const pose = walkerPose(w, t, this.pose)
      this.body.compose(this.p.set(pose.x, pose.y + pose.lift, pose.z), this.q.setFromAxisAngle(this.up, pose.yaw), this.size.setScalar(w.s))
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

  /** The meshes' geometry goes with the surroundings' content; this frees the material. */
  dispose(): void {
    this.mat.dispose()
  }

  /** Instance `i` of `mesh`: hung from (x, y) of the current body and turned `angle` about its X axis. */
  private place(mesh: THREE.InstancedMesh, i: number, x: number, y: number, angle: number): void {
    mesh.setMatrixAt(i, this.m.multiplyMatrices(this.body, this.joint.makeRotationX(angle).setPosition(x, y, 0)))
  }
}
