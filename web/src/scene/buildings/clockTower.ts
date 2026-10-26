import * as THREE from 'three'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

type Face = 'z+' | 'z-' | 'x+' | 'x-'

const W = 8.4 // base hall width / depth
const D = 7
const H0 = 3.2 // hall height
const DOOR_X = 2.9
const SZ = -0.5 // tower axis z
const Y1 = 3.5 // shaft start (top of the hall cornice)
const Y2 = 6.3 // storey line
const Y3 = 8.8 // clock stage start
const Y4 = 12.2 // belfry start
const Y5 = 14.8 // belfry top
const CLOCK_Y = 10.5
const WARM = 0xffd08a
const YAW: Record<Face, number> = { 'z+': 0, 'x+': Math.PI / 2, 'z-': Math.PI, 'x-': -Math.PI / 2 }
const FACES: Face[] = ['z+', 'x+', 'z-', 'x-']
const CLOCK_HALF = 2.6 // clock stage half width

export const build: BuildFn = (color) => {
  const stone = material(0xb59a78)
  const shaft = material(0xc7b08e)
  const trim = material(0xebe2cd)
  const dark = material(0x333844)
  const gold = material(0xd9a93a, { roughness: 0.55 })
  const wood = material(0x8a6a4a)
  const accent = material(color)
  const roofMat = material(new THREE.Color(color).multiplyScalar(0.7))

  // Own materials: emissive strength follows the lit state and the light level.
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM, emissiveIntensity: 2 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff, emissiveIntensity: 2 })
  const faceMat = new THREE.MeshStandardMaterial({ color: 0xf2ead2, emissive: 0xffe2a0, emissiveIntensity: 0.5, roughness: 0.7 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9cc8e0, emissive: WARM, emissiveIntensity: 0.5, transparent: true, opacity: 0.3, roughness: 0.2, depthWrite: false,
  })

  const solid = new VoxelBuilder()
  const glow = new VoxelBuilder()
  const screens = new VoxelBuilder()
  const glass = new VoxelBuilder()
  const windows = new WindowSet()

  // Box on a face of the tower: u right, v up (relative to cy), n outward. (cx, cz) is the face centre on the wall.
  const fbox = (f: Face, cx: number, cz: number, cy: number, u: number, v: number, n: number, w: number, h: number, t: number, mat: THREE.Material, b = solid) => {
    const s = Math.sin(YAW[f])
    const c = Math.cos(YAW[f])
    const flat = f === 'z+' || f === 'z-'
    b.box(cx + u * c + n * s, cy + v - h / 2, cz - u * s + n * c, flat ? w : t, h, flat ? t : w, mat)
  }
  const faceCentre = (f: Face, half: number): [number, number] =>
    f === 'z+' ? [0, SZ + half] : f === 'z-' ? [0, SZ - half] : f === 'x+' ? [half, SZ] : [-half, SZ]
  // Window with a light trim frame; (u, y) on the face, half = distance from the tower axis to the wall.
  const win = (f: Face, half: number, u: number, y: number, w: number, h: number) => {
    const [cx, cz] = faceCentre(f, half)
    const s = Math.sin(YAW[f])
    const c = Math.cos(YAW[f])
    fbox(f, cx, cz, y, u, 0, 0, w + 0.3, h + 0.3, 0.1, trim)
    windows.add(cx + u * c, y, cz - u * s, w, h, f)
  }

  // ---- ground-floor hall ----
  solid.box(0, 0, 0, W, 0.1, D, wood)
  solid.box(0, 0, -D / 2 + 0.15, W, H0, 0.3, stone)
  for (const sx of [-1, 1]) solid.box(sx * (W / 2 - 0.15), 0, 0, 0.3, H0, D, stone)
  solid.box(0, 2.6, D / 2 - 0.15, W, 0.6, 0.3, accent) // shop fascia in the project colour
  solid.box(0, H0, 0, W + 0.3, 0.3, D + 0.3, trim) // cornice / terrace slab
  for (const sx of [-1, 1]) solid.box(sx * (W / 2 - 0.25), 0, D / 2 - 0.2 + 0.05, 0.5, 2.6, 0.4, trim) // corner pilasters
  solid.box(2.15, 0, D / 2 - 0.15 + 0.05, 0.3, 2.6, 0.3, trim)
  solid.box(DOOR_X, 0.1, D / 2 - 0.1, 1.2, 2.3, 0.1, dark) // door leaf
  solid.box(DOOR_X, 2.35, D / 2 - 0.1, 1.5, 0.15, 0.2, trim)
  solid.box(DOOR_X + 0.4, 1.05, D / 2 - 0.02, 0.1, 0.25, 0.08, gold) // handle
  for (const x of [-1.8, 0.1]) solid.box(x, 0.1, D / 2 - 0.05, 0.1, 2.5, 0.12, dark) // mullions
  glass.box(-0.85, 0.1, D / 2 - 0.05, 5.7, 2.5, 0.06, glassMat)
  glass.box(DOOR_X, 0.5, D / 2 - 0.05, 1.0, 1.9, 0.06, glassMat)

  // terrace parapet
  solid.box(0, Y1, D / 2 + 0.03, W + 0.1, 0.45, 0.24, trim)
  solid.box(0, Y1, -D / 2 - 0.03, W + 0.1, 0.45, 0.24, trim)
  for (const sx of [-1, 1]) solid.box(sx * (W / 2 + 0.03), Y1, 0, 0.24, 0.45, D, trim)

  // interior: ceiling lights, desks with screens, bookcase, grandfather clock
  for (const z of [1.1, -1.2]) glow.box(0, H0 - 0.11, z, W - 1.2, 0.1, 0.4, lightMat)
  const desks: Array<[number, number]> = [
    [-2.8, 1.9], [-1.0, 1.9], [0.8, 1.9],
    [-1.9, 0.2], [-0.1, 0.2], [1.7, 0.2],
  ]
  const deskSpots = desks.map(([x, z]) => new THREE.Vector3(x, 0.1, z))
  for (const [x, z] of desks) {
    solid.box(x, 0.1, z + 0.75, 1.2, 0.75, 0.6, wood)
    screens.box(x, 0.85, z + 0.85, 0.6, 0.4, 0.06, screenMat)
  }
  solid.box(0, 0.1, -D / 2 + 0.55, 5.2, 2.0, 0.5, dark) // bookcase
  const spines = [accent, trim, gold]
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 9; i++) solid.box(-2.2 + i * 0.55, 0.45 + r * 0.6, -D / 2 + 0.82, 0.38, 0.4 + ((i * 3 + r) % 3) * 0.05, 0.08, spines[(i + r) % 3])
  }
  solid.box(-3.5, 0.1, -D / 2 + 0.6, 0.6, 2.2, 0.4, wood) // grandfather clock
  solid.box(-3.5, 1.6, -D / 2 + 0.82, 0.34, 0.34, 0.04, trim)
  solid.box(-3.5, 0.5, -D / 2 + 0.82, 0.14, 0.7, 0.04, gold)

  // ---- tower shaft ----
  solid.box(0, Y1, SZ, 4.8, Y3 - Y1, 4.8, shaft)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid.box(sx * 2.2, Y1, SZ + sz * 2.2, 0.6, Y3 - Y1, 0.6, trim)
  solid.box(0, Y2 - 0.12, SZ, 5.2, 0.24, 5.2, trim)
  solid.box(0, Y3 - 0.1, SZ, 5.6, 0.4, 5.6, trim) // corbel under the clock stage
  for (const f of FACES) {
    win(f, 2.4, -0.95, 4.9, 0.9, 1.5)
    win(f, 2.4, 0.95, 4.9, 0.9, 1.5)
    win(f, 2.4, 0, 7.55, 1.0, 1.4)
  }
  // hall side and back windows
  const hallWin = (x: number, z: number, f: Face) => {
    const flat = f === 'z-'
    solid.box(x, 1.7 - 0.8, z, flat ? 1.1 : 0.1, 1.6, flat ? 0.1 : 1.1, trim)
    windows.add(x, 1.7, z, 0.8, 1.3, f)
  }
  for (const z of [-1.3, 1.0]) {
    hallWin(W / 2, z, 'x+')
    hallWin(-W / 2, z, 'x-')
  }
  for (const x of [-1.6, 1.6]) hallWin(x, -D / 2, 'z-')

  // ---- clock stage ----
  solid.box(0, Y3, SZ, 5.2, Y4 - Y3, 5.2, shaft)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid.box(sx * 2.4, Y3, SZ + sz * 2.4, 0.6, Y4 - Y3, 0.6, trim)
  solid.box(0, Y4 - 0.3, SZ, 5.6, 0.3, 5.6, trim)
  for (const f of FACES) {
    const [cx, cz] = faceCentre(f, CLOCK_HALF)
    fbox(f, cx, cz, CLOCK_Y, 0, 0, 0.06, 3.0, 3.0, 0.12, faceMat, glow)
    for (const v of [-1.6, 1.6]) fbox(f, cx, cz, CLOCK_Y, 0, v, 0.05, 3.4, 0.2, 0.1, gold)
    for (const u of [-1.6, 1.6]) fbox(f, cx, cz, CLOCK_Y, u, 0, 0.05, 0.2, 3.0, 0.1, gold)
    for (let k = 0; k < 12; k++) {
      const a = (k * Math.PI) / 6
      const s = k % 3 === 0 ? 0.22 : 0.12
      fbox(f, cx, cz, CLOCK_Y, Math.sin(a) * 1.2, Math.cos(a) * 1.2, 0.14, s, s, 0.04, dark)
    }
    fbox(f, cx, cz, CLOCK_Y, 0, 0, 0.235, 0.24, 0.24, 0.08, gold)
  }

  // ---- belfry ----
  solid.box(0, Y4, SZ, 5.0, 0.3, 5.0, shaft)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) solid.box(sx * 1.8, Y4 + 0.3, SZ + sz * 1.8, 0.8, Y5 - Y4 - 0.3, 0.8, trim)
  glow.box(0, Y4 + 0.3, SZ, 3.6, 0.05, 3.6, lightMat)
  glow.box(0, Y5 - 0.35, SZ, 3.6, 0.05, 3.6, lightMat)
  solid.box(0, Y5 - 0.3, SZ, 4.4, 0.3, 4.4, trim)
  solid.box(0, Y4 + 1.1, SZ, 3.6, 0.12, 0.12, dark) // bell beam
  solid.box(0, Y4 + 0.5, SZ, 1.0, 0.8, 1.0, gold) // bell
  solid.box(0, Y4 + 1.3, SZ, 0.5, 0.2, 0.5, gold)
  solid.box(0, Y5, SZ, 5.4, 0.3, 5.4, accent) // eave band in the project colour

  // ---- roof ----
  let ry = Y5 + 0.3
  for (const s of [4.8, 3.6, 2.4, 1.2]) {
    solid.box(0, ry, SZ, s, 0.7, s, roofMat)
    ry += 0.7
  }
  solid.box(0, ry, SZ, 0.14, 0.6, 0.14, gold)
  solid.box(0, ry + 0.6, SZ, 0.3, 0.3, 0.3, gold)
  const height = ry + 0.9

  // ---- clock hands (one instanced draw call) ----
  const handGeo = new THREE.BoxGeometry(1, 1, 1)
  handGeo.translate(0, 0.5, 0)
  const hands = new THREE.InstancedMesh(handGeo, material(0x2a2d36), 8)
  hands.frustumCulled = false
  const faceM = new THREE.Matrix4()
  const local = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const zAxis = new THREE.Vector3(0, 0, 1)
  const setHands = (ms: number) => {
    const d = new Date(ms)
    const minutes = d.getMinutes() + d.getSeconds() / 60 + d.getMilliseconds() / 60000
    const aMin = (minutes / 60) * Math.PI * 2
    const aHour = (((d.getHours() % 12) + minutes / 60) / 12) * Math.PI * 2
    FACES.forEach((f, i) => {
      const [cx, cz] = faceCentre(f, CLOCK_HALF)
      faceM.makeRotationY(YAW[f]).setPosition(cx, CLOCK_Y, cz)
      local.compose(new THREE.Vector3(0, 0, 0.2), q.setFromAxisAngle(zAxis, -aMin), new THREE.Vector3(0.1, 1.15, 0.05))
      hands.setMatrixAt(i * 2, new THREE.Matrix4().multiplyMatrices(faceM, local))
      local.compose(new THREE.Vector3(0, 0, 0.16), q.setFromAxisAngle(zAxis, -aHour), new THREE.Vector3(0.16, 0.75, 0.05))
      hands.setMatrixAt(i * 2 + 1, new THREE.Matrix4().multiplyMatrices(faceM, local))
    })
    hands.instanceMatrix.needsUpdate = true
  }
  setHands(new Date(2000, 0, 1, 10, 10).getTime())

  const object = new THREE.Group()
  object.add(solid.build({ castShadow: true, receiveShadow: true }))
  object.add(glow.build(), screens.build(), glass.build(), windows.object, hands)

  let lit = true
  let level = 1
  const applyLight = () => {
    const night = 1 - level
    lightMat.emissiveIntensity = lit ? 0.9 + 1.7 * night : 0
    screenMat.emissiveIntensity = lit ? 0.8 + 1.2 * night : 0.05
    faceMat.emissiveIntensity = lit ? 0.12 + 0.55 * night : 0
    glassMat.emissiveIntensity = lit ? 0.15 + 0.75 * night : 0
    glassMat.opacity = lit ? 0.22 : 0.3
  }
  applyLight()

  return {
    style: 'clockTower',
    object,
    footprint: { width: W + 0.3, depth: D + 0.3 },
    height,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots,
    doorSpot: new THREE.Vector3(DOOR_X, 0, D / 2 + 0.9),
    signAnchor: new THREE.Vector3(0, height, SZ),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, s: WindowState) => windows.setState(i, s),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity: (running: boolean) => windows.setFlicker(running),
    update(dtMs: number, sceneNowMs: number) {
      windows.update(dtMs)
      setHands(sceneNowMs)
    },
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      hands.dispose()
      lightMat.dispose(); screenMat.dispose(); faceMat.dispose(); glassMat.dispose()
    },
  }
}
