// Plan 09 active fall response: bounded internal joint effort on an accepted ragdoll. Each substep it reads the actual
// bodies, picks per-arm tasks by role and retained holds, and proposes torque pairs; the arm allocator scales arm torque
// with grasp tension, then power and work caps apply before the solve. It adds no external force, floor anchor, velocity
// correction or body rotation: finite torque and real contact decide what happens, and a miss stays a miss.
import type { ArmEffortDemand, ArmSystem } from './arms';
import { isGround, type ArmSide, type ContactRec, type PlayerId, type Role, type SegmentId } from './contracts';
import type { FallResponseProfile, JointEnvelope } from './profiles';
import { twoBone } from './pose';
import { clampDirToEnvelope, hingeAngles, hingeAxisWorld, landmarkWorld, limbDirWorld, relativeOmega, type Ragdoll, type RagdollJoint } from './ragdoll';
import { add, addScaled, clamp, clampLen, cross, dist, dot, horiz, len, norm, qFromAxisAngle, qInvRot, qRot, rad, rotateToward, round, rv, scale, smooth, sub, v3, vc, type Quat, type Vec3 } from './vec';

export type ArmTask = 'passive' | 'protect' | 'hold' | 'brace';
export type BraceState = 'none' | 'seek' | 'contact' | 'missed';
export type BraceMissReason = 'tooFar' | 'late' | 'obstructed' | 'expired';

const SIDES: ArmSide[] = ['left', 'right'];
/** Brace reach: the two-bone solve stops this far short of the straight arm (m), so the elbow keeps a bend to aim. */
const BRACE_REACH_MARGIN_M = 1e-3;
/** Brace reach: the elbow pole in the core frame, outward (times the side sign) and backward. */
const BRACE_POLE_OUT = 0.6;
const BRACE_POLE_BACK = -1;
/** Power cap: bisection steps for the shared effort scale (2^-14 of full effort). */
const POWER_SCALE_BISECTIONS = 14;

interface ArmState {
  side: ArmSide;
  task: ArmTask;
  brace: BraceState;
  /** Achieved pose this task holds or yields around (core frame, hinge rad). */
  refDirCore: Vec3;
  refElbowRad: number;
  /** Rate-limited brace target, which starts at the achieved pose. */
  targetDirCore: Vec3;
  targetElbowRad: number;
  reachable: boolean;
  everReachable: boolean;
  /**
   * Plan 10c C4: when a seeking brace last touched an opponent or an obstacle with its forearm or palm (s), never a hold
   * the arm system retains; null: never. A miss within the brace's shortest prediction horizon of it is `obstructed`.
   */
  obstructedAtS: number | null;
}

interface JointCmd {
  joint: RagdollJoint;
  /** Proposed torque on the child (world, N m), the parent takes its negative. */
  torque: Vec3;
  requestedNm: number;
  capNm: number;
  /** Relative angular velocity before the solve. */
  wPre: Vec3;
  /** Rough inertia about the joint: predicts how far this substep's torque raises the joint speed. */
  inertia: number;
  arm?: ArmSide;
  task?: ArmTask;
}

/** One actuated joint in one substep. */
export interface JointEffortEntry {
  t: number;
  step: number;
  owner: PlayerId;
  joint: string;
  task?: ArmTask;
  requestedNm: number;
  capNm: number;
  /** Budget scale (arm allocator) and power/work scale applied to the proposal. */
  budgetScale: number;
  powerScale: number;
  appliedNm: number;
  onChild: Vec3;
  onParent: Vec3;
  /** Positive-power prediction before the solve and realized power across it (W). */
  predictedW: number;
  realizedW: number;
}

export interface FallStats {
  positiveWorkJ: number;
  negativeWorkJ: number;
  peakPositiveW: number;
  peakPredictedW: number;
  peakNm: Record<'shoulder' | 'elbow' | 'hip' | 'knee', number>;
  taskChanges: number;
  /** Substeps whose realized power passed the cap by more than the declared tolerance, and whether total work did. Either fails. */
  overPowerSubsteps: number;
  overWork: boolean;
  /**
   * Of those over substeps, the ones where contact changed a joint's speed during the solve beyond what the torque
   * explains, and the largest such power: a diagnosis of why, never an excuse. Each also counts in `overPowerSubsteps`.
   */
  impactPowerSubsteps: number;
  peakImpactW: number;
  /** Substeps the impact guard held effort off at least one limb, and off the whole body. */
  heldSubsteps: number;
  heldBodySubsteps: number;
  /** Substeps with any torque applied, the last such time (s from conversion). */
  activeSubsteps: number;
  lastEffortS: number;
}

export interface FallEpisode {
  playerId: PlayerId;
  rag: Ragdoll;
  role: Role;
  t0: number;
  /** Actual conversion angles every target starts from. */
  knee0: Record<ArmSide, number>;
  hipDir0: Record<ArmSide, Vec3>;
  arms: Record<ArmSide, ArmState>;
  /** Demands for this substep's arm allocation. */
  armDemand: Partial<Record<ArmSide, ArmEffortDemand>>;
  cmds: JointCmd[];
  applied: { entry: JointEffortEntry; cmd: JointCmd }[];
  /** 0..1 effort window of this substep. */
  effort: number;
  coreDown: boolean;
  exhausted: boolean;
  done: boolean;
  stats: FallStats;
}

export interface FallHost {
  readonly dt: number;
  readonly t: number;
  readonly steps: number;
  readonly gravity: number;
  emit(type: string, playerId: PlayerId | undefined, data: Record<string, unknown>): void;
  /**
   * Per segment, the fastest closing speed (m/s) of a contact its geometry meets within `lookaheadS`, if any; with
   * `jointResidual`, counting the segment's parent-joint velocity residual along the contact normal; with
   * `manifoldPoints`, at every point of the pair's last contact manifold as well as the closest one.
   */
  closingSpeeds(rag: Ragdoll, lookaheadS: number, predictionM: number, skinM: number, jointResidual?: boolean, manifoldPoints?: boolean): Partial<Record<SegmentId, number>>;
  /** Plan 11: per forearm, the summed contact impulse (N s) on its own trunk in the solve just read (never a contact record). */
  selfImpulses(rag: Ragdoll): Partial<Record<SegmentId, number>>;
}

type Limb = 'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg';
const LIMB_OF: Record<SegmentId, Limb | 'body'> = {
  core: 'body',
  head: 'body',
  leftUpperArm: 'leftArm',
  leftForearm: 'leftArm',
  rightUpperArm: 'rightArm',
  rightForearm: 'rightArm',
  leftThigh: 'leftLeg',
  leftShin: 'leftLeg',
  rightThigh: 'rightLeg',
  rightShin: 'rightLeg',
};
const jointLimb = (j: RagdollJoint): Limb => LIMB_OF[j.child] as Limb;

/** Torque toward a limb direction (world): spring across the error, damping across the swing rate only, no twist. */
function dirTorque(cur: Vec3, tgt: Vec3, w: Vec3, kp: number, kd: number, spring = true): Vec3 {
  const c = cross(cur, tgt);
  const s = len(c);
  const ang = Math.atan2(s, dot(cur, tgt));
  const swingRate = sub(w, scale(cur, dot(w, cur)));
  const damp = scale(swingRate, -kd);
  return spring && s > 1e-6 ? addScaled(damp, c, (kp * ang) / s) : damp;
}

export class FallResponse {
  readonly episodes = new Map<PlayerId, FallEpisode>();
  ledger: JointEffortEntry[] = [];
  /** Plan 10c (C7): set by the simulation from `SimOptions.ledgers` (off by default). */
  keepLedger = false;

  constructor(
    readonly P: FallResponseProfile,
    readonly host: FallHost,
  ) {}

  private joint(ep: FallEpisode, id: string): RagdollJoint {
    return ep.rag.joints.find((j) => j.id === id)!;
  }

  private envelope(ep: FallEpisode, kind: 'shoulder' | 'hip'): JointEnvelope {
    // the simulation admits a fall response only on an envelope with hips (plan 12: an L3 or HC one is shoulder-only)
    return ep.rag.profile.envelope![kind]!;
  }

  private coreQ(ep: FallEpisode): Quat {
    return ep.rag.bodies.core.rotation();
  }

  private dirCore(ep: FallEpisode, seg: SegmentId): Vec3 {
    return qInvRot(this.coreQ(ep), limbDirWorld(ep.rag, seg));
  }

  /**
   * Start at an accepted conversion, from the actual angles, tasks and holds at that boundary. `carry`: the arm the ball
   * is actually on (null: no ball); plan 10c C2: that arm protects, and the profile's declared carry arm must agree.
   */
  begin(playerId: PlayerId, rag: Ragdoll, role: Role, arms: ArmSystem | null, carry: ArmSide | null): FallEpisode {
    if (carry && carry !== this.P.arms.carryArm) throw new Error(`fall response ${this.P.id}: declared carry arm ${this.P.arms.carryArm}, but ${playerId} carries the ball on the ${carry} arm`);
    const hinge = hingeAngles(rag);
    const mk = (side: ArmSide): ArmState => {
      const dir = qInvRot(rag.bodies.core.rotation(), limbDirWorld(rag, `${side}UpperArm`));
      const elbow = rad(hinge[`${side}Elbow`]);
      return { side, task: 'passive', brace: 'none', refDirCore: dir, refElbowRad: elbow, targetDirCore: dir, targetElbowRad: elbow, reachable: false, everReachable: false, obstructedAtS: null };
    };
    const ep: FallEpisode = {
      playerId,
      rag,
      role,
      t0: this.host.t,
      knee0: { left: rad(hinge.leftKnee), right: rad(hinge.rightKnee) },
      hipDir0: {
        left: qInvRot(rag.bodies.core.rotation(), limbDirWorld(rag, 'leftThigh')),
        right: qInvRot(rag.bodies.core.rotation(), limbDirWorld(rag, 'rightThigh')),
      },
      arms: { left: mk('left'), right: mk('right') },
      armDemand: {},
      cmds: [],
      applied: [],
      effort: 0,
      coreDown: false,
      exhausted: false,
      done: false,
      stats: { positiveWorkJ: 0, negativeWorkJ: 0, peakPositiveW: 0, peakPredictedW: 0, peakNm: { shoulder: 0, elbow: 0, hip: 0, knee: 0 }, taskChanges: 0, overPowerSubsteps: 0, overWork: false, impactPowerSubsteps: 0, peakImpactW: 0, heldSubsteps: 0, heldBodySubsteps: 0, activeSubsteps: 0, lastEffortS: 0 },
    };
    for (const side of SIDES) {
      const a = ep.arms[side];
      if (!this.P.enable.arms) continue;
      if (side === carry) a.task = 'protect';
      else if (arms?.retained(playerId, side)) a.task = 'hold';
      else {
        a.task = 'brace';
        a.brace = 'seek';
      }
    }
    this.episodes.set(playerId, ep);
    this.host.emit('fallResponse', playerId, {
      profile: this.P.id,
      role,
      tasks: { left: ep.arms.left.task, right: ep.arms.right.task },
      kneeDeg: { left: round(hinge.leftKnee, 2), right: round(hinge.rightKnee, 2) },
    });
    return ep;
  }

  private effortAt(tS: number): number {
    const T = this.P.timing;
    return smooth((tS - T.delayS) / T.rampS) * (1 - smooth((tS - T.fadeStartS) / T.fadeS));
  }

  private setTask(ep: FallEpisode, a: ArmState, task: ArmTask, reason: string): void {
    if (a.task === task) return;
    this.host.emit('fallTask', ep.playerId, { arm: a.side, from: a.task, to: task, reason });
    a.task = task;
    ep.stats.taskChanges++;
  }

  private missBrace(ep: FallEpisode, a: ArmState, reason: BraceMissReason): void {
    a.brace = 'missed';
    this.host.emit('braceMiss', ep.playerId, { arm: a.side, reason, everReachable: a.everReachable });
    this.setTask(ep, a, 'passive', 'braceMiss');
  }

  /** Solved contact and retained holds decide this substep's tasks; a lost hold may brace, a new one never forms. */
  private observe(ep: FallEpisode, contacts: ContactRec[], arms: ArmSystem | null): void {
    const onFloor: Partial<Record<ArmSide, string>> = {};
    for (const c of contacts) {
      if (c.impulse <= 0) continue;
      for (const [own, other] of [[c.a, c.b], [c.b, c.a]] as const) {
        if (own.playerId !== ep.playerId) continue;
        const arm = own.side && (own.region === 'palm' || own.region === 'forearm') ? own.side : null;
        if (isGround(other)) {
          if (arm && !onFloor[arm]) onFloor[arm] = own.region;
          if (own.region === 'torso' || own.region === 'pelvis' || own.region === 'head') ep.coreDown = true;
        } else if (arm && other.playerId !== ep.playerId) {
          // plan 10c C4: only a seeking brace is obstructed (a hold's own contact is not), and not by a hold the arm
          // system retains, the arm's own or an opponent's on it
          const a = ep.arms[arm];
          const held = !!other.playerId && !!other.side && (other.region === 'palm' || other.region === 'forearm') && !!arms?.retained(other.playerId, other.side);
          if (a.task === 'brace' && a.brace === 'seek' && !held && !arms?.retained(ep.playerId, arm)) a.obstructedAtS = this.host.t;
        }
      }
    }
    for (const side of SIDES) {
      const a = ep.arms[side];
      if (a.task === 'hold' && !arms?.retained(ep.playerId, side)) {
        if (ep.coreDown) this.setTask(ep, a, 'passive', 'holdLost');
        else {
          // bracing starts from the achieved pose, with whatever budget and time remain
          a.targetDirCore = this.dirCore(ep, `${side}UpperArm`);
          a.targetElbowRad = rad(hingeAngles(ep.rag)[`${side}Elbow`]);
          a.brace = 'seek';
          this.setTask(ep, a, 'brace', 'holdLost');
        }
      }
      if (a.task !== 'brace' || a.brace !== 'seek') continue;
      const part = onFloor[side];
      if (part) {
        a.brace = 'contact';
        a.refDirCore = this.dirCore(ep, `${side}UpperArm`);
        a.refElbowRad = rad(hingeAngles(ep.rag)[`${side}Elbow`]);
        this.host.emit('braceContact', ep.playerId, { arm: side, part, tS: round(this.host.t - ep.t0, 4), palm: rv(landmarkWorld(ep.rag, `${side}Palm`), 4) });
      } else if (ep.coreDown) {
        const obstructed = a.obstructedAtS !== null && this.host.t - a.obstructedAtS <= this.P.brace.horizonS[0] + 1e-9;
        this.missBrace(ep, a, obstructed ? 'obstructed' : a.reachable ? 'late' : 'tooFar');
      }
    }
  }

  /** Propose this substep's torques, before the arm allocator sees them. */
  request(ep: FallEpisode, contacts: ContactRec[], arms: ArmSystem | null): void {
    ep.cmds = [];
    ep.armDemand = {};
    ep.applied = [];
    ep.effort = 0;
    if (ep.done) return;
    const tS = this.host.t - ep.t0;
    const T = this.P.timing;
    this.observe(ep, contacts, arms);
    if (tS >= T.fadeStartS + T.fadeS) {
      ep.done = true;
      for (const side of SIDES) {
        const a = ep.arms[side];
        if (a.task === 'brace' && a.brace === 'seek') this.missBrace(ep, a, 'expired');
        this.setTask(ep, a, 'passive', 'windowEnded');
      }
      this.host.emit('fallResponseEnd', ep.playerId, { reason: 'windowEnded', positiveWorkJ: round(ep.stats.positiveWorkJ, 3), negativeWorkJ: round(ep.stats.negativeWorkJ, 3) });
      return;
    }
    // the work cap: once less is left than one substep at the tolerated power could use, effort stops for good, so no
    // command of any sign (contact can turn an absorbing one positive) can carry the total past the cap
    const W = this.P.power;
    if (!ep.exhausted && W.maxPositiveWorkJ - ep.stats.positiveWorkJ < W.maxPositiveW * (1 + W.toleranceFraction) * this.host.dt) {
      ep.exhausted = true;
      this.host.emit('fallExhausted', ep.playerId, { positiveWorkJ: round(ep.stats.positiveWorkJ, 3), tS: round(tS, 4) });
    }
    if (ep.exhausted) return;
    const e = this.effortAt(tS);
    ep.effort = e;
    if (e <= 0) return;
    if (this.P.enable.knee) for (const side of SIDES) this.kneeCmd(ep, side, tS, e);
    if (this.P.enable.hip) for (const side of SIDES) this.hipCmd(ep, side, tS, e);
    if (this.P.enable.arms) for (const side of SIDES) this.armCmds(ep, ep.arms[side], e);
    const held = this.impactsAhead(ep, contacts);
    if (held.size) {
      ep.stats.heldSubsteps++;
      if (held.has('body')) ep.stats.heldBodySubsteps++;
      ep.cmds = held.has('body') ? [] : ep.cmds.filter((c) => !held.has(jointLimb(c.joint)));
    }
    for (const side of SIDES) {
      const cs = ep.cmds.filter((c) => c.arm === side);
      if (cs.length) ep.armDemand[side] = { shoulderNm: len(cs.find((c) => c.joint.kind === 'shoulder')?.torque ?? v3()), elbowNm: len(cs.find((c) => c.joint.kind === 'elbow')?.torque ?? v3()) };
    }
  }

  /**
   * Limbs (or the whole body) about to take an impact this substep: a contact the geometry says closes faster than the
   * guard speed, or a contact impulse over the guard impulse in the solve just read. Effort holds off them, because the
   * solve will change their joint speeds faster than any cap set before it can follow. A thigh or upper arm closing
   * faster than the body speed holds the whole body: the hit moves the core, and with it every joint the core parents.
   */
  private impactsAhead(ep: FallEpisode, contacts: ContactRec[]): Set<Limb | 'body'> {
    const G = this.P.impactGuard;
    const out = new Set<Limb | 'body'>();
    for (const c of contacts) {
      if (c.impulse <= G.impulseNs) continue;
      for (const t of [c.a, c.b]) if (t.playerId === ep.playerId && t.part !== 'floor') out.add(LIMB_OF[t.part]);
    }
    // plan 11: a forearm on its own trunk is an impact on that arm (the core, far heavier, is not held for it)
    for (const [seg, j] of Object.entries(this.host.selfImpulses(ep.rag)) as [SegmentId, number][]) if (j > G.impulseNs) out.add(LIMB_OF[seg]);
    // v4 (`jointResidual`): a contact also closes at what the segment's own joint still owes it from the last solve.
    // L4-F9-low (intermediate pose, seeded in tests/headplant.test.ts): R's head lands (9.75 N s, under the impulse) and
    // is at rest, but the solve left the core descending 1.08 m/s at the neck; the next solve takes 54.4 N s through the
    // resting head, the core's jolt swings both elbows and they realize 177.3 W against 157.5. Its closing with the
    // residual is 1.08: the body holds
    // v5 (`manifoldPoints`): every point of a contact closes, not only the closest. A core rocking on a torso corner
    // (tipped forward fall 3.5 m/s, 40 deg, 0.5 rad/s, seeded in tests/corerock.test.ts): that corner, the closest point,
    // does not close, the far corner closes at 3.5 m/s and the solve takes 56 N s through it; on the closest point alone
    // the response realizes 219 W against 157.5. Its closing over the manifold is 3.5: the body holds
    const closing = this.host.closingSpeeds(ep.rag, G.lookaheadSubsteps * this.host.dt, G.predictionM, G.skinM, !!G.jointResidual, !!G.manifoldPoints);
    // plan 14: a segment jointed to the core passes a hard hit straight into it, and the core parents every other limb
    const onCore = (seg: SegmentId): boolean => ep.rag.joints.some((j) => j.child === seg && j.parent === 'core');
    for (const [seg, v] of Object.entries(closing) as [SegmentId, number][])
      if (v > G.closingMPerS) out.add(v > G.bodyClosingMPerS && onCore(seg) ? 'body' : LIMB_OF[seg]);
    return out;
  }

  private hingeCmd(ep: FallEpisode, j: RagdollJoint, tau: number, capNm: number, inertia: number, arm?: ArmSide, task?: ArmTask): void {
    const applied = clamp(tau, -capNm, capNm);
    ep.cmds.push({ joint: j, torque: scale(hingeAxisWorld(ep.rag, j), applied), requestedNm: Math.abs(tau), capNm, wPre: relativeOmega(ep.rag, j), inertia, arm, task });
  }

  /**
   * Moment of inertia the power prediction uses for a joint's child: a uniform rod of the segment's mass about its end,
   * mL^2/3. An approximation (the segment is not a rod and drags the limb beyond it); the power audit, predicted
   * against achieved within 5%, holds with it.
   */
  private inertia(ep: FallEpisode, seg: SegmentId, lengthM: number): number {
    return (ep.rag.massKg[seg] * lengthM * lengthM) / 3;
  }

  /** One knee: a flexor only, toward a target that starts at the accepted angle. It never pushes the knee straight. */
  private kneeCmd(ep: FallEpisode, side: ArmSide, tS: number, e: number): void {
    const P = this.P;
    const j = this.joint(ep, `${side}Knee`);
    const th0 = ep.knee0[side];
    const goal = Math.max(th0, Math.min(th0 + rad(P.knee.flexDeg), rad(P.knee.maxDeg)));
    const target = th0 + (goal - th0) * smooth((tS - P.timing.delayS) / P.knee.rampS);
    const theta = rad(hingeAngles(ep.rag)[j.id]);
    const rate = dot(relativeOmega(ep.rag, j), hingeAxisWorld(ep.rag, j));
    const G = P.gains.knee;
    this.hingeCmd(ep, j, Math.max(0, G.kp * (target - theta) - G.kd * rate), P.ceilingsNm.knee * e, this.inertia(ep, `${side}Shin`, ep.rag.profile.lengths.shin));
  }

  /** One hip: forward flexion of the limb direction from its accepted direction. Past the target it only damps. */
  private hipCmd(ep: FallEpisode, side: ArmSide, tS: number, e: number): void {
    const P = this.P;
    const j = this.joint(ep, `${side}Hip`);
    const delta = rad(P.hip.flexDeg) * smooth((tS - P.timing.delayS) / P.hip.rampS);
    const raw = qRot(qFromAxisAngle(v3(1, 0, 0), -delta), ep.hipDir0[side]);
    const tgtCore = clampDirToEnvelope(this.envelope(ep, 'hip'), raw, j.sideSign ?? 1, 0);
    const cur = limbDirWorld(ep.rag, `${side}Thigh`);
    const curCore = qInvRot(this.coreQ(ep), cur);
    const past = Math.atan2(curCore.z, -curCore.y) >= Math.atan2(tgtCore.z, -tgtCore.y);
    const G = P.gains.hip;
    const w = relativeOmega(ep.rag, j);
    const t = dirTorque(cur, qRot(this.coreQ(ep), tgtCore), w, G.kp, G.kd, !past);
    const capNm = P.ceilingsNm.hip * e;
    ep.cmds.push({ joint: j, torque: clampLen(t, capNm), requestedNm: len(t), capNm, wPre: w, inertia: this.inertia(ep, `${side}Thigh`, ep.rag.profile.lengths.thigh) });
  }

  private armCmds(ep: FallEpisode, a: ArmState, e: number): void {
    if (a.task === 'passive') return;
    const P = this.P;
    const shoulder = this.joint(ep, `${a.side}Shoulder`);
    const elbow = this.joint(ep, `${a.side}Elbow`);
    let dirCore = a.refDirCore;
    let elbowRad = a.refElbowRad;
    let gain = 1;
    if (a.task === 'hold') gain = P.arms.holdScale;
    else if (a.task === 'brace') {
      if (a.brace === 'seek') {
        this.braceTarget(ep, a, shoulder);
        dirCore = a.targetDirCore;
        elbowRad = a.targetElbowRad;
      } else gain = P.arms.yieldScale;
    }
    const cur = limbDirWorld(ep.rag, `${a.side}UpperArm`);
    const w = relativeOmega(ep.rag, shoulder);
    const GS = P.gains.shoulder;
    const ts = dirTorque(cur, qRot(this.coreQ(ep), dirCore), w, GS.kp * gain, GS.kd * gain);
    const capS = P.ceilingsNm.shoulder * e;
    const L = ep.rag.profile.lengths;
    ep.cmds.push({ joint: shoulder, torque: clampLen(ts, capS), requestedNm: len(ts), capNm: capS, wPre: w, inertia: this.inertia(ep, `${a.side}UpperArm`, L.upperArm), arm: a.side, task: a.task });
    const axis = hingeAxisWorld(ep.rag, elbow);
    const rate = dot(relativeOmega(ep.rag, elbow), axis);
    const GE = P.gains.elbow;
    const theta = rad(hingeAngles(ep.rag)[elbow.id]);
    this.hingeCmd(ep, elbow, (GE.kp * (elbowRad - theta) - GE.kd * rate) * gain, P.ceilingsNm.elbow * e, this.inertia(ep, `${a.side}Forearm`, L.forearm), a.side, a.task);
  }

  /**
   * The floor point this hand can make, predicted from the shoulder's actual motion over the short horizon, and the
   * limb lengths' joint targets for it. A target too far to reach is still reached toward, and stays recorded as out of
   * reach: the arm extends and misses, nothing pulls the body or the hand to the floor.
   */
  private braceTarget(ep: FallEpisode, a: ArmState, shoulder: RagdollJoint): void {
    const B = this.P.brace;
    const dt = this.host.dt;
    const rag = ep.rag;
    const g = this.host.gravity;
    const sW = landmarkWorld(rag, `${a.side}Shoulder`);
    const vS = vc(rag.bodies[`${a.side}UpperArm`].velocityAtPoint(sW));
    const disc = vS.y * vS.y + 2 * g * (sW.y - B.shoulderHeightM);
    const tHit = g > 1e-6 ? (vS.y + Math.sqrt(Math.max(0, disc))) / g : vS.y < -1e-6 ? (B.shoulderHeightM - sW.y) / vS.y : Infinity;
    const h = clamp(tHit, B.horizonS[0], B.horizonS[1]);
    const S = add(addScaled(sW, vS, h), v3(0, -0.5 * g * h * h, 0));
    const q = this.coreQ(ep);
    const sideSign = shoulder.sideSign ?? 1;
    const outward = norm(horiz(qRot(q, v3(sideSign, 0, 0))), v3(sideSign, 0, 0));
    const offset = clampLen(add(scale(horiz(vS), B.leadS), scale(outward, B.lateralM)), B.maxOffsetM);
    const target = v3(S.x + offset.x, B.palmYM, S.z + offset.z);
    const L = rag.profile.lengths;
    const lower = L.forearm + L.palmExtension;
    const reach = L.upperArm + lower - BRACE_REACH_MARGIN_M;
    const pole = qRot(q, v3(sideSign * BRACE_POLE_OUT, 0, BRACE_POLE_BACK));
    const r = twoBone(sW, target, L.upperArm, lower, pole, reach);
    const wanted = qInvRot(q, norm(sub(r.mid, sW), v3(0, -1, 0)));
    const dirIK = clampDirToEnvelope(this.envelope(ep, 'shoulder'), wanted, sideSign, rad(B.envelopeMarginDeg));
    // in reach of the predicted shoulder, without a direction the shoulder's range does not have
    const reachable = dist(S, target) <= reach && dot(wanted, dirIK) > Math.cos(rad(B.envelopeMarginDeg));
    if (reachable && !a.everReachable) this.host.emit('braceTarget', ep.playerId, { arm: a.side, target: rv(target, 3), horizonS: round(h, 3), tS: round(this.host.t - ep.t0, 4) });
    a.reachable = reachable;
    a.everReachable ||= reachable;
    const d = Math.min(len(sub(target, sW)), reach);
    const flexRad = Math.acos(clamp((d * d - L.upperArm * L.upperArm - lower * lower) / (2 * L.upperArm * lower), -1, 1));
    const lim = rag.joints.find((j) => j.id === `${a.side}Elbow`)!.limitsRad!;
    const elbowIK = clamp(flexRad, Math.max(lim[0], rad(B.minElbowDeg)), lim[1]);
    a.targetDirCore = rotateToward(a.targetDirCore, dirIK, B.maxDirRateRadPerS * dt);
    const dE = elbowIK - a.targetElbowRad;
    a.targetElbowRad += clamp(dE, -B.maxElbowRateRadPerS * dt, B.maxElbowRateRadPerS * dt);
  }

  /** Scale by the shared allocation, cap power and work, then apply each equal and opposite torque pair once. */
  apply(ep: FallEpisode, armScale: Record<ArmSide, number> | undefined): void {
    if (!ep.cmds.length) return;
    const dt = this.host.dt;
    const W = this.P.power;
    const budget = ep.cmds.map((c) => (c.arm ? armScale?.[c.arm] ?? 1 : 1));
    const torques = ep.cmds.map((c, i) => scale(c.torque, budget[i]));
    const power = (i: number, s: number): number => {
      const t = torques[i];
      return s * dot(t, ep.cmds[i].wPre) + (s * s * dot(t, t) * dt) / ep.cmds[i].inertia;
    };
    const positive = ep.cmds.map((_, i) => power(i, 1) > 0);
    const total = (s: number): number => ep.cmds.reduce((sum, _, i) => (positive[i] ? sum + Math.max(0, power(i, s)) : sum), 0);
    // the work left always covers a substep at this power: request() stops effort before it would not
    const limitW = W.maxPositiveW * W.planFraction;
    let s = 1;
    if (total(1) > limitW) {
      let lo = 0;
      let hi = 1;
      for (let k = 0; k < POWER_SCALE_BISECTIONS; k++) {
        const m = (lo + hi) / 2;
        if (total(m) > limitW) hi = m;
        else lo = m;
      }
      s = lo;
    }
    let predicted = 0;
    let torqued = false;
    ep.cmds.forEach((c, i) => {
      const ps = positive[i] ? s : 1;
      const t = scale(torques[i], ps);
      const pred = Math.max(0, power(i, ps));
      predicted += positive[i] ? pred : 0;
      const m = len(t);
      if (m > 0) {
        torqued = true;
        ep.rag.bodies[c.joint.child].addTorque(t, true);
        ep.rag.bodies[c.joint.parent].addTorque(scale(t, -1), true);
      }
      const onParent = scale(t, -1);
      const entry: JointEffortEntry = { t: this.host.t, step: this.host.steps, owner: ep.playerId, joint: c.joint.id, task: c.task, requestedNm: c.requestedNm, capNm: c.capNm, budgetScale: budget[i], powerScale: ps, appliedNm: m, onChild: t, onParent, predictedW: pred, realizedW: 0 };
      ep.applied.push({ entry, cmd: c });
      if (this.keepLedger) this.ledger.push(entry);
      const k = c.joint.kind as keyof FallStats['peakNm'];
      ep.stats.peakNm[k] = Math.max(ep.stats.peakNm[k], m);
      if (m > 0) ep.stats.lastEffortS = this.host.t - ep.t0;
    });
    ep.stats.peakPredictedW = Math.max(ep.stats.peakPredictedW, predicted);
    // plan 10c (C7): a substep whose commands were all scaled to nothing applied no effort
    if (torqued) ep.stats.activeSubsteps++;
  }

  /** Realized work across the solve, measured from the velocities either side of it. Nothing here refunds capacity. */
  audit(ep: FallEpisode): void {
    if (!ep.applied.length) return;
    const dt = this.host.dt;
    const W = this.P.power;
    let positive = 0;
    let negative = 0;
    let impact = false;
    for (const { entry, cmd } of ep.applied) {
      const wPost = relativeOmega(ep.rag, cmd.joint);
      const p = dot(entry.onChild, scale(add(cmd.wPre, wPost), 0.5));
      entry.realizedW = p;
      if (p > 0) positive += p;
      else negative -= p;
      if (len(sub(wPost, cmd.wPre)) - (entry.appliedNm * dt) / cmd.inertia > W.impactOmegaRadPerS) impact = true;
    }
    const s = ep.stats;
    s.positiveWorkJ += positive * dt;
    s.negativeWorkJ += negative * dt;
    s.peakPositiveW = Math.max(s.peakPositiveW, positive);
    const over = positive > W.maxPositiveW * (1 + W.toleranceFraction);
    if (over) {
      s.overPowerSubsteps++;
      if (impact) {
        s.impactPowerSubsteps++;
        s.peakImpactW = Math.max(s.peakImpactW, positive);
      }
    }
    const overWork = s.positiveWorkJ > W.maxPositiveWorkJ * (1 + W.toleranceFraction);
    if ((over && s.overPowerSubsteps === 1) || (overWork && !s.overWork)) this.host.emit('fallEffortOver', ep.playerId, { realizedW: round(positive, 2), positiveWorkJ: round(s.positiveWorkJ, 3), impact });
    s.overWork ||= overWork;
  }

  /** Evidence for traces and exports. */
  report(ep: FallEpisode): Record<string, unknown> {
    const s = ep.stats;
    return {
      t0: round(ep.t0, 5),
      role: ep.role,
      tasks: { left: ep.arms.left.task, right: ep.arms.right.task },
      brace: { left: ep.arms.left.brace, right: ep.arms.right.brace },
      exhausted: ep.exhausted,
      done: ep.done,
      positiveWorkJ: round(s.positiveWorkJ, 4),
      negativeWorkJ: round(s.negativeWorkJ, 4),
      peakPositiveW: round(s.peakPositiveW, 3),
      peakPredictedW: round(s.peakPredictedW, 3),
      peakNm: Object.fromEntries(Object.entries(s.peakNm).map(([k, v]) => [k, round(v, 3)])),
      taskChanges: s.taskChanges,
      overPowerSubsteps: s.overPowerSubsteps,
      overWork: s.overWork,
      impactPowerSubsteps: s.impactPowerSubsteps,
      peakImpactW: round(s.peakImpactW, 3),
      heldSubsteps: s.heldSubsteps,
      heldBodySubsteps: s.heldBodySubsteps,
      activeSubsteps: s.activeSubsteps,
      lastEffortS: round(s.lastEffortS, 4),
    };
  }
}
