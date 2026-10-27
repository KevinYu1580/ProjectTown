// CPU rasterisers (SwiftShader on CI, Mesa llvmpipe, Windows WARP) run this scene 10-100x slower than a GPU.
const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render|software/i

/** True when a WebGL renderer string (WEBGL_debug_renderer_info) names a software rasteriser. */
export function isSoftwareRenderer(renderer: string): boolean {
  return SOFTWARE.test(renderer)
}

/** The unmasked renderer string, or '' when the browser does not expose it. */
export function rendererName(gl: WebGLRenderingContext | WebGL2RenderingContext): string {
  const ext = gl.getExtension('WEBGL_debug_renderer_info')
  return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
}
