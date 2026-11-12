// Ladder 15 (2026-11-12; CLAUDE.md rule 6): the visible-bar rules the whole-run tests block on, as run-length trackers
// fed one sample per drawn frame (or per substep) with its duration. Fine numbers (centimetre overlaps, degrees just past
// a range) are what the trackers also keep, for the tests to print; they block nothing.
import type { Simulation } from '../src/sim/simulation';
import { cross, dot, len, qRot, scale, sub, v3, vc } from '../src/sim/vec';

/** A limb in a body blocks at this depth in any one sample (m). */
export const LIMB_DEEP_M = 0.1;
/** ... or past this depth (m) ... */
export const LIMB_HELD_M = 0.05;
/** ... held this long (s), or its bone axis inside the body this long. */
export const LIMB_HELD_S = 0.1;
/** A joint blocks this far past its range (deg) ... */
export const JOINT_PAST_DEG = 15;
/** ... held this long (s). */
export const JOINT_PAST_S = 0.25;

const EPS = 1e-9;

/** One key's run past a condition: the current run's start and length, and the longest. */
class Runs {
  private cur = new Map<string, { from: number; s: number }>();
  readonly longest = new Map<string, { s: number; from: number; at: string }>();
  sample(key: string, t: number, dt: number, on: boolean, at: string): void {
    if (!on) {
      this.cur.delete(key);
      return;
    }
    const c = this.cur.get(key) ?? { from: t, s: 0 };
    c.s += dt;
    this.cur.set(key, c);
    const l = this.longest.get(key);
    if (!l || c.s > l.s) this.longest.set(key, { s: c.s, from: c.from, at });
  }
  worst(): { key: string; s: number; from: number; at: string } | null {
    let w: { key: string; s: number; from: number; at: string } | null = null;
    for (const [key, l] of this.longest) if (!w || l.s > w.s) w = { key, ...l };
    return w;
  }
}

/**
 * A limb in its own or another body: blocks when its depth passes LIMB_DEEP_M in any sample, or LIMB_HELD_M for
 * LIMB_HELD_S on end, or its bone axis is inside the body for LIMB_HELD_S on end. `sample` takes each limb key's depth
 * (m) and whether its bone axis is inside, with the sample's duration; `breaches` says what blocks; `deepest` is the
 * largest depth (the printed meter).
 */
export function limbInBody(): {
  sample: (key: string, t: number, dt: number, depthM: number, axisIn: boolean, at: string) => void;
  breaches: () => string[];
  deepest: () => { d: number; at: string };
} {
  let deep = { d: 0, at: '' };
  const held = new Runs();
  const axis = new Runs();
  return {
    sample(key, t, dt, depthM, axisIn, at) {
      if (depthM > deep.d) deep = { d: depthM, at };
      held.sample(key, t, dt, depthM > LIMB_HELD_M, at);
      axis.sample(key, t, dt, axisIn, at);
    },
    breaches() {
      const out: string[] = [];
      if (deep.d > LIMB_DEEP_M) out.push(`${deep.at}: ${(deep.d * 100).toFixed(2)} cm deep (over ${LIMB_DEEP_M * 100} cm)`);
      const h = held.worst();
      if (h && h.s >= LIMB_HELD_S - EPS) out.push(`${h.at}: over ${LIMB_HELD_M * 100} cm deep for ${h.s.toFixed(3)} s from ${h.from.toFixed(3)} s (${LIMB_HELD_S} s blocks)`);
      const a = axis.worst();
      if (a && a.s >= LIMB_HELD_S - EPS) out.push(`${a.at}: the bone axis inside for ${a.s.toFixed(3)} s from ${a.from.toFixed(3)} s (${LIMB_HELD_S} s blocks)`);
      return out;
    },
    deepest: () => deep,
  };
}

/**
 * A joint past its range: blocks when a joint is more than JOINT_PAST_DEG past it for JOINT_PAST_S on end. `sample`
 * takes each joint key's excess (deg past the range, negative inside) with the sample's duration; `worst` is the
 * largest excess (the printed meter).
 */
export function jointPastRange(): {
  sample: (key: string, t: number, dt: number, excessDeg: number, at: string) => void;
  breaches: () => string[];
  longest: () => { key: string; s: number; from: number; at: string } | null;
  worst: () => { deg: number; at: string };
} {
  let worst = { deg: -Infinity, at: '' };
  const past = new Runs();
  return {
    sample(key, t, dt, excessDeg, at) {
      if (excessDeg > worst.deg) worst = { deg: excessDeg, at };
      past.sample(key, t, dt, excessDeg > JOINT_PAST_DEG, at);
    },
    breaches() {
      const l = past.worst();
      return l && l.s >= JOINT_PAST_S - EPS ? [`${l.at}: over ${JOINT_PAST_DEG} deg past the range for ${l.s.toFixed(3)} s from ${l.from.toFixed(3)} s (${JOINT_PAST_S} s blocks)`] : [];
    },
    longest: () => past.worst(),
    worst: () => worst,
  };
}

/**
 * A fault for the joint rule's twins: from the substep R's ragdoll exists, for `forS`, a drive (an internal torque pair on
 * R's left upper arm and core, stiff and damped, capped at 1500 N m) holding the left upper arm `deg` behind hanging in
 * the core's frame (the shoulder cone allows 45). Call after each substep (`onSubstep`).
 */
export function holdArmBehind(deg: number, forS: number): (s: Simulation) => void {
  let t0 = -1;
  return (s) => {
    const r = s.players.find((p) => p.id === 'R')?.rag;
    if (!r) return;
    if (t0 < 0) t0 = s.t;
    if (s.t - t0 > forS) return;
    const a = (deg * Math.PI) / 180;
    const tgt = qRot(r.bodies.core.rotation(), v3(0, -Math.cos(a), -Math.sin(a)));
    const u = qRot(r.bodies.leftUpperArm.rotation(), v3(0, -1, 0));
    const ax = cross(u, tgt);
    const sn = len(ax);
    const w = sub(vc(r.bodies.leftUpperArm.angvel()), vc(r.bodies.core.angvel()));
    let tau = sub(sn > 1e-9 ? scale(ax, (3000 * Math.atan2(sn, dot(u, tgt))) / sn) : v3(), scale(w, 60));
    if (len(tau) > 1500) tau = scale(tau, 1500 / len(tau));
    const j = scale(tau, s.physics.dt);
    r.bodies.leftUpperArm.applyTorqueImpulse(j, true);
    r.bodies.core.applyTorqueImpulse(scale(j, -1), true);
  };
}
