import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export interface MaterialOpts {
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  roughness?: number
  transparent?: boolean
  opacity?: number
}

const cache = new Map<string, THREE.MeshStandardMaterial>()
// Flat palette materials (no emissive, opaque): VoxelBuilder bakes their colour into vertices instead.
const flat = new WeakMap<THREE.Material, { color: THREE.Color; roughness: number }>()

/** Shared flat-colour material, cached by parameters. Never dispose the result. */
export function material(color: THREE.ColorRepresentation, opts: MaterialOpts = {}): THREE.MeshStandardMaterial {
  const c = new THREE.Color(color).getHex()
  const e = opts.emissive === undefined ? 0 : new THREE.Color(opts.emissive).getHex()
  const key = [c, e, opts.emissiveIntensity ?? 1, opts.roughness ?? 0.85, opts.transparent ? 1 : 0, opts.opacity ?? 1].join('|')
  let m = cache.get(key)
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: c,
      roughness: opts.roughness ?? 0.85,
      metalness: 0,
      emissive: e,
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? false,
      opacity: opts.opacity ?? 1,
      depthWrite: !opts.transparent,
    })
    cache.set(key, m)
    if (opts.emissive === undefined && !opts.transparent) flat.set(m, { color: m.color.clone(), roughness: m.roughness })
  }
  return m
}

// Wind: one uniform (seconds, wrapped) drives every swaying vertex. Frequencies are whole multiples of
// 2*pi / WIND_PERIOD so the wrap is seamless.
const WIND_PERIOD = 600
/** Shared uniform; other animated materials (water) may reference it too. */
export const WIND = { value: 0 }
const wind = WIND

export function setWindTime(seconds: number): void {
  wind.value = ((seconds % WIND_PERIOD) + WIND_PERIOD) % WIND_PERIOD
}

// Cloud shadows: soft blotches drifting over every voxel surface by day. Offset in metres (not wrapped, so they
// never jump), strength 0 at night. The noise is a small tileable texture (two fetches per pixel).
const cloudOff = { value: new THREE.Vector2() }
const cloudK = { value: 0 }
const cloudTex = { value: cloudNoiseTexture() }
export function setClouds(offsetX: number, offsetZ: number, strength: number): void {
  cloudOff.value.set(offsetX, offsetZ)
  cloudK.value = strength
}

/** 64x64 tileable value noise (one channel), smoothly interpolated by the sampler. */
function cloudNoiseTexture(): THREE.DataTexture {
  const n = 64
  const cells = 8
  const lattice = Array.from({ length: cells * cells }, (_, i) => ((Math.sin(i * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1)
  const at = (x: number, y: number): number => lattice[(y % cells) * cells + (x % cells)]
  const data = new Uint8Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells
      const fy = (y / n) * cells
      const ix = Math.floor(fx)
      const iy = Math.floor(fy)
      const ux = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix))
      const uy = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy))
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * ux
      const bottom = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * ux
      data[y * n + x] = Math.round((top + (bottom - top) * uy) * 255)
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RedFormat)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.needsUpdate = true
  return t
}

const CLOUD_GLSL = /* glsl */ `
float cloudShade(vec2 xz) {
  vec2 p = (xz + uCloudOff) * 0.0035;
  float n = texture2D(uCloudTex, p).r * 0.65 + texture2D(uCloudTex, p * 2.3 + 0.37).r * 0.35;
  return smoothstep(0.48, 0.72, n);
}`

const WIND_GLSL = /* glsl */ `
if (sway > 0.0) {
  #ifdef USE_INSTANCING
  vec4 swayW = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #else
  vec4 swayW = modelMatrix * vec4(transformed, 1.0);
  #endif
  const float W0 = 0.010471976;
  float ph = dot(swayW.xz, vec2(0.21, 0.17));
  float gust = 0.7 + 0.3 * sin(uWind * W0 * 22.0 + ph * 0.5);
  transformed.x += sway * gust * (sin(uWind * W0 * 162.0 + ph) + 0.35 * sin(uWind * W0 * 296.0 + ph * 2.3));
  transformed.z += sway * gust * 0.6 * sin(uWind * W0 * 124.0 + ph * 1.4);
}`

function windShader(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.uniforms.uWind = wind
  shader.uniforms.uCloudOff = cloudOff
  shader.uniforms.uCloudK = cloudK
  shader.uniforms.uCloudTex = cloudTex
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float sway;\nuniform float uWind;\nvarying vec2 vCloudXZ;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${WIND_GLSL}`)
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      #ifdef USE_INSTANCING
      vCloudXZ = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xz;
      #else
      vCloudXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
      #endif`,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\nuniform vec2 uCloudOff;\nuniform float uCloudK;\nuniform sampler2D uCloudTex;\nvarying vec2 vCloudXZ;\n${CLOUD_GLSL}`)
    .replace('#include <color_fragment>', '#include <color_fragment>\nif (uCloudK > 0.0) diffuseColor.rgb *= 1.0 - uCloudK * cloudShade(vCloudXZ);')
}

/** Vertex-coloured standard material with wind sway; geometry needs `color` and `sway` attributes. */
export function makeVoxelMaterial(roughness = 0.85): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 })
  m.onBeforeCompile = windShader
  return m
}

const voxelMats = new Map<number, THREE.MeshStandardMaterial>()
/** Shared vertex-colour material per roughness. Never dispose the result. */
function voxelMaterial(roughness: number): THREE.MeshStandardMaterial {
  let m = voxelMats.get(roughness)
  if (!m) {
    m = makeVoxelMaterial(roughness)
    voxelMats.set(roughness, m)
  }
  return m
}

/** Adds `color` (linear) and `sway` (= k * metres above `base`) attributes to a non-coloured geometry. */
export function paint(g: THREE.BufferGeometry, color: THREE.Color, k = 0, base = 0): THREE.BufferGeometry {
  const pos = g.getAttribute('position')
  const n = pos.count
  const col = new Float32Array(n * 3)
  const sw = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    col[i * 3] = color.r
    col[i * 3 + 1] = color.g
    col[i * 3 + 2] = color.b
    sw[i] = k > 0 ? k * Math.max(0, pos.getY(i) - base) : 0
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.setAttribute('sway', new THREE.BufferAttribute(sw, 1))
  return g
}

/**
 * Collects axis-aligned boxes and merges them into as few meshes as possible: palette colours (see `material`)
 * become vertex colours of one mesh per roughness; other materials get one mesh each.
 */
export class VoxelBuilder {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>()
  private readonly tmp = new THREE.Color()

  /** `paletteMat` replaces the shared vertex-colour material (e.g. one the caller tints at night). */
  constructor(private readonly paletteMat?: THREE.Material) {}

  /**
   * (x, y, z) = bottom-centre of the box. `sway` (palette colours only) lets the box bend in the wind:
   * displacement = sway * metres above `swayBase` (default: the box bottom).
   */
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material, sway = 0, swayBase = y): this {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y + h / 2, z)
    const f = flat.get(mat)
    if (f) {
      g.deleteAttribute('uv')
      paint(g, this.tmp.copy(f.color), sway, swayBase)
      return this.add(this.paletteMat ?? voxelMaterial(f.roughness), g)
    }
    return this.add(mat, g)
  }

  build(opts: { castShadow?: boolean; receiveShadow?: boolean } = {}): THREE.Group {
    const group = new THREE.Group()
    for (const [mat, geos] of this.parts) {
      const merged = mergeGeometries(geos, false)
      for (const g of geos) g.dispose()
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, mat)
      mesh.castShadow = opts.castShadow ?? false
      mesh.receiveShadow = opts.receiveShadow ?? false
      group.add(mesh)
    }
    this.parts.clear()
    return group
  }

  private add(mat: THREE.Material, g: THREE.BufferGeometry): this {
    const list = this.parts.get(mat)
    if (list) list.push(g)
    else this.parts.set(mat, [g])
    return this
  }
}

/** Single box whose bottom sits at y = 0. */
export function boxMesh(w: number, h: number, d: number, mat: THREE.Material): THREE.Mesh {
  const g = new THREE.BoxGeometry(w, h, d)
  g.translate(0, h / 2, 0)
  return new THREE.Mesh(g, mat)
}

/** Disposes geometries under `obj` (materials are shared or owned elsewhere). */
export function disposeGeometries(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) o.geometry.dispose()
  })
}
