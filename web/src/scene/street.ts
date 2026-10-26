// Model base plate with a grass surround, asphalt, sidewalks, zebra crossings, lamps (emissive bulb + additive ground pool + glow) and low-poly trees.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'
import { ROAD_WIDTH, SIDEWALK_WIDTH, type TownLayout } from './layout'
import { VoxelBuilder, disposeGeometries, material } from './voxel'

const SIDEWALK_H = 0.1
const ASPHALT_W = ROAD_WIDTH - 2 * SIDEWALK_WIDTH
const LAMP_H = 3.9
const LAMP_ARM = 0.7
const POOL_SIZE = 13
const GLOW_SIZE = 10 // PointsMaterial size units (world size ~ size * tan(fov / 2))
const LAMP_FADE = 0.1 // level band below 0.5 over which lamps fade in

const FOLIAGE = [0x2d6a3d, 0x37794a, 0x44884f] as const
type Pt = { x: number; z: number }

// Surrounding model base plate: thickness, margin beyond the town (fraction of its size + a minimum), layer heights.
const PLATE_H = 3
const PLATE_MARGIN = { frac: 0.7, min: 34 }
const PLAZA_W = 6
const GRASS_TOP = -0.05
// Greens for meadow patches, bushes and outer trees (instance colours); the rest are flower / field accents.
const PATCH = [0x86b567, 0x72a45a, 0x95b96a, 0xa9b070] as const
const TREE_SHADES = [0x2f7040, 0x3a7e4b, 0x48904f, 0x5a9a50] as const
const BUSH_SHADES = [0x3f8a4a, 0x4d9a54, 0x5fa55a, 0x3a7a46, 0x4d9a54, 0x5fa55a, 0xe58aa0] as const
// Outer surfaces are multiplied by this at night so the town's own light stays the focus.
const NIGHT_TINT = new THREE.Color(0.34, 0.42, 0.64)
const WHITE = new THREE.Color(1, 1, 1)
const CELL = 6 // outer tree jitter-grid cell size

/** 0 at level >= 0.5, 1 at level <= 0.5 - LAMP_FADE (smooth in between). */
function lampAmount(level: number): number {
  const a = THREE.MathUtils.clamp((0.5 - level) / LAMP_FADE, 0, 1)
  return a * a * (3 - 2 * a)
}

export class Street {
  private readonly group = new THREE.Group()
  private readonly table: THREE.Mesh
  private readonly tableMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  private readonly shadowTex = makeContactShadow()
  private readonly shadowMat = new THREE.MeshBasicMaterial({
    map: this.shadowTex, color: 0x141c30, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
  })
  private readonly outerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true, emissive: 0x0e2a18, emissiveIntensity: 0.6 })
  private readonly surfaces = ([[0x7aa75f], [0x8a6a4c], [0x4c3d36], [0x9c998d]] as const).map(([c]) => ({
    mat: new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0 }),
    base: new THREE.Color(c),
  }))
  private readonly tint = new THREE.Color()
  private readonly patchMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  private readonly foliage = FOLIAGE.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0, flatShading: true, emissive: 0x0e2a18, emissiveIntensity: 0.6 }))
  private readonly bulbMat = new THREE.MeshStandardMaterial({ color: 0x3a3020, emissive: 0xffc766, emissiveIntensity: 0.15, roughness: 0.6 })
  private readonly poolTex = makeGlowTexture([[0, 1], [0.25, 0.6], [0.55, 0.2], [1, 0]])
  private readonly haloTex = makeGlowTexture([[0, 1], [0.12, 0.7], [0.4, 0.18], [1, 0]])
  private readonly poolMat = new THREE.MeshBasicMaterial({
    map: this.poolTex, color: 0xffbd58, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  private readonly haloMat = new THREE.PointsMaterial({
    map: this.haloTex, color: 0xffc070, size: GLOW_SIZE, sizeAttenuation: true, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  })
  private content: THREE.Group | null = null
  private pools: THREE.Object3D[] = []
  private level = 1

  constructor(private readonly parent: THREE.Object3D) {
    // The "table" under the model: same tone as the sky so the far ground melts into the background.
    this.table = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), this.tableMat)
    this.table.rotation.x = -Math.PI / 2
    this.table.position.y = -PLATE_H - 0.05
    this.group.add(this.table)
    parent.add(this.group)
  }

  build(layout: TownLayout): void {
    this.clearContent()
    const content = new THREE.Group()
    const b = new VoxelBuilder()
    const { bounds, lotSize, cols, rows, pitch, count } = layout
    const asphalt = material(0x363a44)
    const walk = material(0x9a978f)
    const white = material(0xe8e8e2)
    const pole = material(0x2a2d35)
    const turf = material(0x7d9a6c)
    const [grass, soil, rim, plaza] = this.surfaces.map((x) => x.mat)

    // Asphalt strips along every road centreline (missing cells of a partial grid stay open).
    const reach = ASPHALT_W / 2
    for (const r of layout.roads) {
      const w = Math.abs(r.x1 - r.x0) + 2 * reach
      const d = Math.abs(r.z1 - r.z0) + 2 * reach
      b.box((r.x0 + r.x1) / 2, -0.3, (r.z0 + r.z1) / 2, w, 0.3, d, asphalt)
    }

    // Sidewalk ring around every grid cell, plus a ring on the outside of the town.
    const cells: Pt[] = layout.lots.length > 0 ? [...layout.lots] : [{ x: 0, z: 0 }]
    const parks: Array<Pt & { col: number; row: number }> = []
    for (let i = count; i < cols * rows && count > 0; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const cell = { x: (col - (cols - 1) / 2) * pitch, z: (row - (rows - 1) / 2) * pitch, col, row }
      cells.push(cell)
      parks.push(cell)
    }
    const edge = lotSize / 2 + SIDEWALK_WIDTH / 2
    for (const { x, z } of cells) {
      for (const s of [-1, 1]) {
        b.box(x, 0, z + s * edge, lotSize + 2 * SIDEWALK_WIDTH, SIDEWALK_H, SIDEWALK_WIDTH, walk)
        b.box(x + s * edge, 0, z, SIDEWALK_WIDTH, SIDEWALK_H, lotSize, walk)
      }
    }
    const midX = (bounds.minX + bounds.maxX) / 2
    const midZ = (bounds.minZ + bounds.maxZ) / 2
    const sizeX = bounds.maxX - bounds.minX
    const sizeZ = bounds.maxZ - bounds.minZ

    // Plate under the whole scene; every road line continues across it to the edge.
    const margin = Math.max(PLATE_MARGIN.min, PLATE_MARGIN.frac * Math.max(sizeX, sizeZ))
    const plate = { x0: bounds.minX - margin, x1: bounds.maxX + margin, z0: bounds.minZ - margin, z1: bounds.maxZ + margin }
    const plateW = plate.x1 - plate.x0
    const plateD = plate.z1 - plate.z0
    b.box(midX, GRASS_TOP - 0.4, midZ, plateW, 0.4, plateD, grass)
    b.box(midX, GRASS_TOP - 1.9, midZ, plateW, 1.5, plateD, soil)
    b.box(midX, -PLATE_H, midZ, plateW, PLATE_H + GRASS_TOP - 1.9, plateD, rim)
    for (const [x0, x1, z0, z1] of [
      [bounds.minX - PLAZA_W, bounds.maxX + PLAZA_W, bounds.minZ - PLAZA_W, bounds.minZ],
      [bounds.minX - PLAZA_W, bounds.maxX + PLAZA_W, bounds.maxZ, bounds.maxZ + PLAZA_W],
      [bounds.minX - PLAZA_W, bounds.minX, bounds.minZ, bounds.maxZ],
      [bounds.maxX, bounds.maxX + PLAZA_W, bounds.minZ, bounds.maxZ],
    ]) b.box((x0 + x1) / 2, GRASS_TOP, (z0 + z1) / 2, x1 - x0, 0.04, z1 - z0, plaza)

    const xRoads = layout.roads.filter((r) => r.x0 === r.x1).map((r) => r.x0).sort((a, c) => a - c)
    const zRoads = layout.roads.filter((r) => r.z0 === r.z1).map((r) => r.z0).sort((a, c) => a - c)
    const kerb = reach + SIDEWALK_WIDTH / 2
    for (const x of xRoads) {
      for (const [from, to] of [[plate.z0, bounds.minZ], [bounds.maxZ, plate.z1]]) {
        b.box(x, -0.3, (from + to) / 2, ASPHALT_W, 0.3, to - from, asphalt)
        for (const s of [-1, 1]) b.box(x + s * kerb, 0, (from + to) / 2, SIDEWALK_WIDTH, SIDEWALK_H, to - from, walk)
      }
    }
    for (const z of zRoads) {
      for (const [from, to] of [[plate.x0, bounds.minX], [bounds.maxX, plate.x1]]) {
        b.box((from + to) / 2, -0.3, z, to - from, 0.3, ASPHALT_W, asphalt)
        for (const s of [-1, 1]) b.box((from + to) / 2, 0, z + s * kerb, to - from, SIDEWALK_H, SIDEWALK_WIDTH, walk)
      }
    }

    // Outer sidewalk ring, left open where the road lines run out of town.
    const spans = (a: number, c: number, gaps: number[]): Array<[number, number]> => {
      const out: Array<[number, number]> = []
      let from = a
      for (const g of gaps) {
        if (g - reach > from) out.push([from, g - reach])
        from = Math.max(from, g + reach)
      }
      if (c > from) out.push([from, c])
      return out
    }
    for (const s of [-1, 1]) {
      for (const [from, to] of spans(bounds.minX, bounds.maxX, xRoads)) {
        b.box((from + to) / 2, 0, midZ + s * (sizeZ / 2 - SIDEWALK_WIDTH / 2), to - from, SIDEWALK_H, SIDEWALK_WIDTH, walk)
      }
      for (const [from, to] of spans(bounds.minZ + SIDEWALK_WIDTH, bounds.maxZ - SIDEWALK_WIDTH, zRoads)) {
        b.box(midX + s * (sizeX / 2 - SIDEWALK_WIDTH / 2), 0, (from + to) / 2, SIDEWALK_WIDTH, SIDEWALK_H, to - from, walk)
      }
    }
    // Empty grid cells become small pocket parks.
    for (const p of parks) b.box(p.x, 0, p.z, lotSize, SIDEWALK_H, lotSize, turf)

    // Zebra crossings: stripes run along the road and repeat across its asphalt width.
    for (const c of layout.crosswalks) {
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 0.74
        if (c.axis === 'z') b.box(c.x + off, 0, c.z, 0.42, 0.02, 2.2, white)
        else b.box(c.x, 0, c.z + off, 2.2, 0.02, 0.42, white)
      }
    }

    // Lamps: the head leans toward the nearest road centreline; the bulb is HDR emissive so bloom picks it up.
    const xLines = layout.roads.filter((r) => r.x0 === r.x1).map((r) => r.x0)
    const zLines = layout.roads.filter((r) => r.z0 === r.z1).map((r) => r.z0)
    const nearest = (v: number, lines: number[]): number => lines.reduce((a, l) => (Math.abs(l - v) < Math.abs(a - v) ? l : a), lines[0] ?? v)
    const bulbs: Pt[] = []
    for (const l of layout.lamps) {
      const alongX = (fnv1a32(`lamp:${l.x.toFixed(2)},${l.z.toFixed(2)}`) & 1) === 0
      const dx = alongX ? Math.sign(nearest(l.x, xLines) - l.x) || 1 : 0
      const dz = alongX ? 0 : Math.sign(nearest(l.z, zLines) - l.z) || 1
      const hx = l.x + dx * LAMP_ARM
      const hz = l.z + dz * LAMP_ARM
      b.box(l.x, SIDEWALK_H, l.z, 0.16, LAMP_H, 0.16, pole)
      b.box(l.x + (dx * LAMP_ARM) / 2, SIDEWALK_H + LAMP_H - 0.1, l.z + (dz * LAMP_ARM) / 2, dx ? LAMP_ARM + 0.16 : 0.1, 0.1, dz ? LAMP_ARM + 0.16 : 0.1, pole)
      b.box(hx, SIDEWALK_H + LAMP_H - 0.08, hz, 0.62, 0.12, 0.62, pole)
      b.box(hx, SIDEWALK_H + LAMP_H - 0.46, hz, 0.4, 0.38, 0.4, this.bulbMat)
      bulbs.push({ x: hx, z: hz })
    }

    const solid = b.build({ receiveShadow: true })
    const flat = new Set<THREE.Material>([asphalt, walk, white, turf, grass, soil, rim, plaza])
    solid.traverse((o) => {
      if (o instanceof THREE.Mesh && !flat.has(o.material)) o.castShadow = true
    })
    content.add(solid)
    this.addSurround(content, layout, plate, { x: xRoads, z: zRoads })

    // Trees: layout trees plus a few in the pocket parks. Sidewalk and park trees stand on the 0.1 kerb.
    const trees = [...layout.trees]
    for (const p of parks) {
      const rng = createRng(fnv1a32(`park:${p.col},${p.row}`))
      const range = lotSize / 2 - 3
      for (let i = 0; i < 3; i++) {
        trees.push({ x: p.x + (rng() * 2 - 1) * range, z: p.z + (rng() * 2 - 1) * range, kind: rng() < 0.5 ? 'round' : 'cone', scale: 0.9 + rng() * 0.4 })
      }
    }
    const trunkMat = material(0x5b3f2a)
    const trunks = new VoxelBuilder()
    const crowns = this.foliage.map(() => [] as THREE.BufferGeometry[])
    for (const t of trees) {
      const rng = createRng(fnv1a32(`tree:${t.x.toFixed(2)},${t.z.toFixed(2)}`))
      const onKerb = (t.x > bounds.minX && t.x < bounds.maxX && t.z > bounds.minZ && t.z < bounds.maxZ) || parks.some((p) => Math.abs(t.x - p.x) < lotSize / 2 && Math.abs(t.z - p.z) < lotSize / 2)
      const y = onKerb ? SIDEWALK_H : 0
      const s = t.scale
      const yaw = rng() * Math.PI
      const shade = Math.floor(rng() * crowns.length)
      const place = (g: THREE.BufferGeometry, px: number, py: number, pz: number): void => {
        const ng = g.index ? g.toNonIndexed() : g
        if (ng !== g) g.dispose()
        ng.rotateY(yaw)
        ng.translate(t.x + px * s, y + py * s, t.z + pz * s)
        crowns[(shade + (px === 0 && pz === 0 ? 0 : 1)) % crowns.length].push(ng)
      }
      if (t.kind === 'round') {
        trunks.box(t.x, y, t.z, 0.36 * s, 1.5 * s, 0.36 * s, trunkMat)
        place(new THREE.IcosahedronGeometry(1.35 * s, 0).scale(1, 0.92, 1), 0, 2.7, 0)
        place(new THREE.IcosahedronGeometry(0.85 * s, 0), 0.55, 3.45, 0.25)
      } else {
        trunks.box(t.x, y, t.z, 0.34 * s, 1.1 * s, 0.34 * s, trunkMat)
        const tiers: Array<[number, number, number]> = [[1.5, 1.7, 1.9], [1.15, 1.6, 2.9], [0.8, 1.5, 3.8]]
        for (const [r, h, py] of tiers) place(new THREE.ConeGeometry(r * s, h * s, 6), 0, py, 0)
      }
    }
    const trunkGroup = trunks.build({ castShadow: true, receiveShadow: true })
    content.add(trunkGroup)
    crowns.forEach((geos, i) => {
      if (geos.length === 0) return
      const merged = mergeGeometries(geos, false)
      for (const g of geos) g.dispose()
      if (!merged) return
      const mesh = new THREE.Mesh(merged, this.foliage[i])
      mesh.castShadow = true
      mesh.receiveShadow = true
      content.add(mesh)
    })

    // Light pools (additive ground decals) and halos around the bulbs: one draw call each.
    if (bulbs.length > 0) {
      const quads = bulbs.map((p) => {
        const g = new THREE.PlaneGeometry(POOL_SIZE, POOL_SIZE)
        g.rotateX(-Math.PI / 2)
        g.translate(p.x, SIDEWALK_H + 0.02, p.z)
        return g
      })
      const merged = mergeGeometries(quads, false)
      for (const g of quads) g.dispose()
      const pool = new THREE.Mesh(merged, this.poolMat)
      pool.renderOrder = 2
      const haloGeo = new THREE.BufferGeometry()
      haloGeo.setAttribute('position', new THREE.Float32BufferAttribute(bulbs.flatMap((p) => [p.x, SIDEWALK_H + LAMP_H - 0.3, p.z]), 3))
      const halo = new THREE.Points(haloGeo, this.haloMat)
      halo.renderOrder = 3
      halo.frustumCulled = false
      this.pools = [pool, halo]
      content.add(pool, halo)
    }
    this.content = content
    this.group.add(content)
    this.setLightLevel(this.level)
  }

  /** Contact shadow under the plate, meadow patches, and instanced outer trees and bushes (deterministic per layout). */
  private addSurround(
    content: THREE.Group,
    { bounds }: TownLayout,
    plate: { x0: number; x1: number; z0: number; z1: number },
    roads: { x: number[]; z: number[] },
  ): void {
    const plateW = plate.x1 - plate.x0
    const plateD = plate.z1 - plate.z0
    const midX = (plate.x0 + plate.x1) / 2
    const midZ = (plate.z0 + plate.z1) / 2
    const rng = createRng(fnv1a32(`surround:${plateW.toFixed(1)},${plateD.toFixed(1)}`))
    const between = (lo: number, hi: number): number => lo + (hi - lo) * rng()
    const nearTown = (x: number, z: number, gap: number): boolean =>
      x > bounds.minX - gap && x < bounds.maxX + gap && z > bounds.minZ - gap && z < bounds.maxZ + gap
    const nearRoad = (x: number, z: number, w: number): boolean =>
      roads.x.some((l) => Math.abs(x - l) < w) || roads.z.some((l) => Math.abs(z - l) < w)
    const inside = (x: number, z: number, inset: number): boolean =>
      x > plate.x0 + inset && x < plate.x1 - inset && z > plate.z0 + inset && z < plate.z1 - inset

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(plateW * 1.12, plateD * 1.12).rotateX(-Math.PI / 2), this.shadowMat)
    shadow.position.set(midX, -PLATE_H - 0.02, midZ)
    shadow.renderOrder = 1
    content.add(shadow)

    // Meadow patches: flat vertex-coloured discs, each colour at its own height so overlaps never z-fight.
    const discs: THREE.BufferGeometry[] = []
    const patchCount = Math.round((plateW * plateD) / 420)
    for (let i = 0; i < patchCount; i++) {
      const x = between(plate.x0, plate.x1)
      const z = between(plate.z0, plate.z1)
      const rx = between(3, 9)
      const rz = between(3, 9)
      if (!inside(x, z, Math.max(rx, rz)) || nearTown(x, z, PLAZA_W + 1)) continue
      const shade = Math.floor(rng() * PATCH.length)
      const g = new THREE.CylinderGeometry(1, 1, 0.06, 9).toNonIndexed()
      g.scale(rx, 1, rz).rotateY(rng() * Math.PI).translate(x, GRASS_TOP + 0.01 * (shade + 1) - 0.03, z)
      const c = new THREE.Color(PATCH[shade])
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: g.attributes.position.count }, () => c.toArray()).flat(), 3))
      discs.push(g)
    }
    if (discs.length > 0) {
      const merged = mergeGeometries(discs, false)
      for (const g of discs) g.dispose()
      const mesh = new THREE.Mesh(merged, this.patchMat)
      mesh.receiveShadow = true
      content.add(mesh)
    }

    type Item = { x: number; z: number; yaw: number; s: number; color: number }
    const trees: Array<Item & { cone: boolean }> = []
    const bushes: Item[] = []
    const fieldAt = (x: number, z: number): number =>
      (Math.sin(x * 0.06 + 1.3) + Math.sin(z * 0.05 + 0.4) + Math.sin((x + z) * 0.037 + 2) + 3) / 6
    for (let x = plate.x0; x < plate.x1; x += CELL) {
      for (let z = plate.z0; z < plate.z1; z += CELL) {
        const px = x + CELL / 2 + between(-2.4, 2.4)
        const pz = z + CELL / 2 + between(-2.4, 2.4)
        const dense = THREE.MathUtils.smoothstep(fieldAt(px, pz), 0.45, 0.8)
        const roll = rng()
        const cone = rng() < 0.4
        const item = { x: px, z: pz, yaw: rng() * Math.PI, s: between(0.95, 1.6), color: TREE_SHADES[Math.floor(rng() * TREE_SHADES.length)] }
        if (roll < 0.1 + 0.8 * dense && inside(px, pz, 3) && !nearTown(px, pz, 8) && !nearRoad(px, pz, 6)) trees.push({ ...item, cone })
      }
    }
    for (let x = plate.x0; x < plate.x1; x += CELL * 0.7) {
      for (let z = plate.z0; z < plate.z1; z += CELL * 0.7) {
        const px = x + between(0, CELL * 0.7)
        const pz = z + between(0, CELL * 0.7)
        const item = { x: px, z: pz, yaw: rng() * Math.PI, s: between(0.8, 1.5), color: BUSH_SHADES[Math.floor(rng() * BUSH_SHADES.length)] }
        if (rng() < 0.4 && inside(px, pz, 2) && !nearTown(px, pz, PLAZA_W + 2) && !nearRoad(px, pz, 4.4)) bushes.push(item)
      }
    }

    const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => {
      if (!g.index) return g
      const n = g.toNonIndexed()
      g.dispose()
      return n
    }
    const merge = (parts: THREE.BufferGeometry[]): THREE.BufferGeometry => {
      const out = mergeGeometries(parts.map(flat), false)
      for (const g of parts) g.dispose()
      return out
    }
    const dummy = new THREE.Object3D()
    const col = new THREE.Color()
    const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, items: Item[]): void => {
      if (items.length === 0) {
        geo.dispose()
        return
      }
      const mesh = new THREE.InstancedMesh(geo, mat, items.length)
      items.forEach((it, i) => {
        dummy.position.set(it.x, GRASS_TOP, it.z)
        dummy.rotation.y = it.yaw
        dummy.scale.setScalar(it.s)
        dummy.updateMatrix()
        mesh.setMatrixAt(i, dummy.matrix)
        mesh.setColorAt(i, col.set(it.color))
      })
      mesh.castShadow = true
      mesh.receiveShadow = true
      content.add(mesh)
    }
    const round = merge([
      new THREE.IcosahedronGeometry(1.35, 0).scale(1, 0.92, 1).translate(0, 2.7, 0),
      new THREE.IcosahedronGeometry(0.85, 0).translate(0.55, 3.45, 0.25),
    ])
    const cone = merge(([[1.5, 1.7, 1.9], [1.15, 1.6, 2.9], [0.8, 1.5, 3.8]] as const).map(([r, h, y]) => new THREE.ConeGeometry(r, h, 6).translate(0, y, 0)))
    instanced(new THREE.BoxGeometry(0.36, 1.6, 0.36).translate(0, 0.8, 0), material(0x5b3f2a), trees)
    instanced(round, this.outerMat, trees.filter((t) => !t.cone))
    instanced(cone, this.outerMat, trees.filter((t) => t.cone))
    instanced(new THREE.IcosahedronGeometry(0.9, 0).scale(1, 0.7, 1).translate(0, 0.4, 0), this.outerMat, bushes)
  }

  setLightLevel(level: number): void {
    this.level = level
    const bg = this.parent instanceof THREE.Scene ? this.parent.background : null
    if (bg instanceof THREE.Color) this.tableMat.color.copy(bg).multiplyScalar(0.88)
    this.shadowMat.opacity = THREE.MathUtils.lerp(0.55, 0.4, level)
    this.tint.copy(NIGHT_TINT).lerp(WHITE, THREE.MathUtils.smoothstep(level, 0, 0.6)) // full brightness through dusk and dawn
    for (const { mat, base } of this.surfaces) mat.color.copy(base).multiply(this.tint)
    this.patchMat.color.copy(this.tint)
    this.outerMat.color.copy(this.tint)
    const a = lampAmount(level)
    this.bulbMat.emissiveIntensity = THREE.MathUtils.lerp(0.15, 9, a)
    this.poolMat.opacity = 0.75 * a
    this.haloMat.opacity = 0.9 * a
    for (const o of this.pools) o.visible = a > 0
  }

  dispose(): void {
    this.parent.remove(this.group)
    this.table.geometry.dispose()
    this.clearContent()
    for (const m of [...this.foliage, ...this.surfaces.map((x) => x.mat), this.tableMat, this.shadowMat, this.outerMat, this.patchMat]) m.dispose()
    this.shadowTex.dispose()
    this.bulbMat.dispose()
    this.poolMat.dispose()
    this.haloMat.dispose()
    this.poolTex.dispose()
    this.haloTex.dispose()
  }

  private clearContent(): void {
    if (!this.content) return
    this.group.remove(this.content)
    this.content.traverse((o) => {
      if (o instanceof THREE.Points) o.geometry.dispose()
      if (o instanceof THREE.InstancedMesh) o.dispose()
    })
    disposeGeometries(this.content)
    this.content = null
    this.pools = []
  }
}

/** White radial gradient; stops are [radius 0..1, alpha]. */
function makeGlowTexture(stops: Array<[number, number]>): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  for (const [at, alpha] of stops) g.addColorStop(at, `rgba(255,255,255,${alpha})`)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Soft dark rectangle (alpha only matters); stretched over the plate it fakes a contact shadow on the table. */
function makeContactShadow(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  ctx.shadowColor = '#000'
  ctx.shadowBlur = 12
  ctx.shadowOffsetX = 512 // draw the rect off-canvas so only its blurred shadow lands inside
  ctx.fillRect(14 - 512, 14, 228, 228)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}
