// Plan 10f (F2): debug switches, per simulation. They used to be module state (`FOOT_DEBUG` in footwork, `POSE_DEBUG` in
// pose) shared by every simulation in a process and absent from the export. Now a simulation takes them as
// `SimOptions.debug`, passes them in each foot plan and pose input, and exports every switch that is on.
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Vec3 } from './vec';
import type { BraceDebug } from './brace';
import type { WrapDebug } from './controllers/wrap';

/** Foot plan switches (A/B probes and negative controls); each is off by default and changes behaviour when on. */
export interface FootDebug {
  /** No quick-step rules of plan 07 item 3 (stance-window retiming, little-step touchdown, drag lift). */
  noQuick?: boolean;
  /**
   * Controlled coverage (tests only): the solve at time `t` (s, within half a substep) releases a confirmed plant of
   * `side` as a clearance solve does (observeFeet: the foot rejoins the request from the achieved ankle on the next plan;
   * where the clip stance goes on, the planner proposes it again there: a reseed that keeps mode and source).
   */
  releasePlantAt?: { t: number; side: 'left' | 'right' };
  /**
   * Fault (negative control of plan 15's turns, `FootworkProfile.steps`): with both feet down the foot that gains more by
   * stepping steps, also when it stepped last (as in the step 2 model, where the farther foot stepped).
   */
  stepsNoTurns?: boolean;
  /**
   * Fault (negative control of plan 15's gain, `FootworkProfile.steps`): a plant steps when it is more than coverM from its
   * aim (as in the step 2 model), not when stepping brings it that much nearer its want.
   */
  stepsToAim?: boolean;
  /**
   * Fault (negative control of plan 15's stance, `FootworkProfile.steps`): a plant past its reach waits for the other foot
   * to land before it lifts, as in the step 2 model (which then slid it along the turf).
   */
  stepsStanceWaits?: boolean;
  /**
   * Fault (negative control of plan 15's search, `FootworkProfile.steps`): a foot with no free place within its short step
   * has no aim, though there is one within its leg's reach.
   */
  stepsShortOnly?: boolean;
  /**
   * Fault (negative control of plan 15's least-deep aim, `FootworkProfile.steps`): a foot with no free place within reach
   * aims under its hip (plan 15 round 3), not where its leg stands least deep.
   */
  stepsBoundUnder?: boolean;
  /**
   * Fault (negative control of plan 15's depth order, `FootworkProfile.steps`): depths are compared strictly, not as equal
   * within the leg's skin, for the aim and for whether a plant steps.
   */
  stepsStrictDepth?: boolean;
  /** Fault (negative control of plan 15's touchdown, `FootworkProfile.steps`): a step lands with its heel under the ankle, flat, not as the foot is shown. */
  stepsLandFlat?: boolean;
  /** Fault (negative control of plan 15's touchdown, `FootworkProfile.steps`): a foot in the air turns at most at the swing's yaw rate, not onto the body's heading by touchdown. */
  stepsTurnRate?: boolean;
  /** Fault (negative control of plan 15's path, `FootworkProfile.steps`): a foot in the air moves along its path as planned, through another player's footprint. */
  stepsPathBlind?: boolean;
  /** Fault (negative control of plan 15's swing height, `FootworkProfile.steps`): a foot in the air keeps the planned height, its shoe pitched toe down through the turf. */
  stepsTurfBlind?: boolean;
  /**
   * Fault (negative control of plan 15's come-down read on the model, step 4b; simulation.ts `rideUnsupported`): a foot
   * that is not bound, any contact of the tackler with the carrier and any hold of him hold him up, as under steps-v1 (he
   * went down late).
   */
  stepsRideAnyFoot?: boolean;
}

/** Pose switches; off by default, each changes behaviour when on. */
export interface PoseDebug {
  /** Disable the plan 07 limb continuity (as with dtS 0), for A/B comparison. */
  noContinuity?: boolean;
  /** Plan 13f fault put back: under a leg-guard profile, measure legs against other bodies where they are now only (no prediction). */
  noLegAhead?: boolean;
  /**
   * Fault (rung 7, the swept guard): a plant whose primary placement gives up takes the ordinary choice (an offset, which
   * footwork releases), never the primary at another knee pole.
   */
  noPlantedPole?: boolean;
  /**
   * Fault (ladder 10b, physical legs): a proxy whose support probe finds a refused surface or normal within travel keeps
   * its physical legs live (the D2 rule before 10b), though it has no support.
   */
  legsOnRefused?: boolean;
  /**
   * Fault (ladder 13c, `SelfClearanceProfile.upperArm`): an arm's continuity push may take its target past the arm's reach
   * of its shoulder (the bound off).
   */
  noArmReachBound?: boolean;
  /**
   * Fault (ladder 14b, `SelfClearanceProfile.clipArmSwing`): a met clip arm's departure is let go at once (the arm is
   * shown on its chosen pose the next step), not as fast as the clip's target moves.
   */
  clipArmSwingAtOnce?: boolean;
  /**
   * Fault (ladder 14b, `clipArmSwing`): its rules hold for every composed arm, not only one another body has met (a free
   * run's carry tuck then changes).
   */
  clipArmSwingUngated?: boolean;
  /**
   * Fault (ladder 16b, `SelfClearanceProfile.metArmStay`): a met arm's shown departure moves as far in a substep as the
   * let-go, the give-up (at once, with its elbow pole) and the push take it, not at most CONT_FAST_MPS.
   */
  metArmUnbounded?: boolean;
  /**
   * Fault (ladder 16b, `metArmStay`): a met arm keeps its rules while its player's handoff is deferred for overlapping
   * another body (not pushed out of it as registered, so the retry may find the ragdoll inside the other body again).
   */
  metArmStayDeferred?: boolean;
  /**
   * Fault (contact motion M2, `FixtureDef.brace`): the carrier's braced free arm covering the ball is moved off another
   * body as any met arm is (the swing-out, then hanging), not kept in the tuck as the carry arm is.
   */
  braceCoverSwingOut?: boolean;
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

/** Ladder 17: fault switches of the conversion. */
export interface ConversionDebug {
  /**
   * Fault (`RagdollProfile.bornOverlap`): a candidate is accepted as the profile accepts it, but its born pairs stay in
   * the solve (switched in overlapping, as a looser tolerance would leave them).
   */
  bornInSolve?: boolean;
  /**
   * Fault (`BornOverlapProfile.separation`): a held pair is pushed to part in one solve (the target speed its depth over
   * the step), its force and work uncapped: the depenetration the solve itself would give it.
   */
  bornSeparationUncapped?: boolean;
}

/** Plan 16: fault switches of the palm push (`PalmPushProfile`, arms.ts); each off by default. */
export interface ArmDebug {
  /** Fault (the held patch): a push ends after every solve and is born again from the next substep's palm contact, as a forearm clamp is. */
  pushUnheld?: boolean;
  /** Fault (never pulls): the strut's force is not held at zero or above: a palm whose arm is stretched pulls. */
  pushPulls?: boolean;
  /** Fault (the force from the arm's compression): the strut pushes with the rest length's excess over its length at the push's birth, however the arm's length changes since. */
  pushConstant?: boolean;
  /** Fault (the budgets): a push's force is applied as demanded, past the per-arm ceiling and the owner budget. */
  pushNoBudget?: boolean;
  /** Fault (the palm on the surface): the held palm is shown at the rest length along the arm line (inside the chest by the compression), its pose's validity unread. */
  pushPalmAtRest?: boolean;
}

/** Ladder 18: one separating force of a born pair (`BornOverlapProfile.separation`), before the solve. */
export interface BornForce {
  /** The pair's keys (`player:segment:region~player:key`, the lower first). */
  key: string;
  /** The force on the lower-keyed collider's body at `point`; the other body takes its opposite there (N, world). */
  lo: RAPIER.RigidBody;
  hi: RAPIER.RigidBody;
  force: Vec3;
  point: Vec3;
  depthM: number;
}

export interface SimDebug {
  foot?: FootDebug;
  pose?: PoseDebug;
  conversion?: ConversionDebug;
  /** Contact motion M2: fault switches of the carrier's brace decision (brace.ts). */
  brace?: BraceDebug;
  /** Contact motion polish 1.1: fault switches of the tackler's strike (controllers/wrap.ts). */
  wrap?: WrapDebug;
  /** Plan 16: fault switches of the palm push (arms.ts). */
  arm?: ArmDebug;
  /** Diagnostics only; not a switch, so not exported. */
  poseProbe?: PoseProbe;
  /** Diagnostics only (ladder 18): each born pair's separating force as it is applied. */
  bornForce?: (f: BornForce) => void;
}

/** The switches that are on, for the export (null when every switch is off). */
export function debugExport(d: SimDebug | undefined): { foot?: FootDebug; pose?: PoseDebug; conversion?: ConversionDebug; brace?: BraceDebug; wrap?: WrapDebug; arm?: ArmDebug } | null {
  const on = <T extends object>(o: T | undefined): T | undefined => {
    const e = Object.entries(o ?? {}).filter(([, v]) => v);
    return e.length ? (Object.fromEntries(e) as T) : undefined;
  };
  const foot = on(d?.foot);
  const pose = on(d?.pose);
  const conversion = on(d?.conversion);
  const brace = on(d?.brace);
  const wrap = on(d?.wrap);
  const arm = on(d?.arm);
  return foot || pose || conversion || brace || wrap || arm ? { ...(foot ? { foot } : {}), ...(pose ? { pose } : {}), ...(conversion ? { conversion } : {}), ...(brace ? { brace } : {}), ...(wrap ? { wrap } : {}), ...(arm ? { arm } : {}) } : null;
}
