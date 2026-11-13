// Shared runtime contracts: identities, intents, snapshots, contacts, events.
import type { Quat, Vec3 } from './vec';
import type { ArmObs, WrapStatus } from './arms';

export type PlayerId = string;
export type ArmSide = 'left' | 'right';
export type Role = 'runner' | 'defender';
export type ControlMode = 'supported' | 'falling';
export type Representation = 'proxy' | 'ragdoll';

export type SegmentId =
  | 'core'
  | 'head'
  | 'leftUpperArm'
  | 'leftForearm'
  | 'rightUpperArm'
  | 'rightForearm'
  | 'leftThigh'
  | 'leftShin'
  | 'rightThigh'
  | 'rightShin';

/** Body part a contact/grip refers to. A proxy is entirely `core`; a ragdoll uses its SegmentId. */
export type BodyPartId = SegmentId;

export type ColliderRegion =
  | 'capsule'
  | 'support'
  | 'torso'
  | 'pelvis'
  | 'head'
  | 'neck'
  | 'upperArm'
  | 'forearm'
  | 'palm'
  | 'thigh'
  | 'shin'
  | 'shoe'
  | 'floor';

export interface ColliderTag {
  playerId: PlayerId | null;
  part: BodyPartId | 'floor';
  region: ColliderRegion;
  side?: ArmSide;
  /** Stable key for this collider within its player (survives handle changes). */
  key: string;
}

export interface LocomotionIntent {
  desiredVelocityWorld: Vec3; // horizontal, m/s
  desiredFacingWorld: Vec3; // normalized horizontal direction
  effort: number; // clamped 0..1 (ground drive)
  /** Yaw steering effort 0..1 (default 1). */
  yawEffort?: number;
  /**
   * Plan 06a stance request (suspension support only; ignored by the legacy capsule-floor support): requested root
   * height (m above the ground; default the profile's standing height; clamped to its target range) and the stance
   * foot stagger (m, the left foot forward of the right; pose only).
   */
  stance?: StanceRequest;
}

export interface StanceRequest {
  heightM?: number;
  staggerM?: number;
}

export interface ArmIntent {
  action: 'rest' | 'reach' | 'close' | 'pull' | 'release';
  targetWorld: Vec3;
  /** 0..1 closing effort for forearm clamps (default 1). */
  closeEffort?: number;
  /**
   * Contact motion polish 1.1: an elbow pole (owner-local direction from the shoulder) the arm tries first, ahead of its
   * own alternatives and unsorted (the twist window still bounds how fast the elbow turns toward it). Absent: as before.
   */
  poleLocal?: Vec3;
}

/** Gate 3 balance observation (radians; displayed degrees are derived separately). */
export interface BalanceState {
  playerId: PlayerId;
  controlMode: ControlMode;
  leanAngleRad: number;
  outwardLeanRateRadPerS: number;
  projectedLeanRad: number;
  supportingContact: boolean;
  requestedBalanceTorqueNm: Vec3;
  actualBalanceTorqueNm: Vec3;
  recoveryLimitCounter: number;
}

export interface PostureIntent {
  /** Desired lean direction (horizontal) and magnitude (rad, bounded by the balance profile). */
  leanDirWorld: Vec3;
  leanRad: number;
  /**
   * Contact motion polish 1.1 (a fixture whose wrap profile has a strike, `WrapProfile.strike`; ignored otherwise): the
   * hip hinge. The trunk pitches `rad` forward (about its own level lateral axis) beyond the legs' lean and the hips drop
   * `dropM`, each bounded and rate-limited by the strike's hinge limits (hinge.ts). The legs keep the balance: the
   * support and the loss envelope read the legs' frame, not the pitched trunk's.
   */
  hinge?: { rad: number; dropM: number };
}

export interface PlayerIntent {
  locomotion: LocomotionIntent;
  arms?: Partial<Record<ArmSide, ArmIntent>>;
  posture?: PostureIntent;
  /**
   * Contact motion M3: a supported player's request to leave support (the committed finish's 'takedown', under a wrap
   * profile with one). The simulation converts him through the validated path at the next substep's boundary, as a loss
   * of support would, unless the referee has ended the play.
   */
  leaveSupport?: 'takedown';
  /**
   * Contact motion polish 1.2, the ride-down (a wrap profile with `ride`): he rides the carrier he holds down. While the
   * simulation sees the hold and the contact, a lean past the loss envelope against the carrier is no loss of support.
   */
  ride?: true;
  /** Controller-reported diagnostics (phase names, aim points). Never read by mechanics. */
  debug?: Record<string, unknown>;
}

export interface BodySnapshot {
  playerId: PlayerId;
  position: Vec3; // proxy origin (or ragdoll core origin)
  rotation: Quat;
  linearVelocity: Vec3; // COM velocity
  angularVelocity: Vec3;
  centerOfMassWorld: Vec3;
  grounded: boolean;
  massKg: number;
  controlMode: ControlMode;
  representation: Representation;
}

export interface ContactPointRec {
  pointWorld: Vec3;
  dist: number; // negative = penetration
  impulse: number; // normal impulse of the last step (N s)
}

/** One solved manifold between two colliders, oriented from A to B. */
export interface ContactRec {
  a: ColliderTag;
  b: ColliderTag;
  normalAB: Vec3;
  points: ContactPointRec[];
  impulse: number;
}

/** Region of a player-player contact point, as classified from geometry. */
export type ContactRegionClass =
  | 'shoulder:selected'
  | 'shoulder:other'
  | 'shoulder:left'
  | 'shoulder:right'
  | 'head'
  | 'torso'
  | 'pelvis'
  | 'support'
  | 'capsule'
  | 'limb';

export interface PlayerContactObs {
  /** Opponent id. */
  other: PlayerId;
  /** Own collider region and classified region at the deepest point. */
  ownRegion: ColliderRegion;
  ownClass: ContactRegionClass;
  otherRegion: ColliderRegion;
  otherClass: ContactRegionClass;
  pointWorld: Vec3;
  normalFromOther: Vec3;
  impulse: number;
}

export interface SimEvent {
  /** The trace row that carries this event's state (Simulation.stampTick). */
  tick: number;
  /** Physics substeps completed since t = 0 when the event was emitted (a global counter, not an index in the tick). */
  step: number;
  t: number;
  type: string;
  playerId?: PlayerId;
  data?: Record<string, unknown>;
}

export interface Snapshot {
  tick: number;
  substep: number;
  t: number;
  bodies: Record<PlayerId, BodySnapshot>;
  /** Player-player contact observations keyed by own player id (from the last solved step). */
  contacts: Record<PlayerId, PlayerContactObs[]>;
  /** Closest surface distance between player pairs (`a|b` sorted ids), negative if penetrating. */
  pairGap: Record<string, number>;
  /** Achieved arm state per player (players with arms only). */
  arms: Record<PlayerId, Partial<Record<ArmSide, ArmObs>>>;
  /** Observational wrap status per arm owner. */
  wrap: Record<PlayerId, { status: WrapStatus; target: PlayerId | null }>;
  /** Gate 3 balance state per player (free-rotation stance; zeros under the locked legacy stance). */
  balance: Record<PlayerId, BalanceState>;
}

/**
 * Plan 10c C3 (U6): ground is the floor only. An obstacle collider carries the floor's part and region (it is static
 * scenery), but its own key, and is not ground: not for ragdoll grounding, the fall response's core-down, or the rules.
 */
export const isGround = (t: ColliderTag): boolean => t.playerId === null && t.key === 'floor';

export const pairKey = (a: PlayerId, b: PlayerId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
