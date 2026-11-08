// Plan 10d: the lab's render interpolation and its one drawn ball, pure (no three.js, no DOM) so the tests reach what
// the lab draws. The lab interpolates two solved poses of one representation between ticks; the drawn ball is chosen
// here for both the rule overlay and a player view.
import type { SegmentId } from '../sim/contracts';
import { CARRY_ARM, lerpSeat } from '../sim/carry';
import type { RuleProfile } from '../sim/profiles';
import { carriedBall, type PhysicalPose } from '../sim/pose';
import { lerp, qFromAxisAngle, qMul, qSlerp, toLocal, toWorld, v3, type Pose, type Quat, type Vec3 } from '../sim/vec';

/** The part of a solved pose the render interpolation reads (what the lab keeps of the previous tick). */
export type PoseKey = Pick<PhysicalPose, 'segments' | 'jointLandmarksWorld' | 'carry' | 'anklePitchDeg'>;

/**
 * The segment whose frame carries a landmark through a blend: arm and leg joints on the limb segment they ride on (a
 * proximal joint on its own segment's origin), the head's on the head, everything else on the core.
 */
export function landmarkSegment(name: string): SegmentId {
  if (name === 'carriedBall') return `${CARRY_ARM}Forearm`;
  const m = /^(left|right)(Shoulder|Elbow|Wrist|Palm|Hand|Hip|Knee|Ankle|Shoe)$/.exec(name);
  if (m) {
    const s = m[1] as 'left' | 'right';
    if (m[2] === 'Shoulder') return `${s}UpperArm`;
    if (m[2] === 'Hip') return `${s}Thigh`;
    if (m[2] === 'Knee' || m[2] === 'Ankle' || m[2] === 'Shoe') return `${s}Shin`;
    return `${s}Forearm`;
  }
  if (name === 'neck' || name === 'headCenter') return 'head';
  return 'core';
}

const segPose = (s: PhysicalPose['segments'][SegmentId]): Pose => ({ p: s.originWorld, q: s.rotationWorld });

/**
 * Interpolate two compatible solved poses (same representation; reset at a representation change). Segments blend by
 * position and slerp; every landmark blends in its own segment's frame and is placed on the blended segment, so the
 * drawn joints, hand and palm stay on the blended limbs (and with the model the rig adapter drives from them). The carry
 * seat blends with `lerpSeat`, so the ball stays seated on the blended forearm. At `t` >= 1 it is `b`.
 */
export function lerpPose(a: PoseKey, b: PhysicalPose, t: number): PhysicalPose {
  // the solved pose itself at the end of the blend (a ragdoll's f32 rotations are not exactly unit: a slerp renormalises)
  if (t >= 1) return b;
  const segments = { ...b.segments };
  for (const k of Object.keys(b.segments) as SegmentId[]) {
    const sa = a.segments[k];
    const sb = b.segments[k];
    if (sa && sb) segments[k] = { segmentId: k, originWorld: lerp(sa.originWorld, sb.originWorld, t), rotationWorld: qSlerp(sa.rotationWorld, sb.rotationWorld, t) };
  }
  const jointLandmarksWorld: Record<string, Vec3> = {};
  for (const [k, vb] of Object.entries(b.jointLandmarksWorld)) {
    const va = a.jointLandmarksWorld[k];
    const sk = landmarkSegment(k);
    const sa = a.segments[sk];
    const sb = b.segments[sk];
    if (!va || !sa || !sb) {
      jointLandmarksWorld[k] = va ? lerp(va, vb, t) : vb;
      continue;
    }
    jointLandmarksWorld[k] = toWorld(segPose(segments[sk]), lerp(toLocal(segPose(sa), va), toLocal(segPose(sb), vb), t));
  }
  const out: PhysicalPose = { ...b, segments, jointLandmarksWorld };
  if (a.carry && b.carry) out.carry = lerpSeat(a.carry, b.carry, t);
  if (b.anklePitchDeg) {
    const ap: NonNullable<PhysicalPose['anklePitchDeg']> = {};
    for (const s of ['left', 'right'] as const) {
      const vb = b.anklePitchDeg[s] ?? 0;
      ap[s] = (a.anklePitchDeg?.[s] ?? vb) + (vb - (a.anklePitchDeg?.[s] ?? vb)) * t;
    }
    out.anklePitchDeg = ap;
  }
  return out;
}

const copyV = (d: Vec3 | undefined, s: Vec3): Vec3 => {
  if (!d) return { x: s.x, y: s.y, z: s.z };
  d.x = s.x;
  d.y = s.y;
  d.z = s.z;
  return d;
};

/**
 * Keep what the next frame's interpolation reads of a solved pose, reusing `into`'s objects (the lab keeps one per player
 * and overwrites it every tick). Null for no pose.
 */
export function capturePose(into: PoseKey | null, src: PhysicalPose | null): PoseKey | null {
  if (!src) return null;
  const k: PoseKey = into ?? { segments: {} as PoseKey['segments'], jointLandmarksWorld: {} };
  for (const id of Object.keys(k.segments) as SegmentId[]) if (!src.segments[id]) delete k.segments[id];
  for (const id of Object.keys(src.segments) as SegmentId[]) {
    const s = src.segments[id];
    const d = k.segments[id];
    if (!d) {
      k.segments[id] = { segmentId: id, originWorld: copyV(undefined, s.originWorld), rotationWorld: { ...s.rotationWorld } };
      continue;
    }
    copyV(d.originWorld, s.originWorld);
    d.rotationWorld.x = s.rotationWorld.x;
    d.rotationWorld.y = s.rotationWorld.y;
    d.rotationWorld.z = s.rotationWorld.z;
    d.rotationWorld.w = s.rotationWorld.w;
  }
  for (const n of Object.keys(k.jointLandmarksWorld)) if (!src.jointLandmarksWorld[n]) delete k.jointLandmarksWorld[n];
  for (const [n, v] of Object.entries(src.jointLandmarksWorld)) k.jointLandmarksWorld[n] = copyV(k.jointLandmarksWorld[n], v);
  if (src.carry) k.carry = Object.assign(k.carry ?? { ...src.carry }, src.carry);
  else delete k.carry;
  if (src.anklePitchDeg) k.anklePitchDeg = Object.assign(k.anklePitchDeg ?? {}, { left: src.anklePitchDeg.left, right: src.anklePitchDeg.right });
  else delete k.anklePitchDeg;
  return k;
}

/** A ball without a carry seat lies along the runner's forward axis (the earlier ellipsoids' look). */
const FORWARD: Quat = qFromAxisAngle(v3(1, 0, 0), Math.PI / 2);
export const forwardBallQ = (core: Quat): Quat => qMul(core, FORWARD);

/** The lab's fallback ball beside a runner without a pose or a palm (no rule profile), core frame. */
const LOOSE_BALL_LOCAL = v3(0.2, 0.25, 0.25);

/**
 * The one ball the lab draws, from the pose it draws (`pose`: the render interpolation of the runner's solved pose; at
 * alpha 1 the solved pose itself) and the drawn core frame. With a rule profile it is the observer's ball reference
 * (`RuleObserver.ballRef`): the seated ball (`carryPose`), the ball-arm palm (`carryPalm`), else the profile's
 * core-frame offset. Without one (a player view's own ball): the seated ball, the ball-arm palm, else a fixed offset.
 * The rotation is the seat's, else along the runner's forward axis.
 */
export function drawnBall(pose: PhysicalPose | null, core: Pose, rule: Pick<RuleProfile, 'ballSource' | 'ballLocal'> | null): Pose {
  const seated = carriedBall(pose);
  const palm = pose?.jointLandmarksWorld[`${CARRY_ARM}Palm`];
  const q = seated?.q ?? forwardBallQ(core.q);
  if (rule) {
    const held = rule.ballSource === 'carryPose' ? seated?.p : rule.ballSource === 'carryPalm' ? palm : undefined;
    return { p: held ? { ...held } : toWorld(core, rule.ballLocal), q };
  }
  return { p: seated?.p ?? (palm ? { ...palm } : toWorld(core, LOOSE_BALL_LOCAL)), q };
}
