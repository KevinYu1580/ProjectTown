import { fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'

export const BASE_LOT_SIZE = 14
// Full gap between two neighbouring lots, sidewalks included (asphalt = ROAD_WIDTH - 2 * SIDEWALK_WIDTH).
export const ROAD_WIDTH = 6
export const SIDEWALK_WIDTH = 1.5

// Crosswalk centre sits this far from the intersection centre, along the road (just outside the intersection).
const CROSSWALK_OFFSET = ROAD_WIDTH / 2 + SIDEWALK_WIDTH
// Sidewalk strip centre is this far outside the lot edge.
const SIDEWALK_MID = SIDEWALK_WIDTH / 2

export function lotScaleFor(count: number): number {
  if (count <= 12) return 1
  if (count <= 20) return 0.8
  return 0.65
}

export interface LotPlacement { index: number; col: number; row: number; x: number; z: number }

export interface TownLayout {
  count: number
  cols: number
  rows: number
  lotScale: number
  lotSize: number // BASE_LOT_SIZE * lotScale
  pitch: number // lotSize + ROAD_WIDTH
  lots: LotPlacement[] // count entries; [] when count = 0
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number } // lots + the outer road ring
  roads: Array<{ x0: number; z0: number; x1: number; z1: number }> // centrelines, outer ring included
  // `axis` is the axis of the road the crosswalk lies on ('z' = road runs along Z, people cross along X).
  crosswalks: Array<{ x: number; z: number; axis: 'x' | 'z' }>
  lamps: Array<{ x: number; z: number }>
  trees: Array<{ x: number; z: number; kind: 'round' | 'cone'; scale: number }>
}

export function computeLayout(count: number): TownLayout {
  const cols = count === 0 ? 1 : Math.ceil(Math.sqrt(count))
  const rows = count === 0 ? 1 : Math.ceil(count / cols)
  const lotScale = lotScaleFor(count)
  const lotSize = BASE_LOT_SIZE * lotScale
  const pitch = lotSize + ROAD_WIDTH
  const half = lotSize / 2

  // Lot centres; col 0 at -X, row 0 at -Z, grid centred on the origin.
  const cx = (col: number) => (col - (cols - 1) / 2) * pitch
  const cz = (row: number) => (row - (rows - 1) / 2) * pitch
  const lots: LotPlacement[] = []
  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    lots.push({ index: i, col, row, x: cx(col), z: cz(row) })
  }
  // n = 0 keeps one empty lot at the origin for the hint.
  const hasCell = (col: number, row: number) =>
    col >= 0 && col < cols && row >= 0 && row < rows && (count === 0 || row * cols + col < count)

  // Road centrelines: line k runs between cell k-1 and cell k.
  const xLines = Array.from({ length: cols + 1 }, (_, k) => (k - cols / 2) * pitch)
  const zLines = Array.from({ length: rows + 1 }, (_, k) => (k - rows / 2) * pitch)
  const minX = xLines[0] - ROAD_WIDTH / 2
  const maxX = xLines[cols] + ROAD_WIDTH / 2
  const minZ = zLines[0] - ROAD_WIDTH / 2
  const maxZ = zLines[rows] + ROAD_WIDTH / 2

  const roads: TownLayout['roads'] = [
    ...xLines.map((x) => ({ x0: x, z0: zLines[0], x1: x, z1: zLines[rows] })),
    ...zLines.map((z) => ({ x0: xLines[0], z0: z, x1: xLines[cols], z1: z })),
  ]

  // Two crosswalks per road edge between neighbouring intersections, only next to existing cells.
  const crosswalks: TownLayout['crosswalks'] = []
  for (let k = 0; k <= cols; k++) {
    for (let j = 0; j < rows; j++) {
      if (!hasCell(k - 1, j) && !hasCell(k, j)) continue
      crosswalks.push({ x: xLines[k], z: zLines[j] + CROSSWALK_OFFSET, axis: 'z' })
      crosswalks.push({ x: xLines[k], z: zLines[j + 1] - CROSSWALK_OFFSET, axis: 'z' })
    }
  }
  for (let k = 0; k <= rows; k++) {
    for (let i = 0; i < cols; i++) {
      if (!hasCell(i, k - 1) && !hasCell(i, k)) continue
      crosswalks.push({ x: xLines[i] + CROSSWALK_OFFSET, z: zLines[k], axis: 'x' })
      crosswalks.push({ x: xLines[i + 1] - CROSSWALK_OFFSET, z: zLines[k], axis: 'x' })
    }
  }

  const lamps: TownLayout['lamps'] = []
  const trees: TownLayout['trees'] = []
  const cell = Array.from({ length: Math.max(count, 1) }, (_, i) => ({ col: i % cols, row: Math.floor(i / cols) }))
  const lampOffset = half + SIDEWALK_MID
  const outsideGap = 3.5

  for (const { col, row } of cell) {
    const x = cx(col)
    const z = cz(row)
    // Lamps on two opposite sidewalk corners per lot (front-right, back-left).
    lamps.push({ x: x + lampOffset, z: z + lampOffset }, { x: x - lampOffset, z: z - lampOffset })

    // Trees: sidewalk mid-edge on back/left/right (front stays clear for the door) plus a few outside the ring.
    const rng = createRng(fnv1a32(`lot:${col},${row}`))
    const tree = (tx: number, tz: number, chance: number) => {
      const p = rng()
      const kind = rng() < 0.5 ? 'round' : 'cone'
      const scale = 0.85 + rng() * 0.4
      if (p < chance) trees.push({ x: tx, z: tz, kind, scale })
    }
    const edge = half + SIDEWALK_MID
    tree(x, z - edge, 0.5)
    tree(x - edge, z, 0.5)
    tree(x + edge, z, 0.5)
    // Outside the outer road ring (jitter keeps the border from looking like a ruler line).
    const jitter = () => (rng() - 0.5) * 3
    const out = outsideGap + rng()
    if (row === 0) tree(x + jitter(), minZ - out, 0.7)
    if (row === rows - 1) tree(x + jitter(), maxZ + out, 0.7)
    if (col === 0) tree(minX - out, z + jitter(), 0.7)
    if (col === cols - 1) tree(maxX + out, z + jitter(), 0.7)
  }

  return {
    count, cols, rows, lotScale, lotSize, pitch, lots,
    bounds: { minX, maxX, minZ, maxZ },
    roads, crosswalks, lamps, trees,
  }
}
