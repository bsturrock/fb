// Plan 07: persistent per-foot plant / swing state and a small step planner. Pose only: it reads the solved core, the
// solved travel, the support probe and control mode, and the clip playback; it writes foot requests for the existing
// leg solve (pose.ts buildProxyPose) and its own diagnostics. It never changes grounded state, drive, yaw or balance
// torque, friction, support force or completion rules, and never moves the root.
//
// Touchdown is a proposal (plan 07 review): a proposed plant is `tentative` while the leg solve of its substep runs
// with the plant request. `observeFeet` confirms it from the achieved pose only (primary candidate, no reach clamp
// beyond plantTolM, contact-feature error within plantTolM); only then is it a plant and `footPlant` is emitted. A
// failed proposal continues from the achieved foot with a `footPlantFailed` record (reason, errors), never a
// touchdown/liftoff pair, and the next proposal needs a fresh (non-plant) solve and a reachable anchor from the current
// hip. A confirmed plant that survives a later solve is a sustained interval.
//
// Per foot, one of:
// - planted: a world anchor of the contact feature (heel point = the sole point below the ankle, the planted heading and
//   the roll fraction along the sole, 0 heel .. 1 toe). Valid while the achieved feature stays on its anchor: its
//   horizontal error and the shoe's contact gap (lowest shoe-box corner above the ground) combine to at most plantTolM.
//   A shoe pivoting on its toe or edge (ankle pitch at its range, a tilted shin; the shoe is rigid on the shin) stays
//   planted while the touching sole neither slides nor separates. Released with a reason otherwise: a soft-reach clamp,
//   a clearance alternative, separation or sliding; no clamped target is reported as planted.
// - swing: either a planner step (bounded trajectory from the current target to a destination that is retargeted every
//   substep without restarting) or `follow`: the clip / procedural request plus an offset from where the foot was,
//   decaying at a bounded rate (a released foot rejoining the clip swing, never a jump).
// - airborne: no support (probe invalid, falling) or a ragdoll: no anchors, no new plants.
//
// Regimes: with clip weight > 0 the clip's stance annotations schedule plants (touchdown inside the clip stance
// interval once the clip contact is made and the shoe is on the ground; liftoff at the interval's end). With no clip
// weight and support, reactive steps: a planted foot steps when its anchor is far from its home under the hip (actual
// travel), when the body has yawed away from it, or when its reach is nearly used; one foot at a time unless the geometry
// releases both. A still body takes at most one settle step per foot (no marching).
import type { ArmSide } from './contracts';
import type { FootDebug } from './debug';
import type { RagdollProfile } from './profiles';
import { plantReachM, type FootRequest, type PhysicalPose, footFrame } from './pose';
import { add, addScaled, clamp, dist, dot, headingOf, len, norm, qRot, rad, round, scale, sub, v3, wrapPi, type Pose, type Vec3 } from './vec';
import { canFollow, carryPath, chase, decayOffset, descentS, endRateY, finishSole, followNext, HANDOVER_M, handsOn, heldOff, REQUEST_JUMP_MPS, seedFollow, seedStep, startFollow, takeRequests, trialOf } from './foot-compose';
import { boundedHorizon, HORIZONTAL, limitH, quinticStep, stepAccelMax } from './step-path';

export interface FootworkProfile {
  id: string;
  /** A valid plant keeps its contact feature within this of the anchor (error and drift, m). */
  plantTolM: number;
  /** Reactive steps: a planted foot steps when its anchor is this far (horizontal, m) from its home. */
  stepTriggerM: number;
  /** A still body (speed below settleSpeedMps) takes one settle step per foot farther than settleTriggerM from home. */
  settleTriggerM: number;
  settleSpeedMps: number;
  /** A planted foot steps when the body has yawed this far from its heading (deg); released beyond yawReleaseDeg. */
  yawTriggerDeg: number;
  yawReleaseDeg: number;
  /** Step when the planted leg's hip-ankle distance is within this of the plant reach limit (m). */
  reachMarginM: number;
  /**
   * Planner swing: duration bounds (s); horizontal target speed cap maxSpeedMps + travelSpeedK x the actual travel speed
   * (m/s: a foot that keeps up with a moving body swings at about twice its speed); clearance at mid swing (m, scaled
   * down for short steps); vertical target speed cap (m/s); destination lead along the actual travel (s); foot heading
   * rate (deg/s).
   */
  swing: { minS: number; maxS: number; maxSpeedMps: number; travelSpeedK: number; clearanceM: number; maxLiftRateMps: number; leadS: number; maxYawRateDegPerS: number };
  /** Lateral ankle separation (body frame, m) a destination keeps from the other foot: legs never cross. */
  minSeparationM: number;
  /** Largest horizontal distance of a destination from the predicted hip (m); the reach at the stance height bounds it too. */
  maxStepFromHipM: number;
  /** A released foot's offset to the request it rejoins decays at this speed (m/s). */
  rejoinMps: number;
  /** Clip regime: a clip stance foot plants once the clip contact weight reaches this and the shoe is on the ground. */
  clipPlantWeight: number;
  /**
   * Sideways travel leads with the travel-side foot when the lateral travel speed (body frame) is at least
   * leadLateralMps and at least leadLateralFrac of the travel speed.
   */
  leadLateralMps: number;
  leadLateralFrac: number;
  /** Plan 08 transition composition (absent: the plan 07 planner, bit-identical). */
  compose?: FootComposeProfile;
}

/**
 * Plan 08: how a foot moves between plant, step and follow. Pose only, like the rest of the planner. Every transition
 * starts from the achieved ankle and its achieved velocity, so a released plant or an interrupted step keeps its motion:
 * - a following foot's offset to the request is a critically damped second-order state (not a constant-speed decay);
 * - a planner step's horizontal target is the minimum-jerk path from the current position, velocity and acceleration to
 *   the retargeted destination, replanned every substep; its height arc takes a decaying offset from the same start;
 * - while braking, the planner takes the legs from the clip at a held foot (not at clip weight 0), so the next foot lands
 *   ahead of the hips instead of following the fading clip under them; a foot ahead of its home along the travel is
 *   catching the body and stays down until the body has passed it.
 */
export interface FootComposeProfile {
  /** Following foot: natural rate of the offset (rad/s). */
  followRadPerS: number;
  /** Planner step: smallest natural rate of the height-arc offset (rad/s); the rate rises so it ends within the step. */
  liftRadPerS: number;
  /** Braking blend at or above which the planner takes the legs from the clip (with a held foot), and below which it gives them back. */
  brakeEnterB: number;
  brakeExitB: number;
  /** Largest travel speed (m/s) at which the planner takes the legs from the clip. */
  brakeEnterMps: number;
  /** The last stretch of a step (s): its destination stops moving, so the path arrives; a late step takes this long to arrive. */
  arriveS: number;
  /** A following foot on the ground in the clip's stance plants where it is within this of the request (m): its recovery is rate limited. */
  landOffsetM: number;
  /** A held foot the travel takes out of reach within this time steps now, not when the reach runs out (s). */
  stepAheadS: number;
  /** While the clip comes in, a planner step this close to touchdown lands instead of joining the clip in the air (s). */
  landWithinS: number;
  /**
   * Plan 10b: shortest time between the landings of the two feet (s): half the shortest step (`swing.minS / 2`), the
   * plan 08 contract that a stop lands one foot, then the other. The later of two feet in the air slows to keep it
   * (`fitLanding`).
   */
  landGapS: number;
  /**
   * Plan 10b: largest horizontal acceleration of a planner step's target, stepAccelMps2 + stepAccelPerTravel x the travel
   * speed (m/s^2). Derived from the swing limits (`stepAccelLimits`): a minimum-jerk step at the speed cap over the
   * shortest step time. The step's remaining time is lengthened until its replanned path stays within it, and a step
   * arrives at rest only when its last substep is within it too: never a stop in one substep.
   */
  stepAccelMps2: number;
  stepAccelPerTravel: number;
  /**
   * Plan 10b: largest vertical acceleration of a chase's target (m/s^2), from the swing limits (`stepAccelLimits`): a
   * minimum-jerk rise or descent at the lift cap over half the shortest step.
   */
  liftAccelMps2: number;
}

/** A minimum-jerk path's peak acceleration over its distance / its time^2 (10 / sqrt 3). */
const MJ_PEAK_ACCEL = 10 / Math.sqrt(3);

/**
 * A minimum-jerk path over time T peaks at speed (15/8) D/T and acceleration (10/sqrt 3) D/T^2, so its peak acceleration
 * is 80/(15 sqrt 3) = 3.079 x its peak speed / T. The step's limits: its speed cap (maxSpeedMps + travelSpeedK x travel)
 * reached over the shortest step (minS); vertically, the lift cap (maxLiftRateMps) over half of it (a step rises, then
 * descends).
 */
export function stepAccelLimits(swing: FootworkProfile['swing']): { stepAccelMps2: number; stepAccelPerTravel: number; liftAccelMps2: number } {
  const k = 80 / (15 * Math.sqrt(3));
  return { stepAccelMps2: (k * swing.maxSpeedMps) / swing.minS, stepAccelPerTravel: (k * swing.travelSpeedK) / swing.minS, liftAccelMps2: (k * swing.maxLiftRateMps) / (swing.minS / 2) };
}

export const FOOTWORK_L2: FootworkProfile = {
  id: 'footwork-l2-v2',
  plantTolM: 0.01,
  stepTriggerM: 0.14,
  settleTriggerM: 0.06,
  settleSpeedMps: 0.15,
  yawTriggerDeg: 30,
  yawReleaseDeg: 55,
  reachMarginM: 0.02,
  swing: { minS: 0.2, maxS: 0.34, maxSpeedMps: 3.5, travelSpeedK: 2.5, clearanceM: 0.07, maxLiftRateMps: 1.5, leadS: 0.12, maxYawRateDegPerS: 360 },
  minSeparationM: 0.14,
  maxStepFromHipM: 0.3,
  rejoinMps: 1.5,
  clipPlantWeight: 0.95,
  leadLateralMps: 0.2,
  leadLateralFrac: 0.5,
};

/**
 * Plan 08 planner: FOOTWORK_L2's plant, reach, swing and clearance numbers with the transition composition added. Motor,
 * support and plant confirmation are untouched.
 */
export const FOOTWORK_L3: FootworkProfile = {
  ...FOOTWORK_L2,
  id: 'footwork-l3-v3',
  settleTriggerM: 0.09,
  compose: { followRadPerS: 18, liftRadPerS: 24, brakeEnterB: 0.6, brakeExitB: 0.25, brakeEnterMps: 5, arriveS: 0.05, landOffsetM: 0.12, stepAheadS: 0.25, landWithinS: 0.12, landGapS: FOOTWORK_L2.swing.minS / 2, ...stepAccelLimits(FOOTWORK_L2.swing) },
};

export type FootMode = 'planted' | 'swing' | 'airborne';
/** Why a plant ended or a foot changed mode (traced and emitted). */
export type FootReason =
  | 'step'
  | 'settle'
  | 'yaw'
  | 'reach'
  | 'clearance'
  | 'separation'
  | 'slide'
  | 'liftoff'
  | 'clipSwing'
  | 'continue'
  | 'supportLost'
  | 'falling'
  | 'ragdoll';

/** Plan 10f (F10): one part of a planner step's target motion: velocity and acceleration. */
export interface StepMotion<T> {
  readonly v: T;
  readonly a: T;
}

export interface FootState {
  mode: FootMode;
  /** Planted, proposed this substep (or at initialization) and not yet confirmed by an achieved solve. */
  tentative: boolean;
  /** Solves the confirmed plant has survived after its confirmation (0: confirmed in the last solve). */
  solves: number;
  /** The last observed solve was a failed proposal: no new proposal until a fresh (non-plant) solve is observed. */
  stale: boolean;
  /** Clip or reactive stance eligibility of this substep (coverage): see FootPlan.stats.cover. */
  eligible: boolean;
  /** Last failed proposal: reason and time; proposals and failures of this foot. */
  failReason: FootReason | null;
  failAtS: number;
  attempts: number;
  fails: number;
  /** Swing source: a planner step trajectory, or following the clip / procedural request with a decaying offset. */
  source: 'step' | 'follow';
  /** Planted: heel point (sole point below the ankle) on the ground, heading (rad) and roll fraction; sole length toeZ. */
  heelW: Vec3 | null;
  headingRad: number;
  rollF: number;
  toeZ: number;
  /** Lateral sole offset (shoe frame x, m) of a corner pivot (pose: the shoe rolled onto a sole corner); 0 on the centre line. */
  edgeX: number;
  /** World anchor of the contact feature at the plant (drift reference) and the time it was planted. */
  anchorW: Vec3 | null;
  plantedAtS: number;
  /** Ankle target of the last request (world) and the request before it (speed). */
  target: Vec3;
  /** Planner step: destination (ankle, world), its heading, elapsed and duration (s), start distance (m). */
  dest: Vec3 | null;
  destHeadingRad: number;
  elapsedS: number;
  durS: number;
  stepM: number;
  why: FootReason | null;
  /** Follow: offset of the foot from the request it rejoins (world). */
  offset: Vec3;
  /** Plan 08 (profile compose): rate of the follow offset (m/s, world). */
  offsetV: Vec3;
  /** Composed: decaying foot angle offset (rad, toe up) from the achieved angle at the release, its rate; the achieved angle and the pose's base angle. */
  soleO: number;
  soleV: number;
  soleAngle: number;
  soleBase: number;
  /** Composed: the knee pole's weight of the foot heading, approaching 1 for a plant or a planner step, 0 following the request. */
  poleW: number;
  poleWV: number;
  /** Plan 08 composed: the share of the clip foot angle the foot keeps (a planner step lands flat, not on the clip's toes), and its rate. */
  soleW: number;
  soleWV: number;
  /** Plan 08 composed: times this foot's motion was reseeded from the achieved foot (a new owner, even of the same kind). */
  seeds: number;
  /** Plan 08 composed: substeps planned since the last reseed. */
  ownN: number;
  /** Plan 12 (heel lift): the part of the shown foot's floor lift its ankle range limit makes (m, up): the foot on its toe, not held off. */
  rangeLiftM: number;
  /** Plan 08 composed: the substep this carried step took over: its target is the old owner's, the path starts on the next. */
  carryFirst: boolean;
  /** Plan 08 composed: what the offset took up of a request seam or jump this substep (coordinates, not foot motion). */
  seamOffset: Vec3;
  /** Plan 08 composed: the request's velocity of the substep before this one. */
  requestWasV: Vec3;
  /** Plan 08 composed: this step took over the old owner's path of a held leg: no reseed, the leg's departure stays as it is. */
  carried: boolean;
  /**
   * Plan 08: a planner step's target velocity and acceleration (world), held apart (plan 10f, F10): the horizontal path's
   * (x and z; y is 0) and the vertical one's. Each is replaced whole on an update, never changed in place.
   */
  stepH: StepMotion<Vec3>;
  stepY: StepMotion<number>;
  /** Plan 08: the step target's horizontal motion of its last update (m/s, world): `stepH.v` is already 0 on arrival. */
  moveV: Vec3;
  /** Plan 08: time left of an arrival after the step's own time ran out (s). */
  lateS: number;
  /** Composed: the leg's candidate in the last pose (0 primary; anything else is a clearance departure). */
  variant: number;
  /** Composed: the step's height offset from its clearance arc (from its start height and rate) and its rate, decaying by touchdown. */
  liftO: number;
  liftV: number;
  /** Plan 08: this substep's request and its velocity (world); achieved ankle velocity of the last pose (m/s). */
  lastRequest: Vec3 | null;
  requestV: Vec3;
  ankleV: Vec3;
  /** Composed: the leg solve's request behind the achieved ankle (a request past the soft reach is not the ankle): a new owner starts here. */
  solvedW: Vec3;
  /** Settle step taken since the body became still (cleared when it moves). */
  settled: boolean;
  /** The current step drags along the turf (no clearance): a reach release while the other foot is in the air. */
  drag: boolean;
  /** Clip swing progress of the last clip-regime substep (null in clip stance or outside the clip regime). */
  clipSwingP: number | null;
  /**
   * Reactive regime, a free foot carried over the clip-to-procedural crossing (or one whose touchdown proposal after the
   * crossing failed) waiting for its turn: it plants where it is when it is on the ground, a fresh solve and reachable
   * with the reach margin; else its target is held where it was (not a plant: no anchor, no plant request; the leg
   * reaches it or not, measured) until it may take an ordinary step (one at a time: no step in progress and the other
   * foot held).
   */
  wait: boolean;
  /**
   * A swing inherited at the crossing continues as a planner step from its clip swing progress p0 (no restart); the
   * height it had above the step arc at p0 (m, signed) fades out over the rest of the step.
   */
  p0: number;
  liftExcessM: number;
  /** The step was retimed to a stance window (fitStance): at its end it touches down where it is when reachable. */
  short: boolean;
  /**
   * Carried over the clip-to-procedural crossing: a confirmed clip plant (held while its achieved solve keeps it, the
   * contact-feature check in observeFeet, not released by the flat-heel reach estimate of reactive plants: a rolled clip
   * contact reaches further than its heel point suggests; cleared when released), or a free foot and its continued swing
   * (cleared by its first confirmed plant or ordinary step).
   */
  inherited: boolean;
  /** A confirmed plant its solve released (observeFeet): the next reactive plan steps it at once (a drag if the other foot is not planted). */
  released: boolean;
  /** Last release / mode change reason and time. */
  releaseReason: FootReason | null;
  releaseAtS: number;
  /**
   * Diagnostics of the last pose: contact-feature error to the anchor (horizontal error and contact gap combined), its
   * parts, drift since the plant (max error), IK residual, commanded target speeds (planner steps: the swing target;
   * following: the offset decay) and the follow target's speed (clip / procedural request motion, not commanded here).
   */
  featureErrM: number;
  featureHzM: number;
  gapM: number;
  driftM: number;
  residualM: number;
  speedMps: number;
  liftRateMps: number;
  followMps: number;
  /** Achieved ankle, shoe frame and contact feature (world) of the last pose. */
  ankleW: Vec3;
  footQ: { x: number; y: number; z: number; w: number };
  featureW: Vec3;
  /** Set when a plant was released after the pose: the next plan rejoins from the achieved ankle. */
  rejoin: boolean;
}

export interface FootPlan {
  profile: FootworkProfile;
  /** Shoe box (ragdoll profile): half extents and centre offset from the ankle in the shoe frame (contact gap). */
  shoe: { he: Vec3; centerFoot: Vec3 };
  feet: Record<ArmSide, FootState>;
  /** Plant reach limit (hip-ankle request distance whose soft-reach clamp stays within plantTolM), m. */
  reachM: number;
  /** Side last stepped (alternation). */
  lastStep: ArmSide | null;
  /** The last supported substep was in the clip regime (the next reactive substep is a clip-to-procedural crossing). */
  clipLast: boolean;
  /** Plan 08: the planner holds the legs while the clip still plays (braking: profile compose). */
  brakeHeld: boolean;
  /** Plan 08: the planner holds the legs against a playing clip; they just came back and the clip phase should rejoin the feet. */
  legsHeld: boolean;
  /** Plan 08 composed: the support state the last request was built on. */
  composition?: string;
  clipBack: boolean;
  initialized: boolean;
  /** Substep of the last plan (s): coverage accumulation in observeFeet. */
  dtS: number;
  /**
   * Running extremes and counts over every substep since reset (evidence): smallest margin of a planner step's
   * horizontal target speed below its cap (m/s; negative = over), largest step lift rate and follow-offset decay rate
   * (m/s), largest confirmed-plant contact-feature error (m) over samples that kept the plant (the sample that releases
   * it is in its footRelease event). Touchdown proposals, confirmed plants, failed proposals and the largest failed
   * proposal error (m, measured ones only), sustained intervals (confirmed plants that survived a later solve). Per foot
   * coverage: eligible stance time (clip regime: inside the clip stance interval at the plant contact weight; reactive:
   * supported and not in a planner step) and the part of it confirmed planted (s).
   */
  stats: {
    stepCapMarginMps: number;
    liftRateMps: number;
    offsetDecayMps: number;
    plantErrM: number;
    attempts: number;
    confirmed: number;
    failed: number;
    failedErrM: number;
    sustained: number;
    cover: Record<ArmSide, { eligibleS: number; plantedS: number }>;
  };
}

export interface FootEvent {
  type: 'footPlant' | 'footRelease' | 'footSwing' | 'footPlantFailed';
  side: ArmSide;
  data: Record<string, unknown>;
}

const SIDES: ArmSide[] = ['left', 'right'];
const hz = (a: Vec3): Vec3 => v3(a.x, 0, a.z);
const dirOf = (h: number): Vec3 => v3(Math.sin(h), 0, Math.cos(h));

function newFoot(): FootState {
  return {
    mode: 'airborne',
    tentative: false,
    solves: 0,
    stale: false,
    eligible: false,
    failReason: null,
    failAtS: 0,
    attempts: 0,
    fails: 0,
    source: 'follow',
    heelW: null,
    headingRad: 0,
    rollF: 0,
    toeZ: 0,
    edgeX: 0,
    anchorW: null,
    plantedAtS: 0,
    target: v3(),
    dest: null,
    destHeadingRad: 0,
    elapsedS: 0,
    durS: 0,
    stepM: 0,
    why: null,
    offset: v3(),
    offsetV: v3(),
    soleO: 0,
    soleV: 0,
    soleAngle: 0,
    soleBase: 0,
    poleW: 1,
    poleWV: 0,
    soleW: 1,
    soleWV: 0,
    seeds: 0,
    ownN: 0,
    rangeLiftM: 0,
    carried: false,
    carryFirst: false,
    seamOffset: v3(),
    requestWasV: v3(),
    stepH: { v: v3(), a: v3() },
    stepY: { v: 0, a: 0 },
    moveV: v3(),
    lateS: 0,
    variant: 0,
    liftO: 0,
    liftV: 0,
    lastRequest: null,
    requestV: v3(),
    ankleV: v3(),
    solvedW: v3(),
    settled: false,
    drag: false,
    clipSwingP: null,
    wait: false,
    p0: 0,
    liftExcessM: 0,
    short: false,
    inherited: false,
    released: false,
    releaseReason: null,
    releaseAtS: 0,
    featureErrM: 0,
    featureHzM: 0,
    gapM: 0,
    driftM: 0,
    residualM: 0,
    speedMps: 0,
    liftRateMps: 0,
    followMps: 0,
    ankleW: v3(),
    footQ: { x: 0, y: 0, z: 0, w: 1 },
    featureW: v3(),
    rejoin: false,
  };
}

export function newFootPlan(profile: FootworkProfile, R: RagdollProfile): FootPlan {
  return {
    profile,
    shoe: { he: { ...R.shoe.halfExtents }, centerFoot: v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM) },
    feet: { left: newFoot(), right: newFoot() },
    reachM: plantReachM(R, profile.plantTolM),
    lastStep: null,
    clipLast: false,
    brakeHeld: false,
    legsHeld: false,
    clipBack: false,
    initialized: false,
    dtS: 0,
    stats: {
      stepCapMarginMps: Infinity,
      liftRateMps: 0,
      offsetDecayMps: 0,
      plantErrM: 0,
      attempts: 0,
      confirmed: 0,
      failed: 0,
      failedErrM: 0,
      sustained: 0,
      cover: { left: { eligibleS: 0, plantedS: 0 }, right: { eligibleS: 0, plantedS: 0 } },
    },
  };
}

/** Everything the planner reads for one player and substep (all from the solved state or the pose path). */
export interface FootPlanInput {
  t: number;
  dt: number;
  core: Pose;
  /** Solved horizontal velocity of the core (world, m/s) and yaw rate (rad/s). */
  vel: Vec3;
  yawRate: number;
  /** Support control: supported mode with a valid probe. `falling`: control mode falling. `ragdoll`: articulated. */
  supported: boolean;
  falling: boolean;
  ragdoll: boolean;
  groundY: number;
  /** Achieved hips (world) and the standing home of each ankle (world, ground + sole height, stagger applied). */
  hips: Record<ArmSide, Vec3>;
  home: Record<ArmSide, Vec3>;
  /** Ordinary leg request of this substep (world ankle, before stance IK): what a following foot rejoins. */
  request: Record<ArmSide, Vec3>;
  /**
   * Clip regime (weight > 0): per foot inside its clip stance interval, its clip contact weight and roll fraction, and its
   * clip swing progress (0 at the clip liftoff, 1 at the next touchdown; null in stance).
   */
  clip: {
    weight: number;
    headingRad: number;
    stance: Record<ArmSide, boolean>;
    contact: Record<ArmSide, { weight: number; rollF: number; toeZ: number } | null>;
    swingP?: Record<ArmSide, number | null>;
  } | null;
  /** Sole height of the flat shoe (ankle above the ground), m; default shoe toe length (sole), m. */
  soleM: number;
  toeM: number;
  /** Body lateral axis sign (world right = +1 side), for the no-crossing rule: sideSign(s) * dot(p, right). */
  rightW: Vec3;
  sideSign: Record<ArmSide, number>;
  /** Plan 08: filtered braking blend of the support (0..1; 0 without a braking stance). */
  brakeB?: number;
  /** Plan 08: contact mode: the feet follow the actual movement, the clip (still fading) has no say. */
  contactHold?: boolean;
  /**
   * Plan 12 (a joint-range profile): a touchdown of a foot tilted toe down past its planned contact (the shoe at the
   * ankle range limit, the shin leaning past it) lands on the ball of the foot: its lowest sole corner.
   */
  heelLift?: boolean;  /** Plan 10f (F2): this simulation's foot plan switches (`SimOptions.debug.foot`); absent: all off. */
  debug?: FootDebug;
}

/** Contact feature (world) of a planted foot at its roll fraction. */
export function plantFeature(f: FootState): Vec3 {
  return addScaled(addScaled(f.heelW!, dirOf(f.headingRad), f.toeZ * f.rollF), v3(Math.cos(f.headingRad), 0, -Math.sin(f.headingRad)), f.edgeX);
}

/**
 * End a plant. A confirmed plant emits footRelease (its drift includes the releasing sample; `solves` = later solves it
 * survived). A tentative one was never a plant: it is a failed proposal (footPlantFailed, counted), no touchdown/liftoff.
 */
function release(plan: FootPlan, f: FootState, why: FootReason, t: number, ev: FootEvent[], side: ArmSide, extra: Record<string, unknown> = {}): void {
  if (f.mode === 'planted' && f.tentative) {
    failProposal(plan, f, why, t, ev, side, extra);
    return;
  }
  if (f.mode === 'planted') {
    ev.push({ type: 'footRelease', side, data: { reason: why, driftM: round(f.driftM, 5), featureErrM: round(f.featureErrM, 5), plantedS: round(t - f.plantedAtS, 5), solves: f.solves, ...extra } });
    f.releaseReason = why;
    f.releaseAtS = t;
  }
  f.heelW = null;
  f.anchorW = null;
  f.inherited = false;
}

function failProposal(plan: FootPlan, f: FootState, why: FootReason, t: number, ev: FootEvent[], side: ArmSide, extra: Record<string, unknown>): void {
  const at = f.anchorW ? [round(f.anchorW.x, 4), round(f.anchorW.y, 4), round(f.anchorW.z, 4)] : null;
  ev.push({ type: 'footPlantFailed', side, data: { reason: why, at, rollF: round(f.rollF, 4), ...extra } });
  plan.stats.failed++;
  if (typeof extra.errM === 'number') plan.stats.failedErrM = Math.max(plan.stats.failedErrM, extra.errM);
  f.fails++;
  f.failReason = why;
  f.failAtS = t;
  f.tentative = false;
  f.heelW = null;
  f.anchorW = null;
}

/** Composed: a step's own path and the request's agree on this substep's foot within one handover. */
function joinsRequest(plan: FootPlan, s: ArmSide, inp: FootPlanInput): boolean {
  if (inp.debug?.noJoinCheck) return true;
  const t = trialOf(plan, s);
  advanceStep(t, s, inp);
  // plan 12 (heel lift): the pose holds a step at its ankle range limit up off the floor (its floor lift) and the follow
  // path starts from that achieved request: the step is compared at the height it is shown (L3-F7-phase25: R's right
  // step, held 6 cm up, never joined the clip again)
  const f = plan.feet[s];
  const up = inp.heelLift ? Math.max(0, f.solvedW.y - f.target.y) : 0;
  return dist(add(t.feet[s].target, v3(0, up, 0)), followNext(plan, s, inp, true)) <= HANDOVER_M;
}

/**
 * Plan one substep: mode transitions and the foot requests for the leg solve. `observeFeet` must follow the pose.
 * Deterministic: depends only on the plan state and the input.
 */
export function planFeet(plan: FootPlan, inp: FootPlanInput, ev: FootEvent[]): Record<ArmSide, FootRequest> {
  const P = plan.profile;
  const out = {} as Record<ArmSide, FootRequest>;
  const bodyHeading = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
  const speed = len(hz(inp.vel));
  plan.dtS = inp.dt;
  takeRequests(plan, inp, `${inp.supported}:${inp.falling}`);
  // ---------------- no support: no anchors, no new plants (airborne feet follow the request with a decaying offset)
  if (!inp.supported || inp.ragdoll) {
    const why: FootReason = inp.ragdoll ? 'ragdoll' : inp.falling ? 'falling' : 'supportLost';
    for (const s of SIDES) {
      const f = plan.feet[s];
      // plan 08: losing support takes a composed step's destination, not its path; a leg held off its target keeps its path too
      const onPath = !!P.compose && f.mode === 'swing' && !f.wait && !f.rejoin && f.source === 'step';
      const held = !!P.compose && f.mode === 'swing' && !f.wait && !f.rejoin && f.source === 'follow' && heldOff(plan, f);
      f.rejoin = false;
      f.eligible = false;
      f.wait = false;
      f.inherited = false;
      f.clipSwingP = null;
      if (f.mode !== 'airborne') {
        release(plan, f, why, inp.t, ev, s);
        ev.push({ type: 'footSwing', side: s, data: { mode: 'airborne', reason: why } });
        f.mode = 'airborne';
        f.dest = null;
        // (a step out of time has arrived on paper: its motion is the one it last moved at)
        if (onPath && f.elapsedS >= f.durS) f.stepH = { v: v3(f.moveV.x, 0, f.moveV.z), a: f.stepH.a };
        if (held) {
          carryPath(plan, s, inp);
          f.source = 'step';
        } else if (!onPath) {
          if (P.compose && !canFollow(plan, f)) {
            f.source = 'step';
            seedStep(plan, f);
          } else {
            f.source = 'follow';
            seedFollow(plan, f, inp.request[s]);
          }
        }
      }
      if (P.compose && f.source === 'step') {
        if (canFollow(plan, f) && handsOn(plan, f)) {
          f.source = 'follow';
          seedFollow(plan, f, inp.request[s]);
        } else {
          if (!f.carryFirst) chase(plan, s, inp);
          f.carryFirst = false;
          out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
          continue;
        }
      }
      decayOffset(plan, f, inp.dt);
      f.target = add(inp.request[s], f.offset);
      out[s] = { kind: 'offset', offsetW: f.offset };
    }
    finishSole(plan, out, inp.dt);
    plan.clipLast = false;
    return out;
  }
  // plan 08: while braking the planner takes the legs at a held foot and keeps them until the brake lets go (the crossing
  // below runs from there, with the clip still fading: a swing continues as a planner step that lands ahead of the hips)
  const C = P.compose;
  if (C) {
    const b = inp.brakeB ?? 0;
    // the planner takes the legs only if the foot in the air can land, within the lift rate, before the held foot runs out
    // of reach: otherwise the held foot is released with the other still up, and the two legs land together
    const handsOver = (s: ArmSide): boolean => {
      const f = plan.feet[s];
      const o = plan.feet[other(s)];
      if (f.mode !== 'planted' || f.tentative) return false;
      return o.mode === 'planted' || descentS(plan, o, inp) <= reachTimeLeft(plan, f, inp.hips[s], hz(inp.vel), inp.soleM, inp.heelLift);
    };
    if (!inp.clip) plan.brakeHeld = false;
    else if (plan.brakeHeld) plan.brakeHeld = b >= C.brakeExitB;
    else plan.brakeHeld = b >= C.brakeEnterB && speed <= C.brakeEnterMps && SIDES.some(handsOver);
  }
  const clip = plan.brakeHeld || inp.contactHold ? null : inp.clip;
  // plan 08: the planner held the legs against a playing clip: on their return the clip takes the phase of the achieved feet
  if (C && clip) {
    plan.clipBack ||= plan.legsHeld;
    plan.legsHeld = false;
  } else if (C && inp.clip) plan.legsHeld = true;
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.rejoin) {
      // a plant released after the last pose continues from the achieved ankle: it follows if the request is moving near enough
      // to its motion, else it steps
      f.rejoin = false;
      if (C && !canFollow(plan, f)) startStep(plan, s, inp, 'step', ev);
      else {
        f.source = 'follow';
        seedFollow(plan, f, inp.request[s]);
      }
    }
    // support regained: an airborne foot does not snap down; it swings to its home (reactive) or follows the clip
    if (f.mode === 'airborne') {
      const onPath = !!C && f.source === 'step';
      f.mode = 'swing';
      if (clip && (!C || canFollow(plan, f))) startFollow(plan, f, inp.request[s]);
      else startStep(plan, s, inp, 'settle', ev, false, onPath);
      ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: f.source, reason: 'supportRegained' } });
    }
  }
  if (clip) {
    // ---------------- clip regime: plants follow the clip stance annotations
    plan.clipLast = true;
    for (const s of SIDES) {
      const f = plan.feet[s];
      const c = clip.contact[s];
      f.clipSwingP = clip.swingP?.[s] ?? null;
      f.wait = false;
      f.inherited = false;
      f.released = false;
      if (f.mode === 'planted') {
        if (!clip.stance[s]) {
          // plan 08: while the clip comes in a held foot stays until the other foot is down or it runs out of reach
          const o = plan.feet[other(s)];
          const reachable = dist(plantedAnkle(f, inp.soleM, inp.heelLift), inp.hips[s]) <= plan.reachM;
          const holds = !!C && !f.tentative && reachable && ((clip.weight < 1 && !(o.mode === 'planted' && !o.tentative)) || f.solves * inp.dt < C.landWithinS);
          if (!holds) {
            release(plan, f, 'liftoff', inp.t, ev, s);
            f.mode = 'swing';
            // composed: a request already running away from the foot is not followed from rest: the foot steps
            if (C && !canFollow(plan, f)) startStep(plan, s, inp, 'liftoff', ev);
            else startFollow(plan, f, inp.request[s]);
          }
        } else if (c) {
          f.rollF = clamp(c.rollF, 0, 1);
          f.edgeX = 0;
        }
      } else {
        // plan 08: while the clip comes in a planner step lands if it is near touchdown (the clip phase was chosen for that
        // landing) or too far from the request to recover before its stance; a step the request is moving too differently
        // from always stays on its path (following would stop it dead)
        const landing = !!C && clip.weight < 1 && (f.durS - f.elapsedS <= C.landWithinS || dist(f.target, inp.request[s]) > P.rejoinMps * C.stepAheadS);
        if (f.source === 'step' && !(C && (landing || !canFollow(plan, f) || !handsOn(plan, f) || !joinsRequest(plan, s, inp)))) startFollow(plan, f, inp.request[s]);
        if (f.source === 'step') continue;
        // touchdown proposal: inside the stance interval, the clip contact made, the shoe on the ground where it is now
        // (a fresh achieved solve, not the failed proposal's), and the anchor reachable from the current hip with the
        // reach margin; the solve of this substep confirms it or not (observeFeet)
        if (clip.stance[s] && c && c.weight >= P.clipPlantWeight && len(f.offset) <= (C ? C.landOffsetM : P.plantTolM) && !f.stale && f.gapM <= P.plantTolM) {
          const rollF = clamp(c.rollF, 0, 1);
          // composed: where the moving foot is this substep, not where the last solve left it
          const here = C ? addScaled(f.ankleW, f.ankleV, inp.dt) : f.ankleW;
          const feat0 = add(here, qRot(f.footQ, v3(0, -inp.soleM, c.toeZ * rollF)));
          // plan 12: a foot tilted toe down past the clip's contact lands on the ball of the foot
          const ball = ballOfFoot(plan, f, inp, here, c.toeZ * rollF);
          const feat = ball ? ball.w : feat0;
          const ankleAt = add(here, v3(0, inp.groundY - feat.y, 0));
          if ((inp.debug?.noReachCheck || dist(ankleAt, inp.hips[s]) <= plan.reachM) && (!C || dist(here, followNext(plan, s, inp, false)) <= HANDOVER_M)) {
            if (ball) proposeOnCorner(plan, f, inp, clip.headingRad, ball, c.toeZ);
            else {
              f.featureW = feat;
              proposePlant(plan, f, inp, clip.headingRad, rollF, c.toeZ);
            }
          }
        }
      }
    }
  } else {
    // ---------------- reactive steps (no clip weight)
    const still = speed < P.settleSpeedMps && Math.abs(inp.yawRate) < 0.3;
    // clip-to-procedural crossing: every following foot is inherited, with its clip phase, achieved foot and contacts
    // (plants carry over unchanged and stay only while valid, below)
    const crossing = plan.clipLast;
    plan.clipLast = false;
    for (const s of SIDES) {
      const f = plan.feet[s];
      if (!still) f.settled = false;
      if (inp.debug?.legacyEntry) {
        if (f.mode === 'swing' && f.source === 'follow') startStep(plan, s, inp, 'step', ev);
        continue;
      }
      if (f.mode !== 'swing' || f.source !== 'follow') {
        f.wait = false;
        if (crossing && f.mode === 'planted' && !f.tentative) f.inherited = true;
        continue;
      }
      const cross = crossing;
      if (cross) {
        f.wait = true;
        f.inherited = true;
        // plan 08: the shoe of a high swing can point up or down: its projection is no heading. Composed (plan 10b): the
        // following foot already publishes the planner's heading (its knee pole, finishSole): it keeps it, and the new owner
        // turns it toward its destination at the yaw rate. Setting the body's here jumped the published pole at the crossing
        // (L3-F7-loadRelease D left 0.575 s: 19 degrees in one substep, enough to change the leg's clearance variant)
        if (!C) f.headingRad = headingOf(norm(hz(qRot(f.footQ, v3(0, 0, 1))), v3(0, 0, 1)));
        else if (inp.debug?.crossingBodyHeading) f.headingRad = bodyHeading;
      }
      if (!f.wait) {
        // outside the crossing a following foot (initialization, a failed touchdown, a released plant) steps now; a plant
        // its solve released while the other foot is not planted drags (a stumble), like a reach release
        const drag = f.released && plan.feet[other(s)].mode !== 'planted';
        f.released = false;
        startStep(plan, s, inp, 'step', ev, drag);
        continue;
      }
      // inherited / failed-proposal foot: an honest touchdown where it is (on the ground, a fresh solve, reachable from the
      // current hip); else, crossing in the air, its own clip swing continues as a planner step (no new lift); else it
      // waits for its turn (one ordinary step at a time, below)
      const ankleAt = add(f.ankleW, v3(0, inp.groundY - f.featureW.y, 0));
      // composed: a shoe moving more than the plant tolerance a substep cannot stay on its anchor: no proposal from it
      const settled = !C || len(hz(f.ankleV)) * inp.dt <= P.plantTolM;
      if (f.gapM <= P.plantTolM && !f.stale && settled && dist(ankleAt, inp.hips[s]) <= plan.reachM - P.reachMarginM) {
        f.wait = false;
        const heading = headingOf(norm(hz(qRot(f.footQ, v3(0, 0, 1))), v3(0, 0, 1)));
        // plan 12: a foot tilted toe down past the sole point below its ankle lands on the ball of the foot
        const ball = ballOfFoot(plan, f, inp, f.ankleW, 0);
        if (ball) proposeOnCorner(plan, f, inp, heading, ball, inp.toeM);
        else proposePlant(plan, f, inp, heading, 0, inp.toeM);
      } else if (cross && (f.gapM > P.plantTolM || !settled)) {
        f.wait = false;
        continueSwing(plan, s, inp, ev);
      }
    }
    for (const s of SIDES) plan.feet[s].clipSwingP = null;
    const swinging = SIDES.filter((s) => plan.feet[s].mode === 'swing');
    // planted feet: hard releases (reach, yaw) and step triggers
    const want: { s: ArmSide; why: FootReason; urgency: number }[] = [];
    for (const s of SIDES) {
      const f = plan.feet[s];
      // a proposal (initialization) is confirmed or failed by this substep's solve, not stepped from
      if (f.mode !== 'planted' || f.tentative) continue;
      const ankleAt = plantedAnkle(f, inp.soleM, inp.heelLift);
      const reach = dist(ankleAt, inp.hips[s]);
      const yawErr = Math.abs(wrapPi(bodyHeading - f.headingRad));
      // (where the foot stands is its footprint: a lifted heel turning about the ball of the foot does not move it, plan 12)
      const standAt = add(f.heelW!, v3(0, inp.soleM, 0));
      const err = len(hz(sub(standAt, inp.home[s])));
      if ((reach > plan.reachM && !f.inherited) || yawErr > rad(P.yawReleaseDeg)) {
        // the anchor is no longer valid: released now, swinging from where it is (no teleport)
        const why: FootReason = reach > plan.reachM ? 'reach' : 'yaw';
        release(plan, f, why, inp.t, ev, s, { reachM: round(reach, 4), yawErrDeg: round((yawErr * 180) / Math.PI, 2) });
        // with the other foot in the air the released foot drags on the turf (a stumble), not a second foot lifting
        const o = plan.feet[s === 'left' ? 'right' : 'left'];
        startStep(plan, s, inp, why, ev, o.mode !== 'planted');
        continue;
      }
      // plan 08: a foot ahead of its home along the travel is catching the body: it stays until the body has passed it
      const catching = !!C && speed > P.settleSpeedMps && dot(hz(sub(standAt, inp.home[s])), hz(inp.vel)) > 0;
      const sideErr = catching ? Math.abs(dot(hz(sub(standAt, inp.home[s])), v3(-inp.vel.z / speed, 0, inp.vel.x / speed))) : err;
      // (a fresh plant is held like one under a clip: it is not stepped from the moment it lands)
      const leaving = !!C && speed > P.settleSpeedMps && f.solves * inp.dt >= C.landWithinS && reachTimeLeft(plan, f, inp.hips[s], hz(inp.vel), inp.soleM, inp.heelLift) < C.stepAheadS;
      if (sideErr > P.stepTriggerM) want.push({ s, why: 'step', urgency: sideErr - P.stepTriggerM });
      else if (leaving) want.push({ s, why: 'reach', urgency: 0.5 * (C!.stepAheadS - reachTimeLeft(plan, f, inp.hips[s], hz(inp.vel), inp.soleM, inp.heelLift)) });
      else if (yawErr > rad(P.yawTriggerDeg)) want.push({ s, why: 'yaw', urgency: yawErr - rad(P.yawTriggerDeg) });
      else if (reach > plan.reachM - P.reachMarginM) want.push({ s, why: 'reach', urgency: reach - plan.reachM + P.reachMarginM });
      else if (still && !f.settled && err > P.settleTriggerM) want.push({ s, why: 'settle', urgency: (err - P.settleTriggerM) * 0.1 });
    }
    const held = (s: ArmSide): boolean => plan.feet[s].mode === 'planted' && !plan.feet[s].tentative;
    // a waiting foot takes the next ordinary step: when no step is in progress and the other foot is held (or both wait:
    // the one farther from its home goes first)
    const stepping = SIDES.some((s) => plan.feet[s].mode === 'swing' && plan.feet[s].source === 'step');
    const waiting = SIDES.filter((s) => plan.feet[s].mode === 'swing' && plan.feet[s].source === 'follow' && plan.feet[s].wait);
    if (!stepping && waiting.length) {
      const far = (s: ArmSide): number => len(hz(sub(plan.feet[s].target, inp.home[s])));
      const ready = waiting.filter((s) => held(other(s)));
      const pickS = ready.length ? ready[0] : waiting.length === 2 ? (far('right') > far('left') ? 'right' : 'left') : null;
      if (pickS) {
        startStep(plan, pickS, inp, 'step', ev);
        plan.feet[pickS].wait = false;
      }
    } else if (swinging.length === 0 && held('left') && held('right') && want.length) {
      // one foot at a time: the most urgent, then the foot that did not step last (alternation). Sideways travel is a
      // shuffle that leads with the foot on the travel side: when the lateral component dominates, a trigger on either
      // foot steps the lead foot out after a trailing step (or first) and closes the trailing foot after a lead step,
      // so a side step never starts by swinging the inside foot into the other leg
      want.sort((a, b) => b.urgency - a.urgency || (a.s === plan.lastStep ? 1 : -1));
      let pickS = want[0].s;
      let why = want[0].why;
      const lateral = dot(hz(inp.vel), inp.rightW);
      if (Math.abs(lateral) >= P.leadLateralMps && Math.abs(lateral) >= P.leadLateralFrac * speed) {
        const lead: ArmSide = inp.sideSign.right * lateral > 0 ? 'right' : 'left';
        const trail: ArmSide = lead === 'left' ? 'right' : 'left';
        pickS = plan.lastStep === lead ? trail : lead;
        why = want.find((w) => w.s === pickS)?.why ?? 'step';
      }
      release(plan, plan.feet[pickS], why, inp.t, ev, pickS);
      startStep(plan, pickS, inp, why, ev);
    }
  }
  // ---------------- requests
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode === 'planted') {
      out[s] = { kind: 'plant', heelW: f.heelW!, headingRad: f.headingRad, rollF: f.rollF, toeZ: f.toeZ, edgeX: f.edgeX };
      // (plan 12: a plant on the ball of the foot, its heel lifted, has its ankle where the leg holds it)
      f.target = plantedAnkle(f, inp.soleM, inp.heelLift);
      continue;
    }
    if (f.source === 'follow' && f.wait) {
      // waiting: the target held (no offset decay, not the request's procedural swing)
      f.speedMps = 0;
      f.liftRateMps = 0;
      f.followMps = 0;
      f.offset = sub(f.target, inp.request[s]);
      f.offsetV = v3();
      out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
      continue;
    }
    if (f.source === 'follow') {
      const o0 = f.offset;
      decayOffset(plan, f, inp.dt);
      const prev = f.target;
      f.target = add(inp.request[s], f.offset);
      f.speedMps = inp.dt > 0 ? len(hz(sub(f.offset, o0))) / inp.dt : 0;
      f.liftRateMps = inp.dt > 0 ? Math.abs(f.offset.y - o0.y) / inp.dt : 0;
      f.followMps = inp.dt > 0 ? len(hz(sub(f.target, prev))) / inp.dt : 0;
      if (!C) plan.stats.offsetDecayMps = Math.max(plan.stats.offsetDecayMps, inp.dt > 0 ? len(sub(f.offset, o0)) / inp.dt : 0);
      out[s] = { kind: 'offset', offsetW: f.offset };
      continue;
    }
    if (f.carryFirst) {
      f.carryFirst = false;
      f.elapsedS += inp.dt;
      out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
      continue;
    }
    if (advanceStep(plan, s, inp)) out[s] = { kind: 'plant', heelW: f.heelW!, headingRad: f.headingRad, rollF: f.rollF, toeZ: f.toeZ, edgeX: f.edgeX };
    else out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
  }
  // stance eligibility (coverage): clip stance at the plant contact weight; reactive: supported, not in a planner step
  for (const s of SIDES) {
    const f = plan.feet[s];
    const c = clip?.contact[s];
    f.eligible = clip ? !!(clip.stance[s] && c && c.weight >= P.clipPlantWeight) : !(f.mode === 'swing' && f.source === 'step');
  }
  finishSole(plan, out, inp.dt);
  return out;
}

/**
 * Plan 08 audit: what each foot's owner of the last substep would request now, had nothing changed hands. Runs on a copy of
 * the plan taken after that substep's observation (the live plan is never touched): the same request bookkeeping as
 * `planFeet`, then a plant stays on its anchor, a waiting foot on its held target, a following foot takes one more offset
 * update and a step one more trajectory update. A plant the last observation ended has no anchor to continue on: what
 * remains of that owner is the achieved foot and its motion.
 *
 * (Plan 10b: a step's update no longer stops dead when its time runs out, so the old path is compared as it is; the
 * `stepStopM` reference correction that stood in for that stop is gone.)
 */
export function continueOwners(copy: FootPlan, inp: FootPlanInput, was: Partial<Record<ArmSide, FootRequest>>): { requests: Record<ArmSide, FootRequest>; tookUp: Partial<Record<ArmSide, boolean>> } {
  const out = {} as Record<ArmSide, FootRequest>;
  const tookUp: Partial<Record<ArmSide, boolean>> = {};
  copy.dtS = inp.dt;
  for (const s of SIDES) {
    const last = copy.feet[s].lastRequest;
    tookUp[s] = !!last && inp.dt > 0 && dist(inp.request[s], last) / inp.dt > REQUEST_JUMP_MPS;
  }
  takeRequests(copy, inp);
  for (const s of SIDES) {
    const f = copy.feet[s];
    const q = was[s];
    if (f.mode === 'planted' && q?.kind === 'plant') out[s] = q;
    else if (f.rejoin) out[s] = { kind: 'target', ankleW: addScaled(f.solvedW, f.ankleV, inp.dt), headingRad: f.headingRad };
    else if (f.mode === 'airborne' && f.source === 'step') {
      chase(copy, s, inp);
      out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
    } else if (f.mode === 'swing' && f.source === 'step') {
      advanceStep(copy, s, inp);
      out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
    } else if (f.mode === 'swing' && f.wait) out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
    else {
      decayOffset(copy, f, inp.dt);
      out[s] = { kind: 'offset', offsetW: f.offset };
    }
  }
  finishSole(copy, out, inp.dt);
  return { requests: out, tookUp };
}

/**
 * Propose a plant where the foot's contact feature is now (on the ground below it): no jump to a plausible stance. The
 * proposal is tentative: this substep's solve runs with the plant request and observeFeet confirms it (footPlant) or
 * fails it (footPlantFailed).
 */
function proposePlant(plan: FootPlan, f: FootState, inp: FootPlanInput, headingRad: number, rollF: number, toeZ: number): void {
  const feat = v3(f.featureW.x, inp.groundY, f.featureW.z);
  plan.stats.attempts++;
  f.attempts++;
  f.mode = 'planted';
  f.tentative = true;
  f.solves = 0;
  f.source = 'step';
  f.headingRad = headingRad;
  f.rollF = rollF;
  f.toeZ = toeZ;
  f.edgeX = 0;
  f.heelW = addScaled(feat, dirOf(headingRad), -toeZ * rollF);
  f.anchorW = feat;
  f.plantedAtS = inp.t;
  f.dest = null;
  f.offset = v3();
  f.driftM = 0;
  f.featureErrM = 0;
}

/** Destination of a reactive step: under the hip predicted at touchdown, led along the actual travel, reach-bounded. */
function destination(plan: FootPlan, s: ArmSide, inp: FootPlanInput, remainS: number): Vec3 {
  const P = plan.profile;
  const v = hz(inp.vel);
  const hipTd = add(hz(inp.hips[s]), scale(v, remainS));
  const homeOff = hz(sub(inp.home[s], inp.hips[s]));
  let d = add(add(hipTd, homeOff), scale(v, P.swing.leadS));
  // reach at the stance height: the horizontal radius whose plant request stays inside the plant reach (less margin)
  const vert = inp.hips[s].y - (inp.groundY + inp.soleM);
  const rReach = Math.sqrt(Math.max(0, (plan.reachM - 2 * P.reachMarginM) ** 2 - vert * vert));
  const rMax = Math.min(P.maxStepFromHipM, rReach);
  const off = sub(d, hipTd);
  const L = len(off);
  if (L > rMax) d = addScaled(hipTd, off, rMax / L);
  // no crossing: keep the destination on its own side of the other foot by the minimum separation (body frame)
  const o = s === 'left' ? 'right' : 'left';
  const of = plan.feet[o];
  const other = of.mode === 'planted' ? add(of.heelW!, v3(0, inp.soleM, 0)) : of.target;
  const lat = (p: Vec3): number => dot(hz(p), inp.rightW) * inp.sideSign[s];
  const gap = lat(d) - lat(other);
  if (gap < P.minSeparationM) d = addScaled(d, inp.rightW, inp.sideSign[s] * (P.minSeparationM - gap));
  return v3(d.x, inp.groundY + inp.soleM, d.z);
}

const other = (s: ArmSide): ArmSide => (s === 'left' ? 'right' : 'left');

function startStep(plan: FootPlan, s: ArmSide, inp: FootPlanInput, why: FootReason, ev: FootEvent[], drag = false, onPath = false): void {
  const P = plan.profile;
  const f = plan.feet[s];
  f.mode = 'swing';
  f.source = 'step';
  f.why = why;
  f.elapsedS = 0;
  f.drag = drag;
  f.wait = false;
  f.inherited = false;
  f.p0 = 0;
  f.liftExcessM = 0;
  f.short = false;
  // plan 08: a foot already on a planner path keeps it; only its destination is new
  if (!onPath) seedStep(plan, f);
  if (P.compose) {
    f.liftO = f.target.y - (inp.groundY + inp.soleM);
    f.liftV = onPath ? f.stepY.v : f.ankleV.y;
  }
  const d0 = destination(plan, s, inp, P.swing.minS);
  const L = len(hz(sub(d0, f.target)));
  const vCap = P.swing.maxSpeedMps + P.swing.travelSpeedK * len(hz(inp.vel));
  f.durS = clamp(1.6 * (L / vCap) + P.swing.minS * 0.5, P.swing.minS, P.swing.maxS);
  fitStance(plan, s, inp);
  fitLanding(plan, s, inp);
  f.dest = destination(plan, s, inp, f.durS);
  f.stepM = len(hz(sub(f.dest, f.target)));
  f.destHeadingRad = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
  if (why === 'settle') f.settled = true;
  plan.lastStep = s;
  ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'step', reason: why, durS: round(f.durS, 4), stepM: round(f.stepM, 4), ...(drag ? { drag: true } : {}) } });
}

/**
 * Clip-to-procedural crossing, a foot in the air in its clip swing: the swing continues as a planner step from its clip
 * swing progress p0 (no new liftoff, no restart, no snap): the step starts at p0 from the current target, its remaining
 * time from the remaining distance, and the height it has above the step arc at p0 fades out over the rest of the step
 * (it lands at the step's touchdown, a proposal like any other).
 */
function continueSwing(plan: FootPlan, s: ArmSide, inp: FootPlanInput, ev: FootEvent[]): void {
  const P = plan.profile;
  const f = plan.feet[s];
  const p0 = clamp(f.clipSwingP ?? 0.5, 0, 0.9);
  f.mode = 'swing';
  f.source = 'step';
  f.why = 'continue';
  f.drag = false;
  f.wait = false;
  f.short = false;
  if (P.compose && heldOff(plan, f)) carryPath(plan, s, inp);
  else seedStep(plan, f);
  const vCap = P.swing.maxSpeedMps + P.swing.travelSpeedK * len(hz(inp.vel));
  // remaining time: what is left to do, the remaining distance to the (touchdown-time) destination and the descent from
  // the current height within the lift rate (smooth: peak rate 1.5 x mean), not a nominal fraction of a new step
  const h0 = Math.max(0, f.target.y - (inp.groundY + inp.soleM));
  let remS = P.swing.minS * (1 - p0);
  // composed: it keeps the time its descent takes
  const descent = P.compose ? descentS(plan, f, inp) : (1.5 * h0) / P.swing.maxLiftRateMps;
  const longest = P.compose ? Math.max(P.swing.maxS, descent) : P.swing.maxS;
  // (plan 10b) composed: and the time the step's acceleration limit needs for that distance (a minimum-jerk path peaks at
  // 5.77 x its distance / its time^2): a shorter time is no time the foot can keep (L3-F16-stop1.7 left 2.258 s: 0.70 m
  // in 0.105 s, about 3 x the limit)
  const aMax = P.compose ? stepAccelMax(P.compose, inp.vel) : Infinity;
  for (let i = 0; i < 3; i++) {
    const L = len(hz(sub(destination(plan, s, inp, remS), f.target)));
    remS = clamp(Math.max(1.6 * (L / vCap), Math.sqrt((MJ_PEAK_ACCEL * L) / aMax), descent), inp.dt, longest);
  }
  f.durS = remS / (1 - p0);
  f.elapsedS = p0 * f.durS;
  f.p0 = p0;
  f.dest = destination(plan, s, inp, remS);
  f.stepM = len(hz(sub(f.dest, f.target)));
  f.destHeadingRad = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
  f.liftExcessM = f.target.y - (inp.groundY + inp.soleM) - stepClearance(P, f) * Math.sin(Math.PI * p0) ** 2;
  if (P.compose) f.liftExcessM = 0; // the descent is a minimum-jerk path from the achieved height and rate (advanceStep)
  plan.lastStep = s;
  ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'step', reason: 'continue', durS: round(remS, 4), stepM: round(f.stepM, 4), p0: round(p0, 4) } });
}

/** Step clearance: by step length (short steps lift less), within what the lift rate allows over the step (quick steps). */
const stepClearance = (P: FootworkProfile, f: FootState): number =>
  f.drag ? 0 : Math.min(P.swing.clearanceM * clamp(f.stepM / 0.25, 0.35, 1), (P.swing.maxLiftRateMps * f.durS) / Math.PI);

/**
 * Quick steps: when the held other foot would leave its reach before this step ends (fast travel), the rest of the step
 * is retimed to the time that foot has left, as far as the remaining distance allows within the speed cap. The progress
 * is kept (no restart, no jump); only its rate changes. Smaller, quicker steps instead of a stance foot released while
 * this one is still in the air.
 */
function fitStance(plan: FootPlan, s: ArmSide, inp: FootPlanInput): void {
  const f = plan.feet[s];
  const os = other(s);
  const o = plan.feet[os];
  if (inp.debug?.noQuick || o.mode !== 'planted' || o.tentative || f.durS <= 0) return;
  const p = clamp(f.elapsedS / f.durS, 0, 1);
  const remain = (1 - p) * f.durS;
  const left = reachTimeLeft(plan, o, inp.hips[os], hz(inp.vel), inp.soleM, inp.heelLift);
  if (p >= 1 || !(left < remain)) return;
  // not below a quarter of the shortest nominal step (no vanishing shuffles): a window shorter than that releases the
  // stance foot (its hard reach release) while this one finishes
  // plan 08: a foot descending from a clip swing keeps the time its descent needs
  const C = plan.profile.compose;
  const descent = C && f.why === 'continue' ? descentS(plan, f, inp) : 0;
  // plan 12 (heel lift): nor below the time its horizontal path needs to arrive within its acceleration limit. A stance
  // foot rising onto its toes stays within reach longer, and shortening the step to it over all that time asked for more
  // than the path can do (L3-F16-runStop: R's left foot 9 substeps late at 6 m/s); the stance foot then leaves first
  const aMax = C ? stepAccelMax(C, inp.vel) : 0;
  const brake = inp.heelLift && C && f.dest ? boundedHorizon(HORIZONTAL, f.target, f.stepH.v, limitH(f.stepH.a, aMax), f.dest, inp.dt, inp.dt, aMax) : 0;
  const rem = Math.min(remain, Math.max(left, 0.25 * plan.profile.swing.minS, inp.dt, descent, brake));
  f.short = true;
  f.durS = rem / (1 - p);
  f.elapsedS = p * f.durS;
}

/**
 * Plan 10b (composed): the feet land one at a time. A step whose other foot is also a step in the air, and due to land no
 * later, keeps its landing at least `landGapS` after that foot's; a step whose other foot has just landed keeps the rest
 * of the gap, as far as that foot's reach allows. Touchdown comes on the first substep after the gap. Only the rate of the rest of the step changes (its
 * progress is kept), and only ever slower: a later landing stays within the step's limits. Before 10b the gap came from
 * the instant stop at the end of the late stretch (B1), which brought the earlier foot down at its destination
 * (L3-F16-stop1.7: left at 2.400 s, right at 2.513 s; with that stop gone, 4 ms apart).
 */
function fitLanding(plan: FootPlan, s: ArmSide, inp: FootPlanInput): void {
  const C = plan.profile.compose;
  const f = plan.feet[s];
  if (!C || f.durS <= 0 || f.elapsedS >= f.durS) return;
  const o = plan.feet[other(s)];
  const remain = f.durS - f.elapsedS;
  let need = 0;
  // (never past the time the held foot has left within its reach: a stance foot released with this one still up is
  // worse than a quick landing, fitStance)
  if (o.mode === 'planted') need = Math.min(C.landGapS - (inp.t - o.plantedAtS) + inp.dt, reachTimeLeft(plan, o, inp.hips[other(s)], hz(inp.vel), inp.soleM, inp.heelLift));
  else if (o.mode === 'swing' && o.source === 'step' && !o.wait && o.elapsedS < o.durS) {
    // (a foot past its time is not waited for: when it lands is not known; once it has, the case above holds)
    const left = o.durS - o.elapsedS;
    if (remain > left || (remain === left && s === 'right')) need = left + C.landGapS + inp.dt;
  }
  if (remain >= need) return;
  const p = f.elapsedS / f.durS;
  f.durS = need / (1 - p);
  f.elapsedS = p * f.durS;
}

/** Time (s) until a planted foot's anchor leaves the plant reach of a hip moving at `vel` (0: already out; Infinity: still). */
function reachTimeLeft(plan: FootPlan, f: FootState, hip: Vec3, vel: Vec3, soleM: number, heelLift?: boolean): number {
  const a = sub(plantedAnkle(f, soleM, heelLift), hip);
  const c = dot(a, a) - plan.reachM * plan.reachM;
  if (c >= 0) return 0;
  const vv = dot(vel, vel);
  if (vv < 1e-12) return Infinity;
  const b = dot(a, vel);
  return (b + Math.sqrt(b * b - vv * c)) / vv;
}

/**
 * The ankle of a planted foot as its reach and step triggers read it: over its footprint at the flat-foot height. Plan 12
 * (`heelLift`): a foot standing on a corner with its heel lifted (the achieved ankle above the flat-foot one) is read
 * where it is; its flat-foot ankle lies the corner's distance back along the footprint, nowhere the leg is.
 */
function plantedAnkle(f: FootState, soleM: number, heelLift?: boolean): Vec3 {
  const flat = add(f.heelW!, v3(0, soleM, 0));
  return heelLift && f.ankleW.y > flat.y + HEEL_LIFT_M ? f.ankleW : flat;
}

/**
 * A composed step touches down on the lowest sole corner of the achieved foot, where that corner is this substep: a foot
 * short of its target (at the reach limit, tilted with the shin) does not jump to the flat footprint below the target.
 */
function landOnCorner(plan: FootPlan, f: FootState, inp: FootPlanInput): void {
  // the step's own path this substep: the achieved foot is on it (advanceStep)
  proposeOnCorner(plan, f, inp, f.headingRad, lowestCorner(plan, f, inp, f.target), inp.toeM);
}

type SoleCorner = { x: number; z: number; y: number; w: Vec3 };

/** The lowest sole corner (shoe frame x, z; world point) of the achieved foot frame with its ankle at `here`. */
function lowestCorner(plan: FootPlan, f: FootState, inp: FootPlanInput, here: Vec3): SoleCorner {
  const { he, centerFoot } = plan.shoe;
  let low: SoleCorner = { x: 0, z: 0, y: Infinity, w: v3() };
  for (const x of [-he.x, he.x])
    for (const z of [centerFoot.z - he.z, centerFoot.z + he.z]) {
      const w = add(here, qRot(f.footQ, v3(x, -inp.soleM, z)));
      if (w.y < low.y) low = { x, z, y: w.y, w };
    }
  return low;
}

/** A touchdown proposal on one sole corner of the footprint (the corner on its anchor, the rest of the sole lifts). */
function proposeOnCorner(plan: FootPlan, f: FootState, inp: FootPlanInput, headingRad: number, low: SoleCorner, toeZ: number): void {
  f.featureW = low.w;
  const dir = dirOf(headingRad);
  const lat = v3(dir.z, 0, -dir.x);
  proposePlant(plan, f, inp, headingRad, low.z / toeZ, toeZ);
  f.edgeX = low.x;
  f.heelW = addScaled(f.heelW!, lat, -low.x);
}

/** Plan 12: how far (m) a toe corner must lie below the planned contact point before the touchdown is on it. */
const HEEL_LIFT_M = 0.002;

/**
 * Plan 12 heel lift (`FootPlanInput.heelLift`): with the shoe at its ankle range limit and the shin leaning past it, the
 * foot is tilted toe down and its lowest sole corner is at the toe, below the sole point (`featZ` along the sole) that a
 * flat foot lands on. A plant there could only be made by turning the whole foot onto that corner in one substep, which
 * the shown foot follows at its continuity rate and misses (a failed proposal, a slide). The touchdown is on the corner:
 * the ball of the foot, the heel lifted. Null when the profile is off or the foot is not tilted so.
 */
function ballOfFoot(plan: FootPlan, f: FootState, inp: FootPlanInput, here: Vec3, featZ: number): SoleCorner | null {
  if (!inp.heelLift) return null;
  const low = lowestCorner(plan, f, inp, here);
  const feat = add(here, qRot(f.footQ, v3(0, -inp.soleM, featZ)));
  return low.z > featZ && low.y < feat.y - HEEL_LIFT_M ? low : null;
}

/**
 * Advance a planner step one substep: retargeted destination, bounded horizontal and vertical target speeds. True when
 * the step proposed its touchdown.
 */
function advanceStep(plan: FootPlan, s: ArmSide, inp: FootPlanInput): boolean {
  const P = plan.profile;
  const f = plan.feet[s];
  const dt = inp.dt;
  const prev = f.target;
  // a drag (the other foot was in the air) lifts for the rest of its step once the other foot is held
  const o = plan.feet[other(s)];
  if (f.drag && o.mode === 'planted' && !o.tentative && !inp.debug?.noQuick) f.drag = false;
  fitStance(plan, s, inp);
  fitLanding(plan, s, inp);
  f.elapsedS += dt;
  const remainS = Math.max(0, f.durS - f.elapsedS);
  const C = P.compose;
  // composed: the destination stops moving for the last stretch, so the path arrives at rest; a step whose time ran out away
  // from it takes that stretch again, to a fresh destination (plan 10b: also when the stretch ran out with the foot still on
  // its way: the path no longer arrives in one substep, it slows within the step's acceleration limit)
  const arriving = !!C && f.dest !== null && (f.lateS > 0 || (remainS > 0 && remainS <= C.arriveS));
  if (!arriving) {
    f.dest = destination(plan, s, inp, remainS);
    // plan 08: a step shortened to the other foot's stance lands where it has got to, it does not run back to the nearer point
    const along = len(hz(inp.vel)) > 1e-6 ? dot(sub(prev, f.dest), norm(hz(inp.vel))) : 0;
    if (C && f.short && len(hz(inp.vel)) >= P.settleSpeedMps && along > 0) f.dest = addScaled(f.dest, norm(hz(inp.vel)), along);
    // a step held off its destination by another body lands where the leg has got to
    if (C && remainS <= 0 && f.variant !== 0) f.dest = v3(f.ankleW.x, f.dest.y, f.ankleW.z);
  }
  if (C && remainS <= 0 && f.lateS <= 0 && len(hz(sub(f.dest!, prev))) >= 1e-3) f.lateS = C.arriveS;
  const horizonS = remainS > 0 ? remainS + dt : Math.max(f.lateS, dt);
  if (C) f.lateS = Math.max(0, f.lateS - dt);
  f.destHeadingRad = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
  const p0 = f.durS > 0 ? clamp((f.elapsedS - dt) / f.durS, 0, 1) : 1;
  const p = f.durS > 0 ? clamp(f.elapsedS / f.durS, 0, 1) : 1;
  // horizontal: the remaining distance to the (retargeted) destination is covered along the remainder of a minimum-jerk
  // schedule in the step progress (the progress never restarts), capped in speed
  const mj = (x: number): number => x * x * x * (10 - 15 * x + 6 * x * x);
  const rem = hz(sub(f.dest!, prev));
  const rl = len(rem);
  const frac = p0 >= 1 || 1 - mj(p0) < 1e-12 ? 1 : (mj(p) - mj(p0)) / (1 - mj(p0));
  const vCap = P.swing.maxSpeedMps + P.swing.travelSpeedK * len(hz(inp.vel));
  let step = Math.min(rl * frac, rl, vCap * dt);
  let h = rl > 1e-12 ? addScaled(hz(prev), rem, step / rl) : hz(prev);
  if (C) {
    // minimum-jerk from the current position, velocity and acceleration to the destination (at rest) in the remaining
    // time, replanned every substep: the path keeps the foot's motion through a start, a retime and a retarget
    // (plan 10b: over at least the time its acceleration limit needs, so a step held back by its speed cap or out of
    // time slows down instead of stopping at its destination in one substep)
    // (the path starts from at most that acceleration: a stored one above it, from a path that had no such limit, is not kept)
    const aMax = stepAccelMax(C, inp.vel);
    const a0 = limitH(f.stepH.a, aMax);
    const T = boundedHorizon(HORIZONTAL, prev, f.stepH.v, a0, f.dest!, horizonS, dt, aMax);
    const x = quinticStep(prev.x, f.stepH.v.x, a0.x, f.dest!.x, T, dt);
    const z = quinticStep(prev.z, f.stepH.v.z, a0.z, f.dest!.z, T, dt);
    let move = v3(x.p - prev.x, 0, z.p - prev.z);
    const m = len(move);
    if (m > vCap * dt) move = scale(move, (vCap * dt) / m);
    h = add(hz(prev), move);
    step = len(move);
    f.stepH = { v: v3(x.v, 0, z.v), a: v3(x.a, 0, z.a) };
    // the speed cap took over: the next path starts from the accepted motion, with the planner's acceleration (plan 10b:
    // zeroed, every replan started from rest acceleration and a capped foot could not slow below the cap; L3-F16-runStop
    // R right 3.35 s ran 8 m/s past its destination and was still swinging at the end of the run)
    if (m > vCap * dt) f.stepH = { v: v3(move.x / dt, 0, move.z / dt), a: f.stepH.a };
  }
  // vertical: clearance arc over the step progress (sin^2: no vertical speed at liftoff and touchdown; short steps lift
  // less), rate-capped; a continued clip swing adds its inherited height above the arc, faded out by touchdown
  const clr = stepClearance(P, f);
  let yWant = inp.groundY + inp.soleM + clr * Math.sin(Math.PI * p) ** 2;
  if (f.liftExcessM !== 0) {
    const u = clamp((p - f.p0) / (1 - f.p0), 0, 1);
    yWant = Math.max(inp.groundY + inp.soleM, yWant + f.liftExcessM * (1 - u * u * (3 - 2 * u)));
  }
  if (C && (f.liftO !== 0 || f.liftV !== 0)) {
    // the start height and rate decay over the rest of the step (critically damped, ending by touchdown)
    const w = Math.min(0.5 / dt, Math.max(C.liftRadPerS, 6 / Math.max(remainS, dt)));
    f.liftV += (-w * w * f.liftO - 2 * w * f.liftV) * dt;
    f.liftO += f.liftV * dt;
    if (Math.abs(f.liftO) < 1e-4 && Math.abs(f.liftV) < 1e-3) f.liftO = f.liftV = 0;
    yWant = Math.max(inp.groundY + inp.soleM, yWant + f.liftO);
  }
  const liftCap = P.swing.maxLiftRateMps * dt;
  let y = prev.y + clamp(yWant - prev.y, -liftCap, liftCap);
  let ay: number | null = null;
  if (C && f.why === 'continue' && dt > 0) {
    // a continued clip swing descends along the minimum-jerk path from its achieved height and rate to the sole at rest
    const q = quinticStep(prev.y, endRateY(f, f.stepY.a, dt), f.stepY.a, inp.groundY + inp.soleM, horizonS, dt);
    y = prev.y + clamp(q.p - prev.y, -liftCap, liftCap);
    ay = q.a;
  }
  if (C && dt > 0) {
    // plan 10b: the stored vertical rate is the published one, whatever set the height (canFollow, chase and the lift
    // damper read it). Its acceleration: the path's own where a path set the height (kept at the lift cap, as at the
    // speed cap), else the published rate's change (0 where the lift cap held)
    const vy = (y - prev.y) / dt;
    const limited = Math.abs(y - prev.y) >= liftCap - 1e-12;
    f.stepY = { v: vy, a: ay ?? (limited ? 0 : (vy - f.stepY.v) / dt) };
  }
  f.moveV = dt > 0 ? scale(hz(sub(h, prev)), 1 / dt) : v3();
  f.target = v3(h.x, y, h.z);
  f.headingRad += clamp(wrapPi(f.destHeadingRad - f.headingRad), -rad(P.swing.maxYawRateDegPerS) * dt, rad(P.swing.maxYawRateDegPerS) * dt);
  f.speedMps = dt > 0 ? step / dt : 0;
  f.liftRateMps = dt > 0 ? Math.abs(y - prev.y) / dt : 0;
  if (dt > 0) {
    plan.stats.stepCapMarginMps = Math.min(plan.stats.stepCapMarginMps, vCap - f.speedMps);
    plan.stats.liftRateMps = Math.max(plan.stats.liftRateMps, f.liftRateMps);
  }
  // touchdown: progress complete, at the destination, the sole down; a step retimed to a stance window (a little step)
  // touches down where it is at the end of its time when that is within reach (else it continues to the destination)
  const down = f.target.y - (inp.groundY + inp.soleM) < 1e-4;
  // (plan 10b, composed: so does a step out of time whose foot, and its target, move no more than the plant tolerance a
  // substep (the settled test of an inherited foot's proposal). Before 10b the stop at the end of the late stretch put it
  // on a destination; without that stop a step whose destination kept moving, a leg held off by a tackler, chased it a
  // fresh stretch at a time and hovered: L3-F4-twoArm D, no plant from 0.48 s until its fall at 1.40 s)
  const settled = !!C && len(hz(f.ankleV)) * dt <= P.plantTolM && len(f.stepH.v) * dt <= P.plantTolM;
  const little = (f.short || (settled && remainS <= 0)) && dist(f.target, inp.hips[s]) <= plan.reachM - P.reachMarginM;
  // composed: and the achieved foot is on the ground on its primary leg (a leg held off by clearance comes down first: the
  // proposal starts from the achieved foot, however long that takes, no teleport to the target)
  // plan 12 heel lift: a foot at its ankle range limit is on the ground tilted, its ankle above the flat-foot target by
  // the floor lift: it has arrived when it is over the target, and it lands on the corner it stands on
  const lifted = !!inp.heelLift && f.ankleW.y > f.target.y;
  // (and, held up at the leg's reach, inside the plant reach margin: a plant there is pulled off its corner by the leg's
  // soft reach on its first solve, L3-F5-drag D's left foot 2.567 s)
  const arrived = lifted ? len(hz(sub(f.ankleW, f.target))) <= P.plantTolM && dist(f.ankleW, inp.hips[s]) <= plan.reachM - P.reachMarginM : dist(f.ankleW, f.target) <= P.plantTolM;
  if (p >= 1 && down && (len(hz(sub(f.dest!, f.target))) < 1e-3 || little) && (!C || (f.gapM <= P.plantTolM && f.variant === 0 && arrived))) {
    // (the step's own path this substep, level, at the achieved height: the foot moves on while it lands)
    if (C && lifted) proposeOnCorner(plan, f, inp, f.headingRad, lowestCorner(plan, f, inp, v3(f.target.x, f.ankleW.y, f.target.z)), inp.toeM);
    else if (C) landOnCorner(plan, f, inp);
    else {
      f.featureW = sub(f.target, v3(0, inp.soleM, 0));
      proposePlant(plan, f, inp, f.headingRad, 0, inp.toeM);
    }
    return true;
  }
  return false;
}

/**
 * Plan 08: how the achieved feet join a run clip that comes in: the foot that takes (or holds) the next stance, its
 * fore-aft offset from the hip at that stance along `dirW`, and the time until it is down. A planner step lands where its
 * destination is; otherwise the held foot furthest ahead. Null when neither foot is on or near the ground.
 */
export function clipJoin(plan: FootPlan, hips: Record<ArmSide, Vec3>, dirW: Vec3, vel: Vec3): { side: ArmSide; offsetM: number; delayS: number } | null {
  let held: { side: ArmSide; offsetM: number; delayS: number } | null = null;
  // two steps in the air: the clip's next stance is the later landing, the earlier foot is by then on its way off
  let landing: { side: ArmSide; offsetM: number; delayS: number } | null = null;
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode === 'swing' && f.source === 'step' && f.dest) {
      const delayS = Math.max(0, f.durS - f.elapsedS);
      if (!landing || delayS > landing.delayS) landing = { side: s, offsetM: dot(hz(sub(f.dest, add(hz(hips[s]), scale(vel, delayS)))), dirW), delayS };
      continue;
    }
    if (f.mode === 'planted') {
      const offsetM = dot(hz(sub(f.heelW!, hips[s])), dirW);
      if (!held || offsetM > held.offsetM) held = { side: s, offsetM, delayS: 0 };
    }
  }
  return landing ?? held;
}

/** Height of the lowest shoe-box corner above the ground (negative: penetration). */
function contactGap(plan: FootPlan, ankle: Vec3, q: { x: number; y: number; z: number; w: number }, groundY: number): number {
  const { he, centerFoot } = plan.shoe;
  const c = add(ankle, qRot(q, centerFoot));
  let low = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) low = Math.min(low, c.y + qRot(q, v3(sx * he.x, sy * he.y, sz * he.z)).y);
  return low - groundY;
}

/** Why a plant's achieved solve is not (or no longer) a valid plant: clearance alternative, reach clamp, separation, slide. */
function invalidWhy(f: FootState, info: NonNullable<PhysicalPose['legInfo']>[ArmSide]): FootReason {
  return info && info.variant !== 0 ? 'clearance' : info && info.softM > 0.5 * f.featureErrM ? 'reach' : Math.abs(f.gapM) >= f.featureHzM ? 'separation' : 'slide';
}

/**
 * After the pose: achieved contact feature, its error to the anchor and its drift, the leg residual.
 * - A proposal (tentative plant) is confirmed when its solve used the primary candidate, the request's reach clamp is
 *   within plantTolM and the contact-feature error is within plantTolM: footPlant (with the achieved error). Otherwise it
 *   fails (footPlantFailed: reason, errors) and the foot continues from the achieved ankle; the next proposal waits for
 *   a fresh solve.
 * - A confirmed plant whose feature left the anchor by more than plantTolM (reach clamp, floor lift, a clearance
 *   alternative) is released now with that reason (footRelease; its drift includes this sample); the foot then
 *   continues from the achieved ankle (no jump back to the anchor). One that holds counts a survived solve.
 * Coverage: eligible stance time and its confirmed-planted part accumulate per foot.
 */
export function observeFeet(plan: FootPlan, pose: PhysicalPose, soleM: number, groundY: number, ev: FootEvent[], t: number): void {
  for (const s of SIDES) {
    observeFoot(plan, s, pose, soleM, groundY, ev, t);
    const f = plan.feet[s];
    if (f.eligible && plan.dtS > 0) {
      plan.stats.cover[s].eligibleS += plan.dtS;
      if (f.mode === 'planted' && !f.tentative) plan.stats.cover[s].plantedS += plan.dtS;
    }
  }
}

function observeFoot(plan: FootPlan, s: ArmSide, pose: PhysicalPose, soleM: number, groundY: number, ev: FootEvent[], t: number): void {
  const P = plan.profile;
  const f = plan.feet[s];
  const ankle = pose.jointLandmarksWorld[`${s}Ankle`];
  const q = footFrame(pose, s);
  const info = pose.legInfo?.[s];
  if (P.compose) {
    f.ankleV = plan.dtS > 0 ? scale(sub(ankle, f.ankleW), 1 / plan.dtS) : v3();
    f.solvedW = info?.request ?? ankle;
    f.rangeLiftM = info?.rangeLiftM ?? 0;
    f.variant = info?.variant ?? 0;
    const z = qRot(q, v3(0, 0, 1));
    // measured in the leg's own sagittal plane, the one the next solve applies it in (a heading can lie across a high shoe)
    f.soleAngle = info?.soleAngle ?? Math.atan2(z.y, dot(z, dirOf(f.headingRad)));
    f.soleBase = info?.soleBase ?? 0;
  }
  f.ankleW = ankle;
  f.footQ = q;
  f.residualM = pose.targetResidualM?.[`${s}Leg`] ?? 0;
  f.gapM = contactGap(plan, ankle, q, groundY);
  // a plant pivoted on the other end of its footprint (pose: heel or toe on the anchor) is measured at that end
  if (f.mode === 'planted' && info?.rollF !== undefined) {
    f.rollF = info.rollF;
    f.edgeX = info.edgeX ?? 0;
  }
  const roll = f.mode === 'planted' ? f.rollF : 0;
  const toe = f.mode === 'planted' ? f.toeZ : 0;
  const ex = f.mode === 'planted' ? f.edgeX : 0;
  f.featureW = add(ankle, qRot(q, v3(ex, -soleM, toe * roll)));
  if (f.mode !== 'planted') {
    f.featureErrM = 0;
    f.featureHzM = 0;
    // a fresh achieved solve of a free foot: a new proposal may use it
    f.stale = false;
    return;
  }
  const anchor = plantFeature(f);
  f.featureHzM = len(hz(sub(f.featureW, anchor)));
  f.featureErrM = Math.hypot(f.featureHzM, f.gapM);
  f.driftM = Math.max(f.driftM, f.featureErrM);
  const detail = (): Record<string, unknown> => ({ softM: round(info?.softM ?? 0, 5), liftM: round(info?.liftM ?? 0, 5), gapM: round(f.gapM, 5), hzM: round(f.featureHzM, 5), variant: info?.variant ?? 0 });
  if (f.tentative) {
    const ok = f.featureErrM <= P.plantTolM && (!info || (info.variant === 0 && info.softM <= P.plantTolM));
    if (ok) {
      // the plant interval starts at its confirmation (an initialization proposal is confirmed one substep later)
      f.tentative = false;
      f.inherited = false;
      f.solves = 0;
      f.plantedAtS = t;
      plan.stats.confirmed++;
      plan.stats.plantErrM = Math.max(plan.stats.plantErrM, f.featureErrM);
      const a = f.anchorW!;
      ev.push({ type: 'footPlant', side: s, data: { at: [round(a.x, 4), round(a.y, 4), round(a.z, 4)], headingDeg: round((f.headingRad * 180) / Math.PI, 2), rollF: round(f.rollF, 4), errM: round(f.featureErrM, 5) } });
      return;
    }
    const why: FootReason = info && info.variant !== 0 ? 'clearance' : info && info.softM > P.plantTolM ? 'reach' : invalidWhy(f, info);
    failProposal(plan, f, why, t, ev, s, { errM: round(f.featureErrM, 5), ...detail() });
    f.stale = true;
    toFollow(f, ankle, why);
    // a foot carried over the crossing waits again (one step at a time); others step at once, as before
    f.wait = f.inherited;
    ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'rejoin', reason: why, failed: true } });
    return;
  }
  if (f.featureErrM > P.plantTolM) {
    const why = invalidWhy(f, info);
    release(plan, f, why, t, ev, s, detail());
    toFollow(f, ankle, why);
    f.released = true;
    ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'rejoin', reason: why } });
    return;
  }
  plan.stats.plantErrM = Math.max(plan.stats.plantErrM, f.featureErrM);
  f.solves++;
  if (f.solves === 1) plan.stats.sustained++;
}

/** A plant that ended after the pose continues from the achieved ankle (the next plan rejoins the request from it). */
function toFollow(f: FootState, ankle: Vec3, why: FootReason): void {
  f.mode = 'swing';
  f.source = 'follow';
  f.target = { ...ankle };
  f.dest = null;
  f.why = why;
  f.rejoin = true;
  f.wait = false;
}

/**
 * Initialize from the achieved pose (reset): a supported foot on the ground within reach proposes a plant where it is
 * (confirmed or failed by the next solve, like any touchdown); others follow. Emits nothing itself (`_ev` kept for the
 * call site's event buffer).
 */
export function initFeet(plan: FootPlan, pose: PhysicalPose, inp: FootPlanInput, _ev: FootEvent[]): void {
  for (const s of SIDES) {
    const f = plan.feet[s];
    const ankle = pose.jointLandmarksWorld[`${s}Ankle`];
    const q = footFrame(pose, s);
    f.ankleW = ankle;
    f.solvedW = ankle;
    f.footQ = q;
    f.target = { ...ankle };
    if (plan.profile.compose) f.headingRad = headingOf(qRot(inp.core.q, v3(0, 0, 1)));
    const c0 = inp.clip?.contact[s];
    f.featureW = add(ankle, qRot(q, v3(0, -inp.soleM, c0 ? c0.toeZ * clamp(c0.rollF, 0, 1) : 0)));
    f.mode = inp.supported ? 'swing' : 'airborne';
    f.source = 'follow';
    // the ankle offset of the achieved pose from the ordinary request (0 unless clamped): followed, then decayed
    f.offset = sub(ankle, inp.request[s]);
    f.gapM = contactGap(plan, ankle, q, inp.groundY);
    const onGround = f.gapM <= plan.profile.plantTolM;
    const clipStance = inp.clip ? inp.clip.stance[s] && (inp.clip.contact[s]?.weight ?? 0) >= plan.profile.clipPlantWeight : true;
    const reachable = dist(ankle, inp.hips[s]) <= plan.reachM - plan.profile.reachMarginM;
    // a proposal: the first solve with the plant request confirms or fails it (observeFeet)
    if (inp.supported && onGround && clipStance && reachable) {
      const c = inp.clip?.contact[s];
      const heading = inp.clip ? inp.clip.headingRad : headingOf(norm(hz(qRot(q, v3(0, 0, 1))), v3(0, 0, 1)));
      proposePlant(plan, f, inp, heading, c ? clamp(c.rollF, 0, 1) : 0, c ? c.toeZ : inp.toeM);
    }
  }
  plan.initialized = true;
}

/** Articulated (ragdoll) or removed: every anchor released with the reason; the plan stays airborne (no new plants). */
export function releaseFeet(plan: FootPlan, why: FootReason, t: number, ev: FootEvent[]): void {
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode === 'airborne') continue;
    release(plan, f, why, t, ev, s);
    ev.push({ type: 'footSwing', side: s, data: { mode: 'airborne', reason: why } });
    f.mode = 'airborne';
    f.source = 'follow';
    f.dest = null;
    f.rejoin = false;
    f.eligible = false;
  }
}

/**
 * Compact per-foot trace (mode, source, anchor, feature error, drift, residual, swing progress, target speeds; tn: a
 * proposal not yet confirmed, only before the first solve).
 */
export function footTrace(plan: FootPlan): Record<'l' | 'r', Record<string, unknown>> {
  const one = (f: FootState): Record<string, unknown> => ({
    m: f.mode === 'planted' ? 'P' : f.mode === 'swing' ? (f.source === 'step' ? 'S' : 'F') : 'A',
    a: f.anchorW ? [round(f.anchorW.x, 4), round(f.anchorW.z, 4)] : null,
    e: round(f.featureErrM, 5),
    eh: round(f.featureHzM, 5),
    gap: round(f.gapM, 5),
    d: round(f.driftM, 5),
    res: round(f.residualM, 4),
    p: f.mode === 'swing' && f.source === 'step' && f.durS > 0 ? round(Math.min(1, f.elapsedS / f.durS), 3) : null,
    v: round(f.speedMps, 3),
    vy: round(f.liftRateMps, 3),
    vf: round(f.followMps, 3),
    tg: [round(f.target.x, 4), round(f.target.y, 4), round(f.target.z, 4)],
    fy: round(f.featureW.y, 4),
    ...(f.mode === 'swing' && f.drag ? { dr: 1 } : {}),
    ...(f.mode === 'swing' && f.wait ? { wt: 1 } : {}),
    ...(f.mode === 'planted' && f.tentative ? { tn: 1 } : {}),
    ...(f.releaseReason ? { why: f.releaseReason } : {}),
  });
  return { l: one(plan.feet.left), r: one(plan.feet.right) };
}

