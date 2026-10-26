import { describe, expect, it } from 'vitest'
import { createRng } from '../src/util/prng'

describe('createRng', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    for (let i = 0; i < 50; i++) expect(a()).toBe(b())
  })

  it('differs between seeds', () => {
    const a = Array.from({ length: 5 }, createRng(1))
    const b = Array.from({ length: 5 }, createRng(2))
    expect(a).not.toEqual(b)
  })

  it('stays in [0, 1) with a roughly uniform mean', () => {
    const r = createRng(7)
    let sum = 0
    const n = 10000
    for (let i = 0; i < n; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      sum += v
    }
    expect(sum / n).toBeGreaterThan(0.48)
    expect(sum / n).toBeLessThan(0.52)
  })
})
