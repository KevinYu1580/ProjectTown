const MAX_DT_MS = 100
const FPS_WINDOW_MS = 1000
// On-demand mode: frames drawn after each invalidate() before the loop stops asking for animation frames.
const DEMAND_FRAMES = 2

/** Decides which rAF ticks should render for a target fps. Pure; no timers. */
export class FrameThrottle {
  private interval: number
  private acc = 0
  private last: number | null = null

  constructor(fps: number) {
    this.interval = 1000 / fps
  }

  setFps(fps: number): void {
    this.interval = 1000 / fps
  }

  reset(): void {
    this.acc = 0
    this.last = null
  }

  tick(nowMs: number): boolean {
    if (this.last === null) {
      this.last = nowMs
      return true
    }
    this.acc += nowMs - this.last
    this.last = nowMs
    // 1 ms tolerance: 60 fps on a 120 Hz display must render every 2nd tick, not drift to 40 fps.
    if (this.acc < this.interval - 1) return false
    this.acc -= this.interval
    if (this.acc >= this.interval) this.acc = 0 // long stall: drop the backlog
    return true
  }
}

export class RenderLoop {
  private readonly throttle: FrameThrottle
  private rafId: number | null = null
  private running = false
  private paused = false
  private framesLeft = 0
  private lastRenderedMs: number | null = null
  private frames = 0
  private windowStartMs: number | null = null
  private fps = 0

  /**
   * `onDemand` is for a scene that only changes when told to: after start, un-pausing and every `invalidate()` the
   * loop draws DEMAND_FRAMES frames and then stops requesting animation frames until the next `invalidate()`.
   */
  constructor(
    private readonly onFrame: (dtMs: number, nowMs: number) => void,
    fps: number,
    private readonly onDemand = false,
  ) {
    this.throttle = new FrameThrottle(fps)
  }

  /** Rendered frames per second over the last ~1 s (debug). */
  get measuredFps(): number {
    return this.fps
  }

  get isPaused(): boolean {
    return this.paused
  }

  setFps(fps: number): void {
    this.throttle.setFps(fps)
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return
    this.paused = paused
    if (paused) this.cancel()
    else this.wake()
  }

  start(): void {
    this.running = true
    this.wake()
  }

  /** On-demand mode: the picture changed, draw it again. Does nothing otherwise (a continuous loop redraws anyway). */
  invalidate(): void {
    if (this.onDemand) this.wake()
  }

  stop(): void {
    this.running = false
    this.cancel()
  }

  private wake(): void {
    this.framesLeft = DEMAND_FRAMES
    this.schedule()
  }

  private schedule(): void {
    if (!this.running || this.paused || this.rafId !== null) return
    // Fresh timing state so the first frame never includes time spent stopped or paused.
    this.throttle.reset()
    this.lastRenderedMs = null
    this.clearStats()
    this.rafId = requestAnimationFrame(this.tick)
  }

  private clearStats(): void {
    this.windowStartMs = null
    this.frames = 0
    this.fps = 0
  }

  private cancel(): void {
    if (this.rafId === null) return
    cancelAnimationFrame(this.rafId)
    this.rafId = null
  }

  private tick = (nowMs: number): void => {
    this.rafId = null
    const render = this.throttle.tick(nowMs)
    if (render && this.onDemand) this.framesLeft--
    // Re-arm first so one throwing frame does not freeze the wallpaper for good. On demand: only while frames are owed.
    if (!this.onDemand || this.framesLeft > 0) this.rafId = requestAnimationFrame(this.tick)
    else this.clearStats() // idle: nothing is being drawn any more
    if (!render) return

    const dt = this.lastRenderedMs === null ? 0 : Math.min(MAX_DT_MS, nowMs - this.lastRenderedMs)
    this.lastRenderedMs = nowMs
    this.countFrame(nowMs)
    this.onFrame(dt, nowMs)
  }

  private countFrame(nowMs: number): void {
    if (this.windowStartMs === null) {
      this.windowStartMs = nowMs
      return
    }
    this.frames++
    const elapsed = nowMs - this.windowStartMs
    if (elapsed >= FPS_WINDOW_MS) {
      this.fps = (this.frames * 1000) / elapsed
      this.frames = 0
      this.windowStartMs = nowMs
    }
  }
}
