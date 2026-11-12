// Gate 4 passive ten-body ragdoll: candidate construction from the sim-owned PhysicalPose, geometry validation,
// bulk momentum transfer with an audit, and the atomic switch. Only PhysicsWorld/this module touch Rapier handles;
// PlayerId and segment identity live in collider tags and body userData.
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArmSide, ColliderRegion, ColliderTag, PlayerId, SegmentId } from './contracts';
import { CARRY_ARM, seatBallLocal, seatPalmLocal, type CarrySeat } from './carry';
import { boxSeg, cullGeom, geomNear, PHYS_LEG_KEY, type CullGeom, type PhysicsWorld } from './physics';
import { armSelfShapes, pelvisMidLocal, pitchShin, type PhysicalPose, type SegmentPose } from './pose';
import { anatomicalTwistReach, clampDirToEnvelope, limbAnatomicalTwistRad, swingExcess, swingExtentDeg } from './joint-cone';
import { applyHipApproach, hipNeutralFrame, initHipStop, initKneeStop, ratchetHipStop, ratchetKneeStop, type HipStopRuntime, type KneeStopRuntime } from './joint-stops';
import { hipLocal, shoulderLocal, sideSignX, type BodyProfile, type JointEnvelope, type JointRangeProfile, type RagdollProfile, type SelfClearanceProfile, type ShoulderTwistLimitProfile } from './profiles';
import {
  add, addScaled, composePose, cross, dist, dot, isFiniteVec, len, m3Add, m3Det, m3Inverse, m3ParallelAxis, m3Vec, norm, qConj, qFromAxisAngle, qFromUnitVectors, qIdentity, qMul, qRot, round, rv, scale,
  sub, toLocal, toWorld, v3, vc, worldInertia, type Mat3, type Pose, type Quat, type Vec3,
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

/** Ladder rung 9a: a leg's self shape, with a capsule holding it in its body's frame (`cap`, which culls its queries). */
export interface SelfLegShape extends RagdollCollider {
  cap: { a: Vec3; b: Vec3; r: number };
}

/** Plan 09: one spherical joint's soft envelope state since the handoff. */
export interface EnvelopeRuntime {
  jointId: string;
  /** Plan 10f (F6): the joint's index in `Ragdoll.joints`, so a substep does not search for it. */
  jointIndex: number;
  /** Range the joint started outside of (rad); it follows the limb inward and decays, so conversion adds no kick. */
  swingSlack: number;
  twistSlackLo: number;
  twistSlackHi: number;
  /** The largest start slack, deg: swing excess, or twist excess about the limb unscaled (the slack's own measure). */
  startOutsideDeg: number;
  /**
   * Excursion past the range in force (nominal plus slack) now, and the largest of it, deg; the same past the nominal
   * range. Plan 10c (C7): the twist term is the twist excess scaled by cos(swing / 2) (the envelope's moment measure), so
   * a twist overshoot reads smaller here than in `startOutsideDeg` at the same pose.
   */
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
  /**
   * Ankle pitch (deg) of the pose the candidate was built from: the shoe stays fixed on the shin at that angle. Plan 12
   * (`limpFoot`): the shoe's current pitch on the shin, easing toward the relaxed pitch.
   */
  anklePitchDeg?: Partial<Record<ArmSide, number>>;
  /**
   * Plan 12 joint range: the limp foot. From the conversion each shoe turns on its shin toward `targetDeg` at its own
   * rate (the conversion difference over the profile's ease time), its collider and landmark with it. Absent: profile off.
   */
  limpFoot?: { targetDeg: number; rateDegPerS: Record<ArmSide, number>; shoes: Record<ArmSide, RagdollCollider>; heldSubsteps: Record<ArmSide, number> };
  /** Plan 08a: the last supported hand and ball seat on the right forearm (frozen). */
  carry?: CarrySeat;
  /** Plan 09: soft envelope state of the shoulders and hips (absent: no envelope profile, or not switched yet). */
  envelope?: EnvelopeRuntime[];
  /** Plan 11 arm self-clearance: the forearms' self shapes and the core's trunk pieces (absent: profile off). */
  self?: { arms: RagdollCollider[]; trunk: RAPIER.Collider[] };
  /** Ladder rung 8d: the hips' hard stops since the build (absent: profile off). */
  hipStops?: HipStopRuntime[];
  /** Ladder rung 8f: the knees' flexion stops since the build (absent: profile off). */
  kneeStops?: KneeStopRuntime[];
  /**
   * Ladder rung 9a (`RagdollProfile.selfLegs`): each leg's self shapes (distal thigh, shin, shoe; massless, not in
   * `colliders`), the own trunk pieces they meet (plan 11's when it built them) and the pairs left out of the solve
   * since the switch until their group is within the skin (`selfLegPair` keys). Absent: profile off.
   */
  selfLegs?: { legs: SelfLegShape[]; trunk: RAPIER.Collider[]; off: string[] };
  /**
   * Ladder 17 (`RagdollProfile.bornOverlap`): the collider pairs this ragdoll was switched in overlapping (or another
   * ragdoll's pair carried onto this one's collider), left out of the solve until no deeper than the profile's
   * `releaseM`. Absent or empty: none (profile off, or every pair released).
   */
  born?: BornPair[];
}

/** Ladder 17: one collider pair left out of the solve since a switch (`Ragdoll.born`). */
export interface BornPair {
  /** This ragdoll's segment collider and the other body's collider (engine handles). */
  own: number;
  other: number;
  /** `segment:region` of the own collider, and the other collider's `player:key`. */
  ownKey: string;
  otherKey: string;
  /** When the pair was left out, its depth then and the deepest it has been since (m). */
  t0: number;
  depth0M: number;
  maxDepthM: number;
  /** A trunk or head in another trunk or head (converted at the end of the retry window). */
  gross: boolean;
}

/** Ladder 17: a candidate collider deeper than the tolerance in one external shape (`CandidateReport.born`). */
export interface BornPairRec {
  own: string;
  other: string;
  ownHandle: number;
  otherHandle?: number;
  /** Depth, and depth less the core counterpart's in the same shape (the new overlap). */
  depthM: number;
  newDepthM: number;
  /** A trunk or head in another trunk or head. */
  gross: boolean;
  /** Another body the solve cannot leave out of a pair: an obstacle, or a shape with no collider. */
  fixed: boolean;
  /** Another supported player's physical leg (out of the solve until clear by its own rule, `legsOffInsideConverted`). */
  leg: boolean;
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
  /** Ladder 17 (`RagdollProfile.bornOverlap`): every pair deeper than the tolerance, the floor's aside. Absent: profile off. */
  born?: BornPairRec[];
  /**
   * Ladder 17: the reasons the profile accepted the candidate with: `externalPenetration` (its born pairs left out of the
   * solve), `floorPenetration` (within `floorBornM`). Absent: profile off, or nothing tolerated.
   */
  tolerated?: string[];
}

/** External collision geometry a candidate is validated against (opponents, floor, other candidates). */
export interface ExternalShape {
  key: string;
  shape: RAPIER.Shape;
  pose: Pose;
  /** Floor (penetration counted against the floor tolerance as well). */
  floor?: boolean;
  /**
   * Plan 13a: the live collider at `pose`, when the shape is one, so a query converts only the other shape. Set only where
   * no physics step runs between the capture and the queries.
   */
  collider?: RAPIER.Collider;
  /**
   * Ladder 17 (`RagdollProfile.bornOverlap`): the engine handle and tag of the collider the shape is, where the conversion
   * gives them (a pair the solve can leave out); absent elsewhere.
   */
  handle?: number;
  tag?: ColliderTag;
}

/** A rigid body's solved pose. */
export const poseOfRb = (rb: RAPIER.RigidBody): Pose => ({ p: vc(rb.translation()), q: { ...rb.rotation() } });

/** Signed twist angle (rad) of q about the local X axis (swing removed), in (-pi, pi]. */
export function twistX(q: Quat): number {
  let a = 2 * Math.atan2(q.x, q.w);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Arm self-clearance collider keys (tags): a trunk piece on the core, an arm self shape on a forearm. */
export const SELF_TRUNK_KEY = 'selfTrunk:';
export const SELF_ARM_KEY = 'selfArm:';
/** Ladder rung 9a: a leg's self shape (`selfLeg:<side>Thigh|Shin|Shoe`). */
export const SELF_LEG_KEY = 'selfLeg:';

/**
 * Ladder rung 9a: the pair key when two colliders (by their tags) are a pair of one ragdoll's own-leg contact, else null:
 * one leg's self shape against the other leg's (any of the three on either), or a shin or shoe shape against the own
 * trunk. Never a thigh against the trunk (jointed at the hip) or one leg's own shapes (jointed at the knee).
 */
export function selfLegPair(a: { playerId: PlayerId | null; key: string; region: ColliderRegion; side?: ArmSide }, b: { playerId: PlayerId | null; key: string; region: ColliderRegion; side?: ArmSide }): string | null {
  if (a.playerId === null || a.playerId !== b.playerId) return null;
  const la = a.key.startsWith(SELF_LEG_KEY);
  const lb = b.key.startsWith(SELF_LEG_KEY);
  const key = (): string => (a.key < b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`);
  if (la && lb) return a.side !== undefined && b.side !== undefined && a.side !== b.side ? key() : null;
  if (la && b.key.startsWith(SELF_TRUNK_KEY)) return a.region !== 'thigh' ? key() : null;
  if (lb && a.key.startsWith(SELF_TRUNK_KEY)) return b.region !== 'thigh' ? key() : null;
  return null;
}

/**
 * Ladder rung 9a: every own-leg contact pair of a ragdoll, with its key: the leg shape `a`, the other shape `b` (`bLeg`
 * when it is the other leg's) and the segment `b` is on (null: the trunk, on the core).
 */
export interface SelfLegPairRef {
  a: SelfLegShape;
  b: RAPIER.Collider;
  bLeg: SelfLegShape | null;
  seg: SegmentId | null;
  key: string;
}
export function selfLegPairs(phys: PhysicsWorld, rag: Ragdoll): SelfLegPairRef[] {
  const S = rag.selfLegs;
  if (!S) return [];
  const out: SelfLegPairRef[] = [];
  const tag = (c: RAPIER.Collider) => phys.tags.get(c.handle)!;
  S.legs.forEach((x, i) => {
    for (const y of S.legs.slice(i + 1)) {
      const k = selfLegPair(tag(x.collider), tag(y.collider));
      if (k) out.push({ a: x, b: y.collider, bLeg: y, seg: y.segment, key: k });
    }
    for (const t of S.trunk) {
      const k = selfLegPair(tag(x.collider), tag(t));
      if (k) out.push({ a: x, b: t, bLeg: null, seg: null, key: k });
    }
  });
  return out;
}

/** Cull bounds of a placed collider (`cullGeom`). */
const cullOf = (c: RAPIER.Collider): CullGeom => cullGeom(c.shape, vc(c.translation()), { ...c.rotation() });
/** Cull bounds of a leg's self shape: its capsule, placed (the collider is at its body's origin). */
function legCull(s: SelfLegShape): CullGeom {
  const P = { p: vc(s.collider.translation()), q: { ...s.collider.rotation() } };
  const a = toWorld(P, s.cap.a);
  const b = toWorld(P, s.cap.b);
  return { c: scale(add(a, b), 0.5), r: len(sub(b, a)) / 2 + s.cap.r, seg: { a, b, r: s.cap.r } };
}
/** Ladder rung 9a: the pair's shapes may be within `prediction` (m) of each other (cull bounds only, no shape query). */
export const selfLegNear = (p: SelfLegPairRef, prediction: number): boolean => geomNear(legCull(p.a), p.bLeg ? legCull(p.bLeg) : cullOf(p.b), prediction);

/**
 * Ladder rung 9a: the group of an own-leg pair, its two segments (`leftShin~rightThigh`, `leftShin~trunk`): a shin's
 * shape and its shoe's are one group, as they are one body.
 */
export const selfLegGroup = (p: SelfLegPairRef): string => [p.a.segment, p.seg ?? 'trunk'].sort().join('~');
/** The pair's shapes overlap deeper than `depth` (m). */
function selfLegDeep(p: SelfLegPairRef, depth: number): boolean {
  if (!selfLegNear(p, 0)) return false;
  const r = p.a.collider.contactCollider(p.b, 0);
  return r !== null && -r.distance > depth;
}

/**
 * Ladder rung 9a: at the switch, every pair of a group (`selfLegGroup`) in which any pair's shapes overlap deeper than
 * the skin (`SelfLegProfile.toleranceM`) is left out of the solve (`off`). The supported pose has no own-leg guard: a
 * pair starting inside each other would be pushed apart by the first solve, and two segments switched in crossed would
 * be held crossed by their other pairs. A pair within the skin of each other is in the solve from the start.
 */
export function holdOverlappingSelfLegs(phys: PhysicsWorld, rag: Ragdoll): void {
  if (!rag.selfLegs) return;
  const tol = rag.profile.selfLegs!.toleranceM;
  const pairs = selfLegPairs(phys, rag);
  const held = new Set(pairs.filter((p) => selfLegDeep(p, tol)).map(selfLegGroup));
  rag.selfLegs.off = pairs.filter((p) => held.has(selfLegGroup(p))).map((p) => p.key);
}

/** Ladder rung 9a: before a solve, a group left out since the switch takes part again once none of its pairs is deeper. */
export function releaseSelfLegs(phys: PhysicsWorld, rag: Ragdoll): void {
  const S = rag.selfLegs;
  if (!S || !S.off.length) return;
  const tol = rag.profile.selfLegs!.toleranceM;
  const held = selfLegPairs(phys, rag).filter((p) => S.off.includes(p.key));
  const deep = new Set(held.filter((p) => selfLegDeep(p, tol)).map(selfLegGroup));
  const out = new Set(held.filter((p) => !deep.has(selfLegGroup(p))).map((p) => p.key));
  if (out.size) S.off = S.off.filter((k) => !out.has(k));
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
  /** Arm self-clearance: with `ragdoll` on and a measured trunk, the forearms also collide with their own trunk. */
  selfClearance?: SelfClearanceProfile,
  /** Plan 12: the shoe starts at the pose's ankle pitch within the profile's range, then eases to its limp pitch. */
  jointRange?: JointRangeProfile,
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
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(p.x, p.y, p.z)
      .setRotation(sp.rotationWorld)
      .setEnabled(false)
      .setCanSleep(s.sleeping)
      .setCcdEnabled(s.ccd)
      .setSoftCcdPrediction(s.softCcdPredictionM)
      .setLinearDamping(s.linearDamping)
      .setAngularDamping(s.angularDamping);
    if (R.additionalPgsIterations) desc.setAdditionalPgsIterations(R.additionalPgsIterations);
    const rb = phys.world.createRigidBody(desc);
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
  const at = (x: number, y: number, z: number): Pose => ({ p: v3(x, y, z), q: qIdentity() });
  // shoe on the shin at the pose's ankle pitch (plan 06 pass 2; 0 = the rigid shoe of the procedural gait); plan 12:
  // within the joint-range profile's ankle range
  const JA = jointRange?.ankle;
  const pitch0 = (side: ArmSide): number => {
    const p = pose.anklePitchDeg?.[side] ?? 0;
    return JA ? Math.min(JA.plantarDeg, Math.max(-JA.dorsiDeg, p)) : p;
  };
  const shoeLocal = (side: ArmSide): Pose => shoeOnShin(R, pitch0(side));
  // palm landmark and the palm ball's centre on the forearm; plan 08a: the carry hand turned over the ball's nose
  const palmLocal = (side: ArmSide): { palm: Vec3; hand: Vec3 } => {
    if (side !== CARRY_ARM || !pose.carry) return { palm: v3(0, -(L.forearm + L.palmExtension), 0), hand: v3(0, -(L.forearm + L.palmExtension - R.radii.palm), 0) };
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
  // arm self-clearance: massless trunk pieces on the core and each forearm's self shapes (radii less the profile
  // tolerance, so the skin contact a supported pose may show converts without overlap). They meet only each other
  // within one player (the simulation's contact filter) and are not in `colliders` (no external query sees them).
  const trunk = selfClearance?.ragdoll && body.measured?.handTipM !== undefined ? body.measured.trunkHull : undefined;
  let selfCols: Ragdoll['self'];
  if (trunk && selfClearance) {
    const sc: NonNullable<Ragdoll['self']> = { arms: [], trunk: [] };
    selfCols = sc;
    const self = (seg: SegmentId, desc: RAPIER.ColliderDesc | null, local: Pose, key: string): void => {
      if (!desc) return;
      desc
        .setTranslation(local.p.x, local.p.y, local.p.z)
        .setRotation(local.q)
        .setMass(0)
        .setFriction(s.passiveFriction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule[s.passiveFrictionCombine])
        .setRestitution(s.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule[s.restitutionCombine])
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const c = phys.world.createCollider(desc, bodies[seg]);
      phys.addTag(c, playerId, seg, seg === 'core' ? 'torso' : 'forearm', key, SIDE_OF(seg));
      if (seg === 'core') sc.trunk.push(c);
      else sc.arms.push({ collider: c, segment: seg, region: 'forearm', side: SIDE_OF(seg), local });
    };
    trunk.forEach((pts, i) => self('core', RAPIER.ColliderDesc.convexHull(new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z]))), at(0, 0, 0), `${SELF_TRUNK_KEY}${i}`));
    const tol = selfClearance.toleranceM;
    for (const side of ['left', 'right'] as ArmSide[]) {
      const shapes = armSelfShapes({ forearm: R.radii.forearm - tol, palm: R.radii.palm - tol }, body.measured!.handTipM!, side, v3(), v3(0, -L.forearm, 0), palmLocal(side).palm);
      for (const sh of shapes) {
        if (sh.kind === 'ball') self(`${side}Forearm`, RAPIER.ColliderDesc.ball(sh.r), at(sh.c.x, sh.c.y, sh.c.z), `${SELF_ARM_KEY}${sh.key}`);
        else if (sh.kind === 'capsule') {
          const d = sub(sh.b, sh.a);
          const l = len(d);
          const r = sh.key.endsWith('HandSelf') ? Math.max(0.005, sh.r - tol) : sh.r;
          self(`${side}Forearm`, RAPIER.ColliderDesc.capsule(l / 2, r), { p: addScaled(sh.a, d, 0.5), q: qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / Math.max(l, 1e-9))) }, `${SELF_ARM_KEY}${sh.key}`);
        }
      }
    }
  }
  // ladder rung 9a: own-leg contact, massless self shapes on the thighs and shins and the trunk they meet (plan 11's
  // pieces when it built them; otherwise the measured trunk hull, or on an authored body the core's cuboids, as copies);
  // like plan 11's they are not in `colliders` and meet only each other (the simulation's contact filter, `selfLegPair`).
  // Each is a hull in its body's frame, the collider at the body origin with exactly zero mass properties, which Rapier
  // leaves out of the body's sum: mass, centre of mass and inertia stay bitwise (an offset massless collider re-rounds
  // them; rung 6's physical legs, `PhysicsWorld.addLegCollider`)
  const SL = R.selfLegs;
  let selfLegs: Ragdoll['selfLegs'];
  if (SL) {
    const sl: NonNullable<Ragdoll['selfLegs']> = { legs: [], trunk: [], off: [] };
    selfLegs = sl;
    const make = (seg: SegmentId, hull: { points: Vec3[]; r: number }, key: string, region: ColliderRegion): RAPIER.Collider => {
      const f = new Float32Array(hull.points.flatMap((p) => [p.x, p.y, p.z]));
      const desc = (hull.r > 0 ? RAPIER.ColliderDesc.roundConvexHull(f, hull.r) : RAPIER.ColliderDesc.convexHull(f))!
        .setMassProperties(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 })
        .setFriction(s.passiveFriction)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule[s.passiveFrictionCombine])
        .setRestitution(s.restitution)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule[s.restitutionCombine])
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS);
      const c = phys.world.createCollider(desc, bodies[seg]);
      phys.addTag(c, playerId, seg, region, key, SIDE_OF(seg));
      return c;
    };
    if (selfCols) sl.trunk = selfCols.trunk;
    else if (body.measured?.trunkHull) body.measured.trunkHull.forEach((pts, i) => sl.trunk.push(make('core', { points: pts, r: 0 }, `${SELF_TRUNK_KEY}${i}`, 'torso')));
    else [g.torso, g.pelvis].forEach((part, i) => sl.trunk.push(make('core', boxHull({ p: part.center, q: qIdentity() }, part.halfExtents, 0), `${SELF_TRUNK_KEY}${i}`, i ? 'pelvis' : 'torso')));
    const tol = SL.toleranceM;
    for (const side of ['left', 'right'] as ArmSide[]) {
      const leg = (seg: SegmentId, region: ColliderRegion, hull: { points: Vec3[]; r: number }, cap: SelfLegShape['cap']): void => {
        sl.legs.push({ collider: make(seg, hull, `${SELF_LEG_KEY}${side}${region[0].toUpperCase()}${region.slice(1)}`, region), segment: seg, region, side, local: at(0, 0, 0), cap });
      };
      const capsule = (seg: SegmentId, region: ColliderRegion, a: Vec3, b: Vec3, r: number): void => leg(seg, region, capsuleHull(a, b, r), { a, b, r: r + SELF_HULL_EPS_M });
      // the distal thigh: from `thighFromFraction` of the thigh to the knee, and the shin from the knee to the ankle, each
      // rounded about its joint (the segment capsules end there): two knees or ankles meeting hold their joints a whole
      // diameter apart however the bones meet, as a bone axis drawn to the joint reads them. The ends inside the same
      // leg's other segment never meet it (no pair)
      const rt = Math.min(R.radii.thigh - tol, SL.thighMaxRadiusM);
      capsule(`${side}Thigh`, 'thigh', v3(0, -L.thigh * SL.thighFromFraction, 0), v3(0, -L.thigh, 0), rt);
      capsule(`${side}Shin`, 'shin', v3(0, 0, 0), v3(0, -L.shin, 0), R.radii.shin - tol);
      // the shoe: the shoe box less the skin, where the shoe is on the shin
      leg(`${side}Shin`, 'shoe', boxHull(shoeLocal(side), R.shoe.halfExtents, tol), shoeCap(shoeLocal(side), R.shoe.halfExtents, tol));
    }
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
  const rag: Ragdoll = { playerId, profile: R, bodies, colliders, joints, landmarks, massKg: segMass, enabled: false, ...(selfCols ? { self: selfCols } : {}), ...(selfLegs ? { selfLegs } : {}) };
  // ladder rung 8d: the hips' stops in their anatomical frame, widened to where the pose starts each hip
  const HS = R.hipStops;
  if (HS)
    rag.hipStops = joints.flatMap((j, i) =>
      j.kind === 'hip' && j.side ? [initHipStop(j.joint, j.id, i, bodies[j.parent].rotation(), bodies[j.child].rotation(), hipNeutralFrame(body, j.side), HS, j.sideSign ?? 1)] : [],
    );
  // ladder rung 8f: the knees' flexion stop, widened to where the pose starts each knee (the hinge's limit stays)
  const KS = R.kneeFlexionStopDeg;
  if (KS !== undefined)
    rag.kneeStops = joints.flatMap((j, i) =>
      j.kind === 'knee' && j.limitsRad ? [initKneeStop(j.joint as RAPIER.RevoluteImpulseJoint, j.id, i, bodies[j.parent].rotation(), bodies[j.child].rotation(), j.limitsRad[0], j.limitsRad[1], KS)] : [],
    );
  if (pose.anklePitchDeg) rag.anklePitchDeg = { ...pose.anklePitchDeg };
  if (jointRange) {
    const F = jointRange.limpFoot;
    const from = { left: pitch0('left'), right: pitch0('right') };
    const shoe = (side: ArmSide): RagdollCollider => colliders.find((c) => c.segment === `${side}Shin` && c.region === 'shoe')!;
    rag.anklePitchDeg = { ...from };
    rag.limpFoot = {
      targetDeg: F.pitchDeg,
      rateDegPerS: { left: Math.abs(F.pitchDeg - from.left) / F.easeS, right: Math.abs(F.pitchDeg - from.right) / F.easeS },
      shoes: { left: shoe('left'), right: shoe('right') },
      heldSubsteps: { left: 0, right: 0 },
    };
  }
  if (pose.carry) {
    // plan 08a: the hand and ball stay as published on their forearm, with no further carry motion
    rag.carry = { ...pose.carry };
    landmarks.carriedBall = { seg: `${CARRY_ARM}Forearm`, local: seatBallLocal(pose.carry) };
  }
  return rag;
}

/** Hull half-width of a capsule's segment (m): the capsule is a thin box about it rounded by its radius less this. */
const SELF_HULL_EPS_M = 2e-4;
/** Ladder rung 9a: a capsule from `a` to `b` (radius `r`) as a rounded hull in its body's frame. */
function capsuleHull(a: Vec3, b: Vec3, r: number): { points: Vec3[]; r: number } {
  const E = SELF_HULL_EPS_M;
  const d = norm(sub(b, a), v3(0, 1, 0));
  const u = norm(cross(d, Math.abs(d.x) < 0.9 ? v3(1, 0, 0) : v3(0, 0, 1)), v3(0, 0, 1));
  const w = cross(d, u);
  const points: Vec3[] = [];
  for (const e of [a, b]) for (const su of [-1, 1]) for (const sw of [-1, 1]) points.push(add(e, add(scale(u, su * E), scale(w, sw * E))));
  return { points, r: r - E };
}
/** Ladder rung 9a: the capsule enclosing a box at `pose` (half extents `he` less `shrink`; `boxSeg`). */
const shoeCap = (pose: Pose, he: Vec3, shrink: number): SelfLegShape['cap'] => boxSeg(pose.p, sub(he, v3(shrink, shrink, shrink)), pose.q);
/** Ladder rung 9a: a box at `pose` (half extents `he` less `shrink`) as a hull in its body's frame. */
function boxHull(pose: Pose, he: Vec3, shrink: number): { points: Vec3[]; r: number } {
  const points: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) points.push(add(pose.p, qRot(pose.q, v3(sx * (he.x - shrink), sy * (he.y - shrink), sz * (he.z - shrink)))));
  return { points, r: 0 };
}

/** The shoe box's pose on its shin at an ankle pitch (deg, positive toe down), in the shin frame. */
function shoeOnShin(R: RagdollProfile, pitchDeg: number): Pose {
  const q = pitchShin(qIdentity(), (pitchDeg * Math.PI) / 180);
  return { p: add(v3(0, -R.lengths.shin, 0), qRot(q, v3(0, -R.shoe.belowAnkleM, R.shoe.forwardM))), q };
}

/**
 * Plan 12: one substep of the limp foot, before the solve. Each shoe turns on its shin toward the relaxed pitch at its
 * rate; the collider's pose on the shin, its recorded local pose, the shoe landmark and the published pitch follow. The
 * shin's mass properties are recomputed at once: Rapier 0.21 does update them for a collider moved on its body, but only
 * at the next step, after this substep's effort planning has read them (`.scratch/jr12/mass.ts`).
 */
export function easeLimpFeet(rag: Ragdoll, dt: number, blocked?: (c: RagdollCollider, from: Pose, to: Pose) => boolean): void {
  const F = rag.limpFoot;
  if (!F || !rag.enabled || !rag.anklePitchDeg) return;
  for (const side of ['left', 'right'] as ArmSide[]) {
    const cur = rag.anklePitchDeg[side] ?? 0;
    if (cur === F.targetDeg) continue;
    const step = F.rateDegPerS[side] * dt;
    const next = Math.abs(F.targetDeg - cur) <= step ? F.targetDeg : cur + Math.sign(F.targetDeg - cur) * step;
    const local = shoeOnShin(rag.profile, next);
    const c = F.shoes[side];
    // the plan's contact fallback: the turn is kinematic (no contact pushes back), so a shoe that would turn deeper into
    // another player waits (L3-F9-noProbe-contact: R's right shoe turned 1.5 cm into D's thigh and D's conversion failed)
    if (blocked) {
      const shin = poseOfRb(rag.bodies[`${side}Shin`]);
      if (blocked(c, composePose(shin, c.local), composePose(shin, local))) {
        F.heldSubsteps[side]++;
        continue;
      }
    }
    rag.anklePitchDeg[side] = next;
    c.collider.setTranslationWrtParent(local.p);
    c.collider.setRotationWrtParent(local.q);
    c.local = local;
    // ladder rung 9a: the shoe's self shape turns with it (its hull is in the shin frame)
    const own = rag.selfLegs?.legs.find((x) => x.region === 'shoe' && x.side === side);
    if (own && rag.profile.selfLegs) {
      const tol = rag.profile.selfLegs.toleranceM;
      own.collider.setShape(new RAPIER.ConvexPolyhedron(new Float32Array(boxHull(local, rag.profile.shoe.halfExtents, tol).points.flatMap((p) => [p.x, p.y, p.z])), undefined));
      own.cap = shoeCap(local, rag.profile.shoe.halfExtents, tol);
    }
    rag.landmarks[`${side}Shoe`].local = local.p;
    rag.bodies[`${side}Shin`].recomputeMassPropertiesFromColliders();
  }
}

/** Ladder rung 8d: one substep of the hips' stops, before the solve (`ratchetHipStop`); an enabled ragdoll only. */
export function ratchetHipStops(rag: Ragdoll): void {
  if (!rag.hipStops || !rag.enabled) return;
  for (const h of rag.hipStops) {
    const j = rag.joints[h.jointIndex];
    ratchetHipStop(h, j.joint, rag.bodies[j.parent].rotation(), rag.bodies[j.child].rotation());
  }
}

/** Ladder rung 8g: one substep of the hips' approach zones, before the solve (`applyHipApproach`); an enabled ragdoll only. */
export function applyHipApproaches(rag: Ragdoll, dt: number): void {
  const A = rag.profile.hipStops?.approach;
  if (!A || !rag.hipStops || !rag.enabled) return;
  for (const h of rag.hipStops) {
    const j = rag.joints[h.jointIndex];
    applyHipApproach(h, A, rag.bodies[j.parent], rag.bodies[j.child], j.anchorChildLocal, dt);
  }
}

/** Ladder rung 8f: one substep of the knees' flexion stops, before the solve (`ratchetKneeStop`); an enabled ragdoll only. */
export function ratchetKneeStops(rag: Ragdoll): void {
  if (!rag.kneeStops || !rag.enabled) return;
  for (const k of rag.kneeStops) {
    const j = rag.joints[k.jointIndex];
    ratchetKneeStop(k, j.joint as RAPIER.RevoluteImpulseJoint, j.limitsRad![0], rag.bodies[j.parent].rotation(), rag.bodies[j.child].rotation());
  }
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

/** Angle wrapped to (-pi, pi] by whole turns (exact, unlike `vec.wrapPi`'s atan2; the recorded twist limits use this). */
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

// plan 12: the swing cone moved to joint-cone.ts (shared with the supported pose and the arm-task arms)
export { clampDirToEnvelope, swingExcess, swingExtentDeg };

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

/** Twist from the joint's neutral (rad), positive external on either side. */
export const externalTwistRad = (E: JointEnvelope, twistRad: number, sideSign: number): number => wrapPi(sideSign * (twistRad - (E.neutralTwistDeg * Math.PI) / 180));

const envelopeOf = (rag: Ragdoll, j: RagdollJoint): JointEnvelope | null => (j.kind === 'shoulder' ? rag.profile.envelope?.shoulder ?? null : j.kind === 'hip' ? rag.profile.envelope?.hip ?? null : null);

function jointSwingTwist(rag: Ragdoll, j: RagdollJoint): SwingTwist {
  return swingTwistOf(qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation()));
}

/** Ladder 13a: the anatomical twist limit a joint of this ragdoll reads (a shoulder under `shoulderTwistLimit`), else undefined. */
const anatOf = (rag: Ragdoll, j: RagdollJoint): ShoulderTwistLimitProfile | undefined => (j.kind === 'shoulder' ? rag.profile.shoulderTwistLimit : undefined);

/** World unit axes along which a relative rotation raises this joint's swing excess and external twist. */
export function limitGradients(rag: Ragdoll, j: RagdollJoint): { swing: Vec3; twist: Vec3 } {
  const q = qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation());
  const st = swingTwistOf(q);
  const qp = rag.bodies[j.parent].rotation();
  const s = j.sideSign ?? 1;
  const E = envelopeOf(rag, j)!;
  // ladder 13a: a raised arm under the anatomical limit, the direction raising that twist
  const twist = anatOf(rag, j) && st.dir.y > 0 ? norm(anatomicalTwistGrad(E, q, s), v3(1, 0, 0)) : scale(twistAxis(q, st), s);
  return { swing: qRot(qp, swingExcess(E, st.dir, s).axis), twist: qRot(qp, twist) };
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
 * Ladder 13a: the anatomical twist of a relative rotation (rad, positive external, wrapped half a turn from the middle of
 * the twist range as `rangeTwistRad`) and the scale of its excess (`anatomicalTwistReach`).
 */
export function anatomicalTwist(E: JointEnvelope, q: Quat, sideSign: number): { tw: number; reach: number } {
  const dir = qRot(q, REF);
  const mid = (((E.twistDeg[0] + E.twistDeg[1]) / 2) * Math.PI) / 180;
  return { tw: mid + wrapPi(limbAnatomicalTwistRad(E, dir, qRot(q, v3(1, 0, 0)), sideSign) - mid), reach: anatomicalTwistReach(dir) };
}

/** Ladder 13a: the anatomical twist at q turned by `rad` about parent axis `a`, unwrapped next to `tw0`, and its reach there. */
function anatomicalTwistAt(E: JointEnvelope, q: Quat, sideSign: number, a: Vec3, rad: number, tw0: number): { tw: number; reach: number } {
  const t = anatomicalTwist(E, qMul(qFromAxisAngle(a, rad), q), sideSign);
  return { tw: tw0 + wrapPi(t.tw - tw0), reach: t.reach };
}

/** Ladder 13a: the anatomical twist's rate per unit relative rotation about each parent axis (central differences). */
function anatomicalTwistGrad(E: JointEnvelope, q: Quat, sideSign: number): Vec3 {
  const tw0 = anatomicalTwist(E, q, sideSign).tw;
  const g = AXES.map((a) => (anatomicalTwistAt(E, q, sideSign, a, GRAD_STEP_RAD, tw0).tw - anatomicalTwistAt(E, q, sideSign, a, -GRAD_STEP_RAD, tw0).tw) / (2 * GRAD_STEP_RAD));
  return v3(g[0], g[1], g[2]);
}

/**
 * Ladder 13a (`ShoulderTwistLimitProfile`): `twistTerms` in the anatomical twist, each excess scaled by
 * `anatomicalTwistReach`, with the exact gradient of that product by central differences about each parent axis (the
 * twist unwrapped about its value here, so a limit read across the wrap keeps its slope). The same function as
 * `twistTerms` for an arm at or below horizontal, where `envelopeMoments` keeps that one.
 */
export function anatomicalTwistTerms(E: JointEnvelope, q: Quat, sideSign: number, slackLo: number, slackHi: number): { hi: LimitTerm; lo: LimitTerm } {
  const hiR = (E.twistDeg[1] * Math.PI) / 180 + slackHi;
  const loR = (E.twistDeg[0] * Math.PI) / 180 - slackLo;
  const c = anatomicalTwist(E, q, sideSign);
  const gHi: number[] = [];
  const gLo: number[] = [];
  for (const a of AXES) {
    const p = anatomicalTwistAt(E, q, sideSign, a, GRAD_STEP_RAD, c.tw);
    const m = anatomicalTwistAt(E, q, sideSign, a, -GRAD_STEP_RAD, c.tw);
    gHi.push(((p.tw - hiR) * p.reach - (m.tw - hiR) * m.reach) / (2 * GRAD_STEP_RAD));
    gLo.push(((loR - p.tw) * p.reach - (loR - m.tw) * m.reach) / (2 * GRAD_STEP_RAD));
  }
  return {
    hi: { excess: (c.tw - hiR) * c.reach, grad: v3(gHi[0], gHi[1], gHi[2]) },
    lo: { excess: (loR - c.tw) * c.reach, grad: v3(gLo[0], gLo[1], gLo[2]) },
  };
}

/**
 * The envelope's restoring torque on the child (parent frame) from one energy per limit, U = integral over the excess
 * of min(k x, cap): torque = -(spring + damping) * gradient of the excess, the spring a function of that excess only,
 * so a closed path at rest returns exactly what it took. The damping acts along the same gradient and the total never
 * pulls (it is clamped to [0, cap]), so it can only remove energy from U plus the bodies' kinetic energy.
 */
export function envelopeMoments(E: JointEnvelope, q: Quat, sideSign: number, slack: Pick<EnvelopeRuntime, 'swingSlack' | 'twistSlackLo' | 'twistSlackHi'>, wParent: Vec3, anat?: ShoulderTwistLimitProfile): { torque: Vec3; swing: LimitTerm; hi: LimitTerm; lo: LimitTerm } {
  const st = swingTwistOf(q);
  const swing = swingTerm(E, st.dir, sideSign, slack.swingSlack);
  // ladder 13a: a raised limb under the anatomical limit (`anat`); at or below horizontal the two are the same terms
  const { hi, lo } = anat && st.dir.y > 0 ? anatomicalTwistTerms(E, q, sideSign, slack.twistSlackLo, slack.twistSlackHi) : twistTerms(E, q, st, sideSign, slack.twistSlackLo, slack.twistSlackHi);
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
  for (const [jointIndex, j] of rag.joints.entries()) {
    const E = envelopeOf(rag, j);
    if (!E) continue;
    const st = jointSwingTwist(rag, j);
    const s = j.sideSign ?? 1;
    // ladder 13a: a raised arm under the anatomical limit starts with that twist's excess as its slack
    const tw = anatOf(rag, j) && st.dir.y > 0 ? anatomicalTwist(E, qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation()), s).tw : rangeTwistRad(E, st.twistRad, s);
    const swingSlack = Math.max(0, swingExcess(E, st.dir, s).rad);
    const twistSlackHi = Math.max(0, tw - (E.twistDeg[1] * Math.PI) / 180);
    const twistSlackLo = Math.max(0, (E.twistDeg[0] * Math.PI) / 180 - tw);
    out.push({
      jointId: j.id,
      jointIndex,
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
    const j = rag.joints[e.jointIndex];
    const E = envelopeOf(rag, j)!;
    const s = j.sideSign ?? 1;
    const qp = rag.bodies[j.parent].rotation();
    const q = qMul(qConj(qp), rag.bodies[j.child].rotation());
    const st = swingTwistOf(q);
    const w = relativeOmega(rag, j);
    const over = swingExcess(E, st.dir, s).rad;
    // ladder 13a: a raised arm under the anatomical limit reads that twist and its reach
    const anat = anatOf(rag, j);
    const at = anat && st.dir.y > 0 ? anatomicalTwist(E, q, s) : null;
    const tw = at ? at.tw : rangeTwistRad(E, st.twistRad, s);
    const reach = at ? at.reach : Math.cos(st.swingRad / 2);
    const hi = (E.twistDeg[1] * Math.PI) / 180;
    const lo = (E.twistDeg[0] * Math.PI) / 180;
    // the slack only tightens: it follows a limb moving back inward, then decays at its bounded rate
    e.swingSlack = Math.max(0, Math.min(e.swingSlack, Math.max(0, over)) - decay);
    e.twistSlackHi = Math.max(0, Math.min(e.twistSlackHi, Math.max(0, tw - hi)) - decay);
    e.twistSlackLo = Math.max(0, Math.min(e.twistSlackLo, Math.max(0, lo - tw)) - decay);
    const M = envelopeMoments(E, q, s, e, qRot(qConj(qp), w), anat);
    const torque = qRot(qp, M.torque);
    const overDeg = (Math.max(0, M.swing.excess, M.hi.excess, M.lo.excess) * 180) / Math.PI;
    const nominalDeg = (Math.max(0, over, Math.max(tw - hi, lo - tw) * reach) * 180) / Math.PI;
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
    const j = rag.joints[e.jointIndex];
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

/** The prediction of a candidate's depth queries (only a negative distance, a depth, is read). */
const DEPTH_QUERY_M = 0.05;

/**
 * The deepest penetration of `shape` at `pose` into the external shapes (`geoms`: their cull geometry, in order). Ladder
 * 9g: a pair farther apart than the query's prediction returns nothing, so it is not queried (plan 13a's cull, exact).
 */
function depthAgainst(shape: RAPIER.Shape, pose: Pose, ext: ExternalShape[], geoms: CullGeom[]): { depth: number; other: string; floor: number } {
  let depth = 0;
  let other = '';
  let floor = 0;
  const g = cullGeom(shape, pose.p, pose.q);
  for (let i = 0; i < ext.length; i++) {
    const e = ext[i];
    if (!geomNear(geoms[i], g, DEPTH_QUERY_M)) continue;
    const r = e.shape.contactShape(e.pose.p, e.pose.q, shape, pose.p, pose.q, DEPTH_QUERY_M);
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

/** Ladder 17: the depth of `shape` at `pose` in each external shape (0 where none), by index; `depthAgainst`'s queries. */
function depthsAgainst(shape: RAPIER.Shape, pose: Pose, ext: ExternalShape[], geoms: CullGeom[]): number[] {
  const out = new Array<number>(ext.length).fill(0);
  const g = cullGeom(shape, pose.p, pose.q);
  for (let i = 0; i < ext.length; i++) {
    const e = ext[i];
    if (!geomNear(geoms[i], g, DEPTH_QUERY_M)) continue;
    const r = e.shape.contactShape(e.pose.p, e.pose.q, shape, pose.p, pose.q, DEPTH_QUERY_M);
    if (r) out[i] = Math.max(0, -r.distance);
  }
  return out;
}

/** Ladder 17: `depthAgainst` read off per-shape depths (the same deepest, first such shape and floor depth). */
function deepestOf(ds: number[], ext: ExternalShape[]): { depth: number; other: string; floor: number } {
  let depth = 0;
  let other = '';
  let floor = 0;
  ds.forEach((d, i) => {
    if (ext[i].floor) floor = Math.max(floor, d);
    if (d > depth) {
      depth = d;
      other = ext[i].key;
    }
  });
  return { depth, other, floor };
}

/** Ladder 17: a trunk or head collider by its tag (a proxy's support capsule, torso, pelvis or head; a ragdoll's core or head). */
const isTrunkTag = (t: ColliderTag): boolean => (t.part === 'core' || t.part === 'head') && !t.key.startsWith(PHYS_LEG_KEY);

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
  const geoms = ext.map((e) => cullGeom(e.shape, e.pose.p, e.pose.q));
  const BO = R.bornOverlap;
  let born: BornPairRec[] | undefined;
  const tolerated: string[] = [];
  if (!BO) {
    for (const cp of Object.values(counterparts)) if (cp) proxyCoreDepth = Math.max(proxyCoreDepth, depthAgainst(cp.shape, cp.pose, ext, geoms).depth);
    for (const c of rag.colliders) {
      const p = colliderWorldPose(rag, c);
      const d = depthAgainst(c.collider.shape, p, ext, geoms);
      floorPen = Math.max(floorPen, d.floor);
      let base = 0;
      const cp = c.segment === 'core' || c.segment === 'head' ? counterparts[c.region] : undefined;
      if (cp) base = depthAgainst(cp.shape, cp.pose, ext, geoms).depth;
      const nd = Math.max(0, d.depth - base);
      if (nd > maxNew) {
        maxNew = nd;
        worst = { depthM: d.depth, newDepthM: nd, own: `${c.segment}:${c.region}`, other: d.other };
      }
    }
    if (floorPen > V.penetrationTolM) reasons.push('floorPenetration');
    if (maxNew > V.penetrationTolM) reasons.push('externalPenetration');
  } else {
    // ladder 17 (`bornOverlap`): the same depths, shape by shape (maxNew and worst as above, the meter), and every pair
    // deeper than the tolerance: new overlap, a core or head counterpart's depth in the same shape taken off
    born = [];
    const cpDepths: Partial<Record<ColliderRegion, number[]>> = {};
    for (const [region, cp] of Object.entries(counterparts) as [ColliderRegion, { shape: RAPIER.Shape; pose: Pose } | undefined][]) {
      if (!cp) continue;
      const ds = depthsAgainst(cp.shape, cp.pose, ext, geoms);
      cpDepths[region] = ds;
      proxyCoreDepth = Math.max(proxyCoreDepth, deepestOf(ds, ext).depth);
    }
    let fixedOver = false;
    let grossOver = false;
    let limbOver = false;
    for (const c of rag.colliders) {
      const p = colliderWorldPose(rag, c);
      const ds = depthsAgainst(c.collider.shape, p, ext, geoms);
      const d = deepestOf(ds, ext);
      floorPen = Math.max(floorPen, d.floor);
      const trunk = c.segment === 'core' || c.segment === 'head';
      const cpd = trunk ? cpDepths[c.region] : undefined;
      const base = cpd ? deepestOf(cpd, ext).depth : 0;
      const nd = Math.max(0, d.depth - base);
      const own = `${c.segment}:${c.region}`;
      if (nd > maxNew) {
        maxNew = nd;
        worst = { depthM: d.depth, newDepthM: nd, own, other: d.other };
      }
      ds.forEach((di, i) => {
        const e = ext[i];
        if (e.floor) return;
        const ni = Math.max(0, di - (cpd ? cpd[i] : 0));
        if (ni <= V.penetrationTolM) return;
        const t = e.tag;
        // (an obstacle, as the floor: in the solve, within floorBornM; a shape with no collider: never)
        const fixed = !t || t.playerId === null || e.handle === undefined;
        const leg = !!t && t.key.startsWith(PHYS_LEG_KEY);
        const gross = !fixed && trunk && isTrunkTag(t!);
        if (fixed && (!t || e.handle === undefined || ni > BO.floorBornM)) fixedOver = true;
        else if (gross) grossOver = true;
        else limbOver = true;
        born!.push({ own, other: e.key, ownHandle: c.collider.handle, ...(e.handle !== undefined ? { otherHandle: e.handle } : {}), depthM: di, newDepthM: ni, gross, fixed, leg });
      });
    }
    if (floorPen > BO.floorBornM) reasons.push('floorPenetration');
    else if (floorPen > V.penetrationTolM) tolerated.push('floorPenetration');
    if (fixedOver || grossOver) reasons.push('externalPenetration');
    else if (limbOver) tolerated.push('externalPenetration');
  }
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
    ...(born ? { born } : {}),
    ...(tolerated.length ? { tolerated } : {}),
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
  const det = m3Det(Iasm);
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
