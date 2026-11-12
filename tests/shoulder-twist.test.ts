import { describe, expect, it } from 'vitest';
import { JOINT_RANGE_V2, SHOULDER_TWIST_ANAT_V1, withShoulderTwistLimit, type JointEnvelope } from '../src/sim/profiles';
import { anatomicalTwist, envelopeMoments } from '../src/sim/ragdoll';
import { add, dot, len, norm, qConj, qFromAxisAngle, qFromUnitVectors, qMul, scale, v3, type Quat, type Vec3 } from '../src/sim/vec';
import { loadedLimbMonitor, type LimbRecord } from './loaded-limb';
import { asCaptured } from './runs';
import { loadState, resumeState } from './state';
import { HUMAN_RANGES, shoulderRotationDeg } from './visible';

// Ladder 13a: the ragdoll shoulder's twist limit in the anatomical measure (SHOULDER_TWIST_ANAT_V1). Plan 09's limit
// measures the twist after the shortest arc from the hanging arm and fades its excess by cos(swing / 2) toward an arm
// straight overhead, where that measure turns singular; raised high it read the wrong twist and acted weakly. The
// anatomical measure (`limbAnatomicalTwistRad`, the visible meter's since 13a-i) is plan 09's up to horizontal and
// regular overhead; its excess is scaled to the turn that removes it (`anatomicalTwistReach`).
const E: JointEnvelope = JOINT_RANGE_V2.shoulder;
const A = SHOULDER_TWIST_ANAT_V1;
const D = 180 / Math.PI;
const NO_SLACK = { swingSlack: 0, twistSlackLo: 0, twistSlackHi: 0 };

/** The core-to-upper-arm rotation of an arm along `dir` (core frame, unit) at anatomical external twist `twistDeg`. */
function armAt(side: number, dir: Vec3, twistDeg: number): Quat {
  const q0 = qFromUnitVectors(v3(0, -1, 0), dir);
  const t0 = anatomicalTwist(E, q0, side).tw;
  // a turn of x about the limb's own +Y raises the external twist by side * x
  return qMul(q0, qFromAxisAngle(v3(0, 1, 0), side * (twistDeg / D - t0)));
}
/** A direction at elevation `elevDeg` above horizontal, azimuth `azDeg` from forward toward the arm's own side. */
const dirAt = (side: number, elevDeg: number, azDeg: number): Vec3 => {
  const e = elevDeg / D;
  const a = azDeg / D;
  return v3(side * Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
};
const excessOf = (M: { hi: { excess: number }; lo: { excess: number } }): number => Math.max(M.hi.excess, M.lo.excess);

const STEPS = 400;
const span = (a: number, b: number): number[] => Array.from({ length: STEPS }, (_, i) => a + ((b - a) * i) / STEPS);

/** Work (J) the limit's spring does on the arm along a path of relative rotations taken at rest (trapezoid rule). */
function loopWork(side: number, path: Quat[], closed = true): number {
  const torque = (q: Quat): Vec3 => envelopeMoments(E, q, side, NO_SLACK, v3(), A).torque;
  let work = 0;
  for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
    const [a, b] = [path[i], path[(i + 1) % path.length]];
    const d = qMul(b, qConj(a));
    const sv = Math.hypot(d.x, d.y, d.z);
    const angle = 2 * Math.atan2(sv, Math.abs(d.w)) * Math.sign(d.w || 1);
    const turn = sv > 1e-12 ? scale(v3(d.x, d.y, d.z), angle / sv) : v3();
    work += dot(scale(add(torque(a), torque(b)), 0.5), turn);
  }
  return work;
}
/** A closed loop in elevation and twist at a fixed azimuth. */
const rectangle = (side: number, az: number, [e0, e1]: number[], [t0, t1]: number[]): Quat[] => [
  ...span(e0, e1).map((e) => armAt(side, dirAt(side, e, az), t0)),
  ...span(t0, t1).map((t) => armAt(side, dirAt(side, e1, az), t)),
  ...span(e1, e0).map((e) => armAt(side, dirAt(side, e, az), t1)),
  ...span(t1, t0).map((t) => armAt(side, dirAt(side, e0, az), t)),
];
/** A closed loop in elevation and azimuth at a fixed twist. */
const patch = (side: number, tw: number, [e0, e1]: number[], [a0, a1]: number[]): Quat[] => [
  ...span(e0, e1).map((e) => armAt(side, dirAt(side, e, a0), tw)),
  ...span(a0, a1).map((a) => armAt(side, dirAt(side, e1, a), tw)),
  ...span(e1, e0).map((e) => armAt(side, dirAt(side, e, a1), tw)),
  ...span(a1, a0).map((a) => armAt(side, dirAt(side, e0, a), tw)),
];
const noise = (seed: number): (() => number) => {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
};

describe('ladder 13a: the shoulder twist limit in the anatomical measure', () => {
  it('a raised arm turned past the range is pushed back toward it; plan 09 reads the same arm inside and leaves it (the fault twin); at or below horizontal the two limits are the same terms', () => {
    for (const side of [1, -1]) {
      // 80 deg up, out to the side, the forearm bent toward the face: anatomical external twist 170, past +-100
      const face = armAt(side, dirAt(side, 80, 90), 170);
      const M = envelopeMoments(E, face, side, NO_SLACK, v3(), A);
      expect(excessOf(M) * D).toBeGreaterThan(15);
      expect(len(M.torque)).toBeGreaterThan(50);
      // a small turn along the torque lowers the excess
      const after = envelopeMoments(E, qMul(qFromAxisAngle(norm(M.torque, v3()), 0.01), face), side, NO_SLACK, v3(), A);
      expect(excessOf(after)).toBeLessThan(excessOf(M));
      // the fault twin: plan 09's limit reads that arm inside its range
      const P = envelopeMoments(E, face, side, NO_SLACK, v3());
      expect(excessOf(P)).toBeLessThan(0);
      expect(len(P.torque)).toBe(0);
      // the natural arm overhead, its forearm behind the head, is inside the anatomical range
      expect(len(envelopeMoments(E, armAt(side, dirAt(side, 80, 90), 0), side, NO_SLACK, v3(), A).torque)).toBe(0);
      // at or below horizontal: the same terms
      const r = noise(3);
      for (let i = 0; i < 300; i++) {
        const q = armAt(side, dirAt(side, -90 * Math.abs(r()), 180 * r()), 170 * r());
        const w = v3(r(), r(), r());
        expect(envelopeMoments(E, q, side, NO_SLACK, w, A)).toEqual(envelopeMoments(E, q, side, NO_SLACK, w));
      }
    }
  });

  it('the anatomical terms follow a potential: closed paths at rest overhead, through the wrap and round the arm\'s azimuth, return the work they took; each torque is minus the exact gradient of its excess; damping adds no power', () => {
    for (const side of [1, -1]) {
      // past the upper limit by 5 to 35 deg while raised from horizontal to near vertical, out to the side and forward
      expect(Math.abs(loopWork(side, rectangle(side, 90, [5, 88], [105, 135])))).toBeLessThan(0.01);
      expect(Math.abs(loopWork(side, rectangle(side, 0, [5, 88], [-135, -105])))).toBeLessThan(0.01);
      // across the half turn, where the two limits meet: a ridge of the energy (both read 80 deg past there), sampled
      // so the ridge falls mid-step, where the trapezoid rule is exact across a kink
      expect(Math.abs(loopWork(side, rectangle(side, 45, [20, 80], [150.075, 210.075])))).toBeLessThan(0.01);
      // round the arm's azimuth overhead at a twist past the range, from in front through the side to behind
      expect(Math.abs(loopWork(side, patch(side, 130, [40, 80], [-30, 150])))).toBeLessThan(0.01);
      // from below horizontal (plan 09's terms) into the blend and back
      expect(Math.abs(loopWork(side, rectangle(side, 60, [-40, 50], [110, 140])))).toBeLessThan(0.01);
    }
    // the same loop does real work if it is not closed: the check measures something
    expect(Math.abs(loopWork(1, rectangle(1, 90, [5, 88], [105, 135]).slice(0, 3 * STEPS), false))).toBeGreaterThan(5);
    // the gradient of each limit's scaled excess, and damping, on raised arms away from the measure's singular direction
    const r = noise(17);
    let tested = 0;
    for (const side of [1, -1])
      for (let i = 0; i < 600; i++) {
        const q = armAt(side, dirAt(side, 85 * Math.abs(r()), 180 * r()), 180 * r());
        const M = envelopeMoments(E, q, side, NO_SLACK, v3(), A);
        const w = v3(r(), r(), r());
        const h = 1e-5;
        const [up, down] = [envelopeMoments(E, qMul(qFromAxisAngle(norm(w), h * len(w)), q), side, NO_SLACK, v3(), A), envelopeMoments(E, qMul(qFromAxisAngle(norm(w), -h * len(w)), q), side, NO_SLACK, v3(), A)];
        for (const k of ['hi', 'lo'] as const) {
          if (M[k].excess < -0.05 || Math.abs(up[k].excess - down[k].excess) > 0.1) continue;
          const rate = (up[k].excess - down[k].excess) / (2 * h);
          expect(Math.abs(dot(w, M[k].grad) - rate), k).toBeLessThan(1e-3 * Math.max(1, Math.abs(rate)));
        }
        const spin = scale(w, 20);
        expect(dot(envelopeMoments(E, q, side, NO_SLACK, spin, A).torque, spin)).toBeLessThanOrEqual(dot(M.torque, spin) + 1e-9);
        if (len(M.torque) > 0) tested++;
      }
    expect(tested).toBeGreaterThan(200);
  });

  it("HC-F5-strictTransfer from 1.667 s: R's raised right arm turns past the range and stays there to the end unseen by plan 09's limit (the fault twin); under the anatomical limit it is back inside within the persistence limit, never at the impossible margin, and the limit returns less than it absorbs", async () => {
    const base = await rightArm(false);
    // registered: past the range by the tolerance for 4.2 s, most of it implausible and part impossible, the arm raised
    // (anatomical +125: the forearm turned out and down past the head), while the envelope's own clock stays under the
    // persistence limit because its excess fades by cos(swing / 2) there
    expect(base.longestPastS).toBeGreaterThan(10 * base.persistS);
    expect(base.impossibleS).toBeGreaterThan(0);
    expect(base.envelopeRunS).toBeLessThan(base.persistS);
    const on = await rightArm(true);
    expect(on.longestPastS).toBeLessThan(on.persistS);
    expect(on.impossibleS).toBe(0);
    expect(on.endDeg).toBeLessThan(0);
    // rule 7f, read in the same measure: free past the tolerance under the persistence limit, a pinned arm within its load
    expect(on.limb.freeRunS).toBeLessThan(on.persistS);
    expect(on.limb.overBoundDeg).toBeLessThanOrEqual(0);
    expect(on.limb.returnOverS).toBeLessThanOrEqual(0);
    // passive: the shoulder's limit takes out more than it gives back (from the capture)
    expect(on.returnedJ).toBeLessThan(on.absorbedJ);
  }, 120000);
});

const CAPTURE = 'tests/data/state/HC-F5-strictTransfer~v3@100.json.gz';
const ROT = HUMAN_RANGES.find((r) => r.joint === 'Shoulder' && r.dof === 'rotation')!;

interface ArmRun {
  /** Longest continuous time with the drawn arm (the visible meter's measure) past the range by the envelope's tolerance. */
  longestPastS: number;
  /** Time past the meter's impossible margin. */
  impossibleS: number;
  /** The meter's reading at the end (deg past the range; < 0 inside). */
  endDeg: number;
  /** The envelope's own longest run past its tolerance (`EnvelopeRuntime.maxOverRunS`) for the right shoulder. */
  envelopeRunS: number;
  /** The right shoulder's rule 7f record. */
  limb: LimbRecord;
  /** The right shoulder limit's positive and negative work from the capture (J). */
  returnedJ: number;
  absorbedJ: number;
  persistS: number;
}

/** R's right shoulder from the capture to the end, under the registered profile or with the anatomical twist limit. */
async function rightArm(anatomical: boolean): Promise<ArmRun> {
  const cap = loadState(CAPTURE);
  const def = asCaptured(cap);
  const m = loadedLimbMonitor();
  const sim = await resumeState(cap, anatomical ? { def: { ...def, ragdoll: withShoulderTwistLimit(def.ragdoll!) }, variant: ['ragdoll'], opts: { onSubstep: m.substep } } : { def, opts: { onSubstep: m.substep } });
  const rag = sim.players.find((p) => p.id === 'R')!.rag!;
  expect(rag.profile.shoulderTwistLimit).toEqual(anatomical ? SHOULDER_TWIST_ANAT_V1 : undefined);
  const P = rag.profile.envelope!;
  const side = rag.joints.find((x) => x.id === 'rightShoulder')!.sideSign ?? 1;
  const e = rag.envelope!.find((x) => x.jointId === 'rightShoulder')!;
  const [pos0, neg0] = [e.passivePositiveJ, e.passiveNegativeJ];
  const out = { longestPastS: 0, impossibleS: 0, endDeg: 0, persistS: P.persistS };
  let run = 0;
  let last = sim.t;
  while (!sim.done) {
    sim.stepTick();
    const dt = sim.t - last;
    last = sim.t;
    const ex = ROT.excess({ swing: 0, coneEx: 0, rot: shoulderRotationDeg(qMul(qConj(rag.bodies.core.rotation()), rag.bodies.rightUpperArm.rotation()), side) });
    run = ex > P.toleranceDeg ? run + dt : 0;
    out.longestPastS = Math.max(out.longestPastS, run);
    if (ex > ROT.impossible) out.impossibleS += dt;
    out.endDeg = ex;
  }
  sim.dispose();
  return { ...out, envelopeRunS: e.maxOverRunS, limb: m.records().find((r) => r.key === 'R rightShoulder')!, returnedJ: e.passivePositiveJ - pos0, absorbedJ: e.passiveNegativeJ - neg0 };
}
