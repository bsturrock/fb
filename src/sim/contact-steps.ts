// Plan 15 (contact footwork): one stepping model for a supported player once the clip regime ends (contact hold or
// braking), in place of the reactive planner. Per substep, three rules:
// - Free ground (free-ground.ts): where a foot may stand, the ground minus the other players' moving footprints.
// - Where. Each foot's support point is where the hips need it given their real motion now, the capture point
//   home + v sqrt(h / g) (home: the foot's place under its hip, with its side offset and stagger; a hit or a lean is
//   already in v), taken where the hips will be when the foot lands (moved along v for the time left). Its aim is that
//   point limited to a short step from the hip, then moved to the nearest free ground. A foot in the air follows its aim
//   at a bounded rate that falls to zero at touchdown (the foot commits as it lands).
// - When. The stance holds while each planted foot is within coverM of its aim now and within reach; otherwise the foot
//   farther from its aim steps. A stance foot does not lift while the other is in the air. A step's time comes from
//   its length, at a foot speed that grows with the travel (stepMps + travelK |v|, between minS and maxS), and never
//   changes; when it is up the foot lands where the leg is. A plant past its reach slides toward the hip (a drag)
//   instead of lifting.
// Nothing is held off, retimed, re-picked or remembered: a foot is planted or in a step that will land. The leg solve
// gets the same requests as from the old planner (FootRequest) and observeFeet measures the pose as before; under the
// model a plant is never released by its solve.
import type { ArmSide } from './contracts';
import { seedStep } from './foot-compose';
import type { FootEvent, FootPlan, FootPlanInput, FootReason, FootworkProfile } from './footwork';
import { nearestFree, type FootQuery } from './free-ground';
import type { FootRequest } from './pose';
import { quinticStep } from './step-path';
import { add, clamp, dist, headingOf, len, qRot, rad, round, sub, v3, wrapPi, type Vec3 } from './vec';

export interface StepModelProfile {
  id: string;
  /** Where: the longest step, the aim's horizontal distance from the hip (m); the reach at the stance height bounds it too. */
  maxStepM: number;
  /** When: a planted foot covers its aim within this (m, horizontal). */
  coverM: number;
  /**
   * When: a step's time is its length (m, the distance its foot travels) over the foot's speed, stepMps + travelK x the
   * travel speed (m/s; a foot keeping up with a moving body swings at about twice its speed), between minS and maxS (s).
   */
  stepMps: number;
  travelK: number;
  minS: number;
  maxS: number;
  /** Where: a foot in the air follows its aim at most this fast (m/s), the bound falling to zero at touchdown. */
  followMps: number;
  /** A full-length step's peak lift (m); a shorter step lifts less, down to a third; a foot already up lifts no more. */
  liftM: number;
  /** Free ground: the foot's radius about its shoe centre (m). */
  footR: number;
}

/**
 * Short and quick: at most 0.4 m from the hip (a stride under the hips, not a lunge), a step of 0.3 m in 0.19 s from
 * still, every step within 0.16-0.3 s (a quick shuffle; the old planner's 0.2-0.34 s, before its retimers). At 4 m/s a
 * foot swings at 9.6 m/s, so a stride lands before the stance foot behind it runs out of reach (about 0.2 s). A stance
 * stays while each foot is within 12 cm of its aim (the old step trigger, 14 cm). The foot radius covers the shoe's width
 * and most of its length.
 */
export const STEPS_V1: StepModelProfile = { id: 'steps-v1', maxStepM: 0.4, coverM: 0.12, stepMps: 1.6, travelK: 2, minS: 0.16, maxS: 0.3, followMps: 2, liftM: 0.07, footR: 0.1 };

/** The footwork profile with the contact stepping model, under an id that names it (a profile without compose is returned as it is). */
export const withSteps = (f: FootworkProfile, m: StepModelProfile = STEPS_V1): FootworkProfile => (!f.compose || f.steps ? f : { ...f, id: `${f.id}+${m.id}`, steps: m });
/** The footwork profile without it. */
export const withoutSteps = (f: FootworkProfile): FootworkProfile => {
  if (!f.steps) return f;
  const { steps: m, ...rest } = f;
  return { ...rest, id: f.id.replace(`+${m.id}`, '') };
};

/** A foot's state under the model (`FootState.contact`, written only under it). */
export interface ContactFoot {
  /** The current or last step: its time (s), its start height above the sole height (m) and vertical rate (m/s), its lift (m). */
  T: number;
  h0: number;
  vy0: number;
  liftM: number;
  /** This substep's support point and aim (ankle, world, at the sole height). */
  support: Vec3;
  aim: Vec3;
  /** Planted: how far the plant has slid since it landed (m). */
  slideM: number;
}

const SIDES: ArmSide[] = ['left', 'right'];
const G = 9.81;
const other = (s: ArmSide): ArmSide => (s === 'left' ? 'right' : 'left');
const hz = (a: Vec3): Vec3 => v3(a.x, 0, a.z);
const headingNow = (inp: FootPlanInput): number => headingOf(qRot(inp.core.q, v3(0, 0, 1)));
const stepTime = (plan: FootPlan, inp: FootPlanInput, L: number): number => {
  const M = plan.profile.steps!;
  return clamp(L / (M.stepMps + M.travelK * len(hz(inp.vel))), M.minS, M.maxS);
};

/** The model's substep: the feet's requests for the leg solve (planFeet calls it outside the clip regime). */
export function stepFeet(plan: FootPlan, inp: FootPlanInput, ev: FootEvent[]): Record<ArmSide, FootRequest> {
  const P = plan.profile;
  const entering = !plan.stepsOwn;
  plan.stepsOwn = true;
  plan.clipLast = false;
  for (const s of SIDES) {
    const f = plan.feet[s];
    f.clipSwingP = null;
    f.rejoin = f.wait = f.inherited = f.released = f.tentative = false;
    // taking over: a plant stays where it is; a foot in the air steps from where it is, at its motion
    if (f.mode === 'planted' && (entering || !f.contact)) f.contact = { T: 0, h0: 0, vy0: 0, liftM: 0, support: v3(), aim: v3(), slideM: 0 };
    else if (f.mode !== 'planted' && (entering || !f.contact)) begin(plan, s, inp, ev, 'continue');
  }
  // When: the stance holds while both plants cover their aims; else the farther foot steps
  if (plan.feet.left.mode === 'planted' && plan.feet.right.mode === 'planted') {
    const gap = { left: stanceGap(plan, 'left', inp), right: stanceGap(plan, 'right', inp) };
    if (gap.left > P.steps!.coverM || gap.right > P.steps!.coverM) {
      const far: ArmSide = gap.right > gap.left || (gap.right === gap.left && plan.lastStep === 'left') ? 'right' : 'left';
      // (FootDebug.stepsPickNearer, a fault: the nearer foot steps)
      begin(plan, inp.debug?.stepsPickNearer ? other(far) : far, inp, ev, 'step');
    }
  }
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode !== 'swing') continue;
    advanceContactStep(plan, s, inp);
    if (f.elapsedS >= f.contact!.T - 1e-9) land(plan, s, inp, ev);
  }
  const out = {} as Record<ArmSide, FootRequest>;
  for (const s of SIDES) {
    const f = plan.feet[s];
    f.eligible = f.mode === 'planted';
    if (f.mode !== 'planted') {
      out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad };
      continue;
    }
    slide(plan, s, inp);
    f.target = add(f.heelW!, v3(0, inp.soleM, 0));
    out[s] = { kind: 'plant', heelW: f.heelW!, headingRad: f.headingRad, rollF: f.rollF, toeZ: f.toeZ, edgeX: f.edgeX, tolM: P.plantTolM };
  }
  return out;
}

/**
 * Where: foot `s`'s support point and its aim for a landing `aheadS` from now: the hips and the free ground moved that
 * far along their motion. The free ground is asked at the shoe's centre (along the body heading) with the foot's radius
 * and its other foot's side wall (no crossing); with no free ground within the step, the aim is the limited support point.
 */
function aimOf(plan: FootPlan, s: ArmSide, inp: FootPlanInput, aheadS: number): { support: Vec3; aim: Vec3 } {
  const P = plan.profile;
  const M = P.steps!;
  const sole = inp.groundY + inp.soleM;
  const hip = v3(inp.hips[s].x + inp.vel.x * aheadS, inp.hips[s].y, inp.hips[s].z + inp.vel.z * aheadS);
  const lead = aheadS + Math.sqrt(Math.max(0, hip.y - inp.groundY) / G);
  const support = v3(inp.home[s].x + inp.vel.x * lead, sole, inp.home[s].z + inp.vel.z * lead);
  // a short step from the hip, within the reach at the stance height
  const vert = hip.y - sole;
  const rMax = Math.min(M.maxStepM, Math.sqrt(Math.max(0, (plan.reachM - 2 * P.reachMarginM) ** 2 - vert * vert)));
  const off = hz(sub(support, hip));
  const L = len(off);
  const want = L > rMax ? v3(hip.x + (off.x * rMax) / L, sole, hip.z + (off.z * rMax) / L) : support;
  const h = headingNow(inp);
  const c = v3(Math.sin(h) * plan.shoe.centerFoot.z, 0, Math.cos(h) * plan.shoe.centerFoot.z);
  const o = plan.feet[other(s)];
  const at = o.mode === 'planted' ? o.heelW! : (o.dest ?? o.target);
  const q: FootQuery = { clearM: M.footR, wall: { p: { x: at.x + c.x, z: at.z + c.z }, n: { x: inp.rightW.x * inp.sideSign[s], z: inp.rightW.z * inp.sideSign[s] }, sepM: P.minSeparationM } };
  const free = nearestFree(inp.ground ?? { prints: [] }, add(want, c), add(hip, c), rMax, aheadS, q);
  return { support, aim: free ? v3(free.x - c.x, sole, free.z - c.z) : want };
}

/** Where, for a step from `from`: its time (from its length) and its aim for a landing then. */
function aimFrom(plan: FootPlan, s: ArmSide, inp: FootPlanInput, from: Vec3): { support: Vec3; aim: Vec3; T: number } {
  // (the length depends on the landing time and the time on the length: twice round from the shortest step)
  let T = plan.profile.steps!.minS;
  for (let i = 0; i < 2; i++) T = stepTime(plan, inp, dist(from, aimOf(plan, s, inp, T).aim));
  return { ...aimOf(plan, s, inp, T), T };
}

/** When: how far a plant is from its aim now (m, horizontal); past its reach, Infinity. */
function stanceGap(plan: FootPlan, s: ArmSide, inp: FootPlanInput): number {
  const f = plan.feet[s];
  const ankle = add(f.heelW!, v3(0, inp.soleM, 0));
  const { support, aim } = aimOf(plan, s, inp, 0);
  f.contact!.support = support;
  f.contact!.aim = aim;
  return dist(ankle, inp.hips[s]) > plan.reachM ? Infinity : len(hz(sub(ankle, aim)));
}

/** When: foot `s` lifts (or, in the air, is taken over) for a step to its aim, from the achieved ankle at its motion. */
function begin(plan: FootPlan, s: ArmSide, inp: FootPlanInput, ev: FootEvent[], why: FootReason): void {
  const M = plan.profile.steps!;
  const f = plan.feet[s];
  if (f.mode === 'planted') {
    ev.push({ type: 'footRelease', side: s, data: { reason: why, driftM: round(f.driftM, 5), featureErrM: round(f.featureErrM, 5), plantedS: round(inp.t - f.plantedAtS, 5), solves: f.solves, slideM: round(f.contact?.slideM ?? 0, 5) } });
    f.releaseReason = why;
    f.releaseAtS = inp.t;
    f.heelW = f.anchorW = null;
  }
  f.mode = 'swing';
  f.source = 'step';
  f.why = why;
  f.drag = f.short = false;
  seedStep(plan, f);
  const { support, aim, T } = aimFrom(plan, s, inp, f.target);
  const L = dist(f.target, aim);
  const h0 = Math.max(0, f.target.y - (inp.groundY + inp.soleM));
  f.contact = { T, h0, vy0: f.stepY.v, liftM: Math.max(0, M.liftM * clamp(L / M.maxStepM, 1 / 3, 1) - h0), support, aim, slideM: 0 };
  f.elapsedS = 0;
  f.durS = T;
  f.dest = aim;
  f.stepM = L;
  f.destHeadingRad = headingNow(inp);
  plan.lastStep = s;
  ev.push({ type: 'footSwing', side: s, data: { mode: 'swing', source: 'step', reason: why, durS: round(T, 4), stepM: round(L, 4) } });
}

/**
 * One substep of foot `s`'s step: the destination follows the aim at a bounded rate falling to zero at touchdown; the
 * target moves along the minimum-jerk path from where it is, at its motion, to the destination in the time left; its
 * height is the descent from the start height and rate to the sole at rest over the step, plus the lift arc. Exported
 * for the transition audit (`continueOwners`).
 */
export function advanceContactStep(plan: FootPlan, s: ArmSide, inp: FootPlanInput): void {
  const P = plan.profile;
  const M = P.steps!;
  const f = plan.feet[s];
  const c = f.contact!;
  const dt = inp.dt;
  const sole = inp.groundY + inp.soleM;
  const left = Math.max(c.T - f.elapsedS, dt);
  ({ support: c.support, aim: c.aim } = aimOf(plan, s, inp, left));
  const d = hz(sub(c.aim, f.dest!));
  const dl = len(d);
  const k = M.followMps * dt * clamp((c.T - f.elapsedS) / c.T, 0, 1);
  f.dest = dl > k ? v3(f.dest!.x + (d.x * k) / dl, sole, f.dest!.z + (d.z * k) / dl) : v3(c.aim.x, sole, c.aim.z);
  const prev = f.target;
  const x = quinticStep(prev.x, f.stepH.v.x, f.stepH.a.x, f.dest.x, left, dt);
  const z = quinticStep(prev.z, f.stepH.v.z, f.stepH.a.z, f.dest.z, left, dt);
  f.elapsedS += dt;
  const p = Math.min(f.elapsedS / c.T, 1);
  const down = quinticStep(c.h0, c.vy0, 0, 0, c.T, Math.min(f.elapsedS, c.T));
  const y = sole + down.p + c.liftM * Math.sin(Math.PI * p) ** 2;
  f.target = v3(x.p, y, z.p);
  if (dt > 0) {
    f.stepH = { v: v3(x.v, 0, z.v), a: v3(x.a, 0, z.a) };
    f.stepY = { v: (y - prev.y) / dt, a: down.a + 2 * c.liftM * (Math.PI / c.T) ** 2 * Math.cos(2 * Math.PI * p) };
    f.moveV = v3((x.p - prev.x) / dt, 0, (z.p - prev.z) / dt);
    f.speedMps = len(f.moveV);
    f.liftRateMps = Math.abs(f.stepY.v);
  }
  const turn = rad(P.swing.maxYawRateDegPerS) * dt;
  f.destHeadingRad = headingNow(inp);
  f.headingRad += clamp(wrapPi(f.destHeadingRad - f.headingRad), -turn, turn);
}

/** When: the step's time is up: the foot lands where the leg is this substep (the achieved ankle at its motion), flat. */
function land(plan: FootPlan, s: ArmSide, inp: FootPlanInput, ev: FootEvent[]): void {
  const f = plan.feet[s];
  const here = add(f.ankleW, v3(f.ankleV.x * inp.dt, 0, f.ankleV.z * inp.dt));
  f.mode = 'planted';
  f.solves = 0;
  f.rollF = 0;
  f.toeZ = inp.toeM;
  f.edgeX = 0;
  f.heelW = v3(here.x, inp.groundY, here.z);
  f.anchorW = { ...f.heelW };
  f.featureW = { ...f.heelW };
  f.plantedAtS = inp.t;
  f.dest = null;
  f.offset = v3();
  f.driftM = f.featureErrM = 0;
  f.contact!.slideM = 0;
  f.attempts++;
  plan.stats.attempts++;
  plan.stats.confirmed++;
  ev.push({ type: 'footPlant', side: s, data: { at: [round(here.x, 4), round(inp.groundY, 4), round(here.z, 4)], headingDeg: round((f.headingRad * 180) / Math.PI, 2), rollF: 0, errM: 0 } });
}

/** A plant past its reach slides toward the hip until it is back within it (a drag), instead of lifting. */
function slide(plan: FootPlan, s: ArmSide, inp: FootPlanInput): void {
  const f = plan.feet[s];
  const hip = inp.hips[s];
  const ankle = add(f.heelW!, v3(0, inp.soleM, 0));
  f.drag = dist(ankle, hip) > plan.reachM;
  if (!f.drag) return;
  const off = hz(sub(ankle, hip));
  const L = len(off);
  const r = Math.sqrt(Math.max(0, plan.reachM ** 2 - (hip.y - ankle.y) ** 2));
  const to = L > 1e-9 ? v3(hip.x + (off.x * r) / L, inp.groundY, hip.z + (off.z * r) / L) : v3(hip.x, inp.groundY, hip.z);
  f.contact!.slideM += len(hz(sub(to, f.heelW!)));
  f.heelW = to;
  f.anchorW = { ...to };
}
