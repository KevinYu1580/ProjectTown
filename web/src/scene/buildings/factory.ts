// Factory: brick hall with a glass office front, stepped sawtooth roof with glazed faces, chimney that smokes while running.
import * as THREE from 'three'
import { PAL, accentTone } from '../palette'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

const W = 9
const D = 8
const HW = W / 2
const HD = D / 2
const WALL = 0.3
const H = 4.2 // wall height
const SLAB = 0.25
const GLASS_Z = HD - 0.15
const DOOR_X = 2.6
const TEETH = 3
const TOOTH_D = D / TEETH
const STEPS = 4
const STEP_D = TOOTH_D / STEPS
const STEP_RISE = 0.35
const FACE_H = 0.45 + STEP_RISE * (STEPS - 1) // vertical glazed face of one tooth
const WARM = 0xffd08a

const CHIMNEY = { x: 3.3, z: -2.6 }
const PUFFS = 10
const PUFF_PERIOD = 7000

export const build: BuildFn = (color) => {
  const brick = material(PAL.brick[1])
  const steel = material(PAL.steel[1])
  const accent = material(accentTone(color))
  const dark = material(PAL.frame)
  const wood = material(PAL.wood[1])
  const yellow = material(0xe8b83a)

  const interior = new THREE.MeshStandardMaterial({ color: 0xc4bfb4, emissive: 0xffc27a, roughness: 0.9 })
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9cc8e0, emissive: WARM, transparent: true, opacity: 0.25, roughness: 0.2, depthWrite: false,
  })
  const smokeMat = new THREE.MeshStandardMaterial({ color: 0xdfe3ea, roughness: 1, transparent: true, opacity: 0.75, depthWrite: false })

  const solid = new VoxelBuilder()
  const glow = new VoxelBuilder()
  const screens = new VoxelBuilder()
  const glass = new VoxelBuilder()
  const inside = new VoxelBuilder()

  // Shell: brick walls, steel roof slab with an accent fascia.
  solid.box(0, 0, -HD + WALL / 2, W, H, WALL, brick)
  for (const s of [-1, 1]) solid.box(s * (HW - WALL / 2), 0, -WALL / 2, WALL, H, D - WALL, brick) // stops at the front piers
  solid.box(0, H, 0, W + 0.3, SLAB, D + 0.3, steel)
  const fy = H - 0.05
  solid.box(0, fy, HD + 0.15 + 0.05, W + 0.5, SLAB + 0.2, 0.1, accent)
  solid.box(0, fy, -HD - 0.15 - 0.05, W + 0.5, SLAB + 0.2, 0.1, accent)
  for (const s of [-1, 1]) solid.box(s * (HW + 0.2), fy, 0, 0.1, SLAB + 0.2, D + 0.3, accent)

  // Sawtooth roof: stepped slopes rising towards +Z, each ending in a vertical glazed face.
  const y0 = H + SLAB
  const windows = new WindowSet()
  const faceXs = [-3.0, 0, 3.0]
  const faceZ = (k: number) => -HD + (k + 1) * TOOTH_D
  for (let k = 0; k < TEETH; k++) {
    for (let i = 0; i < STEPS; i++) {
      const z = -HD + k * TOOTH_D + (i + 0.5) * STEP_D
      solid.box(0, y0, z, W, 0.45 + STEP_RISE * i, STEP_D, steel)
    }
    const z1 = faceZ(k)
    solid.box(0, y0 + FACE_H - 0.12, z1 + 0.06, W, 0.12, 0.12, accent)
    for (const x of [-1.5, 1.5]) solid.box(x, y0 + 0.45, z1 + 0.05, 0.6, FACE_H - 0.57, 0.1, steel)
  }

  // Front: glass office run, personnel door with accent lintel, brick pier at the right.
  inside.box(0, 0, 0, W - 2 * WALL, 0.1, D - 2 * WALL, interior)
  inside.box(0, 0.1, -HD + WALL + 0.02, W - 2 * WALL, H - 0.1, 0.04, interior)
  for (const s of [-1, 1]) inside.box(s * (HW - WALL - 0.02), 0.1, 0, 0.04, H - 0.1, D - 2 * WALL, interior)
  for (const z of [2.6, 0.9, -1.0, -2.8]) glow.box(0, H - 0.06, z, 7.4, 0.06, 0.25, lightMat)

  const glassL = -4.0
  const glassR = 1.8
  glass.box((glassL + glassR) / 2, 0.35, GLASS_Z, glassR - glassL, H - 0.3 - 0.35, 0.05, glassMat)
  solid.box(0, H - 0.3, HD - 0.3, W, 0.3, 0.3, steel)
  solid.box((glassL + glassR) / 2, 0.1, GLASS_Z, glassR - glassL, 0.25, 0.2, dark)
  for (let x = glassL + 1.4; x < glassR - 0.1; x += 1.4) solid.box(x, 0.35, GLASS_Z, 0.1, H - 0.95, 0.14, dark)
  solid.box(-HW + 0.25, 0, HD - 0.15, 0.5, H - 0.3, 0.3, brick)
  solid.box(HW - 0.55, 0, HD - 0.15, 1.1, H - 0.3, 0.3, brick)
  solid.box(1.9, 0, HD - 0.15, 0.25, H - 0.3, 0.3, steel)
  solid.box(DOOR_X + 0.85, 0, HD - 0.15, 0.25, H - 0.3, 0.3, steel)
  solid.box(DOOR_X, 0.1, GLASS_Z, 1.4, 2.4, 0.1, dark) // door leaf
  glass.box(DOOR_X, 1.2, GLASS_Z + 0.06, 0.7, 0.7, 0.04, glassMat)
  solid.box(DOOR_X, 2.55, HD - 0.05, 1.9, 0.4, 0.2, accent) // lintel
  solid.box(DOOR_X, 0, HD + 0.1, 1.8, 0.1, 0.5, steel) // threshold step
  solid.box(DOOR_X - 0.45, 1.0, GLASS_Z + 0.06, 0.06, 0.5, 0.05, steel)

  // Side loading shutter (+X) with slats; crates and drums by the front corners.
  solid.box(HW + 0.04, 0.1, 2.3, 0.08, 2.8, 2.6, steel)
  for (let i = 0; i < 6; i++) solid.box(HW + 0.09, 0.4 + i * 0.45, 2.3, 0.04, 0.06, 2.6, dark)
  solid.box(HW + 0.09, 2.7, 2.3, 0.05, 0.2, 2.6, yellow)
  solid.box(3.9, 0, HD + 0.5, 0.9, 0.7, 0.8, accent)
  solid.box(3.9, 0.7, HD + 0.5, 0.6, 0.5, 0.6, wood)
  for (const x of [-4.0, -3.4]) solid.box(x, 0, HD + 0.45, 0.5, 0.7, 0.5, yellow)

  // Windows: glazed faces first (front tooth, then +X wall), the rest follow.
  const addFace = (k: number) => {
    for (const x of faceXs) windows.add(x, y0 + 0.55 + 0.425, faceZ(k), 2.4, 0.85, 'z+')
  }
  addFace(2)
  for (const z of [-3.0, -1.5, 0]) windows.add(HW, 2.7, z, 1.1, 1.3, 'x+')
  addFace(1)
  addFace(0)
  for (const z of [-3.0, -1.5, 1.5]) windows.add(-HW, 2.7, z, 1.1, 1.3, 'x-')
  for (const x of faceXs) windows.add(x, 2.7, -HD, 1.4, 1.3, 'z-')

  // Chimney with accent rings.
  const { x: cx, z: cz } = CHIMNEY
  solid.box(cx, y0, cz, 1.4, 1.6, 1.4, brick)
  solid.box(cx, y0 + 1.6, cz, 1.0, 4.4, 1.0, brick)
  solid.box(cx, y0 + 4.5, cz, 1.1, 0.6, 1.1, accent)
  solid.box(cx, y0 + 6.0, cz, 1.25, 0.25, 1.25, dark)
  const chimneyTop = y0 + 6.25

  // Workstations behind the glass: two staggered rows. People face +Z, monitors sit beside them.
  const deskSpots: THREE.Vector3[] = []
  const spots: Array<[number, number]> = [
    [-1.7, 2.8], [-3.2, 2.8], [-0.2, 2.8], [-2.45, 1.6], [-0.95, 1.6], [0.55, 1.6],
  ]
  for (const [x, z] of spots) {
    deskSpots.push(new THREE.Vector3(x, 0.1, z))
    solid.box(x, 0.1, z + 0.55, 1.3, 0.75, 0.45, wood)
    solid.box(x + 0.48, 0.85, z + 0.55, 0.1, 0.12, 0.1, dark)
    screens.box(x + 0.48, 0.97, z + 0.55, 0.5, 0.3, 0.05, screenMat)
    solid.box(x - 0.1, 0.85, z + 0.45, 0.4, 0.03, 0.14, dark)
  }
  // Production line at the back: conveyor with product crates, a machine with a beacon.
  solid.box(0.6, 0.1, -1.4, 5.6, 0.6, 0.9, dark)
  solid.box(0.6, 0.7, -1.4, 5.6, 0.05, 0.7, steel)
  for (const x of [-1.6, 0.2, 2.0]) solid.box(x, 0.75, -1.4, 0.6, 0.5, 0.5, accent)
  solid.box(-2.6, 0.1, -2.9, 2.0, 2.2, 1.4, steel)
  solid.box(-2.6, 2.3, -2.9, 2.2, 0.2, 1.6, yellow)
  glow.box(-3.1, 2.5, -2.9, 0.3, 0.3, 0.3, lightMat)
  solid.box(HW - 1.0, 0.1, -2.9, 1.2, 1.6, 1.4, dark)

  const object = new THREE.Group()
  object.add(solid.build({ castShadow: true, receiveShadow: true }))
  object.add(inside.build(), glow.build(), screens.build(), glass.build(), windows.object)

  // Smoke: instanced cubes rise from the chimney, swell and shrink away. Phase comes from scene time, so frozen frames repeat.
  const smoke = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), smokeMat, PUFFS)
  smoke.frustumCulled = false
  smoke.visible = false
  object.add(smoke)
  let active = false
  let amount = 0
  let lastDt = 0
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const pos = new THREE.Vector3()
  const scl = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const drawSmoke = (nowMs: number) => {
    smoke.visible = amount > 0.001
    if (!smoke.visible) return
    for (let i = 0; i < PUFFS; i++) {
      const a = (((nowMs + (i * PUFF_PERIOD) / PUFFS) % PUFF_PERIOD) / PUFF_PERIOD)
      const fade = 1 - THREE.MathUtils.smoothstep(a, 0.7, 1)
      const s = (0.4 + 1.1 * a) * fade * amount
      pos.set(cx + a * 2.2 + 0.2 * Math.sin(i * 2.3), chimneyTop + 0.3 + a * 6.5, cz + 0.25 * Math.sin(i * 1.7))
      q.setFromAxisAngle(yAxis, i * 0.7 + a * 1.2)
      m.compose(pos, q, scl.setScalar(s))
      smoke.setMatrixAt(i, m)
    }
    smoke.instanceMatrix.needsUpdate = true
  }

  let lit = true
  let level = 1
  const applyLight = () => {
    interior.emissiveIntensity = lit ? 1.1 - 0.9 * level : 0
    lightMat.emissiveIntensity = lit ? 2.6 - 1.6 * level : 0
    screenMat.emissiveIntensity = lit ? 2 - 1.2 * level : 0.05
    glassMat.emissiveIntensity = lit ? 0.7 - 0.6 * level : 0
    glassMat.opacity = lit ? 0.2 : 0.3
  }
  applyLight()

  return {
    style: 'factory',
    object,
    footprint: { width: W, depth: D },
    height: chimneyTop,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots,
    doorSpot: new THREE.Vector3(DOOR_X, 0, HD + 0.9),
    signAnchor: new THREE.Vector3(0, y0 + FACE_H, 0),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, s: WindowState) => windows.setState(i, s),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity(running: boolean) {
      if (running && !active && lastDt === 0) amount = 1 // frozen or first frame: no ramp
      active = running
      windows.setFlicker(running)
    },
    update(dtMs: number, nowMs: number) {
      lastDt = dtMs
      windows.update(dtMs)
      const target = active ? 1 : 0
      const step = dtMs / 1200
      amount = amount < target ? Math.min(target, amount + step) : Math.max(target, amount - step)
      drawSmoke(nowMs)
    },
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      smoke.dispose()
      interior.dispose(); lightMat.dispose(); screenMat.dispose(); glassMat.dispose(); smokeMat.dispose()
    },
  }
}
