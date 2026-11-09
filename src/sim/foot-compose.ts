// Plan 10f (F10): the composed foot owners, split out of footwork.ts: following the request (seeded from the achieved
// foot, a decaying offset), the airborne chase, the published step motion, the step that carries a held leg's path,
// the per-substep request bookkeeping, and the foot angle and pole weights (the sole). footwork.ts keeps the planner
// (plants, reactive and clip-regime steps, their timing and destinations, observation) and calls these; nothing here
// calls back into it.
import type { ArmSide } from './contracts';
import type { FootPlan, FootPlanInput, FootState } from './footwork';
import type { FootRequest } from './pose';
import { boundedHorizon, HORIZONTAL, limitH, quinticStep, stepAccelMax, VERTICAL } from './step-path';
import { add, addScaled, clamp, dist, horiz, len, scale, sub, v3, wrapPi, type Vec3 } from './vec';

const SIDES: ArmSide[] = ['left', 'right'];

export function startFollow(plan: FootPlan, f: FootState, request: Vec3): void {
  f.mode = f.mode === 'airborne' ? 'airborne' : 'swing';
  f.source = 'follow';
  seedFollow(plan, f, request);
  f.dest = null;
}

/** Faster than any limb: the request itself jumped (its source changed), so it has no velocity to inherit. */
export const REQUEST_JUMP_MPS = 15;

/** Plan 08: the largest velocity change of one substep a foot takes joining the request (m/s of the bounded recovery above rejoinMps). */
export const HANDOVER_M = 0.008;

/**
 * Composed: a leg held off its target by another body (a clearance candidate, or pushed off it): it is mid-correction. Plan 12:
 * the floor lift of a foot at its ankle range limit is not a hold (the foot stands on its toe over the target; counted, a toe
 * dragged at the limit never handed back to the clip: L3-F7-phase25 R's right foot, a step from 1.06 s to the end of the run).
 */
export const heldOff = (plan: FootPlan, f: FootState): boolean => f.ownN > 0 && (f.variant !== 0 || dist(f.rangeLiftM > 0 ? v3(f.solvedW.x, f.solvedW.y - f.rangeLiftM, f.solvedW.z) : f.solvedW, f.target) > plan.profile.plantTolM);

/**
 * Composed: an owner that may hand its foot on. A held leg is mid-correction, and an owner of one substep has shown only the motion
 * it took over: a handover there is not from anything the owner has established. Where the foot has a choice it keeps its owner.
 */
export const handsOn = (plan: FootPlan, f: FootState): boolean => !heldOff(plan, f) && f.ownN > 1;

/** Composed: following the request now keeps the foot's motion within the bounded recovery and the transition limit. */
export function canFollow(plan: FootPlan, f: FootState): boolean {
  const rv = len(f.requestV) > REQUEST_JUMP_MPS ? v3() : f.requestV;
  const v = f.mode !== 'planted' && f.source === 'step' ? v3(f.stepH.v.x, f.stepY.v, f.stepH.v.z) : f.ankleV;
  return (len(sub(v, rv)) - plan.profile.rejoinMps) * plan.dtS <= HANDOVER_M;
}

/**
 * A trial copy of one foot's plan: nothing run on it reaches the live plan. Plan 10b: both feet and the stats are copied
 * whole (the trial step reads the other foot, and the stats hold per-foot records), so the trial cannot reach them either.
 */
export function trialOf(plan: FootPlan, _s: ArmSide): FootPlan {
  return { ...plan, stats: structuredClone(plan.stats), feet: structuredClone(plan.feet) };
}

/** Composed: where following the request puts this foot this substep, from its offset or (seed) newly from the achieved foot. */
export function followNext(plan: FootPlan, s: ArmSide, inp: FootPlanInput, seed: boolean): Vec3 {
  const t = trialOf(plan, s);
  const f = t.feet[s];
  if (seed) seedFollow(t, f, inp.request[s]);
  decayOffset(t, f, inp.dt);
  return add(inp.request[s], f.offset);
}

/**
 * Composed: an airborne foot the request is moving too differently from keeps its own motion on a receding minimum-jerk path
 * toward the request, within the step's caps, until it can follow (no plant, no destination: there is no ground to land on).
 */
export function chase(plan: FootPlan, s: ArmSide, inp: FootPlanInput): void {
  const f = plan.feet[s];
  const dt = inp.dt;
  const C = plan.profile.compose!;
  const T = C.landWithinS;
  const q = inp.request[s];
  const prev = f.target;
  // plan 10b: within the step's acceleration limits, horizontal as a planner step on the ground, vertical the lift's
  const aMax = stepAccelMax(C, inp.vel);
  const a0 = limitH(f.stepH.a, aMax);
  const ay = clamp(f.stepY.a, -C.liftAccelMps2, C.liftAccelMps2);
  const vy = endRateY(f, ay, dt);
  const TH = boundedHorizon(HORIZONTAL, prev, f.stepH.v, a0, q, T, dt, aMax);
  const TV = boundedHorizon(VERTICAL, prev, v3(0, vy, 0), v3(0, ay, 0), q, T, dt, C.liftAccelMps2);
  const x = quinticStep(prev.x, f.stepH.v.x, a0.x, q.x, TH, dt);
  const y = quinticStep(prev.y, vy, ay, q.y, TV, dt);
  const z = quinticStep(prev.z, f.stepH.v.z, a0.z, q.z, TH, dt);
  publishStep(plan, f, inp, v3(x.p, y.p, z.p), v3(x.v, y.v, z.v), v3(x.a, y.a, z.a));
  // plan 10b: the chase's own last motion, as a step's (a chase that lands and then loses support again goes on from it)
  if (dt > 0) f.moveV = v3((f.target.x - prev.x) / dt, 0, (f.target.z - prev.z) / dt);
}

/**
 * Plan 10b: a step's stored vertical rate is the published one, its mean over the last substep; a vertical path planned
 * from it starts from the rate at the end of that substep (half a substep of its acceleration on). Started from the mean
 * rate, each replan kept only half of the planned acceleration, and a continued swing could not turn its rise in time
 * (L3-F7-phase0 R right from 0.575 s: still rising at 0.83 m after 0.4 s, a skipped stance).
 */
export function endRateY(f: FootState, ay: number, dt: number): number {
  return f.stepY.v + 0.5 * ay * dt;
}

/**
 * Composed: a step owner's next target within the step's speed and lift caps, recorded as published. Where a cap takes over the
 * stored motion is the accepted one, so the next path does not start from motion that never happened.
 */
function publishStep(plan: FootPlan, f: FootState, inp: FootPlanInput, next: Vec3, v: Vec3, a: Vec3): void {
  const P = plan.profile;
  const dt = inp.dt;
  const prev = f.target;
  const vCap = P.swing.maxSpeedMps + P.swing.travelSpeedK * len(horiz(inp.vel));
  const wide = v3(next.x - prev.x, 0, next.z - prev.z);
  const m = len(wide);
  const flat = m > vCap * dt;
  const move = flat ? scale(wide, (vCap * dt) / m) : wide;
  const cap = P.swing.maxLiftRateMps * dt;
  const dy = clamp(next.y - prev.y, -cap, cap);
  const level = Math.abs(next.y - prev.y) > cap;
  f.target = v3(prev.x + move.x, prev.y + dy, prev.z + move.z);
  if (dt <= 0) return;
  // (plan 10b: the stored vertical rate is the published one, as advanceStep stores it; at the speed cap the planner's
  // acceleration is kept, as advanceStep keeps it)
  f.stepH = { v: v3(flat ? move.x / dt : v.x, 0, flat ? move.z / dt : v.z), a: v3(a.x, 0, a.z) };
  f.stepY = { v: dy / dt, a: level ? 0 : a.y };
  f.speedMps = len(move) / dt;
  f.liftRateMps = Math.abs(dy) / dt;
  plan.stats.stepCapMarginMps = Math.min(plan.stats.stepCapMarginMps, vCap - f.speedMps);
  plan.stats.liftRateMps = Math.max(plan.stats.liftRateMps, f.liftRateMps);
}

/** The offset of a foot joining the request: composed, from the achieved ankle and its velocity; else from the target. */
export function seedFollow(plan: FootPlan, f: FootState, request: Vec3): void {
  if (plan.profile.compose) {
    // against the request of the achieved ankle's substep: this substep's decay then advances both to the present
    const rv = len(f.requestV) > REQUEST_JUMP_MPS ? v3() : f.requestV;
    f.target = { ...f.solvedW };
    f.offset = sub(f.solvedW, addScaled(request, rv, -plan.dtS));
    f.offsetV = sub(f.ankleV, rv);
    seedSole(f);
  } else f.offset = sub(f.target, request);
}

/** The foot keeps its achieved angle when its owner changes (the shoe of a rolled plant stays clear of the floor). */
function seedSole(f: FootState): void {
  f.soleO = wrapPi(f.soleAngle - f.soleBase);
  f.soleV = 0;
  f.seeds++;
  f.ownN = 0;
  f.carried = false;
  f.carryFirst = false;
}

/** The composed foot angle offset and pole weight of this substep on every request (critically damped). */
export function finishSole(plan: FootPlan, out: Record<ArmSide, FootRequest>, dt: number): void {
  const C = plan.profile.compose;
  if (!C) return;
  for (const s of SIDES) {
    const f = plan.feet[s];
    const w = C.followRadPerS;
    f.ownN++;
    f.soleV += (-w * w * f.soleO - 2 * w * f.soleV) * dt;
    f.soleO += f.soleV * dt;
    const r = out[s];
    r.soleO = f.soleO;
    f.poleWV += (w * w * ((r.kind === 'offset' ? 0 : 1) - f.poleW) - 2 * w * f.poleWV) * dt;
    f.poleW = clamp(f.poleW + f.poleWV * dt, 0, 1);
    r.poleW = f.poleW;
    f.soleWV += (w * w * ((r.kind === 'target' ? 0 : 1) - f.soleW) - 2 * w * f.soleWV) * dt;
    f.soleW = clamp(f.soleW + f.soleWV * dt, 0, 1);
    r.soleW = f.soleW;
    r.seed = f.seeds;
    f.carried &&= r.kind === 'target';
    r.carried = f.carried;
    if (r.kind === 'offset') r.headingRad = f.headingRad;
  }
}

/**
 * Composed: this substep's ordinary requests and their velocity, on every foot, whoever owns it. `composition` is the support
 * state the request was built on: the live plan passes it, a request of the old composition (the audit's) does not.
 */
export function takeRequests(plan: FootPlan, inp: FootPlanInput, composition?: string): void {
  if (!plan.profile.compose) return;
  // the request is built differently from here (support lost or regained, falling)
  const seam = composition !== undefined && plan.composition !== undefined && composition !== plan.composition;
  if (composition !== undefined) plan.composition = composition;
  for (const s of SIDES) {
    const f = plan.feet[s];
    const q = inp.request[s];
    const was = f.requestV;
    f.requestWasV = was;
    f.seamOffset = v3();
    f.requestV = f.lastRequest && inp.dt > 0 ? scale(sub(q, f.lastRequest), 1 / inp.dt) : v3();
    // the request itself jumped (its source changed): a following foot carries on as it was going, the offset takes it up (a leg
    // held off its target has none of the request's motion to carry on: it stays where it is)
    if (f.lastRequest && (seam || len(f.requestV) > REQUEST_JUMP_MPS)) {
      if (f.source === 'follow') {
        f.seamOffset = sub(heldOff(plan, f) ? f.lastRequest : addScaled(f.lastRequest, was, inp.dt), q);
        f.offset = add(f.offset, f.seamOffset);
      }
      f.requestV = was;
    }
    f.lastRequest = q;
  }
}

/**
 * Plan 08: a step taking over a leg held off its target (a planner seed from the achieved foot would take the departure away at
 * once, with the foot jammed against another body) goes on from the old owner's path: this substep's target is the old owner's
 * and the leg keeps its departure, so nothing changes at the handover; the path runs on from there at the motion it had. The
 * step owns this update, so its caps hold from here: where the old path was moving faster the target falls behind it by the
 * difference. A cap that took over leaves the accepted motion for the path to go on from.
 */
export function carryPath(plan: FootPlan, s: ArmSide, inp: FootPlanInput): void {
  const f = plan.feet[s];
  f.stepH = { v: v3(), a: v3() };
  f.stepY = { v: 0, a: 0 };
  if (!f.wait) publishStep(plan, f, inp, followNext(plan, s, inp, false), add(f.requestWasV, f.offsetV), v3());
  f.moveV = horiz(f.stepH.v);
  f.lateS = 0;
  f.liftO = 0;
  f.liftV = 0;
  f.carried = true;
  f.carryFirst = true;
}

/** A planner step of a composed profile starts from the achieved ankle and its velocity. */
export function seedStep(plan: FootPlan, f: FootState): void {
  if (!plan.profile.compose) return;
  f.target = { ...f.solvedW };
  f.stepH = { v: horiz(f.ankleV), a: v3() };
  f.stepY = { v: f.ankleV.y, a: 0 };
  f.moveV = horiz(f.ankleV);
  f.lateS = 0;
  f.liftO = 0;
  f.liftV = 0;
  seedSole(f);
}

export function decayOffset(plan: FootPlan, f: FootState, dt: number): void {
  const P = plan.profile;
  const C = P.compose;
  if (C) {
    // critically damped toward the request from the seeded offset and rate (semi-implicit; dt 0 holds), at most rejoinMps:
    // the stored rate is the accepted one
    const w = C.followRadPerS;
    const v = addScaled(f.offsetV, add(scale(f.offset, -w * w), scale(f.offsetV, -2 * w)), dt);
    const m = len(v);
    f.offsetV = m > P.rejoinMps ? scale(v, P.rejoinMps / m) : v;
    f.offset = addScaled(f.offset, f.offsetV, dt);
    plan.stats.offsetDecayMps = Math.max(plan.stats.offsetDecayMps, len(f.offsetV));
    return;
  }
  const L = len(f.offset);
  if (L <= 0) return;
  const step = P.rejoinMps * dt;
  f.offset = L <= step ? v3() : addScaled(v3(), f.offset, (L - step) / L);
}

/** Composed: time a foot needs to come down from its height within the lift rate (a minimum-jerk descent peaks at 1.875 x its mean rate). */
export function descentS(plan: FootPlan, f: FootState, inp: FootPlanInput): number {
  return (1.9 * Math.max(0, f.target.y - (inp.groundY + inp.soleM))) / plan.profile.swing.maxLiftRateMps;
}
