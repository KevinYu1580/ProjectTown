import { describe, expect, it } from 'vitest'
import { computeLayout, type TownLayout } from '../src/scene/layout'
import { COUNTRY_Y, RAMP, planOutskirts as planCountry, type Rect } from '../src/scene/outskirts/pastoralPlan'
import { CAP, planOutskirts as planCity } from '../src/scene/outskirts/urbanPlan'
import { BODY, PERIOD, sideFor, walkerPose, type Walker } from '../src/scene/outskirts/walkers'

type Plan = { walkers: Walker[] }
const cache = new Map<string, Plan>()
function memo<P extends Plan>(key: string, make: () => P): P {
  if (!cache.has(key)) cache.set(key, make())
  return cache.get(key) as P
}
const city = (n: number) => memo(`city:${n}`, () => planCity(computeLayout(n), { seed: 1, lite: false }))
const country = (n: number) => memo(`country:${n}`, () => planCountry(computeLayout(n), { seed: 1, lite: false }))
const THEMES = [['city', city], ['country', country]] as const

/** The town's paving (street.ts): the sidewalks round every grid cell and round the town, and the zebra crossings. */
function townPaving(l: TownLayout): Rect[] {
  const out: Rect[] = []
  const d = l.lotSize / 2 + 0.75
  for (let col = 0; col < l.cols; col++) {
    for (let row = 0; row < l.rows; row++) {
      const x = (col - (l.cols - 1) / 2) * l.pitch
      const z = (row - (l.rows - 1) / 2) * l.pitch
      for (const s of [-1, 1]) {
        out.push({ x0: x - d - 0.75, x1: x + d + 0.75, z0: z + s * d - 0.75, z1: z + s * d + 0.75 })
        out.push({ x0: x + s * d - 0.75, x1: x + s * d + 0.75, z0: z - d - 0.75, z1: z + d + 0.75 })
      }
    }
  }
  const b = l.bounds
  out.push(
    { x0: b.minX, x1: b.maxX, z0: b.minZ, z1: b.minZ + 1.5 }, { x0: b.minX, x1: b.maxX, z0: b.maxZ - 1.5, z1: b.maxZ },
    { x0: b.minX, x1: b.minX + 1.5, z0: b.minZ, z1: b.maxZ }, { x0: b.maxX - 1.5, x1: b.maxX, z0: b.minZ, z1: b.maxZ },
  )
  for (const c of l.crosswalks) {
    out.push(c.axis === 'z' ? { x0: c.x - 3, x1: c.x + 3, z0: c.z - 1.05, z1: c.z + 1.05 } : { x0: c.x - 1.05, x1: c.x + 1.05, z0: c.z - 3, z1: c.z + 3 })
  }
  return out
}

/** Everywhere a theme's walkers may set foot: the town's paving and what that theme adds. */
function paving(theme: 'city' | 'country', n: number): Rect[] {
  const layout = computeLayout(n)
  const out = townPaving(layout)
  if (theme === 'city') {
    // The sidewalks of the roads leaving town, and a crossing over at their far end.
    const p = city(n)
    const len = Math.min(60, Math.max(24, 0.4 * p.reach))
    for (const e of p.exits) {
      const [near, far] = Math.abs(e.from) < Math.abs(e.to) ? [e.from, e.to] : [e.to, e.from]
      const end = near + Math.sign(far - near) * Math.min(len, Math.abs(far - near) - 1)
      const rect = (a0: number, a1: number, b0: number, b1: number): Rect =>
        e.axis === 'z' ? { x0: a0, x1: a1, z0: b0, z1: b1 } : { x0: b0, x1: b1, z0: a0, z1: a1 }
      const [lo, hi] = [Math.min(e.from, e.to), Math.max(e.from, e.to)]
      out.push(rect(e.at + 1.7, e.at + 3.2, lo, hi), rect(e.at - 3.2, e.at - 1.7, lo, hi), rect(e.at - 3.2, e.at + 3.2, end - 1.05, end + 1.05))
    }
  } else {
    // The gate roads (sidewalks, and the asphalt people cross onto at the gate), the lanes and the road bridge.
    const p = country(n)
    for (const e of p.exits) {
      const [lo, hi] = [Math.min(e.from, e.to), Math.max(e.from, e.to)]
      out.push(e.axis === 'z' ? { x0: e.at - 3.2, x1: e.at + 3.2, z0: lo, z1: hi } : { x0: lo, x1: hi, z0: e.at - 3.2, z1: e.at + 3.2 })
    }
    out.push(...p.lanes, ...p.bridges.filter((br) => br.kind === 'road'))
  }
  return out
}

// Where a road's sidewalk joins the town's (they are 0.2 apart across), a body may overhang its edge by a hand.
const PAD = 0.02
const inside = (r: Rect, x: number, z: number, pad = 1e-6): boolean => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad

describe('walkers', () => {
  it('set foot only on paving, the whole body on it, and keep clear of the street trees', () => {
    for (const [theme, plan] of THEMES) {
      for (const n of [0, 1, 6, 25]) {
        const ground = paving(theme, n)
        const layout = computeLayout(n)
        const b = layout.bounds
        const trees = layout.trees.filter((t) => t.x > b.minX && t.x < b.maxX && t.z > b.minZ && t.z < b.maxZ)
        for (const w of plan(n).walkers) {
          const h = (BODY / 2) * w.s
          for (let t = 0; t < PERIOD; t += 0.5) {
            const { x, y, z } = walkerPose(w, t)
            const at = `${theme} n=${n} t=${t} (${x.toFixed(2)}, ${z.toFixed(2)})`
            for (const [px, pz] of [[x - h, z], [x + h, z], [x, z - h], [x, z + h]]) expect(ground.some((r) => inside(r, px, pz, PAD)), at).toBe(true)
            for (const tr of trees) expect(Math.hypot(x - tr.x, z - tr.z), at).toBeGreaterThan(1.3 * tr.scale + h - 1e-6)
            if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) {
              expect(y, at).toBeGreaterThanOrEqual(0)
              expect(y, at).toBeLessThanOrEqual(0.1 + 1e-9)
            }
          }
        }
      }
    }
  })

  it('walk down the ramps from the gates and along the lanes on the ground (country)', () => {
    const p = country(6)
    const lane = COUNTRY_Y + 0.03
    let onLanes = 0
    for (const w of p.walkers) {
      for (let t = 0; t < PERIOD; t += 0.5) {
        const { x, y, z } = walkerPose(w, t)
        const l = p.lanes.find((r) => inside(r, x, z))
        if (!l) continue
        const along = l.axis === 'x' ? x : z
        const [a, c] = l.axis === 'x' ? [l.x0, l.x1] : [l.z0, l.z1]
        const fromTerrace = l.ramp === 'x0' || l.ramp === 'z0' ? along - a : l.ramp ? c - along : Infinity
        const at = `t=${t} (${x.toFixed(2)}, ${z.toFixed(2)})`
        if (fromTerrace > RAMP + 0.5) {
          expect(y, at).toBeCloseTo(lane, 6)
          onLanes++
        } else expect(Math.abs(y - (fromTerrace / RAMP) * lane), at).toBeLessThan(0.05)
      }
    }
    expect(onLanes).toBeGreaterThan(0)
  })

  it('never bump into each other: in a whole period nobody comes closer than a body, but to pass on opposite sides', () => {
    for (const [theme, plan] of THEMES) {
      for (const n of [1, 6, 25]) {
        const walkers = plan(n).walkers
        for (const w of walkers) expect(w.period).toBe(PERIOD) // so one period covers every meeting
        for (let t = 0; t < PERIOD; t += 0.05) {
          const at = walkers.map((w) => walkerPose(w, t))
          for (let i = 0; i < at.length; i++) {
            for (let j = i + 1; j < at.length; j++) {
              const s = walkers[i].s
              const d = Math.hypot(at[i].x - at[j].x, at[i].z - at[j].z)
              if (d >= BODY * s) continue
              const passing = Math.cos(at[i].yaw - at[j].yaw) < -0.9 && d >= 2 * sideFor(s) - 0.15
              expect(passing, `${theme} n=${n} t=${t.toFixed(2)} walkers ${i} and ${j}, ${d.toFixed(2)} apart`).toBe(true)
            }
          }
        }
      }
    }
  })

  it('roam: each on a round of its own, in and out of the town, and out to the farms in the country', () => {
    for (const [theme, plan] of THEMES) {
      for (const n of [1, 6, 25]) {
        const walkers = plan(n).walkers
        const b = computeLayout(n).bounds
        let both = 0
        let among = 0
        for (const w of walkers) {
          let seen = false // among the lots: inside the outer road
          let out = false
          for (let t = 0; t < PERIOD; t += 1) {
            const { x, z } = walkerPose(w, t)
            const lots = x > b.minX + 3 && x < b.maxX - 3 && z > b.minZ + 3 && z < b.maxZ - 3
            if (lots) among++
            seen ||= lots
            out ||= x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ
          }
          if (seen && out) both++
        }
        const rounds = new Set(walkers.map((w) => w.legs.map((l) => `${l.x0.toFixed(2)},${l.z0.toFixed(2)}`).join(' ')))
        expect(rounds.size, `${theme} n=${n}`).toBe(walkers.length)
        expect(both, `${theme} n=${n}: walk in from outside and out again`).toBeGreaterThanOrEqual(3)
        expect(among / (walkers.length * PERIOD), `${theme} n=${n}: time among the lots`).toBeGreaterThan(0.1)
      }
    }
    // Every farm lane sees someone walk its far half.
    for (const n of [1, 6, 25]) {
      const p = country(n)
      for (const l of p.lanes) {
        const far = l.axis === 'x' ? (l.ramp ? { ...l, x1: (l.x0 + l.x1) / 2 } : { ...l, x0: (l.x0 + l.x1) / 2 }) : { ...l, z0: (l.z0 + l.z1) / 2 }
        const seen = p.walkers.some((w) => Array.from({ length: PERIOD }, (_, t) => walkerPose(w, t)).some((q) => inside(far, q.x, q.z)))
        expect(seen, `n=${n} lane ${l.axis} ${l.x0.toFixed(0)},${l.z0.toFixed(0)}`).toBe(true)
      }
    }
  })

  it('stroll without jumping, round and round', () => {
    for (const [, plan] of THEMES) {
      for (const w of plan(6).walkers) {
        let prev = walkerPose(w, 0)
        for (let t = 0.05; t <= PERIOD + 0.05; t += 0.05) {
          const q = walkerPose(w, t)
          expect(Math.hypot(q.x - prev.x, q.z - prev.z)).toBeLessThan(w.speed * 0.05 * 1.01 + 1e-9)
          prev = q
        }
      }
    }
  })

  it('are many in the city (as many as fit a small town), fewer in the country, and none in the lite plans', () => {
    for (const n of [0, 1, 6, 25]) {
      expect(city(n).walkers.length, `n=${n}`).toBeGreaterThanOrEqual(n < 4 ? 8 : CAP.walkers - 3)
      expect(country(n).walkers.length, `n=${n}`).toBeGreaterThan(0)
      expect(country(n).walkers.length, `n=${n}`).toBeLessThan(city(n).walkers.length)
    }
    expect(planCity(computeLayout(6), { seed: 1, lite: true }).walkers).toEqual([])
    expect(planCountry(computeLayout(6), { seed: 1, lite: true }).walkers).toEqual([])
  })
})
