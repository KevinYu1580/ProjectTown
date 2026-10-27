import * as THREE from 'three'
import { formatRelativeTime, t } from '../../i18n'
import type { SessionInfo, SessionState } from '../../types'
import { hashToIndex } from '../../util/hash'
import { MAX_VISIBLE_PER_BUILDING } from '../slots'
import { Effects, Fireworks, SleepZ } from './effects'
import { Person, PersonParts, type Route, type Target } from './person'

export interface CharacterSpots {
  desks: THREE.Vector3[]
  door: THREE.Vector3
  nearDoor: THREE.Vector3[]
  benchSeats: Array<{ pos: THREE.Vector3; yaw: number }>
  windowPositions: (i: number) => THREE.Vector3
  signTop: THREE.Vector3
  exitRoad: THREE.Vector3[]
  scale?: number // lot scale (people shrink with their lot); default 1
}

// [x, z] offsets (lot units) from the door spot for people waiting there; the extras stand slightly back.
const WAIT_SPOTS: Array<[number, number]> = [[0, 0], [-1, -0.3], [1, -0.3], [-2, -0.3], [2, -0.3], [-3, -0.3]]
const HIDDEN_TTL_MS = 600_000
const FROZEN_TIME_MS = 1500 // animation phase used when the scene is frozen

interface LotState {
  id: string
  people: Map<string, Person>
  zz: Map<string, SleepZ>
  spots: CharacterSpots
}

const sceneScale = (s: CharacterSpots): number => s.scale ?? 1

function doorInside(s: CharacterSpots): THREE.Vector3 {
  return s.door.clone().add(new THREE.Vector3(0, 0, -2 * sceneScale(s)))
}

function capacity(state: SessionState, s: CharacterSpots): number {
  switch (state) {
    case 'running': return s.desks.length
    case 'waiting': return WAIT_SPOTS.length
    case 'finished': return s.nearDoor.length
    default: return s.benchSeats.length
  }
}

function targetFor(state: SessionState, slot: number, s: CharacterSpots): Target {
  const sc = sceneScale(s)
  const ground = s.door.y
  const at = (v: THREE.Vector3): THREE.Vector3 => new THREE.Vector3(v.x, ground, v.z)
  switch (state) {
    case 'running': {
      const pos = s.desks[slot % s.desks.length].clone()
      return { pos, yaw: 0, sit: false, inside: true }
    }
    case 'waiting': {
      const pos = at(s.door)
      const [dx, dz] = WAIT_SPOTS[slot % WAIT_SPOTS.length]
      pos.x += dx * sc
      pos.z += dz * sc
      return { pos, yaw: 0, sit: false, inside: false }
    }
    case 'finished':
      return { pos: at(s.nearDoor[slot % s.nearDoor.length]), yaw: 0, sit: false, inside: false }
    default: {
      const seat = s.benchSeats[slot % s.benchSeats.length]
      const pos = at(seat.pos)
      // Scoot back against the backrest.
      pos.x += Math.sin(seat.yaw) * 0.08 * sc
      pos.z += Math.cos(seat.yaw) * 0.08 * sc
      return { pos, yaw: seat.yaw, sit: true, inside: false }
    }
  }
}

/** Route from the person's current spot to the target, through the door when crossing the storefront. */
function routeTo(p: Person, target: Target, s: CharacterSpots): Route {
  const route: Route = []
  if (target.inside !== p.inside) {
    const door = { p: s.door.clone(), inside: false }
    const inner = { p: doorInside(s), inside: true }
    route.push(...(target.inside ? [door, inner] : [inner, door]))
  }
  route.push({ p: target.pos.clone(), inside: target.inside })
  return route
}

/** Route to the nearest road, then along it toward the map edge. */
function routeOut(p: Person, s: CharacterSpots): Route {
  const route: Route = []
  if (p.inside) route.push({ p: doorInside(s), inside: true }, { p: s.door.clone(), inside: false })
  for (const v of s.exitRoad) route.push({ p: v.clone(), inside: false })
  return route
}

function spotsMoved(a: CharacterSpots, b: CharacterSpots): boolean {
  return a.door.distanceToSquared(b.door) > 1e-4 || sceneScale(a) !== sceneScale(b)
}

export class CharacterManager {
  private readonly root = new THREE.Group()
  private readonly parts = new PersonParts()
  private readonly fx = new Effects()
  private readonly fireworks: Fireworks
  private readonly lots = new Map<string, LotState>()
  private readonly persons = new Set<Person>()
  private readonly zzs = new Map<SleepZ, LotState>()
  private readonly animate: boolean
  private paused = false
  private readonly rng: () => number
  private time: number
  private level = 1
  private readonly tmpOut = new THREE.Vector3()

  constructor(
    scene: THREE.Object3D,
    opts: { rng: () => number; animate: boolean },
  ) {
    this.rng = opts.rng
    this.animate = opts.animate
    this.time = this.animate ? 0 : FROZEN_TIME_MS
    this.root.name = 'characters'
    scene.add(this.root)
    this.fireworks = new Fireworks(this.root, this.rng)
  }

  /**
   * `alive` (optional) = ids of every non-sleeping session of the lot. Without it, a person missing from
   * `visible` counts as "pushed out of the visible 6" when `visible` is full, otherwise as gone.
   * `asleep` (optional) = ids of every sleeping session, including overflow ones without a window.
   */
  syncLot(
    lotId: string,
    visible: SessionInfo[],
    sleeping: Map<string, number>,
    spots: CharacterSpots,
    labels: { show: boolean; locale: 'zh-Hant' | 'en'; nowMs: number },
    alive?: ReadonlySet<string>,
    asleep?: ReadonlySet<string>,
  ): void {
    const known = this.lots.has(lotId)
    const lot = this.lots.get(lotId) ?? { id: lotId, people: new Map<string, Person>(), zz: new Map<string, SleepZ>(), spots }
    this.lots.set(lotId, lot)
    const moved = known && spotsMoved(lot.spots, spots)
    lot.spots = spots
    const scale = sceneScale(spots)

    const visibleIds = new Set(visible.map((s) => s.id))
    const saturated = visible.length >= MAX_VISIBLE_PER_BUILDING
    for (const p of [...lot.people.values()]) {
      if (visibleIds.has(p.id)) continue
      const stillAlive = alive ? alive.has(p.id) : saturated
      if (sleeping.has(p.id) || asleep?.has(p.id)) this.retire(lot, p)
      else if (p.mode === 'hidden') {
        if (!stillAlive) this.destroy(p)
      } else if (stillAlive) this.hide(p)
      else this.leave(lot, p)
    }

    this.syncSleepers(lot, sleeping, known)

    // Keep slots stable: people who stay in the same state keep their spot.
    const taken: Record<SessionState, Set<number>> = {
      running: new Set(), waiting: new Set(), finished: new Set(), idle: new Set(), sleeping: new Set(),
    }
    const slots = new Map<string, number>()
    for (const s of visible) {
      const p = lot.people.get(s.id)
      if (p && p.mode === 'active' && p.state === s.state && p.slot < capacity(s.state, spots) && !taken[s.state].has(p.slot)) {
        taken[s.state].add(p.slot)
        slots.set(s.id, p.slot)
      }
    }
    for (const s of visible) {
      if (slots.has(s.id)) continue
      const cap = capacity(s.state, spots)
      let k = 0
      while (k < cap - 1 && taken[s.state].has(k)) k++
      taken[s.state].add(k)
      slots.set(s.id, k)
    }

    for (const s of visible) {
      const slot = slots.get(s.id)!
      const target = targetFor(s.state, slot, spots)
      let p = lot.people.get(s.id)
      if (!p) {
        p = this.spawn(lot, s, slot, target, known)
      } else if (p.mode === 'hidden') {
        p.mode = 'active'
        p.state = s.state
        p.slot = slot
        p.snapTo(target, this.time)
        p.fadeTo(1, this.animating ? 250 : 0)
      } else if (moved || !this.animating) {
        p.state = s.state
        p.slot = slot
        p.snapTo(target, this.time)
      } else if (p.state !== s.state || p.slot !== slot) {
        const entersFinished = s.state === 'finished' && p.state !== 'finished'
        p.state = s.state
        p.slot = slot
        p.goTo(target, routeTo(p, target, spots))
        if (entersFinished) this.fireworks.spawn(spots.signTop)
      }
      p.setScale(scale)
      p.setLabel(
        labels.show
          ? `${s.name ?? t(labels.locale, 'session.unnamed')}・${formatRelativeTime(labels.locale, s.lastActivityAt, labels.nowMs)}`
          : null,
      )
    }
    if (!labels.show) for (const p of this.persons) if (p.lotId === lotId) p.setLabel(null)
  }

  removeLot(lotId: string): void {
    const lot = this.lots.get(lotId)
    if (!lot) return
    for (const p of [...lot.people.values()]) {
      if (p.mode === 'hidden') this.destroy(p)
      else this.leave(lot, p)
    }
    for (const z of lot.zz.values()) this.killZ(z)
    lot.zz.clear()
    this.lots.delete(lotId)
  }

  update(dtMs: number, _nowMs: number): void {
    void _nowMs
    const dt = this.animating ? dtMs : 0
    this.time += dt
    this.fx.update(this.time)
    for (const p of this.persons) {
      p.update(dt, this.time)
      if (p.dead || (p.mode === 'hidden' && this.time - p.hiddenAt > HIDDEN_TTL_MS)) this.destroy(p)
    }
    for (const [z, lot] of this.zzs) {
      const base = lot.spots.windowPositions(z.window)
      const out = this.tmpOut.set(base.x - lot.spots.signTop.x, 0, base.z - lot.spots.signTop.z)
      if (out.lengthSq() < 1e-4) out.set(0, 0, 1)
      out.normalize()
      if (!z.update(dt, this.time, base, out, sceneScale(lot.spots))) {
        z.dispose()
        this.zzs.delete(z)
      }
    }
    this.fireworks.update(dt)
  }

  /** While paused nobody sees animations: skip them and reclaim leaving people and fading zZ at once. */
  setPaused(paused: boolean): void {
    this.paused = paused
    if (!paused) return
    for (const p of [...this.persons]) if (p.mode === 'leaving') this.destroy(p)
    for (const z of this.zzs.keys()) if (z.dying) {
      z.dispose()
      this.zzs.delete(z)
    }
  }

  setLightLevel(level: number): void {
    this.level = level
    this.fx.setLightLevel(level)
    for (const p of this.persons) p.setNight(1 - level)
  }

  dispose(): void {
    for (const p of [...this.persons]) this.destroy(p)
    for (const z of this.zzs.keys()) z.dispose()
    this.zzs.clear()
    this.lots.clear()
    this.fireworks.dispose()
    this.fx.dispose()
    this.parts.dispose()
    this.root.removeFromParent()
  }

  debugPositions(): Array<{ id: string; x: number; z: number; state: SessionState; label: string | null }> {
    const out: Array<{ id: string; x: number; z: number; state: SessionState; label: string | null }> = []
    for (const p of this.persons) {
      if (p.mode !== 'hidden') out.push({ id: p.id, x: p.pos.x, z: p.pos.z, state: p.state, label: p.labelText })
    }
    return out
  }

  private get animating(): boolean {
    return this.animate && !this.paused
  }

  private spawn(lot: LotState, s: SessionInfo, slot: number, target: Target, known: boolean): Person {
    // A leftover leaving copy of the same session would show up twice.
    for (const q of this.persons) if (q.id === s.id && q.mode === 'leaving') this.destroy(q)
    const p = new Person(s.id, lot.id, s.state, this.parts, this.fx, this.rng)
    p.slot = slot
    p.setNight(1 - this.level)
    p.setScale(sceneScale(lot.spots))
    this.root.add(p.root)
    lot.people.set(s.id, p)
    this.persons.add(p)
    if (!this.animating) {
      p.snapTo(target, this.time)
    } else if (!known) {
      p.fadeTo(0, 0)
      p.snapTo(target, this.time)
      p.fadeTo(1, 500)
    } else {
      // New session in a live town: walk in from the road in front of the door.
      p.fadeTo(0, 0)
      p.snapTo({ pos: lot.spots.exitRoad[0].clone(), yaw: 0, sit: false, inside: false }, this.time)
      p.fadeTo(1, 350)
      p.goTo(target, routeTo(p, target, lot.spots))
      if (s.state === 'finished') this.fireworks.spawn(lot.spots.signTop)
    }
    return p
  }

  private hide(p: Person): void {
    if (!this.animating) return this.destroy(p)
    p.mode = 'hidden'
    p.hiddenAt = this.time
    p.fadeTo(0, 250)
  }

  /** Sleeping session: no person is drawn, so the old one just fades where it stands. */
  private retire(lot: LotState, p: Person): void {
    lot.people.delete(p.id)
    if (!this.animating || p.mode === 'hidden') return this.destroy(p)
    p.startLeave(null)
  }

  /** Session gone: walk to the nearest road, then along it toward the map edge. */
  private leave(lot: LotState, p: Person): void {
    lot.people.delete(p.id)
    if (!this.animating) return this.destroy(p)
    p.startLeave(routeOut(p, lot.spots))
  }

  private destroy(p: Person): void {
    this.persons.delete(p)
    const lot = this.lots.get(p.lotId)
    if (lot?.people.get(p.id) === p) lot.people.delete(p.id)
    p.dispose()
  }

  private syncSleepers(lot: LotState, sleeping: Map<string, number>, known: boolean): void {
    for (const [id, z] of lot.zz) {
      if (sleeping.has(id)) continue
      lot.zz.delete(id)
      this.killZ(z)
    }
    for (const [id, win] of sleeping) {
      let z = lot.zz.get(id)
      if (!z) {
        z = new SleepZ(this.root, this.fx.zTextures, hashToIndex(`${id}:zz`, 1000) / 1000)
        if (!this.animating || !known) z.alpha = 1
        lot.zz.set(id, z)
        this.zzs.set(z, lot)
      }
      z.window = win
    }
  }

  private killZ(z: SleepZ): void {
    if (this.animating) z.dying = true
    else {
      z.dispose()
      this.zzs.delete(z)
    }
  }
}
