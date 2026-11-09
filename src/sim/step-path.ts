// Plan 10f (F10): the minimum-jerk path of a composed planner step, split out of footwork.ts. Pure functions of the
// path's boundary conditions and the step's limits: a quintic substep toward a destination at rest, its sampled peak
// acceleration over a set of axes, the remaining time lengthened until that peak is within a limit, and the limits.
import type { FootComposeProfile } from './footwork';
import { horiz, len, scale, sub, v3, type Vec3 } from './vec';

/**
 * One substep along the quintic from (p, v, a) to the destination at rest in time T (the minimum-jerk path for those
 * boundary conditions); the remaining time shorter than the substep arrives.
 */
export function quinticStep(p: number, v: number, a: number, dest: number, T: number, dt: number): { p: number; v: number; a: number } {
  if (T <= dt + 1e-9) return { p: dest, v: 0, a: 0 };
  const [c3, c4, c5] = quinticCoeffs(dest - p, v, a, T);
  const t = dt;
  return {
    p: p + t * (v + t * (0.5 * a + t * (c3 + t * (c4 + t * c5)))),
    v: v + t * (a + t * (3 * c3 + t * (4 * c4 + t * 5 * c5))),
    a: a + t * (6 * c3 + t * (12 * c4 + t * 20 * c5)),
  };
}

/** Quintic coefficients (c3, c4, c5) of quinticStep's path. */
function quinticCoeffs(D: number, v: number, a: number, T: number): [number, number, number] {
  const T2 = T * T;
  const T3 = T2 * T;
  return [(20 * D - 12 * v * T - 3 * a * T2) / (2 * T3), (-30 * D + 16 * v * T + 3 * a * T2) / (2 * T3 * T), (12 * D - 6 * v * T - a * T2) / (2 * T3 * T2)];
}

export type Axis = 'x' | 'y' | 'z';

export const HORIZONTAL: readonly Axis[] = ['x', 'z'];

export const VERTICAL: readonly Axis[] = ['y'];

/**
 * Largest acceleration (over the given axes together) along the replanned quintic, sampled: the next substep (where the
 * published motion comes from) at its middle and end, then 16 intervals of the rest.
 */
function peakAccel(axes: readonly Axis[], D: Vec3, v: Vec3, a: Vec3, T: number, dt: number): number {
  const c = axes.map((k) => quinticCoeffs(D[k], v[k], a[k], T));
  let peak = 0;
  const N = 16;
  for (let i = -1; i <= N; i++) {
    const t = i < 0 ? dt / 2 : dt + ((T - dt) * i) / N;
    let sq = 0;
    axes.forEach((k, j) => {
      const [c3, c4, c5] = c[j];
      const ak = a[k] + t * (6 * c3 + t * (12 * c4 + t * 20 * c5));
      sq += ak * ak;
    });
    peak = Math.max(peak, Math.sqrt(sq));
  }
  return peak;
}

/**
 * Plan 10b: the remaining time of a composed step's path (over the given axes), lengthened (never shortened) until the
 * replanned minimum-jerk path to the destination stays within the acceleration limit. A path with one substep left
 * arrives only when that last substep is within the limit too (distance at most aMax dt^2 / 2, speed at most aMax dt);
 * otherwise it gets at least two substeps. So a step never stops dead.
 */
export function boundedHorizon(axes: readonly Axis[], prev: Vec3, v: Vec3, a: Vec3, dest: Vec3, T0: number, dt: number, aMax: number): number {
  const D = sub(dest, prev);
  const norm2 = (w: Vec3): number => Math.sqrt(axes.reduce((q, k) => q + w[k] * w[k], 0));
  let T = T0;
  if (T <= dt + 1e-9) {
    // (and the change from the last substep's motion, the published second difference, within the limit: that motion is
    // the mean over its substep, v - a dt / 2. Plan 12: L3-F16-kick R's left step, shortened to its stance, stopped dead
    // from 3.6 mm a substep at 1.3 times the limit)
    if (norm2(D) <= 0.5 * aMax * dt * dt && norm2(v) <= aMax * dt && norm2(sub(D, scale(sub(v, scale(a, dt / 2)), dt))) <= aMax * dt * dt) return T;
    T = 2 * dt;
  }
  for (let i = 0; i < 48 && peakAccel(axes, D, v, a, T, dt) > aMax; i++) T *= 1.15;
  return T;
}

/** The step's horizontal acceleration limit at this travel speed (m/s^2). */
export function stepAccelMax(C: FootComposeProfile, vel: Vec3): number {
  return C.stepAccelMps2 + C.stepAccelPerTravel * len(horiz(vel));
}

/** a with its horizontal part scaled down to at most aMax (y kept). */
export function limitH(a: Vec3, aMax: number): Vec3 {
  const aH = Math.hypot(a.x, a.z);
  return aH > aMax ? v3((a.x * aMax) / aH, a.y, (a.z * aMax) / aH) : a;
}
