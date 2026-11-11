import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { FALL_L4 } from '../src/sim/profiles';
import { ANG_AXES, boxReading, clampDirToHipStops, hipNeutralFrame, hipStopBox, hipStopReading, initHipStop, jointRelative, ratchetHipStop, readAngularLimits, setAngularLimits, type AngBox } from '../src/sim/joint-stops';
import { MODEL_CALIBRATION } from '../src/sim/model/profiles';
import { modelBody } from '../src/sim/model/profiles';
import { initPhysics } from '../src/sim/physics';
import { HIP_STOPS_V1, sideSignX, upperBodyCompound, withHipStops, type BodyProfile } from '../src/sim/profiles';
import { qFromAxisAngle, qFromUnitVectors, qMul, qRot, v3, type Quat, type Vec3 } from '../src/sim/vec';
import { create, FIX, stepWhile } from './helpers';
import { hipAngles } from './visible';

// Ladder rung 8d: hard outer stops on the ragdoll's spherical hips (src/sim/joint-stops.ts), opt-in
// (`RagdollProfile.hipStops`, HIP_STOPS_V1: flexion 125, extension 30, abduction 50, adduction 30, rotation 45 each way).
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
type Side = 'left' | 'right';
const SIDES: Side[] = ['left', 'right'];
const ID: Quat = { x: 0, y: 0, z: 0, w: 1 };
const BODIES: [string, BodyProfile][] = [
  ['authored', upperBodyCompound()],
  ['model', modelBody()],
];

/** Core-to-thigh rotation at flexion, abduction (+ out), rotation (+ external) on the side of sign `ss` (tests/visible.test.ts). */
function thighRel(flex: number, abd: number, rot: number, ss: number): Quat {
  const dir = v3(ss * Math.sin(abd * RAD), -Math.cos(abd * RAD) * Math.cos(flex * RAD), Math.cos(abd * RAD) * Math.sin(flex * RAD));
  return qMul(qFromUnitVectors(v3(0, -1, 0), dir), qFromAxisAngle(v3(0, 1, 0), ss * rot * RAD));
}
const deg3 = (v: number[]): number[] => v.map((x) => Number((x * DEG).toFixed(1)) || 0);

/** A fixed core and a 10 kg thigh on a spherical hip at the origin, the solver as the simulation's (4 iterations, 240 Hz). */
async function hipRig(frame1: Quat, rel0: Quat, flipSign = false) {
  await initPhysics();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = 1 / 240;
  world.numSolverIterations = 4;
  const core = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const q0 = qMul(frame1, rel0);
  const thigh = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setRotation(flipSign ? { x: -q0.x, y: -q0.y, z: -q0.z, w: -q0.w } : q0));
  world.createCollider(RAPIER.ColliderDesc.capsule(0.16, 0.07).setTranslation(0, -0.23, 0).setMass(10), thigh);
  const joint = world.createImpulseJoint(RAPIER.JointData.spherical(v3(), v3()), core, thigh, true);
  joint.setContactsEnabled(false);
  joint.setFrameX1(frame1);
  const reading = (): [number, number, number] => boxReading(jointRelative(core.rotation(), frame1, thigh.rotation()));
  /** Step with a torque along the joint frame's axis `i` (Y: the thigh's own axis), sign `dir`; the peak and final reading. */
  const drive = (i: number, dir: number, nm: number, steps: number) => {
    let peak = -Infinity;
    /** The reading and the thigh's angular speed over the last quarter second (60 steps). */
    const tail: { at: number; w: number }[] = [];
    for (let s = 0; s < steps; s++) {
      const ax = i === 1 ? qRot(thigh.rotation(), v3(0, 1, 0)) : qRot(frame1, i === 0 ? v3(1, 0, 0) : v3(0, 0, 1));
      thigh.resetTorques(true);
      thigh.addTorque({ x: ax.x * dir * nm, y: ax.y * dir * nm, z: ax.z * dir * nm }, true);
      world.step();
      peak = Math.max(peak, dir * reading()[i]);
      const w = thigh.angvel();
      tail.push({ at: dir * reading()[i], w: Math.hypot(w.x, w.y, w.z) });
      if (tail.length > 60) tail.shift();
    }
    return { peak, tailAt: tail.map((t) => t.at), meanW: tail.reduce((a, t) => a + t.w, 0) / tail.length };
  };
  return { world, core, thigh, joint, reading, drive };
}

describe('ladder rung 8d: Rapier\'s per-axis angular limits on a spherical joint (the one raw call)', () => {
  it('pin: Rapier 0.21.0; the raw call enables a limit on each angular axis it is given and reads it back, the others stay off; the joint frame reads back', async () => {
    await initPhysics();
    expect(RAPIER.version()).toBe('0.21.0');
    const frame = qFromAxisAngle(v3(0, 1, 0), 0.3);
    const { joint, world } = await hipRig(frame, ID);
    for (const a of ANG_AXES) expect(readAngularLimits(joint, a).enabled).toBe(false);
    setAngularLimits(joint, RAPIER.JointAxis.AngX, -2.1, 0.5);
    setAngularLimits(joint, RAPIER.JointAxis.AngZ, -0.5, 0.9);
    const x = readAngularLimits(joint, RAPIER.JointAxis.AngX);
    const z = readAngularLimits(joint, RAPIER.JointAxis.AngZ);
    expect([x.enabled, z.enabled, readAngularLimits(joint, RAPIER.JointAxis.AngY).enabled]).toEqual([true, true, false]);
    expect([x.min, x.max, z.min, z.max].map((v) => Number(v.toFixed(5)))).toEqual([-2.1, 0.5, -0.5, 0.9]);
    const f = joint.frameX1();
    expect([f.x, f.y, f.z, f.w].map((v) => Number(v.toFixed(6)))).toEqual([frame.x, frame.y, frame.z, frame.w].map((v) => Number(v.toFixed(6))));
    world.free();
  });

  it('each stop holds a strong torque on its axis, each way, on both sides of both bodies (300 N m swinging; 100 N m twisting about the thigh axis with a fiftieth of the inertia): it stops within 3 deg of the stop and settles there; with no stops (fault twin) the thigh swings through', async () => {
    const rows: string[] = [];
    for (const [name, body] of BODIES)
      for (const side of SIDES) {
        const ss = sideSignX(body, side);
        const frame = hipNeutralFrame(body, side);
        const box = hipStopBox(HIP_STOPS_V1, ss);
        for (let i = 0; i < 3; i++)
          for (const dir of [-1, 1]) {
            const stop = dir < 0 ? -box[i][0] : box[i][1];
            const rig = await hipRig(frame, ID);
            box.forEach(([lo, hi], k) => setAngularLimits(rig.joint, ANG_AXES[k], lo, hi));
            const nm = i === 1 ? 100 : 300;
            const r = rig.drive(i, dir, nm, 240);
            rig.world.free();
            const dev = Math.max(...r.tailAt.map((a) => Math.abs(a - stop))) * DEG;
            rows.push(`${name} ${side} ${'XYZ'[i]}${dir > 0 ? '+' : '-'}: stop ${(stop * DEG).toFixed(0)} peak ${(r.peak * DEG).toFixed(2)} last 0.25 s within ${dev.toFixed(3)} mean w ${r.meanW.toFixed(3)}`);
            expect(Math.abs(r.peak - stop) * DEG).toBeLessThan(3);
            // settled: through the last quarter second within 0.1 deg of the stop (Rapier's position correction leaves a
            // jitter of a few hundredths of a degree under 300 N m on some axes: mean speed under 0.3 rad/s)
            expect(dev).toBeLessThan(0.1);
            expect(r.meanW).toBeLessThan(0.3);
            if (name === 'model' && side === 'left') {
              const free = await hipRig(frame, ID);
              const f = free.drive(i, dir, nm, 60);
              free.world.free();
              expect((f.peak - stop) * DEG).toBeGreaterThan(30);
            }
          }
      }
    expect(rows.length).toBe(24);
  });

  it('Rapier reads the relative rotation sign-normalised (w >= 0): a thigh body given -q, the same orientation, flexed 100 deg, is held at the same flexion stop', async () => {
    const frame = ID;
    const box = hipStopBox(HIP_STOPS_V1, 1);
    const run = async (flip: boolean) => {
      const rig = await hipRig(frame, thighRel(100, 0, 0, 1), flip);
      box.forEach(([lo, hi], k) => setAngularLimits(rig.joint, ANG_AXES[k], lo, hi));
      const first = deg3(rig.reading());
      const r = rig.drive(0, -1, 300, 240);
      rig.world.free();
      return { first, peak: r.peak * DEG };
    };
    const a = await run(false);
    const b = await run(true);
    expect(a.first).toEqual([-100, 0, 0]);
    expect(b.first).toEqual(a.first);
    expect(Math.abs(b.peak - a.peak)).toBeLessThan(0.01);
    expect(a.peak).toBeLessThan(128);
  });
});

describe('ladder rung 8d: the hip\'s anatomical frame and the box\'s reading of a pose', () => {
  it('the frame is built from the calibrated rest (bew-v6 segmentRest): its twist only, so the calibrated rest thighs read their stance, abduction 8 and flexion 1, on both sides, no twist, in the box as anatomically; the authored body\'s is the core frame', () => {
    expect(hipNeutralFrame(upperBodyCompound(), 'left')).toEqual(ID);
    const body = modelBody();
    for (const side of SIDES) {
      const ss = sideSignX(body, side);
      const f = hipNeutralFrame(body, side);
      expect([f.x, f.z]).toEqual([0, 0]);
      expect(Math.abs(2 * Math.atan2(f.y, f.w) * DEG)).toBeLessThan(0.1);
      const [x, y, z, w] = MODEL_CALIBRATION.segmentRest[`${side}Thigh`];
      const rest: Quat = { x, y, z, w };
      const a = hipAngles(rest, ss);
      // the stance: abduction 8.0 and flexion 1.1 (left) / 1.2 (right), no rotation
      expect(Math.abs(a.abd - 8)).toBeLessThan(0.1);
      expect(a.flex).toBeGreaterThan(1);
      expect(a.flex).toBeLessThan(1.3);
      expect(Math.abs(a.rot)).toBeLessThan(0.1);
      // the box reads it the same (flexion is -X; abduction is +Z times the side sign), with no twist
      const [ex, ey, ez] = hipStopReading(rest, f).map((v) => v * DEG);
      expect(Math.abs(-ex - a.flex)).toBeLessThan(0.01);
      expect(Math.abs(ss * ez - a.abd)).toBeLessThan(0.01);
      expect(Math.abs(ey)).toBeLessThan(1e-6);
      // fault twin: the identity frame reads the rest's own twist (0.07 / 0.09 deg) as box twist
      expect(Math.abs(hipStopReading(rest, ID)[1])).toBeGreaterThan(1e-4 * RAD);
    }
  });

  it('on its own axis the box reads the anatomical angle exactly, both sides; combined it couples (the known corners, tabulated): the twist it admits grows with flexion, and rotation at 90 flexion reads as ab/adduction', () => {
    for (const ss of [1, -1]) {
      expect(deg3(hipStopReading(thighRel(110, 0, 0, ss), ID))).toEqual([-110, 0, 0]);
      expect(deg3(hipStopReading(thighRel(-30, 0, 0, ss), ID))).toEqual([30, 0, 0]);
      expect(deg3(hipStopReading(thighRel(0, 40, 0, ss), ID))).toEqual([0, 0, ss * 40]);
      expect(deg3(hipStopReading(thighRel(0, 0, 40, ss), ID))).toEqual([0, ss * 40, 0]);
    }
    // the largest external rotation the Y stop (45) admits at each flexion: 2 asin(sin 22.5 / cos(flex / 2))
    const admitted = [0, 30, 60, 90, 110, 125].map((flex) => {
      let lo = 0;
      let hi = 179;
      for (let k = 0; k < 50; k++) {
        const mid = (lo + hi) / 2;
        if (hipStopReading(thighRel(flex, 0, mid, 1), ID)[1] <= 45 * RAD) lo = mid;
        else hi = mid;
      }
      return Math.round(lo);
    });
    expect(admitted).toEqual([45, 47, 52, 66, 84, 112]);
    // flexion 90 with rotation 45 either way: ab/adduction components of 31.4, past the adduction stop (30) one way
    const [, , zExt] = hipStopReading(thighRel(90, 0, 45, 1), ID);
    const [, , zInt] = hipStopReading(thighRel(90, 0, -45, 1), ID);
    expect([zExt * DEG, zInt * DEG].map((v) => Number(v.toFixed(1)))).toEqual([-31.4, 31.4]);
  });

  it('a fall-response hip target is held inside the stops less the margin: 129 deg forward (the L4 cone) reads 122 after; one inside is the same vector', () => {
    const box = hipStopBox(HIP_STOPS_V1, 1);
    const m = HIP_STOPS_V1.driveMarginDeg * RAD;
    const dir = (flex: number): Vec3 => qRot(thighRel(flex, 0, 0, 1), v3(0, -1, 0));
    const clamped = clampDirToHipStops(dir(129), ID, box, m);
    expect(Math.atan2(clamped.z, -clamped.y) * DEG).toBeCloseTo(122, 6);
    const inside = dir(100);
    expect(clampDirToHipStops(inside, ID, box, m)).toBe(inside);
    // fault twin: unclamped, the target sits past the flexion stop
    expect(Math.atan2(dir(129).z, -dir(129).y) * DEG).toBeGreaterThan(HIP_STOPS_V1.flexionDeg);
    expect(FALL_L4.hip.flexDeg).toBe(30);
  });
});

describe('ladder rung 8d: a conversion outside the stops', () => {
  it('a hip built 60 deg extended (stop 30) stays where it starts, against a stop widened to it; driven in, the stop closes with it and never reopens; with the stop at 30 from the start (fault twin) Rapier pulls it in at 170 deg/s', async () => {
    const box = hipStopBox(HIP_STOPS_V1, 1);
    const rel0 = thighRel(-60, 0, 0, 1);
    const rig = await hipRig(ID, rel0);
    const h = initHipStop(rig.joint, 'leftHip', 0, rig.core.rotation(), rig.thigh.rotation(), ID, HIP_STOPS_V1, 1);
    expect(Number(h.startOutsideDeg.toFixed(3))).toBe(30);
    expect(deg3([h.current[0][1]])).toEqual([60]);
    expect(readAngularLimits(rig.joint, RAPIER.JointAxis.AngX).max).toBeCloseTo(60 * RAD, 5);
    for (let s = 0; s < 12; s++) rig.world.step();
    expect(Math.abs(rig.reading()[0] * DEG - 60)).toBeLessThan(0.01);
    // in: flexion torque (about -X) for 0.1 s, the stop following
    let least = Infinity;
    for (let s = 0; s < 24; s++) {
      ratchetHipStop(h, rig.joint, rig.core.rotation(), rig.thigh.rotation());
      rig.thigh.resetTorques(true);
      rig.thigh.addTorque({ x: -40, y: 0, z: 0 }, true);
      rig.world.step();
      least = Math.min(least, rig.reading()[0]);
    }
    ratchetHipStop(h, rig.joint, rig.core.rotation(), rig.thigh.rotation());
    expect(h.current[0][1]).toBeLessThan(60 * RAD);
    expect(h.current[0][1]).toBeGreaterThanOrEqual(box[0][1]);
    // out again: held where it closed
    let most = -Infinity;
    for (let s = 0; s < 240; s++) {
      ratchetHipStop(h, rig.joint, rig.core.rotation(), rig.thigh.rotation());
      rig.thigh.resetTorques(true);
      rig.thigh.addTorque({ x: 300, y: 0, z: 0 }, true);
      rig.world.step();
      most = Math.max(most, rig.reading()[0]);
    }
    expect((most - Math.max(least, box[0][1])) * DEG).toBeLessThan(3);
    rig.world.free();
    // fault twin: the nominal stop at the start
    const twin = await hipRig(ID, rel0);
    box.forEach(([lo, hi], k) => setAngularLimits(twin.joint, ANG_AXES[k], lo, hi));
    for (let s = 0; s < 12; s++) twin.world.step();
    expect(60 - twin.reading()[0] * DEG).toBeGreaterThan(8);
    twin.world.free();
  });

  it('a hip past the cap (176 deg of extension reading) takes the cap: the excess beyond it is recorded', async () => {
    const rig = await hipRig(ID, qFromAxisAngle(v3(1, 0, 0), 176 * RAD));
    const h = initHipStop(rig.joint, 'leftHip', 0, rig.core.rotation(), rig.thigh.rotation(), ID, HIP_STOPS_V1, 1);
    expect(deg3([h.current[0][1]])).toEqual([172]);
    expect(Number(h.startBeyondCapDeg.toFixed(3))).toBe(4);
    rig.world.free();
  });
});

describe('ladder rung 8d: a ragdoll built under the field', () => {
  it('has on each hip its anatomical frame and the stops (Rapier\'s readback), widened to its start where it starts outside; none without the field', async () => {
    const read = async (on: boolean) => {
      const d = FIX('L4-F2-model-side-off');
      const sim = await create(on ? { ...d, ragdoll: withHipStops(d.ragdoll!) } : d);
      await stepWhile(sim, () => !sim.players.some((p) => p.rag?.enabled));
      const p = sim.players.find((x) => x.rag?.enabled)!;
      const out = p.rag!.joints
        .filter((j) => j.kind === 'hip')
        .map((j) => {
          const f = j.joint.frameX1();
          const box = ANG_AXES.map((a) => readAngularLimits(j.joint, a));
          const h = p.rag!.hipStops?.find((x) => x.jointId === j.id);
          return { id: j.id, frame: [f.x, f.y, f.z, f.w].map((v) => Number(v.toFixed(6))), want: Object.values(hipNeutralFrame(p.body, j.side!)).map((v) => Number(v.toFixed(6))), box, h, ss: j.sideSign! };
        });
      sim.dispose();
      return out;
    };
    for (const j of await read(true)) {
      expect(j.frame).toEqual([j.want[0], j.want[1], j.want[2], j.want[3]]);
      const nominal: AngBox = hipStopBox(HIP_STOPS_V1, j.ss);
      j.box.forEach((b, i) => {
        expect(b.enabled).toBe(true);
        expect(b.min).toBeLessThanOrEqual(nominal[i][0] + 1e-6);
        expect(b.max).toBeGreaterThanOrEqual(nominal[i][1] - 1e-6);
        expect([b.min, b.max].map((v) => Number(v.toFixed(5)))).toEqual(j.h!.current[i].map((v) => Number(v.toFixed(5))));
      });
    }
    for (const j of await read(false)) {
      expect(j.h).toBeUndefined();
      expect(j.box.map((b) => b.enabled)).toEqual([false, false, false]);
    }
  }, 60000);
});
