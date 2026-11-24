// Shared runtime contracts: identities, intents, snapshots, contacts, events.
import type { Quat, Vec3 } from './vec';
import type { ArmObs, WrapStatus } from './arms';
import type { BlockProfile, BlockRequest, BlockState, HandIntent, PunchState } from './controllers/block';
import type { HingeLimits } from './hinge';

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
  /** Plan 16 (the base): each foot this much (m) further out from the hips than the standing stance (pose only; absent 0). */
  widthAddM?: number;
  /** Plan 16 (flat feet): the feet stand where a flat foot holds the hips (`FlatStance`; absent: under the hips). */
  flat?: FlatStance;
  /**
   * Plan 16 (p38, the lean-in): `heightM` is the whole of the root's height: the support takes no locomotion preparation
   * drop under it (a stance whose feet are placed for its own heights is its own preparation). Absent: the drop as ever.
   */
  heightWhole?: boolean;
  /**
   * Plan 16 (p40): the lowest root height (m) this stance may ask, in place of the suspension's `targetRangeM[0]` while it
   * is asked (only lower: a lineman's three-point stance, his hips about 0.65-0.7 m over the turf; every other stance keeps
   * the range's floor). The one reader is support.ts `stanceFloorM` (the stance filter's request, the height target and
   * the reset's placement). Absent: the range's floor.
   */
  lowM?: number;
}

/**
 * Plan 16 (flat feet, block-base.ts `flatAheadM`): a stance whose feet stand where the whole sole can be down. Each foot's
 * place (the stepping model's home, the pose's ordinary request) is far enough ahead of its hip, along the facing, that
 * the shin over a flat foot leans no more than the ankle's dorsiflexion range less `marginDeg` at the hips' height now
 * or the stance's lowest (`lowRootM`; the stagger kept: the pair moves forward together). Planted, a foot steps (its
 * turn or not) once its shin leans `stepPastDeg` past the range (the heel coming up), when its aim is within the range;
 * and with both feet down, a foot steps only once stepping gains it more than `coverM` (m, in place of the stepping
 * model's own), its want led by `captureK` of the capture point's lead.
 */
export interface FlatStance {
  id: string;
  marginDeg: number;
  stepPastDeg: number;
  coverM: number;
  /** The stepping model's want leads the hips by this times the capture point's lead (the model's: 1; 0: where the hips will be when the foot lands). */
  captureK: number;
  /**
   * The lowest root height (m above the ground) the stance asks for (absent: the hips' height now only): the feet stand
   * where a flat foot holds the hips at the lower of that and now, so they need no step as the stance sinks to it.
   */
  lowRootM?: number;
  /**
   * Plan 16 (p35): a brace (the base's `brace` asking his rear foot back) may take the rear foot back to where its shin
   * leans this far past the ankle's range at the hips' height now (deg; on the ball of the foot within the viewer's
   * limit, below `stepPastDeg`), not only to where it stands flat. Absent: a brace never takes a foot back past flat.
   */
  braceDeg?: number;
  /**
   * Plan 16 (p38, the lean-in): the feet behind the hips. Each foot's home stands where the rear foot stands on its ball,
   * pitched `pitchDeg` heel up about its toe with its shin at the ankle's range plus the pitch (at the hips' height now
   * or, lower, at `lowRootM`; block-base.ts `ballAheadM`), the front foot the stagger ahead of it; a plant whose foot
   * would stand pitched past `stepDeg` at the hips' height now steps, its turn or not, to an aim where it stands within
   * `pitchDeg`, landing where it would stand at `landDeg` (under the hips); a plant further ahead of its want (along its
   * heading) than `aheadCoverM` steps, its turn or not (the feet kept behind the hips). In place of the flat rule (`marginDeg`,
   * `stepPastDeg`, `braceDeg` unused). Absent: the flat rule.
   */
  ball?: { pitchDeg: number; stepDeg: number; landDeg: number; aheadCoverM: number };
  /**
   * Plan 16 (p39): the ankle's dorsiflexion range (deg) under this stance, in place of the joint range profile's
   * `ankle.dorsiDeg` for his feet while he stands in it (the owner's ruling, 2026-11-18: a man in a block or a blocking
   * stance bends the ankle to about 38 deg under load; every other player keeps the profile's 25). The pose's ankle, the
   * flat and ball rules here and the visible meter read it (pose-runtime.ts `jointRangeOf`); a ragdoll made from him takes
   * the profile's range as ever. Absent: the profile's.
   */
  dorsiDeg?: number;
  /**
   * Plan 16 (p40): the feet placed along his level forward (pose-runtime.ts `levelFwdOf`: through a trunk pitched near
   * and past 90 deg, a three-point stance), not along his body's forward levelled. Absent: the body's.
   */
  level?: true;
  /**
   * Plan 16 (p49): his plants toed out by this (deg, each foot's toe turned away from his midline off his facing) while
   * he stands in this stance: the plants the reset takes and every step's landing. The knee follows the foot (its pole
   * is the plant's heading), so in a wide set stance it comes out over the foot instead of inside the ankle. A stance
   * without it (his block's, after the snap) lands its steps along his facing, so each foot turns back straight as it
   * steps. Absent: along his facing.
   */
  toeOutDeg?: number;
}

export interface ArmIntent {
  /**
   * Plan 16, `push` (an arm profile with `palmPush`; without one it reaches as `reach` does): the palm reaches for
   * `targetWorld` and, on the chest or the front of a shoulder of the player it meets there, pushes him (the palm push,
   * `PalmPushProfile`) for as long as the request lasts and the push holds.
   */
  action: 'rest' | 'reach' | 'close' | 'pull' | 'release' | 'push';
  targetWorld: Vec3;
  /** 0..1 closing effort for forearm clamps (default 1). */
  closeEffort?: number;
  /**
   * Contact motion polish 1.1: an elbow pole (owner-local direction from the shoulder) the arm tries first, ahead of its
   * own alternatives and unsorted (the twist window still bounds how fast the elbow turns toward it). Absent: as before.
   */
  poleLocal?: Vec3;
  /** Plan 16, the palm push's request (action `push`; absent: effort 1 at the arm's full reach). */
  push?: PushRequest;
  /**
   * Plan 16 (p51): the free palm's top speed for this request (m/s; absent: the arm profile's `maxEndpointSpeedMps`). A
   * move that carries its own timing (the hand fight's swipe along its arc) asks for more than the arm's everyday reach.
   */
  speedMps?: number;
  /**
   * Plan 16 (p51): the upper arm's top twist rate for this request (rad/s; absent: the joint range's
   * `ShoulderTwistProfile.maxRateRadPs`). A ballistic strike (the hand fight's swipe) turns the shoulder faster than an
   * everyday reach; held to the everyday rate, the twist window turns the elbow about the shoulder-to-palm line instead.
   */
  twistRadPs?: number;
}

/**
 * Plan 16, the palm push: `effort` 0..1 (default 1) scales the elbow's extension torque, the most the arm can push;
 * `lengthM` is the arm's held length, shoulder to palm (default and at most the arm's reach, at least its minimum).
 * `extendMps` (plan 16, the punch as a strike): how fast the held length moves toward `lengthM` (m/s; absent the
 * profile's `PalmPushProfile.extendMps`): a strike extends the arm fast, which loads the strut.
 */
export interface PushRequest {
  effort?: number;
  lengthM?: number;
  extendMps?: number;
  /**
   * Plan 16 (p53, a hold, controllers/block.ts `HandHold`): the push may pull: past its rest length by more than `slackM`,
   * its spring and damper in tension, at most `capN` (N). Absent: it never pulls.
   */
  hold?: { capN: number; slackM: number };
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
   * Contact motion polish 1.1 (a fixture whose wrap profile has a strike, `WrapProfile.strike`, or plan 16, a blocking
   * player, `PlayerRuntime.block`, under his block's bounds; ignored otherwise): the hip hinge. The trunk pitches `rad` forward (about its own level lateral axis) beyond the legs' lean and the hips drop
   * `dropM`, each bounded and rate-limited by the strike's hinge limits (hinge.ts). The legs keep the balance: the
   * support and the loss envelope read the legs' frame, not the pitched trunk's.
   */
  hinge?: { rad: number; dropM: number };
  /** Plan 16 (p40): the head up (`HeadUp`); absent, the head on the trunk. */
  headUp?: HeadUp;
  /** Plan 16 (p43): the head on a point (`HeadGaze`), in place of `headUp`; absent, none. */
  gaze?: HeadGaze;
}

/**
 * Plan 16 (p43): the head on a point. The drawn head extends on the neck (about the trunk's lateral axis, as `HeadUp`
 * does) until its face points at `atWorld` in the trunk's own sagittal plane, between the head on the trunk (0: the
 * neck is not flexed for it) and `maxDeg` of extension (the neck's range).
 */
export interface HeadGaze {
  atWorld: Vec3;
  maxDeg: number;
}

/**
 * Plan 16 (p40): the head up. The drawn head extends on the neck by the trunk's pitch from vertical past `freeDeg`, at
 * most `maxDeg`: a man pitched far forward (a lineman's three-point stance) keeps his eyes ahead.
 */
export interface HeadUp {
  freeDeg: number;
  maxDeg: number;
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
  /**
   * Contact motion polish 2.4, staying on from behind (a wrap profile with `bind.behind`): his drive on the carrier he holds
   * is from behind (`WrapBehind`, decided as the drive begins). The bound-legs fall's clause (c) (`WrapBindBehind`) reads it.
   */
  behind?: true;
  /**
   * Plan 16: he is blocking (controllers/block.ts): his request and his block's profile. The simulation keeps his engaged
   * state from it (`PlayerRuntime.block`); absent, he has none. `punch` (a block profile with a strike): the punch's
   * phase as his controller has it now, kept on that state.
   */
  block?: {
    request: BlockRequest;
    profile: BlockProfile;
    punch?: PunchState;
    /** Plan 16 (p40): the hip hinge's bounds in place of the profile's (`PreSnapPose.pace`: a stance got into slowly); absent, the profile's. */
    hinge?: HingeLimits;
    /** Plan 16 (p50, a block profile with `handFight`): what each hand is doing as his controller has it now, kept on that state (`BlockState.hands`). */
    hands?: Record<ArmSide, HandIntent>;
  };
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
  /** Plan 16: every blocking player's engaged state (absent while nobody blocks). */
  block?: Record<PlayerId, Pick<BlockState, 'target' | 'phase' | 'since' | 'punch' | 'lane' | 'hands'> & { /** Plan 16 (p36): his giving ground's level (a profile with `give`). */ give?: number; /** Plan 16 (p37): how far the contest has him stood up (a profile with `contest`). */ stood?: number; /** Plan 16 (p46): how far the hit has him beaten (a contest with `beaten`). */ beaten?: number; /** Plan 16 (p53): how long his hands have kept holds outside a hold's conditions (s; a hand fight with sides, `BlockState.holdingS`). */ holding?: number }>;
}

/**
 * Plan 10c C3 (U6): ground is the floor only. An obstacle collider carries the floor's part and region (it is static
 * scenery), but its own key, and is not ground: not for ragdoll grounding, the fall response's core-down, or the rules.
 */
export const isGround = (t: ColliderTag): boolean => t.playerId === null && t.key === 'floor';

export const pairKey = (a: PlayerId, b: PlayerId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
