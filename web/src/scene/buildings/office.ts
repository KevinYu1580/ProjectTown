// Office tower: glass-fronted lobby with desks, three floors of regular window grid, project-colour crown.
import * as THREE from 'three'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

const W = 9
const D = 7
const HW = W / 2
const HD = D / 2
const WALL = 0.3
const GROUND_H = 3.6
const FLOOR_H = 2.9
const FLOORS = 3 // above the lobby
const ROOF_Y = GROUND_H + FLOOR_H * FLOORS
const ROOF_DECK = 0.15
const PARAPET = 0.45
const GLASS_Z = HD - 0.15
const WARM = 0xffd08a

export const build: BuildFn = (color) => {
  const wall = material(0xe4e6ec)
  const trim = material(0x98a1b4)
  const accent = material(color)
  const dark = material(0x2a2f3d)
  const wood = material(0x9b7452)
  const green = material(0x4f9a5a)

  // Own materials: emissive strength follows lit state and light level.
  const interior = new THREE.MeshStandardMaterial({ color: 0xd9c7a8, emissive: 0xffc27a, roughness: 0.9 })
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9cc8e0, emissive: WARM, transparent: true, opacity: 0.25, roughness: 0.2, depthWrite: false,
  })

  const solid = new VoxelBuilder()
  const glow = new VoxelBuilder()
  const screens = new VoxelBuilder()
  const glass = new VoxelBuilder()
  const inside = new VoxelBuilder()

  // Shell: ground walls, upper body, roof, parapet.
  solid.box(0, 0, -HD + WALL / 2, W, GROUND_H, WALL, wall)
  for (const s of [-1, 1]) solid.box(s * (HW - WALL / 2), 0, -WALL / 2, WALL, GROUND_H, D - WALL, wall) // stops at the front pier
  solid.box(0, GROUND_H, 0, W, FLOOR_H * FLOORS, D, wall)
  solid.box(0, ROOF_Y, 0, W + 0.3, ROOF_DECK, D + 0.3, trim)
  const py = ROOF_Y + ROOF_DECK
  solid.box(0, py, HD + 0.025, W + 0.3, PARAPET, 0.25, accent)
  solid.box(0, py, -HD - 0.025, W + 0.3, PARAPET, 0.25, accent)
  for (const s of [-1, 1]) solid.box(s * (HW + 0.025), py, 0, 0.25, PARAPET, D + 0.3, accent)

  // Lobby interior (emissive so people read against a lit room), floor, ceiling lights.
  inside.box(0, 0, 0, W - 2 * WALL, 0.1, D - 2 * WALL, interior)
  inside.box(0, 0.1, -HD + WALL + 0.02, W - 2 * WALL, GROUND_H - 0.1, 0.04, interior)
  for (const s of [-1, 1]) inside.box(s * (HW - WALL - 0.02), 0.1, 0, 0.04, GROUND_H - 0.1, D - 2 * WALL, interior)
  for (const z of [2.5, 1.2, -0.2]) glow.box(0, GROUND_H - 0.06, z, 7.2, 0.06, 0.25, lightMat)

  // Storefront: one glass run with a dark base, mullions, header band and a central double door.
  glass.box(0, 0.35, GLASS_Z, 8, GROUND_H - 0.65 - 0.35, 0.05, glassMat)
  solid.box(0, GROUND_H - 0.3, HD - 0.3, W, 0.3, 0.3, trim)
  for (const s of [-1, 1]) {
    solid.box(s * (HW - 0.25), 0, HD - 0.15, 0.5, GROUND_H - 0.3, 0.3, trim)
    solid.box(s * 2.5, 0.1, GLASS_Z, 3.0, 0.25, 0.2, dark)
    solid.box(s * 2.5, 0.35, GLASS_Z, 0.1, GROUND_H - 0.95, 0.14, dark)
    solid.box(s * 0.95, 0.1, GLASS_Z, 0.12, 2.45, 0.18, dark)
  }
  solid.box(0, 2.55, GLASS_Z, 2.0, 0.12, 0.18, dark)
  solid.box(0, 0.1, GLASS_Z, 0.1, 2.45, 0.14, dark)
  solid.box(0, 0.1, GLASS_Z, 1.8, 0.2, 0.18, dark)
  for (const s of [-1, 1]) solid.box(s * 0.25, 1.0, GLASS_Z + 0.1, 0.06, 0.6, 0.05, trim)
  solid.box(0, 0, HD + 0.1, 2.2, 0.1, 0.5, trim) // threshold step
  solid.box(0, 3.0, HD + 0.4, 3.4, 0.22, 1.1, accent) // entrance canopy
  for (const s of [-1, 1]) {
    solid.box(s * 3.3, 0, HD + 0.45, 1.3, 0.45, 0.5, trim) // planters
    solid.box(s * 3.3, 0.45, HD + 0.45, 1.1, 0.4, 0.4, green)
  }

  // Windows: regular grid on every face. Front faces first so sleeping windows show from the default view.
  const windows = new WindowSet()
  const frontXs = [-3.4, -1.7, 0, 1.7, 3.4]
  const sideZs = [-2.2, 0, 2.2]
  const rowY = (f: number) => GROUND_H + FLOOR_H * (f + 0.5)
  for (let f = 0; f < FLOORS; f++) for (const x of frontXs) windows.add(x, rowY(f), HD, 1.1, 1.5, 'z+')
  for (let f = 0; f < FLOORS; f++) for (const z of sideZs) windows.add(HW, rowY(f), z, 1.3, 1.5, 'x+')
  for (const z of [-1.4, 1.4]) windows.add(HW, 1.9, z, 1.3, 1.3, 'x+')
  for (let f = 0; f < FLOORS; f++) for (const z of sideZs) windows.add(-HW, rowY(f), z, 1.3, 1.5, 'x-')
  for (const z of [-1.4, 1.4]) windows.add(-HW, 1.9, z, 1.3, 1.3, 'x-')
  for (let f = 0; f < FLOORS; f++) for (const x of frontXs) windows.add(x, rowY(f), -HD, 1.1, 1.5, 'z-')

  // Sills under every upper window give the grid some relief.
  for (let f = 0; f < FLOORS; f++) {
    const y = rowY(f) - 0.75 - 0.1
    for (const x of frontXs) for (const s of [-1, 1]) solid.box(x, y, s * (HD + 0.09), 1.3, 0.1, 0.18, trim)
    for (const z of sideZs) for (const s of [-1, 1]) solid.box(s * (HW + 0.09), y, z, 0.18, 0.1, 1.5, trim)
  }

  // Piers between windows and floor bands (they stand proud of the window quads).
  const pierH = FLOOR_H * FLOORS
  for (const x of [-4.25, -2.55, -0.85, 0.85, 2.55, 4.25]) {
    const w = Math.abs(x) > 4 ? 0.5 : 0.6
    solid.box(x, GROUND_H, HD + 0.06, w, pierH, 0.12, trim)
    solid.box(x, GROUND_H, -HD - 0.06, w, pierH, 0.12, trim)
  }
  for (const z of [-3.25, -1.1, 1.1, 3.25]) {
    const w = Math.abs(z) > 3 ? 0.5 : 0.6
    for (const s of [-1, 1]) solid.box(s * (HW + 0.06), GROUND_H, z, 0.12, pierH, w, trim)
  }
  for (let f = 1; f < FLOORS; f++) solid.box(0, GROUND_H + FLOOR_H * f - 0.12, 0, W + 0.24, 0.24, D + 0.24, trim)

  // Desks: two staggered rows per side behind the glass. People face +Z, monitors sit beside them.
  const deskSpots: THREE.Vector3[] = []
  const spots: Array<[number, number]> = [
    [-1.8, 2.45], [1.8, 2.45], [-3.4, 2.45], [3.4, 2.45], [-2.6, 1.35], [2.6, 1.35],
  ]
  for (const [x, z] of spots) {
    deskSpots.push(new THREE.Vector3(x, 0.1, z))
    solid.box(x, 0.1, z + 0.55, 1.3, 0.75, 0.45, wood)
    const mx = x + 0.48
    solid.box(mx, 0.85, z + 0.55, 0.1, 0.12, 0.1, dark)
    screens.box(mx, 0.97, z + 0.55, 0.5, 0.3, 0.05, screenMat)
    solid.box(x - 0.1, 0.85, z + 0.45, 0.4, 0.03, 0.14, dark) // keyboard
  }
  solid.box(0, 0.1, -1.6, 3.2, 1.0, 0.7, accent) // reception counter
  solid.box(0, 1.1, -1.6, 3.3, 0.08, 0.8, trim)
  for (const s of [-1, 1]) {
    solid.box(s * 3.7, 0.1, -2.6, 0.5, 0.4, 0.5, dark) // plant pots
    solid.box(s * 3.7, 0.5, -2.6, 0.6, 1.2, 0.6, green)
  }

  // Rooftop: AC units, stair housing, planter and an antenna kept off-centre so the sign stays clear.
  for (const x of [-3.0, -1.6]) {
    solid.box(x, py, -2.2, 1.2, 0.8, 1.0, trim)
    solid.box(x, py + 0.8, -2.2, 0.8, 0.1, 0.6, dark)
  }
  solid.box(3.0, py, -2.0, 1.8, 1.5, 1.8, wall)
  solid.box(3.0, py, -2.0 + 0.92, 0.7, 1.1, 0.06, dark)
  solid.box(3.0, py + 1.5, -2.0, 2.0, 0.12, 2.0, trim)
  solid.box(-3.3, py, 1.5, 1.3, 0.45, 1.0, green)
  solid.box(3.9, py, 1.7, 0.1, 2.2, 0.1, dark)
  solid.box(3.9, py + 1.6, 1.7, 0.7, 0.08, 0.08, dark)
  const height = py + 2.2

  const object = new THREE.Group()
  object.add(solid.build({ castShadow: true, receiveShadow: true }))
  object.add(inside.build(), glow.build(), screens.build(), glass.build(), windows.object)

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
    style: 'office',
    object,
    footprint: { width: W, depth: D },
    height,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots,
    doorSpot: new THREE.Vector3(0, 0, HD + 0.9),
    signAnchor: new THREE.Vector3(0, ROOF_Y + ROOF_DECK, 0),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, s: WindowState) => windows.setState(i, s),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity: (running: boolean) => windows.setFlicker(running),
    update: (dtMs: number) => windows.update(dtMs),
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      interior.dispose(); lightMat.dispose(); screenMat.dispose(); glassMat.dispose()
    },
  }
}
