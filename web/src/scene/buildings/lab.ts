// Lab: glass-fronted two-storey block, observatory-style voxel dome with a glowing slit, rooftop dish.
import * as THREE from 'three'
import { PAL, accentTone, mutedAccent } from '../palette'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

type Facing = 'x+' | 'x-' | 'z+' | 'z-'

const W = 8.4
const D = 7
const GH = 4.2 // double-height ground floor so people deep in the room stay visible through the glass
const ROOF = GH + 3
const EAVE = 0.35
const TOP = ROOF + EAVE
const ZG = D / 2 - 0.05 // storefront glass plane
const DOOR_X = -3.2
const DZ = -0.4 // drum / dome centre z
const DRUM_W = 5.2
const DRUM_H = 1.8
const WARM = 0xffd08a
const DL = 0.36 // dome layer height
const DOME = Array.from({ length: 7 }, (_, i) => 2 * Math.sqrt(2.6 ** 2 - ((i + 0.5) * DL) ** 2)) // layer widths of a hemisphere

// Stations [x, z], front row first. Zig-zag so that, at the default 45 degree camera, people in both rows show through the glass.
const DESKS: Array<[number, number]> = [-2.2, -0.5, 1.2].map((x): [number, number] => [x, ZG - 1.0])
  .concat([-1.35, 0.35, 2.05].map((x): [number, number] => [x, ZG - 1.65]))

export const build: BuildFn = (color) => {
  const wall = material(PAL.white[1])
  const fin = material(PAL.steel[2])
  const dark = material(PAL.frame)
  const floorMat = material(PAL.white[0])
  const domeMat = material(PAL.white[2])
  const accent = material(accentTone(color))

  // Own materials: emissive strength depends on lit state and light level.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM, emissiveIntensity: 2 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff, emissiveIntensity: 2 })
  const slitMat = new THREE.MeshStandardMaterial({ color: 0x1a3038, emissive: 0x7fe8ff, emissiveIntensity: 2 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9cc8e0, emissive: WARM, emissiveIntensity: 0.5, transparent: true, opacity: 0.3, roughness: 0.2, depthWrite: false,
  })

  const solid = new VoxelBuilder()
  const glow = new VoxelBuilder()
  const screens = new VoxelBuilder()
  const glass = new VoxelBuilder()
  const slit = new VoxelBuilder()
  const windows = new WindowSet()

  // Window plus a dark frame that sticks out less than the glowing quad (no z-fighting).
  const win = (facing: Facing, plane: number, p: number, y: number, w: number, h: number) => {
    const zFace = facing[0] === 'z'
    const x = zFace ? p : plane
    const z = zFace ? plane : p
    windows.add(x, y, z, w, h, facing)
    solid.box(x, y - h / 2 - 0.12, z, zFace ? w + 0.24 : 0.1, h + 0.24, zFace ? 0.1 : w + 0.24, dark)
  }

  // Shell: floor, ground-floor walls, open storefront, upper block
  solid.box(0, 0, 0, W, 0.1, D, floorMat)
  solid.box(0, 0.1, -D / 2 + 0.15, W, GH - 0.1, 0.3, wall)
  for (const sx of [-1, 1]) solid.box(sx * (W / 2 - 0.15), 0.1, 0, 0.3, GH - 0.1, D, wall)
  solid.box(0, GH, 0, W, 3, D, wall)
  for (const sx of [-1, 1]) solid.box(sx * (W / 2 - 0.2), 0.1, D / 2 - 0.15, 0.4, GH - 0.1, 0.3, wall)
  solid.box(0, 3.8, D / 2 - 0.15, W, GH - 3.8, 0.3, dark) // storefront header
  solid.box(-2.55, 0.1, D / 2 - 0.15, 0.1, 3.7, 0.3, dark)
  for (const x of [-0.4, 1.7]) solid.box(x, 0.1, ZG, 0.08, 3.7, 0.1, dark) // mullions
  glass.box(0.65, 0.1, ZG, 6.3, 3.7, 0.06, glassMat)
  solid.box(DOOR_X, 0.1, ZG, 1.2, 2.3, 0.1, dark) // door leaf
  glass.box(DOOR_X, 2.4, ZG, 1.2, 1.4, 0.06, glassMat)
  solid.box(DOOR_X, 2.7, D / 2 + 0.55, 1.8, 0.12, 1.1, accent) // door canopy
  solid.box(0, ROOF, 0, W + 0.6, EAVE, D + 0.6, material(mutedAccent(color)))
  for (let i = -2; i <= 2; i++) solid.box(i * 2.1, TOP, D / 2 + 0.2, 0.08, 0.8, 0.08, dark) // roof railing
  solid.box(0, TOP + 0.8, D / 2 + 0.2, W + 0.5, 0.07, 0.07, dark)
  for (const z of [-1.7, 0, 1.7]) solid.box(W / 2 + 0.2, TOP, z, 0.08, 0.8, 0.08, dark)
  solid.box(W / 2 + 0.2, TOP + 0.8, 0, 0.07, 0.07, D + 0.5, dark)

  // Upper-floor fins between the front windows
  for (const x of [-4, -2, 0, 2, 4]) solid.box(x, GH + 0.1, D / 2, 0.3, 2.8, 0.12, fin)

  // Windows: visible faces first so sleeping sessions take them first
  const wy = GH + 1.5
  for (const x of [-3, -1, 1, 3]) win('z+', D / 2, x, wy, 1.3, 1.5)
  for (const z of [-1.2, 1.2]) win('x+', W / 2, z, wy, 1.3, 1.5)
  const dy = TOP + 0.95
  for (const x of [-1.5, 0, 1.5]) win('z+', DZ + DRUM_W / 2, x, dy, 1.0, 1.0)
  for (const z of [DZ - 1.1, DZ + 1.1]) win('x+', DRUM_W / 2, z, dy, 1.0, 1.0)
  for (const z of [-1.2, 1.2]) win('x+', W / 2, z, 2.0, 1.2, 1.4)
  for (const z of [-1.2, 1.2]) win('x-', -W / 2, z, wy, 1.3, 1.5)
  for (const x of [-2.6, 0, 2.6]) win('z-', -D / 2, x, wy, 1.3, 1.5)
  for (const z of [DZ - 1.1, DZ + 1.1]) win('x-', -DRUM_W / 2, z, dy, 1.0, 1.0)
  for (const x of [-0.8, 0.8]) win('z-', DZ - DRUM_W / 2, x, dy, 1.0, 1.0)

  // Drum and dome (stacked octagon-ish layers)
  solid.box(0, TOP, DZ, DRUM_W, DRUM_H, DRUM_W, wall)
  solid.box(0, TOP + DRUM_H, DZ, DRUM_W + 0.4, 0.25, DRUM_W + 0.4, accent)
  const domeY = TOP + DRUM_H + 0.25
  DOME.forEach((s, i) => {
    const y = domeY + i * DL
    solid.box(0, y, DZ, s, DL, s * 0.7, domeMat)
    solid.box(0, y, DZ, s * 0.7, DL, s, domeMat)
    slit.box(0, y, DZ + s / 2, 0.5, DL, 0.08, slitMat)
    const next = DOME[i + 1]
    if (next) slit.box(0, y + DL, DZ + (s + next) / 4, 0.5, 0.05, (s - next) / 2 + 0.02, slitMat)
  })
  const domeTop = domeY + DOME.length * DL
  solid.box(0, domeTop, DZ, 1.4, 0.12, 1.4, domeMat)
  slit.box(0, domeTop + 0.01, DZ + 0.35, 0.5, 0.05, 0.9, slitMat)

  // Rooftop dish and AC unit
  solid.box(3.4, TOP, 1.0, 0.2, 0.9, 0.2, dark)
  solid.box(3.4, TOP + 0.9, 1.0, 1.0, 0.12, 1.0, domeMat)
  solid.box(3.4, TOP + 1.02, 1.0, 0.6, 0.1, 0.6, domeMat)
  solid.box(-3.3, TOP, 0.8, 1.2, 0.7, 1.0, fin)

  // Side fins and an exhaust duct on the right wall
  for (const z of [-2.4, 0, 2.4]) solid.box(W / 2, GH + 0.1, z, 0.12, 2.8, 0.3, fin)
  solid.box(W / 2 + 0.2, 0.1, -D / 2 + 0.35, 0.4, TOP + 1.4, 0.4, fin)
  solid.box(W / 2 + 0.2, TOP + 1.5, -D / 2 + 0.35, 0.6, 0.15, 0.6, dark)
  for (const y of [1.6, 5.4]) solid.box(W / 2 + 0.2, y, -D / 2 + 0.35, 0.5, 0.12, 0.5, accent)

  // Interior: lab benches with monitors and flasks (flasks use the project colour)
  const deskSpots: THREE.Vector3[] = []
  for (const [x, z] of DESKS) {
    deskSpots.push(new THREE.Vector3(x, 0.1, z))
    solid.box(x, 0.1, z + 0.7, 1.0, 0.75, 0.5, fin)
    solid.box(x - 0.15, 0.85, z + 0.7, 0.2, 0.08, 0.2, dark)
    screens.box(x - 0.15, 0.93, z + 0.7, 0.5, 0.36, 0.06, screenMat)
    solid.box(x + 0.32, 0.85, z + 0.7, 0.16, 0.28, 0.16, accent)
  }
  solid.box(0.65, 0.1, -D / 2 + 0.55, 6.0, 1.0, 0.5, fin) // back counter
  for (const x of [-1.8, -0.2, 1.4, 2.6]) solid.box(x, 1.1, -D / 2 + 0.55, 0.22, 0.36, 0.22, accent)
  screens.box(0.65, 1.7, -D / 2 + 0.34, 3.4, 1.3, 0.08, screenMat) // wall display
  for (const z of [ZG - 0.7, ZG - 2.0]) glow.box(0.65, GH - 0.14, z, 5.6, 0.1, 0.4, lightMat)

  const object = new THREE.Group()
  object.add(solid.build({ castShadow: true, receiveShadow: true }))
  object.add(glow.build(), screens.build(), slit.build(), glass.build(), windows.object)

  let lit = true
  let level = 1
  let running = false
  let t = 0
  const applyLight = () => {
    lightMat.emissiveIntensity = lit ? 2.6 - 1.6 * level : 0
    screenMat.emissiveIntensity = lit ? 2 - 1.2 * level : 0.05
    glassMat.emissiveIntensity = lit ? 0.4 - 0.3 * level : 0
    glassMat.opacity = lit ? 0.22 : 0.3
    const pulse = running && lit ? 1 + 0.2 * Math.sin(t * 0.004) : 1
    slitMat.emissiveIntensity = lit ? (1.9 - 1.0 * level) * pulse : 0.05
  }
  applyLight()

  return {
    style: 'lab',
    object,
    footprint: { width: W, depth: D },
    height: domeTop + 0.12,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots,
    doorSpot: new THREE.Vector3(DOOR_X, 0, D / 2 + 0.9),
    signAnchor: new THREE.Vector3(0, domeTop + 0.3, DZ),
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
      lightMat.dispose(); screenMat.dispose(); slitMat.dispose(); glassMat.dispose()
    },
  }
}
