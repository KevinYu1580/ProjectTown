import * as THREE from 'three'
import type { BuildingStyle, ProjectInfo, SessionInfo } from '../types'
import { BUILDERS } from './buildings'
import type { BuildingHandle } from './buildings/types'
import type { CharacterSpots } from './characters/manager'
import { BASE_LOT_SIZE, ROAD_WIDTH, type LotPlacement, type TownLayout } from './layout'
import { Sign } from './sign'
import { assignSleepingWindows, assignSlots } from './slots'
import { VoxelBuilder, disposeGeometries, material } from './voxel'

/** Top of the lot paving (matches the sidewalk height drawn by the street). */
export const LOT_Y = 0.1
const BENCH_XS = [-4.4, -2.4, -0.4]
const NEAR_DOOR_OFFSETS: Array<[number, number]> = [[-1.2, 0.4], [1.2, 0.4], [-0.4, 1.2], [0.9, 1.3], [-1.9, 1.1], [1.9, 1.2]]

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
  private readonly furniture: THREE.Group
  private building!: BuildingHandle
  private style!: BuildingStyle
  private color!: string
  private litPattern: boolean[] = []
  private level = 1
  private layout: TownLayout | null = null
  private placement: LotPlacement = { index: 0, col: 0, row: 0, x: 0, z: 0 }
  private benchZ = 0

  constructor(project: ProjectInfo, private readonly rng: () => number) {
    this.id = project.id
    this.content.position.y = LOT_Y
    this.object.add(this.content, this.sign.object)

    const f = new VoxelBuilder()
    f.box(0, -LOT_Y, 0, BASE_LOT_SIZE, LOT_Y, BASE_LOT_SIZE, material(0x8f8c84))
    this.furniture = f.build({ receiveShadow: true })
    this.content.add(this.furniture)
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
    disposeGeometries(this.furniture)
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
    const old = this.furniture.getObjectByName('benches')
    if (old) {
      disposeGeometries(old)
      old.removeFromParent()
    }
    const wood = material(0x8a5a3a)
    const bb = new VoxelBuilder()
    for (const x of BENCH_XS) {
      bb.box(x, 0.4, this.benchZ, 1.6, 0.12, 0.5, wood)
      bb.box(x, 0.52, this.benchZ - 0.25, 1.6, 0.45, 0.1, wood)
      for (const sx of [-0.7, 0.7]) bb.box(x + sx, 0, this.benchZ, 0.1, 0.4, 0.45, wood)
    }
    const benches = bb.build({ castShadow: true, receiveShadow: true })
    benches.name = 'benches'
    this.furniture.add(benches)

    this.setLightLevel(this.level)
    if (this.layout) this.placeSign()
  }
}
