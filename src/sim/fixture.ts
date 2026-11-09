// Fixture definition: starting conditions and requests, never post-contact trajectories.
import type { CarryProfile } from './carry';
import type { ArmSide, PlayerId, Role, StanceRequest } from './contracts';
import type { ArmProfile, ArmSetup, BalanceProfile, BodyProfile, FallResponseProfile, MotorProfile, RagdollProfile, RuleProfile, SelfClearanceProfile, SolverProfile, StanceProfile, SupportProfile } from './profiles';
import type { CandidateEdit } from './ragdoll';
import type { FootworkProfile } from './footwork';
import type { LocomotionProfile } from './locomotion';
import type { RunClipProfile } from './run-clip';
import type { ScriptSpec } from './controllers/base';
import type { CoachedEntrySpec } from './controllers/coached';
import type { WrapSpec } from './controllers/wrap';
import type { Vec3 } from './vec';

export type ControllerSpec = ScriptSpec | CoachedEntrySpec | WrapSpec;

export interface PlayerSetup {
  id: PlayerId;
  role: Role;
  body: BodyProfile;
  motor?: MotorProfile;
  initial: {
    x: number;
    z: number;
    yawDeg: number;
    /** Extra height above the resting origin (airborne fixtures). */
    lift?: number;
    velocity?: Vec3;
    angularVelocity?: Vec3;
    /** Initial lean (deg) applied after settling, rotating about the support hemisphere so floor contact stays valid. */
    leanDeg?: number;
    /** Horizontal world direction the body leans toward (default: the body's forward). */
    leanDirWorld?: Vec3;
    /** Clearly labelled external diagnostic impulse applied once at t = 0 (N s), at a body-local point. */
    diagnosticImpulse?: { impulse: Vec3; pointLocal: Vec3 };
    /** Initial run-clip (and procedural gait) phase, normalized (0 = left touchdown); default runner 0, defender 0.25. */
    runPhase?: number;
    /**
     * Suspension support only: the stance request in force at reset (root height, stagger), placing the body at its
     * height target before settling. It should equal the controller's first request; default the standing height.
     */
    stance?: StanceRequest;
  };
  /** Anatomical shoulder selected for connection (classification label "shoulder:selected"). */
  selectedShoulder?: ArmSide;
  /** Arm configuration (Gate 2); absent = no simulated arms. */
  arms?: ArmSetup;
  controller: ControllerSpec;
  color?: string;
}

export interface FixtureDef {
  id: string;
  gate: number;
  milestone: string;
  title: string;
  notes?: string;
  solver: SolverProfile;
  stance: StanceProfile;
  motor: MotorProfile;
  /** Arm profile (Gate 2) for every player with `arms`. */
  armProfile?: ArmProfile;
  /** Balance profile (Gate 3); used only with a free-rotation stance. */
  balance?: BalanceProfile;
  /** Gate 4: ragdoll handoff on loss of support (absent = Gate 3 falling proxy). */
  ragdoll?: RagdollProfile;
  /** Gate 4: completion rule observer profile (absent = none). */
  rules?: RuleProfile;
  /**
   * Plan 06: decoded supplied run clips sampled into the physical pose of every upper-body player (absent = the
   * procedural gait only). Pose only: never read by forces, support or rules other than through the pose.
   */
  runClips?: RunClipProfile;
  /**
   * Plan 06a: vertical support profile (absent = the named legacy capsule-floor support, SUPPORT_LEGACY). RH fixtures opt
   * into the ground-probed suspension explicitly.
   */
  support?: SupportProfile;
  /**
   * Arm self-clearance (absent = arms ignore their own body). Supported pose arms, arm-task arms and (with `ragdoll`)
   * ragdoll forearms stay out of each player's own measured trunk; players without a measured trunk are unaffected.
   */
  selfClearance?: SelfClearanceProfile;
  /**
   * Plan 07: per-foot plant / swing planner (absent = the plan 06/06a pose path unchanged). Pose only; requires the
   * suspension support (the planner reads its probed ground).
   */
  footwork?: FootworkProfile;
  /** Plan 08: locomotion composition (free-arm poses, locomotion mode; absent: the plan 07 path unchanged). Pose only. */
  locomotion?: LocomotionProfile;
  /** Plan 08a: the ball carrier's right-arm carry and football seat; absent: the plan 06 hold. */
  carry?: CarryProfile;
  /** Plan 09: active fall response of accepted ragdolls (absent: passive). Needs a ragdoll profile with an envelope. */
  fallResponse?: FallResponseProfile;
  /** Clearly labelled diagnostic interventions (never contact-driven outcomes). */
  diagnostics?: {
    conversions?: DiagnosticConversionSpec[];
    /** Labelled external force at the player's COM over [fromS, toS) (plan 06a load tests). */
    forces?: { playerId: PlayerId; fromS: number; toS: number; forceWorld: Vec3 }[];
    /** Labelled equal and opposite torque pair across one ragdoll joint over [fromS, toS) (plan 09 limit load tests). */
    jointLoads?: { playerId: PlayerId; joint: string; fromS: number; toS: number; torqueParentNm: Vec3 }[];
    /** The same, always along the envelope's own gradient, so a stated load presses straight into a shoulder or hip limit. */
    limitLoads?: { playerId: PlayerId; joint: string; fromS: number; toS: number; limit: 'swing' | 'twist'; torqueNm: number }[];
  };
  /**
   * Static diagnostic obstacles (cuboids). `surface: 'turf'` marks a turf patch the suspension probe may stand on (its
   * normal is still checked); any other obstacle under a probe is an invalid support surface.
   */
  obstacles?: { id: string; center: Vec3; halfExtents: Vec3; yawDeg?: number; rollDeg?: number; surface?: 'turf' }[];
  players: PlayerSetup[];
  durationS: number;
  /** Ticks of passive settling before t = 0 (initial velocities are set after settling). */
  settleS: number;
  /** Practice area half extents; leaving it stops the trial as practiceOutOfBounds (not a wall). */
  area: { halfX: number; halfZ: number };
  focus?: Record<PlayerId, PlayerId>;
  /** Cosmetic-only options; the simulation never reads these. */
  cosmetic?: { palette?: string };
}

/**
 * Labelled diagnostic conversion. `when` (plan 06a RH-F7) delays it from `atS` to the first substep at which the proxy's
 * vertical velocity is rising (> 0.05 m/s), falling (< -0.05 m/s), or passes a height extremum (top: velocity turns
 * from up to down; bottom: from down to up).
 */
export interface DiagnosticConversionSpec {
  playerId: PlayerId;
  atS: number;
  edit?: CandidateEdit;
  when?: 'rising' | 'falling' | 'top' | 'bottom';
}

export const PRACTICE_AREA = { halfX: 8, halfZ: 6 };
