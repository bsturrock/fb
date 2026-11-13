// Versioned physical/control profiles. All numbers are authored engineering starting values, not athlete measurements.
import { v3, type Vec3 } from './vec';

export const SCHEMA_VERSION = 'tackling-v1.1';

// ---------------------------------------------------------------- body
export interface CompoundGeometry {
  support: { radius: number; halfHeight: number; center: Vec3 };
  torso: { center: Vec3; halfExtents: Vec3 };
  pelvis: { center: Vec3; halfExtents: Vec3 };
  head: { center: Vec3; radius: number };
}

export interface BodyProfile {
  id: string;
  kind: 'legacyCapsule' | 'upperBodyCompound';
  massKg: number;
  /** legacyCapsule geometry (also the visual reference size for the old fixtures). */
  legacy: { radius: number; halfHeight: number };
  /** upperBodyCompound geometry, relative to the proxy origin. */
  compound: CompoundGeometry;
  /** Mass distribution over compound colliders (sums to 1). Declared once; actual COM/inertia read from the engine. */
  massFractions: { support: number; torso: number; pelvis: number; head: number };
  /** Right shoulder landmark; left is mirrored in X. */
  shoulderRight: Vec3;
  /** Right hip landmark; left is mirrored in X. */
  hipRight: Vec3;
  neck: Vec3;
  headCenter: Vec3;
  /** Proxy origin Y when the support shape rests on the floor. */
  restOriginY: number;
  /** Virtual support radius for the Gate 3 balance-torque cap. */
  supportRadiusM: number;
  /** Shoulder-region classification radius around a shoulder landmark. */
  shoulderPatchRadiusM: number;
  /**
   * Measured-asset body (model-derived profiles only). Absent on the authored Gate 1-4 bodies, which keep right = +X
   * and their historical procedural pose; present, it gives the asset's anatomical side basis and pose references.
   */
  measured?: MeasuredBody;
}

export interface MeasuredBody {
  /** Calibration record identity (asset sha256 prefix). */
  calibrationId: string;
  /** Body-local X sign of the anatomical right side (-1: the GLB's Right* bones lie on -X while facing +Z). */
  rightSignX: 1 | -1;
  /** Pelvis-centre landmark (body-local). */
  pelvisMid: Vec3;
  /** Gait ankle target height (body-local Y). */
  ankleTargetY: number;
  /** Shoulder-to-palm-contact chain length; procedural arm targets are scaled by it (relative to the shoulder). */
  armChainM: number;
  /**
   * Arm self-clearance trunk: the body's own torso and pelvis skin as stacked convex pieces (body-local points, each
   * piece's convex hull). Read only under a fixture's `selfClearance` profile.
   */
  trunkHull?: Vec3[][];
  /** Glove tip distance from the wrist along the forearm axis (m): the fingers' extent in the arm self-clearance shapes. */
  handTipM?: number;
}

/**
 * Arm self-clearance (opt-in per fixture; absent = arms ignore their own body, as on every historical path). The own
 * trunk is the body's measured `trunkHull` (mesh-fit convex pieces), never the padded proxy boxes: only the forearm and
 * palm are kept out of it (the upper arm hangs from the shoulder against the trunk).
 */
export interface SelfClearanceProfile {
  id: string;
  /** Forearm/palm depth in the own trunk (m) still counted as clear: skin contact, not a crossing. */
  toleranceM: number;
  /** Ragdoll: each forearm body also collides with massless copies of the trunk pieces on its own core. */
  ragdoll: boolean;
  /**
   * Ladder 11d (absent: false): a supported arm's continuity step is pushed out of its own trunk with that share halved
   * each time it turns against the share before it. The step's target is pushed up to four times; a forearm lying across
   * the seam between two trunk pieces was pushed fully into the other piece's normal each time, so the side the last
   * push left it on followed where the step started, and the pushed target is the next step's start: the palm went to
   * and fro 1.2 to 1.5 cm every substep (L3-F9-convert-contact D's left arm from 0.63 to 0.78 s). Halved, the pushes
   * settle in the seam. Another body's share is taken in full, as before.
   */
  seamSettle?: true;
  /**
   * Ladder 13c (absent: false): the supported arms' self shapes take the upper arm's distal half too (`armSelfShapes`
   * `upper`: from the bone's middle to the elbow, as the visible meter's upperArmD, at the forearm's radius, the elbow's
   * thickness), so clip, procedural and arm-task arms keep the upper arm and elbow out of the own trunk as they keep the
   * forearm: in each candidate's depth, the arm task's validity and the continuity push, whose pushed target is then kept
   * within the arm's reach of its shoulder. The ragdoll's self colliders are unchanged (forearms only).
   */
  upperArm?: true;
  /**
   * Ladder 14b (absent: false): a composed arm another body has met keeps its clip swing (`CLIP_ARM_HELD_DEPARTURE`).
   * Before, a clip arm whose swing-out found nothing clear took a body-fixed alternative, and the continuity step toward it
   * was a departure from the clip's target carried with that target: as the run's swing moved on, the departure went with
   * it, across the chest (L3-F16-contactStop: the defender's left forearm 10 cm into its own trunk at 0.567 s), and each
   * push-out the arm could not follow was kept as the next step's start, walking the target on (past 1 m). With this, from
   * the arm's primary meeting another body until its departure is back on the chosen pose: a clip arm is moved off the
   * other body only continuously (the swing-out, the continuity push), never sent to an alternative while its own arm is
   * clear of its trunk; its departure also moves toward the chosen pose as fast as the clip's target moves (so it rejoins
   * the swing with no jump); a push that leaves it invalid is not kept; and, squeezed between the other body and its own
   * trunk, a met arm (clip or procedural) gives up as much of its departure as would carry it into its trunk and is not
   * pushed into its chest by the other body (the push loses its share toward the trunk). Arm tasks, and arms nothing has
   * met (a free run's carry tuck), are unchanged.
   */
  clipArmSwing?: true;
  /**
   * Ladder 16b (absent: false): a composed arm another body has met keeps its natural pose (`MET_ARM_FIXED_ALTERNATIVE`).
   * Before, a met arm whose swing-out found nothing clear of the other body took the first clear of eight body-fixed
   * alternatives, several of them raised (a palm at chest or head height), and travelled there at the continuity rate;
   * each push-out was kept as the next step's start and walked the target on (L3-F5-drag: the carrier's left hand in
   * its facemask from 0.8 s, its target 1.5 m off its request by 2.7 s). With this, for a composed arm of a locomotion
   * pose (clip, procedural, brace, ready hands or the ball's carry tuck), from its request meeting another body until
   * its departure is back on the chosen pose (14b's gate), while its player's handoff is not deferred (then as
   * registered: pushed clear, so the retry converts):
   * - it keeps its request while no part of it is more than HARD_OK into another body (the depth a handoff accepts;
   *   another player's arm task included); past that it moves off only by the swing-out (to that depth, not to clear);
   *   when that does not reach it, it hangs at its side (the two hanging alternatives, the one chosen last kept, the
   *   request coming back once it is clear). Never a raised or forward alternative. The ball's carry arm keeps its tuck
   *   whatever presses it (pressed into the other body, not lifted with the ball);
   * - its shown departure moves at most CONT_FAST_MPS a substep, whatever moves it (the let-go as fast as its request
   *   moves, 14b's rule for a clip arm, now for a procedural one too; the give-up; the continuity step; the push);
   * - a push-out is never the next step's start, and never carries it deeper into its own trunk than `MET_ARM_OWN_M`;
   * - its own trunk bounds only a departure that would carry it more than `MET_ARM_OWN_M` into it (or deeper than the
   *   chosen pose): the departure is given up with its elbow pole, the arm is not pushed by its trunk.
   * Arm tasks and arms nothing has met are unchanged. With it, `clipArmSwing` changes nothing (14b's met-arm rules are
   * this one's).
   */
  metArmStay?: true;
}

export const SELF_CLEARANCE_V1: SelfClearanceProfile = { id: 'self-clearance-v1', toleranceM: 0.01, ragdoll: true };
/** Ladder 11d: V1 with the continuity push settling between own trunk pieces (`seamSettle`). */
export const SELF_CLEARANCE_V2: SelfClearanceProfile = { ...SELF_CLEARANCE_V1, id: 'self-clearance-seam-v2', seamSettle: true };
/** Ladder 13c: the id part `withUpperArmClearance` adds. */
export const UPPER_ARM_SELF_ID = 'upper-arm-v1';
/** Ladder 13c: `s` with the upper arm in the supported arms' self shapes (`upperArm`). */
export const withUpperArmClearance = (s: SelfClearanceProfile): SelfClearanceProfile => (s.upperArm ? s : { ...s, id: `${s.id}+${UPPER_ARM_SELF_ID}`, upperArm: true });
/** Ladder 14b: the id part `withClipArmSwing` adds. */
export const CLIP_ARM_SWING_ID = 'clip-swing-v1';
/** Ladder 14b: `s` with the composed clip arms keeping their swing (`clipArmSwing`). */
export const withClipArmSwing = (s: SelfClearanceProfile): SelfClearanceProfile => (s.clipArmSwing ? s : { ...s, id: `${s.id}+${CLIP_ARM_SWING_ID}`, clipArmSwing: true });
/** Ladder 14b: `s` without it, under the id it had before. */
export const withoutClipArmSwing = (s: SelfClearanceProfile): SelfClearanceProfile => {
  if (!s.clipArmSwing) return s;
  const { clipArmSwing: _c, ...rest } = s;
  return { ...rest, id: s.id.replace(`+${CLIP_ARM_SWING_ID}`, '') };
};
/** Ladder 16b: the id part `withMetArmStay` adds. */
export const MET_ARM_STAY_ID = 'met-arm-stay-v1';
/** Ladder 16b: `s` with a met arm keeping its natural pose (`metArmStay`). */
export const withMetArmStay = (s: SelfClearanceProfile): SelfClearanceProfile => (s.metArmStay ? s : { ...s, id: `${s.id}+${MET_ARM_STAY_ID}`, metArmStay: true });
/** Ladder 16b: `s` without it, under the id it had before. */
export const withoutMetArmStay = (s: SelfClearanceProfile): SelfClearanceProfile => {
  if (!s.metArmStay) return s;
  const { metArmStay: _m, ...rest } = s;
  return { ...rest, id: s.id.replace(`+${MET_ARM_STAY_ID}`, '') };
};
/** Ladder 13c: `s` without it, under the id it had before. */
export const withoutUpperArmClearance = (s: SelfClearanceProfile): SelfClearanceProfile => {
  if (!s.upperArm) return s;
  const { upperArm: _u, ...rest } = s;
  return { ...rest, id: s.id.replace(`+${UPPER_ARM_SELF_ID}`, '') };
};

const baseCompound: CompoundGeometry = {
  support: { radius: 0.16, halfHeight: 0.65, center: v3(0, -0.14, 0) },
  torso: { center: v3(0, 0.23, 0), halfExtents: v3(0.25, 0.29, 0.16) },
  pelvis: { center: v3(0, -0.08, 0), halfExtents: v3(0.2, 0.13, 0.15) },
  head: { center: v3(0, 0.79, 0), radius: 0.14 },
};

export function legacyCapsule(massKg = 100, id = `legacyCapsule/${massKg}kg`): BodyProfile {
  return {
    id,
    kind: 'legacyCapsule',
    massKg,
    legacy: { radius: 0.3, halfHeight: 0.65 },
    compound: structuredClone(baseCompound),
    massFractions: { support: 0.3, torso: 0.42, pelvis: 0.2, head: 0.08 },
    shoulderRight: v3(0.26, 0.5, 0),
    hipRight: v3(0.13, -0.05, 0),
    neck: v3(0, 0.64, 0),
    headCenter: v3(0, 0.79, 0),
    restOriginY: 0.95,
    supportRadiusM: 0.3,
    shoulderPatchRadiusM: 0.2,
  };
}

export interface CompoundVariant {
  massKg?: number;
  /** Torso half extents (x width, y height, z depth). */
  torsoHalf?: Vec3;
  /** Shoulder landmark half-width (x) and height (y). */
  shoulder?: { x: number; y: number };
  /** Forward offset of the head sphere (diagnostic forward-head posture). */
  headForwardM?: number;
  /** Virtual support radius for the Gate 3 balance-torque cap (default 0.16). */
  supportRadiusM?: number;
  tag?: string;
}

export function upperBodyCompound(variant: CompoundVariant = {}): BodyProfile {
  const massKg = variant.massKg ?? 100;
  const c = structuredClone(baseCompound);
  if (variant.torsoHalf) {
    // Keep the torso bottom where the pelvis meets it; grow upward.
    const bottom = c.torso.center.y - c.torso.halfExtents.y;
    c.torso.halfExtents = { ...variant.torsoHalf };
    c.torso.center = v3(0, bottom + variant.torsoHalf.y, 0);
  }
  const sh = variant.shoulder ?? { x: 0.26, y: 0.5 };
  const torsoTop = c.torso.center.y + c.torso.halfExtents.y;
  // Head sits above the torso top by the same neck gap as the base profile (0.79 - 0.52 = 0.27).
  c.head.center = v3(0, torsoTop + 0.27, variant.headForwardM ?? 0);
  const tag = variant.tag ?? 'std';
  return {
    id: `upperBodyCompound/${massKg}kg-${tag}`,
    kind: 'upperBodyCompound',
    massKg,
    legacy: { radius: 0.3, halfHeight: 0.65 },
    compound: c,
    massFractions: { support: 0.3, torso: 0.42, pelvis: 0.2, head: 0.08 },
    shoulderRight: v3(sh.x, sh.y, 0),
    hipRight: v3(0.13, -0.05, 0),
    neck: v3(0, torsoTop + 0.12, 0),
    headCenter: { ...c.head.center },
    restOriginY: 0.95,
    supportRadiusM: variant.supportRadiusM ?? 0.16,
    shoulderPatchRadiusM: 0.2,
  };
}

export const mirrorX = (p: Vec3): Vec3 => ({ x: -p.x, y: p.y, z: p.z });
/**
 * Body-local X sign of a side: +1 for right on the authored bodies (right = +X); a measured body uses its asset's
 * anatomical basis. Every side-dependent target, pole and side choice reads this, never a fixed `right = +1`.
 */
export function sideSignX(b: BodyProfile, side: 'left' | 'right'): number {
  return (side === 'right' ? 1 : -1) * (b.measured?.rightSignX ?? 1);
}
export function shoulderLocal(b: BodyProfile, side: 'left' | 'right'): Vec3 {
  return side === 'right' ? { ...b.shoulderRight } : mirrorX(b.shoulderRight);
}
export function hipLocal(b: BodyProfile, side: 'left' | 'right'): Vec3 {
  return side === 'right' ? { ...b.hipRight } : mirrorX(b.hipRight);
}

/** Core half-width/half-depth used by steering geometry (actual profile, not a universal constant). */
export function torsoHalf(b: BodyProfile): Vec3 {
  if (b.kind === 'legacyCapsule') return v3(b.legacy.radius, b.legacy.halfHeight, b.legacy.radius);
  return { ...b.compound.torso.halfExtents };
}
export function headRadius(b: BodyProfile): number {
  return b.kind === 'legacyCapsule' ? b.legacy.radius : b.compound.head.radius;
}

// ---------------------------------------------------------------- motors
export interface MotorProfile {
  id: string;
  maximumRequestedSpeedMps: number;
  maximumDriveForceN: number;
  velocityResponseTimeS: number;
  maximumYawTorqueNm: number;
  yawKp: number; // N m / rad
  yawKd: number; // N m s / rad
  /**
   * Plan 07 (user, 2026-11-05): optional braking limit. The drive component opposing the actual horizontal velocity is
   * capped at m x maxDecelMps2 (the ground can only brake the body that hard), after the vector force cap. Absent: the full
   * drive force also brakes (historical behaviour).
   */
  braking?: { maxDecelMps2: number };
}

/**
 * Throws when a motor profile carries a braking limit that is not a finite deceleration > 0 (a negative or zero limit
 * would push along the travel or remove braking; a non-finite one is no limit). Absent `braking` is valid (historical
 * behaviour). Checked where a limit is authored (withBrakingLimit) and where motors are consumed (Simulation
 * construction: the fixture motor and every player override), not per frame.
 */
export function validateMotorBraking(m: MotorProfile, owner = 'motor'): void {
  if (m.braking === undefined) return;
  const v = (m.braking as { maxDecelMps2?: unknown } | null)?.maxDecelMps2;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(`${owner}: motor profile ${m.id}: braking.maxDecelMps2 must be a finite number > 0 (got ${String(v)})`);
}

/** A motor with the plan 07 braking limit, under a derived identity (opt-in per fixture). */
export function withBrakingLimit(m: MotorProfile, maxDecelMps2 = 5.5): MotorProfile {
  const out = { ...m, id: `${m.id}+brake-${maxDecelMps2}`, braking: { maxDecelMps2 } };
  validateMotorBraking(out, 'withBrakingLimit');
  return out;
}

export const DEFAULT_MOTOR: MotorProfile = {
  id: 'motor-g1-default',
  maximumRequestedSpeedMps: 6.0,
  maximumDriveForceN: 1400,
  velocityResponseTimeS: 0.25,
  maximumYawTorqueNm: 180,
  yawKp: 300,
  yawKd: 80,
};

// ---------------------------------------------------------------- solver
export type CombineRule = 'Average' | 'Min' | 'Multiply' | 'Max';
export interface SolverProfile {
  id: string;
  outerTickS: number;
  substeps: number;
  solverIterations: number;
  gravityY: number;
  ccd: boolean;
  /** Rapier soft-CCD predictive contact distance (m): speculative constraints stop fast bodies at first touch. */
  softCcdPredictionM: number;
  /** Passive Coulomb friction for floor and every non-support collider (and the support shape once falling). */
  passiveFriction: number;
  passiveFrictionCombine: CombineRule;
  /**
   * Engine friction under a SUPPORTED player's support shape. Feet are visual; traction while supported is owned
   * by the bounded ground-drive motor, so the support shape glides (0, Min rule) instead of being dragged by
   * Coulomb friction against its own running velocity.
   */
  supportedSupportFriction: number;
  supportedSupportCombine: CombineRule;
  restitution: number;
  restitutionCombine: CombineRule;
  groundNormalMinDotUp: number;
  /** Supporting contact must lie in the support shape's lower region: local Y <= -halfHeight + tol. */
  supportRegionTolM: number;
  /** A manifold point without solver impulse counts as contact only if penetrating at least this deep (negative). */
  touchDistM: number;
  /**
   * Contact impulses read as solved (`physics.ts` solvedImpulses): a manifold point outside the solve's contacts applied
   * nothing, instead of reading the impulse it kept from the last solve that included it.
   */
  solvedImpulses?: true;
  linearDamping: number;
  angularDamping: number;
  /** Body sleeping, read by every dynamic body (physics proxies and ragdoll segments); always off. */
  sleeping: false;
  /** Max wall-clock ticks consumed per display frame by the lab driver (excess wall time is discarded and reported). */
  maxTicksPerFrame: number;
}

export const SOLVER_G1: SolverProfile = {
  id: 'solver-g1-1x60',
  outerTickS: 1 / 60,
  substeps: 1,
  solverIterations: 4,
  gravityY: -9.81,
  ccd: true,
  softCcdPredictionM: 0.3,
  passiveFriction: 0.7,
  passiveFrictionCombine: 'Average',
  supportedSupportFriction: 0,
  supportedSupportCombine: 'Min',
  restitution: 0,
  restitutionCombine: 'Average',
  groundNormalMinDotUp: 0.6,
  supportRegionTolM: 0.02,
  touchDistM: -0.002,
  linearDamping: 0,
  angularDamping: 0,
  sleeping: false,
  maxTicksPerFrame: 4,
};

/**
 * Gate 4 solver: SOLVER_G1 contact/friction settings with four 1/240 s physics substeps per 1/60 s tick. At one
 * substep the passive ten-body ragdoll's impulse joints opened up to 44 mm and hinges ran up to 16 deg past their
 * limits on hard ground impacts (scripts/probe/g4sep5.ts); four substeps keep both small. Prior gates keep SOLVER_G1.
 */
export const SOLVER_G4: SolverProfile = { ...SOLVER_G1, id: 'solver-g4-4x60', substeps: 4 };
/** Plan 09 L4-F8 only: a labelled zero-gravity diagnostic for the whole-body torque-pair audit. Gameplay gravity is unchanged. */
export const SOLVER_G4_ZEROG: SolverProfile = { ...SOLVER_G4, id: 'solver-g4-4x60-zeroG-diagnostic', gravityY: 0 };

/**
 * Ladder rung 7c: a fixture's solver with contact impulses read as solved (`solvedImpulses`). On the L3, L4 and HC
 * families (their constructors apply it); the older families keep the reading their evidence was made with.
 */
export const withSolvedImpulses = (s: SolverProfile): SolverProfile => (s.solvedImpulses ? s : { ...s, id: `${s.id}+solved`, solvedImpulses: true });

// ---------------------------------------------------------------- support (plan 06a)
/**
 * Vertical support of a supported proxy. `capsuleFloor` (the named legacy profile, the default of every Gate 1-4, G4-M
 * and L1 fixture): the support capsule rests on the floor through rigid contact, so the proxy origin stays at the
 * body's rest height. `suspension`: a finite ground-probed suspension holds the root at a requested height; the support
 * capsule no longer touches static ground and a massless guard ball is the bump stop and the falling contact.
 */
export type SupportProfile = CapsuleFloorSupport | SuspensionSupport;

export interface CapsuleFloorSupport {
  id: string;
  kind: 'capsuleFloor';
}

/** Named legacy support: rigid capsule-floor contact (historical Gate 1-4, G4-M and L1 evidence). */
export const SUPPORT_LEGACY: CapsuleFloorSupport = { id: 'support-capsuleFloor-v1', kind: 'capsuleFloor' };

/**
 * Ground-probed suspension (engineering profile, not a leg model). Heights are root heights: the proxy origin's vertical
 * distance above the probed ground. Ground: a vertical ray from the proxy origin against static colliders and other
 * players' live bodies (the player's own colliders are never hit; a player hit is `obstructed`, never ground); the first
 * hit must be turf with an acceptable normal and lie within `probeMaxM`. Force: F = m (g + a_t) + k (h_t - h) +
 * c (v_t - v), k = m (2 pi f)^2, c = 2 zeta m (2 pi f), clamped to [0, maxForceBW m g], applied vertically and split by
 * `application` (pivot share, excess through the COM). Drive and yaw authority scale with the applied load; the balance
 * ceiling follows `balanceCeiling`.
 */
export interface SuspensionSupport {
  id: string;
  kind: 'suspension';
  /**
   * Root (proxy origin) height of the standing request: the initial athletic stance for this model, provisional and
   * subject to visual review (user decision 2026-11-05). bew-v6: 0.89 m root, hips about 0.921 m, shoe 1.4 mm above the
   * turf, knee 45 deg. Under the current foot placement and knee/soft-reach policy it is the highest height whose static
   * ground-relative leg pose reaches the turf with bent knees (the legacy rest origin 0.95 m leaves the legs 2.6 cm
   * short; scripts/probe/rh-stand-sweep.ts); it is not a universal maximum standing height.
   */
  standingHeightM: number;
  /** Bounded target range: every request (stance or clip-derived) is clamped into it (reported). */
  targetRangeM: [number, number];
  /** Suspension travel: support exists while the probed root height is within [0, probeMaxM] (lost above it). */
  probeMaxM: number;
  /** Once lost, the probe re-acquires below probeMaxM - probeHysteresisM (no chatter at the travel limit). */
  probeHysteresisM: number;
  /** Acceptable turf normal: dot(normal, up) >= this (flat static turf only in this milestone). */
  normalMinDotUp: number;
  /** Guard ball (bump stop, falling contact): its bottom sits this far below the proxy origin; radius. */
  guard: { bottomM: number; radiusM: number };
  /** Natural frequency (Hz) and damping ratio of the spring/damper about the target (scaled by the measured mass). */
  frequencyHz: number;
  dampingRatio: number;
  /** Support force ceiling in body weights (m g). The floor never pulls: the force is clamped at 0 below. */
  maxForceBW: number;
  /** Ceiling of |d target / dt| (m/s) after blending; the target velocity is the slewed target's own rate. */
  targetSlewMps: number;
  /**
   * Stance request filter: critically damped second order at this frequency (Hz), its acceleration (m/s^2) and rate (m/s)
   * bounded so a step request never asks the support for more than a fraction of g downward.
   */
  stance: { frequencyHz: number; maxAccelMps2: number; maxRateMps: number };
  /**
   * Running height from the clips' calibrated pelvis-to-ground trajectory: hip-joint midpoint height above the floor
   * (player leg units), converted to root height with the body's hip landmark offset. The bob keeps its first
   * `bobHarmonics` cycle harmonics (stride and step), and its amplitude is scaled down when the current playback rate
   * would need a downward acceleration above maxDownAccelG g (a support that cannot pull cannot follow it; more force
   * capacity would not help). Provisional (user decision 2026-11-05): the target is an attenuated bob, so tracking error
   * measures agreement with this modified target, not preservation of the clip's original motion. Fast Run (plan 13d, the
   * one run clip) keeps its full truncated amplitude up to 1.19x its cadence (6.9 m/s); at its 1.3x limit it keeps 0.835.
   */
  run: { bobHarmonics: number; maxDownAccelG: number };
  /**
   * Balance (upright support torque) ceiling while the suspension supports the player. Either rule gives 0 without valid
   * probe support or once control is falling, and the absolute (maxBalanceTorqueNm) and combined yaw + balance ceilings
   * still apply. The posture gravity hold always uses the actual applied load and the solved support lever.
   * - 'nominalWeight' (user decision 2026-11-05): min(maxBalanceTorqueNm, m g r) at the nominal body weight, the same
   *   ceiling as the legacy support. An explicit approximation: balance is a bounded posture motor of the suspension
   *   proxy, not a torque a stance foot transmits, so the instantaneous load does not lower it (the running bob unloads
   *   the support for part of every stride; the drive and yaw authority remain bounded by the instantaneous load).
   * - 'appliedLoad': min(maxBalanceTorqueNm, N r) at the instantaneous applied load N (superseded; comparison probes).
   */
  balanceCeiling: 'nominalWeight' | 'appliedLoad';
  /**
   * Where the clamped support force F acts (vertical; user decision 2026-11-05). A deliberate suspension approximation:
   * excess vertical load supplies lift without additional tipping torque.
   * - pivot 'legacyHemisphere': the turf point below the body's calibrated legacy pivot, the centre of its support
   *   capsule's lower hemisphere (body-local, from the body geometry; bew-v6 0.79 m below the root, 1.01 m below the
   *   COM), so the tipping lever is the one the balance ceiling and posture bound were tuned with. 'probeDepth': the
   *   body-axis point at the probed root height (superseded; comparison probes).
   * - excess 'throughCom': pivot force = min(F, m g), COM force = F - pivot force, applied through the COM (no torque
   *   about it), so the vertical force that holds the ride height is unchanged while the tipping contribution is bounded
   *   by the body weight (running bob peaks lift without tipping). 'atPivot': all of F at the pivot (superseded).
   * The posture gravity hold uses the pivot force and the solved pivot lever; both components and the pivot torque
   * about the COM are traced (`sup.Fp`, `sup.Fm`, `sup.T`).
   */
  application: { pivot: 'legacyHemisphere' | 'probeDepth'; excess: 'throughCom' | 'atPivot' };
  /**
   * Plan 07 load-release recovery (absent = the 06a law, SUSPENSION_RH). Below the target the spring term's implied
   * upward approach speed (v_t + (k / c) e) is bounded by v_t + sqrt(2 approachBrakeG g e): the speed from which the body
   * reaches the target decelerating at approachBrakeG g, which push-only support can always produce by removing force
   * (support.ts suspensionForce). Without it a compressed, saturated support converts its whole height error into upward
   * speed on release (RH-F4-load: 0.32 m above standing, beyond travel). Stateless: derived from the solved compression
   * and velocity, never a load schedule; the force clamp, split, caps and ceiling are unchanged.
   */
  recovery?: { approachBrakeG: number };
  /**
   * Plan 07 closeout item 4: temporary lower stance while the player brakes (absent = none, every earlier profile).
   * The braking demand is derived each substep from the locomotion intent and the solved travel: the deceleration the
   * drive motor's velocity law asks for against the actual horizontal travel (effort x max(0, speed - requested speed
   * along the travel) / velocityResponseTimeS) as a fraction of the motor's own braking limit (`MotorProfile.braking`;
   * no braking limit = no braking stance), times smoothstep(speed / fullSpeedMps), while supported and grounded; while
   * unsupported the blend holds (a landing meets the held stance).
   * A blend b follows the demand through a critically damped filter at frequencyHz with |db/dt| <= maxRatePerS and
   * |d2b/dt2| <= maxAccelPerS2, and the height target is the ordinary composition (stance and running height/bob at
   * the clip weight) blended toward min(heightM, filtered stance) by b, so it acts at any clip weight and returns to
   * the ready/idle target as the body settles or accelerates again. No root, phase or pose offset.
   */
  brakingStance?: { heightM: number; fullSpeedMps: number; frequencyHz: number; maxRatePerS: number; maxAccelPerS2: number };
}

export const SUSPENSION_RH: SuspensionSupport = {
  id: 'support-suspension-rh-v1',
  kind: 'suspension',
  standingHeightM: 0.89,
  targetRangeM: [0.72, 0.96],
  probeMaxM: 1.0,
  probeHysteresisM: 0.01,
  normalMinDotUp: Math.cos((20 * Math.PI) / 180),
  guard: { bottomM: 0.62, radiusM: 0.12 },
  frequencyHz: 7,
  dampingRatio: 0.8,
  maxForceBW: 3.5,
  targetSlewMps: 1.5,
  stance: { frequencyHz: 2.5, maxAccelMps2: 4.9, maxRateMps: 0.6 },
  run: { bobHarmonics: 2, maxDownAccelG: 0.75 },
  balanceCeiling: 'nominalWeight',
  application: { pivot: 'legacyHemisphere', excess: 'throughCom' },
};

/**
 * Plan 07 repaired support: SUSPENSION_RH plus the bounded load-release recovery (every other setting identical). RH
 * fixtures keep SUSPENSION_RH (the 06a incoming results); L2 fixtures opt into this profile.
 */
export const SUSPENSION_L2: SuspensionSupport = {
  ...SUSPENSION_RH,
  id: 'support-suspension-rh-v2',
  recovery: { approachBrakeG: 0.5 },
};

/**
 * Plan 07 closeout item 4: SUSPENSION_L2 plus the braking stance (every other setting identical). 0.80 m is the validated
 * intermediate stance level (L2-F1-crouch), a tuning candidate (ready 0.89 m). Rates: a 0.15 m blend span stays within
 * the stance filter's 0.6 m/s and 4.9 m/s^2. Used with the controlled-braking motor (braked fixtures).
 */
export const SUSPENSION_L2_BRAKE: SuspensionSupport = {
  ...SUSPENSION_L2,
  id: 'support-suspension-rh-v3',
  brakingStance: { heightM: 0.8, fullSpeedMps: 3.0, frequencyHz: 2.5, maxRatePerS: 4, maxAccelPerS2: 32 },
};

// ---------------------------------------------------------------- stance (rotation authority)
export interface StanceProfile {
  id: string;
  rotation: 'pitchRollLocked' | 'free';
}
export const STANCE_G1_LOCKED: StanceProfile = { id: 'stance-g1-pitchRollLocked', rotation: 'pitchRollLocked' };
/** Gate 3 balanced profile: all three rotational axes dynamic; upright authority is the finite balance motor. */
export const STANCE_G3_FREE: StanceProfile = { id: 'stance-g3-free', rotation: 'free' };

// ---------------------------------------------------------------- balance (Gate 3)
/** Authored game-mechanic parameters for upright support and loss of support (not a calibrated human model). */
export interface BalanceProfile {
  id: string;
  kp: number; // N m / rad
  kd: number; // N m s / rad
  maxBalanceTorqueNm: number;
  /** Combined |yaw + balance| support-torque ceiling. */
  combinedCeilingNm: number;
  lookAheadS: number;
  minLeanRad: number;
  envelopeRad: number;
  hardLeanRad: number;
  confirmSubsteps: number;
  maxPostureLeanRad: number;
  postureRateRadPerS: number;
  /** Below this tilt the position term is omitted and the lean axis is taken from the last valid one. */
  zeroTiltRad: number;
  /** Owner arm budget (hold + clamp) fraction once the owner is falling. */
  fallingArmBudgetFraction: number;
}

const d2r = (d: number): number => (d * Math.PI) / 180;
export const BALANCE_G3: BalanceProfile = {
  id: 'balance-g3-v1',
  kp: 1200,
  kd: 220,
  maxBalanceTorqueNm: 240,
  combinedCeilingNm: 300,
  lookAheadS: 0.18,
  minLeanRad: d2r(25),
  envelopeRad: d2r(55),
  hardLeanRad: d2r(70),
  confirmSubsteps: 2,
  maxPostureLeanRad: d2r(12),
  postureRateRadPerS: d2r(30),
  zeroTiltRad: 1e-4,
  fallingArmBudgetFraction: 0.35,
};

// ---------------------------------------------------------------- arms (Gate 2)
export type RetentionMode = 'surfaceHold' | 'forearmClamp';

export interface ArmProfile {
  id: string;
  upperArmM: number;
  forearmM: number;
  /** Forearm end (wrist) to palm-contact landmark. */
  palmExtensionM: number;
  /** Maximum shoulder-to-palm-contact distance (below the straight-chain length). */
  maxReachM: number;
  /** Minimum shoulder-to-palm distance (elbow flexion limit). */
  minReachM: number;
  upperArmRadiusM: number;
  forearmRadiusM: number;
  palmRadiusM: number;
  maxEndpointSpeedMps: number;
  surfaceTolM: number;
  /** Maximum query travel per subdivision (palm sweep and relative body motion). */
  queryStepM: number;
  /** Right-arm rest palm in the owner frame (left mirrored). */
  restPalmRight: Vec3;
  hold: {
    stiffness: number;
    damping: number;
    perArmCeilingN: number;
    ownerBudgetN: number;
    pullSpeedMps: number;
    minDesiredLengthM: number;
    reachTolM: number;
    overloadThresholdS: number;
    overloadRecoveryPerS: number;
    withdrawM: number;
    /** Minimum dot(palm direction, -surface normal) for a palm to face the surface. */
    palmFacingMinDot: number;
  };
  clamp: {
    normalStiffness: number;
    normalDamping: number;
    mu: number;
    tangentStiffness: number;
    stationRateMps: number;
    maxClosingErrorM: number;
    /** Point travel on the target surface (target frame) per substep beyond which elastic memory restarts. */
    patchJumpM: number;
  };
  wrap: { azimuthMinDeg: number; bandLowM: number; bandHighM: number; minClampNormalN: number };
}

export const ARM_G2: ArmProfile = {
  id: 'arm-g2-v1',
  upperArmM: 0.35,
  forearmM: 0.34,
  palmExtensionM: 0.05,
  maxReachM: 0.72,
  minReachM: 0.12,
  upperArmRadiusM: 0.055,
  forearmRadiusM: 0.045,
  palmRadiusM: 0.04,
  maxEndpointSpeedMps: 4.0,
  surfaceTolM: 0.015,
  queryStepM: 0.02,
  restPalmRight: v3(0.24, 0.0, 0.12),
  hold: {
    stiffness: 2500,
    damping: 120,
    perArmCeilingN: 700,
    ownerBudgetN: 1000,
    pullSpeedMps: 0.5,
    minDesiredLengthM: 0.35,
    reachTolM: 0.015,
    overloadThresholdS: 0.1,
    overloadRecoveryPerS: 0.5,
    withdrawM: 0.08,
    palmFacingMinDot: 0.3,
  },
  clamp: {
    normalStiffness: 4000,
    normalDamping: 80,
    mu: 0.8,
    tangentStiffness: 1500,
    stationRateMps: 0.5,
    maxClosingErrorM: 0.08,
    patchJumpM: 0.1,
  },
  wrap: { azimuthMinDeg: 55, bandLowM: 0.05, bandHighM: 0.4, minClampNormalN: 1 },
};

/** Per-player arm configuration (fixture-level switches; limits live in ArmProfile). */
export interface ArmSetup {
  enabled: { left: boolean; right: boolean };
  mode: { left: RetentionMode; right: RetentionMode };
  /** Palm surface-hold acquisition allowed (F2 control disables it). */
  acquisition?: boolean;
  /** Multiplies forearm closing pressure (F10 control sets 0). */
  closeEffortScale?: number;
}

// ---------------------------------------------------------------- ragdoll (Gate 4)
/**
 * Coarse ten-body passive ragdoll blueprint (engineering profile, not anthropometry). Limb frames: origin at the
 * proximal joint, local -Y toward the distal joint, local X = hinge axis (elbow/knee), Z = X x Y. Hinge angle zero =
 * straight limb (anatomical reference); positive = flexion. The neck hinge is about the core's local X with zero at
 * the bind pose (head aligned with the core).
 */
export interface RagdollProfile {
  id: string;
  massFractions: { core: number; head: number; upperArm: number; forearm: number; thigh: number; shin: number };
  /** Share of the forearm segment mass carried by the palm ball, and of the shin mass carried by the shoe box. */
  palmMassShare: number;
  shoeMassShare: number;
  lengths: { upperArm: number; forearm: number; palmExtension: number; thigh: number; shin: number };
  radii: { upperArm: number; forearm: number; palm: number; thigh: number; shin: number; head: number };
  shoe: { halfExtents: Vec3; belowAnkleM: number; forwardM: number };
  limitsDeg: { neck: [number, number]; elbow: [number, number]; knee: [number, number] };
  /** Same-owner contact policy: every same-owner pair disabled (adjacent and non-adjacent), reported. */
  selfCollision: 'disabledAllSameOwner';
  validation: {
    anchorTolM: number;
    penetrationTolM: number;
    landmarkTolM: number;
    lengthTolM: number;
    /** Below this bend the hinge plane comes from the stable profile bend direction, not the limb cross product. */
    straightBendDeg: number;
    /** Energy gain failure: max(absJ, fraction * old KE). */
    energyGainAbsJ: number;
    energyGainFraction: number;
  };
  audit: { massTolKg: number; linearRelTol: number; angularRelTol: number };
  /** Passive palm-to-target retention once a grip owner is a ragdoll (section 10). */
  passiveGrip: { stiffness: number; damping: number; maxSeparationM: number; budgetFraction: number };
  /** Plan 09: shoulder/hip swing-twist envelope (absent: spherical joints stay unrestricted, the Gate 4 passive path). */
  envelope?: RagdollEnvelope;
  /**
   * Plan 10c (C6): the longer push-out a convertible player's shown leg takes when the ordinary continuity push leaves it
   * past the pose's validity depth (another body moves into the pose-only leg near the hip, where moving the ankle moves
   * the thigh little), so the published pose, and the candidate built from it, stays valid. Absent: the ordinary push
   * only (historical profiles).
   */
  poseGuard?: PoseGuard;
  /**
   * Ladder rung 8a: Rapier's additional internal PGS iterations per solver substep, asked by every segment body. Rapier
   * runs the largest request of an island's bodies for the whole island, so whatever the ragdoll touches in the same
   * island solves with them too. For an under-converged solve on a closed contact loop that gives a ragdoll energy (the
   * self-trunk pinch: floor, forearm, its own trunk; tests/passive-energy.ts measures it). Absent: none (Rapier's one).
   */
  additionalPgsIterations?: number;
  /**
   * Ladder rung 8d: hard outer stops on the spherical hips (Rapier's angular limits, `src/sim/joint-stops.ts`), in the
   * hip's anatomical frame. Absent: the hips have none (the L4 soft envelope, where there is one, is all).
   */
  hipStops?: HipStopProfile;
  /**
   * Ladder rung 8f: a flexion stop on the knee hinges (deg), short of `limitsDeg.knee`'s upper limit, which the
   * candidate's validation keeps reading, so the stop changes no conversion: a knee that converts past it starts against
   * a stop widened to where it is, closing with it (`src/sim/joint-stops.ts`). Absent: the hinge's own limit.
   */
  kneeFlexionStopDeg?: number;
  /**
   * Ladder rung 8j: a conversion whose candidate fails validation only for overlapping another body (external penetration
   * past `validation.penetrationTolM`) is deferred, not rejected: the player stays the falling proxy and the same
   * conversion is tried again at every following substep boundary, with its shown pose still guarded for validity (it
   * can still convert), until a candidate is accepted, a try fails for any other reason, or the window has passed (then
   * rejected as before). Absent: a rejection is final (the falling proxy to the end).
   */
  conversionRetry?: ConversionRetryProfile;
  /**
   * Ladder rung 9a: the ragdoll's own legs meet each other and its own trunk (plan 11's pattern for the forearms):
   * massless reduced self shapes on the thighs and shins and an explicit list of pairs, never jointed segments
   * (`src/sim/ragdoll.ts`, SELF_LEG_KEY). Absent: every same-owner pair but plan 11's passes through (Gate 4).
   */
  selfLegs?: SelfLegProfile;
  /**
   * Ladder rung 13a: the shoulder envelope's twist limit in the anatomical measure (`ShoulderTwistLimitProfile`), so it
   * holds with the arm raised overhead. Absent: plan 09's twist, which fades out toward an arm straight overhead.
   */
  shoulderTwistLimit?: ShoulderTwistLimitProfile;
  /**
   * Ladder 17 (direction item 4, ragdoll rather than fall stiff): a candidate that overlaps another player is converted,
   * the overlapping collider pairs left out of the solve until they have separated (`BornOverlapProfile`). Absent: a
   * candidate past the external penetration tolerance is rejected (or deferred, `conversionRetry`) as before.
   */
  bornOverlap?: BornOverlapProfile;
}

/**
 * Ladder 17: the conversion of a candidate born overlapping another player. Two bodies switched in overlapping are pushed
 * apart by the next solve, so a candidate deeper than `validation.penetrationTolM` in another body was refused, and one
 * that stayed so left a rigid falling proxy (the worst look there is). Under this profile such a candidate is accepted,
 * and each collider pair born deeper than the tolerance (this player's segment collider and the other body's collider
 * it starts in) meets nothing in the solve (the contact hook) until the two are no deeper than `releaseM` in each other;
 * from then on they collide as any pair. The solver never acts on the overlap it was born with, so the switch adds no
 * depenetration. What may be born so:
 * - a limb (arm or leg segment) in any part of another player, or another player's limb in this one's trunk or head;
 * - not a trunk or head in another player's trunk or head (two bodies merged, "grossly impossible"): such a candidate is
 *   deferred within `conversionRetry`'s window, and at its end (or at once, without one) converted with those pairs left
 *   out as well, rather than left a rigid falling proxy;
 * - not the floor or another static body: the floor is not a pair to leave out (a segment would fall through it); a
 *   candidate past the floor tolerance is converted with the floor in the solve, which pushes the segment out, and
 *   `floorBornM` is the deepest so accepted (measured: a shoe born 4 cm in the floor leaves it at about 0.2 m/s, about
 *   4 J, and the trunk does not rise; deeper is refused as before).
 * The other reasons (finite, mass, lengths, anchors, hinges, landmarks) still refuse a conversion: a candidate that is
 * not the shown body. A pair whose other collider leaves the world (a proxy replaced by its ragdoll) is carried to the
 * ragdoll's collider of the same geometry (trunk, pelvis, head) or ends with it.
 */
export interface BornOverlapProfile {
  id: string;
  /** A pair rejoins the solve once its shapes are no deeper than this in each other (m). */
  releaseM: number;
  /** The deepest a candidate may start in the floor and still be converted (m). */
  floorBornM: number;
  /** Ladder 18: held pairs pushed apart rather than left to part (`BornSeparationProfile`). Absent: left to part. */
  separation?: BornSeparationProfile;
}

/**
 * Ladder 18: a born pair held out of the solve is pushed apart by a capped, one-sided force rather than left to part as
 * the bodies happen to move. Left alone a pair could deepen while held (the solve never sees it): 33 of the 75 pairs of
 * the met-arm flip went past 5 cm, the deepest 9 cm, held up to 0.65 s (`BORN_PAIR_DEEPENS`). Before each solve, for each
 * held pair in one order every player order gives (by its keys), with its shapes' contact normal n and witness midpoint:
 * the target separating speed along n is the born depth (or the depth now, if deeper) over `partS`, within
 * [`minMps`, `maxMps`], so a pair parts in about `partS` at a constant speed; the impulse that would bring the two
 * bodies' relative normal speed there (their effective mass along n at that point, the joints not counted) is applied as
 * equal and opposite forces at the midpoint, never negative (it never pulls a pair together), at most `maxN`. The
 * separation's positive work on a pair is counted (from the speeds before and after it would give) and stops at `workJ`:
 * past it the pair is only kept from closing (a target of zero, which takes energy out), so a pair adds at most that. The
 * solve's own depenetration (the kick 17a removed) is the target "the whole depth in one solve", unbounded
 * (`debug.conversion.bornSeparationUncapped`, the fault).
 */
export interface BornSeparationProfile {
  /** The time a pair is driven to part in: its target speed is its born depth over this (s). */
  partS: number;
  /** The least and the greatest target separating speed (m/s). */
  minMps: number;
  maxMps: number;
  /** The greatest separating force on a pair (N). */
  maxN: number;
  /** The most positive work the separation may do on a pair (J). */
  workJ: number;
}

export const BORN_OVERLAP_V1: BornOverlapProfile = { id: 'born-overlap-v1', releaseM: 0.001, floorBornM: 0.05 };
export const BORN_SEPARATION_V1: BornSeparationProfile = { partS: 0.15, minMps: 0.1, maxMps: 0.5, maxN: 2000, workJ: 2 };
/** Ladder 18: V1 with its held pairs pushed apart. */
export const BORN_OVERLAP_V2: BornOverlapProfile = { ...BORN_OVERLAP_V1, id: 'born-overlap-v2', separation: BORN_SEPARATION_V1 };

/** Ladder 17: the ragdoll profile with the born-overlap conversion, under an id that names it. */
export const withBornOverlap = (r: RagdollProfile, p: BornOverlapProfile = BORN_OVERLAP_V1): RagdollProfile => ({ ...r, id: `${r.id}+${p.id}`, bornOverlap: p });
/** Ladder 17: the ragdoll profile without it, under the id it had before it. */
export function withoutBornOverlap(r: RagdollProfile): RagdollProfile {
  if (!r.bornOverlap) return r;
  const { bornOverlap, ...rest } = r;
  return { ...rest, id: r.id.replace(`+${bornOverlap.id}`, '') };
}
/** Ladder 18: a ragdoll profile with V1's born overlap given V2's in its place (its id's part renamed in place). */
export const withBornSeparation = (r: RagdollProfile): RagdollProfile =>
  r.bornOverlap?.id === BORN_OVERLAP_V1.id ? { ...r, id: r.id.replace(`+${BORN_OVERLAP_V1.id}`, `+${BORN_OVERLAP_V2.id}`), bornOverlap: BORN_OVERLAP_V2 } : r;
/** Ladder 18: the inverse, V2's born overlap back to V1's under the id it had. */
export const withoutBornSeparation = (r: RagdollProfile): RagdollProfile =>
  r.bornOverlap?.id === BORN_OVERLAP_V2.id ? { ...r, id: r.id.replace(`+${BORN_OVERLAP_V2.id}`, `+${BORN_OVERLAP_V1.id}`), bornOverlap: BORN_OVERLAP_V1 } : r;

/**
 * Ladder rung 13a: the ragdoll shoulder envelope's twist limit with the arm raised. Plan 09 measures the twist after the
 * shortest arc from the hanging arm and scales its excess by cos(swing / 2), so that the limit's energy stays continuous
 * at the pole straight overhead, where that measure turns singular (its swing axis turns with the arm's azimuth). Raised
 * high the limit was then weak and read the wrong twist: HC-F5-strictTransfer's runner lies with its right arm up across
 * its head and the forearm folded out and forward, 125 deg of external rotation in the anatomical measure (25 past the
 * range), read as 71 and inside it. Here the limit reads the anatomical twist (`limbAnatomicalTwistRad`, ladder 11d,
 * the measure of the visible meter since 13a-i): plan 09's up to horizontal, taken after the shortest arc from a
 * reference 35 deg forward of hanging above it, singular only at that reference's opposite (35 deg behind straight up,
 * outside the swing cone). Its excess is scaled to the same blend of cos(swing / 2) and cos(half the angle from the
 * reference), so the scaled excess is, to first order, the turn that brings the arm back in range, and the limit's
 * energy is continuous everywhere; up to horizontal the limit is plan 09's, term for term. Range, stiffness, damping, cap,
 * tolerance and start slack stay the envelope's.
 */
export interface ShoulderTwistLimitProfile {
  id: string;
  measure: 'anatomical';
}

export const SHOULDER_TWIST_ANAT_V1: ShoulderTwistLimitProfile = { id: 'shoulder-twist-anat-v1', measure: 'anatomical' };

/** Ladder rung 13a: the ragdoll profile with the anatomical shoulder twist limit, under an id that names it. */
export const withShoulderTwistLimit = (r: RagdollProfile, p: ShoulderTwistLimitProfile = SHOULDER_TWIST_ANAT_V1): RagdollProfile => ({ ...r, id: `${r.id}+${p.id}`, shoulderTwistLimit: p });
/** Ladder rung 13a: the ragdoll profile without it, under the id it had before it. */
export function withoutShoulderTwistLimit(r: RagdollProfile): RagdollProfile {
  if (!r.shoulderTwistLimit) return r;
  const { shoulderTwistLimit, ...rest } = r;
  return { ...rest, id: r.id.replace(`+${shoulderTwistLimit.id}`, '') };
}

/**
 * Ladder rung 9a: ragdoll own-leg contact. Each leg carries three massless self shapes: the distal thigh (a capsule
 * about the bone from `thighFromFraction` of the thigh to the knee, the thigh capsule's radius less `toleranceM` but at
 * most `thighMaxRadiusM`), the shin (about the bone from the knee to the ankle, the shin capsule's radius less
 * `toleranceM`) and the shoe (the shoe box less `toleranceM`, turning with the limp foot). Pairs: any of one leg's
 * shapes against any of the other's, and each shin and shoe against the own trunk (plan 11's trunk hull pieces on a
 * measured body, the core's cuboids on an authored one). Never a thigh against the trunk (the hip joins them), never
 * one leg's own shapes (the knee joins them). The pairs come in groups by their two segments (a shin with its shoe;
 * or the trunk): when the ragdoll is switched in, a group with any pair overlapping deeper than `toleranceM` is left
 * out of the solve until none is, so the conversion never pushes legs apart by more than the skin and segments
 * switched in crossed are never held crossed by their other pairs. The thigh's shape is distal and capped because
 * bew-v6's mesh-fit thighs (14.6 cm) lie against each other at rest from the hips down; at 0.5 and 11 cm a standing
 * switch leaves the two thigh shapes 7 cm apart (the authored body's 8.5 cm thighs, 11 cm). bew-v6's knees touch at its
 * idle stance (23 cm apart, shin shapes 11.4 cm), with no force between them.
 */
export interface SelfLegProfile {
  id: string;
  /**
   * Skin left between the drawn shapes (m): the shapes are the segment colliders less this, as plan 11's forearms; also
   * the deepest a pair may start in the solve.
   */
  toleranceM: number;
  /** Where the thigh's shape starts, as a fraction of the hip-to-knee length from the hip (its segment's proximal end). */
  thighFromFraction: number;
  /** The largest radius of the thigh's shape (m). */
  thighMaxRadiusM: number;
}

export const SELF_LEGS_V1: SelfLegProfile = { id: 'self-legs-v1', toleranceM: 0.01, thighFromFraction: 0.5, thighMaxRadiusM: 0.11 };

/** Ladder rung 9a: the ragdoll profile with own-leg contact, under an id that names it. */
export const withSelfLegs = (r: RagdollProfile, p: SelfLegProfile = SELF_LEGS_V1): RagdollProfile => ({ ...r, id: `${r.id}+${p.id}`, selfLegs: p });
/** Ladder rung 9a: the ragdoll profile without own-leg contact, under the id it had before it. */
export function withoutSelfLegs(r: RagdollProfile): RagdollProfile {
  if (!r.selfLegs) return r;
  const { selfLegs, ...rest } = r;
  return { ...rest, id: r.id.replace(`+${selfLegs.id}`, '') };
}

/** Ladder rung 8j: the deferred conversion. */
export interface ConversionRetryProfile {
  id: string;
  /** The window, s from the first rejected try; a try at or past it that is rejected is final. */
  windowS: number;
  /** A rejected try is deferred when every one of its reasons (`CandidateReport.reasons`) is one of these. */
  reasons: string[];
}

/**
 * Ladder rung 8j. External penetration only: an overlap with another body moves as the bodies move, the structural
 * reasons (anchors, lengths, hinges, landmarks, mass) do not; the floor's reason stays final as well (a falling proxy
 * only gets closer to it). Window 0.25 s: the overlaps that rejected a conversion under the 8i variant (a posed leg
 * 1.6-3.4 cm inside another player's ragdoll) cleared within 5-22 substeps (21-92 ms) of the rejection with the pose
 * unguarded, within 1-11 tries guarded; the window is about three times the longest, so a tangle that does not clear
 * ends as the falling proxy it was, a quarter second later.
 */
export const CONVERSION_RETRY_V1: ConversionRetryProfile = { id: 'conversion-retry-v1', windowS: 0.25, reasons: ['externalPenetration'] };

/** Ladder rung 8j: the ragdoll profile with the deferred conversion, under an id that names it. */
export const withConversionRetry = (r: RagdollProfile, p: ConversionRetryProfile = CONVERSION_RETRY_V1): RagdollProfile => ({ ...r, id: `${r.id}+${p.id}`, conversionRetry: p });
/** Ladder rung 8j: the ragdoll profile without the deferred conversion, under the id it had before it (the lab's `retry=off`). */
export function withoutConversionRetry(r: RagdollProfile): RagdollProfile {
  if (!r.conversionRetry) return r;
  const { conversionRetry, ...rest } = r;
  return { ...rest, id: r.id.replace(`+${conversionRetry.id}`, '') };
}

/**
 * Ladder rung 8d: the hip's hard outer stops, deg from the anatomical neutral (the thigh parallel to the trunk axis, its
 * knee axis on the core's X): flexion forward, extension behind, abduction away from the midline, adduction across it,
 * internal and external rotation about the thigh. Each bounds one component of the joint's relative rotation (Rapier's
 * box on the quaternion's vector part, sin of half the angle), so it is exact on its own axis and couples at corners
 * (`src/sim/joint-stops.ts`). Outside the human active range (hip flexion 120, extension 30, abduction 45, adduction 30,
 * rotation 45; AAOS) by a few degrees where a limp body lies (flexion, abduction), at it elsewhere. Engineering limits.
 */
export interface HipStopProfile {
  id: string;
  flexionDeg: number;
  extensionDeg: number;
  abductionDeg: number;
  adductionDeg: number;
  internalDeg: number;
  externalDeg: number;
  /**
   * A conversion that starts a hip outside a stop widens that stop to the start and lets it close back with the joint (a
   * ratchet: never outward, never past the stop), so no stop kicks at the switch; never wider than this from the neutral,
   * short of the half turn where the quaternion's sign flips.
   */
  capDeg: number;
  /** A fall-response hip target is held this far inside the stops (it would otherwise drive the thigh into one). */
  driveMarginDeg: number;
  /** Ladder rung 8g: a damped soft zone inside each stop (absent: the stops alone). */
  approach?: HipApproachProfile;
}

/**
 * Ladder rung 8g: the hip stops' approach zone. Rapier's limit acts only on a joint already past it, and its position
 * correction returns part of an arrested swing's energy in the solves after (the hip-stop rebound): inside each stop a
 * band `widthDeg` wide (swing: the X and Z stops, flexion / extension and ab / adduction; twist: the Y stop) takes the
 * swing first, a one-sided spring-damper on the box reading (`src/sim/joint-stops.ts`, the plan 09 envelope's law in
 * the box's coordinates), so a thigh reaches its stop slowed or not at all. Passive as stepped: the spring a function of
 * the band's depth only (capped as a function of it), read at the depth the substep ends at (at the current rate), so a
 * band entered or left within a substep gives nothing back; a damper that never pulls and never more than stops the
 * relative rate along the band in one substep. A joint that starts inside a band keeps a start slack that follows it
 * back out of the band and decays, so the conversion adds no kick. Engineering settings.
 */
export interface HipApproachProfile {
  widthDeg: { swing: number; twist: number };
  swing: { stiffnessNmPerRad: number; dampingNmsPerRad: number };
  twist: { stiffnessNmPerRad: number; dampingNmsPerRad: number };
  maxTorqueNm: number;
  slackDecayDegPerS: number;
}

export const HIP_STOPS_V1: HipStopProfile = { id: 'hip-stops-v1', flexionDeg: 125, extensionDeg: 30, abductionDeg: 50, adductionDeg: 30, internalDeg: 45, externalDeg: 45, capDeg: 172, driveMarginDeg: 3 };

/** Ladder rung 8d: the ragdoll profile with hard hip stops, under an id that names them. */
export const withHipStops = (r: RagdollProfile, h: HipStopProfile = HIP_STOPS_V1): RagdollProfile => ({ ...r, id: `${r.id}+${h.id}`, hipStops: h });

/**
 * Ladder rung 8g: the approach zone, 10 deg inside each stop. Swing: at the band's full depth the spring gives 524 N m (a
 * leg's weight, about 50 N m, sits 1 deg in), the damping about critical for a leg about the hip (thigh alone 0.65 kg m^2
 * to a straight leg about 2.5). Twist: the thigh's own inertia about its axis is about 0.025 kg m^2, so the spring is set
 * where one substep resolves it (natural frequency times dt 0.5), critically damped there; 61 N m at full depth.
 * Swung into a stop on its own (tests/hip-approach.test.ts) a thigh stops inside the band, 4 deg short of the stop at 15
 * rad/s, and keeps a few percent of its energy. Stiffness, damping and the cap act on the reading (N m per rad of it):
 * the torque is that times the reading's gradient, 1 on an axis alone and more at combined poses (1.7 for adduction at
 * flexion 110), where the reading moves faster than the turn.
 */
export const HIP_APPROACH_V1: HipApproachProfile = {
  widthDeg: { swing: 10, twist: 10 },
  swing: { stiffnessNmPerRad: 3000, dampingNmsPerRad: 150 },
  twist: { stiffnessNmPerRad: 350, dampingNmsPerRad: 6 },
  maxTorqueNm: 600,
  slackDecayDegPerS: 30,
};

/** Ladder rung 8g: the 8d box with the approach zone inside each stop, for a ragdoll whose hips have no soft envelope (L3, HC). */
export const HIP_STOPS_V2: HipStopProfile = { ...HIP_STOPS_V1, id: 'hip-stops-v2', approach: HIP_APPROACH_V1 };

/**
 * Ladder rung 8g: the backstop of a hip with the L4 soft envelope (ENVELOPE_L4.hip; not taken since rung 8k, see
 * `hipStopsFor`; the 8i assessment's L4 stops, the lab's `hips=l4`). On each axis alone the approach zone
 * starts 5 deg past the envelope's range plus its declared tolerance (forward 128.75, out 61.25, back 39, in 45, twist
 * 50, tolerance 5; rounded up): the zone reads the depth a substep ends at, 5 deg ahead at 20 rad/s, and a fast swing
 * inside the tolerance is the envelope's. The stop is the zone's width past that, so the envelope takes the hip first
 * and the stop only what overruns it. A box cannot hold the envelope's corners: a twist t after a flexion f reads
 * 2 atan(tan(f/2) tan(t/2)) on Z (`src/sim/joint-stops.ts`), 59 at flexion 129 with twist 30, so there the Z stop meets
 * a pose inside the envelope.
 */
export const HIP_STOPS_L4_V1: HipStopProfile = {
  id: 'hip-stops-l4-v1',
  flexionDeg: 149,
  extensionDeg: 59,
  abductionDeg: 82,
  adductionDeg: 65,
  internalDeg: 70,
  externalDeg: 70,
  capDeg: 172,
  driveMarginDeg: 3,
  approach: HIP_APPROACH_V1,
};

/**
 * The hip stops a ragdoll takes (rung 8g: on L4 the backstop outside its soft hip envelope, HIP_STOPS_L4_V1). Ladder
 * rung 8k: every ragdoll the 8d box with the approach zone, L4 too, so its hips have the human ab/adduction. With the
 * backstop the L4 envelope admits adduction 45 and abduction 61.25 on one axis, past the implausible margins at flexed
 * poses (the boundary's largest in the visible measure 50.7 and 70.6); the envelope narrowed to the human range (parked,
 * `.scratch/ladder/parked/l4-hip-envelope-narrowed/`) removes that as well, but the box also halves the L4 deep own-body
 * overlap (248 -> 134 player-s under the visible flip; leg-trunk crossings gone), and the narrowed envelope adds
 * nothing visible inside the box (`.scratch/ladder/r8k-choice/`). The envelope's hip stays as it is: outside the box on
 * every axis, it takes no load under the stops, and it still bounds the fall response's hip targets.
 */
export const hipStopsFor = (_r: RagdollProfile): HipStopProfile => HIP_STOPS_V2;

/** Ladder rung 8f: the ragdoll profile with the knee flexion stop at `deg`, under an id that names it. */
export const withKneeStop = (r: RagdollProfile, deg: number): RagdollProfile => ({ ...r, id: `${r.id}+knee${deg}`, kneeFlexionStopDeg: deg });
/** The ragdoll profile without hip stops, under the id it had before them (the lab's `hips=off`). */
export function withoutHipStops(r: RagdollProfile): RagdollProfile {
  if (!r.hipStops) return r;
  const { hipStops, ...rest } = r;
  return { ...rest, id: r.id.replace(`+${hipStops.id}`, '') };
}
/** Ladder rung 8h: the ragdoll profile without the knee stop, under the id it had before it (the lab's `knees=off`). */
export function withoutKneeStop(r: RagdollProfile): RagdollProfile {
  if (r.kneeFlexionStopDeg === undefined) return r;
  const { kneeFlexionStopDeg, ...rest } = r;
  return { ...rest, id: r.id.replace(`+knee${kneeFlexionStopDeg}`, '') };
}
/** Ladder rung 8h: the ragdoll profile without additional PGS iterations, under the id it had before them (the lab's `pgs=0`). */
export function withoutPgsIterations(r: RagdollProfile): RagdollProfile {
  if (r.additionalPgsIterations === undefined) return r;
  const { additionalPgsIterations, ...rest } = r;
  return { ...rest, id: r.id.replace(`+pgs${additionalPgsIterations}`, '') };
}

export interface PoseGuard {
  id: string;
  /**
   * Push-out iterations and largest total push in one substep (m) of the longer push. The cap is the ordinary one, so
   * the shown leg moves no faster than the continuity budget allows.
   */
  deepPushIterations: number;
  deepPushM: number;
}

/** Plan 10c (C6): adopted by the HC natural-contact variants, whose no-rigid-proxy guarantee holds in both player orders. */
export const POSE_GUARD_C6: PoseGuard = { id: 'poseGuard-v1', deepPushIterations: 12, deepPushM: 0.05 };

/** The ragdoll profile with the convertible-pose guard, under an id that names it. */
export const withPoseGuard = (r: RagdollProfile, g: PoseGuard = POSE_GUARD_C6): RagdollProfile => ({ ...r, id: `${r.id}+${g.id}`, poseGuard: g });

/** Ladder rung 8a: the ragdoll profile with `n` additional PGS iterations on its segments, under an id that names it. */
export const withAdditionalPgsIterations = (r: RagdollProfile, n: number): RagdollProfile => ({ ...r, id: `${r.id}+pgs${n}`, additionalPgsIterations: n });

/**
 * One spherical joint's anatomical range in the parent (core) frame. Swing is measured from the limb hanging along the
 * core's -Y; the limit at any direction comes from the four quadrant values on an ellipse. Twist is measured about the
 * limb from `neutralTwistDeg`, positive external. Engineering settings, not measured athlete ranges.
 */
export interface JointEnvelope {
  /**
   * Swing range: a cone about a centre tilted `tiltDeg` from the hanging limb, toward `towardDeg` (0 forward, 90 out),
   * with an elliptical boundary `alongDeg` from the centre in the tilt plane and `acrossDeg` across it. A tilted cone,
   * not limits per quadrant about the hanging limb: those fall steeply with azimuth near the limb's overhead pole.
   */
  cone: { tiltDeg: number; towardDeg: number; alongDeg: number; acrossDeg: number };
  twistDeg: [number, number];
  neutralTwistDeg: number;
  swing: { stiffnessNmPerRad: number; dampingNmsPerRad: number };
  twist: { stiffnessNmPerRad: number; dampingNmsPerRad: number };
  /**
   * Cap of each limit's restoring moment, swing and twist apart (finite: a hard enough impact overruns the envelope). The
   * spring is capped as a function of its own excess, so the limit keeps an energy; a cap on the summed torque would not.
   */
  maxTorqueNm: number;
}

/**
 * Plan 09: Rapier 0.21 has no spherical limit, so this envelope is soft: a one-sided spring-damper torque pair, passive
 * and independent of any muscle budget. A joint that starts outside (a generated pose may) keeps a start slack, which
 * follows the limb inward and decays at a bounded rate, so conversion adds no kick.
 */
export interface RagdollEnvelope {
  id: string;
  mode: 'soft';
  /** Declared tested overshoot, and how long a joint may stay beyond it before that counts as persistent. */
  toleranceDeg: number;
  persistS: number;
  slackDecayDegPerS: number;
  shoulder: JointEnvelope;
  /** Absent (plan 12: the shoulder-only envelope of an L3 or HC ragdoll under a joint-range profile): the hips are free. */
  hip?: JointEnvelope;
}

export const ENVELOPE_L4: RagdollEnvelope & { hip: JointEnvelope } = {
  // v2 (plan 10b): hip twist 800 -> 1600 N m/rad (damping 3 -> 4, the same damping ratio)
  id: 'envelope-l4-v2',
  mode: 'soft',
  toleranceDeg: 5,
  persistS: 0.25,
  slackDecayDegPerS: 30,
  shoulder: {
    cone: { tiltDeg: 55, towardDeg: 45, alongDeg: 115, acrossDeg: 115 },
    twistDeg: [-100, 100],
    neutralTwistDeg: 180,
    swing: { stiffnessNmPerRad: 1500, dampingNmsPerRad: 30 },
    twist: { stiffnessNmPerRad: 400, dampingNmsPerRad: 2 },
    maxTorqueNm: 500,
  },
  hip: {
    cone: { tiltDeg: 46, towardDeg: 14, alongDeg: 85, acrossDeg: 60 },
    twistDeg: [-50, 50],
    neutralTwistDeg: 0,
    // 2500 let a leg folded under the body's weight sit 5-6 degrees past its range for a quarter second
    swing: { stiffnessNmPerRad: 3500, dampingNmsPerRad: 50 },
    // 800 let a leg lying with its shoe held by friction sit 7.2 degrees past its twist range under about 100 N m for
    // 0.65 s, to the end of the trial (L4-F3-run-on, plan 10b); 1600 puts that load at 3.6 degrees
    twist: { stiffnessNmPerRad: 1600, dampingNmsPerRad: 4 },
    maxTorqueNm: 800,
  },
};

/**
 * Plan 12 joint range (opt-in per fixture; absent = the historical ranges). One shoulder swing cone in the core frame for
 * all three arm sources (supported pose, arm-task arms, ragdoll envelope), the supported ankle range, and the limp foot
 * of a ragdoll. Engineering settings, not measured athlete ranges.
 */
export interface JointRangeProfile {
  id: string;
  /**
   * The shoulder's range: plan 09's twist range, stiffness, damping and torque cap, with the swing cone refit to 45 deg
   * behind the side line hanging and 30 deg raised to horizontal (`.scratch/shoulder/fit.ts`).
   */
  shoulder: JointEnvelope;
  /** Supported pose: soft cost (m) per 30 deg of upper arm behind the side line, only when it is behind. */
  forwardCostM: number;
  /** Supported (ground-relative) legs: shoe pitch range about the shin, deg. Past `dorsiDeg` the heel lifts. */
  ankle: { dorsiDeg: number; plantarDeg: number };
  /** Ragdoll: from the conversion the shoe eases to `pitchDeg` (positive toe down) at the rate that covers the conversion difference in `easeS`. */
  limpFoot: { pitchDeg: number; easeS: number };
  /** Contact motion M1 (absent: the supported and arm-task upper arms' twist is free, as before). */
  shoulderTwist?: ShoulderTwistProfile;
  /** Ladder 11b (absent: the supported thigh's axial rotation is free, as before). */
  hipTwist?: HipTwistProfile;
}

/**
 * Ladder 11b: the supported (ground-relative) thigh's axial rotation. The knee is placed from a pole, so its rotation
 * about the thigh was whatever the pole and the ankle target gave: past 90 degrees, the knee facing sideways or back,
 * when the target came close beside or above the hip (HC-F2-offset A's right foot held up on B as its hip drops, the
 * hinge turning 20 degrees a frame until the knee faces back), and a ragdoll made from that pose starts there. The shin
 * turns about the thigh (the thigh kept, the ankle off its target), so the rotation stays inside `envelope.twistDeg` less
 * `marginDeg`, reaching that range and leaving it at most `maxRateRadPs` from the previous shown rotation
 * (`fitThighTwist`). (Turning the knee about the hip-to-ankle line first, the ankle kept, traded the rotation for hip
 * extension and fold past their ranges: `.scratch/ladder/assess-11b`.) Engineering settings, not measured ranges.
 */
export interface HipTwistProfile extends ShoulderTwistProfile {
  envelope: JointEnvelope;
}

/**
 * Contact motion M1: the upper arm's axial twist in the supported pose and the arm-task arms. Both place the elbow from a
 * pole, so the twist about the upper arm was whatever the pole and target gave: outside the ragdoll's twist range (the
 * elbow pointing up or in), and turning freely on a nearly straight arm, where the elbow hardly moves but the bend plane
 * (and the drawn arm and hand) roll. The elbow is turned about the shoulder-to-palm line, the palm kept, so the twist
 * stays inside the shoulder envelope's `twistDeg` less `marginDeg` and turns at most `maxRateRadPs` from the previous
 * shown twist. Engineering settings, not measured ranges.
 */
export interface ShoulderTwistProfile {
  marginDeg: number;
  maxRateRadPs: number;
  /**
   * Ladder 11d (the shoulder's window only; absent: the envelope's measure): the window, the elbow fit and the forearm
   * turn work in the anatomical twist (`limbAnatomicalTwistRad`, regular through an upper arm pointing straight up), and
   * the envelope's own twist is kept in the range where the two part (`guardEnvelopeTwist`). In the envelope's measure
   * a rate window near vertical held the twist number while the arm itself turned over.
   */
  anatomical?: true;
  /**
   * Ladder 12b (the supported pose's fit only; absent: the fit turns the elbow as far as it needs): the elbow fit's turn
   * about the shoulder-to-palm line moves the elbow at most this fast (m/s, per pose step), the twist left outside the
   * window by what it could not reach. On a folded arm that line is short and the twist hardly follows the turn, so the
   * fit swung the elbow round it: 38 cm in one substep on HC-F3-lowRunner D's left arm, and every one-frame turn of a
   * raised clip arm coming down under the anatomical window (L3-F1, HC-F3).
   */
  fitMaxMps?: number;
}

export const JOINT_RANGE_V1: JointRangeProfile = {
  id: 'joint-range-v1',
  shoulder: { ...ENVELOPE_L4.shoulder, cone: { tiltDeg: 67.5, towardDeg: 25, alongDeg: 110, acrossDeg: 95 } },
  forwardCostM: 0.01,
  ankle: { dorsiDeg: 25, plantarDeg: 50 },
  limpFoot: { pitchDeg: 15, easeS: 0.3 },
};

/** Contact motion M1: plan 12's ranges, with the upper arm's twist kept in range and continuous (`shoulderTwist`). */
export const JOINT_RANGE_V2: JointRangeProfile = { ...JOINT_RANGE_V1, id: 'joint-range-v2', shoulderTwist: { marginDeg: 2, maxRateRadPs: 12 } };

/** Ladder 11b: V2 with the supported thigh's rotation kept in the ragdoll hip's twist range and continuous (`hipTwist`). */
export const JOINT_RANGE_V3: JointRangeProfile = { ...JOINT_RANGE_V2, id: 'joint-range-v3', hipTwist: { envelope: ENVELOPE_L4.hip, marginDeg: 5, maxRateRadPs: 12 } };

/** Ladder 11d: V2 with the shoulder's M1 twist in the anatomical measure (`anatomical`); not V3's thigh rotation. */
export const JOINT_RANGE_V4: JointRangeProfile = { ...JOINT_RANGE_V2, id: 'joint-range-anat-v4', shoulderTwist: { ...JOINT_RANGE_V2.shoulderTwist!, anatomical: true } };

/** Ladder 12b: V4 with the supported pose's elbow fit moving the elbow at most 6 m/s (`fitMaxMps`, the fast continuity rate). */
export const JOINT_RANGE_V5: JointRangeProfile = { ...JOINT_RANGE_V4, id: 'joint-range-anat-fit-v5', shoulderTwist: { ...JOINT_RANGE_V4.shoulderTwist!, fitMaxMps: 6 } };

/**
 * Plan 13f leg guard (absent = the guard measures other bodies where they stand): the supported pose's leg guard also
 * measures the legs against where the other bodies will be after `aheadS`, each moved by its motion relative to the
 * posing player, so a shown leg the guard holds clear is still clear when a conversion checks it on the next substep.
 */
export interface LegGuardProfile {
  id: string;
  /** Prediction time (s): one physics substep. */
  aheadS: number;
  /**
   * Contact motion prerequisite (thigh tangle, ladder rung 5): the supported legs' achieved step is judged, not only its
   * target, against the physical bodies (where they stand and where the prediction puts them). A step still past the
   * clearance tries the other leg placements (the knee poles of the primary placement, then the offsets), and a step that
   * would pass through a body stops at its last clear point (absent: unchanged). Ladder rung 7: a planted foot's leg
   * whose primary placement gives up (or, with `physicalLegs`, is in a body the legs meet) takes the primary at another
   * knee pole first, the foot kept on its anchor within the footwork tolerance, before any offset (which footwork
   * releases); it keeps that pole while valid and returns once the primary is clear at its own knee.
   */
  sweep?: true;
  /**
   * Contact motion prerequisite (ladder rung 6): the supported proxy's legs are physical. Massless thigh, shin and shoe
   * colliders on the proxy's own body follow the achieved pose each substep, so another body's contact on a shown leg
   * is a contact on the proxy (the solver applies it once, equal and opposite). They meet another player's ragdoll
   * segment colliders (ragdoll legs included) and nothing else (pose-runtime `legMeets`): not another player's proxy,
   * supported or falling (supported against supported stays the proxy collision's and the pose guards'), its physical
   * legs, a ragdoll's self-clearance shapes, static ground (floor, obstacles) or their own body. Live only while the
   * proxy stands on support-eligible static ground (pose-runtime `physicalLegsLive`); removed with the proxy at a conversion; a leg inside
   * another player's new ragdoll at its conversion leaves the solve until clear (`legsOffInsideConverted`). The pose
   * leaves a physical leg at most PHYS_LEG_OK (pose.ts) in a body it meets, where that body stands, where the prediction
   * puts it, and where it stands stopped (absent: unchanged).
   */
  physicalLegs?: true;
  /** Ladder 11c (with `sweep`; absent: a knee-pole placement does not read the other leg). */
  ownLegs?: OwnLegProfile;
}

/**
 * Ladder 11c: the supported legs' knee-pole placements and the other leg. Rung 7's planted pose (and rung 5's other
 * placements) take the primary placement at another knee pole when the primary gives up; the first of those poles turns
 * the knee in, so a held runner's planted leg crossed its other thigh (L3-F6-hold R's left knee pole from 3.90 s: the
 * distal thighs' axes 22.7 -> 13.5 cm apart, to 5.0 s). A knee-pole placement whose bone axes (the distal half thigh,
 * the shin, ankle to shoe: radii `thighRadiusM`, `shinRadiusM`, `footRadiusM`, the visible meter's slim radii) come
 * nearer the other leg's (as last shown) than the radii's sum, and nearer than the primary placement brings them, is not
 * taken. Engineering settings, not measured ranges.
 */
export interface OwnLegProfile {
  thighRadiusM: number;
  shinRadiusM: number;
  footRadiusM: number;
}

/** Plan 13f's predictive guard: registered on every L3, L4 and HC fixture until the ladder 10 flip (now the lab's `legs=v1`). */
export const LEG_GUARD_V1: LegGuardProfile = { id: 'leg-guard-predictive-v1', aheadS: 1 / 240 };
/** Contact motion prerequisite: plan 13f's prediction with the swept leg step (`sweep`). No fixture uses it yet. */
export const LEG_GUARD_V2: LegGuardProfile = { ...LEG_GUARD_V1, id: 'leg-guard-sweep-v2', sweep: true };
/**
 * Contact motion prerequisite: `LEG_GUARD_V2` with physical supported legs (`physicalLegs`). Registered on every fixture
 * with a leg guard since the ladder 10 flip (fixtures/index.ts `legFlip`).
 */
export const LEG_GUARD_V3: LegGuardProfile = { ...LEG_GUARD_V2, id: 'leg-guard-physical-v3', physicalLegs: true };

/** Ladder 11c: V3 with the knee-pole placements kept off the other leg (`ownLegs`). */
export const LEG_GUARD_V4: LegGuardProfile = { ...LEG_GUARD_V3, id: 'leg-guard-own-v4', ownLegs: { thighRadiusM: 0.075, shinRadiusM: 0.05, footRadiusM: 0.04 } };

/**
 * Plan 12: the ragdoll under a joint-range profile. The envelope's shoulder is the profile's (an L4 envelope keeps its
 * hips); a ragdoll without an envelope gets a shoulder-only one with the plan 09 tolerance, persistence and slack decay.
 */
export function withJointRange(R: RagdollProfile, J: JointRangeProfile): RagdollProfile {
  const E = R.envelope;
  const envelope: RagdollEnvelope = E
    ? { ...E, id: `${E.id}+${J.id}`, shoulder: J.shoulder }
    : { id: `envelope-${J.id}`, mode: 'soft', toleranceDeg: ENVELOPE_L4.toleranceDeg, persistS: ENVELOPE_L4.persistS, slackDecayDegPerS: ENVELOPE_L4.slackDecayDegPerS, shoulder: J.shoulder };
  return { ...R, id: `${R.id}+${J.id}`, envelope };
}

/**
 * Plan 09 active fall response: bounded internal joint torque on an accepted ragdoll only. Every value is an initial
 * engineering setting, not a measured athlete strength. The falling arm budget is the ragdoll profile's own; arm torque
 * shares it with passive grasp tension through the arm allocator.
 */
export interface FallResponseProfile {
  id: string;
  timing: { delayS: number; rampS: number; fadeStartS: number; fadeS: number };
  ceilingsNm: { shoulder: number; elbow: number; hip: number; knee: number };
  gains: Record<'shoulder' | 'elbow' | 'hip' | 'knee', { kp: number; kd: number }>;
  knee: { flexDeg: number; maxDeg: number; rampS: number };
  hip: { flexDeg: number; rampS: number };
  arms: {
    carryArm: 'left' | 'right';
    /** Gain scale of a holding arm around its achieved pose, and of a brace after it touches the ground (yield). */
    holdScale: number;
    yieldScale: number;
    /** How long a forearm hold survives without a solved contact. */
    holdMemoryS: number;
  };
  brace: {
    /** Prediction horizon, and the shoulder height the prediction aims at inside it. */
    horizonS: [number, number];
    shoulderHeightM: number;
    /** Hand lead along the horizontal motion, outward offset, the largest offset from under the shoulder, palm height. */
    leadS: number;
    lateralM: number;
    maxOffsetM: number;
    palmYM: number;
    /** A bracing elbow keeps this flexion, so a load bends it instead of locking it. */
    minElbowDeg: number;
    /** Target travel limits: the target starts at the achieved pose. */
    maxDirRateRadPerS: number;
    maxElbowRateRadPerS: number;
    /** Keeps a shoulder target this far inside its envelope. */
    envelopeMarginDeg: number;
  };
  /**
   * Caps apply before the solve, and every realized substep is audited against them with `toleranceFraction`: any
   * exceedance fails, impact or not. Planned positive power is held to `planFraction` of the cap, because the per-joint
   * prediction leaves out how one joint's torque moves its neighbours. Effort stops for good once less work remains
   * than one substep at the tolerated power could use, so the last substep cannot pass the work cap. A substep whose
   * joint speed jumped more than `impactOmegaRadPerS` beyond what the torque explains is tagged an impact, for diagnosis.
   */
  power: { maxPositiveW: number; maxPositiveWorkJ: number; toleranceFraction: number; planFraction: number; impactOmegaRadPerS: number };
  /**
   * Contact changes joint speeds inside the solve faster than any cap set before it can follow, so effort holds off a
   * limb (the whole body, for the core or head) in a substep where its geometry meets something closing faster than
   * `closingMPerS` within `lookaheadSubsteps`, or after a solve that gave it a contact impulse over `impulseNs`. A
   * segment jointed to the core (thigh, upper arm) closing faster than `bodyClosingMPerS` holds the whole body.
   */
  impactGuard: {
    closingMPerS: number;
    bodyClosingMPerS: number;
    impulseNs: number;
    lookaheadSubsteps: number;
    predictionM: number;
    skinM: number;
    /**
     * A contact's closing speed also counts the parent joint's velocity residual along the contact normal: what the
     * last solve left unsatisfied at the segment's own joint, which the next solve passes through the segment into what
     * it rests on (absent: off).
     */
    jointResidual?: true;
    /**
     * A contact closes at every point of its pair's last contact manifold (moved with both colliders to their current
     * poses), not only at the closest point: a segment turning on a face or edge contact separates at its pivot while
     * its far points close, and the solve resolves them all (absent: the closest point only).
     */
    manifoldPoints?: true;
    /**
     * A landing carried through a closing contact: a segment jointed to the core, closing faster than `closingMPerS` on
     * another player's ragdoll that is itself about to land on static ground (floor, obstacles) faster than
     * `bodyClosingMPerS`, holds the whole body, though its own closing is under the body speed (absent: off). Only a
     * segment closing on the landing body counts, not one near it.
     */
    carried?: true;
    /**
     * Ladder 9f: a limb striking its own trunk (plan 11's forearm pairs, rung 9a's shin and shoe pairs) closing faster
     * than `bodyClosingMPerS` holds the whole body: the trunk it strikes is the core, so the hit turns the core and every
     * joint it parents, as a hard hit on a core-jointed segment does (absent: the striking limb only).
     */
    selfTrunkBody?: true;
  };
  enable: { knee: boolean; hip: boolean; arms: boolean };
}

/** Ladder 9f: `p` with `impactGuard.selfTrunkBody` (an own-trunk hit faster than the body speed holds the body). */
export function withSelfTrunkBody(p: FallResponseProfile): FallResponseProfile {
  if (p.impactGuard.selfTrunkBody) return p;
  return { ...p, id: `${p.id}+selfTrunkBody`, impactGuard: { ...p.impactGuard, selfTrunkBody: true } };
}

/**
 * v2 (plan 10c): the same numbers under changed behaviour. C1: a hold's grasp is allocated before any arm effort, which
 * gets only what is left of the owner budget. C2: the protect arm is the arm the ball is on (a profile declaring
 * another fails at the conversion). C3: ground is the floor only. C4: a brace miss is `obstructed` only when the seeking
 * brace was blocked within its shortest prediction horizon, never by a hold. C5: the brace direction turns at its rate
 * limit also between opposite vectors. Bookkeeping (C7): `activeSubsteps` counts only substeps that applied torque.
 */
/**
 * v3 (plan 14): a thigh or upper arm closing on something faster than 2 m/s holds the whole body. In
 * `L4-F9-defenderFalling` the runner's core met the defender's right thigh at 3.0 m/s; the guard held only that leg, and
 * the kick through the hip into the core drove the right shoulder to 44.6 W against its predicted 20.0, 171 W in all.
 */
/**
 * v4 (ladder rung 4a): a contact's closing speed counts its segment's joint residual (`impactGuard.jointResidual`): a
 * joint the last solve left unsatisfied passes the rest through the segment into what it rests on in the next one.
 */
/**
 * v5 (ladder rung 4b): a contact's closing speed is read at every point of its manifold (`impactGuard.manifoldPoints`):
 * a core rocking on one torso corner closes at the others while the closest point, the pivot, separates.
 * v6 (ladder rung 6c): a landing carried through a closing contact holds the body (`impactGuard.carried`).
 */
export const FALL_L4: FallResponseProfile = {
  id: 'fall-response-l4-v6',
  timing: { delayS: 0.04, rampS: 0.08, fadeStartS: 0.8, fadeS: 0.2 },
  ceilingsNm: { shoulder: 15, elbow: 10, hip: 18, knee: 22 },
  gains: { shoulder: { kp: 60, kd: 6 }, elbow: { kp: 35, kd: 3 }, hip: { kp: 45, kd: 6 }, knee: { kp: 40, kd: 5 } },
  knee: { flexDeg: 40, maxDeg: 110, rampS: 0.25 },
  hip: { flexDeg: 30, rampS: 0.3 },
  arms: { carryArm: 'right', holdScale: 0.4, yieldScale: 0.35, holdMemoryS: 0.1 },
  brace: {
    horizonS: [0.1, 0.25],
    shoulderHeightM: 0.55,
    leadS: 0.06,
    lateralM: 0.12,
    maxOffsetM: 0.4,
    palmYM: 0.02,
    minElbowDeg: 12,
    maxDirRateRadPerS: 14,
    maxElbowRateRadPerS: 14,
    envelopeMarginDeg: 8,
  },
  power: { maxPositiveW: 150, maxPositiveWorkJ: 100, toleranceFraction: 0.05, planFraction: 0.9, impactOmegaRadPerS: 1 },
  impactGuard: { closingMPerS: 0.5, bodyClosingMPerS: 2, impulseNs: 10, lookaheadSubsteps: 1.5, predictionM: 0.1, skinM: 0.002, jointResidual: true, manifoldPoints: true, carried: true },
  enable: { knee: true, hip: true, arms: true },
};

export const RAGDOLL_G4: RagdollProfile = {
  id: 'ragdoll-g4-v1',
  massFractions: { core: 0.48, head: 0.08, upperArm: 0.04, forearm: 0.03, thigh: 0.1, shin: 0.05 },
  palmMassShare: 0.2,
  shoeMassShare: 0.2,
  lengths: { upperArm: 0.35, forearm: 0.34, palmExtension: 0.05, thigh: 0.44, shin: 0.36 },
  radii: { upperArm: 0.055, forearm: 0.045, palm: 0.04, thigh: 0.085, shin: 0.065, head: 0.14 },
  shoe: { halfExtents: v3(0.08, 0.05, 0.14), belowAnkleM: 0.05, forwardM: 0.08 },
  limitsDeg: { neck: [-35, 35], elbow: [0, 145], knee: [0, 150] },
  selfCollision: 'disabledAllSameOwner',
  validation: {
    anchorTolM: 0.002,
    penetrationTolM: 0.015,
    landmarkTolM: 0.01,
    lengthTolM: 0.002,
    straightBendDeg: 0.5,
    energyGainAbsJ: 10,
    energyGainFraction: 0.5,
  },
  audit: { massTolKg: 1e-4, linearRelTol: 1e-5, angularRelTol: 1e-4 },
  passiveGrip: { stiffness: 3000, damping: 100, maxSeparationM: 0.1, budgetFraction: 0.35 },
};

/** Pose blueprint used for presentation when no ragdoll profile is configured (Gate 1-3 fixtures). */
export const DEFAULT_POSE_PROFILE = RAGDOLL_G4;

/** Plan 09: the Gate 4 ragdoll with the anatomical envelope; everything else is the same blueprint. */
export const RAGDOLL_L4: RagdollProfile = { ...RAGDOLL_G4, id: 'ragdoll-l4-v2', envelope: ENVELOPE_L4 };

// ---------------------------------------------------------------- rule observer (Gate 4)
/**
 * Referee-observation profile. `labCoreOnly` keeps the historical diagnostic (runner torso/pelvis-ground contact after
 * a valid handoff); `footballTackleSubset` observes eligible ground contact after defensive influence, sustained
 * physically restrained progress and a configured sideline. Numbers are transparent simulation thresholds, not
 * rulebook timing.
 */
export interface RuleProfile {
  id: string;
  kind: 'labCoreOnly' | 'footballTackleSubset';
  runnerId: string;
  /** Field-forward axis (unit, horizontal) for progress. */
  forwardAxis: Vec3;
  /** Ball reference: fixed offset in the runner's core frame (cosmetic carried ball; no collision, no fumbles). */
  ballLocal: Vec3;
  /**
   * Where the ball is: `coreOffset` (default) = ballLocal in the core frame; `carryPalm` = the runner's ball-arm palm in
   * the sim-owned physical pose (plan 06: the run-clip carry arm moves the ball); `carryPose` = the seated ball's centre
   * on the achieved forearm (plan 08a, the pose's `carriedBall` landmark). Both fall back to ballLocal when no pose
   * exists.
   */
  ballSource?: 'coreOffset' | 'carryPalm' | 'carryPose';
  /**
   * Ground-region labels that can produce the ending (rules.ts GroundRegion). Hand/wrist, foot/ankle and the virtual
   * foot support are never eligible; the wrist/ankle band is classified per contact point, not per limb.
   */
  eligibleRegions: string[];
  /** Wrist/ankle exclusion band along the forearm/shin from the landmark (m). */
  endBandM: number;
  /** A solved ground contact point counts when it penetrates or its normal impulse exceeds this (N s). */
  groundImpulseMinNs: number;
  /** Achieved-pose limb probe tolerance above the ground plane for a proxy (no limb colliders), m. */
  poseGroundTolM: number;
  /**
   * Continuing defensive influence: opponent contact impulse (N s) or a grip / loaded clamp establishes it; it clears
   * after `clearAfterSupportedS` of supported, grounded, unopposed movement at >= `unrestrainedFraction` of the
   * requested speed along the request.
   */
  influence: { clearAfterSupportedS: number; minContactImpulseNs: number; unrestrainedFraction: number };
  progress: { enabled: boolean; windowS: number; maxAdvanceM: number; minRestraintN: number; minRequestMps: number };
  /** Sideline plane: a touch point p is on/outside when dot(p, outwardNormal) >= offsetM - touchTolM. */
  sideline: { enabled: boolean; outwardNormal: Vec3; offsetM: number; touchTolM: number };
  /** Passive settling after an ending before the trial stops (s). */
  settleS: number;
  /**
   * Plan 10e (U8, U9): the rule corrections, on a revision opted in on L3 and L4 (`rulesRevision2`). Absent on every
   * historical profile, which keeps the behaviour it was recorded with. 2: the settle window keeps each player's stance
   * request and yaw effort (E1); influence clears only out of opponent contact and retention (E2); progress counts the
   * retention force opposing it, not its magnitude (E3).
   */
  revision?: 2;
}

const FOOTBALL_ELIGIBLE = ['torso', 'pelvis', 'head', 'upperArm', 'elbow', 'forearm', 'thigh', 'knee', 'shin'];

const fmtAxis = (a: Vec3): string => `${a.x},${a.y},${a.z}`;
const sameAxis = (a: Vec3, b: Vec3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;

/** The authored ball reference: right arm of a right = +X body, in the core frame (m). Model runners scale it (model/profiles). */
export const AUTHORED_BALL_LOCAL: Vec3 = v3(0.2, 0.3, 0.12);

/**
 * The football rule profile. Every option that departs from the default appears in the id (`+fwd=0,0,-1`,
 * `+sideline=off`, ...), so one id always stands for one set of values; variants built by spreading a profile derive
 * their id the same way (`ruleVariant`).
 */
export const RULES_FOOTBALL = (
  runnerId: string,
  o: { forwardAxis?: Vec3; sidelineNormal?: Vec3; sidelineOffsetM?: number; progress?: boolean; sideline?: boolean } = {},
): RuleProfile => ({
  id: [
    'rules-g4-footballTackleSubset-v1',
    ...(o.forwardAxis && !sameAxis(o.forwardAxis, v3(1, 0, 0)) ? [`fwd=${fmtAxis(o.forwardAxis)}`] : []),
    ...(o.sidelineNormal && !sameAxis(o.sidelineNormal, v3(0, 0, 1)) ? [`sidelineN=${fmtAxis(o.sidelineNormal)}`] : []),
    ...(o.sidelineOffsetM !== undefined && o.sidelineOffsetM !== 4 ? [`sidelineOffset=${o.sidelineOffsetM}`] : []),
    ...(o.progress === false ? ['progress=off'] : []),
    ...(o.sideline === false ? ['sideline=off'] : []),
  ].join('+'),
  kind: 'footballTackleSubset',
  runnerId,
  forwardAxis: o.forwardAxis ?? v3(1, 0, 0),
  ballLocal: { ...AUTHORED_BALL_LOCAL },
  eligibleRegions: FOOTBALL_ELIGIBLE,
  endBandM: 0.03,
  groundImpulseMinNs: 1e-4,
  poseGroundTolM: 0.01,
  influence: { clearAfterSupportedS: 0.2, minContactImpulseNs: 1e-3, unrestrainedFraction: 0.5 },
  progress: { enabled: o.progress ?? true, windowS: 0.75, maxAdvanceM: 0.05, minRestraintN: 20, minRequestMps: 0.5 },
  sideline: { enabled: o.sideline ?? true, outwardNormal: o.sidelineNormal ?? v3(0, 0, 1), offsetM: o.sidelineOffsetM ?? 4, touchTolM: 0 },
  settleS: 0.5,
});

/** A rule profile with some values replaced, under an id that names the change (`<base id>+<label>`). */
export const ruleVariant = (base: RuleProfile, label: string, patch: Partial<Omit<RuleProfile, 'id'>>): RuleProfile => ({ ...base, ...patch, id: `${base.id}+${label}` });

/** Plan 10e: a rule profile on the corrected revision (`+revision=2`); a profile already on it is returned as it is. */
export const rulesRevision2 = (r: RuleProfile): RuleProfile => (r.revision === 2 ? r : ruleVariant(r, 'revision=2', { revision: 2 }));

export const RULES_LAB_CORE = (runnerId: string): RuleProfile => ({
  ...RULES_FOOTBALL(runnerId, { progress: false, sideline: false }),
  id: 'rules-g4-labCoreOnly-v1',
  kind: 'labCoreOnly',
  eligibleRegions: ['torso', 'pelvis'],
});
