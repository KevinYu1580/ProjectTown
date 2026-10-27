// The background neighbourhood around the town ("outskirts") as plain data, so placement can be tested: the base
// plate, residential lanes continuing the town's street grid, small houses on garden plots, trees, a pond park and
// car loops. It reaches past the frame edges of the default view at every orbit angle, then gives way to a band of
// countryside before the plate edge. Deterministic for a layout and seed.
import { fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'
import { FIT_PITCH, FOV_DEG, TARGET_HEIGHT, VIEW_SHIFT, fitDistance } from './cameraMath'
import { ROAD_WIDTH, SIDEWALK_WIDTH, VERGE_W, type TownLayout } from './layout'
import { PAL } from './palette'

const DEG = Math.PI / 180
/** Tallest building style (the clock tower, 18.8) rounded up: the view is sized for the tallest possible town. */
export const MAX_STYLE_HEIGHT = 19
/** Widest viewport whose default view must be filled (16:10 and 3:2 are narrower, so they see less). */
export const WIDEST_ASPECT = 16 / 9
export const LANE_W = 2.8 // asphalt width of a lane; the town's roads keep their full ROAD_WIDTH across the plate
export const LANE_EDGE = 0.18 // kerb strip on each side of a lane
export const LANE_HALF = LANE_W / 2 + LANE_EDGE
/** Cars keep to the right, this far from the lane centreline. */
export const CAR_OFFSET = 0.72
// The town's roads run on across the plate as asphalt, then a kerb and a sidewalk on each side (street.ts).
export const ASPHALT_HALF = ROAD_WIDTH / 2 - SIDEWALK_WIDTH
export const MAIN_HALF = ASPHALT_HALF + 0.2 + SIDEWALK_WIDTH
// Nothing of the outskirts comes closer than this to the town bounds (the verge is the town's garden).
const VERGE_CLEAR = VERGE_W + 0.5
export const CAP = { houses: 2400, trees: 1600, cars: 34, parked: 36 }
// Software rasterisers (CI): the nearest houses only, no parked cars, a few moving ones.
export const LITE_CAP = { houses: 220, trees: 140, cars: 8, parked: 0 }
const PLOT_TONES = 4
const ROUTE_RADIUS = 1.4 // centreline radius of a car loop's corners
const CAR_SPACING = 30 // average gap between cars in one lane

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export type Facing = 'x+' | 'x-' | 'z+' | 'z-'
export type RoofKind = 'gable' | 'hip' | 'flat'
export type BlockKind = 'homes' | 'terrace' | 'park' | 'allotment' | 'garden' | 'pond'
export type Lod = 0 | 1 | 2

/** Lane centreline: `axis: 'x'` runs along X at z = `at`, `axis: 'z'` along Z at x = `at`. */
export interface Lane { axis: 'x' | 'z'; at: number; from: number; to: number }
/** Which sides of a rect face a street (the others face the town's verge or a neighbouring piece). */
export interface Sides { x0: boolean; x1: boolean; z0: boolean; z1: boolean }
/** Buildable piece of one grid cell (roads and the town's verge excluded). */
export interface Block extends Rect { kind: BlockKind; ring: number; tone: number; roads: Sides }
/**
 * Garden plot of one house: lawn tone, and low hedges on its back edge and on its start edge (the lower coordinate
 * along its row), so neighbouring plots never draw the same edge twice.
 */
export interface Plot extends Rect { tone: number; facing: Facing; back: boolean; start: boolean; lod: Lod }
export interface House {
  x: number
  z: number // footprint centre
  w: number // along the front
  d: number // front to back
  h: number // wall height
  facing: Facing // the side with the door
  roof: RoofKind
  storeys: 1 | 2
  wall: number // index into PAL.bgWall
  roofTone: number // index into PAL.bgRoof
  chimney: boolean
  lights: number // windows lit at night
  attached: boolean // terrace unit: no side windows
  lod: Lod
  v: number // [0, 1): small builder-side variations
  front: number // coordinate of the road edge the front garden runs to (x for x± facing, z for z±)
}
export interface Tree { x: number; z: number; s: number; kind: 'round' | 'cone'; v: number; lod: Lod }
export interface Pond { x: number; z: number; rx: number; rz: number }
/** Closed car loop along lane centrelines: a rectangle with rounded corners, driven both ways. */
export interface Route { rect: Rect; r: number; length: number }
export interface Car { route: number; dir: 1 | -1; s0: number; speed: number; color: number }
export interface ParkedCar { x: number; z: number; yaw: number; color: number }

export interface OutskirtsPlan {
  lite: boolean
  scale: number // house and car scale (follows the town's lot scale)
  reach: number // radius around the view target that the default view can show
  plate: Rect
  hood: Rect // the neighbourhood: inside the outermost lane ring (centrelines)
  lanes: Lane[]
  mains: { x: number[]; z: number[] } // the town's road lines, which run on across the plate (street.ts)
  blocks: Block[]
  plots: Plot[]
  houses: House[]
  trees: Tree[]
  pond: Pond | null
  routes: Route[]
  cars: Car[]
  parked: ParkedCar[]
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

/** World footprint of a house. */
export function footprint(h: Pick<House, 'x' | 'z' | 'w' | 'd' | 'facing'>): Rect {
  const alongX = h.facing[0] === 'z' // the front runs along X
  const hx = (alongX ? h.w : h.d) / 2
  const hz = (alongX ? h.d : h.w) / 2
  return { x0: h.x - hx, x1: h.x + hx, z0: h.z - hz, z1: h.z + hz }
}

export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.z0 < b.z1 + pad && b.z0 < a.z1 + pad
}

/** True if (x, z) lies within the neighbourhood (the town included), grown by `pad`. */
export function inHood(plan: Pick<OutskirtsPlan, 'hood'>, x: number, z: number, pad = 0): boolean {
  const { hood } = plan
  return x > hood.x0 - pad && x < hood.x1 + pad && z > hood.z0 - pad && z < hood.z1 + pad
}

export interface RoutePoint { x: number; z: number; hx: number; hz: number }
export interface CarPose { x: number; z: number; yaw: number }

/**
 * Point `s` metres along a route's centreline (counter-clockwise from the lower-left straight) and its unit heading.
 * Writes into `out` (no allocation when one is passed: cars are posed every frame).
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

const scratch: RoutePoint = { x: 0, z: 0, hx: 1, hz: 0 }

/** Where a car is at animation time `t` (seconds): on its lane, right of the centreline, and its yaw. Writes into `out`. */
export function carPose(route: Route, car: Car, t: number, out: CarPose = { x: 0, z: 0, yaw: 0 }): CarPose {
  const p = routePoint(route, car.s0 + car.dir * car.speed * t, scratch)
  const hx = p.hx * car.dir
  const hz = p.hz * car.dir
  // Right of the heading (y up): (-hz, hx).
  out.x = p.x - hz * CAR_OFFSET
  out.z = p.z + hx * CAR_OFFSET
  out.yaw = Math.atan2(hx, hz)
  return out
}

interface Ctx {
  s: number
  reach: number
  plots: Plot[]
  houses: House[]
  trees: Tree[]
  parked: ParkedCar[]
}

/** `a` minus `b` as up to four pieces; a piece's side faces a street when it is also a side of `a`. */
function subtract(a: Rect, b: Rect): Array<Rect & { roads: Sides }> {
  const sides = (r: Rect): Rect & { roads: Sides } => ({ ...r, roads: { x0: r.x0 === a.x0, x1: r.x1 === a.x1, z0: r.z0 === a.z0, z1: r.z1 === a.z1 } })
  if (!overlaps(a, b)) return [sides(a)]
  const out: Array<Rect & { roads: Sides }> = []
  const z0 = Math.max(a.z0, b.z0)
  const z1 = Math.min(a.z1, b.z1)
  if (b.z0 > a.z0) out.push(sides({ ...a, z1: b.z0 }))
  if (b.z1 < a.z1) out.push(sides({ ...a, z0: b.z1 }))
  if (b.x0 > a.x0) out.push(sides({ x0: a.x0, x1: b.x0, z0, z1 }))
  if (b.x1 < a.x1) out.push(sides({ x0: b.x1, x1: a.x1, z0, z1 }))
  return out
}

const lodOf = (r: number, reach: number): Lod => (r < 0.5 * reach ? 0 : r < 0.8 * reach ? 1 : 2)

export function planOutskirts(layout: TownLayout, opts: { seed: number; lite: boolean }): OutskirtsPlan {
  const { cols, rows, pitch, lotScale: s, bounds } = layout
  const X0 = (cols / 2) * pitch // outermost town road centrelines
  const Z0 = (rows / 2) * pitch
  const reach = viewReach(layout)
  // Lane rings outside the town; the outermost lies beyond the reach so blocks fill the farthest frame corner.
  const kx = Math.max(2, Math.ceil((reach - X0) / pitch + 0.35))
  const kz = Math.max(2, Math.ceil((reach - Z0) / pitch + 0.35))
  const hood: Rect = { x0: -X0 - kx * pitch, x1: X0 + kx * pitch, z0: -Z0 - kz * pitch, z1: Z0 + kz * pitch }
  const band = Math.max(16, 0.12 * Math.max(hood.x1, hood.z1)) // countryside between the last lane and the edge
  const plate: Rect = { x0: hood.x0 - band, x1: hood.x1 + band, z0: hood.z0 - band, z1: hood.z1 + band }

  const laneXs: number[] = []
  const laneZs: number[] = []
  for (let j = 1; j <= kx; j++) laneXs.push(-X0 - j * pitch, X0 + j * pitch)
  for (let j = 1; j <= kz; j++) laneZs.push(-Z0 - j * pitch, Z0 + j * pitch)
  const lanes: Lane[] = [
    ...laneXs.sort((a, b) => a - b).map((x): Lane => ({ axis: 'z', at: x, from: hood.z0, to: hood.z1 })),
    ...laneZs.sort((a, b) => a - b).map((z): Lane => ({ axis: 'x', at: z, from: hood.x0, to: hood.x1 })),
  ]

  // Grid lines (town roads + lanes) and the half width of the road on each.
  const townX = Array.from({ length: cols + 1 }, (_, k) => (k - cols / 2) * pitch)
  const townZ = Array.from({ length: rows + 1 }, (_, k) => (k - rows / 2) * pitch)
  const gx = [...townX, ...laneXs].sort((a, b) => a - b)
  const gz = [...townZ, ...laneZs].sort((a, b) => a - b)
  const halfX = (x: number) => (Math.abs(x) <= X0 + 1e-6 ? MAIN_HALF : LANE_HALF)
  const halfZ = (z: number) => (Math.abs(z) <= Z0 + 1e-6 ? MAIN_HALF : LANE_HALF)
  const verge: Rect = {
    x0: bounds.minX - VERGE_CLEAR, x1: bounds.maxX + VERGE_CLEAR, z0: bounds.minZ - VERGE_CLEAR, z1: bounds.maxZ + VERGE_CLEAR,
  }

  const blocks: Block[] = []
  for (let i = 0; i + 1 < gx.length; i++) {
    for (let j = 0; j + 1 < gz.length; j++) {
      const [cx0, cx1, cz0, cz1] = [gx[i], gx[i + 1], gz[j], gz[j + 1]]
      if (cx0 >= -X0 - 1e-6 && cx1 <= X0 + 1e-6 && cz0 >= -Z0 - 1e-6 && cz1 <= Z0 + 1e-6) continue // a town cell
      const cell: Rect = { x0: cx0 + halfX(cx0), x1: cx1 - halfX(cx1), z0: cz0 + halfZ(cz0), z1: cz1 - halfZ(cz1) }
      const ringX = cx0 >= X0 - 1e-6 ? Math.round((cx0 - X0) / pitch) + 1 : cx1 <= -X0 + 1e-6 ? Math.round((-X0 - cx1) / pitch) + 1 : 0
      const ringZ = cz0 >= Z0 - 1e-6 ? Math.round((cz0 - Z0) / pitch) + 1 : cz1 <= -Z0 + 1e-6 ? Math.round((-Z0 - cz1) / pitch) + 1 : 0
      // Next to the town the verge (the town's own garden) is cut out of the cell.
      for (const b of subtract(cell, verge)) {
        if (b.x1 - b.x0 < 2 * s || b.z1 - b.z0 < 2 * s) continue
        blocks.push({ ...b, kind: 'homes', ring: Math.max(ringX, ringZ), tone: 0 })
      }
    }
  }

  // Pond park on the right of the default view (where the countryside pond used to be), in the nearest block that fits.
  const anchor = { x: bounds.maxX + VERGE_W + 13, z: bounds.minZ - VERGE_W - 9 }
  let pond: Pond | null = null
  let pondBlock: Block | null = null
  for (const b of blocks) {
    const w = b.x1 - b.x0
    const d = b.z1 - b.z0
    if (w < 9 || d < 7 || !(b.roads.x0 && b.roads.x1 && b.roads.z0 && b.roads.z1)) continue
    const c = { x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 }
    const best = pondBlock ? Math.hypot((pondBlock.x0 + pondBlock.x1) / 2 - anchor.x, (pondBlock.z0 + pondBlock.z1) / 2 - anchor.z) : Infinity
    if (Math.hypot(c.x - anchor.x, c.z - anchor.z) < best) pondBlock = b
  }
  if (pondBlock) {
    const b = pondBlock
    b.kind = 'pond'
    pond = {
      x: (b.x0 + b.x1) / 2,
      z: (b.z0 + b.z1) / 2,
      rx: Math.min(6.5 * Math.max(s, 0.8), (b.x1 - b.x0) / 2 - 2.4),
      rz: Math.min(4.2 * Math.max(s, 0.8), (b.z1 - b.z0) / 2 - 2.4),
    }
  }

  const ctx: Ctx = { s, reach, plots: [], houses: [], trees: [], parked: [] }
  for (const b of blocks) {
    const cx = (b.x0 + b.x1) / 2
    const cz = (b.z0 + b.z1) / 2
    const rng = createRng(fnv1a32(`outskirts:${opts.seed}:${cx.toFixed(1)},${cz.toFixed(1)}`))
    b.tone = Math.floor(rng() * 3)
    const w = b.x1 - b.x0
    const d = b.z1 - b.z0
    if (b.kind === 'pond') {
      pondPark(ctx, b, pond!, rng)
      continue
    }
    const roll = rng()
    if (Math.min(w, d) < 5 * s) b.kind = 'garden'
    else if (roll < 0.06 && b.ring >= 2) b.kind = 'park'
    else if (roll < 0.1 && b.ring >= 3) b.kind = 'allotment'
    else if (roll < 0.27) b.kind = 'terrace'
    const before = ctx.houses.length
    if ((b.kind === 'homes' || b.kind === 'terrace') && !fillHomes(ctx, b, rng, b.kind === 'terrace')) b.kind = 'garden'
    if (b.kind === 'park' || b.kind === 'garden') scatterTrees(ctx, b, rng, b.kind === 'park' ? 0.55 : 0.35)
    else if (b.kind === 'allotment') allotmentTrees(ctx, b, rng)
    // Toward the edge the houses thin out into garden trees, so the neighbourhood ends softly.
    const rb = Math.hypot(cx, cz)
    const keep = Math.min(1, Math.max(0.3, 1 - (rb - 0.88 * reach) / (0.4 * reach)))
    if (keep < 1) {
      const kept: House[] = []
      for (const h of ctx.houses.splice(before)) {
        if (rng() < keep) kept.push(h)
        else if (rng() < 0.7) ctx.trees.push(tree(h.x, h.z, s * (1 + rng() * 0.3), rng, lodOf(rb, reach)))
      }
      ctx.houses.push(...kept)
    }
  }

  // Caps: the houses and trees nearest the town are the ones on screen most of the time. Very large towns (whose view
  // reaches farther) get up to half as many again.
  const grow = Math.min(1.5, Math.max(1, (reach / 185) ** 2))
  const cap = opts.lite ? LITE_CAP : { ...CAP, houses: Math.round(CAP.houses * grow), trees: Math.round(CAP.trees * grow) }
  const near = <T extends { x: number; z: number }>(list: T[], n: number): T[] =>
    list.length <= n ? list : [...list].sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z)).slice(0, n)
  let houses = near(ctx.houses, cap.houses)
  let trees = near(ctx.trees, cap.trees)
  let parked = opts.lite ? [] : near(ctx.parked, cap.parked)
  if (opts.lite) {
    houses = houses.map((h) => ({ ...h, lod: 2, lights: 0 }))
    trees = trees.map((t) => ({ ...t, lod: 2 }))
    parked = []
  }

  const rings = opts.lite ? [1] : [1, Math.min(3, kx, kz), Math.min(kx, kz)]
  const { routes, cars } = planTraffic(X0, Z0, pitch, rings, s, cap.cars, createRng(fnv1a32(`cars:${opts.seed}:${cols}x${rows}`)))
  const plots = opts.lite ? ctx.plots.map((p) => ({ ...p, lod: 2 as const })) : ctx.plots
  const mains = { x: townX, z: townZ }
  return { lite: opts.lite, scale: s, reach, plate, hood, lanes, mains, blocks, plots, houses, trees, pond, routes, cars, parked }
}

function tree(x: number, z: number, s: number, rng: () => number, lod: Lod): Tree {
  return { x, z, s, kind: rng() < 0.3 ? 'cone' : 'round', v: rng(), lod }
}

function addTree(ctx: Ctx, alongX: boolean, along: number, across: number, s: number, rng: () => number, lod: Lod): void {
  ctx.trees.push(tree(alongX ? along : across, alongX ? across : along, s, rng, lod))
}

/**
 * Garden plots in rows along the block's streets, each with a house behind a front garden; a terrace is a row of
 * attached narrow houses. The plots tile the block. Returns false when no row fits (the block becomes a garden).
 */
function fillHomes(ctx: Ctx, b: Block, rng: () => number, terrace: boolean): boolean {
  const { s, reach } = ctx
  const w = b.x1 - b.x0
  const d = b.z1 - b.z0
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.z0 + b.z1) / 2
  const lod = lodOf(Math.hypot(cx, cz), reach)
  const rowMin = 6.6 * s
  // Rows run along X (fronts on the z sides) or along Z (fronts on the x sides): whichever holds more houses.
  const option = (alongX: boolean) => {
    const depth = alongX ? d : w
    const len = alongX ? w : d
    const lo = alongX ? b.roads.z0 : b.roads.x0
    const hi = alongX ? b.roads.z1 : b.roads.x1
    const outward: 'lo' | 'hi' = (alongX ? cz : cx) > 0 ? 'hi' : 'lo' // one row faces away from the town
    let sides: Array<'lo' | 'hi'> = []
    if (lo && hi && depth >= 2 * rowMin) sides = ['lo', 'hi']
    else if ((lo || hi) && depth >= 0.8 * rowMin) sides = [lo && hi ? outward : lo ? 'lo' : 'hi']
    return { alongX, depth, len, sides, score: sides.length * len }
  }
  const optX = option(true)
  const optZ = option(false)
  const { alongX, depth, len, sides, score } = optX.score >= optZ.score ? optX : optZ
  if (score === 0) return false
  const a0 = alongX ? b.x0 : b.z0 // row start along its axis
  for (const side of sides) {
    const rowDepth = sides.length === 2 ? depth / 2 : depth
    const edge = side === 'lo' ? (alongX ? b.z0 : b.x0) : alongX ? b.z1 : b.x1 // the street edge this row faces
    const inward = side === 'lo' ? 1 : -1
    const backEdge = edge + inward * rowDepth
    const facing: Facing = alongX ? (side === 'lo' ? 'z-' : 'z+') : side === 'lo' ? 'x-' : 'x+'
    const unitW = (2.6 + rng() * 0.5) * s
    const n = terrace ? Math.max(2, Math.floor((len * 0.88) / unitW)) : Math.max(1, Math.round(len / ((5.4 + rng() * 1.3) * s)))
    const slotW = terrace ? unitW : len / n
    const start = a0 + (terrace ? (len - n * unitW) / 2 : 0)
    const setback = (1.5 + rng() * 0.7) * s
    const hT = (3.9 + rng() * 0.4) * s
    const wallT = Math.floor(rng() * PAL.bgWall.length)
    for (let k = 0; k < n; k++) {
      // Plot k; the first and last reach the block ends, so the plots tile the block even for a centred terrace.
      const p0 = k === 0 ? a0 : start + k * slotW
      const p1 = k === n - 1 ? a0 + len : start + (k + 1) * slotW
      const q0 = Math.min(edge, backEdge)
      const q1 = Math.max(edge, backEdge)
      const area = alongX ? { x0: p0, x1: p1, z0: q0, z1: q1 } : { x0: q0, x1: q1, z0: p0, z1: p1 }
      ctx.plots.push({ ...area, tone: Math.floor(rng() * PLOT_TONES), facing, back: sides.length === 1 || side === 'lo', start: k > 0, lod })
      const gap = terrace ? 0 : (0.7 + rng() * 0.6) * s
      const hw = terrace ? unitW : Math.min(slotW - 2 * gap, (3.4 + rng() * 1.4) * s)
      const hd = Math.min((3.1 + rng() * 1.1) * s, rowDepth - setback - 1.0 * s)
      const mid = start + (k + 0.5) * slotW + (terrace ? 0 : (rng() - 0.5) * Math.max(0, slotW - hw - 2 * gap))
      if (hw < 2.6 * s || hd < 2.4 * s) {
        // No room for a house: a garden tree.
        if (rowDepth > 2.8 * s) addTree(ctx, alongX, mid, edge + inward * Math.min(rowDepth / 2, 2.4 * s), s, rng, lod)
        continue
      }
      const storeys: 1 | 2 = terrace ? 2 : rng() < 0.32 ? 2 : 1
      const h = terrace ? hT + (k % 2) * 0.35 * s : storeys === 2 ? (4.1 + rng() * 0.5) * s : (2.4 + rng() * 0.5) * s
      const across = edge + inward * (setback + hd / 2)
      const roofRoll = rng()
      const lit = rng()
      ctx.houses.push({
        x: alongX ? mid : across,
        z: alongX ? across : mid,
        w: hw,
        d: hd,
        h,
        facing,
        roof: terrace ? 'gable' : roofRoll < 0.6 ? 'gable' : roofRoll < 0.92 ? 'hip' : 'flat',
        storeys,
        wall: terrace ? (wallT + k) % PAL.bgWall.length : Math.floor(rng() * PAL.bgWall.length),
        roofTone: Math.floor(rng() * PAL.bgRoof.length),
        chimney: rng() < 0.35,
        lights: lit < 0.55 ? 0 : lit < 0.82 ? 1 : lit < 0.96 ? 2 : 3,
        attached: terrace,
        lod,
        v: rng(),
        front: edge,
      })
      // Back garden tree (clear of the house), and now and then a car on the drive beside the house.
      const backDepth = rowDepth - setback - hd
      if (backDepth > 2.6 * s && rng() < 0.72) {
        const along = mid + (rng() - 0.5) * Math.max(0, slotW - 2.6 * s)
        addTree(ctx, alongX, along, edge + inward * (setback + hd + Math.max(1.4 * s, backDepth / 2)), s * (0.8 + rng() * 0.2), rng, lod)
      }
      if (!terrace && gap > 0.95 * s && lod < 2 && rng() < 0.22) {
        const sgn = rng() < 0.5 ? -1 : 1
        const along = mid + sgn * (hw / 2 + gap / 2)
        const acr = edge + inward * (setback + 0.9 * s)
        const yaw = alongX ? (inward > 0 ? Math.PI : 0) : inward > 0 ? -Math.PI / 2 : Math.PI / 2
        ctx.parked.push({ x: alongX ? along : acr, z: alongX ? acr : along, yaw, color: Math.floor(rng() * PAL.bgCar.length) })
      }
    }
  }
  return true
}

/** Loose grid of trees over a park or a small leftover block. */
function scatterTrees(ctx: Ctx, b: Rect, rng: () => number, density: number): void {
  const { s } = ctx
  const step = 4.2 * s
  const lod = lodOf(Math.hypot((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), ctx.reach)
  for (let x = b.x0 + 1.5 * s; x <= b.x1 - 1.5 * s; x += step) {
    for (let z = b.z0 + 1.5 * s; z <= b.z1 - 1.5 * s; z += step) {
      if (rng() > density) continue
      const jx = Math.min(x + (rng() - 0.5) * step * 0.6, b.x1 - 1.4 * s)
      const jz = Math.min(z + (rng() - 0.5) * step * 0.6, b.z1 - 1.4 * s)
      ctx.trees.push(tree(Math.max(jx, b.x0 + 1.4 * s), Math.max(jz, b.z0 + 1.4 * s), s * (0.9 + rng() * 0.35), rng, lod))
    }
  }
}

/** Allotment gardens: the builder draws the beds; a few trees stand along one edge. */
function allotmentTrees(ctx: Ctx, b: Rect, rng: () => number): void {
  const { s } = ctx
  const lod = lodOf(Math.hypot((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), ctx.reach)
  for (let x = b.x0 + 1.6 * s; x < b.x1 - 1.6 * s; x += 5 * s) {
    if (rng() < 0.6) ctx.trees.push(tree(x, b.z1 - 1.5 * s, s * 0.9, rng, lod))
  }
}

/** Trees around the pond, clear of the water and its reeds. */
function pondPark(ctx: Ctx, b: Rect, pond: Pond, rng: () => number): void {
  const { s } = ctx
  const lod = lodOf(Math.hypot(pond.x, pond.z), ctx.reach)
  for (let i = 0; i < 14; i++) {
    const x = b.x0 + 1.4 * s + rng() * (b.x1 - b.x0 - 2.8 * s)
    const z = b.z0 + 1.4 * s + rng() * (b.z1 - b.z0 - 2.8 * s)
    if (((x - pond.x) / (pond.rx + 2.2)) ** 2 + ((z - pond.z) / (pond.rz + 2.2)) ** 2 < 1) continue
    ctx.trees.push(tree(x, z, s * (0.9 + rng() * 0.3), rng, lod))
  }
}

/** Car loops on lane rings (the inner ring near the town, a middle one and the outermost), cars spread evenly. */
function planTraffic(X0: number, Z0: number, pitch: number, rings: number[], s: number, maxCars: number, rng: () => number): { routes: Route[]; cars: Car[] } {
  const routes: Route[] = [...new Set(rings)].map((j) => {
    const rect = { x0: -X0 - j * pitch, x1: X0 + j * pitch, z0: -Z0 - j * pitch, z1: Z0 + j * pitch }
    const length = 2 * (rect.x1 - rect.x0 + rect.z1 - rect.z0) - 8 * ROUTE_RADIUS + 2 * Math.PI * ROUTE_RADIUS
    return { rect, r: ROUTE_RADIUS, length }
  })
  const total = routes.reduce((a, r) => a + r.length, 0)
  const cars: Car[] = []
  routes.forEach((route, i) => {
    for (const dir of [1, -1] as const) {
      // One speed per lane, so cars never drive through each other; spaced evenly with a little jitter.
      const n = Math.max(1, Math.round(Math.min(route.length / CAR_SPACING, (maxCars * route.length) / total / 2)))
      const speed = (2.6 + rng() * 0.9) * s
      const gap = route.length / n
      const phase = rng() * gap
      for (let k = 0; k < n; k++) cars.push({ route: i, dir, s0: phase + k * gap + (rng() - 0.5) * gap * 0.4, speed, color: Math.floor(rng() * PAL.bgCar.length) })
    }
  })
  return { routes, cars: cars.slice(0, maxCars) }
}
