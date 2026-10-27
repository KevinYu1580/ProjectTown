import type * as THREE from 'three'
import type { BuildingStyle } from '../../types'

export type WindowState = 'off' | 'lit' | 'sleep'

/** One building, in lot-local space: origin = lot centre at ground, front (door, storefront) faces +Z. */
export interface BuildingHandle {
  readonly style: BuildingStyle
  readonly object: THREE.Group
  readonly footprint: { width: number; depth: number }
  readonly height: number // top of the building, sign excluded
  readonly windowCount: number // >= 6 light-able windows, also used for sleeping sessions
  windowPosition(i: number): THREE.Vector3 // outer centre of window i
  readonly deskSpots: THREE.Vector3[] // >= 6 standing spots behind the storefront glass
  readonly doorSpot: THREE.Vector3 // just outside the door, +Z side
  readonly signAnchor: THREE.Vector3 // sign bottom-centre, above the roof
  setLit(on: boolean): void
  setWindowState(i: number, state: WindowState): void
  setLightLevel(level: number): void // 0 night ... 1 day
  setActivity(running: boolean): void
  update(dtMs: number, sceneNowMs: number): void
  dispose(): void
}

/** Every style module exports `build: BuildFn`. */
export type BuildFn = (color: THREE.ColorRepresentation) => BuildingHandle
