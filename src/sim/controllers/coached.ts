// Gate 1-D coached approach and connection. Emits only bounded movement/facing requests (and, from Gate 2 on,
// nothing else). It cannot award contact: phases advance from observed geometry and felt contact only.
import type { ArmSide, PlayerId, PlayerIntent } from '../contracts';
import { pairKey } from '../contracts';
import { hipLocal, headRadius, torsoHalf, shoulderLocal, type MotorProfile } from '../profiles';
import type { Controller, ControllerContext } from './base';
import {
  UP, add, addScaled, clamp, cross, dot, horiz, len, lerp, neg, norm, qRot, scale, sub, toWorld, v3, type Vec3,
} from '../vec';

export interface CoachedEntrySpec {
  kind: 'coachedEntry';
  target: PlayerId;
  /** Side of the runner the tackler keeps (his head side). Unit horizontal world vector. */
  leverageSideWorld: Vec3;
  shoulder: ArmSide;
  /** headClear: head outside the runner's torso on the leverage side. diagnosticHeadOn: deliberately poor aim. */
  fit?: 'headClear' | 'diagnosticHeadOn';
  /** Extra lateral offset (m) along the leverage side; positive values produce glancing entries. */
  lateralExtraM?: number;
  predictionHorizonMaxS?: number;
  observationDelayS?: number;
  decisionIntervalS?: number;
  contactEntrySpeedMps?: number;
  brakingFraction?: number;
  gatherGapM?: number;
  connectGapM?: number;
  headClearanceM?: number;
  driveThroughM?: number;
  continueS?: number;
  recoverAfterS?: number;
}

export type CoachedPhase = 'track' | 'gather' | 'connect' | 'drive' | 'recover';

const DEFAULTS = {
  fit: 'headClear' as const,
  lateralExtraM: 0,
  predictionHorizonMaxS: 0.5,
  observationDelayS: 0,
  decisionIntervalS: 0.05,
  contactEntrySpeedMps: 1.5,
  brakingFraction: 0.75,
  gatherGapM: 3.0,
  connectGapM: 0.4,
  headClearanceM: 0.04,
  driveThroughM: 0.2,
  continueS: 0.8,
  recoverAfterS: 0.3,
};

const smooth = (x: number): number => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};

export class CoachedEntryController implements Controller {
  readonly kind = 'coachedEntry';
  readonly observationDelayS: number;
  readonly decisionIntervalS: number;
  private p: Required<Omit<CoachedEntrySpec, 'kind' | 'target' | 'leverageSideWorld' | 'shoulder'>>;
  phase: CoachedPhase = 'track';
  private phaseT0 = 0;
  private lastLat: Vec3;
  private lastDir: Vec3 = v3(0, 0, 1);
  private lastContactT = -1;
  private firstContactT = -1;
  private minGap = Infinity;
  private gapRiseT = -1;
  private entryNear: Vec3 | null = null;
  /** Approach basis (runner -> tackler axis, leverage lateral); frozen from gather entry for the attempt. */
  private basis: { near: Vec3; lat: Vec3 } | null = null;

  constructor(
    readonly spec: CoachedEntrySpec,
    private readonly motor: MotorProfile,
    private readonly massKg: number,
  ) {
    this.p = { ...DEFAULTS, ...stripUndefined(spec) } as typeof this.p;
    this.observationDelayS = this.p.observationDelayS;
    this.decisionIntervalS = this.p.decisionIntervalS;
    this.lastLat = norm(horiz(spec.leverageSideWorld), v3(1, 0, 0));
  }

  private setPhase(ph: CoachedPhase, t: number): void {
    if (ph !== this.phase) {
      this.phase = ph;
      this.phaseT0 = t;
    }
  }

  decide(ctx: ControllerContext): PlayerIntent {
    const obs = ctx.observed;
    const me = obs.bodies[ctx.self];
    const rb = obs.bodies[this.spec.target];
    const myBody = ctx.bodies[ctx.self];
    const rBody = ctx.bodies[this.spec.target];
    const p = this.p;
    if (!me || !rb || !myBody || !rBody) {
      return { locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: this.lastDir, effort: 1 }, debug: { phase: 'idle' } };
    }
    const S = horiz(me.position);
    const R = horiz(rb.position);
    const vS = horiz(me.linearVelocity);
    const vR = horiz(rb.linearVelocity);
    const dirToR = norm(sub(R, S), this.lastDir);
    this.lastDir = dirToR;
    // Approach basis: live while tracking, frozen once the attempt gathers (close-range centre lines are ill-posed).
    let nearDir: Vec3;
    let lat: Vec3;
    if (this.basis && (this.phase === 'gather' || this.phase === 'connect' || this.phase === 'drive')) {
      nearDir = this.basis.near;
      lat = this.basis.lat;
    } else {
      nearDir = neg(dirToR); // runner -> tackler
      // Leverage lateral axis: component of the assigned side perpendicular to the approach; keep last valid one.
      const levH = horiz(this.spec.leverageSideWorld);
      const latRaw = sub(levH, scale(nearDir, dot(levH, nearDir)));
      lat = len(latRaw) > 0.2 ? norm(latRaw) : this.lastLat;
      this.lastLat = lat;
      this.basis = { near: nearDir, lat };
    }

    const gap = obs.pairGap[pairKey(ctx.self, this.spec.target)] ?? len(sub(R, S)) - 0.6;
    const closing = dot(sub(vS, vR), dirToR);
    // Prediction horizon shrinks with the gap; a slow closing rate cannot stretch it (parallel running would
    // otherwise aim far ahead of the runner). Connection aims at the current upper torso.
    const hRaw = clamp(gap / Math.max(closing, 1.5), 0, p.predictionHorizonMaxS);
    const h = this.phase === 'connect' || this.phase === 'drive' ? Math.min(hRaw, 0.1) : hRaw;

    // Actual profile geometry (no universal center-distance snap).
    const rRight = horiz(qRot(rb.rotation, v3(1, 0, 0)));
    const rFwd = horiz(qRot(rb.rotation, v3(0, 0, 1)));
    const rh = torsoHalf(rBody);
    const rHalfLat = Math.abs(dot(lat, rRight)) * rh.x + Math.abs(dot(lat, rFwd)) * rh.z;
    const rHalfNear = Math.abs(dot(nearDir, rRight)) * rh.x + Math.abs(dot(nearDir, rFwd)) * rh.z;
    const oh = torsoHalf(myBody);
    const ownHeadR = headRadius(myBody);
    const offsetC =
      p.fit === 'diagnosticHeadOn' ? p.lateralExtraM : rHalfLat + ownHeadR + p.headClearanceM + p.lateralExtraM;
    // Selected shoulder lateral coordinate along `lat` while facing the runner.
    const rightWhenFacing = cross(UP, neg(nearDir));
    const sh = shoulderLocal(myBody, this.spec.shoulder);
    const sLat = dot(rightWhenFacing, lat) * sh.x;
    const shoulderLanding = offsetC + sLat;
    const fitCompatible = Math.abs(shoulderLanding) <= rHalfLat;
    const headLateral = offsetC; // own head center lateral offset from runner centerline
    const headClearance = Math.abs(headLateral) - rHalfLat - ownHeadR;

    // Predicted runner near hip (on the leverage side) and the upper-torso fit position.
    const rPose = { p: rb.position, q: rb.rotation };
    const hipL = horiz(toWorld(rPose, hipLocal(rBody, 'left')));
    const hipR = horiz(toWorld(rPose, hipLocal(rBody, 'right')));
    const hipNear = dot(sub(hipL, R), lat) >= dot(sub(hipR, R), lat) ? hipL : hipR;
    const hipNearH = addScaled(hipNear, vR, h);
    const Rh = addScaled(R, vR, h);
    // Track: a point just outside the predicted near hip on the leverage side. Fit: the upper-torso connection
    // position (selected shoulder on the near torso, head on the leverage side), aimed slightly through.
    const trackAim = add(addScaled(hipNearH, lat, oh.x + 0.1), scale(nearDir, oh.z + 0.1));
    const fitAim = add(addScaled(Rh, nearDir, rHalfNear + oh.z - p.driveThroughM), scale(lat, offsetC));
    const wGap = smooth((p.gatherGapM - gap) / Math.max(1e-3, p.gatherGapM - p.connectGapM));
    const wTime = this.phase === 'gather' || this.phase === 'connect' ? smooth((ctx.t - this.phaseT0) / 0.35) : 0;
    const w = this.phase === 'connect' ? 1 : Math.max(wGap, wTime);
    const aim = lerp(trackAim, fitAim, w);

    // ---- phase update from observations (felt contact with the target, gap history)
    const t = ctx.t;
    const touching = (obs.contacts[ctx.self] ?? []).some((c) => c.other === this.spec.target);
    if (touching) {
      this.lastContactT = t;
      if (this.phase !== 'drive') {
        this.firstContactT = t;
        this.setPhase('drive', t);
      }
    }
    if (gap < this.minGap - 1e-4) {
      this.minGap = gap;
      this.gapRiseT = -1;
    } else if (gap > this.minGap + 0.05 && this.gapRiseT < 0) this.gapRiseT = t;
    if (this.phase === 'drive') {
      if (!touching && t - this.lastContactT > p.recoverAfterS) this.setPhase('recover', t);
    } else if (this.phase === 'recover') {
      if (t - this.phaseT0 > p.recoverAfterS) {
        this.minGap = gap;
        this.gapRiseT = -1;
        this.entryNear = null;
        this.basis = null;
        this.setPhase('track', t);
      }
    } else {
      const passed = this.entryNear ? dot(sub(S, R), this.entryNear) < -0.05 : false;
      if (this.phase === 'track' && gap <= p.gatherGapM) this.basis = { near: nearDir, lat };
      const missed = this.phase === 'connect' && this.gapRiseT >= 0 && t - this.gapRiseT > p.recoverAfterS;
      if (passed || missed) this.setPhase('recover', t);
      else if (gap <= p.connectGapM) {
        if (this.phase !== 'connect') this.entryNear = nearDir;
        this.setPhase('connect', t);
      } else if (gap <= p.gatherGapM) this.setPhase('gather', t);
      else this.setPhase('track', t);
    }

    // ---- requests (bounded speeds; the motor bounds the force)
    const toAim = sub(aim, S);
    const dirAim = norm(toAim, dirToR);
    const aBrake = (p.brakingFraction * this.motor.maximumDriveForceN) / this.massKg;
    const ceiling = Math.sqrt(p.contactEntrySpeedMps ** 2 + 2 * aBrake * Math.max(gap, 0));
    const maxV = this.motor.maximumRequestedSpeedMps;
    let desired: Vec3;
    let approach = 0;
    switch (this.phase) {
      case 'track':
      case 'recover':
        approach = Math.min(maxV, 2.5 * len(toAim) + 1.0);
        desired = add(vR, scale(dirAim, approach));
        break;
      case 'gather':
        approach = Math.min(maxV, ceiling, 2.5 * len(toAim) + p.contactEntrySpeedMps);
        desired = add(vR, scale(dirAim, approach));
        break;
      case 'connect':
        approach = p.contactEntrySpeedMps;
        desired = add(vR, scale(dirAim, approach));
        break;
      case 'drive':
      default:
        approach = p.contactEntrySpeedMps;
        desired = add(vR, scale(dirToR, approach));
        break;
    }
    const desiredClamped = len(desired) > maxV ? scale(desired, maxV / len(desired)) : desired;
    const facing =
      this.phase === 'track' || this.phase === 'recover'
        ? dirToR
        : norm(sub(add(add(R, scale(lat, offsetC)), scale(nearDir, -1.0)), S), neg(nearDir));
    return {
      locomotion: { desiredVelocityWorld: desiredClamped, desiredFacingWorld: facing, effort: 1 },
      debug: {
        phase: this.phase,
        aim,
        trackAim,
        fitAim,
        predictedHip: hipNearH,
        leverageLat: lat,
        approachAxis: nearDir,
        selectedShoulder: this.spec.shoulder,
        fitCompatible,
        shoulderLanding,
        headClearance,
        gap,
        horizon: h,
        entryCeiling: ceiling,
        approach,
        readyHands: this.phase !== 'track',
        firstContactT: this.firstContactT,
      },
    };
  }

  exportParams(): unknown {
    return { ...this.spec, resolved: this.p, motorId: this.motor.id, massKg: this.massKg };
  }
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const r: Partial<T> = {};
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] !== undefined) r[k] = o[k];
  return r;
}
