import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

// Radio station: two-storey studio with a glass-fronted ground floor, a red/white lattice mast on the roof
// (blinking beacon), a scanning dish and an ON AIR sign.
const W = 7.4
const D = 6
const FLOOR_H = 3
const ROOF_Y = FLOOR_H * 2
const ROOF_TOP = ROOF_Y + 0.35
const DOOR_X = 2.6
const TOWER_X = -2.3
const TOWER_Z = -1.3
const TIERS = 5
const TIER_H = 1.5
const BEACON_PERIOD = 1600
const BEACON_ON = 700

const UP = new THREE.Vector3(0, 1, 0)
const WARM = 0xffd08a

/** Box of thickness t stretched between two points (for lattice members). */
function bar(a: THREE.Vector3, b: THREE.Vector3, t: number): THREE.BufferGeometry {
  const dir = b.clone().sub(a)
  const g = new THREE.BoxGeometry(t, dir.length(), t)
  const q = new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize())
  return g.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)))
}

function onAirTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 112
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#000'
  g.fillRect(0, 0, 256, 112)
  g.strokeStyle = '#ff5a4a'
  g.lineWidth = 8
  g.strokeRect(8, 8, 240, 96)
  g.fillStyle = '#ff5a4a'
  g.font = 'bold 56px -apple-system, Helvetica, Arial, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('ON AIR', 128, 58)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export const build: BuildFn = (color) => {
  const wall = material(0xd9d3c4)
  const accent = material(color)
  const dark = material(0x2f3440)
  const deskMat = material(0x8a6a4a)
  const unit = material(0xb9b7b0)

  // Own materials: emissive strength follows lit state and light level.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM, emissiveIntensity: 2 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff, emissiveIntensity: 2 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xa9d2e8, emissive: WARM, emissiveIntensity: 0.5, transparent: true, opacity: 0.3, roughness: 0.2, depthWrite: false,
  })
  const beaconMat = new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2a1a, emissiveIntensity: 1 })
  const towerWhite = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.8 })
  const towerRed = new THREE.MeshStandardMaterial({ color: 0xd8433a, roughness: 0.8 })
  const dishMat = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.8, side: THREE.DoubleSide, flatShading: true })
  const tex = onAirTexture()
  const onAirMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 1 })

  const solid = new VoxelBuilder()
  const windows = new WindowSet()
  const screens = new VoxelBuilder()
  const glow = new VoxelBuilder()
  const glass = new VoxelBuilder()

  // Shell. Ground floor: back and left walls solid, front and right sides are glass between pillars.
  solid.box(0, 0, 0, W, 0.1, D, dark)
  solid.box(0, 0.1, -D / 2 + 0.15, W, FLOOR_H - 0.1, 0.3, wall)
  solid.box(-W / 2 + 0.15, 0.1, 0, 0.3, FLOOR_H - 0.1, D, wall)
  solid.box(0, FLOOR_H, 0, W, FLOOR_H, D, wall)
  solid.box(0, ROOF_Y, 0, W + 0.7, 0.35, D + 0.7, accent)
  // Front pillars, door, fascia band in the project colour.
  for (const [x, w] of [[-W / 2 + 0.2, 0.4], [1.75, 0.5], [W / 2 - 0.25, 0.5]]) solid.box(x, 0.1, D / 2 - 0.15, w, FLOOR_H - 0.1, 0.3, wall)
  solid.box(DOOR_X, 0.1, D / 2 - 0.05, 1.2, 2.2, 0.1, dark)
  solid.box(DOOR_X, 2.3, D / 2 - 0.05, 1.5, 0.2, 0.14, dark)
  solid.box(0, FLOOR_H, D / 2 + 0.025, W + 0.2, 0.45, 0.25, accent)
  glass.box(-0.9, 0.1, D / 2 - 0.05, 4.6, 2.75, 0.06, glassMat)
  for (const x of [-2.5, -0.9, 0.7]) solid.box(x, 0.1, D / 2 + 0.0, 0.07, 2.75, 0.07, dark)
  // Right wall: pillars and glass so the interior shows from the default camera angle.
  const rx = W / 2 - 0.15
  solid.box(rx, 0.1, -2.7, 0.3, FLOOR_H - 0.1, 0.6, wall)
  solid.box(rx, 0.1, 2.75, 0.3, FLOOR_H - 0.1, 0.5, wall)
  glass.box(rx, 0.1, 0.05, 0.06, 2.75, 4.9, glassMat)
  solid.box(rx, 2.85, 0.05, 0.3, 0.15, 4.9, wall)
  for (const z of [-1.0, 0.8]) solid.box(rx + 0.0, 0.1, z, 0.07, 2.75, 0.07, dark)

  // Desks next to the glass; people face +Z. Spots stay close to the glass so heads show from the default pitch.
  const deskSpots = [
    [-2.7, 2.05], [-1.5, 2.05], [-0.3, 2.05], [0.9, 2.05], [2.95, 0.85], [2.95, -0.55],
  ].map(([x, z]) => new THREE.Vector3(x, 0.1, z))
  for (const s of deskSpots) {
    solid.box(s.x, 0.1, s.z + 0.55, 1.0, 0.75, 0.5, deskMat)
    screens.box(s.x, 0.85, s.z + 0.5, 0.55, 0.38, 0.05, screenMat)
  }
  glow.box(-0.9, 0.1, 1.95, 4.6, 0.02, 1.0, lightMat) // warm floor spill by the front glass
  glow.box(2.55, 0.1, 0.1, 1.0, 0.02, 2.4, lightMat)
  glow.box(-0.9, 2.78, 1.9, 4.6, 0.07, 0.3, lightMat)

  // Upper-floor windows: front, right, left, back (index order = most visible first).
  const winY = FLOOR_H + 1.6
  const win = (facing: 'z+' | 'z-' | 'x+' | 'x-', a: number) => {
    const alongX = facing === 'z+' || facing === 'z-'
    const sign = facing === 'z+' || facing === 'x+' ? 1 : -1
    const x = alongX ? a : sign * (W / 2)
    const z = alongX ? sign * (D / 2) : a
    windows.add(x, winY, z, 1.1, 1.4, facing)
    const fw = 1.34
    if (alongX) solid.box(x, winY - 0.82, z, fw, 1.64, 0.1, dark)
    else solid.box(x, winY - 0.82, z, 0.1, 1.64, fw, dark)
  }
  for (const x of [-2.8, -1.4, 0]) win('z+', x)
  for (const z of [-1.7, 0, 1.7]) win('x+', z)
  for (const z of [-1.7, 0, 1.7]) win('x-', z)
  for (const x of [-2.4, 0, 2.4]) win('z-', x)

  // ON AIR sign above the door, framed.
  solid.box(2.4, winY - 0.6, D / 2, 2.2, 1.0, 0.1, dark)
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.84), onAirMat)
  sign.position.set(2.4, winY - 0.1, D / 2 + 0.07)

  // Roof: rooftop units, mast plinth, dish mount.
  solid.box(1.3, ROOF_TOP, -1.7, 1.4, 0.7, 1.0, unit)
  solid.box(2.4, ROOF_TOP, 0.2, 0.9, 0.5, 0.9, unit)
  solid.box(TOWER_X, ROOF_TOP, TOWER_Z, 2.9, 0.25, 2.9, dark)
  const dishPivot = new THREE.Group()
  const dishPos = new THREE.Vector3(2.6, ROOF_TOP + 1.25, -1.3)
  dishPivot.position.copy(dishPos)
  solid.box(dishPos.x, ROOF_TOP, dishPos.z, 0.6, 0.25, 0.6, dark)
  solid.box(dishPos.x, ROOF_TOP + 0.25, dishPos.z, 0.25, 1.0, 0.25, dark)

  // Lattice mast: red/white tiers, rungs and zig-zag bracing.
  const towerBaseY = ROOF_TOP + 0.25
  const hwAt = (y: number) => 1.15 + (0.3 - 1.15) * ((y - towerBaseY) / (TIERS * TIER_H))
  const corner = (sx: number, sz: number, y: number) => new THREE.Vector3(TOWER_X + sx * hwAt(y), y, TOWER_Z + sz * hwAt(y))
  const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const whiteGeos: THREE.BufferGeometry[] = []
  const redGeos: THREE.BufferGeometry[] = []
  for (let i = 0; i < TIERS; i++) {
    const y0 = towerBaseY + i * TIER_H
    const y1 = y0 + TIER_H
    const legs = i % 2 === 0 ? redGeos : whiteGeos
    corners.forEach(([sx, sz], j) => {
      legs.push(bar(corner(sx, sz, y0), corner(sx, sz, y1), 0.16))
      const [nx, nz] = corners[(j + 1) % 4]
      whiteGeos.push(bar(corner(sx, sz, y1), corner(nx, nz, y1), 0.09))
      const fwd = (i + j) % 2 === 0
      whiteGeos.push(bar(corner(fwd ? sx : nx, fwd ? sz : nz, y0), corner(fwd ? nx : sx, fwd ? nz : sz, y1), 0.07))
    })
  }
  const topY = towerBaseY + TIERS * TIER_H
  const mastTop = topY + 2.2
  whiteGeos.push(new THREE.BoxGeometry(0.8, 0.14, 0.8).translate(TOWER_X, topY + 0.07, TOWER_Z))
  redGeos.push(bar(new THREE.Vector3(TOWER_X, topY, TOWER_Z), new THREE.Vector3(TOWER_X, topY + 1.1, TOWER_Z), 0.13))
  whiteGeos.push(bar(new THREE.Vector3(TOWER_X, topY + 1.1, TOWER_Z), new THREE.Vector3(TOWER_X, mastTop, TOWER_Z), 0.1))
  whiteGeos.push(bar(new THREE.Vector3(TOWER_X - 0.9, topY + 1.4, TOWER_Z), new THREE.Vector3(TOWER_X + 0.9, topY + 1.4, TOWER_Z), 0.08))
  whiteGeos.push(bar(new THREE.Vector3(TOWER_X, topY + 0.8, TOWER_Z - 0.7), new THREE.Vector3(TOWER_X, topY + 0.8, TOWER_Z + 0.7), 0.08))
  const beaconGeo = new THREE.BoxGeometry(0.22, 0.22, 0.22).translate(TOWER_X, mastTop + 0.11, TOWER_Z)
  const mid = TIERS * TIER_H * 0.5
  const midBeacon = new THREE.BoxGeometry(0.18, 0.18, 0.18).translate(TOWER_X + hwAt(towerBaseY + mid) + 0.1, towerBaseY + mid, TOWER_Z + hwAt(towerBaseY + mid) + 0.1)

  // Dish: bowl facing +Y in pivot space, tilted toward the front and sky.
  const R = 1.1
  const bowl = new THREE.SphereGeometry(R, 10, 4, 0, Math.PI * 2, Math.PI - 0.95, 0.95).translate(0, R, 0)
  const dishGeo = mergeGeometries([
    bowl,
    bar(new THREE.Vector3(0, 0.15, 0), new THREE.Vector3(0, 0.85, 0), 0.07),
    new THREE.BoxGeometry(0.16, 0.12, 0.16).translate(0, 0.9, 0),
  ])
  const dish = new THREE.Mesh(dishGeo, dishMat)
  dish.scale.setScalar(0.85)
  dish.quaternion.setFromUnitVectors(UP, new THREE.Vector3(0.35, 0.55, 0.75).normalize())
  dish.castShadow = true
  dishPivot.add(dish)

  const mkMesh = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow = true) => {
    const g = mergeGeometries(geos)
    for (const x of geos) x.dispose()
    const m = new THREE.Mesh(g, mat)
    m.castShadow = shadow
    return m
  }
  const object = new THREE.Group()
  object.add(solid.build({ castShadow: true, receiveShadow: true }))
  object.add(glow.build(), screens.build(), glass.build(), windows.object, sign, dishPivot)
  object.add(mkMesh(whiteGeos, towerWhite), mkMesh(redGeos, towerRed), mkMesh([beaconGeo, midBeacon], beaconMat, false))

  let lit = true
  let level = 1
  let running = false
  let blinkOn = true
  const applyLight = () => {
    lightMat.emissiveIntensity = lit ? 2.6 - 1.6 * level : 0
    screenMat.emissiveIntensity = lit ? 2 - 1.2 * level : 0.05
    glassMat.emissiveIntensity = lit ? 0.9 - 0.75 * level : 0
    glassMat.opacity = lit ? 0.22 : 0.3
    onAirMat.emissiveIntensity = lit ? (running ? 3 : 1.6) - 1.2 * level : 0.06
    beaconMat.emissiveIntensity = blinkOn ? 4 - 1.8 * level : 0.3 // kept low: bloom would swallow the ! bubble
  }
  applyLight()

  return {
    style: 'radioTower',
    object,
    footprint: { width: W + 0.7, depth: D + 0.7 },
    height: mastTop + 0.22,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots,
    doorSpot: new THREE.Vector3(DOOR_X, 0, D / 2 + 0.9),
    signAnchor: new THREE.Vector3(0, ROOF_TOP, 0.4),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, s: WindowState) => windows.setState(i, s),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity(r: boolean) { running = r; windows.setFlicker(r); applyLight() },
    update(dtMs: number, sceneNowMs: number) {
      windows.update(dtMs)
      // Beacon and dish follow scene time, so a frozen clock gives a fixed phase.
      const on = sceneNowMs % BEACON_PERIOD < BEACON_ON
      if (on !== blinkOn) {
        blinkOn = on
        applyLight()
      }
      dishPivot.rotation.y = running ? 0.6 * Math.sin(sceneNowMs / 2500) : 0
    },
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      for (const m of [lightMat, screenMat, glassMat, beaconMat, towerWhite, towerRed, dishMat, onAirMat]) m.dispose()
      tex?.dispose()
    },
  }
}
