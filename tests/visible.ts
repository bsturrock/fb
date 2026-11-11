// Ladder rung 8c: the visible-quality measures of every drawn frame, observation only. Ported from the visible audit
// (`.scratch/ladder/visible-audit/` in the main checkout: scripts/measure.ts, scan.ts, axes.ts) for the full check's
// visible matrix (scripts/check/visiblemx.ts; definitions and the human range table in scripts/check/README.md).
//
// A drawn frame is a player's published pose (`PlayerRuntime.pose`) at the end of an outer tick: what the lab draws
// (interpolated between ticks at slow speed; extremes inside a tick's physics substeps are never drawn, so never
// counted). For a ragdoll that pose is its Rapier bodies. Every angle is read from the drawn segment transforms in the
// anatomical frame of the joint, never from controller internals.
//
// Off-run cost nothing: the meter only reads a Simulation after each `stepTick`.
import RAPIER from '@dimforge/rapier3d-compat';
import type { FixtureDef } from '../src/sim/fixture';
import { swingExcess } from '../src/sim/joint-cone';
import { poseLimbShapes, type PhysicalPose } from '../src/sim/pose';
import { DEFAULT_POSE_PROFILE, JOINT_RANGE_V2, sideSignX, type BodyProfile, type RagdollProfile } from '../src/sim/profiles';
import { externalTwistRad, swingTwistOf } from '../src/sim/ragdoll';
import { Simulation } from '../src/sim/simulation';
import { add, addScaled, dot, len, norm, qConj, qFromUnitVectors, qMul, qRot, sub, v3, type Quat, type Vec3 } from '../src/sim/vec';

const D = 180 / Math.PI;
type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];

// ------------------------------------------------------------------------------------------------ joint angles
/** Twist (rad) of q about a unit axis (swing-twist split), in (-pi, pi]. */
function twistAbout(q: Quat, a: Vec3): number {
  let t = 2 * Math.atan2(q.x * a.x + q.y * a.y + q.z * a.z, q.w);
  if (t > Math.PI) t -= 2 * Math.PI;
  if (t <= -Math.PI) t += 2 * Math.PI;
  return t;
}
const rel = (pose: PhysicalPose, parent: string, child: string): Quat => qMul(qConj(pose.segments[parent as 'core'].rotationWorld), pose.segments[child as 'core'].rotationWorld);

/**
 * The hip's anatomical angles (deg) from the thigh's rotation relative to the core (core -> thigh, core frame). The
 * frame: the core's X is the body's left-right axis (flexion about it), Z forward (abduction about it), Y up; the thigh's
 * -Y is its long axis (rotation about it) and X its knee axis. Zero is the anatomical neutral, the thigh parallel to the
 * trunk axis with the knee forward (both segment frames aligned). `sideSign` is the side's sign along the core's X
 * (`sideSignX`), which mirrors abduction and rotation per side.
 *  - flex: sagittal angle of the thigh from hanging, positive forward (past 90 folded toward the chest), -ext behind;
 *  - abd: angle out of the sagittal plane, positive away from the midline, negative across it (adduction);
 *  - rot: axial rotation about the thigh (plan 09's swing-twist twist from hanging), positive external;
 *  - swing: angle of the thigh from hanging.
 */
export function hipAngles(q: Quat, sideSign: number): { flex: number; abd: number; rot: number; swing: number } {
  const st = swingTwistOf(q);
  const d = st.dir;
  return {
    flex: Math.atan2(d.z, -d.y) * D,
    abd: Math.asin(Math.max(-1, Math.min(1, sideSign * d.x))) * D,
    rot: externalTwistRad({ neutralTwistDeg: 0 } as never, st.twistRad, sideSign) * D,
    swing: st.swingRad * D,
  };
}

/**
 * Every joint's anatomical measures of a drawn pose (deg):
 *  hip: `hipAngles`;
 *  knee/elbow: flex (twist of the child about the parent's hinge X; + flexion, - hyperextension), off (angle between the
 *    two hinge axes: varus/valgus and axial rotation, 0 for a hinge);
 *  shoulder: swing, coneEx (excess past the joint-range-v2 cone, the repo's fitted range), rot (plan 09 twist, external
 *    positive, neutral 180);
 *  neck: flex (about the core X), off / yoff (anything else: turn and tilt; the ragdoll neck is a hinge);
 *  ankle: pitch (published `anklePitchDeg`, + toe down), where the pose has one.
 */
export function jointAngles(pose: PhysicalPose, body: BodyProfile): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  const shE = JOINT_RANGE_V2.shoulder;
  for (const s of SIDES) {
    const ss = sideSignX(body, s);
    out[`${s}Hip`] = hipAngles(rel(pose, 'core', `${s}Thigh`), ss);
    for (const [j, a, b] of [[`${s}Knee`, `${s}Thigh`, `${s}Shin`], [`${s}Elbow`, `${s}UpperArm`, `${s}Forearm`]]) {
      const q = rel(pose, a, b);
      const xc = qRot(q, v3(1, 0, 0));
      out[j] = { flex: twistAbout(q, v3(1, 0, 0)) * D, off: Math.acos(Math.max(-1, Math.min(1, xc.x))) * D };
    }
    const st = swingTwistOf(rel(pose, 'core', `${s}UpperArm`));
    out[`${s}Shoulder`] = { swing: st.swingRad * D, coneEx: swingExcess(shE, st.dir, ss).rad * D, rot: externalTwistRad(shE, st.twistRad, ss) * D };
    const pitch = pose.anklePitchDeg?.[s];
    if (pitch !== undefined) out[`${s}Ankle`] = { pitch };
  }
  const qn = rel(pose, 'core', 'head');
  const xn = qRot(qn, v3(1, 0, 0));
  const yn = qRot(qn, v3(0, 1, 0));
  out.neck = { flex: twistAbout(qn, v3(1, 0, 0)) * D, off: Math.acos(Math.max(-1, Math.min(1, xn.x))) * D, yoff: Math.acos(Math.max(-1, Math.min(1, Math.hypot(yn.y, yn.z)))) * D };
  return out;
}

/** Relative rotation (parent -> child) of every joint, for the frame-to-frame joint speed. */
function jointQuats(pose: PhysicalPose): Record<string, Quat> {
  const o: Record<string, Quat> = {};
  for (const s of SIDES) {
    o[`${s}Hip`] = rel(pose, 'core', `${s}Thigh`);
    o[`${s}Knee`] = rel(pose, `${s}Thigh`, `${s}Shin`);
    o[`${s}Shoulder`] = rel(pose, 'core', `${s}UpperArm`);
    o[`${s}Elbow`] = rel(pose, `${s}UpperArm`, `${s}Forearm`);
  }
  o.neck = rel(pose, 'core', 'head');
  return o;
}
const qAngle = (a: Quat, b: Quat): number => 2 * Math.acos(Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)));

// ------------------------------------------------------------------------------------------------ human ranges
/** One DOF's check: the excess (deg, <= 0 inside) past the human range, implausible and impossible margins past it. */
export interface RangeCheck {
  joint: 'Hip' | 'Knee' | 'Elbow' | 'Shoulder' | 'neck' | 'Ankle';
  dof: string;
  excess: (m: Record<string, number>) => number;
  implausible: number;
  impossible: number;
}

/**
 * Standard active ranges of adult joints (AAOS; Norkin & White, Measurement of Joint Motion): hip flexion 120 (knee
 * bent), extension 30, abduction 45, adduction 30, internal and external rotation 45; knee flexion 140, hyperextension 0;
 * elbow flexion 150, hyperextension 5; shoulder: the repo's joint-range-v2 swing cone (fitted to 45 deg behind the side
 * line hanging) and twist +-100 about neutral (ER 90 / IR 70 standard); neck flexion 50, extension 60, rotation and tilt
 * 45; ankle dorsiflexion 20, plantarflexion 50. Implausible / impossible: this many deg past the range (most DOF 15 / 30;
 * knee 10 / 20, so 150 / 160 flexion; elbow 5 / 15; ...). The hip's sagittal angle is ambiguous once the thigh passes
 * vertical toward the head or lies out to the side, so past 150 deg of swing the thigh is a `fold` (impossible either
 * way) and flexion / extension are read only below that and within 60 deg of the sagittal plane; hip rotation is not
 * read past 150 deg of swing, where the twist is ill-defined.
 */
export const HUMAN_RANGES: RangeCheck[] = [
  { joint: 'Hip', dof: 'flexion', excess: (m) => (m.swing > 150 || Math.abs(m.abd) > 60 ? -1 : m.flex - 120), implausible: 15, impossible: 30 },
  { joint: 'Hip', dof: 'extension', excess: (m) => (m.swing > 150 || Math.abs(m.abd) > 60 ? -1 : -m.flex - 30), implausible: 15, impossible: 30 },
  { joint: 'Hip', dof: 'fold', excess: (m) => (m.swing > 150 ? m.swing - 120 : -1), implausible: 15, impossible: 30 },
  { joint: 'Hip', dof: 'abduction', excess: (m) => m.abd - 45, implausible: 15, impossible: 30 },
  { joint: 'Hip', dof: 'adduction', excess: (m) => -m.abd - 30, implausible: 15, impossible: 30 },
  { joint: 'Hip', dof: 'rotation', excess: (m) => (m.swing > 150 ? -1 : Math.abs(m.rot) - 45), implausible: 15, impossible: 30 },
  { joint: 'Knee', dof: 'flexion', excess: (m) => m.flex - 140, implausible: 10, impossible: 20 },
  { joint: 'Knee', dof: 'hyperextension', excess: (m) => -m.flex, implausible: 5, impossible: 10 },
  { joint: 'Knee', dof: 'offAxis', excess: (m) => m.off - 5, implausible: 10, impossible: 20 },
  { joint: 'Elbow', dof: 'flexion', excess: (m) => m.flex - 150, implausible: 5, impossible: 15 },
  { joint: 'Elbow', dof: 'hyperextension', excess: (m) => -m.flex - 5, implausible: 5, impossible: 10 },
  { joint: 'Elbow', dof: 'offAxis', excess: (m) => m.off - 5, implausible: 10, impossible: 20 },
  { joint: 'Shoulder', dof: 'swing', excess: (m) => m.coneEx, implausible: 15, impossible: 30 },
  { joint: 'Shoulder', dof: 'rotation', excess: (m) => Math.abs(m.rot) - 100, implausible: 15, impossible: 30 },
  { joint: 'neck', dof: 'flexExt', excess: (m) => (m.flex >= 0 ? m.flex - 50 : -m.flex - 60), implausible: 10, impossible: 25 },
  { joint: 'neck', dof: 'offAxis', excess: (m) => Math.max(m.off, m.yoff) - 45, implausible: 15, impossible: 35 },
  { joint: 'Ankle', dof: 'dorsiflexion', excess: (m) => -m.pitch - 20, implausible: 10, impossible: 20 },
  { joint: 'Ankle', dof: 'plantarflexion', excess: (m) => m.pitch - 50, implausible: 10, impossible: 20 },
];

/** The knee flexion (deg) past which a ragdoll knee counts as lying at the stop: human active 140 + its implausible 10. */
export const KNEE_STOP_DEG = 150;

// ------------------------------------------------------------------------------------------------ drawn shapes
type ShapeCls = 'thigh' | 'thighD' | 'shin' | 'shinD' | 'shoe' | 'upperArm' | 'upperArmD' | 'forearm' | 'palm' | 'trunk' | 'head';
/** A drawn shape: a capsule (segment a-b, radius r), a ball (a = b), or a Rapier shape (box, hull) at p, q. */
interface DShape {
  key: string;
  cls: ShapeCls;
  side?: Side;
  seg?: { a: Vec3; b: Vec3; r: number };
  shape?: RAPIER.Shape;
  p: Vec3;
  q: Quat;
  /** Bounding sphere. */
  c: Vec3;
  r: number;
}

const capsule = (key: string, cls: ShapeCls, a: Vec3, b: Vec3, r: number, side?: Side): DShape => {
  const c = addScaled(a, sub(b, a), 0.5);
  return { key, cls, side, seg: { a, b, r }, p: c, q: { x: 0, y: 0, z: 0, w: 1 }, c, r: len(sub(b, a)) / 2 + r };
};

/** Closest distance between segments p1-q1 and p2-q2. */
export function segDist(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = sub(q1, p1);
  const d2 = sub(q2, p2);
  const r = sub(p1, p2);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  if (a <= 1e-12 && e <= 1e-12) return len(r);
  let s: number;
  let t: number;
  if (a <= 1e-12) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const den = a * e - b * b;
      s = den > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  return len(sub(addScaled(p1, d1, s), addScaled(p2, d2, t)));
}

const hullCache = new WeakMap<object, { shape: RAPIER.Shape; c: Vec3; r: number; box: boolean }[]>();
function trunkPieces(body: BodyProfile): { shape: RAPIER.Shape; c: Vec3; r: number; box: boolean }[] {
  let hull = hullCache.get(body);
  if (hull) return hull;
  hull = [];
  const pieces = body.measured?.trunkHull;
  if (pieces)
    for (const pts of pieces) {
      const sum = pts.reduce((a, p) => add(a, p), v3());
      const c = v3(sum.x / pts.length, sum.y / pts.length, sum.z / pts.length);
      hull.push({ shape: new RAPIER.ConvexPolyhedron(new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])), undefined), c, r: Math.max(...pts.map((p) => len(sub(p, c)))), box: false });
    }
  else for (const part of [body.compound.torso, body.compound.pelvis]) hull.push({ shape: new RAPIER.Cuboid(part.halfExtents.x, part.halfExtents.y, part.halfExtents.z), c: { ...part.center }, r: len(part.halfExtents), box: true });
  hullCache.set(body, hull);
  return hull;
}

/**
 * Drawn shapes of a pose: the candidate's limb capsules, palm ball and shoe box (`poseLimbShapes`: on the model body
 * bew-v6's mesh-fit radii), the distal parts `thighD` / `shinD` / `upperArmD` (distal 45% / 50% / 50% of the bone, for
 * own-body pairs whose proximal ends meet by construction), the measured trunk hull pieces (the compound cuboids on an
 * authored body) and the head ball.
 */
function drawnShapes(pose: PhysicalPose, body: BodyProfile, R: RagdollProfile): DShape[] {
  const out: DShape[] = [];
  for (const sh of poseLimbShapes(R, pose)) {
    const side: Side = sh.key.startsWith('left') ? 'left' : 'right';
    const base = sh.key.replace(/^(left|right)/, '');
    const cls = (base[0].toLowerCase() + base.slice(1)) as ShapeCls;
    if (sh.kind === 'capsule') out.push(capsule(sh.key, cls, sh.a, sh.b, sh.r, side));
    else if (sh.kind === 'ball') out.push({ key: sh.key, cls: 'palm', side, seg: { a: sh.c, b: sh.c, r: sh.r }, p: sh.c, q: { x: 0, y: 0, z: 0, w: 1 }, c: sh.c, r: sh.r });
    else out.push({ key: sh.key, cls: 'shoe', side, shape: new RAPIER.Cuboid(sh.he.x, sh.he.y, sh.he.z), p: sh.c, q: sh.q, c: sh.c, r: len(sh.he) });
  }
  const lm = pose.jointLandmarksWorld;
  for (const s of SIDES) {
    const hip = lm[`${s}Hip`];
    const knee = lm[`${s}Knee`];
    const ank = lm[`${s}Ankle`];
    const sh = lm[`${s}Shoulder`];
    const el = lm[`${s}Elbow`];
    out.push(capsule(`${s}ThighD`, 'thighD', addScaled(hip, sub(knee, hip), 0.55), addScaled(knee, norm(sub(knee, hip)), -R.radii.thigh), R.radii.thigh, s));
    out.push(capsule(`${s}ShinD`, 'shinD', addScaled(knee, sub(ank, knee), 0.5), addScaled(ank, norm(sub(ank, knee)), -R.radii.shin), R.radii.shin, s));
    out.push(capsule(`${s}UpperArmD`, 'upperArmD', addScaled(sh, sub(el, sh), 0.5), addScaled(el, norm(sub(el, sh)), -R.radii.upperArm), R.radii.upperArm, s));
  }
  const core = pose.segments.core;
  trunkPieces(body).forEach((h, i) => {
    // hull pieces sit in the core frame about its origin; the cuboids at their centres
    const c = add(core.originWorld, qRot(core.rotationWorld, h.c));
    out.push({ key: `trunk${i}`, cls: 'trunk', shape: h.shape, p: h.box ? c : core.originWorld, q: core.rotationWorld, c, r: h.r });
  });
  const hc = lm.headCenter;
  if (hc) out.push({ key: 'head', cls: 'head', seg: { a: hc, b: hc, r: R.radii.head }, p: hc, q: { x: 0, y: 0, z: 0, w: 1 }, c: hc, r: R.radii.head });
  return out;
}

const asShape = (s: DShape): { shape: RAPIER.Shape; p: Vec3; q: Quat } => {
  if (s.shape) return { shape: s.shape, p: s.p, q: s.q };
  const g = s.seg!;
  const d = sub(g.b, g.a);
  const L = len(d);
  return { shape: L > 1e-9 ? new RAPIER.Capsule(L / 2, g.r) : new RAPIER.Ball(g.r), p: s.p, q: L > 1e-9 ? qFromUnitVectors(v3(0, 1, 0), norm(d, v3(0, 1, 0))) : s.q };
};

/** Penetration depth (m, > 0 overlapping) of two drawn shapes, else 0: capsules and balls exactly, the rest by Rapier. */
function depth(a: DShape, b: DShape): number {
  if (len(sub(a.c, b.c)) > a.r + b.r) return 0;
  if (a.seg && b.seg) return Math.max(0, a.seg.r + b.seg.r - segDist(a.seg.a, a.seg.b, b.seg.a, b.seg.b));
  const x = asShape(a);
  const y = asShape(b);
  const r = x.shape.contactShape(x.p, x.q, y.shape, y.p, y.q, 0);
  return r ? Math.max(0, -r.distance) : 0;
}

export type SelfClass = 'legLeg' | 'legTrunk' | 'legFold' | 'armLeg' | 'armTrunk' | 'armArm' | 'headLimb';
export const SELF_CLASSES: SelfClass[] = ['legLeg', 'legTrunk', 'legFold', 'armLeg', 'armTrunk', 'armArm', 'headLimb'];

/**
 * Own-body pairs that must not interpenetrate (proximal ends meet by construction, so distal parts there): left leg vs
 * right leg (thighD, shin, shoe crossing pairs); leg vs own trunk (thighD, shinD, shoe); the same leg's fold (shoe vs its
 * thigh, shinD vs its thighD: heel into buttock, calf through thigh); arm vs own legs (upperArmD, forearm, palm vs thigh,
 * shin, shoe); arm vs own trunk; arm vs the other arm; head vs own limbs.
 */
function selfPairs(sh: DShape[]): { a: DShape; b: DShape; cls: SelfClass }[] {
  const out: { a: DShape; b: DShape; cls: SelfClass }[] = [];
  const one = (cls: ShapeCls, side?: Side): DShape | undefined => sh.find((s) => s.cls === cls && (side === undefined || s.side === side));
  const trunk = sh.filter((s) => s.cls === 'trunk');
  const push = (a: DShape | undefined, b: DShape | undefined, cls: SelfClass): void => void (a && b && out.push({ a, b, cls }));
  const legs: ShapeCls[] = ['thighD', 'shin', 'shoe'];
  for (const a of legs)
    for (const b of legs) {
      if (a > b) continue;
      push(one(a, 'left'), one(b, 'right'), 'legLeg');
      if (a !== b) push(one(b, 'left'), one(a, 'right'), 'legLeg');
    }
  for (const s of SIDES) {
    for (const t of trunk) for (const a of ['thighD', 'shinD', 'shoe'] as ShapeCls[]) push(one(a, s), t, 'legTrunk');
    push(one('shoe', s), one('thigh', s), 'legFold');
    push(one('shinD', s), one('thighD', s), 'legFold');
    for (const a of ['upperArmD', 'forearm', 'palm'] as ShapeCls[]) for (const s2 of SIDES) for (const b of ['thigh', 'shin', 'shoe'] as ShapeCls[]) push(one(a, s), one(b, s2), 'armLeg');
    for (const t of trunk) for (const a of ['upperArmD', 'forearm', 'palm'] as ShapeCls[]) push(one(a, s), t, 'armTrunk');
    for (const b of ['forearm', 'palm', 'shinD', 'shoe', 'thighD'] as ShapeCls[]) push(one('head'), one(b, s), 'headLimb');
  }
  const arms: ShapeCls[] = ['upperArmD', 'forearm', 'palm'];
  for (const a of arms)
    for (const b of arms) {
      if (a > b) continue;
      push(one(a, 'left'), one(b, 'right'), 'armArm');
      if (a !== b) push(one(b, 'left'), one(a, 'right'), 'armArm');
    }
  return out;
}

// ------------------------------------------------------------------------------------------------ bone axes
/** A bone axis with its slim anatomical radius (m). */
interface Axis {
  k: string;
  a: Vec3;
  b: Vec3;
  r: number;
}
/** Distal half-thigh (7.5 cm), shin (5), ankle to shoe (4) per side and pelvis to neck (11). */
function boneAxes(lm: Record<string, Vec3>): Axis[] {
  const o: Axis[] = [];
  for (const s of SIDES) {
    o.push({ k: `${s}Thigh`, a: addScaled(lm[`${s}Hip`], sub(lm[`${s}Knee`], lm[`${s}Hip`]), 0.5), b: lm[`${s}Knee`], r: 0.075 });
    o.push({ k: `${s}Shin`, a: lm[`${s}Knee`], b: lm[`${s}Ankle`], r: 0.05 });
    o.push({ k: `${s}Foot`, a: lm[`${s}Ankle`], b: lm[`${s}Shoe`] ?? lm[`${s}Ankle`], r: 0.04 });
  }
  o.push({ k: 'trunk', a: lm.pelvisMid, b: lm.neck, r: 0.11 });
  return o;
}
/** Own pairs on different legs, or a leg and the trunk (the same leg's fold is the knee angle's). */
function ownAxisPairs(S: Axis[]): [Axis, Axis, 'legLeg' | 'legTrunk'][] {
  const o: [Axis, Axis, 'legLeg' | 'legTrunk'][] = [];
  const sideOf = (k: string): string => (k.startsWith('left') ? 'L' : k.startsWith('right') ? 'R' : 'T');
  for (const a of S)
    for (const b of S) {
      if (a.k >= b.k || sideOf(a.k) === sideOf(b.k)) continue;
      o.push([a, b, a.k === 'trunk' || b.k === 'trunk' ? 'legTrunk' : 'legLeg']);
    }
  return o;
}

// ------------------------------------------------------------------------------------------------ idle baseline
/**
 * How deep each own-body pair overlaps (fat shapes), and how near each own axis pair comes, while standing idle
 * (L3-F13-free, the whole run): the drawn mesh-fit shapes already touch there (inner thighs about 4 cm), so own-body
 * overlap is counted past that.
 */
export interface IdleBaseline {
  fat: Record<string, number>;
  axis: Record<string, number>;
}
export async function idleBaseline(def: FixtureDef): Promise<IdleBaseline> {
  const fat: Record<string, number> = {};
  const axis: Record<string, number> = {};
  const sim = await Simulation.create(def, {});
  const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
  while (!sim.done) {
    sim.stepTick();
    for (const p of sim.players) {
      if (!p.pose) continue;
      for (const pr of selfPairs(drawnShapes(p.pose, p.body, R))) {
        const k = `${pr.a.key}~${pr.b.key}`;
        fat[k] = Math.max(fat[k] ?? 0, depth(pr.a, pr.b));
      }
      for (const [a, b] of ownAxisPairs(boneAxes(p.pose.jointLandmarksWorld))) {
        const k = `${a.k}~${b.k}`;
        axis[k] = Math.min(axis[k] ?? 9, segDist(a.a, a.b, b.a, b.b));
      }
    }
  }
  sim.dispose();
  const r4 = (o: Record<string, number>): Record<string, number> => Object.fromEntries(Object.keys(o).sort().map((k) => [k, Number(o[k].toFixed(4))]));
  return { fat: r4(Object.fromEntries(Object.entries(fat).filter(([, v]) => v > 0))), axis: r4(axis) };
}

// ------------------------------------------------------------------------------------------------ the meter
/** Own-body drawn overlap counted (m past the idle baseline), and an event deep (peak past it). */
export const VIS_M = 0.01;
export const DEEP_M = 0.1;
/** A drawn frame turning a joint this fast (rad/s; 57 deg in one 60 Hz frame) is a snap. */
export const SNAP_RADPS = 60;

/** The worst event of a column in a run: player, what (joint.dof or class pair), peak, its time, start, end, severity. */
export type WorstEvent = [string, string, number, number, number, number, number];

interface Ev {
  t0: number;
  t1: number;
  peak: number;
  peakT: number;
  sev: number;
  what: string;
  gap: number;
  frames: number;
}

/** One run's columns (seconds are player-seconds, or player-pair-seconds for `cross`; summed over DOF or class). */
export interface VisibleRun {
  dur: number;
  ragS: number;
  supS: number;
  rag: { imp: Record<string, number>; impl: Record<string, number>; selfAx: Record<string, number>; selfDeep: Record<string, number>; self: Record<string, number>; snap60: number; kneeStop: number };
  sup: { imp: Record<string, number>; impl: Record<string, number>; selfAx: Record<string, number>; self: Record<string, number>; snap60: number };
  cross: { supSup: number; supRag: number; ragRag: number };
  /** Per accepted or rejected conversion: player, time, hips at the last supported frame [flex, abd, rot] left and right. */
  conv: [string, number, number[], number[]][];
  worst: Partial<Record<'ragImp' | 'ragImpl' | 'supImp' | 'ragSelfAx' | 'ragSelfDeep' | 'supSelfAx' | 'crossLeg' | 'snap60' | 'kneeStop', WorstEvent>>;
}

const r3 = (x: number): number => {
  const v = Number(x.toFixed(3));
  return v === 0 ? 0 : v;
};

/**
 * Reads every drawn frame of one run (`frame()` after each `stepTick`). Per player and frame, split ragdoll (`rag`) and
 * supported or falling proxy (`sup`): joints past the human range, own-body fat-shape overlap past the idle baseline by
 * class, own bone-axis crossings, cross-player leg overlap by pair kind, frame-to-frame joint speed, the knee at its
 * stop. Events are runs of consecutive frames past a threshold (gaps up to 2 frames merged); severity is the excess
 * integrated over the event's frames (deg s, cm s).
 */
export class VisibleMeter {
  private t = 0;
  private dt = 0;
  private readonly R: RagdollProfile;
  private readonly open = new Map<string, Ev>();
  private readonly prevQ = new Map<string, { rep: string; q: Record<string, Quat> }>();
  private readonly prevHip = new Map<string, { rep: string; l: number[]; r: number[] }>();
  private readonly run: VisibleRun = {
    dur: 0,
    ragS: 0,
    supS: 0,
    rag: { imp: {}, impl: {}, selfAx: {}, selfDeep: {}, self: {}, snap60: 0, kneeStop: 0 },
    sup: { imp: {}, impl: {}, selfAx: {}, self: {}, snap60: 0 },
    cross: { supSup: 0, supRag: 0, ragRag: 0 },
    conv: [],
    worst: {},
  };

  constructor(
    private readonly sim: Simulation,
    private readonly base: IdleBaseline,
  ) {
    this.R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
  }

  private worse(col: keyof VisibleRun['worst'], who: string, e: Ev, scale = 1): void {
    const w = this.run.worst[col];
    const sev = e.sev * scale;
    if (w && w[6] >= sev) return;
    this.run.worst[col] = [who, e.what, Number((e.peak * scale).toFixed(2)), r3(e.peakT), r3(e.t0), r3(e.t1), Number(sev.toFixed(3))];
  }

  /** An event's end: its contribution to the worst-event columns and the deep-overlap seconds. */
  private close(key: string, e: Ev): void {
    const [cat, mode, who, , tier] = key.split('|');
    if (cat === 'joint') {
      if (mode === 'rag') {
        this.worse('ragImpl', who, e);
        if (tier === 'imp') this.worse('ragImp', who, e);
        if (e.what.endsWith('Knee.flexion')) this.worse('kneeStop', who, e);
      } else if (tier === 'imp') this.worse('supImp', who, e);
    } else if (cat === 'self') {
      if (mode === 'rag' && e.peak > DEEP_M && !e.what.startsWith('legFold')) {
        const c = e.what.split(':')[0];
        this.run.rag.selfDeep[c] = (this.run.rag.selfDeep[c] ?? 0) + e.frames * this.dt;
        this.worse('ragSelfDeep', who, e, 100);
      }
    } else if (cat === 'axis') this.worse(mode === 'rag' ? 'ragSelfAx' : 'supSelfAx', who, e, 100);
    else if (cat === 'cross') this.worse('crossLeg', who, e, 100);
  }

  /** One frame of a tracked quantity `v` against `thr`; `tier` marks an event that reached a higher threshold. */
  private track(key: string, v: number, thr: number, what: () => string, tier?: number): void {
    let e = this.open.get(key);
    if (v > thr) {
      if (!e) {
        e = { t0: this.t, t1: this.t, peak: v, peakT: this.t, sev: 0, what: what(), gap: 0, frames: 0 };
        this.open.set(key, e);
      }
      e.t1 = this.t;
      e.gap = 0;
      e.frames++;
      e.sev += v * this.dt;
      if (v > e.peak) {
        e.peak = v;
        e.peakT = this.t;
        e.what = what();
      }
      if (tier !== undefined && v > tier && !key.endsWith('|imp')) {
        // promote: the same event, now one that reached the higher threshold
        this.open.delete(key);
        this.open.set(`${key}|imp`, e);
      }
    } else if (e && ++e.gap > 2) {
      this.close(key, e);
      this.open.delete(key);
    }
  }

  private trackTiered(base: string, v: number, thr: number, tier: number, what: () => string): void {
    // one event per (mode, player, joint, dof): it is keyed `<base>|imp` once it reaches the impossible margin
    const key = this.open.has(`${base}|imp`) ? `${base}|imp` : base;
    this.track(key, v, thr, what, tier);
  }

  frame(): void {
    const sim = this.sim;
    this.dt = sim.t - this.t;
    this.t = sim.t;
    const dt = this.dt;
    const players = [...sim.players].filter((p) => p.pose).sort((a, b) => (a.id < b.id ? -1 : 1));
    const shapes = new Map<string, DShape[]>();
    for (const p of players) {
      const pose = p.pose!;
      const mode = p.representation === 'ragdoll' ? 'rag' : 'sup';
      if (mode === 'rag') this.run.ragS += dt;
      else this.run.supS += dt;
      // joints
      const J = jointAngles(pose, p.body);
      const M = this.run[mode];
      for (const [jn, m] of Object.entries(J)) {
        const base = jn.replace(/^(left|right)/, '');
        for (const rc of HUMAN_RANGES) {
          if (rc.joint !== base) continue;
          const ex = rc.excess(m);
          const k = `${base}.${rc.dof}`;
          if (ex > rc.implausible) M.impl[k] = (M.impl[k] ?? 0) + dt;
          if (ex > rc.impossible) M.imp[k] = (M.imp[k] ?? 0) + dt;
          this.trackTiered(`joint|${mode}|${p.id}|${jn}.${rc.dof}`, ex, rc.implausible, rc.impossible, () => `${jn}.${rc.dof}`);
        }
        if (mode === 'rag' && base === 'Knee' && m.flex > KNEE_STOP_DEG) this.run.rag.kneeStop += dt;
      }
      // the hips at the last supported frame before a conversion
      const hips = { rep: p.representation, l: ['flex', 'abd', 'rot'].map((f) => Number(J.leftHip[f].toFixed(1))), r: ['flex', 'abd', 'rot'].map((f) => Number(J.rightHip[f].toFixed(1))) };
      const ph = this.prevHip.get(p.id);
      if (ph && ph.rep !== 'ragdoll' && p.representation === 'ragdoll') this.run.conv.push([p.id, r3(this.t), ph.l, ph.r]);
      this.prevHip.set(p.id, hips);
      // joint speed between consecutive drawn frames of the same representation
      const Q = jointQuats(pose);
      const pq = this.prevQ.get(p.id);
      if (pq && pq.rep === p.representation)
        for (const [jn, q] of Object.entries(Q)) {
          const w = qAngle(pq.q[jn], q) / dt;
          if (w <= SNAP_RADPS) continue;
          M.snap60++;
          if (mode === 'rag') {
            const was = this.run.worst.snap60;
            if (!was || w > was[2]) this.run.worst.snap60 = [p.id, jn, Number(w.toFixed(1)), r3(this.t), r3(this.t - dt), r3(this.t), Number((w * dt).toFixed(3))];
          }
        }
      this.prevQ.set(p.id, { rep: p.representation, q: Q });
      // own-body drawn overlap past the idle baseline, the worst pair of each class
      const measured = !!p.body.measured?.trunkHull;
      const sh = drawnShapes(pose, p.body, this.R);
      shapes.set(p.id, sh);
      const worst = new Map<SelfClass, { d: number; pair: string }>();
      for (const pr of selfPairs(sh)) {
        // an authored body's shoulder pivot sits inside its padded trunk box: arm vs own trunk is not read there
        if (!measured && pr.cls === 'armTrunk') continue;
        const k = `${pr.a.key}~${pr.b.key}`;
        const v = depth(pr.a, pr.b) - (this.base.fat[k] ?? 0);
        if (v <= 0) continue;
        const w = worst.get(pr.cls);
        if (!w || v > w.d) worst.set(pr.cls, { d: v, pair: k });
      }
      for (const cls of SELF_CLASSES) {
        const w = worst.get(cls);
        const v = w?.d ?? 0;
        if (v > VIS_M) M.self[cls] = (M.self[cls] ?? 0) + dt;
        this.track(`self|${mode}|${p.id}|${cls}`, v, VIS_M, () => `${cls}:${w?.pair}`);
      }
      // own bone-axis crossing: closer than the slim radii and at least 2 cm closer than the pair gets idle
      const ax: Partial<Record<'legLeg' | 'legTrunk', { d: number; pair: string }>> = {};
      for (const [a, b, cls] of ownAxisPairs(boneAxes(pose.jointLandmarksWorld))) {
        const thr = Math.min(a.r + b.r, (this.base.axis[`${a.k}~${b.k}`] ?? 9) - 0.02);
        const dp = thr - segDist(a.a, a.b, b.a, b.b);
        if (dp > 0 && (!ax[cls] || dp > ax[cls]!.d)) ax[cls] = { d: dp, pair: `${a.k}~${b.k}` };
      }
      for (const cls of ['legLeg', 'legTrunk'] as const) {
        const v = ax[cls]?.d ?? 0;
        if (v > 0) M.selfAx[cls] = (M.selfAx[cls] ?? 0) + dt;
        this.track(`axis|${mode}|${p.id}|${cls}`, v, 0, () => `${cls}:${ax[cls]?.pair}`);
      }
    }
    // cross-player leg overlap (full drawn leg shapes, no baseline), by the pair's representations
    const LEG = new Set<ShapeCls>(['thigh', 'shin', 'shoe']);
    for (let i = 0; i < players.length; i++)
      for (let j = i + 1; j < players.length; j++) {
        const A = shapes.get(players[i].id)!.filter((s) => LEG.has(s.cls));
        const B = shapes.get(players[j].id)!.filter((s) => LEG.has(s.cls));
        let best = { d: 0, pair: '' };
        for (const a of A)
          for (const b of B) {
            const d = depth(a, b);
            if (d > best.d) best = { d, pair: `${players[i].id}.${a.key}~${players[j].id}.${b.key}` };
          }
        const ra = players[i].representation === 'ragdoll';
        const rb = players[j].representation === 'ragdoll';
        const kind = ra && rb ? 'ragRag' : ra || rb ? 'supRag' : 'supSup';
        if (best.d > VIS_M) this.run.cross[kind] += dt;
        this.track(`cross|${kind}|${players[i].id}${players[j].id}|legLeg`, best.d, VIS_M, () => `${kind}:${best.pair}`);
      }
  }

  /** Close every open event and return the run's columns, rounded for a compared file. */
  finish(): VisibleRun {
    for (const [k, e] of this.open) this.close(k, e);
    this.open.clear();
    const run = this.run;
    run.dur = r3(this.t);
    run.ragS = r3(run.ragS);
    run.supS = r3(run.supS);
    const rnd = (o: Record<string, number>): Record<string, number> =>
      Object.fromEntries(
        Object.keys(o)
          .sort()
          .filter((k) => r3(o[k]) !== 0)
          .map((k) => [k, r3(o[k])]),
      );
    run.rag = { ...run.rag, imp: rnd(run.rag.imp), impl: rnd(run.rag.impl), selfAx: rnd(run.rag.selfAx), selfDeep: rnd(run.rag.selfDeep), self: rnd(run.rag.self), kneeStop: r3(run.rag.kneeStop) };
    run.sup = { ...run.sup, imp: rnd(run.sup.imp), impl: rnd(run.sup.impl), selfAx: rnd(run.sup.selfAx), self: rnd(run.sup.self) };
    run.cross = { supSup: r3(run.cross.supSup), supRag: r3(run.cross.supRag), ragRag: r3(run.cross.ragRag) };
    run.worst = Object.fromEntries(Object.keys(run.worst).sort().map((k) => [k, run.worst[k as keyof VisibleRun['worst']]]));
    return run;
  }
}
