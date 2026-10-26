import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FrameThrottle, RenderLoop } from '../src/scene/loop'
import { createRng } from '../src/util/prng'

/** Feeds ticks every `hz`-period for `durationMs` and returns the rendered flags. */
function run(throttle: FrameThrottle, hz: number, durationMs: number, startMs = 0): boolean[] {
  const out: boolean[] = []
  const dt = 1000 / hz
  for (let t = startMs; t < startMs + durationMs; t += dt) out.push(throttle.tick(t))
  return out
}
const count = (flags: boolean[]) => flags.filter(Boolean).length

describe('FrameThrottle', () => {
  it('renders the first tick', () => {
    expect(new FrameThrottle(30).tick(12345)).toBe(true)
  })

  it('120 Hz display @ 60 fps -> every 2nd tick', () => {
    const flags = run(new FrameThrottle(60), 120, 2000)
    flags.forEach((f, i) => expect(f).toBe(i % 2 === 0))
  })

  it('60 Hz @ 30 fps -> every 2nd tick', () => {
    const flags = run(new FrameThrottle(30), 60, 2000)
    flags.forEach((f, i) => expect(f).toBe(i % 2 === 0))
  })

  it('60 Hz @ 15 fps -> every 4th tick', () => {
    const flags = run(new FrameThrottle(15), 60, 4000)
    flags.forEach((f, i) => expect(f).toBe(i % 4 === 0))
  })

  it('60 Hz @ 60 fps and @ 120 fps -> every tick', () => {
    expect(run(new FrameThrottle(60), 60, 2000).every(Boolean)).toBe(true)
    expect(run(new FrameThrottle(120), 60, 2000).every(Boolean)).toBe(true)
  })

  it('144 Hz @ 60 fps -> 60 +/- 1 renders per second, in every second', () => {
    const flags = run(new FrameThrottle(60), 144, 10_000)
    const perSecond = Array.from({ length: 10 }, (_, s) => count(flags.slice(Math.round(s * 144), Math.round((s + 1) * 144))))
    for (const c of perSecond) expect(Math.abs(c - 60)).toBeLessThanOrEqual(1)
  })

  it('stays on target with jittered timestamps', () => {
    const rng = createRng(3)
    for (const fps of [15, 30, 60]) {
      const th = new FrameThrottle(fps)
      let t = 0
      let rendered = 0
      while (t < 20_000) {
        if (th.tick(t)) rendered++
        t += 16.667 + (rng() - 0.5) * 6 // +/- 3 ms
      }
      expect(Math.abs(rendered / 20 - fps)).toBeLessThan(fps * 0.06)
    }
  })

  it('applies a changed fps immediately and mid-run', () => {
    const th = new FrameThrottle(60)
    expect(run(th, 60, 1000).every(Boolean)).toBe(true)
    th.setFps(15)
    const slow = run(th, 60, 2000, 1000 + 1000 / 60)
    expect(Math.abs(count(slow) - 30)).toBeLessThanOrEqual(1)
    th.setFps(60)
    const fast = run(th, 60, 1000, 3100)
    expect(count(fast)).toBeGreaterThanOrEqual(fast.length - 1)
  })

  it('drops the backlog after a long stall instead of bursting', () => {
    const th = new FrameThrottle(30)
    th.tick(0)
    expect(th.tick(5000)).toBe(true)
    // Afterwards it is back to every 2nd 60 Hz tick, not a burst of catch-up frames.
    const after = run(th, 60, 1000, 5000 + 1000 / 60)
    expect(Math.abs(count(after) - 30)).toBeLessThanOrEqual(1)
    for (let i = 1; i < after.length; i++) expect(after[i] && after[i - 1]).toBe(false)
  })

  it('reset makes the next tick render', () => {
    const th = new FrameThrottle(15)
    th.tick(0)
    expect(th.tick(16)).toBe(false)
    th.reset()
    expect(th.tick(32)).toBe(true)
  })
})

describe('RenderLoop', () => {
  let queue: Map<number, FrameRequestCallback>
  let nextId: number
  let cancel: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queue = new Map()
    nextId = 1
    cancel = vi.fn((id: number) => {
      queue.delete(id)
    })
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      queue.set(nextId, cb)
      return nextId++
    })
    vi.stubGlobal('cancelAnimationFrame', cancel)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Runs the callbacks queued right now with timestamp `ts`. */
  const frame = (ts: number) => {
    const cbs = [...queue.values()]
    queue.clear()
    cbs.forEach((cb) => cb(ts))
  }

  it('does nothing until started, then calls onFrame with dt (first dt is 0)', () => {
    const onFrame = vi.fn()
    const loop = new RenderLoop(onFrame, 60)
    expect(queue.size).toBe(0)
    loop.start()
    expect(queue.size).toBe(1)
    frame(1000)
    frame(1000 + 1000 / 60)
    expect(onFrame).toHaveBeenCalledTimes(2)
    expect(onFrame.mock.calls[0][0]).toBe(0)
    expect(onFrame.mock.calls[1][0]).toBeCloseTo(1000 / 60, 6)
    expect(onFrame.mock.calls[1][1]).toBeCloseTo(1000 + 1000 / 60, 6)
  })

  it('passes the time since the previous rendered frame when throttled', () => {
    const onFrame = vi.fn()
    const loop = new RenderLoop(onFrame, 30)
    loop.start()
    for (let i = 0; i < 5; i++) frame(i * (1000 / 60))
    expect(onFrame).toHaveBeenCalledTimes(3) // ticks 0, 2, 4
    expect(onFrame.mock.calls[1][0]).toBeCloseTo(2000 / 60, 6)
  })

  it('clamps dt to 100 ms', () => {
    const onFrame = vi.fn()
    const loop = new RenderLoop(onFrame, 60)
    loop.start()
    frame(0)
    frame(5000)
    expect(onFrame.mock.calls[1][0]).toBe(100)
  })

  it('paused: cancels the pending rAF and requests no more', () => {
    const onFrame = vi.fn()
    const loop = new RenderLoop(onFrame, 60)
    loop.start()
    frame(0)
    loop.setPaused(true)
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(queue.size).toBe(0)
    frame(1000)
    expect(onFrame).toHaveBeenCalledTimes(1)
  })

  it('un-pausing resumes without the paused time in dt', () => {
    const onFrame = vi.fn()
    const loop = new RenderLoop(onFrame, 60)
    loop.start()
    frame(0)
    frame(16.667)
    loop.setPaused(true)
    loop.setPaused(false)
    expect(queue.size).toBe(1)
    frame(60_000)
    frame(60_016.667)
    expect(onFrame.mock.calls[2][0]).toBe(0)
    expect(onFrame.mock.calls[3][0]).toBeCloseTo(16.667, 3)
  })

  it('start while paused schedules nothing until un-paused; stop cancels', () => {
    const onFrame = vi.fn()
    const loop = new RenderLoop(onFrame, 60)
    loop.setPaused(true)
    loop.start()
    expect(queue.size).toBe(0)
    loop.setPaused(false)
    expect(queue.size).toBe(1)
    loop.stop()
    expect(queue.size).toBe(0)
    loop.setPaused(true)
    loop.setPaused(false)
    expect(queue.size).toBe(0)
  })

  it('setFps changes the render rate immediately', () => {
    const onFrame = vi.fn()
    const loop = new RenderLoop(onFrame, 60)
    loop.start()
    for (let i = 0; i < 4; i++) frame(i * (1000 / 60))
    expect(onFrame).toHaveBeenCalledTimes(4)
    loop.setFps(15)
    for (let i = 4; i < 12; i++) frame(i * (1000 / 60))
    expect(onFrame).toHaveBeenCalledTimes(4 + 2)
  })

  it('measures the rendered fps over ~1 s', () => {
    const loop = new RenderLoop(() => {}, 30)
    loop.start()
    expect(loop.measuredFps).toBe(0)
    for (let i = 0; i < 60 * 3; i++) frame(i * (1000 / 60))
    expect(loop.measuredFps).toBeCloseTo(30, 0)
  })

  it('keeps running if onFrame throws once', () => {
    let calls = 0
    const loop = new RenderLoop(() => {
      if (calls++ === 0) throw new Error('boom')
    }, 60)
    loop.start()
    expect(() => frame(0)).toThrow('boom')
    expect(queue.size).toBe(1)
    frame(16.667)
    expect(calls).toBe(2)
  })
})
