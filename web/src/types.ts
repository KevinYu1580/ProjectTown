// Shared contracts between the Swift host and the web scene (HANDOFF §6.3). Keep in sync with Swift Codable types.

export type SessionState = 'running' | 'waiting' | 'finished' | 'idle' | 'sleeping'

export type BuildingStyle =
  | 'office' | 'factory' | 'cafe' | 'bookstore' | 'lab'
  | 'warehouse' | 'radioTower' | 'greenhouse' | 'clockTower' | 'ramenShop'

export interface SessionInfo {
  id: string
  name: string | null
  state: SessionState
  lastActivityAt: number // epoch ms
}

export interface ProjectInfo {
  id: string
  name: string
  color: string // '#RRGGBB'
  buildingStyle: BuildingStyle
  sessions: SessionInfo[]
}

export interface TownState {
  version: 1
  generatedAt: number // epoch ms
  dataSourceOk: boolean
  projects: ProjectInfo[]
}

export interface CameraBase {
  azimuthDeg: number
  pitchDeg: number
  zoom: number
  target: [number, number] // [x, z]
}

export type DayNightSettings =
  | { mode: 'realtime'; sunrise: string; sunset: string } // 'HH:mm'
  | { mode: 'cycle'; periodMinutes: number; dayRatio: number; cycleEpoch: number }

export interface CameraSettings {
  mode: 'fixed' | 'interval' | 'continuous'
  intervalMinutes: number
  continuousPeriodMinutes: number
  base: CameraBase
}

export interface SceneSettings {
  locale: 'zh-Hant' | 'en'
  fps: 15 | 30 | 60 | 120
  hudVisible: boolean
  hideSessionNames: boolean
  depthOfField: boolean
  dayNight: DayNightSettings
  camera: CameraSettings
}

export type ToSwift =
  | { type: 'ready' }
  | { type: 'cameraSaved'; camera: CameraBase }
  | { type: 'cameraEditClosed' }
  | { type: 'error'; message: string }

export interface ProjectTownAPI {
  update(state: TownState): void
  applySettings(settings: SceneSettings): void
  setPaused(paused: boolean): void
  enterCameraEdit(): void
  exitCameraEdit(save: boolean): void
  setCameraPreset(index: 0 | 1 | 2 | 3): void
  resetCamera(): void
  reload(): void
}

// Treat the defaults as read-only; copy before mutating (target is an array).
export const DEFAULT_CAMERA_BASE: CameraBase = { azimuthDeg: 45, pitchDeg: 40, zoom: 1, target: [0, 0] }

export const DEFAULT_SCENE_SETTINGS: SceneSettings = {
  locale: 'en',
  fps: 60,
  hudVisible: true,
  hideSessionNames: true,
  depthOfField: true,
  dayNight: { mode: 'realtime', sunrise: '06:00', sunset: '18:00' },
  camera: {
    mode: 'fixed',
    intervalMinutes: 10,
    continuousPeriodMinutes: 60,
    base: { ...DEFAULT_CAMERA_BASE, target: [0, 0] },
  },
}
