// Ladder rung 8d: hard outer stops on the ragdoll's spherical hips (`RagdollProfile.hipStops`). Rapier 0.21's spherical
// joint takes per-axis angular limits, but its JavaScript API sets them only on unit joints (revolute, prismatic); the
// one call here (`setAngularLimits`) reaches the raw joint set it wraps. tests/joint-stops.test.ts pins that call, its
// readback and what it enforces, so a Rapier change fails loudly.
//
// What Rapier enforces, as measured (tests/joint-stops.test.ts drives a thigh into each stop at combined poses and finds
// where it halts): of the joint's relative rotation e = frame1^-1 * frame2 (each body's rotation times its local frame),
// sign-normalised to w >= 0, each axis's angle 2 atan2(e_i, w), the angle of the rotation's twist about that axis (its
// swing-twist split), is kept within the limit. On its own axis that is the rotation angle itself; combined it reads
// more than the half-sine of the component, 2 asin(e_i), which 8d took it for (at flexion 75 the adduction stop of 30
// holds at a half-sine reading of 24, at flexion 110 at 19.5). A rotation t about the thigh after a flexion f reads
// exactly f and t on X and Y and adds 2 atan(tan(f/2) tan(t/2)) on Z, so at flexion 90 a rotation toward adduction is
// held at 30 by the Z stop (`hipStopReading` gives the box's reading of any pose; the test tabulates it).
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArmSide } from './contracts';
import { MODEL_CALIBRATION, MODEL_CALIBRATION_ID } from './model/profiles';
import type { BodyProfile, HipApproachProfile, HipStopProfile } from './profiles';
import { add, addScaled, dot, m3Add, m3Inverse, m3ParallelAxis, m3Vec, qConj, qFromUnitVectors, qMul, qRot, scale, sub, v3, type Mat3, type Quat, type Vec3 } from './vec';

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

/** The box's reading of a relative rotation (w >= 0), as Rapier limits it: per axis 2 atan2(e_i, w) (rad). */
export const boxReading = (e: Quat): [number, number, number] => [e.x, e.y, e.z].map((c) => 2 * Math.atan2(c, e.w)) as [number, number, number];

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
  /** Ladder rung 8g: the approach zone's state (absent: the profile has none). */
  approach?: HipApproachRuntime;
}

/** Ladder rung 8g: one hip's approach zone since the build. */
export interface HipApproachRuntime {
  /** Per axis [lo, hi]: how far the joint started inside that band (rad); it follows the joint out and decays. */
  slack: AngBox;
  /** Torque applied to the thigh this substep (world; the core takes the opposite), and the largest band depth (deg). */
  torque: Vec3;
  maxDepthDeg: number;
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
  const h: HipStopRuntime = { jointId, jointIndex, frame1, nominal, current, startOutsideDeg: Math.max(0, outside) / RAD, startBeyondCapDeg: Math.max(0, beyond) / RAD };
  if (S.approach) h.approach = { slack: bandDepths(nominal, S.approach, v).map(([a, b]) => [Math.max(0, a), Math.max(0, b)]) as AngBox, torque: v3(), maxDepthDeg: 0 };
  return h;
}

// ---------------------------------------------------------------- ladder rung 8g: the approach zone
const bandWidth = (A: HipApproachProfile, i: number): number => (i === 1 ? A.widthDeg.twist : A.widthDeg.swing) * RAD;

/** How deep a reading lies in each band of the nominal stops (rad, negative outside a band; past the stop counts on). */
function bandDepths(box: AngBox, A: HipApproachProfile, v: [number, number, number]): AngBox {
  return box.map(([lo, hi], i) => [lo + bandWidth(A, i) - v[i], v[i] - (hi - bandWidth(A, i))]) as AngBox;
}

/** The nominal stops less their bands: where the approach zone starts (the box a hip target is held inside). */
export const zoneStartBox = (box: AngBox, A: HipApproachProfile | undefined): AngBox => (A ? (box.map(([lo, hi], i) => [lo + bandWidth(A, i), hi - bandWidth(A, i)]) as AngBox) : box);

/**
 * The box reading's gradients (frame1 coordinates): for each axis the rate of that reading per turn of the thigh. A turn
 * d of the thigh (frame1 coordinates) takes e to (1, d / 2) e: the vector part moves by (w I - [v]x) d / 2 and w by
 * -v.d / 2, so the reading 2 atan2(e_i, w) by (w row_i + e_i v).d / (w^2 + e_i^2). Its length is 1 / sqrt(w^2 + e_i^2):
 * 1 on the reading's own axis alone, more at combined poses (the reading moves faster than the turn there).
 */
export function boxGradients(e: Quat): [Vec3, Vec3, Vec3] {
  const { x, y, z, w } = e;
  const n = (c: number): number => 1 / Math.max(1e-12, w * w + c * c);
  return [
    scale(v3(w * w + x * x, w * z + x * y, x * z - w * y), n(x)),
    scale(v3(x * y - w * z, w * w + y * y, w * x + y * z), n(y)),
    scale(v3(w * y + x * z, y * z - w * x, w * w + z * z), n(z)),
  ];
}

/** g . M g for a symmetric 3x3 matrix given by its upper triangle (Rapier's SdpMatrix3). */
const quad = (M: { m11: number; m12: number; m13: number; m22: number; m23: number; m33: number }, g: Vec3): number =>
  M.m11 * g.x * g.x + M.m22 * g.y * g.y + M.m33 * g.z * g.z + 2 * (M.m12 * g.x * g.y + M.m13 * g.x * g.z + M.m23 * g.y * g.z);

/**
 * One substep, before the solve: the approach zone's torque pair on the thigh and the core. Per band, the rate u at which
 * the reading goes deeper and the depth x it reaches by the end of the substep at that rate (x now + u dt, less the start
 * slack): a generalised force m = min(cap, max(0, min(k x, cap) + c' u)) on the reading, the torque m g with g the
 * reading's gradient (`boxGradients`), out of the band; its work is m times the reading's change, so the spring is the
 * band's energy. Read at the end of the substep, a spring entered or left within one gives nothing back (read at its
 * start, the substep that enters gets no spring and the one that leaves a whole one, tests/hip-approach.test.ts). c' is
 * the damping, never more than stops u in one substep: at most 1 / (dt g.(I_thigh^-1 + I_core^-1).g), the thigh's
 * inertia about the hip (`anchorLocal`, on the thigh) and the core's own, so a light axis (the thigh's twist) is not
 * overdamped into turning back. The slack tightens as the joint comes out of the band, then decays.
 */
export function applyHipApproach(h: HipStopRuntime, A: HipApproachProfile, core: RAPIER.RigidBody, thigh: RAPIER.RigidBody, anchorLocal: Vec3, dt: number): Vec3 {
  const z = h.approach!;
  const q1 = core.rotation();
  const F = qMul(q1, h.frame1);
  const e = jointRelative(q1, h.frame1, thigh.rotation());
  const v = boxReading(e);
  const g1 = boxGradients(e);
  const decay = A.slackDecayDegPerS * RAD * dt;
  const depth = bandDepths(h.nominal, A, v);
  let torque = v3();
  const w1 = core.angvel();
  const w2 = thigh.angvel();
  const wRel = sub(v3(w2.x, w2.y, w2.z), v3(w1.x, w1.y, w1.z));
  let inv: ((g: Vec3) => number) | null = null;
  for (let i = 0; i < 3; i++) {
    const S = i === 1 ? A.twist : A.swing;
    const g = qRot(F, g1[i]);
    const rate = dot(g, wRel);
    for (let k = 0; k < 2; k++) {
      // k 0: the lower stop (the reading goes deeper as it falls); 1: the upper
      const sign = k === 0 ? -1 : 1;
      const d = depth[i][k];
      z.slack[i][k] = Math.max(0, Math.min(z.slack[i][k], d) - decay);
      const u = sign * rate;
      const x = d + u * dt - z.slack[i][k];
      if (x <= 0) continue;
      z.maxDepthDeg = Math.max(z.maxDepthDeg, (d - z.slack[i][k]) / RAD);
      inv ??= (() => {
        // the inertia views are shared scratch: read each at once
        const I1 = core.effectiveWorldInvInertia();
        const i1 = { m11: I1.m11, m12: I1.m12, m13: I1.m13, m22: I1.m22, m23: I1.m23, m33: I1.m33 };
        const I2 = thigh.effectiveAngularInertia();
        const c2: Mat3 = [I2.m11, I2.m12, I2.m13, I2.m12, I2.m22, I2.m23, I2.m13, I2.m23, I2.m33];
        const t2 = thigh.translation();
        const com = thigh.worldCom();
        const hip = add(v3(t2.x, t2.y, t2.z), qRot(thigh.rotation(), anchorLocal));
        const i2 = m3Inverse(m3Add(c2, m3ParallelAxis(thigh.mass(), sub(v3(com.x, com.y, com.z), hip))));
        return (gw: Vec3): number => quad(i1, gw) + (i2 ? dot(gw, m3Vec(i2, gw)) : 0);
      })();
      const c = Math.min(S.dampingNmsPerRad, 1 / (dt * Math.max(inv(g), 1e-9)));
      const m = Math.min(A.maxTorqueNm, Math.max(0, Math.min(S.stiffnessNmPerRad * x, A.maxTorqueNm) + c * u));
      torque = addScaled(torque, g, -sign * m);
    }
  }
  z.torque = torque;
  if (torque.x !== 0 || torque.y !== 0 || torque.z !== 0) {
    thigh.addTorque(torque, true);
    core.addTorque(scale(torque, -1), true);
  }
  return torque;
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
 * and ab/adduction readings clamped, recomposed (each reading fixes its component's ratio to w, tan of half of it; the
 * twist's ratio kept). A fall-response hip target (L4) would otherwise ask the thigh past a stop and hold it pressed there.
 */
export function clampDirToHipStops(dir: Vec3, frame1: Quat, box: AngBox, marginRad: number): Vec3 {
  const e = jointRelative({ x: 0, y: 0, z: 0, w: 1 }, frame1, qFromUnitVectors(REF, dir));
  const v = boxReading(e);
  const cl = (i: number): number => Math.max(box[i][0] + marginRad, Math.min(box[i][1] - marginRad, v[i]));
  if (cl(0) === v[0] && cl(2) === v[2]) return dir;
  const x = Math.tan(cl(0) / 2);
  const y = e.y / e.w;
  const z = Math.tan(cl(2) / 2);
  const s = Math.hypot(x, y, z, 1);
  return qRot(qMul(frame1, { x: x / s, y: y / s, z: z / s, w: 1 / s }), REF);
}

// ---------------------------------------------------------------- ladder rung 8f: the knee's flexion stop
/** Ladder rung 8f: one knee's flexion stop since the build (the hinge's upper Rapier limit; `RagdollProfile.kneeFlexionStopDeg`). */
export interface KneeStopRuntime {
  jointId: string;
  /** The joint's index in `Ragdoll.joints`. */
  jointIndex: number;
  /** The profile's stop and the stop in force (rad): widened to where the knee started, closing with it. */
  nominal: number;
  current: number;
  /** How far past the stop the knee started (deg). */
  startOutsideDeg: number;
}

/**
 * The hinge's angle as Rapier limits it (rad): the X reading of the relative rotation (`boxReading`), sign-normalised.
 * The ragdoll's hinges are built on their local X in both bodies (`JointData.revolute(.., X)`), so the joint frames are
 * the identity.
 */
export const hingeReading = (q1: Quat, q2: Quat): number => boxReading(jointRelative(q1, { x: 0, y: 0, z: 0, w: 1 }, q2))[0];

/**
 * At the build: the knee's upper limit at the stop, or at where the knee starts if that is past it (never past the
 * hinge's own limit, which the candidate's validation reads, so the stop changes no conversion).
 */
export function initKneeStop(joint: RAPIER.RevoluteImpulseJoint, jointId: string, jointIndex: number, q1: Quat, q2: Quat, lowerRad: number, upperRad: number, stopDeg: number): KneeStopRuntime {
  const nominal = Math.min(upperRad, stopDeg * RAD);
  const v = hingeReading(q1, q2);
  const current = Math.min(upperRad, Math.max(nominal, v));
  joint.setLimits(lowerRad, current);
  return { jointId, jointIndex, nominal, current, startOutsideDeg: Math.max(0, v - nominal) / RAD };
}

/** One substep, before the solve: a widened knee stop closes to where the knee is now, never past the stop or outward. */
export function ratchetKneeStop(k: KneeStopRuntime, joint: RAPIER.RevoluteImpulseJoint, lowerRad: number, q1: Quat, q2: Quat): boolean {
  if (k.current <= k.nominal) return false;
  const next = Math.max(k.nominal, Math.min(k.current, hingeReading(q1, q2)));
  if (next === k.current) return false;
  k.current = next;
  joint.setLimits(lowerRad, next);
  return true;
}

/** A knee target (rad) held at the knee's stop in force (none: as it is). */
export const clampToKneeStop = (target: number, k: KneeStopRuntime | undefined): number => (k ? Math.min(target, k.current) : target);
