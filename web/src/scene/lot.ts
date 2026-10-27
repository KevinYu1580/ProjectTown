import * as THREE from 'three'
import type { BuildingStyle, ProjectInfo, SessionInfo } from '../types'
import { fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'
import { BUILDERS } from './buildings'
import type { BuildingHandle } from './buildings/types'
import type { CharacterSpots } from './characters/manager'
import { BASE_LOT_SIZE, ROAD_WIDTH, type LotPlacement, type TownLayout } from './layout'
import { flowerBed, hedge, voxelBush, voxelTree } from './flora'
import { PAL } from './palette'
import { Sign } from './sign'
import { assignSleepingWindows, assignSlots } from './slots'
import { VoxelBuilder, disposeGeometries, material } from './voxel'

/** Top of the lot paving (matches the sidewalk height drawn by the street). */
export const LOT_Y = 0.1
const BENCH_XS = [-4.4, -2.4, -0.4]
const NEAR_DOOR_OFFSETS: Array<[number, number]> = [[-1.2, 0.4], [1.2, 0.4], [-0.4, 1.2], [0.9, 1.3], [-1.9, 1.1], [1.9, 1.2]]
const EDGE = BASE_LOT_SIZE / 2 - 0.4 // garden edge inside the lot border
// Garden zone: behind the building and along the back half of its sides. Buildings keep their props in front
// and on the front half of the sides; the front stays paved for people, benches and the door.
const SIDE_END = -0.8

// Warm light the lit storefront spills onto the forecourt after dark (additive decal, shared texture).
let spillTex: THREE.CanvasTexture | null = null
function spillTexture(): THREE.CanvasTexture {
  if (spillTex) return spillTex
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const ctx = c.getContext('2d')
  if (ctx) {
    const g = ctx.createRadialGradient(32, 20, 2, 32, 26, 34)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.45, 'rgba(255,255,255,0.45)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 64, 64)
  }
  spillTex = new THREE.CanvasTexture(c)
  spillTex.colorSpace = THREE.SRGBColorSpace
  return spillTex
}

/** One project's plot: paving, building, benches, sign. Contents scale with the lot; the sign does not. */
export class Lot {
  readonly id: string
  readonly object = new THREE.Group()
  readonly sign = new Sign()
  visible: SessionInfo[] = []
  sleeping = new Map<string, number>()
  /** Ids of all non-sleeping sessions, including ones not drawn (told apart from gone sessions by the characters). */
  alive: ReadonlySet<string> = new Set()
  /** Ids of all sleeping sessions, including overflow ones that got no window. */
  asleep: ReadonlySet<string> = new Set()
  private readonly content = new THREE.Group()
  private grounds: THREE.Group | null = null
  private building!: BuildingHandle
  private style!: BuildingStyle
  private color!: string
  private litPattern: boolean[] = []
  private level = 1
  private lit = false
  private readonly spillMat = new THREE.MeshBasicMaterial({
    map: spillTexture(), color: 0xffb862, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
    depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })
  private readonly spill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.spillMat)
  private layout: TownLayout | null = null
  private placement: LotPlacement = { index: 0, col: 0, row: 0, x: 0, z: 0 }
  private benchZ = 0

  constructor(project: ProjectInfo, private readonly rng: () => number) {
    this.id = project.id
    this.content.position.y = LOT_Y
    this.object.add(this.content, this.sign.object)
    this.spill.renderOrder = 2
    this.content.add(this.spill)
    this.rebuildBuilding(project)
  }

  /** Building height in world units (scaled), sign excluded. */
  get height(): number {
    return this.building.height * (this.layout?.lotScale ?? 1)
  }

  setLayout(placement: LotPlacement, layout: TownLayout): void {
    this.placement = placement
    this.layout = layout
    this.object.position.set(placement.x, 0, placement.z)
    this.content.scale.setScalar(layout.lotScale)
    this.placeSign()
  }

  update(project: ProjectInfo): void {
    if (project.buildingStyle !== this.style || project.color !== this.color) this.rebuildBuilding(project)
    const b = this.building
    const slots = assignSlots(project.sessions)
    this.visible = slots.visible
    this.alive = new Set(project.sessions.filter((s) => s.state !== 'sleeping').map((s) => s.id))
    const sleepingIds = project.sessions.filter((s) => s.state === 'sleeping').map((s) => s.id)
    this.asleep = new Set(sleepingIds)
    this.sleeping = assignSleepingWindows(sleepingIds, b.windowCount, this.sleeping)
    const asleep = new Set(this.sleeping.values())

    const hasSessions = project.sessions.length > 0
    b.setLit(hasSessions)
    this.lit = hasSessions
    this.applySpill()
    for (let i = 0; i < b.windowCount; i++) b.setWindowState(i, asleep.has(i) ? 'sleep' : this.litPattern[i] ? 'lit' : 'off')
    b.setActivity(slots.counts.running > 0)
    this.sign.set({ name: project.name, color: project.color, counts: slots.counts, hiddenCount: slots.hiddenCount, lit: hasSessions })
  }

  tick(dtMs: number, sceneNowMs: number): void {
    this.building.update(dtMs, sceneNowMs)
  }

  setLightLevel(level: number): void {
    this.level = level
    this.building.setLightLevel(level)
    this.sign.setLightLevel(level)
    this.applySpill()
  }

  /** World-space spots for the character manager. */
  spots(): CharacterSpots {
    const b = this.building
    const layout = this.layout
    const door = this.toWorld(b.doorSpot)
    const scale = layout?.lotScale ?? 1
    const roadZ = this.placement.z + (layout ? layout.lotSize / 2 + ROAD_WIDTH / 2 : 10)
    const bounds = layout?.bounds
    const edgeX = !bounds ? 80 : this.placement.x < 0 ? bounds.minX - 12 : bounds.maxX + 12
    return {
      desks: b.deskSpots.map((v) => this.toWorld(v)),
      door,
      nearDoor: NEAR_DOOR_OFFSETS.map(([dx, dz]) => this.toWorld(b.doorSpot.clone().add(new THREE.Vector3(dx, 0, dz)))),
      benchSeats: BENCH_XS.flatMap((x) => [x - 0.4, x + 0.4]).map((x) => ({ pos: this.toWorld(new THREE.Vector3(x, 0.4, this.benchZ)), yaw: 0 })),
      windowPositions: (i) => this.toWorld(b.windowPosition(i)),
      signTop: this.toWorld(b.signAnchor.clone().add(new THREE.Vector3(0, 3, 0))),
      exitRoad: [new THREE.Vector3(door.x, 0, roadZ), new THREE.Vector3(edgeX, 0, roadZ)],
      scale,
    }
  }

  signTexts(): { projectId: string; lines: string[] } {
    return { projectId: this.id, lines: [...this.sign.lines] }
  }

  dispose(): void {
    this.building.dispose()
    if (this.grounds) disposeGeometries(this.grounds)
    this.spill.geometry.dispose()
    this.spillMat.dispose()
    this.sign.dispose()
  }

  private toWorld(local: THREE.Vector3): THREE.Vector3 {
    const s = this.layout?.lotScale ?? 1
    return new THREE.Vector3(this.placement.x + local.x * s, LOT_Y + local.y * s, this.placement.z + local.z * s)
  }

  private placeSign(): void {
    const a = this.building.signAnchor
    const s = this.layout?.lotScale ?? 1
    this.sign.object.position.set(a.x * s, LOT_Y + a.y * s, a.z * s)
  }

  private rebuildBuilding(project: ProjectInfo): void {
    if (this.building) {
      this.content.remove(this.building.object)
      this.building.dispose()
    }
    this.style = project.buildingStyle
    this.color = project.color
    this.building = BUILDERS[project.buildingStyle](project.color)
    this.content.add(this.building.object)
    this.litPattern = Array.from({ length: this.building.windowCount }, () => this.rng() < 0.75)

    // Benches sit in front of the door area, clear of the building footprint.
    this.benchZ = Math.min(this.building.footprint.depth / 2 + 3, 6.5)
    if (this.grounds) {
      disposeGeometries(this.grounds)
      this.grounds.removeFromParent()
    }
    this.grounds = this.buildGrounds(project.id)
    this.content.add(this.grounds)
    const { width, depth } = this.building.footprint
    this.spill.scale.set(width + 1.5, 1, 4.2)
    this.spill.position.set(0, 0.03, depth / 2 + 1.7)

    this.setLightLevel(this.level)
    if (this.layout) this.placeSign()
  }

  /** Paving, garden (lawn, hedges, flower beds, two small trees), corner planters and benches: two meshes. */
  private buildGrounds(seed: string): THREE.Group {
    const flat = new VoxelBuilder()
    const props = new VoxelBuilder()
    const rng = createRng(fnv1a32(`grounds:${seed}`))
    const { width, depth } = this.building.footprint
    const hw = width / 2
    const hd = depth / 2
    flat.box(0, -LOT_Y, 0, BASE_LOT_SIZE, LOT_Y, BASE_LOT_SIZE, material(PAL.paving[1]))
    // Lighter flagstone path from the door to the street.
    const door = this.building.doorSpot
    const pathFrom = hd + 0.3
    flat.box(door.x, 0, (pathFrom + BASE_LOT_SIZE / 2) / 2, 1.5, 0.015, BASE_LOT_SIZE / 2 - pathFrom, material(PAL.paving[2]))

    const back = hd + 0.5
    const lawn = material(PAL.lawn[1])
    if (EDGE - back > 0.8) flat.box(0, 0, -(back + EDGE) / 2, 2 * EDGE, 0.05, EDGE - back, lawn)
    const sideW = EDGE - (hw + 0.5)
    for (const s of [-1, 1]) {
      if (sideW > 0.8) flat.box(s * (hw + 0.5 + sideW / 2), 0, (-back + SIDE_END) / 2, sideW, 0.05, back + SIDE_END, lawn)
    }
    // Clipped hedge around the garden, flower beds along the side walls, small trees in the back corners.
    hedge(props, 0, 0.05, -EDGE - 0.05, 2 * EDGE + 0.6, 0.6, 0.55)
    for (const s of [-1, 1]) {
      hedge(props, s * (EDGE + 0.05), 0.05, (-EDGE + SIDE_END) / 2, 0.6, EDGE + SIDE_END, 0.55)
      const bedLen = hd - 0.3 + SIDE_END
      if (sideW > 1.3 && bedLen > 1) flowerBed(props, s * (hw + 0.95), 0.05, (-(hd - 0.3) + SIDE_END) / 2, 0.8, bedLen, () => Math.floor(rng() * 7))
      if (EDGE - back > 1.6) voxelTree(props, s * (EDGE - 1.3), 0.05, -EDGE + 1.2, rng() < 0.3 ? 'cone' : 'round', 0.72, rng())
    }
    // Planters on the two front corners.
    for (const s of [-1, 1]) {
      const x = s * (BASE_LOT_SIZE / 2 - 0.95)
      const z = BASE_LOT_SIZE / 2 - 0.95
      props.box(x, 0, z, 1.0, 0.45, 1.0, material(PAL.paving[0]))
      props.box(x, 0.45, z, 1.06, 0.06, 1.06, material(PAL.paving[2]))
      voxelBush(props, x, 0.45, z, 0.75, rng() * 0.45)
    }

    const wood = material(PAL.wood[1])
    const legs = material(PAL.wood[0])
    for (const x of BENCH_XS) {
      props.box(x, 0.4, this.benchZ, 1.6, 0.12, 0.5, wood)
      props.box(x, 0.52, this.benchZ - 0.25, 1.6, 0.45, 0.1, wood)
      for (const sx of [-0.7, 0.7]) props.box(x + sx, 0, this.benchZ, 0.1, 0.4, 0.45, legs)
    }
    const g = new THREE.Group()
    g.add(flat.build({ receiveShadow: true }), props.build({ castShadow: true, receiveShadow: true }))
    return g
  }

  private applySpill(): void {
    const night = 1 - THREE.MathUtils.smoothstep(this.level, 0.2, 0.65)
    this.spillMat.opacity = this.lit ? 0.55 * night : 0
    this.spill.visible = this.spillMat.opacity > 0.01
  }
}
