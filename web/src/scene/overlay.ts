import type * as THREE from 'three'

const KEY = 'projectTownOverlay'

/**
 * Marks `object` as an overlay: something drawn over the town to show names and states (building signs, name labels,
 * the gear, the "!" bubble, fireworks, the green ring, zZ). The wallpaper snapshot leaves overlays out.
 */
export function markOverlay(object: THREE.Object3D): void {
  object.userData[KEY] = true
}

/** Runs `draw` with every visible overlay under `root` hidden, then shows them again, also when `draw` throws. */
export function withoutOverlays<T>(root: THREE.Object3D, draw: () => T): T {
  const hidden: THREE.Object3D[] = []
  root.traverse((object) => {
    if (object.userData[KEY] === true && object.visible) hidden.push(object)
  })
  for (const object of hidden) object.visible = false
  try {
    return draw()
  } finally {
    for (const object of hidden) object.visible = true
  }
}
