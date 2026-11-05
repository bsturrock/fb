// Simulation-owned physical pose: explicit joint landmarks and segment frames generated from the solved core,
// the achieved arms (Gate 2) and a bounded procedural leg/arm pose. Presentation maps this; it never feeds forces.
// Gate 4: the same frames become the ragdoll body frames at a handoff, so the pose and the candidate agree.
//
// Limb frame convention (shared with the ragdoll): origin at the proximal joint, local +Y toward the proximal joint
// (the limb extends along -Y), local X = the elbow/knee hinge axis, Z = X x Y. The hinge angle about X from the
// proximal to the distal frame is zero for a straight limb and positive in flexion.
import type { ArmSide, SegmentId } from './contracts';
import { hipLocal, shoulderLocal, sideSignX, type BodyProfile, type RagdollProfile } from './profiles';
import {
  add, addScaled, clamp, cross, dot, len, neg, norm, qFromAxisAngle, qFromBasis, qMul, qRot, scale, sub, toWorld, upOf, v3,
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
 * [|a-b|+eps, a+b-eps]; `pole` is the preferred elbow/knee direction (projected perpendicular to the limb).
 */
export function twoBone(
  root: Vec3,
  target: Vec3,
  a: number,
  b: number,
  pole: Vec3,
  maxReach = a + b - 1e-4,
): { mid: Vec3; end: Vec3; reached: boolean } {
  const d0 = sub(target, root);
  const dl = len(d0);
  const dir = norm(d0, v3(0, -1, 0));
  const d = clamp(dl, Math.abs(a - b) + 1e-4, Math.min(maxReach, a + b - 1e-4));
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

export function legShapes(R: RagdollProfile, s: string, hip: Vec3, knee: Vec3, ankle: Vec3, shinFrame: Quat): PoseShape[] {
  return [
    fittedCapsule(hip, knee, R.radii.thigh, `${s}Thigh`),
    fittedCapsule(knee, ankle, R.radii.shin, `${s}Shin`),
    { kind: 'box', c: toWorld({ p: ankle, q: shinFrame }, v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM)), q: shinFrame, he: R.shoe.halfExtents, key: `${s}Shoe` },
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

/** Accept a procedural variant at or below this depth (m); validation tolerance is 0.015 m. */
const CLEAR_OK = 0.004;
/** Physical depth a candidate may have and still count as valid for the handoff (margin under 0.015 m). */
const HARD_OK = 0.012;

/** Probe-only switch: when `on`, buildProxyPose records every evaluated limb candidate's depth and worst shape. */
export const POSE_DEBUG: { on: boolean; last: Record<string, { i: number; depth: number; soft: number }[]> } = { on: false, last: {} };

/**
 * Choose a limb variant (sticky: the previous choice is tried first). Physical depth (`depth`) ranks first: a variant
 * is physically valid at <= HARD_OK. Among valid variants the first fully clear one (depth and `soft` <= CLEAR_OK)
 * wins, else the least soft overlap; with no valid variant, the least physical depth.
 */
function pick<T extends { depth: number; soft: number }>(cands: (() => T)[], prev: number | undefined): { best: T; index: number } {
  const order = prev !== undefined && prev < cands.length ? [prev, ...cands.keys()].filter((v, i, a) => a.indexOf(v) === i) : [...cands.keys()];
  let bestValid: { r: T; i: number } | null = null;
  let bestHard: { r: T; i: number } | null = null;
  for (const i of order) {
    const r = cands[i]();
    if (r.depth <= CLEAR_OK && r.soft <= CLEAR_OK) return { best: r, index: i };
    if (r.depth <= HARD_OK && (!bestValid || r.soft < bestValid.r.soft - 1e-6)) bestValid = { r, i };
    if (!bestHard || r.depth < bestHard.r.depth - 1e-6) bestHard = { r, i };
  }
  const b = bestValid ?? bestHard!;
  return { best: b.r, index: b.i };
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
  segs.core = { segmentId: 'core', originWorld: { ...pose.p }, rotationWorld: { ...pose.q } };
  lm.pelvisMid = W(pelvisMidLocal(body));
  lm.neck = W(body.neck);
  lm.headCenter = W(body.headCenter);
  segs.head = { segmentId: 'head', originWorld: lm.neck, rotationWorld: { ...pose.q } };
  // ---------------- arms
  for (const s of ['left', 'right'] as ArmSide[]) {
    const sx = sideSignX(body, s);
    const sh = W(shoulderLocal(body, s));
    const given = inp.arms?.[s];
    type ArmC = { elbow: Vec3; wrist: Vec3; palm: Vec3; chain: HingeChain; shapes: PoseShape[]; depth: number; soft: number };
    const build = (elbow: Vec3, palm: Vec3, wristIn?: Vec3): ArmC => {
      const wrist0 = wristIn ?? add(elbow, scale(sub(palm, elbow), R.lengths.forearm / (R.lengths.forearm + R.lengths.palmExtension)));
      const chain = hingeChain(sh, elbow, [wrist0, palm], [fwd, upB], straight);
      const [wrist, palmS] = chain.ends;
      const shapes = armShapes(R, s, sh, elbow, wrist, palmS);
      const selfD = inp.clearance?.self ? inp.clearance.self(shapes.slice(1)) : 0;
      return { elbow, wrist, palm: palmS, chain, shapes, depth: Math.max(ext(shapes), floorDepth(shapes)), soft: Math.max(softExt(shapes), 0.5 * selfD) };
    };
    let a: ArmC;
    if (given) a = build(given.elbow, given.palm, given.wrist);
    else {
      const procedural = (palmL: Vec3, poleL: Vec3) => (): ArmC => {
        const r = twoBone(sh, W(palmL), R.lengths.upperArm, R.lengths.forearm + R.lengths.palmExtension, qRot(pose.q, poleL));
        return build(r.mid, r.end);
      };
      const cands = [procedural(proceduralArmTargetLocal(s, inp), v3(0.6 * sx, -0.5, -0.6)), ...ARM_ALTS(sx).map((c) => procedural(proceduralLocal(body, s, c.palm), c.pole))];
      const k = `${s}Arm`;
      if (POSE_DEBUG.on) POSE_DEBUG.last[`${inp.playerId}:${k}`] = cands.map((c, i) => { const r = c(); return { i, depth: r.depth, soft: r.soft }; });
      const r = pick(cands, mem[k]);
      mem[k] = r.index;
      a = r.best;
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
  const vdir = inp.localVelDir ?? v3(0, 0, 1);
  const amp = Math.min(0.32, 0.075 * inp.speed);
  const lift = 0.13 * Math.min(1, inp.speed / 3);
  for (const s of ['left', 'right'] as ArmSide[]) {
    const sx = sideSignX(body, s);
    const hipL = hipLocal(body, s);
    const ph = inp.gait.phase + (s === 'left' ? 0 : Math.PI);
    const swing = Math.sin(ph) > 0 ? Math.sin(ph) : 0;
    const off = Math.cos(ph) * amp;
    const base = v3(hipL.x + vdir.x * off, (body.measured?.ankleTargetY ?? AUTHORED_ANKLE_Y) + lift * swing, hipL.z + vdir.z * off);
    const hip = W(hipL);
    type LegC = { knee: Vec3; ankle: Vec3; chain: HingeChain; shapes: PoseShape[]; depth: number; soft: number };
    const variant = (o: Vec3, poleL: Vec3) => (): LegC => {
      let target = W(add(base, o));
      const pole = qRot(pose.q, poleL);
      let c: LegC | null = null;
      for (let it = 0; it < 5; it++) {
        const r = twoBone(hip, target, R.lengths.thigh, R.lengths.shin, pole);
        const chain = hingeChain(hip, r.mid, [r.end], [neg(fwd), neg(upB)], straight);
        const ankle = chain.ends[0];
        const shapes = legShapes(R, s, hip, r.mid, ankle, chain.frameB);
        const fd = floorDepth(shapes);
        c = { knee: r.mid, ankle, chain, shapes, depth: fd, soft: 0 };
        if (fd <= 0.001) break;
        target = add(target, v3(0, fd + 0.003, 0));
      }
      c!.depth = Math.max(c!.depth, ext(c!.shapes));
      c!.soft = softExt(c!.shapes);
      return c!;
    };
    const k = `${s}Leg`;
    const r = pick(LEG_ALTS(sx).map((v) => variant(v.off, v.pole)), mem[k]);
    mem[k] = r.index;
    const l = r.best;
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
  }
  return { playerId: inp.playerId, segments: segs, jointLandmarksWorld: lm, hingeDeg, straightFallback, limbClearance };
}
