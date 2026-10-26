import type { SessionInfo, SessionState } from '../types'

export const MAX_VISIBLE_PER_BUILDING = 6

export interface SlotAssignment {
  visible: SessionInfo[]
  hiddenCount: number // non-sleeping sessions that are not drawn (the sign's "+N")
  counts: Record<SessionState, number> // all sessions
}

const PRIORITY: Record<SessionState, number> = { waiting: 0, running: 1, finished: 2, idle: 3, sleeping: 4 }

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

export function assignSlots(sessions: SessionInfo[]): SlotAssignment {
  const counts: Record<SessionState, number> = { running: 0, waiting: 0, finished: 0, idle: 0, sleeping: 0 }
  for (const s of sessions) counts[s.state]++

  const awake = sessions
    .filter((s) => s.state !== 'sleeping')
    .sort(
      (a, b) =>
        PRIORITY[a.state] - PRIORITY[b.state] || b.lastActivityAt - a.lastActivityAt || byId(a.id, b.id),
    )
  const visible = awake.slice(0, MAX_VISIBLE_PER_BUILDING)
  return { visible, hiddenCount: awake.length - visible.length, counts }
}

/**
 * Sleeping sessions show as dark windows with "zZ". Still-sleeping ids keep their previous window;
 * new ids (sorted) take the lowest free index; overflow gets no window.
 */
export function assignSleepingWindows(
  sleepingIds: string[],
  windowCount: number,
  previous: ReadonlyMap<string, number>,
): Map<string, number> {
  const ids = [...sleepingIds].sort(byId)
  const result = new Map<string, number>()
  const used = new Set<number>()

  for (const id of ids) {
    const w = previous.get(id)
    if (w !== undefined && w >= 0 && w < windowCount && !used.has(w)) {
      result.set(id, w)
      used.add(w)
    }
  }
  let next = 0
  for (const id of ids) {
    if (result.has(id)) continue
    while (next < windowCount && used.has(next)) next++
    if (next >= windowCount) break
    result.set(id, next)
    used.add(next)
  }
  return result
}
