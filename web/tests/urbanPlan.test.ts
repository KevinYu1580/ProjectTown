import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FIT_PITCH, FOV_DEG, TARGET_HEIGHT, VIEW_SHIFT, cameraPosition, fitDistance } from '../src/scene/cameraMath'
import { ROAD_WIDTH, VERGE_W, computeLayout, type TownLayout } from '../src/scene/layout'
import {
  CAP, CAR_OFFSET, HEIGHT_CAP, LANE_HALF, LANE_W, LITE_CAP, MAIN_HALF, MAX_STYLE_HEIGHT,
  carPose, footprint, inHood, overlaps, planOutskirts, roofRise, routePoint, viewReach,
  type OutskirtsPlan, type Rect,
} from '../src/scene/outskirts/urbanPlan'
import { BODY, walkerPose, type Walker } from '../src/scene/outskirts/walkers'

const COUNTS = [0, 1, 4, 6, 10, 13, 20, 25]
const ASPECTS = [16 / 9, 16 / 10, 3 / 2]
const plan = (n: number, seed = 1, lite = false) => planOutskirts(computeLayout(n), { seed, lite })

/** Ground points along the four frame edges of the default view (zoom 1, pitch FIT_PITCH) at one azimuth. */
function frameEdge(layout: TownLayout, height: number, aspect: number, az: number, perEdge = 16): THREE.Vector2[] {
  const w = 1600
  const h = w / aspect
  const cam = new THREE.PerspectiveCamera(FOV_DEG, aspect, 1, 3000)
  cam.setViewOffset(w, h, -w * VIEW_SHIFT.x, h * VIEW_SHIFT.y, w, h)
  const target: [number, number, number] = [0, height * TARGET_HEIGHT, 0]
  cam.position.set(...cameraPosition(target, fitDistance(layout.bounds, height, aspect), az, FIT_PITCH))
  cam.lookAt(...target)
  cam.updateMatrixWorld(true)
  const out: THREE.Vector2[] = []
  for (let i = 0; i <= perEdge; i++) {
    const t = -1 + (2 * i) / perEdge
    for (const [x, y] of [[-1, t], [1, t], [t, -1], [t, 1]]) {
      const p = new THREE.Vector3(x, y, 0.5).unproject(cam)
      const dir = p.sub(cam.position)
      const k = -cam.position.y / dir.y
      out.push(new THREE.Vector2(cam.position.x + dir.x * k, cam.position.z + dir.z * k))
    }
  }
  return out
}

/** Streets as rects: the town's road lines run on across the plate, lanes span the neighbourhood. */
function streets(p: OutskirtsPlan): Rect[] {
  const { plate } = p
  return [
    ...p.mains.x.map((x) => ({ x0: x - MAIN_HALF, x1: x + MAIN_HALF, z0: plate.z0, z1: plate.z1 })),
    ...p.mains.z.map((z) => ({ x0: plate.x0, x1: plate.x1, z0: z - MAIN_HALF, z1: z + MAIN_HALF })),
    ...p.lanes.map((l) =>
      l.axis === 'x'
        ? { x0: l.from - LANE_HALF, x1: l.to + LANE_HALF, z0: l.at - LANE_HALF, z1: l.at + LANE_HALF }
        : { x0: l.at - LANE_HALF, x1: l.at + LANE_HALF, z0: l.from - LANE_HALF, z1: l.to + LANE_HALF },
    ),
  ]
}

const verge = (layout: TownLayout): Rect => {
  const b = layout.bounds
  return { x0: b.minX - VERGE_W, x1: b.maxX + VERGE_W, z0: b.minZ - VERGE_W, z1: b.maxZ + VERGE_W }
}
const inRect = (r: Rect, x: number, z: number, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad
/** Ring of the grid cell at (x, z): 1 next to the town, counting outward in lane pitches. */
const ringAt = (layout: TownLayout, x: number, z: number): number => Math.max(
  Math.ceil((Math.abs(x) - (layout.cols / 2) * layout.pitch) / layout.pitch),
  Math.ceil((Math.abs(z) - (layout.rows / 2) * layout.pitch) / layout.pitch),
)

describe('viewReach', () => {
  it('is the farthest ground point of the default view, for the tallest town, at any azimuth', () => {
    for (const n of COUNTS) {
      const layout = computeLayout(n)
      const tallest = Math.max(6, MAX_STYLE_HEIGHT * layout.lotScale) + 4
      for (const aspect of ASPECTS) {
        let far = 0
        for (let az = 0; az < 360; az += 15) for (const g of frameEdge(layout, tallest, aspect, az)) far = Math.max(far, g.length())
        expect(far, `n=${n} aspect=${aspect.toFixed(2)}`).toBeLessThanOrEqual(viewReach(layout) + 1e-6)
        if (aspect === 16 / 9) expect(far, `n=${n}`).toBeGreaterThan(0.99 * viewReach(layout))
      }
    }
  })
})

describe('planOutskirts', () => {
  it('is deterministic for a seed', () => {
    for (const n of [1, 6, 25]) {
      expect(plan(n, 7)).toEqual(plan(n, 7))
      expect(plan(n, 7, true)).toEqual(plan(n, 7, true))
    }
    expect(plan(6, 7).houses).not.toEqual(plan(6, 8).houses)
  })

  it('fills the frame edges of the default view at every orbit angle (16:9, 16:10, 3:2)', () => {
    for (const n of COUNTS) {
      const layout = computeLayout(n)
      const p = plan(n)
      const pitch = layout.pitch
      // Houses and trees by grid cell, to find the nearest one quickly.
      const cells = new Map<string, Array<{ x: number; z: number }>>()
      const key = (x: number, z: number) => `${Math.floor(x / pitch)},${Math.floor(z / pitch)}`
      for (const o of [...p.houses, ...p.trees]) {
        const k = key(o.x, o.z)
        cells.set(k, [...(cells.get(k) ?? []), o])
      }
      const near = (x: number, z: number): number => {
        let best = Infinity
        for (let i = -1; i <= 1; i++) {
          for (let j = -1; j <= 1; j++) {
            for (const o of cells.get(key(x + i * pitch, z + j * pitch)) ?? []) best = Math.min(best, Math.hypot(o.x - x, o.z - z))
          }
        }
        return best
      }
      const tallest = Math.max(6, MAX_STYLE_HEIGHT * layout.lotScale) + 4
      const bad: string[] = []
      for (const height of [10, tallest]) {
        for (const aspect of ASPECTS) {
          for (let az = 0; az < 360; az += 10) {
            for (const g of frameEdge(layout, height, aspect, az)) {
              const at = `h=${height} aspect=${aspect.toFixed(2)} az=${az} (${g.x.toFixed(0)}, ${g.y.toFixed(0)})`
              // Inside the neighbourhood (never the countryside band or the plate edge), and outside the town and its
              // verge never far from a house or a tree.
              if (!inHood(p, g.x, g.y)) bad.push(`outside: ${at}`)
              else if (!inRect(verge(layout), g.x, g.y, ROAD_WIDTH) && near(g.x, g.y) >= pitch) bad.push(`empty: ${at}`)
            }
          }
        }
      }
      expect(bad, `n=${n}`).toEqual([])
    }
  })

  it('keeps houses, trees, parked cars and open spaces off the town, its verge, every street and each other', () => {
    for (const n of COUNTS) {
      const layout = computeLayout(n)
      for (const lite of [false, true]) {
        const p = plan(n, 3, lite)
        const roads = streets(p)
        const garden = verge(layout)
        const eave = 0.22 * p.scale
        const bad: string[] = []
        const houses = p.houses.map(footprint)
        houses.forEach((fp, i) => {
          const h = p.houses[i]
          if (overlaps(fp, garden, eave) || roads.some((r) => overlaps(fp, r, eave)) || !inHood(p, h.x, h.z)) bad.push(`house ${h.x.toFixed(1)},${h.z.toFixed(1)}`)
        })
        for (const t of [...p.trees, ...p.parked]) {
          const hit = inRect(garden, t.x, t.z) || roads.some((r) => inRect(r, t.x, t.z)) || houses.some((fp) => inRect(fp, t.x, t.z, 0.3 * p.scale))
          if (hit) bad.push(`tree/car ${t.x.toFixed(1)},${t.z.toFixed(1)}`)
        }
        for (const b of p.blocks) if (overlaps(b, garden) || roads.some((r) => overlaps(b, r, -1e-6))) bad.push(`block ${b.x0.toFixed(1)},${b.z0.toFixed(1)}`)
        p.pads.forEach((pad, i) => {
          const at = `${pad.kind} ${pad.x0.toFixed(1)},${pad.z0.toFixed(1)}`
          if (!p.blocks.some((b) => b.x0 <= pad.x0 + 1e-6 && pad.x1 <= b.x1 + 1e-6 && b.z0 <= pad.z0 + 1e-6 && pad.z1 <= b.z1 + 1e-6)) bad.push(`pad outside its block: ${at}`)
          if (houses.some((fp) => overlaps(fp, pad, -1e-6))) bad.push(`pad under a house: ${at}`)
          if (p.pads.some((o, j) => j > i && overlaps(o, pad, -1e-6))) bad.push(`pads overlap: ${at}`)
          if (p.trees.some((t) => inRect(pad, t.x, t.z))) bad.push(`tree on a pad: ${at}`)
        })
        expect(bad, `n=${n} lite=${lite}`).toEqual([])
      }
    }
  })

  it('keeps the town the tallest thing nearby: buildings grow taller only farther out, landmarks are rare', () => {
    // In the two rings round the town nothing reaches the lowest town building style (the warehouse, 6.15 at scale 1).
    expect(HEIGHT_CAP[1]).toBeLessThan(6.15)
    expect(HEIGHT_CAP[2]).toBeLessThan(6.15)
    for (const n of [...COUNTS, 36]) {
      const layout = computeLayout(n)
      for (const seed of [1, 2, 3]) {
        const p = plan(n, seed)
        const bad: string[] = []
        for (const h of p.houses) {
          const ring = ringAt(layout, h.x, h.z)
          const top = h.h + roofRise(h) * p.scale
          if (top > HEIGHT_CAP[Math.min(ring, 4)] * p.scale + 1e-6) bad.push(`${h.kind} ring ${ring}: ${(top / p.scale).toFixed(2)}`)
          if (['flats', 'school', 'church', 'tower'].includes(h.kind) && ring < 3) bad.push(`${h.kind} in ring ${ring}`)
        }
        const count = (kind: string) => p.houses.filter((h) => h.kind === kind).length
        expect(count('church'), `n=${n} seed=${seed}`).toBeLessThanOrEqual(2)
        expect(count('tower')).toBe(count('church'))
        expect(count('school'), `n=${n} seed=${seed}`).toBeLessThanOrEqual(3)
        expect(bad, `n=${n} seed=${seed}`).toEqual([])
      }
    }
  })

  it('mixes building kinds, sizes, setbacks, roofs, colours and open spaces', () => {
    for (const n of [1, 6, 25]) {
      for (const seed of [1, 4]) {
        const p = plan(n, seed)
        const at = `n=${n} seed=${seed}`
        const kinds = new Set(p.houses.map((h) => h.kind))
        for (const k of ['house', 'terrace', 'shop', 'flats', 'works'] as const) expect(kinds.has(k), `${at} ${k}`).toBe(true)
        expect(new Set(p.pads.map((q) => q.kind)).size, at).toBeGreaterThanOrEqual(5)
        const homes = p.houses.filter((h) => h.kind === 'house')
        expect(new Set(homes.map((h) => h.roof)).size, at).toBe(5)
        expect(new Set(homes.map((h) => h.wall)).size, at).toBeGreaterThanOrEqual(10)
        expect(homes.some((h) => h.annex !== 0), at).toBe(true)
        // Widths and setbacks (front wall to the street edge) spread out rather than repeat.
        const spread = (v: number[]) => {
          const mean = v.reduce((a, b) => a + b, 0) / v.length
          return Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length) / mean
        }
        expect(spread(homes.map((h) => h.w)), at).toBeGreaterThan(0.15)
        expect(spread(homes.map((h) => Math.abs(h.front - (h.facing[0] === 'z' ? h.z : h.x)) - h.d / 2)), at).toBeGreaterThan(0.2)
        expect(new Set(p.blocks.map((b) => b.kind)).size, at).toBeGreaterThanOrEqual(6)
      }
    }
  })

  it('never lets two houses overlap (terrace houses may touch)', () => {
    for (const n of [0, 6, 25]) {
      const hs = plan(n).houses.map(footprint)
      const bad: string[] = []
      for (let i = 0; i < hs.length; i++) {
        for (let j = i + 1; j < hs.length; j++) if (overlaps(hs[i], hs[j], -1e-6)) bad.push(`${i}/${j}`)
      }
      expect(bad, `n=${n}`).toEqual([])
    }
  })

  it('keeps the pond park clear of houses', () => {
    for (const n of [1, 6, 25]) {
      const p = plan(n)
      expect(p.pond).not.toBeNull()
      const { x, z, rx, rz } = p.pond!
      const water = { x0: x - rx - 1, x1: x + rx + 1, z0: z - rz - 1, z1: z + rz + 1 }
      for (const h of p.houses) expect(overlaps(footprint(h), water)).toBe(false)
      for (const r of streets(p)) expect(overlaps(water, r)).toBe(false)
    }
  })

  it('adapts to the town: the neighbourhood starts past the verge and reaches past the view', () => {
    for (const n of COUNTS) {
      const layout = computeLayout(n)
      const p = plan(n)
      const v = verge(layout)
      expect(p.hood.x1).toBeGreaterThan(p.reach)
      expect(p.hood.z1).toBeGreaterThan(p.reach)
      expect(p.plate.x1).toBeGreaterThan(p.hood.x1)
      expect(p.plate.z1).toBeGreaterThan(p.hood.z1)
      for (const l of p.lanes) expect(Math.abs(l.at)).toBeGreaterThan(l.axis === 'z' ? v.x1 : v.z1)
      expect(p.scale).toBe(layout.lotScale)
    }
    expect(plan(25).hood.x1).toBeGreaterThan(plan(1).hood.x1)
    expect(plan(25).lanes.length).toBeGreaterThan(plan(1).lanes.length)
    expect(plan(6).houses.length).toBeGreaterThan(plan(1).houses.length)
  })

  it('respects the caps, and the lite plan is the nearest, simplest part', () => {
    for (const n of [...COUNTS, 36, 49]) {
      const full = plan(n)
      expect(full.houses.length).toBeLessThanOrEqual(CAP.houses * 1.5)
      expect(full.trees.length).toBeLessThanOrEqual(CAP.trees * 1.5)
      expect(full.cars.length).toBeLessThanOrEqual(CAP.cars)
      expect(full.parked.length).toBeLessThanOrEqual(CAP.parked)
      const lite = plan(n, 1, true)
      expect(lite.houses.length).toBeLessThanOrEqual(LITE_CAP.houses)
      expect(lite.trees.length).toBeLessThanOrEqual(LITE_CAP.trees)
      expect(lite.cars.length).toBeLessThanOrEqual(LITE_CAP.cars)
      expect(lite.parked).toEqual([])
      expect(lite.houses.every((h) => h.lod === 2 && h.lights === 0)).toBe(true)
      expect(lite.pads.every((q) => q.lod === 2)).toBe(true)
      expect(lite.routes.length).toBe(1)
      // Same streets and plate either way; lite keeps the houses nearest the town.
      expect(lite.plate).toEqual(full.plate)
      const far = Math.max(...lite.houses.map((h) => Math.hypot(h.x, h.z)))
      if (lite.houses.length === LITE_CAP.houses) expect(full.houses.filter((h) => Math.hypot(h.x, h.z) < far - 1).length).toBeLessThanOrEqual(LITE_CAP.houses)
    }
  })
})

describe('cars', () => {
  const onLane = (p: OutskirtsPlan, x: number, z: number, margin: number): boolean =>
    p.lanes.some((l) => {
      const [across, along] = l.axis === 'x' ? [z, x] : [x, z]
      return Math.abs(across - l.at) <= LANE_W / 2 - margin && along >= l.from - LANE_W / 2 && along <= l.to + LANE_W / 2
    })

  it('drive on the lanes, never in town, at any time', () => {
    for (const n of [0, 1, 6, 25]) {
      for (const lite of [false, true]) {
        const p = plan(n, 1, lite)
        expect(p.cars.length).toBeGreaterThan(0)
        for (const car of p.cars) {
          for (const t of [0, 1.7, 41.3, 333, 9999]) {
            const { x, z } = carPose(p.routes[car.route], car, t)
            const at = `n=${n} t=${t} (${x.toFixed(2)}, ${z.toFixed(2)})`
            expect(onLane(p, x, z, 0.4 * p.scale), at).toBe(true)
            expect(inRect(verge(computeLayout(n)), x, z), at).toBe(false)
          }
        }
      }
    }
  })

  it('keep to the right of the centreline on the straights', () => {
    const p = plan(6)
    for (const car of p.cars) {
      const route = p.routes[car.route]
      const s = 3 // a few metres into the first straight (+X along the lower side)
      const t = (s - car.s0) / (car.dir * car.speed)
      const pose = carPose(route, car, t)
      const c = routePoint(route, s)
      // Heading (dir * +X); its right-hand side is (-hz, hx) = (0, dir).
      expect(pose.z - c.z).toBeCloseTo(car.dir * CAR_OFFSET, 6)
    }
  })

  it('move smoothly around a closed loop', () => {
    const p = plan(6)
    for (const route of p.routes) {
      const step = 0.05
      let prev = routePoint(route, 0)
      for (let s = step; s <= route.length; s += step) {
        const q = routePoint(route, s)
        expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(step * 1.01)
        expect(Math.hypot(q.hx, q.hz)).toBeCloseTo(1, 6)
        prev = q
      }
      const a = routePoint(route, 0)
      const b = routePoint(route, route.length)
      expect(b.x).toBeCloseTo(a.x, 6)
      expect(b.z).toBeCloseTo(a.z, 6)
    }
    const car = p.cars[0]
    const lap = p.routes[car.route].length / car.speed
    const a = carPose(p.routes[car.route], car, 10)
    const b = carPose(p.routes[car.route], car, 10 + lap)
    expect(b.x).toBeCloseTo(a.x, 4)
    expect(b.z).toBeCloseTo(a.z, 4)
  })
})

/** The closest any two walkers come in two minutes, in bodies. */
function closest(walkers: Walker[]): number {
  let min = Infinity
  for (let t = 0; t < 120; t += 0.25) {
    const at = walkers.map((w) => walkerPose(w, t))
    for (let i = 0; i < at.length; i++)
      for (let j = i + 1; j < at.length; j++) min = Math.min(min, Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z) / (BODY * walkers[i].s))
  }
  return min
}

describe('walkers', () => {
  it("pace the sidewalks of the town's roads, outside the town, at any time", () => {
    for (const n of [1, 6, 25]) {
      const p = plan(n)
      const town = computeLayout(n).bounds
      expect(p.walkers.length).toBe(CAP.walkers)
      for (const w of p.walkers) {
        for (const t of [0, 1.7, 41.3, 333, 9999]) {
          const { x, z } = walkerPose(w, t)
          const at = `n=${n} t=${t} (${x.toFixed(2)}, ${z.toFixed(2)})`
          const onWalk = p.exits.some((e) => {
            const [across, along] = e.axis === 'z' ? [x, z] : [z, x]
            const off = Math.abs(across - e.at)
            const half = (BODY / 2) * w.s // the whole body on the sidewalk
            return off >= MAIN_HALF - 1.5 + half && off <= MAIN_HALF - half && along >= Math.min(e.from, e.to) && along <= Math.max(e.from, e.to)
          })
          expect(onWalk, at).toBe(true)
          expect(x > town.minX && x < town.maxX && z > town.minZ && z < town.maxZ, at).toBe(false)
        }
      }
    }
  })

  it('keep a body apart, as two could not pass on a sidewalk', () => {
    for (const n of [1, 6, 25]) expect(closest(plan(n).walkers), `n=${n}`).toBeGreaterThanOrEqual(1)
  })

  it('stroll without jumping, turning round where they stop', () => {
    for (const w of plan(6).walkers) {
      let prev = walkerPose(w, 0)
      for (let t = 0.1; t < 200; t += 0.1) {
        const q = walkerPose(w, t)
        expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(w.speed * 0.1 * 1.01)
        prev = q
      }
    }
  })

  it('are left out of the lite plan, and the busier traffic fills a big town up to the cap', () => {
    expect(plan(6, 1, true).walkers).toEqual([])
    expect(plan(25).cars.length).toBe(CAP.cars)
    expect(plan(25).parked.length).toBeGreaterThan(36)
  })
})
