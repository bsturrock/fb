// Fixture definition: starting conditions and requests, never post-contact trajectories.
import type { ArmSide, PlayerId, Role } from './contracts';
import type { ArmProfile, ArmSetup, BalanceProfile, BodyProfile, MotorProfile, RagdollProfile, RuleProfile, SolverProfile, StanceProfile } from './profiles';
import type { CandidateEdit } from './ragdoll';
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
  /** Clearly labelled diagnostic interventions (never contact-driven outcomes). */
  diagnostics?: {
    conversions?: { playerId: PlayerId; atS: number; edit?: CandidateEdit }[];
  };
  /** Static diagnostic obstacles (cuboids). */
  obstacles?: { id: string; center: Vec3; halfExtents: Vec3; yawDeg?: number }[];
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

export const PRACTICE_AREA = { halfX: 8, halfZ: 6 };
