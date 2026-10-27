import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { FIT_PITCH, FOV_DEG, TARGET_HEIGHT, VIEW_SHIFT, cameraPosition, fitDistance } from '../src/scene/cameraMath'
import { computeLayout, type TownLayout } from '../src/scene/layout'
import {
  BANK, CAP, CLEAR, FROZEN_T, LITE_CAP, MAX_STYLE_HEIGHT, RIPARIAN, TERRACE_W,
  grow, hillTierRadius, inRect, overlaps, planOutskirts, riverSpan, riverX, routePoint, tractorPose, trainPose, viewReach,
  type OutskirtsPlan, type Rect,
} from '../src/scene/outskirts/pastoralPlan'

const COUNTS = [0, 1, 4, 6, 10, 13, 20, 25]
const ASPECTS = [16 / 9, 16 / 10, 3 / 2]
const cache = new Map<string, OutskirtsPlan>()
const plan = (n: number, seed = 1, lite = false): OutskirtsPlan => {
  const key = `${n}:${seed}:${lite}`
  if (!cache.has(key)) cache.set(key, planOutskirts(computeLayout(n), { seed, lite }))
  return cache.get(key)!
}

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

const distTo = (r: Rect, x: number, z: number): number => Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1))
const square = (x: number, z: number, h: number): Rect => ({ x0: x - h, x1: x + h, z0: z - h, z1: z + h })
/** Water and banks of the river over the z range of `r`, as a rect. */
const riverBand = (p: OutskirtsPlan, r: Rect, pad = BANK): Rect => {
  const [x0, x1] = riverSpan(p.river, r.z0, r.z1, pad)
  return { x0, x1, z0: r.z0, z1: r.z1 }
}
const ballast = (p: OutskirtsPlan): Rect => ({ x0: p.rail.x0, x1: p.rail.x1, z0: p.rail.z - p.rail.half, z1: p.rail.z + p.rail.half })
const town = (p: OutskirtsPlan): Rect => grow(p.terrace, CLEAR)
const footprint = (h: OutskirtsPlan['hills'][number]): Rect => square(h.x, h.z, hillTierRadius(h, 0))
const mound = (w: OutskirtsPlan['windmills'][number]): Rect => square(w.x, w.z, w.mound)

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
      expect(planOutskirts(computeLayout(n), { seed: 7, lite: false })).toEqual(planOutskirts(computeLayout(n), { seed: 7, lite: false }))
      expect(planOutskirts(computeLayout(n), { seed: 7, lite: true })).toEqual(planOutskirts(computeLayout(n), { seed: 7, lite: true }))
    }
    expect(plan(6, 7).fields).not.toEqual(plan(6, 8).fields)
  })

  it('fills the frame edges of the default view with countryside at every orbit angle (16:9, 16:10, 3:2)', () => {
    for (const n of COUNTS) {
      const layout = computeLayout(n)
      const p = plan(n)
      // Everything that counts as landscape, bucketed on a 20 m grid so the nearest piece is quick to find.
      const pieces: Rect[] = [
        p.terrace, ...p.fields, ...p.lanes, ...p.bridges, ...p.farms, ...p.cottages, ...p.tunnels, ...p.hedges, ballast(p),
        ...p.hills.map(footprint), ...p.windmills.map(mound), ...p.trees.map((t) => square(t.x, t.z, 1)),
      ]
      const cell = 20
      const grid = new Map<string, Rect[]>()
      for (const r of pieces) {
        for (let i = Math.floor((r.x0 - 4) / cell); i <= Math.floor((r.x1 + 4) / cell); i++) {
          for (let j = Math.floor((r.z0 - 4) / cell); j <= Math.floor((r.z1 + 4) / cell); j++) {
            const k = `${i},${j}`
            if (!grid.has(k)) grid.set(k, [])
            grid.get(k)!.push(r)
          }
        }
      }
      const covered = (x: number, z: number): boolean =>
        Math.abs(x - riverX(p.river, z)) <= p.river.half + BANK + RIPARIAN + 4 ||
        (grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) ?? []).some((r) => distTo(r, x, z) <= 4)
      const tallest = Math.max(6, MAX_STYLE_HEIGHT * layout.lotScale) + 4
      const bad: string[] = []
      for (const height of [10, tallest]) {
        for (const aspect of ASPECTS) {
          for (let az = 0; az < 360; az += 10) {
            for (const g of frameEdge(layout, height, aspect, az)) {
              const at = `h=${height} aspect=${aspect.toFixed(2)} az=${az} (${g.x.toFixed(0)}, ${g.y.toFixed(0)})`
              // On the plate, well inside its edge, and never bare plate.
              if (!inRect(p.plate, g.x, g.y, -10)) bad.push(`edge: ${at}`)
              else if (!covered(g.x, g.y)) bad.push(`bare: ${at}`)
            }
          }
        }
      }
      expect(bad, `n=${n}`).toEqual([])
    }
  })

  it('keeps fields, farms and windmills off the town, the river, the railway, the lanes and each other', () => {
    for (const n of COUNTS) {
      for (const lite of [false, true]) {
        const p = plan(n, 3, lite)
        const bad: string[] = []
        const rail = grow(ballast(p), 1)
        const solids: Array<[string, Rect]> = [
          ...p.lanes.map((r): [string, Rect] => ['lane', r]), ...p.bridges.map((r): [string, Rect] => ['bridge', r]),
          ...p.farms.map((r): [string, Rect] => ['farm', r]), ...p.windmills.map((w): [string, Rect] => ['mill', mound(w)]),
          ...p.tunnels.map((r): [string, Rect] => ['tunnel', r]), ['town', town(p)], ['rail', rail],
        ]
        p.fields.forEach((f, i) => {
          const at = `field ${f.crop} ${f.x0.toFixed(1)},${f.z0.toFixed(1)}`
          for (const [name, r] of solids) if (overlaps(f, r)) bad.push(`${at} / ${name}`)
          if (overlaps(f, riverBand(p, f))) bad.push(`${at} / river`)
          for (let j = i + 1; j < p.fields.length; j++) if (overlaps(f, p.fields[j], -1e-6)) bad.push(`${at} / field ${j}`)
        })
        // Farms, cottages and windmill mounds keep clear of the water, the railway, the town, the lanes and each other.
        const sites: Array<[string, Rect]> = [
          ...p.farms.map((r): [string, Rect] => ['farm', r]), ...p.cottages.map((r): [string, Rect] => ['cottage', r]),
          ...p.windmills.map((w): [string, Rect] => ['mill', mound(w)]),
        ]
        sites.forEach(([name, r], i) => {
          if (overlaps(r, riverBand(p, r, BANK + 2))) bad.push(`${name} / river`)
          if (overlaps(r, rail) || overlaps(r, town(p))) bad.push(`${name} / rail or town`)
          if ([...p.lanes, ...p.bridges].some((l) => overlaps(r, l))) bad.push(`${name} / lane`)
          if (name === 'cottage' && !p.fields.some((f) => f.crop === 'meadow' && r.x0 >= f.x0 && r.x1 <= f.x1 && r.z0 >= f.z0 && r.z1 <= f.z1)) bad.push('cottage outside its field')
          for (const [other, o] of sites.slice(i + 1)) if (overlaps(r, o)) bad.push(`${name} / ${other}`)
        })
        expect(bad, `n=${n} lite=${lite}`).toEqual([])
      }
    }
  })

  it('keeps trees, animals, hay and hedgerows out of the water and off the lanes, bridges and track', () => {
    for (const n of COUNTS) {
      const p = plan(n, 5)
      const bad: string[] = []
      const ways = [...p.lanes, ...p.bridges, grow(ballast(p), 0.3)]
      const wet = (x: number, z: number, pad: number) => Math.abs(x - riverX(p.river, z)) < p.river.half + pad
      for (const t of p.trees) {
        const at = `tree ${t.kind} ${t.x.toFixed(1)},${t.z.toFixed(1)}`
        if (wet(t.x, t.z, BANK) || ways.some((r) => inRect(r, t.x, t.z, 0.2))) bad.push(at)
        // The terrace is the town's (its own trees, a fence on the edge): none of the countryside's.
        if (inRect(p.terrace, t.x, t.z)) bad.push(`${at} in town`)
      }
      for (const a of [...p.animals, ...p.bales]) {
        if (wet(a.x, a.z, BANK) || ways.some((r) => inRect(r, a.x, a.z, 0.5)) || inRect(town(p), a.x, a.z)) bad.push(`animal/hay ${a.x.toFixed(1)},${a.z.toFixed(1)}`)
      }
      for (const h of p.hedges) {
        if (overlaps(h, riverBand(p, h)) || ways.some((r) => overlaps(h, r)) || overlaps(h, town(p))) bad.push(`hedge ${h.x0.toFixed(1)},${h.z0.toFixed(1)}`)
      }
      // Hills stand clear of the river and the railway, apart from the two that carry the tunnels.
      for (const h of p.hills) {
        const f = footprint(h)
        const tunnel = p.tunnels.some((tn) => overlaps(f, tn))
        if (overlaps(f, riverBand(p, f)) || (!tunnel && overlaps(f, grow(ballast(p), 1))) || overlaps(f, town(p))) bad.push(`hill ${h.x.toFixed(0)},${h.z.toFixed(0)}`)
      }
      expect(bad, `n=${n}`).toEqual([])
    }
  })

  it('runs the river from plate edge to plate edge, clear of the town, under both bridges', () => {
    for (const n of COUNTS) {
      const p = plan(n)
      const { river, plate } = p
      expect(river.z0).toBeLessThanOrEqual(plate.z0)
      expect(river.z0 + (river.xs.length - 1) * river.step).toBeGreaterThanOrEqual(plate.z1)
      for (let i = 1; i < river.xs.length; i++) expect(Math.abs(river.xs[i] - river.xs[i - 1]), `n=${n} i=${i}`).toBeLessThan(1.5 * river.step)
      for (const x of river.xs) {
        expect(x - river.half - BANK).toBeGreaterThan(p.terrace.x1 + CLEAR)
        expect(x + river.half + BANK).toBeLessThan(plate.x1)
      }
      // One bridge carries the railway, one the east road out of its gate; each spans the water and its banks.
      const rail = p.bridges.find((b) => b.kind === 'rail')!
      const road = p.bridges.find((b) => b.kind === 'road')!
      expect(rail.z0).toBeLessThanOrEqual(p.rail.z - p.rail.half)
      expect(rail.z1).toBeGreaterThanOrEqual(p.rail.z + p.rail.half)
      for (const b of [rail, road]) {
        const [x0, x1] = riverSpan(river, b.z0, b.z1, BANK)
        expect(b.x0, `${b.kind} n=${n}`).toBeLessThan(x0)
        expect(b.x1, `${b.kind} n=${n}`).toBeGreaterThan(x1)
      }
      const gate = p.gates.find((g) => g.x === p.terrace.x1)!
      expect(road.x0).toBe(p.terrace.x1)
      expect(road.z0).toBeLessThan(gate.z)
      expect(road.z1).toBeGreaterThan(gate.z)
      expect(p.lanes.some((l) => l.x0 === road.x1 && l.z0 > road.z0 && l.z1 < road.z1)).toBe(true)
    }
  })

  it('lays the railway straight between two tunnels, clear of the town, and hides the train inside them', () => {
    for (const n of COUNTS) {
      const p = plan(n)
      const { rail, train, plate } = p
      expect(rail.z + rail.half + 1).toBeLessThan(p.terrace.z0 - CLEAR)
      expect(rail.x0).toBeGreaterThan(plate.x0)
      expect(rail.x1).toBeLessThan(plate.x1)
      expect(p.tunnels).toHaveLength(2)
      for (const tn of p.tunnels) {
        expect(Math.abs(tn.portal)).toBeCloseTo(rail.x1, 6)
        expect(tn.x1 - tn.x0).toBeGreaterThan(train.len + 2)
        expect(tn.z0).toBeLessThan(rail.z - rail.half)
        expect(tn.z1).toBeGreaterThan(rail.z + rail.half)
        expect(tn.x0 >= plate.x0 && tn.x1 <= plate.x1).toBe(true)
      }
      let seen = 0
      const dirs = new Set<number>()
      for (let t = 0; t < 4 * train.period; t += 0.7) {
        const pose = trainPose(train, t)
        if (!pose.visible) continue
        seen++
        dirs.add(pose.dir)
        // The whole train lies between the far ends of the two tunnels; what is past a portal is inside its tunnel.
        const tail = pose.head - pose.dir * train.len
        for (const x of [pose.head, tail]) {
          expect(x).toBeGreaterThanOrEqual(p.tunnels[0].x0)
          expect(x).toBeLessThanOrEqual(p.tunnels[1].x1)
        }
        const lo = Math.min(pose.head, tail)
        const hi = Math.max(pose.head, tail)
        expect(hi).toBeGreaterThan(rail.x0)
        expect(lo).toBeLessThan(rail.x1)
      }
      // It passes now and then, both ways, and is out on the line in a frozen scene.
      expect(seen).toBeGreaterThan(0)
      expect(dirs.size).toBe(2)
      expect(trainPose(train, FROZEN_T).visible).toBe(true)
      expect(trainPose(train, FROZEN_T)).toEqual(trainPose(train, FROZEN_T))
    }
  })

  it('adapts to the town: the terrace wraps its bounds, the plate and the patchwork grow with it', () => {
    for (const n of COUNTS) {
      const layout = computeLayout(n)
      const p = plan(n)
      const b = layout.bounds
      expect(p.terrace).toEqual({ x0: b.minX - TERRACE_W, x1: b.maxX + TERRACE_W, z0: b.minZ - TERRACE_W, z1: b.maxZ + TERRACE_W })
      expect(p.plate.x1).toBeGreaterThan(1.2 * p.reach)
      expect(p.plate.z1).toBeGreaterThan(1.2 * p.reach)
      expect(p.scale).toBe(layout.lotScale)
      // Gates sit on the terrace edge, on road lines of the town.
      const lines = layout.roads.flatMap((r) => (r.x0 === r.x1 ? [r.x0] : [r.z0]))
      for (const g of p.gates) {
        expect(lines.some((l) => Math.abs((g.axis === 'x' ? g.z : g.x) - l) < 1e-9)).toBe(true)
        expect(g.axis === 'x' ? [p.terrace.x0, p.terrace.x1] : [p.terrace.z0, p.terrace.z1]).toContain(g.axis === 'x' ? g.x : g.z)
      }
      expect(p.farms).toHaveLength(3)
      expect(p.cottages).toHaveLength(2)
      expect(p.windmills).toHaveLength(2)
      expect(p.ponds).toHaveLength(1)
      expect(p.hills.length).toBeGreaterThan(20)
      expect(new Set(p.fields.map((f) => f.crop)).size).toBeGreaterThan(7)
    }
    expect(plan(25).plate.x1).toBeGreaterThan(plan(1).plate.x1)
    expect(plan(25).fields.length).toBeGreaterThan(plan(1).fields.length)
  })

  it('keeps the land close round the town mostly meadow and pasture, the crop fields further out', () => {
    const soft = new Set(['pasture', 'wildflowers', 'orchard', 'wood', 'pond', 'hay', 'meadow'])
    for (const n of COUNTS) {
      const p = plan(n)
      const share = (lo: number, hi: number): number => {
        let all = 0
        let meadow = 0
        for (const f of p.fields) {
          const d = distTo(p.terrace, (f.x0 + f.x1) / 2, (f.z0 + f.z1) / 2)
          if (d < lo * p.reach || d >= hi * p.reach) continue
          const a = (f.x1 - f.x0) * (f.z1 - f.z0)
          all += a
          if (soft.has(f.crop)) meadow += a
        }
        return meadow / all
      }
      expect(share(0, 0.12), `n=${n}`).toBeGreaterThan(0.8)
      expect(share(0.3, 0.5), `n=${n}`).toBeLessThan(0.65)
    }
  })

  it('respects the caps, and the lite plan is the flat, sparse version of the same land', () => {
    for (const n of [...COUNTS, 36, 49]) {
      const full = plan(n)
      expect(full.trees.length).toBeLessThanOrEqual(CAP.trees)
      expect(full.animals.length).toBeLessThanOrEqual(CAP.animals)
      expect(full.bales.length).toBeLessThanOrEqual(CAP.bales)
      expect(full.tractors.length).toBeLessThanOrEqual(2)
      const lite = plan(n, 1, true)
      expect(lite.trees.length).toBeLessThanOrEqual(LITE_CAP.trees)
      expect(lite.trees.every((t) => t.lod === 2)).toBe(true)
      expect(lite.fields.every((f) => f.lod === 2)).toBe(true)
      expect([lite.animals, lite.bales, lite.hedges, lite.tractors]).toEqual([[], [], [], []])
      expect(lite.plate).toEqual(full.plate)
      expect(lite.fields.map((f) => [f.x0, f.z0, f.crop])).toEqual(full.fields.map((f) => [f.x0, f.z0, f.crop]))
      // Lite keeps the trees nearest the town.
      const far = Math.max(...lite.trees.map((t) => Math.hypot(t.x, t.z)))
      expect(full.trees.filter((t) => Math.hypot(t.x, t.z) < far - 1).length).toBeLessThanOrEqual(LITE_CAP.trees)
    }
  })
})

describe('tractors', () => {
  it('drive round inside their field at any time', () => {
    for (const n of [0, 6, 25]) {
      const p = plan(n)
      expect(p.tractors.length).toBeGreaterThan(0)
      for (const tr of p.tractors) {
        const field = p.fields.find((f) => inRect(f, tr.route.rect.x0 + 0.01, tr.route.rect.z0 + 0.01))!
        expect(field, `n=${n}`).toBeDefined()
        for (const t of [0, 1.7, FROZEN_T, 333, 9999]) {
          const { x, z } = tractorPose(tr, t)
          expect(inRect(field, x, z, 0.01), `n=${n} t=${t}`).toBe(true)
        }
      }
    }
  })

  it('move smoothly round a closed loop', () => {
    for (const tr of plan(6).tractors) {
      const route = tr.route
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
  })
})
