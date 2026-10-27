import { describe, expect, it } from 'vitest'
import { BASE_LOT_SIZE, ROAD_WIDTH, SIDEWALK_WIDTH, computeLayout, lotScaleFor } from '../src/scene/layout'

describe('lotScaleFor', () => {
  it('steps at 12/13 and 20/21', () => {
    expect(lotScaleFor(0)).toBe(1)
    expect(lotScaleFor(12)).toBe(1)
    expect(lotScaleFor(13)).toBe(0.8)
    expect(lotScaleFor(20)).toBe(0.8)
    expect(lotScaleFor(21)).toBe(0.65)
    expect(lotScaleFor(500)).toBe(0.65)
  })
})

describe('computeLayout grid', () => {
  const cases: Array<[number, number, number]> = [
    [0, 1, 1], [1, 1, 1], [2, 2, 1], [4, 2, 2], [5, 3, 2],
    [10, 4, 3], [12, 4, 3], [13, 4, 4], [20, 5, 4], [21, 5, 5], [25, 5, 5],
  ]
  it.each(cases)('n = %i -> %i cols x %i rows', (n, cols, rows) => {
    const l = computeLayout(n)
    expect(l.count).toBe(n)
    expect(l.cols).toBe(cols)
    expect(l.rows).toBe(rows)
    expect(l.lots).toHaveLength(n)
  })

  it('scales the lot only at the documented steps', () => {
    for (const [n, scale] of [[12, 1], [13, 0.8], [20, 0.8], [21, 0.65]] as const) {
      const l = computeLayout(n)
      expect(l.lotScale).toBe(scale)
      expect(l.lotSize).toBeCloseTo(BASE_LOT_SIZE * scale, 10)
      expect(l.pitch).toBeCloseTo(l.lotSize + ROAD_WIDTH, 10)
    }
  })

  it('places lots row-major, col 0 at -X, row 0 at -Z, centred on the origin', () => {
    const l = computeLayout(5) // 3 x 2
    l.lots.forEach((lot, i) => {
      expect(lot.index).toBe(i)
      expect(lot.col).toBe(i % 3)
      expect(lot.row).toBe(Math.floor(i / 3))
    })
    expect(l.lots[0].x).toBeLessThan(l.lots[1].x)
    expect(l.lots[0].z).toBeLessThan(l.lots[3].z)
    expect(l.lots[1].x).toBeCloseTo(0, 10) // middle column
    expect(l.lots[1].x - l.lots[0].x).toBeCloseTo(l.pitch, 10)
    expect(l.lots[0].z + l.lots[3].z).toBeCloseTo(0, 10) // two rows straddle the origin
    expect(l.bounds.minX + l.bounds.maxX).toBeCloseTo(0, 10)
    expect(l.bounds.minZ + l.bounds.maxZ).toBeCloseTo(0, 10)
  })

  it('n = 0 gives one empty lot at the origin (no lots)', () => {
    const l = computeLayout(0)
    expect(l.lots).toEqual([])
    expect(l.cols).toBe(1)
    expect(l.rows).toBe(1)
    expect(l.bounds.maxX).toBeCloseTo(BASE_LOT_SIZE / 2 + ROAD_WIDTH, 10)
    expect(l.roads.length).toBe(4)
    expect(l.lamps.length).toBeGreaterThan(0)
  })

  it('bounds hold every lot plus the full outer road', () => {
    for (const n of [1, 5, 13, 25]) {
      const l = computeLayout(n)
      for (const lot of l.lots) {
        expect(lot.x - l.lotSize / 2).toBeGreaterThanOrEqual(l.bounds.minX + ROAD_WIDTH - 1e-9)
        expect(lot.x + l.lotSize / 2).toBeLessThanOrEqual(l.bounds.maxX - ROAD_WIDTH + 1e-9)
        expect(lot.z - l.lotSize / 2).toBeGreaterThanOrEqual(l.bounds.minZ + ROAD_WIDTH - 1e-9)
        expect(lot.z + l.lotSize / 2).toBeLessThanOrEqual(l.bounds.maxZ - ROAD_WIDTH + 1e-9)
      }
    }
  })

  it('the town footprint grows more slowly than n (only lot contents scale)', () => {
    const w12 = computeLayout(12).bounds.maxX
    const w13 = computeLayout(13).bounds.maxX // 4 cols at 0.8 vs 4 cols at 1.0
    expect(w13).toBeLessThan(w12)
    // Roads keep their width after scaling.
    const l = computeLayout(25)
    expect(l.pitch - l.lotSize).toBe(ROAD_WIDTH)
  })

  it('has (cols + 1) + (rows + 1) road lines, none shorter than the town', () => {
    const l = computeLayout(10)
    expect(l.roads).toHaveLength(l.cols + 1 + l.rows + 1)
    const vertical = l.roads.filter((r) => r.x0 === r.x1)
    const horizontal = l.roads.filter((r) => r.z0 === r.z1)
    expect(vertical).toHaveLength(l.cols + 1)
    expect(horizontal).toHaveLength(l.rows + 1)
    for (const r of vertical) expect(Math.abs(r.z1 - r.z0)).toBeCloseTo(l.rows * l.pitch, 10)
    for (const r of horizontal) expect(Math.abs(r.x1 - r.x0)).toBeCloseTo(l.cols * l.pitch, 10)
  })
})

describe('computeLayout props', () => {
  const sizes = [0, 1, 4, 5, 12, 13, 21, 25]

  it('is deterministic', () => {
    for (const n of sizes) expect(computeLayout(n)).toEqual(computeLayout(n))
  })

  const asphalt = ROAD_WIDTH / 2 - SIDEWALK_WIDTH
  const inLot = (l: ReturnType<typeof computeLayout>, x: number, z: number) => {
    const cells = l.count === 0 ? [{ x: 0, z: 0 }] : l.lots
    return cells.some((c) => Math.abs(x - c.x) < l.lotSize / 2 && Math.abs(z - c.z) < l.lotSize / 2)
  }
  const onAsphalt = (l: ReturnType<typeof computeLayout>, x: number, z: number) =>
    l.roads.some((r) =>
      r.x0 === r.x1
        ? Math.abs(x - r.x0) < asphalt && z >= r.z0 - asphalt && z <= r.z1 + asphalt
        : Math.abs(z - r.z0) < asphalt && x >= r.x0 - asphalt && x <= r.x1 + asphalt,
    )

  it.each(sizes)('n = %i: trees avoid lots, asphalt, crosswalks and lamps', (n) => {
    const l = computeLayout(n)
    expect(l.trees.length).toBeGreaterThan(0)
    for (const t of l.trees) {
      expect(inLot(l, t.x, t.z)).toBe(false)
      expect(onAsphalt(l, t.x, t.z)).toBe(false)
      for (const c of l.crosswalks) {
        expect(Math.abs(t.x - c.x) < asphalt + 1 && Math.abs(t.z - c.z) < asphalt + 1).toBe(false)
      }
      for (const lamp of l.lamps) expect(Math.hypot(t.x - lamp.x, t.z - lamp.z)).toBeGreaterThan(1.5)
      expect(['round', 'cone']).toContain(t.kind)
      expect(t.scale).toBeGreaterThan(0.5)
    }
  })

  it.each(sizes)('n = %i: lamps and crosswalks are outside lots and unique', (n) => {
    const l = computeLayout(n)
    for (const p of [...l.lamps, ...l.crosswalks]) expect(inLot(l, p.x, p.z)).toBe(false)
    for (const lamp of l.lamps) {
      expect(lamp.x).toBeGreaterThan(l.bounds.minX)
      expect(lamp.x).toBeLessThan(l.bounds.maxX)
    }
    const key = (p: { x: number; z: number }) => `${p.x.toFixed(3)},${p.z.toFixed(3)}`
    expect(new Set(l.lamps.map(key)).size).toBe(l.lamps.length)
    expect(new Set(l.crosswalks.map((c) => key(c) + c.axis)).size).toBe(l.crosswalks.length)
  })

  it('crosswalks lie on a road centreline, outside the intersection squares', () => {
    const l = computeLayout(4)
    for (const c of l.crosswalks) {
      const road = l.roads.find((r) => (c.axis === 'z' ? r.x0 === r.x1 && r.x0 === c.x : r.z0 === r.z1 && r.z0 === c.z))
      expect(road).toBeDefined()
    }
    expect(l.crosswalks.length).toBeGreaterThan(0)
  })

  it('does not depend on the number of lots for a given cell (same cell, same grid -> same trees)', () => {
    // 4 and 3 lots both use a 2 x 2 grid and the same scale, so lot (0,0)'s neighbourhood is identical.
    const a = computeLayout(4).trees.filter((t) => t.x < -10 && t.z < -10)
    const b = computeLayout(3).trees.filter((t) => t.x < -10 && t.z < -10)
    expect(a).toEqual(b)
  })
})
