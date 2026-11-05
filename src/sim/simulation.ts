// Simulation: fixed time, players, events, reset and fixture lifecycle. One physical-state authority (Rapier via
// PhysicsWorld); controllers only read snapshots and emit intents; motors apply bounded forces once per substep.
import type {
  BalanceState, BodySnapshot, ControlMode, PlayerContactObs, PlayerId, PlayerIntent, Representation, SimEvent, Snapshot, ContactRec,
} from './contracts';
import { pairKey } from './contracts';
import type { Controller } from './controllers/base';
import { makeController } from './controllers/index';
import { observePlayerContacts, type ClassifyInput } from './contact';
import type { FixtureDef, PlayerSetup } from './fixture';
import { computeDrive, computeYaw } from './motors';
import { initPhysics, PhysicsWorld, RAPIER, RAPIER_VERSION, type MassReport, type ProxyBody } from './physics';
import { ARM_G2, BALANCE_G3, RAGDOLL_G4, SCHEMA_VERSION, type ArmProfile, type BalanceProfile, type BodyProfile, type MotorProfile, type RagdollProfile } from './profiles';
import { buildProxyPose, advanceGait, type GaitState, type PhysicalPose, type PoseClearance, type PoseMemory, type PoseShape } from './pose';
import {
  anchorErrors, buildCandidate, hingeAngles, bulkOf, externalFromColliders, externalFromRagdoll, ragdollPose, removeRagdoll, switchToRagdoll,
  validateCandidate, SEGMENTS, type CandidateEdit, type CandidateReport, type ExternalShape, type Ragdoll, type TransferAudit,
} from './ragdoll';
import {
  availableBalanceTorque, combineSupportTorque, computeBalanceTorque, desiredUpFrom, envelopeStep, leanScale, measureLean, postureGravityHold,
  projectedLean,
} from './balance';
import { ArmSystem, type ArmHost, type ArmHostPlayer, type WrapStatus } from './arms';
import {
  advanceRunPlayback, newRunPlayback, playbackArmMean, playbackLabel, sampleRunClip, playbackSample, retargetSample, runClipProfileExport, validateRunClipProfile, type RunPlayback,
} from './run-clip';
import { RuleObserver, ruleProfileExport, type EndingKind, type RetentionObs, type RuleEnding, type RuleTraceRow } from './rules';
import type { ArmSide } from './contracts';
import {
  type Vec3, v3, vc, rad, qFromYaw, isFiniteVec, round, rv, yawOf, horiz, len, type Quat, add, cross, norm, qFromAxisAngle, qMul,
  qRot, sub, forwardOf, upOf, dot, clamp, UP, deg, qInvRot, qFromUnitVectors, scale, addScaled,
} from './vec';

/**
 * Trial labels. Referee endings (rule observer) are distinct from non-success stops: duration (timeout), the
 * practice safety edge, numerical failure, an invalid (rejected) runner handoff, and an invalid transfer (a switched
 * player whose momentum/energy transfer audit failed: its physical evidence is invalid, so no referee completion).
 */
export type TrialResult = 'running' | 'duration' | 'practiceOutOfBounds' | 'numericalFailure' | 'invalidHandoff' | 'invalidTransfer' | EndingKind;

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
  /** Plan 06: run-clip playback (phase, weight) when the fixture has a run-clip profile; reset with the player. */
  run: RunPlayback | null;
  poseMemory: PoseMemory;
  /** Gate 4 handoff outcome (accepted with audits, or rejected with reasons). */
  handoff: HandoffRecord | null;
  /** Ragdoll running audits (max joint anchor separation, max floor penetration) since the handoff. */
  ragStats: RagStats | null;
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
  /** Gate 4: representation (absent = proxy), max joint anchor separation (m), hinge angles (deg). */
  rep?: Representation;
  jsep?: number;
  hinge?: Record<string, number>;
  /**
   * Plan 06 run-clip playback: clip (or blend) label, phase u (0 = left touchdown), applied weight w and its target wt,
   * playback rate r, clip blend b, solved travel speed v (m/s), sampled-request residuals (m) of the pose.
   */
  run?: { clip: string; u: number; w: number; wt: number; r: number; b: number; v: number; res: Record<string, number> };
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
  pairGap: Record<string, number> = {};
  pairClosest: Record<string, { gap: number; points: Record<PlayerId, Vec3> }> = {};
  private history: Snapshot[] = [];
  private episodes = new Map<string, { since: number; seen: Set<string> }>();
  private tickContactClasses: Record<PlayerId, Set<string>> = {};
  minPairGap = Infinity;
  /** Arm authority (Gate 2); null when no player has arms. */
  arms: ArmSystem | null = null;
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

  static async create(def: FixtureDef, opts: SimOptions = {}): Promise<Simulation> {
    await initPhysics();
    return new Simulation(def, opts);
  }

  constructor(readonly def: FixtureDef, readonly opts: SimOptions = {}) {
    if (def.runClips) validateRunClipProfile(def.runClips, def.ragdoll ?? DEFAULT_POSE_PROFILE);
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
    // Gate 4: same-owner self pairs never generate contact (owner identity, not a per-player collision bit).
    if (def.ragdoll) this.physics.setContactFilter((a, b) => !(a.playerId !== null && a.playerId === b.playerId));
    for (const o of def.obstacles ?? []) {
      const q = qFromYaw(rad(o.yawDeg ?? 0));
      const c = this.physics.world.createCollider(
        RAPIER.ColliderDesc.cuboid(o.halfExtents.x, o.halfExtents.y, o.halfExtents.z)
          .setTranslation(o.center.x, o.center.y + 0.5, o.center.z)
          .setRotation(q)
          .setFriction(def.solver.passiveFriction),
        this.physics.floorBody,
      );
      this.physics.tags.set(c.handle, { playerId: null, part: 'floor', region: 'floor', key: `obstacle:${o.id}` });
      this.obstacleColliders.push(c);
    }
    const order = this.opts.reverseOrder ? [...def.players].reverse() : [...def.players];
    for (const setup of order) {
      const motor = setup.motor ?? def.motor;
      const pose = {
        p: v3(setup.initial.x, setup.body.restOriginY, setup.initial.z),
        q: qFromYaw(rad(setup.initial.yawDeg)),
      };
      const proxy = this.physics.createProxy(setup.id, setup.body, def.stance, pose);
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
        run: def.runClips && setup.body.kind === 'upperBodyCompound' ? newRunPlayback(setup.initial.runPhase ?? (setup.role === 'runner' ? 0 : 0.25)) : null,
        poseMemory: {},
        handoff: null,
        ragStats: null,
      };
      proxy.body.userData = { playerId: setup.id, segment: 'proxy' };
      const supLocal = sub(vc(proxy.support.translation()), pose.p);
      const hc = sub(qRot({ x: -pose.q.x, y: -pose.q.y, z: -pose.q.z, w: pose.q.w }, supLocal), v3(0, proxy.supportShape.halfHeight, 0));
      pl.balance.leverM = len(sub(pl.mass.localCom, hc));
      this.players.push(pl);
      this.byId.set(pl.id, pl);
    }
    // Passive settling (no application forces), then the reset-time initial state.
    const settleSteps = Math.round(def.settleS / this.physics.dt);
    for (let i = 0; i < settleSteps; i++) this.physics.step();
    for (const pl of this.players) {
      const ini = pl.setup.initial;
      const b = pl.proxy.body;
      if (ini.lift) {
        const p = b.translation();
        b.setTranslation({ x: p.x, y: p.y + ini.lift, z: p.z }, true);
      }
      if (ini.leanDeg) this.applyInitialLean(pl, ini.leanDeg, ini.leanDirWorld);
      b.setLinvel(ini.velocity ? vc(ini.velocity) : v3(), true);
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
    if (def.players.some((p) => p.arms)) {
      checkLimbContract(def.armProfile ?? ARM_G2, def.ragdoll ?? DEFAULT_POSE_PROFILE);
      this.arms = new ArmSystem(this.armHost(), def.armProfile ?? ARM_G2, this.balanced ? this.balanceProfile.fallingArmBudgetFraction : 1, def.ragdoll?.passiveGrip);
    }
    this.rules = def.rules ? new RuleObserver(def.rules, def.ragdoll ?? DEFAULT_POSE_PROFILE, (type, id, data) => this.emit(type, id, data)) : null;
    this.settleUntil = null;
    this.postStep(true);
    if (this.balanced) this.evaluateBalance(true);
    this.updatePoses(0);
    if (this.opts.trace !== false) this.recordTrace();
  }

  /** Tilt a settled body by `leanDeg` toward `dir`, rotating about its support hemisphere so floor contact stays. */
  private applyInitialLean(pl: PlayerRuntime, leanDeg: number, dir?: Vec3): void {
    const b = pl.proxy.body;
    const q0 = { ...b.rotation() };
    const p0 = vc(b.translation());
    const d = norm(horiz(dir ?? forwardOf(q0)), v3(0, 0, 1));
    const axis = norm(cross(UP, d));
    const q = qMul(qFromAxisAngle(axis, rad(leanDeg)), q0);
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
    this.pairGap = {};
    this.pairClosest = {};
    this.history = [];
    this.episodes.clear();
    this.minPairGap = Infinity;
    this.arms = null;
    this.diagDone.clear();
    this.obstacleColliders = [];
    this.rules = null;
    this.settleUntil = null;
    this.invalidTransfer = null;
    this.build();
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
        return sim.tick;
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
    this.tickContactClasses = {};
    for (let s = 0; s < this.def.solver.substeps; s++) {
      this.stepSubstep(s);
      if (this.result === 'numericalFailure') break;
    }
    this.tick++;
    if (this.opts.trace !== false) this.recordTrace();
    this.checkStop();
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
        if (d.playerId === pl.id && !this.diagDone.has(i) && this.t >= d.atS - 1e-9) {
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
        // Support capabilities stop: traction returns to passive Coulomb friction on the same proxy.
        this.physics.setSupportFriction(pl.proxy.support, false);
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
      if (this.steps % every === 0) {
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
      }
    }
    // 4. clear application-owned force/torque accumulators (once, before any contribution)
    for (const pl of this.players)
      for (const b of this.activeBodies(pl)) {
        b.resetForces(true);
        b.resetTorques(true);
      }
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
      const drive = computeDrive(pl.intent.locomotion, b.linearVelocity, b.massKg, pl.motor, supported, ls);
      const yaw = computeYaw(pl.intent.locomotion, b.rotation, b.angularVelocity.y, pl.motor, supported);
      if (drive.cap > 0) pl.proxy.body.addForce(drive.force, true);
      let balReq = v3();
      let balCapped = v3();
      let balCap = 0;
      let balSat = false;
      let support = v3(0, yaw.cap > 0 ? yaw.torqueY : 0, 0);
      let supportScale = 1;
      if (this.balanced) {
        if (supported) {
          balCap = availableBalanceTorque(B, b.massKg, this.def.solver.gravityY, pl.body.supportRadiusM);
          const hold = postureGravityHold(bal.desiredUp, b.massKg, this.def.solver.gravityY, bal.leverM);
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
    // 6. arms: collision-aware reach, acquisitions, retention demands, shared budget, reciprocal forces (once)
    this.arms?.preStep();
    // 7. solve
    this.physics.step();
    this.steps++;
    // 8. read solved state; 9-10. reconstruct arms against solved roots, release failures, classify wraps
    this.postStep(false);
    this.arms?.postStep();
    // 9. lean / recovery envelope; loss is queued for the next controlled boundary
    if (this.balanced) this.evaluateBalance();
    // 10. sim-owned physical pose from the solved state (presentation, next handoff candidate, rule queries)
    this.updatePoses(this.physics.dt);
    // 11. rule observer (observation only)
    if (this.rules && this.result === 'running') this.observeRules();
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
      tick: this.tick,
      substep: this.steps,
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
          substep: this.steps,
        });
      }
    }
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
    // numerical health
    for (const pl of this.players) {
      for (const b of this.activeBodies(pl)) {
        if (!isFiniteVec(b.translation()) || !isFiniteVec(b.linvel()) || !isFiniteVec(b.angvel())) {
          this.result = 'numericalFailure';
          this.emit('numericalFailure', pl.id, {});
          return;
        }
      }
    }
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
        this.emit('trialEnd', undefined, { reason: end.kind, eventT: end.t, settledS: round(this.t - end.t, 5) });
      }
      return;
    }
    const area = this.def.area;
    for (const pl of this.players) {
      const c = this.bulk(pl).com;
      if (Math.abs(c.x) > area.halfX || Math.abs(c.z) > area.halfZ) {
        this.result = this.invalidTransfer ? 'invalidTransfer' : 'practiceOutOfBounds';
        this.emit('practiceOutOfBounds', pl.id, { com: rv(c) });
        return;
      }
    }
    if (this.t >= this.def.durationS - 1e-9) {
      this.result = this.invalidTransfer ? 'invalidTransfer' : this.rules?.disabledReason === 'invalidHandoff' ? 'invalidHandoff' : 'duration';
      this.emit('trialEnd', undefined, { reason: this.result });
    }
  }

  emit(type: string, playerId: PlayerId | undefined, data: Record<string, unknown>): void {
    this.events.push({ tick: this.tick, substep: this.steps, t: round(this.t, 5), type, playerId, data });
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
      }
    }
  }

  // ------------------------------------------------------------------ Gate 4: sim-owned physical pose
  private updatePoses(dt: number): void {
    const R = this.def.ragdoll;
    for (const pl of this.players) {
      if (pl.rag) {
        pl.pose = ragdollPose(pl.rag);
        continue;
      }
      if (pl.body.kind !== 'upperBodyCompound') {
        pl.pose = null;
        continue;
      }
      const b = pl.proxy.body;
      const v = vc(b.linvel());
      const sp = len(horiz(v));
      if (dt > 0 && pl.grounded && pl.controlMode === 'supported') advanceGait(pl.gait, sp, dt);
      const core = this.poseOf(pl);
      const localV = qInvRot(core.q, v3(v.x, 0, v.z));
      const RP = R ?? DEFAULT_POSE_PROFILE;
      // plan 06: run-clip playback from solved travel (once per substep); the procedural gait is the bounded fallback
      let sampled: ReturnType<typeof retargetSample> | undefined;
      const P = this.def.runClips;
      if (pl.run && P) {
        const st = pl.run;
        // while the clip is off its phase follows the procedural gait (and the gait follows the clip while it plays)
        if (st.w <= 0 && dt > 0) st.u = (((pl.gait.phase / (2 * Math.PI)) % 1) + 1) % 1;
        advanceRunPlayback(st, P, {
          coreP: core.p,
          forward: forwardOf(core.q),
          supported: pl.grounded && pl.controlMode === 'supported',
          dt,
          initSpeed: sp,
          initDir: v,
          legM: RP.lengths.thigh + RP.lengths.shin,
        });
        if (st.w > 0) pl.gait.phase = 2 * Math.PI * st.u;
        // the sampled request is built at every weight (0 = the procedural targets through the same continuous leg
        // solve), so the clip fades in and out without a solver switch
        if (!pl.rag) {
          sampled = retargetSample(playbackSample(st, P) ?? sampleRunClip(P.clips[st.k], st.u), st.w, pl.body, RP, core, st.heading, {
            armSwing: P.armSwing,
            carrySwing: P.carrySwing,
            restToe: P.clips[st.k].restToe,
            armMean: playbackArmMean(st, P),
          });
        }
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
      pl.pose = buildProxyPose({
        playerId: pl.id,
        body: pl.body,
        ragdoll: RP,
        pose: core,
        gait: pl.gait,
        speed: pl.grounded && pl.controlMode === 'supported' ? sp : 0,
        arms,
        readyHands: !!pl.intent.debug?.readyHands,
        carriesBall: pl.setup.role === 'runner',
        localVelDir: sp > 0.2 ? v3(localV.x / sp, 0, localV.z / sp) : v3(0, 0, 1),
        clearance: R ? this.poseClearance(pl) : undefined,
        memory: pl.poseMemory,
        sampled,
      });
    }
  }

  /**
   * Supported-state limb constraints for the procedural pose: penetration of candidate limb shapes against other
   * players' active colliders, diagnostic obstacles and opponents' achieved query-arm segments (external), and of
   * forearm/palm against the player's own torso/pelvis (self).
   */
  private poseClearance(pl: PlayerRuntime): PoseClearance {
    const ext: ExternalShape[] = [];
    const soft: ExternalShape[] = [];
    for (const o of this.players) {
      if (o === pl) continue;
      ext.push(...externalFromColliders(this.activeColliders(o), () => o.id));
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
    return { external: (shapes) => depth(shapes, ext), soft: (shapes) => depth(shapes, soft), self: (shapes) => depth(shapes, own) };
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
      engine: { name: '@dimforge/rapier3d-compat', version: RAPIER_VERSION },
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
      },
      diagnostics: def.diagnostics,
      obstacles: def.obstacles,
      handoffs: Object.fromEntries(this.players.filter((p) => p.handoff).map((p) => [p.id, p.handoff])),
      ruleEnding: this.rules?.ending ?? null,
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
