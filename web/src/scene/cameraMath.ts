import { DEFAULT_CAMERA_BASE, type CameraBase, type CameraSettings } from '../types'

export const FOV_DEG = 30
export const PITCH_MIN = 20
export const PITCH_MAX = 70
export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 3
export const PRESET_AZIMUTHS = [45, 135, 225, 315] as const
export const INTERVAL_TURN_MS = 3000

const DEG = Math.PI / 180
const FRAME_MARGIN = 0.1 // auto-framing leaves 10 % around the town
// The town is drawn this far up and right of centre (fractions of the screen) to clear the bottom-left HUD.
export const VIEW_SHIFT = { x: 0.04, y: 0.05 }
// Zoom 1 is the distance that frames the town at this pitch, for the worst azimuth.
export const FIT_PITCH = DEFAULT_CAMERA_BASE.pitchDeg
// Buildings stand about this far inside the bounds (road ring + half a lot); only the ground reaches the edge.
export const BUILDING_INSET = 10
// The camera looks at this fraction of the tallest building's height.
export const TARGET_HEIGHT = 0.3

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Preset buttons change azimuth only. */
export function presetBase(current: CameraBase, index: 0 | 1 | 2 | 3): CameraBase {
  return { ...current, azimuthDeg: PRESET_AZIMUTHS[index], target: [...current.target] }
}

export function clampBase(base: CameraBase): CameraBase {
  return {
    ...base,
    pitchDeg: clamp(base.pitchDeg, PITCH_MIN, PITCH_MAX),
    zoom: clamp(base.zoom, ZOOM_MIN, ZOOM_MAX),
    target: [...base.target],
  }
}

export function easeInOutCubic(x: number): number {
  const t = clamp(x, 0, 1)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

/**
 * Azimuth for the current orbit mode. The result is cumulative (not wrapped to 0–360), so it never jumps.
 * `elapsedMs` counts from mode start / the end of camera editing.
 */
export function orbitAzimuth(baseAzimuthDeg: number, cam: CameraSettings, elapsedMs: number): number {
  if (elapsedMs <= 0 || cam.mode === 'fixed') return baseAzimuthDeg

  if (cam.mode === 'continuous') {
    return baseAzimuthDeg + (360 * elapsedMs) / (cam.continuousPeriodMinutes * 60000)
  }

  // interval: turn n starts at n * interval and lasts INTERVAL_TURN_MS.
  const interval = cam.intervalMinutes * 60000
  const turnsStarted = Math.floor(elapsedMs / interval)
  if (turnsStarted === 0) return baseAzimuthDeg
  const sinceTurnStart = elapsedMs - turnsStarted * interval
  const progress = Math.min(1, sinceTurnStart / INTERVAL_TURN_MS)
  return baseAzimuthDeg + 90 * (turnsStarted - 1) + 90 * easeInOutCubic(progress)
}

/**
 * Distance at which the town (ground bounds, plus the tallest building height above the inset bounds) fits the view at
 * FIT_PITCH, with a 10 % margin and room for the HUD shift. Taken as the worst case over all azimuths so the
 * distance, and so the meaning of zoom, does not change while orbiting.
 */
export function fitDistance(
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
  maxHeight: number,
  aspect: number,
): number {
  const { minX, maxX, minZ, maxZ } = bounds
  const h = maxHeight
  const ty = h * TARGET_HEIGHT
  const tanV = Math.tan((FOV_DEG * DEG) / 2)
  const tanH = tanV * aspect
  const lim = 1 / (1 + FRAME_MARGIN) // NDC extent allowed on each side once the view shift is applied
  const sx = 2 * VIEW_SHIFT.x // content moves right / up by this much (NDC)
  const sy = 2 * VIEW_SHIFT.y
  const sp = Math.sin(FIT_PITCH * DEG)
  const cp = Math.cos(FIT_PITCH * DEG)
  const inner = Math.min(BUILDING_INSET, (maxX - minX) / 2, (maxZ - minZ) / 2)
  let dist = 1
  for (let az = 0; az < 180; az += 5) {
    const sa = Math.sin(az * DEG)
    const ca = Math.cos(az * DEG)
    for (const [x0, ix] of [[minX, 1], [maxX, -1]]) {
      for (const [z0, iz] of [[minZ, 1], [maxZ, -1]]) {
        for (const y of [-ty, h - ty]) {
          const inset = y < 0 ? 0 : inner
          const x = x0 + ix * inset
          const z = z0 + iz * inset
          const right = x * ca - z * sa
          const up = -x * sp * sa + y * cp - z * sp * ca
          const away = -(x * cp * sa + y * sp + z * cp * ca) // along the view direction, from the target
          const needX = right > 0 ? right / ((lim - sx) * tanH) : -right / ((lim + sx) * tanH)
          const needY = up > 0 ? up / ((lim - sy) * tanV) : -up / ((lim + sy) * tanV)
          dist = Math.max(dist, needX - away, needY - away)
        }
      }
    }
  }
  return dist
}

/** Azimuth 0 puts the camera on +Z looking toward -Z; 90 puts it on +X. */
export function cameraPosition(
  target: [number, number, number],
  distance: number,
  azimuthDeg: number,
  pitchDeg: number,
): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180
  const pitch = (pitchDeg * Math.PI) / 180
  return [
    target[0] + distance * Math.cos(pitch) * Math.sin(az),
    target[1] + distance * Math.sin(pitch),
    target[2] + distance * Math.cos(pitch) * Math.cos(az),
  ]
}
