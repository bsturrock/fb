// Plan 08a: the right-arm ball carry, ported from sim-6 (src/anim/ballCarry.ts: CARRY, mixKey, rightCarry). The arm sits
// between the user's two keys by where the clip's own arm swing is, a share of that swing turns the carry at the shoulder,
// the ball lies lengthwise on the forearm's seat side with its front nose in the hand. Pose-only: this file reads clip
// directions and returns arm requests and forearm-local seat numbers; nothing here reaches a motor, support or rule force.
//
// Chest frame: +X anatomical left, +Y up, +Z forward (the clip and donor frame). A body with anatomical left on -X gets
// the directions mirrored (`M`); the seat numbers are measured in the mirrored directions, so they stay rigid rotations.
import type { ArmSide } from './contracts';
import type { Pose, Quat, Vec3 } from './vec';
import { addScaled, clamp, cross, dot, neg, norm, qFromAxisAngle, qFromBasis, qMul, qRot, toWorld, v3 } from './vec';

/**
 * The arm that carries the ball: the pose's carry arm (plan 06 hold, plan 08a seat), the ragdoll's `carriedBall`
 * segment and the rules' `carryPalm` all take it from here. Switching hands was outside 08a (plan 10c C2).
 */
export const CARRY_ARM: ArmSide = 'right';

/**
 * One carry key: upper arm and forearm directions (chest frame), the ball's seat side on the forearm, the ball centre along
 * the forearm from the elbow and out from its axis (m), its long axis tilted from the forearm toward the seat (rad) and
 * the wrist flex turning the hand over the front nose (rad).
 */
export interface CarryKey {
  upper: Vec3;
  fore: Vec3;
  inside: Vec3;
  along: number;
  out: number;
  tilt: number;
  wristFlex: number;
}

export interface CarryProfile {
  id: string;
  back: CarryKey;
  fwd: CarryKey;
  /** The forearm the keys were posed on (m): `along` is that share of the current body's forearm. */
  fitForearmM: number;
  /** The clip's arm swing (half the right minus left upper-arm pitch, rad) at which the arm reaches each key. */
  swingRange: [number, number];
  /** Share of the arm swing turning the carry at the shoulder, the forearm's share of that, its arc toward the chest. */
  swing: number;
  foreSwing: number;
  swingIn: number;
  /**
   * Plan 10d D3: seconds over which the hand passes between the carry (roll and wrist flex over the nose) and an achieved
   * arm's own straight hand, when the arm's owner changes.
   */
  handBlendS: number;
  /** Plan 10d D4: the football the seat holds (long half-length and radius, m), a clearance capsule along its axis. */
  ball: { halfM: number; radiusM: number };
}

/**
 * Hand and ball on the carrying forearm, in numbers that survive a conversion and interpolate linearly. All are relative
 * to the right forearm's segment frame (X hinge axis, -Y elbow to wrist), so they follow the achieved arm:
 * - `rollRad`: the seat side about the forearm: -X (where a resting palm faces) turned about +Y;
 * - `flexRad`: the wrist flex turning the fingers from the forearm toward the seat side;
 * - `alongM`, `outM`: ball centre along the forearm from the elbow and out toward the seat side;
 * - `tiltRad`: the ball's long axis from the forearm toward the seat side (negative: nose away from it, as authored);
 * - `handW` (plan 10d D3): the share of the roll and the flex the hand takes: 1 the carry's hand over the nose, 0 an
 *   achieved arm's own hand (no roll, no flex). The ball keeps the full seat either way.
 */
export interface CarrySeat {
  rollRad: number;
  flexRad: number;
  alongM: number;
  outM: number;
  tiltRad: number;
  handW: number;
}

/**
 * A chest-frame arm and seat for one arm swing. `blend`: 0 at the back key, 1 at the forward key. `inside` (plan 10d D4):
 * the seat side in the chest frame (unit, perpendicular to `fore`); `seat.rollRad` is that side in the request's own
 * forearm frame, and `seatOn` re-reads it in whatever forearm frame was achieved.
 */
export interface CarryRequest {
  upper: Vec3;
  fore: Vec3;
  inside: Vec3;
  seat: CarrySeat;
  blend: number;
}

const X = v3(1, 0, 0);
const Y = v3(0, 1, 0);
const F = v3(0, -1, 0);

/**
 * sim-6 CARRY (src/anim/ballCarry.ts at the user's lab fit of 2026-10-30), values unchanged; the swing range reads the run
 * clip's extremes. Model checksum in both repositories: 5aaab36942e3ec55...792d3.
 *
 * v2 (plan 10d): the same keys. The seat side is re-read in the achieved forearm frame against the chest-frame inside
 * direction (D4, `seatOn`), the ball is a clearance shape of the carry arm (D4), and an achieved arm's hand takes no
 * roll or flex, with `handBlendS` between the two at an owner change (D3). The football is the donor's prop.
 */
export const CARRY_L3: CarryProfile = {
  id: 'carry-sim6-v2',
  back: { upper: norm(v3(-0.156, -0.907, 0.391)), fore: norm(v3(0.292, -0.017, 0.956)), inside: v3(0.412, 0.904, -0.11), along: 0.175, out: 0.117, tilt: 0, wristFlex: 0.942 },
  fwd: { upper: norm(v3(-0.156, -0.922, 0.354)), fore: norm(v3(0.016, 0.423, 0.906)), inside: v3(0.42, 0.82, -0.39), along: 0.175, out: 0.117, tilt: -0.314, wristFlex: 1.065 },
  fitForearmM: 0.23217,
  swingRange: [-1.1, 0.8],
  swing: 0.6,
  foreSwing: 0.716,
  swingIn: 0.6,
  handBlendS: 0.15,
  ball: { halfM: 0.14, radiusM: 0.085 },
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpDir = (a: Vec3, b: Vec3, t: number): Vec3 => norm(v3(mix(a.x, b.x, t), mix(a.y, b.y, t), mix(a.z, b.z, t)), a);

/** Two keys mixed: directions normalized, the inside direction as it is (`carryRequest` takes it off the forearm). */
function mixKey(a: CarryKey, b: CarryKey, t: number): CarryKey {
  return {
    upper: lerpDir(a.upper, b.upper, t),
    fore: lerpDir(a.fore, b.fore, t),
    inside: v3(mix(a.inside.x, b.inside.x, t), mix(a.inside.y, b.inside.y, t), mix(a.inside.z, b.inside.z, t)),
    along: mix(a.along, b.along, t),
    out: mix(a.out, b.out, t),
    tilt: mix(a.tilt, b.tilt, t),
    wristFlex: mix(a.wristFlex, b.wristFlex, t),
  };
}

/** Pitch (rad, + forward) of a chest-frame upper-arm direction. */
const pitch = (u: Vec3): number => Math.atan2(u.z, -u.y);

/** The clip's arm swing: half the right minus left upper-arm pitch (rad, + right arm forward), chest-frame directions. */
export const carryArmSwing = (rightUpper: Vec3, leftUpper: Vec3): number => 0.5 * (pitch(rightUpper) - pitch(leftUpper));

/** Forward (+) about the shoulder's lateral axis, turned toward the chest by `swingIn` of it. */
const arc = (C: CarryProfile, a: number): Quat => qMul(qFromAxisAngle(Y, C.swingIn * a), qFromAxisAngle(X, -a));

/**
 * Chest-frame upper arm, forearm and seat for an arm swing (0 = the static carry) on a forearm of `forearmM`; `M` maps to
 * the body's side convention.
 */
export function carryRequest(C: CarryProfile, raw: number, forearmM: number = C.fitForearmM, M: (p: Vec3) => Vec3 = (p) => p, toward?: { key: CarryKey; w: number }): CarryRequest {
  const [b0, b1] = C.swingRange;
  const blend = clamp((raw - b0) / (b1 - b0), 0, 1);
  const K0 = mixKey(C.back, C.fwd, blend);
  // contact motion M2: the carrier's brace takes the swing's key toward its own by its weight (absent or 0: unchanged)
  const K = toward && toward.w > 0 ? mixKey(K0, toward.key, clamp(toward.w, 0, 1)) : K0;
  const swing = C.swing * raw;
  const qF = arc(C, swing * C.foreSwing);
  const upper = M(qRot(arc(C, swing), K.upper));
  const fore = M(qRot(qF, K.fore));
  const in0 = M(qRot(qF, K.inside));
  const inside = norm(addScaled(in0, fore, -dot(in0, fore)));
  // the forearm frame hingeChain builds for this bend: X hinge axis, Y back to the elbow
  const hx = norm(cross(upper, fore));
  const hz = cross(hx, neg(fore));
  const rollRad = Math.atan2(dot(inside, hz), -dot(inside, hx));
  return { upper, fore, inside, blend, seat: { rollRad, flexRad: K.wristFlex, alongM: K.along * (forearmM / C.fitForearmM), outM: K.out, tiltRad: K.tilt, handW: 1 } };
}

/**
 * Plan 10d D4: a request's seat on an achieved forearm frame (world `forearmQ`, X hinge axis, -Y elbow to wrist) of a
 * body whose core (chest frame) is `coreQ`. The seat side is the request's chest-frame inside direction taken
 * perpendicular to the achieved forearm, so the ball keeps its side of the arm whatever bend plane the solve chose (an
 * alternative arm, a pushed one, or a near-straight arm's fallback hinge axis). On the requested arm itself this is the
 * request's own roll.
 */
export function seatOn(req: CarryRequest, forearmQ: Quat, coreQ: Quat, handW = 1): CarrySeat {
  const fx = qRot(forearmQ, X);
  const fz = qRot(forearmQ, v3(0, 0, 1));
  const along = qRot(forearmQ, F);
  const inW = qRot(coreQ, req.inside);
  const i = norm(addScaled(inW, along, -dot(inW, along)), qRot(forearmQ, seatInside(req.seat)));
  return { ...req.seat, rollRad: Math.atan2(dot(i, fz), -dot(i, fx)), handW };
}

/** The seat side, forearm-local. */
const seatInside = (c: CarrySeat): Vec3 => sideAt(c.rollRad);
const sideAt = (roll: number): Vec3 => v3(-Math.cos(roll), 0, Math.sin(roll));

/** Plan 10d D3: the hand's own roll and wrist flex (the seat's, scaled by the hand's share). */
export function seatHand(c: CarrySeat): { rollRad: number; flexRad: number } {
  return { rollRad: c.rollRad * c.handW, flexRad: c.flexRad * c.handW };
}

/** The palm contact landmark, forearm-local: the wrist, then the hand turned over the nose (by the hand's share). */
export function seatPalmLocal(c: CarrySeat, forearmM: number, palmExtensionM: number): Vec3 {
  const h = seatHand(c);
  const fingers = addScaled(addScaled(v3(), F, Math.cos(h.flexRad)), sideAt(h.rollRad), Math.sin(h.flexRad));
  return addScaled(v3(0, -forearmM, 0), fingers, palmExtensionM);
}

/** The ball centre, forearm-local. */
export function seatBallLocal(c: CarrySeat): Vec3 {
  return addScaled(addScaled(v3(), F, c.alongM), seatInside(c), c.outM);
}

/** The ball's rotation, forearm-local: long axis +Y toward the front nose, laces +Z out toward the forearm. */
export function seatBallQ(c: CarrySeat): Quat {
  const I = seatInside(c);
  const axis = addScaled(addScaled(v3(), F, Math.cos(c.tiltRad)), I, -Math.sin(c.tiltRad));
  const laces = neg(norm(addScaled(I, axis, -dot(I, axis))));
  return qFromBasis(cross(axis, laces), axis, laces);
}

/** The carried ball (world) on an achieved forearm. */
export function seatBallWorld(forearm: Pose, c: CarrySeat): Pose {
  return { p: toWorld(forearm, seatBallLocal(c)), q: qMul(forearm.q, seatBallQ(c)) };
}

/**
 * Plan 10d D4: the carried ball's clearance capsule (world): along the ball's long axis, the radius of the football, its
 * ends at the football's tips.
 */
export function seatBallCapsule(forearm: Pose, c: CarrySeat, ball: CarryProfile['ball']): { a: Vec3; b: Vec3; r: number } {
  const w = seatBallWorld(forearm, c);
  const axis = qRot(w.q, Y);
  const h = Math.max(0, ball.halfM - ball.radiusM);
  return { a: addScaled(w.p, axis, -h), b: addScaled(w.p, axis, h), r: ball.radiusM };
}

/**
 * Seat between two poses of one representation (the lab's render interpolation). The roll is interpolated the short way
 * round (the seat side is an angle about the forearm).
 */
export function lerpSeat(a: CarrySeat, b: CarrySeat, t: number): CarrySeat {
  let dr = b.rollRad - a.rollRad;
  dr -= 2 * Math.PI * Math.round(dr / (2 * Math.PI));
  return { rollRad: a.rollRad + dr * t, flexRad: mix(a.flexRad, b.flexRad, t), alongM: mix(a.alongM, b.alongM, t), outM: mix(a.outM, b.outM, t), tiltRad: mix(a.tiltRad, b.tiltRad, t), handW: mix(a.handW, b.handW, t) };
}

/**
 * Plan 10d D3: the hand's share after one substep: toward 1 while the carry owns the arm, toward 0 while an arm task
 * does, at 1 / `blendS` per second. Without a previous share or a step length it is the target.
 */
export function stepHandW(prev: number | undefined, carried: boolean, dtS: number, blendS: number): number {
  const target = carried ? 1 : 0;
  if (prev === undefined || !(dtS > 0) || !(blendS > 0)) return target;
  const step = dtS / blendS;
  return Math.abs(target - prev) <= step ? target : prev + Math.sign(target - prev) * step;
}
