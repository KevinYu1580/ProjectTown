import { describe, expect, it } from 'vitest'
import { MAX_VISIBLE_PER_BUILDING, assignSleepingWindows, assignSlots } from '../src/scene/slots'
import type { SessionInfo, SessionState } from '../src/types'

const s = (id: string, state: SessionState, lastActivityAt = 0): SessionInfo => ({ id, name: null, state, lastActivityAt })

describe('assignSlots', () => {
  it('shows everyone when there is room', () => {
    const r = assignSlots([s('a', 'running'), s('b', 'idle')])
    expect(r.visible.map((x) => x.id)).toEqual(['a', 'b'])
    expect(r.hiddenCount).toBe(0)
  })

  it('crowded: 10 non-sleeping -> 6 visible, +4', () => {
    const sessions = Array.from({ length: 10 }, (_, i) => s(`s${i}`, 'running', i))
    const r = assignSlots(sessions)
    expect(MAX_VISIBLE_PER_BUILDING).toBe(6)
    expect(r.visible).toHaveLength(6)
    expect(r.hiddenCount).toBe(4)
    expect(r.counts.running).toBe(10)
  })

  it('orders waiting > running > finished > idle', () => {
    const r = assignSlots([s('i', 'idle'), s('f', 'finished'), s('r', 'running'), s('w', 'waiting')])
    expect(r.visible.map((x) => x.id)).toEqual(['w', 'r', 'f', 'i'])
  })

  it('within a state, more recent activity first, then id', () => {
    const r = assignSlots([s('b', 'idle', 100), s('a', 'idle', 100), s('z', 'idle', 500), s('y', 'idle', 1)])
    expect(r.visible.map((x) => x.id)).toEqual(['z', 'a', 'b', 'y'])
  })

  it('priority decides who is hidden when crowded', () => {
    const sessions = [
      ...Array.from({ length: 5 }, (_, i) => s(`idle${i}`, 'idle', 1000 + i)),
      s('w', 'waiting', 1),
      s('r', 'running', 1),
    ]
    const r = assignSlots(sessions)
    expect(r.visible.map((x) => x.id).slice(0, 2)).toEqual(['w', 'r'])
    expect(r.visible).toHaveLength(6)
    expect(r.hiddenCount).toBe(1)
    // The oldest idle session is the one left out.
    expect(r.visible.some((x) => x.id === 'idle0')).toBe(false)
  })

  it('sleeping sessions never take a slot and never count towards +N', () => {
    const sessions = [...Array.from({ length: 8 }, (_, i) => s(`z${i}`, 'sleeping')), s('a', 'running')]
    const r = assignSlots(sessions)
    expect(r.visible.map((x) => x.id)).toEqual(['a'])
    expect(r.hiddenCount).toBe(0)
    expect(r.counts.sleeping).toBe(8)
  })

  it('counts every state, including hidden ones', () => {
    const sessions = [
      ...Array.from({ length: 7 }, (_, i) => s(`i${i}`, 'idle')),
      s('w', 'waiting'), s('f', 'finished'), s('z', 'sleeping'),
    ]
    const r = assignSlots(sessions)
    expect(r.counts).toEqual({ running: 0, waiting: 1, finished: 1, idle: 7, sleeping: 1 })
    expect(r.hiddenCount).toBe(3) // 9 non-sleeping, 6 drawn
  })

  it('handles an empty list and does not mutate the input', () => {
    expect(assignSlots([])).toEqual({
      visible: [], hiddenCount: 0, counts: { running: 0, waiting: 0, finished: 0, idle: 0, sleeping: 0 },
    })
    const input = [s('b', 'idle'), s('a', 'waiting')]
    assignSlots(input)
    expect(input.map((x) => x.id)).toEqual(['b', 'a'])
  })
})

describe('assignSleepingWindows', () => {
  it('gives new ids the lowest free windows in id order', () => {
    const m = assignSleepingWindows(['c', 'a', 'b'], 6, new Map())
    expect([...m]).toEqual(expect.arrayContaining([['a', 0], ['b', 1], ['c', 2]]))
    expect(m.size).toBe(3)
  })

  it('keeps previous windows for ids that are still sleeping', () => {
    const prev = new Map([['a', 3], ['b', 0]])
    const m = assignSleepingWindows(['a', 'b', 'c'], 6, prev)
    expect(m.get('a')).toBe(3)
    expect(m.get('b')).toBe(0)
    expect(m.get('c')).toBe(1)
  })

  it('drops ids that woke up and lets new ones reuse their window', () => {
    const prev = new Map([['a', 0], ['b', 1]])
    const m = assignSleepingWindows(['b', 'c'], 6, prev)
    expect(m.has('a')).toBe(false)
    expect(m.get('b')).toBe(1)
    expect(m.get('c')).toBe(0)
  })

  it('overflow gets no window', () => {
    const ids = ['a', 'b', 'c', 'd', 'e']
    const m = assignSleepingWindows(ids, 3, new Map())
    expect(m.size).toBe(3)
    expect([...m.values()].sort()).toEqual([0, 1, 2])
    expect(m.has('d')).toBe(false)
    expect(m.has('e')).toBe(false)
  })

  it('a previous window beyond the window count is not kept', () => {
    const m = assignSleepingWindows(['a'], 4, new Map([['a', 9]]))
    expect(m.get('a')).toBe(0)
  })

  it('is stable when called again with its own result', () => {
    const ids = ['x', 'y', 'z', 'w']
    const first = assignSleepingWindows(ids, 6, new Map())
    const second = assignSleepingWindows([...ids].reverse(), 6, first)
    expect(second).toEqual(first)
  })

  it('never hands one window to two ids', () => {
    const m = assignSleepingWindows(['a', 'b'], 4, new Map([['a', 2], ['b', 2]]))
    expect(new Set(m.values()).size).toBe(m.size)
    expect(m.size).toBe(2)
  })
})
