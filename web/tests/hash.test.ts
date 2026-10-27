import { describe, expect, it } from 'vitest'
import { BUILDING_STYLES, fnv1a32, hashToIndex, pickBuildingStyle } from '../src/util/hash'

describe('fnv1a32', () => {
  it('matches reference vectors (ASCII and UTF-8)', () => {
    expect(fnv1a32('')).toBe(2166136261)
    expect(fnv1a32('a')).toBe(3826002220)
    expect(fnv1a32('foobar')).toBe(3214735720)
    expect(fnv1a32('專案')).toBe(538054075)
  })

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['x', '/Users/me/very/long/path/'.repeat(20), '日本語']) {
      const h = fnv1a32(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })
})

describe('pickBuildingStyle', () => {
  it('lists the ten styles in the spec order', () => {
    expect(BUILDING_STYLES).toEqual([
      'office', 'factory', 'cafe', 'bookstore', 'lab',
      'warehouse', 'radioTower', 'greenhouse', 'clockTower', 'ramenShop',
    ])
  })

  it('is stable and follows BUILDING_STYLES[fnv1a32(path) % 10] (parity vectors for Swift)', () => {
    expect(pickBuildingStyle('/Users/me/projects/foo')).toBe('warehouse') // 1681320835 % 10 = 5
    expect(pickBuildingStyle('/Users/me/projects/bar')).toBe('lab') // 2775086574 % 10 = 4
    expect(pickBuildingStyle('/Users/me/work/ProjectTown')).toBe('warehouse') // 2272331545 % 10 = 5
    expect(pickBuildingStyle('/Users/me/projects/foo')).toBe(pickBuildingStyle('/Users/me/projects/foo'))
  })

  it('distributes paths roughly evenly over all styles', () => {
    const counts = new Map<string, number>()
    const n = 2000
    for (let i = 0; i < n; i++) {
      const style = pickBuildingStyle(`/Users/dev/projects/project-${i}`)
      counts.set(style, (counts.get(style) ?? 0) + 1)
    }
    expect(counts.size).toBe(10)
    // Expected 200 each (sd about 13); 120..280 is a very safe band.
    for (const c of counts.values()) {
      expect(c).toBeGreaterThan(120)
      expect(c).toBeLessThan(280)
    }
  })
})

describe('hashToIndex', () => {
  it('stays in range and is deterministic', () => {
    for (const n of [1, 2, 12, 100]) {
      const i = hashToIndex('some-session-id', n)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(n)
      expect(hashToIndex('some-session-id', n)).toBe(i)
    }
  })
})
