// Simulation-owned physical pose: explicit joint landmarks and segment frames generated from the solved core,
// the achieved arms (Gate 2) and a bounded procedural leg/arm pose. Presentation maps this; it never feeds forces.
// Gate 4: the same frames become the ragdoll body frames at a handoff, so the pose and the candidate agree.
//
// Limb frame convention (shared with the ragdoll): origin at the proximal joint, local +Y toward the proximal joint
// (the limb extends along -Y), local X = the elbow/knee hinge axis, Z = X x Y. The hinge angle about X from the
// proximal to the distal frame is zero for a straight limb and positive in flexion.
import type { ArmSide, SegmentId } from './contracts';
import type { SampledLimbs } from './run-clip';
import { hipLocal, shoulderLocal, sideSignX, type BodyProfile, type RagdollProfile } from './profiles';
import {
  add, addScaled, clamp, clampLen, cross, dist, dot, len, lerp, neg, norm, qFromAxisAngle, qFromBasis, qInvRot, qMul, qRot, scale, sub, toWorld, upOf, v3,
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
   * clamp of the request (m, the part of the residual reach clamping explains).
   */
  legInfo?: Partial<Record<ArmSide, { variant: number; request: Vec3; liftM: number; softM: number; rollF?: number; edgeX?: number }>>;
}

/**
 * Plan 07 foot request of one leg (footwork.ts), solved through the existing leg path (soft reach, two-bone, hinge frames,
 * ankle pitch, floor lift, clearance alternatives):
 * - `plant`: a world-anchored contact feature. The sole point `toeZ * rollF` ahead of the heel (the sole point below the
 *   ankle) along the planted heading lies on the anchor; the ankle is solved for it with the shoe at its solved pitch.
 * - `target`: a planner swing ankle target (world) with the foot heading (knee pole).
 * - `offset`: the ordinary procedural / clip request shifted by a world offset (a released foot rejoining it).
 */
export type FootRequest =
  | { kind: 'plant'; heelW: Vec3; headingRad: number; rollF: number; toeZ: number; edgeX?: number }
  | { kind: 'target'; ankleW: Vec3; headingRad: number }
  | { kind: 'offset'; offsetW: Vec3 };

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

/** Max penetration depth (m, >= 0) of `shapes` against external obstacles; `self` = own core (forearm/palm only). */
/**
 * Supported-state clearance queries. `external` is physical: other players' active colliders and obstacles (what
 * candidate validation checks). `soft` covers geometry that is not a collider but should not be visibly crossed
 * (opponents' query arms); `self` is the limb against the player's own torso/pelvis.
 */
export interface PoseClearance {
  external(shapes: PoseShape[]): number;
  soft?(shapes: PoseShape[]): number;
  self?(shapes: PoseShape[]): number;
  /**
   * Plan 07: the separating move (world, m) for shapes penetrating the external shapes: per pose shape its deepest
   * contact's outward normal times the depth, summed. Zero when clear.
   */
  push?(shapes: PoseShape[]): Vec3;
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

export function legShapes(R: RagdollProfile, s: string, hip: Vec3, knee: Vec3, ankle: Vec3, shinFrame: Quat, footQ: Quat = shinFrame): PoseShape[] {
  return [
    fittedCapsule(hip, knee, R.radii.thigh, `${s}Thigh`),
    fittedCapsule(knee, ankle, R.radii.shin, `${s}Shin`),
    { kind: 'box', c: toWorld({ p: ankle, q: footQ }, v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM)), q: footQ, he: R.shoe.halfExtents, key: `${s}Shoe` },
  ];
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
  return proceduralLocal(body, 'right', v3(0.13 * sideSignX(body, 'right'), 0.24, 0.24));
}

export function pelvisMidLocal(body: BodyProfile): Vec3 {
  return body.measured ? { ...body.measured.pelvisMid } : { ...AUTHORED_PELVIS_MID };
}

/** Default procedural arm palm in body-local coordinates: carry (ball arm), ready hands or a running swing. */
export function proceduralArmTargetLocal(s: ArmSide, inp: ProxyPoseInput): Vec3 {
  const body = inp.body;
  const sx = sideSignX(body, s);
  if (inp.carriesBall && s === 'right') return carryPalmLocal(body);
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
const CONT_LEG_MPS = 2.5;
const CONT_ARM_MPS = 3.0;
const CONT_POLE_RADPS = 8;
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
 * A primary planted foot within this distance (m) of the shown departure is shown exactly (the plant must hold its
 * anchor within the 0.01 m drift contract; touchdown corrections are a few cm). Farther: it blends like any switch.
 */
const CONT_PLANT_EXACT_M = 0.05;
/** Accept a procedural variant at or below this depth (m); validation tolerance is 0.015 m. */
const CLEAR_OK = 0.004;
/** Physical depth a candidate may have and still count as valid for the handoff (margin under 0.015 m). */
const HARD_OK = 0.012;

/** Probe-only switch: when `on`, buildProxyPose records every evaluated limb candidate's depth and worst shape. */
export const POSE_DEBUG: {
  on: boolean;
  last: Record<string, { i: number; depth: number; soft: number }[]>;
  legs: Record<string, { request: Vec3; ik: Vec3; lifted: Vec3; floorLeft: number }>;
  /** Plan 07 continuity: per limb the rate-limited fraction, the shown fraction and the departure change (m). */
  cont: Record<string, { a0: number; al: number; dd: number }>;
  contLast: { a0: number; al: number; dd: number } | null;
  /** Probe-only: true disables the plan 07 limb continuity (as with dtS 0), for A/B comparison. */
  noContinuity?: boolean;
  /** Per-call leg trace (body frame): request, chosen and shown departures, shown ankle and knee, variant. */
  trace?: (key: string, r: Record<string, unknown>) => void;
} = { on: false, last: {}, legs: {}, cont: {}, contLast: null };

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
 * previous shown state (`dp`, `pp`): the rate-limited fraction, advanced (bisection) to the smallest fraction whose pose
 * is valid when the rate-limited one is not. `ok(alpha)` builds and checks the pose at that fraction.
 */
function continuityAlpha(dp: Vec3, pp: Vec3, dc: Vec3, pc: Vec3, dt: number, mps: number, ok: (alpha: number) => boolean): number {
  const dd = dist(dp, dc);
  const ang = Math.acos(clamp(dot(norm(pp, pc), norm(pc, pp)), -1, 1));
  const a0 = Math.min(1, dd > 1e-9 ? (mps * dt) / dd : 1, ang > 1e-9 ? (CONT_POLE_RADPS * dt) / ang : 1);
  if (POSE_DEBUG.on) POSE_DEBUG.contLast = { a0, al: a0, dd };
  if (a0 >= 1 || ok(a0)) return a0;
  let lo = a0;
  let hi = 1;
  for (let i = 0; i < 6; i++) {
    const m = 0.5 * (lo + hi);
    if (ok(m)) hi = m;
    else lo = m;
  }
  if (POSE_DEBUG.on) POSE_DEBUG.contLast = { a0, al: hi, dd };
  return hi;
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
    const st = (s === 'left' ? 0.5 : -0.5) * gr.staggerM * (1 - Math.min(1, inp.speed / 1.5));
    const aw = v3(hipW.x + gx.x + fwdH.x * st, gr.y + soleH + lift * swing, hipW.z + gx.z + fwdH.z * st);
    proc = qInvRot(pose.q, sub(aw, pose.p));
  }
  const sl = inp.sampled ? inp.sampled.legs[s] : null;
  return sl ? lerp(proc, sl.ankleLocal, clamp(inp.sampled!.weight, 0, 1)) : proc;
}

export function buildProxyPose(inp: ProxyPoseInput): PhysicalPose {
  const { body, pose } = inp;
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
  segs.head = { segmentId: 'head', originWorld: lm.neck, rotationWorld: { ...pose.q } };
  // flexion-bounded reach of every generated limb (the joint limits the candidate is validated against)
  const elbowMin = flexReach(R.lengths.upperArm, R.lengths.forearm + R.lengths.palmExtension, maxFlexRad(R, 'elbow'));
  const kneeMin = flexReach(R.lengths.thigh, R.lengths.shin, maxFlexRad(R, 'knee'));
  const gr0 = !!inp.ground;
  // ---------------- arms
  for (const s of ['left', 'right'] as ArmSide[]) {
    const sx = sideSignX(body, s);
    const sh = W(shoulderLocal(body, s));
    const given = inp.arms?.[s];
    /** `softOther`: soft overlap without the self (own torso/pelvis) term. */
    type ArmC = { elbow: Vec3; wrist: Vec3; palm: Vec3; chain: HingeChain; shapes: PoseShape[]; depth: number; soft: number; softOther: number; tgtL?: Vec3; poleL?: Vec3 };
    const build = (elbow: Vec3, palm: Vec3, wristIn?: Vec3): ArmC => {
      const wrist0 = wristIn ?? add(elbow, scale(sub(palm, elbow), R.lengths.forearm / (R.lengths.forearm + R.lengths.palmExtension)));
      const chain = hingeChain(sh, elbow, [wrist0, palm], [fwd, upB], straight);
      const [wrist, palmS] = chain.ends;
      const shapes = armShapes(R, s, sh, elbow, wrist, palmS);
      const selfD = inp.clearance?.self ? inp.clearance.self(shapes.slice(1)) : 0;
      const so = softExt(shapes);
      return { elbow, wrist, palm: palmS, chain, shapes, depth: Math.max(ext(shapes), floorDepth(shapes)), soft: Math.max(so, 0.5 * selfD), softOther: so };
    };
    let a: ArmC;
    if (given) {
      a = build(given.elbow, given.palm, given.wrist);
      // an achieved arm owns the pose: a later procedural pose starts from its own chosen candidate
      for (const q of ['d', 'p', 'b']) for (const c of ['x', 'y', 'z']) delete mem[`${s}Arm:${q}:${c}`];
    }
    else {
      const procedural = (palmL: Vec3, poleL: Vec3) => (): ArmC => {
        const r = twoBone(sh, W(palmL), R.lengths.upperArm, R.lengths.forearm + R.lengths.palmExtension, qRot(pose.q, poleL), undefined, elbowMin);
        return { ...build(r.mid, r.end), tgtL: palmL, poleL };
      };
      let palm0 = proceduralArmTargetLocal(s, inp);
      let pole0 = v3(0.6 * sx, -0.5, -0.6);
      const k = `${s}Arm`;
      // run-clip arms: a free arm takes the clip swing; the carry arm holds the ball beside the chest (CLIP_CARRY) and
      // adds a share of the clip hand's excursion (the ball stays in that hand); ready hands keep their procedural
      // assignment. The blend starts from the pose the procedural path showed (its last chosen variant, kept while
      // the clip is off), so the clip fades in without a jump.
      const carry = !!inp.carriesBall && s === 'right';
      const sw = smp?.arms && !inp.readyHands ? smp.arms[s] : null;
      const sampledArm = !!sw && smp!.weight > 0 && (!carry || smp!.carrySwing > 0);
      if (sw && sampledArm) {
        const from = mem[`${k}Proc`] ?? 0;
        const alt = from > 0 ? ARM_ALTS(sx)[from - 1] : null;
        const fromPalm = alt ? proceduralLocal(body, s, alt.palm) : palm0;
        const fromPole = alt ? alt.pole : pole0;
        const toPalm = carry ? addScaled(proceduralLocal(body, s, v3(CLIP_CARRY.x * sx, CLIP_CARRY.y, CLIP_CARRY.z)), sw.swingLocal, smp!.carrySwing) : sw.palmLocal;
        const toPole = carry ? pole0 : sw.poleLocal;
        palm0 = toward(fromPalm, toPalm, smp!.weight);
        pole0 = towardDir(fromPole, toPole, smp!.weight);
      }
      const cands = [procedural(palm0, pole0), ...ARM_ALTS(sx).map((c) => procedural(proceduralLocal(body, s, c.palm), c.pole))];
      if (POSE_DEBUG.on) POSE_DEBUG.last[`${inp.playerId}:${k}`] = cands.map((c, i) => { const r = c(); return { i, depth: r.depth, soft: r.soft }; });
      // a sampled arm that crosses another body moves away from the body (horizontal, radially from the body axis: a
      // continuous direction) by the smallest clearing distance (bracketed, then bisected), so the correction changes
      // continuously with the clip; only when nothing within SWING_OUT_MAX clears does it fall back to the
      // alternatives. Its own torso is not a constraint: the clips were authored on this skeleton, the proxy capsules
      // are padded, and the ragdoll has no self-collision.
      let r: { best: ArmC; index: number } | null = null;
      if (sampledArm) {
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
      r ??= pick(cands, mem[k], sampledArm, gr0);
      mem[k] = r.index;
      if (!sampledArm) mem[`${k}Proc`] = r.index;
      a = r.best;
      // plan 07 continuity (ground-relative poses): the palm target's departure from the ordinary request and the elbow
      // pole move toward the chosen candidate at a bounded rate
      if (gr0) {
        const dc = sub(a.tgtL!, palm0);
        const pc = norm(a.poleL!, pole0);
        const dt = POSE_DEBUG.noContinuity ? 0 : (inp.dtS ?? 0);
        const dp = contPrev(mem, k, palm0, dt);
        const pp = memVec(mem, `${k}:p`);
        if (dp && pp && dt > 0) {
          const chosen = a;
          const extOk = Math.max(HARD_OK, chosen.depth) + 1e-9;
          // the blended palm target, pushed out along the contact normals while it penetrates
          const at = (al: number): ArmC => {
            const t0 = add(palm0, lerp(dp, dc, al));
            let t = t0;
            const pole = towardDir(pp, pc, al);
            let c = procedural(t, pole)();
            // pushed toward validity (HARD_OK), also when no candidate is valid (tangled with another body)
            for (let i = 0; i < CONT_PUSH_IT && c.depth > HARD_OK && inp.clearance?.push; i++) {
              const pv = qInvRot(pose.q, inp.clearance.push(c.shapes));
              const m = len(pv);
              if (m < 1e-6) break;
              t = add(t0, clampLen(sub(addScaled(t, pv, 1 + 0.001 / m), t0), CONT_PUSH_MAX_M));
              c = procedural(t, pole)();
            }
            return c;
          };
          let shown: ArmC | null = null;
          const guard = inp.handoffPossible !== false;
          const al = continuityAlpha(dp, pp, dc, pc, dt, CONT_ARM_MPS, (x) => {
            const c = at(x);
            const good = !guard || c.depth <= extOk;
            if (good) shown = c;
            return good;
          });
          if (POSE_DEBUG.on && POSE_DEBUG.contLast) POSE_DEBUG.cont[`${inp.playerId}:${k}`] = POSE_DEBUG.contLast;
          if (al < 1) a = shown ?? at(al);
          // the shown target (with its push-out) is the next pose's start: each step then only needs a shallow push
          setMemVec(mem, `${k}:d`, al < 1 ? sub(a.tgtL!, palm0) : dc);
          setMemVec(mem, `${k}:p`, al < 1 ? towardDir(pp, pc, al) : pc);
        } else {
          setMemVec(mem, `${k}:d`, dc);
          setMemVec(mem, `${k}:p`, pc);
        }
      }
      if (POSE_DEBUG.trace) POSE_DEBUG.trace(`${inp.playerId}:${k}`, { v: r.index, sampled: sampledArm, palm0, dc: sub(r.best.tgtL!, palm0), shown: a.tgtL ? sub(a.tgtL, palm0) : null, poleC: r.best.poleL, pole: a.poleL, elbow: qInvRot(pose.q, sub(a.elbow, pose.p)), wrist: qInvRot(pose.q, sub(a.wrist, pose.p)), fb: a.chain.fallback, depth: a.depth });
      if (sampledArm) targetResidualM[k] = dist(a.palm, W(palm0));
    }
    const pre = s;
    lm[`${pre}Shoulder`] = sh;
    lm[`${pre}Elbow`] = a.elbow;
    lm[`${pre}Wrist`] = a.wrist;
    lm[`${pre}Palm`] = a.palm;
    lm[`${pre}Hand`] = addScaled(a.palm, norm(sub(a.palm, a.wrist), v3(0, -1, 0)), -R.radii.palm);
    segs[`${pre}UpperArm` as SegmentId] = { segmentId: `${pre}UpperArm` as SegmentId, originWorld: sh, rotationWorld: a.chain.frameA };
    segs[`${pre}Forearm` as SegmentId] = { segmentId: `${pre}Forearm` as SegmentId, originWorld: a.elbow, rotationWorld: a.chain.frameB };
    hingeDeg[`${pre}Elbow`] = (a.chain.angleRad * 180) / Math.PI;
    if (a.chain.fallback) straightFallback.push(`${pre}Elbow`);
    limbClearance[`${pre}Arm`] = a.depth;
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
    const frPole = fr && fr.kind !== 'offset' ? v3(Math.sin(fr.headingRad), 0.2, Math.cos(fr.headingRad)) : null;
    const hip = W(hipL);
    type LegC = { knee: Vec3; ankle: Vec3; chain: HingeChain; shapes: PoseShape[]; depth: number; soft: number; req?: Vec3; ik?: Vec3; softM: number; pitch: number; rollF?: number; edgeX?: number; pole?: Vec3 };
    // Sampled / ground-relative leg solve for a knee pole: soft reach (the target eases in below the reach limit, which
    // keeps a minimum knee flexion, so the knee never snaps straight and its hinge axis never flips) and the clip's foot
    // pitch at the ankle (the shoe keeps the clip foot's angle to the floor within the ankle range, so a planted foot
    // stays flat while the shin leans). `depth` here is the floor depth.
    const legSolver = (pole: Vec3) => {
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
        const r = twoBone(hip, soft(t), a, b, pole, reach, kneeMin);
        const chain = hingeChain(hip, r.mid, [r.end], [neg(fwd), neg(upB)], straight);
        const ankle = chain.ends[0];
        // pitch about the shin hinge axis that gives the shoe the clip foot's sagittal angle (toe up positive)
        const zw = qRot(chain.frameB, v3(0, 0, 1));
        // legacy: the clip foot angle at the clip weight (rigid shoe at weight 0); ground-relative legs: the shoe keeps
        // the blended foot angle (clip at its weight, flat on the ground otherwise) at full ankle authority
        const wc = sl ? smp!.weight : 0;
        const want = Math.atan2(zw.y, dot(zw, hdir)) - (gr ? wc * (sl?.footPitch ?? 0) : sl!.footPitch);
        const pitch = (gr ? 1 : wc) * clamp(Math.atan2(Math.sin(want), Math.cos(want)), -(gr ? ANKLE_DORSI : ANKLE_DORSI_LEGACY), ANKLE_PLANTAR);
        const shapes = legShapes(R, s, hip, r.mid, ankle, chain.frameB, pitchShin(chain.frameB, pitch));
        return { knee: r.mid, ankle, chain, shapes, depth: floorDepth(shapes), soft: 0, softM: dist(t, soft(t)), pitch, pole };
      };
      return { solve, hdir };
    };
    const variant = (o: Vec3, poleL: Vec3) => (): LegC => {
      let target = W(add(base, o));
      const primary = len(o) < 1e-9;
      const pole = frPole && primary ? frPole : qRot(pose.q, sl ? towardDir(poleL, sl.poleLocal, smp!.weight) : poleL);
      if (sl || gr) {
        // Sampled legs, all continuous in the clip phase (no searches or switches): the solve above, stance foot IK, then
        // a fixed-point floor lift for what is left (a pitch at the ankle range limit, a blend toward the procedural gait).
        const { solve, hdir } = legSolver(pole);
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
          const dir = v3(Math.sin(fr.headingRad), 0, Math.cos(fr.headingRad));
          const lat = v3(Math.cos(fr.headingRad), 0, -Math.sin(fr.headingRad));
          const ikAt = (rf: number, ex: number): Vec3 => {
            const feature = addScaled(addScaled(fr.heelW, dir, fr.toeZ * rf), lat, ex);
            const soleFoot = v3(ex, -soleUp, fr.toeZ * rf);
            let p = target;
            for (let i = 0; i < 4; i++) {
              const c0 = solve(p);
              p = sub(feature, qRot(pitchShin(c0.chain.frameB, c0.pitch), soleFoot));
            }
            return p;
          };
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
        if (POSE_DEBUG.on && len(o) < 1e-9) POSE_DEBUG.legs[`${inp.playerId}:${s}`] = { request: W(base), ik, lifted: target, floorLeft: c.depth };
        // floor depth left after the lift is a presentation residual, not a reason to switch variants
        c.depth = ext(c.shapes);
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
      c!.depth = Math.max(c!.depth, ext(c!.shapes));
      c!.soft = softExt(c!.shapes);
      return c!;
    };
    const k = `${s}Leg`;
    const r = pick(LEG_ALTS(sx).map((v) => variant(v.off, v.pole)), mem[k], !!sl || !!gr, !!gr);
    mem[k] = r.index;
    let l = r.best;
    // plan 07 continuity (ground-relative legs): the ankle target's departure from the ordinary request (variant offset,
    // plant correction, floor lift) and the knee pole move toward the chosen candidate at a bounded rate
    if (gr && l.req && l.pole) {
      const dc = sub(Lw(l.req), base);
      const pc = qInvRot(pose.q, l.pole);
      const dt = POSE_DEBUG.noContinuity ? 0 : (inp.dtS ?? 0);
      const dp = contPrev(mem, k, base, dt);
      const pp = memVec(mem, `${k}:p`);
      const exactPlant = fr?.kind === 'plant' && r.index === 0 && !!dp && dist(dp, dc) <= CONT_PLANT_EXACT_M;
      if (dp && pp && dt > 0 && !exactPlant) {
        const chosen = l;
        const floorC = floorDepth(chosen.shapes);
        const extOk = Math.max(HARD_OK, chosen.depth) + 1e-9;
        const floorOk = Math.max(CONT_FLOOR_OK, floorC) + 1e-9;
        // the blended target, pushed out along the contact normals (and up off the floor) while it penetrates
        const at = (al: number): LegC & { good: boolean } => {
          const t0 = W(add(base, lerp(dp, dc, al)));
          let t = t0;
          const sol = legSolver(qRot(pose.q, towardDir(pp, pc, al)));
          let c = sol.solve(t);
          let de = ext(c.shapes);
          // pushed toward validity (HARD_OK), also when no candidate is valid (tangled with another body)
          for (let i = 0; i < CONT_PUSH_IT && (de > HARD_OK || c.depth > floorOk) && inp.clearance?.push; i++) {
            const pv = inp.clearance.push(c.shapes);
            if (c.depth > floorOk) pv.y += c.depth;
            const m = len(pv);
            if (m < 1e-6) break;
            t = add(t0, clampLen(sub(addScaled(t, pv, 1 + 0.001 / m), t0), CONT_PUSH_MAX_M));
            c = sol.solve(t);
            de = ext(c.shapes);
          }
          return { ...c, depth: de, soft: softExt(c.shapes), req: t, ik: chosen.ik, rollF: chosen.rollF, edgeX: chosen.edgeX, good: de <= extOk && c.depth <= floorOk };
        };
        let shown: LegC | null = null;
        const guard = inp.handoffPossible !== false;
        const al = continuityAlpha(dp, pp, dc, pc, dt, CONT_LEG_MPS, (x) => {
          const c = at(x);
          const good = !guard || c.good;
          if (good) shown = c;
          return good;
        });
        if (POSE_DEBUG.on && POSE_DEBUG.contLast) POSE_DEBUG.cont[`${inp.playerId}:${k}`] = POSE_DEBUG.contLast;
        if (al < 1) l = shown ?? at(al);
        // the shown target (with its push-out) is the next pose's start: each step then only needs a shallow push
        setMemVec(mem, `${k}:d`, al < 1 ? sub(Lw(l.req!), base) : dc);
        setMemVec(mem, `${k}:p`, al < 1 ? towardDir(pp, pc, al) : pc);
      } else {
        setMemVec(mem, `${k}:d`, dc);
        setMemVec(mem, `${k}:p`, pc);
      }
    }
    if (POSE_DEBUG.trace) POSE_DEBUG.trace(`${inp.playerId}:${k}`, { v: r.index, base, dc: l.req ? sub(Lw(r.best.req!), base) : null, shown: l.req ? sub(Lw(l.req), base) : null, ankle: Lw(l.ankle), knee: Lw(l.knee), poleC: r.best.pole ? qInvRot(pose.q, r.best.pole) : null, pole: l.pole ? qInvRot(pose.q, l.pole) : null, fb: l.chain.fallback, chosenAnkle: Lw(r.best.ankle), depth: l.depth, chosenDepth: r.best.depth });
    if (sl || gr) targetResidualM[k] = dist(l.ankle, l.req ?? W(base));
    lm[`${s}Hip`] = hip;
    lm[`${s}Knee`] = l.knee;
    lm[`${s}Ankle`] = l.ankle;
    const shoe = l.shapes[2] as Extract<PoseShape, { kind: 'box' }>;
    lm[`${s}Shoe`] = shoe.c;
    segs[`${s}Thigh` as SegmentId] = { segmentId: `${s}Thigh` as SegmentId, originWorld: hip, rotationWorld: l.chain.frameA };
    segs[`${s}Shin` as SegmentId] = { segmentId: `${s}Shin` as SegmentId, originWorld: l.knee, rotationWorld: l.chain.frameB };
    hingeDeg[`${s}Knee`] = (l.chain.angleRad * 180) / Math.PI;
    if (l.chain.fallback) straightFallback.push(`${s}Knee`);
    limbClearance[`${s}Leg`] = l.depth;
    if (sl || gr) anklePitchDeg[s] = (l.pitch * 180) / Math.PI;
    if (inp.feet) legInfo[s] = { variant: r.index, request: l.req ?? W(base), liftM: l.ik && l.req ? dist(l.req, l.ik) : 0, softM: l.softM, ...(l.rollF !== undefined ? { rollF: l.rollF, edgeX: l.edgeX ?? 0 } : {}) };
  }
  const out: PhysicalPose = { playerId: inp.playerId, segments: segs, jointLandmarksWorld: lm, hingeDeg, straightFallback, limbClearance };
  if (smp || gr) {
    out.targetResidualM = targetResidualM;
    out.anklePitchDeg = anklePitchDeg;
  }
  if (inp.feet) out.legInfo = legInfo;
  return out;
}
