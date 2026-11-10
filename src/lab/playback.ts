// Plan 13a: look-ahead playback. The lab computes ticks ahead of what it shows, into a buffer of render snapshots, for up
// to a wall-time budget per display frame, and plays the buffer at the chosen speed. A slow tick then delays only how far
// ahead the buffer runs, not the frames; if playback reaches the newest snapshot it holds there (`computing`) rather
// than skip time. The simulation is untouched: it steps at its fixed tick, one snapshot per tick.

/** What the playback drives: the simulation seen through its snapshot. */
export interface PlaybackSource<F> {
  /** Snapshot of the current state (the state after the last step; the initial state before any). */
  capture(): F;
  step(): void;
  done(): boolean;
}

export interface PlaybackView<F> {
  /** Frames around the shown time: `a` at tick `tick`, `b` the next (or `a` itself at the newest frame). */
  a: F;
  b: F;
  /** Blend from `a` to `b` (0..1). */
  alpha: number;
  tick: number;
}

export class Playback<F> {
  /** One snapshot per tick: frames[k] is the state after k ticks. */
  readonly frames: F[] = [];
  /** Shown time in ticks (fractional between two frames). */
  private pos = 0;
  /** Simulated seconds per wall second (0 holds time). */
  speed = 1;
  paused = true;
  /**
   * Plan 14: the most ticks computed ahead of the shown time (default unbounded). The run lab caps it so a live request
   * (its speed slider) reaches the shown run within a few ticks.
   */
  maxLeadTicks = Infinity;
  /** Wall time of the last computed tick (ms), the estimate for the next one. */
  private tickCostMs = 0;

  constructor(
    private readonly src: PlaybackSource<F>,
    readonly tickS: number,
    /** Wall clock in ms (`performance.now` in the lab; a fake clock in tests). */
    private readonly now: () => number,
    /** Wall time per display frame spent computing ahead (ms). */
    readonly budgetMs = 8,
  ) {
    if (!(Number.isFinite(tickS) && tickS > 0)) throw new RangeError(`Playback: tickS must be finite and > 0 (got ${tickS})`);
    this.frames.push(src.capture());
  }

  /** Index of the newest computed frame. */
  get newest(): number {
    return this.frames.length - 1;
  }

  /** The simulation has run to its end: no frame beyond the newest will come. */
  get complete(): boolean {
    return this.src.done();
  }

  /** Shown tick (fractional). */
  get shown(): number {
    return this.pos;
  }

  /** Running, at the newest frame, with more to compute: the shown time waits for the simulation. */
  get computing(): boolean {
    return !this.paused && this.speed > 0 && this.pos >= this.newest && !this.complete;
  }

  /** At the newest frame of a finished run. */
  get ended(): boolean {
    return this.complete && this.pos >= this.newest;
  }

  private extend(): boolean {
    if (this.src.done()) return false;
    const t0 = this.now();
    this.src.step();
    this.frames.push(this.src.capture());
    this.tickCostMs = this.now() - t0;
    return true;
  }

  /**
   * Compute ahead within the budget: one tick per display frame always (a tick cannot be split, so one slower than the
   * budget lengthens its frame either way), then more while the estimated cost of the next (the last tick's) still fits;
   * never past `maxLeadTicks` ahead of the shown time.
   */
  fill(): void {
    const ahead = (): boolean => this.newest - this.pos < this.maxLeadTicks;
    if (!ahead()) return;
    const t0 = this.now();
    if (!this.extend()) return;
    while (ahead() && this.now() - t0 + this.tickCostMs <= this.budgetMs && this.extend()) {
      // keep computing
    }
  }

  /** One display frame of `wallS` seconds: compute ahead, then advance the shown time (held at the newest frame). */
  frame(wallS: number): void {
    this.fill();
    if (!this.paused && this.speed > 0 && wallS > 0 && Number.isFinite(wallS)) this.pos += (wallS * this.speed) / this.tickS;
    if (this.pos >= this.newest) {
      this.pos = this.newest;
      if (this.complete) this.paused = true;
    }
  }

  view(): PlaybackView<F> {
    const k = Math.min(Math.floor(this.pos + 1e-9), this.newest);
    const b = Math.min(k + 1, this.newest);
    return { a: this.frames[k], b: this.frames[b], alpha: b === k ? 0 : Math.min(1, Math.max(0, this.pos - k)), tick: k };
  }

  /** Pause and show the next tick, computing it if needed. */
  step(): void {
    this.paused = true;
    const target = Math.floor(this.pos + 1e-9) + 1;
    while (this.newest < target && this.extend()) {
      // compute up to the target
    }
    this.pos = Math.min(target, this.newest);
  }

  /** Show tick `tick` (computing up to it if needed; clamped to what the run reaches). */
  seek(tick: number): void {
    const target = Math.max(0, Math.round(tick));
    while (this.newest < target && this.extend()) {
      // compute up to the target
    }
    this.pos = Math.min(target, this.newest);
  }

  /** Compute the run to its end without moving the shown time. */
  finish(): void {
    while (this.extend()) {
      // compute to the end
    }
  }

  /** Forget every frame and start again from the source's current state (call after resetting the simulation). */
  restart(): void {
    this.frames.length = 0;
    this.frames.push(this.src.capture());
    this.pos = 0;
    this.tickCostMs = 0;
  }
}
