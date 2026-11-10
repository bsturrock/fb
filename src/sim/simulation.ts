// Simulation: fixed time, players, events, reset and fixture lifecycle. One physical-state authority (Rapier via
// PhysicsWorld); controllers only read snapshots and emit intents; motors apply bounded forces once per substep.
import type {
  BalanceState, BodySnapshot, ControlMode, PlayerContactObs, PlayerId, PlayerIntent, Representation, SegmentId, SimEvent, Snapshot, ContactRec,
} from './contracts';
import type { Controller } from './controllers/base';
import { makeController } from './controllers/index';
import type { FixtureDef, PlayerSetup } from './fixture';
import { cullGeom, FLOOR_HALF_M, geomNear, initPhysics, PhysicsWorld, RAPIER, type MassReport, type ProxyBody } from './physics';
import {
  ARM_G2, BALANCE_G3, DEFAULT_POSE_PROFILE, SUPPORT_LEGACY, hipLocal, sideSignX, validateMotorBraking, withJointRange, type ArmProfile, type BalanceProfile, type BodyProfile, type MotorProfile, type RagdollProfile,
  type SupportProfile, type SuspensionSupport,
} from './profiles';
import {
  clipHeightModel, composeTarget, newSuspensionRuntime, runHeight, type ClipHeightModel, type RunHeight,
  type HeightCalibration, type SuspensionRuntime,
} from './support';
import { advanceGait, type GaitState, type PhysicalPose, type PoseClearance, type PoseMemory, type ProxyPoseInput } from './pose';
import { advanceIdle, advanceLoco, IDLE_POSE_RECORD, idlePhase, idleTarget, newLocoState, sampleIdle, type LocoState } from './locomotion';
import { type SimDebug } from './debug';
import { clipJoin, newFootPlan, type FootPlan, type FootPlanInput } from './footwork';
import {
  applyEnvelope, auditEnvelope, bulkOf, easeLimpFeet, limitGradients, SEGMENTS, SELF_ARM_KEY, SELF_TRUNK_KEY, type CandidateEdit, type CandidateReport, type ExternalShape, type Ragdoll,
  type RagdollCollider, type TransferAudit,
} from './ragdoll';
import {
  envelopeStep, measureLean, projectedLean,
} from './balance';
import { ArmSystem, type ArmHost, type ArmHostPlayer, type WrapStatus } from './arms';
import { FallResponse, type ArmTask, type BraceState, type FallEpisode } from './fall-response';
import {
  advanceRunPlayback, followClipWeight, joinPhase, newRunPlayback, retargetSample, validateRunClipProfile, type RunPlayback,
} from './run-clip';
import { RuleObserver, type EndingKind, type RuleEnding, type RuleTraceRow } from './rules';
import type { ArmSide } from './contracts';
import { type Pose, type Vec3, v3, vc, rad, qFromYaw, isFiniteVec, round, rv, horiz, len, type Quat, add, cross, norm, qFromAxisAngle, qMul, qRot, sub, forwardOf, dot, clamp, UP, deg, scale, toWorld, clampLen, neg } from './vec';
import { fixtureExport, limitReportOf, recordTrace, summaryOf } from './sim-evidence';
import { auditPlayback } from './transition-audit';
import type { AuditPrev, TransitionDelta } from './transition-audit';
import { observeRules } from './rule-wiring';
import { applySupport, prepDropM, supportTargets, updateProbes } from './support-runtime';
import { convertPlayers } from './conversion';
import { observeContacts } from './contact-observation';
import { carrySideOf, footInputOf, poseClearanceOf, publishedLimbs, sampledLimbsOf, updatePoses } from './pose-runtime';
import { EMPTY_APPLIED, applyMotors } from './motor-step';
export type { AuditLeg, TransitionDelta } from './transition-audit';

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
  /**
   * Plan 13e: the idle cycle's hips sway this substep (world, horizontal, m/s), added to the drive's request only: the
   * referee, the braking stance and the clip playback read the controller's request.
   */
  sway?: Vec3;
  /**
   * Plan 13e: the body's intended sway displacement (world, horizontal, m): the sway request integrated while it plays,
   * unwound at IDLE_SWAY_UNWIND_MPS once it stops. The foot planner's home is taken without it, so the sway is not read
   * as creep (the feet stay; the legs follow the body).
   */
  swayM?: Vec3;
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
  /** Bulk vertical velocity before the last solve (RH-F7 extremum conversions: [prevVy, lastVy] spans the last solve). */
  prevVy: number;
  /** Bulk vertical velocity after the last solve (diagnostic `when` conversions). */
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
  run?: { clip: string; u: number; w: number; wt: number; r: number; b: number; v: number; s?: number; res: Record<string, number> };
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
  /**
   * Plan 10c (C7): keep the per-substep arm force, arm effort and joint effort ledgers (default `SIM_DEFAULTS.ledgers`).
   * Off, nothing is pushed, so a long lab session does not grow them; the running totals stay in the stats either way.
   */
  ledgers?: boolean;
  /**
   * Plan 10f (F2): debug switches for this simulation only (footwork and pose A/B switches, read-only pose diagnostics).
   * Every switch that is on is recorded in the export (`debug`); the diagnostics are not.
   */
  debug?: SimDebug;
}

/**
 * Process-wide option defaults. Ledgers are off (the lab); the test setup turns them on for every test file, so a test
 * reading a ledger never reads an empty one by omission.
 */
export const SIM_DEFAULTS: { ledgers: boolean } = { ledgers: false };

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


/**
 * One limb geometry contract: the arm queries (ArmSystem), the physical pose, candidate bodies and ground-region
 * classification all read the same lengths and radii. A fixture pairing an arm profile with a ragdoll/pose profile of
 * different geometry is rejected at construction.
 */
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

/**
 * Plan 12: how near (m) another player a limp shoe may turn toward (Simulation.shoeDeeper). 2 cm left D's thigh in
 * L3-F9-noProbe-contact 1.5 cm inside R's turned shoe at D's conversion, 5 cm D's thigh in HC-F3-phase75 2.3 cm (both
 * rejected, D left a rigid falling proxy).
 */
const LIMP_SHOE_CLEARANCE_M = 0.08;
/** Plan 13e: how fast the sway displacement the foot planner's home leaves out unwinds once the sway stops (m/s). */
const IDLE_SWAY_UNWIND_MPS = 0.05;

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
  auditPrev = new Map<PlayerId, AuditPrev>();
  /** Plan 08 audit: the achieved landmarks of the last two substeps in the body frame. */
  auditHist = new Map<PlayerId, Record<string, Vec3>[]>();
  auditRun = new Map<PlayerId, RunPlayback>();
  pairGap: Record<string, number> = {};
  pairClosest: Record<string, { gap: number; points: Record<PlayerId, Vec3> }> = {};
  private history: Snapshot[] = [];
  episodes = new Map<string, { since: number; seen: Set<string> }>();
  tickContactClasses: Record<PlayerId, Set<string>> = {};
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
  settleUntil: number | null = null;
  /** First failed transfer audit (review finding 2): the trial ends labelled invalidTransfer, never a completion. */
  invalidTransfer: { playerId: PlayerId; reasons: string[]; t: number } | null = null;
  /** Plan 06a: static colliders the suspension probe may hit (turf, obstacles), and which of them are turf. */
  probeTargets: RAPIER.Collider[] = [];
  turf = new Set<number>();
  /** Plan 06a: clip pelvis-height models (shared by the players; null without suspension and run clips). */
  heightModels: ClipHeightModel[] | null = null;

  static async create(def: FixtureDef, opts: SimOptions = {}): Promise<Simulation> {
    await initPhysics();
    // plan 12: under a joint-range profile the ragdoll's shoulder envelope is the profile's (recorded as such)
    return new Simulation(def.jointRange && def.ragdoll ? { ...def, ragdoll: withJointRange(def.ragdoll, def.jointRange) } : def, opts);
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
    // plan 14: the floor covers the practice area with 10 m to spare (40 m for every area up to 30 m)
    this.physics = new PhysicsWorld(def.solver, Math.max(FLOOR_HALF_M, def.area.halfX + 10, def.area.halfZ + 10));
    const S = this.suspension;
    // Gate 4: same-owner self pairs never generate contact (owner identity, not a per-player collision bit). Plan 06a:
    // a suspension guard ball touches static ground only (never a player collider).
    if (def.ragdoll || S) {
      const sameOwner = !!def.ragdoll;
      this.physics.setContactFilter((a, b) => {
        // arm self-clearance colliders (ragdoll): a forearm's self shape meets its own trunk piece, and nothing else
        const ta = a.key.startsWith(SELF_TRUNK_KEY);
        const tb = b.key.startsWith(SELF_TRUNK_KEY);
        if (ta || tb || a.key.startsWith(SELF_ARM_KEY) || b.key.startsWith(SELF_ARM_KEY))
          return a.playerId !== null && a.playerId === b.playerId && ta !== tb && (ta ? b : a).key.startsWith(SELF_ARM_KEY);
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
    if (S) updateProbes(this, true);
    for (let i = 0; i < settleSteps; i++) {
      if (S)
        for (const pl of this.players) {
          pl.proxy.body.resetForces(true);
          pl.proxy.body.resetTorques(true);
          applySupport(this, pl, S, this.physics.dt, true);
        }
      this.physics.step();
      if (S) updateProbes(this, false);
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
      this.arms = new ArmSystem(this.armHost(), def.armProfile ?? ARM_G2, this.balanced ? this.balanceProfile.fallingArmBudgetFraction : 1, def.ragdoll?.passiveGrip, def.selfClearance, def.jointRange);
    }
    if (def.fallResponse) {
      const sim = this;
      if (!def.ragdoll?.envelope?.hip) throw new Error(`fixture ${def.id}: a fall response needs a ragdoll profile with a shoulder and hip envelope`);
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
        selfImpulses: (rag) => sim.selfImpulses(rag),
      });
      if (this.arms) this.arms.holdMemoryS = def.fallResponse.arms.holdMemoryS;
    }
    const keep = this.opts.ledgers ?? SIM_DEFAULTS.ledgers;
    if (this.arms) this.arms.keepLedger = keep;
    if (this.fall) this.fall.keepLedger = keep;
    this.rules = def.rules ? new RuleObserver(def.rules, def.ragdoll ?? DEFAULT_POSE_PROFILE, (type, id, data) => this.emit(type, id, data)) : null;
    this.settleUntil = null;
    observeContacts(this, true);
    if (this.balanced) this.evaluateBalance(true);
    if (S) for (const pl of this.players) this.advanceLocomotion(pl, 0);
    updatePoses(this, 0);
    for (const pl of this.players) pl.prevVy = pl.lastVy = this.bulk(pl).v.y;
    if (this.opts.trace !== false) recordTrace(this);
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
    if (this.opts.trace !== false) recordTrace(this);
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
      // brake with its finite motor and keep upright support; physics settles passively. Plan 10e E1 (rules revision 2,
      // U9): the player keeps its stance request (ride height and stagger) and its yaw effort, which are how it stands
      // and turns, not tackle actions; the historical profile returns it to the profile's standing height.
      if (this.rules?.ending) {
        const f = this.coreBody(pl);
        const was = pl.intent.locomotion;
        const keep = this.rules.profile.revision === 2 ? { ...(was.yawEffort !== undefined ? { yawEffort: was.yawEffort } : {}), ...(was.stance ? { stance: { ...was.stance } } : {}) } : {};
        pl.intent = { locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: norm(horiz(forwardOf(f.rotation())), v3(0, 0, 1)), effort: 1, ...keep } };
        decided = true;
      }
      // plan 10b: the ramp reads this substep's locomotion mode (decided from the last solve's contacts and motion, which
      // nothing changes before 4b), not the previous substep's
      if (this.suspension && !pl.rag && pl.sus) this.advanceLocoMode(pl, this.physics.dt);
      this.rampWalkRequest(pl, decided);
      this.idleSway(pl);
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
        this.advanceLocomotion(pl, this.physics.dt);
        supportTargets(this, pl, S, this.physics.dt);
        applySupport(this, pl, S, this.physics.dt, false);
      }
    this.applyDiagnosticForces();
    // 5. bounded motors: drive, yaw and (balanced profile) finite upright support torque from the same snapshot
    applyMotors(this, snap);
    // 5b. plan 09: passive soft envelopes of every ragdoll, then this substep's effort proposals (accepted ragdolls only)
    let limbsNow: Map<PlayerId, ExternalShape[]> | null = null;
    const limbs = (): Map<PlayerId, ExternalShape[]> => (limbsNow ??= publishedLimbs(this));
    for (const pl of this.players) {
      if (pl.rag) {
        // plan 12: the limp shoe eases toward its relaxed pitch on the shin before the envelope reads the joints
        if (pl.rag.limpFoot) easeLimpFeet(pl.rag, this.physics.dt, (c, from, to) => this.shoeDeeper(pl, c, from, to, limbs()));
        applyEnvelope(pl.rag, this.physics.dt);
      }
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
    observeContacts(this, false);
    this.arms?.postStep();
    // 9. lean / recovery envelope; loss is queued for the next controlled boundary
    if (this.balanced) this.evaluateBalance();
    // 10. sim-owned physical pose from the solved state (presentation, next handoff candidate, rule queries)
    updatePoses(this, this.physics.dt);
    // 11. rule observer (observation only)
    if (this.rules && this.result === 'running') observeRules(this);
    for (const pl of this.players) {
      pl.prevVy = pl.lastVy;
      pl.lastVy = this.bulk(pl).v.y;
    }
    this.opts.onSubstep?.(this);
  }


  /** Plan 08: the bounded height drop preparation requests (m), continuous with its weight; 0 without a locomotion profile. */
  prepDrop(pl: PlayerRuntime): number {
    return prepDropM(this, pl);
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
    // plan 13e: the idle weight from this substep's mode, support and solved travel
    if (P.idle.cycle) advanceIdle(st, P, idleTarget(len(horiz(v)), st.mode === 'free' && pl.grounded && pl.controlMode === 'supported'), dt);
  }

  /**
   * Plan 13e: this player's idle phase (0..1) now, from simulation time and its index in the fixture's player list (not
   * the body order: a reversed order keeps every player's phase).
   */
  idlePhaseOf(pl: PlayerRuntime): number {
    return idlePhase(this.def.locomotion!.idle.cycle!, this.t, this.def.players.findIndex((p) => p.id === pl.id));
  }

  /**
   * Plan 13e: the idle cycle's weight sway as a velocity request. While the idle weight is above 0 and the player's own
   * request is zero, the drive gains the time derivative of the cycle's hips offset (leg-scaled, in the body's heading
   * frame), scaled by the idle weight: the motor moves the body, the planted feet stay where they are.
   */
  private idleSway(pl: PlayerRuntime): void {
    pl.sway = undefined;
    const P = this.def.locomotion;
    const C = P?.idle.cycle;
    if (!C || !P.idle.sway) return;
    const dt = this.physics.dt;
    const w = pl.loco?.idleW ?? 0;
    // (after a referee ending the physics settles passively: no sway either)
    if (pl.rag || this.rules?.ending || !(w > 0) || len(horiz(pl.intent.locomotion.desiredVelocityWorld)) > 0) {
      if (pl.swayM) pl.swayM = clampLen(pl.swayM, Math.max(0, len(pl.swayM) - IDLE_SWAY_UNWIND_MPS * dt));
      return;
    }
    const r = sampleIdle(C, this.idlePhaseOf(pl)).hipsV;
    const f = norm(horiz(forwardOf(this.coreBody(pl).rotation())), v3(0, 0, 1));
    const k = w * IDLE_POSE_RECORD.stance.legScale;
    // the clip's x is anatomical left; the body's left is on its own +X sign
    const lx = sideSignX(pl.body, 'left') * r.x * k;
    pl.sway = v3(lx * f.z + r.z * k * f.x, 0, -lx * f.x + r.z * k * f.z);
    pl.swayM = add(pl.swayM ?? v3(), scale(pl.sway, dt));
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

  /**
   * Locomotion phase from solved travel: the procedural gait and the run-clip playback (once per substep; dt 0 =
   * initialization). Legacy support: called by pose generation after the solve (plan 06 order). Suspension: called
   * before the support force (plan 06a order); pose generation then only reads the phase.
   */
  advanceLocomotion(pl: PlayerRuntime, dt: number): void {
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
    if (this.opts.transitionAudit) auditPlayback(this, pl, st, P, input, dt);
    advanceRunPlayback(st, P, input);
    if (pl.feet?.profile.compose) followClipWeight(st, dt, this.def.locomotion!.contact.clipWeightRadPerS);
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
   * Plan 12 limp foot: true when a ragdoll shoe turned from `from` to `to` (world poses) would come closer to another
   * player, inside `LIMP_SHOE_CLEARANCE_M`: its active colliders, or the published limbs of a player that can still convert
   * (they become its ragdoll at the switch, and its pose cannot always move a thigh out of the way). The floor and
   * obstacles are not counted.
   */
  shoeDeeper(pl: PlayerRuntime, c: RagdollCollider, from: Pose, to: Pose, limbs: Map<PlayerId, ExternalShape[]>): boolean {
    const shape = c.collider.shape;
    const M = LIMP_SHOE_CLEARANCE_M;
    // plan 13a: beyond the prediction the query returns nothing (the gap reads M), so the pair is not queried
    const gap = (at: Pose, e: { shape: RAPIER.Shape; pose: Pose }): number =>
      geomNear(cullGeom(e.shape, e.pose.p, e.pose.q), cullGeom(shape, at.p, at.q), M) ? (e.shape.contactShape(e.pose.p, e.pose.q, shape, at.p, at.q, M)?.distance ?? M) : M;
    for (const o of this.players) {
      if (o === pl) continue;
      const ext: { shape: RAPIER.Shape; pose: Pose }[] = this.activeColliders(o).map((k) => ({ shape: k.shape, pose: { p: vc(k.translation()), q: { ...k.rotation() } } }));
      if (!o.rag && !o.handoff) ext.push(...(limbs.get(o.id) ?? []));
      for (const e of ext) {
        const g = gap(to, e);
        if (g < M && g < gap(from, e) - 1e-6) return true;
      }
    }
    return false;
  }

  /**
   * Plan 09 impact guard: per segment of a ragdoll, the fastest closing speed of a contact its geometry meets within
   * `lookaheadS` (floor, obstacles, other players' active colliders), read before the solve. Observation only.
   */
  closingSpeeds(rag: Ragdoll, lookaheadS: number, predictionM: number, skinM: number): Partial<Record<SegmentId, number>> {
    const out: Partial<Record<SegmentId, number>> = {};
    const others: RAPIER.Collider[] = [this.physics.floorCollider, ...this.obstacleColliders];
    for (const o of this.players) if (o.id !== rag.playerId) others.push(...this.activeColliders(o));
    // plan 13a: a pair farther apart than the prediction returns nothing, so it is not queried; the query runs between the
    // colliders themselves (no shape conversion)
    const geoms = others.map((c) => cullGeom(c.shape, c.translation(), c.rotation()));
    for (const rc of rag.colliders) {
      const own = rc.collider;
      const body = rag.bodies[rc.segment];
      const og = cullGeom(own.shape, own.translation(), own.rotation());
      for (let i = 0; i < others.length; i++) {
        const c = others[i];
        if (!geomNear(geoms[i], og, predictionM)) continue;
        const r = c.contactCollider(own, predictionM);
        if (!r) continue;
        const other = c.parent();
        const vRel = sub(vc(body.velocityAtPoint(r.point2)), other ? vc(other.velocityAtPoint(r.point1)) : v3());
        const closing = -dot(vRel, vc(r.normal1));
        if (closing > 0 && r.distance - closing * lookaheadS < skinM) out[rc.segment] = Math.max(out[rc.segment] ?? 0, closing);
      }
    }
    // plan 11: a forearm's self shapes closing on the player's own trunk pieces
    if (rag.self) {
      const core = rag.bodies.core;
      for (const rc of rag.self.arms) {
        const body = rag.bodies[rc.segment];
        const ag = cullGeom(rc.collider.shape, rc.collider.translation(), rc.collider.rotation());
        for (const t of rag.self.trunk) {
          if (!geomNear(cullGeom(t.shape, t.translation(), t.rotation()), ag, predictionM)) continue;
          const r = t.contactCollider(rc.collider, predictionM);
          if (!r) continue;
          const vRel = sub(vc(body.velocityAtPoint(r.point2)), vc(core.velocityAtPoint(r.point1)));
          const closing = -dot(vRel, vc(r.normal1));
          if (closing > 0 && r.distance - closing * lookaheadS < skinM) out[rc.segment] = Math.max(out[rc.segment] ?? 0, closing);
        }
      }
    }
    return out;
  }

  /** Plan 11: per forearm of a ragdoll, the summed impulse of its self shapes on its own trunk in the last solve. */
  selfImpulses(rag: Ragdoll): Partial<Record<SegmentId, number>> {
    const out: Partial<Record<SegmentId, number>> = {};
    if (!rag.self) return out;
    const W = this.physics.world;
    for (const rc of rag.self.arms)
      for (const t of rag.self.trunk)
        W.contactPair(rc.collider, t, (m) => {
          for (let i = 0; i < m.numContacts(); i++) out[rc.segment] = (out[rc.segment] ?? 0) + m.contactImpulse(i);
        });
    return out;
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

  /** The clip's limb requests of a playback at the solved root. */
  sampledLimbs(pl: PlayerRuntime, st: RunPlayback, core: ProxyPoseInput['pose']): ReturnType<typeof retargetSample> {
    return sampledLimbsOf(this, pl, st, core);
  }

  /**
   * Plan 10c C2: the arm the ball is actually on: the ragdoll's carried-ball segment (the 08a seat), else the pose's
   * carry arm of a ball carrier (`carriesBall`); null for a player without the ball.
   */
  carrySide(pl: PlayerRuntime): ArmSide | null {
    return carrySideOf(pl);
  }

  // Plan 10f (F9): the three seams below stay methods, called through the simulation, so that tests and the cited probes
  // can wrap them as they did before the split (`transitions-modes`, `p07-*`, `p07a-baseline`, `l1-carry`).

  /** Foot planner input from the solved state, the support probe and control mode, and the pose path's requests. */
  footInput(pl: PlayerRuntime, inp: ProxyPoseInput, sampled: ProxyPoseInput['sampled'], dt: number): FootPlanInput {
    return footInputOf(this, pl, inp, sampled, dt);
  }

  /** Supported-state limb constraints for the procedural pose (`poseClearanceOf`). */
  poseClearance(pl: PlayerRuntime, limbs?: Map<PlayerId, ExternalShape[]>): PoseClearance {
    return poseClearanceOf(this, pl, limbs);
  }

  /** One boundary operation for every player converting now (`convertPlayers`). */
  convertBatch(list: { pl: PlayerRuntime; reason: HandoffRecord['reason']; edit?: CandidateEdit }[]): void {
    convertPlayers(this, list);
  }

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

  exportFixture(): Record<string, unknown> {
    return fixtureExport(this);
  }

  /** Plan 09: measured limit error per joint since the handoff (native hinges and soft envelopes), with its mode. */
  limitReport(pl: PlayerRuntime): Record<string, unknown> {
    return limitReportOf(this, pl);
  }

  summary(): Record<string, unknown> {
    return summaryOf(this);
  }
}
