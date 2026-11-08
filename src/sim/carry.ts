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
}

/**
 * Hand and ball on the carrying forearm, in numbers that survive a conversion and interpolate linearly. All are relative
 * to the right forearm's segment frame (X hinge axis, -Y elbow to wrist), so they follow the achieved arm:
 * - `rollRad`: the seat side about the forearm: -X (where a resting palm faces) turned about +Y;
 * - `flexRad`: the wrist flex turning the fingers from the forearm toward the seat side;
 * - `alongM`, `outM`: ball centre along the forearm from the elbow and out toward the seat side;
 * - `tiltRad`: the ball's long axis from the forearm toward the seat side (negative: nose away from it, as authored).
 */
export interface CarrySeat {
  rollRad: number;
  flexRad: number;
  alongM: number;
  outM: number;
  tiltRad: number;
}

/** A chest-frame arm and seat for one arm swing. `blend`: 0 at the back key, 1 at the forward key. */
export interface CarryRequest {
  upper: Vec3;
  fore: Vec3;
  seat: CarrySeat;
  blend: number;
}

const X = v3(1, 0, 0);
const Y = v3(0, 1, 0);
const F = v3(0, -1, 0);

/**
 * sim-6 CARRY (src/anim/ballCarry.ts at the user's lab fit of 2026-10-30), values unchanged; the swing range reads the run
 * clip's extremes. Model checksum in both repositories: 5aaab36942e3ec55...792d3.
 */
export const CARRY_L3: CarryProfile = {
  id: 'carry-sim6-v1',
  back: { upper: norm(v3(-0.156, -0.907, 0.391)), fore: norm(v3(0.292, -0.017, 0.956)), inside: v3(0.412, 0.904, -0.11), along: 0.175, out: 0.117, tilt: 0, wristFlex: 0.942 },
  fwd: { upper: norm(v3(-0.156, -0.922, 0.354)), fore: norm(v3(0.016, 0.423, 0.906)), inside: v3(0.42, 0.82, -0.39), along: 0.175, out: 0.117, tilt: -0.314, wristFlex: 1.065 },
  fitForearmM: 0.23217,
  swingRange: [-1.1, 0.8],
  swing: 0.6,
  foreSwing: 0.716,
  swingIn: 0.6,
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerpDir = (a: Vec3, b: Vec3, t: number): Vec3 => norm(v3(mix(a.x, b.x, t), mix(a.y, b.y, t), mix(a.z, b.z, t)), a);

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
export function carryRequest(C: CarryProfile, raw: number, forearmM: number = C.fitForearmM, M: (p: Vec3) => Vec3 = (p) => p): CarryRequest {
  const [b0, b1] = C.swingRange;
  const blend = clamp((raw - b0) / (b1 - b0), 0, 1);
  const K: CarryKey = {
    upper: lerpDir(C.back.upper, C.fwd.upper, blend),
    fore: lerpDir(C.back.fore, C.fwd.fore, blend),
    inside: v3(mix(C.back.inside.x, C.fwd.inside.x, blend), mix(C.back.inside.y, C.fwd.inside.y, blend), mix(C.back.inside.z, C.fwd.inside.z, blend)),
    along: mix(C.back.along, C.fwd.along, blend),
    out: mix(C.back.out, C.fwd.out, blend),
    tilt: mix(C.back.tilt, C.fwd.tilt, blend),
    wristFlex: mix(C.back.wristFlex, C.fwd.wristFlex, blend),
  };
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
  return { upper, fore, blend, seat: { rollRad, flexRad: K.wristFlex, alongM: K.along * (forearmM / C.fitForearmM), outM: K.out, tiltRad: K.tilt } };
}

/** The seat side, forearm-local. */
const seatInside = (c: CarrySeat): Vec3 => v3(-Math.cos(c.rollRad), 0, Math.sin(c.rollRad));

/** The palm contact landmark, forearm-local: the wrist, then the hand turned over the nose. */
export function seatPalmLocal(c: CarrySeat, forearmM: number, palmExtensionM: number): Vec3 {
  const fingers = addScaled(addScaled(v3(), F, Math.cos(c.flexRad)), seatInside(c), Math.sin(c.flexRad));
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

/** Seat between two poses of one representation (the lab's render interpolation). */
export function lerpSeat(a: CarrySeat, b: CarrySeat, t: number): CarrySeat {
  return { rollRad: mix(a.rollRad, b.rollRad, t), flexRad: mix(a.flexRad, b.flexRad, t), alongM: mix(a.alongM, b.alongM, t), outM: mix(a.outM, b.outM, t), tiltRad: mix(a.tiltRad, b.tiltRad, t) };
}
