// Gate 4 passive ten-body ragdoll: candidate construction from the sim-owned PhysicalPose, geometry validation,
// bulk momentum transfer with an audit, and the atomic switch. Only PhysicsWorld/this module touch Rapier handles;
// PlayerId and segment identity live in collider tags and body userData.
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArmSide, ColliderRegion, PlayerId, SegmentId } from './contracts';
import type { PhysicsWorld } from './physics';
import type { PhysicalPose, SegmentPose } from './pose';
import { hipLocal, shoulderLocal, type BodyProfile, type RagdollProfile } from './profiles';
import {
  add, cross, dist, dot, isFiniteVec, len, m3Add, m3Inverse, m3ParallelAxis, m3Vec, qConj, qMul, round, rv, scale, sub, toLocal,
  toWorld, v3, vc, worldInertia, type Mat3, type Pose, type Quat, type Vec3,
} from './vec';

export const SEGMENTS: SegmentId[] = [
  'core', 'head', 'leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm', 'leftThigh', 'leftShin', 'rightThigh', 'rightShin',
];

export interface RagdollCollider {
  collider: RAPIER.Collider;
  segment: SegmentId;
  region: ColliderRegion;
  side?: ArmSide;
  /** Collider pose relative to its segment body. */
  local: Pose;
}

export interface RagdollJoint {
  id: string;
  kind: 'neck' | 'shoulder' | 'elbow' | 'hip' | 'knee';
  parent: SegmentId;
  child: SegmentId;
  joint: RAPIER.ImpulseJoint;
  anchorParentLocal: Vec3;
  anchorChildLocal: Vec3;
  /** Blueprint (profile) anchors: the joint location each segment frame declares (limb child origin = proximal joint). */
  blueprintParentLocal: Vec3;
  blueprintChildLocal: Vec3;
  /** Hinge limits (rad) about the shared local X axis; spherical joints have none (deferred cone/twist). */
  limitsRad: [number, number] | null;
}

export interface Ragdoll {
  playerId: PlayerId;
  profile: RagdollProfile;
  bodies: Record<SegmentId, RAPIER.RigidBody>;
  colliders: RagdollCollider[];
  joints: RagdollJoint[];
  /** Landmark name -> owning segment and local point (pose reconstruction, grip remapping). */
  landmarks: Record<string, { seg: SegmentId; local: Vec3 }>;
  massKg: Record<SegmentId, number>;
  enabled: boolean;
}

/**
 * Labelled diagnostic edits of a candidate. Never used by contact-driven fixtures.
 *  - jointMismatch (G4-F6): offset one segment body so its joint anchors no longer coincide with the blueprint.
 *  - surfaceShift (G4-F4): move one core collider inside its segment so a held surface point is no longer on it.
 */
export type CandidateEdit =
  | { kind: 'jointMismatch'; segment: SegmentId; offsetWorld: Vec3 }
  | { kind: 'surfaceShift'; segment: SegmentId; region: ColliderRegion; offsetLocal: Vec3 };

export interface PenetrationRec {
  depthM: number;
  newDepthM: number;
  own: string;
  other: string;
}

export interface CandidateReport {
  ok: boolean;
  reasons: string[];
  finite: boolean;
  massKg: number;
  lengthErrM: number;
  /** max(world anchor separation, deviation of either local anchor from the blueprint). */
  maxAnchorErrM: number;
  anchorErrM: Record<string, number>;
  anchorProfileErrM: Record<string, number>;
  hingeDeg: Record<string, number>;
  hingeOk: boolean;
  floorPenetrationM: number;
  maxNewExternalPenetrationM: number;
  worstExternal: PenetrationRec | null;
  /** Pre-existing overlap of the proxy core (torso/pelvis/head counterparts) with the same external geometry. */
  proxyCoreDepthM: number;
  maxLandmarkErrM: number;
  worstLandmark: string | null;
}

/** External collision geometry a candidate is validated against (opponents, floor, other candidates). */
export interface ExternalShape {
  key: string;
  shape: RAPIER.Shape;
  pose: Pose;
  /** Floor (penetration counted against the floor tolerance as well). */
  floor?: boolean;
}

const poseOfRb = (rb: RAPIER.RigidBody): Pose => ({ p: vc(rb.translation()), q: { ...rb.rotation() } });
const composePose = (a: Pose, b: Pose): Pose => ({ p: toWorld(a, b.p), q: qMul(a.q, b.q) });
const I3: Quat = { x: 0, y: 0, z: 0, w: 1 };

/** Signed twist angle (rad) of q about the local X axis (swing removed), in (-pi, pi]. */
export function twistX(q: Quat): number {
  let a = 2 * Math.atan2(q.x, q.w);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

const SIDE_OF = (s: SegmentId): ArmSide | undefined => (s.startsWith('left') ? 'left' : s.startsWith('right') ? 'right' : undefined);

/**
 * Build disabled candidate bodies, colliders and joints from the physical pose (no physics step). Segment masses are
 * set through collider masses so each body's total is its declared fraction of `totalMassKg`.
 */
export function buildCandidate(
  phys: PhysicsWorld,
  playerId: PlayerId,
  body: BodyProfile,
  pose: PhysicalPose,
  R: RagdollProfile,
  totalMassKg: number,
  edit?: CandidateEdit,
): Ragdoll {
  const s = phys.solver;
  const L = R.lengths;
  const f = R.massFractions;
  const segMass: Record<SegmentId, number> = {
    core: f.core * totalMassKg,
    head: f.head * totalMassKg,
    leftUpperArm: f.upperArm * totalMassKg,
    rightUpperArm: f.upperArm * totalMassKg,
    leftForearm: f.forearm * totalMassKg,
    rightForearm: f.forearm * totalMassKg,
    leftThigh: f.thigh * totalMassKg,
    rightThigh: f.thigh * totalMassKg,
    leftShin: f.shin * totalMassKg,
    rightShin: f.shin * totalMassKg,
  };
  const bodies = {} as Record<SegmentId, RAPIER.RigidBody>;
  const colliders: RagdollCollider[] = [];
  for (const id of SEGMENTS) {
    const sp: SegmentPose = pose.segments[id];
    let p = sp.originWorld;
    if (edit?.kind === 'jointMismatch' && edit.segment === id) p = add(p, edit.offsetWorld);
    const rb = phys.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, p.y, p.z)
        .setRotation(sp.rotationWorld)
        .setEnabled(false)
        .setCanSleep(false)
        .setCcdEnabled(s.ccd)
        .setSoftCcdPrediction(s.softCcdPredictionM)
        .setLinearDamping(s.linearDamping)
        .setAngularDamping(s.angularDamping),
    );
    rb.userData = { playerId, segment: id };
    bodies[id] = rb;
  }
  const add1 = (seg: SegmentId, desc: RAPIER.ColliderDesc, local0: Pose, mass: number, region: ColliderRegion): void => {
    const local = edit?.kind === 'surfaceShift' && edit.segment === seg && edit.region === region ? { p: add(local0.p, edit.offsetLocal), q: local0.q } : local0;
    desc
      .setTranslation(local.p.x, local.p.y, local.p.z)
      .setRotation(local.q)
      .setMass(mass)
      .setFriction(s.passiveFriction)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule[s.passiveFrictionCombine])
      .setRestitution(s.restitution)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule[s.restitutionCombine])
      .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
    const c = phys.world.createCollider(desc, bodies[seg]);
    const side = SIDE_OF(seg);
    phys.addTag(c, playerId, seg, region, `${seg}:${region}`, side);
    colliders.push({ collider: c, segment: seg, region, side, local });
  };
  const at = (x: number, y: number, z: number): Pose => ({ p: v3(x, y, z), q: I3 });
  // core: torso + pelvis cuboids from the supported proxy's declared surface profile (one rigid compound)
  const g = body.compound;
  const fp = body.massFractions;
  const torsoShare = fp.torso / (fp.torso + fp.pelvis);
  add1('core', RAPIER.ColliderDesc.cuboid(g.torso.halfExtents.x, g.torso.halfExtents.y, g.torso.halfExtents.z), at(g.torso.center.x, g.torso.center.y, g.torso.center.z), segMass.core * torsoShare, 'torso');
  add1('core', RAPIER.ColliderDesc.cuboid(g.pelvis.halfExtents.x, g.pelvis.halfExtents.y, g.pelvis.halfExtents.z), at(g.pelvis.center.x, g.pelvis.center.y, g.pelvis.center.z), segMass.core * (1 - torsoShare), 'pelvis');
  // head: sphere about the head centre; body origin at the neck pivot, bind rotation = core
  const hc = sub(body.headCenter, body.neck);
  add1('head', RAPIER.ColliderDesc.ball(R.radii.head), at(hc.x, hc.y, hc.z), segMass.head, 'head');
  const capsule = (seg: SegmentId, Lseg: number, r: number, mass: number, region: ColliderRegion): void => {
    add1(seg, RAPIER.ColliderDesc.capsule(Math.max(0, (Lseg - 2 * r) / 2), r), at(0, -Lseg / 2, 0), mass, region);
  };
  for (const side of ['left', 'right'] as ArmSide[]) {
    capsule(`${side}UpperArm`, L.upperArm, R.radii.upperArm, segMass[`${side}UpperArm`], 'upperArm');
    capsule(`${side}Forearm`, L.forearm, R.radii.forearm, segMass[`${side}Forearm`] * (1 - R.palmMassShare), 'forearm');
    add1(`${side}Forearm`, RAPIER.ColliderDesc.ball(R.radii.palm), at(0, -(L.forearm + L.palmExtension - R.radii.palm), 0), segMass[`${side}Forearm`] * R.palmMassShare, 'palm');
    capsule(`${side}Thigh`, L.thigh, R.radii.thigh, segMass[`${side}Thigh`], 'thigh');
    capsule(`${side}Shin`, L.shin, R.radii.shin, segMass[`${side}Shin`] * (1 - R.shoeMassShare), 'shin');
    const he = R.shoe.halfExtents;
    add1(`${side}Shin`, RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z), at(0, -L.shin - R.shoe.belowAnkleM, R.shoe.forwardM), segMass[`${side}Shin`] * R.shoeMassShare, 'shoe');
  }
  for (const id of SEGMENTS) bodies[id].recomputeMassPropertiesFromColliders();
  // joints: anchors from the same world landmarks expressed in both frames
  const joints: RagdollJoint[] = [];
  const rad = (d: number): number => (d * Math.PI) / 180;
  const mk = (
    id: string,
    kind: RagdollJoint['kind'],
    parent: SegmentId,
    child: SegmentId,
    landmarkWorld: Vec3,
    blueprintParentLocal: Vec3,
    hinge: [number, number] | null,
  ): void => {
    const a1 = toLocal(poseOfRb(bodies[parent]), landmarkWorld);
    const a2 = toLocal(poseOfRb(bodies[child]), landmarkWorld);
    const data = hinge ? RAPIER.JointData.revolute(a1, a2, v3(1, 0, 0)) : RAPIER.JointData.spherical(a1, a2);
    const j = phys.world.createImpulseJoint(data, bodies[parent], bodies[child], true);
    j.setContactsEnabled(false);
    let limitsRad: [number, number] | null = null;
    if (hinge) {
      limitsRad = [rad(hinge[0]), rad(hinge[1])];
      (j as RAPIER.RevoluteImpulseJoint).setLimits(limitsRad[0], limitsRad[1]);
    }
    joints.push({ id, kind, parent, child, joint: j, anchorParentLocal: a1, anchorChildLocal: a2, blueprintParentLocal, blueprintChildLocal: v3(), limitsRad });
  };
  const lmW = pose.jointLandmarksWorld;
  mk('neck', 'neck', 'core', 'head', lmW.neck, { ...body.neck }, R.limitsDeg.neck);
  for (const side of ['left', 'right'] as ArmSide[]) {
    mk(`${side}Shoulder`, 'shoulder', 'core', `${side}UpperArm`, lmW[`${side}Shoulder`], shoulderLocal(body, side), null);
    mk(`${side}Elbow`, 'elbow', `${side}UpperArm`, `${side}Forearm`, lmW[`${side}Elbow`], v3(0, -L.upperArm, 0), R.limitsDeg.elbow);
    mk(`${side}Hip`, 'hip', 'core', `${side}Thigh`, lmW[`${side}Hip`], hipLocal(body, side), null);
    mk(`${side}Knee`, 'knee', `${side}Thigh`, `${side}Shin`, lmW[`${side}Knee`], v3(0, -L.thigh, 0), R.limitsDeg.knee);
  }
  // landmarks in their owning segment (distal joints belong to the child segment)
  const landmarks: Ragdoll['landmarks'] = {
    pelvisMid: { seg: 'core', local: v3(0, -0.05, 0) },
    neck: { seg: 'head', local: v3() },
    headCenter: { seg: 'head', local: hc },
  };
  for (const side of ['left', 'right'] as ArmSide[]) {
    landmarks[`${side}Shoulder`] = { seg: `${side}UpperArm`, local: v3() };
    landmarks[`${side}Elbow`] = { seg: `${side}Forearm`, local: v3() };
    landmarks[`${side}Wrist`] = { seg: `${side}Forearm`, local: v3(0, -L.forearm, 0) };
    landmarks[`${side}Palm`] = { seg: `${side}Forearm`, local: v3(0, -(L.forearm + L.palmExtension), 0) };
    landmarks[`${side}Hand`] = { seg: `${side}Forearm`, local: v3(0, -(L.forearm + L.palmExtension - R.radii.palm), 0) };
    landmarks[`${side}Hip`] = { seg: `${side}Thigh`, local: v3() };
    landmarks[`${side}Knee`] = { seg: `${side}Shin`, local: v3() };
    landmarks[`${side}Ankle`] = { seg: `${side}Shin`, local: v3(0, -L.shin, 0) };
    landmarks[`${side}Shoe`] = { seg: `${side}Shin`, local: v3(0, -L.shin - R.shoe.belowAnkleM, R.shoe.forwardM) };
  }
  return { playerId, profile: R, bodies, colliders, joints, landmarks, massKg: segMass, enabled: false };
}

/** World pose of a ragdoll collider computed from its body (valid for disabled candidates). */
export function colliderWorldPose(rag: Ragdoll, c: RagdollCollider): Pose {
  return composePose(poseOfRb(rag.bodies[c.segment]), c.local);
}

export function landmarkWorld(rag: Ragdoll, name: string): Vec3 {
  const l = rag.landmarks[name];
  return toWorld(poseOfRb(rag.bodies[l.seg]), l.local);
}

/** World anchor separation per joint (m). */
export function anchorErrors(rag: Ragdoll): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of rag.joints) {
    const a = toWorld(poseOfRb(rag.bodies[j.parent]), j.anchorParentLocal);
    const b = toWorld(poseOfRb(rag.bodies[j.child]), j.anchorChildLocal);
    out[j.id] = dist(a, b);
  }
  return out;
}

/** Per joint: largest deviation of the constructed local anchors from the blueprint anchors (m). */
export function anchorProfileErrors(rag: Ragdoll): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of rag.joints) out[j.id] = Math.max(dist(j.anchorParentLocal, j.blueprintParentLocal), dist(j.anchorChildLocal, j.blueprintChildLocal));
  return out;
}

/** Hinge angles (deg) measured from the body rotations about the shared local X axis. */
export function hingeAngles(rag: Ragdoll): Record<string, number> {
  const out: Record<string, number> = {};
  for (const j of rag.joints) {
    if (!j.limitsRad) continue;
    const q = qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation());
    out[j.id] = (twistX(q) * 180) / Math.PI;
  }
  return out;
}

/** External geometry from live colliders (opponents, floor). */
export function externalFromColliders(cs: RAPIER.Collider[], keyOf: (c: RAPIER.Collider) => string, floor?: RAPIER.Collider): ExternalShape[] {
  const out: ExternalShape[] = cs.map((c) => ({ key: keyOf(c), shape: c.shape, pose: { p: vc(c.translation()), q: { ...c.rotation() } } }));
  if (floor) out.push({ key: 'floor', shape: floor.shape, pose: { p: vc(floor.translation()), q: { ...floor.rotation() } }, floor: true });
  return out;
}

/** External geometry from a (possibly disabled) candidate ragdoll. */
export function externalFromRagdoll(rag: Ragdoll): ExternalShape[] {
  return rag.colliders.map((c) => ({ key: `${rag.playerId}:${c.segment}:${c.region}`, shape: c.collider.shape, pose: colliderWorldPose(rag, c) }));
}

function depthAgainst(shape: RAPIER.Shape, pose: Pose, ext: ExternalShape[]): { depth: number; other: string; floor: number } {
  let depth = 0;
  let other = '';
  let floor = 0;
  for (const e of ext) {
    const r = e.shape.contactShape(e.pose.p, e.pose.q, shape, pose.p, pose.q, 0.05);
    if (!r) continue;
    const d = Math.max(0, -r.distance);
    if (e.floor) floor = Math.max(floor, d);
    if (d > depth) {
      depth = d;
      other = e.key;
    }
  }
  return { depth, other, floor };
}

/**
 * Validate a candidate before enabling it. `counterparts` maps a candidate core region (torso/pelvis/head) to the
 * proxy collider with identical geometry, so already-existing proxy overlap is not counted as new penetration.
 */
export function validateCandidate(
  rag: Ragdoll,
  pose: PhysicalPose,
  ext: ExternalShape[],
  counterparts: Partial<Record<ColliderRegion, { shape: RAPIER.Shape; pose: Pose }>>,
  expectedMassKg: number,
): CandidateReport {
  const R = rag.profile;
  const V = R.validation;
  const reasons: string[] = [];
  // 1. finite transforms, masses, inertia
  let finite = true;
  let mass = 0;
  for (const id of SEGMENTS) {
    const b = rag.bodies[id];
    const m = b.mass();
    const pi = vc(b.principalInertia());
    mass += m;
    if (!isFiniteVec(b.translation()) || !Number.isFinite(m) || m <= 0 || !isFiniteVec(pi) || pi.x <= 0 || pi.y <= 0 || pi.z <= 0) finite = false;
  }
  if (!finite) reasons.push('nonFinite');
  if (Math.abs(mass - expectedMassKg) > R.audit.massTolKg) reasons.push('mass');
  // 2. limb lengths and joint anchors
  const lm = (n: string) => landmarkWorld(rag, n);
  let lengthErr = 0;
  for (const side of ['left', 'right']) {
    lengthErr = Math.max(
      lengthErr,
      Math.abs(dist(pose.jointLandmarksWorld[`${side}Shoulder`], pose.jointLandmarksWorld[`${side}Elbow`]) - R.lengths.upperArm),
      Math.abs(dist(pose.jointLandmarksWorld[`${side}Elbow`], pose.jointLandmarksWorld[`${side}Wrist`]) - R.lengths.forearm),
      Math.abs(dist(pose.jointLandmarksWorld[`${side}Hip`], pose.jointLandmarksWorld[`${side}Knee`]) - R.lengths.thigh),
      Math.abs(dist(pose.jointLandmarksWorld[`${side}Knee`], pose.jointLandmarksWorld[`${side}Ankle`]) - R.lengths.shin),
    );
  }
  if (lengthErr > V.lengthTolM) reasons.push('limbLength');
  const anchorErrM = anchorErrors(rag);
  const anchorProfileErrM = anchorProfileErrors(rag);
  const maxAnchor = Math.max(...Object.values(anchorErrM), ...Object.values(anchorProfileErrM));
  if (maxAnchor > V.anchorTolM) reasons.push('jointAnchor');
  // 3. hinge angles inside limits
  const hingeDeg = hingeAngles(rag);
  let hingeOk = true;
  for (const j of rag.joints) {
    if (!j.limitsRad) continue;
    const a = (hingeDeg[j.id] * Math.PI) / 180;
    if (a < j.limitsRad[0] - 1e-6 || a > j.limitsRad[1] + 1e-6) hingeOk = false;
  }
  if (!hingeOk) reasons.push('hingeLimit');
  // 4-5. floor and external penetration (new overlap only for core counterparts)
  let floorPen = 0;
  let worst: PenetrationRec | null = null;
  let maxNew = 0;
  let proxyCoreDepth = 0;
  for (const cp of Object.values(counterparts)) if (cp) proxyCoreDepth = Math.max(proxyCoreDepth, depthAgainst(cp.shape, cp.pose, ext).depth);
  for (const c of rag.colliders) {
    const p = colliderWorldPose(rag, c);
    const d = depthAgainst(c.collider.shape, p, ext);
    floorPen = Math.max(floorPen, d.floor);
    let base = 0;
    const cp = c.segment === 'core' || c.segment === 'head' ? counterparts[c.region] : undefined;
    if (cp) base = depthAgainst(cp.shape, cp.pose, ext).depth;
    const nd = Math.max(0, d.depth - base);
    if (nd > maxNew) {
      maxNew = nd;
      worst = { depthM: d.depth, newDepthM: nd, own: `${c.segment}:${c.region}`, other: d.other };
    }
  }
  if (floorPen > V.penetrationTolM) reasons.push('floorPenetration');
  if (maxNew > V.penetrationTolM) reasons.push('externalPenetration');
  // landmark continuity: candidate landmarks vs the visible pose
  let maxLm = 0;
  let worstLm: string | null = null;
  for (const name of Object.keys(rag.landmarks)) {
    const want = pose.jointLandmarksWorld[name];
    if (!want) continue;
    const e = dist(lm(name), want);
    if (e > maxLm) {
      maxLm = e;
      worstLm = name;
    }
  }
  if (maxLm > V.landmarkTolM) reasons.push('landmarkDiscontinuity');
  return {
    ok: reasons.length === 0,
    reasons,
    finite,
    massKg: mass,
    lengthErrM: lengthErr,
    maxAnchorErrM: maxAnchor,
    anchorErrM,
    anchorProfileErrM,
    hingeDeg,
    hingeOk,
    floorPenetrationM: floorPen,
    maxNewExternalPenetrationM: maxNew,
    worstExternal: worst,
    proxyCoreDepthM: proxyCoreDepth,
    maxLandmarkErrM: maxLm,
    worstLandmark: worstLm,
  };
}

// ---------------------------------------------------------------- bulk momentum transfer
export interface BulkState {
  massKg: number;
  com: Vec3;
  P: Vec3;
  L: Vec3; // about `com`
  ke: number;
}

export interface TransferAudit {
  before: { massKg: number; com: number[]; v: number[]; w: number[]; P: number[]; L: number[]; keJ: number };
  after: { massKg: number; com: number[]; P: number[]; L: number[]; keJ: number; omega: number[] };
  massDiffKg: number;
  linearRelErr: number;
  angularRelErr: number;
  energyDeltaJ: number;
  energyGainLimitJ: number;
  ok: boolean;
  reasons: string[];
  inertiaDet: number;
}

interface PartState {
  m: number;
  C: Vec3;
  I: Mat3;
}

function partOf(rb: RAPIER.RigidBody): PartState {
  const pose = poseOfRb(rb);
  return { m: rb.mass(), C: toWorld(pose, vc(rb.localCom())), I: worldInertia(vc(rb.principalInertia()), { ...rb.principalInertiaLocalFrame() }, pose.q) };
}

/** Assembly mass, COM, linear and angular momentum (about the COM) and kinetic energy of a set of bodies. */
export function bulkOf(rbs: RAPIER.RigidBody[]): BulkState {
  const parts = rbs.map((rb) => ({ ...partOf(rb), v: vc(rb.linvel()), w: vc(rb.angvel()) }));
  const M = parts.reduce((s, p) => s + p.m, 0);
  const C = scale(parts.reduce((s, p) => add(s, scale(p.C, p.m)), v3()), 1 / M);
  let P = v3();
  let L = v3();
  let ke = 0;
  for (const p of parts) {
    P = add(P, scale(p.v, p.m));
    L = add(L, add(m3Vec(p.I, p.w), scale(cross(sub(p.C, C), p.v), p.m)));
    ke += 0.5 * p.m * dot(p.v, p.v) + 0.5 * dot(p.w, m3Vec(p.I, p.w));
  }
  return { massKg: M, com: C, P, L, ke };
}

/**
 * Atomic switch: read the old proxy state, compute P/L-preserving bulk velocities for the candidate, remove the
 * proxy, enable the candidate, set velocities and audit by reading the engine back (no physics step in between).
 */
export function switchToRagdoll(phys: PhysicsWorld, proxyBody: RAPIER.RigidBody, rag: Ragdoll): TransferAudit {
  const R = rag.profile;
  const old = partOf(proxyBody);
  const v0 = vc(proxyBody.linvel());
  const w0 = vc(proxyBody.angvel());
  const M0 = old.m;
  const P = scale(v0, M0);
  const ke0 = 0.5 * M0 * dot(v0, v0) + 0.5 * dot(w0, m3Vec(old.I, w0));
  const rbs = SEGMENTS.map((id) => rag.bodies[id]);
  const parts = rbs.map(partOf);
  const M = parts.reduce((s, p) => s + p.m, 0);
  const C = scale(parts.reduce((s, p) => add(s, scale(p.C, p.m)), v3()), 1 / M);
  const L = add(m3Vec(old.I, w0), cross(sub(old.C, C), P));
  let Iasm: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const p of parts) Iasm = m3Add(Iasm, m3Add(p.I, m3ParallelAxis(p.m, sub(p.C, C))));
  const inv = m3Inverse(Iasm);
  const det = Iasm[0] * (Iasm[4] * Iasm[8] - Iasm[5] * Iasm[7]) - Iasm[1] * (Iasm[3] * Iasm[8] - Iasm[5] * Iasm[6]) + Iasm[2] * (Iasm[3] * Iasm[7] - Iasm[4] * Iasm[6]);
  const omega = inv ? m3Vec(inv, L) : v3();
  // ---- the switch: old proxy out, candidate in, in one boundary operation
  phys.removeBody(proxyBody);
  for (const rb of rbs) rb.setEnabled(true);
  rag.enabled = true;
  rbs.forEach((rb, i) => {
    const vi = add(scale(P, 1 / M), cross(omega, sub(parts[i].C, C)));
    rb.setLinvel(vi, true);
    rb.setAngvel(omega, true);
  });
  // ---- audit from the engine, no step in between
  const after = bulkOf(rbs);
  const Lafter = add(after.L, cross(sub(after.com, C), after.P)); // about the same point C (identical COM in practice)
  const massDiff = Math.abs(after.massKg - M0);
  const linRel = len(sub(after.P, P)) / Math.max(len(P), 1);
  const angRel = len(sub(Lafter, L)) / Math.max(len(L), 1);
  const dE = after.ke - ke0;
  const gainLimit = Math.max(R.validation.energyGainAbsJ, R.validation.energyGainFraction * ke0);
  const reasons: string[] = [];
  if (!inv) reasons.push('singularInertia');
  if (massDiff > R.audit.massTolKg) reasons.push('mass');
  if (linRel > R.audit.linearRelTol) reasons.push('linearMomentum');
  if (angRel > R.audit.angularRelTol) reasons.push('angularMomentum');
  if (dE > gainLimit) reasons.push('energyGain');
  return {
    before: { massKg: round(M0, 6), com: rv(old.C, 5), v: rv(v0, 5), w: rv(w0, 5), P: rv(P, 5), L: rv(L, 5), keJ: round(ke0, 4) },
    after: { massKg: round(after.massKg, 6), com: rv(after.com, 5), P: rv(after.P, 5), L: rv(Lafter, 5), keJ: round(after.ke, 4), omega: rv(omega, 5) },
    massDiffKg: massDiff,
    linearRelErr: linRel,
    angularRelErr: angRel,
    energyDeltaJ: round(dE, 4),
    energyGainLimitJ: round(gainLimit, 4),
    ok: reasons.length === 0,
    reasons,
    inertiaDet: det,
  };
}

/** Remove every body (and with it every collider tag and joint) of a ragdoll or rejected candidate. */
export function removeRagdoll(phys: PhysicsWorld, rag: Ragdoll): void {
  for (const id of SEGMENTS) phys.removeBody(rag.bodies[id]);
  rag.enabled = false;
}

/** Physical pose reconstructed from the solved segment bodies (presentation and rule queries after handoff). */
export function ragdollPose(rag: Ragdoll): PhysicalPose {
  const segments = {} as PhysicalPose['segments'];
  for (const id of SEGMENTS) {
    const p = poseOfRb(rag.bodies[id]);
    segments[id] = { segmentId: id, originWorld: p.p, rotationWorld: p.q };
  }
  const jointLandmarksWorld: Record<string, Vec3> = {};
  for (const n of Object.keys(rag.landmarks)) jointLandmarksWorld[n] = landmarkWorld(rag, n);
  const hingeDeg = hingeAngles(rag);
  return { playerId: rag.playerId, segments, jointLandmarksWorld, hingeDeg, straightFallback: [], limbClearance: {} };
}
