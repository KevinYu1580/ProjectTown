import { afterEach, describe, expect, it } from 'vitest'
import { lightLevel } from '../src/time/dayNight'
import type { DayNightSettings } from '../src/types'

// Local wall-clock time on an arbitrary non-DST-transition day, so results do not depend on the machine's zone.
const at = (h: number, m = 0, s = 0): number => new Date(2026, 0, 15, h, m, s).getTime()
const realtime = (sunrise = '06:00', sunset = '18:00'): DayNightSettings => ({ mode: 'realtime', sunrise, sunset })

describe('realtime mode', () => {
  it('is full day at noon and deep night at midnight', () => {
    expect(lightLevel(at(12), realtime())).toEqual({ level: 1, phase: 'day' })
    expect(lightLevel(at(0), realtime())).toEqual({ level: 0, phase: 'night' })
    expect(lightLevel(at(23, 59), realtime())).toEqual({ level: 0, phase: 'night' })
  })

  it('transitions for 60 minutes centred on sunrise (05:30-06:30)', () => {
    expect(lightLevel(at(5, 29, 59), realtime())).toEqual({ level: 0, phase: 'night' })
    expect(lightLevel(at(5, 30), realtime())).toEqual({ level: 0, phase: 'dawn' })
    expect(lightLevel(at(6, 0), realtime())).toEqual({ level: 0.5, phase: 'dawn' })
    expect(lightLevel(at(6, 30), realtime())).toEqual({ level: 1, phase: 'day' })
  })

  it('transitions for 60 minutes centred on sunset (17:30-18:30)', () => {
    expect(lightLevel(at(17, 29, 59), realtime())).toEqual({ level: 1, phase: 'day' })
    expect(lightLevel(at(17, 30), realtime())).toEqual({ level: 1, phase: 'dusk' })
    expect(lightLevel(at(18, 0), realtime())).toEqual({ level: 0.5, phase: 'dusk' })
    expect(lightLevel(at(18, 30), realtime())).toEqual({ level: 0, phase: 'night' })
  })

  it('uses smoothstep inside the transition and is monotonic', () => {
    // 25 % of the way: 3x^2 - 2x^3 = 0.15625
    expect(lightLevel(at(5, 45), realtime()).level).toBeCloseTo(0.15625, 10)
    expect(lightLevel(at(6, 15), realtime()).level).toBeCloseTo(0.84375, 10)
    let prev = -1
    for (let s = 0; s <= 3600; s += 30) {
      const { level } = lightLevel(at(5, 30) + s * 1000, realtime())
      expect(level).toBeGreaterThanOrEqual(prev)
      prev = level
    }
    expect(prev).toBe(1)
  })

  it('honours custom sunrise and sunset', () => {
    const s = realtime('07:15', '16:45')
    expect(lightLevel(at(7, 15), s)).toEqual({ level: 0.5, phase: 'dawn' })
    expect(lightLevel(at(16, 45), s)).toEqual({ level: 0.5, phase: 'dusk' })
    expect(lightLevel(at(12), s).phase).toBe('day')
    expect(lightLevel(at(17, 30), s).phase).toBe('night')
  })

  it('handles a transition that crosses midnight', () => {
    const s = realtime('00:15', '22:00') // dawn runs 23:45 -> 00:45
    expect(lightLevel(at(23, 44), s)).toEqual({ level: 0, phase: 'night' })
    expect(lightLevel(at(23, 45), s)).toEqual({ level: 0, phase: 'dawn' })
    expect(lightLevel(at(0, 0), s).level).toBeCloseTo(0.15625, 10)
    expect(lightLevel(at(0, 15), s)).toEqual({ level: 0.5, phase: 'dawn' })
    expect(lightLevel(at(0, 45), s)).toEqual({ level: 1, phase: 'day' })
    expect(lightLevel(at(12), s).phase).toBe('day')
    expect(lightLevel(at(22, 0), s)).toEqual({ level: 0.5, phase: 'dusk' })
    expect(lightLevel(at(23, 0), s)).toEqual({ level: 0, phase: 'night' })
  })

  it('shrinks the transition when the day or the night is shorter than 60 minutes (no level jump)', () => {
    for (const [rise, set] of [['06:00', '06:30'], ['06:00', '06:10'], ['00:20', '23:50']]) {
      const s = realtime(rise, set)
      let prev = lightLevel(at(0), s).level
      for (let sec = 1; sec <= 86400; sec++) {
        const { level } = lightLevel(at(0) + sec * 1000, s)
        expect(Math.abs(level - prev), `${rise}-${set} at +${sec}s`).toBeLessThan(0.01)
        prev = level
      }
    }
    // The transitions meet at the day's midpoint, where the level peaks at 1.
    expect(lightLevel(at(6, 15), realtime('06:00', '06:30'))).toEqual({ level: 1, phase: 'dusk' })
    expect(lightLevel(at(6, 0), realtime('06:00', '06:30')).level).toBe(0.5)
    expect(lightLevel(at(6, 30), realtime('06:00', '06:30')).level).toBe(0.5)
  })

  describe('time zones', () => {
    const original = process.env.TZ
    afterEach(() => {
      if (original === undefined) delete process.env.TZ
      else process.env.TZ = original
    })

    it('reads the local zone and gives the same result for the same local wall time', () => {
      for (const tz of ['UTC', 'Asia/Taipei', 'America/Los_Angeles', 'Asia/Kolkata', 'Pacific/Auckland']) {
        process.env.TZ = tz
        expect(lightLevel(at(6, 0), realtime()).level).toBe(0.5)
        expect(lightLevel(at(12), realtime()).phase).toBe('day')
        expect(lightLevel(at(0), realtime()).phase).toBe('night')
      }
    })

    it('shifts with the zone for a fixed instant', () => {
      const instant = Date.UTC(2026, 0, 15, 22, 0) // 22:00 UTC = 06:00 (+1 day) in Taipei
      process.env.TZ = 'UTC'
      expect(lightLevel(instant, realtime())).toEqual({ level: 0, phase: 'night' })
      process.env.TZ = 'Asia/Taipei'
      expect(lightLevel(instant, realtime())).toEqual({ level: 0.5, phase: 'dawn' })
    })
  })
})

const EPOCH = 1_800_000_000_000
const MIN = 60_000
const cycle = (periodMinutes: number, dayRatio: number): DayNightSettings => ({
  mode: 'cycle', periodMinutes, dayRatio, cycleEpoch: EPOCH,
})

describe('cycle mode', () => {
  // period 60, dayRatio 0.5 -> T = 2.5 min, D = 30 min
  const s = cycle(60, 0.5)
  const atMin = (m: number) => lightLevel(EPOCH + m * MIN, s)

  it('starts in full day at the epoch', () => {
    expect(atMin(0)).toEqual({ level: 1, phase: 'day' })
  })

  it('follows the day/night timeline', () => {
    expect(atMin(27.49)).toEqual({ level: 1, phase: 'day' })
    expect(atMin(27.5)).toEqual({ level: 1, phase: 'dusk' }) // D - T
    expect(atMin(28.75)).toEqual({ level: 0.5, phase: 'dusk' })
    expect(atMin(30)).toEqual({ level: 0, phase: 'night' }) // D
    expect(atMin(57.49)).toEqual({ level: 0, phase: 'night' })
    expect(atMin(57.5)).toEqual({ level: 0, phase: 'dawn' }) // period - T
    expect(atMin(58.75)).toEqual({ level: 0.5, phase: 'dawn' })
    expect(atMin(59.999).level).toBeCloseTo(1, 5)
    expect(atMin(60)).toEqual({ level: 1, phase: 'day' }) // next cycle
  })

  it('transition length is period / 24', () => {
    const p = cycle(1440, 0.5)
    const T = 60 // minutes
    expect(lightLevel(EPOCH + (720 - T) * MIN, p).phase).toBe('dusk')
    expect(lightLevel(EPOCH + (720 - T - 0.01) * MIN, p).phase).toBe('day')
    expect(lightLevel(EPOCH + 720 * MIN, p).phase).toBe('night')
  })

  it('measures day length from dawn midpoint to dusk midpoint (period 60, ratio 0.7 -> 42 min)', () => {
    const p = cycle(60, 0.7) // T = 2.5, D = 42
    const dawnMid = -1.25 // previous cycle: period - T/2
    const duskMid = 42 - 1.25
    expect(lightLevel(EPOCH + dawnMid * MIN, p).level).toBeCloseTo(0.5, 10)
    expect(lightLevel(EPOCH + duskMid * MIN, p).level).toBeCloseTo(0.5, 10)
    expect(duskMid - dawnMid).toBeCloseTo(42, 10)
  })

  it('spends dayRatio of the period at level >= 0.5 for several settings', () => {
    for (const [period, ratio] of [[60, 0.7], [5, 0.1], [1440, 0.9], [60, 0.5], [37, 0.33]] as const) {
      const p = cycle(period, ratio)
      const n = 24000
      let bright = 0
      for (let i = 0; i < n; i++) {
        // offset by half a sample so no point lands exactly on a midpoint
        if (lightLevel(EPOCH + ((i + 0.5) / n) * period * MIN, p).level >= 0.5) bright++
      }
      expect(Math.abs(bright / n - ratio)).toBeLessThan(0.001)
    }
  })

  it('works for times before the epoch', () => {
    for (const m of [0, 10, 28, 29.5, 45, 58.2]) {
      expect(lightLevel(EPOCH - 3 * 60 * MIN + m * MIN, s)).toEqual(atMin(m))
    }
    expect(lightLevel(EPOCH - 1, s).phase).toBe('dawn')
  })

  it('keeps level within [0, 1] and monotonic inside each transition', () => {
    let prevDusk = 2
    for (let m = 27.5; m <= 30; m += 0.05) {
      const { level } = atMin(m)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(1)
      expect(level).toBeLessThanOrEqual(prevDusk)
      prevDusk = level
    }
  })
})
