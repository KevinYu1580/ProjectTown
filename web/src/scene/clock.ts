/** Scene time source. Frozen mode (`?time=`) pins time and stops animations (dt = 0) for reproducible screenshots. */
export class SceneClock {
  readonly frozen: boolean

  constructor(private readonly frozenAtMs?: number) {
    this.frozen = frozenAtMs !== undefined
  }

  now(): number {
    return this.frozenAtMs ?? Date.now()
  }
}
