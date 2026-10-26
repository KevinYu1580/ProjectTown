import type { DayNightSettings } from '../types'

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk'
export interface LightInfo {
  level: number // 0 = deep night, 1 = full day
  phase: DayPhase
}

const DAY_MINUTES = 1440
const REALTIME_TRANSITION_MIN = 60

const smoothstep = (x: number): number => x * x * (3 - 2 * x)
const mod = (a: number, n: number): number => ((a % n) + n) % n

function parseHHmm(s: string): number {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

// Dawn/dusk are half-open [start, start + length), so the end of a transition already reads as day/night.
// The transition shrinks to the shorter of the day and the night, so the two windows never overlap (no level jump).
function realtime(nowMs: number, sunrise: string, sunset: string): LightInfo {
  const d = new Date(nowMs)
  const minutes = d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000
  const rise = parseHHmm(sunrise)
  const set = parseHHmm(sunset)
  const span = mod(set - rise, DAY_MINUTES)
  const length = Math.min(REALTIME_TRANSITION_MIN, span, DAY_MINUTES - span)
  const half = length / 2

  const dawnPos = mod(minutes - (rise - half), DAY_MINUTES)
  if (dawnPos < length) {
    return { level: smoothstep(dawnPos / length), phase: 'dawn' }
  }
  const duskPos = mod(minutes - (set - half), DAY_MINUTES)
  if (duskPos < length) {
    return { level: 1 - smoothstep(duskPos / length), phase: 'dusk' }
  }
  // Full-day span runs from the end of dawn to the start of dusk (may wrap past midnight).
  const isDay = mod(minutes - (rise + half), DAY_MINUTES) < span - length
  return isDay ? { level: 1, phase: 'day' } : { level: 0, phase: 'night' }
}

function cycle(nowMs: number, periodMinutes: number, dayRatio: number, cycleEpoch: number): LightInfo {
  const period = periodMinutes * 60000
  const t = period / 24
  const dayEnd = dayRatio * period
  const p = mod(nowMs - cycleEpoch, period)

  if (p < dayEnd - t) return { level: 1, phase: 'day' }
  if (p < dayEnd) return { level: 1 - smoothstep((p - (dayEnd - t)) / t), phase: 'dusk' }
  if (p < period - t) return { level: 0, phase: 'night' }
  return { level: smoothstep((p - (period - t)) / t), phase: 'dawn' }
}

export function lightLevel(nowMs: number, settings: DayNightSettings): LightInfo {
  return settings.mode === 'realtime'
    ? realtime(nowMs, settings.sunrise, settings.sunset)
    : cycle(nowMs, settings.periodMinutes, settings.dayRatio, settings.cycleEpoch)
}
