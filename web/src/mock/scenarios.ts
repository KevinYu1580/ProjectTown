import type { BuildingStyle, ProjectInfo, SceneSettings, SessionInfo, SessionState, TownState } from '../types'
import { BUILDING_STYLES, fnv1a32 } from '../util/hash'
import { createRng } from '../util/prng'

export const SCENARIO_NAMES = ['empty', 'single', 'busy', 'crowded', 'many', 'unnamed', 'gallery', 'nodata'] as const
export type ScenarioName = (typeof SCENARIO_NAMES)[number]

export interface Scenario {
  state: TownState
  /** Settings the scenario needs (e.g. `unnamed` shows session names). */
  settings: Partial<SceneSettings>
}

const PROJECT_NAMES = [
  'ProjectTown', 'api-server', 'blog', 'dotfiles', 'mobile-app', 'data-pipeline', 'design-system', 'ml-lab',
  'infra', 'docs-site', 'game-jam', 'billing', 'cli-tools', 'dashboard', 'search', 'notes',
]
const SESSION_NAMES = [
  'Issue #43 backend', 'Fix login redirect', 'Refactor parser', 'Add dark mode', 'Write unit tests',
  '修正登入流程', 'Migrate database', 'Review PR #12', 'Update README', '效能調校',
]
const COLORS = [
  '#e4572e', '#2e86ab', '#f2a541', '#6a4c93', '#3bb273', '#e0457b',
  '#17bebb', '#a0522d', '#5c7aea', '#8cb369', '#d1495b', '#00798c',
]
const ALL_STATES: SessionState[] = ['running', 'waiting', 'finished', 'idle', 'sleeping']

// Session states per project for the hand-written scenarios.
const RECIPES: SessionState[][] = [
  ['running', 'running', 'waiting'],
  ['running', 'finished', 'idle'],
  ['sleeping', 'sleeping', 'sleeping', 'idle'],
  ['waiting', 'running', 'finished', 'idle', 'sleeping'],
  [],
  ['idle', 'idle', 'sleeping'],
]

const MIN = 60_000
// How long ago the last activity was, per state: [min, max] minutes.
const AGE: Record<SessionState, [number, number]> = {
  running: [0, 2], waiting: [1, 10], finished: [1, 3], idle: [10, 120], sleeping: [180, 2880],
}

export function buildScenario(name: ScenarioName, nowMs: number, seed: number): Scenario {
  const rng = createRng(seed)
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rng() * list.length)]
  let named = true

  const session = (state: SessionState): SessionInfo => {
    const [lo, hi] = AGE[state]
    const id = `s-${Math.floor(rng() * 0xffffffff).toString(16).padStart(8, '0')}`
    return { id, name: named ? pick(SESSION_NAMES) : null, state, lastActivityAt: nowMs - Math.round((lo + rng() * (hi - lo)) * MIN) }
  }

  const styleOffset = Math.floor(rng() * BUILDING_STYLES.length)
  const project = (i: number, states: SessionState[], style?: BuildingStyle): ProjectInfo => {
    const base = PROJECT_NAMES[i % PROJECT_NAMES.length]
    const projectName = style ?? (i < PROJECT_NAMES.length ? base : `${base}-${Math.floor(i / PROJECT_NAMES.length) + 1}`)
    return {
      id: `p-${fnv1a32(`${projectName}:${i}`).toString(16).padStart(8, '0')}`,
      name: projectName,
      color: COLORS[i % COLORS.length],
      // Stride 3 is coprime with 10, so up to ten neighbours get distinct styles.
      buildingStyle: style ?? BUILDING_STYLES[(styleOffset + i * 3) % BUILDING_STYLES.length],
      sessions: states.map(session),
    }
  }

  const settings: Partial<SceneSettings> = {}
  let projects: ProjectInfo[] = []
  let dataSourceOk = true

  switch (name) {
    case 'empty':
      break
    case 'single':
      projects = [project(0, ALL_STATES)]
      break
    case 'busy':
      projects = RECIPES.map((r, i) => project(i, r))
      break
    case 'crowded':
      projects = [project(0, [...rep('running', 3), ...rep('waiting', 2), ...rep('finished', 2), ...rep('idle', 3)])]
      break
    case 'many':
      projects = Array.from({ length: 25 }, (_, i) => project(i, Array.from({ length: Math.floor(rng() * 4) }, () => pick(ALL_STATES))))
      break
    case 'unnamed':
      named = false
      settings.hideSessionNames = false
      projects = [0, 1, 3].map((r, i) => project(i, RECIPES[r]))
      break
    case 'gallery':
      projects = BUILDING_STYLES.map((style, i) => project(i, RECIPES[i % RECIPES.length], style))
      break
    case 'nodata':
      dataSourceOk = false
      projects = [project(0, []), project(1, [])]
      break
  }

  return { state: { version: 1, generatedAt: nowMs, dataSourceOk, projects }, settings }
}

function rep(state: SessionState, n: number): SessionState[] {
  return Array.from({ length: n }, () => state)
}
