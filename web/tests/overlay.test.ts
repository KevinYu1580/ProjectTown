import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { markOverlay, withoutOverlays } from '../src/scene/overlay'

function town(): { scene: THREE.Scene; house: THREE.Mesh; sign: THREE.Sprite; label: THREE.Sprite; hiddenLabel: THREE.Sprite } {
  const scene = new THREE.Scene()
  const house = new THREE.Mesh()
  const sign = new THREE.Sprite()
  const label = new THREE.Sprite()
  const hiddenLabel = new THREE.Sprite()
  hiddenLabel.visible = false
  for (const overlay of [sign, label, hiddenLabel]) markOverlay(overlay)
  house.add(sign)
  scene.add(house, label, hiddenLabel)
  return { scene, house, sign, label, hiddenLabel }
}

describe('withoutOverlays', () => {
  it('hides only overlays while drawing and shows them again afterwards', () => {
    const { scene, house, sign, label, hiddenLabel } = town()
    const seen = withoutOverlays(scene, () => [house.visible, sign.visible, label.visible])
    expect(seen).toEqual([true, false, false])
    expect([house.visible, sign.visible, label.visible]).toEqual([true, true, true])
    expect(hiddenLabel.visible).toBe(false) // hidden before, hidden after
  })

  it('shows the overlays again when drawing throws', () => {
    const { scene, sign } = town()
    expect(() => withoutOverlays(scene, () => { throw new Error('lost context') })).toThrow('lost context')
    expect(sign.visible).toBe(true)
  })
})
