import * as THREE from 'three'
import type { WindowState } from './types'

type Facing = 'x+' | 'x-' | 'z+' | 'z-'

const CAPACITY = 96
const THICKNESS = 0.1

// Unlit instanced quads: one draw call per building, per-window colour. HDR values (> 1) feed the bloom.
const NIGHT_OFF = new THREE.Color(0x0d1420)
const DAY_OFF = new THREE.Color(0x587590)
const WARM = new THREE.Color(0xffcf7a)
// Lit windows vary a little (lamp shades, curtains): a fixed tint per window index, so the facade never looks flat.
const TINTS = [new THREE.Color(1, 1, 1), new THREE.Color(1.04, 0.95, 0.84), new THREE.Color(0.94, 0.95, 1.0), new THREE.Color(1.06, 1.02, 0.94)]
const tintOf = (i: number): THREE.Color => TINTS[(i * 7 + (i >> 2)) % TINTS.length]

const NORMALS: Record<Facing, [number, number, number]> = { 'z+': [0, 0, 1], 'z-': [0, 0, -1], 'x+': [1, 0, 0], 'x-': [-1, 0, 0] }
const YAWS: Record<Facing, number> = { 'z+': 0, 'z-': Math.PI, 'x+': Math.PI / 2, 'x-': -Math.PI / 2 }

/** Shared window helper. `add` takes the window centre on the wall surface. */
export class WindowSet {
  readonly object = new THREE.Group()
  private readonly mesh: THREE.InstancedMesh
  private readonly states: WindowState[] = []
  private readonly positions: THREE.Vector3[] = []
  private lit = true
  private level = 1
  private flicker = false
  private time = 0
  private readonly tmp = new THREE.Color()

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), CAPACITY)
    this.mesh.count = 0
    this.mesh.frustumCulled = false // instances are added after construction; skip stale bounds
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 3), 3)
    this.object.add(this.mesh)
  }

  get count(): number {
    return this.states.length
  }

  add(x: number, y: number, z: number, w: number, h: number, facing: Facing): number {
    const i = this.states.length
    if (i >= CAPACITY) throw new Error('WindowSet: too many windows')
    const [nx, ny, nz] = NORMALS[facing]
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x + nx * THICKNESS * 0.4, y, z + nz * THICKNESS * 0.4),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), YAWS[facing]),
      new THREE.Vector3(w, h, THICKNESS),
    )
    this.mesh.setMatrixAt(i, m)
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.count = i + 1
    this.positions.push(new THREE.Vector3(x + nx * THICKNESS, y + ny * THICKNESS, z + nz * THICKNESS))
    this.states.push('lit')
    this.refresh()
    return i
  }

  position(i: number): THREE.Vector3 {
    return this.positions[i].clone()
  }

  setState(i: number, s: WindowState): void {
    if (this.states[i] === s) return
    this.states[i] = s
    this.refresh()
  }

  setLit(on: boolean): void {
    this.lit = on
    this.refresh()
  }

  setLightLevel(level: number): void {
    this.level = level
    this.refresh()
  }

  setFlicker(on: boolean): void {
    this.flicker = on
    this.refresh()
  }

  update(dtMs: number): void {
    this.time += dtMs
    if (this.flicker) this.refresh()
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }

  private refresh(): void {
    const off = this.tmp.copy(NIGHT_OFF).lerp(DAY_OFF, this.level)
    const sleep = off.clone().multiplyScalar(0.6)
    const litDay = DAY_OFF.clone().lerp(WARM, 0.3)
    const litBase = WARM.clone().multiplyScalar(2.2).lerp(litDay, this.level)
    const c = new THREE.Color()
    for (let i = 0; i < this.states.length; i++) {
      const s = this.states[i]
      if (s === 'lit' && this.lit) {
        c.copy(litBase).multiply(tintOf(i))
        if (this.flicker) c.multiplyScalar(1 + 0.1 * Math.sin(this.time * 0.004 + i * 1.7) + 0.05 * Math.sin(this.time * 0.013 + i * 3.1))
      } else if (s === 'sleep') c.copy(sleep)
      else c.copy(off)
      this.mesh.setColorAt(i, c)
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}
