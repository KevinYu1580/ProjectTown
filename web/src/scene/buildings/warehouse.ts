// Warehouse: wide and low, corrugated walls, stepped roof with skylights, half-open roll-up door, glass office, pallets and crates.
import * as THREE from 'three'
import { PAL, accentTone } from '../palette'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

type Facing = 'x+' | 'x-' | 'z+' | 'z-'

const W = 9
const D = 7.5
const GLASS_TOP = 3.7
const WH = 4.7 // wall height
const ZG = D / 2 - 0.05 // storefront glass plane
const DOOR_X = -1.3
const WARM = 0xffd08a
const STEP_H = 0.25
const STEPS = [D - 0.4, D * 0.72, D * 0.46, D * 0.2] // roof step depths

// Office stations [x, z], front row first. Zig-zag so that, at the default 45 degree camera, people in both rows show through the glass.
const DESKS: Array<[number, number]> = [-0.1, 1.5, 3.1].map((x): [number, number] => [x, ZG - 1.0])
  .concat([-0.9, 0.7, 2.3].map((x): [number, number] => [x, ZG - 1.65]))

export const build: BuildFn = (color) => {
  const wall = material(PAL.steel[2])
  const rib = material(PAL.steel[1])
  const roof = material(PAL.slate[2])
  const dark = material(PAL.frame)
  const floorMat = material(PAL.paving[0])
  const wood = material(PAL.wood[2])
  const cardboard = material(0xc89b5d)
  const rack = material(0xe0872b)
  const accent = material(accentTone(color))

  // Own materials: emissive strength depends on lit state and light level.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM, emissiveIntensity: 2 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff, emissiveIntensity: 2 })
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x3a2200, emissive: 0xff9a1f, emissiveIntensity: 1 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9cc8e0, emissive: WARM, emissiveIntensity: 0.5, transparent: true, opacity: 0.3, roughness: 0.2, depthWrite: false,
  })

  const solid = new VoxelBuilder()
  const glow = new VoxelBuilder()
  const screens = new VoxelBuilder()
  const beacon = new VoxelBuilder()
  const glass = new VoxelBuilder()
  const windows = new WindowSet()

  // Window plus a dark frame that sticks out less than the glowing quad (no z-fighting).
  const win = (facing: Facing, plane: number, p: number, y: number, w: number, h: number) => {
    const zFace = facing[0] === 'z'
    const x = zFace ? p : plane
    const z = zFace ? plane : p
    windows.add(x, y, z, w, h, facing)
    solid.box(x, y - h / 2 - 0.1, z, zFace ? w + 0.2 : 0.1, h + 0.2, zFace ? 0.1 : w + 0.2, dark)
  }

  // Shell: floor, back and side walls, ceiling block, front wall pieces
  solid.box(0, 0, 0, W, 0.1, D, floorMat)
  solid.box(0, 0.1, -D / 2 + 0.15, W, WH - 0.1, 0.3, wall)
  for (const sx of [-1, 1]) solid.box(sx * (W / 2 - 0.15), 0.1, 0, 0.3, WH - 0.1, D, wall)
  solid.box(0, GLASS_TOP, 0, W, WH - GLASS_TOP, D, wall) // ceiling block, front header included
  const front = (x0: number, x1: number) => solid.box((x0 + x1) / 2, 0.1, D / 2 - 0.15, x1 - x0, GLASS_TOP - 0.1, 0.3, wall)
  front(-W / 2, -4.2); front(-2.1, -1.8); front(-0.8, -0.6); front(4.2, W / 2)
  solid.box(0, GLASS_TOP - 0.15, D / 2 - 0.15, W, 0.15, 0.3, dark) // header trim

  // Corrugation ribs on the lower side and back walls
  for (let x = -4.1; x <= 4.1; x += 0.7) solid.box(x, 0.1, -D / 2 - 0.04, 0.16, 3.3, 0.08, rib)
  for (const sx of [-1, 1]) for (let z = -3.4; z <= 3.4; z += 0.7) solid.box(sx * (W / 2 + 0.04), 0.1, z, 0.08, 3.3, 0.16, rib)

  // Person door (left of centre) and glass office (right)
  solid.box(DOOR_X, 0.1, ZG, 1.0, 2.2, 0.1, dark)
  solid.box(DOOR_X, 2.7, D / 2 + 0.5, 1.6, 0.12, 1.0, accent) // door canopy
  glass.box(DOOR_X, 2.3, ZG, 1.0, GLASS_TOP - 2.3, 0.06, glassMat)
  glass.box(1.8, 0.1, ZG, 4.8, GLASS_TOP - 0.1, 0.06, glassMat)
  for (const x of [1.0, 2.6]) solid.box(x, 0.1, ZG, 0.08, GLASS_TOP - 0.1, 0.1, dark) // mullions

  // Half-open roll-up door: slats hang from the top, the lower part shows racks inside
  const rollTop = 3.3
  const rollBottom = 2.1
  const slatH = 0.2
  for (let i = 0, y = rollTop - slatH; y >= rollBottom - 0.01; i++, y -= slatH) {
    solid.box(-3.15, y, D / 2 + 0.03, 1.9, slatH - 0.03, 0.06, i % 2 ? wall : rib)
  }
  solid.box(-3.15, rollTop, D / 2 + 0.08, 2.2, 0.4, 0.3, dark) // roller housing
  for (const x of [-4.1, -2.2]) solid.box(x, 0.1, D / 2 + 0.02, 0.12, rollTop - 0.1, 0.1, dark) // guide rails
  solid.box(-3.15, rollBottom - 0.08, D / 2 + 0.03, 1.9, 0.08, 0.1, accent) // bottom bar in the project colour
  // pallet rack behind the opening
  const rz = ZG - 1.5
  for (const x of [-4.0, -2.3]) for (const z of [rz, rz - 0.7]) solid.box(x, 0.1, z, 0.1, 2.0, 0.1, rack)
  for (const y of [0.55, 1.2, 1.85]) for (const z of [rz, rz - 0.7]) solid.box(-3.15, y, z, 1.8, 0.08, 0.08, rack)
  for (const [x, y, s] of [[-3.65, 0.1, 0.6], [-3.0, 0.1, 0.7], [-2.55, 0.1, 0.5], [-3.5, 0.63, 0.5], [-2.7, 0.63, 0.5], [-3.2, 1.28, 0.5]] as const) {
    solid.box(x, y, rz - 0.35, s, s * 0.8, 0.6, y > 1 ? accent : cardboard)
  }

  // Stepped roof with skylights and a coloured ridge and eave
  solid.box(0, WH, 0, W + 0.5, 0.3, D + 0.3, accent)
  let y = WH + 0.3
  STEPS.forEach((depth, i) => {
    solid.box(0, y, 0, W + 0.3, STEP_H, depth, i % 2 ? rib : roof)
    y += STEP_H
  })
  solid.box(0, y, 0, W + 0.4, 0.15, 0.5, accent)
  const topY = y + 0.15
  const skyY = WH + 0.3 + STEP_H
  for (const x of [-2.8, 0, 2.8]) {
    glow.box(x, skyY, (STEPS[0] + STEPS[1]) / 4 - 0.1, 1.4, 0.07, 0.6, lightMat)
    glow.box(x, skyY + STEP_H, (STEPS[1] + STEPS[2]) / 4 - 0.1, 1.4, 0.07, 0.5, lightMat)
  }
  solid.box(3.3, WH + 0.3 + STEP_H * 2, -1.0, 0.8, 0.5, 0.8, dark) // roof vent
  solid.box(-3.3, WH + 0.3 + STEP_H, -1.5, 0.8, 0.4, 0.8, dark)
  beacon.box(-3.15, rollTop + 0.4, D / 2 + 0.12, 0.3, 0.2, 0.2, beaconMat) // warning beacon on the housing

  // Windows: front clerestory first (visible), then right side, left, back
  for (let x = -3.9; x <= 3.95; x += 1.3) win('z+', D / 2, x, 4.2, 0.9, 0.55)
  for (const z of [-2.2, 0, 2.2]) win('x+', W / 2, z, 4.2, 1.0, 0.6)
  for (const z of [-2.2, 0, 2.2]) win('x-', -W / 2, z, 4.2, 1.0, 0.6)
  for (const x of [-3.2, -1.6, 0, 1.6, 3.2]) win('z-', -D / 2, x, 4.2, 0.9, 0.6)

  // Office: desks with monitors, warm ceiling strips
  const deskSpots: THREE.Vector3[] = []
  for (const [x, z] of DESKS) {
    deskSpots.push(new THREE.Vector3(x, 0.1, z))
    solid.box(x, 0.1, z + 0.7, 0.9, 0.75, 0.5, wood)
    solid.box(x - 0.1, 0.85, z + 0.7, 0.2, 0.08, 0.2, dark)
    screens.box(x - 0.1, 0.93, z + 0.7, 0.5, 0.36, 0.06, screenMat)
  }
  for (const z of [ZG - 0.7, ZG - 2.0]) glow.box(1.8, GLASS_TOP - 0.1, z, 4.4, 0.1, 0.4, lightMat)
  glow.box(-3.15, GLASS_TOP - 0.1, ZG - 1.5, 1.9, 0.1, 0.4, lightMat)
  solid.box(1.5, 0.1, -D / 2 + 0.5, 6.0, 1.2, 0.5, wood) // back shelf units
  for (const x of [-0.5, 1.0, 2.5, 3.5]) solid.box(x, 1.3, -D / 2 + 0.5, 0.5, 0.4, 0.4, cardboard)

  // Pallets and crates outside
  const pallet = (x: number, z: number, crates: number) => {
    solid.box(x, 0, z, 1.3, 0.15, 1.0, wood)
    for (let i = 0; i < crates; i++) {
      const s = 0.62 - i * 0.04
      solid.box(x + (i % 2 ? 0.1 : -0.08), 0.15 + i * 0.55, z, s + 0.45, 0.55, s + 0.3, i === 1 ? accent : cardboard)
    }
  }
  pallet(-5.6, 2.2, 3)
  pallet(5.2, 1.6, 2)
  pallet(5.2, -0.2, 3)
  for (const [x, z] of [[4.2, D / 2 + 0.7], [4.9, D / 2 + 0.9]] as const) solid.box(x, 0, z, 0.5, 0.9, 0.5, rack) // barrels

  // Forklift beside the roll-up door, carrying a crate
  const fx = -5.1
  const fz = D / 2 + 1.0
  solid.box(fx, 0.15, fz, 0.9, 0.7, 1.3, rack)
  for (const [dx, dz] of [[-0.5, -0.45], [0.5, -0.45], [-0.5, 0.45], [0.5, 0.45]] as const) solid.box(fx + dx, 0, fz + dz, 0.2, 0.4, 0.4, dark)
  for (const dx of [-0.4, 0.4]) for (const dz of [-0.55, 0.1]) solid.box(fx + dx, 0.85, fz + dz, 0.07, 1.0, 0.07, dark)
  solid.box(fx, 1.85, fz - 0.22, 1.0, 0.08, 0.8, rack)
  for (const dx of [-0.3, 0.3]) solid.box(fx + dx, 0.1, fz + 0.65, 0.08, 1.6, 0.08, dark) // mast
  for (const dx of [-0.25, 0.25]) solid.box(fx + dx, 0.55, fz + 0.65, 0.1, 0.06, 0.9, dark) // forks
  solid.box(fx, 0.61, fz + 1.05, 0.7, 0.5, 0.6, cardboard)

  const object = new THREE.Group()
  object.add(solid.build({ castShadow: true, receiveShadow: true }))
  object.add(glow.build(), screens.build(), beacon.build(), glass.build(), windows.object)

  let lit = true
  let level = 1
  let running = false
  let t = 0
  const applyLight = () => {
    lightMat.emissiveIntensity = lit ? 2.6 - 1.6 * level : 0
    screenMat.emissiveIntensity = lit ? 2 - 1.2 * level : 0.05
    glassMat.emissiveIntensity = lit ? 0.4 - 0.3 * level : 0
    glassMat.opacity = lit ? 0.22 : 0.3
    const blink = running && lit ? (Math.sin(t * 0.008) > 0 ? 1 : 0.15) : lit ? 0.5 : 0
    beaconMat.emissiveIntensity = blink * (4 - 2 * level)
  }
  applyLight()

  return {
    style: 'warehouse',
    object,
    footprint: { width: W, depth: D },
    height: topY,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots,
    doorSpot: new THREE.Vector3(DOOR_X, 0, D / 2 + 0.9),
    signAnchor: new THREE.Vector3(0, topY, 0),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, s: WindowState) => windows.setState(i, s),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity(r: boolean) { running = r; windows.setFlicker(r); applyLight() },
    update(dtMs: number) {
      windows.update(dtMs)
      t += dtMs
      if (running && lit) applyLight()
    },
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      lightMat.dispose(); screenMat.dispose(); beaconMat.dispose(); glassMat.dispose()
    },
  }
}
