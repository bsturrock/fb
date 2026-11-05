// Wrap-attempt controller (Gate 2): approaches the runner and requests independent arm paths around the runner's
// opposite sides. Waypoints are requests generated from the runner's current observed geometry; phases advance on
// observed hand position / clamp contact. Timeouts only abandon or retry; they never create contact or a wrap.
import type { ArmIntent, ArmSide, PlayerIntent } from '../contracts';
import { pairKey } from '../contracts';
import type { BodyProfile, MotorProfile } from '../profiles';
import { sideSignX } from '../profiles';
import type { PlayerSetup } from '../fixture';
import type { Controller, ControllerContext } from './base';
import { add, addScaled, clamp, cross, dot, horiz, len, norm, qRot, scale, sub, v3, UP, type Vec3 } from '../vec';

export type ArmPlan = 'wrap' | 'palmFlank' | 'none';
export type WrapArmPhase = 'ready' | 'spread' | 'arc' | 'close' | 'sustain' | 'recover' | 'palmReach' | 'palmClose' | 'palmPull' | 'idle';

export interface WrapSpec {
  kind: 'wrapAttempt';
  plan: { left: ArmPlan; right: ArmPlan };
  approachSpeedMps?: number;
  /**
   * Closing-speed gain (1/s) on the remaining body gap: closing = min(gain * gap, approachSpeedMps). The default eases
   * in; a large gain keeps the approach speed until contact (a tackle that runs through). Request only.
   */
  closingGainPerS?: number;
  /**
   * true (default): request the runner's velocity plus the closing speed (pursue and ease in). false: request only the
   * closing speed toward the runner (run at the runner; the relative speed at contact is the closing speed).
   */
  matchRunnerVelocity?: boolean;
  /**
   * Straight-line run: until the first retained arm contact, request this fixed field velocity instead of pursuing
   * (a defender running a committed line through the runner's path). Request only.
   */
  approachVelocityWorld?: Vec3;
  /** Aim at the runner's predicted position (current + velocity x time to close at the approach speed, <= 1 s). */
  interceptLead?: boolean;
  /** Desired surface gap while engaged (negative presses in). */
  contactGapM?: number;
  /** Extra closing speed requested once in contact (drives through the runner). */
  driveInMps?: number;
  /** Lateral offset of the approach aim along the defender's right (m). */
  aimLateralM?: number;
  /** Arms start spreading below this body gap. */
  engageGapM?: number;
  /** Wrap band height in the runner's core frame. */
  bandYLocal?: number;
  marginM?: number;
  spreadAzDeg?: number;
  arcLeadDeg?: number;
  wrapAzDeg?: number;
  closeDepthM?: number;
  stuckS?: number;
  recoverS?: number;
  effort?: number;
  /** Stop all arm work after this time (fixtures that test release behaviour). */
  armsOffAfterS?: number;
  /** Stop pursuing after this time: request zero velocity at `standEffort` (arms keep working). */
  standAfterS?: number;
  standEffort?: number;
  /**
   * Gate 3 supported finish (section 9.1). Requests only, through the same bounded actuators:
   *  - both arms retaining: drive along `dirWorld` (explicit field direction) at `speedMps` while matching the runner's
   *    velocity across it, posture lean toward it;
   *  - one arm retaining: limited lateral reposition toward the free arm's side; the free arm keeps its own reach;
   *  - contact but little progress along `dirWorld`: adjust facing toward `dirWorld`;
   *  - all useful contact lost: pursue again (approach behaviour).
   */
  finish?: { dirWorld: Vec3; speedMps: number; leanDeg?: number; repositionMps?: number; progressWindowS?: number; minProgressMps?: number; adjustDeg?: number };
  /** F9 control: once connected, remove drive and closure requests (locomotion effort 0, arms release). */
  removeAfterConnect?: boolean;
  /** Forward posture lean (deg) toward the runner while approaching/engaged (bounded by the balance profile). */
  approachLeanDeg?: number;
}

const DEF = {
  approachSpeedMps: 3,
  closingGainPerS: 2.5,
  matchRunnerVelocity: true,
  interceptLead: false,
  contactGapM: 0.0,
  driveInMps: 0.3,
  aimLateralM: 0,
  engageGapM: 0.35,
  bandYLocal: 0.22,
  marginM: 0.09,
  spreadAzDeg: 60,
  arcLeadDeg: 30,
  wrapAzDeg: 115,
  closeDepthM: 0.1,
  stuckS: 0.6,
  recoverS: 0.3,
  effort: 1,
  armsOffAfterS: Infinity,
  standAfterS: Infinity,
  standEffort: 1,
  removeAfterConnect: false,
  approachLeanDeg: 0,
};

interface ArmCtl {
  phase: WrapArmPhase;
  since: number;
  bestAz: number;
  lastProgressT: number;
  lastClampT: number;
}

const SIDES: ArmSide[] = ['left', 'right'];

export class WrapAttemptController implements Controller {
  readonly kind = 'wrapAttempt';
  readonly observationDelayS = 0;
  readonly decisionIntervalS = 0;
  readonly p: Required<Omit<WrapSpec, 'kind' | 'plan' | 'finish'>>;
  private connectedAt: number | null = null;
  private lastContactT = -Infinity;
  private progress: { t: number; along: number }[] = [];
  private finishMode = 'approach';
  private arm: Record<ArmSide, ArmCtl>;
  private near: Vec3 = v3(0, 0, -1);
  private lastFacing: Vec3;

  constructor(
    readonly spec: WrapSpec,
    readonly setup: PlayerSetup,
    readonly motor: MotorProfile,
  ) {
    this.p = { ...DEF, ...stripUndef(spec) } as Required<Omit<WrapSpec, 'kind' | 'plan' | 'finish'>>;
    const mk = (s: ArmSide): ArmCtl => ({ phase: spec.plan[s] === 'none' ? 'idle' : spec.plan[s] === 'wrap' ? 'ready' : 'palmReach', since: 0, bestAz: -180, lastProgressT: 0, lastClampT: -1 });
    this.arm = { left: mk('left'), right: mk('right') };
    const y = (setup.initial.yawDeg * Math.PI) / 180;
    this.lastFacing = v3(Math.sin(y), 0, Math.cos(y));
  }

  /** Horizontal support distance of the runner's torso box along world direction d. */
  private support(body: BodyProfile, rq: { x: number; y: number; z: number; w: number }, d: Vec3): number {
    const rx = qRot(rq, v3(1, 0, 0));
    const rz = qRot(rq, v3(0, 0, 1));
    if (body.kind === 'legacyCapsule') return body.legacy.radius;
    const h = body.compound.torso.halfExtents;
    return Math.abs(dot(d, rx)) * h.x + Math.abs(dot(d, rz)) * h.z;
  }

  decide(ctx: ControllerContext): PlayerIntent {
    const P = this.p;
    const me = ctx.observed.bodies[ctx.self];
    const tid = ctx.focus;
    const tb = tid ? ctx.observed.bodies[tid] : undefined;
    if (!me || !tb || !tid) return { locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: this.lastFacing, effort: 1 } };
    const tBody = ctx.bodies[tid];
    const R = tb.position;
    const nearRaw = horiz(sub(me.position, R));
    if (len(nearRaw) > 1e-3) this.near = norm(nearRaw);
    const near = this.near;
    const side = norm(cross(near, UP));
    const gap = ctx.observed.pairGap[pairKey(ctx.self, tid)] ?? 10;
    // ---------------- locomotion: approach the (optionally offset) runner and keep pressing once engaged
    const vR = horiz(tb.linearVelocity);
    const lead = P.interceptLead ? clamp(len(horiz(sub(R, me.position))) / Math.max(P.approachSpeedMps, 0.5), 0, 1) : 0;
    const aim = addScaled(addScaled(R, vR, lead), side, P.aimLateralM);
    const toAim = horiz(sub(aim, me.position));
    const dir = norm(toAim, scale(near, -1));
    const closing = gap > P.contactGapM ? clamp(P.closingGainPerS * (gap - P.contactGapM), 0, P.approachSpeedMps) : 0;
    const desired = add(P.matchRunnerVelocity ? vR : v3(), scale(dir, closing + (gap < 0.05 ? P.driveInMps : 0)));
    const maxV = this.motor.maximumRequestedSpeedMps;
    const standing = ctx.t >= P.standAfterS;
    const line = this.spec.approachVelocityWorld;
    const want = line && this.connectedAt === null ? horiz(line) : desired;
    let vel = standing ? v3() : len(want) > maxV ? scale(want, maxV / len(want)) : want;
    this.lastFacing = norm(horiz(sub(R, me.position)), this.lastFacing);
    let effortOut = standing ? P.standEffort : P.effort;
    let posture: PlayerIntent['posture'] = P.approachLeanDeg > 0 ? { leanDirWorld: this.lastFacing, leanRad: (P.approachLeanDeg * Math.PI) / 180 } : undefined;
    // ---------------- connection bookkeeping (observed arm retention or body contact with the runner)
    const armsObs = ctx.observed.arms[ctx.self] ?? {};
    const retaining = SIDES.filter((s) => !!(armsObs[s]?.clampContactId || armsObs[s]?.gripId));
    const bodyContact = (ctx.observed.contacts[ctx.self] ?? []).some((c) => c.other === tid);
    if (retaining.length > 0 || bodyContact) {
      this.lastContactT = ctx.t;
      if (this.connectedAt === null && retaining.length > 0) this.connectedAt = ctx.t;
    }
    const removed = P.removeAfterConnect && this.connectedAt !== null;
    const F = this.spec.finish;
    if (removed) {
      vel = v3();
      effortOut = 0;
      posture = undefined;
      this.finishMode = 'removed';
    } else if (F && this.connectedAt !== null && ctx.observed.bodies[ctx.self].controlMode === 'supported') {
      const fdir = norm(horiz(F.dirWorld), v3(1, 0, 0));
      const along = dot(R, fdir);
      this.progress.push({ t: ctx.t, along });
      const win = F.progressWindowS ?? 0.5;
      while (this.progress.length > 1 && this.progress[0].t < ctx.t - win) this.progress.shift();
      const rate = this.progress.length > 1 ? (along - this.progress[0].along) / Math.max(1e-6, ctx.t - this.progress[0].t) : Infinity;
      const lean = F.leanDeg ? { leanDirWorld: fdir, leanRad: (F.leanDeg * Math.PI) / 180 } : undefined;
      if (retaining.length === 2) {
        // drive along the chosen field direction while matching the runner's motion across it (stay on the runner)
        this.finishMode = 'drive';
        vel = add(sub(vR, scale(fdir, dot(vR, fdir))), scale(fdir, F.speedMps));
        posture = lean;
        if (ctx.t - this.connectedAt > win && rate < (F.minProgressMps ?? 0.3)) {
          // stable contact, little progress: turn the requested facing toward the finish direction (bounded yaw motor)
          this.finishMode = 'adjust';
          const a = ((F.adjustDeg ?? 25) * Math.PI) / 180;
          const toR = this.lastFacing;
          const turn = Math.sign(dot(cross(toR, fdir), UP)) || 1;
          this.lastFacing = norm(add(scale(toR, Math.cos(a)), scale(cross(UP, toR), turn * Math.sin(a))), toR);
        }
      } else if (retaining.length === 1) {
        // limited lateral reposition toward the free arm's side, keeping pace with the runner
        this.finishMode = 'reposition';
        const free: ArmSide = retaining[0] === 'left' ? 'right' : 'left';
        vel = add(horiz(tb.linearVelocity), scale(side, sideSignX(this.setup.body, free) * -(F.repositionMps ?? 0.8)));
        posture = lean;
      } else if (ctx.t - this.lastContactT > 0.3) {
        this.finishMode = 'recover';
      } else this.finishMode = 'contact';
      if (len(vel) > maxV) vel = scale(vel, maxV / len(vel));
    } else this.finishMode = this.connectedAt === null ? 'approach' : 'engaged';
    // ---------------- arms
    const arms: Partial<Record<ArmSide, ArmIntent>> = {};
    const band = R.y + P.bandYLocal;
    const myArms = ctx.observed.arms[ctx.self] ?? {};
    const azOf = (pt: Vec3, sgn: number): number => {
      const r = horiz(sub(pt, R));
      return (Math.atan2(sgn * dot(r, side), dot(r, near)) * 180) / Math.PI;
    };
    const ring = (azDeg: number, sgn: number, extra: number): Vec3 => {
      const a = (azDeg * Math.PI) / 180;
      const d = norm(add(scale(near, Math.cos(a)), scale(side, sgn * Math.sin(a))));
      const r = this.support(tBody, tb.rotation, d) + extra;
      return v3(R.x + d.x * r, band, R.z + d.z * r);
    };
    const debugArms: Record<string, unknown> = {};
    for (const s of SIDES) {
      const plan = this.spec.plan[s];
      const st = this.arm[s];
      const ob = myArms[s];
      if (plan === 'none' || !ob) continue;
      // `side` is the defender's local +X (cross(near, UP) with the defender facing the runner): the arm's sign on it
      const sgn = sideSignX(this.setup.body, s);
      const az = azOf(ob.palmContactWorld, sgn);
      const t = ctx.t;
      const go = (ph: WrapArmPhase): void => {
        st.phase = ph;
        st.since = t;
        st.bestAz = az;
        st.lastProgressT = t;
      };
      if (az > st.bestAz + 3) {
        st.bestAz = az;
        st.lastProgressT = t;
      }
      if (ob.clampContactId) st.lastClampT = t;
      if (t >= P.armsOffAfterS || removed) {
        arms[s] = { action: 'release', targetWorld: ob.palmContactWorld };
        debugArms[s] = { phase: 'off', az };
        continue;
      }
      let action: ArmIntent['action'] = 'reach';
      let target: Vec3;
      if (plan === 'palmFlank') {
        const flank = addScaled(addScaled(R, near, this.support(tBody, tb.rotation, near) - 0.07), side, sgn * 0.1);
        target = v3(flank.x, band, flank.z);
        if (st.phase === 'palmReach' && gap < P.engageGapM && t - st.since > 0.2) go('palmClose');
        if (st.phase === 'palmClose' && ob.gripId && t - st.since > 0.2) go('palmPull');
        if (st.phase === 'palmPull' && !ob.gripId) go('palmReach');
        action = st.phase === 'palmReach' ? 'reach' : st.phase === 'palmClose' ? 'close' : 'pull';
      } else {
        switch (st.phase) {
          case 'ready':
            target = addScaled(ring(0, sgn, 0.12), side, sgn * 0.18);
            if (gap < P.engageGapM) go('spread');
            break;
          case 'spread':
            target = ring(P.spreadAzDeg, sgn, P.marginM + 0.06);
            if (az >= P.spreadAzDeg - 10 || len(sub(ob.palmContactWorld, target)) < 0.08 || t - st.lastProgressT > P.stuckS) go('arc');
            break;
          case 'arc':
            target = ring(Math.min(P.wrapAzDeg, Math.max(az, P.spreadAzDeg - 10) + P.arcLeadDeg), sgn, P.marginM);
            if (az >= P.wrapAzDeg - 25 || ob.touchingTarget === tid && az >= 70) go('close');
            else if (t - st.lastProgressT > P.stuckS) go('recover');
            break;
          case 'close':
            target = ring(P.wrapAzDeg + 10, sgn, -P.closeDepthM);
            action = 'close';
            if (ob.clampContactId || ob.gripId) go('sustain');
            else if (t - st.since > P.stuckS) go('arc');
            break;
          case 'sustain':
            target = ring(P.wrapAzDeg + 10, sgn, -P.closeDepthM);
            action = 'close';
            if (!ob.clampContactId && !ob.gripId && t - st.lastClampT > 0.15) go(az < 50 ? 'arc' : 'close');
            break;
          case 'recover':
            target = ring(20, sgn, 0.2);
            if (t - st.since > P.recoverS) go('spread');
            break;
          default:
            target = ob.palmContactWorld;
        }
      }
      arms[s] = { action, targetWorld: target };
      debugArms[s] = { phase: st.phase, az: Math.round(az), target };
    }
    return {
      locomotion: { desiredVelocityWorld: vel, desiredFacingWorld: this.lastFacing, effort: effortOut },
      arms,
      posture,
      debug: { phase: `${this.finishMode} L:${this.arm.left.phase} R:${this.arm.right.phase}`, finish: this.finishMode, arms: debugArms, gap, near, side, readyHands: true },
    };
  }

  exportParams(): unknown {
    return { ...this.spec, resolved: this.p };
  }
}

function stripUndef<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined && k !== 'kind' && k !== 'plan' && k !== 'finish') r[k] = o[k];
  return r;
}
