// Display-frame driver: converts wall time into whole fixed ticks. Slow motion changes how fast simulated time is
// consumed, never the integration step; wall time beyond maxTicksPerFrame is discarded and reported, keeping at most
// one tick of remainder so the next frame stays on the same phase.
export class FixedStepDriver {
  speed = 1;
  paused = false;
  private accumulator = 0;
  /** Wall-clock seconds dropped because a frame would have needed more than maxTicksPerFrame ticks. */
  discardedWallS = 0;
  constructor(
    readonly tickS: number,
    readonly maxTicksPerFrame: number,
  ) {
    if (!(Number.isFinite(tickS) && tickS > 0)) throw new RangeError(`FixedStepDriver: tickS must be finite and > 0 (got ${tickS})`);
    if (!(Number.isInteger(maxTicksPerFrame) && maxTicksPerFrame >= 1)) throw new RangeError(`FixedStepDriver: maxTicksPerFrame must be an integer >= 1 (got ${maxTicksPerFrame})`);
  }

  /** Set the playback speed (simulated seconds per wall second): finite and >= 0 (0 holds time like a pause). */
  setSpeed(speed: number): void {
    if (!(Number.isFinite(speed) && speed >= 0)) throw new RangeError(`FixedStepDriver: speed must be finite and >= 0 (got ${speed})`);
    this.speed = speed;
  }

  /** Number of whole ticks to run for a display frame lasting `wallDtS` (non-finite or negative frames run none). */
  frame(wallDtS: number): number {
    if (this.paused || !(wallDtS > 0) || !Number.isFinite(wallDtS)) return 0;
    if (!(Number.isFinite(this.speed) && this.speed >= 0)) throw new RangeError(`FixedStepDriver: speed must be finite and >= 0 (got ${this.speed})`);
    if (this.speed === 0) return 0;
    this.accumulator += wallDtS * this.speed;
    let n = Math.floor(this.accumulator / this.tickS + 1e-9);
    if (n > this.maxTicksPerFrame) {
      // keep the sub-tick remainder (bounded below one tick); discard only the whole ticks over the limit
      const rest = Math.max(0, this.accumulator - n * this.tickS);
      this.discardedWallS += ((n - this.maxTicksPerFrame) * this.tickS) / this.speed;
      n = this.maxTicksPerFrame;
      this.accumulator = Math.min(rest, this.tickS);
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
