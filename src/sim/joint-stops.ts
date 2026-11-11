// Ladder rung 8d: hard outer stops on the ragdoll's spherical hips (`RagdollProfile.hipStops`). Rapier 0.21's spherical
// joint takes per-axis angular limits, but its JavaScript API sets them only on unit joints (revolute, prismatic); the
// one call here (`setAngularLimits`) reaches the raw joint set it wraps. tests/joint-stops.test.ts pins that call, its
// readback and what it enforces, so a Rapier change fails loudly.
//
// What Rapier enforces (rapier 0.21 joint_constraint_builder: `limit_angular`): the joint's relative rotation
// e = frame1^-1 * frame2 (each body's rotation times its local frame), sign-normalised to w >= 0, has each vector-part
// component kept within sin(limit / 2). On its own axis that is the rotation angle itself; combined, the components are
// those of the quaternion, so a stop is exact alone and couples at corners: with twist t about the thigh and swing s,
// the twist component is cos(s/2) sin(t/2) (the twist the box admits grows with swing) and the swing components turn by
// half the twist (`hipStopReading` gives the box's reading of any pose; the test tabulates it).
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArmSide } from './contracts';
import { MODEL_CALIBRATION, MODEL_CALIBRATION_ID } from './model/profiles';
import type { BodyProfile, HipStopProfile } from './profiles';
import { qConj, qFromUnitVectors, qMul, qRot, v3, type Quat, type Vec3 } from './vec';

const RAD = Math.PI / 180;
/** Rapier's angular joint axes, in the order of a box ([X, Y, Z]). */
export const ANG_AXES = [RAPIER.JointAxis.AngX, RAPIER.JointAxis.AngY, RAPIER.JointAxis.AngZ] as const;
const REF = v3(0, -1, 0);

/** A box of per-axis angular limits [lo, hi] (rad) about the joint frame's X, Y, Z. */
export type AngBox = [[number, number], [number, number], [number, number]];

/** The one wrapper of Rapier's raw per-axis limit call (enables the limit on that axis). */
export function setAngularLimits(joint: RAPIER.ImpulseJoint, axis: (typeof ANG_AXES)[number], lo: number, hi: number): void {
  (joint as unknown as { rawSet: { jointSetLimits(h: number, a: number, lo: number, hi: number): void } }).rawSet.jointSetLimits(joint.handle, axis, lo, hi);
}

/** Rapier's own record of an axis limit (enabled, min, max; rad). */
export function readAngularLimits(joint: RAPIER.ImpulseJoint, axis: (typeof ANG_AXES)[number]): { enabled: boolean; min: number; max: number } {
  const raw = (joint as unknown as { rawSet: { jointLimitsEnabled(h: number, a: number): boolean; jointLimitsMin(h: number, a: number): number; jointLimitsMax(h: number, a: number): number } }).rawSet;
  return { enabled: raw.jointLimitsEnabled(joint.handle, axis), min: raw.jointLimitsMin(joint.handle, axis), max: raw.jointLimitsMax(joint.handle, axis) };
}

/**
 * The hip's anatomical frame on the core (the joint's frame1; frame2 on the thigh is the identity): the neutral the
 * stops are measured from, in core coordinates. The segment frames are anatomical by construction (`src/sim/pose.ts`:
 * the core's X lateral, Y up, Z forward; the thigh's -Y along the hip-knee line, X its knee axis), and on the model body
 * the calibration fits them to the mesh (`segmentRest`, bew-v6: the rest thigh's -Y on the mesh's hip-knee line, X on its
 * knee axis). The neutral is that calibrated rest thigh with its swing taken out (the thigh parallel to the trunk axis;
 * the rest stance's 8 deg abduction and 1 deg flexion are a stance, not the zero of the range), keeping its twist (the
 * knee forward as the mesh has it: under 0.1 deg). An authored body has no calibration: the neutral is the core's own
 * frame. Each side from its own rest, so the two mirror.
 */
export function hipNeutralFrame(body: BodyProfile, side: ArmSide): Quat {
  if (body.measured?.calibrationId !== MODEL_CALIBRATION_ID) return { x: 0, y: 0, z: 0, w: 1 };
  const [cx, cy, cz, cw] = MODEL_CALIBRATION.segmentRest.core;
  if (Math.abs(cw) < 1 - 1e-9 || cx || cy || cz) throw new Error('hipNeutralFrame: the calibration core rest is not its own frame');
  const [x, y, z, w] = MODEL_CALIBRATION.segmentRest[`${side}Thigh`];
  const rest: Quat = { x, y, z, w };
  // the twist about the thigh's Y left after the shortest swing from hanging
  const swing = qFromUnitVectors(REF, qRot(rest, REF));
  const t = qMul(qConj(swing), rest);
  const n = Math.hypot(t.y, t.w);
  return { x: 0, y: t.y / n, z: 0, w: t.w / n };
}

/**
 * The stops as a box about the joint frame's axes (rad): X [-flexion, extension] (a positive turn about X swings the
 * thigh back); Y the twist about the thigh, external = side sign x twist; Z ab/adduction, toward +X positive, so away from
 * the midline on the side of sign +1.
 */
export function hipStopBox(S: HipStopProfile, sideSign: number): AngBox {
  const out = sideSign > 0;
  return [
    [-S.flexionDeg * RAD, S.extensionDeg * RAD],
    out ? [-S.internalDeg * RAD, S.externalDeg * RAD] : [-S.externalDeg * RAD, S.internalDeg * RAD],
    out ? [-S.adductionDeg * RAD, S.abductionDeg * RAD] : [-S.abductionDeg * RAD, S.adductionDeg * RAD],
  ];
}

/** The joint's relative rotation as Rapier limits it: (q1 f1)^-1 (q2 f2), sign-normalised to w >= 0. */
export function jointRelative(q1: Quat, f1: Quat, q2: Quat, f2: Quat = { x: 0, y: 0, z: 0, w: 1 }): Quat {
  const e = qMul(qConj(qMul(q1, f1)), qMul(q2, f2));
  return e.w < 0 ? { x: -e.x, y: -e.y, z: -e.z, w: -e.w } : e;
}

/** The box's reading of a relative rotation: per axis the angle whose half-sine is that component (rad). */
export const boxReading = (e: Quat): [number, number, number] => [e.x, e.y, e.z].map((c) => 2 * Math.asin(Math.max(-1, Math.min(1, c)))) as [number, number, number];

/** The box reading of a core-to-thigh rotation `rel` (core frame) of a hip with neutral frame `neutral`. */
export const hipStopReading = (rel: Quat, neutral: Quat): [number, number, number] => boxReading(jointRelative({ x: 0, y: 0, z: 0, w: 1 }, neutral, rel));

/** Ladder rung 8d: one hip's stops since the build. */
export interface HipStopRuntime {
  jointId: string;
  /** The joint's index in `Ragdoll.joints`. */
  jointIndex: number;
  /** The joint's frame on the core (`hipNeutralFrame`). */
  frame1: Quat;
  /** The profile's stops for this side, and the stops in force: widened to where the joint started, closing with it. */
  nominal: AngBox;
  current: AngBox;
  /** The largest excess past a stop at the start (deg), and past the cap (what the stop could not take in). */
  startOutsideDeg: number;
  startBeyondCapDeg: number;
}

/**
 * At the build: set the hip's frame and its stops, each widened to include where the joint starts (never past the
 * cap), so a conversion outside the stops starts at rest against them, not with a kick.
 */
export function initHipStop(joint: RAPIER.ImpulseJoint, jointId: string, jointIndex: number, q1: Quat, q2: Quat, frame1: Quat, S: HipStopProfile, sideSign: number): HipStopRuntime {
  joint.setFrameX1(frame1);
  const nominal = hipStopBox(S, sideSign);
  const v = boxReading(jointRelative(q1, frame1, q2));
  const cap = S.capDeg * RAD;
  let outside = 0;
  let beyond = 0;
  const current = nominal.map(([lo, hi], i) => {
    outside = Math.max(outside, lo - v[i], v[i] - hi);
    beyond = Math.max(beyond, Math.abs(v[i]) - cap);
    return [Math.max(-cap, Math.min(lo, v[i])), Math.min(cap, Math.max(hi, v[i]))];
  }) as AngBox;
  current.forEach(([lo, hi], i) => setAngularLimits(joint, ANG_AXES[i], lo, hi));
  return { jointId, jointIndex, frame1, nominal, current, startOutsideDeg: Math.max(0, outside) / RAD, startBeyondCapDeg: Math.max(0, beyond) / RAD };
}

/**
 * One substep, before the solve: a stop widened at the start closes to where the joint is now, while that is inside the
 * widened stop, and never past the profile's stop. It never opens again and never moves into the joint, so it holds a
 * joint that moves inward and pushes nothing. Returns whether any stop moved.
 */
export function ratchetHipStop(h: HipStopRuntime, joint: RAPIER.ImpulseJoint, q1: Quat, q2: Quat): boolean {
  let any = false;
  let v: [number, number, number] | null = null;
  for (let i = 0; i < 3; i++) {
    const [lo0, hi0] = h.nominal[i];
    const cur = h.current[i];
    if (cur[0] >= lo0 && cur[1] <= hi0) continue;
    v ??= boxReading(jointRelative(q1, h.frame1, q2));
    const lo = cur[0] < lo0 ? Math.min(lo0, Math.max(cur[0], v[i])) : cur[0];
    const hi = cur[1] > hi0 ? Math.max(hi0, Math.min(cur[1], v[i])) : cur[1];
    if (lo === cur[0] && hi === cur[1]) continue;
    h.current[i] = [lo, hi];
    setAngularLimits(joint, ANG_AXES[i], lo, hi);
    any = true;
  }
  return any;
}

/**
 * A limb direction (core frame) held inside the hip's stops less `marginRad`: the twist-free swing to it, its flexion
 * and ab/adduction components clamped, recomposed. A fall-response hip target (L4) would otherwise ask the thigh past a
 * stop and hold it pressed there.
 */
export function clampDirToHipStops(dir: Vec3, frame1: Quat, box: AngBox, marginRad: number): Vec3 {
  const e = qMul(qConj(frame1), qFromUnitVectors(REF, dir));
  const v = boxReading(e);
  const cl = (i: number): number => Math.max(box[i][0] + marginRad, Math.min(box[i][1] - marginRad, v[i]));
  if (cl(0) === v[0] && cl(2) === v[2]) return dir;
  const x = Math.sin(cl(0) / 2);
  const z = Math.sin(cl(2) / 2);
  const w = Math.sqrt(Math.max(0, 1 - x * x - e.y * e.y - z * z));
  const s = Math.hypot(x, e.y, z, w);
  return qRot(qMul(frame1, { x: x / s, y: e.y / s, z: z / s, w: w / s }), REF);
}
