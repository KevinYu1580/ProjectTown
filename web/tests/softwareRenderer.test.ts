import { describe, expect, it } from 'vitest'
import { isSoftwareRenderer, rendererName } from '../src/scene/softwareRenderer'

describe('isSoftwareRenderer', () => {
  it('detects SwiftShader, llvmpipe and other CPU rasterisers', () => {
    for (const name of [
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)',
      'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      'Google SwiftShader',
      'ANGLE (Mesa, llvmpipe (LLVM 15.0.7, 256 bits), OpenGL 4.5)',
      'llvmpipe (LLVM 12.0.0, 256 bits)',
      'Mesa Software Rasterizer (softpipe)',
      'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'Apple Software Renderer',
    ]) expect(isSoftwareRenderer(name), name).toBe(true)
  })

  it('leaves real GPUs alone', () => {
    for (const name of [
      'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Pro, Unspecified Version)',
      'Apple GPU',
      'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)',
      'ANGLE (AMD, AMD Radeon Pro 5500M OpenGL Engine, OpenGL 4.1)',
      'Mali-G78',
      'Adreno (TM) 650',
    ]) expect(isSoftwareRenderer(name), name).toBe(false)
  })

  it('treats a hidden renderer string as a GPU', () => {
    expect(isSoftwareRenderer('')).toBe(false)
  })
})

describe('rendererName', () => {
  const gl = (ext: object | null) =>
    ({ getExtension: () => ext, getParameter: (p: number) => `renderer ${p}` }) as unknown as WebGLRenderingContext

  it('reads the unmasked renderer when the extension exists', () => {
    expect(rendererName(gl({ UNMASKED_RENDERER_WEBGL: 37446 }))).toBe('renderer 37446')
  })

  it('returns an empty string when the browser hides it', () => {
    expect(rendererName(gl(null))).toBe('')
  })
})
