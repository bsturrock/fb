// Plan 10f (F2): debug switches, per simulation. They used to be module state (`FOOT_DEBUG` in footwork, `POSE_DEBUG` in
// pose) shared by every simulation in a process and absent from the export. Now a simulation takes them as
// `SimOptions.debug`, passes them in each foot plan and pose input, and exports every switch that is on.
import type { Vec3 } from './vec';

/** Foot plan switches (A/B probes and negative controls); each is off by default and changes behaviour when on. */
export interface FootDebug {
  /** Skip the clip touchdown reach pre-check (proposals then rely on confirmation). */
  noReachCheck?: boolean;
  /** The reactive entry before plan 07 item 3: every following foot starts a step at once. */
  legacyEntry?: boolean;
  /** No quick-step rules of plan 07 item 3 (stance-window retiming, little-step touchdown, drag lift). */
  noQuick?: boolean;
  /** No handover check: a following foot joins the ordinary request at once. */
  noJoinCheck?: boolean;
  /** The composed crossing sets a following foot's heading to the body's, as before plan 10b (negative control). */
  crossingBodyHeading?: boolean;
  /** An inherited foot settles over one substep, as before plan 13e: a sliding shoe can plant (negative control). */
  settleOneSubstep?: boolean;
  /** The planner's home includes the idle sway's displacement, as before plan 13e's fix (negative control). */
  swayInHome?: boolean;
  /** A foot held off its home by another body steps toward it again at once, as before plan 13e (negative control). */
  noBlockedMemory?: boolean;
  /**
   * Controlled coverage (tests only): the solve at time `t` (s, within half a substep) releases a confirmed plant of
   * `side` as a clearance solve does (observeFeet: the foot rejoins the request from the achieved ankle on the next plan;
   * where the clip stance goes on, the planner proposes it again there: a reseed that keeps mode and source).
   */
  releasePlantAt?: { t: number; side: 'left' | 'right' };
}

/** Pose switches; off by default, each changes behaviour when on. */
export interface PoseDebug {
  /** Disable the plan 07 limb continuity (as with dtS 0), for A/B comparison. */
  noContinuity?: boolean;
  /** Plan 13f fault put back: under a leg-guard profile, measure legs against other bodies where they are now only (no prediction). */
  noLegAhead?: boolean;
  /**
   * Fault (negative control of the transition audit): a composed leg whose foot owner changed starts its continuity step
   * this far (m, body up) off the shown path, so the shown leg jumps at the ownership change.
   */
  ownerChangeJumpM?: number;
}

/** Read-only pose diagnostics (never change a result, never exported). */
export interface PoseProbe {
  /** Record every evaluated limb candidate's depth and worst shape (`last`), the leg IK (`legs`) and continuity (`cont`). */
  on: boolean;
  last: Record<string, { i: number; depth: number; soft: number }[]>;
  legs: Record<string, { request: Vec3; ik: Vec3; lifted: Vec3; floorLeft: number }>;
  /** Plan 07 continuity: per limb the rate-limited fraction, the shown fraction and the departure change (m). */
  cont: Record<string, { a0: number; al: number; dd: number }>;
  contLast: { a0: number; al: number; dd: number } | null;
  /** Per-call limb trace (body frame): request, chosen and shown departures, shown joints, variant. */
  trace?: (key: string, r: Record<string, unknown>) => void;
}

export function poseProbe(o: { on?: boolean; trace?: PoseProbe['trace'] } = {}): PoseProbe {
  return { on: o.on ?? false, last: {}, legs: {}, cont: {}, contLast: null, ...(o.trace ? { trace: o.trace } : {}) };
}

export interface SimDebug {
  foot?: FootDebug;
  pose?: PoseDebug;
  /** Diagnostics only; not a switch, so not exported. */
  poseProbe?: PoseProbe;
}

/** The switches that are on, for the export (null when every switch is off). */
export function debugExport(d: SimDebug | undefined): { foot?: FootDebug; pose?: PoseDebug } | null {
  const on = <T extends object>(o: T | undefined): T | undefined => {
    const e = Object.entries(o ?? {}).filter(([, v]) => v);
    return e.length ? (Object.fromEntries(e) as T) : undefined;
  };
  const foot = on(d?.foot);
  const pose = on(d?.pose);
  return foot || pose ? { ...(foot ? { foot } : {}), ...(pose ? { pose } : {}) } : null;
}
