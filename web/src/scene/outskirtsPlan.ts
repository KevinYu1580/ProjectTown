// The countryside around the town ("outskirts") as plain data, so placement can be tested. The town stands on a low
// terrace (its verge garden, an avenue and a stone wall with gates); below it lie patchwork fields cut by a winding
// river with two bridges, a railway with a tunnel at each end, dirt lanes from the gates to a few farms, windmills,
// woods and a pond, and a ring of hills toward the plate edge. It reaches past the frame edges of the default view at
// every orbit angle and is deterministic for a layout and seed.
import { fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'
import { FIT_PITCH, FOV_DEG, TARGET_HEIGHT, VIEW_SHIFT, fitDistance } from './cameraMath'
import { VERGE_W, type TownLayout } from './layout'

const DEG = Math.PI / 180
/** Tallest building style (the clock tower, 18.8) rounded up: the view is sized for the tallest possible town. */
export const MAX_STYLE_HEIGHT = 19
/** Widest viewport whose default view must be filled (16:10 and 3:2 are narrower, so they see less). */
export const WIDEST_ASPECT = 16 / 9
/** The town's terrace reaches this far past its bounds: the verge garden, then an avenue and a wall on its edge. */
export const TERRACE_W = VERGE_W + 3.6
/** Top of the countryside ground (the plate). */
export const COUNTRY_Y = -0.5
/** Top of the terrace grass (the street's verge and town trees stand on it); the town's paving is at about 0. */
export const TERRACE_Y = -0.05
/** Grass kept clear around the terrace. */
export const CLEAR = 3
const LANE_W = 3.2 // dirt lane width at lot scale >= 0.8
export const RAMP = 5 // a lane slopes down from the terrace over this length
export const BANK = 1.1 // sand bank on each side of the river
const RAIL_HALF = 1.4 // ballast half width at lot scale 1
export const LEVEL_H = 1.8 // hill contour step
const HILL_IN = 0.86 // hills begin this fraction of the view reach out
const PLATE_K = 1.22 // plate half size, in view reaches
const GAP = 1.3 // grass between neighbouring fields
export const RIPARIAN = 2.6 // grass between a river bank and the fields
const RAIL_CLEAR = 2.6 // grass between the ballast and the fields
const STRIP = 4 // fields along the river are cut into strips this deep, each trimmed to the bank
const MIN_PIECE = 3
/** Seconds of animation clock a frozen scene shows. */
export const FROZEN_T = 41.3
/** Locomotive and coach lengths at lot scale 1; speed in m/s; the train waits in a tunnel between passes. */
export const TRAIN = { loco: 4, coach: 4.4, gap: 0.3, coaches: 3, speed: 7, wait: 75 }
export const CAP = { trees: 1500, animals: 90, bales: 60 }
// Software rasterisers (CI): flat fields, the trees nearest the town, no animals, bales, hedgerows or tractors.
export const LITE_CAP = { trees: 140 }

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export type Facing = 'x+' | 'x-' | 'z+' | 'z-'
export type Lod = 0 | 1 | 2
export type Crop =
  | 'wheat' | 'barley' | 'rapeseed' | 'lavender' | 'sunflower' | 'tulips' | 'vegetables' | 'ploughed'
  | 'hay' | 'pasture' | 'orchard' | 'wood' | 'pond' | 'meadow'
export type TreeKind = 'round' | 'cone' | 'fruit' | 'poplar' | 'willow'

/** Height of a field above the countryside ground, per crop (woods stand on the ground itself). */
export const FIELD_H: Record<Crop, number> = {
  wheat: 0.24, barley: 0.22, rapeseed: 0.24, lavender: 0.18, sunflower: 0.18, tulips: 0.16, vegetables: 0.14,
  ploughed: 0.1, hay: 0.16, pasture: 0.14, orchard: 0.12, wood: 0, pond: 0.1, meadow: 0.05,
}

/** A patch of the patchwork; rows run along X when `alongX`. */
export interface Field extends Rect { crop: Crop; alongX: boolean; v: number; lod: Lod }
/** Dirt lane; `ramp` names the end that climbs onto the terrace at a gate (none where a bridge leaves the gate). */
export interface Lane extends Rect { axis: 'x' | 'z'; ramp?: 'x0' | 'x1' | 'z0' | 'z1' }
/** Opening in the terrace wall where a town road leaves as a lane (or over the river bridge). */
export interface Gate { x: number; z: number; axis: 'x' | 'z' }
/** River centreline: x at z = z0 + i * step; the water is 2 * half wide. */
export interface River { z0: number; step: number; xs: number[]; half: number }
/** Rail bridge: the span over the river. Road bridge: from the terrace gate over the river, then a ramp down to its lane. */
export interface Bridge extends Rect { kind: 'road' | 'rail' }
/** Straight track along X at `z` between the tunnel portals at x0 and x1. */
export interface Rail { z: number; x0: number; x1: number; half: number }
/** The train: `len` long, through the tunnels and back every `period` seconds (direction alternates). */
export interface Train { z: number; x0: number; x1: number; len: number; speed: number; period: number; phase: number; scale: number }
/** Farmyard; its entrance faces `facing`. */
export interface Farm extends Rect { facing: Facing; v: number; silo: boolean; lights: number }
/** Windmill on a low mound; sails turn at `speed` rad/s from `phase`, facing the default camera. */
export interface Windmill { x: number; z: number; s: number; mound: number; phase: number; speed: number }
/** Stepped hill: `levels` contour tiers shrinking from radius `r`. */
export interface Hill { x: number; z: number; r: number; levels: number; kind: 'grass' | 'wood' | 'pasture'; v: number }
/** Earth block that hides the train beyond a portal (`portal` is the x of its open face). */
export interface Tunnel extends Rect { portal: number; levels: number }
export interface Pond { x: number; z: number; rx: number; rz: number }
export interface Tree { x: number; y: number; z: number; s: number; kind: TreeKind; v: number; lod: Lod }
export interface Animal { x: number; y: number; z: number; kind: 'sheep' | 'cow'; facing: Facing; s: number }
export interface Bale { x: number; y: number; z: number; s: number }
/** Closed loop along lane or field centrelines: a rectangle with rounded corners. */
export interface Route { rect: Rect; r: number; length: number }
export interface Tractor { route: Route; s0: number; speed: number; scale: number; color: number }

export interface OutskirtsPlan {
  lite: boolean
  scale: number // lot scale: farm buildings, trees, the train and tractors follow it
  reach: number // radius around the view target that the default view can show
  plate: Rect
  terrace: Rect
  gates: Gate[]
  lanes: Lane[]
  river: River
  bridges: Bridge[]
  rail: Rail
  tunnels: Tunnel[]
  train: Train
  fields: Field[]
  hedges: Rect[]
  ponds: Pond[]
  farms: Farm[]
  windmills: Windmill[]
  hills: Hill[]
  trees: Tree[]
  animals: Animal[]
  bales: Bale[]
  tractors: Tractor[]
  glows: Array<{ x: number; z: number }> // firefly spots over the river and the pond
}

/**
 * How far from the view target the default view (zoom 1, pitch FIT_PITCH, any azimuth) can see the ground: the
 * distance to the farthest frame corner's ground point, for the tallest possible town of this layout.
 */
export function viewReach(layout: TownLayout, aspect = WIDEST_ASPECT): number {
  const tallest = Math.max(6, MAX_STYLE_HEIGHT * layout.lotScale) + 4
  const dist = fitDistance(layout.bounds, tallest, aspect)
  const ty = tallest * TARGET_HEIGHT
  const p = FIT_PITCH * DEG
  const tanV = Math.tan((FOV_DEG * DEG) / 2)
  const tanH = tanV * aspect
  let reach = 0
  for (const sy of [1 - 2 * VIEW_SHIFT.y, -1 - 2 * VIEW_SHIFT.y]) {
    for (const sx of [1 - 2 * VIEW_SHIFT.x, -1 - 2 * VIEW_SHIFT.x]) {
      const down = Math.sin(p) - sy * tanV * Math.cos(p) // per unit of ray: drop, forward run and sideways run
      const run = Math.cos(p) + sy * tanV * Math.sin(p)
      const k = (ty + dist * Math.sin(p)) / down
      reach = Math.max(reach, Math.hypot(k * run - dist * Math.cos(p), k * sx * tanH))
    }
  }
  return reach
}

export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.z0 < b.z1 + pad && b.z0 < a.z1 + pad
}

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad
}

export function grow(r: Rect, d: number): Rect {
  return { x0: r.x0 - d, x1: r.x1 + d, z0: r.z0 - d, z1: r.z1 + d }
}

/** Centreline x of the river at `z` (linear between samples). */
export function riverX(river: River, z: number): number {
  const u = Math.min(river.xs.length - 1, Math.max(0, (z - river.z0) / river.step))
  const i = Math.min(river.xs.length - 2, Math.floor(u))
  return river.xs[i] + (river.xs[i + 1] - river.xs[i]) * (u - i)
}

/** X extent of the water grown by `pad` over the z range [z0, z1]. */
export function riverSpan(river: River, z0: number, z1: number, pad: number): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (let z = z0; ; z = Math.min(z1, z + river.step / 2)) {
    const x = riverX(river, z)
    lo = Math.min(lo, x)
    hi = Math.max(hi, x)
    if (z >= z1) break
  }
  return [lo - river.half - pad, hi + river.half + pad]
}

export interface TrainPose { head: number; dir: 1 | -1; visible: boolean }

/**
 * Where the train's head is at animation time `t` (seconds), its heading (+1 = east) and whether it is out of the
 * tunnels. Writes into `out` (posed every frame).
 */
export function trainPose(train: Train, t: number, out: TrainPose = { head: 0, dir: 1, visible: false }): TrainPose {
  const cycle = t + train.phase
  const k = Math.floor(cycle / train.period)
  const travel = (cycle - k * train.period) * train.speed
  out.dir = k % 2 === 0 ? 1 : -1
  out.visible = travel < train.x1 - train.x0 + train.len
  out.head = out.dir > 0 ? train.x0 + travel : train.x1 - travel
  return out
}

export interface RoutePoint { x: number; z: number; hx: number; hz: number }

/**
 * Point `s` metres along a route's centreline (counter-clockwise from the lower-left straight) and its unit heading.
 * Writes into `out` (no allocation when one is passed: tractors are posed every frame).
 */
export function routePoint(route: Route, s: number, out: RoutePoint = { x: 0, z: 0, hx: 1, hz: 0 }): RoutePoint {
  const { rect, r } = route
  const arc = (Math.PI / 2) * r
  let u = ((s % route.length) + route.length) % route.length
  // Straights along +x, +z, -x, -z (leg i), each followed by a quarter turn to the left.
  for (let i = 0; i < 4; i++) {
    const dx = i === 0 ? 1 : i === 2 ? -1 : 0
    const dz = i === 1 ? 1 : i === 3 ? -1 : 0
    const len = i % 2 === 0 ? rect.x1 - rect.x0 - 2 * r : rect.z1 - rect.z0 - 2 * r
    // Start of the straight and the centre of the turn after it.
    const sx = i === 0 ? rect.x0 + r : i === 1 ? rect.x1 : i === 2 ? rect.x1 - r : rect.x0
    const sz = i === 0 ? rect.z0 : i === 1 ? rect.z0 + r : i === 2 ? rect.z1 : rect.z1 - r
    const cx = i === 0 || i === 1 ? rect.x1 - r : rect.x0 + r
    const cz = i === 0 || i === 3 ? rect.z0 + r : rect.z1 - r
    if (u <= len) {
      out.x = sx + dx * u
      out.z = sz + dz * u
      out.hx = dx
      out.hz = dz
      return out
    }
    u -= len
    if (u <= arc || i === 3) {
      // Quarter turn about (cx, cz): the heading angle grows by u / r; the point sits at (hz, -hx) * r from the centre.
      const a = Math.atan2(dz, dx) + Math.min(u, arc) / r
      out.hx = Math.cos(a)
      out.hz = Math.sin(a)
      out.x = cx + out.hz * r
      out.z = cz - out.hx * r
      return out
    }
    u -= arc
  }
  return out
}

/** Where a tractor is at animation time `t` (seconds) and its yaw. Writes into `out`. */
export function tractorPose(tr: Tractor, t: number, out = { x: 0, z: 0, yaw: 0 }): { x: number; z: number; yaw: number } {
  const p = routePoint(tr.route, tr.s0 + tr.speed * t, scratch)
  out.x = p.x
  out.z = p.z
  out.yaw = Math.atan2(p.hx, p.hz)
  return out
}

const scratch: RoutePoint = { x: 0, z: 0, hx: 1, hz: 0 }
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const smooth = (lo: number, hi: number, v: number): number => {
  const k = clamp((v - lo) / (hi - lo), 0, 1)
  return k * k * (3 - 2 * k)
}
const centre = (r: Rect): { x: number; z: number } => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 })
const lodOf = (d: number, reach: number): Lod => (d < 0.5 * reach ? 0 : d < 0.8 * reach ? 1 : 2)
const square = (x: number, z: number, h: number): Rect => ({ x0: x - h, x1: x + h, z0: z - h, z1: z + h })

const usable = (r: Rect): boolean => Math.min(r.x1 - r.x0, r.z1 - r.z0) >= MIN_PIECE
// Ground kept by a set of pieces, counting thin strips for less (they lose most of their width to the field gaps).
const area = (list: Rect[]): number =>
  list.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0) * Math.min(1, Math.min(r.x1 - r.x0, r.z1 - r.z0) / 8), 0)

/** `a` minus `b` as up to four usable pieces: cut along X or along Z, whichever keeps more useful ground. */
function subtract(a: Rect, b: Rect): Rect[] {
  if (!overlaps(a, b)) return [a]
  const x0 = Math.max(a.x0, b.x0)
  const x1 = Math.min(a.x1, b.x1)
  const z0 = Math.max(a.z0, b.z0)
  const z1 = Math.min(a.z1, b.z1)
  const rows = [
    { x0: a.x0, x1: a.x1, z0: a.z0, z1: b.z0 }, { x0: a.x0, x1: a.x1, z0: b.z1, z1: a.z1 },
    { x0: a.x0, x1: b.x0, z0, z1 }, { x0: b.x1, x1: a.x1, z0, z1 },
  ].filter(usable)
  const cols = [
    { x0: a.x0, x1: b.x0, z0: a.z0, z1: a.z1 }, { x0: b.x1, x1: a.x1, z0: a.z0, z1: a.z1 },
    { x0, x1, z0: a.z0, z1: b.z0 }, { x0, x1, z0: b.z1, z1: a.z1 },
  ].filter(usable)
  return area(cols) > area(rows) ? cols : rows
}

/** Recursive split of `r` into fields no longer than `maxAt` on either side (cuts snapped to half metres). */
function split(r: Rect, maxAt: (r: Rect) => number, rng: () => number, out: Rect[]): void {
  const w = r.x1 - r.x0
  const d = r.z1 - r.z0
  if (Math.max(w, d) <= maxAt(r)) {
    out.push(r)
    return
  }
  const acrossX = w > 1.25 * d ? true : d > 1.25 * w ? false : rng() < 0.5
  const len = acrossX ? w : d
  const cut = Math.round((0.32 + 0.36 * rng()) * len * 2) / 2
  if (acrossX) {
    split({ ...r, x1: r.x0 + cut }, maxAt, rng, out)
    split({ ...r, x0: r.x0 + cut }, maxAt, rng, out)
  } else {
    split({ ...r, z1: r.z0 + cut }, maxAt, rng, out)
    split({ ...r, z0: r.z0 + cut }, maxAt, rng, out)
  }
}

const CROPS: Crop[] = ['wheat', 'barley', 'rapeseed', 'lavender', 'sunflower', 'tulips', 'vegetables', 'ploughed', 'hay', 'pasture', 'orchard', 'wood']

export function planOutskirts(layout: TownLayout, opts: { seed: number; lite: boolean }): OutskirtsPlan {
  const { cols, rows, pitch, lotScale: s, bounds: b } = layout
  const reach = viewReach(layout)
  const P = Math.ceil(PLATE_K * reach)
  const plate: Rect = { x0: -P, x1: P, z0: -P, z1: P }
  const t: Rect = { x0: b.minX - TERRACE_W, x1: b.maxX + TERRACE_W, z0: b.minZ - TERRACE_W, z1: b.maxZ + TERRACE_W }
  const depth = t.z1 - t.z0
  const rng = createRng(fnv1a32(`outskirts:${opts.seed}:${cols}x${rows}`))
  const k = Math.max(s, 0.8) // widths that must stay readable in large towns
  const laneW = LANE_W * k
  const farmW = 18 * s // farmyard along its entrance side, and deep
  const farmD = 15 * s

  // Gates: the middle road lines leave the terrace to the west, east and south.
  const xLines = Array.from({ length: cols + 1 }, (_, i) => (i - cols / 2) * pitch)
  const zLines = Array.from({ length: rows + 1 }, (_, i) => (i - rows / 2) * pitch)
  const xs = xLines[Math.floor(cols / 2)]
  const zw = zLines[Math.floor(rows / 2)]
  const ze = zLines[Math.ceil(rows / 2)]
  const gates: Gate[] = [{ x: t.x0, z: zw, axis: 'x' }, { x: t.x1, z: ze, axis: 'x' }, { x: xs, z: t.z1, axis: 'z' }]

  // River: hugs the east side of the terrace, swings away to the north-east and the south-east with a gentle
  // meander, and runs from plate edge to plate edge. Never closer to the town than at the hug.
  const half = 3 + 0.004 * reach
  const X0 = t.x1 + CLEAR + 1.5 + BANK + half
  const za = t.z0 - 4
  const zb = t.z0 + 0.6 * depth
  const soft = (d: number): number => (d > 0 ? 26 * (Math.sqrt(1 + (d / 26) ** 2) - 1) : 0)
  const amp = 1.5 + 0.025 * reach
  const wave = (2 * Math.PI) / Math.max(60, 0.45 * reach)
  const phi = rng() * Math.PI * 2
  const xs0: number[] = []
  for (let z = plate.z0; z <= plate.z1 + 1e-6; z += 1) {
    const away = 0.55 * soft(za - z) + 0.4 * soft(z - zb)
    xs0.push(X0 + away + Math.min(amp, 0.6 * away) * Math.sin(z * wave + phi))
  }
  const river: River = { z0: plate.z0, step: 1, xs: xs0, half }

  // Railway north of the town; it enters the hills through a tunnel at each end.
  const railHalf = RAIL_HALF * k
  const zr = t.z0 - CLEAR - clamp(0.08 * reach, 8, 18) - railHalf
  const hillIn = HILL_IN * reach
  const portal = Math.sqrt(Math.max(0, hillIn ** 2 - zr ** 2)) - 2
  const rail: Rail = { z: zr, x0: -portal, x1: portal, half: railHalf }
  const len = (TRAIN.loco + TRAIN.coaches * (TRAIN.coach + TRAIN.gap)) * s
  const tunnelLevels = 3
  const tunnels: Tunnel[] = [-1, 1].map((sg) => {
    const x0 = sg < 0 ? -P : portal
    const x1 = sg < 0 ? -portal : P
    return { x0, x1, z0: zr - 7 * k, z1: zr + 7 * k, portal: sg * portal, levels: tunnelLevels }
  })
  const speed = TRAIN.speed
  const period = (2 * portal + len) / speed + TRAIN.wait
  // A frozen scene shows the train heading west just past the middle of the line, where the default view sees it.
  const travel0 = portal - 0.3 * -zr + len / 2
  const train: Train = { z: zr, x0: -portal, x1: portal, len, speed, period, phase: period + travel0 / speed - FROZEN_T, scale: s }

  const [rx0, rx1] = riverSpan(river, zr - railHalf - 0.5, zr + railHalf + 0.5, BANK + 0.5)
  const bridges: Bridge[] = [{ x0: rx0, x1: rx1, z0: zr - railHalf - 0.5, z1: zr + railHalf + 0.5, kind: 'rail' }]

  // Lanes from the gates to three farms; the east lane crosses the river.
  const lanes: Lane[] = []
  const farms: Farm[] = []
  const farm = (r: Rect, facing: Facing): void => {
    farms.push({ ...r, facing, v: rng(), silo: farms.length !== 1, lights: 1 + Math.floor(rng() * 3) })
  }
  const lw = clamp(0.2 * reach, 16, 40)
  lanes.push({ x0: t.x0 - lw, x1: t.x0, z0: zw - laneW / 2, z1: zw + laneW / 2, axis: 'x', ramp: 'x1' })
  farm({ x0: t.x0 - lw - farmD, x1: t.x0 - lw, z0: zw - 0.35 * farmW, z1: zw + 0.65 * farmW }, 'x+')
  // East: the river runs close by, so the road leaves the gate straight onto a stone bridge, then on as a lane.
  const rz0 = ze - laneW / 2 - 0.35
  const rz1 = ze + laneW / 2 + 0.35
  const road: Bridge = { x0: t.x1, x1: riverSpan(river, rz0, rz1, BANK + 0.5)[1] + RAMP, z0: rz0, z1: rz1, kind: 'road' }
  bridges.push(road)
  const fe = road.x1 + Math.max(6, 0.06 * reach)
  lanes.push({ x0: road.x1, x1: fe, z0: ze - laneW / 2, z1: ze + laneW / 2, axis: 'x' })
  farm({ x0: fe, x1: fe + farmD, z0: ze - 0.65 * farmW, z1: ze + 0.35 * farmW }, 'x-')
  const ls = clamp(0.22 * reach, 18, 44)
  lanes.push({ x0: xs - laneW / 2, x1: xs + laneW / 2, z0: t.z1, z1: t.z1 + ls, axis: 'z', ramp: 'z0' })
  farm({ x0: xs - 0.6 * farmW, x1: xs + 0.4 * farmW, z0: t.z1 + ls, z1: t.z1 + ls + farmD }, 'z-')

  // Windmills: one beside the town's south-west, where the default view looks past the town, one far off to the
  // north-west beyond the railway. Both face the default camera.
  const windmills: Windmill[] = []
  const mill = (x: number, z: number, mound: number): void => {
    windmills.push({ x, z, s: Math.max(s, 0.75), mound, phase: rng() * Math.PI * 2, speed: 0.32 + 0.1 * rng() })
  }
  mill(t.x0 - CLEAR - 7.5, t.z1 - 0.15 * depth, 6)
  mill(-0.42 * reach, Math.min(-0.45 * reach, zr - railHalf - RAIL_CLEAR - 13), 8)

  // Fields: the plate minus the town, the railway, lanes, farms and windmill mounds, split into a patchwork that grows
  // coarser with distance, then trimmed to the river banks. Past the hill line they are plain meadow under the hills.
  const blocks: Rect[] = [
    { x0: t.x0 - CLEAR, x1: t.x1 + CLEAR, z0: t.z0 - CLEAR, z1: t.z1 + CLEAR },
    { x0: plate.x0, x1: plate.x1, z0: zr - railHalf - RAIL_CLEAR, z1: zr + railHalf + RAIL_CLEAR },
    ...lanes.map((l) => grow(l, 1.4)),
    ...bridges.map((br) => grow(br, 1.4)),
    ...farms.map((f) => grow(f, 2)),
    ...windmills.map((w) => square(w.x, w.z, w.mound + 2)),
    ...tunnels,
  ]
  let pieces: Rect[] = [plate]
  for (const o of blocks) pieces = pieces.flatMap((p) => subtract(p, o))
  const base = clamp(0.19 * reach, 16, 40)
  const maxAt = (r: Rect): number => {
    const c = centre(r)
    return base * (1 + 0.9 * smooth(0.35 * reach, 0.95 * reach, Math.hypot(c.x, c.z))) * (0.8 + 0.4 * rng())
  }
  const leaves: Rect[] = []
  for (const p of pieces) split(p, maxAt, rng, leaves)
  const plots = leaves
    .map((r) => grow(r, -GAP / 2))
    .filter((r) => Math.min(r.x1 - r.x0, r.z1 - r.z0) >= MIN_PIECE)
    .map((r): Field => {
      const c = centre(r)
      const far = Math.hypot(c.x, c.z) > hillIn + 4
      return { ...r, crop: far ? 'meadow' : 'wheat', alongX: rng() < 0.5, v: rng(), lod: lodOf(Math.hypot(c.x, c.z), reach) }
    })
  assignCrops(plots, { t, reach, windmill: windmills[0], farms, rng })

  // A pond in a field west of the town, orchards to its south-east.
  const ponds: Pond[] = []
  const pondField = nearest(plots, t.x0 - 0.12 * reach, t.z0 + 0.25 * depth, (f) => f.x1 - f.x0 >= 15 && f.z1 - f.z0 >= 12 && f.crop !== 'meadow' && !overlaps(f, riverBand(river, f, BANK + RIPARIAN)))
  if (pondField) {
    pondField.crop = 'pond'
    const c = centre(pondField)
    ponds.push({ x: c.x, z: c.z, rx: Math.min(9, (pondField.x1 - pondField.x0) / 2 - 3), rz: Math.min(6.5, (pondField.z1 - pondField.z0) / 2 - 3) })
  }
  for (let i = 0; i < 2; i++) {
    const f = nearest(plots, t.x1 - 0.25 * (t.x1 - t.x0), t.z1 + 0.14 * reach, (q) => q.crop !== 'meadow' && q.crop !== 'pond' && q.crop !== 'orchard' && (q.x1 - q.x0) * (q.z1 - q.z0) >= 120)
    if (f) f.crop = 'orchard'
  }

  // Trim to the river: fields across it become strips on either bank, each cut to the bank.
  const fields: Field[] = []
  const inner = new Set<Field>() // strips below the first of their field: no hedge between them
  for (const f of plots) {
    const [lo, hi] = riverSpan(river, f.z0, f.z1, BANK + RIPARIAN)
    if (f.x1 <= lo || f.x0 >= hi) {
      fields.push(f)
      continue
    }
    const n = Math.max(1, Math.ceil((f.z1 - f.z0) / STRIP))
    for (let i = 0; i < n; i++) {
      const z0 = f.z0 + ((f.z1 - f.z0) * i) / n
      const z1 = f.z0 + ((f.z1 - f.z0) * (i + 1)) / n
      const [l, h] = riverSpan(river, z0, z1, BANK + RIPARIAN)
      for (const piece of [{ ...f, z0, z1, x1: Math.min(f.x1, l) }, { ...f, z0, z1, x0: Math.max(f.x0, h) }]) {
        if (piece.x1 - piece.x0 < MIN_PIECE + 1) continue
        fields.push(piece)
        if (i > 0) inner.add(piece)
      }
    }
  }

  const trees: Tree[] = []
  const animals: Animal[] = []
  const bales: Bale[] = []
  const hedges: Rect[] = []
  const tree = (x: number, y: number, z: number, sc: number, kind: TreeKind): void => {
    trees.push({ x, y, z, s: sc, kind, v: rng(), lod: lodOf(Math.hypot(x, z), reach) })
  }
  const clearOf = (r: Rect): boolean => !blocks.some((o) => overlaps(r, o)) && !overlaps(r, riverBand(river, r, BANK + 0.4))

  // Terrace avenue: round trees on the strip between the verge and the wall, open at the gates.
  const av = TERRACE_W - 1.9
  const avenue = (x: number, z: number): void => {
    const atGate = gates.some((g) => (g.axis === 'x' ? Math.abs(z - g.z) < 4.6 && Math.abs(x - g.x) < 3 : Math.abs(x - g.x) < 4.6 && Math.abs(z - g.z) < 3))
    if (atGate || rng() < 0.12) return
    trees.push({ x, y: TERRACE_Y, z, s: 0.95 + 0.15 * rng(), kind: 'round', v: 0.2 + 0.8 * rng(), lod: 0 })
  }
  const ax0 = b.minX - av
  const az0 = b.minZ - av
  const aw = b.maxX - b.minX + 2 * av
  const ad = b.maxZ - b.minZ + 2 * av
  const nx = Math.round(aw / 5.6)
  const nz = Math.round(ad / 5.6)
  for (let i = 0; i <= nx; i++) for (const z of [az0, az0 + ad]) avenue(ax0 + (aw * i) / nx, z)
  for (let i = 1; i < nz; i++) for (const x of [ax0, ax0 + aw]) avenue(x, az0 + (ad * i) / nz)

  // Field furniture: orchards, woods, the pond's trees, grazing animals, hay bales, and hedgerows on some edges.
  for (const f of fields) {
    const w = f.x1 - f.x0
    const d = f.z1 - f.z0
    const y = COUNTRY_Y + FIELD_H[f.crop]
    const fr = createRng(fnv1a32(`field:${opts.seed}:${f.x0.toFixed(1)},${f.z0.toFixed(1)}`))
    if (f.crop === 'orchard') {
      const step = 3.6 * k
      for (let x = f.x0 + step / 2; x < f.x1 - 1; x += step) for (let z = f.z0 + step / 2; z < f.z1 - 1; z += step) tree(x, y, z, s * (0.68 + 0.1 * fr()), 'fruit')
    } else if (f.crop === 'wood') {
      const step = 3.3 * k
      for (let x = f.x0 + 1.4; x < f.x1 - 1.2; x += step) {
        for (let z = f.z0 + 1.4; z < f.z1 - 1.2; z += step) {
          if (fr() < 0.18) continue
          const jx = Math.min(f.x1 - 1.2, x + (fr() - 0.5) * step * 0.7)
          const jz = Math.min(f.z1 - 1.2, z + (fr() - 0.5) * step * 0.7)
          tree(jx, COUNTRY_Y, jz, s * (0.95 + 0.5 * fr()), fr() < 0.45 ? 'cone' : 'round')
        }
      }
    } else if (f.crop === 'pond') {
      const pond = ponds[0]
      for (let i = 0; i < 12; i++) {
        const a = fr() * Math.PI * 2
        const x = pond.x + Math.cos(a) * (pond.rx + 1.6 + fr() * 1.4)
        const z = pond.z + Math.sin(a) * (pond.rz + 1.6 + fr() * 1.4)
        if (inRect(f, x, z, -1)) tree(x, y, z, s * (0.9 + 0.3 * fr()), fr() < 0.45 ? 'willow' : 'round')
      }
    } else if (f.crop === 'pasture') {
      const cows = fr() < 0.4
      const n = Math.round(clamp((w * d) / (cows ? 130 : 75), 2, cows ? 5 : 8))
      for (let i = 0; i < n && w > 5 && d > 5; i++) {
        const facing = (['x+', 'x-', 'z+', 'z-'] as const)[Math.floor(fr() * 4)]
        animals.push({ x: f.x0 + 2 + fr() * (w - 4), y, z: f.z0 + 2 + fr() * (d - 4), kind: cows ? 'cow' : 'sheep', facing, s })
      }
      if (w > 9 && d > 9 && fr() < 0.6) tree(f.x0 + 2.5 + fr() * (w - 5), y, f.z0 + 2.5 + fr() * (d - 5), s * (1.1 + 0.3 * fr()), 'round')
    } else if (f.crop === 'hay') {
      const n = Math.round(clamp((w * d) / 90, 2, 7))
      for (let i = 0; i < n && w > 5 && d > 5; i++) bales.push({ x: f.x0 + 2 + fr() * (w - 4), y, z: f.z0 + 2 + fr() * (d - 4), s })
    }
    // Hedgerows on the north and west edges of some fields, with a tree now and then.
    if (f.crop === 'meadow' || f.crop === 'wood') continue
    const north = { x0: f.x0, x1: f.x1, z0: f.z0 - GAP / 2 - 0.35, z1: f.z0 - GAP / 2 + 0.35 }
    const west = { x0: f.x0 - GAP / 2 - 0.35, x1: f.x0 - GAP / 2 + 0.35, z0: f.z0, z1: f.z1 }
    for (const h of inner.has(f) ? [west] : [north, west]) {
      if (fr() > 0.5 || !clearOf(h)) continue
      hedges.push(h)
      const alongX = h.x1 - h.x0 > h.z1 - h.z0
      const l = alongX ? h.x1 - h.x0 : h.z1 - h.z0
      for (let u = 2.5 + fr() * 4; u < l - 2; u += 5 + fr() * 7) {
        if (fr() < 0.6) tree(alongX ? h.x0 + u : (h.x0 + h.x1) / 2, COUNTRY_Y, alongX ? (h.z0 + h.z1) / 2 : h.z0 + u, s * (1 + 0.35 * fr()), fr() < 0.3 ? 'cone' : 'round')
      }
    }
  }

  // Willows and alders along the river banks, clear of the bridges.
  for (let z = plate.z0 + 4; z < plate.z1 - 4; z += 6 + rng() * 4) {
    for (const sg of [-1, 1]) {
      if (rng() < 0.45) continue
      const x = riverX(river, z) + sg * (half + BANK + 1.3)
      if (bridges.some((br) => inRect(br, x, z, 4)) || Math.hypot(x, z) > hillIn + 6) continue
      if (blocks.some((o) => inRect(o, x, z, 0.8))) continue
      tree(x, COUNTRY_Y, z, s * (1 + 0.3 * rng()), rng() < 0.5 ? 'willow' : 'round')
    }
  }
  // Poplars along the west lane; a few trees behind each farm.
  const wl = lanes[0]
  for (let x = wl.x0 + 3; x < wl.x1 - RAMP - 2; x += 6.5) tree(x, COUNTRY_Y, wl.z1 + 1.6, s * (0.95 + 0.15 * rng()), 'poplar')
  for (const f of farms) {
    const back = f.facing === 'x+' ? { x: f.x0 + 1.5, z: (f.z0 + f.z1) / 2 } : f.facing === 'x-' ? { x: f.x1 - 1.5, z: (f.z0 + f.z1) / 2 } : { x: (f.x0 + f.x1) / 2, z: f.z1 - 1.5 }
    const along = f.facing[0] === 'x'
    for (const o of [-0.38, 0.05, 0.42]) {
      const u = o * (along ? f.z1 - f.z0 : f.x1 - f.x0)
      tree(along ? back.x : back.x + u, COUNTRY_Y, along ? back.z + u : back.z, s * (1.05 + 0.3 * rng()), rng() < 0.3 ? 'cone' : 'round')
    }
  }

  // Hills: rings of stepped mounds from the hill line to the plate edge, clear of the river and the railway (whose
  // tunnels get mounds of their own).
  const hills: Hill[] = []
  for (let ring = 0; ring < 3; ring++) {
    const rAvg = (0.13 + 0.03 * ring) * reach
    const rho = hillIn + rAvg * (0.85 + 1.55 * ring)
    const n = Math.ceil((2 * Math.PI * rho) / (1.25 * rAvg))
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5 * (ring % 2) + 0.3 * (rng() - 0.5)) / n) * Math.PI * 2
      const r = rAvg * (0.8 + 0.45 * rng())
      const d = Math.max(rho + (rng() - 0.5) * 0.06 * reach, hillIn + 0.8 * r)
      const x = Math.cos(a) * d
      const z = Math.sin(a) * d
      if (Math.abs(x) > P + 0.3 * r || Math.abs(z) > P + 0.3 * r) continue
      const foot = square(x, z, r)
      if (overlaps(foot, riverBand(river, foot, BANK + 2)) || Math.abs(z - zr) < r + railHalf + 2) continue
      const levels = Math.min(7, 2 + ring + Math.floor(rng() * 3))
      const roll = rng()
      hills.push({ x, z, r, levels, kind: roll < 0.45 ? 'wood' : roll < 0.7 ? 'pasture' : 'grass', v: rng() })
    }
  }
  for (const tn of tunnels) {
    const r = Math.max(len + 4, 0.11 * reach)
    hills.push({ x: tn.portal + Math.sign(tn.portal) * (r + 0.3), z: zr, r, levels: 4, kind: 'wood', v: rng() })
  }
  // Trees on wooded hills and sheep on pastures, standing on the tier they fall on.
  for (const h of hills) {
    if (h.kind === 'grass') continue
    const hr = createRng(fnv1a32(`hill:${opts.seed}:${h.x.toFixed(1)},${h.z.toFixed(1)}`))
    const step = h.kind === 'wood' ? 3.6 * k : 6 * k
    for (let x = h.x - h.r; x < h.x + h.r; x += step) {
      for (let z = h.z - h.r; z < h.z + h.r; z += step) {
        const px = x + hr() * step * 0.6
        const pz = z + hr() * step * 0.6
        const lv = hillLevel(h, px, pz, 1.2)
        if (lv < 1 || !inRect(plate, px, pz, -2) || tunnels.some((tn) => inRect(tn, px, pz, 1))) continue
        const y = COUNTRY_Y + lv * LEVEL_H
        if (h.kind === 'wood' && hr() < 0.85) tree(px, y, pz, s * (1 + 0.5 * hr()), hr() < 0.6 ? 'cone' : 'round')
        else if (h.kind === 'pasture' && hr() < 0.35) animals.push({ x: px, y, z: pz, kind: 'sheep', facing: hr() < 0.5 ? 'x+' : 'z-', s })
      }
    }
  }

  // Woods on top of the tunnel blocks.
  for (const tn of tunnels) {
    const y = COUNTRY_Y + tn.levels * LEVEL_H
    for (let x = tn.x0 + 2; x < tn.x1 - 2; x += 4.4 * k) {
      for (let z = tn.z0 + 2; z < tn.z1 - 1.5; z += 4.4 * k) if (rng() < 0.65) tree(x + rng(), y, z + rng(), s * (1 + 0.4 * rng()), rng() < 0.6 ? 'cone' : 'round')
    }
  }

  // Tractors working two fields near the town, by day.
  const tractors: Tractor[] = []
  const working = (f: Field) => (f.crop === 'ploughed' || f.crop === 'hay') && f.x1 - f.x0 > 9 && f.z1 - f.z0 > 9
  for (const [ax, az] of [[t.x0 - 0.1 * reach, t.z1 + 0.06 * reach], [t.x1 + 0.12 * reach, t.z0 - 0.02 * reach]]) {
    const f = nearest(fields, ax, az, (q) => working(q) && !tractors.some((tr) => inRect(q, tr.route.rect.x0 + 1, tr.route.rect.z0 + 1)))
    if (!f) continue
    const rect = grow(f, -1.8 * k)
    const r = 1.6 * k
    const length = 2 * (rect.x1 - rect.x0 + rect.z1 - rect.z0) - 8 * r + 2 * Math.PI * r
    tractors.push({ route: { rect, r, length }, s0: rng() * length, speed: 1.3 * k, scale: s, color: Math.floor(rng() * 3) })
  }

  // Fireflies over the river near the town and around the pond.
  const glows: Array<{ x: number; z: number }> = []
  for (let z = t.z0 - 20; z < t.z1 + 20; z += 3.5) glows.push({ x: riverX(river, z) + (rng() - 0.5) * 2 * (half + 1), z })
  for (const p of ponds) for (let i = 0; i < 8; i++) glows.push({ x: p.x + (rng() - 0.5) * 2 * p.rx, z: p.z + (rng() - 0.5) * 2 * p.rz })

  // Caps: the trees nearest the town are the ones on screen most of the time.
  const byNear = <T extends { x: number; z: number }>(list: T[], n: number): T[] =>
    list.length <= n ? list : [...list].sort((a, c) => Math.hypot(a.x, a.z) - Math.hypot(c.x, c.z)).slice(0, n)
  const lite = opts.lite
  return {
    lite,
    scale: s,
    reach,
    plate,
    terrace: t,
    gates,
    lanes,
    river,
    bridges,
    rail,
    tunnels,
    train,
    fields: lite ? fields.map((f) => ({ ...f, lod: 2 as const })) : fields,
    hedges: lite ? [] : hedges,
    ponds,
    farms,
    windmills,
    hills,
    trees: lite ? byNear(trees, LITE_CAP.trees).map((tr) => ({ ...tr, lod: 2 as const })) : byNear(trees, CAP.trees),
    animals: lite ? [] : byNear(animals, CAP.animals),
    bales: lite ? [] : byNear(bales, CAP.bales),
    tractors: lite ? [] : tractors,
    glows,
  }
}

/** The river's water and banks next to `r` (grown by `pad` beyond the water), as a rect. */
function riverBand(river: River, r: Rect, pad: number): Rect {
  const [x0, x1] = riverSpan(river, r.z0, r.z1, pad)
  return { x0, x1, z0: r.z0, z1: r.z1 }
}

/** Index of the highest contour tier of `h` under (x, z), keeping `inset` from its edge; 0 = not on the hill. */
function hillLevel(h: Hill, x: number, z: number, inset = 0): number {
  let level = 0
  for (let i = 0; i < h.levels; i++) {
    const r = hillTierRadius(h, i) - inset
    const arm = 0.62 * r
    const dx = Math.abs(x - h.x)
    const dz = Math.abs(z - h.z)
    if ((dx < r && dz < arm) || (dx < arm && dz < r)) level = i + 1
  }
  return level
}

/** Half size of tier `i` (0 = the bottom one). */
export function hillTierRadius(h: Hill, i: number): number {
  return h.r * (1 - (0.82 * i) / h.levels)
}

function nearest<T extends Rect>(list: T[], x: number, z: number, ok: (f: T) => boolean): T | null {
  let best: T | null = null
  let bd = Infinity
  for (const f of list) {
    if (!ok(f)) continue
    const c = centre(f)
    const d = Math.hypot(c.x - x, c.z - z)
    if (d < bd) {
      bd = d
      best = f
    }
  }
  return best
}

/**
 * Crops by place: flowers and grain around the near windmill, pasture, hay and vegetables by the farms, woods and
 * pasture toward the hills; neighbouring fields avoid the same crop.
 */
function assignCrops(fields: Field[], ctx: { t: Rect; reach: number; windmill: Windmill; farms: Farm[]; rng: () => number }): void {
  const { reach, windmill, farms, rng } = ctx
  const order = fields.filter((f) => f.crop !== 'meadow').sort((a, c) => a.z0 - c.z0 || a.x0 - c.x0)
  const done = new Set<Field>()
  for (const f of order) {
    const c = centre(f)
    const d = Math.hypot(c.x, c.z)
    const nearMill = Math.hypot(c.x - windmill.x, c.z - windmill.z) < 34
    const nearFarm = farms.some((fm) => Math.hypot(c.x - (fm.x0 + fm.x1) / 2, c.z - (fm.z0 + fm.z1) / 2) < 30)
    const far = smooth(0.45 * reach, 0.85 * reach, d)
    const w: Record<string, number> = {
      wheat: 18, barley: 6, rapeseed: 6, lavender: 4, sunflower: 5, tulips: 3, vegetables: 12, ploughed: 7,
      hay: 7, pasture: 12, orchard: 4, wood: 5 + 14 * far,
    }
    if (nearMill) Object.assign(w, { lavender: 16, tulips: 12, wheat: 26, sunflower: 9 })
    if (nearFarm) Object.assign(w, { pasture: 22, hay: 16, vegetables: 16 })
    if (far > 0.5) Object.assign(w, { lavender: 1, tulips: 1, sunflower: 2, pasture: 14 })
    const near = order.filter((o) => done.has(o) && overlaps(o, f, GAP + 0.6)).map((o) => o.crop)
    let crop: Crop = 'wheat'
    for (let tries = 0; tries < 4; tries++) {
      let roll = rng() * CROPS.reduce((a, cr) => a + w[cr], 0)
      crop = CROPS.find((cr) => (roll -= w[cr]) < 0) ?? 'wheat'
      if (!near.includes(crop)) break
    }
    f.crop = crop
    done.add(f)
    // Long fields are ploughed along their length.
    const fw = f.x1 - f.x0
    const fd = f.z1 - f.z0
    if (fw > 1.6 * fd) f.alongX = true
    else if (fd > 1.6 * fw) f.alongX = false
  }
}
