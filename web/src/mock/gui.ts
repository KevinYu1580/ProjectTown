import GUI from 'lil-gui'
import { BUILDING_STYLES } from '../util/hash'
import type { ProjectInfo, SceneSettings, SessionState, TownState } from '../types'
import type { MockContext } from './mockHost'
import { SCENARIO_NAMES, buildScenario, type ScenarioName } from './scenarios'

const STATES: SessionState[] = ['running', 'waiting', 'finished', 'idle', 'sleeping']
const COLORS = ['#e4572e', '#2e86ab', '#f2a541', '#6a4c93', '#3bb273', '#e0457b', '#17bebb', '#5c7aea']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))
const pad = (n: number): string => String(n).padStart(2, '0')
const clone = <T>(v: T): T => structuredClone(v)

/** Flat view of SceneSettings, so lil-gui can bind to it. */
interface Model {
  scenario: ScenarioName
  paused: boolean
  locale: SceneSettings['locale']
  fps: SceneSettings['fps']
  hudVisible: boolean
  hideSessionNames: boolean
  theme: SceneSettings['theme']
  depthOfField: boolean
  depthOfFieldStrength: number
  depthOfFieldRange: number
  dayMode: 'realtime' | 'cycle'
  sunrise: string
  sunset: string
  periodMinutes: number
  dayPercent: number
  cameraMode: SceneSettings['camera']['mode']
  intervalMinutes: number
  continuousPeriodMinutes: number
  azimuthDeg: number
  pitchDeg: number
  zoom: number
  targetX: number
  targetZ: number
  overrideTime: boolean
  hour: number
  readout: string
}

export function setupGui(ctx: MockContext): void {
  const { app } = ctx
  // Scene time override: patch the clock instance (TownApp keeps it private) without touching clock.ts.
  const clock = (app as unknown as { clock: { now(): number } }).clock
  const realNow = clock.now.bind(clock)
  let overrideMs: number | null = null
  clock.now = () => overrideMs ?? realNow()

  let state: TownState = clone(ctx.state)
  let serial = 0
  const closed = new Set<string>()

  const dn = ctx.settings.dayNight
  const cam = ctx.settings.camera
  const m: Model = {
    scenario: ctx.params.scenario,
    paused: false,
    locale: ctx.settings.locale,
    fps: ctx.settings.fps,
    hudVisible: ctx.settings.hudVisible,
    hideSessionNames: ctx.settings.hideSessionNames,
    theme: ctx.settings.theme,
    depthOfField: ctx.settings.depthOfField,
    depthOfFieldStrength: ctx.settings.depthOfFieldStrength,
    depthOfFieldRange: ctx.settings.depthOfFieldRange,
    dayMode: dn.mode,
    sunrise: dn.mode === 'realtime' ? dn.sunrise : '06:00',
    sunset: dn.mode === 'realtime' ? dn.sunset : '18:00',
    periodMinutes: dn.mode === 'cycle' ? dn.periodMinutes : 60,
    dayPercent: Math.round((dn.mode === 'cycle' ? dn.dayRatio : 0.5) * 100),
    cameraMode: cam.mode,
    intervalMinutes: cam.intervalMinutes,
    continuousPeriodMinutes: cam.continuousPeriodMinutes,
    azimuthDeg: cam.base.azimuthDeg,
    pitchDeg: cam.base.pitchDeg,
    zoom: cam.base.zoom,
    targetX: cam.base.target[0],
    targetZ: cam.base.target[1],
    overrideTime: false,
    hour: 12,
    readout: '',
  }
  let cycleEpoch = dn.mode === 'cycle' ? dn.cycleEpoch : realNow()

  const settingsFromModel = (): SceneSettings => ({
    locale: m.locale,
    fps: m.fps,
    hudVisible: m.hudVisible,
    hideSessionNames: m.hideSessionNames,
    theme: m.theme,
    depthOfField: m.depthOfField,
    depthOfFieldStrength: m.depthOfFieldStrength,
    depthOfFieldRange: m.depthOfFieldRange,
    dayNight:
      m.dayMode === 'realtime'
        ? { mode: 'realtime', sunrise: m.sunrise, sunset: m.sunset }
        : { mode: 'cycle', periodMinutes: m.periodMinutes, dayRatio: m.dayPercent / 100, cycleEpoch },
    camera: {
      mode: m.cameraMode,
      intervalMinutes: m.intervalMinutes,
      continuousPeriodMinutes: m.continuousPeriodMinutes,
      base: { azimuthDeg: m.azimuthDeg, pitchDeg: m.pitchDeg, zoom: m.zoom, target: [m.targetX, m.targetZ] },
    },
  })
  const push = (): void => {
    applyTime()
    ctx.applySettings(settingsFromModel())
  }
  const pushState = (): void => ctx.setState(clone(state))

  // Slider position (hours) -> scene time: local time of day in realtime mode, share of the period in cycle mode.
  function applyTime(): void {
    if (!m.overrideTime) {
      overrideMs = null
      return
    }
    if (m.dayMode === 'realtime') {
      const d = new Date(realNow())
      d.setHours(0, 0, 0, 0)
      overrideMs = d.getTime() + m.hour * 3_600_000
    } else {
      overrideMs = cycleEpoch + (m.hour / 24) * m.periodMinutes * 60_000
    }
  }

  const gui = new GUI({ title: 'ProjectTown mock' })
  gui.domElement.setAttribute('data-testid', 'mock-gui')

  // Scenario / host
  const host = gui.addFolder('Scenario')
  host
    .add(m, 'scenario', [...SCENARIO_NAMES])
    .name('scenario')
    .onChange((name: ScenarioName) => {
      const sc = buildScenario(name, realNow(), ctx.params.seed)
      state = clone(sc.state)
      if (sc.settings.hideSessionNames !== undefined) {
        m.hideSessionNames = sc.settings.hideSessionNames
        gui.controllersRecursive().forEach((c) => c.updateDisplay())
        ctx.applySettings(settingsFromModel())
      }
      pushState()
      buildProjects()
    })
  host.add(m, 'paused').name('paused (setPaused)').onChange((v: boolean) => app.setPaused(v))

  // Time
  const time = gui.addFolder('Time of day')
  time.add(m, 'overrideTime').name('override scene time').onChange(push)
  time.add(m, 'hour', 0, 24, 0.01).name('time (h)').onChange(() => m.overrideTime && push())
  time.add(m, 'readout').name('now').disable().listen()

  // Day / night
  const day = gui.addFolder('Day / night')
  day.add(m, 'dayMode', ['realtime', 'cycle']).name('mode').onChange(() => {
    if (m.dayMode === 'cycle') cycleEpoch = realNow()
    showDayControls()
    push()
  })
  const good = { sunrise: m.sunrise, sunset: m.sunset }
  const hhmm = (key: 'sunrise' | 'sunset') =>
    day.add(m, key).onFinishChange((v: string) => {
      // Reject bad input and sunset <= sunrise.
      if (!HHMM.test(v) || toMin(m.sunset) <= toMin(m.sunrise)) {
        m[key] = good[key]
        sunriseCtl.updateDisplay()
        sunsetCtl.updateDisplay()
        return
      }
      good[key] = v
      push()
    })
  const sunriseCtl = hhmm('sunrise')
  const sunsetCtl = hhmm('sunset')
  const periodCtl = day.add(m, 'periodMinutes', 5, 1440, 1).name('period (min)').onChange(push)
  const ratioCtl = day.add(m, 'dayPercent', 10, 90, 1).name('day ratio (%)').onChange(push)
  function showDayControls(): void {
    const rt = m.dayMode === 'realtime'
    sunriseCtl.show(rt)
    sunsetCtl.show(rt)
    periodCtl.show(!rt)
    ratioCtl.show(!rt)
  }
  showDayControls()

  // Scene settings
  const scene = gui.addFolder('Settings')
  scene.add(m, 'locale', ['en', 'zh-Hant']).name('language').onChange(push)
  scene.add(m, 'fps', [15, 30, 60, 120]).name('FPS').onChange(push)
  scene.add(m, 'hudVisible').name('HUD').onChange(push)
  scene.add(m, 'hideSessionNames').name('hide session names').onChange(push)
  scene.add(m, 'theme', ['pastoral', 'urban']).name('theme').onChange(push)
  scene.add(m, 'depthOfField').name('depth of field').onChange(push)
  scene.add(m, 'depthOfFieldStrength', 0.25, 2, 0.05).name('blur strength').onChange(push)
  scene.add(m, 'depthOfFieldRange', 0, 0.45, 0.05).name('blur range').onChange(push)

  // Camera
  const camera = gui.addFolder('Camera')
  camera.add(m, 'cameraMode', ['fixed', 'interval', 'continuous']).name('mode').onChange(() => {
    showCameraControls()
    push()
  })
  const intervalCtl = camera.add(m, 'intervalMinutes', 1, 60, 1).name('interval (min)').onChange(push)
  const periodCamCtl = camera.add(m, 'continuousPeriodMinutes', 2, 60, 1).name('orbit period (min)').onChange(push)
  function showCameraControls(): void {
    intervalCtl.show(m.cameraMode === 'interval')
    periodCamCtl.show(m.cameraMode === 'continuous')
  }
  showCameraControls()
  camera.add(m, 'azimuthDeg', 0, 360, 1).name('base azimuth').onChange(push)
  camera.add(m, 'pitchDeg', 20, 70, 1).name('base pitch').onChange(push)
  camera.add(m, 'zoom', 0.5, 3, 0.05).name('base zoom').onChange(push)
  camera.add(m, 'targetX', -60, 60, 0.5).name('base target x').onChange(push)
  camera.add(m, 'targetZ', -60, 60, 0.5).name('base target z').onChange(push)

  // Camera edit mode
  const edit = gui.addFolder('Camera edit')
  edit.add({ go: () => app.enterCameraEdit() }, 'go').name('enter edit mode')
  edit.add({ go: () => app.exitCameraEdit(true) }, 'go').name('exit (save)')
  edit.add({ go: () => app.exitCameraEdit(false) }, 'go').name('exit (cancel)')
  ;([0, 1, 2, 3] as const).forEach((i) => edit.add({ go: () => app.setCameraPreset(i) }, 'go').name(`preset ${i + 1} (${45 + i * 90}°)`))
  edit.add({ go: () => app.resetCamera() }, 'go').name('reset camera')

  // Projects and sessions
  const projectsRoot = gui.addFolder('Projects')
  projectsRoot.add({ go: addProject }, 'go').name('+ add project')
  let projectFolders: GUI[] = []

  function folder(parent: GUI, key: string, title: string, open: boolean): GUI {
    const f = parent.addFolder(title)
    if (open && !closed.has(key)) f.open()
    else f.close()
    f.onOpenClose((g) => {
      if (g._closed) closed.add(key)
      else closed.delete(key)
    })
    return f
  }

  function buildProjects(): void {
    projectFolders.forEach((f) => f.destroy())
    projectFolders = state.projects.map((p) => buildProject(p))
  }

  function buildProject(p: ProjectInfo): GUI {
    const f = folder(projectsRoot, p.id, p.name, false)
    f.add(p, 'name').onFinishChange((v: string) => {
      f.title(v)
      pushState()
    })
    f.addColor(p, 'color').onChange(pushState)
    f.add(p, 'buildingStyle', [...BUILDING_STYLES]).name('style').onChange(pushState)
    f.add({ go: () => addSession(p) }, 'go').name('+ add session')
    f.add({ go: () => removeProject(p) }, 'go').name('remove project')
    p.sessions.forEach((s, i) => {
      const sf = folder(f, s.id, `${i + 1}. ${s.name ?? '(unnamed)'}`, true)
      sf.add(s, 'state', STATES).onChange(() => {
        s.lastActivityAt = clock.now()
        pushState()
      })
      sf.add({ go: () => removeSession(p, s.id) }, 'go').name('remove session')
    })
    return f
  }

  function addProject(): void {
    const n = ++serial
    state.projects.push({
      id: `g-p${n}`,
      name: `new-project-${n}`,
      color: COLORS[n % COLORS.length],
      buildingStyle: BUILDING_STYLES[n % BUILDING_STYLES.length],
      sessions: [],
    })
    pushState()
    buildProjects()
  }
  function removeProject(p: ProjectInfo): void {
    state.projects = state.projects.filter((x) => x !== p)
    pushState()
    buildProjects()
  }
  function addSession(p: ProjectInfo): void {
    const n = ++serial
    p.sessions.push({ id: `g-s${n}`, name: `Session ${n}`, state: 'running', lastActivityAt: clock.now() })
    pushState()
    buildProjects()
  }
  function removeSession(p: ProjectInfo, id: string): void {
    p.sessions = p.sessions.filter((s) => s.id !== id)
    pushState()
    buildProjects()
  }

  buildProjects()
  gui.folders.forEach((f) => f.close())

  // Keep the readout live, and pick up a base saved from the in-scene toolbar (Done button).
  const sync = (): void => {
    const info = app.lightInfo()
    const d = new Date(clock.now())
    m.readout = `${pad(d.getHours())}:${pad(d.getMinutes())} ${info.phase} ${info.level.toFixed(2)}`
    const b = ctx.settings.camera.base
    if (b.azimuthDeg !== m.azimuthDeg || b.pitchDeg !== m.pitchDeg || b.zoom !== m.zoom || b.target[0] !== m.targetX || b.target[1] !== m.targetZ) {
      m.azimuthDeg = b.azimuthDeg
      m.pitchDeg = b.pitchDeg
      m.zoom = b.zoom
      m.targetX = b.target[0]
      m.targetZ = b.target[1]
      camera.controllers.forEach((c) => c.updateDisplay())
    }
  }
  window.setInterval(sync, 500)
  sync()
}
