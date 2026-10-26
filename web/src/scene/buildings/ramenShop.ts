import * as THREE from 'three'
import { PAL, accentTone, mutedAccent } from '../palette'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

type Facing = 'x+' | 'x-' | 'z+' | 'z-'

const W = 7.4 // hall width (x) / depth (z)
const D = 6.2
const H = 3.1 // hall wall height
const DOOR_X = 2.4
const WARM = 0xffd08a
const PUFFS = 6
const STEAM_X = 3.1
const STEAM_Z = -1.6

function signTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 100
  const g = c.getContext('2d')
  if (!g) return null
  g.fillStyle = '#2b1914'
  g.fillRect(0, 0, c.width, c.height)
  g.strokeStyle = '#e9c98a'
  g.lineWidth = 5
  g.strokeRect(7, 7, c.width - 14, c.height - 14)
  g.fillStyle = '#f7e8c4'
  g.font = '700 62px "Hiragino Sans", "Noto Sans CJK JP", "Yu Gothic", sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText('らーめん', c.width / 2, c.height / 2 + 3)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

export const build: BuildFn = (color) => {
  const plaster = material(PAL.cream[1])
  const timber = material(0x4d3527)
  const tile = material(PAL.slate[0])
  const accent = material(accentTone(color))
  const brick = material(PAL.brick[0])
  const floorM = material(PAL.wood[0])
  const tableM = material(PAL.wood[2])

  // Own materials: emissive strength follows the lit state and the light level.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM, emissiveIntensity: 2 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff, emissiveIntensity: 2 })
  const lanternMat = new THREE.MeshStandardMaterial({ color: 0x7a1410, emissive: 0xff3b1c, emissiveIntensity: 2 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9cc8e0, emissive: WARM, emissiveIntensity: 0.5, transparent: true, opacity: 0.3, roughness: 0.2, depthWrite: false,
  })
  const steamMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.25, transparent: true, opacity: 0.45, depthWrite: false })
  const signTex = signTexture()
  const signMat = new THREE.MeshBasicMaterial({ color: 0xffffff, map: signTex })

  const solid = new VoxelBuilder()
  const glow = new VoxelBuilder()
  const screens = new VoxelBuilder()
  const glass = new VoxelBuilder()
  const lamps = new VoxelBuilder()
  const windows = new WindowSet()

  // Window with a timber frame; (x, y, z) is the centre on the wall surface.
  const win = (x: number, y: number, z: number, w: number, h: number, f: Facing) => {
    const flat = f === 'z+' || f === 'z-'
    solid.box(x, y - (h + 0.2) / 2, z, flat ? w + 0.2 : 0.1, h + 0.2, flat ? 0.1 : w + 0.2, timber)
    windows.add(x, y, z, w, h, f)
  }

  // ---- hall ----
  solid.box(0, 0, 0, W, 0.1, D, floorM)
  solid.box(0, 0, -D / 2 + 0.15, W, H, 0.3, plaster)
  for (const sx of [-1, 1]) solid.box(sx * (W / 2 - 0.15), 0, 0, 0.3, H, D, plaster)
  solid.box(0, 0, -D / 2, W + 0.1, 0.9, 0.1, timber) // wainscot
  for (const sx of [-1, 1]) solid.box(sx * (W / 2), 0, 0, 0.1, 0.9, D + 0.1, timber)

  // storefront (+Z): lintel, lower panel, glass with lattice, door, pillars
  solid.box(0, 2.5, D / 2 - 0.15, W, 0.6, 0.3, plaster)
  solid.box(-0.95, 0, D / 2 - 0.15, 4.7, 0.9, 0.3, timber)
  solid.box(1.55, 0, D / 2 - 0.1, 0.3, 2.5, 0.3, timber)
  solid.box(-3.5, 0, D / 2 - 0.1, 0.4, 2.5, 0.3, timber)
  solid.box(3.4, 0, D / 2 - 0.1, 0.6, 2.5, 0.3, timber)
  glass.box(-0.95, 0.9, D / 2 - 0.05, 4.7, 1.6, 0.06, glassMat)
  for (const x of [-2.5, -1.7, -0.9, -0.1, 0.7]) solid.box(x, 0.9, D / 2 - 0.05, 0.06, 1.6, 0.1, timber)
  solid.box(-0.95, 1.65, D / 2 - 0.05, 4.7, 0.06, 0.1, timber)
  solid.box(DOOR_X, 0.1, D / 2 - 0.1, 1.4, 2.4, 0.1, timber) // sliding door
  for (const dx of [-0.35, 0.35]) solid.box(DOOR_X + dx, 0.95, D / 2 - 0.03, 0.45, 0.9, 0.04, plaster)
  solid.box(DOOR_X, 2.3, D / 2 + 0.14, 1.7, 0.07, 0.07, timber) // noren rod
  for (const dx of [-0.5, 0, 0.5]) {
    solid.box(DOOR_X + dx, 1.3, D / 2 + 0.14, 0.42, 1.0, 0.04, accent)
    solid.box(DOOR_X + dx, 1.3, D / 2 + 0.14, 0.42, 0.12, 0.05, plaster)
  }
  // nobori-style banner on the right pillar
  solid.box(3.45, 0.7, D / 2 + 0.1, 0.5, 2.2, 0.03, accent)
  for (const y of [1.1, 1.6, 2.1]) solid.box(3.45, y, D / 2 + 0.115, 0.26, 0.2, 0.02, plaster)

  // lanterns hang from the eave
  const lantern = (x: number, w: number, h: number, y: number) => {
    lamps.box(x, y, D / 2 + 0.55, w, h, w, lanternMat)
    for (const cy of [y - 0.05, y + h]) solid.box(x, cy, D / 2 + 0.55, w * 0.7, 0.05, w * 0.7, timber)
    solid.box(x, y + h + 0.05, D / 2 + 0.55, 0.03, 3.1 - (y + h + 0.05), 0.03, timber)
  }
  lantern(1.5, 0.5, 0.65, 2.2)
  lantern(3.3, 0.5, 0.65, 2.2)
  lantern(-3.35, 0.3, 0.4, 2.5)
  lantern(0.8, 0.3, 0.4, 2.5)

  // interior: pendant lamps, tables with screens and bowls, kitchen counter
  const desks: Array<[number, number]> = [
    [-2.4, 1.7], [-0.8, 1.7], [0.8, 1.7],
    [-1.6, 0.0], [0.0, 0.0], [1.6, 0.0],
  ]
  const deskSpots = desks.map(([x, z]) => new THREE.Vector3(x, 0.1, z))
  for (const [x, z] of desks) {
    solid.box(x, 0.1, z + 0.75, 1.2, 0.75, 0.6, tableM)
    screens.box(x - 0.25, 0.85, z + 0.85, 0.5, 0.36, 0.06, screenMat)
    solid.box(x + 0.3, 0.85, z + 0.7, 0.3, 0.14, 0.3, plaster) // bowl
    glow.box(x, 2.3, z + 0.75, 0.4, 0.28, 0.4, lightMat)
  }
  solid.box(0, 0.1, -D / 2 + 0.7, 6.2, 0.95, 0.7, floorM)
  solid.box(0, 1.05, -D / 2 + 0.7, 6.4, 0.08, 0.85, tableM)
  for (const x of [-2, -0.6, 1.4]) solid.box(x, 1.13, -D / 2 + 0.7, 0.55, 0.45, 0.55, plaster) // stock pots
  glow.box(0, H - 0.12, -1.2, 5.6, 0.1, 0.35, lightMat)

  // ---- roof: accent eave, slate tiers, loft with windows, second roof ----
  const roofY = H
  const eave = material(mutedAccent(color))
  solid.box(0, roofY, 0, W + 1.4, 0.25, D + 1.4, eave)
  solid.box(0, roofY + 0.25, 0, W + 0.8, 0.3, D + 0.8, tile)
  const loftY = roofY + 0.55
  solid.box(0, loftY, 0, 5.2, 1.9, 4.4, plaster)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid.box(sx * 2.55, loftY, sz * 2.15, 0.25, 1.9, 0.25, timber)
  solid.box(0, loftY + 1.7, 0, 5.3, 0.2, 4.5, timber)
  const loftTop = loftY + 1.9
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.56), signMat) // shop name board on the loft front
  sign.position.set(0, loftY + 0.42, 2.2 + 0.03)
  solid.box(0, loftTop, 0, 6.2, 0.2, 5.4, eave)
  solid.box(0, loftTop + 0.2, 0, 5.4, 0.5, 4.6, tile)
  solid.box(0, loftTop + 0.7, 0, 3.8, 0.5, 3.0, tile)
  solid.box(0, loftTop + 1.2, 0, 2.2, 0.35, 1.0, accent)
  const height = loftTop + 1.55
  // chimney
  const chimTop = roofY + 0.55 + 3.4
  solid.box(STEAM_X, roofY + 0.55, STEAM_Z, 0.8, chimTop - roofY - 0.55, 0.8, brick)
  solid.box(STEAM_X, chimTop, STEAM_Z, 1.0, 0.15, 1.0, timber)

  // windows (front ones first so sleeping sessions show up on the visible faces)
  const wy = loftY + 1.3
  for (const x of [-1.6, 0, 1.6]) win(x, wy, 2.2, 0.9, 0.7, 'z+')
  for (const z of [-1.2, 1.2]) win(W / 2, 1.85, z, 1.2, 1.0, 'x+')
  win(2.6, wy, 0, 0.9, 0.7, 'x+')
  for (const x of [-1.6, 0, 1.6]) win(x, wy, -2.2, 0.9, 0.7, 'z-')
  for (const z of [-1.2, 1.2]) win(-W / 2, 1.85, z, 1.2, 1.0, 'x-')
  win(-2.6, wy, 0, 0.9, 0.7, 'x-')
  for (const x of [-1.8, 1.8]) win(x, 1.85, -D / 2, 1.2, 1.0, 'z-')

  // steam from the chimney (visible only while a session is running)
  const steamGeo = new THREE.BoxGeometry(1, 1, 1)
  const steam = new THREE.InstancedMesh(steamGeo, steamMat, PUFFS)
  steam.frustumCulled = false
  steam.visible = false
  const m4 = new THREE.Matrix4()
  const qId = new THREE.Quaternion()
  let t = 1500
  const placeSteam = () => {
    for (let i = 0; i < PUFFS; i++) {
      const p = (t / 3600 + i / PUFFS) % 1
      const s = 0.15 + 0.5 * Math.sin(Math.PI * p)
      m4.compose(
        new THREE.Vector3(STEAM_X + 0.3 * Math.sin(p * 5 + i * 2) + p * 0.5, chimTop + 0.4 + p * 2.6, STEAM_Z + 0.2 * Math.cos(p * 4 + i)),
        qId.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p * 2 + i),
        new THREE.Vector3(s, s, s),
      )
      steam.setMatrixAt(i, m4)
    }
    steam.instanceMatrix.needsUpdate = true
  }
  placeSteam()

  const object = new THREE.Group()
  object.add(solid.build({ castShadow: true, receiveShadow: true }))
  object.add(glow.build(), screens.build(), glass.build(), lamps.build(), windows.object, steam)
  if (signTex) object.add(sign)

  let lit = true
  let level = 1
  const applyLight = () => {
    const night = 1 - level
    lightMat.emissiveIntensity = lit ? 0.9 + 1.7 * night : 0
    screenMat.emissiveIntensity = lit ? 0.8 + 1.2 * night : 0.05
    lanternMat.emissiveIntensity = lit ? 0.5 + 1.1 * night : 0.08
    glassMat.emissiveIntensity = lit ? 0.15 + 0.75 * night : 0
    glassMat.opacity = lit ? 0.22 : 0.3
    signMat.color.setScalar(lit ? 0.8 + 0.8 * night : 0.25)
  }
  applyLight()

  return {
    style: 'ramenShop',
    object,
    footprint: { width: W + 1.4, depth: D + 1.4 },
    height,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots,
    doorSpot: new THREE.Vector3(DOOR_X, 0, D / 2 + 1.2),
    signAnchor: new THREE.Vector3(0, height, 0),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, s: WindowState) => windows.setState(i, s),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity(running: boolean) {
      windows.setFlicker(running)
      steam.visible = running
    },
    update(dtMs: number) {
      windows.update(dtMs)
      if (steam.visible) {
        t += dtMs
        placeSteam()
      }
    },
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      steam.dispose()
      lightMat.dispose(); screenMat.dispose(); lanternMat.dispose(); glassMat.dispose(); steamMat.dispose()
      signMat.dispose(); signTex?.dispose()
    },
  }
}
