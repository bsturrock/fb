import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { clampToKneeStop, hingeReading, initKneeStop, ratchetKneeStop } from '../src/sim/joint-stops';
import { initPhysics } from '../src/sim/physics';
import { withKneeStop } from '../src/sim/profiles';
import { qFromAxisAngle, v3 } from '../src/sim/vec';
import { create, FIX, stepWhile } from './helpers';

// Ladder rung 8f: the ragdoll knee's flexion stop (`RagdollProfile.kneeFlexionStopDeg`; no fixture uses it). The knee is
// a Rapier revolute hinge about its local X with limits [0, 150] deg (`limitsDeg.knee`, which the conversion's candidate
// validation reads); the stop is the hinge's upper Rapier limit set lower, widened to where the knee starts.
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const HINGE: [number, number] = [0, 150 * RAD];

/** A fixed thigh and a 4 kg shin on a knee hinge about X at the origin (240 Hz, 4 iterations), the shin at `deg0` flexion. */
async function kneeRig(deg0: number) {
  await initPhysics();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = 1 / 240;
  world.numSolverIterations = 4;
  const thigh = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const shin = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setRotation(qFromAxisAngle(v3(1, 0, 0), deg0 * RAD)));
  world.createCollider(RAPIER.ColliderDesc.capsule(0.16, 0.05).setTranslation(0, -0.21, 0).setMass(4), shin);
  const joint = world.createImpulseJoint(RAPIER.JointData.revolute(v3(), v3(), v3(1, 0, 0)), thigh, shin, true) as RAPIER.RevoluteImpulseJoint;
  joint.setContactsEnabled(false);
  joint.setLimits(HINGE[0], HINGE[1]);
  const reading = (): number => hingeReading(thigh.rotation(), shin.rotation()) * DEG;
  /** Steps under a torque about X (N m, + flexes), the ratchet before each when `k` is given; the peak and final reading. */
  const drive = (nm: number, steps: number, k?: ReturnType<typeof initKneeStop>) => {
    let peak = -Infinity;
    for (let s = 0; s < steps; s++) {
      if (k) ratchetKneeStop(k, joint, HINGE[0], thigh.rotation(), shin.rotation());
      shin.resetTorques(true);
      shin.addTorque({ x: nm, y: 0, z: 0 }, true);
      world.step();
      peak = Math.max(peak, reading());
    }
    return { peak, final: reading() };
  };
  return { world, thigh, shin, joint, reading, drive };
}

describe('ladder rung 8f: the knee flexion stop', () => {
  it('the hinge reading is the flexion Rapier limits: a knee driven hard into a 140 stop stops within 2 deg of it and settles on it; the hinge\'s own 150 without it (fault twin)', async () => {
    const rig = await kneeRig(60);
    expect(rig.reading()).toBeCloseTo(60, 6);
    const k = initKneeStop(rig.joint, 'leftKnee', 0, rig.thigh.rotation(), rig.shin.rotation(), HINGE[0], HINGE[1], 140);
    expect(rig.joint.limitsMax()).toBeCloseTo(140 * RAD, 6);
    expect(k.startOutsideDeg).toBe(0);
    const { peak, final } = rig.drive(200, 240, k);
    expect(peak).toBeLessThan(142);
    expect(Math.abs(final - 140)).toBeLessThan(0.5);
    rig.world.free();
    const twin = await kneeRig(60);
    const t = twin.drive(200, 240);
    expect(t.final).toBeGreaterThan(148);
    twin.world.free();
  });

  it('a knee that starts past the stop (148 under 140) starts at rest against a stop widened to it; extended, the stop closes with it to 140 and never reopens; set at 140 from the start (fault twin) the hinge snaps in', async () => {
    const rig = await kneeRig(148);
    const k = initKneeStop(rig.joint, 'leftKnee', 0, rig.thigh.rotation(), rig.shin.rotation(), HINGE[0], HINGE[1], 140);
    expect(k.startOutsideDeg).toBeCloseTo(8, 4);
    expect(k.current * DEG).toBeCloseTo(148, 4);
    rig.drive(0, 12, k);
    expect(Math.abs(rig.reading() - 148)).toBeLessThan(0.01);
    // extend to under 140, then flex hard: held at 140
    rig.drive(-30, 120, k);
    expect(rig.reading()).toBeLessThan(140);
    expect(k.current).toBe(k.nominal);
    expect(rig.joint.limitsMax()).toBeCloseTo(140 * RAD, 6);
    const { peak } = rig.drive(200, 240, k);
    expect(peak).toBeLessThan(142);
    // the clamp of a fall-response knee target: at the stop in force
    expect(clampToKneeStop(150 * RAD, k)).toBe(k.nominal);
    expect(clampToKneeStop(1, k)).toBe(1);
    expect(clampToKneeStop(150 * RAD, undefined)).toBe(150 * RAD);
    rig.world.free();
    const twin = await kneeRig(148);
    twin.joint.setLimits(HINGE[0], 140 * RAD);
    twin.drive(0, 12);
    expect(148 - twin.reading()).toBeGreaterThan(3);
    twin.world.free();
  });

  it('a ragdoll built under the field has the stop on both knees (Rapier\'s readback) and the hinge\'s own limit without it', async () => {
    const read = async (deg?: number) => {
      const d = FIX('L4-F2-side-off');
      const sim = await create(deg === undefined ? d : { ...d, ragdoll: withKneeStop(d.ragdoll!, deg) });
      await stepWhile(sim, () => !sim.players.some((p) => p.rag?.enabled));
      const rag = sim.players.find((p) => p.rag?.enabled)!.rag!;
      const out = rag.joints.filter((j) => j.kind === 'knee').map((j) => ({ id: j.id, max: Number(((j.joint as RAPIER.RevoluteImpulseJoint).limitsMax() * DEG).toFixed(3)), stop: rag.kneeStops?.find((k) => k.jointId === j.id)?.nominal }));
      sim.dispose();
      return out;
    };
    const on = await read(140);
    expect(on.map((x) => x.id).sort()).toEqual(['leftKnee', 'rightKnee']);
    for (const x of on) {
      expect(x.max).toBeGreaterThanOrEqual(140);
      expect(x.stop! * DEG).toBeCloseTo(140, 6);
    }
    for (const x of await read()) {
      expect(x.max).toBe(150);
      expect(x.stop).toBeUndefined();
    }
  }, 60000);
});
