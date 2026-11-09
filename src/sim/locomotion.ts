// Plan 08: locomotion composition above the foot planner: free-arm poses (brace, fitted idle, walking swing) and the
// per-player locomotion mode. Pose-only requests; the motor, the support budgets and the contact mechanics never read this.
import type { ArmSide } from './contracts';
import { hipLocal, type BodyProfile } from './profiles';
import { lerp, norm, qNormalize, qSlerp, v3, type Quat, type Vec3 } from './vec';
import IDLE_RECORD from './model/idle-pose.record.json';

/** Intake record of the supplied idle (scripts/model/idle-intake.ts). */
export interface IdlePoseRecord {
  note: string;
  id: string;
  source: string;
  sourceSha256: string;
  data: string;
  dataSha256: string;
  fps: number;
  frames: number;
  seamM: number;
  rootDriftM: number;
  rootBobM: number;
  footMoveM: number;
  posePolicy: string;
  /** The representative frame (0-based): closest to the cycle's mean posture around the hips. */
  frame: number;
  arms: Record<ArmSide, { upper: [number, number, number]; fore: [number, number, number] }>;
  stance: { widthM: number; leftForwardM: number; legScale: number };
  /**
   * Plan 13e: the whole cycle, one entry per frame (the last repeats the first): arm directions in that frame's chest
   * frame (as `arms`), the head's rotation in the chest frame relative to the representative frame (x, y, z, w), and the
   * hips' horizontal offset (x, z; m, clip root frame, before the leg scale) from the loop mean. `periodS` is the loop
   * (frames - 1) / fps; `headMaxDeg` and `hipsMaxM` are the measured bounds of the head rotation and the hips offset.
   */
  cycle: {
    frames: number;
    periodS: number;
    upper: Record<ArmSide, [number, number, number][]>;
    fore: Record<ArmSide, [number, number, number][]>;
    head: [number, number, number, number][];
    hips: [number, number][];
    headMaxDeg: number;
    hipsMaxM: number;
  };
}

export const IDLE_POSE_RECORD = IDLE_RECORD as unknown as IdlePoseRecord;

/** A free-arm pose in the procedural authored frame (x outward, y up, z forward). */
export interface ArmPoseSpec {
  palm: Vec3;
  pole: Vec3;
}

export interface LocomotionProfile {
  id: string;
  /** Free arm while braking (out and a little forward, elbow out and back), weighted by the support's braking blend. */
  brace: ArmPoseSpec;
  /**
   * Fitted resting posture: chest-frame arm directions (anatomical left +X) and the fitted stance's half width (m: each
   * ankle from the body's centre line, the clip's width scaled to the body's legs). What it adds outside the hip is taken
   * at use from the body's own hip (idleWidthAddM).
   */
  idle: {
    arms: IdlePoseRecord['arms'];
    halfWidthM: number;
    /**
     * Plan 13e: the supplied cycle a standing player plays (arms and head drawn, the hips offset as a physical sway),
     * blended from the representative frame by the idle weight. Absent: the static fitted posture (plan 08).
     */
    cycle?: IdlePoseRecord['cycle'];
    /** Plan 13e: the cycle's hips offset drives the standing body (a velocity request; arms and head play without it). */
    sway?: boolean;
  };
  /** Walking arms: follow the achieved feet's fore-aft spread (m at full swing), faded in with travel speed (m/s). */
  walk: { strideM: number; fadeMps: [number, number]; swingRad: number; restReach: number; forwardBend: number; tauS: number };
  /** Contact composition: observation hysteresis and the bounded preparation request. */
  contact: {
    /** No contact or retention for this long ends contact (s). */
    clearS: number;
    /** An opponent within this gap (m), closing at this speed (m/s) or more, is preparation; unwinds after holdS. */
    prepRangeM: number;
    prepClosingMps: number;
    prepHoldS: number;
    /** Exit lasts at least this long, and until the clip weight has reached its target (s). */
    exitMinS: number;
    /** Largest height drop requested by preparation (m) and the rate of the preparation and contact weights (1/s). */
    prepDropM: number;
    weightRatePerS: number;
    /** Rate of the free arms' critically damped brace weight. */
    braceRadPerS: number;
    /**
     * Rate of the composed clip weight, critically damped toward the clip's smoothed weight, so a reversal (a contact
     * that ends mid-fade) is no velocity step; a rejoined phase slides in at the same rate.
     */
    clipWeightRadPerS: number;
  };
}

export const LOCOMOTION_L3: LocomotionProfile = {
  // v3 (plan 10b): the stance's half width instead of a width added outside a fixed 0.1125 m hip (bew-v6's)
  id: 'locomotion-l3-v3',
  brace: { palm: v3(0.5, 0.12, 0.26), pole: v3(0.9, 0, -0.4) },
  idle: { arms: IDLE_POSE_RECORD.arms, halfWidthM: 0.5 * IDLE_POSE_RECORD.stance.widthM * IDLE_POSE_RECORD.stance.legScale },
  walk: { strideM: 0.2, fadeMps: [0.25, 1], swingRad: 0.42, restReach: 0.965, forwardBend: 0.07, tauS: 0.06 },
  contact: { clearS: 0.12, prepRangeM: 2.2, prepClosingMps: 1.5, prepHoldS: 0.15, exitMinS: 0.15, prepDropM: 0.05, weightRatePerS: 5, braceRadPerS: 24, clipWeightRadPerS: 24 },
};

/**
 * Plan 13e: LOCOMOTION_L3 with the supplied idle cycle played (the player model's fixtures; the authored bodies keep
 * LOCOMOTION_L3, whose fitted idle is calibrated to the model).
 */
export const LOCOMOTION_L3_IDLE: LocomotionProfile = {
  ...LOCOMOTION_L3,
  id: 'locomotion-l3-v4',
  idle: { ...LOCOMOTION_L3.idle, cycle: IDLE_POSE_RECORD.cycle, sway: true },
};

// ------------------------------------------------------------------------------------------- idle cycle (plan 13e)
/** Phase offset between consecutive players (golden-ratio steps, so no two players of a fixture stand in step). */
export const IDLE_PHASE_STEP = 0.618;
const frac = (x: number): number => x - Math.floor(x);

/** A player's idle phase (0..1) at simulation time `t`: from time alone, so a reset or a pause cannot shift it. */
export function idlePhase(C: IdlePoseRecord['cycle'], t: number, playerIndex: number): number {
  return frac(t / C.periodS + frac(IDLE_PHASE_STEP * playerIndex));
}

/** The cycle at a phase: arm directions (chest frame), head rotation (chest frame), hips offset (m) and its rate (m/s). */
export interface IdleSample {
  upper: Record<ArmSide, Vec3>;
  fore: Record<ArmSide, Vec3>;
  head: Quat;
  /** Clip root frame (x = anatomical left, z = forward), before the leg scale. */
  hips: Vec3;
  hipsV: Vec3;
}

const t3 = (a: readonly number[]): Vec3 => v3(a[0], a[1], a[2]);
const t4 = (a: readonly number[]): Quat => ({ x: a[0], y: a[1], z: a[2], w: a[3] });

/**
 * Sample the cycle at phase `u`, linearly between frames (directions renormalized, the head slerped). The hips rate is
 * each frame's central difference over the loop, interpolated the same way, so the sway request has no steps.
 */
export function sampleIdle(C: IdlePoseRecord['cycle'], u: number): IdleSample {
  const L = C.frames - 1;
  const f = frac(u) * L;
  const i = Math.min(Math.floor(f), L - 1);
  const a = f - i;
  const j = i + 1;
  const dir = (r: [number, number, number][]): Vec3 => norm(lerp(t3(r[i]), t3(r[j]), a), t3(r[i]));
  const h = (k: number): Vec3 => v3(C.hips[k][0], 0, C.hips[k][1]);
  const fps = L / C.periodS;
  const rate = (k: number): Vec3 => {
    const p = h((k + 1) % L);
    const m = h((k - 1 + L) % L);
    return v3(((p.x - m.x) * fps) / 2, 0, ((p.z - m.z) * fps) / 2);
  };
  return {
    upper: { left: dir(C.upper.left), right: dir(C.upper.right) },
    fore: { left: dir(C.fore.left), right: dir(C.fore.right) },
    head: qNormalize(qSlerp(t4(C.head[i]), t4(C.head[j]), a)),
    hips: lerp(h(i), h(j), a),
    hipsV: lerp(rate(i), rate(j % L), a),
  };
}

/** The idle weight's target: the stance fade at this travel speed while moving freely and supported, else 0. */
export function idleTarget(speed: number, freeAndSupported: boolean): number {
  return freeAndSupported ? idleStanceFade(speed) : 0;
}

/**
 * Advance the idle weight toward its target at the profile's weight rate (a mode change or a loss of support is no
 * step in the arms or the head); the first call takes the target.
 */
export function advanceIdle(st: LocoState, P: LocomotionProfile, target: number, dt: number): void {
  if (st.idleW === undefined) {
    st.idleW = target;
    return;
  }
  const k = P.contact.weightRatePerS * dt;
  st.idleW += Math.max(-k, Math.min(k, target - st.idleW));
}

/** The idle weight a pose or the sway reads: the advanced weight, or (before the first substep) its target. */
export const idleWeight = (st: LocoState, target: number): number => st.idleW ?? target;

/** The fitted idle stance's width per foot outside the body's own hip (m, never inward). */
export function idleWidthAddM(P: LocomotionProfile, body: BodyProfile, s: ArmSide): number {
  return Math.max(0, P.idle.halfWidthM - Math.abs(hipLocal(body, s).x));
}

/** Travel speed (m/s) at which the idle stance has fully closed. */
export const IDLE_STANCE_FADE_MPS = 1.5;
/** How much of the idle stance (width and stagger) shows at this travel speed: 1 at rest, 0 from IDLE_STANCE_FADE_MPS. */
export function idleStanceFade(speed: number): number {
  return 1 - Math.min(1, speed / IDLE_STANCE_FADE_MPS);
}

// ------------------------------------------------------------------------------------------- locomotion mode
/** Free movement, preparation for a closing opponent, contact (solver contact or retention), exit back to free movement. */
export type LocoMode = 'free' | 'prep' | 'contact' | 'exit';

/** Per-player composition state, separate from the control mode and the representation. Cleared with the player. */
export interface LocoState {
  mode: LocoMode;
  /** Why the mode last changed (trace, lab). */
  reason: string;
  sinceS: number;
  /** Time without contact or retention (contact mode), without a closing opponent (preparation). */
  clearS: number;
  /** Continuous weights: preparation height request, contact brace of free arms. */
  prepW: number;
  contactW: number;
  /** The free arms' brace: critically damped toward contactW, so a reversal (a recontact in exit) is no velocity step. */
  braceW: number;
  braceV: number;
  /** Filtered walking arm swing (-1..1, + = right foot ahead). */
  swing: number;
  /** Plan 13e: how much of the idle cycle plays (0..1; a profile with a cycle only, absent until its first substep). */
  idleW?: number;
}

export const newLocoState = (): LocoState => ({ mode: 'free', reason: 'reset', sinceS: 0, clearS: 0, prepW: 0, contactW: 0, braceW: 0, braceV: 0, swing: 0 });

/** What one substep observed: solved contact, retained arms, the closest closing opponent, falling, the clip's settling. */
export interface LocoObs {
  contact: boolean;
  retained: boolean;
  closing: boolean;
  falling: boolean;
  clipSettled: boolean;
}

/**
 * Advance the mode one substep from actual observations. Contact, retention and falling act at once; leaving contact and
 * unwinding preparation take the profile's hysteresis, and no timer other than that hysteresis ends a mode: a stationary
 * contest stays in contact for as long as it lasts. Returns the change, or null.
 */
export function advanceLoco(st: LocoState, P: LocomotionProfile, o: LocoObs, t: number, dt: number): { from: LocoMode; to: LocoMode; reason: string } | null {
  const C = P.contact;
  const touching = o.contact || o.retained;
  const from = st.mode;
  let to: LocoMode = from;
  let reason = st.reason;
  if (o.falling) {
    if (from !== 'free') [to, reason] = ['free', 'falling'];
  } else if (touching) {
    if (from !== 'contact') [to, reason] = ['contact', from === 'exit' ? 'recontact' : o.contact ? 'contact' : 'retained'];
    st.clearS = 0;
  } else if (from === 'contact') {
    st.clearS += dt;
    if (st.clearS >= C.clearS) [to, reason] = ['exit', 'cleared'];
  } else if (from === 'exit') {
    if (t - st.sinceS >= C.exitMinS && o.clipSettled) [to, reason] = ['free', 'resumed'];
  } else if (from === 'prep') {
    st.clearS = o.closing ? 0 : st.clearS + dt;
    if (st.clearS >= C.prepHoldS) [to, reason] = ['free', 'unwound'];
  } else if (o.closing) [to, reason] = ['prep', 'closing'];
  const k = C.weightRatePerS * dt;
  const step = (x: number, want: number): number => x + Math.max(-k, Math.min(k, want - x));
  st.prepW = step(st.prepW, !o.falling && (to === 'prep' || to === 'contact') ? 1 : 0);
  st.contactW = step(st.contactW, !o.falling && to === 'contact' ? 1 : 0);
  const w = C.braceRadPerS;
  st.braceV += (w * w * (st.contactW - st.braceW) - 2 * w * st.braceV) * dt;
  const braceW = st.braceW + st.braceV * dt;
  st.braceW = Math.max(0, Math.min(1, braceW));
  // plan 10b: a clamped weight stops there: the rate the clamp overrode is not integrated on the next substep
  if (st.braceW !== braceW) st.braceV = 0;
  if (to === from) return null;
  st.mode = to;
  st.reason = reason;
  st.sinceS = t;
  st.clearS = 0;
  return { from, to, reason };
}
