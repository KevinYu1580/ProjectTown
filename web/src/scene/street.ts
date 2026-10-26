// Diorama base plate with a green surround, asphalt roads with kerbs, sidewalks, zebra crossings, lamps (emissive bulb +
// additive ground pool + glow), pocket parks and voxel plants. Static geometry is merged into a few vertex-coloured
// meshes; plants sway through the shared wind uniform, water ripples on the same clock.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'
import { flower, flowerBed, hedge, voxelBush, voxelTree } from './flora'
import { ROAD_WIDTH, SIDEWALK_WIDTH, type TownLayout } from './layout'
import { PAL } from './palette'
import { VoxelBuilder, WIND, disposeGeometries, makeVoxelMaterial, material } from './voxel'

const SIDEWALK_H = 0.1
const ASPHALT_W = ROAD_WIDTH - 2 * SIDEWALK_WIDTH
const KERB_W = 0.2 // kerb stones line the asphalt edge, just outside every sidewalk
const KERB_H = 0.13
const LAMP_H = 3.9
const LAMP_ARM = 0.7
const POOL_SIZE = 13
const GLOW_SIZE = 10 // PointsMaterial size units (world size ~ size * tan(fov / 2))
const LAMP_FADE = 0.1 // level band below 0.5 over which lamps fade in

type Pt = { x: number; z: number }

// Surrounding model base plate: thickness, margin beyond the town (fraction of its size + a minimum), layer heights.
const PLATE_H = 3
const PLATE_MARGIN = { frac: 0.7, min: 34 }
const VERGE_W = 6 // garden verge between the town's outer sidewalk and the fields
const GRASS_TOP = -0.05
// Thin ground layers sit on the grass at distinct heights (no z-fighting) and stay below the asphalt top (y = 0).
const MEADOW_H = [0.008, 0.016, 0.024]
const VERGE_H = 0.036
const SHORE_TOP = GRASS_TOP + 0.03
const WATER_TOP = GRASS_TOP + 0.044
// Outer surfaces are multiplied by this at night so the town's own light stays the focus.
const NIGHT_TINT = new THREE.Color(0.38, 0.45, 0.66)
const WHITE = new THREE.Color(1, 1, 1)
const CELL = 6 // outer tree jitter-grid cell size

/** 0 at level >= 0.5, 1 at level <= 0.5 - LAMP_FADE (smooth in between). */
function lampAmount(level: number): number {
  const a = THREE.MathUtils.clamp((0.5 - level) / LAMP_FADE, 0, 1)
  return a * a * (3 - 2 * a)
}

/** Water: flat colour with slow ripples of light driven by the wind clock (no textures). */
function makeWaterMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: PAL.water[1], roughness: 0.3, metalness: 0 })
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWind = WIND
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWater;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWater = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWater;\nuniform float uWind;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float t = uWind * 0.010471976;
        float r = sin(vWater.x * 1.9 + t * 230.0) * sin(vWater.y * 1.6 - t * 170.0) + 0.5 * sin((vWater.x + vWater.y) * 0.9 + t * 120.0);
        diffuseColor.rgb *= 0.9 + 0.1 * r + 0.18 * smoothstep(1.15, 1.45, r);`,
      )
  }
  return m
}

export class Street {
  private readonly group = new THREE.Group()
  private readonly table: THREE.Mesh
  private readonly tableMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
  private readonly shadowTex = makeContactShadow()
  private readonly shadowMat = new THREE.MeshBasicMaterial({
    map: this.shadowTex, color: 0x141c30, transparent: true, opacity: 0.5, depthWrite: false, fog: false,
  })
  // The surround (plate, fields, their plants) shares one vertex-colour material that is tinted at night.
  private readonly outerMat = makeVoxelMaterial(0.92)
  private readonly waterMat = makeWaterMaterial()
  private readonly waterBase = new THREE.Color(PAL.water[1])
  private readonly tint = new THREE.Color()
  private readonly bulbMat = new THREE.MeshStandardMaterial({ color: 0x3a3020, emissive: PAL.lamp, emissiveIntensity: 0.15, roughness: 0.6 })
  private readonly poolTex = makeGlowTexture([[0, 1], [0.25, 0.6], [0.55, 0.2], [1, 0]])
  private readonly haloTex = makeGlowTexture([[0, 1], [0.12, 0.7], [0.4, 0.18], [1, 0]])
  private readonly poolMat = new THREE.MeshBasicMaterial({
    map: this.poolTex, color: 0xffbd5e, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  private readonly haloMat = new THREE.PointsMaterial({
    map: this.haloTex, color: 0xffc274, size: GLOW_SIZE, sizeAttenuation: true, transparent: true, opacity: 0,
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
    const flats = new VoxelBuilder() // town ground: receives shadows only
    const props = new VoxelBuilder() // lamps, town trees, park furniture
    const outer = new VoxelBuilder(this.outerMat) // plate and fields
    const outerProps = new VoxelBuilder(this.outerMat) // field plants
    const water: THREE.BufferGeometry[] = []
    const { bounds, lotSize, cols, rows, pitch, count } = layout
    const asphalt = material(PAL.asphalt[1])
    const walk = material(PAL.walk[1])
    const kerb = material(PAL.walk[2])
    const marking = material(PAL.marking)
    const pole = material(PAL.frame)

    // Asphalt strips along every road centreline (missing cells of a partial grid stay open).
    const reach = ASPHALT_W / 2
    for (const r of layout.roads) {
      const w = Math.abs(r.x1 - r.x0) + 2 * reach
      const d = Math.abs(r.z1 - r.z0) + 2 * reach
      flats.box((r.x0 + r.x1) / 2, -0.3, (r.z0 + r.z1) / 2, w, 0.3, d, asphalt)
    }

    // Sidewalk ring around every grid cell with a kerb on its road side, plus a ring on the outside of the town.
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
    const kerbAt = lotSize / 2 + SIDEWALK_WIDTH + KERB_W / 2
    const ringW = lotSize + 2 * SIDEWALK_WIDTH
    for (const { x, z } of cells) {
      for (const s of [-1, 1]) {
        flats.box(x, 0, z + s * edge, ringW, SIDEWALK_H, SIDEWALK_WIDTH, walk)
        flats.box(x + s * edge, 0, z, SIDEWALK_WIDTH, SIDEWALK_H, lotSize, walk)
        flats.box(x, 0, z + s * kerbAt, ringW + 2 * KERB_W, KERB_H, KERB_W, kerb)
        flats.box(x + s * kerbAt, 0, z, KERB_W, KERB_H, ringW, kerb)
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
    outer.box(midX, GRASS_TOP - 0.4, midZ, plateW, 0.4, plateD, material(PAL.grass[1]))
    outer.box(midX, GRASS_TOP - 1.9, midZ, plateW, 1.5, plateD, material(PAL.soil[1]))
    outer.box(midX, -PLATE_H, midZ, plateW, PLATE_H + GRASS_TOP - 1.9, plateD, material(PAL.rim))
    // Garden verge around the town: a slightly richer lawn than the fields.
    for (const [x0, x1, z0, z1] of [
      [bounds.minX - VERGE_W, bounds.maxX + VERGE_W, bounds.minZ - VERGE_W, bounds.minZ],
      [bounds.minX - VERGE_W, bounds.maxX + VERGE_W, bounds.maxZ, bounds.maxZ + VERGE_W],
      [bounds.minX - VERGE_W, bounds.minX, bounds.minZ, bounds.maxZ],
      [bounds.maxX, bounds.maxX + VERGE_W, bounds.minZ, bounds.maxZ],
    ]) outer.box((x0 + x1) / 2, GRASS_TOP, (z0 + z1) / 2, x1 - x0, VERGE_H, z1 - z0, material(PAL.lawn[1]))

    const xRoads = layout.roads.filter((r) => r.x0 === r.x1).map((r) => r.x0).sort((a, c) => a - c)
    const zRoads = layout.roads.filter((r) => r.z0 === r.z1).map((r) => r.z0).sort((a, c) => a - c)
    const walkOff = reach + KERB_W + SIDEWALK_WIDTH / 2
    const kerbOff = reach + KERB_W / 2
    for (const x of xRoads) {
      for (const [from, to] of [[plate.z0, bounds.minZ], [bounds.maxZ, plate.z1]]) {
        flats.box(x, -0.3, (from + to) / 2, ASPHALT_W, 0.3, to - from, asphalt)
        for (const s of [-1, 1]) {
          flats.box(x + s * walkOff, 0, (from + to) / 2, SIDEWALK_WIDTH, SIDEWALK_H, to - from, walk)
          flats.box(x + s * kerbOff, 0, (from + to) / 2, KERB_W, KERB_H, to - from, kerb)
        }
      }
    }
    for (const z of zRoads) {
      for (const [from, to] of [[plate.x0, bounds.minX], [bounds.maxX, plate.x1]]) {
        flats.box((from + to) / 2, -0.3, z, to - from, 0.3, ASPHALT_W, asphalt)
        for (const s of [-1, 1]) {
          flats.box((from + to) / 2, 0, z + s * walkOff, to - from, SIDEWALK_H, SIDEWALK_WIDTH, walk)
          flats.box((from + to) / 2, 0, z + s * kerbOff, to - from, KERB_H, KERB_W, kerb)
        }
      }
    }

    // Outer sidewalk ring (kerb on its inner, road side), left open where the road lines run out of town.
    const spans = (a: number, c: number, gaps: number[], gap: number): Array<[number, number]> => {
      const out: Array<[number, number]> = []
      let from = a
      for (const g of gaps) {
        if (g - gap > from) out.push([from, g - gap])
        from = Math.max(from, g + gap)
      }
      if (c > from) out.push([from, c])
      return out
    }
    const verge = (x0: number, z0: number, x1: number, z1: number, alongX: boolean, seed: string): void => {
      // Hedge runs broken by flower beds, on the verge just outside the outer sidewalk.
      const rng = createRng(fnv1a32(seed))
      const len = alongX ? x1 - x0 : z1 - z0
      let p = 0.6
      let bed = false
      while (p < len - 1.2) {
        const piece = Math.min(bed ? 2.6 : 5 + rng() * 3, len - 0.6 - p)
        if (piece < 1.2) break
        const c = p + piece / 2
        const cx = alongX ? x0 + c : x0
        const cz = alongX ? z0 : z0 + c
        if (bed) flowerBed(outerProps, cx, GRASS_TOP, cz, alongX ? piece : 0.9, alongX ? 0.9 : piece, () => Math.floor(rng() * 7))
        else hedge(outerProps, cx, GRASS_TOP, cz, alongX ? piece : 0.6, alongX ? 0.6 : piece)
        p += piece + 0.6
        bed = !bed
      }
    }
    const vergeIn = 0.9 // hedge line distance outside the bounds
    for (const s of [-1, 1]) {
      const zRing = midZ + s * (sizeZ / 2 - SIDEWALK_WIDTH / 2)
      for (const [from, to] of spans(bounds.minX, bounds.maxX, xRoads, reach + KERB_W)) {
        flats.box((from + to) / 2, 0, zRing, to - from, SIDEWALK_H, SIDEWALK_WIDTH, walk)
        flats.box((from + to) / 2, 0, zRing - s * (SIDEWALK_WIDTH / 2 + KERB_W / 2), to - from, KERB_H, KERB_W, kerb)
      }
      for (const [from, to] of spans(bounds.minZ + SIDEWALK_WIDTH, bounds.maxZ - SIDEWALK_WIDTH, zRoads, reach + KERB_W)) {
        const xRing = midX + s * (sizeX / 2 - SIDEWALK_WIDTH / 2)
        flats.box(xRing, 0, (from + to) / 2, SIDEWALK_WIDTH, SIDEWALK_H, to - from, walk)
        flats.box(xRing - s * (SIDEWALK_WIDTH / 2 + KERB_W / 2), 0, (from + to) / 2, KERB_W, KERB_H, to - from, kerb)
      }
      const zv = s < 0 ? bounds.minZ - vergeIn : bounds.maxZ + vergeIn
      for (const [from, to] of spans(bounds.minX - VERGE_W + 1, bounds.maxX + VERGE_W - 1, xRoads, walkOff + SIDEWALK_WIDTH)) {
        verge(from, zv, to, zv, true, `verge:z${s}:${from.toFixed(1)}`)
      }
      const xv = s < 0 ? bounds.minX - vergeIn : bounds.maxX + vergeIn
      for (const [from, to] of spans(bounds.minZ, bounds.maxZ, zRoads, walkOff + SIDEWALK_WIDTH)) {
        verge(xv, from, xv, to, false, `verge:x${s}:${from.toFixed(1)}`)
      }
    }

    // Zebra crossings: stripes run along the road and repeat across its asphalt width (inside the kerbs).
    for (const c of layout.crosswalks) {
      for (let i = 0; i < 4; i++) {
        const off = (i - 1.5) * 0.62
        if (c.axis === 'z') flats.box(c.x + off, 0, c.z, 0.36, 0.02, 2.1, marking)
        else flats.box(c.x, 0, c.z + off, 2.1, 0.02, 0.36, marking)
      }
    }

    // Pocket parks in empty grid cells: lawn quadrants around a fountain, cross paths, beds and trees.
    for (const p of parks) this.park(flats, props, water, p, lotSize)

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
      props.box(l.x, SIDEWALK_H, l.z, 0.34, 0.3, 0.34, pole)
      props.box(l.x, SIDEWALK_H, l.z, 0.16, LAMP_H, 0.16, pole)
      props.box(l.x + (dx * LAMP_ARM) / 2, SIDEWALK_H + LAMP_H - 0.1, l.z + (dz * LAMP_ARM) / 2, dx ? LAMP_ARM + 0.16 : 0.1, 0.1, dz ? LAMP_ARM + 0.16 : 0.1, pole)
      props.box(hx, SIDEWALK_H + LAMP_H - 0.08, hz, 0.62, 0.12, 0.62, pole)
      props.box(hx, SIDEWALK_H + LAMP_H - 0.46, hz, 0.4, 0.38, 0.4, this.bulbMat)
      bulbs.push({ x: hx, z: hz })
    }

    // Town trees: layout trees on the sidewalks (with a tree pit) and the verge.
    for (const t of layout.trees) {
      const onKerb = t.x > bounds.minX && t.x < bounds.maxX && t.z > bounds.minZ && t.z < bounds.maxZ
      const y = onKerb ? SIDEWALK_H : GRASS_TOP
      const v = createRng(fnv1a32(`tree:${t.x.toFixed(2)},${t.z.toFixed(2)}`))()
      if (onKerb) props.box(t.x, SIDEWALK_H, t.z, 0.95, 0.03, 0.95, material(PAL.walk[0]))
      voxelTree(onKerb ? props : outerProps, t.x, y, t.z, t.kind, t.scale, v)
    }

    const ground = flats.build({ receiveShadow: true })
    content.add(ground, props.build({ castShadow: true, receiveShadow: true }))
    this.addSurround(content, outer, outerProps, water, layout, plate, { x: xRoads, z: zRoads })
    content.add(outer.build({ receiveShadow: true }), outerProps.build({ castShadow: true, receiveShadow: true }))
    if (water.length > 0) {
      const merged = mergeGeometries(water, false)
      for (const g of water) g.dispose()
      const mesh = new THREE.Mesh(merged, this.waterMat)
      mesh.receiveShadow = true
      content.add(mesh)
    }

    // Light pools (additive ground decals) and halos around the bulbs: one draw call each.
    if (bulbs.length > 0) {
      const quads = bulbs.map((p) => {
        const g = new THREE.PlaneGeometry(POOL_SIZE, POOL_SIZE)
        g.rotateX(-Math.PI / 2)
        g.translate(p.x, SIDEWALK_H + 0.04, p.z)
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

  setLightLevel(level: number): void {
    this.level = level
    const bg = this.parent instanceof THREE.Scene ? this.parent.background : null
    if (bg instanceof THREE.Color) this.tableMat.color.copy(bg).multiplyScalar(0.88)
    this.shadowMat.opacity = THREE.MathUtils.lerp(0.55, 0.4, level)
    this.tint.copy(NIGHT_TINT).lerp(WHITE, THREE.MathUtils.smoothstep(level, 0, 0.6)) // full brightness through dusk and dawn
    this.outerMat.color.copy(this.tint)
    // Water darkens more than the land at night so it never glows.
    this.waterMat.color.copy(this.waterBase).multiply(this.tint).multiplyScalar(THREE.MathUtils.lerp(0.45, 1, THREE.MathUtils.smoothstep(level, 0, 0.6)))
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
    for (const m of [this.tableMat, this.shadowMat, this.outerMat, this.waterMat]) m.dispose()
    this.shadowTex.dispose()
    this.bulbMat.dispose()
    this.poolMat.dispose()
    this.haloMat.dispose()
    this.poolTex.dispose()
    this.haloTex.dispose()
  }

  /** Pocket park on an empty grid cell: lawn quadrants, cross paths, a fountain, beds, trees and shrubs. */
  private park(flats: VoxelBuilder, props: VoxelBuilder, water: THREE.BufferGeometry[], p: Pt & { col: number; row: number }, size: number): void {
    const rng = createRng(fnv1a32(`park:${p.col},${p.row}`))
    const y = SIDEWALK_H
    const path = 1.3
    const q = (size - path) / 2 // quadrant size
    flats.box(p.x, 0, p.z, size, SIDEWALK_H, size, material(PAL.paving[1]))
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const cx = p.x + sx * (path / 2 + q / 2)
        const cz = p.z + sz * (path / 2 + q / 2)
        flats.box(cx, y, cz, q - 0.3, 0.06, q - 0.3, material(PAL.lawn[1]))
        if (sx === sz) voxelTree(props, cx + sx * q * 0.12, y + 0.06, cz + sz * q * 0.12, rng() < 0.5 ? 'round' : 'cone', 0.9 + rng() * 0.3, rng())
        else {
          flowerBed(props, cx - sx * q * 0.18, y + 0.06, cz + sz * q * 0.22, q * 0.45, 0.9, () => Math.floor(rng() * 7))
          voxelBush(props, cx + sx * q * 0.22, y + 0.06, cz - sz * q * 0.2, 0.9, rng())
        }
      }
    }
    // Fountain: stone basin with water, pedestal and a top bowl.
    const r = Math.min(1.9, size * 0.16)
    const stone = material(PAL.paving[2])
    for (const s of [-1, 1]) {
      props.box(p.x, y, p.z + s * (r - 0.15), 2 * r, 0.45, 0.3, stone)
      props.box(p.x + s * (r - 0.15), y, p.z, 0.3, 0.45, 2 * r - 0.6, stone)
    }
    water.push(new THREE.BoxGeometry(2 * r - 0.6, 0.05, 2 * r - 0.6).translate(p.x, y + 0.33, p.z))
    props.box(p.x, y, p.z, 0.42, 1.2, 0.42, material(PAL.paving[1]))
    props.box(p.x, y + 1.2, p.z, 0.95, 0.18, 0.95, stone)
    water.push(new THREE.BoxGeometry(0.75, 0.05, 0.75).translate(p.x, y + 1.36, p.z))
  }

  /** Contact shadow under the plate, meadows, groves, shrubs, flower patches, a pond and road-side avenues. */
  private addSurround(
    content: THREE.Group,
    outer: VoxelBuilder,
    outerProps: VoxelBuilder,
    water: THREE.BufferGeometry[],
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

    // Pond on the far right of the default view, clear of roads and the town.
    const pond = { x: bounds.maxX + VERGE_W + 13, z: bounds.minZ - VERGE_W - 9, rx: 6.5, rz: 4.2 }
    const inPond = (x: number, z: number, pad: number): boolean =>
      ((x - pond.x) / (pond.rx + pad)) ** 2 + ((z - pond.z) / (pond.rz + pad)) ** 2 < 1
    const hasPond = inside(pond.x, pond.z, 10) && !nearRoad(pond.x, pond.z, pond.rx + 5)
    if (hasPond) {
      // Blocky ellipse: rows of water with a sandy, stepped shore.
      for (let dz = -pond.rz; dz <= pond.rz + 1e-6; dz += 0.7) {
        const half = pond.rx * Math.sqrt(Math.max(0, 1 - (dz / (pond.rz + 0.35)) ** 2))
        if (half < 0.5) continue
        const w = Math.round(half / 0.7) * 1.4
        outer.box(pond.x, SHORE_TOP - 0.06, pond.z + dz, w + 1.4, 0.06, 0.7, material(PAL.meadow[2]))
        water.push(new THREE.BoxGeometry(w, 0.05, 0.7).translate(pond.x, WATER_TOP - 0.025, pond.z + dz))
      }
      for (let i = 0; i < 5; i++) {
        const a = rng() * Math.PI * 2
        const k = 0.35 + rng() * 0.45
        outer.box(pond.x + Math.cos(a) * pond.rx * k, WATER_TOP, pond.z + Math.sin(a) * pond.rz * k, 0.6, 0.03, 0.6, material(PAL.lawn[2]))
      }
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2
        const x = pond.x + Math.cos(a) * (pond.rx + 0.5)
        const z = pond.z + Math.sin(a) * (pond.rz + 0.5)
        outerProps.box(x, GRASS_TOP, z, 0.14, 0.7 + rng() * 0.5, 0.14, material(PAL.hedge[2]), 0.12, GRASS_TOP)
        outerProps.box(x + 0.2, GRASS_TOP, z + 0.1, 0.14, 0.5 + rng() * 0.4, 0.14, material(PAL.hedge[1]), 0.12, GRASS_TOP)
      }
    }
    const clear = (x: number, z: number, pad: number): boolean => !(hasPond && inPond(x, z, pad))

    // Meadow patches: blocky tone variations, each tone at its own height so overlaps never z-fight.
    const patchCount = Math.round((plateW * plateD) / 420)
    for (let i = 0; i < patchCount; i++) {
      const x = between(plate.x0, plate.x1)
      const z = between(plate.z0, plate.z1)
      const rx = between(3, 9)
      const rz = between(3, 9)
      const tone = Math.floor(rng() * 3)
      if (!inside(x, z, Math.max(rx, rz)) || nearTown(x, z, VERGE_W + 1) || !clear(x, z, Math.max(rx, rz))) continue
      const c = material([PAL.meadow[0], PAL.meadow[1], PAL.grass[2]][tone])
      outer.box(x, GRASS_TOP, z, rx * 2, MEADOW_H[tone], rz * 1.2, c)
      outer.box(x + rx * 0.3, GRASS_TOP, z + rz * 0.2, rx * 1.2, MEADOW_H[tone], rz * 2, c)
    }

    // Groves: trees follow a smooth density field; shrubs and flower patches fill the open meadow.
    const fieldAt = (x: number, z: number): number =>
      (Math.sin(x * 0.06 + 1.3) + Math.sin(z * 0.05 + 0.4) + Math.sin((x + z) * 0.037 + 2) + 3) / 6
    for (let x = plate.x0; x < plate.x1; x += CELL) {
      for (let z = plate.z0; z < plate.z1; z += CELL) {
        const px = x + CELL / 2 + between(-2.4, 2.4)
        const pz = z + CELL / 2 + between(-2.4, 2.4)
        const dense = THREE.MathUtils.smoothstep(fieldAt(px, pz), 0.55, 0.85)
        const roll = rng()
        const cone = rng() < 0.4
        const s = between(0.95, 1.5)
        const v = 0.2 + 0.8 * rng()
        if (roll < 0.02 + 0.75 * dense && inside(px, pz, 3) && !nearTown(px, pz, VERGE_W + 2) && !nearRoad(px, pz, 6) && clear(px, pz, 3)) {
          voxelTree(outerProps, px, GRASS_TOP, pz, cone ? 'cone' : 'round', s, v)
        } else if (roll > 0.9 && dense < 0.3 && inside(px, pz, 4) && !nearTown(px, pz, VERGE_W + 1) && !nearRoad(px, pz, 4) && clear(px, pz, 2)) {
          // Flower patch: a loose cluster of one or two colours.
          const c0 = PAL.flowers[Math.floor(rng() * PAL.flowers.length)]
          const c1 = PAL.flowers[Math.floor(rng() * PAL.flowers.length)]
          const n = 10 + Math.floor(rng() * 6)
          for (let i = 0; i < n; i++) flower(outerProps, px + between(-1.3, 1.3), GRASS_TOP, pz + between(-1.0, 1.0), i % 3 ? c0 : c1, 1.4)
        }
      }
    }
    for (let x = plate.x0; x < plate.x1; x += CELL * 0.7) {
      for (let z = plate.z0; z < plate.z1; z += CELL * 0.7) {
        const px = x + between(0, CELL * 0.7)
        const pz = z + between(0, CELL * 0.7)
        const s = between(0.8, 1.4)
        const v = rng()
        if (rng() < 0.16 && inside(px, pz, 2) && !nearTown(px, pz, VERGE_W + 1) && !nearRoad(px, pz, 4.4) && clear(px, pz, 1.5)) {
          voxelBush(outerProps, px, GRASS_TOP, pz, s, v)
        }
      }
    }

    // Avenues: trees along the road lines that run out across the plate.
    const avenueOff = ASPHALT_W / 2 + KERB_W + SIDEWALK_WIDTH + 1.4
    const avenue = (x: number, z: number, seed: string): void => {
      if (!inside(x, z, 2) || nearTown(x, z, VERGE_W + 1) || !clear(x, z, 2)) return
      const v = createRng(fnv1a32(seed))()
      voxelTree(outerProps, x, GRASS_TOP, z, v < 0.3 ? 'cone' : 'round', 0.95 + v * 0.25, v * 0.7 + 0.2)
    }
    for (const x of roads.x) {
      for (const s of [-1, 1]) for (let z = plate.z0 + 4; z < plate.z1 - 4; z += 9) avenue(x + s * avenueOff, z, `av:${x.toFixed(1)},${z.toFixed(1)},${s}`)
    }
    for (const z of roads.z) {
      for (const s of [-1, 1]) for (let x = plate.x0 + 4; x < plate.x1 - 4; x += 9) avenue(x, z + s * avenueOff, `av:${x.toFixed(1)},${z.toFixed(1)},${s}`)
    }
  }

  private clearContent(): void {
    if (!this.content) return
    this.group.remove(this.content)
    this.content.traverse((o) => {
      if (o instanceof THREE.Points) o.geometry.dispose()
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
