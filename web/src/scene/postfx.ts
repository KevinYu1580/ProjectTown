import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import type { Pass } from 'three/addons/postprocessing/Pass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { CopyShader } from 'three/addons/shaders/CopyShader.js'

// Tilt-shift band, in fractions of the screen height (uv.y 0..1).
const BAND_CENTER = 0.55 // CameraRig draws the town 5 % of the height above the screen centre
const BAND_HALF = 0.2 // 2 * 0.2 = the sharp central 40 %
const BAND_FALLOFF = 0.28 // blur ramps up to its maximum over this distance; full blur 0.48 from the centre
const MAX_BLUR = 0.038 // blur radius at full blur, as a fraction of the screen height

const BLOOM = { strength: 0.35, radius: 0.55, threshold: 1.0 }

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`

// One axis of a separable Gaussian whose radius depends only on the screen y of the pixel.
// Rows inside the sharp band take a single tap, and the branch is coherent per row.
const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 axis;
uniform vec2 texel;
uniform float maxRadius;
varying vec2 vUv;
const int TAPS = 12;
void main() {
  float d = abs(vUv.y - ${BAND_CENTER.toFixed(3)});
  float k = smoothstep(0.0, 1.0, clamp((d - ${BAND_HALF.toFixed(3)}) / ${BAND_FALLOFF.toFixed(3)}, 0.0, 1.0));
  float radius = maxRadius * k;
  vec4 sum = texture2D(tDiffuse, vUv);
  if (radius < 0.5) {
    gl_FragColor = sum;
    return;
  }
  vec2 stepUv = axis * texel * (radius / float(TAPS));
  float sigma = float(TAPS) * 0.5;
  float total = 1.0;
  for (int i = 1; i <= TAPS; i++) {
    float fi = float(i);
    float w = exp(-0.5 * fi * fi / (sigma * sigma));
    sum += w * (texture2D(tDiffuse, vUv + stepUv * fi) + texture2D(tDiffuse, vUv - stepUv * fi));
    total += 2.0 * w;
  }
  gl_FragColor = sum / total;
}`

class TiltShiftPass extends ShaderPass {
  constructor(axis: THREE.Vector2) {
    super(
      new THREE.ShaderMaterial({
        uniforms: {
          tDiffuse: { value: null },
          axis: { value: axis },
          texel: { value: new THREE.Vector2(1, 1) },
          maxRadius: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
      }),
    )
  }

  override setSize(width: number, height: number): void {
    this.uniforms.texel.value.set(1 / width, 1 / height)
    this.uniforms.maxRadius.value = height * MAX_BLUR
  }
}

/** Bloom at half the stock resolution (a quarter of the pixels): same look at this strength, about 2 ms less GPU time at 4K. */
class HalfResBloomPass extends UnrealBloomPass {
  override setSize(width: number, height: number): void {
    super.setSize(width / 2, height / 2)
  }
}

/**
 * Draws the scene into a private MSAA target and resolves it into the composer's plain buffer.
 * Every later pass (bloom blends additively into the buffer it reads) then works on single-sample
 * targets; with MSAA on the ping-pong buffers the same frame cost 2-3x as much on the GPU.
 */
class SceneMsaaPass extends ShaderPass {
  private readonly target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 })

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {
    super(CopyShader)
  }

  override setSize(width: number, height: number): void {
    this.target.setSize(width, height)
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
  private readonly bloom: HalfResBloomPass
  private readonly tilt: TiltShiftPass[]
  private readonly passes: Pass[]

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })
    this.composer = new EffectComposer(renderer, target)

    const render = new SceneMsaaPass(scene, camera)
    this.bloom = new HalfResBloomPass(new THREE.Vector2(1, 1), BLOOM.strength, BLOOM.radius, BLOOM.threshold)
    this.tilt = [new TiltShiftPass(new THREE.Vector2(1, 0)), new TiltShiftPass(new THREE.Vector2(0, 1))]
    const output = new OutputPass()
    this.passes = [render, this.bloom, ...this.tilt, output]
    for (const p of this.passes) this.composer.addPass(p)
  }

  /** Off removes both tilt-shift passes from the pipeline. */
  setDepthOfField(on: boolean): void {
    for (const p of this.tilt) p.enabled = on
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio)
    this.composer.setSize(width, height)
  }

  render(): void {
    this.composer.render()
  }

  dispose(): void {
    for (const p of this.passes) p.dispose()
    this.composer.dispose()
  }
}
