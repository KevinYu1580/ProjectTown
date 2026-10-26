import type { LightInfo } from './time/dayNight'
import type { SceneSettings, TownState } from './types'
import type { TownApp } from './scene/app'

export interface ProjectTownDebug {
  ready: boolean
  getSignTexts(): Array<{ projectId: string; lines: string[] }>
  getCharacters(): ReturnType<TownApp['getCharacters']>
  measuredFps(): number
  renderInfo(): ReturnType<TownApp['renderInfo']>
  lightInfo(): LightInfo
  focusLot(index: number, zoom?: number): void
  setPaused(paused: boolean): void
  cameraAzimuthDeg(): number
  cameraEditing(): boolean
  enterCameraEdit(): void
  exitCameraEdit(save: boolean): void
  setCameraPreset(index: 0 | 1 | 2 | 3): void
  resetCamera(): void
  getState(): TownState | null
  getSettings(): SceneSettings
  setState(state: TownState): void
  applySettings(s: SceneSettings): void
}

declare global {
  interface Window {
    __projectTownDebug?: ProjectTownDebug
  }
}

/** Mock mode only: the hook used by e2e tests and screenshot scripts. */
export function installDebug(app: TownApp): ProjectTownDebug {
  const debug: ProjectTownDebug = {
    ready: false,
    getSignTexts: () => app.getSignTexts(),
    getCharacters: () => app.getCharacters(),
    measuredFps: () => app.measuredFps,
    renderInfo: () => app.renderInfo(),
    lightInfo: () => app.lightInfo(),
    focusLot: (index, zoom) => app.focusLot(index, zoom),
    setPaused: (paused) => app.setPaused(paused),
    cameraAzimuthDeg: () => app.cameraAzimuthDeg(),
    cameraEditing: () => app.cameraEditing,
    enterCameraEdit: () => app.enterCameraEdit(),
    exitCameraEdit: (save) => app.exitCameraEdit(save),
    setCameraPreset: (index) => app.setCameraPreset(index),
    resetCamera: () => app.resetCamera(),
    getState: () => app.currentState,
    getSettings: () => app.currentSettings,
    setState: (state) => app.update(state),
    applySettings: (s) => app.applySettings(s),
  }
  app.onFirstFrame = () => {
    debug.ready = true
  }
  window.__projectTownDebug = debug
  return debug
}
