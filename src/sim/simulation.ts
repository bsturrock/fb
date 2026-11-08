// Simulation: fixed time, players, events, reset and fixture lifecycle. One physical-state authority (Rapier via
// PhysicsWorld); controllers only read snapshots and emit intents; motors apply bounded forces once per substep.
import type {
  BalanceState, BodySnapshot, ControlMode, PlayerContactObs, PlayerId, PlayerIntent, Representation, SegmentId, SimEvent, Snapshot, ContactRec,
} from './contracts';
import { pairKey } from './contracts';
import type { Controller } from './controllers/base';
import { makeController } from './controllers/index';
import { observePlayerContacts, type ClassifyInput } from './contact';
import type { FixtureDef, PlayerSetup } from './fixture';
import { computeDrive, computeYaw } from './motors';
import { initPhysics, PhysicsWorld, RAPIER, rapierVersion, type MassReport, type ProxyBody } from './physics';
import {
  ARM_G2, BALANCE_G3, RAGDOLL_G4, SCHEMA_VERSION, SUPPORT_LEGACY, hipLocal, shoulderLocal, sideSignX, validateMotorBraking, type ArmProfile, type BalanceProfile, type BodyProfile, type MotorProfile, type RagdollProfile,
  type SupportProfile, type SuspensionSupport,
} from './profiles';
import {
  advanceBraking, advanceStance, brakingDemand, classifyProbe, clipHeightModel, composeTarget, loadAuthority, newSuspensionRuntime, runHeight, splitSupportForce, suspensionForce, type ClipHeightModel, type RunHeight,
  type HeightCalibration, type SuspensionRuntime,
} from './support';
import { buildProxyPose, advanceGait, legRequestLocal, poseLimbShapes, type GaitState, type PhysicalPose, type PoseClearance, type PoseMemory, type PoseShape, type ProxyPoseInput } from './pose';
import { advanceLoco, newLocoState, type LocoState, type LocomotionProfile } from './locomotion';
import { clipJoin, continueOwners, footTrace, initFeet, newFootPlan, observeFeet, planFeet, releaseFeet, type FootEvent, type FootPlan, type FootPlanInput } from './footwork';
import {
  anchorErrors, applyEnvelope, auditEnvelope, buildCandidate, hingeAngles, bulkOf, externalFromColliders, externalFromRagdoll, initEnvelope, limitGradients, ragdollPose, removeRagdoll, switchToRagdoll,
  validateCandidate, SEGMENTS, type CandidateEdit, type CandidateReport, type ExternalShape, type Ragdoll, type TransferAudit,
} from './ragdoll';
import {
  availableBalanceTorque, combineSupportTorque, computeBalanceTorque, desiredUpFrom, envelopeStep, leanScale, measureLean, postureGravityHold,
  projectedLean,
} from './balance';
import { ArmSystem, type ArmHost, type ArmHostPlayer, type WrapStatus } from './arms';
import { FallResponse, type ArmTask, type BraceState, type FallEpisode } from './fall-response';
import {
  advanceRunPlayback, joinPhase, newRunPlayback, smooth, playbackArmMean, playbackWidthAddM, playbackLabel, playbackStance, shownSample, playbackSwingProgress, sampleRunClip, playbackSample, retargetSample, runClipProfileExport, validateRunClipProfile, type RunPlayback,
} from './run-clip';
import { RuleObserver, ruleProfileExport, type EndingKind, type RetentionObs, type RuleEnding, type RuleTraceRow } from './rules';
import type { ArmSide } from './contracts';
import { dist, type Vec3, v3, vc, rad, qFromYaw, isFiniteVec, round, rv, yawOf, horiz, len, type Quat, add, cross, norm, qFromAxisAngle, qMul, qRot, sub, forwardOf, upOf, dot, clamp, UP, deg, qInvRot, qFromUnitVectors, scale, addScaled, toWorld, clampLen, neg } from './vec';

/**
 * Trial labels. Referee endings (rule observer) are distinct from non-success stops: duration (timeout), the
 * practice safety edge, numerical failure, an invalid (rejected) runner handoff, and an invalid transfer (a switched
 * player whose momentum/energy transfer audit failed: its physical evidence is invalid, so no referee completion).
 */
export type TrialResult = 'running' | 'duration' | 'practiceOutOfBounds' | 'numericalFailure' | 'invalidHandoff' | 'invalidTransfer' | EndingKind;

/**
 * Why a trial stopped (exported as `stop`). `result` keeps its labels, which fold conditions in (an out-of-bounds or
 * duration stop after a failed transfer is `invalidTransfer`; a duration stop with the rule observer disabled by a
 * rejected runner handoff is `invalidHandoff`); `reason` is the stop itself and `flags` the conditions folded in.
 */
export interface StopRecord {
  reason: 'ruleEnding' | 'practiceOutOfBounds' | 'duration' | 'numericalFailure';
  result: TrialResult;
  tick: number;
  t: number;
  /** The ending kind for a rule ending. */
  ending?: string;
  /** The player whose COM left the area, or whose state went non-finite. */
  playerId?: PlayerId;
  flags: { invalidTransfer: boolean; invalidHandoff: boolean };
}

export interface AppliedRecord {
  requestedVelocity: Vec3;
  drive: Vec3;
  driveCap: number;
  driveSaturated: boolean;
  /** Yaw torque requested by the capped yaw motor (before the combined support ceiling). */
  yawTorque: number;
  yawCap: number;
  yawError: number;
  /** Gate 3: balance torque requested (uncapped), after the balance cap, and the actually applied support torque. */
  balanceRequested: Vec3;
  balanceCapped: Vec3;
  balanceCap: number;
  balanceSaturated: boolean;
  /** Applied support torque (yaw + balance after the combined ceiling) and the ceiling scale. */
  supportTorque: Vec3;
  supportScale: number;
  /** Drive reduction from lean. */
  leanScale: number;
}

/** Per-player Gate 3 runtime balance state. */
export interface BalanceRuntime {
  theta: number;
  axis: Vec3;
  outwardRate: number;
  projected: number;
  counter: number;
  /** Rate-limited desired body up (posture request). */
  desiredUp: Vec3;
  /** Loss queued for the next controlled boundary. */
  pendingLoss: boolean;
  lossT: number | null;
  /** COM-to-support-hemisphere-centre distance (m), from the engine COM and the support shape (posture gravity hold). */
  leverM: number;
}

export interface PlayerRuntime {
  id: PlayerId;
  setup: PlayerSetup;
  /** Plan 08: the ramped walking request and the controller's request it advances toward (see rampWalkRequest). */
  walkRequest?: Vec3;
  walkWant?: Vec3;
  body: BodyProfile;
  motor: MotorProfile;
  proxy: ProxyBody;
  mass: MassReport;
  controller: Controller;
  intent: PlayerIntent;
  grounded: boolean;
  supportPoint: Vec3 | null;
  controlMode: ControlMode;
  representation: Representation;
  applied: AppliedRecord;
  balance: BalanceRuntime;
  /** Gate 4: active ragdoll (null while the proxy is the representation). */
  rag: Ragdoll | null;
  /** Sim-owned physical pose after the last solve (presentation, candidate source, rule queries). */
  pose: PhysicalPose | null;
  gait: GaitState;
  /** Plan 08: locomotion mode and composition weights (pose and bounded height request only; reset with the player). */
  loco: LocoState | null;
  /** Plan 06: run-clip playback (phase, weight) when the fixture has a run-clip profile; reset with the player. */
  run: RunPlayback | null;
  /** Plan 06a: suspension support state (probe, height target, force, work); null under the legacy support. */
  sus: SuspensionRuntime | null;
  /** Bulk vertical velocity after the previous solve (diagnostic `when` conversions). */
  /** Bulk vertical velocity after the last two solves (RH-F7 extremum conversions: [before, after] the last solve). */
  prevVy: number;
  lastVy: number;
  poseMemory: PoseMemory;
  /**
   * Plan 07: per-foot plant / swing state (pose only; never read by support, drive, balance, friction or rules); null
   * without a footwork profile or the suspension. Reset with the player.
   */
  feet: FootPlan | null;
  /** Gate 4 handoff outcome (accepted with audits, or rejected with reasons). */
  handoff: HandoffRecord | null;
  /** Ragdoll running audits (max joint anchor separation, max floor penetration) since the handoff. */
  ragStats: RagStats | null;
  /** Plan 09: active fall response of an accepted ragdoll (null otherwise). */
  fall: FallEpisode | null;
}

/** Ragdoll runtime extremes since the handoff (presentation/integrity evidence, not gates). */
export interface RagStats {
  maxAnchorErrM: number;
  maxFloorPenM: number;
  maxSpeed: number;
  /** Largest hinge excursion past the upper (flexion) limit, deg. */
  maxHingeOverDeg: number;
  hingeOverJoint: string | null;
  /** Largest hinge excursion below the lower limit (reverse bending), deg. */
  maxHingeReverseDeg: number;
  hingeReverseJoint: string | null;
}

export interface HandoffRecord {
  /** Candidate validated, switched and its transfer audit passed (a valid handoff). */
  accepted: boolean;
  /**
   * accepted; rejected (candidate failed validation, proxy kept); transferFailed (the candidate was switched in but the
   * transfer audit failed: the assembly stays as diagnostic state, the trial is labelled invalidTransfer).
   */
  outcome: 'accepted' | 'rejected' | 'transferFailed';
  t: number;
  step: number;
  reason: 'lossOfSupport' | 'diagnostic';
  report: CandidateReport;
  audit?: TransferAudit;
  activeBodies?: { before: number; after: number; proxyRemoved: boolean };
}

export interface PlayerTraceRow {
  p: [number, number, number];
  com: [number, number, number];
  v: [number, number, number];
  w: [number, number, number];
  yaw: number;
  drive: [number, number, number];
  cap: number;
  req: [number, number];
  yawT: number;
  g: 0 | 1;
  c: string[];
  ph?: string;
  mode: ControlMode;
  /**
   * Gate 3: lean (deg), outward rate (rad/s), projected lean (deg), applied balance torque |tau| (N m), lean scale,
   * envelope counter, rate-limited desired posture lean (deg) and actual-vs-desired up deviation (deg).
   */
  lean?: { deg: number; rate: number; proj: number; tauB: number; tauReq: number; s: number; cnt: number; post: number; dev: number };
  /** Arms (Gate 2): phase, retention id, actual force magnitude, clamp normal, clamp tangential, palm. */
  arm?: Partial<Record<ArmSide, { ph: string; id: string | null; F: number; N: number; Ft: number; palm: [number, number, number]; ok: 0 | 1 }>>;
  wrap?: WrapStatus;
  /**
   * Plan 09 fall response: effort window e, arm task and brace state (l, r), positive and negative work so far (J),
   * realized positive power (W), applied joint torque (N m). `lim`: largest envelope excursion so far (deg).
   */
  fall?: { e: number; l: [ArmTask, BraceState]; r: [ArmTask, BraceState]; W: number; Wn: number; P: number; T: Record<string, number> };
  lim?: number;
  /** Gate 4: representation (absent = proxy), max joint anchor separation (m), hinge angles (deg). */
  rep?: Representation;
  jsep?: number;
  hinge?: Record<string, number>;
  /**
   * Plan 07 feet (left l, right r): mode m (P planted, S planner step, F following the request, A airborne), anchor a
   * (contact feature x/z), feature error e and drift d (m), leg residual res (m), step progress p, target speeds v / vy
   * (m/s), ankle target tg, achieved feature height fy, last release reason why; tn: a touchdown proposal not yet
   * confirmed by a solve (initial row only).
   */
  ft?: Record<'l' | 'r', Record<string, unknown>>;
  /**
   * Plan 06 run-clip playback: clip (or blend) label, phase u (0 = left touchdown), applied weight w and its target wt,
   * playback rate r, clip blend b, solved travel speed v (m/s), sampled-request residuals (m) of the pose.
   */
  run?: { clip: string; u: number; w: number; wt: number; r: number; b: number; v: number; res: Record<string, number> };
  /** Plan 08 locomotion mode m, why it changed, preparation and contact weights p c, arm swing s, height drop d (m). */
  loco?: { m: string; why: string; p: number; c: number; s: number; d: number };
  /**
   * Plan 06a suspension support (last substep of the tick): probed root height h, target ht and its rate vt, stance
   * request req (before the range clamp), clip-derived running height run (null when no clip plays) and its bob scale s,
   * applied and commanded force F/Fc (N), saturation sat (0 none, 1 at zero, 2 at the ceiling), load authority a, probe
   * ok and status st, target feedforward acceleration at (m/s^2), lever lev (m), cumulative work W (J) and vertical impulse J (N s), power P (W), guard bottom-out bot, clip flight fl (both clip
   * feet up while the suspension still supports: visual flight, not ballistic). Force split (profile application): pivot
   * share Fp (N, at the turf point below the pivot) and COM share Fm (N, through the COM; Fp + Fm = F), and the pivot
   * share's torque about the COM T (N m, world; the COM share adds none).
   */
  sup?: {
    h: number | null; ht: number; vt: number; at: number; req: number; run: number | null; s: number; F: number; Fc: number; Fp: number; Fm: number; T: [number, number, number]; sat: 0 | 1 | 2; a: number;
    ok: 0 | 1; st: string; lev: number; W: number; J: number; P: number; bot: 0 | 1; fl: 0 | 1;
    /** Plan 07 recovery (repaired profile): upward approach limit (m/s) when it bound the spring term; absent otherwise. */
    vl?: number;
    /** Plan 07 item 4 braking stance (profiles with `brakingStance`): blend b and this substep's braking demand. */
    bk?: number;
    /** Braking demand; null while unsupported (the blend holds). */
    bkw?: number | null;
  };
}

export interface TraceRow {
  tick: number;
  t: number;
  players: Record<PlayerId, PlayerTraceRow>;
  /** Gate 4 rule observer row (absent without a rule profile). */
  rule?: RuleTraceRow;
}

export interface SimOptions {
  /** Create players (and iterate them) in reverse fixture order. */
  reverseOrder?: boolean;
  /** Record a trace row every outer tick (default true). */
  trace?: boolean;
  /**
   * Plan 08 evidence: at every locomotion transition boundary (foot mode or source, locomotion mode, planner hold) also
   * build the pose of the previous composition at the same solved root from copied memory, and record the largest
   * landmark difference (`transitionDeltas`). Read-only: the copy never touches the live pose memory or foot plan.
   */
  transitionAudit?: boolean;
  /** Evidence: called after every physics substep (solved state, poses, foot plans); read-only. */
  onSubstep?: (sim: Simulation) => void;
}

/** One audited transition boundary: same solved time and root, old versus new composition. */
export interface TransitionDelta {
  t: number;
  playerId: PlayerId;
  from: string;
  to: string;
  /**
   * Largest landmark difference against the reference (m), the measure the limit applies to. The reference is the old
   * composition with its own snaps taken out at their source: the ordinary request's jump of this substep from a following
   * foot (a collision turns the clip's heading with the travel in one substep; that jump belongs to the old path whether or
   * not ownership changes) and a timed-out step's dead stop. Everything else about the old composition stands.
   */
  deltaM: number;
  landmark: string;
  /** Every compared landmark's difference (m). */
  by: Record<string, number>;
  /** The same comparison against the old composition as it stands, with the request jump in it (m). */
  rawM: number;
  rawBy: Record<string, number>;
  /** Largest difference of any landmark from its own body-frame motion carried on one substep (its second difference, m); reported only, never part of `deltaM`. */
  continuedM: number;
  /** Size of the ordinary request's jump removed from each following foot (m); 0 for other owners. */
  requestJumpM: Record<ArmSide, number>;
  /** Size of the dead stop removed from each timed-out step (m, see `continueOwners`); 0 for other owners. */
  stepStopM: Record<ArmSide, number>;
  /** Both compositions' requests and solved legs at the boundary. */
  legs: Record<ArmSide, { old: AuditLeg; now: AuditLeg }>;
}

/** One leg of an audited composition: its request kind, the solved request, ankle, candidate and blends. */
export interface AuditLeg {
  kind: string;
  request: Vec3;
  ankle: Vec3;
  variant: number;
  softM: number;
  liftM: number;
  soleO: number;
  poleW: number;
}

/** The old composition's pose input at a boundary, and the reference feet (see TransitionDelta.deltaM). */
type AuditOld = ProxyPoseInput & { from: string; to: string; reference: NonNullable<ProxyPoseInput['feet']>; requestJumpM: Record<ArmSide, number>; stepStopM: Record<ArmSide, number> };

/** The composition of one substep, kept for the next substep's audit. */
interface AuditPrev {
  key: string;
  /** Per side foot and arm owner. */
  foot: Record<ArmSide, string>;
  arm: Record<ArmSide, string>;
  feet: NonNullable<ProxyPoseInput['feet']>;
  /** The foot plan after this substep's observation. */
  plan: FootPlan | null;
  /** Ordinary leg requests (body frame) of this substep and the one before. */
  reqL: Record<ArmSide, Vec3>;
  reqL2: Record<ArmSide, Vec3>;
  /** Substeps recorded: the request has a motion of its own from the second. */
  reqN: number;
  /** Achieved arms in the body frame, the free arm composition and the support state. */
  armsL: Partial<Record<ArmSide, { elbow: Vec3; wrist: Vec3; palm: Vec3 }>>;
  readyHands: boolean;
  contactW: number;
  supported: boolean;
  falling: boolean;
  mode: string;
}

/** Labelled diagnostic conversion request (G4-F1/F2/F6); contact-driven fixtures never use this. */
export interface DiagnosticConversion {
  playerId: PlayerId;
  atS: number;
  edit?: CandidateEdit;
}

const EMPTY_APPLIED = (): AppliedRecord => ({
  requestedVelocity: v3(),
  drive: v3(),
  driveCap: 0,
  driveSaturated: false,
  yawTorque: 0,
  yawCap: 0,
  yawError: 0,
  balanceRequested: v3(),
  balanceCapped: v3(),
  balanceCap: 0,
  balanceSaturated: false,
  supportTorque: v3(),
  supportScale: 1,
  leanScale: 1,
});

const EMPTY_BALANCE = (): BalanceRuntime => ({
  theta: 0,
  axis: v3(1, 0, 0),
  outwardRate: 0,
  projected: 0,
  counter: 0,
  desiredUp: { ...UP },
  pendingLoss: false,
  lossT: null,
  leverM: 0,
});

/** Pose blueprint used for presentation when no ragdoll profile is configured (Gate 1-3 fixtures). */
const DEFAULT_POSE_PROFILE = RAGDOLL_G4;

/**
 * One limb geometry contract: the arm queries (ArmSystem), the physical pose, candidate bodies and ground-region
 * classification all read the same lengths and radii. A fixture pairing an arm profile with a ragdoll/pose profile of
 * different geometry is rejected at construction.
 */
/** Plan 08: critically damped toward the clip's smoothed weight, so a reversal (a contact that ends mid-fade) is no velocity step. */
const CLIP_WEIGHT_RADPS = 24;
function followClipWeight(st: RunPlayback, dt: number): void {
  const want = smooth(st.w);
  if (st.wF === undefined || dt <= 0) {
    st.wF = want;
    st.wFV = 0;
    return;
  }
  const w = CLIP_WEIGHT_RADPS;
  st.wFV = (st.wFV ?? 0) + (w * w * (want - st.wF) - 2 * w * (st.wFV ?? 0)) * dt;
  st.wF = clamp(st.wF + st.wFV * dt, 0, 1);
  // a rejoined phase slides in the same way: the clip it left may still be shown
  st.uSlipV = (st.uSlipV ?? 0) + (-w * w * (st.uSlip ?? 0) - 2 * w * (st.uSlipV ?? 0)) * dt;
  st.uSlip = (st.uSlip ?? 0) + st.uSlipV * dt;
  if (st.w <= 0 && st.wF < 1e-3) {
    st.wF = 0;
    st.wFV = 0;
  }
}

export function checkLimbContract(A: ArmProfile, R: RagdollProfile): void {
  const pairs: [string, number, number][] = [
    ['upperArm', A.upperArmM, R.lengths.upperArm],
    ['forearm', A.forearmM, R.lengths.forearm],
    ['palmExtension', A.palmExtensionM, R.lengths.palmExtension],
    ['upperArmRadius', A.upperArmRadiusM, R.radii.upperArm],
    ['forearmRadius', A.forearmRadiusM, R.radii.forearm],
    ['palmRadius', A.palmRadiusM, R.radii.palm],
  ];
  const bad = pairs.filter(([, a, r]) => Math.abs(a - r) > 1e-9);
  if (bad.length) throw new Error(`limb contract: arm profile ${A.id} and ragdoll profile ${R.id} differ (${bad.map(([k, a, r]) => `${k} ${a} vs ${r}`).join(', ')})`);
}

function capsuleShape(a: Vec3, b: Vec3, r: number): { shape: RAPIER.Shape; pose: { p: Vec3; q: Quat } } | null {
  const d = sub(b, a);
  const l = len(d);
  if (l < 1e-6) return { shape: new RAPIER.Ball(r), pose: { p: a, q: { x: 0, y: 0, z: 0, w: 1 } } };
  return { shape: new RAPIER.Capsule(l / 2, r), pose: { p: addScaled(a, d, 0.5), q: qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l)) } };
}

function poseShapeToRapier(s: PoseShape): { shape: RAPIER.Shape; pose: { p: Vec3; q: Quat } } | null {
  if (s.kind === 'ball') return { shape: new RAPIER.Ball(s.r), pose: { p: s.c, q: { x: 0, y: 0, z: 0, w: 1 } } };
  if (s.kind === 'box') return { shape: new RAPIER.Cuboid(s.he.x, s.he.y, s.he.z), pose: { p: s.c, q: s.q } };
  return capsuleShape(s.a, s.b, s.r);
}

export class Simulation {
  physics!: PhysicsWorld;
  players: PlayerRuntime[] = [];
  byId = new Map<PlayerId, PlayerRuntime>();
  /** Completed outer ticks. */
  tick = 0;
  /** Completed physics substeps since t = 0. */
  steps = 0;
  result: TrialResult = 'running';
  events: SimEvent[] = [];
  trace: TraceRow[] = [];
  contacts: ContactRec[] = [];
  contactObs: Record<PlayerId, PlayerContactObs[]> = {};
  /** Plan 08 evidence (SimOptions.transitionAudit). */
  transitionDeltas: TransitionDelta[] = [];
  private auditPrev = new Map<PlayerId, AuditPrev>();
  /** Plan 08 audit: the achieved landmarks of the last two substeps in the body frame. */
  private auditHist = new Map<PlayerId, Record<string, Vec3>[]>();
  private auditRun = new Map<PlayerId, RunPlayback>();
  pairGap: Record<string, number> = {};
  pairClosest: Record<string, { gap: number; points: Record<PlayerId, Vec3> }> = {};
  private history: Snapshot[] = [];
  private episodes = new Map<string, { since: number; seen: Set<string> }>();
  private tickContactClasses: Record<PlayerId, Set<string>> = {};
  /** True while stepTick runs its substeps (stampTick). */
  private building = false;
  /** Why the trial stopped, with the conditions `result` folds in (exported; `result` keeps its labels). */
  stop: StopRecord | null = null;
  minPairGap = Infinity;
  /** Arm authority (Gate 2); null when no player has arms. */
  arms: ArmSystem | null = null;
  fall: FallResponse | null = null;
  /** Diagnostic conversion requests already issued (index into def.diagnostics.conversions). */
  private diagDone = new Set<number>();
  /** Diagnostic static obstacles (cuboid colliders on the fixed floor body). */
  obstacleColliders: RAPIER.Collider[] = [];
  /** Gate 4 rule observer (null without a rule profile). */
  rules: RuleObserver | null = null;
  /** After a referee ending: physics settles until this time, then the trial stops with the ending's label. */
  private settleUntil: number | null = null;
  /** First failed transfer audit (review finding 2): the trial ends labelled invalidTransfer, never a completion. */
  invalidTransfer: { playerId: PlayerId; reasons: string[]; t: number } | null = null;
  /** Plan 06a: static colliders the suspension probe may hit (turf, obstacles), and which of them are turf. */
  private probeTargets: RAPIER.Collider[] = [];
  private turf = new Set<number>();
  /** Plan 06a: clip pelvis-height models (shared by the players; null without suspension and run clips). */
  heightModels: ClipHeightModel[] | null = null;

  static async create(def: FixtureDef, opts: SimOptions = {}): Promise<Simulation> {
    await initPhysics();
    return new Simulation(def, opts);
  }

  constructor(readonly def: FixtureDef, readonly opts: SimOptions = {}) {
    if (def.runClips) validateRunClipProfile(def.runClips, def.ragdoll ?? DEFAULT_POSE_PROFILE);
    validateMotorBraking(def.motor, `fixture ${def.id} motor`);
    for (const p of def.players) if (p.motor) validateMotorBraking(p.motor, `fixture ${def.id} player ${p.id} motor`);
    this.build();
  }

  get dt(): number {
    return this.physics.dt;
  }
  get t(): number {
    return this.steps * this.physics.dt;
  }
  get tickS(): number {
    return this.def.solver.outerTickS;
  }
  get done(): boolean {
    return this.result !== 'running';
  }
  /** Gate 3 balanced profile active (free rotation + finite upright motor). */
  get balanced(): boolean {
    return this.def.stance.rotation === 'free';
  }
  get balanceProfile(): BalanceProfile {
    return this.def.balance ?? BALANCE_G3;
  }
  get ragdollProfile(): RagdollProfile | undefined {
    return this.def.ragdoll;
  }
  /** Plan 06a vertical support profile (the named legacy capsule-floor support when the fixture declares none). */
  get supportProfile(): SupportProfile {
    return this.def.support ?? SUPPORT_LEGACY;
  }
  /** The suspension profile, or null under the legacy capsule-floor support. */
  get suspension(): SuspensionSupport | null {
    const S = this.def.support;
    return S && S.kind === 'suspension' ? S : null;
  }

  // ------------------------------------------------------------------ representation helpers
  /** The body that carries the player's frame: the proxy, or the ragdoll core. */
  coreBody(pl: PlayerRuntime): RAPIER.RigidBody {
    return pl.rag ? pl.rag.bodies.core : pl.proxy.body;
  }
  activeBodies(pl: PlayerRuntime): RAPIER.RigidBody[] {
    return pl.rag ? SEGMENTS.map((id) => pl.rag!.bodies[id]) : [pl.proxy.body];
  }
  activeColliders(pl: PlayerRuntime): RAPIER.Collider[] {
    return pl.rag ? pl.rag.colliders.map((c) => c.collider) : pl.proxy.colliders;
  }
  /** Assembly mass, COM, COM velocity (P/M) and angular velocity (core body) of the active representation. */
  bulk(pl: PlayerRuntime): { massKg: number; com: Vec3; v: Vec3; w: Vec3 } {
    if (!pl.rag) {
      const b = pl.proxy.body;
      return { massKg: b.mass(), com: vc(b.worldCom()), v: vc(b.linvel()), w: vc(b.angvel()) };
    }
    const k = bulkOf(this.activeBodies(pl));
    return { massKg: k.massKg, com: k.com, v: scale(k.P, 1 / k.massKg), w: vc(pl.rag.bodies.core.angvel()) };
  }
  /** Enabled engine bodies / impulse joints owned by a player (lifecycle counts). */
  bodyCount(id?: PlayerId): number {
    let n = 0;
    this.physics.world.bodies.forEach((b) => {
      const u = b.userData as { playerId?: string } | undefined;
      if (b.isEnabled() && u?.playerId !== undefined && (id === undefined || u.playerId === id)) n++;
    });
    return n;
  }
  counts(): { bodies: number; joints: number; colliders: number; grips: number; clamps: number; tags: number } {
    let clamps = 0;
    if (this.arms) for (const pl of this.players) for (const sd of ['left', 'right'] as ArmSide[]) if (this.arms.clampOf(pl.id, sd)) clamps++;
    return {
      bodies: this.physics.world.bodies.len(),
      joints: this.physics.world.impulseJoints.len(),
      colliders: this.physics.world.colliders.len(),
      grips: this.arms?.grips.size ?? 0,
      clamps,
      tags: this.physics.tags.size,
    };
  }

  // ------------------------------------------------------------------ lifecycle
  private build(): void {
    const def = this.def;
    this.physics = new PhysicsWorld(def.solver);
    const S = this.suspension;
    // Gate 4: same-owner self pairs never generate contact (owner identity, not a per-player collision bit). Plan 06a:
    // a suspension guard ball touches static ground only (never a player collider).
    if (def.ragdoll || S) {
      const sameOwner = !!def.ragdoll;
      this.physics.setContactFilter((a, b) => {
        if (sameOwner && a.playerId !== null && a.playerId === b.playerId) return false;
        if ((a.key === 'supportGuard' && b.playerId !== null) || (b.key === 'supportGuard' && a.playerId !== null)) return false;
        return true;
      });
    }
    this.probeTargets = [this.physics.floorCollider];
    this.turf = new Set([this.physics.floorCollider.handle]);
    if (S) this.physics.markStatic(this.physics.floorCollider);
    for (const o of def.obstacles ?? []) {
      let q = qFromYaw(rad(o.yawDeg ?? 0));
      if (o.rollDeg) q = qMul(q, qFromAxisAngle(v3(0, 0, 1), rad(o.rollDeg)));
      const c = this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(o.halfExtents.x, o.halfExtents.y, o.halfExtents.z)
          .setTranslation(o.center.x, o.center.y + 0.5, o.center.z)
          .setRotation(q)
          .setFriction(def.solver.passiveFriction),
        this.physics.floorBody,
      );
      this.physics.tags.set(c.handle, { playerId: null, part: 'floor', region: 'floor', key: `obstacle:${o.id}` });
      if (S) this.physics.markStatic(c);
      this.obstacleColliders.push(c);
      this.probeTargets.push(c);
      if (o.surface === 'turf') this.turf.add(c.handle);
    }
    this.heightModels = S && def.runClips ? def.runClips.clips.map((c) => clipHeightModel(c, S.run.bobHarmonics)) : null;
    const order = this.opts.reverseOrder ? [...def.players].reverse() : [...def.players];
    for (const setup of order) {
      const motor = setup.motor ?? def.motor;
      const q0 = qFromYaw(rad(setup.initial.yawDeg));
      const run = def.runClips && setup.body.kind === 'upperBodyCompound' ? newRunPlayback(setup.initial.runPhase ?? (setup.role === 'runner' ? 0 : 0.25)) : null;
      let sus: SuspensionRuntime | null = null;
      let y0 = setup.body.restOriginY;
      if (S) {
        // Reset placement: the root at its height target over the ground below the spawn point (stance request in
        // force at reset, blended with the clip height when the clip plays from t = 0).
        const st0 = setup.initial.stance;
        const h0 = clamp(st0?.heightM ?? S.standingHeightM, S.targetRangeM[0], S.targetRangeM[1]);
        sus = newSuspensionRuntime(h0);
        sus.staggerM = st0?.staggerM ?? 0;
        const cal = this.heightCalibration(setup.body);
        let runM: RunHeight | null = null;
        if (run && def.runClips && this.heightModels) {
          const v0 = setup.initial.velocity ?? v3();
          advanceRunPlayback(run, def.runClips, { coreP: v3(setup.initial.x, 0, setup.initial.z), forward: forwardOf(q0), supported: true, dt: 0, initSpeed: len(horiz(v0)), initDir: v0, legM: cal.legM });
          if (run.w > 0) runM = runHeight(S, def.runClips, this.heightModels, run, cal, def.solver.gravityY);
        }
        composeTarget(sus, S, runM, run?.w ?? 0, 0);
        const gnd = this.physics.groundProbe(v3(setup.initial.x, 50, setup.initial.z), 100, this.probeTargets);
        y0 = (gnd ? gnd.pointWorld.y : 0) + sus.targetM;
      }
      const pose = { p: v3(setup.initial.x, y0, setup.initial.z), q: q0 };
      const proxy = this.physics.createProxy(setup.id, setup.body, def.stance, pose, S ?? undefined);
      const controller = makeController(setup.controller, setup, motor);
      const pl: PlayerRuntime = {
        id: setup.id,
        setup,
        body: setup.body,
        motor,
        proxy,
        mass: this.physics.massReport(proxy.body),
        controller,
        intent: { locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: v3(0, 0, 1), effort: 0 } },
        grounded: false,
        supportPoint: null,
        controlMode: 'supported',
        representation: 'proxy',
        applied: EMPTY_APPLIED(),
        balance: EMPTY_BALANCE(),
        rag: null,
        pose: null,
        gait: { phase: setup.initial.runPhase !== undefined ? 2 * Math.PI * (((setup.initial.runPhase % 1) + 1) % 1) : setup.role === 'runner' ? 0 : Math.PI / 2 },
        run,
        sus,
        prevVy: 0,
        lastVy: 0,
        poseMemory: {},
        feet: def.footwork && S && setup.body.kind === 'upperBodyCompound' ? newFootPlan(def.footwork, def.ragdoll ?? DEFAULT_POSE_PROFILE) : null,
        loco: def.locomotion ? newLocoState() : null,
        handoff: null,
        ragStats: null,
        fall: null,
      };
      proxy.body.userData = { playerId: setup.id, segment: 'proxy' };
      const supLocal = sub(vc(proxy.support.translation()), pose.p);
      const hc = sub(qRot({ x: -pose.q.x, y: -pose.q.y, z: -pose.q.z, w: pose.q.w }, supLocal), v3(0, proxy.supportShape.halfHeight, 0));
      pl.balance.leverM = len(sub(pl.mass.localCom, hc));
      // plan 06a: the suspension's pivot is the same calibrated legacy pivot (support capsule's lower hemisphere centre)
      if (pl.sus) pl.sus.pivotLocal = hc;
      this.players.push(pl);
      this.byId.set(pl.id, pl);
    }
    // Passive settling (no application forces; under the suspension profile its support force only, at the constant
    // reset target), then the reset-time initial state.
    const settleSteps = Math.round(def.settleS / this.physics.dt);
    if (S) this.updateProbes(true);
    for (let i = 0; i < settleSteps; i++) {
      if (S)
        for (const pl of this.players) {
          pl.proxy.body.resetForces(true);
          pl.proxy.body.resetTorques(true);
          this.applySupport(pl, S, this.physics.dt, true);
        }
      this.physics.step();
      if (S) this.updateProbes(false);
    }
    for (const pl of this.players) {
      const ini = pl.setup.initial;
      const b = pl.proxy.body;
      if (S) {
        b.resetForces(true);
        b.resetTorques(true);
        // no support force acts on the reset state yet (the settle force is not carried into t = 0)
        if (pl.sus) Object.assign(pl.sus, { commandedN: 0, appliedN: 0, pivotN: 0, comN: 0, tipTorqueNm: v3(), saturated: 'none', authority: 0, powerW: 0, workJ: 0, impulseNs: 0, active: false });
      }
      if (ini.lift) {
        const p = b.translation();
        b.setTranslation({ x: p.x, y: p.y + ini.lift, z: p.z }, true);
      }
      if (ini.leanDeg) this.applyInitialLean(pl, ini.leanDeg, ini.leanDirWorld);
      // suspension: a playing clip's bob starts at its steady-state vertical rate (the reset target's own rate)
      const vy0 = pl.sus ? pl.sus.targetVMps : 0;
      b.setLinvel(add(ini.velocity ? vc(ini.velocity) : v3(), v3(0, vy0, 0)), true);
      b.setAngvel(ini.angularVelocity ? vc(ini.angularVelocity) : v3(), true);
      if (ini.diagnosticImpulse) {
        const pose = this.poseOf(pl);
        const pt = add(pose.p, qRot(pose.q, ini.diagnosticImpulse.pointLocal));
        b.applyImpulseAtPoint(vc(ini.diagnosticImpulse.impulse), pt, true);
        this.emit('diagnosticImpulse', pl.id, { impulse: rv(ini.diagnosticImpulse.impulse), point: rv(pt) });
      }
    }
    // Colliders follow bodies only during a step; publish the reset-time placement to queries now.
    this.physics.world.propagateModifiedBodyPositionsToColliders();
    if (def.fallResponse || def.players.some((p) => p.arms)) {
      checkLimbContract(def.armProfile ?? ARM_G2, def.ragdoll ?? DEFAULT_POSE_PROFILE);
      this.arms = new ArmSystem(this.armHost(), def.armProfile ?? ARM_G2, this.balanced ? this.balanceProfile.fallingArmBudgetFraction : 1, def.ragdoll?.passiveGrip);
    }
    if (def.fallResponse) {
      const sim = this;
      if (!def.ragdoll?.envelope) throw new Error(`fixture ${def.id}: a fall response needs a ragdoll profile with an envelope`);
      this.fall = new FallResponse(def.fallResponse, {
        get dt() {
          return sim.physics.dt;
        },
        get t() {
          return sim.t;
        },
        get steps() {
          return sim.steps;
        },
        gravity: Math.abs(def.solver.gravityY),
        emit: (type, id, data) => sim.emit(type, id, data),
        closingSpeeds: (rag, lookaheadS, predictionM, skinM) => sim.closingSpeeds(rag, lookaheadS, predictionM, skinM),
      });
      if (this.arms) this.arms.holdMemoryS = def.fallResponse.arms.holdMemoryS;
    }
    this.rules = def.rules ? new RuleObserver(def.rules, def.ragdoll ?? DEFAULT_POSE_PROFILE, (type, id, data) => this.emit(type, id, data)) : null;
    this.settleUntil = null;
    this.postStep(true);
    if (this.balanced) this.evaluateBalance(true);
    if (S) for (const pl of this.players) this.advanceLocomotion(pl, 0);
    this.updatePoses(0);
    for (const pl of this.players) pl.prevVy = pl.lastVy = this.bulk(pl).v.y;
    if (this.opts.trace !== false) this.recordTrace();
  }

  /** Player calibration of the clip heights (leg length, flat-shoe ankle height, hip landmark height). */
  heightCalibration(body: BodyProfile): HeightCalibration {
    const R = this.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    return { legM: R.lengths.thigh + R.lengths.shin, soleM: R.shoe.belowAnkleM + R.shoe.halfExtents.y, hipLocalY: hipLocal(body, 'right').y };
  }

  /** Tilt a settled body by `leanDeg` toward `dir`, rotating about its support hemisphere so floor contact stays. */
  private applyInitialLean(pl: PlayerRuntime, leanDeg: number, dir?: Vec3): void {
    const b = pl.proxy.body;
    const q0 = { ...b.rotation() };
    const p0 = vc(b.translation());
    const d = norm(horiz(dir ?? forwardOf(q0)), v3(0, 0, 1));
    const axis = norm(cross(UP, d));
    const q = qMul(qFromAxisAngle(axis, rad(leanDeg)), q0);
    if (pl.sus) {
      // suspension: lean about the support pivot, keeping the probed root height (the reset target): the pivot (profile
      // application: the calibrated legacy pivot, or the body-axis point at probe depth) stays at its x/z and the root
      // stays at its height
      const h = Number.isFinite(pl.sus.probe.heightM) ? pl.sus.probe.heightM : p0.y;
      const local = this.suspension!.application.pivot === 'legacyHemisphere' ? pl.sus.pivotLocal : v3(0, -h, 0);
      const pivot = add(p0, qRot(q0, local));
      const off = qRot(q, local);
      b.setRotation(q, true);
      b.setTranslation(v3(pivot.x - off.x, p0.y, pivot.z - off.z), true);
      this.emit('initialLean', pl.id, { leanDeg, dir: rv(d), pivot: rv(pivot) });
      return;
    }
    const sup = pl.proxy.support;
    const sl = sup.translation();
    const hcLocal = sub(qRot({ x: -q0.x, y: -q0.y, z: -q0.z, w: q0.w }, sub(vc(sl), p0)), v3(0, pl.proxy.supportShape.halfHeight, 0));
    const hcWorld = add(p0, qRot(q0, hcLocal));
    const p = sub(hcWorld, qRot(q, hcLocal));
    b.setRotation(q, true);
    b.setTranslation(p, true);
    this.emit('initialLean', pl.id, { leanDeg, dir: rv(d) });
  }

  reset(): void {
    this.physics.dispose();
    this.players = [];
    this.byId.clear();
    this.tick = 0;
    this.steps = 0;
    this.result = 'running';
    this.events = [];
    this.trace = [];
    this.contacts = [];
    this.contactObs = {};
    this.transitionDeltas = [];
    this.auditPrev.clear();
    this.auditHist.clear();
    this.auditRun.clear();
    this.pairGap = {};
    this.pairClosest = {};
    this.history = [];
    this.episodes.clear();
    this.minPairGap = Infinity;
    this.arms = null;
    this.fall = null;
    this.diagDone.clear();
    this.obstacleColliders = [];
    this.rules = null;
    this.settleUntil = null;
    this.invalidTransfer = null;
    this.stop = null;
    this.clearTickScratch();
    this.build();
  }

  /** Per-tick scratch: cleared at the start of every tick and by reset(), before trace row 0 is recorded. */
  private clearTickScratch(): void {
    this.tickContactClasses = {};
  }

  dispose(): void {
    this.physics.dispose();
  }

  private armHost(): ArmHost {
    const sim = this;
    return {
      players(): ArmHostPlayer[] {
        return sim.players.map((pl) => ({
          id: pl.id,
          body: pl.body,
          rb: sim.coreBody(pl),
          colliders: sim.activeColliders(pl),
          arms: pl.setup.arms,
          armIntent: pl.intent.arms,
          falling: pl.controlMode === 'falling',
          ragdoll: pl.rag,
          armEffort: pl.fall?.armDemand,
        }));
      },
      regionOf: (c) => {
        const t = sim.physics.tags.get(c.handle);
        return t ? { playerId: t.playerId, region: t.region } : undefined;
      },
      get dt() {
        return sim.physics.dt;
      },
      get tick() {
        return sim.stampTick;
      },
      get steps() {
        return sim.steps;
      },
      get t() {
        return sim.t;
      },
      emit: (type, id, data) => sim.emit(type, id, data),
      reverseOrder: !!this.opts.reverseOrder,
      contacts: () => sim.contacts,
    };
  }

  // ------------------------------------------------------------------ stepping
  /** Advance exactly one outer tick (all substeps). */
  stepTick(): void {
    if (this.done) return;
    this.clearTickScratch();
    this.building = true;
    try {
      for (let s = 0; s < this.def.solver.substeps; s++) {
        this.stepSubstep(s);
        if (this.result === 'numericalFailure') break;
      }
    } finally {
      this.building = false;
    }
    this.tick++;
    if (this.opts.trace !== false) this.recordTrace();
    this.checkStop();
  }

  /**
   * The tick number stamped on events, ledgers and rule frames: the trace row being built. Inside stepTick that is
   * `tick + 1` (the row recorded when the tick completes); outside it (build, reset, checkStop) it is `tick`. So an
   * event's `tick` equals the `tick` of the trace row that carries its state.
   */
  get stampTick(): number {
    return this.building ? this.tick + 1 : this.tick;
  }

  runToEnd(maxTicks = Infinity): void {
    let n = 0;
    while (!this.done && n < maxTicks) {
      this.stepTick();
      n++;
    }
  }

  private stepSubstep(substep: number): void {
    // 1. queued control-mode / representation transitions at the controlled boundary (one batch)
    const converting: { pl: PlayerRuntime; reason: HandoffRecord['reason']; edit?: CandidateEdit }[] = [];
    const diag = this.def.diagnostics?.conversions ?? [];
    for (const pl of this.players) {
      let reason: HandoffRecord['reason'] | null = null;
      let edit: CandidateEdit | undefined;
      if (pl.balance.pendingLoss && pl.controlMode === 'supported') reason = 'lossOfSupport';
      diag.forEach((d, i) => {
        if (d.playerId === pl.id && !this.diagDone.has(i) && this.t >= d.atS - 1e-9 && this.conversionCondition(pl, d.when)) {
          this.diagDone.add(i);
          if (!pl.rag) {
            reason = reason ?? 'diagnostic';
            edit = d.edit;
            this.emit('diagnosticConversionRequest', pl.id, { atS: d.atS, edit: d.edit ?? null });
          }
        }
      });
      if (!reason) continue;
      if (pl.controlMode === 'supported') {
        pl.controlMode = 'falling';
        pl.balance.pendingLoss = false;
        // Support capabilities stop: traction returns to passive Coulomb friction on the same proxy. Plan 06a: the
        // suspension is disabled before any falling force (it requires the supported control mode).
        this.physics.setSupportFriction(pl.proxy.support, false);
        if (pl.proxy.guard) this.physics.setSupportFriction(pl.proxy.guard, false);
        if (pl.sus) Object.assign(pl.sus, { active: false, commandedN: 0, appliedN: 0, pivotN: 0, comN: 0, tipTorqueNm: v3(), saturated: 'none', approachLimitMps: NaN, authority: 0, powerW: 0 });
        this.emit('controlMode', pl.id, { mode: 'falling', reason, armBudgetFraction: this.arms?.hasArms(pl.id) ? this.balanceProfile.fallingArmBudgetFraction : undefined });
      }
      if (this.def.ragdoll && !pl.rag && !pl.handoff) converting.push({ pl, reason, edit });
    }
    if (converting.length) this.convertBatch(converting);
    // 2. one immutable snapshot for every controller
    const snap = this.snapshot(substep);
    this.history.push(snap);
    if (this.history.length > 64) this.history.shift();
    // 3. intents
    const bodies: Record<PlayerId, BodyProfile> = {};
    for (const pl of this.players) bodies[pl.id] = pl.body;
    for (const pl of this.players) {
      const c = pl.controller;
      const every = Math.max(1, Math.round(c.decisionIntervalS / this.physics.dt));
      let decided = false;
      if (this.steps % every === 0) {
        decided = true;
        const observed = this.observed(c.observationDelayS);
        pl.intent = c.decide({
          self: pl.id,
          focus: this.def.focus?.[pl.id] ?? null,
          observed,
          t: this.t,
          tick: this.tick,
          substep,
          dt: this.physics.dt,
          bodies,
        });
      }
      // After a referee ending: no tackle acceleration, arm requests or posture lean. A supported player may still
      // brake with its finite motor and keep upright support; physics settles passively.
      if (this.rules?.ending) {
        const f = this.coreBody(pl);
        pl.intent = { locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: norm(horiz(forwardOf(f.rotation())), v3(0, 0, 1)), effort: 1 } };
        decided = true;
      }
      this.rampWalkRequest(pl, decided);
    }
    // 4. clear application-owned force/torque accumulators (once, before any contribution)
    for (const pl of this.players)
      for (const b of this.activeBodies(pl)) {
        b.resetForces(true);
        b.resetTorques(true);
      }
    // 4b. plan 06a suspension: locomotion phase once from the solved travel, the height target, then the support force
    // from the probe of the last solved state; labelled diagnostic loads (any profile)
    const S = this.suspension;
    if (S)
      for (const pl of this.players) {
        if (pl.rag || !pl.sus) continue;
        this.advanceLocoMode(pl, this.physics.dt);
        this.advanceLocomotion(pl, this.physics.dt);
        this.supportTargets(pl, S, this.physics.dt);
        this.applySupport(pl, S, this.physics.dt, false);
      }
    this.applyDiagnosticForces();
    // 5. bounded motors: drive, yaw and (balanced profile) finite upright support torque from the same snapshot
    const B = this.balanceProfile;
    for (const pl of this.players) {
      if (pl.rag) {
        pl.applied = EMPTY_APPLIED(); // passive ragdoll: no locomotion, yaw, balance or pose-following motors
        continue;
      }
      const b = snap.bodies[pl.id];
      const supported = pl.controlMode === 'supported' && pl.grounded;
      const bal = pl.balance;
      let ls = 1;
      if (this.balanced) {
        ls = leanScale(bal.theta, B);
        // posture request: desired up, rate-limited toward the requested lean (<= max posture lean)
        const pr = pl.intent.posture;
        const target = pr ? desiredUpFrom(clamp(pr.leanRad, 0, B.maxPostureLeanRad), pr.leanDirWorld) : { ...UP };
        const ang = Math.acos(clamp(dot(bal.desiredUp, target), -1, 1));
        const maxStep = B.postureRateRadPerS * this.physics.dt;
        if (ang <= maxStep || ang < 1e-9) bal.desiredUp = target;
        else {
          const ax = cross(bal.desiredUp, target);
          bal.desiredUp = len(ax) > 1e-12 ? norm(qRot(qFromAxisAngle(norm(ax), maxStep), bal.desiredUp)) : target;
        }
      }
      // plan 06a: the applied suspension load bounds traction (drive and yaw scale with it, never above the legacy caps)
      const auth = pl.sus ? pl.sus.authority : 1;
      const drive = computeDrive(pl.intent.locomotion, b.linearVelocity, b.massKg, pl.motor, supported, ls * auth);
      const yaw = computeYaw(pl.intent.locomotion, b.rotation, b.angularVelocity.y, pl.motor, supported, auth);
      if (drive.cap > 0) pl.proxy.body.addForce(drive.force, true);
      let balReq = v3();
      let balCapped = v3();
      let balCap = 0;
      let balSat = false;
      let support = v3(0, yaw.cap > 0 ? yaw.torqueY : 0, 0);
      let supportScale = 1;
      if (this.balanced) {
        if (supported) {
          // plan 06a: under the suspension the upright torque ceiling follows the profile's balanceCeiling rule (nominal
          // body weight by default, 0 without valid support); the posture hold uses the applied load and the solved lever
          const g = this.def.solver.gravityY;
          const Sb = this.suspension;
          balCap = !pl.sus
            ? availableBalanceTorque(B, b.massKg, g, pl.body.supportRadiusM)
            : !pl.sus.active
              ? 0
              : Sb?.balanceCeiling === 'appliedLoad'
                ? Math.min(B.maxBalanceTorqueNm, pl.sus.appliedN * pl.body.supportRadiusM)
                : availableBalanceTorque(B, b.massKg, g, pl.body.supportRadiusM);
          const hold = pl.sus ? postureGravityHold(bal.desiredUp, pl.sus.pivotN / Math.abs(g), g, pl.sus.leverM) : postureGravityHold(bal.desiredUp, b.massKg, g, bal.leverM);
          const bt = computeBalanceTorque(upOf(b.rotation), bal.desiredUp, b.angularVelocity, B, balCap, hold);
          balReq = bt.requested;
          balCapped = bt.capped;
          balSat = bt.saturated;
          const c = combineSupportTorque(bt.capped, yaw.cap > 0 ? yaw.torqueY : 0, B.combinedCeilingNm);
          support = c.torque;
          supportScale = c.scale;
        } else support = v3();
      }
      if (len(support) > 0) pl.proxy.body.addTorque(support, true);
      pl.applied = {
        requestedVelocity: drive.requestedVelocity,
        drive: drive.force,
        driveCap: drive.cap,
        driveSaturated: drive.saturated,
        yawTorque: yaw.torqueY,
        yawCap: yaw.cap,
        yawError: yaw.angleError,
        balanceRequested: balReq,
        balanceCapped: balCapped,
        balanceCap: balCap,
        balanceSaturated: balSat,
        supportTorque: support,
        supportScale,
        leanScale: ls,
      };
    }
    // 5b. plan 09: passive soft envelopes of every ragdoll, then this substep's effort proposals (accepted ragdolls only)
    for (const pl of this.players) {
      if (pl.rag) applyEnvelope(pl.rag, this.physics.dt);
      if (pl.fall) this.fall!.request(pl.fall, this.contacts, this.arms);
    }
    // 6. arms: collision-aware reach, acquisitions, retention demands, shared budget, reciprocal forces (once)
    this.arms?.preStep();
    // 6b. plan 09: effort applied after the shared allocation, under its power and work caps, as internal torque pairs
    for (const pl of this.players) if (pl.fall) this.fall!.apply(pl.fall, this.arms?.effortScale.get(pl.id));
    // 7. solve
    this.physics.step();
    this.steps++;
    // numerical health first: a non-finite solved state stops the substep and the tick before anything reads it
    if (!this.numericallyHealthy()) return;
    for (const pl of this.players) {
      if (pl.rag) auditEnvelope(pl.rag, this.physics.dt);
      if (pl.fall) this.fall!.audit(pl.fall);
    }
    // 8. read solved state; 9-10. reconstruct arms against solved roots, release failures, classify wraps
    this.postStep(false);
    this.arms?.postStep();
    // 9. lean / recovery envelope; loss is queued for the next controlled boundary
    if (this.balanced) this.evaluateBalance();
    // 10. sim-owned physical pose from the solved state (presentation, next handoff candidate, rule queries)
    this.updatePoses(this.physics.dt);
    // 11. rule observer (observation only)
    if (this.rules && this.result === 'running') this.observeRules();
    for (const pl of this.players) {
      pl.prevVy = pl.lastVy;
      pl.lastVy = this.bulk(pl).v.y;
    }
    this.opts.onSubstep?.(this);
  }

  // ------------------------------------------------------------------ plan 06a: suspension support
  /**
   * Probe every suspension proxy from its solved state: vertical ray from the proxy origin against static colliders
   * (turf and obstacles; players, including the player itself, are never probed). `initial`: reset-time classification
   * (no hysteresis). Grounded (support-eligible ground) = a valid probe.
   */
  private updateProbes(initial: boolean): void {
    for (const pl of this.players) {
      if (pl.rag || !pl.sus) continue;
      this.updateProbe1(pl, initial);
      pl.grounded = pl.sus.probe.valid;
    }
  }

  private updateProbe1(pl: PlayerRuntime, initial: boolean): void {
    const S = this.suspension;
    if (!S || !pl.sus) return;
    const o = vc(pl.proxy.body.translation());
    // other players' live bodies (proxy compound or ragdoll segments) obstruct the probe; the player's own never do
    const others: RAPIER.Collider[] = [];
    for (const p2 of this.players) {
      if (p2 === pl) continue;
      if (p2.rag) for (const c of p2.rag.colliders) others.push(c.collider);
      else others.push(...p2.proxy.colliders);
    }
    const hit = this.physics.groundProbe(o, S.probeMaxM + 4, others.length ? [...this.probeTargets, ...others] : this.probeTargets);
    const player = !!hit && others.includes(hit.collider);
    const tag = hit ? this.physics.tags.get(hit.collider.handle) : undefined;
    pl.sus.probe = classifyProbe(
      S,
      hit
        ? { distM: hit.distM, groundY: hit.pointWorld.y, normalUpDot: hit.normal.y, turf: this.turf.has(hit.collider.handle), player, surface: player ? `player:${tag?.playerId ?? '?'}` : (tag?.key ?? 'static') }
        : null,
      initial || pl.sus.probe.valid,
    );
  }

  /** Stance request (filtered) and the clip-derived running height composed into this substep's height target. */
  private supportTargets(pl: PlayerRuntime, S: SuspensionSupport, dt: number): void {
    const st = pl.sus!;
    const req = pl.intent.locomotion.stance;
    st.requestM = req?.heightM ?? S.standingHeightM;
    advanceStance(st, S, clamp(st.requestM, S.targetRangeM[0], S.targetRangeM[1]), dt);
    // stagger is a pose request: rate-bounded so the feet never jump
    const sg = req?.staggerM ?? 0;
    st.staggerM += clamp(sg - st.staggerM, -S.stance.maxRateMps * dt, S.stance.maxRateMps * dt);
    let runM: RunHeight | null = null;
    const P = this.def.runClips;
    if (pl.run && P && this.heightModels && pl.run.w > 0) {
      const r = runHeight(S, P, this.heightModels, pl.run, this.heightCalibration(pl.body), this.def.solver.gravityY);
      runM = r;
      st.bobScale = r.bobScale;
    } else st.bobScale = 1;
    st.runM = runM?.heightM ?? NaN;
    // plan 07 item 4: braking demand from the intent and the solved travel (the drive's own velocity law and limit)
    const B = S.brakingStance;
    if (B) {
      const loco = pl.intent.locomotion;
      const reqH = clampLen(horiz(loco.desiredVelocityWorld), pl.motor.maximumRequestedSpeedMps);
      const supported = pl.controlMode === 'supported' && pl.grounded;
      // unsupported (airborne, falling): no braking state to derive; the blend holds
      const want = supported ? brakingDemand(B, reqH, horiz(vc(pl.proxy.body.linvel())), loco.effort, pl.motor.velocityResponseTimeS, pl.motor.braking?.maxDecelMps2) : null;
      advanceBraking(st, B, want, dt);
    }
    composeTarget(st, S, runM, pl.run?.w ?? 0, dt, this.prepDrop(pl));
  }

  /** Plan 08: the bounded height drop preparation requests (m), continuous with its weight; 0 without a locomotion profile. */
  private prepDrop(pl: PlayerRuntime): number {
    return pl.loco ? this.def.locomotion!.contact.prepDropM * smooth(pl.loco.prepW) : 0;
  }

  /**
   * Suspension force from the probe of the last solved state: gravity compensation plus spring/damper about the target,
   * clamped to [0, maxForceBW m g], then split (profile application): min(F, m g) vertically at the turf point below the
   * calibrated legacy pivot, the excess vertically through the COM. Only while supported (control mode) with a valid
   * probe; nothing otherwise. Records the load authority, split, pivot torque, lever, power and work. `settle`: reset
   * settling (target constant, no motors).
   */
  private applySupport(pl: PlayerRuntime, S: SuspensionSupport, dt: number, settle: boolean): void {
    const st = pl.sus!;
    const b = pl.proxy.body;
    const pr = st.probe;
    st.active = pl.controlMode === 'supported' && pr.valid;
    if (!st.active) {
      st.commandedN = 0;
      st.appliedN = 0;
      st.pivotN = 0;
      st.comN = 0;
      st.tipTorqueNm = v3();
      st.saturated = 'none';
      st.approachLimitMps = NaN;
      st.authority = 0;
      st.powerW = 0;
      return;
    }
    const m = b.mass();
    const g = this.def.solver.gravityY;
    const o = vc(b.translation());
    const q = { ...b.rotation() };
    const com = vc(b.worldCom());
    const v = vc(b.linvel());
    const w = vc(b.angvel());
    const vAt = (p: Vec3): Vec3 => add(v, cross(w, sub(p, com)));
    const h = pr.heightM;
    const f = suspensionForce(S, m, g, h, vAt(o).y, st.targetM, settle ? 0 : st.targetVMps, settle ? 0 : st.targetAMps2);
    st.commandedN = f.commandedN;
    st.appliedN = f.appliedN;
    st.saturated = f.saturated;
    st.approachLimitMps = f.approachLimitMps;
    st.authority = loadAuthority(f.appliedN, m, g);
    // split after the clamp (profile application): min(F, m g) at the turf point below the pivot, the excess through
    // the COM (lift without additional tipping torque); the total vertical force is unchanged
    const pivot = add(o, qRot(q, S.application.pivot === 'legacyHemisphere' ? st.pivotLocal : v3(0, -h, 0)));
    st.leverM = len(sub(pivot, com));
    const sp = v3(pivot.x, pr.groundY, pivot.z);
    const split = splitSupportForce(S, f.appliedN, m * Math.abs(g));
    st.pivotN = split.pivotN;
    st.comN = split.comN;
    st.pivotPointWorld = sp;
    st.tipTorqueNm = cross(sub(sp, com), v3(0, split.pivotN, 0));
    st.powerW = split.pivotN * vAt(sp).y + split.comN * v.y;
    st.workJ += st.powerW * dt;
    st.impulseNs += f.appliedN * dt;
    if (split.pivotN > 0) b.addForceAtPoint(v3(0, split.pivotN, 0), sp, true);
    if (split.comN > 0) b.addForceAtPoint(v3(0, split.comN, 0), com, true);
  }

  /** Labelled diagnostic external forces at the COM (plan 06a load fixtures); after the support force. */
  private applyDiagnosticForces(): void {
    for (const d of this.def.diagnostics?.forces ?? []) {
      if (this.t < d.fromS - 1e-9 || this.t >= d.toS - 1e-9) continue;
      const pl = this.byId.get(d.playerId);
      if (!pl) continue;
      if (pl.rag) pl.rag.bodies.core.addForce(vc(d.forceWorld), true);
      else pl.proxy.body.addForce(vc(d.forceWorld), true);
    }
    // plan 09 L4-F1: a labelled load across one ragdoll joint, an equal and opposite torque pair (parent frame)
    for (const d of this.def.diagnostics?.jointLoads ?? []) {
      if (this.t < d.fromS - 1e-9 || this.t >= d.toS - 1e-9) continue;
      const rag = this.byId.get(d.playerId)?.rag;
      const j = rag?.joints.find((x) => x.id === d.joint);
      if (!rag || !j) continue;
      const t = qRot(rag.bodies[j.parent].rotation(), d.torqueParentNm);
      rag.bodies[j.child].addTorque(t, true);
      rag.bodies[j.parent].addTorque(neg(t), true);
    }
    for (const d of this.def.diagnostics?.limitLoads ?? []) {
      if (this.t < d.fromS - 1e-9 || this.t >= d.toS - 1e-9) continue;
      const rag = this.byId.get(d.playerId)?.rag;
      const j = rag?.joints.find((x) => x.id === d.joint);
      if (!rag || !j) continue;
      const t = scale(limitGradients(rag, j)[d.limit], d.torqueNm);
      rag.bodies[j.child].addTorque(t, true);
      rag.bodies[j.parent].addTorque(neg(t), true);
    }
  }

  /** Diagnostic conversion condition (RH-F7): vertical motion of the bulk since the previous solve. */
  private conversionCondition(pl: PlayerRuntime, when: 'rising' | 'falling' | 'top' | 'bottom' | undefined): boolean {
    if (!when) return true;
    const vy = pl.lastVy;
    if (when === 'rising') return vy > 0.05;
    if (when === 'falling') return vy < -0.05;
    // an extremum lies in the last solve: the vertical velocity changed sign across it
    if (when === 'top') return pl.prevVy > 0 && vy <= 0;
    return pl.prevVy < 0 && vy >= 0;
  }

  /**
   * Locomotion phase from solved travel: the procedural gait and the run-clip playback (once per substep; dt 0 =
   * initialization). Legacy support: called by pose generation after the solve (plan 06 order). Suspension: called
   * before the support force (plan 06a order); pose generation then only reads the phase.
   */
  /** Plan 08: the locomotion mode from this substep's observations (solved contact, retention, opponents, falling). */
  private advanceLocoMode(pl: PlayerRuntime, dt: number): void {
    const P = this.def.locomotion;
    const st = pl.loco;
    if (!P || !st) return;
    const b = pl.proxy.body;
    const p = vc(b.translation());
    const v = vc(b.linvel());
    let closing = false;
    for (const o of this.players) {
      if (o === pl || o.setup.role === pl.setup.role) continue;
      const q = vc(this.coreBody(o).translation());
      const d = horiz(sub(q, p));
      const gap = len(d);
      const rel = horiz(sub(v, vc(this.coreBody(o).linvel())));
      if (gap <= P.contact.prepRangeM && gap > 1e-6 && dot(rel, d) / gap >= P.contact.prepClosingMps) closing = true;
    }
    const ch = advanceLoco(
      st,
      P,
      {
        contact: (this.contactObs[pl.id] ?? []).length > 0,
        retained: this.retained(pl),
        closing,
        falling: pl.controlMode === 'falling',
        clipSettled: !pl.run || Math.abs(pl.run.w - pl.run.wTarget) < 0.02,
      },
      this.t,
      dt,
    );
    if (ch) this.emit('locoMode', pl.id, ch);
  }

  /** A held grip or clamp on or by this player (owner or target). */
  private retained(pl: PlayerRuntime): boolean {
    if (!this.arms) return false;
    for (const g of this.arms.grips.values()) if (g.ownerId === pl.id || g.targetId === pl.id) return true;
    for (const o of this.players)
      for (const s of ['left', 'right'] as ArmSide[]) {
        const c = this.arms.clampOf(o.id, s);
        if (c && (o === pl || c.targetId === pl.id)) return true;
      }
    return false;
  }

  private advanceLocomotion(pl: PlayerRuntime, dt: number): void {
    if (pl.rag || pl.body.kind !== 'upperBodyCompound') return;
    const b = pl.proxy.body;
    const v = vc(b.linvel());
    const sp = len(horiz(v));
    if (dt > 0 && pl.grounded && pl.controlMode === 'supported') advanceGait(pl.gait, sp, dt);
    const P = this.def.runClips;
    if (!pl.run || !P) return;
    const st = pl.run;
    const core = this.poseOf(pl);
    const RP = this.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    // while the clip is off its phase follows the procedural gait (and the gait follows the clip while it plays)
    if (st.w <= 0 && dt > 0) st.u = (((pl.gait.phase / (2 * Math.PI)) % 1) + 1) % 1;
    const off = st.w <= 0;
    const input = {
      coreP: core.p,
      forward: forwardOf(core.q),
      supported: pl.grounded && pl.controlMode === 'supported' && pl.loco?.mode !== 'contact',
      dt,
      initSpeed: sp,
      initDir: v,
      legM: RP.lengths.thigh + RP.lengths.shin,
      ...(P.walk ? { requestMps: len(horiz(pl.intent.locomotion.desiredVelocityWorld)), braking: (pl.sus?.brakeB ?? 0) > P.walk.brakeB } : {}),
    };
    // the audit's old composition has its own playback: a change of mode changes the clip's weight target
    if (this.opts.transitionAudit) {
      const pv = this.auditPrev.get(pl.id);
      const was = pv ? pv.supported && pv.mode !== 'contact' : input.supported;
      this.auditRun.delete(pl.id);
      if (was !== input.supported) {
        const copy = structuredClone(st);
        advanceRunPlayback(copy, P, { ...input, supported: was });
        if (pl.feet?.profile.compose) followClipWeight(copy, dt);
        this.auditRun.set(pl.id, copy);
      }
    }
    advanceRunPlayback(st, P, input);
    if (pl.feet?.profile.compose) followClipWeight(st, dt);
    // plan 08: a clip that comes in takes the phase of the achieved feet (the foot taking the next stance), not the gait's
    const back = !!pl.feet?.clipBack;
    if (pl.feet) pl.feet.clipBack = false;
    if ((off || back) && st.w > 0 && pl.feet?.profile.compose) {
      const hips = { left: toWorld(core, hipLocal(pl.body, 'left')), right: toWorld(core, hipLocal(pl.body, 'right')) };
      const dir = v3(Math.sin(st.heading), 0, Math.cos(st.heading));
      const join = clipJoin(pl.feet, hips, dir, v);
      if (join) {
        const was = st.u + (st.uSlip ?? 0);
        st.u = joinPhase(st, P, join.side, join.offsetM, join.delayS, RP.lengths.thigh + RP.lengths.shin);
        st.uSlip = ((((was - st.u + 0.5) % 1) + 1) % 1) - 0.5;
      }
    }
    if (st.w > 0) pl.gait.phase = 2 * Math.PI * st.u;
  }

  /** Feed the rule observer one solved substep; on an ending, stop tackle actions and start the settle window. */
  private observeRules(): void {
    const R = this.rules!;
    const pl = this.byId.get(R.runnerId);
    if (!pl) return;
    const core = this.coreBody(pl);
    const retention: RetentionObs[] = [];
    if (this.arms) {
      for (const g of this.arms.grips.values()) {
        if (g.targetId !== pl.id) continue;
        const e = this.arms.lastForce.get(`${g.ownerId}:${g.arm}`);
        const fresh = e && e.id === g.id && e.step === this.steps - 1;
        retention.push({ id: g.id, owner: g.ownerId, kind: 'grip', forceOnRunner: fresh ? e!.forceOnTarget : v3(), loadN: fresh ? len(e!.forceOnTarget) : 0 });
      }
      for (const o of this.players) for (const side of ['left', 'right'] as ArmSide[]) {
        const c = this.arms.clampOf(o.id, side);
        if (!c || c.targetId !== pl.id) continue;
        const e = this.arms.lastForce.get(`${o.id}:${side}`);
        const fresh = e && e.id === c.id && e.step === this.steps - 1;
        retention.push({ id: c.id, owner: o.id, kind: 'clamp', forceOnRunner: fresh ? e!.forceOnTarget : v3(), loadN: c.normalForceN });
      }
    }
    const opp = (this.contactObs[pl.id] ?? []).filter((o) => this.byId.get(o.other)?.setup.role !== pl.setup.role);
    const end = R.observe({
      t: this.t,
      tick: this.stampTick,
      step: this.steps,
      dt: this.physics.dt,
      runnerId: pl.id,
      representation: pl.representation,
      validHandoff: !!pl.handoff?.accepted,
      controlMode: pl.controlMode,
      grounded: pl.grounded,
      corePose: { p: vc(core.translation()), q: { ...core.rotation() } },
      pose: pl.pose,
      velocity: this.bulk(pl).v,
      request: pl.intent.locomotion.desiredVelocityWorld,
      contacts: this.contacts,
      opponentContacts: opp,
      retention,
      minClampNormalN: (this.def.armProfile ?? ARM_G2).wrap.minClampNormalN,
    });
    if (end && this.settleUntil === null) {
      this.settleUntil = this.t + R.profile.settleS;
      this.arms?.endPlay();
    }
  }

  /** The referee ending recorded by the rule observer (frozen; null when none). */
  get ending(): RuleEnding | null {
    return this.rules?.ending ?? null;
  }

  /** Measure actual lean from the solved state and run the loss criterion (supported players only). */
  private evaluateBalance(measureOnly = false): void {
    const B = this.balanceProfile;
    for (const pl of this.players) {
      const b = this.coreBody(pl);
      const bal = pl.balance;
      const m = measureLean({ ...b.rotation() }, vc(b.angvel()), bal.axis, B.zeroTiltRad);
      bal.theta = m.theta;
      bal.axis = m.axis;
      bal.outwardRate = m.outwardRate;
      bal.projected = projectedLean(m, B);
      if (measureOnly || pl.controlMode !== 'supported' || bal.pendingLoss) continue;
      const v = envelopeStep(m, bal.counter, B);
      bal.counter = v.counter;
      if (v.loss) {
        bal.pendingLoss = true;
        bal.lossT = this.t;
        const ids: string[] = [];
        if (this.arms) for (const g of this.arms.grips.values()) if (g.ownerId === pl.id || g.targetId === pl.id) ids.push(g.id);
        if (this.arms) for (const p2 of this.players) for (const side of ['left', 'right'] as ArmSide[]) {
          const c = this.arms.clampOf(p2.id, side);
          if (c && (c.ownerId === pl.id || c.targetId === pl.id)) ids.push(c.id);
        }
        for (const o of this.contactObs[pl.id] ?? []) ids.push(`contact:${pl.id}>${o.other}:${o.ownClass}>${o.otherClass}`);
        this.emit('lossOfSupport', pl.id, {
          reason: v.reason,
          leanAngleRad: round(m.theta, 5),
          leanDeg: round(deg(m.theta), 3),
          outwardLeanRateRadPerS: round(m.outwardRate, 5),
          projectedLeanDeg: round(deg(bal.projected), 3),
          angularVelocity: rv(b.angvel(), 5),
          relevantContactAndGripIds: [...new Set(ids)],
          step: this.steps,
        });
      }
    }
  }

  /**
   * Plan 09 impact guard: per segment of a ragdoll, the fastest closing speed of a contact its geometry meets within
   * `lookaheadS` (floor, obstacles, other players' active colliders), read before the solve. Observation only.
   */
  closingSpeeds(rag: Ragdoll, lookaheadS: number, predictionM: number, skinM: number): Partial<Record<SegmentId, number>> {
    const out: Partial<Record<SegmentId, number>> = {};
    const others: RAPIER.Collider[] = [this.physics.floorCollider, ...this.obstacleColliders];
    for (const o of this.players) if (o.id !== rag.playerId) others.push(...this.activeColliders(o));
    for (const rc of rag.colliders) {
      const own = rc.collider;
      const body = rag.bodies[rc.segment];
      for (const c of others) {
        const r = c.shape.contactShape(c.translation(), c.rotation(), own.shape, own.translation(), own.rotation(), predictionM);
        if (!r) continue;
        const other = c.parent();
        const vRel = sub(vc(body.velocityAtPoint(r.point2)), other ? vc(other.velocityAtPoint(r.point1)) : v3());
        const closing = -dot(vRel, vc(r.normal1));
        if (closing > 0 && r.distance - closing * lookaheadS < skinM) out[rc.segment] = Math.max(out[rc.segment] ?? 0, closing);
      }
    }
    return out;
  }

  /** Read contacts, support, classification and gaps after a solve. */
  private postStep(initial: boolean): void {
    this.contacts = this.physics.collectContacts();
    for (const pl of this.players) {
      if (pl.rag) {
        // ragdoll: grounded = any solved segment-floor manifold (observation only; no support capability)
        let g = false;
        let pen = 0;
        for (const c of this.contacts) {
          const own = c.a.playerId === pl.id ? c.a : c.b.playerId === pl.id ? c.b : null;
          const other = own === c.a ? c.b : c.a;
          if (!own || other.region !== 'floor' || other.playerId !== null) continue;
          g = true;
          for (const p of c.points) pen = Math.max(pen, -p.dist);
        }
        if (!initial && g !== pl.grounded) this.emit('grounded', pl.id, { grounded: g, representation: 'ragdoll' });
        pl.grounded = g;
        pl.supportPoint = null;
        if (pl.ragStats && !initial) {
          const ae = anchorErrors(pl.rag);
          pl.ragStats.maxAnchorErrM = Math.max(pl.ragStats.maxAnchorErrM, ...Object.values(ae));
          pl.ragStats.maxFloorPenM = Math.max(pl.ragStats.maxFloorPenM, pen);
          const hd = hingeAngles(pl.rag);
          for (const j of pl.rag.joints) {
            if (!j.limitsRad) continue;
            const lo = (j.limitsRad[0] * 180) / Math.PI;
            const hi = (j.limitsRad[1] * 180) / Math.PI;
            if (hd[j.id] - hi > pl.ragStats.maxHingeOverDeg) {
              pl.ragStats.maxHingeOverDeg = hd[j.id] - hi;
              pl.ragStats.hingeOverJoint = j.id;
            }
            if (lo - hd[j.id] > pl.ragStats.maxHingeReverseDeg) {
              pl.ragStats.maxHingeReverseDeg = lo - hd[j.id];
              pl.ragStats.hingeReverseJoint = j.id;
            }
          }
          for (const b of this.activeBodies(pl)) pl.ragStats.maxSpeed = Math.max(pl.ragStats.maxSpeed, len(vc(b.linvel())));
        }
        continue;
      }
      if (pl.sus) {
        // plan 06a: support-eligible ground is the classified probe, never the capsule manifold or a drawn foot
        const before = pl.sus.probe;
        this.updateProbe1(pl, initial);
        const pr = pl.sus.probe;
        if (!initial && pr.valid !== pl.grounded) this.emit('grounded', pl.id, { grounded: pr.valid, probe: pr.status, heightM: round(pr.heightM, 4), surface: pr.surface });
        if (!initial && pr.status !== before.status) this.emit('supportProbe', pl.id, { from: before.status, to: pr.status, heightM: round(pr.heightM, 4), normalUpDot: round(pr.normalUpDot, 4), surface: pr.surface, mode: pl.controlMode });
        pl.grounded = pr.valid;
        // support point: the turf point below the body-axis point at probe depth (as applied by the suspension)
        const ax = pr.valid ? add(vc(pl.proxy.body.translation()), qRot({ ...pl.proxy.body.rotation() }, v3(0, -pr.heightM, 0))) : null;
        pl.supportPoint = ax ? v3(ax.x, pr.groundY, ax.z) : null;
        let bot = false;
        for (const c of this.contacts) if ((c.a.key === 'supportGuard' && c.a.playerId === pl.id && c.b.playerId === null) || (c.b.key === 'supportGuard' && c.b.playerId === pl.id && c.a.playerId === null)) bot = true;
        if (!initial && bot !== pl.sus.bottomed) this.emit('supportGuard', pl.id, { contact: bot, mode: pl.controlMode, heightM: round(pr.heightM, 4) });
        pl.sus.bottomed = bot;
        // Collapse: the body has come down onto its bump stop on static ground with no valid support below it (invalid
        // surface or normal, obstructed): a loss of support, queued for the next controlled boundary like an envelope
        // loss. A landing re-acquires the probe within travel before the guard can touch, so it never triggers this.
        if (!initial && bot && !pr.valid && pl.controlMode === 'supported' && !pl.balance.pendingLoss) {
          pl.balance.pendingLoss = true;
          pl.balance.lossT = this.t;
          this.emit('lossOfSupport', pl.id, { reason: 'unsupportedBottomOut', probe: pr.status, surface: pr.surface, heightM: Number.isFinite(pr.heightM) ? round(pr.heightM, 4) : null, step: this.steps });
        }
        continue;
      }
      const com = vc(pl.proxy.body.worldCom());
      const sc = this.physics.supportContact(pl.proxy.support, pl.proxy.supportShape, com);
      if (initial) {
        // Reset-time state: manifolds predate the initial placement, so use geometric clearance instead.
        sc.supporting = this.physics.supportClearance(pl.proxy.support, pl.proxy.supportShape) <= this.def.solver.supportRegionTolM;
      }
      if (!initial && sc.supporting !== pl.grounded) {
        this.emit('grounded', pl.id, { grounded: sc.supporting, localY: sc.localY, normalUpDot: sc.normalUpDot });
      }
      pl.grounded = sc.supporting;
      pl.supportPoint = sc.pointWorld;
    }
    const who: Record<PlayerId, ClassifyInput> = {};
    for (const pl of this.players) {
      who[pl.id] = { pose: this.poseOf(pl), body: pl.body, selectedShoulder: pl.setup.selectedShoulder };
    }
    this.contactObs = observePlayerContacts(this.contacts, who);
    // closest surfaces between every player pair
    for (let i = 0; i < this.players.length; i++)
      for (let j = i + 1; j < this.players.length; j++) {
        const A = this.players[i];
        const B = this.players[j];
        const cl = this.physics.closestBetween(this.activeColliders(A), this.activeColliders(B));
        const k = pairKey(A.id, B.id);
        if (cl) {
          this.pairGap[k] = cl.distance;
          this.pairClosest[k] = { gap: cl.distance, points: { [A.id]: cl.pointA, [B.id]: cl.pointB } };
          if (!initial) this.minPairGap = Math.min(this.minPairGap, cl.distance);
        } else {
          this.pairGap[k] = 50;
          delete this.pairClosest[k];
        }
      }
    if (!initial) this.updateEpisodes();
  }

  /**
   * After a solve: false (once, with the result, stop record and event set) when any active body has a non-finite
   * position or velocity. The caller then stops the substep and stepTick stops the tick, so arms, balance, pose and
   * rules never run on that state.
   */
  private numericallyHealthy(): boolean {
    for (const pl of this.players)
      for (const b of this.activeBodies(pl))
        if (!isFiniteVec(b.translation()) || !isFiniteVec(b.linvel()) || !isFiniteVec(b.angvel())) {
          this.result = 'numericalFailure';
          this.recordStop('numericalFailure', undefined, pl.id);
          this.emit('numericalFailure', pl.id, {});
          return false;
        }
    return true;
  }

  private updateEpisodes(): void {
    const active = new Set<string>();
    for (const pl of this.players) {
      for (const o of this.contactObs[pl.id] ?? []) {
        const k = pairKey(pl.id, o.other);
        active.add(k);
        let ep = this.episodes.get(k);
        if (!ep) {
          ep = { since: this.t, seen: new Set() };
          this.episodes.set(k, ep);
          this.emit('contactBegin', pl.id, { other: o.other, own: o.ownClass, otherClass: o.otherClass, point: rv(o.pointWorld) });
        }
        const label = `${o.ownClass}>${o.otherClass}`;
        (this.tickContactClasses[pl.id] ??= new Set()).add(label);
        const sk = `${pl.id}:${label}`;
        if (!ep.seen.has(sk)) {
          ep.seen.add(sk);
          this.emit('contactRegion', pl.id, {
            other: o.other,
            own: o.ownClass,
            otherClass: o.otherClass,
            point: rv(o.pointWorld),
            impulse: round(o.impulse, 3),
          });
          if (o.ownClass === 'head') {
            this.emit('techniqueFailure', pl.id, { kind: 'headContact', other: o.other, otherClass: o.otherClass });
          }
        }
      }
    }
    for (const [k, ep] of this.episodes) {
      if (!active.has(k)) {
        this.emit('contactEnd', undefined, { pair: k, durationS: round(this.t - ep.since, 4) });
        this.episodes.delete(k);
      }
    }
  }

  private checkStop(): void {
    if (this.result !== 'running') return;
    const end = this.rules?.ending;
    if (end) {
      // the official event and spot are frozen; bodies settle under gravity, contact and passive motion
      if (this.t >= (this.settleUntil ?? 0) - 1e-9 || this.t >= this.def.durationS - 1e-9) {
        this.result = end.kind;
        this.recordStop('ruleEnding', end.kind);
        this.emit('trialEnd', undefined, { reason: end.kind, eventT: end.t, settledS: round(this.t - end.t, 5) });
      }
      return;
    }
    const area = this.def.area;
    for (const pl of this.players) {
      const c = this.bulk(pl).com;
      if (Math.abs(c.x) > area.halfX || Math.abs(c.z) > area.halfZ) {
        // `result` folds an earlier failed transfer in (review finding 2); the stop record keeps the cause
        this.result = this.invalidTransfer ? 'invalidTransfer' : 'practiceOutOfBounds';
        this.recordStop('practiceOutOfBounds', undefined, pl.id);
        this.emit('practiceOutOfBounds', pl.id, { com: rv(c) });
        return;
      }
    }
    if (this.t >= this.def.durationS - 1e-9) {
      this.result = this.invalidTransfer ? 'invalidTransfer' : this.rules?.disabledReason === 'invalidHandoff' ? 'invalidHandoff' : 'duration';
      this.recordStop('duration');
      this.emit('trialEnd', undefined, { reason: this.result });
    }
  }

  private recordStop(reason: StopRecord['reason'], ending?: string, playerId?: PlayerId): void {
    this.stop = {
      reason,
      result: this.result,
      tick: this.stampTick,
      t: round(this.t, 5),
      ...(ending ? { ending } : {}),
      ...(playerId ? { playerId } : {}),
      flags: { invalidTransfer: !!this.invalidTransfer, invalidHandoff: this.rules?.disabledReason === 'invalidHandoff' },
    };
  }

  emit(type: string, playerId: PlayerId | undefined, data: Record<string, unknown>): void {
    this.events.push({ tick: this.stampTick, step: this.steps, t: round(this.t, 5), type, playerId, data });
  }

  // ------------------------------------------------------------------ Gate 4: representation transition
  /**
   * One boundary operation for every player converting now: build all candidates (disabled), validate them together
   * (other converting players are checked as candidates, everyone else as active colliders), then switch the
   * accepted ones atomically and remap their relationships once. Rejected candidates are removed and the player
   * continues as the Gate 3 falling proxy with a recorded handoffRejected reason.
   */
  private convertBatch(list: { pl: PlayerRuntime; reason: HandoffRecord['reason']; edit?: CandidateEdit }[]): void {
    const R = this.def.ragdoll!;
    const cands = list.map((c) => ({
      ...c,
      rag: buildCandidate(this.physics, c.pl.id, c.pl.body, c.pl.pose!, R, c.pl.proxy.body.mass(), c.edit),
      report: null as CandidateReport | null,
    }));
    let accepted = [...cands];
    for (let pass = 0; pass < cands.length + 1; pass++) {
      for (const c of accepted) {
        const ext: ExternalShape[] = externalFromColliders([], () => '', this.physics.floorCollider);
        ext.push(...externalFromColliders(this.obstacleColliders, (cc) => this.physics.tags.get(cc.handle)?.key ?? 'obstacle'));
        for (const o of this.players) {
          if (o === c.pl) continue;
          const oc = accepted.find((x) => x.pl === o);
          if (oc) ext.push(...externalFromRagdoll(oc.rag));
          else ext.push(...externalFromColliders(this.activeColliders(o), (cc) => `${o.id}:${this.physics.tags.get(cc.handle)?.key ?? '?'}`));
        }
        const cp: Parameters<typeof validateCandidate>[3] = {};
        for (const pc of c.pl.proxy.colliders) {
          const t = this.physics.tags.get(pc.handle);
          if (t && (t.region === 'torso' || t.region === 'pelvis' || t.region === 'head')) cp[t.region] = { shape: pc.shape, pose: { p: vc(pc.translation()), q: { ...pc.rotation() } } };
        }
        c.report = validateCandidate(c.rag, c.pl.pose!, ext, cp, c.pl.proxy.body.mass());
      }
      const still = accepted.filter((c) => c.report!.ok);
      if (still.length === accepted.length) break;
      accepted = still;
    }
    for (const c of cands) {
      if (accepted.includes(c)) continue;
      removeRagdoll(this.physics, c.rag);
      const rep = c.report!;
      c.pl.handoff = { accepted: false, outcome: 'rejected', t: this.t, step: this.steps, reason: c.reason, report: rep };
      if (this.rules && c.pl.id === this.rules.runnerId) this.rules.disable('invalidHandoff', { reasons: rep.reasons.join(',') });
      this.emit('handoffRejected', c.pl.id, {
        reasons: rep.reasons.join(','),
        trigger: c.reason,
        edit: c.edit ?? null,
        maxAnchorErrM: round(rep.maxAnchorErrM, 5),
        maxNewExternalPenetrationM: round(rep.maxNewExternalPenetrationM, 5),
        worstExternal: rep.worstExternal,
        proxyCoreDepthM: round(rep.proxyCoreDepthM, 5),
        floorPenetrationM: round(rep.floorPenetrationM, 5),
        hingeDeg: Object.fromEntries(Object.entries(rep.hingeDeg).map(([k, v]) => [k, round(v, 2)])),
        maxLandmarkErrM: round(rep.maxLandmarkErrM, 5),
        fallback: 'fallingProxy',
      });
    }
    const captured = this.arms?.captureRelations(accepted.map((c) => c.pl.id)) ?? new Map();
    const switched: PlayerId[] = [];
    for (const c of accepted) {
      const pl = c.pl;
      const before = this.bodyCount(pl.id);
      const oldHandle = pl.proxy.body.handle;
      const audit = switchToRagdoll(this.physics, pl.proxy.body, c.rag);
      pl.rag = c.rag;
      // plan 08: an accepted conversion ends the locomotion composition (a rejected one keeps it: falling already cleared it)
      if (pl.loco) {
        if (pl.loco.mode !== 'free') this.emit('locoMode', pl.id, { from: pl.loco.mode, to: 'free', reason: 'conversion' });
        pl.loco = newLocoState();
      }
      pl.representation = 'ragdoll';
      const after = this.bodyCount(pl.id);
      const proxyRemoved = !this.physics.world.bodies.contains(oldHandle) || !this.physics.world.getRigidBody(oldHandle)?.isEnabled();
      pl.handoff = { accepted: audit.ok, outcome: audit.ok ? 'accepted' : 'transferFailed', t: this.t, step: this.steps, reason: c.reason, report: c.report!, audit, activeBodies: { before, after, proxyRemoved } };
      pl.ragStats = { maxAnchorErrM: c.report!.maxAnchorErrM, maxFloorPenM: 0, maxSpeed: 0, maxHingeOverDeg: 0, hingeOverJoint: null, maxHingeReverseDeg: 0, hingeReverseJoint: null };
      switched.push(pl.id);
      this.emit('representation', pl.id, {
        from: 'proxy',
        to: 'ragdoll',
        trigger: c.reason,
        profile: this.def.ragdoll!.id,
        activeBodies: { before, after, proxyRemoved },
        audit: { ...audit, massDiffKg: round(audit.massDiffKg, 8), linearRelErr: round(audit.linearRelErr, 9), angularRelErr: round(audit.angularRelErr, 9) },
        candidate: {
          maxAnchorErrM: round(c.report!.maxAnchorErrM, 6),
          maxNewExternalPenetrationM: round(c.report!.maxNewExternalPenetrationM, 5),
          worstExternal: c.report!.worstExternal,
          floorPenetrationM: round(c.report!.floorPenetrationM, 5),
          maxLandmarkErrM: round(c.report!.maxLandmarkErrM, 6),
          hingeDeg: Object.fromEntries(Object.entries(c.report!.hingeDeg).map(([k, v]) => [k, round(v, 2)])),
          straightFallback: pl.pose?.straightFallback ?? [],
        },
      });
      if (!audit.ok) {
        // The proxy is already gone (the audit reads the switched engine state); the assembly remains as diagnostic
        // state. A failed transfer invalidates the trial's physical evidence: no referee completion can follow.
        this.invalidTransfer = { playerId: pl.id, reasons: audit.reasons, t: this.t };
        this.emit('handoffAuditFailure', pl.id, { reasons: audit.reasons.join(','), energyDeltaJ: audit.energyDeltaJ, energyGainLimitJ: audit.energyGainLimitJ, outcome: 'transferFailed' });
        this.rules?.disable('invalidTransfer', { playerId: pl.id, reasons: audit.reasons.join(',') });
      }
    }
    if (switched.length) {
      this.arms?.onRepresentationChange(switched, captured);
      for (const id of switched) {
        const pl = this.byId.get(id)!;
        pl.pose = ragdollPose(pl.rag!);
        // plan 09: the anatomical range starts with the ragdoll; the effort layer only after an accepted transfer
        initEnvelope(pl.rag!);
        if (this.fall && pl.handoff?.accepted) pl.fall = this.fall.begin(pl.id, pl.rag!, pl.setup.role, this.arms);
      }
    }
  }

  // ------------------------------------------------------------------ Gate 4: sim-owned physical pose
  private updatePoses(dt: number): void {
    const R = this.def.ragdoll;
    // plan 07a: every player's published limbs before any pose of this substep is built (order independent)
    const limbs = this.publishedLimbs();
    for (const pl of this.players) {
      if (pl.rag) {
        pl.pose = ragdollPose(pl.rag);
        if (pl.feet) {
          const ev: FootEvent[] = [];
          releaseFeet(pl.feet, 'ragdoll', this.t, ev);
          this.emitFeet(pl, ev);
        }
        continue;
      }
      if (pl.body.kind !== 'upperBodyCompound') {
        pl.pose = null;
        continue;
      }
      const b = pl.proxy.body;
      const v = vc(b.linvel());
      const sp = len(horiz(v));
      // plan 06 order (legacy support): the locomotion phase advances here, after the solve; plan 06a (suspension):
      // it advanced before the support force of this substep and is only read here
      if (!pl.sus) this.advanceLocomotion(pl, dt);
      const core = this.poseOf(pl);
      const localV = qInvRot(core.q, v3(v.x, 0, v.z));
      const RP = R ?? DEFAULT_POSE_PROFILE;
      // plan 06: run-clip playback from solved travel (once per substep); the procedural gait is the bounded fallback
      let sampled: ReturnType<typeof retargetSample> | undefined;
      const P = this.def.runClips;
      if (pl.run && P) {
        const st = pl.run;
        // the sampled request is built at every weight (0 = the procedural targets through the same continuous leg
        // solve), so the clip fades in and out without a solver switch
        if (!pl.rag) sampled = this.sampledLimbs(pl, st, core);
      }
      const armObs = this.arms?.obs(pl.id);
      const arms = armObs
        ? Object.fromEntries(
            // disabled arms have no solved chain: they take the procedural pose
            (['left', 'right'] as ArmSide[])
              .filter((s) => armObs[s]?.enabled)
              .map((s) => [s, { shoulder: armObs[s]!.shoulderWorld, elbow: armObs[s]!.elbowWorld, wrist: armObs[s]!.wristWorld, palm: armObs[s]!.palmContactWorld }]),
          )
        : undefined;
      const poseIn: ProxyPoseInput = {
        playerId: pl.id,
        body: pl.body,
        ragdoll: RP,
        pose: core,
        gait: pl.gait,
        speed: pl.grounded && pl.controlMode === 'supported' ? sp : 0,
        arms,
        readyHands: !!pl.intent.debug?.readyHands,
        carriesBall: pl.setup.role === 'runner',
        ...(this.def.carry ? { carry: this.def.carry } : {}),
        localVelDir: sp > 0.2 ? v3(localV.x / sp, 0, localV.z / sp) : v3(0, 0, 1),
        clearance: R ? this.poseClearance(pl, limbs) : undefined,
        memory: pl.poseMemory,
        sampled,
        ground: pl.sus
          ? { y: pl.sus.probe.valid || Number.isFinite(pl.sus.probe.heightM) ? pl.sus.probe.groundY : 0, staggerM: pl.sus.staggerM, ...(pl.controlMode === 'falling' ? { bodyRelative: true } : {}) }
          : undefined,
        dtS: dt,
        handoffPossible: !!this.def.ragdoll && !pl.rag && !pl.handoff,
        ...(this.def.locomotion ? { loco: { profile: this.def.locomotion, brakeB: pl.sus?.brakeB ?? 0, swing: this.walkSwing(pl, this.def.locomotion, core, sp, dt), contactW: pl.loco?.braceW ?? 0 } } : {}),
      };
      // plan 07: the foot plan reads the solved state and this substep's ordinary leg requests, writes foot requests for
      // the same leg solve, then observes the achieved pose (pose only)
      const fp = pl.feet;
      let ftIn: FootPlanInput | null = null;
      const ev: FootEvent[] = [];
      if (fp && poseIn.ground) {
        poseIn.ground.fixedGait = true;
        ftIn = this.footInput(pl, poseIn, sampled, dt);
        poseIn.feet = fp.initialized ? planFeet(fp, ftIn, ev) : {};
      }
      const oldIn = this.opts.transitionAudit && ftIn ? this.auditInput(pl, poseIn, ftIn) : null;
      pl.pose = buildProxyPose(poseIn);
      if (oldIn) this.recordTransition(pl, oldIn, poseIn, pl.pose);
      if (this.opts.transitionAudit) this.keepLandmarks(pl, poseIn, pl.pose);
      if (fp && ftIn) {
        if (!fp.initialized) initFeet(fp, pl.pose, ftIn, ev);
        else observeFeet(fp, pl.pose, ftIn.soleM, ftIn.groundY, ev, ftIn.t);
        this.emitFeet(pl, ev);
        const prev = this.auditPrev.get(pl.id);
        if (prev && this.opts.transitionAudit) prev.plan = structuredClone(fp);
      }
    }
  }

  /** The clip's limb requests of a playback at the solved root. */
  private sampledLimbs(pl: PlayerRuntime, st: RunPlayback, core: ProxyPoseInput['pose']): ReturnType<typeof retargetSample> {
    const P = this.def.runClips!;
    const composed = !!pl.feet?.profile.compose;
    return retargetSample(composed ? shownSample(st, P) : (playbackSample(st, P) ?? sampleRunClip(P.clips[st.k], st.u)), composed ? (st.wF ?? smooth(st.w)) : st.w, pl.body, this.def.ragdoll ?? DEFAULT_POSE_PROFILE, core, st.heading, {
      armSwing: P.armSwing,
      carrySwing: P.carrySwing,
      restToe: P.clips[st.k].restToe,
      armMean: playbackArmMean(st, P),
      ...(P.stanceWidthAddM ? { widthAddM: playbackWidthAddM(st, P) } : {}),
      ...(st.stride !== undefined ? { strideScale: st.stride, carryShare: clamp(st.pos, 0, 1) } : {}),
      ...(this.def.carry ? { carryRaw: true } : {}),
    });
  }

  /**
   * Plan 08 audit: when this substep's composition differs from the last one, the pose input of the old composition at the
   * same solved state and time. Each owner that changed continues as if nothing had happened: the feet from a copy of the
   * plan (`continueOwners`), the arms from their last owner (an achieved arm kept in the body frame, the last ready and
   * contact state), the legs' support state. The phases have advanced once, for the live substep; the copies share them.
   * Null when nothing changed.
   */
  private auditInput(pl: PlayerRuntime, inp: ProxyPoseInput, ftIn: FootPlanInput): AuditOld | null {
    const fp = pl.feet;
    if (!fp?.initialized || !inp.feet) return null;
    const SD: ArmSide[] = ['left', 'right'];
    // (with its reseed count: the pose takes a reseed as a new owner of the same kind)
    const foot = (s: ArmSide): string => `${fp.feet[s].mode}/${fp.feet[s].source}${fp.feet[s].mode === 'swing' && fp.feet[s].wait ? '+wait' : ''}#${fp.feet[s].seeds}`;
    const contactW = inp.loco?.contactW ?? 0;
    const arm = (s: ArmSide): string => (inp.arms?.[s] ? 'achieved' : inp.readyHands ? 'ready' : inp.carriesBall && s === 'right' ? 'carry' : 'free') + (contactW > 0 ? '+contact' : '');
    const supported = pl.controlMode === 'supported' && !!pl.sus?.probe.valid;
    const falling = pl.controlMode === 'falling';
    const footO = { left: foot('left'), right: foot('right') };
    const armO = { left: arm('left'), right: arm('right') };
    const key = [footO.left, footO.right, pl.loco?.mode ?? '', fp.brakeHeld ? 'held' : 'clip', armO.left, armO.right, falling ? 'falling' : supported ? 'supported' : 'unsupported'].join(' ');
    const prev = this.auditPrev.get(pl.id);
    const armsL: AuditPrev['armsL'] = {};
    for (const s of SD) {
      const a = inp.arms?.[s];
      if (a) armsL[s] = { elbow: qInvRot(inp.pose.q, sub(a.elbow, inp.pose.p)), wrist: qInvRot(inp.pose.q, sub(a.wrist ?? a.palm, inp.pose.p)), palm: qInvRot(inp.pose.q, sub(a.palm, inp.pose.p)) };
    }
    const reqNow = { left: legRequestLocal(inp, 'left'), right: legRequestLocal(inp, 'right') };
    this.auditPrev.set(pl.id, { key, foot: footO, arm: armO, feet: { ...inp.feet }, plan: null, reqL: reqNow, reqL2: prev?.reqL ?? reqNow, reqN: (prev?.reqN ?? 0) + 1, armsL, readyHands: !!inp.readyHands, contactW, supported, falling, mode: pl.loco?.mode ?? '' });
    if (!prev?.plan || prev.key === key) return null;
    const old: AuditOld = { ...inp, memory: structuredClone(pl.poseMemory), from: prev.key, to: key, reference: {}, requestJumpM: { left: 0, right: 0 }, stepStopM: { left: 0, right: 0 } };
    // the legs' support composition: the ordinary request of the old state at this root
    const v = vc(pl.proxy.body.linvel());
    const seam = prev.supported !== supported || prev.falling !== falling;
    if (seam) {
      old.speed = prev.supported ? len(horiz(v)) : 0;
      old.ground = { ...inp.ground!, bodyRelative: prev.falling ? true : undefined };
    }
    const run = this.auditRun.get(pl.id);
    if (run) old.sampled = this.sampledLimbs(pl, run, inp.pose);
    const request = {} as FootPlanInput['request'];
    for (const s of SD) request[s] = toWorld(inp.pose, legRequestLocal(old, s));
    const { requests: cont, stopped, tookUp } = continueOwners(prev.plan, { ...ftIn, request }, prev.feet);
    const feet = { ...inp.feet };
    // a foot whose ownership did not change keeps this substep's request: only the handover is compared. Across a change of the
    // request's composition its offset is the old one: the live offset has taken the new request's seam up
    const kept = (s: ArmSide): boolean => prev.foot[s] === footO[s] && !seam;
    for (const s of SD) if (!kept(s)) feet[s] = cont[s];
    old.feet = feet;
    // the reference: the same composition with the old path's own snaps taken out where they start: a following foot's
    // ordinary request carried on in the body frame, a step out of time carried on along its stored motion
    const ref = { ...feet };
    for (const s of SD) {
      const q = feet[s];
      // (a carried foot has the old path's request itself: nothing of it was corrected, its comparison is with that path as it is)
      if (kept(s) || inp.feet[s]?.carried) continue;
      const on = stopped[s];
      // (a jump the old owner's offset took up is already out of its path)
      if (q?.kind === 'offset' && prev.reqN > 1 && !tookUp[s]) {
        const L = legRequestLocal(old, s);
        const jump = sub(L, sub(scale(prev.reqL[s], 2), prev.reqL2[s]));
        ref[s] = { ...q, offsetW: sub(q.offsetW, qRot(inp.pose.q, jump)) };
        old.requestJumpM[s] = len(jump);
      } else if (q?.kind === 'target' && on) {
        ref[s] = { ...q, ankleW: on };
        old.stepStopM[s] = dist(q.ankleW, on);
      }
    }
    old.reference = ref;
    // an arm whose owner changed keeps the old owner
    const arms = { ...(inp.arms ?? {}) };
    for (const s of SD) {
      if (prev.arm[s].split('+')[0] === armO[s].split('+')[0]) continue;
      const q = prev.armsL[s];
      if (q) arms[s] = { shoulder: toWorld(inp.pose, shoulderLocal(pl.body, s)), elbow: toWorld(inp.pose, q.elbow), wrist: toWorld(inp.pose, q.wrist), palm: toWorld(inp.pose, q.palm) };
      else delete arms[s];
    }
    old.arms = inp.arms ? arms : undefined;
    old.readyHands = prev.readyHands;
    if (inp.loco && (prev.contactW > 0) !== (contactW > 0)) old.loco = { ...inp.loco, contactW: prev.contactW };
    return old;
  }

  private keepLandmarks(pl: PlayerRuntime, inp: ProxyPoseInput, pose: PhysicalPose): void {
    const local: Record<string, Vec3> = {};
    for (const [n, p] of Object.entries(pose.jointLandmarksWorld)) local[n] = qInvRot(inp.pose.q, sub(p, inp.pose.p));
    const h = this.auditHist.get(pl.id) ?? [];
    h.push(local);
    if (h.length > 2) h.shift();
    this.auditHist.set(pl.id, h);
  }

  private recordTransition(pl: PlayerRuntime, oldIn: AuditOld, nowIn: ProxyPoseInput, now: PhysicalPose): void {
    const diff = (o: PhysicalPose): { m: number; k: string; by: Record<string, number> } => {
      const by: Record<string, number> = {};
      let m = 0;
      let k = '';
      for (const [n, p] of Object.entries(now.jointLandmarksWorld)) {
        const q = o.jointLandmarksWorld[n];
        if (!q) continue;
        const d = len(sub(p, q));
        by[n] = d;
        if (d > m) [m, k] = [d, n];
      }
      return { m, k, by };
    };
    const old = buildProxyPose({ ...oldIn, memory: structuredClone(oldIn.memory) });
    const reference = buildProxyPose({ ...oldIn, feet: oldIn.reference, memory: structuredClone(oldIn.memory) });
    const raw = diff(old);
    const rf = diff(reference);
    // reported beside the limit, never part of it: the largest landmark departure from its own body-frame motion carried on
    const h = this.auditHist.get(pl.id);
    let continuedM = 0;
    if (h?.length === 2)
      for (const n of Object.keys(rf.by)) {
        if (!h[0][n] || !h[1][n]) continue;
        continuedM = Math.max(continuedM, len(sub(qInvRot(nowIn.pose.q, sub(now.jointLandmarksWorld[n], nowIn.pose.p)), sub(scale(h[1][n], 2), h[0][n]))));
      }
    const leg = (i: ProxyPoseInput, o: PhysicalPose, s: ArmSide): AuditLeg => {
      const r = i.feet?.[s];
      const n = o.legInfo?.[s];
      return { kind: r?.kind ?? 'none', request: n?.request ?? v3(), ankle: o.jointLandmarksWorld[`${s}Ankle`], variant: n?.variant ?? 0, softM: n?.softM ?? 0, liftM: n?.liftM ?? 0, soleO: r?.soleO ?? 0, poleW: r?.poleW ?? 0 };
    };
    const legs = { left: { old: leg(oldIn, old, 'left'), now: leg(nowIn, now, 'left') }, right: { old: leg(oldIn, old, 'right'), now: leg(nowIn, now, 'right') } };
    this.transitionDeltas.push({ t: this.t, playerId: pl.id, from: oldIn.from, to: oldIn.to, deltaM: rf.m, landmark: rf.k, by: rf.by, rawM: raw.m, rawBy: raw.by, continuedM, requestJumpM: oldIn.requestJumpM, stepStopM: oldIn.stepStopM, legs });
  }

  /**
   * Plan 08 walking arm swing (-1..1, + = right foot ahead): the achieved feet's fore-aft spread along the body, low-pass
   * filtered (the planner's steps are not continuous), faded in with the supported travel speed.
   */
  /**
   * Plan 08: starts and stops go over steps, at the speed curves of the supplied start clips. A free player's request
   * slews at the profile's walk ramp while it and the ramp are at walking speed, and at its start ramp (optional) while
   * it asks for more than the ramp has reached (from the solved speed, so a run that picks up again never brakes first).
   * A stop from a run, any contact and a referee ending pass through unchanged. The ramp's output replaces the intent's request, so the
   * controller's own request is kept apart: a decision updates it, every substep advances the ramp toward it.
   */
  private rampWalkRequest(pl: PlayerRuntime, decided: boolean): void {
    const W = this.def.runClips?.walk;
    if (!W) return;
    const loco = pl.intent.locomotion;
    if (decided || !pl.walkWant) pl.walkWant = horiz(loco.desiredVelocityWorld);
    const want = pl.walkWant;
    let was = pl.walkRequest ?? want;
    const free = !this.rules?.ending && pl.controlMode === 'supported' && pl.loco?.mode === 'free';
    let rate = 0;
    if (free && len(want) <= W.requestMps[1] && len(was) <= W.requestMps[1]) rate = W.rampMps2;
    else if (free && W.startMps2 && len(want) > len(was)) {
      rate = W.startMps2;
      const v = horiz(vc(pl.proxy.body.linvel()));
      if (len(v) > len(was)) was = v;
    }
    pl.walkRequest = rate > 0 ? add(was, clampLen(sub(want, was), rate * this.physics.dt)) : want;
    pl.intent = { ...pl.intent, locomotion: { ...loco, desiredVelocityWorld: pl.walkRequest } };
  }

  private walkSwing(pl: PlayerRuntime, P: LocomotionProfile, core: ProxyPoseInput['pose'], speed: number, dt: number): number {
    const fp = pl.feet;
    if (!fp || !fp.initialized) return 0;
    const fwd = forwardOf(core.q);
    const fwdH = norm(v3(fwd.x, 0, fwd.z), v3(0, 0, 1));
    const d = dot(sub(fp.feet.right.ankleW, fp.feet.left.ankleW), fwdH);
    const W = P.walk;
    const supported = pl.grounded && pl.controlMode === 'supported';
    const want = supported ? clamp(d / W.strideM, -1, 1) * smooth((speed - W.fadeMps[0]) / (W.fadeMps[1] - W.fadeMps[0])) : 0;
    const st = pl.loco!;
    st.swing += (want - st.swing) * (dt > 0 ? 1 - Math.exp(-dt / W.tauS) : 0);
    return st.swing;
  }

  /** Foot planner input from the solved state, the support probe and control mode, and the pose path's requests. */
  private footInput(pl: PlayerRuntime, inp: ProxyPoseInput, sampled: ProxyPoseInput['sampled'], dt: number): FootPlanInput {
    const R = inp.ragdoll;
    const core = inp.pose;
    const b = pl.proxy.body;
    const v = vc(b.linvel());
    const soleM = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
    const gy = inp.ground!.y;
    const fwd = forwardOf(core.q);
    const fwdH = norm(v3(fwd.x, 0, fwd.z), v3(0, 0, 1));
    const rw = qRot(core.q, v3(sideSignX(pl.body, 'right'), 0, 0));
    const rightW = norm(v3(rw.x, 0, rw.z), v3(1, 0, 0));
    const hips = {} as FootPlanInput['hips'];
    const home = {} as FootPlanInput['home'];
    const request = {} as FootPlanInput['request'];
    for (const s of ['left', 'right'] as ArmSide[]) {
      const hip = toWorld(core, hipLocal(pl.body, s));
      hips[s] = hip;
      const st = (s === 'left' ? 0.5 : -0.5) * (inp.ground?.staggerM ?? 0);
      // plan 08: the fitted idle stance opens as the travel stops (the same width as the ordinary request)
      const wide = inp.loco ? inp.loco.profile.idle.widthAddM * (s === 'left' ? -1 : 1) * (1 - Math.min(1, inp.speed / 1.5)) : 0;
      home[s] = v3(hip.x + fwdH.x * st + rightW.x * wide, gy + soleM, hip.z + fwdH.z * st + rightW.z * wide);
      request[s] = toWorld(core, legRequestLocal(inp, s));
    }
    const P = this.def.runClips;
    let clip: FootPlanInput['clip'] = null;
    if (pl.run && P && pl.run.w > 0 && sampled) {
      const contact = {} as NonNullable<FootPlanInput['clip']>['contact'];
      for (const s of ['left', 'right'] as ArmSide[]) {
        const c = sampled.legs[s].contact;
        contact[s] = c ? { weight: c.weight, rollF: c.rollF, toeZ: c.toeZ } : null;
      }
      clip = { weight: pl.run.w, headingRad: pl.run.heading, stance: playbackStance(pl.run, P), contact, swingP: playbackSwingProgress(pl.run, P) };
    }
    const sus = pl.sus!;
    return {
      t: this.t,
      dt,
      core,
      vel: v3(v.x, 0, v.z),
      yawRate: b.angvel().y,
      supported: pl.controlMode === 'supported' && sus.probe.valid,
      falling: pl.controlMode === 'falling',
      ragdoll: !!pl.rag,
      groundY: gy,
      hips,
      home,
      request,
      clip,
      soleM,
      // reactive plants: the toe pivot of the footprint midway between the shoe centre and its tip (no clip toe base)
      toeM: R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z,
      rightW,
      sideSign: { left: -1, right: 1 },
      brakeB: sus.brakeB,
      contactHold: pl.loco?.mode === 'contact',
    };
  }

  private emitFeet(pl: PlayerRuntime, ev: FootEvent[]): void {
    for (const e of ev) this.emit(e.type, pl.id, { side: e.side, ...e.data });
  }

  /**
   * Supported-state limb constraints for the procedural pose: penetration of candidate limb shapes against other
   * players' active colliders, diagnostic obstacles and opponents' achieved query-arm segments (external), and of
   * forearm/palm against the player's own torso/pelvis (self).
   */
  private poseClearance(pl: PlayerRuntime, limbs?: Map<PlayerId, ExternalShape[]>): PoseClearance {
    const ext: ExternalShape[] = [];
    const soft: ExternalShape[] = [];
    for (const o of this.players) {
      if (o === pl) continue;
      ext.push(...externalFromColliders(this.activeColliders(o), () => o.id));
      // plan 07a (ground-relative poses): another player's published limbs are physical for this player's procedural
      // limbs while that player can still convert (they become its ragdoll colliders at the switch, possibly in the same
      // batch); a ragdoll's limbs are already active colliders
      if (pl.sus && limbs && this.def.ragdoll && !o.rag && !o.handoff) {
        const ls = limbs.get(o.id);
        if (ls) ext.push(...ls);
      }
      const ao = this.arms?.obs(o.id);
      if (ao && !o.rag)
        for (const sd of ['left', 'right'] as ArmSide[]) {
          const a = ao[sd];
          if (!a || !a.enabled) continue;
          const A = this.def.armProfile ?? ARM_G2;
          for (const sh of [capsuleShape(a.shoulderWorld, a.elbowWorld, A.upperArmRadiusM), capsuleShape(a.elbowWorld, a.wristWorld, A.forearmRadiusM)]) if (sh) soft.push({ key: `${o.id}:arm`, ...sh });
        }
    }
    ext.push(...externalFromColliders(this.obstacleColliders, () => 'obstacle'));
    const own: ExternalShape[] = [];
    for (const c of pl.proxy.colliders) {
      const t = this.physics.tags.get(c.handle);
      if (t && (t.region === 'torso' || t.region === 'pelvis')) own.push({ key: t.region, shape: c.shape, pose: { p: vc(c.translation()), q: { ...c.rotation() } } });
    }
    const depth = (shapes: PoseShape[], against: ExternalShape[]): number => {
      let d = 0;
      for (const s of shapes) {
        const q = poseShapeToRapier(s);
        if (!q) continue;
        for (const e of against) {
          const r = e.shape.contactShape(e.pose.p, e.pose.q, q.shape, q.pose.p, q.pose.q, 0.02);
          if (r) d = Math.max(d, -r.distance);
        }
      }
      return d;
    };
    const push = (shapes: PoseShape[], toleranceM = 0): Vec3 => {
      const v = v3();
      for (const s of shapes) {
        const q = poseShapeToRapier(s);
        if (!q) continue;
        let best: { d: number; n: Vec3 } | null = null;
        for (const e of ext) {
          const r = e.shape.contactShape(e.pose.p, e.pose.q, q.shape, q.pose.p, q.pose.q, 0);
          if (r && r.distance < 0 && (!best || -r.distance > best.d)) best = { d: -r.distance, n: vc(r.normal1) };
        }
        if (best) Object.assign(v, addScaled(v, best.n, Math.max(0, best.d - toleranceM)));
      }
      return v;
    };
    return { external: (shapes) => depth(shapes, ext), soft: (shapes) => depth(shapes, soft), self: (shapes) => depth(shapes, own), push };
  }

  /**
   * Plan 07a: candidate-equivalent limb and shoe shapes of every non-ragdoll player's published pose (the pose of the
   * last substep), keyed `<id>:<segment>`. Read once before the poses of a substep are built, so no player sees another
   * player's pose of the same substep (player order cannot decide who yields).
   */
  private publishedLimbs(): Map<PlayerId, ExternalShape[]> {
    const out = new Map<PlayerId, ExternalShape[]>();
    const R = this.def.ragdoll;
    if (!R || !this.suspension) return out;
    for (const o of this.players) {
      if (o.rag || !o.pose || o.body.kind !== 'upperBodyCompound') continue;
      const ls: ExternalShape[] = [];
      for (const s of poseLimbShapes(R, o.pose)) {
        const q = poseShapeToRapier(s);
        if (q) ls.push({ key: `${o.id}:${s.key}`, shape: q.shape, pose: q.pose });
      }
      out.set(o.id, ls);
    }
    return out;
  }

  /** Clip flight: the clip plays (weight >= 0.5) outside both feet's stance intervals (visual flight only). */
  clipFlight(pl: PlayerRuntime): boolean {
    const st = pl.run;
    const P = this.def.runClips;
    if (!st || !P || st.w < 0.5) return false;
    const c = P.clips[st.blend > 0.5 && P.clips[st.k + 1] ? st.k + 1 : st.k].record.stance;
    const inS = (u: number, [a, b]: [number, number]): boolean => (a <= b ? u >= a && u < b : u >= a || u < b);
    return !inS(st.u, c.left) && !inS(st.u, c.right);
  }

  // ------------------------------------------------------------------ snapshots
  poseOf(pl: PlayerRuntime): { p: Vec3; q: Quat } {
    const b = this.coreBody(pl);
    return { p: vc(b.translation()), q: { ...b.rotation() } };
  }

  bodySnapshot(pl: PlayerRuntime): BodySnapshot {
    const b = this.coreBody(pl);
    const k = this.bulk(pl);
    return {
      playerId: pl.id,
      position: vc(b.translation()),
      rotation: { ...b.rotation() },
      linearVelocity: k.v,
      angularVelocity: k.w,
      centerOfMassWorld: k.com,
      grounded: pl.grounded,
      massKg: k.massKg,
      controlMode: pl.controlMode,
      representation: pl.representation,
    };
  }

  snapshot(substep = 0): Snapshot {
    const bodies: Record<PlayerId, BodySnapshot> = {};
    for (const pl of this.players) bodies[pl.id] = this.bodySnapshot(pl);
    const contacts: Record<PlayerId, PlayerContactObs[]> = {};
    for (const pl of this.players) contacts[pl.id] = [...(this.contactObs[pl.id] ?? [])];
    const arms: Snapshot['arms'] = {};
    const wrap: Snapshot['wrap'] = {};
    if (this.arms)
      for (const pl of this.players) {
        const o = this.arms.obs(pl.id);
        if (o) arms[pl.id] = o;
        const w = this.arms.wrap.get(pl.id);
        if (w) wrap[pl.id] = { status: w.status, target: w.target };
      }
    const balance: Record<PlayerId, BalanceState> = {};
    for (const pl of this.players) balance[pl.id] = this.balanceState(pl);
    return { tick: this.tick, substep, t: this.t, bodies, contacts, pairGap: { ...this.pairGap }, arms, wrap, balance };
  }

  balanceState(pl: PlayerRuntime): BalanceState {
    return {
      playerId: pl.id,
      controlMode: pl.controlMode,
      leanAngleRad: pl.balance.theta,
      outwardLeanRateRadPerS: pl.balance.outwardRate,
      projectedLeanRad: pl.balance.projected,
      supportingContact: pl.grounded,
      requestedBalanceTorqueNm: { ...pl.applied.balanceRequested },
      actualBalanceTorqueNm: sub(pl.applied.supportTorque, v3(0, pl.applied.supportScale * (pl.applied.yawCap > 0 ? pl.applied.yawTorque : 0), 0)),
      recoveryLimitCounter: pl.balance.counter,
    };
  }

  private observed(delayS: number): Snapshot {
    const back = Math.round(delayS / this.physics.dt);
    const i = Math.max(0, this.history.length - 1 - back);
    return this.history[i];
  }

  // ------------------------------------------------------------------ trace / export
  private recordTrace(): void {
    const players: Record<PlayerId, PlayerTraceRow> = {};
    for (const pl of this.players) {
      const b = this.coreBody(pl);
      const k = this.bulk(pl);
      const d = pl.applied;
      players[pl.id] = {
        p: rv(b.translation(), 5),
        com: rv(k.com, 5),
        v: rv(k.v, 5),
        w: rv(k.w, 5),
        yaw: round(yawOf(b.rotation()), 5),
        drive: rv(d.drive, 3),
        cap: round(d.driveCap, 3),
        req: [round(d.requestedVelocity.x, 4), round(d.requestedVelocity.z, 4)],
        yawT: round(d.yawTorque, 3),
        g: pl.grounded ? 1 : 0,
        c: [...(this.tickContactClasses[pl.id] ?? [])],
        ph: (pl.intent.debug?.phase as string | undefined) ?? undefined,
        mode: pl.controlMode,
      };
      if (this.balanced)
        players[pl.id].lean = {
          deg: round(deg(pl.balance.theta), 4),
          rate: round(pl.balance.outwardRate, 4),
          proj: round(deg(pl.balance.projected), 4),
          tauB: round(len(this.balanceState(pl).actualBalanceTorqueNm), 3),
          tauReq: round(len(pl.applied.balanceRequested), 3),
          s: round(pl.applied.leanScale, 4),
          cnt: pl.balance.counter,
          post: round(deg(Math.acos(clamp(pl.balance.desiredUp.y, -1, 1))), 4),
          dev: round(deg(Math.acos(clamp(dot(upOf(b.rotation()), pl.balance.desiredUp), -1, 1))), 4),
        };
      if (pl.rag) {
        const ae = anchorErrors(pl.rag);
        players[pl.id].rep = 'ragdoll';
        players[pl.id].jsep = round(Math.max(...Object.values(ae)), 5);
        players[pl.id].hinge = Object.fromEntries(Object.entries(pl.pose?.hingeDeg ?? {}).map(([kk, vv]) => [kk, round(vv, 2)]));
      }
      if (pl.fall) {
        const f = pl.fall;
        players[pl.id].fall = {
          e: round(f.effort, 3),
          l: [f.arms.left.task, f.arms.left.brace],
          r: [f.arms.right.task, f.arms.right.brace],
          W: round(f.stats.positiveWorkJ, 3),
          Wn: round(f.stats.negativeWorkJ, 3),
          P: round(f.applied.reduce((s, a) => s + Math.max(0, a.entry.realizedW), 0), 2),
          T: Object.fromEntries(f.applied.map((a) => [a.entry.joint, round(a.entry.appliedNm, 2)])),
        };
      }
      if (pl.rag?.envelope) players[pl.id].lim = round(Math.max(0, ...pl.rag.envelope.map((e) => e.maxOverDeg)), 2);
      if (pl.feet && !pl.rag) players[pl.id].ft = footTrace(pl.feet);
      if (pl.loco && !pl.rag) players[pl.id].loco = { m: pl.loco.mode, why: pl.loco.reason, p: round(pl.loco.prepW, 3), c: round(pl.loco.contactW, 3), s: round(pl.loco.swing, 3), d: round(this.prepDrop(pl), 4) };
      if (pl.run && this.def.runClips && !pl.rag) {
        const st = pl.run;
        players[pl.id].run = {
          clip: playbackLabel(st, this.def.runClips),
          u: round(st.u, 5),
          w: round(st.w, 4),
          wt: round(st.wTarget, 4),
          r: round(st.rate, 4),
          b: round(st.blend, 4),
          v: round(st.speed, 4),
          res: Object.fromEntries(Object.entries(pl.pose?.targetResidualM ?? {}).map(([kk, vv]) => [kk, round(vv, 4)])),
        };
      }
      if (pl.sus && !pl.rag) {
        const u = pl.sus;
        const pr = u.probe;
        players[pl.id].sup = {
          h: Number.isFinite(pr.heightM) ? round(pr.heightM, 5) : null,
          ht: round(u.targetM, 5),
          vt: round(u.targetVMps, 4),
          at: round(u.targetAMps2, 3),
          req: round(u.requestM, 4),
          run: Number.isFinite(u.runM) ? round(u.runM, 5) : null,
          ...(this.suspension?.brakingStance ? { bk: round(u.brakeB, 4), bkw: Number.isFinite(u.brakeWant) ? round(u.brakeWant, 4) : null } : {}),
          s: round(u.bobScale, 4),
          F: round(u.appliedN, 2),
          Fc: round(u.commandedN, 2),
          Fp: round(u.pivotN, 2),
          Fm: round(u.comN, 2),
          T: [round(u.tipTorqueNm.x, 2), round(u.tipTorqueNm.y, 2), round(u.tipTorqueNm.z, 2)],
          sat: u.saturated === 'none' ? 0 : u.saturated === 'zero' ? 1 : 2,
          a: round(u.authority, 4),
          ok: pr.valid ? 1 : 0,
          st: pr.status,
          lev: round(u.leverM, 4),
          W: round(u.workJ, 3),
          J: round(u.impulseNs, 4),
          P: round(u.powerW, 2),
          bot: u.bottomed ? 1 : 0,
          fl: this.clipFlight(pl) ? 1 : 0,
        };
        if (Number.isFinite(u.approachLimitMps)) players[pl.id].sup!.vl = round(u.approachLimitMps, 4);
      }
      const ao = this.arms?.obs(pl.id);
      if (ao) {
        const arm: NonNullable<PlayerTraceRow['arm']> = {};
        for (const side of ['left', 'right'] as ArmSide[]) {
          const o = ao[side];
          if (!o || !o.enabled) continue;
          const f = this.arms!.lastForce.get(`${pl.id}:${side}`);
          arm[side] = {
            ph: o.phase,
            id: o.gripId ?? o.clampContactId,
            F: round(f?.actual ?? 0, 2),
            N: round(f?.normalActual ?? 0, 2),
            Ft: round(f?.tangentActual ?? 0, 2),
            palm: rv(o.palmContactWorld, 4),
            ok: o.poseValid ? 1 : 0,
          };
        }
        players[pl.id].arm = arm;
        players[pl.id].wrap = this.arms!.wrap.get(pl.id)?.status;
      }
    }
    const row: TraceRow = { tick: this.tick, t: round(this.t, 5), players };
    if (this.rules?.lastRow) row.rule = this.rules.lastRow;
    this.trace.push(row);
  }

  exportFixture(): Record<string, unknown> {
    const def = this.def;
    const bodyProfiles: Record<string, BodyProfile> = {};
    for (const p of def.players) bodyProfiles[p.body.id] = p.body;
    return {
      schemaVersion: SCHEMA_VERSION,
      fixtureId: def.id,
      gate: def.gate,
      milestone: def.milestone,
      title: def.title,
      notes: def.notes,
      engine: { name: '@dimforge/rapier3d-compat', version: rapierVersion() },
      profileIds: {
        body: Object.fromEntries(def.players.map((p) => [p.id, p.body.id])),
        motor: def.motor.id,
        solver: def.solver.id,
        stance: def.stance.id,
        arm: this.arms ? (def.armProfile ?? ARM_G2).id : undefined,
        balance: this.balanced ? this.balanceProfile.id : undefined,
        ragdoll: def.ragdoll?.id,
        rule: def.rules?.id,
        runClips: def.runClips?.id,
        support: this.supportProfile.id,
        footwork: def.footwork?.id,
        locomotion: def.locomotion?.id,
        carry: def.carry?.id,
        fallResponse: def.fallResponse?.id,
      },
      profiles: {
        body: bodyProfiles,
        motor: def.motor,
        solver: def.solver,
        stance: def.stance,
        arm: this.arms ? (def.armProfile ?? ARM_G2) : undefined,
        balance: this.balanced ? this.balanceProfile : undefined,
        ragdoll: def.ragdoll,
        rule: def.rules ? ruleProfileExport(def.rules) : undefined,
        runClips: def.runClips ? runClipProfileExport(def.runClips) : undefined,
        support: this.supportProfile,
        footwork: def.footwork,
        locomotion: def.locomotion,
        carry: def.carry,
        fallResponse: def.fallResponse,
        supportHeights: this.heightModels ?? undefined,
      },
      diagnostics: def.diagnostics,
      obstacles: def.obstacles,
      handoffs: Object.fromEntries(this.players.filter((p) => p.handoff).map((p) => [p.id, p.handoff])),
      ...(def.ragdoll?.envelope
        ? {
            fallEffort: Object.fromEntries(this.players.filter((p) => p.fall).map((p) => [p.id, this.fall!.report(p.fall!)])),
            jointLimits: Object.fromEntries(this.players.filter((p) => p.rag).map((p) => [p.id, this.limitReport(p)])),
          }
        : {}),
      ruleEnding: this.rules?.ending ?? null,
      stop: this.stop,
      timing: {
        outerTickS: def.solver.outerTickS,
        substeps: def.solver.substeps,
        physicsDtS: this.physics.dt,
        durationS: def.durationS,
        durationTicks: Math.round(def.durationS / def.solver.outerTickS),
        settleS: def.settleS,
      },
      area: def.area,
      players: def.players.map((p) => ({
        id: p.id,
        role: p.role,
        bodyProfileId: p.body.id,
        motorProfileId: (p.motor ?? def.motor).id,
        selectedShoulder: p.selectedShoulder,
        arms: p.arms,
        initial: p.initial,
        controller: this.byId.get(p.id)?.controller.exportParams(def.solver.outerTickS),
        measuredMass: this.byId.get(p.id)?.mass,
      })),
      randomSeed: null,
    };
  }

  /** Plan 09: measured limit error per joint since the handoff (native hinges and soft envelopes), with its mode. */
  limitReport(pl: PlayerRuntime): Record<string, unknown> {
    const rs = pl.ragStats;
    return {
      hinges: { mode: 'native', maxOverDeg: round(rs?.maxHingeOverDeg ?? 0, 3), overJoint: rs?.hingeOverJoint ?? null, maxReverseDeg: round(rs?.maxHingeReverseDeg ?? 0, 3), reverseJoint: rs?.hingeReverseJoint ?? null },
      envelope: {
        mode: this.def.ragdoll?.envelope?.mode ?? null,
        profile: this.def.ragdoll?.envelope?.id ?? null,
        joints: (pl.rag?.envelope ?? []).map((e) => ({
          joint: e.jointId,
          startOutsideDeg: round(e.startOutsideDeg, 3),
          maxOverDeg: round(e.maxOverDeg, 3),
          maxNominalOverDeg: round(e.maxNominalOverDeg, 3),
          maxOverRunS: round(e.maxOverRunS, 4),
          passivePositiveJ: round(e.passivePositiveJ, 4),
          passiveNegativeJ: round(e.passiveNegativeJ, 4),
        })),
      },
    };
  }

  summary(): Record<string, unknown> {
    return {
      fixtureId: this.def.id,
      result: this.result,
      ticks: this.tick,
      t: round(this.t, 4),
      minPairGap: Number.isFinite(this.minPairGap) ? round(this.minPairGap, 4) : null,
      events: this.events.filter((e) => e.type !== 'grounded').length,
      players: Object.fromEntries(
        this.players.map((pl) => {
          const b = this.coreBody(pl);
          const k = this.bulk(pl);
          return [pl.id, { p: rv(b.translation(), 3), v: rv(k.v, 3), speed: round(len(horiz(k.v)), 3), rep: pl.representation }];
        }),
      ),
    };
  }
}
