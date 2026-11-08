// Gate 4 passive ten-body ragdoll: candidate construction from the sim-owned PhysicalPose, geometry validation,
// bulk momentum transfer with an audit, and the atomic switch. Only PhysicsWorld/this module touch Rapier handles;
// PlayerId and segment identity live in collider tags and body userData.
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArmSide, ColliderRegion, PlayerId, SegmentId } from './contracts';
import { seatBallLocal, seatPalmLocal, type CarrySeat } from './carry';
import type { PhysicsWorld } from './physics';
import { pelvisMidLocal, pitchShin, type PhysicalPose, type SegmentPose } from './pose';
import { hipLocal, shoulderLocal, sideSignX, type BodyProfile, type JointEnvelope, type RagdollProfile } from './profiles';
import {
  add, addScaled, cross, dist, dot, isFiniteVec, len, m3Add, m3Inverse, m3ParallelAxis, m3Vec, norm, qConj, qFromAxisAngle, qMul, qRot, round, rv, scale, sub, toLocal,
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
  /** Hinge limits (rad) about the shared local X axis; spherical joints have none (plan 09: soft swing-twist envelope). */
  limitsRad: [number, number] | null;
  /** Limb side and its measured sign along the core's X (absent on the neck). */
  side?: ArmSide;
  sideSign?: number;
}

/** Plan 09: one spherical joint's soft envelope state since the handoff. */
export interface EnvelopeRuntime {
  jointId: string;
  /** Range the joint started outside of (rad); it follows the limb inward and decays, so conversion adds no kick. */
  swingSlack: number;
  twistSlackLo: number;
  twistSlackHi: number;
  startOutsideDeg: number;
  /** Excursion past the range in force (nominal plus slack) now, and the largest of it, deg; the same past the nominal range. */
  overDeg: number;
  maxOverDeg: number;
  maxNominalOverDeg: number;
  /** Longest continuous time past the declared tolerance (range in force), s. */
  overRunS: number;
  maxOverRunS: number;
  /** Torque applied to the child this substep (world), and the relative angular velocity before the solve. */
  torque: Vec3;
  wPre: Vec3;
  passivePositiveJ: number;
  passiveNegativeJ: number;
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
  /** Ankle pitch (deg) of the pose the candidate was built from: the shoe stays fixed on the shin at that angle. */
  anklePitchDeg?: Partial<Record<ArmSide, number>>;
  /** Plan 08a: the last supported hand and ball seat on the right forearm (frozen). */
  carry?: CarrySeat;
  /** Plan 09: soft envelope state of the shoulders and hips (absent: no envelope profile, or not switched yet). */
  envelope?: EnvelopeRuntime[];
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
  // shoe on the shin at the pose's ankle pitch (plan 06 pass 2; 0 = the rigid shoe of the procedural gait)
  const shoeLocal = (side: ArmSide): Pose => {
    const q = pitchShin(I3, ((pose.anklePitchDeg?.[side] ?? 0) * Math.PI) / 180);
    return { p: add(v3(0, -L.shin, 0), qRot(q, v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM))), q };
  };
  // palm landmark and the palm ball's centre on the forearm; plan 08a: the carry hand turned over the ball's nose
  const palmLocal = (side: ArmSide): { palm: Vec3; hand: Vec3 } => {
    if (side !== 'right' || !pose.carry) return { palm: v3(0, -(L.forearm + L.palmExtension), 0), hand: v3(0, -(L.forearm + L.palmExtension - R.radii.palm), 0) };
    const palm = seatPalmLocal(pose.carry, L.forearm, L.palmExtension);
    return { palm, hand: addScaled(palm, norm(sub(palm, v3(0, -L.forearm, 0)), v3(0, -1, 0)), -R.radii.palm) };
  };
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
    const palmC = palmLocal(side);
    add1(`${side}Forearm`, RAPIER.ColliderDesc.ball(R.radii.palm), at(palmC.hand.x, palmC.hand.y, palmC.hand.z), segMass[`${side}Forearm`] * R.palmMassShare, 'palm');
    capsule(`${side}Thigh`, L.thigh, R.radii.thigh, segMass[`${side}Thigh`], 'thigh');
    capsule(`${side}Shin`, L.shin, R.radii.shin, segMass[`${side}Shin`] * (1 - R.shoeMassShare), 'shin');
    const he = R.shoe.halfExtents;
    add1(`${side}Shin`, RAPIER.ColliderDesc.cuboid(he.x, he.y, he.z), shoeLocal(side), segMass[`${side}Shin`] * R.shoeMassShare, 'shoe');
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
    side?: ArmSide,
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
    joints.push({ id, kind, parent, child, joint: j, anchorParentLocal: a1, anchorChildLocal: a2, blueprintParentLocal, blueprintChildLocal: v3(), limitsRad, ...(side ? { side, sideSign: sideSignX(body, side) } : {}) });
  };
  const lmW = pose.jointLandmarksWorld;
  mk('neck', 'neck', 'core', 'head', lmW.neck, { ...body.neck }, R.limitsDeg.neck);
  for (const side of ['left', 'right'] as ArmSide[]) {
    mk(`${side}Shoulder`, 'shoulder', 'core', `${side}UpperArm`, lmW[`${side}Shoulder`], shoulderLocal(body, side), null, side);
    mk(`${side}Elbow`, 'elbow', `${side}UpperArm`, `${side}Forearm`, lmW[`${side}Elbow`], v3(0, -L.upperArm, 0), R.limitsDeg.elbow, side);
    mk(`${side}Hip`, 'hip', 'core', `${side}Thigh`, lmW[`${side}Hip`], hipLocal(body, side), null, side);
    mk(`${side}Knee`, 'knee', `${side}Thigh`, `${side}Shin`, lmW[`${side}Knee`], v3(0, -L.thigh, 0), R.limitsDeg.knee, side);
  }
  // landmarks in their owning segment (distal joints belong to the child segment)
  const landmarks: Ragdoll['landmarks'] = {
    pelvisMid: { seg: 'core', local: pelvisMidLocal(body) },
    neck: { seg: 'head', local: v3() },
    headCenter: { seg: 'head', local: hc },
  };
  for (const side of ['left', 'right'] as ArmSide[]) {
    landmarks[`${side}Shoulder`] = { seg: `${side}UpperArm`, local: v3() };
    landmarks[`${side}Elbow`] = { seg: `${side}Forearm`, local: v3() };
    landmarks[`${side}Wrist`] = { seg: `${side}Forearm`, local: v3(0, -L.forearm, 0) };
    const palmL = palmLocal(side);
    landmarks[`${side}Palm`] = { seg: `${side}Forearm`, local: palmL.palm };
    landmarks[`${side}Hand`] = { seg: `${side}Forearm`, local: palmL.hand };
    landmarks[`${side}Hip`] = { seg: `${side}Thigh`, local: v3() };
    landmarks[`${side}Knee`] = { seg: `${side}Shin`, local: v3() };
    landmarks[`${side}Ankle`] = { seg: `${side}Shin`, local: v3(0, -L.shin, 0) };
    landmarks[`${side}Shoe`] = { seg: `${side}Shin`, local: shoeLocal(side).p };
  }
  const rag: Ragdoll = { playerId, profile: R, bodies, colliders, joints, landmarks, massKg: segMass, enabled: false };
  if (pose.anklePitchDeg) rag.anklePitchDeg = { ...pose.anklePitchDeg };
  if (pose.carry) {
    // plan 08a: the hand and ball stay as published on their forearm, with no further carry motion
    rag.carry = { ...pose.carry };
    landmarks.carriedBall = { seg: 'rightForearm', local: seatBallLocal(pose.carry) };
  }
  return rag;
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

// ---------------------------------------------------------------- plan 09: joint coordinates and the soft envelope
/** World hinge axis (the parent's local X, shared with the child). */
export const hingeAxisWorld = (rag: Ragdoll, j: RagdollJoint): Vec3 => qRot(rag.bodies[j.parent].rotation(), v3(1, 0, 0));

/** Child minus parent angular velocity (world). */
export const relativeOmega = (rag: Ragdoll, j: RagdollJoint): Vec3 => sub(vc(rag.bodies[j.child].angvel()), vc(rag.bodies[j.parent].angvel()));

/** Limb direction (proximal to distal), world. */
export const limbDirWorld = (rag: Ragdoll, seg: SegmentId): Vec3 => qRot(rag.bodies[seg].rotation(), v3(0, -1, 0));

const wrapPi = (a: number): number => {
  let x = a;
  while (x > Math.PI) x -= 2 * Math.PI;
  while (x <= -Math.PI) x += 2 * Math.PI;
  return x;
};

export interface SwingTwist {
  /** Limb direction in the parent frame. */
  dir: Vec3;
  /** Angle from the limb hanging along the parent's -Y (rad). */
  swingRad: number;
  /** Rotation axis taking -Y to `dir`, parent frame (unit; zero when the limb hangs straight). */
  axis: Vec3;
  /** Rotation about the limb's own +Y left after that swing (rad, not offset by a neutral). */
  twistRad: number;
}

const REF = v3(0, -1, 0);

/** Swing-twist split of a relative rotation (parent to child): q = swing * twist. */
export function swingTwistOf(q: Quat): SwingTwist {
  const dir = qRot(q, REF);
  const swingRad = Math.atan2(Math.hypot(dir.x, dir.z), -dir.y);
  const c = cross(REF, dir);
  const s = len(c);
  const axis = s > 1e-9 ? scale(c, 1 / s) : v3();
  const h = swingRad / 2;
  const swing: Quat = { x: axis.x * Math.sin(h), y: axis.y * Math.sin(h), z: axis.z * Math.sin(h), w: Math.cos(h) };
  const t = qMul(qConj(swing), q);
  return { dir, swingRad, axis, twistRad: wrapPi(2 * Math.atan2(t.y, t.w)) };
}

/**
 * Unit parent-frame rotation axis that raises the twist angle fastest. Twist also changes as the limb swings around the
 * hanging axis, by tan(swing / 2) of the azimuth rate, so the gradient holds both terms; its length before normalizing
 * is 1 / cos(swing / 2), which turns a twist angle into a true distance that fades at the swing pole.
 */
export function twistAxis(q: Quat, st: SwingTwist): Vec3 {
  const half = st.swingRad / 2;
  return addScaled(scale(qRot(q, v3(0, 1, 0)), Math.cos(half)), cross(st.dir, st.axis), -Math.sin(half));
}

/** Where a parent-frame limb direction sits in the joint's swing cone: distance `d` from the centre, boundary radius there. */
function coneAt(E: JointEnvelope, dir: Vec3, sideSign: number): { c: Vec3; p: Vec3; d: number; sinD: number; R: number; dR: number } {
  const t = (E.cone.tiltDeg * Math.PI) / 180;
  const a = (E.cone.towardDeg * Math.PI) / 180;
  const h = v3(sideSign * Math.sin(a), 0, Math.cos(a));
  const c = add(scale(REF, Math.cos(t)), scale(h, Math.sin(t)));
  const u = add(scale(REF, -Math.sin(t)), scale(h, Math.cos(t)));
  const cosD = Math.max(-1, Math.min(1, dot(dir, c)));
  const p = sub(dir, scale(c, cosD));
  const sinD = len(p);
  const Ra = (E.cone.alongDeg * Math.PI) / 180;
  const Rb = (E.cone.acrossDeg * Math.PI) / 180;
  const cs = sinD > 1e-9 ? dot(p, u) / sinD : 1;
  const sn = sinD > 1e-9 ? dot(p, cross(c, u)) / sinD : 0;
  const R = 1 / Math.sqrt((cs * cs) / (Ra * Ra) + (sn * sn) / (Rb * Rb));
  return { c, p, d: Math.acos(cosD), sinD, R, dR: -(R ** 3) * sn * cs * (1 / (Rb * Rb) - 1 / (Ra * Ra)) };
}

/**
 * How far a limb direction is past the swing boundary (rad, negative inside), to first order a true angular distance,
 * and the unit parent-frame rotation axis that raises it fastest. The restoring torque follows this gradient, so it
 * derives from a potential: a limb cannot slide sideways into a deep error for free and then be paid to leave it.
 */
export function swingExcess(E: JointEnvelope, dir: Vec3, sideSign: number): { rad: number; axis: Vec3 } {
  const { c, d, sinD, R, dR } = coneAt(E, dir, sideSign);
  if (sinD < 1e-6) return { rad: d - R, axis: v3() };
  const radial = norm(cross(c, dir), v3(1, 0, 0));
  const g = sub(radial, scale(cross(dir, radial), dR / Math.max(sinD, 0.05)));
  const n = len(g);
  return { rad: (d - R) / n, axis: scale(g, 1 / n) };
}

/** Parent-frame swing range (deg) along one azimuth about the hanging limb (0 forward, 90 out, 180 back, -90 in). */
export function swingExtentDeg(E: JointEnvelope, azimuthDeg: number): number {
  const a = (azimuthDeg * Math.PI) / 180;
  for (let deg = 0; deg < 180; deg += 0.25) {
    const th = (deg * Math.PI) / 180;
    if (swingExcess(E, v3(Math.sin(th) * Math.sin(a), -Math.cos(th), Math.sin(th) * Math.cos(a)), 1).rad > 0) return deg;
  }
  return 180;
}

/** Twist from the joint's neutral (rad), positive external on either side. */
export const externalTwistRad = (E: JointEnvelope, twistRad: number, sideSign: number): number => wrapPi(sideSign * (twistRad - (E.neutralTwistDeg * Math.PI) / 180));

/** A parent-frame limb direction pulled inside the swing cone by `marginRad`, along the line from the cone's centre. */
export function clampDirToEnvelope(E: JointEnvelope, dir: Vec3, sideSign: number, marginRad: number): Vec3 {
  const { c, p, d, sinD, R } = coneAt(E, dir, sideSign);
  const r = R - marginRad;
  if (d <= r || sinD < 1e-9) return dir;
  return add(scale(c, Math.cos(r)), scale(p, Math.sin(r) / sinD));
}

const envelopeOf = (rag: Ragdoll, j: RagdollJoint): JointEnvelope | null => (j.kind === 'shoulder' ? rag.profile.envelope?.shoulder ?? null : j.kind === 'hip' ? rag.profile.envelope?.hip ?? null : null);

function jointSwingTwist(rag: Ragdoll, j: RagdollJoint): SwingTwist {
  return swingTwistOf(qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation()));
}

/** World unit axes along which a relative rotation raises this joint's swing excess and external twist. */
export function limitGradients(rag: Ragdoll, j: RagdollJoint): { swing: Vec3; twist: Vec3; twistReach: number } {
  const q = qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation());
  const st = swingTwistOf(q);
  const qp = rag.bodies[j.parent].rotation();
  const s = j.sideSign ?? 1;
  return { swing: qRot(qp, swingExcess(envelopeOf(rag, j)!, st.dir, s).axis), twist: scale(qRot(qp, twistAxis(q, st)), s), twistReach: Math.cos(st.swingRad / 2) };
}

/**
 * External twist (rad) measured so that it wraps half a turn from the middle of the twist range, not from the neutral:
 * where it wraps, the excess past either limit is the same, so the limit energy stays continuous for any range.
 */
export function rangeTwistRad(E: JointEnvelope, twistRad: number, sideSign: number): number {
  const mid = (((E.twistDeg[0] + E.twistDeg[1]) / 2) * Math.PI) / 180;
  return mid + wrapPi(externalTwistRad(E, twistRad, sideSign) - mid);
}

/** One limit's excess past the range in force (rad, positive outside) and its exact parent-frame gradient. */
export interface LimitTerm {
  excess: number;
  /** Rate of the excess per unit relative rotation about each parent axis (the excess's derivative, not normalized). */
  grad: Vec3;
}

const GRAD_STEP_RAD = 1e-4;
const AXES = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];

/** Swing excess and its gradient, by central differences of that same function about each parent axis. */
export function swingTerm(E: JointEnvelope, dir: Vec3, sideSign: number, slack: number): LimitTerm {
  const f = (d: Vec3): number => swingExcess(E, d, sideSign).rad - slack;
  const g = AXES.map((a) => (f(qRot(qFromAxisAngle(a, GRAD_STEP_RAD), dir)) - f(qRot(qFromAxisAngle(a, -GRAD_STEP_RAD), dir))) / (2 * GRAD_STEP_RAD));
  return { excess: f(dir), grad: v3(g[0], g[1], g[2]) };
}

/**
 * Twist excess past each limit, scaled by cos(swing / 2) so it fades toward the swing pole, and the exact gradient of
 * that product: the unit twist axis (the twist rate is that axis over cos(swing / 2)), plus the swing term the fading
 * needs. Leaving the swing term out is what let a twisted limb gain energy around a closed path.
 */
export function twistTerms(E: JointEnvelope, q: Quat, st: SwingTwist, sideSign: number, slackLo: number, slackHi: number): { hi: LimitTerm; lo: LimitTerm } {
  const tw = rangeTwistRad(E, st.twistRad, sideSign);
  const half = st.swingRad / 2;
  const reach = Math.cos(half);
  const dReach = scale(st.axis, -0.5 * Math.sin(half));
  const axis = scale(twistAxis(q, st), sideSign);
  const a = tw - (E.twistDeg[1] * Math.PI) / 180 - slackHi;
  const b = (E.twistDeg[0] * Math.PI) / 180 - tw - slackLo;
  return {
    hi: { excess: a * reach, grad: addScaled(axis, dReach, a) },
    lo: { excess: b * reach, grad: addScaled(scale(axis, -1), dReach, b) },
  };
}

/**
 * The envelope's restoring torque on the child (parent frame) from one energy per limit, U = integral over the excess
 * of min(k x, cap): torque = -(spring + damping) * gradient of the excess, the spring a function of that excess only,
 * so a closed path at rest returns exactly what it took. The damping acts along the same gradient and the total never
 * pulls (it is clamped to [0, cap]), so it can only remove energy from U plus the bodies' kinetic energy.
 */
export function envelopeMoments(E: JointEnvelope, q: Quat, sideSign: number, slack: Pick<EnvelopeRuntime, 'swingSlack' | 'twistSlackLo' | 'twistSlackHi'>, wParent: Vec3): { torque: Vec3; swing: LimitTerm; hi: LimitTerm; lo: LimitTerm } {
  const st = swingTwistOf(q);
  const swing = swingTerm(E, st.dir, sideSign, slack.swingSlack);
  const { hi, lo } = twistTerms(E, q, st, sideSign, slack.twistSlackLo, slack.twistSlackHi);
  let torque = v3();
  const push = (t: LimitTerm, k: number, c: number): void => {
    if (t.excess <= 0) return;
    const m = Math.min(E.maxTorqueNm, Math.max(0, Math.min(k * t.excess, E.maxTorqueNm) + c * dot(wParent, t.grad)));
    torque = addScaled(torque, t.grad, -m);
  };
  push(swing, E.swing.stiffnessNmPerRad, E.swing.dampingNmsPerRad);
  push(hi, E.twist.stiffnessNmPerRad, E.twist.dampingNmsPerRad);
  push(lo, E.twist.stiffnessNmPerRad, E.twist.dampingNmsPerRad);
  return { torque, swing, hi, lo };
}

/** Start the envelope at the handoff: whatever the accepted pose already exceeds becomes that joint's start slack. */
export function initEnvelope(rag: Ragdoll): void {
  if (!rag.profile.envelope) return;
  const out: EnvelopeRuntime[] = [];
  for (const j of rag.joints) {
    const E = envelopeOf(rag, j);
    if (!E) continue;
    const st = jointSwingTwist(rag, j);
    const s = j.sideSign ?? 1;
    const tw = rangeTwistRad(E, st.twistRad, s);
    const swingSlack = Math.max(0, swingExcess(E, st.dir, s).rad);
    const twistSlackHi = Math.max(0, tw - (E.twistDeg[1] * Math.PI) / 180);
    const twistSlackLo = Math.max(0, (E.twistDeg[0] * Math.PI) / 180 - tw);
    out.push({
      jointId: j.id,
      swingSlack,
      twistSlackLo,
      twistSlackHi,
      startOutsideDeg: (Math.max(swingSlack, twistSlackLo, twistSlackHi) * 180) / Math.PI,
      overDeg: 0,
      maxOverDeg: 0,
      maxNominalOverDeg: 0,
      overRunS: 0,
      maxOverRunS: 0,
      torque: v3(),
      wPre: v3(),
      passivePositiveJ: 0,
      passiveNegativeJ: 0,
    });
  }
  rag.envelope = out;
}

/**
 * Plan 09: one substep of the passive soft envelope, before the solve: a one-sided spring-damper torque pair on each
 * shoulder and hip, equal and opposite on child and parent, with no muscle budget. It never moves a body directly.
 */
export function applyEnvelope(rag: Ragdoll, dt: number): void {
  const P = rag.profile.envelope;
  if (!P || !rag.envelope) return;
  const decay = (P.slackDecayDegPerS * Math.PI * dt) / 180;
  const tolDeg = P.toleranceDeg;
  for (const e of rag.envelope) {
    const j = rag.joints.find((x) => x.id === e.jointId)!;
    const E = envelopeOf(rag, j)!;
    const s = j.sideSign ?? 1;
    const qp = rag.bodies[j.parent].rotation();
    const q = qMul(qConj(qp), rag.bodies[j.child].rotation());
    const st = swingTwistOf(q);
    const w = relativeOmega(rag, j);
    const over = swingExcess(E, st.dir, s).rad;
    const tw = rangeTwistRad(E, st.twistRad, s);
    const hi = (E.twistDeg[1] * Math.PI) / 180;
    const lo = (E.twistDeg[0] * Math.PI) / 180;
    // the slack only tightens: it follows a limb moving back inward, then decays at its bounded rate
    e.swingSlack = Math.max(0, Math.min(e.swingSlack, Math.max(0, over)) - decay);
    e.twistSlackHi = Math.max(0, Math.min(e.twistSlackHi, Math.max(0, tw - hi)) - decay);
    e.twistSlackLo = Math.max(0, Math.min(e.twistSlackLo, Math.max(0, lo - tw)) - decay);
    const M = envelopeMoments(E, q, s, e, qRot(qConj(qp), w));
    const torque = qRot(qp, M.torque);
    const overDeg = (Math.max(0, M.swing.excess, M.hi.excess, M.lo.excess) * 180) / Math.PI;
    const nominalDeg = (Math.max(0, over, Math.max(tw - hi, lo - tw) * Math.cos(st.swingRad / 2)) * 180) / Math.PI;
    if (len(torque) > 0) {
      rag.bodies[j.child].addTorque(torque, true);
      rag.bodies[j.parent].addTorque(scale(torque, -1), true);
    }
    e.torque = torque;
    e.wPre = w;
    e.maxNominalOverDeg = Math.max(e.maxNominalOverDeg, nominalDeg);
    e.overDeg = overDeg;
    e.maxOverDeg = Math.max(e.maxOverDeg, overDeg);
    e.overRunS = overDeg > tolDeg ? e.overRunS + dt : 0;
    e.maxOverRunS = Math.max(e.maxOverRunS, e.overRunS);
  }
}

/** Realized passive envelope work over the substep just solved (logged, never refunded to any effort budget). */
export function auditEnvelope(rag: Ragdoll, dt: number): void {
  if (!rag.envelope) return;
  for (const e of rag.envelope) {
    if (len(e.torque) === 0) continue;
    const j = rag.joints.find((x) => x.id === e.jointId)!;
    const w = scale(add(e.wPre, relativeOmega(rag, j)), 0.5);
    const work = dot(e.torque, w) * dt;
    if (work > 0) e.passivePositiveJ += work;
    else e.passiveNegativeJ -= work;
  }
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
  const out: PhysicalPose = { playerId: rag.playerId, segments, jointLandmarksWorld, hingeDeg, straightFallback: [], limbClearance: {} };
  if (rag.anklePitchDeg) out.anklePitchDeg = { ...rag.anklePitchDeg };
  if (rag.carry) out.carry = { ...rag.carry };
  return out;
}
