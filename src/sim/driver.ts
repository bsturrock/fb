// Display-frame driver: converts wall time into whole fixed ticks. Slow motion changes how fast simulated time is
// consumed, never the integration step; excess wall time beyond maxTicksPerFrame is discarded and reported.
export class FixedStepDriver {
  speed = 1;
  paused = false;
  private accumulator = 0;
  /** Wall-clock seconds dropped because a frame would have needed more than maxTicksPerFrame ticks. */
  discardedWallS = 0;
  constructor(
    readonly tickS: number,
    readonly maxTicksPerFrame: number,
  ) {}

  /** Number of whole ticks to run for a display frame lasting `wallDtS`. */
  frame(wallDtS: number): number {
    if (this.paused || !(wallDtS > 0)) return 0;
    this.accumulator += wallDtS * this.speed;
    let n = Math.floor(this.accumulator / this.tickS + 1e-9);
    if (n > this.maxTicksPerFrame) {
      this.discardedWallS += ((n - this.maxTicksPerFrame) * this.tickS) / this.speed;
      n = this.maxTicksPerFrame;
      this.accumulator = 0;
    } else {
      this.accumulator -= n * this.tickS;
    }
    return n;
  }

  /** Fraction of a tick accumulated (render interpolation factor 0..1). */
  alpha(): number {
    return Math.min(1, Math.max(0, this.accumulator / this.tickS));
  }

  reset(): void {
    this.accumulator = 0;
    this.discardedWallS = 0;
  }
}
