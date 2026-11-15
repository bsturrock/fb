import RAPIER from '@dimforge/rapier3d-compat';
import { describe, expect, it } from 'vitest';
import { initPhysics } from '../src/sim/physics';
import { ENVELOPE_L4, JOINT_RANGE_V2, SHOULDER_TWIST_ANAT_V1, SHOULDER_TWIST_ANAT_V2, withoutShoulderTwistLimit, withShoulderTwistLimit, type JointEnvelope, type ShoulderTwistLimitProfile } from '../src/sim/profiles';
import { anatomicalTwist, applyEnvelope, envelopeMoments, initEnvelope, steppedLimitPush, type Ragdoll, type RagdollJoint } from '../src/sim/ragdoll';
import { add, cross, dot, qConj, qFromAxisAngle, qFromUnitVectors, qMul, qRot, scale, v3, type Quat, type Vec3 } from '../src/sim/vec';
import { asCaptured } from './runs';
import { loadState, resumeState } from './state';
import { HUMAN_RANGES, jointQuats, qAngle, shoulderRotationDeg, SNAP_RADPS, VisibleMeter } from './visible';

// Ladder 13a-iii: the shoulder twist limit stepped over the substep on the arm's own inertia (SHOULDER_TWIST_ANAT_V2,
// `steppedLimitPush`), in place of plan 09's explicit spring-damper (400 N m/rad with 2 N m s: about 0.3 of critical
// for a bent arm, and for a straight one so light that one substep's push overshoots). Under V1 an arm lifted past its
// stop stored the impact and gave it back (`SHOULDER_TWIST_REBOUND`). Registered on every L3, L4 and HC ragdoll since the
// shoulder twist flip (src/sim/fixtures/index.ts `shoulderTwistFlip`).
const E: JointEnvelope = JOINT_RANGE_V2.shoulder;
const ROT = HUMAN_RANGES.find((r) => r.joint === 'Shoulder' && r.dof === 'rotation')!;
const D = 180 / Math.PI;
const DT = 1 / 240;
const SIDE = 1;
const NO_SLACK = { swingSlack: 0, twistSlackLo: 0, twistSlackHi: 0 };
const K = E.twist.stiffnessNmPerRad;
const CAP = E.maxTorqueNm;

/** The core-to-upper-arm rotation of an arm along `dir` (core frame, unit) at anatomical external twist `twistDeg`. */
function armAt(dir: Vec3, twistDeg: number): Quat {
  const q0 = qFromUnitVectors(v3(0, -1, 0), dir);
  const t0 = anatomicalTwist(E, q0, SIDE).tw;
  // a turn of x about the limb's own +Y raises the external twist by side * x
  return qMul(q0, qFromAxisAngle(v3(0, 1, 0), SIDE * (twistDeg / D - t0)));
}
/** A direction at elevation `elevDeg` above horizontal, azimuth `azDeg` from forward toward the arm's own side. */
const dirAt = (elevDeg: number, azDeg: number): Vec3 => {
  const [e, a] = [elevDeg / D, azDeg / D];
  return v3(SIDE * Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
};
const vc = (v: { x: number; y: number; z: number }): Vec3 => v3(v.x, v.y, v.z);

const UPPER = 0.3;
const FORE = 0.3;
const ID: Quat = { x: 0, y: 0, z: 0, w: 1 };
/** The forearm's rotation on the upper arm: straight, or bent 90 deg (it points along the upper arm's own +Z). */
const ELBOW = { straight: ID, bent: qFromAxisAngle(v3(1, 0, 0), -Math.PI / 2) };
type Elbow = keyof typeof ELBOW;

/**
 * A fixed core and one arm in no gravity: a 2 kg upper arm on the shoulder at the origin and a 1.6 kg forearm held on
 * it at the elbow, straight or bent 90 deg, as a ragdoll's left shoulder under the L4 envelope with the joint-range
 * profiles' shoulder and twist limit `limit` (none: plan 09's). The envelope runs as the ragdoll runs it (`initEnvelope`
 * at the start, `applyEnvelope` before each solve). `hinge`: the shoulder turns only about the upper arm's own axis (a
 * raised arm held where it is while it twists), else it is free (spherical).
 */
async function armRig(limit: ShoulderTwistLimitProfile | undefined, elbow: Elbow, q0: Quat, hinge: boolean) {
  await initPhysics();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = DT;
  world.numSolverIterations = 8;
  const core = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  const ua = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  world.createCollider(RAPIER.ColliderDesc.capsule(UPPER / 2 - 0.045, 0.045).setMass(2), ua);
  const fa = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic());
  world.createCollider(RAPIER.ColliderDesc.capsule(FORE / 2 - 0.04, 0.04).setMass(1.6), fa);
  /** The arm placed at core-to-upper-arm rotation `q` (the core stays at the origin, unturned). */
  const place = (q: Quat): void => {
    const fq = qMul(q, ELBOW[elbow]);
    ua.setTranslation(qRot(q, v3(0, -UPPER / 2, 0)), true);
    ua.setRotation(q, true);
    fa.setTranslation(add(qRot(q, v3(0, -UPPER, 0)), qRot(fq, v3(0, -FORE / 2, 0))), true);
    fa.setRotation(fq, true);
  };
  place(q0);
  const data = hinge ? RAPIER.JointData.revoluteWithAxes(v3(), v3(0, UPPER / 2, 0), qRot(q0, v3(0, -1, 0)), v3(0, -1, 0)) : RAPIER.JointData.spherical(v3(), v3(0, UPPER / 2, 0));
  const shoulder = world.createImpulseJoint(data, core, ua, true);
  shoulder.setContactsEnabled(false);
  world.createImpulseJoint(RAPIER.JointData.fixed(v3(0, -UPPER / 2, 0), ELBOW[elbow], v3(0, FORE / 2, 0), ID), ua, fa, true).setContactsEnabled(false);
  const j: RagdollJoint = { id: 'leftShoulder', kind: 'shoulder', parent: 'core', child: 'leftUpperArm', joint: shoulder, anchorParentLocal: v3(), anchorChildLocal: v3(0, UPPER / 2, 0), blueprintParentLocal: v3(), blueprintChildLocal: v3(), limitsRad: null, side: 'left', sideSign: SIDE };
  const rag = { profile: { envelope: { ...ENVELOPE_L4, shoulder: E }, ...(limit ? { shoulderTwistLimit: limit } : {}) }, joints: [j], bodies: { core, leftUpperArm: ua, leftForearm: fa } } as unknown as Ragdoll;
  initEnvelope(rag);
  const e = rag.envelope![0];
  /** The arm turning about the shoulder at `w` (world, rad/s). */
  const spin = (w: Vec3): void => {
    for (const b of [ua, fa]) {
      b.setAngvel(w, true);
      b.setLinvel(cross(w, vc(b.worldCom())), true);
    }
  };
  const kinetic = (): number =>
    [ua, fa].reduce((s, b) => {
      const v = b.linvel();
      const w = vc(b.angvel());
      const I = b.effectiveAngularInertia();
      const Iw = v3(I.m11 * w.x + I.m12 * w.y + I.m13 * w.z, I.m12 * w.x + I.m22 * w.y + I.m23 * w.z, I.m13 * w.x + I.m23 * w.y + I.m33 * w.z);
      return s + 0.5 * b.mass() * (v.x ** 2 + v.y ** 2 + v.z ** 2) + 0.5 * dot(w, Iw);
    }, 0);
  const rel = (): Quat => qMul(qConj(core.rotation()), ua.rotation());
  /** The anatomical twist's scaled excess past the nearer stop (rad, < 0 inside). */
  const excess = (): number => {
    const M = envelopeMoments(E, rel(), SIDE, NO_SLACK, v3(), SHOULDER_TWIST_ANAT_V1);
    return Math.max(M.hi.excess, M.lo.excess);
  };
  /** The visible meter's shoulder rotation past the human range (deg, < 0 inside). */
  const meter = (): number => ROT.excess({ swing: 0, coneEx: 0, rot: shoulderRotationDeg(rel(), SIDE) });
  const step = (): void => {
    ua.resetTorques(true);
    applyEnvelope(rag, DT);
    world.step();
  };
  return { world, rag, ua, e, place, spin, kinetic, excess, meter, step };
}

interface Spun {
  /** The meter's peak past the range (deg). */
  meterPeak: number;
  /** The kinetic energy when the stop first lets go, over the start's: what it gave back (nothing else acts). */
  returned: number;
  /** The largest kinetic plus stop energy (1/2 k x^2 past the stop) over the start's. */
  gain: number;
  /** The limit's largest push (N m): the stop was reached. */
  pushNm: number;
}

/** A raised arm 30 deg inside its range, spun about its own axis toward external rotation at `w0` rad/s for 0.5 s. */
async function spun(limit: ShoulderTwistLimitProfile | undefined, elbow: Elbow, [elevDeg, azDeg]: number[], w0: number): Promise<Spun> {
  const r = await armRig(limit, elbow, armAt(dirAt(elevDeg, azDeg), 70), true);
  r.spin(scale(qRot(r.ua.rotation(), v3(0, SIDE, 0)), w0));
  const k0 = r.kinetic();
  const out = { meterPeak: -Infinity, returned: NaN, gain: 0, pushNm: 0 };
  for (let i = 0; i < 120; i++) {
    r.step();
    out.meterPeak = Math.max(out.meterPeak, r.meter());
    out.gain = Math.max(out.gain, (r.kinetic() + 0.5 * K * Math.max(0, r.excess()) ** 2) / k0);
    const push = Math.hypot(r.e.torque.x, r.e.torque.y, r.e.torque.z);
    if (push === 0 && out.pushNm > 0 && Number.isNaN(out.returned)) out.returned = r.kinetic() / k0;
    out.pushNm = Math.max(out.pushNm, push);
  }
  r.world.free();
  return out;
}

/** Raised postures (elevation, azimuth) with a twist rate (rad/s): out to the side near vertical, forward and up, out and up. */
const RAISED: [number[], number][] = [
  [[80, 90], 10],
  [[55, 30], 15],
  [[30, 60], 15],
];
const ARMS: Elbow[] = ['bent', 'straight'];

describe('ladder 13a-iii: the stepped shoulder twist limit (SHOULDER_TWIST_ANAT_V2)', () => {
  it("the push: none until the substep would end past the stop, never pulls or passes the cap, never carries the joint back past the stop within the substep, critically damped for a heavy arm; plan 09's explicit law on a light arm throws it back past the stop in one substep (the fault twin)", () => {
    let seed = 11;
    const rnd = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let crossed = 0;
    for (let i = 0; i < 4000; i++) {
      const x = 0.2 * rnd();
      const u = 40 * rnd();
      const n = 5 + 495 * Math.abs(rnd());
      const xEnd = x + u * DT;
      const m = steppedLimitPush(x, u, n, K, 1, CAP, DT);
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(CAP);
      // none unless the substep would end past the stop, and then never so much that it ends back inside
      if (xEnd <= 0) expect(m).toBe(0);
      else expect(xEnd - n * m * DT * DT).toBeGreaterThanOrEqual(-1e-12);
      // plan 09's law on the same term
      const p = x > 0 ? Math.min(CAP, Math.max(0, Math.min(K * x, CAP) + E.twist.dampingNmsPerRad * u)) : 0;
      if (xEnd - n * p * DT * DT < -1e-3) crossed++;
    }
    expect(crossed).toBeGreaterThan(100);
    // the substep it will cross the stop in, the push starts
    expect(steppedLimitPush(-0.01, 10, 20, K, 1, CAP, DT)).toBeGreaterThan(0);
    expect(steppedLimitPush(-0.01, 2, 20, K, 1, CAP, DT)).toBe(0);
    // a heavy arm (n 20: 0.05 kg m^2), inside its no-crossing bound: the spring at the substep's end and critical damping
    const [x, u, n] = [0.02, 1, 20];
    expect(steppedLimitPush(x, u, n, K, 1, CAP, DT)).toBeCloseTo(K * (x + u * DT) + 2 * Math.sqrt(K / n) * u, 9);
  });

  it("an arm swung overhead with no twist of its own takes no twist torque; plan 09's limit pushes on the same path (the fault twin)", async () => {
    // from hanging up the side to 80 deg, then round over the head toward the front at 75, at anatomical external
    // twist 0 throughout (the natural arm), the elbow bent; every pose inside the swing cone
    const path: Quat[] = [];
    for (let e = -80; e <= 80; e += 1) path.push(armAt(dirAt(e, 90), 0));
    for (let a = 90; a >= -30; a -= 1) path.push(armAt(dirAt(75, a), 0));
    const worstPush = async (limit: ShoulderTwistLimitProfile | undefined): Promise<number> => {
      const r = await armRig(limit, 'bent', path[0], false);
      let worst = 0;
      for (let i = 1; i < path.length; i++) {
        expect(envelopeMoments(E, path[i], SIDE, NO_SLACK, v3()).swing.excess).toBeLessThan(0);
        // at the path's own rate, one pose per substep
        const d = qMul(path[i], qConj(path[i - 1]));
        const sv = Math.hypot(d.x, d.y, d.z);
        r.place(path[i]);
        r.spin(sv > 0 ? scale(v3(d.x, d.y, d.z), (2 * Math.atan2(sv, d.w)) / sv / DT) : v3());
        applyEnvelope(r.rag, DT);
        worst = Math.max(worst, Math.hypot(r.e.torque.x, r.e.torque.y, r.e.torque.z));
      }
      r.world.free();
      return worst;
    };
    expect(await worstPush(SHOULDER_TWIST_ANAT_V2)).toBe(0);
    expect(await worstPush(undefined)).toBeGreaterThan(20);
  });

  it('a raised arm turned past its range is stopped at the anatomical stop, short of the implausible margin, and given back less than 15% of its energy; plan 09\'s limit lets it turn past the margin, and V1 gives back more than 30% (the fault twins)', async () => {
    for (const elbow of ARMS)
      for (const [pose, w0] of RAISED) {
        const at = `${elbow} arm at ${pose.join('/')}, ${w0} rad/s`;
        const v2 = await spun(SHOULDER_TWIST_ANAT_V2, elbow, pose, w0);
        expect(v2.pushNm, at).toBeGreaterThan(1);
        expect(v2.meterPeak, at).toBeLessThan(ROT.implausible);
        expect(v2.returned, at).toBeLessThan(0.15);
        expect((await spun(undefined, elbow, pose, w0)).meterPeak, at).toBeGreaterThan(ROT.implausible);
        expect((await spun(SHOULDER_TWIST_ANAT_V1, elbow, pose, w0)).returned, at).toBeGreaterThan(0.3);
      }
  });

  it('the stop adds no energy: kinetic plus stop energy never rises past the start, bent or straight, slow or fast; V1 on a straight arm gains (the fault twin)', async () => {
    let v1Gain = 0;
    for (const elbow of ARMS)
      for (const [pose] of RAISED)
        for (const w0 of [5, 15, 30]) {
          const at = `${elbow} arm at ${pose.join('/')}, ${w0} rad/s`;
          const v2 = await spun(SHOULDER_TWIST_ANAT_V2, elbow, pose, w0);
          expect(v2.pushNm, at).toBeGreaterThan(1);
          expect(v2.gain, at).toBeLessThan(1.001);
          if (elbow === 'straight') v1Gain = Math.max(v1Gain, (await spun(SHOULDER_TWIST_ANAT_V1, elbow, pose, w0)).gain);
        }
    expect(v1Gain).toBeGreaterThan(1.05);
  });

  it("L4-F10-elbow-on from 0.333 s: R's left arm, lifted past its stop with the elbow bent, is spun back through the whole range in one drawn frame under V1 as the elbow straightens (the fault twin); under V2 no joint turns faster than the snap bar, the shoulder never reaches the impossible margin, and its limit takes out more than it gives back", async () => {
    const cap = loadState(CAPTURE);
    const def = asCaptured(cap);
    const run = async (limit: ShoulderTwistLimitProfile) => {
      const sim = await resumeState(cap, { def: { ...def, ragdoll: withShoulderTwistLimit(withoutShoulderTwistLimit(def.ragdoll!), limit) }, variant: ['ragdoll'] });
      const rag = sim.players.find((p) => p.id === 'R')!.rag!;
      expect(rag.profile.shoulderTwistLimit).toBe(limit);
      const e = rag.envelope!.find((x) => x.jointId === 'leftShoulder')!;
      const [pos0, neg0] = [e.passivePositiveJ, e.passiveNegativeJ];
      const meter = new VisibleMeter(sim, { fat: {}, axis: {} });
      while (!sim.done) {
        sim.stepTick();
        meter.frame();
      }
      const out = meter.finish();
      sim.dispose();
      return { snaps: out.rag.snap60, worst: out.worst.snap60, impossibleS: out.rag.imp['Shoulder.rotation'] ?? 0, returnedJ: e.passivePositiveJ - pos0, absorbedJ: e.passiveNegativeJ - neg0 };
    };
    const v1 = await run(SHOULDER_TWIST_ANAT_V1);
    expect(v1.worst?.slice(0, 2)).toEqual(['R', 'leftShoulder']);
    const v2 = await run(SHOULDER_TWIST_ANAT_V2);
    expect(v2.snaps).toBe(0);
    expect(v2.impossibleS).toBe(0);
    expect(v2.returnedJ).toBeLessThan(v2.absorbedJ);
  }, 120000);
});

const CAPTURE = 'tests/data/state/L4-F10-elbow-on@20.json.gz';

// Tracked (rule 5), reached by the shoulder twist flip. LANDING_SHOULDER_SNAP: L3-F9-low (both orders) and L4-F9-low
// reversed, the carrier R lands on his free left arm at 1.03 s (the landing of LANDING_ELBOW_SNAP,
// tests/fall-react-defects.test.ts). The landing whips the passive arm; under the registered limit the shoulder is the
// joint past the snap bar (62 rad/s forward, 88 reversed; 67 on L4-F9-low reversed), where before the flip the reversed
// run's elbow was (62) and the forward run's shoulder spun 79 deg past its twist range for 0.1 s instead. Captured at
// 1.000 s (L3-F9-low reversed, registered): plan 09's limit from the same state snaps the shoulder the same (87 rad/s);
// through the whip the shoulder's limit absorbs about 70 J under either. The landing makes the snap and the limit brakes
// it: reached by the moved trajectory, not made by the limit. Pinned present; once it is gone this becomes the fix's test
describe('the shoulder twist flip: tracked defects (rule 5)', () => {
  it("LANDING_SHOULDER_SNAP (L3-F9-low reversed, from 1.000 s): R's left shoulder turns past SNAP_RADPS in one drawn frame as he lands on the arm, under the registered limit and under plan 09's from the same state; the limit takes out more than it gives back meanwhile", async () => {
    const cap = loadState('tests/data/state/L3-F9-low~rev@60.json.gz');
    const def = asCaptured(cap);
    expect(def.ragdoll!.shoulderTwistLimit).toBe(SHOULDER_TWIST_ANAT_V2);
    const look = async (limit: ShoulderTwistLimitProfile | null) => {
      const r = withoutShoulderTwistLimit(def.ragdoll!);
      const sim = await resumeState(cap, { def: { ...def, ragdoll: limit ? withShoulderTwistLimit(r, limit) : r }, variant: ['ragdoll'] });
      const R = sim.byId.get('R')!;
      const e = R.rag!.envelope!.find((x) => x.jointId === 'leftShoulder')!;
      const [pos0, neg0] = [e.passivePositiveJ, e.passiveNegativeJ];
      let prev: Record<string, Quat> | null = null;
      const snaps: { t: number; w: number }[] = [];
      while (!sim.done && sim.t < 1.1 - 1e-9) {
        sim.stepTick();
        const q = jointQuats(R.pose!);
        const w = prev ? qAngle(prev.leftShoulder, q.leftShoulder) / sim.def.solver.outerTickS : 0;
        if (w > SNAP_RADPS) snaps.push({ t: sim.t, w });
        prev = q;
      }
      const out = { snaps, returnedJ: e.passivePositiveJ - pos0, absorbedJ: e.passiveNegativeJ - neg0 };
      sim.dispose();
      return out;
    };
    const on = await look(SHOULDER_TWIST_ANAT_V2);
    const off = await look(null);
    const said = JSON.stringify({ on, off });
    for (const r of [on, off]) {
      expect(r.snaps.length, said).toBeGreaterThanOrEqual(1);
      for (const x of r.snaps) expect(x.t, said).toBeCloseTo(1.033, 2);
      expect(r.returnedJ, said).toBeLessThan(r.absorbedJ);
    }
  }, 60000);
});
