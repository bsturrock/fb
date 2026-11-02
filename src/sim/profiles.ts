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
}

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
  linearDamping: number;
  angularDamping: number;
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

export interface ProfileIds {
  body: Record<string, string>;
  motor: string;
  solver: string;
  stance: string;
  arm?: string;
  balance?: string;
  ragdoll?: string;
  rule?: string;
}

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
  /** Wrist/ankle exclusion band for ground-contact classification (m from the landmark along the limb). */
  endBandM: number;
}

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
  endBandM: 0.03,
};

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
}

const FOOTBALL_ELIGIBLE = ['torso', 'pelvis', 'head', 'upperArm', 'elbow', 'forearm', 'thigh', 'knee', 'shin'];

export const RULES_FOOTBALL = (
  runnerId: string,
  o: { forwardAxis?: Vec3; sidelineNormal?: Vec3; sidelineOffsetM?: number; progress?: boolean; sideline?: boolean } = {},
): RuleProfile => ({
  id: 'rules-g4-footballTackleSubset-v1',
  kind: 'footballTackleSubset',
  runnerId,
  forwardAxis: o.forwardAxis ?? v3(1, 0, 0),
  ballLocal: v3(0.2, 0.3, 0.12),
  eligibleRegions: FOOTBALL_ELIGIBLE,
  endBandM: 0.03,
  groundImpulseMinNs: 1e-4,
  poseGroundTolM: 0.01,
  influence: { clearAfterSupportedS: 0.2, minContactImpulseNs: 1e-3, unrestrainedFraction: 0.5 },
  progress: { enabled: o.progress ?? true, windowS: 0.75, maxAdvanceM: 0.05, minRestraintN: 20, minRequestMps: 0.5 },
  sideline: { enabled: o.sideline ?? true, outwardNormal: o.sidelineNormal ?? v3(0, 0, 1), offsetM: o.sidelineOffsetM ?? 4, touchTolM: 0 },
  settleS: 0.5,
});

export const RULES_LAB_CORE = (runnerId: string): RuleProfile => ({
  ...RULES_FOOTBALL(runnerId, { progress: false, sideline: false }),
  id: 'rules-g4-labCoreOnly-v1',
  kind: 'labCoreOnly',
  eligibleRegions: ['torso', 'pelvis'],
});
