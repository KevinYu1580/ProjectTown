import * as THREE from 'three'
import { Hud } from '../hud/hud'
import { t } from '../i18n'
import { lightLevel, type LightInfo } from '../time/dayNight'
import type { CameraBase, ProjectTownAPI, SceneSettings, ToSwift, TownState } from '../types'
import { fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'
import { Ambient } from './ambient'
import { CameraRig } from './camera'
import { CharacterManager } from './characters/manager'
import type { SceneClock } from './clock'
import { computeLayout, type TownLayout } from './layout'
import { Lot, LOT_Y } from './lot'
import { Outskirts } from './outskirts'
import { planOutskirts } from './outskirtsPlan'
import { PAL } from './palette'
import { PostFX } from './postfx'
import { RenderLoop } from './loop'
import { Sky } from './sky'
import { isSoftwareRenderer, rendererName } from './softwareRenderer'
import { Street } from './street'
import { VoxelBuilder, disposeGeometries, material } from './voxel'

export interface TownAppOptions {
  root: HTMLElement
  clock: SceneClock
  seed: number
  settings: SceneSettings
  onMessage?: (msg: ToSwift) => void
}

const LABEL_REFRESH_MS = 30_000
// Cap on backing-store pixels: MSAA + bloom cost scales with it, and 5K/6K displays at 2x miss 60 fps.
const PIXEL_BUDGET = 8e6

/** Device pixel ratio, capped at 2 and so that w*h*ratio^2 stays within PIXEL_BUDGET. */
export function pixelRatio(dpr: number, w: number, h: number): number {
  return Math.min(dpr || 1, 2, Math.sqrt(PIXEL_BUDGET / (w * h)))
}
const HINT_CSS =
  'position:absolute;left:50%;bottom:14%;transform:translateX(-50%);z-index:4;padding:10px 18px;border-radius:12px;' +
  'background:rgba(14,18,28,0.62);border:1px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.88);' +
  'font:16px -apple-system,BlinkMacSystemFont,"PingFang TC",sans-serif;pointer-events:none;'

export class TownApp implements Omit<ProjectTownAPI, 'reload'> {
  /** Fires once, after the first frame has been rendered. */
  onFirstFrame: (() => void) | null = null
  private firstFrameDone = false

  private readonly root: HTMLElement
  private readonly clock: SceneClock
  private readonly seed: number
  private readonly post: (msg: ToSwift) => void
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly rig: CameraRig
  private readonly postfx: PostFX
  private readonly sky: Sky
  private readonly street: Street
  private readonly outskirts: Outskirts
  private readonly ambient: Ambient
  private readonly characters: CharacterManager
  private readonly hud: Hud
  private readonly loop: RenderLoop
  private readonly hint = document.createElement('div')
  private readonly lots = new Map<string, Lot>()
  private readonly lite: boolean
  private emptyPatch: THREE.Group | null = null
  private settings: SceneSettings
  private state: TownState | null = null
  private layout: TownLayout = computeLayout(0)
  private maxHeight = -1
  private light: LightInfo = { level: 1, phase: 'day' }
  private lightValid = false
  private lastLabelRefresh = 0

  constructor(opts: TownAppOptions) {
    this.root = opts.root
    this.clock = opts.clock
    this.seed = opts.seed
    this.settings = opts.settings
    this.post = opts.onMessage ?? (() => {})

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(pixelRatio(window.devicePixelRatio, window.innerWidth, window.innerHeight))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.info.autoReset = false // reset once per frame so the totals cover every post-processing pass
    this.root.appendChild(this.renderer.domElement)

    // A software rasteriser (SwiftShader on CI) cannot afford the full effect stack: no shadows, MSAA or bloom.
    const lite = isSoftwareRenderer(rendererName(this.renderer.getContext()))
    this.lite = lite
    this.sky = new Sky(this.scene, this.renderer, !lite)
    this.street = new Street(this.scene)
    this.outskirts = new Outskirts(this.scene)
    this.ambient = new Ambient(this.scene)
    this.rig = new CameraRig(window.innerWidth / window.innerHeight)
    this.postfx = new PostFX(this.renderer, this.scene, this.rig.camera, lite)
    this.characters = new CharacterManager(this.scene, { rng: createRng(this.seed), animate: !this.clock.frozen })
    this.hud = new Hud(this.root)
    // A frozen scene (dt = 0) only changes when told to, so it is drawn on demand instead of every frame.
    this.loop = new RenderLoop(this.frame, this.settings.fps, this.clock.frozen)
    this.rig.onChange = () => this.loop.invalidate()

    this.hint.style.cssText = HINT_CSS
    this.hint.setAttribute('data-testid', 'empty-hint')
    this.hint.hidden = true
    this.root.appendChild(this.hint)

    window.addEventListener('resize', this.onResize)
    this.onResize()
    this.applyLayout(computeLayout(0))
    this.applySettings(this.settings)
  }

  start(): void {
    this.loop.start()
  }

  update(state: TownState): void {
    this.state = state
    const ids = new Set(state.projects.map((p) => p.id))
    for (const [id, lot] of this.lots) {
      if (ids.has(id)) continue
      this.characters.removeLot(id)
      this.scene.remove(lot.object)
      lot.dispose()
      this.lots.delete(id)
    }
    for (const p of state.projects) {
      if (this.lots.has(p.id)) continue
      const lot = new Lot(p, createRng(fnv1a32(`${this.seed}:${p.id}`)))
      lot.setLightLevel(this.light.level)
      this.scene.add(lot.object)
      this.lots.set(p.id, lot)
    }

    const layout = computeLayout(state.projects.length)
    if (layout.count !== this.layout.count) this.applyLayout(layout)

    state.projects.forEach((p, i) => {
      const lot = this.lots.get(p.id)!
      lot.setLayout(this.layout.lots[i], this.layout)
      lot.update(p)
    })
    this.refit()
    this.syncCharacters()
    this.refreshOverlay()
    this.loop.invalidate()
  }

  applySettings(s: SceneSettings): void {
    this.settings = s
    this.loop.setFps(s.fps)
    this.postfx.setDepthOfField(s.depthOfField)
    this.rig.applySettings(s.camera)
    this.rig.setLocale(s.locale)
    this.applyLight(true)
    this.refreshOverlay()
    this.syncCharacters()
    this.loop.invalidate()
  }

  setPaused(paused: boolean): void {
    this.loop.setPaused(paused)
    this.characters.setPaused(paused)
  }

  enterCameraEdit(): void {
    if (this.rig.editing) return
    this.rig.onEditClosed = (saved) => this.finishEdit(saved)
    this.rig.enterEdit(this.renderer.domElement, this.settings.locale)
  }

  exitCameraEdit(save: boolean): void {
    if (!this.rig.editing) return
    this.finishEdit(this.rig.exitEdit(save))
  }

  setCameraPreset(index: 0 | 1 | 2 | 3): void {
    this.rig.setPreset(index)
  }

  resetCamera(): void {
    this.rig.reset()
  }

  // Debug helpers (used by debug.ts).
  getSignTexts(): Array<{ projectId: string; lines: string[] }> {
    return [...this.lots.values()].map((l) => l.signTexts())
  }

  getCharacters(): ReturnType<CharacterManager['debugPositions']> {
    return this.characters.debugPositions()
  }

  get measuredFps(): number {
    return this.loop.measuredFps
  }

  /** Draw calls and triangles of the last frame (all passes); debug only. */
  renderInfo(): { calls: number; triangles: number; geometries: number; textures: number } {
    const { render, memory } = this.renderer.info
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures }
  }

  get currentState(): TownState | null {
    return this.state
  }

  get currentSettings(): SceneSettings {
    return this.settings
  }

  /** Horizontal angle of the camera around the origin, in degrees [0, 360); debug only. */
  cameraAzimuthDeg(): number {
    const { x, z } = this.rig.camera.position
    return (((Math.atan2(x, z) * 180) / Math.PI) + 360) % 360
  }

  get cameraEditing(): boolean {
    return this.rig.editing
  }

  lightInfo(): LightInfo {
    return lightLevel(this.clock.now(), this.settings.dayNight)
  }

  /** Fixed camera centred on one lot; debug only, leaves the app settings untouched. */
  focusLot(index: number, zoom = 2.5): void {
    const p = this.layout.lots[index]
    if (!p) return
    const cam = this.settings.camera
    this.rig.applySettings({ ...cam, mode: 'fixed', base: { ...cam.base, target: [p.x, p.z], zoom } })
  }

  dispose(): void {
    this.loop.stop()
    window.removeEventListener('resize', this.onResize)
    this.rig.exitEdit(false) // drops the orbit controls, toolbar and Esc listener if an edit is open
    for (const lot of this.lots.values()) lot.dispose()
    this.lots.clear()
    this.characters.dispose()
    this.street.dispose()
    this.outskirts.dispose()
    this.ambient.dispose()
    this.sky.dispose()
    this.postfx.dispose()
    this.hud.dispose()
    this.hint.remove()
    this.renderer.dispose()
    this.renderer.forceContextLoss()
    this.renderer.domElement.remove()
  }

  private readonly frame = (dtMs: number): void => {
    const dt = this.clock.frozen ? 0 : dtMs
    const now = this.clock.now()
    this.applyLight(false)
    this.rig.update(dt)
    for (const lot of this.lots.values()) lot.tick(dt, now)
    this.characters.update(dt, now)
    this.outskirts.update(dt)
    this.ambient.update(dt)
    if (!this.clock.frozen && now - this.lastLabelRefresh >= LABEL_REFRESH_MS) {
      this.lastLabelRefresh = now
      this.syncCharacters()
    }
    this.renderer.info.reset()
    this.postfx.render()
    if (!this.firstFrameDone) {
      this.firstFrameDone = true
      this.onFirstFrame?.()
    }
  }

  private readonly onResize = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    const pr = pixelRatio(window.devicePixelRatio, w, h)
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h)
    this.postfx.setSize(w, h, pr)
    this.rig.resize(w, h)
    this.loop.invalidate()
    // Resizing clears the canvas; a paused loop will not redraw it.
    if (this.firstFrameDone && this.loop.isPaused) this.postfx.render()
  }

  private applyLayout(layout: TownLayout): void {
    this.layout = layout
    // The background neighbourhood fills the view around the town; its plan also sizes the street's base plate.
    const outskirts = planOutskirts(layout, { seed: this.seed, lite: this.lite })
    this.street.build(layout, outskirts)
    this.outskirts.build(outskirts)
    this.ambient.build(layout)
    this.maxHeight = -1
    this.refit()
    this.updateEmptyPatch()
  }

  /** Re-frame the camera and shadow volume when the layout or the tallest building changes. */
  private refit(): void {
    const tallest = Math.max(6, ...[...this.lots.values()].map((l) => l.height)) + 4
    if (tallest === this.maxHeight) return
    this.maxHeight = tallest
    this.rig.setTownBounds(this.layout.bounds, tallest)
    this.sky.setTownBounds(this.layout.bounds, tallest)
    this.postfx.setTownBounds(this.layout.bounds, tallest)
  }

  private updateEmptyPatch(): void {
    if (this.layout.count > 0) {
      if (this.emptyPatch) {
        this.scene.remove(this.emptyPatch)
        disposeGeometries(this.emptyPatch)
        this.emptyPatch = null
      }
      return
    }
    if (this.emptyPatch) return
    const size = this.layout.lotSize
    this.emptyPatch = new VoxelBuilder().box(0, 0, 0, size, LOT_Y, size, material(PAL.paving[1])).build({ receiveShadow: true })
    this.scene.add(this.emptyPatch)
  }

  private applyLight(force: boolean): void {
    const info = this.lightInfo()
    if (!force && this.lightValid && info.phase === this.light.phase && Math.abs(info.level - this.light.level) < 0.002) return
    this.light = info
    this.lightValid = true
    this.sky.apply(info)
    this.street.setLightLevel(info.level)
    this.outskirts.setLightLevel(info.level)
    this.ambient.setLightLevel(info.level)
    this.characters.setLightLevel(info.level)
    for (const lot of this.lots.values()) lot.setLightLevel(info.level)
  }

  private syncCharacters(): void {
    const labels = { show: !this.settings.hideSessionNames, locale: this.settings.locale, nowMs: this.clock.now() }
    for (const lot of this.lots.values()) {
      this.characters.syncLot(lot.id, lot.visible, lot.sleeping, lot.spots(), labels, lot.alive, lot.asleep)
    }
  }

  private refreshOverlay(): void {
    const { locale, hudVisible } = this.settings
    if (this.state) this.hud.render(this.state, { locale, visible: hudVisible })
    this.hint.hidden = !(this.state && this.state.projects.length === 0)
    this.hint.textContent = t(locale, 'empty.hint')
  }

  private finishEdit(saved: CameraBase | null): void {
    if (saved) {
      this.settings = { ...this.settings, camera: { ...this.settings.camera, base: saved } }
      this.post({ type: 'cameraSaved', camera: saved })
    }
    this.post({ type: 'cameraEditClosed' })
  }
}
