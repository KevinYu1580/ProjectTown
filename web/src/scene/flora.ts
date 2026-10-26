// Voxel plants shared by the street, parks and lots: axis-aligned boxes in palette ramps (shadow / mid / light),
// big enough to read at the town camera distance. Canopies and blooms sway in the wind (see voxel.ts).
import { PAL, type Ramp } from './palette'
import { material, type VoxelBuilder } from './voxel'

const TREE_SWAY = 0.03 // metres of sway per metre above the ground
const BUSH_SWAY = 0.05
const FLOWER_SWAY = 0.16

export type TreeKind = 'round' | 'cone'

/** Mostly green; in town a few blossom and sunny golden-green crowns keep it lively. `v` in [0, 1). */
function crown(v: number): Ramp {
  if (v < 0.1) return PAL.blossom
  if (v < 0.18) return PAL.golden
  return PAL.leaf
}

/**
 * Tree standing at (x, y, z); `v` in [0, 1) picks the crown colour and lobe layout. Field trees pass v >= 0.2
 * (always green) so the countryside stays calm.
 */
export function voxelTree(b: VoxelBuilder, x: number, y: number, z: number, kind: TreeKind, s: number, v: number): void {
  const m = material
  if (kind === 'cone') {
    const [d, mid, l] = PAL.pine
    b.box(x, y, z, 0.32 * s, 0.9 * s, 0.32 * s, m(PAL.trunk[0]))
    const tiers: Array<[number, number, number, number]> = [
      [2.3, 0.75, 0.75, d], [1.8, 0.75, 1.45, mid], [1.3, 0.7, 2.1, mid], [0.8, 0.65, 2.7, l], [0.36, 0.45, 3.3, l],
    ]
    for (const [w, h, py, c] of tiers) b.box(x, y + py * s, z, w * s, h * s, w * s, m(c), TREE_SWAY, y)
    return
  }
  // Crown built from cross sections (a plus shape from above), so it reads round rather than as a crate.
  const [d, mid, l] = crown(v)
  const side = v * 7 % 1 < 0.5 ? 1 : -1
  b.box(x, y, z, 0.36 * s, 1.5 * s, 0.36 * s, m(PAL.trunk[1]))
  b.box(x, y + 1.2 * s, z, 1.9 * s, 1.5 * s, 1.9 * s, m(mid), TREE_SWAY, y)
  b.box(x, y + 1.45 * s, z, 2.6 * s, 0.95 * s, 1.3 * s, m(mid), TREE_SWAY, y)
  b.box(x, y + 1.35 * s, z, 1.3 * s, 0.95 * s, 2.6 * s, m(d), TREE_SWAY, y)
  b.box(x + side * 0.35 * s, y + 2.7 * s, z - 0.15 * s, 1.25 * s, 0.5 * s, 1.25 * s, m(l), TREE_SWAY, y)
  b.box(x - side * 0.75 * s, y + 2.35 * s, z + 0.55 * s, 0.75 * s, 0.45 * s, 0.75 * s, m(l), TREE_SWAY, y)
}

/** Low round shrub; some carry a few blooms. */
export function voxelBush(b: VoxelBuilder, x: number, y: number, z: number, s: number, v: number): void {
  const [, mid, l] = PAL.hedge
  b.box(x, y, z, 1.1 * s, 0.55 * s, 0.9 * s, material(mid), BUSH_SWAY, y)
  b.box(x + 0.12 * s, y + 0.5 * s, z - 0.05 * s, 0.65 * s, 0.3 * s, 0.55 * s, material(l), BUSH_SWAY, y)
  if (v < 0.45) {
    const c = material(PAL.flowers[Math.floor(v * 97) % PAL.flowers.length])
    b.box(x - 0.3 * s, y + 0.5 * s, z + 0.25 * s, 0.2 * s, 0.16 * s, 0.2 * s, c, BUSH_SWAY, y)
    b.box(x + 0.35 * s, y + 0.45 * s, z + 0.3 * s, 0.2 * s, 0.16 * s, 0.2 * s, c, BUSH_SWAY, y)
  }
}

/** One flower: leafy tuft plus a bloom. */
export function flower(b: VoxelBuilder, x: number, y: number, z: number, color: number, s = 1): void {
  b.box(x, y, z, 0.26 * s, 0.2 * s, 0.26 * s, material(PAL.lawn[2]), FLOWER_SWAY, y)
  b.box(x, y + 0.2 * s, z, 0.2 * s, 0.16 * s, 0.2 * s, material(color), FLOWER_SWAY, y)
}

/** Flower bed w x d centred at (x, z) on a soil tray; rows of blooms, colours from `pick` (index into PAL.flowers). */
export function flowerBed(b: VoxelBuilder, x: number, y: number, z: number, w: number, d: number, pick: (i: number) => number): void {
  b.box(x, y, z, w, 0.14, d, material(PAL.soil[1]))
  const nx = Math.max(1, Math.floor(w / 0.45))
  const nz = Math.max(1, Math.floor(d / 0.45))
  let i = 0
  for (let ix = 0; ix < nx; ix++) {
    for (let iz = 0; iz < nz; iz++) {
      const fx = x - w / 2 + (ix + 0.5) * (w / nx)
      const fz = z - d / 2 + (iz + 0.5) * (d / nz)
      flower(b, fx, y + 0.14, fz, PAL.flowers[pick(i++) % PAL.flowers.length])
    }
  }
}

/** Clipped hedge along x or z, with a lighter sunlit top. */
export function hedge(b: VoxelBuilder, x: number, y: number, z: number, w: number, d: number, h = 0.6): void {
  b.box(x, y, z, w, h, d, material(PAL.hedge[1]))
  b.box(x, y + h, z, w - 0.08, 0.12, d - 0.08, material(PAL.hedge[2]))
}

/** Planter box under a window on a wall facing `facing`, with a row of blooms; (x, y, z) = box bottom on the wall. */
export function windowBox(b: VoxelBuilder, x: number, y: number, z: number, w: number, facing: 'x+' | 'x-' | 'z+' | 'z-', pick: (i: number) => number): void {
  const out = facing.endsWith('+') ? 1 : -1
  const alongX = facing[0] === 'z'
  const d = 0.28
  const cx = alongX ? x : x + (out * d) / 2
  const cz = alongX ? z + (out * d) / 2 : z
  b.box(cx, y, cz, alongX ? w : d, 0.22, alongX ? d : w, material(PAL.wood[1]))
  const n = Math.max(2, Math.round(w / 0.34))
  for (let i = 0; i < n; i++) {
    const o = -w / 2 + (i + 0.5) * (w / n)
    flower(b, alongX ? cx + o : cx, y + 0.22, alongX ? cz : cz + o, PAL.flowers[pick(i) % PAL.flowers.length], 0.8)
  }
}
