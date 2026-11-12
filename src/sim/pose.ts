// Simulation-owned physical pose: explicit joint landmarks and segment frames generated from the solved core,
// the achieved arms (Gate 2) and a bounded procedural leg/arm pose. Presentation maps this; it never feeds forces.
// Gate 4: the same frames become the ragdoll body frames at a handoff, so the pose and the candidate agree.
//
// Limb frame convention (shared with the ragdoll): origin at the proximal joint, local +Y toward the proximal joint
// (the limb extends along -Y), local X = the elbow/knee hinge axis, Z = X x Y. The hinge angle about X from the
// proximal to the distal frame is zero for a straight limb and positive in flexion.
import type { ArmSide, SegmentId } from './contracts';
import { CARRY_ARM, carryRequest, seatBallCapsule, seatBallLocal, seatBallWorld, seatOn, seatPalmLocal, stepHandW, type CarryProfile, type CarrySeat } from './carry';
import { chestArm, type SampledLimbs } from './run-clip';
import { idleStanceFade, idleWidthAddM, type IdleSample, type LocomotionProfile } from './locomotion';
import { hipLocal, shoulderLocal, sideSignX, type BodyProfile, type JointRangeProfile, type OwnLegProfile, type RagdollProfile } from './profiles';
import { segmentDistanceSq } from './physics';
import { armTwistRad, behindDeg, clampDirToEnvelope, fitElbowTwist, fitThighTwist, turnForearmTwist, twistWindow } from './joint-cone';
import type { PoseDebug, PoseProbe } from './debug';
import {
  add, addScaled, clamp, clampLen, cross, dist, dot, len, lerp, neg, norm, qFromAxisAngle, qFromBasis, qFromUnitVectors, qInvRot, qMul, qRot, qSlerp, scale, sub, toWorld, upOf, v3,
  type Pose, type Quat, type Vec3,
} from './vec';

export interface SegmentPose {
  segmentId: SegmentId;
  originWorld: Vec3; // proximal joint (core: proxy origin; head: neck pivot)
  rotationWorld: Quat;
}

export interface PhysicalPose {
  playerId: string;
  segments: Record<SegmentId, SegmentPose>;
  jointLandmarksWorld: Record<string, Vec3>;
  /** Elbow/knee flexion (deg) in the anatomical reference (0 = straight). */
  hingeDeg: Record<string, number>;
  /** Which limbs used the stable profile bend plane (near-straight limb). */
  straightFallback: string[];
  /** Max external penetration of the chosen procedural limbs (m), for diagnostics. */
  limbClearance: Record<string, number>;
  /**
   * Run-clip sampling only (plan 06): distance (m) from each sampled request (ankle target / free-arm palm target, after
   * the clip-procedural blend) to the achieved landmark. Floor lift, reach clamp and clearance alternatives show here.
   */
  targetResidualM?: Record<string, number>;
  /**
   * Run-clip sampling only (plan 06 pass 2): ankle pitch (deg) of each shoe about its shin's hinge axis X; the shoe
   * frame is the shin frame rotated by it (positive = toe down). Absent or 0: the shoe is rigid on the shin.
   */
  anklePitchDeg?: Partial<Record<ArmSide, number>>;
  /**
   * Plan 07 (foot requests present): per leg the chosen variant (0 = primary; anything else is a clearance departure),
   * the final IK request (after the stance / plant IK and the floor lift), the floor lift itself (m) and the soft-reach
   * clamp of the request (m, the part of the residual reach clamping explains). Plan 12 (a joint-range profile): the floor
   * lift's rise (m) when the shoe is at its dorsiflexion limit (the foot on its toe, the heel lifted).
   */
  legInfo?: Partial<Record<ArmSide, { variant: number; request: Vec3; liftM: number; rangeLiftM?: number; softM: number; rollF?: number; edgeX?: number; soleBase?: number; soleAngle?: number }>>;
  /**
   * Plan 08a (carry profile, ball carrier): the hand and ball on the achieved right forearm (carry.ts). The palm landmark is
   * the turned hand's and `carriedBall` the ball centre. A ragdoll keeps the last supported seat on its forearm. Absent: no
   * carry profile; the hand is rigid on the forearm.
   */
  carry?: CarrySeat;
}

/** Plan 08a: the seated ball (world) on a pose's achieved right forearm; null without a carry seat. */
export function carriedBall(pose: PhysicalPose | null | undefined): Pose | null {
  const fa = pose?.segments.rightForearm;
  return pose?.carry && fa ? seatBallWorld({ p: fa.originWorld, q: fa.rotationWorld }, pose.carry) : null;
}

/**
 * Plan 07 foot request of one leg (footwork.ts), solved through the existing leg path (soft reach, two-bone, hinge frames,
 * ankle pitch, floor lift, clearance alternatives):
 * - `plant`: a world-anchored contact feature. The sole point `toeZ * rollF` ahead of the heel (the sole point below the
 *   ankle) along the planted heading lies on the anchor; the ankle is solved for it with the shoe at its solved pitch.
 *   `tolM`: the footwork's plant tolerance (`plantTolM`), within which a shown leg keeps the plant.
 * - `target`: a planner swing ankle target (world) with the foot heading (knee pole).
 * - `offset`: the ordinary procedural / clip request shifted by a world offset (a released foot rejoining it).
 */
export type FootRequest =
  | ({ kind: 'plant'; heelW: Vec3; headingRad: number; rollF: number; toeZ: number; edgeX?: number; tolM?: number } & FootBlend)
  | ({ kind: 'target'; ankleW: Vec3; headingRad: number } & FootBlend)
  | ({ kind: 'offset'; offsetW: Vec3; headingRad?: number } & FootBlend);

/** The composed planner's continuity of a foot across a change of owner (plan 08). */
export interface FootBlend {
  /** Adds to the wanted foot angle (rad, toe up): the decaying difference to the achieved foot. */
  soleO?: number;
  /** The knee pole between the leg's ordinary pole (0) and the foot heading (1); absent: the heading for a plant or a target, ordinary for an offset. */
  poleW?: number;
  /** The share of the clip foot angle the foot keeps; absent: all of it. */
  soleW?: number;
  /** Plan 08 composed: reseed count of the foot: a new owner of the same kind still starts from the achieved foot. */
  seed?: number;
  /** Plan 08: this step took over the old owner's path of a held leg: same owner to the pose, the leg's departure stays. */
  carried?: boolean;
}

/** The shin frame pitched about its hinge axis X (the shoe frame for an ankle pitch, rad; positive = toe down). */
export function pitchShin(shin: Quat, rad: number): Quat {
  return rad === 0 ? shin : qMul(shin, qFromAxisAngle(v3(1, 0, 0), rad));
}

/** Shoe (foot) frame of one side of a pose: its shin frame pitched by the pose's ankle angle. */
export function footFrame(pose: PhysicalPose, s: ArmSide): Quat {
  return pitchShin(pose.segments[`${s}Shin` as SegmentId].rotationWorld, ((pose.anklePitchDeg?.[s] ?? 0) * Math.PI) / 180);
}

// Limb lengths and radii come from the player's ragdoll profile (the same numbers its arm profile and candidate
// bodies use; checked at simulation construction), never a shared constant.

export interface GaitState {
  phase: number; // rad
}

/** Advance the gait phase from actual horizontal travel (pose only; no forces). */
export function advanceGait(g: GaitState, speed: number, dt: number): void {
  const stride = 1.1 + 0.25 * speed; // m per full cycle
  g.phase = (g.phase + (2 * Math.PI * speed * dt) / stride) % (2 * Math.PI);
}

/**
 * Two-bone solve with fixed lengths and a stable bend direction. The endpoint is clamped into
 * [max(|a-b|+eps, minReach), min(maxReach, a+b-eps)]; `pole` is the preferred elbow/knee direction (projected
 * perpendicular to the limb). `minReach` bounds flexion (flexReach: the hinge's upper limit); without it the solve folds
 * the limb up to ~178 deg.
 */
export function twoBone(
  root: Vec3,
  target: Vec3,
  a: number,
  b: number,
  pole: Vec3,
  maxReach = a + b - 1e-4,
  minReach = 0,
): { mid: Vec3; end: Vec3; reached: boolean } {
  const d0 = sub(target, root);
  const dl = len(d0);
  const dir = norm(d0, v3(0, -1, 0));
  const d = clamp(dl, Math.max(Math.abs(a - b) + 1e-4, minReach), Math.min(maxReach, a + b - 1e-4));
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  let perp = sub(pole, scale(dir, dot(pole, dir)));
  if (len(perp) < 1e-6) perp = cross(dir, v3(1, 0, 0));
  if (len(perp) < 1e-6) perp = cross(dir, v3(0, 0, 1));
  perp = norm(perp);
  const mid = add(addScaled(root, dir, along), scale(perp, h));
  const end = addScaled(root, dir, d);
  return { mid, end, reached: Math.abs(d - dl) < 1e-3 };
}

/**
 * Root-to-end distance of a two-bone limb (lengths a, b) flexed by `flexRad` (0 = straight): the minimum reach that
 * keeps the hinge angle at or below `flexRad` (law of cosines, d^2 = a^2 + b^2 + 2 a b cos(flex)).
 */
export function flexReach(a: number, b: number, flexRad: number): number {
  return Math.sqrt(Math.max(0, a * a + b * b + 2 * a * b * Math.cos(flexRad)));
}

/**
 * Plan 07: largest hinge flexion (rad) a generated pose may use: the ragdoll joint's upper limit less the profile's
 * straight-bend angle as a numerical margin (candidate hinge angles are measured from float32 body rotations). The
 * supported pose is the handoff candidate, so a generated elbow or knee beyond its limit would only be rejected later
 * (RH-F6-oneArm: 167.8 deg knee against [0, 150]).
 */
export function maxFlexRad(R: RagdollProfile, joint: 'knee' | 'elbow'): number {
  return ((R.limitsDeg[joint][1] - R.validation.straightBendDeg) * Math.PI) / 180;
}

/**
 * Plan 07a: below this sine between the requested pole and the root-target line the pole no longer defines a stable
 * bend plane (twoBone's perpendicular turns quickly with small target changes: RH-F6-simultaneous R's left elbow swung
 * 24.5 cm in one tick with pole.dir = -1.000).
 */
const POLE_STABLE_SIN = 0.35;

/**
 * Plan 07a: a bend direction that stays continuous when the requested pole degenerates or turns quickly. The bend plane
 * turns from the previous shown elbow/knee (world, re-expressed in the current body frame) toward the requested one by
 * at most the angle that moves the joint `maxMoveM` about the limb line. Near the limb line (sine s below
 * POLE_STABLE_SIN) that bound is scaled by 1 / (1 - s / POLE_STABLE_SIN); it is capped at `fastMoveM` (the fast
 * continuity rate), which also bounds a well-defined pole, so a plane held while degenerate catches up along a visible
 * orbit instead of releasing at the band edge (HC-F2-offset A's knee swung 85 cm when it did). A straight limb (small
 * orbit radius) turns freely: the angle bound grows as the joint's distance from the limb line shrinks.
 * L3's `damp` also scales the requested turn by the pole's projected length, so an unreliable heading fades continuously.
 */
export function stablePole(root: Vec3, target: Vec3, pole: Vec3, prevMid: Vec3 | null, maxMoveM: number, fastMoveM: number, damp = false): Vec3 {
  if (!prevMid || !(maxMoveM > 0)) return pole;
  const dir = norm(sub(target, root), v3(0, -1, 0));
  const pn = norm(pole, v3(0, 0, 1));
  const pp = sub(pn, scale(dir, dot(pn, dir)));
  const s = len(pp);
  const e = sub(prevMid, root);
  const pe = sub(e, scale(dir, dot(e, dir)));
  const h = len(pe);
  if (h < 1e-6) return pole;
  const from = scale(pe, 1 / h);
  if (s < 1e-9) return from;
  const to = scale(pp, 1 / s);
  // A nearly parallel pole has no reliable heading; carry the achieved plane through that band.
  const weight = damp ? s : 1;
  const ang = weight * Math.atan2(dot(cross(from, to), dir), dot(from, to));
  const move = s >= POLE_STABLE_SIN ? fastMoveM : Math.min(fastMoveM, maxMoveM / Math.max(1e-6, 1 - s / POLE_STABLE_SIN));
  const lim = move / Math.max(h, 0.02);
  if (Math.abs(ang) <= lim && weight === 1) return pole;
  return qRot(qFromAxisAngle(dir, clamp(ang, -lim, lim)), from);
}

/** Unit direction `a` turned toward unit direction `b` by at most `maxRad` (about their common normal). */
function turnToward(a: Vec3, b: Vec3, maxRad: number): Vec3 {
  const ang = Math.acos(clamp(dot(a, b), -1, 1));
  if (ang <= maxRad) return b;
  const axis = norm(cross(a, b), anyPerp(a));
  return qRot(qFromAxisAngle(axis, maxRad), a);
}

/**
 * Plan 07a: a reach direction that stays continuous when the target comes inside the limb's minimum reach (maximum
 * flexion). twoBone then places the end at `minReach` along root->target, a direction that turns arbitrarily fast as
 * the target passes near the root (HC-F2-offset: A's leg target, pushed out of B, reached the hip and the ankle moved
 * 13.6 cm in one substep for a 3 cm target move). Limit the final shown direction, remembering that direction and
 * continuing the limit outside the band until it catches up; a distance-weighted release can bypass the turn limit.
 */
export function stableReach(root: Vec3, target: Vec3, held: Vec3 | null, minReach: number, fastMoveM: number, recovering = false): { target: Vec3; held: Vec3; limited: boolean } {
  const d0 = sub(target, root);
  const dl = len(d0);
  const req = norm(d0, held ?? v3(0, -1, 0));
  if (!held || !(fastMoveM > 0) || (dl >= 2 * minReach && !recovering)) return { target, held: req, limited: false };
  const radius = Math.max(dl, minReach, 0.02);
  const maxRad = fastMoveM / radius;
  const limited = Math.acos(clamp(dot(held, req), -1, 1)) > maxRad;
  const dir = turnToward(held, req, maxRad);
  return { target: addScaled(root, dir, Math.max(dl, minReach)), held: dir, limited };
}

/** Any unit vector perpendicular to `d`. */
function anyPerp(d: Vec3): Vec3 {
  const c = cross(d, Math.abs(d.x) < 0.9 ? v3(1, 0, 0) : v3(0, 0, 1));
  return norm(c);
}

export interface HingeChain {
  frameA: Quat;
  frameB: Quat;
  /** Hinge axis (world) shared by both frames. */
  axis: Vec3;
  /** Flexion angle (rad), >= 0 in the anatomical reference. */
  angleRad: number;
  /** Distal landmarks re-expressed from frameB (identical to the inputs unless the near-straight fallback snapped). */
  ends: Vec3[];
  fallback: boolean;
}

/**
 * Hinge frames for a proximal/distal limb pair. The hinge axis comes from the actual bend plane when the limb is
 * bent more than `straightRad`; a near-straight limb uses the first usable stable flexion direction instead of a
 * zero cross product and is snapped exactly into that plane (end displacement <= length * sin(straightRad)).
 * `ends` are distal landmarks (distance kept) that are re-expressed in the distal frame.
 */
export function hingeChain(prox: Vec3, mid: Vec3, ends: Vec3[], flexFallbacks: Vec3[], straightRad: number): HingeChain {
  const dA = norm(sub(mid, prox), v3(0, -1, 0));
  const dB0 = norm(sub(ends[0], mid), dA);
  const c = cross(dA, dB0);
  let X: Vec3 | null = null;
  let fallback = false;
  if (len(c) > Math.sin(straightRad)) X = norm(c);
  else {
    fallback = true;
    for (const f of flexFallbacks) {
      const fp = sub(f, scale(dA, dot(f, dA)));
      if (len(fp) > 0.2) {
        X = norm(cross(dA, norm(fp)));
        break;
      }
    }
    if (!X) X = anyPerp(dA);
  }
  const YA = neg(dA);
  const frameA = qFromBasis(X, YA, cross(X, YA));
  const YB0 = neg(dB0);
  let theta = Math.atan2(dot(cross(YA, YB0), X), dot(YA, YB0));
  if (fallback) theta = Math.max(0, theta);
  const frameB = qMul(qFromAxisAngle(X, theta), frameA);
  const YB = upOf(frameB);
  const outEnds = ends.map((e) => addScaled(mid, YB, -len(sub(e, mid))));
  return { frameA, frameB, axis: X, angleRad: theta, ends: outEnds, fallback };
}

// ---------------------------------------------------------------- shapes (clearance)
export type PoseShape =
  | { kind: 'capsule'; a: Vec3; b: Vec3; r: number; key: string }
  | { kind: 'ball'; c: Vec3; r: number; key: string }
  | { kind: 'box'; c: Vec3; q: Quat; he: Vec3; key: string };

/**
 * Supported-state clearance queries, each the max penetration depth (m, >= 0) of `shapes`. `external` is physical: other
 * players' active colliders and obstacles (what candidate validation checks). `soft` covers geometry that is not a
 * collider but should not be visibly crossed (opponents' query arms); `self` is against the player's own torso/pelvis
 * (the limb's forearm and palm, and the carried ball's centre, plan 10d D4).
 */
export interface PoseClearance {
  external(shapes: PoseShape[]): number;
  soft?(shapes: PoseShape[]): number;
  self?(shapes: PoseShape[]): number;
  /**
   * Arm self-clearance (a fixture's `selfClearance` profile, measured bodies only): depth of an arm's self-clearance
   * shapes (`armSelfShapes`) in the player's own measured trunk beyond the profile tolerance (m, >= 0), counted as
   * physical depth, and the separating move (world, m) of those shapes from the trunk beyond the same tolerance.
   */
  body?(shapes: PoseShape[]): number;
  bodyPush?(shapes: PoseShape[]): Vec3;
  /**
   * Plan 07: the separating move (world, m) for shapes penetrating the external shapes: per pose shape its deepest
   * contact's outward normal times the depth beyond `toleranceM` (default 0), summed. Zero within that tolerance.
   */
  push?(shapes: PoseShape[], toleranceM?: number): Vec3;
  /**
   * Plan 13f (a leg-guard profile): the supported legs' guard. `external` is the deeper of the plain query and the same
   * against the other bodies where they will be after the profile's prediction time; `push` separates from whichever
   * is deeper. Absent: the legs use `external` and `push` as the arms do.
   */
  legs?: {
    external(shapes: PoseShape[]): number;
    push(shapes: PoseShape[], toleranceM?: number): Vec3;
    /**
     * Contact motion prerequisite (`legSweep`): the depth against the physical colliders only, what a conversion validates
     * (live colliders and obstacles, not another supported player's published limbs), the deeper of where they stand and
     * the prediction.
     */
    physical(shapes: PoseShape[]): number;
    /**
     * Contact motion prerequisite (`LegGuardProfile.physicalLegs`, the legs live): depth against the bodies the physical
     * legs meet in the solve, the deepest of where they stand, where the prediction puts them and where they stand
     * stopped; and the push that clears those to `metToleranceM` (every other shape to `toleranceM`). A physical leg left
     * inside one is a contact the solver resolves on the whole proxy at once.
     */
    met?(shapes: PoseShape[]): number;
    pushMet?(shapes: PoseShape[], toleranceM: number, metToleranceM: number): Vec3;
  };
}

/** Penetration below the floor plane Y = 0 (analytic, m >= 0). */
export function floorDepth(shapes: PoseShape[]): number {
  let d = 0;
  for (const s of shapes) {
    let low: number;
    if (s.kind === 'capsule') low = Math.min(s.a.y, s.b.y) - s.r;
    else if (s.kind === 'ball') low = s.c.y - s.r;
    else {
      const ex = qRot(s.q, v3(1, 0, 0));
      const ey = qRot(s.q, v3(0, 1, 0));
      const ez = qRot(s.q, v3(0, 0, 1));
      low = s.c.y - (Math.abs(ex.y) * s.he.x + Math.abs(ey.y) * s.he.y + Math.abs(ez.y) * s.he.z);
    }
    d = Math.max(d, -low);
  }
  return d;
}

/** Capsule fitted inside a joint-to-joint extent of length L (outer extent L, not L + 2r). */
function fittedCapsule(a: Vec3, b: Vec3, r: number, key: string): PoseShape {
  const d = sub(b, a);
  const L = len(d);
  const u = norm(d, v3(0, -1, 0));
  const hh = Math.max(0, (L - 2 * r) / 2);
  const c = addScaled(a, d, 0.5);
  return { kind: 'capsule', a: addScaled(c, u, -hh), b: addScaled(c, u, hh), r, key };
}

export function armShapes(R: RagdollProfile, s: string, sh: Vec3, elbow: Vec3, wrist: Vec3, palm: Vec3): PoseShape[] {
  const dir = norm(sub(palm, wrist), v3(0, -1, 0));
  return [
    fittedCapsule(sh, elbow, R.radii.upperArm, `${s}UpperArm`),
    fittedCapsule(elbow, wrist, R.radii.forearm, `${s}Forearm`),
    { kind: 'ball', c: addScaled(palm, dir, -R.radii.palm), r: R.radii.palm, key: `${s}Palm` },
  ];
}

/** Radius of the fingers' capsule in an arm's self-clearance shapes (m): the glove's finger half-thickness and more. */
const HAND_SELF_R = 0.03;

/**
 * Arm self-clearance shapes (plan 11): what the drawn arm puts against its own trunk. The forearm over its full joint
 * extent (the elbow cap included: `armShapes` fits its capsule inside the joints), the palm ball, and the fingers from the
 * palm centre to the glove tip (`tipAlongM` from the wrist). Used only against the player's own measured trunk.
 */
export function armSelfShapes(radii: { forearm: number; palm: number }, tipAlongM: number, s: string, elbow: Vec3, wrist: Vec3, palm: Vec3): PoseShape[] {
  const dir = norm(sub(palm, wrist), v3(0, -1, 0));
  const pc = addScaled(palm, dir, -radii.palm);
  const tip = addScaled(wrist, dir, Math.max(dist(pc, wrist), tipAlongM - HAND_SELF_R));
  return [
    { kind: 'capsule', a: elbow, b: wrist, r: radii.forearm, key: `${s}ForearmSelf` },
    { kind: 'ball', c: pc, r: radii.palm, key: `${s}PalmSelf` },
    { kind: 'capsule', a: pc, b: tip, r: HAND_SELF_R, key: `${s}HandSelf` },
  ];
}

export function legShapes(R: RagdollProfile, s: string, hip: Vec3, knee: Vec3, ankle: Vec3, shinFrame: Quat, footQ: Quat = shinFrame): PoseShape[] {
  return [
    fittedCapsule(hip, knee, R.radii.thigh, `${s}Thigh`),
    fittedCapsule(knee, ankle, R.radii.shin, `${s}Shin`),
    { kind: 'box', c: toWorld({ p: ankle, q: footQ }, v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM)), q: footQ, he: R.shoe.halfExtents, key: `${s}Shoe` },
  ];
}

/**
 * Plan 07a: the limb and shoe shapes of a published pose (upper arm, forearm, palm, thigh, shin, shoe per side) with
 * the candidate's geometry: the same capsules, palm ball and shoe box (at the pose's ankle pitch) its ragdoll bodies
 * would carry if it converted now. Keys are segment-like (`leftUpperArm`, `rightShoe`, ...).
 */
export function poseLimbShapes(R: RagdollProfile, pose: PhysicalPose): PoseShape[] {
  const lm = pose.jointLandmarksWorld;
  const out: PoseShape[] = [];
  for (const s of ['left', 'right'] as ArmSide[]) {
    out.push(...armShapes(R, s, lm[`${s}Shoulder`], lm[`${s}Elbow`], lm[`${s}Wrist`], lm[`${s}Palm`]));
    out.push(...legShapes(R, s, lm[`${s}Hip`], lm[`${s}Knee`], lm[`${s}Ankle`], pose.segments[`${s}Shin` as SegmentId].rotationWorld, footFrame(pose, s)));
  }
  return out;
}

// ---------------------------------------------------------------- pose generation
export interface ArmPoseInput {
  shoulder: Vec3;
  elbow: Vec3;
  /** Palm contact landmark (achieved). */
  palm: Vec3;
  /** Achieved wrist (optional; otherwise placed along the forearm). */
  wrist?: Vec3;
}

/** Chosen procedural limb variants (kept while still clear, so the pose does not flicker between choices). */
export type PoseMemory = Record<string, number>;

export interface ProxyPoseInput {
  playerId: string;
  body: BodyProfile;
  ragdoll: RagdollProfile;
  pose: Pose; // solved proxy origin pose
  gait: GaitState;
  speed: number;
  /** Achieved arms (Gate 2); when absent a bounded procedural arm pose is generated. */
  arms?: Partial<Record<ArmSide, ArmPoseInput>>;
  readyHands?: boolean;
  carriesBall?: boolean;
  /** Plan 08a: the ball-arm carry; absent: the plan 06 hold. Ready hands leave it in place (the ball stays carried). */
  carry?: CarryProfile;
  /**
   * Plan 12 joint range (absent: the historical ranges). Every procedural arm candidate's upper arm is kept inside the
   * shoulder cone (core frame) and pays a soft cost for being behind the side line; ground-relative shoes keep the
   * profile's ankle range.
   */
  jointRange?: JointRangeProfile;
  /** Horizontal velocity direction in body-local frame (for leg swing direction). */
  localVelDir?: Vec3;
  clearance?: PoseClearance;
  memory?: PoseMemory;
  /**
   * Run-clip limb requests (plan 06), blended with the procedural requests by `weight`. Legs: ankle target and knee pole.
   * Arms: only free arms (no achieved arm, not the carry arm, no ready hands) take the sampled swing.
   */
  sampled?: SampledLimbs;
  /**
   * Plan 06a (suspension support): ground-relative legs around the achieved hips. Procedural ankle targets sit on the
   * probed ground (flat-shoe ankle height plus the gait lift) instead of a fixed distance below the hips, the shoe is
   * pitched to keep its angle to the ground (the clip foot angle at the clip weight, flat otherwise), and the stance feet
   * take the stagger (m, left foot forward). Absent: the legacy body-relative legs (bit-identical). Plan 07
   * `bodyRelative` (falling proxies): without support the ordinary leg request is the body-relative one (legs follow
   * the body; a ground target below a lying body folds the legs over the torso); the floor lift and continuity stay.
   */
  ground?: { y: number; staggerM: number; fixedGait?: boolean; bodyRelative?: boolean };
  /**
   * Plan 07 foot planner requests (footwork.ts), ground-relative legs only. `ground.fixedGait`: the procedural phase gait
   * swings each foot along the actual travel (the 06a gait swung it against travel: the recorded moonwalk).
   */
  feet?: Partial<Record<ArmSide, FootRequest>>;
  /**
   * Plan 07 limb continuity (ground-relative poses only): the time since the previous pose of this player (s). With
   * memory and dtS > 0, each procedural limb's departure from its ordinary request (clearance variant offset, floor lift,
   * swing-out, plant correction) and its elbow/knee pole move toward the chosen candidate at a bounded rate instead of
   * jumping, unless the intermediate pose penetrates more than the chosen one (then the smallest further step that does
   * not). Absent or 0: the chosen candidate is shown as before.
   */
  dtS?: number;
  /**
   * Plan 07: false when this player can no longer convert (no ragdoll profile, already converted, or a rejected
   * handoff, which is final): its shown pose does not have to stay handoff-valid, so continuity steps are never
   * advanced for validity (the push-out still applies). Absent: true.
   */
  handoffPossible?: boolean;
  /**
   * Contact motion prerequisite (`LegGuardProfile.sweep`, ground-relative legs): the supported legs' achieved step is
   * judged against the physical bodies, may take another placement, and is swept from the shown pose. Absent: false.
   */
  legSweep?: boolean;
  /** Ladder 11c (`LegGuardProfile.ownLegs`, with `legSweep`): a knee-pole placement kept off the other leg. Absent: not read. */
  legOwn?: OwnLegProfile;
  /** Ladder 11d (`SelfClearanceProfile.seamSettle`): an arm's continuity push settles between own trunk pieces. Absent: false. */
  selfSeam?: boolean;
  /** Plan 08 locomotion composition (free arms); absent: the plan 07 arms. */
  loco?: {
    profile: LocomotionProfile;
    brakeB: number;
    swing: number;
    contactW: number;
    /** Plan 13e: the idle cycle sampled at this player's phase and its weight (a profile with a cycle only). */
    idle?: { sample: IdleSample; w: number };
  };  /** Plan 10f (F2): this simulation's pose switches (`SimOptions.debug.pose`); absent: all off. */
  debug?: PoseDebug;
  /** Plan 10f (F2): read-only diagnostics (`SimOptions.debug.poseProbe`). */
  probe?: PoseProbe;
}

/** Authored procedural reference: the right shoulder and shoulder-to-palm chain the arm targets were written for. */
const AUTHORED_SHOULDER = v3(0.26, 0.5, 0);
const AUTHORED_CHAIN_M = 0.74;
/** Pelvis-centre landmark and gait ankle height of the authored bodies. */
const AUTHORED_PELVIS_MID = v3(0, -0.05, 0);
const AUTHORED_ANKLE_Y = -0.83;

/**
 * Procedural palm target (body-local). `p` is written for the authored bodies with its x already side-signed
 * (sideSignX); an authored body uses it unchanged. A measured body takes it relative to its own shoulder, scaled by
 * its arm chain (same reach fraction and direction from the shoulder).
 */
export function proceduralLocal(body: BodyProfile, s: ArmSide, p: Vec3): Vec3 {
  const m = body.measured;
  if (!m) return p;
  const ref = v3(AUTHORED_SHOULDER.x * sideSignX(body, s), AUTHORED_SHOULDER.y, AUTHORED_SHOULDER.z);
  return add(shoulderLocal(body, s), scale(sub(p, ref), m.armChainM / AUTHORED_CHAIN_M));
}

/** Ball-arm carry palm (body-local, the right arm). */
export function carryPalmLocal(body: BodyProfile): Vec3 {
  return proceduralLocal(body, CARRY_ARM, v3(0.13 * sideSignX(body, CARRY_ARM), 0.24, 0.24));
}

export function pelvisMidLocal(body: BodyProfile): Vec3 {
  return body.measured ? { ...body.measured.pelvisMid } : { ...AUTHORED_PELVIS_MID };
}

/** Default procedural arm palm in body-local coordinates: carry (ball arm), ready hands or a running swing. */
export function proceduralArmTargetLocal(s: ArmSide, inp: ProxyPoseInput): Vec3 {
  const body = inp.body;
  const sx = sideSignX(body, s);
  if (inp.carriesBall && s === CARRY_ARM) return carryPalmLocal(body);
  if (inp.readyHands) return proceduralLocal(body, s, v3(0.2 * sx, 0.27, 0.38));
  const swing = Math.cos(inp.gait.phase + (s === 'left' ? 0 : Math.PI)) * Math.min(1, inp.speed / 4);
  return proceduralLocal(body, s, v3(0.27 * sx, 0.05 + 0.08 * Math.abs(swing), 0.1 + 0.22 * swing));
}

/** Procedural arm alternatives (body-local palm targets, local elbow poles), tried in order when the first is blocked. */
const ARM_ALTS = (sx: number): { palm: Vec3; pole: Vec3 }[] => [
  { palm: v3(0.13 * sx, 0.3, 0.3), pole: v3(0.7 * sx, -0.5, -0.3) },
  { palm: v3(0.18 * sx, 0.55, 0.42), pole: v3(0.6 * sx, -0.7, 0) },
  { palm: v3(0.3 * sx, -0.12, -0.12), pole: v3(0.5 * sx, 0, 0.8) },
  { palm: v3(0.2 * sx, -0.02, 0.36), pole: v3(0.7 * sx, -0.3, -0.5) },
  { palm: v3(0.32 * sx, 0.95, 0.12), pole: v3(0.8 * sx, 0.2, -0.4) },
  { palm: v3(0.12 * sx, 0.1, -0.3), pole: v3(0.6 * sx, 0, 0.6) },
  // arm hanging at the side (slightly forward / slightly back), elbow pointing back
  { palm: v3(0.24 * sx, -0.2, 0.06), pole: v3(0.3 * sx, 0, -1) },
  { palm: v3(0.24 * sx, -0.2, -0.08), pole: v3(0.3 * sx, 0, -1) },
];

/** Leg alternatives relative to the gait ankle target (body-local offsets and knee pole). */
const LEG_ALTS = (sx: number): { off: Vec3; pole: Vec3 }[] => [
  { off: v3(0, 0, 0), pole: v3(0, 0.2, 1) },
  { off: v3(-0.07 * sx, 0, -0.06), pole: v3(0, 0.2, 1) },
  { off: v3(0, 0, -0.16), pole: v3(0, 0.2, 1) },
  { off: v3(-0.08 * sx, 0.05, -0.18), pole: v3(-0.4 * sx, 0.2, 1) },
  { off: v3(0, 0, 0.16), pole: v3(0, 0.2, 1) },
  { off: v3(-0.06 * sx, 0.18, -0.12), pole: v3(0, 0.3, 1) },
  { off: v3(0.08 * sx, 0.05, 0), pole: v3(0.5 * sx, 0.2, 1) },
  // larger excursions: knee tucked up, leg spread outward, leg extended back
  { off: v3(0, 0.35, 0.12), pole: v3(0, 0.3, 1) },
  { off: v3(0.25 * sx, 0.08, 0), pole: v3(0.6 * sx, 0.3, 1) },
  { off: v3(0, 0.12, -0.38), pole: v3(0, 0.2, 1) },
];

/**
 * Contact motion prerequisite (`legSweep`): the distinct knee poles of LEG_ALTS other than the primary's (authored frame).
 * A placement at another pole keeps the primary's ankle target: a planted foot stays on its anchor.
 */
const LEG_POLES = (sx: number): Vec3[] => {
  const all = LEG_ALTS(sx).map((v) => v.pole);
  return all.filter((p, i) => all.findIndex((q) => dist(p, q) < 1e-9) === i && dist(p, all[0]) > 1e-9);
};

/** Run-clip ball-carry hold (authored frame, x outward): the palm beside the chest at shoulder width, clear of the torso. */
const CLIP_CARRY = v3(0.34, 0.24, 0.2);
/** Sampled-arm clearance: bracket step and the largest move away from the body (m). */
const SWING_OUT_STEP = 0.02;
const SWING_OUT_MAX = 0.3;
/** Sampled legs: soft-reach zone below the reach limit (m) and the minimum knee flexion (x straightBendDeg). */
export const SOFT_REACH_M = 0.08;
const MIN_FLEX = 2;

/** Reach limit of the continuous (sampled / ground-relative) leg solve: the hip-ankle distance at the minimum flexion. */
export function legReachM(R: RagdollProfile): number {
  const a = R.lengths.thigh;
  const b = R.lengths.shin;
  return Math.sqrt(a * a + b * b + 2 * a * b * Math.cos((MIN_FLEX * R.validation.straightBendDeg * Math.PI) / 180));
}

/** Hip-ankle distance the soft reach actually gives a request at distance `L` (the eased reach, <= L). */
export function softReachM(R: RagdollProfile, L: number): number {
  const ds = legReachM(R) - SOFT_REACH_M;
  return L <= ds ? L : ds + SOFT_REACH_M * (1 - Math.exp(-(L - ds) / SOFT_REACH_M));
}

/** Largest hip-ankle request distance whose soft-reach clamp stays within `tolM` (bisection on softReachM). */
export function plantReachM(R: RagdollProfile, tolM: number): number {
  let lo = legReachM(R) - SOFT_REACH_M;
  let hi = lo + 1;
  for (let i = 0; i < 60; i++) {
    const m = 0.5 * (lo + hi);
    if (m - softReachM(R, m) <= tolM) lo = m;
    else hi = m;
  }
  return lo;
}
/**
 * Ankle range of a sampled shoe about the shin (rad): dorsiflexion (toe up) and plantarflexion (toe down). Plan 07:
 * dorsiflexion 45 deg (weight-bearing athletic range; was 30), so a flat heel holds while the shin leans in a 0.72 m
 * crouch (about 43 deg with the ankle under the hip) and on a staggered back foot.
 */
const ANKLE_DORSI = (45 * Math.PI) / 180;
/** Dorsiflexion of the legacy sampled legs (no ground-relative support: L1), unchanged so historical evidence holds. */
const ANKLE_DORSI_LEGACY = (30 * Math.PI) / 180;
const ANKLE_PLANTAR = (50 * Math.PI) / 180;
/**
 * Plan 07 limb continuity rates (ground-relative poses): departure speed (m/s, body frame) and pole turn rate (rad/s).
 * A full alternative switch (up to about 1 m) takes 0.3 to 0.4 s instead of one substep.
 */
export const CONT_LEG_MPS = 2.5;
const CONT_ARM_MPS = 3.0;
const CONT_POLE_RADPS = 8;
/** Ladder 11b: the thigh rotation range (`hipTwist`) applies below this swing from hanging (deg); past it the rotation is ill-defined. */
export const HIP_TWIST_SWING_DEG = 150;
const HIP_TWIST_SWING_COS = Math.cos((HIP_TWIST_SWING_DEG * Math.PI) / 180);
/** Plan 08: a composed pose's departures and poles: within the transition limit (0.01 m) of one physics substep. */
const CONT_L3_MPS = 2.1;
export const CONT_L3_PLANT_MPS = 1;
export const CONT_L3_RADPS = 3;
/**
 * Plan 07a: fastest departure (m/s, body frame; the pole turns faster in proportion) a continuity step may take to
 * regain a valid pose when the held and rate-limited poses are not valid (the guard; plan 07 jumped instead).
 */
export const CONT_FAST_MPS = 6;
/**
 * Ordinary request speed (m/s, body frame) above which a request change is a jump (a mode change: ready hands, clip
 * arm, support lost), not motion: the shown target is then held and blends to the new request at the departure rate.
 */
const CONT_BASE_MPS = 15;
/** Floor depth a continuity step may show beyond the chosen candidate's (m). */
const CONT_FLOOR_OK = 0.003;
/** Push-out iterations of a continuity step that penetrates (the end-effector target moves along the contact normals). */
const CONT_PUSH_IT = 4;
/** Largest total push-out of one pose (m): a deeper contact is not followed (the step falls back toward the candidate). */
const CONT_PUSH_MAX_M = 0.05;
/**
 * Contact motion prerequisite (`legSweep`): the largest move (m, ankle departure or knee arc at the thigh's length) between
 * two samples of the leg sweep. A body part is several centimetres across, so a step that crosses one shows an
 * intermediate overlap at this spacing.
 */
export const LEG_SWEEP_M = 0.01;
/**
 * Contact motion prerequisite (physical legs, D1): the depth (m) a physical leg may be left at in a body it meets in the
 * solve. The pose-only tolerance (HARD_OK) is a presentation allowance; a physical leg held there is a penetration the
 * solver resolves on the whole proxy in one substep, and a body on the floor behind it gives way to nothing (the old
 * tree: L3-F1-mirror0, 285.8 N s in one substep).
 */
export const PHYS_LEG_OK = 0.001;
/**
 * A primary planted foot within this distance (m) of the shown departure is shown exactly (the plant must hold its
 * anchor within the 0.01 m drift contract; touchdown corrections are a few cm). Farther: it blends like any switch.
 */
const CONT_PLANT_EXACT_M = 0.05;
/** Accept a procedural variant at or below this depth (m); validation tolerance is 0.015 m. */
const CLEAR_OK = 0.004;
/** Physical depth a candidate may have and still count as valid for the handoff (margin under 0.015 m). */
export const HARD_OK = 0.012;

/** Ladder 11c: a leg's bone axes (the distal half thigh, the shin, ankle to shoe) with their slim radii. */
function legAxes(P: OwnLegProfile, hip: Vec3, knee: Vec3, ankle: Vec3, shoe: Vec3): [Vec3, Vec3, number][] {
  return [
    [addScaled(hip, sub(knee, hip), 0.5), knee, P.thighRadiusM],
    [knee, ankle, P.shinRadiusM],
    [ankle, shoe, P.footRadiusM],
  ];
}
/** Ladder 11c: how far (m) two legs' bone axes come inside their radii's sum, the largest over the axis pairs (negative: apart). */
function ownLegNear(a: [Vec3, Vec3, number][], b: [Vec3, Vec3, number][]): number {
  let m = -Infinity;
  for (const [p, q, r] of a) for (const [u, w, t] of b) m = Math.max(m, r + t - Math.sqrt(segmentDistanceSq(p, q, u, w)));
  return m;
}

/**
 * Choose a limb variant (sticky: the previous choice is tried first). Physical depth (`depth`) ranks first: a variant
 * is physically valid at <= HARD_OK. Among valid variants the first fully clear one (depth and `soft` <= CLEAR_OK)
 * wins, else the least soft overlap; with no valid variant, the least physical depth. `keepValid`: the previous
 * choice is kept while valid (after a fully clear primary when `primaryFirst`).
 */
function pick<T extends { depth: number; soft: number }>(cands: (() => T)[], prev: number | undefined, primaryFirst = false, keepValid = false): { best: T; index: number } {
  const head = primaryFirst ? [0, prev ?? 0] : [prev ?? 0];
  const order = prev !== undefined && prev < cands.length ? [...head, ...cands.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...cands.keys()];
  let bestValid: { r: T; i: number } | null = null;
  let bestHard: { r: T; i: number } | null = null;
  for (const i of order) {
    const r = cands[i]();
    if (r.depth <= CLEAR_OK && r.soft <= CLEAR_OK) return { best: r, index: i };
    // plan 07 hysteresis (keepValid, ground-relative poses): the previous choice is kept while physically valid, so two
    // alternatives near an opponent do not alternate every few substeps; the primary still wins back when fully clear
    if (keepValid && i === prev && r.depth <= HARD_OK) return { best: r, index: i };
    if (r.depth <= HARD_OK && (!bestValid || r.soft < bestValid.r.soft - 1e-6)) bestValid = { r, i };
    if (!bestHard || r.depth < bestHard.r.depth - 1e-6) bestHard = { r, i };
  }
  const b = bestValid ?? bestHard!;
  return { best: b.r, index: b.i };
}

/**
 * Continuity step (plan 07): the blend fraction toward the chosen state (departure `dc`, pole `pc`, body frame) from the
 * previous shown state (`dp`, `pp`). `ev(alpha)` builds the pose at that fraction and reports whether it is valid and
 * its depth.
 * - The rate-limited fraction (departure `mps`, pole CONT_POLE_RADPS) when its pose is valid.
 * - Plan 07a: else the largest valid fraction at or below it (the shown pose held and pushed out along the contacts:
 *   contact motion, continuous).
 * - Else the smallest valid fraction up to the fast bound (CONT_FAST_MPS): the shown pose regains validity faster than
 *   the departure rate, but never in one jump (plan 07 advanced to any fraction: RH-F5-playerBelow A's right leg
 *   0.02 -> 0.94, RH-F6-sideRecover R's left arm 0.02 -> 0.86).
 * - Else (nothing valid within the bound): the least deep of the held, rate-limited and fast steps.
 */
function continuityAlpha(dp: Vec3, pp: Vec3, dc: Vec3, pc: Vec3, dt: number, mps: number, poleRadPs: number, ev: (alpha: number) => { good: boolean; depth: number }, probe?: PoseProbe): number {
  const dd = dist(dp, dc);
  const ang = Math.acos(clamp(dot(norm(pp, pc), norm(pc, pp)), -1, 1));
  const frac = (k: number): number => Math.min(1, dd > 1e-9 ? (k * mps * dt) / dd : 1, ang > 1e-9 ? (k * poleRadPs * dt) / ang : 1);
  const a0 = frac(1);
  const aF = frac(CONT_FAST_MPS / mps);
  const done = (al: number): number => {
    if (probe?.on) probe.contLast = { a0, al, dd };
    return al;
  };
  if (a0 >= 1 || ev(a0).good) return done(a0);
  if (ev(0).good) {
    let lo = 0;
    let hi = a0;
    for (let i = 0; i < 6; i++) {
      const m = 0.5 * (lo + hi);
      if (ev(m).good) lo = m;
      else hi = m;
    }
    return done(lo);
  }
  if (aF > a0 && ev(aF).good) {
    let lo = a0;
    let hi = aF;
    for (let i = 0; i < 6; i++) {
      const m = 0.5 * (lo + hi);
      if (ev(m).good) hi = m;
      else lo = m;
    }
    return done(hi);
  }
  let best = 0;
  for (const x of [a0, aF]) if (ev(x).depth < ev(best).depth - 1e-6) best = x;
  return done(best);
}

/** The last shown target of a continuity key (body frame). */
function contShown(mem: PoseMemory, k: string): Vec3 | null {
  const dp = memVec(mem, `${k}:d`);
  const pb = memVec(mem, `${k}:b`);
  return dp && pb ? add(pb, dp) : null;
}

/**
 * Previous shown departure, re-expressed against the current request after a request jump (the shown target is kept).
 * Records the current request.
 */
function contPrev(mem: PoseMemory, k: string, base: Vec3, dt: number): Vec3 | null {
  const dp = memVec(mem, `${k}:d`);
  const pb = memVec(mem, `${k}:b`);
  setMemVec(mem, `${k}:b`, base);
  if (!dp || !pb) return dp;
  return dist(base, pb) > CONT_BASE_MPS * dt ? sub(add(pb, dp), base) : dp;
}
const memVec = (mem: PoseMemory, k: string): Vec3 | null => (mem[`${k}:x`] === undefined ? null : v3(mem[`${k}:x`], mem[`${k}:y`], mem[`${k}:z`]));
const setMemVec = (mem: PoseMemory, k: string, v: Vec3): void => {
  mem[`${k}:x`] = v.x;
  mem[`${k}:y`] = v.y;
  mem[`${k}:z`] = v.z;
};

/**
 * Ordinary leg request of one side (body-local ankle target): the bounded procedural gait (ground-relative under the
 * suspension: on the probed ground below the hip, with the stance stagger) blended toward the clip ankle at the clip
 * weight. The stance-foot IK and the plan 07 foot requests act on top of it.
 */
export function legRequestLocal(inp: ProxyPoseInput, s: ArmSide): Vec3 {
  const { body, pose } = inp;
  const R = inp.ragdoll;
  const fwd = qRot(pose.q, v3(0, 0, 1));
  const vdir = inp.localVelDir ?? v3(0, 0, 1);
  const amp = Math.min(0.32, 0.075 * inp.speed);
  const lift = 0.13 * Math.min(1, inp.speed / 3);
  const gr = inp.ground ?? null;
  const soleH = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
  const hipL = hipLocal(body, s);
  const ph = inp.gait.phase + (s === 'left' ? 0 : Math.PI);
  const swing = Math.sin(ph) > 0 ? Math.sin(ph) : 0;
  // the swinging foot (sin ph > 0) moves from behind the hip to ahead of it along the travel with the fixed gait
  const off = (gr?.fixedGait ? -Math.cos(ph) : Math.cos(ph)) * amp;
  let proc = v3(hipL.x + vdir.x * off, (body.measured?.ankleTargetY ?? AUTHORED_ANKLE_Y) + lift * swing, hipL.z + vdir.z * off);
  if (gr && !gr.bodyRelative) {
    // ground-relative: the gait offset and stagger along the body's horizontal forward, the ankle at the flat-shoe
    // height above the ground plus the swing lift (world), below the hip
    const fwdH = norm(v3(fwd.x, 0, fwd.z), v3(0, 0, 1));
    const hipW = toWorld(pose, v3(hipL.x, hipL.y, hipL.z));
    const gx = qRot(pose.q, v3(vdir.x * off, 0, vdir.z * off));
    const still = idleStanceFade(inp.speed);
    const st = (s === 'left' ? 0.5 : -0.5) * gr.staggerM * still;
    // plan 08: the fitted idle stance is wider than the hips; it opens as the travel stops (absent: unchanged)
    const wide = inp.loco ? qRot(pose.q, v3(sideSignX(body, s) * idleWidthAddM(inp.loco.profile, body, s) * still, 0, 0)) : v3();
    const aw = v3(hipW.x + gx.x + fwdH.x * st + wide.x, gr.y + soleH + lift * swing, hipW.z + gx.z + fwdH.z * st + wide.z);
    proc = qInvRot(pose.q, sub(aw, pose.p));
  }
  const sl = inp.sampled ? inp.sampled.legs[s] : null;
  return sl ? lerp(proc, sl.ankleLocal, clamp(inp.sampled!.weight, 0, 1)) : proc;
}

export function buildProxyPose(inp: ProxyPoseInput): PhysicalPose {
  const { body, pose } = inp;
  const P = inp.probe;
  const R = inp.ragdoll;
  const straight = (R.validation.straightBendDeg * Math.PI) / 180;
  const W = (l: Vec3) => toWorld(pose, l);
  const fwd = qRot(pose.q, v3(0, 0, 1));
  const upB = qRot(pose.q, v3(0, 1, 0));
  const lm: Record<string, Vec3> = {};
  const segs = {} as Record<SegmentId, SegmentPose>;
  const hingeDeg: Record<string, number> = { neck: 0 };
  const straightFallback: string[] = [];
  const limbClearance: Record<string, number> = {};
  const mem = inp.memory ?? {};
  const ext = (shapes: PoseShape[]): number => (inp.clearance ? inp.clearance.external(shapes) : 0);
  // plan 13f (a leg-guard profile): the legs are also judged against where the other bodies will be next substep
  const legs = inp.clearance?.legs;
  const extL0 = (shapes: PoseShape[]): number => (legs ? legs.external(shapes) : ext(shapes));
  // contact motion prerequisite (`legSweep`): the leg queries are asked of the same solved leg several times in one pose
  // (candidate, continuity step, the sweep's checks); its shapes are never changed after the solve and the bodies stand
  // still within the pose, so each answer is kept. Without the sweep the queries are asked as before
  const legQ = (fn: (shapes: PoseShape[]) => number): ((shapes: PoseShape[]) => number) => {
    const m = new WeakMap<PoseShape[], number>();
    return (shapes) => {
      let v = m.get(shapes);
      if (v === undefined) m.set(shapes, (v = fn(shapes)));
      return v;
    };
  };
  const extL = inp.legSweep ? legQ(extL0) : extL0;
  // the physical bodies alone (`PoseClearance.legs.physical`)
  const physL = legQ((shapes) => (legs ? legs.physical(shapes) : ext(shapes)));
  // physical legs (live): the bodies they meet in the solve (`PoseClearance.legs.met`)
  const physMet = !!legs?.met;
  const metL = legQ((shapes) => legs!.met!(shapes));
  const softExt = (shapes: PoseShape[]): number => (inp.clearance?.soft ? inp.clearance.soft(shapes) : 0);
  // a sampled request at weight 0 still routes the legs through the continuous sampled solve (procedural targets)
  const smp = inp.sampled ?? null;
  const targetResidualM: Record<string, number> = {};
  const anklePitchDeg: Partial<Record<ArmSide, number>> = {};
  const legInfo: NonNullable<PhysicalPose['legInfo']> = {};
  /** Blend of a procedural request toward a sampled one (unit poles are blended as directions). */
  const toward = (a: Vec3, b: Vec3, w: number): Vec3 => lerp(a, b, clamp(w, 0, 1));
  const towardDir = (a: Vec3, b: Vec3, w: number): Vec3 => norm(toward(norm(a), norm(b), w), norm(a));
  segs.core = { segmentId: 'core', originWorld: { ...pose.p }, rotationWorld: { ...pose.q } };
  lm.pelvisMid = W(pelvisMidLocal(body));
  lm.neck = W(body.neck);
  lm.headCenter = W(body.headCenter);
  // plan 13e: the head turns on the core by the idle cycle's head rotation (chest frame), weighted from identity; the
  // clip's anatomical left is +X, so a body with its left on -X takes the rotation mirrored
  const idl = inp.loco?.idle;
  if (idl && idl.w > 0) {
    const h = sideSignX(body, 'left') > 0 ? idl.sample.head : { x: idl.sample.head.x, y: -idl.sample.head.y, z: -idl.sample.head.z, w: idl.sample.head.w };
    const hq = qMul(pose.q, qSlerp({ x: 0, y: 0, z: 0, w: 1 }, h, idl.w));
    lm.headCenter = add(lm.neck, qRot(hq, sub(body.headCenter, body.neck)));
    segs.head = { segmentId: 'head', originWorld: lm.neck, rotationWorld: hq };
  } else segs.head = { segmentId: 'head', originWorld: lm.neck, rotationWorld: { ...pose.q } };
  // flexion-bounded reach of every generated limb (the joint limits the candidate is validated against)
  const elbowMin = flexReach(R.lengths.upperArm, R.lengths.forearm + R.lengths.palmExtension, maxFlexRad(R, 'elbow'));
  const kneeMin = flexReach(R.lengths.thigh, R.lengths.shin, maxFlexRad(R, 'knee'));
  const gr0 = !!inp.ground;
  const tipAlong = body.measured?.handTipM;
  let seat: CarrySeat | null = null;
  // ---------------- arms
  for (const s of ['left', 'right'] as ArmSide[]) {
    const sx = sideSignX(body, s);
    const sh = W(shoulderLocal(body, s));
    const given = inp.arms?.[s];
    // plan 08a: the carry arm's request and the hand and ball seat on whatever forearm is achieved. The clip's arm swing fades
    // with the shown clip weight into the static carry (swing 0, between the keys). Plan 10d: the seat side is re-read on
    // each candidate's achieved forearm against the request's chest-frame inside direction (D4), and the ball is one of
    // the arm's clearance shapes (D4). An achieved arm (an arm task's) keeps its solve and its own hand: the hand's share
    // of the carry roll and flex passes to 0 over the profile's `handBlendS` and back when the carry has the arm again (D3);
    // the ball stays seated on the achieved forearm.
    const carryArm = inp.carry && inp.carriesBall && s === CARRY_ARM ? carryRequest(inp.carry, (smp?.weight ?? 0) * (smp?.carryRaw ?? 0), R.lengths.forearm, (p) => v3(p.x * (sideSignX(body, 'left') > 0 ? 1 : -1), p.y, p.z)) : null;
    const carried = given ? null : carryArm;
    let handW = 1;
    if (carryArm) {
      handW = stepHandW(mem.carryHand, !given, inp.dtS ?? 0, inp.carry!.handBlendS);
      mem.carryHand = handW;
    }
    /**
     * `palm`: the shown palm landmark; `reach`: the solved chain's end, where the arm's request is measured. `seat`: the
     * carry seat on this candidate's forearm; `ball`: the ball's clearance depth (external and floor, physical) and how
     * deep its centre is in the player's own torso or pelvis (a soft cost: a variant with the ball through the body ranks
     * below one without).
     */
    type ArmC = { elbow: Vec3; wrist: Vec3; palm: Vec3; reach: Vec3; chain: HingeChain; shapes: PoseShape[]; depth: number; soft: number; softOther: number; tgtL?: Vec3; poleL?: Vec3; seat?: CarrySeat; ball?: { depth: number; self: number }; body?: number; selfShapes?: PoseShape[] };
    const build = (elbow: Vec3, palm: Vec3, wristIn?: Vec3): ArmC => {
      const wrist0 = wristIn ?? add(elbow, scale(sub(palm, elbow), R.lengths.forearm / (R.lengths.forearm + R.lengths.palmExtension)));
      const chain = hingeChain(sh, elbow, [wrist0, palm], [fwd, upB], straight);
      const [wrist, reach] = chain.ends;
      const fa = { p: elbow, q: chain.frameB };
      const seatC = carryArm ? seatOn(carryArm, chain.frameB, pose.q, handW) : undefined;
      // an achieved arm's hand is its own; the carry's flex (by the hand's share) turns it from there
      const palmS = !seatC ? reach : carried ? toWorld(fa, seatPalmLocal(seatC, R.lengths.forearm, R.lengths.palmExtension)) : handW > 0 ? add(reach, qRot(chain.frameB, sub(seatPalmLocal(seatC, R.lengths.forearm, R.lengths.palmExtension), seatPalmLocal({ ...seatC, handW: 0 }, R.lengths.forearm, R.lengths.palmExtension)))) : reach;
      const shapes = armShapes(R, s, sh, elbow, wrist, palmS);
      const selfD = inp.clearance?.self ? inp.clearance.self(shapes.slice(1)) : 0;
      let depth = Math.max(ext(shapes), floorDepth(shapes));
      // arm self-clearance (opt-in): the arm's self shapes in the player's own measured trunk count as physical depth
      const selfShapes = inp.clearance?.body && tipAlong !== undefined ? armSelfShapes(R.radii, tipAlong, s, elbow, wrist, palmS) : undefined;
      const bodyD = selfShapes ? inp.clearance!.body!(selfShapes) : undefined;
      if (bodyD !== undefined) depth = Math.max(depth, bodyD);
      let ball: ArmC['ball'];
      if (seatC) {
        const bc = seatBallCapsule(fa, seatC, inp.carry!.ball);
        const bs: PoseShape = { kind: 'capsule', ...bc, key: 'carriedBall' };
        // the ball's centre inside the player's own torso or pelvis (the authored carry presses the ball into the padded
        // proxy torso, never its centre)
        const centre: PoseShape = { kind: 'ball', c: lerp(bc.a, bc.b, 0.5), r: 1e-4, key: 'carriedBall' };
        ball = { depth: Math.max(ext([bs]), floorDepth([bs])), self: inp.clearance?.self ? inp.clearance.self([centre]) : 0 };
        depth = Math.max(depth, ball.depth);
        shapes.push(bs);
      }
      const so = softExt(shapes);
      return { elbow, wrist, palm: palmS, reach, chain, shapes, depth, soft: Math.max(so, 0.5 * selfD, ball?.self ?? 0), softOther: so, seat: seatC, ball, ...(bodyD !== undefined ? { body: bodyD, selfShapes } : {}) };
    };
    let a: ArmC;
    if (given) {
      a = build(given.elbow, given.palm, given.wrist);
      // an achieved arm owns the pose: a later procedural pose starts from its own chosen candidate
      for (const q of ['d', 'p', 'b']) for (const c of ['x', 'y', 'z']) delete mem[`${s}Arm:${q}:${c}`];
    }
    else {
      // plan 07a (ground-relative poses): the previous shown elbow keeps the bend plane when the pole degenerates
      const prevElbowL = gr0 ? memVec(mem, `${s}Arm:e`) : null;
      const prevElbow = prevElbowL ? W(prevElbowL) : null;
      const JR = inp.jointRange;
      // contact motion M1: the twist this pose may show (the range, and one step from the last shown twist)
      const TW = JR?.shoulderTwist;
      const twWin = TW ? twistWindow(JR!.shoulder, TW, gr0 ? (mem[`${s}Arm:tw`] ?? null) : null, inp.dtS ?? 0) : null;
      const procedural = (palmL: Vec3, poleL: Vec3) => (): ArmC => {
        const tgt = W(palmL);
        const r = twoBone(sh, tgt, R.lengths.upperArm, R.lengths.forearm + R.lengths.palmExtension, stablePole(sh, tgt, qRot(pose.q, poleL), prevElbow, CONT_ARM_MPS * (inp.dtS ?? 0), CONT_FAST_MPS * (inp.dtS ?? 0)), undefined, elbowMin);
        if (!JR) return { ...build(r.mid, r.end), tgtL: palmL, poleL };
        // plan 12: an upper arm outside the shoulder cone turns the whole chain rigidly about the shoulder onto the
        // boundary (the elbow bend kept, the palm off its target: the request residual reports it)
        let { mid, end } = r;
        const cone = (): Vec3 => {
          const d = qInvRot(pose.q, norm(sub(mid, sh), v3(0, -1, 0)));
          const dc = clampDirToEnvelope(JR.shoulder, d, sx, 0);
          if (dc !== d) {
            const q = qFromUnitVectors(qRot(pose.q, d), qRot(pose.q, dc));
            mid = add(sh, qRot(q, sub(mid, sh)));
            end = add(sh, qRot(q, sub(end, sh)));
          }
          return dc;
        };
        let dc = cone();
        // contact motion M1: then the elbow turns about the shoulder-to-palm line into the twist window (the palm kept);
        // that turn moves the upper arm, so the cone is applied again after each turn: the cone is the hard limit, the
        // twist after the last clamp is within a fraction of a degree of the window
        for (let it = 0; it < 2 && twWin; it++) {
          const f = fitElbowTwist(JR.shoulder, pose.q, sh, mid, end, sx, twWin);
          if (!f.turned) break;
          mid = f.elbow;
          dc = cone();
          // what the clamp's turn left outside the window: the forearm turns about the upper arm (the cone kept)
          if (it === 1) end = turnForearmTwist(JR.shoulder, pose.q, sh, mid, end, sx, twWin);
        }
        const c = build(mid, end);
        // and the forward preference: a soft cost per 30 deg behind the side line
        const behind = behindDeg(dc);
        return { ...c, soft: behind > 0 ? c.soft + (JR.forwardCostM * behind) / 30 : c.soft, tgtL: palmL, poleL };
      };
      let palm0 = proceduralArmTargetLocal(s, inp);
      let pole0 = v3(0.6 * sx, -0.5, -0.6);
      const k = `${s}Arm`;
      // plan 08: a free arm rests in the fitted idle posture and swings opposite the achieved feet (the gait swing target
      // above is only 25% at walking speed, and the planner's steps do not follow the gait phase)
      const lo = inp.loco;
      const freeArm = !!lo && !inp.readyHands && !(inp.carriesBall && s === CARRY_ARM);
      if (freeArm) {
        const mx = sideSignX(body, 'left') > 0 ? 1 : -1;
        const dir = (a: readonly number[]): Vec3 => v3(a[0] * mx, a[1], a[2]);
        // plan 13e: the idle cycle at this player's phase, blended from the representative frame by the idle weight
        const still = lo!.profile.idle.arms[s];
        const id = lo!.idle;
        const blend = (a: readonly number[], c: Vec3 | undefined): Vec3 => (id && c && id.w > 0 ? norm(lerp(dir(a), v3(c.x * mx, c.y, c.z), id.w), dir(a)) : dir(a));
        const rest = chestArm(body, R, s, blend(still.upper, id?.sample.upper[s]), blend(still.fore, id?.sample.fore[s]));
        const sw = (s === 'left' ? 1 : -1) * lo!.swing;
        const A = lo!.profile.walk;
        // about the shoulder, the fitted arm a little bent (a straight arm has no stable elbow), more when forward
        const shL = shoulderLocal(body, s);
        const reach = scale(sub(rest.palmLocal, shL), A.restReach - A.forwardBend * Math.max(0, sw));
        const ang = A.swingRad * sw;
        const c = Math.cos(ang);
        const n = Math.sin(ang);
        palm0 = add(shL, v3(reach.x, reach.y * c + reach.z * n, reach.z * c - reach.y * n));
        pole0 = v3(0.35 * sx, 0, -1);
      }
      // run-clip arms: a free arm takes the clip swing; the carry arm holds the ball beside the chest (CLIP_CARRY) and
      // adds a share of the clip hand's excursion (the ball stays in that hand); ready hands keep their procedural
      // assignment. The blend starts from the pose the procedural path showed (its last chosen variant, kept while
      // the clip is off), so the clip fades in without a jump.
      const carry = !!inp.carriesBall && s === CARRY_ARM;
      const sw = smp?.arms && !inp.readyHands ? smp.arms[s] : null;
      const sampledArm = !!sw && smp!.weight > 0 && (!carry || smp!.carrySampled);
      if (carried) {
        const req = chestArm(body, R, s, carried.upper, carried.fore);
        palm0 = req.palmLocal;
        pole0 = req.poleLocal;
      } else if (sw && sampledArm) {
        const from = mem[`${k}Proc`] ?? 0;
        const alt = from > 0 ? ARM_ALTS(sx)[from - 1] : null;
        const fromPalm = alt ? proceduralLocal(body, s, alt.palm) : palm0;
        const fromPole = alt ? alt.pole : pole0;
        const toPalm = carry ? addScaled(proceduralLocal(body, s, v3(CLIP_CARRY.x * sx, CLIP_CARRY.y, CLIP_CARRY.z)), sw.swingLocal, smp!.carrySwing) : sw.palmLocal;
        const toPole = carry ? pole0 : sw.poleLocal;
        palm0 = toward(fromPalm, toPalm, smp!.weight);
        pole0 = towardDir(fromPole, toPole, smp!.weight);
      }
      // plan 08: a free arm braces while braking (carry and ready hands keep their own pose; achieved arms never get here)
      const braced = freeArm ? Math.max(lo!.brakeB, lo!.contactW) : 0;
      if (braced > 0) {
        const bp = lo!.profile.brace;
        palm0 = toward(palm0, proceduralLocal(body, s, v3(bp.palm.x * sx, bp.palm.y, bp.palm.z)), braced);
        pole0 = towardDir(pole0, v3(bp.pole.x * sx, bp.pole.y, bp.pole.z), braced);
      }
      // plan 08: a composed free or carry arm is judged like a sampled arm: the plan 07 path stood in a raised alternative
      // for a few millimetres of padded self overlap (and blended clips and stops through that stale variant). Another body is
      // a real obstacle: the arm moves off it continuously, and the alternatives remain for what that does not clear.
      const held = sampledArm || (!!lo && !inp.readyHands) || !!carried;
      const cands = [procedural(palm0, pole0), ...ARM_ALTS(sx).map((c) => procedural(proceduralLocal(body, s, c.palm), c.pole))];
      if (P?.on) P.last[`${inp.playerId}:${k}`] = cands.map((c, i) => { const r = c(); return { i, depth: r.depth, soft: r.soft }; });
      // a sampled arm that crosses another body moves away from the body (horizontal, radially from the body axis: a
      // continuous direction) by the smallest clearing distance (bracketed, then bisected), so the correction changes
      // continuously with the clip; only when nothing within SWING_OUT_MAX clears does it fall back to the
      // alternatives. Its own torso is a constraint only under a fixture's self-clearance profile (the measured trunk, in
      // `depth`); otherwise the clips' self overlap stands: they were authored on this skeleton and the proxy boxes are
      // padded.
      let r: { best: ArmC; index: number } | null = null;
      if (held) {
        const clear = (c: ArmC) => c.depth <= CLEAR_OK && c.softOther <= CLEAR_OK;
        const c0 = cands[0]();
        if (clear(c0)) r = { best: c0, index: 0 };
        else {
          const u = norm(v3(palm0.x, 0, palm0.z), v3(sx, 0, 0));
          const at = (d: number) => procedural(addScaled(palm0, u, d), pole0)();
          let lo = 0;
          for (let d = SWING_OUT_STEP; d <= SWING_OUT_MAX + 1e-9; d += SWING_OUT_STEP) {
            if (clear(at(d))) {
              let hi = d;
              for (let b = 0; b < 6; b++) {
                const m = 0.5 * (lo + hi);
                if (clear(at(m))) hi = m;
                else lo = m;
              }
              r = { best: at(hi), index: 0 };
              break;
            }
            lo = d;
          }
        }
      }
      // a sampled arm returns to its primary as soon as that is clear again (no sticking in an alternative)
      r ??= pick(cands, mem[k], held, gr0);
      mem[k] = r.index;
      if (!held) mem[`${k}Proc`] = r.index;
      else if (lo) mem[`${k}Proc`] = 0;
      a = r.best;
      // plan 07 continuity (ground-relative poses): the palm target's departure from the ordinary request and the elbow
      // pole move toward the chosen candidate at a bounded rate
      let contDbg: Record<string, number> | null = null;
      if (gr0) {
        const dc = sub(a.tgtL!, palm0);
        const pc = norm(a.poleL!, pole0);
        const dt = inp.debug?.noContinuity ? 0 : (inp.dtS ?? 0);
        // plan 08: an owner change jumps the palm request: the arm carries on at its last body-frame motion, as a foot's new
        // owner does, and turns toward the new request at the bounded rate from there, not from where it stood
        const last = lo ? contShown(mem, k) : null;
        const last2 = lo ? memVec(mem, `${k}:s`) : null;
        if (last) setMemVec(mem, `${k}:s`, last);
        const pb = memVec(mem, `${k}:b`);
        const handed = !!pb && !!last2 && dist(palm0, pb) > CONT_BASE_MPS * dt;
        const dp0 = contPrev(mem, k, palm0, dt);
        const dp = handed ? sub(sub(scale(last!, 2), last2!), palm0) : dp0;
        // plan 14: a clip arm on a composed pose turns its shown pole with the request's own pole, as the departure is
        // measured from the moving request: only a departure from the request is rate-limited. Before, the clip's elbow
        // plane (which turns about 110 degrees each half cycle) was held at the rate limit, and the run's forward swing
        // lifted the elbow out and above the shoulder. Only consecutive clip-arm poses carry; a request jump (`handed`)
        // is not carried.
        const clipPole = !!lo && sampledArm;
        const pp0 = memVec(mem, `${k}:p`);
        const pq = clipPole && !handed ? memVec(mem, `${k}:q`) : null;
        const pp = pp0 && pq ? qRot(qFromUnitVectors(norm(pq, pole0), norm(pole0, pq)), pp0) : pp0;
        if (clipPole) setMemVec(mem, `${k}:q`, pole0);
        else for (const c of ['x', 'y', 'z']) delete mem[`${k}:q:${c}`];
        if (dp && pp && dt > 0) {
          const chosen = a;
          const extOk = Math.max(HARD_OK, chosen.depth) + 1e-9;
          // the blended palm target, pushed out along the contact normals while it penetrates
          const at = (al: number): ArmC => {
            const t0 = add(palm0, lerp(dp, dc, al));
            let t = t0;
            const pole = towardDir(pp, pc, al);
            let c = procedural(t, pole)();
            // ladder 11d (`selfSeam`): the own trunk's share of a move, halved each time it turns against the one before
            let lastSelf: Vec3 | null = null;
            let selfGain = 1;
            // pushed toward validity (HARD_OK), also when no candidate is valid (tangled with another body)
            for (let i = 0; i < CONT_PUSH_IT && c.depth > HARD_OK && inp.clearance?.push; i++) {
              const pw = inp.clearance.push(c.shapes);
              const bw = c.selfShapes && inp.clearance.bodyPush ? inp.clearance.bodyPush(c.selfShapes) : null;
              if (bw && inp.selfSeam) {
                if (lastSelf && dot(bw, lastSelf) < 0) selfGain *= 0.5;
                lastSelf = bw;
              }
              const pv = qInvRot(pose.q, bw ? (selfGain === 1 ? add(pw, bw) : addScaled(pw, bw, selfGain)) : pw);
              const m = len(pv);
              if (m < 1e-6) break;
              t = add(t0, clampLen(sub(addScaled(t, pv, 1 + 0.001 / m), t0), CONT_PUSH_MAX_M));
              c = procedural(t, pole)();
            }
            return c;
          };
          const guard = inp.handoffPossible !== false;
          const memo = new Map<number, ArmC>();
          const atM = (x: number): ArmC => {
            let c = memo.get(x);
            if (!c) memo.set(x, (c = at(x)));
            return c;
          };
          const al = continuityAlpha(dp, pp, dc, pc, dt, lo ? CONT_L3_MPS : CONT_ARM_MPS, lo ? CONT_L3_RADPS : CONT_POLE_RADPS, (x) => {
            const c = atM(x);
            return { good: !guard || c.depth <= extOk, depth: c.depth };
          }, P);
          if (P?.on && P.contLast) P.cont[`${inp.playerId}:${k}`] = P.contLast;
          // plan 07a: a tangled chosen candidate (itself in another body) is shown pushed out too, as for the legs
          const shownPushed = al < 1 || ext(chosen.shapes) > HARD_OK;
          if (shownPushed) a = atM(al);
          if (P?.trace) contDbg = { ...(P.contLast ?? { a0: al, dd: 0 }), al, push: dist(a.tgtL!, add(palm0, lerp(dp, dc, al))) };
          // the shown target (with its push-out) is the next pose's start: each step then only needs a shallow push
          setMemVec(mem, `${k}:d`, shownPushed ? sub(a.tgtL!, palm0) : dc);
          setMemVec(mem, `${k}:p`, al < 1 ? towardDir(pp, pc, al) : pc);
        } else {
          setMemVec(mem, `${k}:d`, dc);
          setMemVec(mem, `${k}:p`, pc);
        }
      }
      if (P?.trace) P.trace(`${inp.playerId}:${k}`, { cont: contDbg, v: r.index, sampled: sampledArm, palm0, dc: sub(r.best.tgtL!, palm0), shown: a.tgtL ? sub(a.tgtL, palm0) : null, poleC: r.best.poleL, pole: a.poleL, elbow: qInvRot(pose.q, sub(a.elbow, pose.p)), wrist: qInvRot(pose.q, sub(a.wrist, pose.p)), fb: a.chain.fallback, depth: a.depth });
      if (held) targetResidualM[k] = dist(a.reach, W(palm0));
    }
    const pre = s;
    // contact motion M1: the shown twist is the next pose's start (an arm task's too, so a procedural arm carries on from it)
    if (inp.jointRange?.shoulderTwist) {
      const tw = armTwistRad(inp.jointRange.shoulder, pose.q, sh, a.elbow, a.reach, sx);
      if (tw !== null) mem[`${s}Arm:tw`] = tw;
    }
    lm[`${pre}Shoulder`] = sh;
    lm[`${pre}Elbow`] = a.elbow;
    if (gr0) setMemVec(mem, `${s}Arm:e`, qInvRot(pose.q, sub(a.elbow, pose.p)));
    lm[`${pre}Wrist`] = a.wrist;
    lm[`${pre}Palm`] = a.palm;
    lm[`${pre}Hand`] = addScaled(a.palm, norm(sub(a.palm, a.wrist), v3(0, -1, 0)), -R.radii.palm);
    if (carryArm) {
      seat = a.seat!;
      lm.carriedBall = toWorld({ p: a.elbow, q: a.chain.frameB }, seatBallLocal(seat));
      // plan 10d D4: the ball's fit is reported, never hidden in the arm's residual
      limbClearance.carriedBall = a.ball!.depth;
      limbClearance.carriedBallTorso = a.ball!.self;
    }
    segs[`${pre}UpperArm` as SegmentId] = { segmentId: `${pre}UpperArm` as SegmentId, originWorld: sh, rotationWorld: a.chain.frameA };
    segs[`${pre}Forearm` as SegmentId] = { segmentId: `${pre}Forearm` as SegmentId, originWorld: a.elbow, rotationWorld: a.chain.frameB };
    hingeDeg[`${pre}Elbow`] = (a.chain.angleRad * 180) / Math.PI;
    if (a.chain.fallback) straightFallback.push(`${pre}Elbow`);
    limbClearance[`${pre}Arm`] = a.depth;
    if (a.body !== undefined) limbClearance[`${pre}ArmTrunk`] = a.body;
  }
  // ---------------- legs: bounded procedural gait, floor-constrained, opponent-aware (no support or traction)
  const gr = inp.ground ?? null;
  for (const s of ['left', 'right'] as ArmSide[]) {
    const sx = sideSignX(body, s);
    const hipL = hipLocal(body, s);
    const sl = smp ? smp.legs[s] : null;
    const fr = gr ? inp.feet?.[s] : undefined;
    let base = legRequestLocal(inp, s);
    // plan 07 foot requests: a plant or swing target replaces the request (alternatives stay offsets around it); an
    // offset shifts it; the foot heading becomes the primary variant's knee pole
    const Lw = (w: Vec3): Vec3 => qInvRot(pose.q, sub(w, pose.p));
    const soleUp = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
    if (fr?.kind === 'target') base = Lw(fr.ankleW);
    else if (fr?.kind === 'plant') base = Lw(add(fr.heelW, v3(0, soleUp, 0)));
    else if (fr?.kind === 'offset') base = add(base, qInvRot(pose.q, fr.offsetW));
    const frHeading = fr?.headingRad;
    const frPole = fr && frHeading !== undefined && (fr.kind !== 'offset' || (fr.poleW ?? 0) > 0) ? v3(Math.sin(frHeading), 0.2, Math.cos(frHeading)) : null;
    // an authored knee pole (x across, z along) in the foot heading frame: LEG_ALTS[0]'s pole there is frPole
    const headingPole = (p: Vec3, h: number): Vec3 => v3(p.x * Math.cos(h) + p.z * Math.sin(h), p.y, -p.x * Math.sin(h) + p.z * Math.cos(h));
    const hip = W(hipL);
    // plan 07a (ground-relative legs): the previous shown knee keeps the bend plane when the pole degenerates
    const prevKneeL = gr ? memVec(mem, `${s}Leg:e`) : null;
    const prevKnee = prevKneeL ? W(prevKneeL) : null;
    // plan 07a: and the held reach direction keeps the ankle continuous when the target comes inside the minimum reach
    const prevReachL = gr ? memVec(mem, `${s}Leg:r`) : null;
    const prevReach = prevReachL ? qRot(pose.q, prevReachL) : null;
    const prevReachLimited = !!gr && mem[`${s}Leg:reachLimited`] === 1;
    type LegC = { knee: Vec3; ankle: Vec3; chain: HingeChain; shapes: PoseShape[]; depth: number; soft: number; soleAngle?: number; req?: Vec3; ik?: Vec3; softM: number; pitch: number; rollF?: number; edgeX?: number; pole?: Vec3; held?: Vec3; reachLimited?: boolean; hipHeld?: boolean };
    // Sampled / ground-relative leg solve for a knee pole: soft reach (the target eases in below the reach limit, which
    // keeps a minimum knee flexion, so the knee never snaps straight and its hinge axis never flips) and the clip's foot
    // pitch at the ankle (the shoe keeps the clip foot's angle to the floor within the ankle range, so a planted foot
    // stays flat while the shin leans). `depth` here is the floor depth.
    // plan 12: a joint-range profile's ankle range on ground-relative legs (past it the plant pivots on a sole corner)
    const JA = inp.jointRange?.ankle;
    const dorsi = JA ? (JA.dorsiDeg * Math.PI) / 180 : ANKLE_DORSI;
    const plantar = JA ? (JA.plantarDeg * Math.PI) / 180 : ANKLE_PLANTAR;
    // plan 07 plant: the ankle (fixed point over the shoe frame) that puts the planted sole point (edgeX, toeZ * rollF)
    // on its world anchor for a leg solve
    const plantIk = (solve: (t: Vec3) => LegC, start: Vec3, f: FootRequest & { kind: 'plant' }, rf: number, ex: number): Vec3 => {
      const dir = v3(Math.sin(f.headingRad), 0, Math.cos(f.headingRad));
      const lat = v3(Math.cos(f.headingRad), 0, -Math.sin(f.headingRad));
      const feature = addScaled(addScaled(f.heelW, dir, f.toeZ * rf), lat, ex);
      const soleFoot = v3(ex, -soleUp, f.toeZ * rf);
      let p = start;
      for (let i = 0; i < 4; i++) {
        const c0 = solve(p);
        p = sub(feature, qRot(pitchShin(c0.chain.frameB, c0.pitch), soleFoot));
      }
      return p;
    };
    // ladder 11b: the last shown thigh rotation (the next window's start)
    const HT = gr ? inp.jointRange?.hipTwist : undefined;
    const hipPrev = HT ? (mem[`${s}Leg:hr`] ?? null) : null;
    const hipHeld = !!HT && mem[`${s}Leg:hrHeld`] === 1;
    // `free`: the knee where the pole puts it, not turned from the shown knee by at most the continuity bound
    const legSolver = (pole: Vec3, free = false) => {
      const hdir = norm(v3(pole.x, 0, pole.z), fwd);
      const a = R.lengths.thigh;
      const b = R.lengths.shin;
      const reach = Math.sqrt(a * a + b * b + 2 * a * b * Math.cos(MIN_FLEX * straight));
      const soft = (t: Vec3): Vec3 => {
        const d = sub(t, hip);
        const L = len(d);
        const ds = reach - SOFT_REACH_M;
        if (L <= ds) return t;
        return addScaled(hip, d, (ds + SOFT_REACH_M * (1 - Math.exp(-(L - ds) / SOFT_REACH_M))) / L);
      };
      const solve = (t: Vec3): LegC => {
        const sr = stableReach(hip, soft(t), prevReach, kneeMin, CONT_FAST_MPS * (inp.dtS ?? 0), prevReachLimited);
        const st = sr.target;
        const r = twoBone(hip, st, a, b, stablePole(hip, st, pole, free ? null : prevKnee, CONT_LEG_MPS * (inp.dtS ?? 0), CONT_FAST_MPS * (inp.dtS ?? 0), !!inp.loco), reach, kneeMin);
        // ladder 11b: the shin turns about the thigh into the rotation window (the thigh kept, the ankle moves). Past
        // HIP_TWIST_SWING_DEG of swing the rotation from hanging is ill-defined (the visible meter does not read it there)
        // and the leg is as solved
        const mid = r.mid;
        const ft = HT && -dot(norm(sub(mid, hip), upB), upB) > HIP_TWIST_SWING_COS ? fitThighTwist(HT.envelope, HT, pose.q, hip, mid, r.end, sx, hipPrev, hipHeld, inp.dtS ?? 0) : null;
        const end = ft ? ft.ankle : r.end;
        const chain = hingeChain(hip, mid, [end], [neg(fwd), neg(upB)], straight);
        const ankle = chain.ends[0];
        // pitch about the shin hinge axis that gives the shoe the clip foot's sagittal angle (toe up positive)
        const zw = qRot(chain.frameB, v3(0, 0, 1));
        // legacy: the clip foot angle at the clip weight (rigid shoe at weight 0); ground-relative legs: the shoe keeps
        // the blended foot angle (clip at its weight, flat on the ground otherwise) at full ankle authority
        const wc = sl ? smp!.weight : 0;
        const want = Math.atan2(zw.y, dot(zw, hdir)) - (gr ? (fr?.soleW ?? 1) * wc * (sl?.footPitch ?? 0) + (fr?.soleO ?? 0) : sl!.footPitch);
        const pitch = (gr ? 1 : wc) * clamp(Math.atan2(Math.sin(want), Math.cos(want)), -(gr ? dorsi : ANKLE_DORSI_LEGACY), gr ? plantar : ANKLE_PLANTAR);
        const shapes = legShapes(R, s, hip, mid, ankle, chain.frameB, pitchShin(chain.frameB, pitch));
        const zs = qRot(pitchShin(chain.frameB, pitch), v3(0, 0, 1));
        // plan 12 (a joint-range profile): the achieved angle in the measure the next solve applies it in, the shin frame's
        // angle less the pitch. The shoe's own projected angle differs from it when the shin frame lies across the heading
        // (L3-F11-invalid: D's falling left leg, its shin frame 50 degrees across, 25 degrees apart), and a new owner seeded
        // from that would turn the shoe by the difference in one substep
        const soleAngle = JA ? Math.atan2(Math.sin(Math.atan2(zw.y, dot(zw, hdir)) - pitch), Math.cos(Math.atan2(zw.y, dot(zw, hdir)) - pitch)) : Math.atan2(zs.y, dot(zs, hdir));
        return { knee: mid, ankle, chain, shapes, depth: floorDepth(shapes), soft: 0, softM: dist(t, soft(t)), pitch, pole, held: sr.held, reachLimited: sr.limited, soleAngle, ...(ft ? { hipHeld: ft.held } : {}) };
      };
      return { solve, hdir };
    };
    // `atPole` (`legSweep`): the primary placement (its ankle target, a plant's anchor) at the knee pole `poleL`, in the
    // foot heading frame where the foot has one (blended with the ordinary pole as the primary's is), else the body frame
    // `free` (rung 7): solved with the knee where its pole puts it (legSolver)
    const variant = (o: Vec3, poleL: Vec3, atPole = false, free = false) => (): LegC => {
      let target = W(add(base, o));
      const primary = len(o) < 1e-9;
      const ordinary = (): Vec3 => qRot(pose.q, sl ? towardDir(poleL, sl.poleLocal, smp!.weight) : poleL);
      const hp = atPole && frPole ? headingPole(poleL, frHeading!) : null;
      const pole = hp ? (fr?.poleW === undefined ? hp : towardDir(ordinary(), hp, fr.poleW)) : frPole && primary && !atPole ? (fr?.poleW === undefined ? frPole : towardDir(ordinary(), frPole, fr.poleW)) : ordinary();
      if (sl || gr) {
        // Sampled legs, all continuous in the clip phase (no searches or switches): the solve above, stance foot IK, then
        // a fixed-point floor lift for what is left (a pitch at the ankle range limit, a blend toward the procedural gait).
        const { solve, hdir } = legSolver(pole, free);
        // stance foot IK (primary variant only; alternatives keep their clearance offset): the clip ankle is corrected
        // so the shoe's planted sole point lands on the clip's contact point (fixed point over the shoe frame); the
        // correction is added at the clip weight, so a partly blended request is not pulled to the clip's contact
        let rollUsed: number | undefined;
        let edgeUsed: number | undefined;
        if (fr?.kind === 'plant' && primary) {
          // plan 07 plant: the same fixed point onto the world anchor of the planted contact feature (the sole point at
          // the roll fraction on the planted footprint), at full weight. The shoe is rigid on the shin (no toe joint) with
          // a bounded pitch and no subtalar roll: when the solved shoe would dip below the floor at a sole corner (pitch
          // at the ankle range, a tilted shin), the footprint pivots on that corner instead (the same footprint's corner
          // on its anchor; the rest of the sole lifts). The pivot is a sole point (edgeX, toeZ * rollF) of the shoe
          // frame; the roll fraction then lies outside [0, 1].
          const ikAt = (rf: number, ex: number): Vec3 => plantIk(solve, target, fr, rf, ex);
          let rf = fr.rollF;
          let ex = fr.edgeX ?? 0;
          let p = ikAt(rf, ex);
          const c1 = solve(p);
          if (c1.depth > 0.0005 && fr.toeZ > 1e-6) {
            const Q = pitchShin(c1.chain.frameB, c1.pitch);
            const he = R.shoe.halfExtents;
            let low = { x: 0, z: 0, y: Infinity };
            for (const x of [-he.x, he.x])
              for (const z of [R.shoe.forwardM - he.z, R.shoe.forwardM + he.z]) {
                const y = add(c1.ankle, qRot(Q, v3(x, -soleUp, z))).y;
                if (y < low.y) low = { x, z, y };
              }
            const rf2 = low.z / fr.toeZ;
            if (Math.abs(rf2 - rf) > 1e-9 || Math.abs(low.x - ex) > 1e-9) {
              const p2 = ikAt(rf2, low.x);
              if (solve(p2).depth < c1.depth) {
                p = p2;
                rf = rf2;
                ex = low.x;
              }
            }
          }
          target = p;
          rollUsed = rf;
          edgeUsed = ex;
        } else if (sl?.contact && primary && !fr) {
          // (with plan 07 foot requests the planner owns stance contact: clip stance plants are its world anchors)
          const ct = sl.contact;
          const clipAnkle = W(sl.ankleLocal);
          let p = clipAnkle;
          for (let i = 0; i < 4; i++) {
            const c0 = solve(p);
            p = sub(ct.pointWorld, qRot(pitchShin(c0.chain.frameB, c0.pitch), ct.soleFoot));
          }
          target = addScaled(target, sub(p, clipAnkle), clamp(ct.weight * smp!.weight, 0, 1));
        }
        const ik = target;
        let c = solve(target);
        // the least-penetrating lift is kept: near the flexion limit the lift can overshoot and fold the leg back down
        let best = { c, target };
        for (let i = 0; i < 8 && c.depth > 0.0005; i++) {
          target = add(target, v3(0, c.depth + 0.001, 0));
          // a leg folded at its flexion limit cannot lift its shoe by shortening (the solve clamps the reach to the
          // hinge's minimum along the same line): the target also moves out along the bend direction, unfolding the leg
          const d = sub(target, hip);
          const L = len(d);
          if (L < kneeMin + 0.02) target = addScaled(target, hdir, kneeMin + 0.02 - L + c.depth);
          c = solve(target);
          if (c.depth < best.c.depth) best = { c, target };
        }
        c = best.c;
        target = best.target;
        c.req = target;
        c.ik = ik;
        c.rollF = rollUsed;
        c.edgeX = edgeUsed;
        if (P?.on && len(o) < 1e-9 && !atPole) P.legs[`${inp.playerId}:${s}`] = { request: W(base), ik, lifted: target, floorLeft: c.depth };
        // floor depth left after the lift is a presentation residual, not a reason to switch variants
        c.depth = extL(c.shapes);
        c.soft = softExt(c.shapes);
        return c;
      }
      let c: LegC | null = null;
      for (let it = 0; it < 5; it++) {
        const r = twoBone(hip, target, R.lengths.thigh, R.lengths.shin, pole, undefined, kneeMin);
        const chain = hingeChain(hip, r.mid, [r.end], [neg(fwd), neg(upB)], straight);
        const ankle = chain.ends[0];
        const shapes = legShapes(R, s, hip, r.mid, ankle, chain.frameB);
        const fd = floorDepth(shapes);
        c = { knee: r.mid, ankle, chain, shapes, depth: fd, soft: 0, softM: 0, pitch: 0 };
        if (fd <= 0.001) break;
        target = add(target, v3(0, fd + 0.003, 0));
      }
      c!.depth = Math.max(c!.depth, extL(c!.shapes));
      c!.soft = softExt(c!.shapes);
      return c!;
    };
    const k = `${s}Leg`;
    // plan 08: a composed foot's new owner starts from the achieved foot, which already holds the old clearance departure:
    // the primary leg is tried first, an offset on top would add that correction twice
    const own = fr?.poleW === undefined ? 0 : fr.carried && mem[`${k}:own`] !== undefined ? mem[`${k}:own`] : (fr.kind === 'plant' ? 1 : fr.kind === 'target' ? 2 : 3) + 4 * (fr.seed ?? 0);
    const rebased = own !== 0 && mem[`${k}:own`] !== undefined && mem[`${k}:own`] !== own;
    // contact motion prerequisite (`legSweep`, ground-relative legs): each placement is solved once per pose (the step's
    // alternatives read them again), and index alts.length + j is the primary placement at knee pole LEG_POLES[j]
    const sweep = !!inp.legSweep && !!gr;
    const alts = LEG_ALTS(sx);
    const once = (fn: () => LegC): (() => LegC) => {
      let c: LegC | undefined;
      return () => (c ??= fn());
    };
    const cands = alts.map((v) => (sweep ? once(variant(v.off, v.pole)) : variant(v.off, v.pole)));
    const kneePoles = sweep ? LEG_POLES(sx) : [];
    const poleCands = kneePoles.map((p) => once(variant(v3(), p, true)));
    // rung 7: the primary placement with its knee where its pole puts it
    const primaryOwn = once(variant(v3(), alts[0].pole, false, true));
    const candAt = (i: number): (() => LegC) => (i < alts.length ? cands[i] : poleCands[i - alts.length]);
    // ladder 11c (`legOwn`): the other leg as last shown, this pose's for the right leg (solved after the left), the
    // previous pose's for the left; a knee-pole placement crossing it (`ownCross`) is not taken
    const OL = sweep ? inp.legOwn : undefined;
    const ol = s === 'left' ? 'right' : 'left';
    const otherL = !OL ? null : s === 'right' ? { k: lm.leftKnee, a: lm.leftAnkle, f: lm.leftShoe } : ((kk, aa, ff) => (kk && aa && ff ? { k: W(kk), a: W(aa), f: W(ff) } : null))(memVec(mem, `${ol}Leg:e`), memVec(mem, `${ol}Leg:an`), memVec(mem, `${ol}Leg:sf`));
    const otherAx = OL && otherL ? legAxes(OL, W(hipLocal(body, ol)), otherL.k, otherL.a, otherL.f) : null;
    const ownNear = (x: LegC): number => (otherAx ? ownLegNear(legAxes(OL!, hip, x.knee, x.ankle, (x.shapes[2] as Extract<PoseShape, { kind: 'box' }>).c), otherAx) : -Infinity);
    const ownCross = (x: LegC): boolean => !!otherAx && ownNear(x) > Math.max(0, ownNear(cands[0]())) + 1e-4;
    const prevV = rebased ? 0 : mem[k];
    // footwork's plant test on a shown leg (observeFoot): its contact feature on the anchor across the ground and the
    // shoe's lowest corner on the ground, together within the plant tolerance
    const plantKept = (x: LegC, p: FootRequest & { kind: 'plant' }): boolean => {
      const rf = x.rollF ?? p.rollF;
      const ex = x.edgeX ?? p.edgeX ?? 0;
      const anchor = addScaled(addScaled(p.heelW, v3(Math.sin(p.headingRad), 0, Math.cos(p.headingRad)), p.toeZ * rf), v3(Math.cos(p.headingRad), 0, -Math.sin(p.headingRad)), ex);
      const feat = add(x.ankle, qRot(pitchShin(x.chain.frameB, x.pitch), v3(ex, -soleUp, p.toeZ * rf)));
      const shoe = x.shapes[2] as Extract<PoseShape, { kind: 'box' }>;
      let low = Infinity;
      for (const a of [-1, 1]) for (const b of [-1, 1]) for (const c of [-1, 1]) low = Math.min(low, shoe.c.y + qRot(shoe.q, v3(a * shoe.he.x, b * shoe.he.y, c * shoe.he.z)).y);
      return Math.hypot(Math.hypot(feat.x - anchor.x, feat.z - anchor.z), low - p.heelW.y) <= (p.tolM ?? 0.01) + 1e-9;
    };
    // the ordinary choice: a leg kept at a knee-pole placement re-picks from the primary
    const ordinaryR = pick(cands, prevV !== undefined && prevV >= alts.length ? 0 : prevV, !!sl || !!gr, !!gr);
    // One leg step from the chosen placement `r` (index alts.length + j: the primary at knee pole LEG_POLES[j]): the
    // continuity blend toward it, its push-outs, and (`legSweep`) its judgement; `ok` says whether the shown leg is clear
    // (no physical body past the larger of HARD_OK and its depth at the step's start), `keptOn` whether a plant's shown leg
    // keeps it (plantKept)
    const legStep = (r: { best: LegC; index: number }): { r: { best: LegC; index: number }; l: LegC; contDbg: Record<string, number> | null; ok: boolean; keptOn: boolean } => {
    // the primary placement, at the foot heading's pole or another knee pole
    const primaryAt = r.index === 0 || r.index >= alts.length;
    mem[k] = r.index;
    let l = r.best;
    let ok = true;
    // plan 07 continuity (ground-relative legs): the ankle target's departure from the ordinary request (variant offset,
    // plant correction, floor lift) and the knee pole move toward the chosen candidate at a bounded rate
    let contDbg: Record<string, number> | null = null;
    if (gr && l.req && l.pole) {
      const dc = sub(Lw(l.req), base);
      const pc = qInvRot(pose.q, l.pole);
      const dt = inp.debug?.noContinuity ? 0 : (inp.dtS ?? 0);
      // plan 08: the new request starts from the shown path; the old departure is not added a second time
      if (own !== 0) mem[`${k}:own`] = own;
      // ... and where it was going: a new owner takes over a moving foot, at its last body-frame motion
      const last = own !== 0 ? contShown(mem, k) : null;
      const last2 = own !== 0 ? memVec(mem, `${k}:s`) : null;
      if (last) setMemVec(mem, `${k}:s`, last);
      const shownPrev = rebased && last ? (last2 ? sub(scale(last, 2), last2) : last) : null;
      const dp0 = contPrev(mem, k, base, dt);
      if (rebased) setMemVec(mem, `${k}:b`, base);
      const dp0r = shownPrev ? sub(shownPrev, base) : dp0;
      // fault (PoseDebug.ownerChangeJumpM): a new owner's step starts off the shown path
      const dp = rebased && dp0r && inp.debug?.ownerChangeJumpM ? add(dp0r, v3(0, inp.debug.ownerChangeJumpM, 0)) : dp0r;
      const pp = memVec(mem, `${k}:p`);
      const poleStep = pp && inp.loco ? dist(norm(pp), norm(pc)) : 0;
      const exactPlant = fr?.kind === 'plant' && primaryAt && !!dp && dist(dp, dc) <= (rebased ? CONT_L3_PLANT_MPS * (inp.dtS ?? 0) : CONT_PLANT_EXACT_M) && poleStep <= CONT_L3_RADPS * (inp.dtS ?? 0);
      if (dp && pp && dt > 0 && !exactPlant) {
        const chosen = l;
        // the blended target, pushed out along the contact normals (and up off the floor) while it penetrates
        // plan 12 (a joint-range profile): a continuing plant's shown leg, its knee pole still blending in, keeps its sole
        // point on the anchor at the blended pole. With the shoe at the ankle range limit the foot turns with the shin
        // about that point (the heel lifts as the shin leans past the range), and the ankle moves with it as fast as the
        // shin turns; blended at the plant rate it would drag the sole point off its anchor (L3-F1-mirror0: D's toe, 1.2 cm)
        const pivot = !!inp.jointRange && fr?.kind === 'plant' && primaryAt && !rebased && chosen.rollF !== undefined && dist(dp, dc) <= CONT_PLANT_EXACT_M ? fr : null;
        const mpsL = inp.loco ? (fr?.kind === 'plant' ? CONT_L3_PLANT_MPS : CONT_L3_MPS) : CONT_LEG_MPS;
        // Rung 7b (physical legs, `legSweep`): an exact plant is shown where it stands, never pushed, so a body the legs
        // meet can come into it (L3-F4-gripOwner R: 5.9 mm, on a knee pole); the first step after it (the swing's start)
        // pushed the whole depth out at once (the ankle 1.3 cm, the shoe 2.0 cm in one substep with the rate step). The
        // leg held so (`${k}:mh`) moves at most at the plant rate from where it stands, push-out included, until it is
        // clear of the met bodies (PHYS_LEG_OK): it leaves the plant's own correction as a plant would make it. Fault:
        // PoseDebug.noHeldMetExit
        const heldMet = sweep && physMet && mem[`${k}:mh`] === 1 && !inp.debug?.noHeldMetExit;
        // the step toward a placement (its departure `dcT`, pole `pcT`, candidate `ch`, plant pivot `pv`) at blend `al`: the
        // chosen one, or (`legSweep`) another placement tried for a step that is not clear
        const atTo = (dcT: Vec3, pcT: Vec3, ch: LegC, pv: typeof pivot, al: number, deep = false): LegC & { good: boolean; rank: number } => {
          const extOk = Math.max(HARD_OK, ch.depth) + 1e-9;
          const floorOk = Math.max(CONT_FLOOR_OK, floorDepth(ch.shapes)) + 1e-9;
          const sol = legSolver(qRot(pose.q, towardDir(pp, pcT, al)));
          const t0 = pv ? plantIk(sol.solve, W(add(base, lerp(dp, dcT, al))), pv, ch.rollF!, ch.edgeX ?? 0) : W(add(base, lerp(dp, dcT, al)));
          let t = t0;
          let c = sol.solve(t);
          let de = extL(c.shapes);
          // physical legs: the depth in the bodies they meet, pushed out past PHYS_LEG_OK as well (to none)
          const metD = (x: LegC): number => (physMet ? metL(x.shapes) : 0);
          let dm = metD(c);
          // pushed toward validity (HARD_OK), also when no candidate is valid (tangled with another body)
          const G = deep ? inp.ragdoll.poseGuard : undefined;
          for (let i = 0; i < (G ? G.deepPushIterations : CONT_PUSH_IT) && (de > HARD_OK || c.depth > floorOk || dm > PHYS_LEG_OK) && inp.clearance?.push; i++) {
            // Correct only the excess depth: a full push at the validity threshold jumps by the whole tolerance.
            const tol = inp.loco ? HARD_OK - 0.001 : 0;
            const pv = physMet ? legs!.pushMet!(c.shapes, tol, 0) : legs ? legs.push(c.shapes, tol) : inp.clearance.push(c.shapes, tol);
            if (c.depth > floorOk) pv.y += inp.loco ? c.depth - floorOk + 0.001 : c.depth;
            const m = len(pv);
            if (m < 1e-6) break;
            t = add(t0, clampLen(sub(addScaled(t, pv, inp.loco ? 1 : 1 + 0.001 / m), t0), G ? G.deepPushM : CONT_PUSH_MAX_M));
            c = sol.solve(t);
            de = extL(c.shapes);
            dm = metD(c);
          }
          // rung 7b: a leg leaving a held plant in a met body moves at most the plant rate from where it stands, its
          // push-out included
          if (heldMet) {
            const s0 = W(add(base, dp));
            const cap = (inp.loco ? CONT_L3_PLANT_MPS : CONT_LEG_MPS) * dt;
            if (dist(t, s0) > cap + 1e-9) {
              t = add(s0, clampLen(sub(t, s0), cap));
              c = sol.solve(t);
              de = extL(c.shapes);
            }
          }
          return { ...c, depth: de, soft: softExt(c.shapes), req: t, ik: ch.ik, rollF: ch.rollF, edgeX: ch.edgeX, good: de <= extOk && c.depth <= floorOk, rank: Math.max(de, c.depth) };
        };
        const at = (al: number, deep = false): ReturnType<typeof atTo> => atTo(dc, pc, chosen, pivot, al, deep);
        const guard = inp.handoffPossible !== false;
        const memo = new Map<number, ReturnType<typeof at>>();
        const atM = (x: number): ReturnType<typeof at> => {
          let c = memo.get(x);
          if (!c) memo.set(x, (c = at(x)));
          return c;
        };
        const radL = inp.loco ? CONT_L3_RADPS : CONT_POLE_RADPS;
        const al = continuityAlpha(dp, pp, dc, pc, dt, mpsL, radL, (x) => {
          const c = atM(x);
          return { good: !guard || c.good, depth: c.rank };
        }, P);
        if (P?.on && P.contLast) P.cont[`${inp.playerId}:${k}`] = P.contLast;
        // plan 07a: a chosen candidate that itself penetrates another body (no clear variant: tangled) is shown pushed
        // out as well, also once the blend toward it is complete (HC-F2-lowCarrier: A's shoe stood 13 cm in B's head)
        // (physical legs: also a chosen candidate in a body they meet past PHYS_LEG_OK)
        const shownPushed = al < 1 || extL(chosen.shapes) > HARD_OK || (physMet && metL(chosen.shapes) > PHYS_LEG_OK);
        if (shownPushed) l = atM(al);
        // plan 10c (C6, RagdollProfile.poseGuard): a convertible player's shown leg still past HARD_OK after the ordinary
        // push (4 iterations: reversed HC-F2-bothFallL2, B's ragdoll forearm 8 cm into A's thigh, where moving the ankle
        // moves the thigh little) takes the longer push, within the same per-substep cap, so the published pose, and the
        // candidate built from it, stays valid
        if (inp.ragdoll.poseGuard && guard && shownPushed && l.depth > HARD_OK) {
          const dl = at(al, true);
          if (dl.rank < atM(al).rank) l = dl;
        }
        if (P?.trace) contDbg = { ...(P.contLast ?? { a0: al, dd: 0 }), al, push: dist(Lw(l.req!), add(base, lerp(dp, dc, al))) };
        let shownD = shownPushed ? sub(Lw(l.req!), base) : dc;
        let shownP = al < 1 ? towardDir(pp, pc, al) : pc;
        // Contact motion prerequisite (`legSweep`): the achieved step is what the next pose starts from and what a
        // conversion would start from, so it is judged itself, against the physical bodies where they stand and where the
        // 13f prediction puts them a substep on. (1) A shown leg still past HARD_OK after the guard tries the other
        // placements, the primary's other knee poles first (the ankle target kept), then the offsets: the same
        // rate-limited, pushed step from the shown pose toward each clear one; the first clear step wins and becomes the
        // chosen placement. (2) The step from the shown pose to the new one is swept, the ankle departure and knee pole
        // together in samples at most LEG_SWEEP_M apart, each solved from the hip where it is now (limb lengths and hip
        // attachment kept): a step that would pass through a body (a sample deeper than HARD_OK and both ends) stops at
        // its last clear sample.
        // Physical legs (`legs.met`, rung 6): a step may also not take a body the legs meet in the solve past the larger of
        // PHYS_LEG_OK and its depth at the step's start (`metBad`). The step starts from the last shown leg carried with
        // the body (`${k}:q`: its shown ankle request, body frame): the request base moves with the step, so the last
        // departure from it is not where the leg stands, and a stop there would carry the leg on. The sweep checks its end
        // too, however short the step. A step that only takes a met body deeper is held by the sweep, and tries other
        // placements (the primary's other knee poles only, the ankle target kept) only when the sweep cannot start (its
        // first sample already deeper), so it is not held where it stands for as long as the bodies stay
        if (sweep && guard) {
          const qPrev = physMet ? memVec(mem, `${k}:q`) : null;
          const d0 = qPrev ? sub(qPrev, base) : dp;
          const sampleAt = (f: number): LegC => {
            const req = W(add(base, lerp(d0, shownD, f)));
            const c = legSolver(qRot(pose.q, towardDir(pp, shownP, f))).solve(req);
            return { ...c, depth: extL(c.shapes), req };
          };
          // (the start is solved when first read: without physical legs, after the placements are tried, as rung 5 had it)
          let startC: LegC | null = null;
          const startOf = (): LegC => (startC ??= sampleAt(0));
          const metBad = (x: LegC): boolean => physMet && metL(x.shapes) > Math.max(PHYS_LEG_OK, metL(startOf().shapes)) + 1e-4;
          const bad = (x: LegC): boolean => physL(x.shapes) > HARD_OK + 1e-9 || metBad(x);
          const hard = physL(l.shapes) > HARD_OK + 1e-9;
          // the sweep's sample count (from `d0`); physical legs: at least one, so the end is checked
          const steps = (): number => Math.ceil(Math.max(dist(d0, shownD), Math.acos(clamp(dot(norm(pp), norm(shownP)), -1, 1)) * R.lengths.thigh) / LEG_SWEEP_M);
          const stuck = (): boolean => {
            const ns = Math.max(1, steps());
            return metBad(legSolver(qRot(pose.q, towardDir(pp, shownP, 1 / ns))).solve(W(add(base, lerp(d0, shownD, 1 / ns)))));
          };
          if (hard || (physMet && metBad(l) && stuck())) {
            for (const j of [...kneePoles.map((_, i) => alts.length + i), ...(hard ? alts.keys() : [])]) {
              if (!bad(l)) break;
              if (j === r.index) continue;
              const cj = candAt(j)();
              if (!cj.req || !cj.pole || cj.depth > HARD_OK || bad(cj) || (j >= alts.length && ownCross(cj))) continue;
              const dcj = sub(Lw(cj.req), base);
              const pcj = qInvRot(pose.q, cj.pole);
              // a knee-pole placement of a continuing plant keeps its sole point on the anchor, as the primary does
              const pvj = j >= alts.length && !!inp.jointRange && fr?.kind === 'plant' && !rebased && cj.rollF !== undefined && dist(dp, dcj) <= CONT_PLANT_EXACT_M ? fr : null;
              const mj = new Map<number, ReturnType<typeof atTo>>();
              const atj = (x: number): ReturnType<typeof atTo> => {
                let c = mj.get(x);
                if (!c) mj.set(x, (c = atTo(dcj, pcj, cj, pvj, x)));
                return c;
              };
              const alj = continuityAlpha(dp, pp, dcj, pcj, dt, mpsL, radL, (x) => ({ good: atj(x).good, depth: atj(x).rank }));
              let sj = atj(alj);
              if (inp.ragdoll.poseGuard && sj.depth > HARD_OK) {
                const dl = atTo(dcj, pcj, cj, pvj, alj, true);
                if (dl.rank < sj.rank) sj = dl;
              }
              if (sj.good && !bad(sj)) {
                l = sj;
                mem[k] = j;
                shownD = sub(Lw(sj.req!), base);
                shownP = alj < 1 ? towardDir(pp, pcj, alj) : pcj;
              }
            }
          }
          const n0 = steps();
          const n = physMet ? Math.max(1, n0) : n0;
          // the last sample checked: the step's end too with physical legs
          const top = physMet ? n : n - 1;
          const start = startOf();
          if (n > 1 || (physMet && metBad(l))) {
            const ends = Math.max(HARD_OK, physL(start.shapes), physL(l.shapes)) + 1e-4;
            let last = 0;
            for (let i = 1; i <= top; i++) {
              const smpI = sampleAt(i / n);
              if (physL(smpI.shapes) > ends || metBad(smpI)) break;
              last = i;
            }
            if (last < top) {
              const f = last / n;
              l = { ...sampleAt(f), ik: l.ik };
              shownD = lerp(d0, shownD, f);
              shownP = towardDir(pp, shownP, f);
            }
          }
          ok = !bad(l) || (physL(l.shapes) <= Math.max(HARD_OK, physL(start.shapes)) + 1e-4 && !metBad(l));
        }
        // the shown target (with its push-out) is the next pose's start: each step then only needs a shallow push
        setMemVec(mem, `${k}:d`, shownD);
        setMemVec(mem, `${k}:p`, shownP);
      } else {
        setMemVec(mem, `${k}:d`, dc);
        setMemVec(mem, `${k}:p`, pc);
      }
    }
    // rung 7b: a shown leg held exactly at its plant inside a met body (no step: never pushed) is marked; the mark goes
    // once the shown leg is clear of the met bodies
    if (kneePoles.length && physMet && metL(l.shapes) > PHYS_LEG_OK) {
      if (l === r.best && fr?.kind === 'plant') mem[`${k}:mh`] = 1;
    } else if (mem[`${k}:mh`] !== undefined) delete mem[`${k}:mh`];
    // physical legs: the shown leg's ankle request (body frame), the next step's start; kept only while they are live
    if (kneePoles.length && physMet) setMemVec(mem, `${k}:q`, Lw(l.req ?? W(base)));
    else if (mem[`${k}:q:x`] !== undefined) for (const a of ['x', 'y', 'z']) delete mem[`${k}:q:${a}`];
    return { r, l, contDbg, ok, keptOn: fr?.kind === 'plant' ? plantKept(l, fr) : true };
    };
    // Rung 7 (`legSweep`): a plant whose ordinary choice gives up the primary placement (no valid primary: an offset
    // leaves the anchor and footwork releases the plant) tries the primary at the other knee poles first, the foot kept
    // on its anchor: the first valid one (sticky, as the ordinary choice). Physical legs: also a plant whose primary leg
    // is in a body the legs meet past PHYS_LEG_OK, the first knee pole clear of the met bodies. That step is taken only
    // when it is clear (`ok`) and keeps the plant within the footwork tolerance (`keptOn`); otherwise the pose memory is
    // put back and the ordinary choice runs, offsets included (with no valid planted pose footwork releases the plant)
    let res: ReturnType<typeof legStep> | null = null;
    const metHit = physMet && kneePoles.length > 0 && fr?.kind === 'plant' && metL(cands[0]().shapes) > PHYS_LEG_OK;
    const onPole = prevV !== undefined && prevV >= alts.length;
    if (kneePoles.length && fr?.kind === 'plant' && !rebased && !inp.debug?.noPlantedPole && (ordinaryR.index !== 0 || metHit || onPole) && (prevV === undefined || prevV === 0 || onPole)) {
      // ladder 11c: a knee pole crossing the other leg reads as no valid placement (never taken)
      const keep = [cands[0], ...poleCands.map((f) => (otherAx ? once((): LegC => (ownCross(f()) ? { ...f(), depth: Infinity } : f())) : f))];
      // A knee pole is kept while valid; the primary wins back once it is fully clear (and clear of the met bodies) at its
      // own knee. Every placement is solved with its knee turned from the shown knee by at most the continuity bound, so
      // at a knee pole the primary reads clear long before its knee is back where it is obstructed: judged that way it
      // won back, its knee turned back into the body, and the leg went to and fro between the two at the pole rate
      const own = onPole ? primaryOwn() : null;
      const back = !!own && own.depth <= CLEAR_OK && own.soft <= CLEAR_OK && (!physMet || metL(own.shapes) <= PHYS_LEG_OK);
      const prevK = prevV === undefined ? undefined : prevV === 0 || back ? 0 : prevV - alts.length + 1;
      let rk: { best: LegC; index: number } | null = null;
      if (ordinaryR.index !== 0 || (onPole && !metHit)) rk = pick(keep, prevK, !onPole || back, true);
      else
        for (const i of [...(prevK ? [prevK] : []), ...keep.keys()]) {
          const c = keep[i]();
          if (c.depth <= HARD_OK && metL(c.shapes) <= PHYS_LEG_OK) {
            rk = { best: c, index: i };
            break;
          }
        }
      if (rk && rk.index !== 0 && rk.best.depth <= HARD_OK) {
        const saved = { ...mem };
        const tr = legStep({ best: rk.best, index: alts.length + rk.index - 1 });
        if (tr.ok && tr.keptOn) res = tr;
        else {
          for (const key of Object.keys(mem)) if (!(key in saved)) delete mem[key];
          Object.assign(mem, saved);
        }
      }
    }
    res ??= legStep(ordinaryR);
    const { r, l, contDbg } = res;
    if (P?.trace) P.trace(`${inp.playerId}:${k}`, { cont: contDbg, v: r.index, base, dc: l.req ? sub(Lw(r.best.req!), base) : null, shown: l.req ? sub(Lw(l.req), base) : null, ankle: Lw(l.ankle), knee: Lw(l.knee), poleC: r.best.pole ? qInvRot(pose.q, r.best.pole) : null, pole: l.pole ? qInvRot(pose.q, l.pole) : null, fb: l.chain.fallback, chosenAnkle: Lw(r.best.ankle), depth: l.depth, chosenDepth: r.best.depth });
    if (sl || gr) targetResidualM[k] = dist(l.ankle, l.req ?? W(base));
    lm[`${s}Hip`] = hip;
    lm[`${s}Knee`] = l.knee;
    if (gr) {
      setMemVec(mem, `${s}Leg:e`, qInvRot(pose.q, sub(l.knee, pose.p)));
      setMemVec(mem, `${s}Leg:r`, qInvRot(pose.q, l.held ?? norm(sub(l.ankle, hip))));
      mem[`${s}Leg:reachLimited`] = l.reachLimited ? 1 : 0;
      // ladder 11c: the shown ankle and shoe, for the other leg's next pose
      if (inp.legOwn && sweep) {
        setMemVec(mem, `${s}Leg:an`, qInvRot(pose.q, sub(l.ankle, pose.p)));
        setMemVec(mem, `${s}Leg:sf`, qInvRot(pose.q, sub((l.shapes[2] as Extract<PoseShape, { kind: 'box' }>).c, pose.p)));
      }
      // ladder 11b: the shown thigh rotation is the next pose's start
      if (HT) {
        const hr = armTwistRad(HT.envelope, pose.q, hip, l.knee, l.ankle, sx);
        if (hr !== null) mem[`${s}Leg:hr`] = hr;
        mem[`${s}Leg:hrHeld`] = l.hipHeld ? 1 : 0;
      }
    }
    lm[`${s}Ankle`] = l.ankle;
    const shoe = l.shapes[2] as Extract<PoseShape, { kind: 'box' }>;
    lm[`${s}Shoe`] = shoe.c;
    segs[`${s}Thigh` as SegmentId] = { segmentId: `${s}Thigh` as SegmentId, originWorld: hip, rotationWorld: l.chain.frameA };
    segs[`${s}Shin` as SegmentId] = { segmentId: `${s}Shin` as SegmentId, originWorld: l.knee, rotationWorld: l.chain.frameB };
    hingeDeg[`${s}Knee`] = (l.chain.angleRad * 180) / Math.PI;
    if (l.chain.fallback) straightFallback.push(`${s}Knee`);
    limbClearance[`${s}Leg`] = l.depth;
    if (sl || gr) anklePitchDeg[s] = (l.pitch * 180) / Math.PI;
    if (inp.feet) legInfo[s] = { variant: r.index >= alts.length ? 0 : r.index, request: l.req ?? W(base), liftM: l.ik && l.req ? dist(l.req, l.ik) : 0, ...(JA && l.ik && l.req && l.pitch <= -dorsi + 1e-6 ? { rangeLiftM: Math.max(0, l.req.y - l.ik.y) } : {}), softM: l.softM, soleBase: sl ? (fr?.soleW ?? 1) * smp!.weight * sl.footPitch : 0, soleAngle: l.soleAngle, ...(l.rollF !== undefined ? { rollF: l.rollF, edgeX: l.edgeX ?? 0 } : {}) };
  }
  const out: PhysicalPose = { playerId: inp.playerId, segments: segs, jointLandmarksWorld: lm, hingeDeg, straightFallback, limbClearance };
  if (seat) out.carry = seat;
  if (smp || gr) {
    out.targetResidualM = targetResidualM;
    out.anklePitchDeg = anklePitchDeg;
  }
  if (inp.feet) out.legInfo = legInfo;
  return out;
}
