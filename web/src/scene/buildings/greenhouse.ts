import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { PAL, accentTone, mutedAccent } from '../palette'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

// Garden centre: a two-storey potting house on the left and a glass conservatory with desks and plants on
// the right (green translucent walls, gabled glass roof). Grow lights breathe while sessions are running.
const D = 7
const X0 = -4.4 // outer left edge
const XP = -0.6 // wall between potting house and conservatory
const X1 = 4.4 // outer right edge
const XC = (XP + X1) / 2
const PZ0 = -1.5 // potting house back wall
const ROOF_Y = 6
const ROOF_TOP = ROOF_Y + 0.35
const EAVE_Y = 3.2
const RIDGE_Y = 4.7
const DOOR_X = -2.5
const GROW = 0xffc4ee

/** Box rotated about Z, centred at (cx, cy, cz). */
function tilted(len: number, thick: number, width: number, rotZ: number, cx: number, cy: number, cz: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(len, thick, width).rotateZ(rotZ).translate(cx, cy, cz)
}

export const build: BuildFn = (color) => {
  const wall = material(PAL.sage[1])
  const accent = material(accentTone(color))
  const frame = material(PAL.white[2])
  const dark = material(PAL.frame)
  const wood = material(PAL.wood[1])
  const leafD = material(PAL.leaf[0])
  const leafL = material(PAL.leaf[2])

  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a2f, emissive: GROW, emissiveIntensity: 2 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff, emissiveIntensity: 2 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x9fe6bc, emissive: 0xb8ffd0, emissiveIntensity: 0.5, transparent: true, opacity: 0.17, roughness: 0.2, depthWrite: false,
  })

  const solid = new VoxelBuilder()
  const glass = new VoxelBuilder()
  const screens = new VoxelBuilder()
  const glow = new VoxelBuilder()
  const windows = new WindowSet()

  solid.box((X0 + X1) / 2, 0, 0, X1 - X0, 0.1, D, dark)

  // Potting house (x0..XP, z PZ0..D/2), two floors, flat roof in the project colour.
  const pw = XP - X0
  const pd = D / 2 - PZ0
  const pxc = (X0 + XP) / 2
  const pzc = (D / 2 + PZ0) / 2
  solid.box(pxc, 0.1, pzc, pw, ROOF_Y - 0.1, pd, wall)
  solid.box(pxc, 0.1, pzc, pw + 0.04, 0.5, pd + 0.04, dark) // base course
  solid.box(pxc, ROOF_Y, pzc, pw + 0.2, 0.35, pd + 0.2, material(mutedAccent(color)))
  solid.box(DOOR_X, 0.1, D / 2, 1.2, 2.2, 0.1, dark)
  solid.box(DOOR_X, 2.3, D / 2 + 0.1, 1.9, 0.18, 0.7, accent) // door awning
  solid.box(DOOR_X, 2.1, D / 2 + 0.02, 1.6, 0.2, 0.06, dark)
  for (const x of [-3.6, -1.4]) {
    // flower box under each upper-front window
    solid.box(x, 3.25, D / 2 + 0.12, 1.3, 0.25, 0.3, wood)
    for (const dx of [-0.4, 0, 0.4]) solid.box(x + dx, 3.5, D / 2 + 0.12, 0.3, 0.28, 0.24, dx === 0 ? leafL : leafD)
  }

  // Upper-floor windows (index order = most visible first). Frames sit slightly proud of the wall.
  const winY = 4.7
  const win = (facing: 'z+' | 'z-' | 'x+' | 'x-', a: number, y = winY) => {
    const alongX = facing === 'z+' || facing === 'z-'
    const x = alongX ? a : facing === 'x+' ? XP : X0
    const z = alongX ? (facing === 'z+' ? D / 2 : PZ0) : a
    windows.add(x, y, z, 1.1, 1.3, facing)
    if (alongX) solid.box(x, y - 0.77, z, 1.34, 1.54, 0.1, dark)
    else solid.box(x, y - 0.77, z, 0.1, 1.54, 1.34, dark)
  }
  for (const x of [-3.6, -1.4]) win('z+', x)
  for (const z of [-0.2, 2.0]) win('x+', z)
  for (const z of [-0.2, 2.0]) win('x-', z)
  for (const x of [-3.2, -1.8]) win('z-', x)
  for (const z of [0.2, 2.2]) win('x-', z, 1.7)

  // Rain tank on stilts behind the potting house.
  for (const [dx, dz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) solid.box(-3.2 + dx, 0.1, -2.7 + dz, 0.15, 2.1, 0.15, dark)
  solid.box(-3.2, 2.2, -2.7, 1.5, 1.1, 1.5, wood)
  solid.box(-3.2, 2.6, -2.7, 1.56, 0.1, 1.56, dark)
  solid.box(-3.2, 3.3, -2.7, 1.7, 0.15, 1.7, accent)

  // Roof garden along the left edge of the potting house.
  solid.box(X0 + 0.45, ROOF_TOP, pzc, 0.55, 0.3, pd - 0.6, wood)
  for (let i = 0; i < 5; i++) {
    const z = PZ0 + 0.7 + i * 0.85
    solid.box(X0 + 0.45, ROOF_TOP + 0.3, z, 0.6, 0.35 + (i % 2) * 0.2, 0.6, i % 2 ? leafL : leafD)
  }
  solid.box(-1.7, ROOF_TOP, -0.6, 0.45, 1.0, 0.45, dark) // chimney
  solid.box(-1.7, ROOF_TOP + 1.0, -0.6, 0.6, 0.15, 0.6, accent)

  // Conservatory: stone plinth, green glass walls, white frame.
  const cw = X1 - XP
  solid.box(XC, 0.1, D / 2 - 0.1, cw, 0.4, 0.2, wall)
  solid.box(XC, 0.1, -D / 2 + 0.1, cw, 0.4, 0.2, wall)
  solid.box(X1 - 0.1, 0.1, 0, 0.2, 0.4, D, wall)
  glass.box(XC, 0.5, D / 2 - 0.1, cw - 0.2, EAVE_Y - 0.5, 0.06, glassMat)
  glass.box(XC, 0.5, -D / 2 + 0.1, cw - 0.2, EAVE_Y - 0.5, 0.06, glassMat)
  glass.box(X1 - 0.1, 0.5, 0, 0.06, EAVE_Y - 0.5, D - 0.2, glassMat)
  for (const x of [XP + 0.08, 0.7, 1.9, 3.1, X1 - 0.08]) {
    solid.box(x, 0.1, D / 2 - 0.1, 0.14, EAVE_Y - 0.1, 0.16, frame)
    solid.box(x, 0.1, -D / 2 + 0.1, 0.14, EAVE_Y - 0.1, 0.16, frame)
  }
  for (const z of [-D / 2 + 0.1, -2.3, -1.15, 0, 1.15, 2.3, D / 2 - 0.1]) solid.box(X1 - 0.1, 0.1, z, 0.16, EAVE_Y - 0.1, 0.14, frame)
  for (const y of [1.9, EAVE_Y - 0.1]) {
    solid.box(XC, y, D / 2 - 0.1, cw, 0.1, 0.17, frame)
    solid.box(XC, y, -D / 2 + 0.1, cw, 0.1, 0.17, frame)
    solid.box(X1 - 0.1, y, 0, 0.17, 0.1, D, frame)
  }
  solid.box(XC, RIDGE_Y - 0.05, 0, 0.14, 0.14, D + 0.2, frame)
  for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) solid.box(XC, EAVE_Y, z, 0.1, RIDGE_Y - EAVE_Y, 0.1, frame)

  // Gabled glass roof and gable ends (non-indexed so the triangles merge with the slabs).
  const slope = Math.atan2(RIDGE_Y - EAVE_Y, XC - XP)
  const slopeLen = Math.hypot(XC - XP, RIDGE_Y - EAVE_Y)
  const midY = (EAVE_Y + RIDGE_Y) / 2
  const tri = new THREE.Shape([new THREE.Vector2(XP, EAVE_Y), new THREE.Vector2(X1, EAVE_Y), new THREE.Vector2(XC, RIDGE_Y)])
  const gable = (z: number) => new THREE.ExtrudeGeometry(tri, { depth: 0.05, bevelEnabled: false }).translate(0, 0, z)
  const roofGlass = [
    tilted(slopeLen, 0.05, D + 0.2, slope, (XP + XC) / 2, midY, 0).toNonIndexed(),
    tilted(slopeLen, 0.05, D + 0.2, -slope, (XC + X1) / 2, midY, 0).toNonIndexed(),
    gable(D / 2 - 0.12), gable(-D / 2 + 0.07),
  ]
  const ribs: THREE.BufferGeometry[] = []
  for (let i = 0; i <= 6; i++) {
    const z = -D / 2 + 0.1 + (i * (D - 0.2)) / 6
    ribs.push(tilted(slopeLen, 0.07, 0.07, slope, (XP + XC) / 2, midY + 0.05, z))
    ribs.push(tilted(slopeLen, 0.07, 0.07, -slope, (XC + X1) / 2, midY + 0.05, z))
  }

  // Desks inside the glass: three along the front, three along the right wall. People face +Z.
  const deskSpots = [
    [0.1, 2.0], [1.3, 2.0], [2.5, 2.0], [3.6, 0.575], [3.6, -0.575], [3.6, -1.725],
  ].map(([x, z]) => new THREE.Vector3(x, 0.1, z))
  for (const s of deskSpots) {
    solid.box(s.x, 0.1, s.z + 0.55, 1.0, 0.75, 0.5, wood)
    screens.box(s.x, 0.85, s.z + 0.5, 0.55, 0.38, 0.05, screenMat)
  }
  glow.box(1.5, 0.1, 1.9, 3.6, 0.02, 1.2, lightMat)
  glow.box(3.5, 0.1, -0.6, 1.2, 0.02, 3.4, lightMat)
  for (const x of [0.1, 1.3, 2.5]) glow.box(x, 2.7, 2.0, 0.9, 0.06, 0.3, lightMat)
  for (const z of [-1.725, -0.575, 0.575]) glow.box(3.6, 2.7, z, 0.3, 0.06, 0.9, lightMat)

  // Plants: back bed, shelf along the partition, two palms, flowers in the project colour.
  solid.box(XC, 0.1, -D / 2 + 0.7, cw - 0.5, 0.45, 0.8, wood)
  solid.box(XC, 0.55, -D / 2 + 0.7, cw - 0.7, 0.05, 0.6, dark)
  for (let i = 0; i < 6; i++) {
    const x = XP + 0.5 + i * 0.75
    const s = 0.5 + (i % 3) * 0.12
    solid.box(x, 0.6, -D / 2 + 0.7, s, s * 0.9, s, i % 2 ? leafL : leafD)
    if (i % 2 === 0) solid.box(x, 0.6 + s * 0.9, -D / 2 + 0.7, 0.18, 0.18, 0.18, accent)
  }
  solid.box(XP + 0.28, 0.1, -0.6, 0.4, 0.55, 3.2, wood)
  for (let i = 0; i < 4; i++) {
    solid.box(XP + 0.28, 0.65, -2.0 + i * 0.85, 0.34, 0.3 + (i % 2) * 0.15, 0.34, i % 2 ? leafD : leafL)
    solid.box(XP + 0.28, 0.65 + 0.3 + (i % 2) * 0.15, -2.0 + i * 0.85, 0.14, 0.14, 0.14, accent)
  }
  for (const [px, pz] of [[0.2, -1.8], [2.4, -1.4]]) {
    solid.box(px, 0.1, pz, 0.5, 0.35, 0.5, wood)
    solid.box(px, 0.45, pz, 0.2, 1.7, 0.2, wood)
    solid.box(px, 2.1, pz, 1.7, 0.12, 0.4, leafD)
    solid.box(px, 2.1, pz, 0.4, 0.12, 1.7, leafD)
    solid.box(px, 2.22, pz, 0.6, 0.3, 0.6, leafL)
    for (const [dx, dz] of [[0.85, 0], [-0.85, 0], [0, 0.85], [0, -0.85]]) solid.box(px + dx, 1.85, pz + dz, 0.3, 0.25, 0.3, leafL)
  }
  // Pots by the door.
  for (const x of [-4.0, -1.0]) {
    solid.box(x, 0.1, D / 2 + 0.55, 0.55, 0.4, 0.55, wood)
    solid.box(x, 0.5, D / 2 + 0.55, 0.65, 0.6, 0.65, leafD)
    solid.box(x, 1.1, D / 2 + 0.55, 0.3, 0.25, 0.3, accent)
  }

  const mkMesh = (geos: THREE.BufferGeometry[], mat: THREE.Material, shadow: boolean) => {
    const g = mergeGeometries(geos)
    for (const x of geos) x.dispose()
    const m = new THREE.Mesh(g, mat)
    m.castShadow = shadow
    return m
  }
  const object = new THREE.Group()
  object.add(solid.build({ castShadow: true, receiveShadow: true }))
  object.add(glow.build(), screens.build(), glass.build(), windows.object)
  object.add(mkMesh(roofGlass, glassMat, false), mkMesh(ribs, frame, true))

  let lit = true
  let level = 1
  let running = false
  let pulse = 1
  const applyLight = () => {
    lightMat.emissiveIntensity = lit ? (2.4 - 1.9 * level) * pulse : 0
    screenMat.emissiveIntensity = lit ? 2 - 1.2 * level : 0.05
    glassMat.emissiveIntensity = lit ? 1.0 - 0.85 * level : 0
  }
  applyLight()

  return {
    style: 'greenhouse',
    object,
    footprint: { width: X1 - X0, depth: D },
    height: ROOF_TOP + 1.15,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots,
    doorSpot: new THREE.Vector3(DOOR_X, 0, D / 2 + 0.9),
    signAnchor: new THREE.Vector3(-1.5, ROOF_TOP, 0.5),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, s: WindowState) => windows.setState(i, s),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity(r: boolean) {
      running = r
      windows.setFlicker(r)
      if (!r) pulse = 1
      applyLight()
    },
    update(dtMs: number, sceneNowMs: number) {
      windows.update(dtMs)
      if (running) {
        pulse = 1 + 0.12 * Math.sin(sceneNowMs / 700)
        applyLight()
      }
    },
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      for (const m of [lightMat, screenMat, glassMat]) m.dispose()
    },
  }
}
