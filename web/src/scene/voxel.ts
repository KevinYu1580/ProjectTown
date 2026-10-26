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
  }
  return m
}

/** Collects axis-aligned boxes and merges them into one mesh per material. */
export class VoxelBuilder {
  private readonly parts = new Map<THREE.Material, THREE.BufferGeometry[]>()

  /** (x, y, z) = bottom-centre of the box. */
  box(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material): this {
    const g = new THREE.BoxGeometry(w, h, d)
    g.translate(x, y + h / 2, z)
    const list = this.parts.get(mat)
    if (list) list.push(g)
    else this.parts.set(mat, [g])
    return this
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
