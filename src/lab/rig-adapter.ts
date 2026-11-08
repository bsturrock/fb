// Rig adapter: drives the supplied player's skeleton (models/bew-v6.glb, Mixamo names) from the simulation-owned
// achieved pose (PlayerRuntime.pose or its render interpolation), never from requested targets. The same mapping runs
// before and after a ragdoll handoff: both representations publish the same PhysicalPose segment frames.
//
// For a driven bone b on segment s:   boneWorld = segmentWorld * bindCorrection,
//   bindCorrection = segmentRest^-1 * boneRest   (both body-local, from the calibration record and the asset's rest).
// World targets are converted to parent-local transforms in hierarchy order. The model root and the Armature keep
// their rest placement; the Hips bone carries the player's placement (root placement happens once). Undriven bones
// (spine, clavicles, toes, fingers) keep their rest local transforms, so they follow their driven parents in
// the calibrated rest pose. Twist comes from each segment quaternion (no swing-only retargeting). The feet follow the
// shoe frame (the shin frame pitched by the pose's ankle angle; plan 06 pass 2). A carry seat (plan 08a) rolls the right
// forearm bone about the segment's long axis so the palm faces the ball, and flexes the hand over the nose about the
// calibrated wrist: the segment frame stays the hinge frame the physics and clearance use. Both take the hand's share of
// the seat (plan 10d D3, `seatHand` in carry.ts): an achieved arm's hand (an arm task's) is drawn unrolled and straight.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { SegmentId } from '../sim/contracts';
import type { PhysicalPose } from '../sim/pose';
import type { ModelCalibration } from '../sim/model/calibration-types';

/**
 * Bone key (GLB name without the Mixamo prefix). GLTFLoader sanitises node names (PropertyBinding drops ':'), so the
 * loaded bones are named `mixamorigHips`; the file's names are `mixamorig:Hips`. Both map to `Hips`.
 */
export function boneKey(name: string): string | null {
  const m = /^mixamorig:?(.+)$/.exec(name);
  return m ? m[1] : null;
}

/**
 * Segment driving each bone (GLB anatomical names; the model profiles use the same anatomical sides). A `foot` entry
 * is driven by that side's shin frame pitched by the pose's ankle angle about the calibrated rest ankle (at pitch 0
 * the foot is exactly its rest pose on the shin, as an undriven bone).
 */
export const RIG_MAP: ReadonlyArray<{ bone: string; segment: SegmentId; restOrigin: string; foot?: 'left' | 'right'; carry?: 'forearm' | 'hand' }> = [
  { bone: 'Hips', segment: 'core', restOrigin: 'core' },
  { bone: 'Neck', segment: 'head', restOrigin: 'neck' },
  { bone: 'Head', segment: 'head', restOrigin: 'neck' },
  ...(['Left', 'Right'] as const).flatMap((S) => {
    const s = S.toLowerCase() as 'left' | 'right';
    return [
      { bone: `${S}Arm`, segment: `${s}UpperArm` as SegmentId, restOrigin: `${s}Shoulder` },
      { bone: `${S}ForeArm`, segment: `${s}Forearm` as SegmentId, restOrigin: `${s}Elbow`, ...(s === 'right' ? { carry: 'forearm' as const } : {}) },
      { bone: `${S}Hand`, segment: `${s}Forearm` as SegmentId, restOrigin: `${s}Elbow`, ...(s === 'right' ? { carry: 'hand' as const } : {}) },
      { bone: `${S}UpLeg`, segment: `${s}Thigh` as SegmentId, restOrigin: `${s}Hip` },
      { bone: `${S}Leg`, segment: `${s}Shin` as SegmentId, restOrigin: `${s}Knee` },
      { bone: `${S}Foot`, segment: `${s}Shin` as SegmentId, restOrigin: `${s}Knee`, foot: s },
    ];
  }),
];

/** Bones the adapter requires on the asset (every driven bone and the chain they hang from). */
export const REQUIRED_BONES = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftShoulder', 'RightShoulder', ...RIG_MAP.map((m) => m.bone), 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];

const tv = (a: number[]): THREE.Vector3 => new THREE.Vector3(a[0], a[1], a[2]);
/** Record quaternions are rounded to 1e-5: renormalise so the bind corrections are rigid. */
const tq = (a: number[]): THREE.Quaternion => new THREE.Quaternion(a[0], a[1], a[2], a[3]).normalize();

export class RigAdapter {
  /** Bones in hierarchy order (parents first). */
  private readonly order: THREE.Bone[];
  private readonly driven = new Map<THREE.Bone, { segment: SegmentId; correction: THREE.Matrix4; foot?: { side: 'left' | 'right'; ankle: THREE.Vector3 }; carry?: 'forearm' | 'hand' }>();
  /** The rest wrist in the right forearm's segment frame (a carried hand's pivot). */
  private readonly wrist: THREE.Vector3;
  private readonly pitch = new THREE.Matrix4();
  private readonly world = new Map<THREE.Object3D, THREE.Matrix4>();
  /** One world matrix per bone, reused every apply (plan 10d D5: no per-frame allocation). */
  private readonly boneWorld = new Map<THREE.Bone, THREE.Matrix4>();
  private readonly pos = new THREE.Vector3();
  private readonly rot = new THREE.Quaternion();
  private readonly tmp = new THREE.Matrix4();
  private readonly seg = new THREE.Matrix4();
  private readonly inv = new THREE.Matrix4();
  private readonly one = new THREE.Vector3(1, 1, 1);

  /**
   * `bones` by GLB name (prefix stripped). Rest world matrices are read from the bones as given (the asset's rest
   * pose, bind = rest); the model root must be at its rest placement when the adapter is built.
   */
  constructor(
    readonly bones: Record<string, THREE.Bone>,
    readonly cal: ModelCalibration,
  ) {
    for (const b of REQUIRED_BONES) if (!bones[b]) throw new Error(`rig adapter: bone ${b} missing`);
    const root = bones.Hips.parent;
    if (!root) throw new Error('rig adapter: Hips has no parent');
    root.updateWorldMatrix(true, true);
    const origin = tv(cal.frame.origin);
    const toBody = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z);
    const restOrigins: Record<string, THREE.Vector3> = { core: new THREE.Vector3() };
    for (const [k, p] of Object.entries(cal.landmarks)) restOrigins[k] = tv(p);
    const foreRest = new THREE.Matrix4().compose(restOrigins.rightElbow, tq(cal.segmentRest.rightForearm), this.one);
    this.wrist = restOrigins.rightWrist.clone().applyMatrix4(foreRest.invert());
    for (const m of RIG_MAP) {
      const bone = bones[m.bone];
      const segRest = new THREE.Matrix4().compose(restOrigins[m.restOrigin], tq(cal.segmentRest[m.segment]), this.one);
      // a foot pivots about the rest ankle, expressed in the shin segment frame
      let foot: { side: 'left' | 'right'; ankle: THREE.Vector3 } | undefined;
      if (m.foot) {
        const ankle = restOrigins[`${m.foot}Ankle`].clone().applyMatrix4(segRest.clone().invert());
        foot = { side: m.foot, ankle };
        segRest.multiply(new THREE.Matrix4().makeTranslation(ankle.x, ankle.y, ankle.z));
      }
      const boneRest = toBody.clone().multiply(bone.matrixWorld);
      this.driven.set(bone, { segment: m.segment, correction: segRest.invert().multiply(boneRest), foot, carry: m.carry });
    }
    const all: THREE.Bone[] = [];
    bones.Hips.traverse((o) => {
      if ((o as THREE.Bone).isBone) all.push(o as THREE.Bone);
    });
    this.order = all;
    for (const b of all) this.boneWorld.set(b, new THREE.Matrix4());
  }

  /** Bind correction of a driven bone (segment rest^-1 * bone rest), for tests and the calibration report. */
  correction(bone: string): THREE.Matrix4 {
    return this.driven.get(this.bones[bone])!.correction.clone();
  }

  /** Pose the skeleton from an achieved physical pose (world). Writes bone-local TRS only. */
  apply(pose: PhysicalPose): void {
    this.world.clear();
    const rootParent = this.bones.Hips.parent!;
    rootParent.updateWorldMatrix(true, false);
    this.world.set(rootParent, rootParent.matrixWorld);
    for (const bone of this.order) {
      const parentWorld = this.world.get(bone.parent!)!;
      const d = this.driven.get(bone);
      const w = this.boneWorld.get(bone)!;
      if (d) {
        const s = pose.segments[d.segment];
        const o = s.originWorld;
        const q = s.rotationWorld;
        this.seg.compose(this.pos.set(o.x, o.y, o.z), this.rot.set(q.x, q.y, q.z, q.w), this.one);
        if (d.foot) {
          const a = d.foot.ankle;
          const rad = ((pose.anklePitchDeg?.[d.foot.side] ?? 0) * Math.PI) / 180;
          this.seg.multiply(this.pitch.makeTranslation(a.x, a.y, a.z));
          if (rad !== 0) this.seg.multiply(this.pitch.makeRotationX(rad));
        }
        if (d.carry && pose.carry) {
          const roll = pose.carry.rollRad * pose.carry.handW;
          this.seg.multiply(this.pitch.makeRotationY(roll));
          if (d.carry === 'hand') {
            const a = this.wrist;
            this.seg.multiply(this.pitch.makeTranslation(a.x, a.y, a.z));
            this.seg.multiply(this.pitch.makeRotationZ(-pose.carry.flexRad * pose.carry.handW));
            this.seg.multiply(this.pitch.makeTranslation(-a.x, -a.y, -a.z));
          }
        }
        w.multiplyMatrices(this.seg, d.correction);
        this.inv.copy(parentWorld).invert();
        this.tmp.multiplyMatrices(this.inv, w);
        this.tmp.decompose(bone.position, bone.quaternion, bone.scale);
      } else {
        bone.updateMatrix();
        w.multiplyMatrices(parentWorld, bone.matrix);
      }
      this.world.set(bone, w);
    }
  }
}

/** One clone of the asset scene: own bones and skeletons, own morph weights (Basis), shared geometry and materials. */
export interface RigClone {
  root: THREE.Object3D;
  bones: Record<string, THREE.Bone>;
  meshes: THREE.SkinnedMesh[];
}

export function cloneRig(source: THREE.Object3D): RigClone {
  const root = cloneSkinned(source);
  const bones: Record<string, THREE.Bone> = {};
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const key = (o as THREE.Bone).isBone ? boneKey(o.name) : null;
    if (key) bones[key] = o as THREE.Bone;
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    meshes.push(m);
    // the Hips bone carries the player across the field; the bind-pose bounds at the origin do not
    m.frustumCulled = false;
    m.castShadow = true;
    // Basis shape only: the asset's default weights are heavy = lean = 1 (the lab has no morph controls)
    if (m.morphTargetInfluences) m.morphTargetInfluences.fill(0);
  });
  return { root, bones, meshes };
}
