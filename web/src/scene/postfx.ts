import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import type { Pass } from 'three/addons/postprocessing/Pass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import type { TownLayout } from './layout'

// Depth of field by scene depth. The town's depth range, as seen from the camera, stays sharp. Behind it the blur grows
// with distance and nears MAX_BLUR at the horizon; in front of it (the screen-bottom foreground) it stays gentle.
// Blur radii are 2 sigma of the Gaussian, as fractions of the screen height (the old screen-y tilt-shift used 0.038).
const MAX_BLUR = 0.024
const MAX_NEAR_BLUR = 0.005
// The blur reaches half its maximum this far past an edge of the sharp zone, as a fraction of that edge's depth.
const FAR_HALF = 0.15
const NEAR_HALF = 0.4

const BLOOM = { strength: 0.35, radius: 0.55, threshold: 1.0 }

// Most blur taps on each side of the centre pixel; small blurs take about one per pixel. The lite pipeline (software
// rasteriser) uses fewer.
const DOF_TAPS = 12
const LITE_DOF_TAPS = 4

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// Copies (resolves) the scene into the composer's buffer. With the blur on, alpha carries each pixel's circle of
// confusion (CoC): its blur radius in pixels, worked out from the depth buffer. With the blur off, alpha is 1.
const RESOLVE_FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform bool blur;
uniform vec2 focus; // view depth of the sharp zone's near and far edges
uniform vec2 maxBlur; // blur limits in pixels: in front of the zone, and far behind it
uniform vec2 clip; // camera near and far planes
varying vec2 vUv;
float coc() {
  float z = clip.x * clip.y / (clip.y - texture2D(tDepth, vUv).x * (clip.y - clip.x));
  float f = max(z - focus.y, 0.0) / (${FAR_HALF.toFixed(3)} * focus.y);
  float n = max(focus.x - z, 0.0) / (${NEAR_HALF.toFixed(3)} * focus.x);
  return max(maxBlur.y * f / (1.0 + f), maxBlur.x * n / (1.0 + n));
}
void main() {
  gl_FragColor = vec4(texture2D(tDiffuse, vUv).rgb, blur ? coc() : 1.0);
}`

// One axis of a separable Gaussian whose radius is the pixel's CoC, read from alpha. A tap only counts where its own
// CoC reaches the centre pixel, so the sharp town neither bleeds halos into the blurred background nor gets smeared by
// it. Sharp pixels take a single tap. The first pass passes the CoC on in alpha; the last writes alpha 1 (the canvas
// composites alpha).
const blurFrag = (taps: number, last: boolean): string => {
  const alpha = last ? '1.0' : 'coc'
  return /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 axis;
uniform vec2 texel;
varying vec2 vUv;
const int TAPS = ${taps};
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float coc = c.a;
  if (coc < 0.5) {
    gl_FragColor = vec4(c.rgb, ${alpha});
    return;
  }
  float n = min(float(TAPS), ceil(coc));
  float stepPx = coc / n;
  float k = -2.0 / (coc * coc); // sigma = coc / 2
  vec3 sum = c.rgb;
  float total = 1.0;
  for (int i = 1; i <= TAPS; i++) {
    if (float(i) > n) break;
    float x = float(i) * stepPx;
    vec2 o = axis * texel * x;
    vec4 a = texture2D(tDiffuse, vUv + o);
    vec4 b = texture2D(tDiffuse, vUv - o);
    float g = exp(k * x * x);
    float wa = g * clamp(a.a - x + 1.0, 0.0, 1.0);
    float wb = g * clamp(b.a - x + 1.0, 0.0, 1.0);
    sum += wa * a.rgb + wb * b.rgb;
    total += wa + wb;
  }
  gl_FragColor = vec4(sum / total, ${alpha});
}`
}

/**
 * Material options for marks drawn over everything (signs, labels, bubbles, gears, zZ). They always pass the depth test
 * but still write their depth, except for nearly clear texels, so the blur keeps them as sharp as the town they stand
 * in instead of blurring them like whatever lies behind.
 */
export const DRAWN_ON_TOP = { depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, alphaTest: 0.05 } as const

type Vec3 = { x: number; y: number; z: number }

/**
 * Nearest and farthest view depth (distance along the unit view direction `dir`) of the town's box, its bounds from the
 * ground up to `height`, seen from `eye`. Written to `out` (x = near, y = far) so it can run every frame without allocating.
 */
export function townDepthRange(eye: Vec3, dir: Vec3, b: TownLayout['bounds'], height: number, out: { x: number; y: number }): void {
  let near = Infinity
  let far = -Infinity
  for (let i = 0; i < 8; i++) {
    const d =
      ((i & 1 ? b.maxX : b.minX) - eye.x) * dir.x + ((i & 2 ? height : 0) - eye.y) * dir.y + ((i & 4 ? b.maxZ : b.minZ) - eye.z) * dir.z
    near = Math.min(near, d)
    far = Math.max(far, d)
  }
  out.x = near
  out.y = far
}

class DofBlurPass extends ShaderPass {
  /** `last`: the second axis, which ends the blur and writes alpha 1. */
  constructor(axis: THREE.Vector2, taps: number, last: boolean) {
    super(
      new THREE.ShaderMaterial({
        uniforms: { tDiffuse: { value: null }, axis: { value: axis }, texel: { value: new THREE.Vector2(1, 1) } },
        vertexShader: VERT,
        fragmentShader: blurFrag(taps, last),
      }),
    )
  }

  override setSize(width: number, height: number): void {
    this.uniforms.texel.value.set(1 / width, 1 / height)
  }
}

/** Bloom at half the stock resolution (a quarter of the pixels): same look at this strength, about 2 ms less GPU time at 4K. */
class HalfResBloomPass extends UnrealBloomPass {
  override setSize(width: number, height: number): void {
    super.setSize(width / 2, height / 2)
  }
}

/**
 * Draws the scene into a private target (MSAA unless `samples` is 0) and resolves it into the composer's plain buffer,
 * with the CoC in alpha. Every later pass (bloom blends additively into the buffer it reads) then works on single-sample
 * targets; with MSAA on the ping-pong buffers the same frame cost 2-3x as much on the GPU.
 */
class ScenePass extends ShaderPass {
  private readonly target: THREE.WebGLRenderTarget

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    samples: number,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples, depthTexture: new THREE.DepthTexture(1, 1) })
    super(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          tDepth: { value: target.depthTexture },
          blur: { value: true },
          focus: { value: new THREE.Vector2(1, 2) },
          maxBlur: { value: new THREE.Vector2() },
          clip: { value: new THREE.Vector2(1, 2) },
        },
        vertexShader: VERT,
        fragmentShader: RESOLVE_FRAG,
      }),
    )
    this.target = target
  }

  /** Off: alpha 1 and no CoC. */
  set blur(on: boolean) {
    this.uniforms.blur.value = on
  }

  /** View depth of the sharp zone's near and far edges. */
  setFocus(near: number, far: number): void {
    this.uniforms.focus.value.set(near, far)
    this.uniforms.clip.value.set(this.camera.near, this.camera.far)
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height)
    this.uniforms.maxBlur.value.set(height * MAX_NEAR_BLUR, height * MAX_BLUR)
  }

  override render(renderer: THREE.WebGLRenderer, writeBuffer: THREE.WebGLRenderTarget, ...rest: [THREE.WebGLRenderTarget, number, boolean]): void {
    renderer.setRenderTarget(this.target)
    renderer.render(this.scene, this.camera)
    super.render(renderer, writeBuffer, this.target, rest[1], rest[2]) // copies (resolves) the target into writeBuffer
  }

  override dispose(): void {
    this.target.dispose()
    super.dispose()
  }
}

export class PostFX {
  private readonly composer: EffectComposer
  private readonly scenePass: ScenePass
  private readonly dof: DofBlurPass[]
  private readonly passes: Pass[]
  private town: TownLayout['bounds'] = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }
  private townHeight = 8
  private readonly eye = new THREE.Vector3()
  private readonly dir = new THREE.Vector3()
  private readonly range = new THREE.Vector2()

  /**
   * `lite` is for software rasterisers (SwiftShader on CI), where these effects cost several times the scene itself:
   * no MSAA, no bloom, and fewer blur taps.
   */
  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    lite = false,
  ) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
    this.composer = new EffectComposer(renderer, target)

    this.scenePass = new ScenePass(scene, camera, lite ? 0 : 4)
    const taps = lite ? LITE_DOF_TAPS : DOF_TAPS
    this.dof = [new DofBlurPass(new THREE.Vector2(1, 0), taps, false), new DofBlurPass(new THREE.Vector2(0, 1), taps, true)]
    // Bloom comes after the blur, which needs the CoC that the resolve leaves in alpha; what blooms is in the sharp town.
    const bloom = lite ? [] : [new HalfResBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold)]
    const output = new OutputPass()
    this.passes = [this.scenePass, ...this.dof, ...bloom, output]
    for (const p of this.passes) this.composer.addPass(p)
  }

  /** Off removes both blur passes from the pipeline. */
  setDepthOfField(on: boolean): void {
    for (const p of this.dof) p.enabled = on
    this.scenePass.blur = on
  }

  /** The town's ground bounds and the height of its tallest building with its sign: all of it stays sharp. */
  setTownBounds(bounds: TownLayout['bounds'], height: number): void {
    this.town = bounds
    this.townHeight = height
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
  }

  render(): void {
    if (this.dof[0].enabled) {
      // The sharp zone follows the camera every frame: orbit, zoom, pitch, pan and camera editing.
      this.camera.getWorldPosition(this.eye)
      this.camera.getWorldDirection(this.dir)
      townDepthRange(this.eye, this.dir, this.town, this.townHeight, this.range)
      const near = Math.max(this.range.x, this.camera.near)
      this.scenePass.setFocus(near, Math.max(this.range.y, near))
    }
    this.composer.render()
  }

  dispose(): void {
    for (const p of this.passes) p.dispose()
    this.composer.dispose()
  }
}
