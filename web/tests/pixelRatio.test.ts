import { describe, expect, it } from 'vitest'
import { pixelRatio } from '../src/scene/app'

const pixels = (dpr: number, w: number, h: number): number => (w * h * pixelRatio(dpr, w, h) ** 2)

describe('pixelRatio', () => {
  it('keeps the capped device ratio on normal screens', () => {
    expect(pixelRatio(2, 1512, 982)).toBe(2)
    expect(pixelRatio(2, 1920, 1080)).toBeGreaterThan(1.95) // 8.3 Mpx, barely over budget
    expect(pixelRatio(3, 1280, 800)).toBe(2)
    expect(pixelRatio(1, 1280, 800)).toBe(1)
    expect(pixelRatio(0, 1280, 800)).toBe(1)
  })

  it('shrinks the ratio on 5K / 6K displays so the backing store stays within budget', () => {
    for (const [w, h] of [[2560, 1440], [3008, 1692]]) {
      expect(pixelRatio(2, w, h)).toBeLessThan(2)
      expect(pixels(2, w, h)).toBeLessThanOrEqual(8e6 + 1)
    }
  })
})
