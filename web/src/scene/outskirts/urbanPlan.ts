// The background neighbourhood around the town ("outskirts") as plain data, so placement can be tested: the base
// plate, residential lanes continuing the town's street grid, and the blocks between them: houses on garden plots of
// irregular widths, terraces, corner shops, apartment blocks and workshops, now and then a school or a church, open
// spaces (car parks, courts, playgrounds, little squares, empty lots), trees, a pond park and car loops. A smooth
// district field makes some areas denser and others leafier, and buildings may grow taller only farther from the town,
// which stays the focus. It reaches past the frame edges of the default view at every orbit angle, then gives way to a
// band of countryside before the plate edge. Deterministic for a layout and seed.
import { fnv1a32 } from '../../util/hash'
import { createRng } from '../../util/prng'
import { FIT_PITCH, FOV_DEG, TARGET_HEIGHT, VIEW_SHIFT, fitDistance } from '../cameraMath'
import { ROAD_WIDTH, SIDEWALK_WIDTH, VERGE_W, type TownLayout } from '../layout'
import { PAL } from '../palette'
import type { RoadExit } from '../street'

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
/** Storey height (x scale) of shops, flats and schools. */
export const STOREY = 2.05
/**
 * Highest point (x scale) a building may reach, by ring (4 and beyond share the last). In the two rings round the town
 * nothing outgrows its lowest building style (the warehouse, 6.15); apartment blocks and the church stand farther out.
 */
export const HEIGHT_CAP = [6, 6, 6, 10.4, 12.8]

export interface Rect { x0: number; x1: number; z0: number; z1: number }
export type Facing = 'x+' | 'x-' | 'z+' | 'z-'
/** Stepped roofs: a gable's ridge runs along the front, a cross gable's from front to back; a shed roof rises to the back. */
export type RoofKind = 'gable' | 'cross' | 'hip' | 'shed' | 'flat' | 'saw' | 'spire'
export type BuildingKind = 'house' | 'terrace' | 'shop' | 'flats' | 'school' | 'works' | 'church' | 'tower'
export type BlockKind = 'homes' | 'terrace' | 'flats' | 'works' | 'school' | 'church' | 'park' | 'allotment' | 'garden' | 'pond'
/** Open ground: car park, sports court (a school yard is one), playground, little square, works yard, empty lot. */
export type PadKind = 'parking' | 'court' | 'playground' | 'plaza' | 'yard' | 'lot'
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
/** One building: a box with a roof (a church is a nave and a tower). */
export interface House {
  kind: BuildingKind
  x: number
  z: number // footprint centre
  w: number // along the front, a garage wing included
  d: number // front to back
  h: number // wall height
  facing: Facing // the side with the door
  roof: RoofKind
  storeys: number
  wall: number // index into the kind's wall palette: PAL.bgFlats, PAL.bgShed, else PAL.bgWall (a church is PAL.bgChurch)
  roofTone: number // index into PAL.bgHouseRoof; a shop's awning colour in PAL.bgAwning
  chimney: boolean
  lights: number // windows lit at night
  attached: boolean // terrace unit: no side windows
  annex: number // garage wing at one end of the front, inside `w`: its width, > 0 at the right end, < 0 at the left; 0 = none
  lod: Lod
  v: number // [0, 1): small builder-side variations
  front: number // coordinate of the road edge the front garden runs to (x for x± facing, z for z±)
}
export interface Pad extends Rect { kind: PadKind; v: number; lod: Lod }
export interface Tree { x: number; z: number; s: number; kind: 'round' | 'cone' | 'column'; v: number; lod: Lod }
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
  exits: RoadExit[]
  blocks: Block[]
  plots: Plot[]
  pads: Pad[]
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

/** Height (x scale) of one tier of a stepped pitched roof. */
export function roofTier(kind: BuildingKind): number {
  return kind === 'church' ? 0.42 : kind === 'works' ? 0.2 : kind === 'school' ? 0.27 : 0.3
}

/** How far (x scale) a roof rises above the walls: chimney, rooftop boxes and spire included. */
export function roofRise(h: Pick<House, 'kind' | 'roof' | 'chimney'>): number {
  if (h.roof === 'spire') return 4.2
  if (h.roof === 'flat') return h.kind === 'flats' ? 1.15 : 0.8
  if (h.roof === 'saw') return 1.1
  const t = roofTier(h.kind)
  return Math.max((h.kind === 'church' ? 4 : 2.9) * t, h.chimney ? 3 * t + 0.45 : 0)
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
  pads: Pad[]
  houses: House[]
  trees: Tree[]
  parked: ParkedCar[]
}

/** A row of plots along one street side of a block: `a0` to `a0 + len` along it, `depth` in from the street edge. */
interface Row {
  alongX: boolean // the row runs along X (fronts on the z sides)
  a0: number
  len: number
  edge: number // the street edge the row faces
  inward: 1 | -1 // from that edge into the block
  depth: number
  facing: Facing
  back: boolean // its plots draw the hedge on the back edge
  ends: [boolean, boolean] // a street runs past its start / end (corner plots)
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
const allRoads = (b: Block): boolean => b.roads.x0 && b.roads.x1 && b.roads.z0 && b.roads.z1
const inside = (r: Rect, x: number, z: number, pad: number): boolean => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad

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
    if (w < 9 || d < 7 || !allRoads(b)) continue
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

  // Landmarks, rare and away from the town (from the third ring): a church and a school or two with a yard, each in a
  // large block with a street on every side, never two side by side.
  const centre = (b: Rect) => ({ x: (b.x0 + b.x1) / 2, z: (b.z0 + b.z1) / 2 })
  const large = blocks.filter((b) => b.kind === 'homes' && allRoads(b) && Math.min(b.x1 - b.x0, b.z1 - b.z0) >= 14 * s && Math.hypot(centre(b).x, centre(b).z) < 0.9 * reach)
  const lrng = createRng(fnv1a32(`landmarks:${opts.seed}:${cols}x${rows}`))
  const picked: Block[] = []
  const pick = (kind: BlockKind, minRing: number): void => {
    const apart = (b: Block) => picked.every((o) => Math.hypot(centre(b).x - centre(o).x, centre(b).z - centre(o).z) > 2.5 * pitch)
    const can = large.filter((b) => b.kind === 'homes' && b.ring >= minRing && apart(b))
    if (can.length === 0) return
    const b = can[Math.floor(lrng() * can.length)]
    b.kind = kind
    picked.push(b)
  }
  pick('church', 3)
  if (large.length > 160) pick('church', 3)
  for (let i = Math.min(3, Math.max(1, Math.round(large.length / 70))); i > 0; i--) pick('school', 3)

  // Districts: a smooth field, dense (terraces, flats, shops) where it is high and leafy (wide gardens, parks) where low.
  const drng = createRng(fnv1a32(`districts:${opts.seed}`))
  const ph = [drng(), drng(), drng()].map((v) => v * 2 * Math.PI)
  const kd = 1 / (1.5 * pitch)
  const denseAt = (x: number, z: number): number =>
    Math.min(1, Math.max(0, 0.5 + 0.22 * (Math.sin(x * kd + ph[0]) + Math.sin(z * kd * 1.21 + ph[1])) + 0.08 * Math.sin((x - z) * kd * 2.3 + ph[2])))

  const ctx: Ctx = { s, reach, plots: [], pads: [], houses: [], trees: [], parked: [] }
  for (const b of blocks) {
    const { x: cx, z: cz } = centre(b)
    const rng = createRng(fnv1a32(`outskirts:${opts.seed}:${cx.toFixed(1)},${cz.toFixed(1)}`))
    b.tone = Math.floor(rng() * 3)
    const w = b.x1 - b.x0
    const d = b.z1 - b.z0
    if (b.kind === 'pond') {
      pondPark(ctx, b, pond!, rng)
      continue
    }
    const rb = Math.hypot(cx, cz)
    const lod = lodOf(rb, reach)
    const dense = denseAt(cx, cz)
    if (b.kind === 'homes') {
      // Zoning: workshops from the second ring, apartment blocks from the third, both inside the view's reach (the
      // neighbourhood thins out past it).
      const big = b.ring >= 2 && rb < reach
      const roll = rng()
      const odds: Array<[BlockKind, number]> = [
        ['park', b.ring >= 2 ? 0.02 + 0.06 * (1 - dense) : 0],
        ['allotment', b.ring >= 3 ? 0.05 * (1 - dense) : 0],
        ['flats', big && b.ring >= 3 ? 0.02 + 0.26 * dense : 0],
        ['works', big ? 0.05 : 0],
        ['terrace', 0.08 + 0.2 * dense],
      ]
      let acc = 0
      if (Math.min(w, d) < 5 * s) b.kind = 'garden'
      else b.kind = odds.find(([, p]) => roll < (acc += p))?.[0] ?? 'homes'
    }
    const before = ctx.houses.length
    if (b.kind === 'school' && !schoolBlock(ctx, b, rng, lod)) b.kind = 'homes'
    if (b.kind === 'church' && !churchBlock(ctx, b, rng, lod)) b.kind = 'homes'
    if (b.kind === 'flats' && !flatsBlock(ctx, b, rng, lod)) b.kind = 'homes'
    if (b.kind === 'works' && !worksBlock(ctx, b, rng, lod)) b.kind = 'homes'
    if ((b.kind === 'homes' || b.kind === 'terrace') && !homesBlock(ctx, b, rng, lod, dense)) b.kind = 'garden'
    if (b.kind === 'park') parkBlock(ctx, b, rng, lod)
    else if (b.kind === 'garden') scatterTrees(ctx, b, rng, 0.35)
    else if (b.kind === 'allotment') allotmentTrees(ctx, b, rng)
    // Toward the edge the houses thin out into garden trees, so the neighbourhood ends softly.
    const keep = Math.min(1, Math.max(0.3, 1 - (rb - 0.88 * reach) / (0.4 * reach)))
    if (keep < 1) {
      const kept: House[] = []
      for (const h of ctx.houses.splice(before)) {
        if (h.kind !== 'house' && h.kind !== 'terrace' && h.kind !== 'shop') kept.push(h)
        else if (rng() < keep) kept.push(h)
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
  const pads = opts.lite ? ctx.pads.map((p) => ({ ...p, lod: 2 as const })) : ctx.pads
  const mains = { x: townX, z: townZ }
  // Every road line runs on to the plate edge on both sides; its sidewalks open where a lane crosses.
  const exits: RoadExit[] = [
    ...townX.flatMap((x) => [[plate.z0, bounds.minZ], [bounds.maxZ, plate.z1]].map(([from, to]): RoadExit => (
      { axis: 'z', at: x, from, to, walks: openSpans(from, to, laneZs, LANE_W / 2), tinted: true }
    ))),
    ...townZ.flatMap((z) => [[plate.x0, bounds.minX], [bounds.maxX, plate.x1]].map(([from, to]): RoadExit => (
      { axis: 'x', at: z, from, to, walks: openSpans(from, to, laneXs, LANE_W / 2), tinted: true }
    ))),
  ]
  return { lite: opts.lite, scale: s, reach, plate, hood, lanes, mains, exits, blocks, plots, pads, houses, trees, pond, routes, cars, parked }
}

/** Pieces of [a, c] left between gaps of +-gap around the sorted positions `gaps` (gaps outside [a, c] are ignored). */
function openSpans(a: number, c: number, gaps: number[], gap: number): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let from = a
  for (const g of gaps) {
    if (g + gap <= a || g - gap >= c) continue
    if (g - gap > from) out.push([from, g - gap])
    from = Math.max(from, g + gap)
  }
  if (c > from) out.push([from, c])
  return out
}

function tree(x: number, z: number, s: number, rng: () => number, lod: Lod, kind?: Tree['kind']): Tree {
  const k = rng()
  return { x, z, s, kind: kind ?? (k < 0.27 ? 'cone' : k < 0.34 ? 'column' : 'round'), v: rng(), lod }
}

function addTree(ctx: Ctx, r: Row, along: number, across: number, s: number, rng: () => number, lod: Lod, kind?: Tree['kind']): void {
  const c = r.edge + r.inward * across
  ctx.trees.push(tree(r.alongX ? along : c, r.alongX ? c : along, s, rng, lod, kind))
}

/**
 * Rows along the block's streets, along X or along Z, whichever holds more: two back to back where `minDepth` fits
 * twice, else one facing a street (away from the town when both sides do).
 */
function rowsOf(b: Block, minDepth: number): Row[] {
  const w = b.x1 - b.x0
  const d = b.z1 - b.z0
  const option = (alongX: boolean) => {
    const depth = alongX ? d : w
    const lo = alongX ? b.roads.z0 : b.roads.x0
    const hi = alongX ? b.roads.z1 : b.roads.x1
    const outward: 'lo' | 'hi' = (alongX ? b.z0 + b.z1 : b.x0 + b.x1) > 0 ? 'hi' : 'lo'
    let sides: Array<'lo' | 'hi'> = []
    if (lo && hi && depth >= 2 * minDepth) sides = ['lo', 'hi']
    else if ((lo || hi) && depth >= 0.8 * minDepth) sides = [lo && hi ? outward : lo ? 'lo' : 'hi']
    return { alongX, depth, sides, score: sides.length * (alongX ? w : d) }
  }
  const optX = option(true)
  const optZ = option(false)
  const { alongX, depth, sides } = optX.score >= optZ.score ? optX : optZ
  return sides.map((side): Row => {
    const lo = side === 'lo'
    return {
      alongX,
      a0: alongX ? b.x0 : b.z0,
      len: alongX ? w : d,
      edge: lo ? (alongX ? b.z0 : b.x0) : alongX ? b.z1 : b.x1,
      inward: lo ? 1 : -1,
      depth: sides.length === 2 ? depth / 2 : depth,
      facing: alongX ? (lo ? 'z-' : 'z+') : lo ? 'x-' : 'x+',
      back: sides.length === 1 || lo,
      ends: alongX ? [b.roads.x0, b.roads.x1] : [b.roads.z0, b.roads.z1],
    }
  })
}

/** Part of a row: `p0` to `p1` along it, `q0` to `q1` in from its street edge. */
function rowRect(r: Row, p0: number, p1: number, q0 = 0, q1 = r.depth): Rect {
  const e0 = r.edge + r.inward * q0
  const e1 = r.edge + r.inward * q1
  const [c0, c1] = [Math.min(e0, e1), Math.max(e0, e1)]
  return r.alongX ? { x0: p0, x1: p1, z0: c0, z1: c1 } : { x0: c0, x1: c1, z0: p0, z1: p1 }
}

/** A building facing the row's street, centred `along` it with its front `setback` in from the street edge. */
function building(r: Row, along: number, setback: number, w: number, d: number, lod: Lod, rng: () => number,
  props: Pick<House, 'kind' | 'h' | 'roof' | 'storeys' | 'wall' | 'roofTone'> & Partial<House>): House {
  const across = r.edge + r.inward * (setback + d / 2)
  return {
    x: r.alongX ? along : across, z: r.alongX ? across : along, w, d, facing: r.facing, front: r.edge, lod,
    chimney: false, lights: 0, attached: false, annex: 0, v: rng(), ...props,
  }
}

const litCount = (rng: () => number): number => {
  const lit = rng()
  return lit < 0.55 ? 0 : lit < 0.82 ? 1 : lit < 0.96 ? 2 : 3
}

/**
 * Homes along the block's streets: rows of detached houses or terraces; a homes block may mix in a terrace row, and
 * now and then one row of a block is an open space instead. Returns false when no row fits (the block becomes a garden).
 */
function homesBlock(ctx: Ctx, b: Block, rng: () => number, lod: Lod, dense: number): boolean {
  const rows = rowsOf(b, 6.6 * ctx.s)
  if (rows.length === 0) return false
  const open = rows.length === 2 && rng() < 0.16 ? Math.floor(rng() * 2) : rows.length === 1 && rng() < 0.05 ? 0 : -1
  rows.forEach((r, i) => {
    if (i === open) openRow(ctx, r, rng, lod, dense)
    else if (b.kind === 'terrace' || (i === 1 && rng() < 0.1 + 0.2 * dense)) terraceRow(ctx, r, rng, lod, b.ring)
    else houseRow(ctx, r, rng, lod, dense, b.ring)
  })
  return true
}

/** Detached houses on plots of irregular widths (wider in leafy districts); a corner shop, an empty plot now and then. */
function houseRow(ctx: Ctx, r: Row, rng: () => number, lod: Lod, dense: number, ring: number): void {
  const { s } = ctx
  const widths: number[] = []
  for (let left = r.len; left > 1e-6;) {
    let pw = (4.4 + rng() * 3.2 + (1 - dense) * 1.6) * s
    if (left - pw < 4.4 * s) pw = left
    widths.push(pw)
    left -= pw
  }
  let p0 = r.a0
  widths.forEach((pw, k) => {
    const p1 = k === widths.length - 1 ? r.a0 + r.len : p0 + pw
    ctx.plots.push({ ...rowRect(r, p0, p1), tone: Math.floor(rng() * PLOT_TONES), facing: r.facing, back: r.back, start: k > 0, lod })
    const corner = k === 0 ? r.ends[0] : k === widths.length - 1 && r.ends[1]
    const roll = rng()
    if (corner && roll < 0.06 + 0.3 * dense && p1 - p0 > 4.8 * s && r.depth > 6 * s) shop(ctx, r, p0, p1, k === 0, rng, lod, ring)
    else if (roll > 0.94) emptyPlot(ctx, r, p0, p1, rng, lod)
    else house(ctx, r, p0, p1, rng, lod, dense)
    p0 = p1
  })
}

/** A detached house: its own size, setback, height, roof and colours; a garage wing where the plot leaves room. */
function house(ctx: Ctx, r: Row, p0: number, p1: number, rng: () => number, lod: Lod, dense: number): void {
  const { s } = ctx
  const slotW = p1 - p0
  const gap = (0.6 + rng() * 0.7) * s
  const setback = Math.min((1.2 + rng() * 2.0) * s, Math.max(1.2 * s, r.depth - 4.0 * s)) // shallow rows keep room for a house
  const body = Math.min(slotW - 2 * gap, (3.2 + rng() * 2.4) * s)
  const d = Math.min((3.0 + rng() * 1.8) * s, r.depth - setback - 1.0 * s)
  if (body < 2.6 * s || d < 2.4 * s) {
    // No room for a house: a garden tree.
    if (r.depth > 2.8 * s) addTree(ctx, r, (p0 + p1) / 2, Math.min(r.depth / 2, 2.4 * s), s, rng, lod)
    return
  }
  const room = slotW - 2 * gap - body
  const annex = room > 2.0 * s && rng() < 0.4 ? (rng() < 0.5 ? -1 : 1) * Math.min(room, (1.9 + rng() * 0.6) * s) : 0
  const w = body + Math.abs(annex)
  const mid = (p0 + p1) / 2 + (rng() - 0.5) * Math.max(0, slotW - w - 2 * gap)
  const storeys = rng() < 0.3 + 0.2 * dense ? 2 : 1
  const rr = rng()
  const roof: RoofKind = rr < 0.1 ? 'flat' : rr < 0.22 ? 'shed' : rr < 0.46 ? 'hip' : body < d * 1.1 ? 'cross' : 'gable'
  ctx.houses.push(building(r, mid, setback, w, d, lod, rng, {
    kind: 'house', h: storeys === 2 ? (4.1 + rng() * 0.5) * s : (2.4 + rng() * 0.5) * s, roof, storeys, annex,
    wall: Math.floor(rng() * PAL.bgWall.length), roofTone: Math.floor(rng() * PAL.bgHouseRoof.length),
    chimney: roof !== 'flat' && roof !== 'shed' && rng() < 0.32, lights: litCount(rng),
  }))
  // Back garden trees, clear of the house.
  const backDepth = r.depth - setback - d
  if (backDepth > 2.6 * s && rng() < 0.75) {
    const n = slotW > 6 * s && rng() < 0.6 * (1 - dense) ? 2 : 1 // two in wide leafy gardens
    for (let i = 0; i < n; i++) {
      addTree(ctx, r, p0 + ((i + 0.2 + 0.6 * rng()) / n) * slotW, setback + d + Math.max(1.4 * s, backDepth / 2), s * (0.8 + rng() * 0.2), rng, lod)
    }
  }
  // Now and then a car: on the drive in front of the garage, or beside a house without one.
  const drive = annex !== 0 ? setback > 2.2 * s : gap > 0.95 * s
  if (drive && lod < 2 && rng() < 0.3) {
    const right = r.alongX ? (r.facing === 'z+' ? 1 : -1) : r.facing === 'x+' ? -1 : 1 // the house's right, along the row
    const along = annex !== 0 ? mid + (right * Math.sign(annex) * (w - Math.abs(annex))) / 2 : mid + (rng() < 0.5 ? -1 : 1) * (w / 2 + gap / 2)
    const c = r.edge + r.inward * (annex !== 0 ? setback - 1.0 * s : setback + 0.9 * s)
    const yaw = r.alongX ? (r.inward > 0 ? Math.PI : 0) : r.inward > 0 ? -Math.PI / 2 : Math.PI / 2
    ctx.parked.push({ x: r.alongX ? along : c, z: r.alongX ? c : along, yaw, color: Math.floor(rng() * PAL.bgCar.length) })
  }
}

/** Corner shop: close to both streets, an awning over its window; up to two floors of flats above it from the third ring. */
function shop(ctx: Ctx, r: Row, p0: number, p1: number, atStart: boolean, rng: () => number, lod: Lod, ring: number): void {
  const { s } = ctx
  const setback = (0.95 + rng() * 0.3) * s
  const w = Math.min(p1 - p0 - 0.9 * s, (4.2 + rng() * 2.0) * s)
  const d = Math.min((3.8 + rng() * 1.4) * s, r.depth - setback - 0.8 * s)
  const storeys = ring >= 3 && rng() < 0.35 ? 3 : rng() < 0.75 ? 2 : 1
  ctx.houses.push(building(r, atStart ? p0 + 0.45 * s + w / 2 : p1 - 0.45 * s - w / 2, setback, w, d, lod, rng, {
    kind: 'shop', h: (0.35 + storeys * STOREY) * s, roof: 'flat', storeys,
    wall: Math.floor(rng() * PAL.bgWall.length), roofTone: Math.floor(rng() * PAL.bgAwning.length),
    lights: rng() < 0.7 ? 1 + Math.floor(rng() * storeys) : 0,
  }))
}

/** A plot without a house: a clump of trees, or bare earth. */
function emptyPlot(ctx: Ctx, r: Row, p0: number, p1: number, rng: () => number, lod: Lod): void {
  const { s } = ctx
  if (rng() < 0.5) {
    for (let i = 2 + Math.floor(rng() * 3); i > 0; i--) {
      addTree(ctx, r, p0 + (0.2 + 0.6 * rng()) * (p1 - p0), 1.4 * s + rng() * Math.max(0, r.depth - 2.8 * s), s * (0.85 + rng() * 0.35), rng, lod)
    }
  } else {
    ctx.pads.push({ ...rowRect(r, p0 + 0.6 * s, p1 - 0.6 * s, 0.9 * s, r.depth - 0.8 * s), kind: 'lot', v: rng(), lod })
  }
}

/** Terrace: attached narrow houses on one building line, a few wall colours mixed along it, one roof style per row. */
function terraceRow(ctx: Ctx, r: Row, rng: () => number, lod: Lod, ring: number): void {
  const { s } = ctx
  const unitW = (2.6 + rng() * 0.6) * s
  const n = Math.max(2, Math.floor((r.len * (0.8 + rng() * 0.1)) / unitW))
  const start = r.a0 + (r.len - n * unitW) * (0.25 + rng() * 0.5)
  const setback = (1.3 + rng() * 1.0) * s
  const d = Math.min((3.2 + rng() * 1.0) * s, r.depth - setback - 1.0 * s)
  const storeys = ring >= 3 && rng() < 0.3 ? 3 : 2
  const hT = storeys === 3 ? (5.8 + rng() * 0.2) * s : (3.9 + rng() * 0.4) * s
  const rr = rng()
  const roof: RoofKind = rr < 0.55 ? 'gable' : rr < 0.75 ? 'flat' : 'cross'
  const base = Math.floor(rng() * PAL.bgWall.length)
  const walls = [0, 3, 7].map((k) => (base + k) % PAL.bgWall.length)
  const roofTone = Math.floor(rng() * PAL.bgHouseRoof.length)
  let last = -1
  for (let k = 0; k < n; k++) {
    // Plot k; the first and last reach the row ends, so the plots tile the row.
    const q0 = k === 0 ? r.a0 : start + k * unitW
    const q1 = k === n - 1 ? r.a0 + r.len : start + (k + 1) * unitW
    ctx.plots.push({ ...rowRect(r, q0, q1), tone: Math.floor(rng() * PLOT_TONES), facing: r.facing, back: r.back, start: k > 0, lod })
    if (d < 2.4 * s) {
      if (r.depth > 2.8 * s) addTree(ctx, r, (q0 + q1) / 2, Math.min(r.depth / 2, 2.4 * s), s, rng, lod)
      continue
    }
    let i = Math.floor(rng() * 3)
    if (i === last) i = (i + 1) % 3
    last = i
    ctx.houses.push(building(r, start + (k + 0.5) * unitW, setback, unitW, d, lod, rng, {
      kind: 'terrace', h: roof === 'flat' ? hT + rng() * 0.45 * s : hT + (k % 2) * (storeys === 3 ? 0.2 : 0.35) * s, roof, storeys,
      wall: walls[i], roofTone: roof === 'cross' ? Math.floor(rng() * PAL.bgHouseRoof.length) : roofTone,
      chimney: roof !== 'flat' && rng() < 0.3, lights: litCount(rng), attached: true,
    }))
    const backDepth = r.depth - setback - d
    if (backDepth > 2.6 * s && rng() < 0.6) addTree(ctx, r, (q0 + q1) / 2, setback + d + Math.max(1.4 * s, backDepth / 2), s * (0.8 + rng() * 0.2), rng, lod)
  }
}

/**
 * A row given to an open space on a lawn: a playground, a sports court, a car park or a little square with trees beside
 * it, or a pocket wood.
 */
function openRow(ctx: Ctx, r: Row, rng: () => number, lod: Lod, dense: number): void {
  const { s } = ctx
  ctx.plots.push({ ...rowRect(r, r.a0, r.a0 + r.len), tone: Math.floor(rng() * PLOT_TONES), facing: r.facing, back: r.back, start: false, lod })
  const roll = rng()
  if (roll > 0.84) {
    for (let t = r.a0 + 1.3 * s; t < r.a0 + r.len - 1.2 * s; t += (1.7 + rng() * 1.2) * s) {
      addTree(ctx, r, t, 1.4 * s + rng() * Math.max(0, r.depth - 2.8 * s), s * (0.85 + rng() * 0.4), rng, lod)
    }
    return
  }
  const kind = roll < 0.3 ? 'playground' : roll < 0.55 ? 'court' : roll < 0.65 + 0.12 * dense ? 'parking' : 'plaza'
  const [pl, pd] = { playground: [8, 6], court: [12, 7], parking: [16, 7.5], plaza: [10, 8] }[kind]
  const len = Math.min(r.len - 2.4 * s, pl * s)
  const dep = Math.min(r.depth - 1.4 * s, pd * s)
  const p0 = r.a0 + 1.2 * s + (r.len - 2.4 * s - len) * rng()
  const q0 = kind === 'parking' ? 0.3 * s : 0.6 * s + (r.depth - 1.4 * s - dep) * rng()
  ctx.pads.push({ ...rowRect(r, p0, p0 + len, q0, q0 + dep), kind, v: rng(), lod })
  // Trees on the lawn left beside it.
  for (const [a, c] of [[r.a0, p0], [p0 + len, r.a0 + r.len]]) {
    for (let t = a + 1.3 * s; t < c - 1.2 * s; t += (2.2 + rng() * 1.6) * s) {
      if (rng() < 0.7) addTree(ctx, r, t, 1.4 * s + rng() * Math.max(0, r.depth - 2.8 * s), s * (0.85 + rng() * 0.3), rng, lod)
    }
  }
}

/** Apartment blocks: three or four storeys in the third ring, up to five farther out, on a shared lawn with a car park. */
function flatsBlock(ctx: Ctx, b: Block, rng: () => number, lod: Lod): boolean {
  const { s } = ctx
  const rows = rowsOf(b, 7.6 * s)
  const most = Math.min(5, b.ring + 1)
  const parkAt = rows.length === 2 && rng() < 0.3 ? 1 : -1
  const avoid: Rect[] = []
  rows.forEach((r, i) => {
    if (i === parkAt) {
      const pad = rowRect(r, r.a0 + 1.0 * s, r.a0 + r.len - 1.0 * s, 0.3 * s, r.depth - 0.9 * s)
      ctx.pads.push({ ...pad, kind: 'parking', v: rng(), lod })
      avoid.push(pad)
      return
    }
    const two = r.len > 25 * s && rng() < 0.6
    const w = Math.min(two ? (r.len - 4.5 * s) / 2 : r.len - 2.4 * s, (9 + rng() * 6) * s)
    const setback = (1.6 + rng() * 1.2) * s
    const d = Math.min((5.0 + rng() * 1.6) * s, r.depth - setback - 0.8 * s)
    if (w < 6 * s || d < 4 * s) return
    const storeys = 3 + Math.floor(rng() * (most - 2))
    const free = r.len - (two ? 2 : 1) * w
    const mids = two ? [r.a0 + free / 3 + w / 2, r.a0 + (2 * free) / 3 + 1.5 * w] : [r.a0 + r.len / 2 + (rng() - 0.5) * (free - 2.4 * s)]
    const wall = Math.floor(rng() * PAL.bgFlats.length)
    const roof: RoofKind = rng() < 0.18 ? 'hip' : 'flat'
    for (const mid of mids) {
      ctx.houses.push(building(r, mid, setback, w, d, lod, rng, {
        kind: 'flats', h: (0.35 + storeys * STOREY) * s, roof, storeys, wall, roofTone: Math.floor(rng() * PAL.bgHouseRoof.length),
        lights: Math.round(storeys * (w / s) * 0.2 * (0.5 + rng())),
      }))
      avoid.push(rowRect(r, mid - w / 2 - 1.0 * s, mid + w / 2 + 1.0 * s, 0, setback + d + 1.0 * s))
    }
  })
  if (avoid.length === 0) return false
  scatterTrees(ctx, b, rng, 0.4, avoid)
  return true
}

/** Workshops and small warehouses, low and wide behind a yard; a second small one or a car park where there is room. */
function worksBlock(ctx: Ctx, b: Block, rng: () => number, lod: Lod): boolean {
  const { s } = ctx
  const r = rowsOf(b, 10 * s)[0]
  if (!r) return false
  const yard = (3.0 + rng() * 1.6) * s
  const w = Math.min(r.len - 2.4 * s, (8 + rng() * 6) * s)
  const d = Math.min((6 + rng() * 3) * s, r.depth - yard - 1.0 * s)
  if (w < 6 * s || d < 4.5 * s) return false
  const free = r.len - w - 2.4 * s
  const atStart = rng() < 0.5
  const mid = free > 6.5 * s ? (atStart ? r.a0 + 1.2 * s + w / 2 : r.a0 + r.len - 1.2 * s - w / 2) : r.a0 + r.len / 2 + (rng() - 0.5) * Math.max(0, free)
  const shed = (along: number, sw: number, sd: number, roof: RoofKind): void => {
    ctx.houses.push(building(r, along, yard, sw, sd, lod, rng, {
      kind: 'works', h: (3.4 + rng() * 1.3) * s, roof, storeys: 1, wall: Math.floor(rng() * PAL.bgShed.length),
      roofTone: Math.floor(rng() * PAL.bgHouseRoof.length), lights: rng() < 0.5 ? 1 : 0,
    }))
    ctx.pads.push({ ...rowRect(r, along - sw / 2, along + sw / 2, 0.4 * s, yard - 0.3 * s), kind: 'yard', v: rng(), lod })
  }
  const rr = rng()
  shed(mid, w, d, rr < 0.4 ? 'saw' : rr < 0.7 ? 'gable' : 'flat')
  if (free > 6.5 * s) {
    const a = atStart ? mid + w / 2 + 1.2 * s : r.a0 + 1.0 * s
    const c = atStart ? r.a0 + r.len - 1.0 * s : mid - w / 2 - 1.2 * s
    if (rng() < 0.35) ctx.pads.push({ ...rowRect(r, a, c, 0.3 * s, Math.min(r.depth - 2.8 * s, 8 * s)), kind: 'parking', v: rng(), lod })
    else shed((a + c) / 2, Math.min(c - a - 0.8 * s, (4 + rng() * 2) * s), Math.min((4 + rng() * 1.5) * s, d), 'gable')
  }
  // A few trees along the back edge.
  for (let t = r.a0 + 1.5 * s; t < r.a0 + r.len - 1.4 * s; t += 3.6 * s) {
    if (rng() < 0.55 && r.depth - yard - d > 2.6 * s) addTree(ctx, r, t, r.depth - 1.3 * s, s * (0.85 + rng() * 0.3), rng, lod)
  }
  return true
}

/** School: a long building on one street, its yard (a court on paving) behind, poplars along the yard's ends. */
function schoolBlock(ctx: Ctx, b: Block, rng: () => number, lod: Lod): boolean {
  const { s } = ctx
  const r = rowsOf(b, 14 * s)[0]
  if (!r || r.depth < 13 * s || r.len < 13 * s) return false
  const w = Math.min(r.len - 2.4 * s, (13 + rng() * 6) * s)
  const d = (5.0 + rng() * 0.8) * s
  const setback = 1.5 * s
  const storeys = b.ring >= 3 && rng() < 0.4 ? 3 : 2
  ctx.houses.push(building(r, r.a0 + r.len / 2 + (rng() - 0.5) * (r.len - w - 2.4 * s), setback, w, d, lod, rng, {
    kind: 'school', h: (0.35 + storeys * STOREY) * s, roof: rng() < 0.55 ? 'hip' : 'flat', storeys,
    wall: [1, 5, 7, 11][Math.floor(rng() * 4)], roofTone: Math.floor(rng() * PAL.bgHouseRoof.length), lights: rng() < 0.5 ? 2 : 0,
  }))
  const y0 = setback + d + 0.8 * s
  const y1 = r.depth - 0.7 * s
  ctx.pads.push({ ...rowRect(r, r.a0 + 2.0 * s, r.a0 + r.len - 2.0 * s, y0, y1), kind: 'court', v: rng(), lod })
  for (const along of [r.a0 + 1.0 * s, r.a0 + r.len - 1.0 * s]) {
    for (let t = y0 + 0.6 * s; t < y1 - 0.4 * s; t += 2.0 * s) addTree(ctx, r, along, t, s * (0.9 + rng() * 0.2), rng, lod, 'column')
  }
  return true
}

/** Church: a nave with a steep roof and a tower with a stepped spire at its front, a paved forecourt, churchyard trees. */
function churchBlock(ctx: Ctx, b: Block, rng: () => number, lod: Lod): boolean {
  const { s } = ctx
  const r = rowsOf(b, 16 * s)[0]
  const tw = (2.4 + rng() * 0.4) * s
  const setback = 2.6 * s
  if (!r || r.len < 9 * s) return false
  const nd = Math.min((8.5 + rng() * 1.5) * s, r.depth - setback - tw - 1.2 * s)
  const nw = (4.6 + rng() * 0.8) * s
  if (nd < 6 * s) return false
  const mid = r.a0 + r.len / 2 + (rng() - 0.5) * Math.max(0, r.len - nw - 6 * s)
  const parts: Array<[BuildingKind, number, number, number, number, RoofKind]> = [
    ['tower', setback, tw, tw, (b.ring >= 4 ? 7.6 : 6.0) * s, 'spire'],
    ['church', setback + tw, nw, nd, (3.4 + rng() * 0.4) * s, 'cross'],
  ]
  const avoid: Rect[] = []
  for (const [kind, back, w, d, h, roof] of parts) {
    ctx.houses.push(building(r, mid, back, w, d, lod, rng, { kind, h, roof, storeys: 1, wall: 0, roofTone: 0, lights: kind === 'church' ? 2 : 0 }))
    avoid.push(rowRect(r, mid - w / 2 - 1.2 * s, mid + w / 2 + 1.2 * s, 0, back + d + 1.2 * s))
  }
  ctx.pads.push({ ...rowRect(r, mid - nw / 2 - 0.6 * s, mid + nw / 2 + 0.6 * s, 0.4 * s, setback - 0.15 * s), kind: 'plaza', v: rng(), lod })
  scatterTrees(ctx, b, rng, 0.45, avoid)
  return true
}

/** Park: lawn, cross paths (drawn by the builder), trees, and in about half of them a playground in one quarter. */
function parkBlock(ctx: Ctx, b: Block, rng: () => number, lod: Lod): void {
  const { s } = ctx
  const avoid: Rect[] = []
  const cx = (b.x0 + b.x1) / 2
  const cz = (b.z0 + b.z1) / 2
  if (b.x1 - b.x0 > 12 * s && b.z1 - b.z0 > 12 * s && rng() < 0.5) {
    const sx = rng() < 0.5 ? -1 : 1
    const sz = rng() < 0.5 ? -1 : 1
    const pw = Math.min((b.x1 - b.x0) / 2 - 2.0 * s, 6.5 * s)
    const pd = Math.min((b.z1 - b.z0) / 2 - 2.0 * s, 5.5 * s)
    const x = cx + sx * (1.0 * s + pw / 2)
    const z = cz + sz * (1.0 * s + pd / 2)
    const pad = { x0: x - pw / 2, x1: x + pw / 2, z0: z - pd / 2, z1: z + pd / 2 }
    ctx.pads.push({ ...pad, kind: 'playground', v: rng(), lod })
    avoid.push(pad)
  }
  scatterTrees(ctx, b, rng, 0.55, avoid)
}

/** Loose grid of trees over a park or a small leftover block, clear of the `avoid` rects. */
function scatterTrees(ctx: Ctx, b: Rect, rng: () => number, density: number, avoid: Rect[] = []): void {
  const { s } = ctx
  const step = 4.2 * s
  const lod = lodOf(Math.hypot((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), ctx.reach)
  for (let x = b.x0 + 1.5 * s; x <= b.x1 - 1.5 * s; x += step) {
    for (let z = b.z0 + 1.5 * s; z <= b.z1 - 1.5 * s; z += step) {
      if (rng() > density) continue
      const jx = Math.max(Math.min(x + (rng() - 0.5) * step * 0.6, b.x1 - 1.4 * s), b.x0 + 1.4 * s)
      const jz = Math.max(Math.min(z + (rng() - 0.5) * step * 0.6, b.z1 - 1.4 * s), b.z0 + 1.4 * s)
      const sc = s * (0.9 + rng() * 0.35)
      if (avoid.some((r) => inside(r, jx, jz, 0.9 * s))) continue
      ctx.trees.push(tree(jx, jz, sc, rng, lod))
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
