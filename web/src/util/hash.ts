import type { BuildingStyle } from '../types'

// Order matters: Swift picks the style with the same index (HANDOFF §6.3 / §8.4).
export const BUILDING_STYLES: readonly BuildingStyle[] = [
  'office', 'factory', 'cafe', 'bookstore', 'lab',
  'warehouse', 'radioTower', 'greenhouse', 'clockTower', 'ramenShop',
]

const encoder = new TextEncoder()

/** FNV-1a 32-bit over the UTF-8 bytes of `s`. Returns a uint32. */
export function fnv1a32(s: string): number {
  let h = 2166136261
  for (const byte of encoder.encode(s)) {
    h ^= byte
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function hashToIndex(s: string, n: number): number {
  return fnv1a32(s) % n
}

export function pickBuildingStyle(normalizedPath: string): BuildingStyle {
  return BUILDING_STYLES[hashToIndex(normalizedPath, BUILDING_STYLES.length)]
}
