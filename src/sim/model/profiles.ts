// Model-derived profiles for the supplied player (models/bew-v6.glb): one measured geometry contract shared by the
// proxy body, the arm queries, the physical pose, the candidate bodies and the rule observer's limb classification.
// Every geometric number is read from bew-v6.calibration.json (scripts/calibrate-model.ts, measured from the committed
// GLB, Basis shape only); non-geometric values (masses, gains, limits, tolerances) are the Gate 2-4 values unchanged.
// The authored Gate 1-4 profiles are untouched; these carry their own ids.
import CAL from './bew-v6.calibration.json';
import type { ModelCalibration, Tuple3 } from './calibration-types';
import { carryPalmLocal, proceduralLocal } from '../pose';
import { ARM_G2, AUTHORED_BALL_LOCAL, RAGDOLL_G4, upperBodyCompound, type ArmProfile, type BodyProfile, type RagdollProfile, type RuleProfile } from '../profiles';
import { v3, type Vec3 } from '../vec';

export const MODEL_CALIBRATION = CAL as unknown as ModelCalibration;
const C = MODEL_CALIBRATION;
export const MODEL_CALIBRATION_ID = `bew-v6:${C.asset.sha256.slice(0, 12)}`;

const t3 = (a: Tuple3): Vec3 => v3(a[0], a[1], a[2]);
/** Bilateral landmark pair as the right-side point of a mirror-symmetric profile (mean of R and mirrored L). */
function symRight(r: Tuple3, l: Tuple3): Vec3 {
  return v3(C.frame.rightSignX * 0.5 * (Math.abs(r[0]) + Math.abs(l[0])), 0.5 * (r[1] + l[1]), 0.5 * (r[2] + l[2]));
}

/** Shoulder-to-palm-contact chain (m). */
export const MODEL_ARM_CHAIN_M = C.lengths.upperArm + C.lengths.forearm + C.lengths.palmExtension;
const lm = C.landmarks;
const hipRight = symRight(lm.rightHip, lm.leftHip);
const thighShin = C.lengths.thigh + C.lengths.shin;
/** Authored gait leg extension: ankle target 0.78 m below the hip on a 0.80 m leg (pose.ts AUTHORED_ANKLE_Y). */
const AUTHORED_LEG_EXTENSION = 0.78 / 0.8;

/**
 * Model body: the calibrated trunk boxes, helmet sphere, shoulder/hip/neck landmarks and the asset's anatomical side
 * basis (right on -X). Mass, mass fractions, the support shape and its balance radius stay those of `base` (the proxy
 * support is the Gate 1-4 shape the motors and balance were authored on; the ten-body physics model is unchanged).
 */
export function modelBody(base: BodyProfile = upperBodyCompound()): BodyProfile {
  if (base.kind !== 'upperBodyCompound') throw new Error(`modelBody: base ${base.id} is not an upper-body compound`);
  if (Math.abs(base.restOriginY - C.frame.restOriginY) > 1e-9) throw new Error(`modelBody: rest origin ${base.restOriginY} differs from the calibration's ${C.frame.restOriginY}`);
  const headCenter = t3(C.helmet.center);
  return {
    ...base,
    id: `${base.id}+${MODEL_CALIBRATION_ID}`,
    compound: {
      support: { ...base.compound.support, center: { ...base.compound.support.center } },
      torso: { center: t3(C.torso.center), halfExtents: t3(C.torso.halfExtents) },
      pelvis: { center: t3(C.pelvis.center), halfExtents: t3(C.pelvis.halfExtents) },
      head: { center: headCenter, radius: C.radii.head },
    },
    shoulderRight: symRight(lm.rightShoulder, lm.leftShoulder),
    hipRight,
    neck: t3(lm.neck),
    headCenter: { ...headCenter },
    measured: {
      calibrationId: MODEL_CALIBRATION_ID,
      rightSignX: C.frame.rightSignX,
      pelvisMid: t3(lm.pelvisMid),
      ankleTargetY: hipRight.y - AUTHORED_LEG_EXTENSION * thighShin,
      armChainM: MODEL_ARM_CHAIN_M,
    },
  };
}

/** Reference model body (shoulder geometry and side basis do not depend on mass). */
const REF_BODY = modelBody();

/**
 * Model arm profile: calibrated segment lengths, radii and palm contact; reach limits keep the authored margins
 * (max = chain - 0.02 m, min 0.12 m); the rest palm is the authored rest palm relative to the shoulder, scaled by the
 * chain, on the anatomical right (-X). Hold, clamp and wrap laws are `base`'s.
 */
export function modelArm(base: ArmProfile = ARM_G2): ArmProfile {
  const authoredChain = base.upperArmM + base.forearmM + base.palmExtensionM;
  return {
    ...base,
    id: `${base.id}+${MODEL_CALIBRATION_ID}`,
    upperArmM: C.lengths.upperArm,
    forearmM: C.lengths.forearm,
    palmExtensionM: C.lengths.palmExtension,
    maxReachM: MODEL_ARM_CHAIN_M - (authoredChain - base.maxReachM),
    minReachM: base.minReachM,
    upperArmRadiusM: C.radii.upperArm,
    forearmRadiusM: C.radii.forearm,
    palmRadiusM: C.radii.palm,
    restPalmRight: proceduralLocal(REF_BODY, 'right', v3(base.restPalmRight.x * C.frame.rightSignX, base.restPalmRight.y, base.restPalmRight.z)),
  };
}

/**
 * Model ragdoll profile: the ten bodies with calibrated lengths, capsule radii, palm ball and shoe box (in the shin
 * frame: centre below the ankle and forward, as measured). Mass fractions, joint limits, validation and audit
 * tolerances, passive grip and the end band are `base`'s.
 */
export function modelRagdoll(base: RagdollProfile = RAGDOLL_G4): RagdollProfile {
  return {
    ...base,
    id: `${base.id}+${MODEL_CALIBRATION_ID}`,
    lengths: { upperArm: C.lengths.upperArm, forearm: C.lengths.forearm, palmExtension: C.lengths.palmExtension, thigh: C.lengths.thigh, shin: C.lengths.shin },
    radii: { upperArm: C.radii.upperArm, forearm: C.radii.forearm, palm: C.radii.palm, thigh: C.radii.thigh, shin: C.radii.shin, head: C.radii.head },
    shoe: { halfExtents: t3(C.shoe.halfExtents), belowAnkleM: -C.shoe.centerShin[1], forwardM: C.shoe.centerShin[2] },
  };
}

/**
 * Carry reference for a model runner: the authored ball offset relative to the shoulder (scaled by the chain) on the
 * anatomical right, tucked against the carry palm (carryPalmLocal) as the authored ball is.
 */
export function modelBallLocal(body: BodyProfile = REF_BODY): Vec3 {
  return proceduralLocal(body, 'right', v3(AUTHORED_BALL_LOCAL.x * C.frame.rightSignX, AUTHORED_BALL_LOCAL.y, AUTHORED_BALL_LOCAL.z));
}

export function modelRules(r: RuleProfile, runnerBody: BodyProfile = REF_BODY): RuleProfile {
  return { ...r, id: `${r.id}+${MODEL_CALIBRATION_ID}`, ballLocal: modelBallLocal(runnerBody) };
}

export { carryPalmLocal };
