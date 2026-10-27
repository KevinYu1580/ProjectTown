// Bookstore: green two-storey shop with a project-colour sign band, big display windows, packed shelves and a giant book stack carrying the sign.
import * as THREE from 'three'
import { createRng } from '../../util/prng'
import { windowBox } from '../flora'
import { PAL, accentTone } from '../palette'
import { VoxelBuilder, disposeGeometries, material } from '../voxel'
import type { BuildFn, WindowState } from './types'
import { WindowSet } from './windows'

const W = 8
const D = 7.6
const HW = W / 2
const HD = D / 2
const T = 0.3 // wall thickness
const H1 = 3.6 // ground floor height
const TOP = 6.4 // top of the walls
const WARM = 0xffd08a
const ROW_Z = HD - 0.85 // people stand in two groups right behind the reading desks
const SPOT_XS = [-3.2, -2.25, -1.3, 1.3, 2.25, 3.2]
const STACK_TOP = TOP + 1.5

export const build: BuildFn = (color) => {
  const wall = material(PAL.bottle[1])
  const trim = material(PAL.cream[1])
  const accent = material(accentTone(color))
  const wood = material(PAL.wood[0])
  const dark = material(PAL.slate[0])
  const plant = material(PAL.leaf[1])

  // Own materials: emissive follows the lit state and the light level.
  const bookMats = [0xb8453f, 0xe3b54a, 0x3f8d8a].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, emissive: c, emissiveIntensity: 0 }))
  const [bkRed, bkYel, bkTeal] = bookMats
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: WARM, emissiveIntensity: 2 })
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x6fd3ff, emissiveIntensity: 2 })
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x9a6b45, roughness: 0.9, emissive: 0xffb870, emissiveIntensity: 0 })
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xb8d8e8, emissive: WARM, emissiveIntensity: 0.5, transparent: true, opacity: 0.25, roughness: 0.2, depthWrite: false,
  })

  const s = new VoxelBuilder() // lit, casts shadows
  const inner = new VoxelBuilder() // interior floor and emissive bits
  const glass = new VoxelBuilder()
  const books = new VoxelBuilder() // shelf books and book props: one mesh per own book material
  const windows = new WindowSet()
  const rng = createRng(7)
  const bookPalette = [bkRed, bkYel, bkTeal, accent, trim, bkRed, bkTeal, bkYel]

  // Window with a cream frame and cross bars; the frame sits behind the glow quad so nothing is coplanar.
  const win = (x: number, y: number, z: number, w: number, h: number, f: 'x+' | 'x-' | 'z+' | 'z-') => {
    windows.add(x, y, z, w, h, f)
    const sg = f.endsWith('+') ? 1 : -1
    if (f[0] === 'z') {
      s.box(x, y - h / 2 - 0.12, z + sg * 0.02, w + 0.24, h + 0.24, 0.08, trim)
      s.box(x, y - h / 2, z + sg * 0.09, 0.06, h, 0.04, trim)
      s.box(x, y - 0.03, z + sg * 0.09, w, 0.06, 0.04, trim)
    } else {
      s.box(x + sg * 0.02, y - h / 2 - 0.12, z, 0.08, h + 0.24, w + 0.24, trim)
      s.box(x + sg * 0.09, y - h / 2, z, 0.04, h, 0.06, trim)
      s.box(x + sg * 0.09, y - 0.03, z, 0.04, 0.06, w, trim)
    }
  }
  // Window order matters: sleeping sessions take the lowest indices, so the ones facing the default camera come first.
  const UY = H1 + 1.5
  for (const x of [-2.85, -0.95, 0.95, 2.85]) win(x, UY, HD, 1.2, 1.4, 'z+')
  for (const z of [-2.2, 0, 2.2]) win(HW, UY, z, 1.3, 1.4, 'x+')
  for (const x of [-2.85, 2.85]) windowBox(s, x, UY - 0.98, HD + 0.08, 1.3, 'z+', (i) => (i * 3 + 1) % 7)
  for (const z of [-2.2, 2.2]) windowBox(s, HW + 0.08, UY - 0.98, z, 1.4, 'x+', (i) => (i * 5 + 2) % 7)
  for (const z of [-2.2, 0, 2.2]) win(-HW, UY, z, 1.3, 1.4, 'x-')
  for (const z of [-1.5, 1.5]) win(-HW, 2, z, 1.3, 1.3, 'x-')
  for (const x of [-2.85, -0.95, 0.95, 2.85]) win(x, UY, -HD, 1.2, 1.4, 'z-')
  for (const x of [-2, 2]) win(x, 2, -HD, 1.3, 1.3, 'z-')

  // Shell: the right wall is open glass on the ground floor so the shelves show from the default camera angle.
  s.box(0, 0, -HD + T / 2, W, TOP, T, wall)
  s.box(-(HW - T / 2), 0, 0, T, TOP, D, wall)
  s.box(HW - T / 2, 3.2, 0, T, TOP - 3.2, D, wall)
  s.box(0, 3.2, HD - T / 2, W, TOP - 3.2, T, wall)
  s.box(0, H1 - 0.2, 0, W - 2 * T, 0.2, D - T - 0.1, wall) // ceiling
  s.box(0, H1 - 0.07, 0, W + 0.14, 0.14, D + 0.14, trim) // belt between the floors
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.box(sx * (HW - 0.16), 0, sz * (HD - 0.16), 0.48, TOP, 0.48, trim) // corner quoins
  // Wood base ring (the front leaves the door gap)
  for (const sx of [-1, 1]) s.box(sx * 2.45, 0, HD - 0.11, 3.2, 0.5, 0.3, wood)
  for (const sx of [-1, 1]) s.box(sx * (HW - 0.11), 0, 0, 0.3, 0.5, D + 0.08, wood)
  s.box(0, 0, -HD + 0.11, W + 0.08, 0.5, 0.3, wood)

  // Front: display windows either side of a double door, project-colour sign band with an open-book emblem
  for (let k = 0; k < 4; k++) for (const sx of [-1, 1]) s.box(sx * (0.9 + 0.9 * k), 0.5, HD - 0.05, 0.08, 2.7, 0.14, trim)
  for (const sx of [-1, 1]) {
    s.box(sx * 2.25, 3.18, HD - 0.05, 2.7, 0.08, 0.14, trim)
    s.box(sx * 2.25, 0.46, HD - 0.05, 2.7, 0.08, 0.14, trim)
    s.box(sx * 0.82, 0, HD - 0.05, 0.16, 3.2, 0.16, trim) // posts beside the door
    glass.box(sx * 2.25, 0.5, HD - 0.05, 2.7, 2.7, 0.04, glassMat)
    s.box(sx * 0.35, 0.1, HD - 0.05, 0.66, 2.35, 0.08, wood) // door leaves
    glass.box(sx * 0.35, 1.0, HD, 0.4, 1.1, 0.04, glassMat)
    s.box(sx * 0.1, 1.05, HD + 0.02, 0.05, 0.3, 0.05, wood)
  }
  s.box(0, 2.45, HD - 0.05, 1.8, 0.12, 0.16, trim)
  glass.box(0, 2.57, HD - 0.05, 1.48, 0.63, 0.04, glassMat)
  s.box(0, 0, HD + 0.2, 2, 0.1, 0.5, trim) // doorstep
  s.box(0, 3.24, HD, 7.2, 0.97, 0.1, trim)
  s.box(0, 3.3, HD + 0.03, 7, 0.85, 0.12, accent)
  for (const sx of [-1, 1]) {
    s.box(sx * 0.38, 3.47, HD + 0.12, 0.7, 0.5, 0.1, trim)
    for (const y of [3.6, 3.72, 3.84]) s.box(sx * 0.4, y, HD + 0.18, 0.46, 0.04, 0.03, dark)
  }
  s.box(0, 3.47, HD + 0.12, 0.06, 0.5, 0.11, dark)
  // Right wall glass
  for (let k = 0; k < 5; k++) s.box(HW - 0.15, 0.5, -3.4 + 1.7 * k, 0.14, 2.7, 0.1, trim)
  s.box(HW - 0.15, 3.18, 0, 0.14, 0.08, 6.8, trim)
  s.box(HW - 0.15, 0.46, 0, 0.14, 0.08, 6.8, trim)
  glass.box(HW - 0.15, 0.5, 0, 0.04, 2.7, 6.8, glassMat)

  // Accent cornice, parapet, roof; cream cap
  s.box(0, TOP - 0.35, HD, W + 0.3, 0.35, 0.3, accent)
  s.box(0, TOP - 0.35, -HD, W + 0.3, 0.35, 0.3, accent)
  for (const sx of [-1, 1]) s.box(sx * HW, TOP - 0.35, 0, 0.3, 0.35, D + 0.3, accent)
  s.box(0, TOP, 0, W - 0.2, 0.15, D - 0.2, dark)
  for (const sz of [-1, 1]) {
    s.box(0, TOP, sz * (HD - 0.125), W, 0.55, 0.25, wall)
    s.box(0, TOP + 0.55, sz * (HD - 0.075), W + 0.2, 0.14, 0.35, trim)
  }
  for (const sx of [-1, 1]) {
    s.box(sx * (HW - 0.125), TOP, 0, 0.25, 0.55, D - 0.5, wall)
    s.box(sx * (HW - 0.075), TOP + 0.55, 0, 0.35, 0.14, D - 0.5, trim)
  }
  s.box(2.4, TOP + 0.15, 1.9, 1.6, 0.3, 1.2, trim) // skylight
  glass.box(2.4, TOP + 0.45, 1.9, 1.3, 0.1, 0.9, glassMat)

  // A book: covers and spine in `cover`, cream pages visible on three sides
  const book = (cx: number, y: number, cz: number, w: number, d: number, h: number, cover: THREE.Material) => {
    books.box(cx, y, cz, w, 0.07, d, cover)
    books.box(cx, y + h - 0.07, cz, w, 0.07, d, cover)
    books.box(cx - w / 2 + 0.04, y + 0.07, cz, 0.08, h - 0.14, d, cover)
    s.box(cx + 0.04, y + 0.07, cz, w - 0.08, h - 0.14, d - 0.1, trim)
  }
  book(0, TOP + 0.15, 0.1, 2.8, 1.9, 0.5, bkRed)
  book(0.15, TOP + 0.65, -0.05, 2.4, 1.6, 0.45, bkTeal)
  book(-0.1, TOP + 1.1, 0.05, 2, 1.3, 0.4, bkYel)

  // Shelves: wood boards with runs of coloured books (deterministic from the seeded rng)
  const run = (axis: 'x' | 'z', fixed: number, from: number, to: number, y: number, depth: number) => {
    for (let p = from; p < to - 0.3; ) {
      const len = 0.12 + rng() * 0.2
      const h = 0.3 + rng() * 0.14
      if (rng() > 0.1) {
        const m = bookPalette[Math.floor(rng() * bookPalette.length)]
        const bs = m === trim || m === accent ? s : books
        const c = p + len / 2
        if (axis === 'x') bs.box(c, y, fixed, len, h, depth, m)
        else bs.box(fixed, y, c, depth, h, len, m)
      }
      p += len
    }
  }
  const shelf = (axis: 'x' | 'z', fixed: number, from: number, to: number, rows: number, depth: number) => {
    const mid = (from + to) / 2
    for (let r = 0; r < rows; r++) {
      const y = 0.1 + 0.5 * r
      if (axis === 'x') s.box(mid, y, fixed, to - from, 0.04, depth + 0.04, wood)
      else s.box(fixed, y, mid, depth + 0.04, 0.04, to - from, wood)
      run(axis, fixed, from + 0.04, to - 0.04, y + 0.04, depth)
    }
    if (axis === 'x') s.box(mid, 0.1, fixed - depth / 2 - 0.02, to - from, 0.5 * rows, 0.04, wood)
    else s.box(fixed - depth / 2 - 0.02, 0.1, mid, 0.04, 0.5 * rows, to - from, wood)
  }
  shelf('x', -HD + T + 0.22, -3.6, 3.6, 6, 0.36) // back wall
  shelf('z', -(HW - T) + 0.22, -3.2, 1.9, 6, 0.36) // left wall
  // Free-standing double-sided unit behind the right glass wall
  s.box(3, 0.1, -0.5, 0.06, 2.1, 4.2, wood)
  for (let r = 0; r < 4; r++) {
    const y = 0.1 + 0.5 * r
    s.box(3, y, -0.5, 0.5, 0.04, 4.2, wood)
    run('z', 3.18, -2.6, 1.6, y + 0.04, 0.2)
    run('z', 2.82, -2.6, 1.6, y + 0.04, 0.2)
  }

  // Interior: reading desks with monitors, book piles and pendant lamps, entrance runner
  inner.box(0, 0, 0.1, W - 2 * T, 0.1, D - T - 0.1, floorMat)
  s.box(0, 0.1, 0.3, 1.4, 0.03, 6, accent)
  for (const sx of [-1, 1]) {
    s.box(sx * 2.25, 0.1, ROW_Z + 0.5, 2.8, 0.9, 0.35, wood)
    s.box(sx * 2.25, 1, ROW_Z + 0.5, 2.9, 0.05, 0.45, trim)
  }
  for (const x of SPOT_XS) {
    s.box(x, 1.05, ROW_Z + 0.5, 0.08, 0.12, 0.08, dark)
    inner.box(x, 1.17, ROW_Z + 0.52, 0.46, 0.3, 0.04, screenMat)
    inner.box(x, 2.75, ROW_Z - 0.15, 0.32, 0.22, 0.32, lightMat)
    s.box(x, 2.97, ROW_Z - 0.15, 0.03, 0.43, 0.03, dark)
  }
  for (const x of [-2.725, -1.775, 1.775, 2.725]) {
    books.box(x, 1.05, ROW_Z + 0.5, 0.32, 0.07, 0.22, bkRed)
    books.box(x + 0.02, 1.12, ROW_Z + 0.5, 0.27, 0.07, 0.2, bkTeal)
    books.box(x - 0.01, 1.19, ROW_Z + 0.5, 0.22, 0.07, 0.18, bkYel)
  }

  // Outdoors: planters beside the door and a bargain book cart
  for (const sx of [-1, 1]) {
    s.box(sx * 1.35, 0, HD + 0.4, 0.5, 0.4, 0.5, wood)
    s.box(sx * 1.35, 0.4, HD + 0.4, 0.44, 0.5, 0.44, plant)
    s.box(sx * 1.35 + 0.1, 0.9, HD + 0.4, 0.12, 0.1, 0.12, accent)
  }
  const cartZ = HD + 1.4
  s.box(-2.8, 0.45, cartZ, 1.4, 0.1, 0.7, wood)
  for (const dx of [-0.65, 0.65]) for (const dz of [-0.3, 0.3]) s.box(-2.8 + dx, 0.12, cartZ + dz, 0.06, 0.33, 0.06, wood)
  for (const dx of [-0.65, 0.65]) s.box(-2.8 + dx, 0, cartZ, 0.14, 0.14, 0.7, dark)
  s.box(-2.8, 0.55, cartZ + 0.33, 1.4, 0.55, 0.04, wood)
  for (const z of [cartZ - 0.1, cartZ + 0.15]) {
    for (let i = 0; i < 6; i++) books.box(-3.4 + i * 0.22 + 0.11, 0.55, z, 0.15, 0.3, 0.2, bookMats[i % 3])
  }

  const object = new THREE.Group()
  object.add(s.build({ castShadow: true, receiveShadow: true }))
  object.add(books.build({ castShadow: true, receiveShadow: true }))
  object.add(inner.build({ receiveShadow: true }), glass.build(), windows.object)

  let lit = true
  let level = 1
  const applyLight = () => {
    const glow = lit ? 0.55 - 0.5 * level : 0
    for (const m of bookMats) m.emissiveIntensity = glow
    lightMat.emissiveIntensity = lit ? 2.8 - 2 * level : 0
    screenMat.emissiveIntensity = lit ? 2.4 - 1.5 * level : 0.05
    floorMat.emissiveIntensity = lit ? 0.7 - 0.6 * level : 0
    glassMat.emissiveIntensity = lit ? 2.2 - 1.9 * level : 0
    glassMat.opacity = lit ? 0.28 : 0.32
  }
  applyLight()

  return {
    style: 'bookstore',
    object,
    footprint: { width: W, depth: D },
    height: STACK_TOP,
    get windowCount() { return windows.count },
    windowPosition: (i) => windows.position(i),
    deskSpots: SPOT_XS.map((x) => new THREE.Vector3(x, 0.1, ROW_Z)),
    doorSpot: new THREE.Vector3(0, 0, HD + 0.9),
    signAnchor: new THREE.Vector3(0, STACK_TOP, 0),
    setLit(on: boolean) { lit = on; windows.setLit(on); applyLight() },
    setWindowState: (i: number, st: WindowState) => windows.setState(i, st),
    setLightLevel(l: number) { level = l; windows.setLightLevel(l); applyLight() },
    setActivity: (running: boolean) => windows.setFlicker(running),
    update: (dtMs: number) => windows.update(dtMs),
    dispose() {
      disposeGeometries(object)
      windows.dispose()
      for (const m of bookMats) m.dispose()
      lightMat.dispose(); screenMat.dispose(); floorMat.dispose(); glassMat.dispose()
    },
  }
}
