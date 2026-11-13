// Gate 3 balance mechanics (pure functions): lean measurement, finite upright support torque, the recovery
// envelope and the drive lean scale. Authored game mechanics, not a calibrated simulation of human balance.
import type { BalanceProfile } from './profiles';
import { clamp, clampLen, cross, dot, len, norm, qFromAxisAngle, qRot, scale, sub, upOf, UP, v3, type Quat, type Vec3 } from './vec';

export interface LeanMeasure {
  /** Actual world lean (rad) = acos(dot(bodyUp, worldUp)). */
  theta: number;
  /** Unit correction axis toward upright (normalize(cross(u, U))); last valid axis near zero tilt. */
  axis: Vec3;
  /** dot(omega, -axis): positive = rotating further away from upright. Zero near zero tilt. */
  outwardRate: number;
  bodyUp: Vec3;
}

export function measureLean(q: Quat, omega: Vec3, lastAxis: Vec3, zeroTiltRad: number): LeanMeasure {
  const u = upOf(q);
  const theta = Math.acos(clamp(dot(u, UP), -1, 1));
  const c = cross(u, UP);
  const cl = len(c);
  // Near upright (or inverted) the cross product vanishes: keep the last valid axis and use a zero-rate convention.
  if (cl < 1e-6 || theta < zeroTiltRad) return { theta, axis: lastAxis, outwardRate: 0, bodyUp: u };
  const axis = scale(c, 1 / cl);
  return { theta, axis, outwardRate: dot(omega, scale(axis, -1)), bodyUp: u };
}

/** projectedLean = theta + max(0, outwardRate) * lookAhead. */
export const projectedLean = (m: LeanMeasure, b: BalanceProfile): number => m.theta + Math.max(0, m.outwardRate) * b.lookAheadS;

export type EnvelopeVerdict = { loss: false; counter: number } | { loss: true; counter: number; reason: 'recoveryEnvelope' | 'hardLeanLimit' };

/** One substep of the loss criterion with its confirmation counter. */
export function envelopeStep(m: LeanMeasure, counter: number, b: BalanceProfile): EnvelopeVerdict {
  if (m.theta >= b.hardLeanRad) return { loss: true, counter, reason: 'hardLeanLimit' };
  const projected = projectedLean(m, b);
  if (m.theta >= b.minLeanRad && projected > b.envelopeRad) {
    const n = counter + 1;
    if (n >= b.confirmSubsteps) return { loss: true, counter: n, reason: 'recoveryEnvelope' };
    return { loss: false, counter: n };
  }
  return { loss: false, counter: 0 };
}

/** availableBalanceTorque = min(configuredMaximum, mass * g * supportRadius). */
export const availableBalanceTorque = (b: BalanceProfile, massKg: number, g: number, supportRadiusM: number): number =>
  Math.min(b.maxBalanceTorqueNm, massKg * Math.abs(g) * supportRadiusM);

/** Desired body up: world up tilted by `leanRad` toward a horizontal direction. */
export function desiredUpFrom(leanRad: number, dirWorld: Vec3): Vec3 {
  const d = norm(v3(dirWorld.x, 0, dirWorld.z));
  if (leanRad <= 0 || len(d) < 1e-9) return { ...UP };
  // rotate UP about axis = cross(UP, d) by leanRad (tilts toward d)
  const axis = norm(cross(UP, d));
  return qRot(qFromAxisAngle(axis, leanRad), UP);
}

export interface BalanceTorque {
  requested: Vec3;
  /** After the balance cap (before the combined ceiling). */
  capped: Vec3;
  cap: number;
  thetaError: number;
  saturated: boolean;
}

/**
 * tauRequested = Kp * thetaError * correctionAxis - Kd * omegaTilt (+ posture gravity hold); |tau| <= available.
 * The position term is omitted when thetaError ~ 0 (finite damping only).
 *
 * Posture gravity hold (documented deviation from the spec formula): when the desired up is tilted by thetaD, add
 * m g L sin(thetaD) about the axis back toward world up, L = COM-to-support-hemisphere-centre distance. Without it the
 * PD settles at Kp thetaD / (Kp - m g L) (3.7x the request for the compound body) and a bounded posture request
 * topples the player by itself. Zero when the target is upright; always inside the same torque cap.
 */
export function computeBalanceTorque(
  bodyUp: Vec3,
  desiredUp: Vec3,
  omega: Vec3,
  b: BalanceProfile,
  cap: number,
  gravityHoldNm = 0,
  /** The up the hold is taken for (its axis); the desired up when absent. */
  holdUp: Vec3 = desiredUp,
): BalanceTorque {
  const thetaError = Math.acos(clamp(dot(bodyUp, desiredUp), -1, 1));
  const c = cross(bodyUp, desiredUp);
  const cl = len(c);
  const omegaTilt = sub(omega, scale(UP, dot(omega, UP)));
  let req = scale(omegaTilt, -b.kd);
  if (cl > 1e-6 && thetaError > b.zeroTiltRad) req = { x: req.x + (b.kp * thetaError * c.x) / cl, y: req.y + (b.kp * thetaError * c.y) / cl, z: req.z + (b.kp * thetaError * c.z) / cl };
  const dc = cross(holdUp, UP);
  const dcl = len(dc);
  if (gravityHoldNm > 0 && dcl > 1e-9) req = { x: req.x + (gravityHoldNm * dc.x) / dcl, y: req.y + (gravityHoldNm * dc.y) / dcl, z: req.z + (gravityHoldNm * dc.z) / dcl };
  const capped = clampLen(req, cap);
  return { requested: req, capped, cap, thetaError, saturated: len(req) > cap + 1e-9 };
}

/** Combine yaw (world Y) and balance torques under the combined support ceiling (proportional scaling). */
export function combineSupportTorque(balance: Vec3, yawY: number, ceiling: number): { torque: Vec3; scale: number } {
  const t = v3(balance.x, balance.y + yawY, balance.z);
  const l = len(t);
  if (l <= ceiling || l < 1e-12) return { torque: t, scale: 1 };
  const s = ceiling / l;
  return { torque: scale(t, s), scale: s };
}

/** Posture gravity hold magnitude m g L sin(thetaD) for a desired up vector. */
export function postureGravityHold(desiredUp: Vec3, massKg: number, g: number, leverM: number): number {
  const sinD = len(cross(desiredUp, UP));
  return massKg * Math.abs(g) * leverM * sinD;
}

/** leanScale = clamp(1 - (theta / hardLeanLimit)^2, 0, 1). */
export const leanScale = (theta: number, b: BalanceProfile): number => clamp(1 - (theta / b.hardLeanRad) ** 2, 0, 1);
