import { describe, expect, it } from 'vitest'
import { contrastRatio, nameInk, relativeLuminance } from '../src/scene/sign'

const WHITE = { fill: '#ffffff', shadow: true }
const DARK = { fill: '#1c2230', shadow: false }
const grey = (v: number): string => `#${v.toString(16).padStart(2, '0').repeat(3)}`

describe('relativeLuminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10)
  })

  it('weights the channels with the WCAG coefficients', () => {
    expect(relativeLuminance('#ff0000')).toBeCloseTo(0.2126, 4)
    expect(relativeLuminance('#00ff00')).toBeCloseTo(0.7152, 4)
    expect(relativeLuminance('#0000ff')).toBeCloseTo(0.0722, 4)
  })

  it('linearises sRGB: power curve above 0.04045, linear segment below', () => {
    expect(relativeLuminance('#808080')).toBeCloseTo(0.21586, 5)
    expect(relativeLuminance('#0a0a0a')).toBeCloseTo(10 / 255 / 12.92, 8)
  })

  it('reads #rgb and #rrggbb in any case', () => {
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 10)
    expect(relativeLuminance('#F2C94C')).toBe(relativeLuminance('#f2c94c'))
    expect(relativeLuminance('#abc')).toBe(relativeLuminance('#aabbcc'))
  })

  it('treats anything that is not a hex colour as black', () => {
    for (const bad of ['', 'red', '#12', '#12345', '#gggggg', 'f2c94c', 'rgb(1,2,3)']) {
      expect(relativeLuminance(bad)).toBe(0)
    }
  })
})

describe('contrastRatio', () => {
  it('spans 1 (identical colours) to 21 (black on white)', () => {
    expect(contrastRatio('#336699', '#336699')).toBe(1)
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 10)
  })

  it('does not depend on the argument order', () => {
    expect(contrastRatio('#f2c94c', '#1c2230')).toBe(contrastRatio('#1c2230', '#f2c94c'))
  })

  it('matches the well-known WCAG reference greys on white', () => {
    expect(contrastRatio('#ffffff', '#767676')).toBeCloseTo(4.54, 2) // the darkest grey that still passes AA
    expect(contrastRatio('#ffffff', '#777777')).toBeCloseTo(4.48, 2)
  })
})

describe('nameInk', () => {
  it('keeps white text with the shadow on dark and saturated project colours', () => {
    // #5B8DEF is the app default project colour.
    for (const c of ['#000000', '#1c2230', '#6a4c93', '#00798c', '#d1495b', '#e4572e', '#5B8DEF']) {
      expect(nameInk(c, true), c).toEqual(WHITE)
    }
  })

  it('switches to dark ink without a shadow on light project colours', () => {
    for (const c of ['#ffffff', '#f2c94c', '#f6d26e', '#f2a541', '#3bb273', '#8cb369']) {
      expect(nameInk(c, true), c).toEqual(DARK)
    }
  })

  it('is white exactly while white keeps 3:1 against the plate, and dark ink then passes AA', () => {
    for (let v = 0; v <= 255; v++) {
      const c = grey(v)
      if (nameInk(c, true).fill === WHITE.fill) expect(contrastRatio('#ffffff', c), c).toBeGreaterThanOrEqual(3)
      else {
        expect(contrastRatio('#ffffff', c), c).toBeLessThan(3)
        expect(contrastRatio('#1c2230', c), c).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('flips from white to dark exactly once as the colour gets lighter', () => {
    let flips = 0
    let prev = nameInk(grey(0), true).fill
    for (let v = 1; v <= 255; v++) {
      const cur = nameInk(grey(v), true).fill
      if (cur !== prev) flips++
      prev = cur
    }
    expect(flips).toBe(1)
  })

  it('judges the dimmed plate of a lot without sessions, so even light colours keep white text there', () => {
    for (const c of ['#ffffff', '#f2c94c', '#f6d26e', '#f2a541']) expect(nameInk(c, false), c).toEqual(WHITE)
    for (let v = 0; v <= 255; v++) expect(nameInk(grey(v), false), grey(v)).toEqual(WHITE)
  })

  it('falls back to the original white text for a colour it cannot parse', () => {
    expect(nameInk('not-a-colour', true)).toEqual(WHITE)
    expect(nameInk('not-a-colour', false)).toEqual(WHITE)
  })
})
