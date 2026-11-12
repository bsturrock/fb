// Plan 09 (L4): active falls, joint limits and role responses. The envelope works with muscles off and takes its own
// load, every effort is a capped equal and opposite internal torque pair, each arm's task follows role and retained
// holds, and a miss stays a miss. Power and work are audited from velocities across the solve, and nothing outside the
// fall changes: traces match the passive path to the conversion, and the rule observer never sees the response.
//
// Plan 13b: one test per contract. A contract checked on several fixtures is one table (`rows`: every row runs, and a
// red run lists every failing row); closely related checks on the same runs are one table of named checks. Every fall
// fixture is simulated once and shared, with the observers of every test that watches it as it goes.
import { createHash } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { FixedStepDriver } from '../src/sim/driver';
import { asL4, fallFixtures, LIMIT_TIMES } from '../src/sim/fixtures/falls';
import { transitionFixtures } from '../src/sim/fixtures/transitions';
import type { FixtureDef } from '../src/sim/fixture';
import type { ArmSide } from '../src/sim/contracts';
import { CARRY_ARM } from '../src/sim/carry';
import { isGround } from '../src/sim/contracts';
import { rotateToward } from '../src/sim/vec';
import { ENVELOPE_L4, FALL_L4, JOINT_RANGE_V1, LEG_GUARD_V1, LEG_GUARD_V3, SOLVER_G4, SOLVER_G4_ZEROG, withoutHipStops, withSolvedImpulses, type JointEnvelope } from '../src/sim/profiles';
import { applyEnvelope, bulkOf, clampDirToEnvelope, envelopeMoments, initEnvelope, externalTwistRad, hingeAngles, landmarkWorld, limbDirWorld, swingExcess, swingExtentDeg, swingTwistOf, twistAxis, type Ragdoll } from '../src/sim/ragdoll';
import { Simulation } from '../src/sim/simulation';
import { add, cross, dot, len, norm, qConj, qFromAxisAngle, qInvRot, qMul, rad, scale, sub, v3, type Quat, type Vec3 } from '../src/sim/vec';
import { breathe, create, evs, FIX, nonEmpty, pace, preFlip, preV3, rows, run, runSim, stepWhile, traceDiff } from './helpers';
import { loadedLimbMonitor } from './loaded-limb';
import { JOINT_PAST_DEG, JOINT_PAST_S } from './visible-bar';

const ALL = fallFixtures();

// ------------------------------------------------------------------ one run per fixture
// Plan 13b: every fall fixture a test reads is simulated once, as `run(FIX(id))` gives it (the default options), and
// shared. A test that watches a fall as it goes registers its observer for its fixtures with `watch` while the file is
// collected, before any test runs, so the one shared run carries every observer. An observer only reads and records
// (the trace and `onSubstep` change nothing in a run); its test asserts on the record afterwards.
interface Observer {
  /** After every outer tick. */
  tick?: (s: Simulation) => void;
  /** After every physics substep (`onSubstep`). */
  substep?: (s: Simulation) => void;
}
const observers: ((id: string) => Observer | undefined)[] = [];

/** Attach `make()`'s observer to the shared run of every fixture `covers` takes; the reader returns what it recorded. */
function watch<T>(covers: (id: string) => boolean, make: () => Observer & { data: T }): (id: string) => Promise<T> {
  const got = new Map<string, T>();
  observers.push((id) => {
    if (!covers(id)) return undefined;
    const o = make();
    got.set(id, o.data);
    return o;
  });
  return async (id) => {
    await sim(id);
    const d = got.get(id);
    if (d === undefined) throw new Error(`${id}: its shared run carries no such observer`);
    return d;
  };
}

/** The shared run of `id` (tracked, to its end, yielding as it goes) with every observer that covers it. */
async function observed(id: string): Promise<Simulation> {
  const os = observers.flatMap((f) => f(id) ?? []);
  const sub = os.filter((o) => o.substep);
  const s = await create(FIX(id), sub.length ? { onSubstep: (x: Simulation) => sub.forEach((o) => o.substep!(x)) } : {});
  return runSim(s, Infinity, (x) => os.forEach((o) => o.tick?.(x)));
}

const ran = new Map<string, Simulation>();
async function sim(id: string): Promise<Simulation> {
  if (!ran.has(id)) ran.set(id, await observed(id));
  await breathe();
  return ran.get(id)!;
}
afterAll(() => {
  for (const s of ran.values()) s.dispose();
});

/** The first player's hinge angles where `stepWhile(s, () => s.t < at)` stops: the first tick at or past `at`, or the end. */
const hingesAt =
  (at: number) =>
  (): Observer & { data: { h?: Record<string, number> } } => {
    const data: { h?: Record<string, number> } = {};
    return {
      data,
      tick: (s) => {
        if (!data.h && (s.t >= at || s.done)) data.h = hingeAngles(s.players[0].rag!);
      },
    };
  };

/** A table of named checks: each runs, and the test fails once with every failing check's name and first failure. */
type Check = [string, () => void | Promise<void>];
const checks = (cs: Check[]): Promise<void> => rows(cs, ([n]) => n, ([, f]) => f());

const exp = (s: Simulation): any => s.exportFixture();
const report = (s: Simulation, id: string): any => exp(s).fallEffort[id];
const envelopeOf = (s: Simulation, id: string): any[] => exp(s).jointLimits[id].envelope.joints;
const passive = (s: Simulation, id: string): { pos: number; neg: number } => ({ pos: envelopeOf(s, id).reduce((a, j) => a + j.passivePositiveJ, 0), neg: envelopeOf(s, id).reduce((a, j) => a + j.passiveNegativeJ, 0) });
const tasksOf = (s: Simulation, id: string): any => evs(s, 'fallResponse').find((e) => e.playerId === id)?.data.tasks;
const LIMIT_SIDES = ['left', 'right'] as const;

// ------------------------------------------------------------------ limits
describe('L4-F1 limits under stated loads, muscles off', () => {
  // the settled mean is the stated load over the profile's stiffness (deg): 1.15, 2.15, 0.98 and, since plan 10b's
  // stiffer hip twist, 1.07
  const loadDeg = (nm: number, k: number): number => ((nm / k) * 180) / Math.PI;
  const E = ENVELOPE_L4;
  const SOFT = [
    ['L4-F1-shoulderSwing', 'Shoulder', loadDeg(30, E.shoulder.swing.stiffnessNmPerRad)],
    ['L4-F1-shoulderTwist', 'Shoulder', loadDeg(15, E.shoulder.twist.stiffnessNmPerRad)],
    ['L4-F1-hipSwing', 'Hip', loadDeg(60, E.hip.swing.stiffnessNmPerRad)],
    ['L4-F1-hipTwist', 'Hip', loadDeg(30, E.hip.twist.stiffnessNmPerRad)],
  ] as const;

  it('soft: the settled overshoot stays inside 5 degrees on every L4-F1 swing and twist fixture (its mean beside the stiffness load printed)', async () => {
    const meter: string[] = [];
    await rows(SOFT, ([id]) => id, async ([id, joint, expected]) => {
      // (the envelope's own limit: since the visible flip an L4 ragdoll's hips take the 8d box with the zone, ladder rung
      // 8k, which lies inside the envelope and stops them before it, overshoot 0; the hip rows read the envelope without it)
      const d = joint === 'Hip' ? { ...FIX(id), ragdoll: withoutHipStops(FIX(id).ragdoll!) } : FIX(id);
      const s = await Simulation.create(d, { trace: false });
      const [a, b] = [LIMIT_TIMES.loadS[1] - 0.4, LIMIT_TIMES.loadS[1]];
      const settled: Record<string, number> = {};
      const sum: Record<string, number> = {};
      let n = 0;
      while (!s.done) {
        s.stepTick();
        await pace();
        if (s.t < a || s.t >= b) continue;
        n++;
        for (const e of s.players[0].rag?.envelope ?? []) {
          settled[e.jointId] = Math.max(settled[e.jointId] ?? 0, e.overDeg);
          sum[e.jointId] = (sum[e.jointId] ?? 0) + e.overDeg;
        }
      }
      expect(s.fall).toBeNull();
      expect(exp(s).jointLimits.R.envelope.mode).toBe('soft');
      for (const side of LIMIT_SIDES) {
        // the largest excursion, lightly damped twist still ringing, stays inside the tolerance; its mean is the load
        // over the stiffness (ladder 15: the mean's 0.25 deg match is a fine number, printed, not a gate)
        expect(settled[`${side}${joint}`]).toBeLessThan(ENVELOPE_L4.toleranceDeg);
        meter.push(`${id} ${side}: mean ${(sum[`${side}${joint}`] / n).toFixed(2)} deg against the load's ${expected.toFixed(2)}`);
      }
      for (const j of envelopeOf(s, 'R')) expect(j.maxOverRunS).toBeLessThan(ENVELOPE_L4.persistS);
      s.dispose();
    });
    console.log(`L4-F1 soft settled overshoot (ladder 15 meter): ${meter.join('; ')}`);
  });

  it('native hinge holds under the load, on every L4-F1 hinge fixture', async () => {
    await rows(['L4-F1-elbow', 'L4-F1-knee'], (id) => id, async (id) => {
      const s = await sim(id);
      const h = exp(s).jointLimits.R.hinges;
      expect(h.mode).toBe('native');
      expect(h.maxReverseDeg).toBeLessThan(ENVELOPE_L4.toleranceDeg);
      expect(h.maxOverDeg).toBeLessThan(ENVELOPE_L4.toleranceDeg);
    });
  });

  it('the published extents are the declared cone, and a brace direction stays inside it', () => {
    const S = ENVELOPE_L4.shoulder;
    expect(swingExtentDeg(S, 0)).toBeGreaterThan(160);
    expect(swingExtentDeg(S, 90)).toBeGreaterThan(160);
    expect(swingExtentDeg(S, 180)).toBeLessThan(80);
    expect(swingExtentDeg(S, -90)).toBeLessThan(80);
    const H = ENVELOPE_L4.hip;
    expect(swingExtentDeg(H, 0)).toBeGreaterThan(120);
    expect(swingExtentDeg(H, 180)).toBeLessThan(45);
    for (const s of [1, -1]) for (const dir of [v3(0, 1, 0), v3(-s, 0, -1), v3(-s, -0.2, 0), v3(0, 0.3, -1)]) expect(swingExcess(S, clampDirToEnvelope(S, norm(dir), s, 0.14), s).rad).toBeLessThan(-0.1);
  });
});

/** Small seeded unit values, for directional derivative checks. */
const noise = (seed: number): (() => number) => {
  let x = seed;
  return () => ((x = (x * 16807) % 2147483647) / 2147483647) * 2 - 1;
};

const NO_SLACK = { swingSlack: 0, twistSlackLo: 0, twistSlackHi: 0 };
const HANG = v3(0, -1, 0);

/** Relative rotation (parent frame) with the limb swung `swingDeg` toward azimuth `azDeg` and twisted `twistDeg` externally. */
function limbAt(E: JointEnvelope, side: number, swingDeg: number, azDeg: number, twistDeg: number): Quat {
  const toward = v3(side * Math.sin(rad(azDeg)), 0, Math.cos(rad(azDeg)));
  const swing = qFromAxisAngle(norm(cross(HANG, toward)), rad(swingDeg));
  return qMul(swing, qFromAxisAngle(v3(0, 1, 0), rad(E.neutralTwistDeg) + side * rad(twistDeg)));
}

const STEPS = 400;
const span = (a: number, b: number): number[] => Array.from({ length: STEPS }, (_, i) => a + ((b - a) * i) / STEPS);

/** A closed loop in swing and twist at a fixed azimuth, counter-clockwise from (swing0, twist0). */
function rectangle(E: JointEnvelope, side: number, azDeg: number, [s0, s1]: number[], [t0, t1]: number[]): Quat[] {
  return [
    ...span(s0, s1).map((s) => limbAt(E, side, s, azDeg, t0)),
    ...span(t0, t1).map((t) => limbAt(E, side, s1, azDeg, t)),
    ...span(s1, s0).map((s) => limbAt(E, side, s, azDeg, t1)),
    ...span(t1, t0).map((t) => limbAt(E, side, s0, azDeg, t)),
  ];
}

/** A closed loop in swing and azimuth at neutral twist. */
function patch(E: JointEnvelope, side: number, [s0, s1]: number[], [a0, a1]: number[]): Quat[] {
  return [
    ...span(s0, s1).map((s) => limbAt(E, side, s, a0, 0)),
    ...span(a0, a1).map((a) => limbAt(E, side, s1, a, 0)),
    ...span(s1, s0).map((s) => limbAt(E, side, s, a1, 0)),
    ...span(a1, a0).map((a) => limbAt(E, side, s0, a, 0)),
  ];
}

/** Work (J) the envelope's spring does on the limb along a path of relative rotations taken at rest (trapezoid rule). */
function loopWork(E: JointEnvelope, side: number, path: Quat[], closed = true): number {
  let work = 0;
  const torque = (q: Quat): Vec3 => envelopeMoments(E, q, side, NO_SLACK, v3()).torque;
  for (let i = 0; i < path.length - (closed ? 0 : 1); i++) {
    const [a, b] = [path[i], path[(i + 1) % path.length]];
    const d = qMul(b, qConj(a)); // the parent-frame turn taking a to b
    const sv = Math.hypot(d.x, d.y, d.z);
    const angle = 2 * Math.atan2(sv, Math.abs(d.w)) * Math.sign(d.w || 1);
    const turn = sv > 1e-12 ? scale(v3(d.x, d.y, d.z), angle / sv) : v3();
    work += dot(scale(add(torque(a), torque(b)), 0.5), turn);
  }
  return work;
}

describe('the limit torque follows a potential', () => {
  it('the swing and twist rates, closed paths at rest, exact gradients and damping all follow the potential', async () => {
    await checks([
      [
        'swing: near the boundary the axis is the gradient of the excess, on either side, on an elliptical cone too',
        () => {
          let tested = 0;
          for (const E of [ENVELOPE_L4.shoulder, ENVELOPE_L4.hip])
            for (const side of [1, -1]) {
              const r = noise(11);
              for (let i = 0; i < 4000; i++) {
                const dir = norm(v3(r(), r(), r()));
                const a = swingExcess(E, dir, side);
                if (Math.abs(a.rad) > 0.03) continue;
                tested++;
                const h = 1e-4;
                const up = norm(add(dir, scale(cross(a.axis, dir), h)));
                const across = norm(add(dir, scale(cross(dir, cross(a.axis, dir)), h)));
                expect((swingExcess(E, up, side).rad - a.rad) / h).toBeCloseTo(1, 0);
                expect(Math.abs(swingExcess(E, across, side).rad - a.rad) / h).toBeLessThan(0.15);
              }
            }
          expect(tested).toBeGreaterThan(20);
        },
      ],
      [
        'twist: the rate is the child axis plus the tan(swing / 2) azimuth term',
        () => {
          const r = noise(5);
          for (let i = 0; i < 500; i++) {
            const raw = { x: r(), y: r(), z: r(), w: r() };
            const n = Math.hypot(raw.x, raw.y, raw.z, raw.w);
            const q: Quat = { x: raw.x / n, y: raw.y / n, z: raw.z / n, w: raw.w / n };
            const st = swingTwistOf(q);
            if (st.swingRad > 2.9 || st.swingRad < 0.05) continue;
            const w = v3(r(), r(), r());
            const h = 1e-5;
            const st2 = swingTwistOf(qMul(qFromAxisAngle(norm(w), h * len(w)), q));
            const dTw = st2.twistRad - st.twistRad;
            if (Math.abs(dTw) > 1) continue;
            const g = twistAxis(q, st);
            expect(len(g)).toBeCloseTo(1, 6);
            expect(dot(w, g) / Math.cos(st.swingRad / 2)).toBeCloseTo(dTw / h, 2);
          }
          // the neutral and side of the external twist
          const E = ENVELOPE_L4.shoulder;
          expect(externalTwistRad(E, Math.PI, 1)).toBeCloseTo(0, 9);
          expect(externalTwistRad(E, Math.PI - 0.1, 1)).toBeCloseTo(-0.1, 9);
          expect(externalTwistRad(E, Math.PI - 0.1, -1)).toBeCloseTo(0.1, 9);
        },
      ],
      // the review regression: the twist spring faded with swing but had no swing torque, so a twisted shoulder swung up
      // and down around a closed path gained 26.3 J with muscles off
      [
        'a closed path at rest returns exactly the work it took: twist fading, an elliptical swing cone, both limits, the cap',
        () => {
          const S = ENVELOPE_L4.shoulder;
          const H = ENVELOPE_L4.hip;
          // past the shoulder twist limit by 5 to 25 deg while swinging 20 to 120 deg toward the cone centre (swing inside)
          for (const side of [1, -1]) expect(Math.abs(loopWork(S, side, rectangle(S, side, 45, [20, 120], [105, 125])))).toBeLessThan(0.01);
          // the hip swung backward past its elliptical boundary, around a patch in swing and azimuth, twist at neutral
          for (const side of [1, -1]) expect(Math.abs(loopWork(H, side, patch(H, side, [50, 75], [150, 215])))).toBeLessThan(0.01);
          // both hip limits at once, deep enough that the swing spring reaches its cap on the far edge
          expect(H.swing.stiffnessNmPerRad * rad(30)).toBeGreaterThan(H.maxTorqueNm);
          for (const side of [1, -1]) expect(Math.abs(loopWork(H, side, rectangle(H, side, 180, [55, 75], [55, 80])))).toBeLessThan(0.01);
          // the same loop does real work if it is not closed: the check measures something
          expect(Math.abs(loopWork(S, 1, rectangle(S, 1, 45, [20, 120], [105, 125]).slice(0, 3 * STEPS), false))).toBeGreaterThan(5);
        },
      ],
      [
        'each limit torque is minus the exact gradient of its own excess, and damping never adds power',
        () => {
          const r = noise(17);
          let tested = 0;
          for (const E of [ENVELOPE_L4.shoulder, ENVELOPE_L4.hip])
            for (const side of [1, -1])
              for (let i = 0; i < 400; i++) {
                const raw = { x: r(), y: r(), z: r(), w: r() };
                const n = Math.hypot(raw.x, raw.y, raw.z, raw.w);
                const q: Quat = { x: raw.x / n, y: raw.y / n, z: raw.z / n, w: raw.w / n };
                if (swingTwistOf(q).swingRad > 2.8) continue;
                const at = (x: Quat) => envelopeMoments(E, x, side, NO_SLACK, v3());
                const M = at(q);
                const w = v3(r(), r(), r());
                const h = 1e-5;
                const [up, down] = [at(qMul(qFromAxisAngle(norm(w), h * len(w)), q)), at(qMul(qFromAxisAngle(norm(w), -h * len(w)), q))];
                for (const k of ['swing', 'hi', 'lo'] as const) {
                  // where the limit acts or is about to (deep inside, the cone's centre leaves the azimuth undefined), and
                  // not across the half turn where twist wraps
                  if (M[k].excess < -0.05 || Math.abs(up[k].excess - down[k].excess) > 0.1) continue;
                  const rate = (up[k].excess - down[k].excess) / (2 * h);
                  expect(Math.abs(dot(w, M[k].grad) - rate), k).toBeLessThan(1e-3 * Math.max(1, Math.abs(rate)));
                }
                // the damped moment, for any relative speed, never does more work than the spring alone
                const spin = scale(w, 20);
                const damped = envelopeMoments(E, q, side, NO_SLACK, spin);
                expect(dot(damped.torque, spin)).toBeLessThanOrEqual(dot(M.torque, spin) + 1e-9);
                if (len(M.torque) > 0) tested++;
              }
          expect(tested).toBeGreaterThan(200);
        },
      ],
    ]);
  });

  // (the first test to read most falls: it runs them, with every observer, for the whole file)
  // Ladder rung 7f (tests/loaded-limb.ts): the persistence clock counts the substeps a joint is past the tolerance while its
  // envelope can correct it, not while the floor holds its limb (load-pinned); a pinned limb stays within the static
  // deflection of the load it carries plus the envelope's overshoot, and once the floor lets go it is back inside within
  // the envelope's free crossing time plus a tick. tests/loaded-limb.test.ts holds the rule's own cases and fault twins.
  const limbs = watch(
    (id) => !id.startsWith('L4-F1-'),
    () => {
      const m = loadedLimbMonitor();
      return { data: m, substep: m.substep };
    },
  );
  it('in every fall, on or off, no joint stays far past its limit, and a limit returns less than it absorbs and launches nothing', async () => {
    await checks([
      [
        'no joint stays more than 15 deg past its limit for 0.25 s in any fall, on or off (the loaded-limb rule printed)',
        async () => {
          // ladder 15: what blocks is the visible bar, a joint more than 15 deg past its limit for 0.25 s (deepRunS,
          // tests/visible-bar.ts), in every fall. The rule's three parts (free past the 5 deg tolerance under the persistence
          // limit, a pinned limb within its load's deflection, an unloaded one back within its crossing time) are printed
          // per family, and their own cases and fault twins stay in tests/loaded-limb.test.ts; the natural sample that
          // pinned L4-F3-model-oblique-off's ['R rightShoulder'] (pre-flip) is the rule's case now
          const meter = new Map<string, { n: number; free: number; bound: number; ret: number; deg: number; at: string }>();
          await rows(
            ALL.filter((x) => !x.id.startsWith('L4-F1-')).map((d) => d.id),
            (id) => id,
            async (id) => {
              for (const r of (await limbs(id)).records()) {
                const fam = id.split('-')[0];
                const m = meter.get(fam) ?? { n: 0, free: 0, bound: -Infinity, ret: -Infinity, deg: 0, at: '' };
                m.n++;
                m.free = Math.max(m.free, r.freeRunS);
                m.bound = Math.max(m.bound, r.overBoundDeg);
                m.ret = Math.max(m.ret, r.returnOverS);
                if (r.maxDeg > m.deg) [m.deg, m.at] = [r.maxDeg, `${id} ${r.key}`];
                meter.set(fam, m);
                expect(r.deepRunS, `${r.key} more than ${JOINT_PAST_DEG} deg past its limit for ${r.deepRunS.toFixed(3)} s from ${r.deepFrom.toFixed(3)} s`).toBeLessThan(JOINT_PAST_S);
              }
            },
          );
          console.log(
            `loaded-limb rule (ladder 15 meter): ${[...meter]
              .map(([f, m]) => `${f} ${m.n} joints: free past ${ENVELOPE_L4.toleranceDeg} deg ${m.free.toFixed(3)} s (limit ${ENVELOPE_L4.persistS}), over the load's bound ${m.bound.toFixed(2)} deg, return over ${m.ret.toFixed(3)} s, largest ${m.deg.toFixed(1)} deg (${m.at})`)
              .join('; ')}`,
          );
        },
      ],
      // the regression behind the cone: limits per quadrant fell under a limb sliding sideways, and paid 320 J to leave
      [
        'a limit returns less than it absorbs and launches nothing, in every natural fall',
        async () => {
          for (const id of ['L4-F4-late', 'L4-F4-tooFar', 'L4-F3-oblique-on', 'L4-F3-oblique-off', 'L4-F3-side-on', 'L4-F12-base']) {
            const s = await sim(id);
            for (const p of s.players.filter((x) => x.rag)) {
              const { pos, neg } = passive(s, p.id);
              expect(pos, id).toBeLessThan(Math.max(neg, 40));
              expect(p.ragStats!.maxSpeed, id).toBeLessThan(9);
            }
          }
        },
      ],
    ]);
  }, 240000);

  // the crowded fall's slack, every tick: whether a joint starts well outside, and each joint's slack beside its previous
  // tick's
  const crowded = watch(
    (id) => id === 'L4-F9-crowded',
    () => {
      const data = { slack: [] as [number, number][] };
      const prev = new Map<string, number>();
      return {
        data,
        tick: (s) => {
          for (const p of s.players)
            for (const e of p.rag?.envelope ?? []) {
              const k = `${p.id}${e.jointId}`;
              const slack = e.swingSlack + e.twistSlackLo + e.twistSlackHi;
              if (prev.has(k)) data.slack.push([slack, prev.get(k)!]);
              prev.set(k, slack);
            }
        },
      };
    },
  );

  it('slack: a joint that starts outside keeps it, so conversion adds no kick; it follows the limb inward at once, only tightens and never refills', async () => {
    await checks([
      [
        'a joint that starts outside keeps slack, so conversion adds no kick, and the slack only tightens',
        async () => {
          const { slack: ticks } = await crowded('L4-F9-crowded');
          for (const [slack, prev] of ticks) expect(slack).toBeLessThanOrEqual(prev + 1e-12);
          // contact motion M1: under joint-range-v2 the supported arm's twist is in range, so L4-F9-crowded's runner now
          // converts with every joint inside (its right shoulder started 51.3 deg outside, in twist); the start outside is
          // its twin on plan 12's joint-range-v1
          const twin = await Simulation.create({ ...FIX('L4-F9-crowded'), id: 'L4-F9-crowded-v1', jointRange: JOINT_RANGE_V1 });
          let seen = false;
          const prev = new Map<string, number>();
          await runSim(twin, Infinity, (x) => {
            for (const p of x.players)
              for (const e of p.rag?.envelope ?? []) {
                if (e.startOutsideDeg > 20) seen = true;
                const k = `${p.id}${e.jointId}`;
                const slack = e.swingSlack + e.twistSlackLo + e.twistSlackHi;
                if (prev.has(k)) expect(slack).toBeLessThanOrEqual(prev.get(k)! + 1e-12);
                prev.set(k, slack);
              }
          });
          twin.dispose();
          expect(seen).toBe(true);
        },
      ],
      [
        'slack takes up a start outside the range, follows the limb inward at once and never refills',
        async () => {
          const s = await Simulation.create(FIX('L4-F8-passive'), { trace: false });
          await stepWhile(s, () => !s.players[0].rag);
          const rag = s.players[0].rag!;
          const j = rag.joints.find((x) => x.id === 'leftShoulder')!;
          // (plan 12: the shoulder in force is the joint-range profile's)
          const E = rag.profile.envelope!.shoulder;
          expect(E).toEqual(JOINT_RANGE_V1.shoulder);
          const dt = 1 / 240;
          const decay = rad(ENVELOPE_L4.slackDecayDegPerS) * dt;
          const parent = rag.bodies[j.parent].rotation();
          let relative: Quat = { x: 0, y: 0, z: 0, w: 1 };
          const place = (q: Quat): void => {
            relative = q;
            rag.bodies[j.child].setRotation(qMul(parent, q), true);
          };
          const twisted = qFromAxisAngle(v3(0, 1, 0), rad(E.neutralTwistDeg));
          const back = (deg: number): Quat => qMul(qFromAxisAngle(v3(1, 0, 0), rad(deg)), twisted); // a positive turn about X swings backward
          const excess = (): number => swingExcess(E, swingTwistOf(relative).dir, j.sideSign ?? 1).rad;

          place(back(110));
          initEnvelope(rag);
          const e = rag.envelope!.find((x) => x.jointId === j.id)!;
          const start = excess();
          expect(start).toBeGreaterThan(0.3);
          expect(e.swingSlack).toBeCloseTo(start, 5); // the engine keeps rotations in 32-bit floats
          // no kick: only one substep of decay reaches the torque
          applyEnvelope(rag, dt);
          expect(e.swingSlack).toBeCloseTo(start - decay, 5);
          expect(len(e.torque)).toBeLessThan(E.swing.stiffnessNmPerRad * decay * 1.1); // plus the damping on the same small excess
          // the limb moves inward: the slack comes with it
          place(back(95));
          const inward = excess();
          expect(inward).toBeLessThan(start - 0.1);
          expect(inward).toBeGreaterThan(0);
          applyEnvelope(rag, dt);
          expect(e.swingSlack).toBeCloseTo(inward - decay, 5);
          // back outward: what was given up stays given up, and the limit pushes
          place(back(110));
          applyEnvelope(rag, dt);
          expect(e.swingSlack).toBeCloseTo(inward - 2 * decay, 5);
          expect(len(e.torque)).toBeGreaterThan(50);
          // inside the range: gone
          place(back(20));
          applyEnvelope(rag, dt);
          expect(e.swingSlack).toBe(0);

          // the same for twist, past either limit by 30 deg, then back to neutral
          const taken: number[][] = [];
          for (const sign of [1, -1]) {
            place(qFromAxisAngle(v3(0, 1, 0), rad(E.neutralTwistDeg + sign * (E.twistDeg[1] + 30))));
            initEnvelope(rag);
            const t = rag.envelope!.find((x) => x.jointId === j.id)!;
            taken.push([t.twistSlackLo, t.twistSlackHi]);
            place(twisted);
            applyEnvelope(rag, dt);
            expect([t.twistSlackLo, t.twistSlackHi]).toEqual([0, 0]);
          }
          expect(Math.max(...taken.map((x) => x[0]))).toBeGreaterThan(0.4);
          expect(Math.max(...taken.map((x) => x[1]))).toBeGreaterThan(0.4);
          s.dispose();
        },
      ],
    ]);
  });
});

// ------------------------------------------------------------------ every response, whatever the fixture
/** What a run's power audit reads past the realized-power tolerance, per player (ladder 15: printed, not a gate). */
type PowerOver = { label: string; overPowerSubsteps: number; impactPowerSubsteps: number; peakImpactW: number; overEvents: number; peakRealizedW: number; capW: number };

/**
 * The power and work audit of one run of a response fixture `d`, every player: the work within its cap and the predicted
 * power within the plan, which block. Ladder 15 (2026-11-12, the visible bar): the realized power a few per cent over
 * the cap in a substep (overPowerSubsteps, impacts, fallEffortOver, the ledger's per-substep sum) is not visible; it is
 * returned for the test to print (and l4mx carries it per run), not asserted.
 */
function powerAudit(d: FixtureDef, s: Simulation): PowerOver[] {
  const P = d.fallResponse!.power;
  const out: PowerOver[] = [];
  const bySubstep = new Map<string, number>();
  for (const e of s.fall!.ledger) bySubstep.set(`${e.owner}@${e.step}`, (bySubstep.get(`${e.owner}@${e.step}`) ?? 0) + Math.max(0, e.realizedW));
  for (const [id, r] of Object.entries(exp(s).fallEffort ?? {}) as [string, any][]) {
    const label = `${d.id} ${id}`;
    expect(r.overWork, label).toBe(false);
    expect(r.positiveWorkJ, label).toBeLessThanOrEqual(P.maxPositiveWorkJ * (1 + P.toleranceFraction));
    expect(r.peakPredictedW, label).toBeLessThanOrEqual(P.maxPositiveW * P.planFraction * (1 + 1e-3));
    let peakRealizedW = 0;
    for (const [k, w] of bySubstep) if (k.startsWith(`${id}@`)) peakRealizedW = Math.max(peakRealizedW, w);
    out.push({
      label,
      overPowerSubsteps: r.overPowerSubsteps,
      impactPowerSubsteps: r.impactPowerSubsteps,
      peakImpactW: r.peakImpactW,
      overEvents: evs(s, 'fallEffortOver').filter((e) => e.playerId === id).length,
      peakRealizedW,
      capW: P.maxPositiveW * (1 + P.toleranceFraction),
    });
  }
  return out;
}

describe('L4 audits on every fixture', () => {
  const withResponse = (): FixtureDef[] => ALL.filter((d) => d.fallResponse);

  it('every response fixture passes the effort audits: caps, power and work, impacts, active substeps, the shared budget, the window and held arms', async () => {
    await checks([
      [
        'every actuated joint is capped, inside the effort window, on accepted ragdolls only (equal and opposite: L4-F8)',
        async () => {
          for (const d of withResponse()) {
            const s = await sim(d.id);
            const P = d.fallResponse!;
            for (const e of s.fall!.ledger) {
              const pl = s.players.find((p) => p.id === e.owner)!;
              expect(pl.handoff?.accepted, d.id).toBe(true);
              expect(e.t, d.id).toBeGreaterThanOrEqual(pl.handoff!.t);
              expect(e.appliedNm, `${d.id} ${e.joint}`).toBeLessThanOrEqual(e.capNm * (1 + 1e-6));
              expect(e.capNm).toBeLessThanOrEqual(P.ceilingsNm[pl.rag!.joints.find((j) => j.id === e.joint)!.kind as 'knee'] + 1e-9);
              // plan 10c (C7): no pair-sum check: the ledger's sum was of the commanded pair (always 0). Equal and opposite
              // application is established physically by the L4-F8 zero-gravity momentum test.
              expect(e.budgetScale).toBeLessThanOrEqual(1 + 1e-9);
              expect(e.powerScale).toBeLessThanOrEqual(1 + 1e-9);
            }
          }
        },
      ],
      [
        'work within its cap and power planned within the plan; the realized power past the 5% tolerance printed',
        async () => {
          const over: PowerOver[] = [];
          let n = 0;
          let peak = { f: 0, at: '' };
          for (const d of withResponse())
            for (const r of powerAudit(d, await sim(d.id))) {
              n++;
              if (r.overPowerSubsteps > 0 || r.overEvents > 0 || r.peakRealizedW > r.capW) over.push(r);
              if (r.peakRealizedW / r.capW > peak.f) peak = { f: r.peakRealizedW / r.capW, at: r.label };
            }
          console.log(
            `L4 realized power past the 5% tolerance (ladder 15 meter): ${n} players, ${over.length} over; largest ${(peak.f * 100).toFixed(1)}% of the tolerance cap (${peak.at})` +
              over.map((r) => `; ${r.label} ${r.overPowerSubsteps} substeps (${r.impactPowerSubsteps} impacts, ${r.peakImpactW} W), ${r.peakRealizedW.toFixed(1)} W against ${r.capW.toFixed(1)}`).join(''),
          );
        },
      ],
      [
        // ladder 10e: IMPACT_OVER_POWER's live exception (L4-F3-run-on D, L4-F9-free D) is retired: since the leg-guard
        // flip no registered run shows it (the one instance left, L4-F9-low reversed R, is not a registered forward run;
        // its capture test is in tests/fall-defects.test.ts). The fault twin puts back what the exception set aside: the
        // landing of L4-F3-run-on D under the leg guard before the flip, one substep over the power cap, an impact
        'fault twin: the audit reads an impact through the legs over the power cap (L4-F3-run-on D under LEG_GUARD_V1, the IMPACT_OVER_POWER landing)',
        async () => {
          // (ladder 15: the realized-power tolerance is printed, not a gate; the twin shows the meter reads the landing)
          const d = FIX('L4-F3-run-on');
          const s = await simV1(d.id);
          const D = powerAudit(d, s).find((r) => r.label === 'L4-F3-run-on D')!;
          expect([D.overPowerSubsteps, D.impactPowerSubsteps, D.overEvents]).toEqual([1, 1, 1]);
          expect(D.peakImpactW).toBeGreaterThan(D.capW);
          expect(evs(s, 'fallEffortOver').filter((e) => e.playerId === 'D').map((e) => e.data.impact)).toEqual([true]);
          // the registered run (the leg guard as registered) passes the same audit
          powerAudit(d, await sim(d.id));
        },
      ],
      [
        'an impact holds effort off the limb it reaches, or the whole body through the core, for that substep only',
        async () => {
          let held = 0;
          let body = 0;
          for (const d of withResponse()) {
            const s = await sim(d.id);
            for (const [id, r] of Object.entries(exp(s).fallEffort ?? {}) as [string, any][]) {
              held += r.heldSubsteps;
              body += r.heldBodySubsteps;
              expect(r.heldBodySubsteps, d.id).toBeLessThanOrEqual(r.heldSubsteps);
              // substeps with effort commands (plan 10c, C7: activeSubsteps now counts only those that applied torque, and a
              // zero-cap profile never does)
              const commanded = new Set(s.fall!.ledger.filter((e) => e.owner === id).map((e) => e.step)).size;
              // (plan 12: a ragdoll accepted less than a ramp before the run ends has a handful of substeps, too few to compare:
              // L4-F5-twoPalm-on R converts 29 ms before the end, inside its delay, L4-F10-elbow-on D 71 ms before, 3 commanded, 4 held)
              const pl = s.players.find((p) => p.id === id)!;
              if (s.t - pl.handoff!.t - d.fallResponse!.timing.delayS < d.fallResponse!.timing.rampS) continue;
              expect(r.heldSubsteps, d.id).toBeLessThan(commanded);
            }
          }
          expect(held).toBeGreaterThan(body);
          expect(body).toBeGreaterThan(0);
        },
      ],
      [
        'an active substep is one that applied torque: the count matches the ledger',
        async () => {
          // plan 10c (C7): a substep whose commands were all scaled to nothing used to count as active
          let checked = 0;
          let idle = 0;
          for (const d of withResponse()) {
            const s = await sim(d.id);
            const torqued = new Map<string, Set<number>>();
            const commanded = new Map<string, Set<number>>();
            for (const e of s.fall!.ledger) {
              if (!commanded.has(e.owner)) commanded.set(e.owner, new Set());
              commanded.get(e.owner)!.add(e.step);
              if (e.appliedNm > 0) {
                if (!torqued.has(e.owner)) torqued.set(e.owner, new Set());
                torqued.get(e.owner)!.add(e.step);
              }
            }
            for (const [id, r] of Object.entries(exp(s).fallEffort ?? {}) as [string, any][]) {
              expect(r.activeSubsteps, `${d.id} ${id}`).toBe(torqued.get(id)?.size ?? 0);
              idle += (commanded.get(id)?.size ?? 0) - (torqued.get(id)?.size ?? 0);
              checked++;
            }
          }
          expect(checked).toBeGreaterThan(20);
          // commanded substeps without torque exist (the work cap, a zero proposal), so the distinction is exercised
          expect(idle).toBeGreaterThan(0);
        },
      ],
      [
        'accounted arm effort stays under the shared budget, combined with grasp tension',
        async () => {
          let shared = 0;
          let grasp = 0;
          for (const d of withResponse()) {
            const s = await sim(d.id);
            const byStep = new Map<string, number>();
            for (const e of s.arms?.effortLedger ?? []) {
              expect(e.allocatedN, d.id).toBeLessThanOrEqual(e.perArmN + 1e-6);
              const k = `${e.owner}:${e.step}`;
              byStep.set(k, (byStep.get(k) ?? 0) + e.allocatedN);
              expect(byStep.get(k)!, d.id).toBeLessThanOrEqual(e.ownerBudgetN + 1e-6);
              if (e.graspN > 0) grasp++;
              // the torque actually applied carries the same scale as the grasp it shares a budget with
              const torque = s.fall!.ledger.find((x) => x.owner === e.owner && x.step === e.step && x.joint === `${e.arm}Shoulder`);
              if (torque) expect(torque.budgetScale, d.id).toBeCloseTo(e.armFactor * e.sharedScale, 9);
              if (torque && e.armFactor * e.sharedScale < 1 - 1e-9) shared++;
            }
          }
          expect(grasp).toBeGreaterThan(0);
          expect(shared).toBeGreaterThan(0);
        },
      ],
      [
        'no effort after the window, and the window is about a second',
        async () => {
          for (const d of withResponse()) {
            const s = await sim(d.id);
            const T = d.fallResponse!.timing;
            for (const r of Object.values(exp(s).fallEffort ?? {}) as any[]) expect(r.lastEffortS).toBeLessThanOrEqual(T.fadeStartS + T.fadeS + 1e-6);
          }
        },
      ],
      [
        'a held arm never takes a brace target while its hold stands',
        async () => {
          for (const d of withResponse()) {
            const s = await sim(d.id);
            const lost = new Map<string, number>();
            for (const e of s.events) {
              const data = e.data!;
              if (e.type === 'fallTask' && data.from === 'hold') lost.set(`${e.playerId}:${data.arm}`, e.t);
              if (e.type !== 'braceTarget' && e.type !== 'braceContact') continue;
              const begin = tasksOf(s, e.playerId!);
              if (begin?.[data.arm as string] !== 'hold') continue;
              expect(lost.has(`${e.playerId}:${data.arm}`), d.id).toBe(true);
            }
          }
        },
      ],
    ]);
  }, 240000);

  it('ledgers off (the lab default) changes nothing but the ledgers', async () => {
    // plan 10c (C7): the ledgers grow per substep; off, nothing is pushed and the running totals stay in the stats
    const id = 'L4-F5-twoPalm-on';
    const on = await sim(id);
    const off = await Simulation.create(FIX(id), { trace: false, ledgers: false });
    off.runToEnd();
    expect(on.fall!.ledger.length).toBeGreaterThan(0);
    expect(on.arms!.ledger.length).toBeGreaterThan(0);
    expect(on.arms!.effortLedger.length).toBeGreaterThan(0);
    expect([off.fall!.ledger.length, off.arms!.ledger.length, off.arms!.effortLedger.length]).toEqual([0, 0, 0]);
    expect(JSON.stringify(off.summary())).toBe(JSON.stringify(on.summary()));
    expect(JSON.stringify(exp(off).fallEffort)).toBe(JSON.stringify(exp(on).fallEffort));
    off.dispose();
  });
});

// ------------------------------------------------------------------ knee and hip
describe('L4-F2 knee flexion, on and off', () => {
  const DIRS = ['forward', 'back', 'side', 'model-forward', 'model-back', 'model-side'];
  const IDS = new Set(DIRS.flatMap((dir) => [`L4-F2-${dir}-on`, `L4-F2-${dir}-off`]));
  // each fall's knees where a run stepped while t < 0.3 s stops
  const at03 = watch((id) => IDS.has(id), hingesAt(0.3));

  it('the active case attempts finite flexion from the accepted angle, in every L4-F2 direction', async () => {
    await rows(DIRS, (dir) => dir, async (dir) => {
      const at = async (id: string): Promise<number> => {
        const h = (await at03(id)).h!;
        return (h.leftKnee + h.rightKnee) / 2;
      };
      const [on, off] = [await at(`L4-F2-${dir}-on`), await at(`L4-F2-${dir}-off`)];
      // a forward fall folds the knees past the target on its own, so the flexor stops; it never holds them straighter
      if (dir.endsWith('forward')) expect(on).toBeGreaterThan(off - 3);
      else expect(on).toBeGreaterThan(off + 2);
      const s = await sim(`L4-F2-${dir}-on`);
      // (plan 12: the plain forward fall's flexor attempts and only brakes: its knees fold past the target on their own. The
      // twin pushed 0.28 J before they did; with the narrower shoulder the arms fall differently and it does none)
      if (dir === 'forward') expect(report(s, 'R').activeSubsteps).toBeGreaterThan(0);
      else expect(report(s, 'R').positiveWorkJ).toBeGreaterThan(0);
      const joints = new Set(s.fall!.ledger.map((e) => e.joint));
      expect([...joints].sort()).toEqual(['leftKnee', 'rightKnee']);
      expect(report(s, 'R').peakNm.knee).toBeLessThanOrEqual(FALL_L4.ceilingsNm.knee + 1e-9);
      expect(evs(s, 'fallResponse')[0].data.kneeDeg.left).toBeCloseTo((s.players[0].fall!.knee0.left * 180) / Math.PI, 1);
    });
  });
});

// ------------------------------------------------------------------ arms
describe('L4-F3 carrier with a free arm', () => {
  it('the free arm braces only where the fall allows, a miss stays a miss, and the carry arm protects, on every L4-F3 response-on fixture', async () => {
    await checks([
      [
        'L4-F3-model-side-on: cannot brace',
        async () => {
          // (plan 12: the brace point lies outside the narrower shoulder range, `tooFar`; before it the arm got there `late`)
          const s = await sim('L4-F3-model-side-on');
          expect(tasksOf(s, 'R')).toEqual({ left: 'brace', right: 'protect' });
          expect(evs(s, 'braceContact')).toEqual([]);
          expect(evs(s, 'braceMiss').map((e) => e.data.reason)).toEqual(['tooFar']);
        },
      ],
      // plan 12: the oblique and side falls' free arm, held inside the narrower shoulder range, reaches the floor after the body:
      // a late miss where the twin's palm landed at 0.308 s. The carry arm still protects
      ...['L4-F3-oblique-on', 'L4-F3-side-on'].map(
        (id): Check => [
          `${id}: late inside the shoulder range`,
          async () => {
            // (ladder 8l: natural samples, pinned to the profile before the visible flip; under its hip stops the oblique
            // fall's free arm lands its palm at 0.350 s and the side fall's misses tooFar at 0.338 s)
            const s = await simPre(id);
            expect(tasksOf(s, 'R')).toEqual({ left: 'brace', right: 'protect' });
            expect(evs(s, 'braceContact').filter((e) => e.playerId === 'R')).toEqual([]);
            expect(evs(s, 'braceMiss').map((e) => `${e.data.arm} ${e.data.reason}`)).toEqual(['left late']);
            expect(evs(s, 'fallTask').filter((e) => e.playerId === 'R' && e.data.arm === 'right').map((e) => e.data.reason)).toEqual(['windowEnded']);
            for (const e of nonEmpty(s.fall!.ledger.filter((x) => x.owner === 'R' && x.joint.startsWith('right') && /Shoulder|Elbow/.test(x.joint)), 'right arm effort')) expect(e.task).toBe('protect');
          },
        ],
      ),
      ...['L4-F3-forward-on', 'L4-F3-run-on', 'L4-F3-model-forward-on', 'L4-F3-model-oblique-on'].map(
        (id): Check => [
          `${id}: reaches the floor through a real collider`,
          async () => {
            const s = await sim(id);
            expect(tasksOf(s, 'R')).toEqual({ left: 'brace', right: 'protect' });
            const c = evs(s, 'braceContact').filter((e) => e.playerId === 'R');
            expect(c.length).toBe(1);
            expect(c[0].data.arm).toBe('left');
            expect(['palm', 'forearm']).toContain(c[0].data.part);
            expect(evs(s, 'fallTask').filter((e) => e.playerId === 'R' && e.data.arm === 'right').map((e) => e.data.reason)).toEqual(['windowEnded']);
            const right = s.fall!.ledger.filter((e) => e.owner === 'R' && e.joint.startsWith('right') && /Shoulder|Elbow/.test(e.joint));
            expect(right.length).toBeGreaterThan(0);
            for (const e of right) expect(e.task).toBe('protect');
          },
        ],
      ),
    ]);
  });

  // the landed arm, every tick of the forward fall: the joint count at conversion, and from the first brace contact the
  // palm's distance from where it landed and the elbow's bend from its angle then
  const landed = watch(
    (id) => id === 'L4-F3-forward-on',
    () => {
      const data = { joints: -1, elbow0: null as number | null, fromContact: 0, bend: 0, samples: 0 };
      return {
        data,
        tick: (s) => {
          const rag: Ragdoll | null = s.players[0].rag;
          if (rag && data.joints < 0) data.joints = s.physics.world.impulseJoints.len();
          const c = evs(s, 'braceContact')[0];
          if (rag && c) {
            const side = c.data.arm as ArmSide;
            const at = v3(c.data.palm[0], c.data.palm[1], c.data.palm[2]);
            const h = hingeAngles(rag)[`${side}Elbow`];
            const elbow0 = (data.elbow0 ??= h);
            data.bend = Math.max(data.bend, Math.abs(h - elbow0));
            data.fromContact = Math.max(data.fromContact, len(sub(landmarkWorld(rag, `${side}Palm`), at)));
            data.samples++;
          }
        },
      };
    },
  );

  it('the arm yields once it lands: no sticky anchor, no extra joint, the hand can still move', async () => {
    // plan 10c (C8): measured against the contact, not in the world (the forearm moves with the falling body anyway):
    // the palm leaves the point where it landed, and the elbow bends under the load
    const s = await sim('L4-F3-forward-on');
    const { joints, fromContact, bend, samples } = await landed('L4-F3-forward-on');
    expect(samples).toBeGreaterThan(10);
    expect(s.physics.world.impulseJoints.len()).toBe(joints);
    expect(fromContact).toBeGreaterThan(0.01);
    expect(bend).toBeGreaterThan(5);
  });

  it('the motor-off twin has no response evidence', async () => {
    const s = await sim('L4-F3-forward-off');
    expect(s.fall).toBeNull();
    expect(exp(s).fallEffort).toEqual({});
    expect(evs(s, 'fallResponse').length).toBe(0);
    expect(exp(s).jointLimits.R.envelope.joints.length).toBe(4);
  });
});

// plan 10c C5: opposite vectors returned the target at once, a half-turn jump past the brace's rate limit
describe('the brace direction turns at its rate limit', () => {
  it('opposite vectors turn by the limit each step, about an axis perpendicular to the start', () => {
    const step = 0.3;
    for (const from of [v3(0, -1, 0), v3(1, 0, 0), norm(v3(0.3, -0.8, 0.52)), v3(0, 0, -1)]) {
      const to = scale(from, -1);
      let d = from;
      let n = 0;
      while (dot(d, to) < 1 - 1e-12 && n < 100) {
        const next = rotateToward(d, to, step);
        expect(Math.abs(len(next) - 1)).toBeLessThan(1e-12);
        const turned = Math.acos(Math.min(1, dot(next, d)));
        expect(turned).toBeLessThanOrEqual(step + 1e-9);
        d = next;
        n++;
      }
      expect(n).toBe(Math.ceil(Math.PI / step));
    }
    // and the ordinary cases are unchanged: within the limit it arrives, beyond it it turns by the limit in the plane
    expect(rotateToward(v3(1, 0, 0), norm(v3(1, 0.1, 0)), step)).toEqual(norm(v3(1, 0.1, 0)));
    const r = rotateToward(v3(1, 0, 0), v3(0, 1, 0), step);
    expect(r.z).toBeCloseTo(0, 12);
    expect(Math.acos(r.x)).toBeCloseTo(step, 12);
  });
});

describe('L4-F4 braces that fail stay failures', () => {
  const withMisses = (): FixtureDef[] => ALL.filter((d) => d.fallResponse?.enable.arms);

  it('each L4-F4 brace ends as its fall allows: a miss passes the arm to passive, a clear arm lands, a fast fall leaves no time, a carrier with no free arm braces nothing, on every L4-F4 fixture', async () => {
    await checks([
      // (plan 12: L4-F4-late's brace point is outside the narrower shoulder range, so it misses `tooFar` before it is late;
      // L4-F4-obstructed's arm, inside the range, passes clear of the obstruction and lands, below)
      ...([
        ['L4-F4-tooFar', 'tooFar'],
        ['L4-F4-late', 'tooFar'],
      ] as const).map(
        ([id, reason]): Check => [
          `${id}: ${reason}, no contact claimed, the arm goes passive`,
          async () => {
            const s = await sim(id);
            expect(evs(s, 'braceContact').length).toBe(0);
            const m = evs(s, 'braceMiss');
            expect(m.length).toBe(1);
            expect(m[0].data).toMatchObject({ arm: 'left', reason });
            expect(evs(s, 'fallTask').find((e) => e.data.arm === 'left')!.data).toMatchObject({ from: 'brace', to: 'passive', reason: 'braceMiss' });
            const after = s.fall!.ledger.filter((e) => e.joint === 'leftShoulder' && e.t > m[0].t + 1e-9);
            expect(after.length).toBe(0);
          },
        ],
      ),
      [
        'L4-F4-obstructed: the arm inside the shoulder range passes clear of the obstruction and lands (plan 12; the twin misses obstructed)',
        async () => {
          const s = await sim('L4-F4-obstructed');
          expect(evs(s, 'braceMiss')).toEqual([]);
          expect(evs(s, 'braceContact').map((e) => `${e.data.arm} ${e.data.part}`)).toEqual(['left palm']);
        },
      ],
      [
        'L4-F4-fast: a fast fall lands before the arm: no time to brace',
        async () => {
          const s = await sim('L4-F4-fast');
          expect(evs(s, 'braceContact').length).toBe(0);
          expect(evs(s, 'braceMiss').length).toBe(1);
          expect(s.players[0].fall!.coreDown).toBe(true);
        },
      ],
      [
        'L4-F4-occupied: a carrier with no free arm: one protects, one holds, nothing braces',
        async () => {
          // (ladder 10: a natural sample, pinned to the leg guard it was taken under. Under V3 R's legs meet D's body from
          // 0.93 s and D's left hold ends on separation at 1.729 s, so that arm is free and braces, too late: braceMiss)
          const s = await simV1('L4-F4-occupied');
          expect(tasksOf(s, 'D')).toEqual({ left: 'hold', right: 'protect' });
          expect(evs(s, 'braceTarget').length + evs(s, 'braceContact').length + evs(s, 'braceMiss').length).toBe(0);
          // plan 10c (C8): a per-item check over nothing proves nothing
          for (const e of nonEmpty(s.fall!.ledger.filter((x) => x.task), 'tasked effort entries')) expect(['hold', 'protect']).toContain(e.task);
        },
      ],
    ]);
  });

  // every substep of every fall with arms: per player and arm, the last time a seeking brace (not a hold, not on a hold)
  // pressed on another body or an obstacle
  /** When each arm's seeking brace last touched a body other than the ground (not a hold): the obstruction a miss reads. */
  const seekObserver = (): Observer & { data: Map<string, number>; substep: (x: Simulation) => void } => {
    const seek = new Map<string, number>();
    return {
      data: seek,
      substep: (x: Simulation) => {
        for (const p of x.players) {
          if (!p.fall) continue;
          for (const c of x.contacts) {
            if (c.impulse <= 0) continue;
            for (const [own, o] of [[c.a, c.b], [c.b, c.a]] as const) {
              if (own.playerId !== p.id || !own.side || (own.region !== 'palm' && own.region !== 'forearm') || isGround(o) || o.playerId === p.id) continue;
              const a = p.fall.arms[own.side];
              const held = !!o.playerId && !!o.side && (o.region === 'palm' || o.region === 'forearm') && !!x.arms?.retained(o.playerId, o.side);
              if (a.task === 'brace' && a.brace === 'seek' && !held && !x.arms?.retained(p.id, own.side)) seek.set(`${p.id}:${own.side}`, x.t);
            }
          }
        }
      },
    };
  };
  const seekOf = watch((id) => withMisses().some((d) => d.id === id), seekObserver);

  // plan 10c C4: `obstructed` was set by any arm contact with the opponent or an obstacle at any time, the arm's own hold
  // included, and never cleared: L4-F6-break's left arm missed as `obstructed` 0.52 s after its hold broke
  it('a miss is obstructed only by a seeking brace blocked within its shortest prediction horizon, never by a hold', async () => {
    const W = FALL_L4.brace.horizonS[0];
    let obstructed = 0;
    let other = 0;
    const runs: [string, Simulation, Map<string, number>][] = [];
    for (const d of withMisses()) runs.push([d.id, await sim(d.id), await seekOf(d.id)]);
    // plan 13d: the natural obstructed misses (3 before: L4-F5-oneClamp-on, L4-F9-defenderRising, L4-F10-wrap-on) are gone
    // with Fast Run's contact timing; L4-F4-obstructed without the joint range, the case the fixture was built for, still
    // misses obstructed (R left at 0.442 s, as before)
    const o = seekObserver();
    const tw = await create({ ...FIX('L4-F4-obstructed'), id: 'L4-F4-obstructed-noRange', jointRange: undefined }, { onSubstep: (x: Simulation) => o.substep(x) });
    await runSim(tw, Infinity);
    runs.push([tw.def.id, tw, o.data]);
    for (const [id, s, seek] of runs) {
      const d = { id };
      for (const e of evs(s, 'braceMiss')) {
        const at = seek.get(`${e.playerId}:${e.data.arm}`);
        const near = at !== undefined && e.t - at <= W + 1e-9;
        expect(e.data.reason === 'obstructed', `${d.id} ${e.playerId} ${e.data.arm} at ${e.t}`).toBe(near);
        if (near) obstructed++;
        else other++;
      }
    }
    // (plan 12: 3, L4-F4-obstructed lands instead; plan 13d: 1, the twin's; ladder 9e: also L4-F5-twoClamp-on and
    // L4-F9-both D right, pressed on R's shin when the window ends)
    expect(obstructed).toBeGreaterThanOrEqual(1);
    tw.dispose();
    expect(other).toBeGreaterThan(10);
    // the review's case: the broken hold braces and misses, and its own hold's contact does not make that an obstruction
    const m = evs(await sim('L4-F6-break'), 'braceMiss').filter((e) => e.playerId === 'D' && e.data.arm === 'left');
    // (plan 12: it runs out of window, `expired`; before, it was `late`)
    expect(m.map((e) => e.data.reason)).toEqual(['expired']);
  }, 120000);
});

/** Ladder rung 7d: per `owner:step:arm`, the torque the fall response applied to that arm's shoulder and elbow (N m, after the arm budget and the power scale). */
function appliedArmEffort(s: Simulation): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of s.fall!.ledger) {
    const arm = /^(left|right)(Shoulder|Elbow)$/.exec(e.joint)?.[1];
    if (!arm) continue;
    const k = `${e.owner}:${e.step}:${arm}`;
    m.set(k, (m.get(k) ?? 0) + e.appliedNm);
  }
  return m;
}

/** Ladder rung 7d: `id` pinned to LEG_GUARD_V1, the guard its natural samples were taken under (the shared run while the fixture registers it). */
async function simV1(id: string): Promise<Simulation> {
  const d = FIX(id);
  if (!d.legGuard || d.legGuard.id === LEG_GUARD_V1.id) return sim(id);
  const k = `${id}~v1`;
  if (!ran.has(k)) ran.set(k, await runSim(await create({ ...d, legGuard: LEG_GUARD_V1 }), Infinity));
  return ran.get(k)!;
}

/**
 * Ladder 8l: `id` pinned to the profile before the visible flip (`preFlip`; since ladder 10 also the leg guard before
 * its flip, `preV3`), the profile its natural samples were taken under.
 */
async function simPre(id: string): Promise<Simulation> {
  const k = `${id}~pre`;
  if (!ran.has(k)) ran.set(k, await runSim(await create(preV3(preFlip(FIX(id)))), Infinity));
  return ran.get(k)!;
}

describe('L4-F5 holds, L4-F6 the last hold breaks', () => {
  it('holds take their arms from bracing, forearm clamps count as holds, and a hold ends on its load, never on a decision', async () => {
    await checks([
      [
        'two palm holds suppress bracing on both arms',
        async () => {
          const s = await sim('L4-F5-twoPalm-on');
          expect(tasksOf(s, 'D')).toEqual({ left: 'hold', right: 'hold' });
          expect(evs(s, 'braceTarget').length).toBe(0);
        },
      ],
      [
        'one palm hold: that arm holds, the free arm may brace',
        async () => {
          // (ladder rung 7d: pinned to LEG_GUARD_V1; under the physical legs the hold arm's brace no longer runs out of window)
          const s = await simV1('L4-F5-onePalm-on');
          expect(tasksOf(s, 'D')).toEqual({ left: 'hold', right: 'brace' });
          // plan 12: the held runner leaves the hold at 1.846 s (its feet released at 0.996 s, the twin's at 1.17 s), so the hold
          // arm braces and runs out of window; the free arm lands where the twin's was late. No hold is lost on its load.
          // Ladder 8l, a behaviour change the user accepted at the visible flip: under its knee stop the free arm's brace
          // no longer lands and runs out of window, and the hold stands until the runner leaves it at 1.992 s (the same
          // state without the knee stop lands the palm at 1.675 s; without the hip stops or PGS 4 it does not land either)
          expect(evs(s, 'braceContact').map((e) => `${e.data.arm} ${e.data.part}`)).toEqual([]);
          expect(evs(s, 'braceMiss').map((e) => `${e.data.arm} ${e.data.reason}`)).toEqual(['right expired']);
          expect(evs(s, 'gripRelease').map((e) => `${e.data.arm} ${e.data.reason}`)).toEqual(['left separation']);
        },
      ],
      [
        'forearm clamps carried into the fall count as holds',
        async () => {
          const s = await sim('L4-F5-twoClamp-on');
          expect(Object.values(tasksOf(s, 'D'))).toContain('hold');
        },
      ],
      [
        'a hold ends on its load, never on a decision: no reflexive drop',
        async () => {
          // plan 10c (C8): at least one release and one lost hold, so the checks run on something
          let releases = 0;
          let losses = 0;
          for (const id of ['L4-F5-twoPalm-on', 'L4-F5-onePalm-on', 'L4-F4-occupied', 'L4-F6-break']) {
            const s = await sim(id);
            for (const e of evs(s, 'gripRelease')) expect(['voluntary', 'playEnded'], id).not.toContain(e.data.reason);
            const lost = evs(s, 'fallTask').filter((e) => e.data.from === 'hold' && e.data.reason !== 'windowEnded');
            for (const e of lost) expect(e.data.reason).toBe('holdLost');
            releases += evs(s, 'gripRelease').length;
            losses += lost.length;
          }
          expect(releases).toBeGreaterThan(0);
          expect(losses).toBeGreaterThan(0);
        },
      ],
    ]);
  });

  // plan 10c C1 (U4): the hold arm's own effort took grasp tension in the shared budget and counted as grasp overload
  // (L4-F5-twoPalm-on released both holds at 1.717 s while the off twin kept them). Grasp now allocates first.
  it('a hold is allocated first, so a hold the response-off twin keeps survives the response unless its own grasp is over its allocation', async () => {
    await checks([
      [
        'a hold is allocated first: its tension and overload exposure are what they would be with no effort',
        async () => {
          // The check only tells grasp first from the fault it was written against where the budget binds: the pre-10c
          // joint allocation, the arm's effort added to its grasp under one per-arm factor and one shared scale (C1 above).
          // That fault is computed here from each substep's own demands (the same state), and it is the check's fault twin:
          // the check must fail under it somewhere in the sample, and the two allocations may differ only in a substep whose
          // effort the budget scaled. (Ladder 8m, in place of a count of scaled substeps, 50 at plan 10c and 20 since plan
          // 12: before the visible flip 29, 16 of them L4-F5-onePalm-on's free arm, whose brace no longer lands under the
          // knee stop; under it 13, every one L4-F6-break's, and the fault takes up to 31% of that hold's tension.)
          let checked = 0;
          const scaled = new Set<string>();
          const caught: string[] = [];
          for (const d of ALL.filter((x) => x.fallResponse)) {
            const s = await sim(d.id);
            const A = s.arms;
            if (!A) continue;
            const effort = new Map<string, typeof A.effortLedger>();
            for (const e of A.effortLedger) effort.set(`${e.owner}:${e.step}`, [...(effort.get(`${e.owner}:${e.step}`) ?? []), e]);
            const byStep = new Map<string, typeof A.ledger>();
            for (const e of A.ledger) byStep.set(`${e.owner}:${e.step}`, [...(byStep.get(`${e.owner}:${e.step}`) ?? []), e]);
            for (const [k, es] of byStep) {
              const ef = effort.get(k);
              if (!ef) continue;
              const [perArm, budget] = [ef[0].perArmN, ef[0].ownerBudgetN];
              const holds = es.filter((x) => x.kind === 'hold' || x.kind === 'passive');
              if (holds.length && ef.some((e) => e.armFactor * e.sharedScale < 1 - 1e-9)) scaled.add(`${d.id} ${k}`);
              // the grasps' own allocation, from their demands alone
              const sum = es.reduce((a, e) => a + e.demand, 0);
              const alone = sum > budget ? budget / sum : 1;
              // the fault's: per arm its grasp plus its effort's force equivalent under the arm's ceiling, then one scale
              const joint: Record<ArmSide, number> = { left: 1, right: 1 };
              let total = 0;
              for (const side of ['left', 'right'] as const) {
                const t = es.filter((e) => e.arm === side).reduce((a, e) => a + e.demand, 0) + (ef.find((e) => e.arm === side)?.equivalentN ?? 0);
                joint[side] = t > perArm ? perArm / t : 1;
                total += t * joint[side];
              }
              const jointShared = total > budget ? budget / total : 1;
              for (const e of holds) {
                checked++;
                const want = Math.min(e.raw, perArm) * alone;
                expect(e.actual, `${d.id} ${k} ${e.arm}`).toBeCloseTo(want, 9);
                expect(e.allocated, `${d.id} ${k} ${e.arm}`).toBeCloseTo(alone < 1 ? e.actual : perArm, 9);
                if (Math.abs(Math.min(e.raw, perArm) * joint[e.arm] * jointShared - want) > 1e-6) caught.push(`${d.id} ${k}`);
              }
            }
          }
          expect(checked).toBeGreaterThan(500);
          expect(caught.length, 'the sample tells grasp first from the joint allocation somewhere').toBeGreaterThan(0);
          expect(caught.filter((c) => !scaled.has(c)), 'the allocations differ only where the budget scaled the effort').toEqual([]);
        },
      ],
      [
        'a hold the response-off twin keeps survives with the response on, unless its grasp alone is over its allocation',
        async () => {
          const twins: string[] = [];
          for (const on of ALL.filter((x) => x.id.endsWith('-on'))) {
            const offId = on.id.replace(/-on$/, '-off');
            if (!ALL.some((x) => x.id === offId)) continue;
            const [a, b] = [await sim(on.id), await sim(offId)];
            if (!a.arms?.ledger.some((e) => e.kind === 'hold' || e.kind === 'passive')) continue;
            twins.push(on.id);
            const lostOff = new Set(evs(b, 'gripRelease').filter((e) => e.data.reason === 'overload').map((e) => `${e.playerId}:${e.data.arm}`));
            for (const e of evs(a, 'gripRelease').filter((x) => x.data.reason === 'overload')) {
              const k = `${e.playerId}:${e.data.arm}`;
              if (lostOff.has(k)) continue;
              const over = a.arms!.ledger.some((x) => `${x.owner}:${x.arm}` === k && x.raw > x.allocated + 1e-9);
              expect(over, `${on.id} ${k}: released for overload with no grasp over its allocation`).toBe(true);
            }
          }
          // (the twins with a hold at conversion; L4-F4-occupied and L4-F6-break have no response-off twin)
          expect(twins.sort()).toEqual(['L4-F5-onePalm-on', 'L4-F5-twoPalm-on']);
          // the review's case: both holds stand to the end of the window, with no overload exposure, as with the response off.
          // (Ladder 8l: a natural sample, pinned to the profile before the visible flip, under which neither hold is ever
          // over its allocation: 64 substeps before, 30 with its hip stops off, none with PGS 4 or the knee stop off)
          const [on, off] = [await simPre('L4-F5-twoPalm-on'), await simPre('L4-F5-twoPalm-off')];
          expect(evs(on, 'gripRelease')).toEqual([]);
          expect(evs(on, 'fallTask').map((e) => `${e.data.arm} ${e.data.from}>${e.data.to} ${e.data.reason}`)).toEqual(['left hold>passive windowEnded', 'right hold>passive windowEnded']);
          const holds = (s: Simulation) => s.arms!.ledger.filter((e) => e.kind === 'hold' || e.kind === 'passive');
          // The response adds no exposure. (plan 12: the runner pulls harder on the holds, 0.018 s overload exposure with the
          // response on, 0.020 off, where both were 0.) The two twins part at the conversion: the response-off twin's runner
          // never converts and its holds end on separation at 1.90 and 1.97 s, so the exposures are of different loads, and
          // comparing them was exact only while the runs matched. Contact motion M1: the runner's free-arm twist moves its
          // wrist 0.5 mm by 1.18 s, and its pull just before it converts (2.02-2.15 s, up to 292 N on a 132 N allocation)
          // then lasts 32 substeps in one episode instead of 24 in two: 0.031 s on, 0.020 off. So what is checked is the
          // response's part directly: in every substep a hold is over its allocation the held arm takes no response effort
          // (the overload is the grasp's load alone; the allocation row above checks the accounting), and the exposure stays
          // within half the release threshold. Ladder rung 7d: the effort the joints were given (the fall ledger), not the
          // one the response asked for (see the row below)
          const applied = appliedArmEffort(on);
          const over = holds(on).filter((e) => e.raw > e.allocated + 1e-9);
          expect(over.length).toBeGreaterThan(0);
          // (to rounding: the room a grasp at its allocation leaves is the difference of two equal sums, 1e-14 N m under V3)
          for (const e of over) expect(applied.get(`${e.owner}:${e.step}:${e.arm}`) ?? 0, `${e.owner} ${e.arm} step ${e.step}`).toBeLessThan(1e-9);
          expect(Math.max(...holds(on).map((e) => e.exposure))).toBeLessThanOrEqual(on.arms!.profile.hold.overloadThresholdS / 2);
          expect(evs(off, 'gripRelease').map((e) => `${e.data.arm} ${e.data.reason}`)).toEqual(['right separation', 'left separation']);
          // (plan 12: this run's effort no longer meets the shared budget, so nothing of it is scaled here; the allocation test
          // above finds its scaled substeps in other L4 fixtures)
        },
      ],
      [
        'the held arm\'s effort read as applied: an arm may ask for effort while its grasp is over its allocation, the budget gives it none (L4-F5-twoPalm-on under LEG_GUARD_V3)',
        async () => {
          // Ladder rung 7d. Under the physical legs (V3, the flip after this rung) D's left arm asks for effort (0.76 N m at
          // step 451) in substeps its grasp is over its allocation; the grasp leaves the arm no room, so the budget scales
          // that request to 0 and the joints get none. Reading the request, the row above failed there. Fault twin: the same
          // run with an arm the budget gives no room taking its request unscaled where the torque is applied (the same run up
          // to that substep): the arm then takes effort while its grasp is over its allocation
          const v3 = async (unscaled: boolean): Promise<{ requested: number; applied: number }> => {
            // (ladder 8l: a natural sample, pinned to the profile before the visible flip, under which the arm asks 0.03 N m
            // at most in those substeps)
            const s = await create({ ...preFlip(FIX('L4-F5-twoPalm-on')), legGuard: LEG_GUARD_V3 });
            if (unscaled) {
              type Scale = Record<ArmSide, number> | undefined;
              const f = s.fall! as unknown as { apply(ep: unknown, scale: Scale): void };
              const apply = f.apply.bind(f);
              f.apply = (ep, sc) => apply(ep, sc && { left: sc.left > 0 ? sc.left : 1, right: sc.right > 0 ? sc.right : 1 });
            }
            await runSim(s, Infinity);
            const asked = new Map(s.arms!.effortLedger.map((e) => [`${e.owner}:${e.step}:${e.arm}`, Math.abs(e.shoulderNm) + Math.abs(e.elbowNm)]));
            const got = appliedArmEffort(s);
            const over = s.arms!.ledger.filter((e) => (e.kind === 'hold' || e.kind === 'passive') && e.raw > e.allocated + 1e-9).map((e) => `${e.owner}:${e.step}:${e.arm}`);
            s.dispose();
            return { requested: Math.max(0, ...over.map((k) => asked.get(k) ?? 0)), applied: Math.max(0, ...over.map((k) => got.get(k) ?? 0)) };
          };
          const run3 = await v3(false);
          expect(run3.requested).toBeGreaterThan(0.1);
          expect(run3.applied).toBeLessThan(1e-9);
          expect((await v3(true)).applied).toBeGreaterThan(0.1);
        },
      ],
    ]);
  }, 180000);

  // the broken hold, every tick until its left arm first braces: the angle between the brace target and the upper arm
  const braceGap = watch(
    (id) => id === 'L4-F6-break',
    () => {
      const data = { gapRad: Infinity };
      return {
        data,
        tick: (live) => {
          if (data.gapRad !== Infinity) return;
          const ep = live.players.find((p) => p.fall)?.fall;
          if (ep?.arms.left.task === 'brace') data.gapRad = Math.acos(Math.min(1, dot(ep.arms.left.targetDirCore, qInvRot(ep.rag.bodies.core.rotation(), limbDirWorld(ep.rag, 'leftUpperArm')))));
        },
      };
    },
  );

  it('the broken hold may brace from its achieved pose, and no new hold forms', async () => {
    const s = await sim('L4-F6-break');
    const { gapRad } = await braceGap('L4-F6-break');
    expect(gapRad).toBeLessThan(0.3);
    const conv = evs(s, 'fallResponse')[0].t;
    const change = evs(s, 'fallTask').find((e) => e.data.arm === 'left' && e.data.from === 'hold')!;
    expect(change.data).toMatchObject({ to: 'brace', reason: 'holdLost' });
    expect(evs(s, 'gripBegin').filter((e) => e.t > conv).length).toBe(0);
    expect(evs(s, 'clampBegin').filter((e) => e.playerId === 'D' && e.t > conv).length).toBe(0);
  });
});

// ------------------------------------------------------------------ saturation and momentum
describe('L4-F7 saturation and zero caps', () => {
  it('zero ceilings give exactly the motor-off trace', async () => {
    const a = await sim('L4-F7-zeroCap');
    const b = await sim('L4-F7-passive');
    expect(traceDiff(a.trace, b.trace, ['R'])).toEqual({ pos: 0, vel: 0, yaw: 0, ticks: 0 });
    expect(report(a, 'R').positiveWorkJ).toBe(0);
    expect(report(a, 'R').peakNm).toEqual({ shoulder: 0, elbow: 0, hip: 0, knee: 0 });
    for (const e of nonEmpty(a.fall!.ledger, 'zero-cap effort entries')) expect(e.appliedNm).toBe(0);
    expect(a.players[0].ragStats).toEqual(b.players[0].ragStats);
  });

  // each fall's knees where a run stepped while t < 0.5 s stops
  const at05 = watch((id) => id === 'L4-F7-overcome' || id === 'L4-F3-forward-on', hingesAt(0.5));

  it('a load past the ceiling overcomes the motor: torque saturates, the knee extends anyway', async () => {
    const s = await sim('L4-F7-overcome');
    const knees = s.fall!.ledger.filter((e) => /Knee/.test(e.joint) && e.t > 0.3 && e.t < 0.85);
    expect(knees.filter((e) => e.requestedNm >= e.capNm - 1e-9).length).toBeGreaterThan(20);
    for (const e of knees) expect(e.appliedNm).toBeLessThanOrEqual(e.capNm * (1 + 1e-6));
    const at = async (id: string): Promise<number> => (await at05(id)).h!.leftKnee;
    expect(await at('L4-F7-overcome')).toBeLessThan((await at('L4-F3-forward-on')) - 5);
  });
});

describe('L4-F8 airborne torque pairs', () => {
  // the ragdoll's bulk momentum, angular momentum about the origin and kinetic energy, every tick it exists
  const bulk = watch(
    (id) => id === 'L4-F8-airborne' || id === 'L4-F8-passive',
    () => {
      const data = { P: [] as Vec3[], L: [] as Vec3[], ke: [] as number[] };
      return {
        data,
        tick: (s) => {
          const rag = s.players[0].rag;
          if (!rag) return;
          const b = bulkOf(Object.values(rag.bodies));
          data.P.push(b.P);
          data.L.push(add(b.L, cross(b.com, b.P)));
          data.ke.push(b.ke);
        },
      };
    },
  );
  const sample = async (id: string): Promise<{ P: Vec3[]; L: Vec3[]; ke: number[]; s: Simulation }> => ({ ...(await bulk(id)), s: await sim(id) });

  it('joint actuation adds no external momentum, and energy change is explained by the work', async () => {
    const r = await sample('L4-F8-airborne');
    // (rung 7c: the L4 family reads contact impulses as solved; the zero-gravity solver otherwise)
    expect(FIX('L4-F8-airborne').solver).toEqual(withSolvedImpulses(SOLVER_G4_ZEROG));
    expect(SOLVER_G4.gravityY).toBeLessThan(-9);
    const f = report(r.s, 'R');
    expect(f.positiveWorkJ).toBeGreaterThan(5);
    for (let i = 1; i < r.P.length; i++) {
      expect(len(sub(r.P[i], r.P[0]))).toBeLessThan(0.05);
      expect(len(sub(r.L[i], r.L[0]))).toBeLessThan(0.3);
    }
    const lim = passive(r.s, 'R');
    const work = f.positiveWorkJ - f.negativeWorkJ + lim.pos - lim.neg;
    expect(Math.abs(r.ke.at(-1)! - r.ke[0] - work)).toBeLessThan(1.5);
  });

  // ladder 15 (2026-11-12, the visible bar): the motor-off airborne run blocks on the explosion gate (the natural-fall
  // limit row's 40 J and 9 m/s); its energy change, a fraction of a joule, is printed
  const EXPLODE_J = 40;
  const EXPLODE_MS = 9;
  const explosion = (gainJ: number, maxSpeed: number): string[] => [
    ...(gainJ >= EXPLODE_J ? [`gained ${gainJ.toFixed(1)} J (${EXPLODE_J} J blocks)`] : []),
    ...(maxSpeed >= EXPLODE_MS ? [`a body at ${maxSpeed.toFixed(1)} m/s (${EXPLODE_MS} m/s blocks)`] : []),
  ];

  it('the airborne motor-off twin launches nothing (its energy change printed)', async () => {
    const r = await sample('L4-F8-passive');
    const gain = r.ke.at(-1)! - r.ke[0];
    console.log(`L4-F8-passive kinetic energy change (ladder 15 meter): ${gain.toFixed(3)} J over ${r.ke.length} ticks`);
    expect(explosion(gain, r.s.players[0].ragStats!.maxSpeed)).toEqual([]);
  });

  it('fault twin: a kick of 3 m/s to every body of the motor-off run fails the explosion gate', async () => {
    let ke0 = NaN;
    let ke1 = NaN;
    let kicked = false;
    const s = await Simulation.create(FIX('L4-F8-passive'), {
      trace: false,
      onSubstep: (x) => {
        const rag = x.players[0].rag;
        if (!rag) return;
        const bodies = Object.values(rag.bodies);
        if (Number.isNaN(ke0)) ke0 = bulkOf(bodies).ke;
        if (!kicked) for (const b of bodies) b.applyImpulse(scale(v3(3, 0, 0), b.mass()), true);
        kicked = true;
        ke1 = bulkOf(bodies).ke;
      },
    });
    await runSim(s);
    expect(explosion(ke1 - ke0, s.players[0].ragStats!.maxSpeed)[0]).toMatch(/^gained \d+\.\d J \(40 J blocks\)$/);
    s.dispose();
  });
});

// ------------------------------------------------------------------ boundaries
describe('L4-F9 fall boundaries', () => {
  const pairs: [string, string, string[]][] = [
    ['L4-F9-free', 'L3-F9-convert-free', ['R', 'D']],
    ['L4-F9-prep', 'L3-F9-convert-prep', ['R', 'D']],
    ['L4-F9-contact', 'L3-F9-convert-contact', ['R', 'D']],
    ['L4-F9-exit', 'L3-F9-convert-exit', ['R', 'D']],
    ['L4-F9-low', 'L3-F9-low', ['R', 'D']],
    ['L4-F9-defenderRising', 'L3-F9-defenderRising', ['R', 'D']],
    ['L4-F9-defenderFalling', 'L3-F9-defenderFalling', ['R', 'D']],
    ['L4-F9-both', 'L3-F10-both', ['R', 'D']],
  ];
  const L3 = (id: string): FixtureDef => transitionFixtures().find((d) => d.id === id)!;

  it('a rejected or failed conversion starts no response, and nothing starts a gait after the handoff', async () => {
    await checks([
      [
        'a rejected conversion stays a passive falling proxy: no response starts',
        async () => {
          const s = await sim('L4-F9-rejected');
          const pl = s.players.find((p) => p.id === 'R')!;
          expect(pl.representation).toBe('proxy');
          expect(pl.fall).toBeNull();
          expect(evs(s, 'fallResponse')).toEqual([]);
          expect(s.fall!.ledger).toEqual([]);
        },
      ],
      [
        'a transfer that failed its audit gets no response: limits stay, effort never starts',
        async () => {
          const s = await sim('L4-F9-transferFailed');
          const failed = s.players.filter((p) => p.handoff?.outcome === 'transferFailed');
          expect(failed.length).toBeGreaterThan(0);
          for (const p of failed) {
            expect(p.rag?.envelope?.length).toBe(4);
            expect(p.fall).toBeNull();
            expect(evs(s, 'fallResponse').filter((e) => e.playerId === p.id)).toEqual([]);
            expect(s.fall!.ledger.filter((e) => e.owner === p.id)).toEqual([]);
          }
        },
      ],
      [
        'a rejected conversion stays a passive proxy: no episode, no effort',
        async () => {
          const def = asL4(L3('L3-F11-invalid'), 'L4-x', 'rejected');
          const s = await run(def);
          const rej = s.players.filter((p) => p.handoff && !p.handoff.accepted);
          expect(rej.length).toBeGreaterThan(0);
          for (const p of rej) {
            expect(p.fall).toBeNull();
            expect(s.fall!.ledger.some((e) => e.owner === p.id)).toBe(false);
          }
          s.dispose();
        },
      ],
      [
        'nothing here starts a gait: the planner has no feet after the handoff',
        async () => {
          const s = await sim('L4-F9-free');
          const conv = s.players[0].handoff!.t;
          const later = s.events.filter((e) => /^foot/.test(e.type) && e.playerId === 'R' && e.t > conv + 1e-9);
          expect(later.length).toBeGreaterThan(0);
          for (const e of later) expect(e.data).toMatchObject({ mode: 'airborne', reason: 'ragdoll' });
        },
      ],
    ]);
  });

  it('identical to its passive source up to the conversion, whose audits pass, on every L4-F9 boundary pair', async () => {
    await rows(pairs, ([id, base]) => `${id} (${base})`, async ([id, base, ids]) => {
      const a = await sim(id);
      const b = await run(L3(base));
      const conv = Math.min(...a.players.filter((p) => p.handoff).map((p) => p.handoff!.t));
      const n = a.trace.filter((r) => r.t < conv - 1e-9).length;
      expect(n).toBeGreaterThan(5);
      expect(traceDiff(a.trace.slice(0, n), b.trace.slice(0, n), ids)).toEqual({ pos: 0, vel: 0, yaw: 0, ticks: 0 });
      for (const p of a.players.filter((x) => x.handoff)) {
        expect(p.handoff!.outcome, `${id} ${p.id}`).toBe('accepted');
        expect(p.fall).not.toBeNull();
        const q = b.players.find((x) => x.id === p.id)!;
        // the runs are identical only up to the first conversion: a later conversion at the same time in both (plan 14:
        // L4-F9-defenderRising D at 1.4125 s, after R's at 0.804 s) has a different state behind it
        if (q.handoff && Math.abs(p.handoff!.t - conv) < 1e-9 && Math.abs(q.handoff.t - p.handoff!.t) < 1e-9) expect(p.handoff!.audit).toEqual(q.handoff.audit);
      }
      b.dispose();
    });
  });
});

describe('L4-F10 official endings', () => {
  const ending = (s: Simulation): any => exp(s).ruleEnding;
  // the rule ending, every tick it is set
  const endings = watch(
    (id) => ['L4-F10-knee-on', 'L4-F10-wrap-on', 'L4-F10-palm-on'].includes(id),
    () => {
      const data: string[] = [];
      return {
        data,
        tick: (s) => {
          const e = s.rules?.ending;
          if (e) data.push(JSON.stringify(e));
        },
      };
    },
  );

  it('natural endings are eligible, a palm brace ends nothing, and the spot freezes at the event', async () => {
    await checks([
      [
        'natural endings fall in the eligible subset, knee and elbow included',
        async () => {
          expect(ending(await sim('L4-F10-knee-on')).evidence.region).toBe('knee');
          expect(ending(await sim('L4-F10-elbow-off')).evidence.region).toBe('elbow');
          for (const id of ['L4-F10-knee-off', 'L4-F10-elbow-on', 'L4-F10-wrap-on', 'L4-F10-wrap-off']) {
            const e = ending(await sim(id));
            expect(e.kind).toBe('groundDown');
            expect(['hand', 'wrist', 'foot', 'ankle', 'footSupport']).not.toContain(e.evidence.region);
          }
        },
      ],
      [
        'a palm brace ends nothing: the core contact does',
        async () => {
          const s = await sim('L4-F10-palm-on');
          const palm = evs(s, 'braceContact').find((e) => e.data.part === 'palm')!;
          const e = ending(s);
          expect(e.kind).toBe('runnerCoreDown');
          expect(e.t).toBeGreaterThan(palm.t);
        },
      ],
      [
        'the spot freezes at the event and the settle window changes nothing',
        async () => {
          for (const id of ['L4-F10-knee-on', 'L4-F10-wrap-on', 'L4-F10-palm-on']) {
            let first: string | null = null;
            for (const e of await endings(id)) {
              first ??= e;
              expect(e).toBe(first);
            }
            expect(first).not.toBeNull();
          }
        },
      ],
    ]);
  });
});

describe('L4-F11 settling, exhausted work, repeated disturbance', () => {
  it('effort ends and the body settles under the limits, repeated impacts cannot refill the work, and exhausted work stays exhausted', async () => {
    await checks([
      [
        'effort ends, the body settles, and the limits stay on',
        async () => {
          const s = await sim('L4-F11-settle');
          expect(report(s, 'R').done).toBe(true);
          expect(evs(s, 'fallResponseEnd').length).toBe(1);
          const b = bulkOf(Object.values(s.players[0].rag!.bodies));
          expect(b.ke).toBeLessThan(1);
          expect(s.result).toBe('duration');
          expect(s.players[0].rag!.envelope!.length).toBe(4);
        },
      ],
      [
        'repeated impacts cannot refill the work, and later ones meet only the limits',
        async () => {
          const quiet = await sim('L4-F11-settle');
          const s = await sim('L4-F11-disturbed');
          expect(report(s, 'R').lastEffortS).toBeLessThanOrEqual(1 + 1e-9);
          expect(report(s, 'R').positiveWorkJ).toBeLessThan(FALL_L4.power.maxPositiveWorkJ);
          expect(passive(s, 'R').neg).toBeGreaterThan(passive(quiet, 'R').neg);
          expect(evs(s, 'fallResponse').length).toBe(1);
        },
      ],
      [
        'exhausted work stays exhausted',
        async () => {
          const s = await sim('L4-F11-exhausted');
          const cap = FIX('L4-F11-exhausted').fallResponse!.power.maxPositiveWorkJ;
          const ex = evs(s, 'fallExhausted');
          expect(ex.length).toBe(1);
          expect(report(s, 'R').exhausted).toBe(true);
          expect(report(s, 'R').positiveWorkJ).toBeLessThanOrEqual(cap);
          // nothing at all after exhaustion: contact could turn even an absorbing command positive
          expect(s.fall!.ledger.filter((x) => x.owner === 'R' && x.t >= ex[0].t)).toEqual([]);
        },
      ],
    ]);
  });

  // the review regression: absorbing commands stayed on after exhaustion, and contact turned them positive (0.91 J with
  // no work allowed, 1.55 J with 1 J)
  it('a zero or small work cap holds through contact: no torque with none, never past the cap', async () => {
    const base = FIX('L4-F3-forward-on');
    // (plan 12: the uncapped fall does 18.6 J, the twin 20.0 J, so 20 J no longer binds; 15 J does)
    for (const cap of [0, 0.5, 1, 2, 5, 15]) {
      const def: FixtureDef = { ...base, id: `${base.id}-cap${cap}`, fallResponse: { ...base.fallResponse!, power: { ...base.fallResponse!.power, maxPositiveWorkJ: cap } } };
      const s = await run(def);
      const r = report(s, 'R');
      const mine = s.fall!.ledger.filter((x) => x.owner === 'R');
      expect(r.positiveWorkJ, `${cap} J`).toBeLessThanOrEqual(cap);
      expect(r.overPowerSubsteps, `${cap} J`).toBe(0);
      expect(r.exhausted, `${cap} J`).toBe(true);
      if (cap < 1) expect(mine, `${cap} J`).toEqual([]);
      else expect(r.positiveWorkJ, `${cap} J`).toBeGreaterThan(cap / 3);
      expect(evs(s, 'braceContact').length + evs(s, 'braceMiss').length, `${cap} J`).toBeGreaterThan(0);
      s.dispose();
    }
  });
});

describe('L4-F12 mirror and the protect arm', () => {
  it('a mirrored fall mirrors the decisions', async () => {
    const a = await sim('L4-F12-base');
    const b = await sim('L4-F12-mirror');
    expect(tasksOf(a, 'R')).toEqual({ left: 'brace', right: 'brace' });
    expect(tasksOf(b, 'R')).toEqual({ left: 'brace', right: 'brace' });
    // plan 12: inside the narrower shoulder range neither arm reaches the floor in time, in either fall (the twins' landing
    // arm, right in the base and left in the mirror, got there at 0.32-0.33 s). The mirrored arms miss together; the base's
    // left arm misses `late` and its mirror `tooFar`, a fall on the edge of the reach test. Ladder 8l: under the visible
    // flip's hip stops the landing arm reaches the floor again, its palm at 0.358 s in both falls, and the other arm misses
    // `tooFar` in both. So each mirrored pair is checked alike, landed or missed: the same part at the same time, or a
    // miss at the same time (the landing arm's for the same reason)
    const contacts = (s: Simulation, arm: string) => evs(s, 'braceContact').filter((e) => e.data.arm === arm);
    const miss = (s: Simulation, arm: string) => evs(s, 'braceMiss').find((e) => e.data.arm === arm);
    for (const [x, y] of [['right', 'left'], ['left', 'right']]) {
      const [cx, cy] = [contacts(a, x), contacts(b, y)];
      expect(cx.map((e) => e.data.part), `base ${x}, mirror ${y}`).toEqual(cy.map((e) => e.data.part));
      for (const [i, e] of cx.entries()) expect(Math.abs(e.t - cy[i].t), `base ${x}, mirror ${y}`).toBeLessThan(0.03);
      const [mx, my] = [miss(a, x), miss(b, y)];
      expect(!!mx, `base ${x}, mirror ${y}: missed`).toBe(!!my);
      if (mx && my) expect(Math.abs(mx.t - my.t), `base ${x}, mirror ${y}`).toBeLessThan(0.03);
    }
    expect(contacts(a, 'right').length + (miss(a, 'right') ? 1 : 0)).toBeGreaterThan(0);
    expect(miss(a, 'right')?.data.reason).toBe(miss(b, 'left')?.data.reason);
    expect(Math.abs(report(a, 'R').positiveWorkJ - report(b, 'R').positiveWorkJ)).toBeLessThan(8);
  });

  // plan 10c C2 (U5): the protect arm was the profile's declared carry arm, so L4-F12-carryLeft protected the empty left
  // arm while the ball arm braced. It is the arm the ball is on now, and a declaration that disagrees fails.
  it('the protect arm is the arm the ball is on, and a profile that declares another carry arm fails at the conversion', async () => {
    await checks([
      [
        'the protect arm is the arm the ball is on',
        async () => {
          let seats = 0;
          for (const d of ALL.filter((x) => x.fallResponse)) {
            const s = await sim(d.id);
            for (const p of s.players.filter((x) => x.fall)) {
              const seg = p.rag!.landmarks.carriedBall?.seg;
              if (seg) seats++;
              const ball = seg ? (seg.startsWith('left') ? 'left' : 'right') : p.setup.role === 'runner' ? CARRY_ARM : null;
              const tasks = tasksOf(s, p.id);
              // (L4-F2 runs the legs only: no arm takes a task)
              expect(Object.keys(tasks).filter((k) => tasks[k] === 'protect'), `${d.id} ${p.id}`).toEqual(ball && d.fallResponse!.enable.arms ? [ball] : []);
            }
          }
          expect(seats).toBeGreaterThan(5);
          expect(ALL.some((d) => d.id === 'L4-F12-carryLeft')).toBe(false);
        },
      ],
      [
        'a profile whose declared carry arm the ball is not on fails at the conversion',
        async () => {
          const d = FIX('L4-F3-oblique-on');
          const left: FixtureDef = { ...d, fallResponse: { ...d.fallResponse!, id: 'x-leftCarry', arms: { ...d.fallResponse!.arms, carryArm: 'left' } } };
          await expect(run(left)).rejects.toThrow(/declared carry arm left, but R carries the ball on the right arm/);
        },
      ],
    ]);
  });
});

describe('L4-F12 mirror, rates and resets', () => {
  const fingerprint = (s: Simulation): string => JSON.stringify({ t: s.trace, e: s.events, l: s.fall?.ledger, f: exp(s).fallEffort, j: exp(s).jointLimits });

  it('same policy and effort over render rates and pause', async () => {
    const def = FIX('L4-F9-contact');
    const ref = await run(def);
    const want = fingerprint(ref);
    ref.dispose();
    for (const [hz, pauseEvery] of [
      [30, 0],
      [144, 0],
      [240, 7],
    ]) {
      const s = await Simulation.create(def);
      const drv = new FixedStepDriver(def.solver.outerTickS, 8);
      let frame = 0;
      while (!s.done) {
        drv.paused = pauseEvery > 0 && frame % pauseEvery === 3;
        frame++;
        for (let i = drv.frame(1 / hz); i > 0 && !s.done; i--) {
          s.stepTick();
          await pace();
        }
      }
      expect(fingerprint(s), `${hz} Hz`).toBe(want);
      s.dispose();
      await breathe();
    }
  });

  it('20 resets: the same run, nothing stale, no growing counts', async () => {
    // plan 10c (C8): reset() builds a new FallResponse and ArmSystem, so their state straight after it proves nothing.
    // Each cycle is compared at the same tick in the fall (counts and a hash of the trace so far) and at the end.
    const def = FIX('L4-F11-exhausted');
    const s = await Simulation.create(def);
    const state = (sim: Simulation): string =>
      JSON.stringify({
        tick: sim.tick,
        episodes: sim.fall?.episodes.size,
        ledger: sim.fall?.ledger.length,
        forces: sim.arms?.ledger.length,
        effort: sim.arms?.effortLedger.length,
        events: sim.events.length,
        trace: createHash('sha256').update(JSON.stringify(sim.trace)).digest('hex'),
      });
    await stepWhile(s, () => !s.fall?.episodes.size);
    const mid = s.tick + 20;
    await stepWhile(s, () => s.tick < mid);
    expect(s.fall!.episodes.size).toBeGreaterThan(0);
    expect(s.fall!.ledger.length).toBeGreaterThan(0);
    const wantMid = state(s);
    await runSim(s);
    const want = fingerprint(s);
    const bodies = s.physics.world.bodies.len();
    const joints = s.physics.world.impulseJoints.len();
    for (let i = 0; i < 20; i++) {
      s.reset();
      await stepWhile(s, () => s.tick < mid);
      expect(state(s), `cycle ${i}`).toBe(wantMid);
      await runSim(s);
      expect(fingerprint(s)).toBe(want);
      expect(s.physics.world.bodies.len()).toBe(bodies);
      expect(s.physics.world.impulseJoints.len()).toBe(joints);
      await breathe();
    }
    s.dispose();
  });
});

// plan 10c C3 (U6): ragdoll grounding took any collider with the floor region, obstacles included, while the fall
// response and the rules took the floor only. All three now share isGround: the floor only.
describe('ground is the floor only', () => {
  it('the floor alone is ground, so a fall onto a raised deck is never grounded and its brace never lands', async () => {
    await checks([
      [
        'the predicate: the floor, not an obstacle (which carries the floor region) or a player',
        () => {
          expect(isGround({ playerId: null, part: 'floor', region: 'floor', key: 'floor' })).toBe(true);
          expect(isGround({ playerId: null, part: 'floor', region: 'floor', key: 'obstacle:box' })).toBe(false);
          expect(isGround({ playerId: 'R', part: 'core', region: 'torso', key: 'torso' } as never)).toBe(false);
        },
      ],
      [
        'a fall onto a raised deck touches the obstacle only: never grounded, no brace contact; the brace is missed at the window\'s end, obstructed by the deck',
        async () => {
          const base = FIX('L4-F3-forward-on');
          // (plan 12: 4 m; inside the shoulder range the fall carries the palm past a 2 m edge, onto the floor at 0.97 s)
          const deck: FixtureDef = { ...base, id: 'T-deck', obstacles: [{ id: 'deck', center: v3(0, 0.05, 0), halfExtents: v3(4, 0.05, 4) }] };
          // the last substep a seeking brace's forearm or palm pressed on the deck, per arm (plan 10c C4: an obstacle
          // obstructs, the floor grounds)
          const pressed = new Map<string, number>();
          const onSubstep = (x: Simulation) => {
            for (const p of x.players)
              for (const c of x.contacts) {
                if (c.impulse <= 0) continue;
                for (const [own, o] of [[c.a, c.b], [c.b, c.a]] as const) {
                  if (own.playerId !== p.id || !own.side || (own.region !== 'palm' && own.region !== 'forearm') || o.key !== 'obstacle:deck') continue;
                  const a = p.fall?.arms[own.side];
                  if (a?.task === 'brace' && a.brace === 'seek') pressed.set(own.side, x.t);
                }
              }
          };
          const s = await Simulation.create(deck, { trace: false, onSubstep });
          let onDeck = 0;
          while (!s.done) {
            s.stepTick();
            await pace();
            const R = s.players[0];
            if (!R.rag) continue;
            const touched = s.contacts.filter((c) => c.a.playerId === R.id || c.b.playerId === R.id).map((c) => (c.a.playerId === R.id ? c.b : c.a));
            if (touched.some((t) => t.key === 'obstacle:deck')) onDeck++;
            expect(touched.some((t) => t.key === 'floor')).toBe(false);
            expect(R.grounded, `${s.t}`).toBe(false);
          }
          expect(onDeck).toBeGreaterThan(100);
          expect(evs(s, 'grounded').filter((e) => e.data.representation === 'ragdoll')).toEqual([]);
          expect(evs(s, 'braceContact')).toEqual([]);
          // (ladder 9e: `expired` before, the end-of-window path not reading the obstruction; the left forearm presses on
          // the deck in the substep the window ends)
          const end = evs(s, 'fallResponseEnd');
          const miss = evs(s, 'braceMiss');
          expect(miss.map((e) => [e.t, e.data.reason]), 'one miss, at the window\'s end').toEqual([[end[0].t, 'obstructed']]);
          expect(miss[0].t - pressed.get(miss[0].data.arm as ArmSide)!).toBeLessThanOrEqual(FALL_L4.brace.horizonS[0] + 1e-9);
          s.dispose();
        },
      ],
    ]);
  });
});
