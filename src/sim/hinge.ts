// Contact motion polish 1.1: the hip hinge of a supported proxy. The proxy is one rigid body (pelvis, torso and head);
// its legs are posed in the travel frame under it. A striking tackler pitches that body well past the balance profile's
// posture lean (the legs could never hold 40 deg of whole-body lean: the support's gravity torque would be some 630 N m
// against a 240 N m ceiling). The hinge splits the body's orientation into the legs' frame and a pitch about one
// horizontal axis: the support force acts below the centre of mass along the legs' frame, and the loss envelope and the
// drive's lean scale read the legs' lean, so a deliberate trunk pitch never reads as a fall and costs no support torque.
// The balance torque pitches the trunk to the hinge's angle (motor-step), as it holds any posture.
import { add, clamp, cross, dot, horiz, len, norm, qFromAxisAngle, qInvRot, qMul, qRot, scale, sub, upOf, v3, type Quat, type Vec3 } from './vec';
import { computeBalanceTorque, type BalanceTorque } from './balance';
import type { BalanceProfile } from './profiles';

/** One supported player's hinge (`PlayerRuntime.hinge`; absent while he has none). */
export interface HingeState {
  /** The commanded trunk pitch beyond the legs' desired up (rad, >= 0), rate-limited toward the request. */
  rad: number;
  /**
   * The most body pitch (about `axis`, beyond the legs' desired up) the measure attributes to the hinge (rad): never
   * below `rad`; while the commanded pitch unwinds it follows the pitch the body still has down, so the trunk coming up
   * never reads as the legs leaning.
   */
  capRad: number;
  /** The commanded pitch's rate (rad/s): the balance torque damps the body's pitch rate relative to it. */
  rateRadPerS: number;
  /** The hips' drop the hinge adds to the stance (m, >= 0), rate-limited toward the request. */
  dropM: number;
  /**
   * Polish 1.2, the ride-down's come-down (`WrapRideDown.weightForward`; set by the simulation): his weight goes forward
   * with the trunk, the support pivot under the body's own frame (as without the hinge), not the legs'.
   */
  bodyPivot?: true;
  /**
   * Polish 1.2, the come-down arriving (`HingeArrive`): the body's pitch rate has come to need the planned braking to
   * reach the full fold at its end rate (latched for the come-down); the weight-forward topple ends with it.
   */
  braking?: true;
}

/**
 * Contact motion polish 1.2, the ride-down's come-down arriving (`WrapRideDown.arrive`): the fold arrives at its end
 * slowing down. The commanded pitch moves on at the commanded rate but never more than `leadDeg` ahead of the pitch the
 * body has reached (a trunk the carrier blocks is not left far behind a command that saturates the cap and then throws
 * him at it), and its rate is the hinge's top rate until the body's own pitch rate needs the planned braking to reach
 * the full fold at `endDegPerS`; from then on it is the rate of that braking at the pitch the body has reached
 * (`brakeDegPerS2`, well within what the balance cap brakes on the proxy's pitch inertia, 240 N m on about 15.7 kg m^2,
 * some 870 deg/s^2: the legs' share and the contacts take the rest), and the command leads the body by at most
 * `brakeLeadDeg` (enough to keep the pitch the hinge's, so the legs' balance does not read it as lean).
 */
export interface HingeArrive {
  leadDeg: number;
  brakeLeadDeg: number;
  brakeDegPerS2: number;
  endDegPerS: number;
}

/** The hinge's bounds (`WrapStrike.hinge`). */
export interface HingeLimits {
  maxDeg: number;
  /** The pitch's speed and acceleration bounds: the balance torque must be able to carry the trunk along it. */
  rateDegPerS: number;
  accelDegPerS2: number;
  maxDropM: number;
  dropRateMps: number;
}

/** Signed angle (rad) about unit `a` from `from` to `to`, each projected on the plane normal to `a`. */
export function angleAbout(a: Vec3, from: Vec3, to: Vec3): number {
  const p1 = sub(from, scale(a, dot(from, a)));
  const p2 = sub(to, scale(a, dot(to, a)));
  return Math.atan2(dot(a, cross(p1, p2)), dot(p1, p2));
}

/**
 * The hinge's axis: the body's own lateral axis, level (a hip hinge turns about the pelvis's left-right line, whichever
 * way the body faces). A positive angle about it pitches the body's up toward its forward.
 */
export const hingeAxis = (q: Quat): Vec3 => norm(horiz(qRot(q, v3(1, 0, 0))), v3(1, 0, 0));

/** The body's pitch about the hinge axis beyond the legs' desired up (rad, signed). */
export const hingePitch = (q: Quat, legsUp: Vec3): number => angleAbout(hingeAxis(q), legsUp, upOf(q));

/** The part of that pitch the hinge takes (rad): clamped to [0, capRad]. */
export const hingeShare = (h: HingeState, q: Quat, legsUp: Vec3): number => clamp(hingePitch(q, legsUp), 0, h.capRad);

/** The legs' frame: the body's rotation less the hinge's share about its axis. */
export function legRotation(h: HingeState, q: Quat, legsUp: Vec3): Quat {
  const s = hingeShare(h, q, legsUp);
  return s > 0 ? qMul(qFromAxisAngle(hingeAxis(q), -s), q) : q;
}

/** The legs' angular velocity: inside the hinge's range its axis component turns the hinge, not the legs. */
export function legOmega(h: HingeState, q: Quat, legsUp: Vec3, omega: Vec3): Vec3 {
  const p = hingePitch(q, legsUp);
  const a = hingeAxis(q);
  return p > 0 && p < h.capRad ? sub(omega, scale(a, dot(omega, a))) : omega;
}

/**
 * The balance torque under a hinge, balance first. The legs' part is the ordinary balance torque (balance.ts) on the
 * legs' frame toward their desired up, with its posture hold, under the cap; the hinge's part pitches the trunk about
 * the axis toward the commanded pitch with the same gains (its damping relative to the commanded rate) and takes only
 * what the legs' part leaves of the cap. A trunk the carrier blocks so never takes the budget his balance needs.
 */
export function hingeBalanceTorque(
  h: HingeState,
  q: Quat,
  omega: Vec3,
  legsUp: Vec3,
  b: BalanceProfile,
  cap: number,
  gravityHoldNm: number,
  holdUp: Vec3,
): BalanceTorque {
  const legs = computeBalanceTorque(upOf(legRotation(h, q, legsUp)), legsUp, legOmega(h, q, legsUp, omega), b, cap, gravityHoldNm, holdUp);
  const a = hingeAxis(q);
  const pitch = hingePitch(q, legsUp);
  const want = b.kp * (h.rad - Math.max(0, Math.min(pitch, h.capRad))) - b.kd * (dot(omega, a) - h.rateRadPerS);
  const room = Math.max(0, cap - len(legs.capped));
  const hinge = clamp(want, -room, room);
  const requested = add(legs.requested, scale(a, want));
  return { requested, capped: add(legs.capped, scale(a, hinge)), cap, thetaError: legs.thetaError, saturated: legs.saturated || Math.abs(want) > room + 1e-9 };
}

/**
 * The support pivot under the hinge: the body's pivot point (body-local `local`) placed from the centre of mass in the
 * legs' frame instead of the body's, so the trunk's pitch moves no support force off the centre of mass.
 */
export function hingePivot(h: HingeState, q: Quat, origin: Vec3, com: Vec3, local: Vec3, legsUp: Vec3): Vec3 {
  const comLocal = qInvRot(q, sub(com, origin));
  return add(com, qRot(legRotation(h, q, legsUp), sub(local, comLocal)));
}

/**
 * One substep of the hinge from its request (undefined: none). The pitch moves toward the bounded request along a
 * speed- and acceleration-bounded path, the drop at its rate; the hinge ends once nothing is requested and both have
 * unwound with the body (returns undefined). With `arrive` (polish 1.2, the come-down: `HingeArrive`, the body's
 * angular velocity `omega`) the pitch's path is re-based on the body's achieved pitch and brakes to the full fold.
 */
export function advanceHinge(
  h: HingeState | undefined,
  req: { rad: number; dropM: number } | undefined,
  L: HingeLimits,
  q: Quat,
  legsUp: Vec3,
  dt: number,
  arrive?: { law: HingeArrive; omega: Vec3 },
): HingeState | undefined {
  const want = req ? clamp(req.rad, 0, (L.maxDeg * Math.PI) / 180) : 0;
  const wantDrop = req ? clamp(req.dropM, 0, L.maxDropM) : 0;
  if (!h) {
    if (!req || (want <= 0 && wantDrop <= 0)) return undefined;
    h = { rad: 0, capRad: 0, rateRadPerS: 0, dropM: 0 };
  }
  // the pitch's trajectory: speed and acceleration bounded, braking in time to stop at the request
  const vmax = (L.rateDegPerS * Math.PI) / 180;
  const amax = (L.accelDegPerS2 * Math.PI) / 180;
  if (arrive && req) {
    // (the come-down arriving: the path from the pitch the body has reached, braking once his own rate needs it)
    const d2r = Math.PI / 180;
    const lead = arrive.law.leadDeg * d2r;
    const brakeLead = arrive.law.brakeLeadDeg * d2r;
    const brake = arrive.law.brakeDegPerS2 * d2r;
    const end = arrive.law.endDegPerS * d2r;
    const p = hingePitch(q, legsUp);
    const w = dot(arrive.omega, hingeAxis(q));
    const e = want - p;
    if (e <= 0 || (w > end && w * w - end * end >= 2 * brake * e)) h.braking = true;
    const vt = e <= 0 ? 0 : h.braking ? Math.min(vmax, Math.sqrt(end * end + 2 * brake * e)) : vmax;
    h.rateRadPerS = Math.min(h.rateRadPerS + amax * dt, vt);
    // (braking, never ahead of the body: the lead's push would be braking's loss)
    const base = Math.max(0, p);
    h.rad = clamp(Math.min(h.rad + h.rateRadPerS * dt, base + (h.braking ? brakeLead : lead)), 0, want);
  } else {
    if (h.braking) delete h.braking;
    const e = want - h.rad;
    const vt = Math.sign(e) * Math.min(vmax, Math.sqrt(2 * amax * Math.abs(e)));
    h.rateRadPerS += clamp(vt - h.rateRadPerS, -amax * dt, amax * dt);
    h.rad += h.rateRadPerS * dt;
    if ((want - h.rad) * e < 0 || e === 0) {
      h.rad = want;
      h.rateRadPerS = 0;
    }
  }
  h.dropM += clamp(wantDrop - h.dropM, -L.dropRateMps * dt, L.dropRateMps * dt);
  h.capRad = Math.max(h.rad, Math.min(h.capRad, Math.max(0, hingePitch(q, legsUp))));
  if (!req && h.rad <= 0 && h.dropM <= 0 && h.capRad < (0.5 * Math.PI) / 180) return undefined;
  return h;
}
