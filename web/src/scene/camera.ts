import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { DEFAULT_CAMERA_BASE, type CameraBase, type CameraSettings } from '../types'
import type { Locale } from '../i18n'
import { CameraToolbar } from './cameraToolbar'
import {
  FOV_DEG, PITCH_MAX, PITCH_MIN, TARGET_HEIGHT, VIEW_SHIFT, ZOOM_MAX, ZOOM_MIN,
  cameraPosition, clampBase, fitDistance, orbitAzimuth, presetBase,
} from './cameraMath'
import type { TownLayout } from './layout'

const DEG = Math.PI / 180
const PAN_MARGIN = 0.2 // pan limit: town bounds grown by 20 % of their size on each side

const copyBase = (b: CameraBase): CameraBase => ({ ...b, target: [...b.target] })
const r3 = (v: number) => Math.round(v * 1000) / 1000
const sameBase = (a: CameraBase, b: CameraBase) =>
  Math.abs(a.azimuthDeg - b.azimuthDeg) < 1e-6 && Math.abs(a.pitchDeg - b.pitchDeg) < 1e-6 &&
  Math.abs(a.zoom - b.zoom) < 1e-6 && Math.abs(a.target[0] - b.target[0]) < 1e-6 && Math.abs(a.target[1] - b.target[1]) < 1e-6

interface EditSession {
  controls: OrbitControls
  toolbar: CameraToolbar
  dom: HTMLElement
  snapshot: CameraBase
}

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera
  onEditClosed: ((saved: CameraBase | null) => void) | null = null
  private bounds: TownLayout['bounds'] = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  private maxHeight = 8
  private settings: CameraSettings = {
    mode: 'fixed', intervalMinutes: 10, continuousPeriodMinutes: 60, base: copyBase(DEFAULT_CAMERA_BASE),
  }
  private base: CameraBase = copyBase(DEFAULT_CAMERA_BASE)
  private elapsed = 0
  private baseDistance = 50
  private edit: EditSession | null = null
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.preventDefault()
    this.close(true)
  }

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(FOV_DEG, aspect, 1, 3000)
    this.refit()
    this.applyPose(this.base.azimuthDeg)
  }

  get editing(): boolean {
    return this.edit !== null
  }

  setTownBounds(bounds: TownLayout['bounds'], maxHeight: number): void {
    this.bounds = bounds
    this.maxHeight = maxHeight
    this.refit()
  }

  /** Restarts the orbit clock only when the mode, its period or the base actually changed. */
  applySettings(cam: CameraSettings): void {
    const base = clampBase(cam.base)
    const restart =
      cam.mode !== this.settings.mode || cam.intervalMinutes !== this.settings.intervalMinutes ||
      cam.continuousPeriodMinutes !== this.settings.continuousPeriodMinutes || !sameBase(base, this.base)
    this.settings = { ...cam, base: copyBase(base) }
    this.base = base
    if (this.edit) this.edit.snapshot = copyBase(base)
    else if (restart) this.elapsed = 0
  }

  setLocale(locale: Locale): void {
    this.edit?.toolbar.setLocale(locale)
  }

  /** Orbiting only changes the azimuth and never touches `base`; editing pauses it. */
  update(dtMs: number): void {
    if (this.edit) {
      this.edit.controls.update()
      this.clampTarget(this.edit.controls)
      return
    }
    this.elapsed += dtMs
    this.applyPose(orbitAzimuth(this.base.azimuthDeg, this.settings, this.elapsed))
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height
    this.camera.setViewOffset(width, height, -width * VIEW_SHIFT.x, height * VIEW_SHIFT.y, width, height)
    this.refit()
  }

  enterEdit(dom: HTMLElement, locale: Locale): void {
    if (this.edit) return
    const controls = new OrbitControls(this.camera, dom)
    controls.screenSpacePanning = false // pan along the ground
    controls.minPolarAngle = (90 - PITCH_MAX) * DEG
    controls.maxPolarAngle = (90 - PITCH_MIN) * DEG
    const toolbar = new CameraToolbar(dom.parentElement ?? document.body, locale, {
      onPreset: (i) => this.setPreset(i),
      onReset: () => this.reset(),
      onCancel: () => this.close(false),
      onDone: () => this.close(true),
    })
    this.edit = { controls, toolbar, dom, snapshot: copyBase(this.base) }
    this.refit()
    this.poseFromBase(this.base)
    window.addEventListener('keydown', this.onKey)
  }

  /** Programmatic exit. Does not fire `onEditClosed` (that is for the toolbar / Esc). */
  exitEdit(save: boolean): CameraBase | null {
    const e = this.edit
    if (!e) return null
    const next = this.currentBase()
    e.controls.dispose()
    e.dom.style.touchAction = ''
    e.toolbar.dispose()
    window.removeEventListener('keydown', this.onKey)
    this.edit = null
    this.elapsed = 0
    this.base = save ? clampBase({ ...next, azimuthDeg: r3(((next.azimuthDeg % 360) + 360) % 360), pitchDeg: r3(next.pitchDeg), zoom: r3(next.zoom), target: [r3(next.target[0]), r3(next.target[1])] }) : e.snapshot
    this.applyPose(this.base.azimuthDeg)
    return save ? copyBase(this.base) : null
  }

  setPreset(i: 0 | 1 | 2 | 3): void {
    this.setBase(presetBase(this.currentBase(), i))
  }

  reset(): void {
    this.setBase(copyBase(DEFAULT_CAMERA_BASE))
  }

  private close(save: boolean): void {
    const saved = this.exitEdit(save)
    this.onEditClosed?.(saved)
  }

  private setBase(b: CameraBase): void {
    if (this.edit) this.poseFromBase(b)
    else {
      this.base = clampBase(b)
      this.elapsed = 0
    }
  }

  /** The base the camera is showing right now (edit mode: read back from the orbit controls). */
  private currentBase(): CameraBase {
    const c = this.edit?.controls
    if (!c) return this.base
    const off = this.camera.position.clone().sub(c.target)
    const dist = off.length()
    return {
      azimuthDeg: Math.atan2(off.x, off.z) / DEG,
      pitchDeg: Math.asin(off.y / dist) / DEG,
      zoom: this.baseDistance / dist,
      target: [c.target.x, c.target.z],
    }
  }

  private targetOf(b: CameraBase): [number, number, number] {
    return [b.target[0], this.maxHeight * TARGET_HEIGHT, b.target[1]]
  }

  private poseFromBase(b: CameraBase): void {
    const c = this.edit?.controls
    if (!c) return
    const cb = clampBase(b)
    const t = this.targetOf(cb)
    c.target.set(...t)
    this.camera.position.set(...cameraPosition(t, this.baseDistance / cb.zoom, cb.azimuthDeg, cb.pitchDeg))
    c.update()
  }

  private applyPose(azimuthDeg: number): void {
    const t = this.targetOf(this.base)
    this.camera.position.set(...cameraPosition(t, this.baseDistance / this.base.zoom, azimuthDeg, this.base.pitchDeg))
    this.camera.lookAt(...t)
  }

  /** Keeps the pan target inside the town bounds + 20 %, moving the camera with it. */
  private clampTarget(c: OrbitControls): void {
    const { minX, maxX, minZ, maxZ } = this.bounds
    const mx = (maxX - minX) * PAN_MARGIN
    const mz = (maxZ - minZ) * PAN_MARGIN
    const x = THREE.MathUtils.clamp(c.target.x, minX - mx, maxX + mx)
    const z = THREE.MathUtils.clamp(c.target.z, minZ - mz, maxZ + mz)
    this.camera.position.x += x - c.target.x
    this.camera.position.z += z - c.target.z
    c.target.x = x
    c.target.z = z
  }

  private refit(): void {
    this.baseDistance = fitDistance(this.bounds, this.maxHeight, this.camera.aspect)
    const c = this.edit?.controls
    if (c) {
      c.minDistance = this.baseDistance / ZOOM_MAX
      c.maxDistance = this.baseDistance / ZOOM_MIN
    }
  }
}
