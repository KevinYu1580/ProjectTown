// The town's surroundings, one module per theme (pastoral: countryside, urban: a neighbourhood). Each plans and builds
// itself from the layout and tells the street where the town's roads leave it.
import type * as THREE from 'three'
import type { SceneTheme } from '../../types'
import type { TownLayout } from '../layout'
import type { TownEdge } from '../street'
import { Outskirts as Pastoral } from './pastoral'
import { Outskirts as Urban } from './urban'

export interface Surroundings {
  /** Replaces whatever was built before; `glows` are extra firefly spots (over water). */
  build(layout: TownLayout, opts: { seed: number; lite: boolean }): TownEdge & { glows: Array<{ x: number; z: number }> }
  setLightLevel(level: number): void
  update(dtMs: number): void
  dispose(): void
}

export function createSurroundings(theme: SceneTheme, parent: THREE.Object3D): Surroundings {
  return theme === 'urban' ? new Urban(parent) : new Pastoral(parent)
}
