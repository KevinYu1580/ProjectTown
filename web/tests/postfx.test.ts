import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { TARGET_HEIGHT, cameraPosition, fitDistance } from '../src/scene/cameraMath'
import { computeLayout } from '../src/scene/layout'
import { townDepthRange } from '../src/scene/postfx'

type Bounds = ReturnType<typeof computeLayout>['bounds']
type Vec3 = { x: number; y: number; z: number }

const depthRange = (eye: Vec3, dir: Vec3, bounds: Bounds, height: number) => {
  const out = { x: NaN, y: NaN }
  townDepthRange(eye, dir, bounds, height, out)
  return out
}

describe('townDepthRange', () => {
  const box = { minX: -10, maxX: 10, minZ: -20, maxZ: 20 }

  it('measures along the view direction', () => {
    expect(depthRange({ x: 0, y: 5, z: 100 }, { x: 0, y: 0, z: -1 }, box, 30)).toEqual({ x: 80, y: 120 })
    // Straight down from 50 m: the top of a 12 m box is 38 m away, the ground 50 m.
    expect(depthRange({ x: 3, y: 50, z: -7 }, { x: 0, y: -1, z: 0 }, box, 12)).toEqual({ x: 38, y: 50 })
  })

  it('matches the view-space depth of the town box for every rig pose and town size', () => {
    for (const n of [1, 6, 25]) {
      const { bounds } = computeLayout(n)
      const height = 22
      const target: [number, number, number] = [0, height * TARGET_HEIGHT, 0]
      const camera = new THREE.PerspectiveCamera(30, 16 / 9, 1, 3000)
      camera.setViewOffset(1600, 900, -64, 45, 1600, 900) // the rig's HUD shift does not change view depth
      const corner = new THREE.Vector3()
      for (const pitch of [20, 40, 70]) {
        for (const zoom of [0.5, 1, 3]) {
          for (const azimuth of [0, 45, 160, 300]) {
            const focus = fitDistance(bounds, height, 16 / 9) / zoom
            camera.position.set(...cameraPosition(target, focus, azimuth, pitch))
            camera.lookAt(...target)
            camera.updateMatrixWorld()
            const r = depthRange(camera.position, camera.getWorldDirection(new THREE.Vector3()), bounds, height)

            let near = Infinity
            let far = -Infinity
            for (const x of [bounds.minX, bounds.maxX]) {
              for (const y of [0, height]) {
                for (const z of [bounds.minZ, bounds.maxZ]) {
                  const depth = -corner.set(x, y, z).applyMatrix4(camera.matrixWorldInverse).z
                  near = Math.min(near, depth)
                  far = Math.max(far, depth)
                }
              }
            }
            const pose = `n=${n} pitch=${pitch} zoom=${zoom} azimuth=${azimuth}`
            expect(r.x, pose).toBeCloseTo(near, 6)
            expect(r.y, pose).toBeCloseTo(far, 6)
            // The rig target, where the camera is focused, lies inside the sharp zone.
            expect(r.x, pose).toBeLessThan(focus)
            expect(r.y, pose).toBeGreaterThan(focus)
          }
        }
      }
    }
  })

  it('a larger town has a deeper sharp zone at the same pose', () => {
    const dir = new THREE.Vector3(-1, -1, -1).normalize()
    const eye = { x: 150, y: 150, z: 150 }
    const span = (n: number) => {
      const r = depthRange(eye, dir, computeLayout(n).bounds, 20)
      return r.y - r.x
    }
    expect(span(6)).toBeGreaterThan(span(1))
    expect(span(25)).toBeGreaterThan(span(6))
  })
})
