// Cafe: cream corner shop with a striped awning, a window bar with laptops, a stepped gable roof and a cup blade sign.
import * as THREE from 'three'
import { PAL, accentTone } from '../palette'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

const W = 8
const D = 7
const HW = W / 2
const HD = D / 2
const T = 0.3 // wall thickness
const H1 = 4 // ground floor height (tall, so the glass stays open above the awning)
const TOP = 6.5 // top of the walls
const WARM = 0xffd08a
const DOOR_X = 2.95
const ROW_Z = HD - 0.85 // people stand in one row right behind the window bar
const SPOT_XS = [-3.2, -2.2, -1.2, -0.2, 0.8, 1.8]
const CHIMNEY = { x: -2.4, z: -1.2, top: TOP + 2.9 }

export const build: BuildFn = (color) => {
  const wall = material(PAL.cream[1])
  const accent = material(accentTone(color))
  const dark = material(PAL.warmDark)
  const wood = material(PAL.wood[1])
  const brick = material(PAL.brick[1])
  const plant = material(PAL.leaf[1])
  const slate = material(PAL.slate[1])

  // Own materials: their emissive strength follows the lit state and the light level.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM, emissiveIntensity: 2 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff, emissiveIntensity: 2 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xb08558, roughness: 0.9, emissive: 0xffb870, emissiveIntensity: 0 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xb8d8e8, emissive: WARM, emissiveIntensity: 0.5, transparent: true, opacity: 0.25, roughness: 0.2, depthWrite: false,
  })
  const steamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, roughness: 1, depthWrite: false })

  const s = new VoxelBuilder() // lit, casts shadows
  const inner = new VoxelBuilder() // interior floor and emissive bits
  const glass = new VoxelBuilder()
  const windows = new WindowSet()

  // Window with a dark frame and cross bars; the frame sits behind the glow quad so nothing is coplanar.
  const win = (x: number, y: number, z: number, w: number, h: number, f: 'x+' | 'x-' | 'z+' | 'z-') => {
    windows.add(x, y, z, w, h, f)
    const sg = f.endsWith('+') ? 1 : -1
    if (f[0] === 'z') {
      s.box(x, y - h / 2 - 0.12, z + sg * 0.02, w + 0.24, h + 0.24, 0.08, dark)
      s.box(x, y - h / 2, z + sg * 0.09, 0.06, h, 0.04, dark)
      s.box(x, y - 0.03, z + sg * 0.09, w, 0.06, 0.04, dark)
    } else {
      s.box(x + sg * 0.02, y - h / 2 - 0.12, z, 0.08, h + 0.24, w + 0.24, dark)
      s.box(x + sg * 0.09, y - h / 2, z, 0.04, h, 0.06, dark)
      s.box(x + sg * 0.09, y - 0.03, z, 0.04, 0.06, w, dark)
    }
  }
  // Window order matters: sleeping sessions take the lowest indices, so the ones facing the default camera come first.
  const UY = 5.3
  for (const x of [-2.4, 0, 2.4]) win(x, UY, HD, 1.3, 1.4, 'z+')
  for (const z of [-1.3, 1.3]) win(HW, UY, z, 1.3, 1.4, 'x+')
  for (const z of [-1.3, 1.3]) win(HW, 2, z, 1.3, 1.3, 'x+')
  for (const z of [-1.3, 1.3]) win(-HW, UY, z, 1.3, 1.4, 'x-')
  for (const z of [-1.3, 1.3]) win(-HW, 2, z, 1.3, 1.3, 'x-')
  for (const x of [-2.4, 0, 2.4]) win(x, UY, -HD, 1.3, 1.4, 'z-')
  for (const x of [-2, 2]) win(x, 2, -HD, 1.3, 1.3, 'z-')

  // Shell
  s.box(0, 0, -HD + T / 2, W, TOP, T, wall)
  for (const sx of [-1, 1]) s.box(sx * (HW - T / 2), 0, 0, T, TOP, D, wall)
  for (const sx of [-1, 1]) s.box(sx * (HW - 0.2), 0, HD - T / 2, 0.4, H1, T, wall) // front piers
  s.box(0, 3.6, HD - T / 2, W, TOP - 3.6, T, wall) // front fascia and upper wall
  s.box(0, H1 - 0.1, 0, W + 0.16, 0.2, D + 0.16, dark) // belt between the floors
  s.box(0, H1 - 0.2, 0, W - 2 * T, 0.2, D - T - 0.1, wall) // ceiling
  // Brick base ring (front pieces leave the door and glass gap)
  s.box(-0.9, 0, HD - 0.11, 6.3, 0.45, 0.3, brick)
  s.box(3.8, 0, HD - 0.11, 0.5, 0.45, 0.3, brick)
  for (const sx of [-1, 1]) s.box(sx * (HW - 0.11), 0, 0, 0.3, 0.45, D + 0.08, brick)
  s.box(0, 0, -HD + 0.11, W + 0.08, 0.45, 0.3, brick)
  s.box(DOOR_X, 0, HD + 0.15, 1.2, 0.1, 0.5, brick) // doorstep

  // Storefront: mullions, door, transom
  for (let k = 0; k < 6; k++) s.box(-3.6 + 1.18 * k, 0.45, HD - 0.05, 0.1, 3.15, 0.14, dark)
  s.box(-0.65, 3.55, HD - 0.05, 5.9, 0.08, 0.14, dark)
  s.box(-0.65, 0.4, HD - 0.05, 5.9, 0.08, 0.14, dark)
  s.box(DOOR_X, 0.1, HD - 0.05, 1.12, 2.6, 0.08, wood)
  s.box(3.3, 1.2, HD, 0.06, 0.22, 0.06, wall)
  s.box(DOOR_X, 2.7, HD - 0.05, 1.3, 0.15, 0.14, dark)
  s.box(3.55, 0.1, HD - 0.05, 0.1, 2.6, 0.14, dark)
  glass.box(-0.65, 0.45, HD - 0.05, 5.9, 3.15, 0.04, glassMat)
  glass.box(DOOR_X, 1.2, HD, 0.7, 1.1, 0.04, glassMat)
  glass.box(DOOR_X, 2.85, HD - 0.05, 1.12, 0.75, 0.04, glassMat)

  // Striped awning: short and high so the sight lines from above still reach the people behind the glass
  for (let k = 0; k < 10; k++) {
    const x = -4.1 + 0.82 * (k + 0.5)
    const m = k % 2 ? wall : accent
    s.box(x, 3.72, HD + 0.11, 0.82, 0.2, 0.22, m)
    s.box(x, k % 2 ? 3.58 : 3.43, HD + 0.3, 0.82, k % 2 ? 0.14 : 0.29, 0.1, m)
  }

  // Flower boxes under the front windows
  for (const x of [-2.4, 0, 2.4]) {
    s.box(x, 4.18, HD, 1.2, 0.28, 0.3, wood)
    s.box(x, 4.46, HD + 0.02, 1.1, 0.16, 0.26, plant)
    for (const dx of [-0.4, 0, 0.4]) s.box(x + dx, 4.62, HD + 0.1, 0.12, 0.1, 0.12, accent)
  }

  // Stepped gable roof: accent eave board, slate slopes, accent ridge, brick chimney
  s.box(0, TOP, 0, W + 0.9, 0.3, D + 0.9, accent)
  const depths = [7.3, 5.8, 4.3, 2.8]
  depths.forEach((depth, k) => s.box(0, TOP + 0.3 + 0.45 * k, 0, W + 0.6, 0.45, depth, slate))
  s.box(0, TOP + 2.1, 0, W + 1.1, 0.25, 1.2, accent)
  s.box(CHIMNEY.x, TOP + 1.5, CHIMNEY.z, 0.8, CHIMNEY.top - TOP - 1.5, 0.8, brick)
  s.box(CHIMNEY.x, CHIMNEY.top, CHIMNEY.z, 1, 0.12, 1, dark)

  // Cup blade sign on the right wall
  const cx = HW + 1.2
  const zc = HD - 0.5
  const y0 = 4.3
  s.box(HW + 0.9, y0 + 1.5, zc, 1.8, 0.08, 0.1, dark)
  s.box(cx, y0, zc, 1.5, 1.5, 0.1, accent)
  s.box(cx - 0.1, y0 + 0.4, zc, 0.7, 0.55, 0.16, wall)
  s.box(cx - 0.1, y0 + 0.3, zc, 1, 0.1, 0.16, wall)
  s.box(cx + 0.4, y0 + 0.76, zc, 0.3, 0.09, 0.16, wall)
  s.box(cx + 0.4, y0 + 0.5, zc, 0.3, 0.09, 0.16, wall)
  s.box(cx + 0.51, y0 + 0.5, zc, 0.09, 0.35, 0.16, wall)
  s.box(cx - 0.25, y0 + 1.0, zc, 0.1, 0.3, 0.16, dark)
  s.box(cx + 0.05, y0 + 1.05, zc, 0.1, 0.28, 0.16, dark)

  // Interior: window bar with laptops and pendant lamps, a few tables, back counter
  inner.box(0, 0, 0.1, W - 2 * T, 0.1, D - T - 0.1, floorMat)
  s.box(-0.75, 0.1, ROW_Z + 0.5, 5.95, 0.95, 0.35, dark)
  s.box(-0.75, 1.05, ROW_Z + 0.5, 6.05, 0.06, 0.45, wood)
  for (const x of SPOT_XS) {
    s.box(x, 1.11, ROW_Z + 0.45, 0.42, 0.03, 0.3, dark)
    inner.box(x, 1.14, ROW_Z + 0.6, 0.4, 0.26, 0.03, screenMat)
    s.box(x + 0.4, 1.11, ROW_Z + 0.45, 0.09, 0.1, 0.09, wall)
    inner.box(x, 2.95, ROW_Z - 0.15, 0.32, 0.22, 0.32, lightMat)
    s.box(x, 3.17, ROW_Z - 0.15, 0.03, 0.63, 0.03, dark)
  }
  const chair = (x: number, z: number, toward: 1 | -1) => {
    s.box(x, 0.4, z, 0.42, 0.06, 0.42, wood)
    s.box(x, 0.46, z - toward * 0.19, 0.42, 0.4, 0.05, wood)
    for (const dx of [-0.18, 0.18]) for (const dz of [-0.18, 0.18]) s.box(x + dx, 0.1, z + dz, 0.05, 0.3, 0.05, dark)
  }
  for (const tx of [-2.4, 0.2]) {
    s.box(tx, 0.1, 0.6, 0.1, 0.65, 0.1, dark)
    s.box(tx, 0.75, 0.6, 0.8, 0.05, 0.8, wood)
    chair(tx, -0.2, 1)
    chair(tx, 1.4, -1)
  }
  s.box(-1.25, 0.1, -2.65, 3.5, 0.95, 0.6, dark)
  s.box(-1.25, 1.05, -2.65, 3.6, 0.06, 0.7, wood)
  s.box(-2.3, 1.11, -2.7, 0.9, 0.5, 0.5, accent) // espresso machine
  s.box(-1.5, 1.7, -3.0, 4, 0.06, 0.3, wood)
  for (const dx of [-0.2, 0.3, 0.8, 1.3, 1.7]) s.box(-1.5 + dx, 1.76, -3.0, 0.14, 0.14, 0.14, wall)

  // Outdoor tables and chairs, planter, chalkboard
  for (const tx of [-2.6, -0.4]) {
    const tz = HD + 1.45
    s.box(tx, 0, tz, 0.1, 0.72, 0.1, dark)
    s.box(tx, 0.72, tz, 0.75, 0.05, 0.75, accent)
    s.box(tx + 0.15, 0.77, tz - 0.1, 0.1, 0.1, 0.1, wall)
    chair(tx, tz - 0.7, 1)
    chair(tx, tz + 0.7, -1)
  }
  s.box(3.9, 0, HD + 0.4, 0.6, 0.5, 0.5, brick)
  s.box(3.9, 0.5, HD + 0.4, 0.5, 0.5, 0.4, plant)
  for (const dx of [-0.15, 0.1, 0.2]) s.box(3.9 + dx, 1.0, HD + 0.4, 0.12, 0.1, 0.12, accent)
  // Festoon lights over the terrace: two strings from the fascia to slim posts, sagging between bulbs.
  for (const fx of [-3.3, 0.3]) {
    const z0 = HD + 0.15
    const z1 = HD + 2.35
    s.box(fx, 0, z1, 0.08, 2.75, 0.08, dark)
    for (let k = 0; k <= 7; k++) {
      const u = k / 7
      const y = 3.3 + (2.6 - 3.3) * u - 0.35 * Math.sin(Math.PI * u)
      const z = z0 + (z1 - z0) * u
      inner.box(fx, y - 0.12, z, 0.1, 0.12, 0.1, lightMat)
      s.box(fx, y, z, 0.03, 0.03, (z1 - z0) / 7, dark)
    }
  }
  s.box(-3.5, 0.15, HD + 0.7, 0.7, 0.85, 0.06, dark)
  for (const y of [0.85, 0.65, 0.45]) s.box(-3.5, y, HD + 0.745, y === 0.85 ? 0.45 : 0.35, 0.04, 0.03, wall)
  for (const dx of [-0.3, 0.3]) s.box(-3.5 + dx, 0, HD + 0.7, 0.05, 0.15, 0.05, dark)

  // Chimney steam: three shrinking puffs on a loop, phase from the scene clock so frozen mode is static
  const steam = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), steamMat, 3)
  steam.frustumCulled = false
  const puff = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scl = new THREE.Vector3()
  const yAxis = new THREE.Vector3(0, 1, 0)
  const placeSteam = (nowMs: number) => {
    for (let i = 0; i < 3; i++) {
      const p = (nowMs / 2600 + i / 3) % 1
      const sc = 0.08 + 0.4 * Math.sin(Math.PI * p)
      pos.set(CHIMNEY.x + 0.15 * Math.sin(p * 6 + i * 2), CHIMNEY.top + 0.2 + p * 1.8, CHIMNEY.z)
      quat.setFromAxisAngle(yAxis, p * 2)
      steam.setMatrixAt(i, puff.compose(pos, quat, scl.setScalar(sc)))
    }
    steam.instanceMatrix.needsUpdate = true
  }
  placeSteam(0)

  const object = new THREE.Group()
  object.add(s.build({ castShadow: true, receiveShadow: true }))
  object.add(inner.build({ receiveShadow: true }), glass.build(), windows.object, steam)

  let lit = true
  let level = 1
  const applyLight = () => {
    lightMat.emissiveIntensity = lit ? 2.8 - 2 * level : 0
    screenMat.emissiveIntensity = lit ? 2.4 - 1.5 * level : 0.05
    floorMat.emissiveIntensity = lit ? 0.7 - 0.6 * level : 0
    glassMat.emissiveIntensity = lit ? 2.2 - 1.9 * level : 0
    glassMat.opacity = lit ? 0.28 : 0.32
    steam.visible = lit
  }
  applyLight()

  return {
    style: 'cafe',
    object,
    footprint: { width: W, depth: D },
    height: CHIMNEY.top,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots: SPOT_XS.map((x) => new THREE.Vector3(x, 0.1, ROW_Z)),
    doorSpot: new THREE.Vector3(DOOR_X, 0, HD + 0.9),
    signAnchor: new THREE.Vector3(0, TOP + 2.35, 0),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, st: WindowState) => windows.setState(i, st),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity: (running: boolean) => windows.setFlicker(running),
    update(dtMs: number, sceneNowMs: number) {
      windows.update(dtMs)
      if (lit) placeSteam(sceneNowMs)
    },
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      lightMat.dispose(); screenMat.dispose(); floorMat.dispose(); glassMat.dispose(); steamMat.dispose()
    },
  }
}
