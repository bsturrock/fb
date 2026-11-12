import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { swingExtentDeg } from '../src/sim/joint-cone';
import { applyHipApproach, boxGradients, boxReading, clampDirToHipStops, hipStopBox, initHipStop, jointRelative, zoneStartBox, type AngBox, type HipStopRuntime } from '../src/sim/joint-stops';
import { initPhysics } from '../src/sim/physics';
import { ENVELOPE_L4, HIP_APPROACH_V1, HIP_STOPS_L4_V1, HIP_STOPS_V1, HIP_STOPS_V2, hipStopsFor, withHipStops, withoutHipStops, type HipStopProfile } from '../src/sim/profiles';
import { addScaled, dot, m3Add, m3Inverse, m3ParallelAxis, m3Vec, qFromAxisAngle, qFromUnitVectors, qMul, qRot, v3, type Mat3, type Quat, type Vec3 } from '../src/sim/vec';
import { create, FIX, preFlip, preOwnLegs, runSim } from './helpers';
import { INJECTION_J, passiveEnergyMeter, type SolveEnergy } from './passive-energy';
import { loadState, resumeState } from './state';

// Ladder rung 8g: the approach zone inside the hip stops (`HipStopProfile.approach`, src/sim/joint-stops.ts
// `applyHipApproach`), opt-in: HIP_STOPS_V2 (the 8d box with the zone) and HIP_STOPS_L4_V1 (the backstop outside the L4
// soft envelope, the 8i assessment's L4 stops; since rung 8k `hipStopsFor` gives every ragdoll HIP_STOPS_V2,
// tests/l4-hip-box.test.ts). No fixture uses either yet.
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const ID: Quat = { x: 0, y: 0, z: 0, w: 1 };
const DT = 1 / 240;

/** A fixed core and a 10 kg thigh on a spherical hip at the origin (tests/joint-stops.test.ts's rig), no gravity, under `S`. */
async function rig(S: HipStopProfile, rel0: Quat = ID) {
  await initPhysics();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 4;
  const core = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const thigh = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setRotation(rel0));
  world.createCollider(RAPIER.ColliderDesc.capsule(0.16, 0.07).setTranslation(0, -0.23, 0).setMass(10), thigh);
  const joint = world.createImpulseJoint(RAPIER.JointData.spherical(v3(), v3()), core, thigh, true);
  joint.setContactsEnabled(false);
  const h = initHipStop(joint, 'leftHip', 0, core.rotation(), thigh.rotation(), ID, S, 1);
  const reading = (): [number, number, number] => boxReading(jointRelative(core.rotation(), ID, thigh.rotation()));
  const kinetic = (): number => {
    const v = thigh.linvel();
    const w = thigh.angvel();
    const I = thigh.effectiveAngularInertia();
    const [a, b, c, d, e, f] = [I.m11, I.m12, I.m13, I.m22, I.m23, I.m33];
    return 0.5 * thigh.mass() * (v.x ** 2 + v.y ** 2 + v.z ** 2) + 0.5 * (w.x * (a * w.x + b * w.y + c * w.z) + w.y * (b * w.x + d * w.y + e * w.z) + w.z * (c * w.x + e * w.y + f * w.z));
  };
  /** The thigh turning about the hip at `w` (world, rad/s). */
  const spin = (w: Vec3): void => {
    const c = thigh.worldCom();
    thigh.setAngvel(w, true);
    thigh.setLinvel({ x: w.y * c.z - w.z * c.y, y: w.z * c.x - w.x * c.z, z: w.x * c.y - w.y * c.x }, true);
  };
  /** One substep: the zone's torque (`zone`, default the profile's own law), then the solve. */
  const step = (zone: ((h: HipStopRuntime) => void) | null = (hh) => applyHipApproach(hh, S.approach!, core, thigh, v3(), DT)): void => {
    thigh.resetTorques(true);
    if (zone && S.approach) zone(h);
    world.step();
  };
  return { world, core, thigh, h, reading, kinetic, spin, step };
}

/** The band energy of a reading: 1/2 k x^2 summed over the bands it is in (none of these cases reaches the cap). */
function bandEnergy(box: AngBox, v: [number, number, number]): number {
  const A = HIP_APPROACH_V1;
  let U = 0;
  for (let i = 0; i < 3; i++) {
    const k = i === 1 ? A.twist.stiffnessNmPerRad : A.swing.stiffnessNmPerRad;
    const w = (i === 1 ? A.widthDeg.twist : A.widthDeg.swing) * RAD;
    for (const x of [box[i][0] + w - v[i], v[i] - (box[i][1] - w)]) if (x > 0) U += 0.5 * k * x * x;
  }
  return U;
}

/**
 * Fault (passivity): the law as first written, the depth read at the substep's start instead of its end; otherwise the
 * same (the damping capped the same way, the rig's core fixed and the hip at the origin, no start slack: the rig starts
 * outside every band). A band entered within a substep then takes no spring, and one left within a substep a whole one.
 */
function startDepthBand(S: HipStopProfile, core: RAPIER.RigidBody, thigh: RAPIER.RigidBody) {
  return (h: HipStopRuntime): void => {
    const A = S.approach!;
    const e = jointRelative(core.rotation(), h.frame1, thigh.rotation());
    const v = boxReading(e);
    const g1 = boxGradients(e);
    const w = thigh.angvel();
    // the inertia view is shared scratch: read it before any other call
    const I = thigh.effectiveAngularInertia();
    const Ic: Mat3 = [I.m11, I.m12, I.m13, I.m12, I.m22, I.m23, I.m13, I.m23, I.m33];
    const c = thigh.worldCom();
    const inv = m3Inverse(m3Add(Ic, m3ParallelAxis(thigh.mass(), v3(c.x, c.y, c.z))))!;
    let t = v3();
    for (let i = 0; i < 3; i++) {
      const P = i === 1 ? A.twist : A.swing;
      const wd = (i === 1 ? A.widthDeg.twist : A.widthDeg.swing) * RAD;
      const g = qRot(qMul(core.rotation(), h.frame1), g1[i]);
      const rate = dot(g, v3(w.x, w.y, w.z));
      const damping = Math.min(P.dampingNmsPerRad, 1 / (DT * dot(g, m3Vec(inv, g))));
      [h.nominal[i][0] + wd - v[i], v[i] - (h.nominal[i][1] - wd)].forEach((x, k) => {
        if (x <= 0) return;
        const sign = k === 0 ? -1 : 1;
        const m = Math.min(A.maxTorqueNm, Math.max(0, Math.min(P.stiffnessNmPerRad * x, A.maxTorqueNm) + damping * sign * rate));
        t = addScaled(t, g, -sign * m);
      });
    }
    thigh.addTorque(t, true);
  };
}

/** The thigh swung about axis `i` of the hip frame toward the stop of sign `dir` at `w0` rad/s; per substep the reading. */
const CASES: [string, number, number, number][] = [
  ['flexion', 0, -1, 8],
  ['flexion fast', 0, -1, 15],
  ['extension', 0, 1, 8],
  ['abduction', 2, 1, 8],
  ['adduction', 2, -1, 8],
  ['external rotation', 1, 1, 8],
  ['internal rotation fast', 1, -1, 25],
];
const AXES = [v3(1, 0, 0), v3(0, 1, 0), v3(0, 0, 1)];

describe('ladder rung 8g: the approach zone on a thigh swung into its stops (constructed)', () => {
  it('the box reading\'s gradient: the rate of each reading under a small turn of the thigh (central differences), of length 1 / sqrt(w^2 + e_i^2), 1 on its own axis alone; the half-sine reading\'s unit gradient (8d\'s reading, fault twin) is off far from neutral', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let worstFault = 0;
    for (let n = 0; n < 200; n++) {
      const axis = v3(rnd(), rnd(), rnd());
      const q = qFromAxisAngle(axis, Math.PI * 0.95 * Math.abs(rnd()));
      const e = jointRelative(ID, ID, q);
      const g = boxGradients(e);
      const eps = 1e-6;
      const { x, y, z, w } = e;
      // the half-sine reading's gradient: row i of (w I - [v]x) over sqrt(1 - e_i^2)
      const half = [v3(w, z, -y), v3(-z, w, x), v3(y, -x, w)];
      for (let i = 0; i < 3; i++) {
        const c = [x, y, z][i];
        expect(Math.hypot(g[i].x, g[i].y, g[i].z) * Math.hypot(w, c)).toBeCloseTo(1, 9);
        AXES.forEach((a, k) => {
          const turn = (s: number): number => boxReading(jointRelative(ID, ID, qMul(qFromAxisAngle(a, s * eps), q)))[i];
          const num = (turn(1) - turn(-1)) / (2 * eps);
          const ana = [g[i].x, g[i].y, g[i].z][k];
          expect(Math.abs(num - ana)).toBeLessThan(1e-5 * Math.max(1, Math.abs(ana)));
          worstFault = Math.max(worstFault, Math.abs(num - [half[i].x, half[i].y, half[i].z][k] / Math.sqrt(1 - c * c)));
        });
      }
    }
    expect(worstFault).toBeGreaterThan(0.3);
  });

  it('swung into each stop, the thigh stops inside the band and keeps a few percent of its energy; with the stops alone (fault twin) it goes to the stop', async () => {
    const rows: string[] = [];
    for (const [name, i, dir, w0] of CASES) {
      const run = async (S: HipStopProfile) => {
        const r = await rig(S);
        r.spin({ x: AXES[i].x * dir * w0, y: AXES[i].y * dir * w0, z: AXES[i].z * dir * w0 });
        const K0 = r.kinetic();
        let peak = -Infinity;
        for (let s = 0; s < 240; s++) {
          r.step();
          peak = Math.max(peak, dir * r.reading()[i]);
        }
        const stop = dir < 0 ? -r.h.nominal[i][0] : r.h.nominal[i][1];
        const out = { K0, kept: r.kinetic() / K0, peak, stop };
        r.world.free();
        return out;
      };
      const zone = await run(HIP_STOPS_V2);
      const hard = await run(HIP_STOPS_V1);
      rows.push(`${name}: stop ${(zone.stop * DEG).toFixed(0)}, zone peak ${(zone.peak * DEG).toFixed(2)} kept ${(zone.kept * 100).toFixed(1)}%, stops alone peak ${(hard.peak * DEG).toFixed(2)}`);
      expect((zone.stop - zone.peak) * DEG, name).toBeGreaterThan(3);
      expect(zone.kept, name).toBeLessThan(0.1);
      expect(Math.abs(hard.peak - hard.stop) * DEG, name).toBeLessThan(1.5);
    }
    expect(rows.length).toBe(CASES.length);
  });

  it('passive as stepped: the thigh\'s kinetic energy plus the band\'s never rises in a substep, whatever the phase of the entry in a substep; read at the substep\'s start (fault twin) a band gives energy back at some phase on every axis', async () => {
    for (const [name, i, dir, w0] of CASES) {
      // six speeds over 40%: the band entered at six phases of a substep (a rise read at the start depends on the phase)
      const run = async (explicit: boolean, w: number) => {
        const r = await rig(HIP_STOPS_V2);
        r.spin({ x: AXES[i].x * dir * w, y: AXES[i].y * dir * w, z: AXES[i].z * dir * w });
        const energy = (): number => r.kinetic() + bandEnergy(r.h.nominal, r.reading());
        const E0 = energy();
        let prev = E0;
        let rise = 0;
        const law = explicit ? startDepthBand(HIP_STOPS_V2, r.core, r.thigh) : undefined;
        for (let s = 0; s < 240; s++) {
          r.step(law);
          const E = energy();
          rise = Math.max(rise, E - prev);
          prev = E;
        }
        r.world.free();
        return rise / E0;
      };
      let ok = 0;
      let bad = 0;
      for (let j = 0; j < 6; j++) {
        ok = Math.max(ok, await run(false, w0 * (1 + j / 15)));
        bad = Math.max(bad, await run(true, w0 * (1 + j / 15)));
      }
      expect(ok, name).toBeLessThan(1e-4);
      expect(bad, name).toBeGreaterThan(0.01);
    }
  });

  it('a hip built 7 deg inside the adduction band starts with the slack\'s decay alone (6.5 N m) and is eased out; with no slack (fault twin) it takes the whole band at once (over 360 N m)', async () => {
    const S = HIP_STOPS_V2;
    const rel0 = qFromUnitVectors(v3(0, -1, 0), v3(-Math.sin(27 * RAD), -Math.cos(27 * RAD), 0));
    const r = await rig(S, rel0);
    expect(r.reading()[2] * DEG).toBeCloseTo(-27, 6);
    expect(r.h.approach!.slack[2][0] * DEG).toBeCloseTo(7, 6);
    const torques: number[] = [];
    for (let s = 0; s < 48; s++) {
      r.step();
      const t = r.h.approach!.torque;
      torques.push(Math.hypot(t.x, t.y, t.z));
    }
    // the first substep: only the slack's decay, 30 deg/s over one substep (6.5 N m); then the thigh, eased out of the
    // band, stays ahead of the slack, and the torque falls
    const k = HIP_APPROACH_V1.swing.stiffnessNmPerRad;
    expect(torques[0]).toBeCloseTo(k * HIP_APPROACH_V1.slackDecayDegPerS * RAD * DT, 6);
    expect(Math.max(...torques)).toBe(torques[0]);
    expect(torques[47]).toBeGreaterThan(0);
    expect(-r.reading()[2] * DEG).toBeLessThan(25);
    r.world.free();
    const twin = await rig(S, rel0);
    twin.h.approach!.slack = [[0, 0], [0, 0], [0, 0]];
    twin.step();
    const t = twin.h.approach!.torque;
    expect(Math.hypot(t.x, t.y, t.z)).toBeGreaterThan(HIP_APPROACH_V1.swing.stiffnessNmPerRad * 6.9 * RAD);
    twin.world.free();
  });

  it('a fall-response hip target is held inside the zone less the margin: 129 deg forward reads 112 under the zone; the stops\' own box (fault twin) leaves it in the band at 122', () => {
    const dir = (flex: number): Vec3 => v3(0, -Math.cos(flex * RAD), Math.sin(flex * RAD));
    const flexOf = (d: Vec3): number => Math.atan2(d.z, -d.y) * DEG;
    const box = hipStopBox(HIP_STOPS_V2, 1);
    const m = HIP_STOPS_V2.driveMarginDeg * RAD;
    expect(flexOf(clampDirToHipStops(dir(129), ID, zoneStartBox(box, HIP_STOPS_V2.approach), m))).toBeCloseTo(112, 6);
    expect(flexOf(clampDirToHipStops(dir(129), ID, zoneStartBox(box, undefined), m))).toBeCloseTo(122, 6);
  });
});

describe('ladder rung 8g: the L4 backstop', () => {
  it('every ragdoll takes the 8d box with the zone (rung 8k: L4 too); on each axis alone the backstop\'s zone starts 5 deg past the L4 envelope\'s range plus its tolerance (the 8d box, fault twin, lies inside the envelope)', () => {
    for (const id of ['L4-F2-side-off', 'L3-F9-convert-free', 'HC-F1-mirror']) expect(hipStopsFor(FIX(id).ragdoll!), id).toBe(HIP_STOPS_V2);
    const E = ENVELOPE_L4.hip;
    const tol = ENVELOPE_L4.toleranceDeg;
    const range = { flexionDeg: swingExtentDeg(E, 0), abductionDeg: swingExtentDeg(E, 90), extensionDeg: swingExtentDeg(E, 180), adductionDeg: swingExtentDeg(E, -90), internalDeg: -E.twistDeg[0], externalDeg: E.twistDeg[1] };
    expect(range).toEqual({ flexionDeg: 128.75, abductionDeg: 61.25, extensionDeg: 39, adductionDeg: 45, internalDeg: 50, externalDeg: 50 });
    const zone = (S: HipStopProfile, k: keyof typeof range): number => S[k] - (k === 'internalDeg' || k === 'externalDeg' ? S.approach!.widthDeg.twist : S.approach!.widthDeg.swing);
    for (const k of Object.keys(range) as (keyof typeof range)[]) {
      // 5 deg of the zone's look-ahead past the envelope's tolerance
      expect(zone(HIP_STOPS_L4_V1, k), k).toBeGreaterThanOrEqual(range[k] + tol + 5);
      expect(zone(HIP_STOPS_L4_V1, k), k).toBeLessThan(range[k] + tol + 6);
      expect(HIP_STOPS_V1[k], k).toBeLessThanOrEqual(range[k]);
    }
  });

  it('on L4 the envelope takes the hips first: L4-F1-hipSwing, L4-F1-hipTwist and L4-F2-side-off under the backstop run as registered to the byte (the profile id aside), no band entered; under the 8d box (fault twin) each differs', async () => {
    const run = async (id: string, S?: HipStopProfile) => {
      // (the registered profile without its hip stops: since the visible flip the box with the zone is registered, so the
      // backstop is compared with no stops at all; and as before own-leg contact, ladder 9: no fixture takes the
      // backstop since 8k, and with own-leg contact L4-F1-hipTwist's legs press R's twisted hip 0.03 deg into the
      // backstop's band at 3.12 s, so the backstop's contract is the profile it was built on)
      const d = { ...FIX(id), ragdoll: withoutHipStops(preOwnLegs(FIX(id)).ragdoll!) };
      const s = await create(S ? { ...d, ragdoll: withHipStops(d.ragdoll!, S) } : d, { trace: true });
      await runSim(s);
      const depth = Math.max(0, ...s.players.flatMap((p) => p.rag?.hipStops?.map((h) => h.approach?.maxDepthDeg ?? 0) ?? []));
      const out = JSON.stringify({ summary: s.summary(), events: s.events, trace: s.trace }).replace(/\+hip-stops-[a-z0-9-]+/g, '');
      s.dispose();
      return { out, depth };
    };
    for (const id of ['L4-F1-hipSwing', 'L4-F1-hipTwist', 'L4-F2-side-off']) {
      const base = await run(id);
      const back = await run(id, HIP_STOPS_L4_V1);
      expect(back.out === base.out, id).toBe(true);
      expect(back.depth, id).toBe(0);
      const v1 = await run(id, HIP_STOPS_V1);
      expect(v1.out === base.out, id).toBe(false);
    }
  }, 180000);
});

// The hip-stop rebound (found at 8e): L4-F2-side-off (one ragdoll dropped on its side, the response off) under the 8d
// box alone: R's right hip meets the adduction stop at solve 69 while flexing and untwisting, the solves lose 6.5 and 7.7
// J (69, 70), and solve 71 gains 4.19 J with no contact at all (73 and 74 gain 3.1 and 2.9 with the floor only). The
// capture is that run under HIP_STOPS_V2 (the same box with the zone) at the end of tick 12 (solve 48, 0.200 s): every
// hip outside every band, so up to there the run is the 8d box's to the byte (no band has acted), 21 solves before the
// stop. Resumed as captured the zone takes the hip; resumed under the 8d box (`variant: ['ragdoll']`) it is the 8d run.
const CAP = 'tests/data/state/L4-F2-side-off~hipsv2@12.json.gz';
const SIDE = 'L4-F2-side-off';

async function fromCapture(S: HipStopProfile) {
  // (captured before the visible flip: resumed under the profile it ran under, the stops aside)
  const d = preFlip(FIX(SIDE));
  const sim = await resumeState(loadState(CAP), { def: { ...d, ragdoll: withHipStops(d.ragdoll!, S) }, variant: ['ragdoll'] });
  const R = sim.players[0];
  const hip = R.rag!.hipStops!.find((h) => h.jointId === 'rightHip')!;
  const solves = new Map<number, SolveEnergy & { addDeg: number }>();
  const meter = passiveEnergyMeter(sim, (e) => {
    const j = R.rag!.joints[hip.jointIndex];
    const z = boxReading(jointRelative(R.rag!.bodies[j.parent].rotation(), hip.frame1, R.rag!.bodies[j.child].rotation()))[2];
    // the right hip's adduction reading against its stop (deg; the right side's adduction is the Z stop's lower bound)
    solves.set(e.step, { ...e, addDeg: (hip.nominal[2][0] - z) * DEG });
  });
  const start = sim.steps;
  await runSim(sim);
  meter.restore();
  sim.dispose();
  return { solves, start };
}

describe('ladder rung 8g: the hip-stop rebound, from a capture', () => {
  it('regression: from 0.200 s with the zone no solve of L4-F2-side-off R gains over the threshold (the largest 0.001 J) and the right hip stays over 5 deg inside its adduction stop; under the 8d box alone (fault twin) solve 71 gains 4.19 J with no contact, the hip on the stop', async () => {
    const zone = await fromCapture(HIP_STOPS_V2);
    expect(zone.start).toBe(48);
    const counted = [...zone.solves.values()].filter((e) => !e.touched);
    expect(counted.length).toBeGreaterThan(300);
    expect(Math.max(...counted.map((e) => e.passiveJ))).toBeLessThan(INJECTION_J);
    // the right hip's closest approach to its adduction stop over the whole run (8.2 deg short)
    expect(Math.max(...[...zone.solves.values()].map((e) => e.addDeg))).toBeLessThan(-5);

    const hard = await fromCapture(HIP_STOPS_V1);
    const at = hard.solves.get(71)!;
    expect(at.touched).toBe(false);
    expect(at.contact).toBe(false);
    expect(at.passiveJ).toBeGreaterThan(4);
    // the arrest before it: two solves losing 6 J and more
    expect(hard.solves.get(69)!.passiveJ).toBeLessThan(-6);
    expect(hard.solves.get(70)!.passiveJ).toBeLessThan(-6);
    // the hip on its stop (0.28 deg past it at solve 71 on the box reading, Rapier's own measure since 7062264)
    expect(at.addDeg).toBeGreaterThan(-1.5);
  }, 120000);
});
