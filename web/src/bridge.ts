import type { ProjectTownAPI, ToSwift } from './types'
import type { TownApp } from './scene/app'

interface WebKitHandlers {
  messageHandlers?: { projectTown?: { postMessage(message: unknown): void } }
}

declare global {
  interface Window {
    projectTown?: ProjectTownAPI
    webkit?: WebKitHandlers
  }
}

/** True when running inside the WKWebView wallpaper window. */
export function hasWebKitHost(): boolean {
  return window.webkit?.messageHandlers?.projectTown !== undefined
}

export function postToSwift(msg: ToSwift): void {
  window.webkit?.messageHandlers?.projectTown?.postMessage(msg)
}

/** Forwards uncaught errors to the Swift log; install before anything that can throw. */
export function installErrorForwarding(): void {
  window.addEventListener('error', (e) => postToSwift({ type: 'error', message: e.message }))
  window.addEventListener('unhandledrejection', (e) => postToSwift({ type: 'error', message: String(e.reason) }))
}

/** Exposes `window.projectTown` to Swift. */
export function installBridge(app: TownApp): void {
  window.projectTown = {
    update: (state) => app.update(state),
    applySettings: (s) => app.applySettings(s),
    setPaused: (p) => app.setPaused(p),
    enterCameraEdit: () => app.enterCameraEdit(),
    exitCameraEdit: (save) => app.exitCameraEdit(save),
    setCameraPreset: (i) => app.setCameraPreset(i),
    resetCamera: () => app.resetCamera(),
    reload: () => location.reload(),
    snapshot: () => app.snapshot(),
  }
}
