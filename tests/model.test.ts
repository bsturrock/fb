// Supplied player model (models/bew-v6.glb): asset contract, calibration record, side basis, rig adapter and the G4-M
// model-geometry fixtures (handoff audits, grip direction, clamp transition, ground and boundary classification).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { calibrate } from '../scripts/model/calibrate';
import { glbScene } from '../scripts/model/glb-scene';
import CAL from '../src/sim/model/bew-v6.calibration.json';
import { MODEL_CALIBRATION, MODEL_CALIBRATION_ID, MODEL_ARM_CHAIN_M, modelArm, modelBallLocal, modelBody, modelRagdoll } from '../src/sim/model/profiles';
import { REQUIRED_BONES, RIG_MAP, RigAdapter, boneKey, cloneRig } from '../src/lab/rig-adapter';
import { buildProxyPose, carryPalmLocal, twoBone, type PhysicalPose } from '../src/sim/pose';
import { ARM_G2, RAGDOLL_G4, hipLocal, shoulderLocal, sideSignX, upperBodyCompound } from '../src/sim/profiles';
import { Simulation, checkLimbContract } from '../src/sim/simulation';
import { modelFixtures } from '../src/sim/fixtures/model';
import type { FixtureDef } from '../src/sim/fixture';
import type { SegmentId } from '../src/sim/contracts';
import { add, dist, dot, len, qFromAxisAngle, qInvRot, qMul, sub, toWorld, v3, type Pose, type Vec3 } from '../src/sim/vec';
import { run } from './helpers';

const C = MODEL_CALIBRATION;
const M = (id: string): FixtureDef => {
  const f = modelFixtures().find((d) => d.id === id);
  if (!f) throw new Error(`no model fixture ${id}`);
  return f;
};
const evs = (sim: Simulation, type: string, id?: string) => sim.events.filter((e) => e.type === type && (!id || e.playerId === id));
const tv = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);
const worldPos = (o: THREE.Object3D): THREE.Vector3 => new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);

async function runEach(def: FixtureDef, each: (sim: Simulation) => void): Promise<Simulation> {
  const sim = await Simulation.create(def);
  each(sim);
  while (!sim.done) {
    sim.stepTick();
    each(sim);
  }
  return sim;
}

const qNorm = (q: { x: number; y: number; z: number; w: number }) => {
  const n = Math.hypot(q.x, q.y, q.z, q.w);
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
};
/** Rest physical pose of the calibrated body placed at `root` (segment rest frames and rest landmarks). */
function restPose(root: Pose): PhysicalPose {
  const lm = C.landmarks as Record<string, number[]>;
  const at = (k: string): Vec3 => (k === 'core' ? v3() : v3(lm[k][0], lm[k][1], lm[k][2]));
  const origin: Record<string, string> = Object.fromEntries(RIG_MAP.map((m) => [m.segment, m.restOrigin]));
  const segments = {} as PhysicalPose['segments'];
  for (const [seg, q] of Object.entries(C.segmentRest) as [SegmentId, number[]][]) {
    segments[seg] = { segmentId: seg, originWorld: toWorld(root, at(origin[seg] ?? 'core')), rotationWorld: qMul(root.q, qNorm({ x: q[0], y: q[1], z: q[2], w: q[3] })) };
  }
  return { playerId: 'X', segments, jointLandmarksWorld: {}, hingeDeg: {}, straightFallback: [], limbClearance: {} };
}

function rigFromGlb(): { scene: THREE.Group; rig: ReturnType<typeof cloneRig>; adapter: RigAdapter } {
  const { scene } = glbScene();
  const rig = cloneRig(scene);
  rig.root.updateMatrixWorld(true);
  return { scene, rig, adapter: new RigAdapter(rig.bones, C) };
}

// --------------------------------------------------------------------------------------------- asset + calibration
describe('model asset and calibration record', () => {
  it('the committed calibration is re-derived exactly from the committed GLB (identity, joints, morphs, bind = rest)', () => {
    const bytes = readFileSync('models/bew-v6.glb');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(CAL.asset.sha256);
    expect(calibrate()).toEqual(CAL);
    expect(C.asset.joints).toBe(33);
    expect(C.asset.morphTargets).toEqual(['heavy', 'lean']);
    expect(C.asset.animations).toBe(0);
    expect(C.asset.bindRestMaxErr).toBeLessThan(1e-4);
    expect(C.frame.rightSignX).toBe(-1);
    expect(MODEL_CALIBRATION_ID).toBe(`bew-v6:${CAL.asset.sha256.slice(0, 12)}`);
  });

  it('required bones and morph names exist; the asset default morph weights are heavy = lean = 1 (clones zero them)', () => {
    const { scene } = glbScene();
    for (const b of REQUIRED_BONES) expect((scene.getObjectByName(`mixamorig${b}`) as THREE.Bone | undefined)?.isBone, b).toBe(true);
    const body = scene.getObjectByName('geometry_0') as THREE.SkinnedMesh;
    expect(Object.keys(body.morphTargetDictionary!)).toEqual(['heavy', 'lean']);
    expect(body.morphTargetInfluences).toEqual([1, 1]);
  });

  it('clones are independent: own bones and skeletons, own morph weights (Basis), shared geometry', () => {
    const { scene } = glbScene();
    const src = scene.getObjectByName('geometry_0') as THREE.SkinnedMesh;
    const a = cloneRig(scene);
    const b = cloneRig(scene);
    expect(a.meshes).toHaveLength(2);
    for (const k of Object.keys(a.bones)) expect(a.bones[k]).not.toBe(b.bones[k]);
    for (const m of a.meshes) for (const bone of m.skeleton.bones) expect(a.bones[boneKey(bone.name)!]).toBe(bone);
    expect(a.meshes[0].skeleton).not.toBe(b.meshes[0].skeleton);
    expect(a.meshes[0].geometry).toBe(src.geometry);
    expect(a.meshes[0].morphTargetInfluences).toEqual([0, 0]);
    expect(a.meshes[0].morphTargetInfluences).not.toBe(b.meshes[0].morphTargetInfluences);
    expect(src.morphTargetInfluences).toEqual([1, 1]);
    a.bones.Hips.position.x += 1;
    a.root.updateMatrixWorld(true);
    b.root.updateMatrixWorld(true);
    expect(worldPos(b.bones.Hips).x).toBeCloseTo(worldPos(src.skeleton.bones.find((x) => boneKey(x.name) === 'Hips')!).x, 9);
    expect(a.meshes.every((m) => m.frustumCulled === false)).toBe(true);
  });
});

// --------------------------------------------------------------------------------------------- side basis
describe('model side basis: anatomical Right on -X (authored bodies keep right = +X)', () => {
  it('model body landmarks are the GLB anatomical sides', () => {
    const b = modelBody();
    expect(sideSignX(b, 'right')).toBe(-1);
    expect(sideSignX(b, 'left')).toBe(1);
    expect(shoulderLocal(b, 'right').x).toBeCloseTo(C.landmarks.rightShoulder[0], 4);
    expect(shoulderLocal(b, 'left').x).toBeCloseTo(C.landmarks.leftShoulder[0], 4);
    expect(hipLocal(b, 'right').x).toBeLessThan(0);
    expect(modelArm().restPalmRight.x).toBeLessThan(0);
    const a = upperBodyCompound();
    expect(sideSignX(a, 'right')).toBe(1);
    expect(shoulderLocal(a, 'right').x).toBeGreaterThan(0);
  });

  it('labelled single right arm: the solved right arm stays the anatomical right in the pose and on the rendered bones', () => {
    const body = modelBody();
    const R = modelRagdoll();
    const root: Pose = { p: v3(2, 0.95, -1), q: qFromAxisAngle(v3(0, 1, 0), 0.6) };
    const sh = toWorld(root, shoulderLocal(body, 'right'));
    // a reach forward and across to the anatomical right (-X local), elbow out to the right
    const palmL = add(shoulderLocal(body, 'right'), v3(-0.15, -0.1, 0.55));
    const s = twoBone(sh, toWorld(root, palmL), R.lengths.upperArm, R.lengths.forearm + R.lengths.palmExtension, toWorld({ p: v3(), q: root.q }, v3(-1, -0.4, 0)));
    const pose = buildProxyPose({ playerId: 'X', body, ragdoll: R, pose: root, gait: { phase: 0 }, speed: 0, arms: { right: { shoulder: sh, elbow: s.mid, palm: s.end } } });
    const lm = pose.jointLandmarksWorld;
    const local = (p: Vec3): Vec3 => qInvRot(root.q, sub(p, root.p));
    expect(dist(lm.rightPalm, s.end)).toBeLessThan(1e-9);
    expect(local(lm.rightShoulder).x).toBeLessThan(0);
    expect(local(lm.rightElbow).x).toBeLessThan(local(lm.rightShoulder).x);
    expect(local(lm.leftShoulder).x).toBeGreaterThan(0);
    expect(local(lm.leftPalm).x).toBeGreaterThan(0); // the procedural (unsolved) left arm stays on the left
    const { rig, adapter } = rigFromGlb();
    adapter.apply(pose);
    rig.root.updateMatrixWorld(true);
    expect(worldPos(rig.bones.RightArm).distanceTo(tv(lm.rightShoulder))).toBeLessThan(1e-4);
    expect(worldPos(rig.bones.RightForeArm).distanceTo(tv(lm.rightElbow))).toBeLessThan(1e-4);
    expect(worldPos(rig.bones.RightHand).distanceTo(tv(lm.rightWrist))).toBeLessThan(1e-4);
    expect(worldPos(rig.bones.LeftHand).distanceTo(tv(lm.leftWrist))).toBeLessThan(1e-4);
  });
});

// --------------------------------------------------------------------------------------------- rig adapter
describe('rig adapter: bones from the achieved pose (bind corrections, parent-local, one root placement)', () => {
  it('the calibrated rest pose reproduces the asset rest for every bone under translated and yawed roots', () => {
    const { scene, rig, adapter } = rigFromGlb();
    const origin = C.frame.origin;
    const restWorld = new Map<string, THREE.Matrix4>();
    scene.traverse((o) => {
      if ((o as THREE.Bone).isBone) restWorld.set(o.name, o.matrixWorld.clone());
    });
    for (const [x, z, yawDeg] of [[0, 0, 0], [3, -2, 37], [-1.2, 4, 200]]) {
      const root: Pose = { p: v3(x, 0.95, z), q: qFromAxisAngle(v3(0, 1, 0), (yawDeg * Math.PI) / 180) };
      adapter.apply(restPose(root));
      rig.root.updateMatrixWorld(true);
      const R = new THREE.Matrix4().compose(tv(root.p), new THREE.Quaternion(root.q.x, root.q.y, root.q.z, root.q.w), new THREE.Vector3(1, 1, 1));
      const T = new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]);
      let worst = 0;
      rig.root.traverse((o) => {
        if (!(o as THREE.Bone).isBone) return;
        const want = R.clone().multiply(T).multiply(restWorld.get(o.name)!);
        const e = o.matrixWorld.elements;
        want.elements.forEach((w, i) => (worst = Math.max(worst, Math.abs(w - e[i]))));
      });
      expect(worst).toBeLessThan(1e-5);
    }
  });

  it('an ankle pitch turns the foot about the calibrated ankle (shin and the rest of the leg unchanged)', () => {
    const { rig, adapter } = rigFromGlb();
    const root: Pose = { p: v3(1, 0.95, -2), q: qFromAxisAngle(v3(0, 1, 0), 0.6) };
    const flat = restPose(root);
    adapter.apply(flat);
    rig.root.updateMatrixWorld(true);
    const keep = (b: string) => {
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      rig.bones[b].matrixWorld.decompose(p, q, new THREE.Vector3());
      return { p, q };
    };
    const before = { foot: keep('LeftFoot'), toe: keep('LeftToeBase') };
    const fixed = ['LeftLeg', 'LeftUpLeg', 'RightFoot', 'RightLeg'].map((b) => rig.bones[b].matrixWorld.clone());
    const deg = 25;
    adapter.apply({ ...flat, anklePitchDeg: { left: deg } });
    rig.root.updateMatrixWorld(true);
    const after = { foot: keep('LeftFoot'), toe: keep('LeftToeBase') };
    ['LeftLeg', 'LeftUpLeg', 'RightFoot', 'RightLeg'].forEach((b, i) => {
      const e = rig.bones[b].matrixWorld.elements;
      expect(Math.max(...fixed[i].elements.map((w, j) => Math.abs(w - e[j])))).toBeLessThan(1e-6);
    });
    // the Foot bone sits at the ankle: it stays in place and turns by the pitch about the shin hinge axis
    expect(after.foot.p.distanceTo(before.foot.p)).toBeLessThan(2e-3);
    expect((after.foot.q.angleTo(before.foot.q) * 180) / Math.PI).toBeCloseTo(deg, 3);
    const shinQ = flat.segments.leftShin.rotationWorld;
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(new THREE.Quaternion(shinQ.x, shinQ.y, shinQ.z, shinQ.w));
    const rel = after.foot.q.clone().multiply(before.foot.q.clone().invert());
    expect(Math.abs(new THREE.Vector3(rel.x, rel.y, rel.z).normalize().dot(axis))).toBeGreaterThan(0.9999);
    // positive pitch = toe down
    expect(after.toe.p.y).toBeLessThan(before.toe.p.y);
  });

  it('driven bones land on the pose landmarks before and after a handoff; one root placement; undriven bones keep rest locals', async () => {
    const { rig, adapter } = rigFromGlb();
    const rootRest = rig.root.matrixWorld.clone();
    const restLocal = new Map<THREE.Bone, THREE.Matrix4>();
    const driven = new Set(RIG_MAP.map((m) => rig.bones[m.bone]));
    rig.root.traverse((o) => {
      if ((o as THREE.Bone).isBone && !driven.has(o as THREE.Bone)) restLocal.set(o as THREE.Bone, (o as THREE.Bone).matrix.clone());
    });
    let checked = { proxy: 0, ragdoll: 0 };
    let worst = 0;
    let worstQ = 0;
    const sim = await runEach(M('G4-F4-simultaneous-M'), (s) => {
      if (s.tick % 6 !== 0) return;
      for (const pl of s.players) {
        const pose = pl.pose!;
        adapter.apply(pose);
        rig.root.updateMatrixWorld(true);
        const lm = pose.jointLandmarksWorld;
        const pairs: [string, Vec3][] = [['Hips', lm.pelvisMid], ['Neck', lm.neck]];
        for (const S of ['Left', 'Right'] as const) {
          const k = S.toLowerCase();
          pairs.push([`${S}Arm`, lm[`${k}Shoulder`]], [`${S}ForeArm`, lm[`${k}Elbow`]], [`${S}Hand`, lm[`${k}Wrist`]], [`${S}UpLeg`, lm[`${k}Hip`]], [`${S}Leg`, lm[`${k}Knee`]], [`${S}Foot`, lm[`${k}Ankle`]]);
        }
        for (const [b, p] of pairs) worst = Math.max(worst, worldPos(rig.bones[b]).distanceTo(tv(p)));
        // twist is kept: bone world rotation = segment rotation x bind-correction rotation
        for (const m of RIG_MAP) {
          const q = pose.segments[m.segment].rotationWorld;
          const rot = (mx: THREE.Matrix4): THREE.Quaternion => {
            const r = new THREE.Quaternion();
            mx.decompose(new THREE.Vector3(), r, new THREE.Vector3());
            return r;
          };
          const want = new THREE.Quaternion(q.x, q.y, q.z, q.w).multiply(rot(adapter.correction(m.bone)));
          const got = rot(rig.bones[m.bone].matrixWorld);
          const r = want.clone().conjugate().multiply(got);
          worstQ = Math.max(worstQ, 2 * Math.atan2(Math.hypot(r.x, r.y, r.z), Math.abs(r.w)));
        }
        // no side swap: the GLB Left bones sit on the body's left (+X local for the model)
        const core: Pose = { p: pose.segments.core.originWorld, q: pose.segments.core.rotationWorld };
        expect(qInvRot(core.q, sub(lm.leftShoulder, core.p)).x).toBeGreaterThan(0);
        expect(dot(sub(worldPos(rig.bones.LeftArm) as unknown as Vec3, worldPos(rig.bones.RightArm) as unknown as Vec3), toWorld({ p: v3(), q: core.q }, v3(1, 0, 0)))).toBeGreaterThan(0);
        // the clone root and Armature never move (the Hips bone carries the placement)
        expect(rig.root.matrixWorld.equals(rootRest)).toBe(true);
        for (const [bone, m] of restLocal) expect(bone.matrix.equals(m)).toBe(true);
        checked[pl.representation === 'ragdoll' ? 'ragdoll' : 'proxy']++;
      }
    });
    expect(worst).toBeLessThan(1e-4);
    // rad; the asset's node scales differ from 1 by up to 1e-5 (export noise), nothing else separates the two
    expect(worstQ).toBeLessThan(1e-4);
    expect(checked.proxy).toBeGreaterThan(10);
    expect(checked.ragdoll).toBeGreaterThan(10);
    sim.dispose();
  });
});

// --------------------------------------------------------------------------------------------- one geometry contract
describe('model profiles: one measured geometry contract', () => {
  it('arm queries, pose, candidates and rules share the calibrated lengths; a mismatched pair is rejected', async () => {
    const A = modelArm();
    const R = modelRagdoll();
    expect([A.upperArmM, A.forearmM, A.palmExtensionM]).toEqual([C.lengths.upperArm, C.lengths.forearm, C.lengths.palmExtension]);
    expect([R.lengths.thigh, R.lengths.shin]).toEqual([C.lengths.thigh, C.lengths.shin]);
    expect(A.maxReachM).toBeCloseTo(MODEL_ARM_CHAIN_M - (0.74 - ARM_G2.maxReachM), 12);
    expect(() => checkLimbContract(A, R)).not.toThrow();
    expect(() => checkLimbContract(ARM_G2, R)).toThrow(/limb contract/);
    expect(() => checkLimbContract(A, RAGDOLL_G4)).toThrow(/limb contract/);
    const sim = await run(M('G4-F4-simultaneous-M'));
    const D = sim.players.find((p) => p.id === 'D')!;
    // after the handoff the pose comes from the ten candidate bodies
    expect(D.representation).toBe('ragdoll');
    const lm = D.pose!.jointLandmarksWorld;
    for (const s of ['left', 'right']) {
      expect(dist(lm[`${s}Elbow`], lm[`${s}Wrist`])).toBeCloseTo(C.lengths.forearm, 4);
      expect(dist(lm[`${s}Knee`], lm[`${s}Ankle`])).toBeCloseTo(C.lengths.shin, 4);
      expect(dist(lm[`${s}Wrist`], lm[`${s}Palm`])).toBeCloseTo(C.lengths.palmExtension, 4);
    }
    const h = D.handoff!;
    expect(h.report.lengthErrM).toBeLessThanOrEqual(R.validation.lengthTolM);
    expect(h.report.maxLandmarkErrM).toBeLessThanOrEqual(R.validation.landmarkTolM);
    expect(sim.rules).toBeNull();
    sim.dispose();
  });

  it('the carry palm and the ball reference are the authored carry relation on the anatomical right', () => {
    const b = modelBody();
    const palm = carryPalmLocal(b);
    const ball = modelBallLocal(b);
    expect(palm.x).toBeLessThan(0);
    expect(ball.x).toBeLessThan(0);
    const authored = len(sub(v3(0.2, 0.3, 0.12), v3(0.13, 0.24, 0.24)));
    expect(dist(palm, ball)).toBeCloseTo((authored * MODEL_ARM_CHAIN_M) / 0.74, 9);
  });
});

// --------------------------------------------------------------------------------------------- G4-M fixtures
describe('G4-M: handoffs on the model geometry', () => {
  const acceptedSet = ['G4-F1-M', 'G4-F2-yaw225-tumble-M', 'G4-F4-ownerOnly-M', 'G4-F4-simultaneous-M', 'G4-F5-twoRagdolls-M'];
  for (const id of acceptedSet)
    it(`${id}: every handoff accepted, transfer audit within tolerance (mass, P, L, energy), ten active bodies`, async () => {
      const def = M(id);
      const sim = await run(def);
      const R = def.ragdoll!;
      const hs = sim.players.filter((p) => p.handoff).map((p) => p.handoff!);
      expect(hs.length).toBeGreaterThan(0);
      for (const h of hs) {
        expect(h.outcome).toBe('accepted');
        const a = h.audit!;
        expect(a.ok).toBe(true);
        expect(a.massDiffKg).toBeLessThanOrEqual(R.audit.massTolKg);
        expect(a.linearRelErr).toBeLessThanOrEqual(R.audit.linearRelTol);
        expect(a.angularRelErr).toBeLessThanOrEqual(R.audit.angularRelTol);
        expect(a.energyDeltaJ).toBeLessThanOrEqual(a.energyGainLimitJ);
        expect(h.activeBodies).toEqual({ before: 1, after: 10, proxyRemoved: true });
        expect(h.report.maxNewExternalPenetrationM).toBeLessThanOrEqual(R.validation.penetrationTolM);
      }
      expect(sim.invalidTransfer).toBeNull();
      sim.dispose();
    });

  it('every G4-M handoff is accepted with a passing audit or rejected with recorded reasons; none switches with a failed audit', async () => {
    for (const def of modelFixtures()) {
      const sim = await run(def);
      for (const pl of sim.players) {
        const h = pl.handoff;
        if (!h) continue;
        if (h.outcome === 'rejected') expect(h.report.reasons.length, def.id).toBeGreaterThan(0);
        else expect([def.id, h.outcome, h.audit?.ok]).toEqual([def.id, 'accepted', true]);
      }
      expect(sim.result, def.id).not.toBe('invalidTransfer');
      expect(sim.result, def.id).not.toBe('numericalFailure');
      sim.dispose();
    }
  });

  it('continuity: the first ragdoll pose continues the last proxy pose (segment origins move by one tick of travel)', async () => {
    let last: PhysicalPose | null = null;
    let jump = -1;
    let travel = 0;
    const sim = await runEach(M('G4-F2-yaw225-tumble-M'), (s) => {
      const pl = s.players[0];
      if (pl.representation === 'ragdoll' && jump < 0 && last) {
        const cur = pl.pose!;
        travel = Math.hypot(...pl.handoff!.audit!.before.v) * s.def.solver.outerTickS;
        for (const k of Object.keys(cur.segments) as SegmentId[]) jump = Math.max(jump, dist(cur.segments[k].originWorld, last.segments[k].originWorld));
      }
      if (pl.representation === 'proxy') last = structuredClone(pl.pose!);
    });
    expect(jump).toBeGreaterThanOrEqual(0);
    // velocity before the switch is (-2, 0, -2) m/s plus spin: one 1/60 s tick moves a segment by a few centimetres
    expect(jump).toBeLessThan(Math.max(0.08, 3 * travel));
    sim.dispose();
  });

  it('G4-F4-ownerOnly-M: passive palm links of the ragdoll owner are tensile (force on the target toward the palm)', async () => {
    let ledger: any[] = [];
    const sim = await runEach(M('G4-F4-ownerOnly-M'), (s) => {
      const arms = (s as unknown as { arms?: { keepLedger: boolean; ledger: any[] } }).arms;
      if (arms) {
        arms.keepLedger = true;
        ledger = arms.ledger;
      }
    });
    const passive = ledger.filter((x) => x.kind === 'passive' && x.actual > 1);
    expect(passive.length).toBeGreaterThan(0);
    for (const x of passive) {
      const d = sub(x.pointOnTarget, x.pointOnOwner);
      if (len(d) < 1e-6) continue;
      expect(dot(x.forceOnTarget, d)).toBeLessThan(0);
      expect(len(add(x.forceOnTarget, x.forceOnOwner))).toBeLessThan(1e-9);
    }
    sim.dispose();
  });

  it('G4-F3-twoArm-M: the forearm clamps remap onto the runner ragdoll and the play ends groundDown on an eligible runner region', async () => {
    const sim = await run(M('G4-F3-twoArm-M'));
    const R = sim.players.find((p) => p.id === 'R')!;
    expect(R.handoff?.outcome).toBe('accepted');
    const remaps = evs(sim, 'clampRemap', 'D').filter((e) => e.data!.target === 'R');
    expect(remaps.length).toBeGreaterThan(0);
    // event times are recorded to 1e-5 s; every remap belongs to the runner's switch substep or later
    expect(remaps.every((e) => e.t >= R.handoff!.t - 1e-4)).toBe(true);
    const end = evs(sim, 'ruleEnding')[0].data as { kind: string; region: string; ids: string[] };
    expect(end.kind).toBe('groundDown');
    expect(sim.def.rules!.eligibleRegions).toContain(end.region);
    expect(end.ids[0]).toMatch(/^(core|left|right)/); // a runner ragdoll segment collider
    sim.dispose();
  });

  it('G4-F11-sidelineFoot-M: the anatomical right shoe (toward the sideline for a +X runner) touches out', async () => {
    const sim = await run(M('G4-F11-sidelineFoot-M'));
    const e = evs(sim, 'ruleEnding')[0].data as { kind: string; ids: string[]; region: string; point: number[] };
    expect(e.kind).toBe('sidelineOut');
    expect(e.ids).toEqual(['rightShin:shoe']);
    expect(e.region).toBe('foot');
    expect(e.point[2]).toBeGreaterThanOrEqual(4);
    sim.dispose();
  });
});
