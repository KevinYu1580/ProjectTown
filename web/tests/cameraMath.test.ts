import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  BUILDING_INSET, FIT_PITCH, FOV_DEG, INTERVAL_TURN_MS, PITCH_MAX, PITCH_MIN, PRESET_AZIMUTHS, TARGET_HEIGHT, VIEW_SHIFT,
  ZOOM_MAX, ZOOM_MIN,
  cameraPosition, clampBase, easeInOutCubic, fitDistance, orbitAzimuth, presetBase,
} from '../src/scene/cameraMath'
import { computeLayout } from '../src/scene/layout'
import { DEFAULT_CAMERA_BASE, type CameraBase, type CameraSettings } from '../src/types'

const MIN = 60_000
const base: CameraBase = { azimuthDeg: 45, pitchDeg: 40, zoom: 1, target: [0, 0] }
const cam = (over: Partial<CameraSettings> = {}): CameraSettings => ({
  mode: 'fixed', intervalMinutes: 10, continuousPeriodMinutes: 60, base, ...over,
})

describe('orbitAzimuth', () => {
  it('fixed: always the base azimuth', () => {
    for (const e of [0, 1000, 99 * MIN]) expect(orbitAzimuth(45, cam(), e)).toBe(45)
  })

  it('interval: holds until the first multiple of the interval', () => {
    const c = cam({ mode: 'interval', intervalMinutes: 10 })
    expect(orbitAzimuth(45, c, 0)).toBe(45)
    expect(orbitAzimuth(45, c, 10 * MIN - 1)).toBe(45)
  })

  it('interval: turns +90 deg over 3 s with ease-in-out, then holds', () => {
    const c = cam({ mode: 'interval', intervalMinutes: 10 })
    const t = 10 * MIN
    expect(orbitAzimuth(45, c, t)).toBe(45)
    expect(orbitAzimuth(45, c, t + INTERVAL_TURN_MS / 2)).toBeCloseTo(90, 10) // easeInOutCubic(0.5) = 0.5
    expect(orbitAzimuth(45, c, t + 750)).toBeCloseTo(45 + 90 * easeInOutCubic(0.25), 10)
    expect(orbitAzimuth(45, c, t + INTERVAL_TURN_MS)).toBeCloseTo(135, 10)
    expect(orbitAzimuth(45, c, t + 5 * MIN)).toBeCloseTo(135, 10)
    expect(orbitAzimuth(45, c, 20 * MIN - 1)).toBeCloseTo(135, 10)
  })

  it('interval: keeps adding 90 deg per interval and never moves backwards', () => {
    const c = cam({ mode: 'interval', intervalMinutes: 1 })
    expect(orbitAzimuth(0, c, 3 * MIN + 10_000)).toBeCloseTo(270, 10)
    expect(orbitAzimuth(0, c, 4 * MIN + 10_000)).toBeCloseTo(360, 10)
    let prev = -1
    for (let e = 0; e < 5 * MIN; e += 250) {
      const a = orbitAzimuth(0, c, e)
      expect(a).toBeGreaterThanOrEqual(prev)
      prev = a
    }
  })

  it('continuous: 360 deg per period, linear', () => {
    const c = cam({ mode: 'continuous', continuousPeriodMinutes: 60 })
    expect(orbitAzimuth(45, c, 0)).toBe(45)
    expect(orbitAzimuth(45, c, 15 * MIN)).toBeCloseTo(135, 10)
    expect(orbitAzimuth(45, c, 60 * MIN)).toBeCloseTo(405, 10)
    expect(orbitAzimuth(0, cam({ mode: 'continuous', continuousPeriodMinutes: 2 }), 30_000)).toBeCloseTo(90, 10)
  })
})

describe('easeInOutCubic', () => {
  it('has the right end points and midpoint, and clamps', () => {
    expect(easeInOutCubic(0)).toBe(0)
    expect(easeInOutCubic(0.5)).toBe(0.5)
    expect(easeInOutCubic(1)).toBe(1)
    expect(easeInOutCubic(-1)).toBe(0)
    expect(easeInOutCubic(2)).toBe(1)
    expect(easeInOutCubic(0.25)).toBeCloseTo(0.0625, 10)
    expect(easeInOutCubic(0.75)).toBeCloseTo(0.9375, 10)
  })
})

describe('presets and clamping', () => {
  it('presets change azimuth only', () => {
    const cur: CameraBase = { azimuthDeg: 200, pitchDeg: 55, zoom: 2, target: [3, -4] }
    expect(PRESET_AZIMUTHS).toEqual([45, 135, 225, 315])
    PRESET_AZIMUTHS.forEach((az, i) => {
      expect(presetBase(cur, i as 0 | 1 | 2 | 3)).toEqual({ ...cur, azimuthDeg: az })
    })
  })

  it('does not alias or mutate the input', () => {
    const cur: CameraBase = { azimuthDeg: 0, pitchDeg: 40, zoom: 1, target: [1, 2] }
    const out = presetBase(cur, 1)
    out.target[0] = 99
    expect(cur.target).toEqual([1, 2])
    expect(cur.azimuthDeg).toBe(0)
    expect(clampBase(cur).target).not.toBe(cur.target)
  })

  it('clamps pitch to 20-70 and zoom to 0.5-3', () => {
    expect(clampBase({ ...base, pitchDeg: 5, zoom: 0.1 })).toMatchObject({ pitchDeg: PITCH_MIN, zoom: ZOOM_MIN })
    expect(clampBase({ ...base, pitchDeg: 89, zoom: 9 })).toMatchObject({ pitchDeg: PITCH_MAX, zoom: ZOOM_MAX })
    expect(clampBase(base)).toEqual(base)
    expect(clampBase(DEFAULT_CAMERA_BASE)).toEqual(DEFAULT_CAMERA_BASE)
  })
})

describe('cameraPosition', () => {
  const at = (az: number, pitch: number, d = 10) => cameraPosition([0, 0, 0], d, az, pitch)

  it('azimuth 0 is on +Z, azimuth 90 on +X (pitch 0)', () => {
    const [x0, y0, z0] = at(0, 0)
    expect(x0).toBeCloseTo(0, 10)
    expect(y0).toBeCloseTo(0, 10)
    expect(z0).toBeCloseTo(10, 10)
    const [x1, , z1] = at(90, 0)
    expect(x1).toBeCloseTo(10, 10)
    expect(z1).toBeCloseTo(0, 10)
  })

  it('azimuth 45 sits on +X/+Z; 180 on -Z; 270 on -X', () => {
    const [x, , z] = at(45, 0)
    expect(x).toBeGreaterThan(0)
    expect(z).toBeGreaterThan(0)
    expect(x).toBeCloseTo(z, 10)
    expect(at(180, 0)[2]).toBeCloseTo(-10, 10)
    expect(at(270, 0)[0]).toBeCloseTo(-10, 10)
  })

  it('pitch raises the camera and is relative to the target', () => {
    const [x, y, z] = cameraPosition([5, 1, -2], 10, 0, 30)
    expect(y).toBeCloseTo(1 + 5, 10)
    expect(x).toBeCloseTo(5, 10)
    expect(z).toBeCloseTo(-2 + 10 * Math.cos(Math.PI / 6), 10)
    expect(Math.hypot(x - 5, y - 1, z + 2)).toBeCloseTo(10, 10)
  })
})

describe('fitDistance (auto-framing, 10 % margin)', () => {
  const LIM = 1 / 1.1
  /** Largest |NDC| of the town's corners over all azimuths, seen through the real camera with the HUD view shift. */
  function worstExtent(count: number, maxHeight: number, aspect: number): number {
    const b = computeLayout(count).bounds
    const dist = fitDistance(b, maxHeight, aspect)
    const w = 1600
    const h = w / aspect
    const cam = new THREE.PerspectiveCamera(FOV_DEG, aspect, 1, 3000)
    cam.setViewOffset(w, h, -w * VIEW_SHIFT.x, h * VIEW_SHIFT.y, w, h)
    const inner = Math.min(BUILDING_INSET, (b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2)
    const target: [number, number, number] = [0, maxHeight * TARGET_HEIGHT, 0]
    const corners: THREE.Vector3[] = []
    for (const [x, ix] of [[b.minX, 1], [b.maxX, -1]]) {
      for (const [z, iz] of [[b.minZ, 1], [b.maxZ, -1]]) {
        corners.push(new THREE.Vector3(x, 0, z), new THREE.Vector3(x + ix * inner, maxHeight, z + iz * inner))
      }
    }
    let worst = 0
    for (let az = 0; az < 360; az += 5) {
      cam.position.set(...cameraPosition(target, dist, az, FIT_PITCH))
      cam.lookAt(...target)
      cam.updateMatrixWorld(true)
      for (const c of corners) {
        const p = c.clone().project(cam)
        worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y))
      }
    }
    return worst
  }

  it('keeps the whole town inside the view minus the margin, and no tighter than needed', () => {
    for (const count of [0, 1, 4, 10, 13, 25]) {
      for (const aspect of [1.0, 1512 / 982, 2.2]) {
        for (const height of [6, 14]) {
          const worst = worstExtent(count, height, aspect)
          expect(worst, `n=${count} aspect=${aspect} h=${height}`).toBeLessThanOrEqual(LIM + 1e-6)
          // The HUD shift only helps one side, so some edge sits within a few percent of the limit.
          expect(worst, `n=${count} aspect=${aspect} h=${height}`).toBeGreaterThan(LIM * 0.9)
        }
      }
    }
  })

  it('grows with the town and with the tallest building', () => {
    const d = (n: number, h: number) => fitDistance(computeLayout(n).bounds, h, 1.5)
    expect(d(25, 8)).toBeGreaterThan(d(4, 8))
    expect(d(4, 20)).toBeGreaterThan(d(4, 6))
  })
})
