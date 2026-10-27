// Sky colour, fog and the light rig (hemisphere + one shadow-casting sun) driven by the day/night level.
import * as THREE from 'three'
import type { LightInfo } from '../time/dayNight'
import type { TownLayout } from './layout'
import { SKY } from './palette'

const C = (hex: number): THREE.Color => new THREE.Color(hex)

// Palette endpoints (palette.ts): level 0 (night) and level 1 (day).
const pair = ([night, day]: readonly [number, number]) => [C(night), C(day)] as const
const BG = pair(SKY.bg)
const HEMI_SKY = pair(SKY.hemiSky)
const HEMI_GROUND = pair(SKY.hemiGround)
const SUN = pair(SKY.sun)
// Warm tint mixed in around the middle of a transition.
const DUSK_SKY = C(SKY.dusk)
const DAWN_SKY = C(SKY.dawn)
// Keep the sun's green channel high: a deep orange sun turns green ground olive.
const WARM_SUN = C(SKY.warmSun)
// Transition skies pass through these so blue and orange never mix into grey: peach on the day side, mauve on the night side.
const PEACH = C(SKY.peach)
const MAUVE = C(SKY.mauve)
const WARM_FILL = C(SKY.warmFill)

// The sun always comes from the front-left of the default camera so +Z facades are lit and shadows fall right-back.
const SUN_AZIMUTH = new THREE.Vector2(-0.45, 0.55).normalize()

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k
const mix = (out: THREE.Color, pair: readonly [THREE.Color, THREE.Color], k: number): THREE.Color =>
  out.copy(pair[0]).lerp(pair[1], k)

export class Sky {
  private readonly sun = new THREE.DirectionalLight(0xffffff, 1)
  private readonly hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1)
  private readonly bg = new THREE.Color()
  private readonly fog = new THREE.Fog(0x000000, 100, 600)
  private readonly dir = new THREE.Vector3()
  private radius = 40
  private townRadius = 30

  /** `shadows` off (software rasterisers): no shadow pass and no shadow lookups in any shader. */
  constructor(private readonly scene: THREE.Scene, renderer: THREE.WebGLRenderer, shadows = true) {
    renderer.shadowMap.enabled = shadows
    // three 0.186 removed PCFSoftShadowMap; PCFShadowMap is its soft-edged replacement.
    renderer.shadowMap.type = THREE.PCFShadowMap
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.04
    this.sun.shadow.radius = 3
    scene.background = this.bg
    scene.fog = this.fog
    scene.add(this.sun, this.sun.target, this.hemi)
    this.apply({ level: 1, phase: 'day' })
  }

  setTownBounds(b: TownLayout['bounds'], maxHeight: number): void {
    this.sun.target.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2)
    this.townRadius = Math.hypot(b.maxX - b.minX, b.maxZ - b.minZ) / 2
    // Square ortho box that contains the whole town footprint plus the tallest building.
    this.radius = this.townRadius + maxHeight
    const cam = this.sun.shadow.camera
    cam.left = cam.bottom = -this.radius
    cam.right = cam.top = this.radius
    cam.near = 1
    cam.far = this.radius * 4
    cam.updateProjectionMatrix()
    // The camera sits roughly 4-9 town radii away; keep the town clear and melt the far ground into the sky.
    this.fog.near = this.townRadius * 6
    this.fog.far = this.townRadius * 24
    this.placeSun()
  }

  apply(info: LightInfo): void {
    const k = info.level
    // 0 at full night/day, 1 at the transition midpoint.
    const warm = info.phase === 'dawn' || info.phase === 'dusk' ? 1 - Math.abs(2 * k - 1) : 0
    const tint = info.phase === 'dawn' ? DAWN_SKY : DUSK_SKY

    mix(this.bg, BG, k)
      .lerp(k > 0.5 ? PEACH : MAUVE, THREE.MathUtils.smoothstep(warm, 0, 0.5) * 0.85)
      .lerp(tint, THREE.MathUtils.smoothstep(warm, 0.3, 1) * 0.9)
    this.fog.color.copy(this.bg)

    // Golden hour: warm fill and a low warm sun with long, softer shadows.
    mix(this.hemi.color, HEMI_SKY, k).lerp(WARM_FILL, warm * 0.45)
    mix(this.hemi.groundColor, HEMI_GROUND, k).lerp(tint, warm * 0.3)
    this.hemi.intensity = lerp(2.2, 1.15, k) + warm * 0.2

    mix(this.sun.color, SUN, k).lerp(WARM_SUN, warm * 0.9)
    this.sun.intensity = lerp(0.95, 2.7, k) + warm * 1.6
    this.sun.shadow.intensity = lerp(0.35, 0.72, k) - warm * 0.12

    // Moonlight stays high, the sun sinks toward the horizon in the middle of a transition.
    const elevation = THREE.MathUtils.degToRad(k > 0.5 ? lerp(26, 55, (k - 0.5) * 2) : lerp(40, 26, k * 2))
    this.dir.set(SUN_AZIMUTH.x * Math.cos(elevation), Math.sin(elevation), SUN_AZIMUTH.y * Math.cos(elevation))
    this.placeSun()
  }

  dispose(): void {
    this.scene.remove(this.sun, this.sun.target, this.hemi)
    this.scene.background = null
    this.scene.fog = null
    this.sun.dispose()
    this.hemi.dispose()
  }

  private placeSun(): void {
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.dir, this.radius * 2)
  }
}
