import type { Locale } from '../i18n'
import { TownApp } from '../scene/app'
import { SceneClock } from '../scene/clock'
import { installDebug } from '../debug'
import { DEFAULT_SCENE_SETTINGS, type SceneSettings, type ToSwift, type TownState } from '../types'
import { SCENARIO_NAMES, buildScenario, type ScenarioName } from './scenarios'

export interface MockParams {
  scenario: ScenarioName
  lang: Locale | null
  time: number | null // epoch ms; set = frozen scene time
  seed: number
  gui: boolean
}

/** What the mock GUI gets to drive the scene, standing in for the Swift host. */
export interface MockContext {
  app: TownApp
  params: MockParams
  state: TownState
  settings: SceneSettings
  setState(state: TownState): void
  applySettings(settings: SceneSettings): void
}

export function parseMockParams(search: string): MockParams {
  const q = new URLSearchParams(search)
  const scenario = q.get('scenario')
  const lang = q.get('lang')
  const time = q.get('time')
  const seed = Number(q.get('seed'))
  return {
    scenario: (SCENARIO_NAMES as readonly string[]).includes(scenario ?? '') ? (scenario as ScenarioName) : 'busy',
    lang: lang === 'en' || lang === 'zh-Hant' ? lang : null,
    time: time !== null && time !== '' && Number.isFinite(Number(time)) ? Number(time) : null,
    seed: q.get('seed') !== null && Number.isFinite(seed) ? seed : 1,
    gui: q.get('gui') !== '0',
  }
}

export function startMock(root: HTMLElement): void {
  const params = parseMockParams(location.search)
  const clock = new SceneClock(params.time ?? undefined)
  const scenario = buildScenario(params.scenario, clock.now(), params.seed)
  const settings: SceneSettings = {
    ...DEFAULT_SCENE_SETTINGS,
    camera: { ...DEFAULT_SCENE_SETTINGS.camera, base: { ...DEFAULT_SCENE_SETTINGS.camera.base, target: [0, 0] } },
    ...(params.lang ? { locale: params.lang } : {}),
    ...scenario.settings,
  }

  // The host has no Swift side to message; keep the saved camera so the GUI can read it back.
  const onMessage = (msg: ToSwift): void => {
    if (msg.type === 'cameraSaved') ctx.settings = { ...ctx.settings, camera: { ...ctx.settings.camera, base: msg.camera } }
  }
  const app = new TownApp({ root, clock, seed: params.seed, settings, onMessage })
  const ctx: MockContext = {
    app,
    params,
    state: scenario.state,
    settings,
    setState(state) {
      ctx.state = state
      app.update(state)
    },
    applySettings(s) {
      ctx.settings = s
      app.applySettings(s)
    },
  }

  installDebug(app)
  app.update(scenario.state)
  app.start()
  if (params.gui) void import('./gui').then((m) => m.setupGui(ctx))
}
