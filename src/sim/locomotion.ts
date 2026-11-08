// Plan 08: locomotion composition above the foot planner: free-arm poses (brace, fitted idle, walking swing) and the
// per-player locomotion mode. Pose-only requests; the motor, the support budgets and the contact mechanics never read this.
import type { ArmSide } from './contracts';
import { hipLocal, type BodyProfile } from './profiles';
import { v3, type Vec3 } from './vec';
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
  idle: { arms: IdlePoseRecord['arms']; halfWidthM: number };
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
