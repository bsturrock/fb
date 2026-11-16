// Plan 15 (contact footwork): one stepping model for a supported player once the clip regime ends (contact hold or
// braking), in place of the reactive planner. Per substep, three rules:
// - Free ground (free-ground.ts): where a leg can stand, the ground minus the other players' moving footprints, with the
//   whole leg on the place (thigh, shin, shoe, as the leg solve gives it: pose.ts plannedLeg) clear of their parts and
//   inside its joint ranges (`inRange`). That is the one test of a place, for a plant as for an aim.
// - Where. Each foot's want is where the hips need it given their real motion now, the capture point home + v sqrt(h / g)
//   (home: the foot's place under its hip, with its side offset and stagger; a hit or a lean is already in v), taken
//   where the hips will be when the foot lands (moved along v for the time left), limited to a short step from the hip.
//   Its aim is the nearest free place to its want within the short step, and with none there, within the leg's reach
//   (none when there is no free place within either). A foot in the air follows its aim at a bounded rate that falls to
//   zero at touchdown (the foot commits as it lands); with no aim, it steps under its hip (the shortest step). With an
//   aim its path keeps to free ground: a move into another player's footprint slides along its edge (`onFreeGround`).
// - When. A planted foot never moves on the ground: it stands or it steps. It stands while its leg is in range and lifts
//   the moment it is not, whatever the other foot does: that is the only way both feet are in the air (a flight, as in
//   running), and it ends when the other foot's step lands, within one step time. Otherwise, with both feet
//   down, a foot steps when stepping improves its support by more than coverM (its aim is that much nearer its want than
//   its plant is; a plant its leg no longer stands clear on is as far as can be), and they take turns: the foot that
//   stepped last steps again only when its plant no longer stands clear. A step's time comes from its length, at a foot
//   speed that grows with the travel (stepMps + travelK |v|, between minS and maxS), and never changes; the foot turns
//   onto the body's heading over it; when it is up the foot lands where the leg is, the plant taken at the foot as shown
//   (its lowest sole corner on the ground where it is).
// Nothing is held off, retimed, re-picked or remembered: a foot is planted or in a step that will land. A foot is bound
// when it cannot follow the hips: its plant is more than coverM from its want or out of range, or it is in the air, and
// no free place is within its reach. The fall triggers read that (legsBound, standsNowhere): the legs are bound while a
// foot cannot follow the hips, and the player stands nowhere while neither can. The leg solve shows the feet where the
// model asks (FootRequest, `exact`): the leg guard never moves them (a plant's knee may turn to another pole); a body
// coming into a standing leg is the model's to answer, by stepping. observeFeet measures the pose as before; under the
// model a plant is never released by its solve.
import type { ArmSide } from './contracts';
import { seedStep } from './foot-compose';
import type { FootEvent, FootPlan, FootPlanInput, FootReason, FootworkProfile } from './footwork';
import { isFree, nearestFree, type FootQuery } from './free-ground';
import { armTwistRad, swingExcess } from './joint-cone';
import { flexReach, maxFlexRad, plannedChain, plannedLeg, type FootRequest } from './pose';
import { quinticStep } from './step-path';
import { add, clamp, dist, headingOf, len, norm, qInvRot, qRot, rad, round, sub, v3, wrapPi, type Quat, type Vec3 } from './vec';

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
  /** Free ground: the foot's radius about its shoe centre (m), and how clear of every other player's part its leg must stand (m). */
  footR: number;
  legSkinM: number;
}

/**
 * Short and quick: at most 0.4 m from the hip (a stride under the hips, not a lunge), a step of 0.3 m in 0.19 s from
 * still, every step within 0.16-0.3 s (a quick shuffle; the old planner's 0.2-0.34 s, before its retimers). At 4 m/s a
 * foot swings at 9.6 m/s, so a stride lands before the stance foot behind it runs out of reach (about 0.2 s). A stance
 * stays while stepping would bring a foot no more than 12 cm nearer its want (the old step trigger, 14 cm). The foot
 * radius covers the shoe's width and most of its length. The leg's skin (3 cm) covers how far the leg solve departs from
 * the planned leg toward a body in front (a plant's shoe at the ankle range lifts the ankle about 3 cm and brings the knee
 * forward about 4 cm; 90% within 2.8 cm over the L3 holds and drives), so a leg stood on clear is clear to the guard.
 */
export const STEPS_V1: StepModelProfile = { id: 'steps-v1', maxStepM: 0.4, coverM: 0.12, stepMps: 1.6, travelK: 2, minS: 0.16, maxS: 0.3, followMps: 2, liftM: 0.07, footR: 0.1, legSkinM: 0.03 };

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
  /** This substep's support point and aim (ankle, world, at the sole height; with no free place, the want or the destination). */
  support: Vec3;
  aim: Vec3;
  /** It cannot follow the hips: it needs a step (or is in one) and no free place is within its step. */
  bound: boolean;
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

/**
 * The fall triggers' reads under the model (simulation.ts: the bound-legs fall's clause (b), the ride-down's come-down),
 * in place of a foot held off or past its time, which cannot happen here (every step lands on time). The legs are bound
 * while a foot cannot follow the hips.
 */
export const legsBound = (plan: FootPlan): boolean => SIDES.some((s) => !!plan.feet[s].contact?.bound);
/** The player stands nowhere while neither foot can follow the hips (a flight is not that: a foot in the air with a free place to land is following). */
export const standsNowhere = (plan: FootPlan): boolean => SIDES.every((s) => !!plan.feet[s].contact?.bound);

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
    if (f.mode === 'planted' && (entering || !f.contact)) f.contact = { T: 0, h0: 0, vy0: 0, liftM: 0, support: v3(), aim: v3(), bound: false };
    else if (f.mode !== 'planted' && (entering || !f.contact)) begin(plan, s, inp, ev, 'continue');
  }
  // When: a plant that cannot stand lifts at once (FootDebug.stepsStanceWaits, a fault: not while the other foot is in
  // the air); with both standing, the foot that gains more steps if it gains more than coverM, but the foot that stepped
  // last only when its plant no longer stands clear: otherwise it is the other's turn (FootDebug.stepsNoTurns, a fault:
  // no turns)
  for (const s of SIDES) {
    const o = plan.feet[other(s)];
    if (plan.feet[s].mode === 'planted' && !canStand(plan, s, inp) && !(inp.debug?.stepsStanceWaits && o.mode !== 'planted')) begin(plan, s, inp, ev, 'reach');
  }
  const gain = { left: -Infinity, right: -Infinity };
  for (const s of SIDES) if (plan.feet[s].mode === 'planted') gain[s] = gainOf(plan, s, inp);
  if (plan.feet.left.mode === 'planted' && plan.feet.right.mode === 'planted') {
    const more: ArmSide = gain.right > gain.left || (gain.right === gain.left && plan.lastStep === 'left') ? 'right' : 'left';
    const turn = more === plan.lastStep && gain[more] < Infinity && !inp.debug?.stepsNoTurns ? other(more) : more;
    if (gain[turn] > P.steps!.coverM) begin(plan, turn, inp, ev, 'step');
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
      out[s] = { kind: 'target', ankleW: f.target, headingRad: f.headingRad, exact: true };
      continue;
    }
    f.target = add(f.heelW!, v3(0, inp.soleM, 0));
    out[s] = { kind: 'plant', heelW: f.heelW!, headingRad: f.headingRad, rollF: f.rollF, toeZ: f.toeZ, edgeX: f.edgeX, tolM: P.plantTolM, exact: true };
  }
  return out;
}

/**
 * Where: foot `s`'s support point, its want (the support point limited to a short step), its aim and the place under its
 * hip (`under`) for a landing `aheadS` from now: the hips and the free ground moved that far along their motion. The aim
 * is the nearest free place to the want within the short step, and with none there, within the leg's reach at the
 * stance height; with none there either, there is no aim. The free ground is asked at the shoe's centre (along the body
 * heading) with the foot's radius, its other foot's side wall (no crossing) and its leg from the hip there.
 */
function aimOf(plan: FootPlan, s: ArmSide, inp: FootPlanInput, aheadS: number): { support: Vec3; want: Vec3; aim: Vec3 | null; under: Vec3 } {
  const P = plan.profile;
  const M = P.steps!;
  const sole = inp.groundY + inp.soleM;
  const hip = v3(inp.hips[s].x + inp.vel.x * aheadS, inp.hips[s].y, inp.hips[s].z + inp.vel.z * aheadS);
  const lead = aheadS + Math.sqrt(Math.max(0, hip.y - inp.groundY) / G);
  const support = v3(inp.home[s].x + inp.vel.x * lead, sole, inp.home[s].z + inp.vel.z * lead);
  // a short step from the hip, within the knee's range at the stance height (the rest of the leg's ranges: `inRange`),
  // asked a margin inside the reach so the plant stands when it lands (the hips' motion over the step is a prediction)
  const vert = hip.y - sole;
  const reach = plan.reachM - P.reachMarginM;
  const rLegal = Math.sqrt(Math.max(0, reach ** 2 - vert * vert));
  const rMax = Math.min(M.maxStepM, rLegal);
  const off = hz(sub(support, hip));
  const L = len(off);
  const want = L > rMax ? v3(hip.x + (off.x * rMax) / L, sole, hip.z + (off.z * rMax) / L) : support;
  const h = headingNow(inp);
  const c = v3(Math.sin(h) * plan.shoe.centerFoot.z, 0, Math.cos(h) * plan.shoe.centerFoot.z);
  const o = plan.feet[other(s)];
  const at = o.mode === 'planted' ? o.heelW! : (o.dest ?? o.target);
  const R = inp.legs;
  const ankle = (p: Vec3): Vec3 => v3(p.x - c.x, sole, p.z - c.z);
  const leg = R ? { at: (p: Vec3) => plannedLeg(R, s, hip, ankle(p), h), skinM: M.legSkinM, inRange: (p: Vec3) => inRange(inp, s, hip, ankle(p), h, reach) } : undefined;
  const q: FootQuery = { clearM: M.footR, wall: { p: { x: at.x + c.x, z: at.z + c.z }, n: { x: inp.rightW.x * inp.sideSign[s], z: inp.rightW.z * inp.sideSign[s] }, sepM: P.minSeparationM }, ...(leg ? { leg } : {}) };
  const g = inp.ground ?? { prints: [] };
  // (FootDebug.stepsShortOnly, a fault: the short step alone)
  const free = nearestFree(g, add(want, c), add(hip, c), rMax, aheadS, q) ?? (rLegal > rMax && !inp.debug?.stepsShortOnly ? nearestFree(g, add(want, c), add(hip, c), rLegal, aheadS, q) : null);
  const under = v3(inp.home[s].x + inp.vel.x * aheadS, sole, inp.home[s].z + inp.vel.z * aheadS);
  return { support, want, aim: free ? v3(free.x - c.x, sole, free.z - c.z) : null, under };
}

/**
 * Where, for a step from `from`: its time (from its length) and its aim for a landing then; with no free place then, the
 * place under its hip then (a bound foot takes the shortest step: `boundAim`).
 */
function aimFrom(plan: FootPlan, s: ArmSide, inp: FootPlanInput, from: Vec3): { support: Vec3; aim: Vec3; bound: boolean; T: number } {
  // (the length depends on the landing time and the time on the length: twice round from the shortest step)
  const to = (T: number) => {
    const a = aimOf(plan, s, inp, T);
    return { support: a.support, aim: a.aim ?? boundAim(inp, a), bound: !a.aim };
  };
  let T = plan.profile.steps!.minS;
  for (let i = 0; i < 2; i++) T = stepTime(plan, inp, dist(from, to(T).aim));
  return { ...to(T), T };
}

/**
 * Where a bound foot goes: under its hip, the shortest step (FootDebug.stepsBoundWant, a fault: its want, as before plan 15
 * round 3, into whatever bars it).
 */
const boundAim = (inp: FootPlanInput, a: { want: Vec3; under: Vec3 }): Vec3 => (inp.debug?.stepsBoundWant ? a.want : a.under);

/** When: a plant can stand while its leg is inside its joint ranges (`inRange`). */
const canStand = (plan: FootPlan, s: ArmSide, inp: FootPlanInput): boolean => inRange(inp, s, inp.hips[s], add(plan.feet[s].heelW!, v3(0, inp.soleM, 0)), plan.feet[s].headingRad, plan.reachM);

/**
 * The leg's own part of the standable test (free ground asks the rest: the leg clear of the other players): the leg the
 * solve gives a plant at `ankle` from `hip` (pose.ts plannedChain, the shoe on heading `h`) is inside its joint ranges.
 * The knee between its fold and its reach (hip to ankle within `reachM`, the plant reach); under a range profile with a
 * hip range (`hipTwist`), the thigh inside the hip's swing cone and its rotation inside the hip's twist range less its
 * margin, in the core frame. The ankle's range bars no place: past its dorsiflexion the heel lifts, as the pose has it.
 */
function inRange(inp: FootPlanInput, s: ArmSide, hip: Vec3, ankle: Vec3, h: number, reachM: number): boolean {
  const L = dist(ankle, hip);
  const R = inp.legs;
  // (the search's reach circle is this reach on the ground: rounding only)
  if (L > reachM + 1e-7 || (R && L < flexReach(R.lengths.thigh, R.lengths.shin, maxFlexRad(R, 'knee')))) return false;
  const H = inp.range?.profile.hipTwist;
  if (!R || !H) return true;
  const sx = inp.range!.sideX[s];
  const { mid, end } = plannedChain(R, hip, ankle, h);
  if (swingExcess(H.envelope, qInvRot(inp.core.q, norm(sub(mid, hip))), sx).rad > 0) return false;
  const tw = armTwistRad(H.envelope, inp.core.q, hip, mid, end, sx);
  const [lo, hi] = H.envelope.twistDeg;
  return tw === null || Math.abs(wrapPi(tw - rad((lo + hi) / 2))) <= rad((hi - lo) / 2 - H.marginDeg);
}

/**
 * When: how much a standing plant's support improves by stepping now (m, horizontal): how far it is from its want (as
 * far as can be when its leg no longer stands clear: its footprint and leg free with no margin) less how far its aim is;
 * -Infinity with no aim. Writes the plant's support, aim and whether it is bound.
 */
function gainOf(plan: FootPlan, s: ArmSide, inp: FootPlanInput): number {
  const f = plan.feet[s];
  const c = f.contact!;
  const ankle = add(f.heelW!, v3(0, inp.soleM, 0));
  const a = aimOf(plan, s, inp, 0);
  const { support, want, aim } = a;
  const off = len(hz(sub(ankle, want)));
  c.support = support;
  c.aim = aim ?? boundAim(inp, a);
  c.bound = !aim && (off > plan.profile.steps!.coverM || !canStand(plan, s, inp));
  if (!aim) return -Infinity;
  const R = inp.legs;
  const h = f.headingRad;
  const shoe = v3(Math.sin(h) * plan.shoe.centerFoot.z, 0, Math.cos(h) * plan.shoe.centerFoot.z);
  const stands = isFree(inp.ground ?? { prints: [] }, add(ankle, shoe), 0, { clearM: 0, ...(R ? { leg: { at: () => plannedLeg(R, s, inp.hips[s], ankle, h), skinM: 0 } } : {}) });
  // (FootDebug.stepsToAim, a fault: how far the plant is from its aim, as in the step 2 model)
  if (inp.debug?.stepsToAim) return len(hz(sub(ankle, aim)));
  return (stands ? off : Infinity) - len(hz(sub(aim, want)));
}

/** When: foot `s` lifts (or, in the air, is taken over) for a step to its aim, from the achieved ankle at its motion. */
function begin(plan: FootPlan, s: ArmSide, inp: FootPlanInput, ev: FootEvent[], why: FootReason): void {
  const M = plan.profile.steps!;
  const f = plan.feet[s];
  if (f.mode === 'planted') {
    ev.push({ type: 'footRelease', side: s, data: { reason: why, driftM: round(f.driftM, 5), featureErrM: round(f.featureErrM, 5), plantedS: round(inp.t - f.plantedAtS, 5), solves: f.solves } });
    f.releaseReason = why;
    f.releaseAtS = inp.t;
    f.heelW = f.anchorW = null;
  }
  f.mode = 'swing';
  f.source = 'step';
  f.why = why;
  f.drag = f.short = false;
  seedStep(plan, f);
  const { support, aim, bound, T } = aimFrom(plan, s, inp, f.target);
  const L = dist(f.target, aim);
  const h0 = Math.max(0, f.target.y - (inp.groundY + inp.soleM));
  f.contact = { T, h0, vy0: f.stepY.v, liftM: Math.max(0, M.liftM * clamp(L / M.maxStepM, 1 / 3, 1) - h0), support, aim, bound };
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
  const a = aimOf(plan, s, inp, left);
  c.support = a.support;
  c.aim = a.aim ?? boundAim(inp, a);
  c.bound = !a.aim;
  const d = hz(sub(c.aim, f.dest!));
  const dl = len(d);
  const k = M.followMps * dt * clamp((c.T - f.elapsedS) / c.T, 0, 1);
  f.dest = dl > k ? v3(f.dest!.x + (d.x * k) / dl, sole, f.dest!.z + (d.z * k) / dl) : v3(c.aim.x, sole, c.aim.z);
  const prev = f.target;
  const x = quinticStep(prev.x, f.stepH.v.x, f.stepH.a.x, f.dest.x, left, dt);
  const z = quinticStep(prev.z, f.stepH.v.z, f.stepH.a.z, f.dest.z, left, dt);
  if (!c.bound) ({ x: x.p, z: z.p } = onFreeGround(plan, inp, f.headingRad, prev, v3(x.p, 0, z.p)));
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
  // the foot turns to the body's heading over the time left, so it is on it at touchdown (FootDebug.stepsTurnRate, a
  // fault: at most the swing's yaw rate, as before)
  f.destHeadingRad = headingNow(inp);
  const dh = wrapPi(f.destHeadingRad - f.headingRad);
  const turn = rad(P.swing.maxYawRateDegPerS) * dt;
  f.headingRad += inp.debug?.stepsTurnRate ? clamp(dh, -turn, turn) : dh * Math.min(1, dt / left);
}

/**
 * The path keeps to free ground: a move of a foot in the air from `from` to `to` (ankles) that would take its shoe into
 * another player's footprint ends at the nearest free place to `to` within the move from `from` (the foot slides along
 * the footprint's edge); with none, as planned (FootDebug.stepsPathBlind, a fault: the path as planned). A bound foot's
 * path is as planned: it goes under its hip, where no free place is.
 */
function onFreeGround(plan: FootPlan, inp: FootPlanInput, h: number, from: Vec3, to: Vec3): Vec3 {
  const g = inp.ground;
  if (!g || inp.debug?.stepsPathBlind) return to;
  const c = v3(Math.sin(h) * plan.shoe.centerFoot.z, 0, Math.cos(h) * plan.shoe.centerFoot.z);
  const q: FootQuery = { clearM: plan.profile.steps!.footR };
  const t = v3(to.x + c.x, 0, to.z + c.z);
  if (isFree(g, t, 0, q)) return to;
  const fr = v3(from.x + c.x, 0, from.z + c.z);
  const p = nearestFree(g, t, fr, Math.hypot(t.x - fr.x, t.z - fr.z) + 1e-6, 0, q);
  return p ? v3(p.x - c.x, to.y, p.z - c.z) : to;
}

/**
 * When: the step's time is up: the foot lands where the leg is this substep (the achieved ankle at its motion), as it is
 * shown (`plantAtShownFoot`; FootDebug.stepsLandFlat, a fault: its heel under the ankle, flat, as before).
 */
function land(plan: FootPlan, s: ArmSide, inp: FootPlanInput, ev: FootEvent[]): void {
  const f = plan.feet[s];
  const here = add(f.ankleW, v3(f.ankleV.x * inp.dt, 0, f.ankleV.z * inp.dt));
  const p = inp.debug?.stepsLandFlat ? { heelW: v3(here.x, inp.groundY, here.z), rollF: 0, edgeX: 0, at: v3(here.x, inp.groundY, here.z) } : plantAtShownFoot(here, f.footQ, f.headingRad, inp.groundY, inp.soleM, inp.toeM, plan.shoe);
  f.mode = 'planted';
  f.solves = 0;
  f.rollF = p.rollF;
  f.toeZ = inp.toeM;
  f.edgeX = p.edgeX;
  f.heelW = p.heelW;
  f.anchorW = { ...p.at };
  f.featureW = { ...p.at };
  f.plantedAtS = inp.t;
  f.dest = null;
  f.offset = v3();
  f.driftM = f.featureErrM = 0;
  f.attempts++;
  plan.stats.attempts++;
  plan.stats.confirmed++;
  ev.push({ type: 'footPlant', side: s, data: { at: [round(p.at.x, 4), round(inp.groundY, 4), round(p.at.z, 4)], headingDeg: round((f.headingRad * 180) / Math.PI, 2), rollF: round(p.rollF, 4), errM: 0 } });
}

/**
 * Where a step's plant is taken: at the foot as shown, its ankle at `ankle` and its shoe frame `footQ`. The lowest sole
 * corner (shoe frame x, z) is the plant's contact point, on the ground where it is (`at`); the heel is placed from it
 * along the plan heading (`headingRad`), so the leg solve, which puts that corner on its anchor, shows the shoe where it
 * touched down: no settle onto a flat footprint under the ankle.
 */
export function plantAtShownFoot(ankle: Vec3, footQ: Quat, headingRad: number, groundY: number, soleM: number, toeM: number, shoe: { he: Vec3; centerFoot: Vec3 }): { heelW: Vec3; rollF: number; edgeX: number; at: Vec3 } {
  let low = { x: 0, z: 0, y: Infinity, w: v3() };
  for (const x of [-shoe.he.x, shoe.he.x])
    for (const z of [shoe.centerFoot.z - shoe.he.z, shoe.centerFoot.z + shoe.he.z]) {
      const w = add(ankle, qRot(footQ, v3(x, -soleM, z)));
      if (w.y < low.y) low = { x, z, y: w.y, w };
    }
  const at = v3(low.w.x, groundY, low.w.z);
  const dir = v3(Math.sin(headingRad), 0, Math.cos(headingRad));
  const lat = v3(Math.cos(headingRad), 0, -Math.sin(headingRad));
  return { heelW: v3(at.x - dir.x * low.z - lat.x * low.x, groundY, at.z - dir.z * low.z - lat.z * low.x), rollF: low.z / toeM, edgeX: low.x, at };
}
