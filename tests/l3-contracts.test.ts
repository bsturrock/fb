// Plan 13b: the L3 contract pass. Every L3 fixture runs once, with the transition audit on (it reads copies: "the audit
// reads copies" below) and every check that reads it attached: per-fixture contracts (plan 08, 10b, 12) and the named
// cases that read a plain run of a registered L3 fixture. The checks are in tests/l3-pass.ts; the pass is split over
// shard processes (tests/l3-shard.ts), each asking for the next fixture, so the slowest file of the suite is not one
// worker's serial run. One test per contract over every fixture it covers, failing with the whole list: each failing
// fixture with its first failed assertion, or every breach where the check collects them. Replaces transitions-audit,
// foot-continuity, transitions-feet and the per-fixture parts of transitions-modes and transitions-contact. Negative
// controls and cases that need their own runs stay their own tests (here for the audit, continuity and contact
// retention; tests/transitions.test.ts for modes, the walking ramp and the lifecycle).
//
// L3_CONTRACTS=<regex> narrows the pass to the matching fixtures (to iterate on one): every test name then says so, a
// test whose checks cover none of them is skipped, and the assertions over several fixtures together are not made.
// L3_SHARDS=<n> sets the number of shard processes (default: half the cores, at most 4; on the 8-core M2, with the
// suite at 950 s of CPU, four shards gave the shortest suite, 141 s, against 153-155 s with two, where this file's own
// tests waited for a pass that ended at 100 s, and 145 s with six); 0 runs the pass in this process (to debug a check).
import { fork, type ChildProcess } from 'node:child_process';
import { availableParallelism, setPriority } from 'node:os';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SimOptions, TransitionDelta } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { FOOTWORK_L2, FOOTWORK_L3, initFeet, newFootPlan, observeFeet, planFeet, stepAccelLimits, withHoldStill, type FootEvent, type FootPlan, type FootPlanInput } from '../src/sim/footwork';
import type { ArmSide } from '../src/sim/contracts';
import type { FootDebug } from '../src/sim/debug';
import { CONT_L3_RADPS, type FootRequest, type PhysicalPose } from '../src/sim/pose';
import { add, dist, norm, v3, type Vec3 } from '../src/sim/vec';
import { LEG_GUARD_V1, LEG_GUARD_V2, LEG_GUARD_V3 } from '../src/sim/profiles';
import { breathe, FIX, preFlip, preV3, rows, run, runSim } from './helpers';
import { loadState, resumeState } from './state';
import { L3 } from './transitions-shared';
import {
  ANCHORS,
  ARM_SWING,
  AUDIT,
  AUDITED_FALL,
  BAD_CANDIDATE,
  BRAKE,
  C,
  CHECKS,
  CLAMPS,
  CARRY_AUDIT,
  CARRY_BOUNDARIES,
  CLEARS,
  CONT,
  CONTINUITY,
  continuity,
  type Continuity,
  type ContinuitySeen,
  COPIED,
  COPIES,
  COPY_IDS,
  covers,
  DEFENDER_13F,
  DEFENDER_BOB,
  FEET,
  FIRST,
  FITTED,
  IDLE_PLANTS,
  IDLE_WEIGHT,
  type FixturePass,
  FOLLOWS_CONTACT,
  FOOT_LIMITS,
  FREE_ARMS,
  FRESH_PLANT,
  HANDOVER,
  HELD_LEG,
  HOLD_CLEARANCE_REPLANT,
  HOLD_SETTLES,
  KEEP_STEPPING,
  LANDINGS,
  LEG_IN_RAGDOLL,
  LIFT,
  LIFT_RECOVERY,
  mergeRecords,
  NO_LAUNCH,
  noneSeen,
  NOT_TWICE,
  OFF_GROUND,
  ONE_BALL,
  ONE_BALL_SEEN,
  ONE_FOOT,
  PALM_HOLDS,
  passFixture,
  PLAYER_BELOW,
  PREP_UNWINDS,
  RAW_KEPT,
  REACH_AT,
  RECONTACT,
  type Records,
  RESEED,
  RESEED_SAMPLE,
  reseedCovered,
  RETAINED,
  RETENTION_BITES,
  RULE_FIXTURES,
  RULE_REF,
  RULE_REF_SPOT,
  FULL_STRIDE,
  RUN_START,
  runWatched,
  SEAM,
  SEAMS,
  seen,
  SETTLE_PLANTS,
  SETTLES,
  STANDS_STILL,
  STEP_AS_IS,
  stepAsIsCovered,
  STOP_MOTOR,
  TOE_OFF,
  unseenKinds,
  WALK_STEPS,
  WALK_VALID,
  type Watch,
} from './l3-pass';

// ---------------------------------------------------------------------------------------------------------------------
// The pass

const FILTER = process.env.L3_CONTRACTS ? new RegExp(process.env.L3_CONTRACTS) : null;
const NOTE = FILTER ? ` (narrowed: L3_CONTRACTS=${process.env.L3_CONTRACTS})` : '';
const PASS = L3(/^L3-/).filter((d) => !FILTER || FILTER.test(d.id));
const SHARDS = Math.min(PASS.length, process.env.L3_SHARDS !== undefined ? Number(process.env.L3_SHARDS) : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))));
const results = new Map<string, { fixtures: string[]; failures: string[] }>();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
/** What a shard sends (tests/l3-shard.ts). */
type FromShard = { ready: true } | { id: string; pass: FixturePass } | { records: Records } | { id: string | null; error: string };

/**
 * Runs the pass's fixtures over `n` shard processes: each is handed the next fixture as it finishes one (the longest
 * first), so the shards end together. Merges the shards' records into this process's. A shard that fails or exits
 * early fails the pass with what it said.
 */
async function sharded(jobs: FixtureDef[], n: number, done: (id: string, p: FixturePass) => void): Promise<void> {
  let next = 0;
  const kids: ChildProcess[] = [];
  const one = (k: number): Promise<void> =>
    new Promise((resolve, reject) => {
      const kid = fork(`${ROOT}node_modules/vite-node/vite-node.mjs`, [`${ROOT}tests/l3-shard.ts`], { cwd: ROOT, serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      kids.push(kid);
      // below the test workers: the shards fill the cores the files that run in one worker leave idle, instead of slowing
      // them (the pass has the slack: its work is split, theirs is not). Scheduling only, never a result
      try {
        setPriority(kid.pid!, 10);
      } catch {
        // not permitted here: the shards run at the workers' priority
      }
      let said = '';
      const keep = (b: Buffer): void => void (said = (said + b.toString()).slice(-4000));
      kid.stdout!.on('data', keep);
      kid.stderr!.on('data', keep);
      let current: string | null = null;
      let ended = false;
      const give = (): void => {
        current = next < jobs.length ? jobs[next++]!.id : null;
        kid.send(current ? { id: current } : { end: true });
      };
      kid.on('message', (m: FromShard) => {
        if ('error' in m) {
          ended = true;
          reject(new Error(`L3 pass shard ${k}: ${m.id ?? ''}: ${m.error}`));
        } else if ('records' in m) {
          ended = true;
          mergeRecords(m.records);
          resolve();
        } else {
          if ('pass' in m) done(m.id, m.pass);
          give();
        }
      });
      kid.on('error', reject);
      kid.on('exit', (code, signal) => {
        if (!ended) reject(new Error(`L3 pass shard ${k} exited (${code ?? signal}) running ${current ?? 'nothing'}:\n${said}`));
      });
    });
  try {
    await Promise.all(Array.from({ length: n }, (_, k) => one(k)));
  } finally {
    for (const kid of kids) if (kid.exitCode === null) kid.kill();
  }
}

beforeAll(async () => {
  const byId = new Map<string, FixturePass>();
  if (SHARDS > 0) {
    // the longest runs first: run time, players, and the copy comparison's second run
    const cost = (d: FixtureDef): number => d.durationS * d.players.length * (COPY_IDS.includes(d.id) ? 2 : 1);
    await sharded([...PASS].sort((a, b) => cost(b) - cost(a)), SHARDS, (id, p) => byId.set(id, p));
  } else
    for (const d of PASS) {
      byId.set(d.id, await passFixture(d));
      await breathe();
    }
  // in the pass's own order, whatever order the shards finished in
  for (const c of CHECKS) results.set(c.name, { fixtures: [], failures: [] });
  for (const d of PASS) {
    const p = byId.get(d.id);
    if (!p) throw new Error(`the pass did not run ${d.id}`);
    for (const name of p.covered) results.get(name)!.fixtures.push(d.id);
    for (const [name, m] of p.failures) results.get(name)!.failures.push(m);
  }
}, 900000);

/** One run of `def` with one watch, outside the pass (negative controls): fails with what the watch reported. */
async function runOne(def: FixtureDef, w: Watch, opts: SimOptions = {}): Promise<void> {
  const fails: string[] = [];
  await runWatched(def, [{ w, fail: (m) => fails.push(m) }], opts);
  expect(fails).toEqual([]);
}

/**
 * One test over the named checks: every failure on every fixture they cover, prefixed with the check's name. A check
 * given a list of fixtures must have covered exactly that list. `then` holds the assertions over several fixtures
 * together (skipped when the pass is narrowed).
 */
function passTest(title: string, names: string[], then?: () => void | Promise<void>): void {
  const cs = names.map((n) => {
    const c = CHECKS.find((x) => x.name === n);
    if (!c) throw new Error(`no check ${n}`);
    return c;
  });
  const any = cs.some((c) => PASS.some((d) => covers(c, d.id)));
  it.skipIf(!any)(`${title}${NOTE}`, async () => {
    const out: string[] = [];
    for (const c of cs) {
      const r = results.get(c.name)!;
      if (!FILTER) {
        expect(r.fixtures.length, `${c.name}: covers no fixture`).toBeGreaterThan(0);
        if (!(c.fixtures instanceof RegExp)) expect([...r.fixtures].sort(), `${c.name}: fixtures`).toEqual([...c.fixtures].sort());
      }
      out.push(...r.failures.map((f) => `${c.name}: ${f}`));
    }
    // the list goes into the message: reporters that print no diff (the JSON report) still show every failure
    expect(out, `${out.length} failures:\n${out.join('\n')}\n`).toEqual([]);
    if (then && !FILTER) await then();
  });
}

describe('plan 08 transition audit', () => {
  passTest('transition-only pose discontinuity at most 1 cm at every ownership change, all landmarks, same solved time; every reseed is a boundary: every L3 fixture', [AUDIT]);

  it(`the audit reads copies: the same run with and without it is identical, every trace row and every substep's planner, sampler and pose state${NOTE}`, async () => {
    // the audited side of each comparison is the pass's run of the fixture, the unaudited side runs right after it in the
    // same process (tests/l3-pass.ts compareCopy: every trace row, the events and every substep's state)
    expect(FIRST.size).toBeGreaterThanOrEqual(16);
    expect(results.get(COPIES)!.failures).toEqual([]);
    await rows(
      COPY_IDS.filter((id) => !FILTER || FILTER.test(id)),
      (id) => id,
      (id) => {
        expect(COPIED.has(id), `${id}: not compared`).toBe(true);
        const fail = COPIED.get(id);
        if (fail) throw new Error(fail);
      },
    );
  }, 300000);

  passTest(
    'the boundary records: a reseed that keeps mode and source is a boundary; a landing is compared with its old path as it is; the raw difference and what was set aside are kept; a jump the offset took up is not corrected twice',
    [RAW_KEPT, NOT_TWICE, LANDINGS],
  );

  it('the boundary records, natural sample: a reseed that keeps mode and source is a boundary (L3-F7-phase75, the planted pose off)', async () => {
    // ladder rung 7d: R's right foot released by clearance and planted again in the next substep (tests/l3-pass.ts
    // RESEED_SAMPLE). Under the swept leg guard the planted pose holds that plant and the run has no reseed, so the sample
    // runs with `noPlantedPole` (the same run under V1)
    const def = FIX('L3-F7-phase75');
    const fails: string[] = [];
    const rep = (m: string): void => void fails.push(m);
    await runWatched(def, [{ w: RESEED_SAMPLE.watch(def, rep), fail: rep }], { transitionAudit: true, debug: { pose: { noPlantedPole: true } } });
    expect(fails).toEqual([]);
  }, 60000);

  it('the boundary records, controlled: a reseed that keeps mode and source is a boundary; a step that loses support is compared with its old path as it is', async () => {
    // the same two records on situations the test makes where its run shows them (tests/l3-pass.ts reseedCovered,
    // stepAsIsCovered): a plant mid-stance released by its solve, a step mid-swing over a strip the probe finds no support
    // on. Each passes with its drive and fails without it (no reseed, no support loss: the record is not made)
    await rows(
      [
        [RESEED, reseedCovered, () => reseedCovered({ release: false }), [/: released at /, /reseeded in the next substep/]],
        [STEP_AS_IS, stepAsIsCovered, () => stepAsIsCovered({ strip: false }), [/no supported-to-airborne boundary/]],
      ] as const,
      ([n]) => n,
      async ([, f, off, why]) => {
        const fails = await f();
        expect(fails, fails.join('\n')).toEqual([]);
        const undriven = await off();
        for (const w of why) expect(undriven.some((m) => w.test(m)), `${w} in ${undriven.join('\n')}`).toBe(true);
      },
    );
  }, 120000);

  passTest(
    "the planner's handovers: a held leg handed to a step keeps the old owner's request, a support loss keeps a step on its path; a request seam goes into the offset; a fresh plant is not stepped from the moment it lands",
    [HELD_LEG, SEAM, FRESH_PLANT],
    () => {
      expect(HANDOVER.carried).toBeGreaterThan(0);
      expect(HANDOVER.kept).toBeGreaterThan(0);
      expect(HANDOVER.airborne).toBeGreaterThan(0);
      expect(HANDOVER.overdue).toBeGreaterThan(0);
      expect(SEAMS.n).toBeGreaterThan(0);
    },
  );

  it('negative control: a known old/new pose difference over 1 cm still fails (the 10b crossing heading fault put back)', async () => {
    // L3-F7-loadRelease with the composed crossing setting a following foot's heading to the body's, as before 10b: D's
    // left knee pole turns 19 degrees in one substep at contact entry and the leg takes another clearance variant, while
    // the old owner keeps its heading. The audit has to report that boundary, with nothing set aside. (The plan 08 control,
    // the handover check switched off in L3-F7-phase25, no longer gives one: with 10b's bounded step paths no handover in
    // L3 departs by over 1 cm without it.) Plan 12: run without the joint-range profile; with it, D's run into the contact
    // changes and the faulted crossing there stays under 1 cm. Ladder rung 7d: with the planted pose off
    // (`noPlantedPole`): under the swept leg guard (V2, V3) the knee-pole plant holds D's left leg there and the faulted
    // crossing takes no clearance variant (no change under V1, which has no planted pose)
    const sim = await run({ ...FIX('L3-F7-loadRelease'), jointRange: undefined }, { transitionAudit: true, debug: { foot: { crossingBodyHeading: true }, pose: { noPlantedPole: true } } });
    const ds = sim.transitionDeltas;
    sim.dispose();
    const x = ds.filter((b) => b.deltaM > 0.01);
    expect(x.map((b) => `${b.playerId} ${b.t.toFixed(4)} ${b.landmark}`)).toEqual(['D 0.5750 leftAnkle']);
    for (const b of x) expect(b.deltaM).toBeCloseTo(b.rawM, 10);
  }, 30000);

  it('negative control: a known old/new pose difference over 1 cm still fails (a new foot owner shown off its path)', async () => {
    // the audit check itself (AUDIT), on the free 6.6 m/s run of one player (L3-F16-sprint): passes as it is, and with every
    // composed leg whose foot owner changed starting its continuity step 3 cm off the shown path (PoseDebug.ownerChangeJumpM)
    // it reports each such boundary over 1 cm, the old owner's continuation kept as it was. Unlike the 10b crossing fault
    // above, it does not depend on a contact run reaching a particular crossing: every ownership change of the run carries it
    const def = FIX('L3-F16-sprint');
    const audited = async (debug?: SimOptions['debug']) => {
      const c = CHECKS.find((x) => x.name === AUDIT)!;
      const fails: string[] = [];
      let ds: TransitionDelta[] = [];
      const rep = (m: string): void => void fails.push(m);
      await runWatched(def, [{ w: c.watch(def, rep), fail: rep }, { w: { finish: (s) => void (ds = s.transitionDeltas) }, fail: rep }], { transitionAudit: true, ...(debug ? { debug } : {}) });
      return { fails, ds };
    };
    const ok = await audited();
    expect(ok.fails).toEqual([]);
    expect(ok.ds.filter((b) => b.deltaM > 0.01)).toEqual([]);
    const bad = await audited({ pose: { ownerChangeJumpM: 0.03 } });
    const x = bad.ds.filter((b) => b.deltaM > 0.01);
    expect(x.length).toBeGreaterThan(0);
    // every one is an ownership change the audit fails on its 1 cm limit, and nothing else fails: one failure per such
    // boundary, each naming that boundary's time, player, landmark and owners
    for (const b of x) expect(b.from).not.toBe(b.to);
    const named = (b: TransitionDelta): string => `L3-F16-sprint ${b.t.toFixed(4)} ${b.playerId} ${b.landmark} ${b.from} > ${b.to} raw ${b.rawM.toFixed(4)}: `;
    expect(bad.fails.map((m) => m.slice(0, m.indexOf(': ') + 2)).sort()).toEqual(x.map(named).sort());
    for (const m of bad.fails) expect(m).toMatch(/: expected 0\.0\d+ to be less than or equal to 0\.01$/);
    // nothing set aside: every boundary over 1 cm raw is still over 1 cm after the correction; and a boundary whose
    // reference took no request jump out (transition-audit.ts sets requestJumpM exactly where it moves a reference foot's
    // offset) is compared as it is, its measure exactly the raw difference
    expect(bad.ds.filter((b) => b.rawM > 0.01 && b.deltaM <= 0.01)).toEqual([]);
    for (const run of [ok, bad]) {
      const plain = run.ds.filter((b) => b.requestJumpM.left === 0 && b.requestJumpM.right === 0);
      expect(plain.length).toBeGreaterThan(0);
      for (const b of plain) expect(b.deltaM, `${b.t.toFixed(4)} ${b.landmark}`).toBe(b.rawM);
    }
    expect(x.filter((b) => b.requestJumpM.left === 0 && b.requestJumpM.right === 0).length).toBeGreaterThan(0);
  }, 60000);
});

describe('plan 10b foot target continuity', () => {
  it('the step acceleration limits are declared from the swing limits, not measured', () => {
    // a minimum-jerk path peaks at 80 / (15 sqrt 3) = 3.079 x its peak speed / its time: the speed cap over the shortest
    // step, and the lift cap over half of it
    const k = 80 / (15 * Math.sqrt(3));
    expect(stepAccelLimits(FOOTWORK_L2.swing)).toEqual({ stepAccelMps2: (k * 3.5) / 0.2, stepAccelPerTravel: (k * 2.5) / 0.2, liftAccelMps2: (k * 1.5) / 0.1 });
    expect(C.stepAccelMps2).toBeCloseTo(53.89, 2);
    expect(C.stepAccelPerTravel).toBeCloseTo(38.49, 2);
    expect(C.liftAccelMps2).toBeCloseTo(46.19, 2);
    expect(FOOTWORK_L3.id).toBe('footwork-l3-v4');
    expect(FOOTWORK_L2.compose).toBeUndefined();
  });

  passTest(
    'step targets within the acceleration limit, stored vertical motion as published, chases within the lift acceleration, no jump in the clip leg request: every L3 fixture; the checks saw every kind of substep they bound',
    [CONTINUITY],
    () => {
      // ladder 14a: the step bounds (B1, B2) saw every kind of planner step outside a stationary hold (tests/l3-pass.ts
      // STEP_KINDS): voluntary steps, reach steps, liftoff steps and clip swings continued at the crossing. This replaced a
      // floor of 30,000 B1 and B2 substeps over the pass, which a stationary hold's voluntary steps (2,783 of 31,223 B1
      // substeps) held up and the still-hold flip took away by its definition; outside stationary holds the pass has 28,440
      // with and without the flip, and the fault below removes a kind (the next test)
      expect(unseenKinds(seen)).toEqual([]);
      expect(seen.chaseStarts).toBeGreaterThan(5);
      expect(seen.chaseInside).toBeGreaterThan(100);
      expect(seen.requests).toBeGreaterThan(30000);
    },
  );

  it('the step coverage, controlled: two runs together check every kind of step outside a stationary hold, and with no voluntary step anywhere (the fault) not the voluntary kind; a stationary hold neither counts for it nor against it (L3-F6-hold with the still-hold rule and without it)', async () => {
    // ladder 14a: the coverage rule of the test above on runs the test makes. L3-F16-kick (a run stop: voluntary, reach and
    // continued steps) and L3-F10-defender (liftoff and continued) together see every kind; FootDebug.noVoluntarySteps
    // takes the voluntary kind away and nothing else
    const record = async (ids: string[], opts: SimOptions = {}, def: (d: FixtureDef) => FixtureDef = (d) => d): Promise<ContinuitySeen> => {
      const s = noneSeen();
      for (const id of ids) await runOne(def(FIX(id)), continuity(def(FIX(id)), s).watch, { transitionAudit: true, ...opts });
      return s;
    };
    const pair = ['L3-F16-kick', 'L3-F10-defender'];
    const ok = await record(pair);
    expect(unseenKinds(ok)).toEqual([]);
    expect(unseenKinds(await record(pair, { debug: { foot: { noVoluntarySteps: true } } }))).toEqual(['B1 voluntary', 'B2 voluntary']);
    // the hold: registered, the defender steps in it (counted as held, for no kind); with the rule it does not, and every
    // kind's count is the same
    const off = await record(['L3-F6-hold']);
    const on = await record(['L3-F6-hold'], {}, (d) => ({ ...d, footwork: withHoldStill(d.footwork!) }));
    expect(off.held).toBeGreaterThan(on.held);
    const kinds = (s: ContinuitySeen) => Object.fromEntries(Object.entries(s).filter(([k]) => /^b[12]/.test(k)));
    expect(kinds(on)).toEqual(kinds(off));
    expect(off.b1Voluntary).toBeGreaterThan(0);
  }, 120000);

  it(`the continuity records: a step out of time while moving slows within its limit; a continued step is given the time its acceleration limit needs${NOTE}`, async () => {
    const of = async (id: string): Promise<Continuity> => {
      const kept = CONT.get(id);
      if (kept) return kept;
      const c = continuity(FIX(id), noneSeen());
      await runOne(FIX(id), c.watch, { transitionAudit: true });
      return c.out;
    };
    const ids = allFixtures()
      .filter((x) => /^L3-F1[67]-(runStop|stop\d|reaccel|runStart)/.test(x.id))
      .map((x) => x.id);
    const records: [string, () => Promise<void>][] = [
      [
        'reproductions: a step out of time while moving slows within its limit, it does not stop at its destination in one substep',
        async () => {
          // before 10b: L3-F3-side D left 0.0583 s went from 20.51 m/s to 0 in one substep (8.55 cm second difference), and the
          // same at R 0.2708 s, D left 0.3333 s and L3-F1-phase0 0.6708 s. Those runs have changed with the fix; each fixture
          // still has steps running out of time at speed
          // plan 13d: L3-F1-phase0 has none now; L3-F1-phase1 D left 0.721 s slows from 11.0 to 10.5 m/s within its limit.
          // Plan 13e: L3-F3-side has none at speed now (it plays the supplied clips); L3-F3-recover has two (below)
          for (const id of ['L3-F3-recover', 'L3-F1-phase1']) {
            const { outOfTime } = await of(id);
            const moving = outOfTime.filter((x) => x.speed > 1);
            expect(moving.length, id).toBeGreaterThan(0);
            for (const x of moving) {
              expect(x.next, `${id} ${x.at} ${x.t.toFixed(4)}`).toBeGreaterThan(0);
              expect(x.speed - x.next, `${id} ${x.at} ${x.t.toFixed(4)}`).toBeLessThanOrEqual(x.aMax * (1 / 240) + 1e-9);
            }
            if (id === 'L3-F3-recover') {
              // plan 13e: R's left foot runs out of time near 0.838 s at 1.47 m/s and is still moving after it (1.16 m/s);
              // D's left near 1.413 s at 9.19 m/s
              const first = moving.find((x) => x.at === 'R:left' && Math.abs(x.t - 0.8375) < 0.01);
              expect(first, 'R left out of time near 0.838 s').toBeDefined();
              expect(first!.speed).toBeGreaterThan(1);
              expect(first!.next).toBeGreaterThan(1);
              expect(moving.some((x) => x.at === 'D:left' && x.speed > 9), 'D left out of time at over 9 m/s').toBe(true);
            }
          }
        },
      ],
      [
        'a continued step is given the time its acceleration limit needs: on a free stop or start it lands on time',
        async () => {
          // without the acceleration term in its timing a continued step was timed shorter than its path can keep (L3-F16-stop1.7
          // left 2.258 s: 0.70 m in 0.105 s, about 3 x the limit) and ran past its time: 3 to 13 substeps on these runs. With it
          // the most measured is 2 (L3-F16-stop2.9 R right 3.575 s), where the destination moved on after the step was timed
          expect(ids.length).toBe(16);
          for (const id of ids) {
            const { overdue } = await of(id);
            const worst = overdue.reduce((a, x) => (x.n > a.n ? x : a), { at: '-', n: 0 });
            expect(worst.n, `${worst.at} overdue ${worst.n} substeps`).toBeLessThanOrEqual(2);
          }
        },
      ],
    ];
    await rows(records, ([n]) => n, ([, f]) => f());
  }, 120000);

  it('B3 fault put back: with the clip heading snapping to the travel direction, the leg request jumps at contact', async () => {
    // before 10b the sampled clip's heading took the travel direction in one substep, so a collision that turned the
    // travel turned the leg request with it: up to 4.45 cm in L3-F8-recontact (D2 left 0.829 s), 116 substeps over 1 cm
    // across L3. The heading now follows at the planner's follow rate (run-clips headingRadPerS)
    const d = FIX('L3-F8-recontact');
    expect(d.runClips?.headingRadPerS).toBe(18);
    const fresh = noneSeen;
    let now = CONT.get(d.id);
    if (!now) {
      const c = continuity(d, fresh());
      await runOne(d, c.watch, { transitionAudit: true });
      now = c.out;
    }
    expect(now.requestDD).toEqual([]);
    const snapDef = { ...d, runClips: { ...d.runClips!, headingRadPerS: undefined } };
    const snap = continuity(snapDef, fresh());
    await runOne(snapDef, snap.watch, { transitionAudit: true });
    expect(Math.max(...snap.out.requestDD.map((r) => r.d))).toBeGreaterThan(0.03);
  }, 60000);
});

describe('plan 08 foot limits at every actual substep', () => {
  passTest(
    'vertical target and offset recovery stay inside their limits, measured inside the planner and from outside: every L3 fixture; a carried handover is under the bound from its first update; the reported overruns reach the limits',
    [FOOT_LIMITS],
    () => {
      const records: [string, () => void][] = [
        [
          'a carried handover is under the bound from its first update, and the planner records that update',
          () => {
            // the follow path these legs came off was going down at 3.25 m/s (phase3) and 2.85 m/s (phase0) when a step took them over
            // (plan 13d: L3-F1-low's D carries none now; L3-F1-phase6's D left does, at 0.479 s)
            for (const id of ['L3-F1-phase3', 'L3-F1-phase0', 'L3-F1-phase6']) {
              const { seen } = FEET.get(id)!;
              expect(seen.nCarried, id).toBeGreaterThan(0);
              expect(seen.lift, id).toBeGreaterThan(0.9 * LIFT);
              expect(seen.lift, id).toBeLessThanOrEqual(LIFT + 1e-6);
            }
          },
        ],
        [
          'the reported overruns run again: the limits are reached there, not avoided',
          () => {
            for (const id of ['L3-F16-runStop', 'L3-F14-walkRunStop', 'L3-F7-phase0']) {
              const { seen, c } = FEET.get(id)!;
              expect(seen.nLift, id).toBeGreaterThan(100);
              expect(seen.nOffset, id).toBeGreaterThan(100);
              expect(seen.ownerChanges, id).toBeGreaterThan(4);
              expect(Math.max(c.lift, seen.lift), id).toBeGreaterThan(0.9 * LIFT);
            }
          },
        ],
      ];
      return rows(records, ([n]) => n, ([, f]) => f());
    },
  );
});

describe('plan 08 pass 1: start, brake, settle', () => {
  passTest('no stance is skipped: outside contact a moving player is never long off the ground: every L3-F16 run and stop, every L3-F7 fixture', [OFF_GROUND]);
  passTest('brake phases, the comparison stop and the interrupted stops stay valid: every L3-F16 fixture', [BRAKE]);
  passTest('a full stop stays in bounds long enough to show it settle: at rest, both feet held, no late step: every L3-F16 full stop', [SETTLES]);
  passTest('a stop lands one foot, then the other: never two at once, never a held foot released with the other still up: every L3-F16 full stop', [ONE_FOOT]);
  passTest(
    'the stops: the toe-off release and the 2.55 s variant lose their L2 spike and settle; the stop keeps the plan 07 motor, the lower stance and individual steps; free arms brace, carry stays on the ball',
    [TOE_OFF, STOP_MOTOR, FREE_ARMS],
    () => {
      const free = REACH_AT.get('L3-F16-runStopFree')!;
      const carry = REACH_AT.get('L3-F16-runStop')!;
      expect(free.right).toBeGreaterThan(carry.right + 0.05);
      expect(free.left).toBeGreaterThan(0.45);
    },
  );
});

describe('plan 13e faults put back', () => {
  /** The named check's failures on one run of `def` (its own expectations and what it reports). */
  const failsOf = async (name: string, def: FixtureDef, opts: SimOptions): Promise<string[]> => {
    const c = CHECKS.find((x) => x.name === name)!;
    const fails: string[] = [];
    const rep = (m: string): void => void fails.push(m);
    await runWatched(def, [{ w: c.watch(def, rep), fail: rep }], opts);
    return fails;
  };

  // ------------------------------------------------------------------- planner substeps on constructed input (no physics)
  // Plan 13e's planner rules guarded on constructed planner input, the L3 planner (FOOTWORK_L3) on an L3 fixture's ragdoll
  // and shoe: what the rule decides does not depend on any run reaching the case. The solve is synthetic: flat shoes at
  // the requested ankles, except where a row says what the shown leg does instead.
  const R = FIX('L3-F6-hold').ragdoll!;
  const SOLE = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
  const TOE = R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z;
  const DT = 1 / 240;
  const I = { x: 0, y: 0, z: 0, w: 1 };
  const HOME: Record<ArmSide, Vec3> = { left: v3(-0.12, SOLE, 0), right: v3(0.12, SOLE, 0) };
  const P = FOOTWORK_L3;
  type Ev = FootEvent & { t: number };
  /** A still body standing over `home`, hips 0.75 m above it. */
  const input = (t: number, o: { home?: Record<ArmSide, Vec3>; request?: Partial<Record<ArmSide, Vec3>>; clip?: FootPlanInput['clip']; contactHold?: boolean; others?: Vec3[]; debug?: FootDebug }): FootPlanInput => {
    const home = o.home ?? HOME;
    return {
      t,
      dt: DT,
      core: { p: v3(0, SOLE + 0.85, 0), q: I },
      vel: v3(),
      yawRate: 0,
      supported: true,
      falling: false,
      ragdoll: false,
      groundY: 0,
      hips: { left: add(home.left, v3(0, 0.75, 0)), right: add(home.right, v3(0, 0.75, 0)) },
      home,
      request: { left: o.request?.left ?? { ...home.left }, right: o.request?.right ?? { ...home.right } },
      clip: o.clip ?? null,
      contactHold: o.contactHold,
      soleM: SOLE,
      toeM: TOE,
      rightW: v3(1, 0, 0),
      sideSign: { left: -1, right: 1 },
      others: o.others,
      debug: o.debug,
    };
  };
  /** A synthetic solve: flat shoes (shin frame = identity) at `ankles`, each leg on the given clearance variant (0: primary). */
  const pose = (ankles: Record<ArmSide, Vec3>, variant: Partial<Record<ArmSide, number>> = {}): PhysicalPose => {
    const seg = (id: string) => ({ segmentId: id, originWorld: v3(), rotationWorld: I });
    const li = (s: ArmSide) => ({ variant: variant[s] ?? 0, request: ankles[s], liftM: 0, softM: 0 });
    return {
      playerId: 'T',
      segments: { leftShin: seg('leftShin'), rightShin: seg('rightShin') } as unknown as PhysicalPose['segments'],
      jointLandmarksWorld: { leftAnkle: { ...ankles.left }, rightAnkle: { ...ankles.right } } as unknown as PhysicalPose['jointLandmarksWorld'],
      hingeDeg: {},
      straightFallback: [],
      limbClearance: {},
      legInfo: { left: li('left'), right: li('right') },
    } as unknown as PhysicalPose;
  };
  /** The ankle an exact solve of each request reaches. */
  const exact = (out: Record<ArmSide, FootRequest>, inp: FootPlanInput): Record<ArmSide, Vec3> => {
    const a = {} as Record<ArmSide, Vec3>;
    for (const s of ['left', 'right'] as const) {
      const r = out[s];
      a[s] = r.kind === 'plant' ? add(r.heelW, v3(0, SOLE, 0)) : r.kind === 'target' ? { ...r.ankleW } : add(inp.request[s], r.offsetW);
    }
    return a;
  };
  /** One substep: plan, solve (`solve` from the exact ankles), observe; the events go into `all`. */
  const substep = (plan: FootPlan, inp: FootPlanInput, all: Ev[], solve: (a: Record<ArmSide, Vec3>, out: Record<ArmSide, FootRequest>) => PhysicalPose = (a) => pose(a)): Record<ArmSide, FootRequest> => {
    const ev: FootEvent[] = [];
    const out = planFeet(plan, inp, ev);
    observeFeet(plan, solve(exact(out, inp), out), SOLE, 0, ev, inp.t);
    for (const e of ev) all.push({ ...e, t: inp.t });
    return out;
  };


  it('an inherited foot settling over one substep plants while it still moves, and the plant fails (L3-F7-phase50 D left 0.575 s)', async () => {
    // the 13e fix measures an inherited foot's settling over an arrival (C.arriveS), not one substep: before it, a shoe
    // still sliding passed the plant tolerance in one substep and planted. Plan 14 moved the case: with the clip arms
    // shown as the clip has them, L3-F1-phase4 no longer shows it; L3-F7-phase50 does, beside its own plant
    // failure at 0.567 s (there with or without the fault, and before plan 14). Ladder rung 7d: with the planted pose off
    // (`noPlantedPole`, no change under V1): under the swept leg guard the knee-pole plant takes D's left foot, and
    // neither plant fails
    const fails = async (foot?: NonNullable<SimOptions['debug']>['foot']): Promise<string[]> => {
      const sim = await run(FIX('L3-F7-phase50'), { debug: { ...(foot ? { foot } : {}), pose: { noPlantedPole: true } } });
      const out = sim.events.filter((e) => e.type === 'footPlantFailed').map((e) => `${e.playerId} ${(e as { side?: string }).side ?? (e.data as { side?: string })?.side} ${e.t.toFixed(4)}`);
      sim.dispose();
      return out;
    };
    expect(await fails()).toEqual(['D left 0.5667']);
    expect(await fails({ settleOneSubstep: true })).toEqual(['D left 0.5667', 'D left 0.5750']);
  }, 60000);

  it('the idle sway in the planner home takes a late settle step at the end of a stop (L3-F16-stop2.9)', async () => {
    // the 13e fix leaves the integrated sway out of the home: with it in, the swaying root drags the home past the
    // settle trigger 0.18 s before the end
    const def = FIX('L3-F16-stop2.9');
    expect(await failsOf(SETTLES, def, {})).toEqual([]);
    expect((await failsOf(SETTLES, def, { debug: { foot: { swayInHome: true } } })).join(' ')).toMatch(/expected 0\.1\d+ to be greater than 0\.4/);
  }, 60000);

  it('a foot held off its home by another body re-steps toward it in a stationary hold (L3-F6-hold)', async () => {
    // the 13e fix keeps the home the held-off step could not reach: the planted foot takes no step or settle step toward
    // it while it stays there. Without it the defender's right foot re-steps into the runner about every 0.3 s
    // (L3-F6-holdMirror until contact motion M1, then L3-F6-hold until ladder rung 3: with the arm-task twist anchored per
    // substep the fault moves no foot of L3-F6-hold, its defender is not held off its home; the fault is shown on the
    // constructed hold below)
    const def = FIX('L3-F6-hold');
    expect(await failsOf(HOLD_SETTLES, def, {})).toEqual([]);
    // and lets it go once the body that held it moves off: L3-F4-gripOwner's runner plants its held-off left foot at
    // 1.325 s and steps home at 1.392 s (1.3875 s under the plan 13f leg guard), when the defender's core is 9 cm from
    // where it was (kept to 1.99 s otherwise, and that later release crosses its boundary by 1.01 cm). Ladder rung 7d:
    // pinned to LEG_GUARD_V1; under the physical legs the defender's core no longer holds that foot off its home. Ladder
    // 8l: and to the profile before the visible flip (under it the step home comes at 1.4000 s, each of its parts moving it)
    const sim = await run({ ...preFlip(FIX('L3-F4-gripOwner')), legGuard: LEG_GUARD_V1 });
    const steps = sim.events.filter((e) => e.type === 'footSwing' && e.playerId === 'R' && (e.data as { side?: string }).side === 'left' && (e.data as { reason?: string }).reason === 'step');
    sim.dispose();
    expect(steps.map((e) => e.t.toFixed(4))).toContain('1.3875');
  }, 60000);

  it('the hold check counts every plant after 3.5 s: the registered holds pass it, and under the leg guard before the flip (V1) their clearance re-plants fail it (L3-F6-hold, L3-F6-holdMirror: HOLD_CLEARANCE_REPLANT, its exception retired at ladder 10e)', async () => {
    // the fault twin of the retired exception: the cycle it set aside, put back by the leg guard it was found under
    for (const id of ['L3-F6-hold', 'L3-F6-holdMirror']) {
      expect(await failsOf(HOLD_SETTLES, FIX(id), {}), id).toEqual([]);
      expect((await failsOf(HOLD_SETTLES, preV3(FIX(id)), {})).join(' '), id).toMatch(new RegExp(`^${id}: expected [2-9] to be less than or equal to 1`));
    }
  }, 120000);

  it('a foot held off its home by another body re-steps toward it in a stationary hold, and steps home once that body moves off (constructed hold)', async () => {
    // the 13e fix keeps the home the held-off step could not reach (FootState.blockedW): the planted foot takes no step or
    // settle step toward it while the home and the body that held it stay put, and lets it go when either moves more than
    // settleTriggerM. Without it a defender's foot re-stepped into the runner about every 0.3 s, each step landing about
    // where it started (L3-F6-holdMirror before M1, then L3-F6-hold until ladder rung 3, where the fault no longer moves
    // a foot of L3-F6-hold: its defender is not held off its home). The hold is constructed, on the planner alone: a still
    // body whose right home moves
    // 28 cm toward another player's core (over stepTriggerM); the shown right leg cannot pass that body's near side (a
    // request past it is solved on clearance variant 1, the leg stopped at it). The re-steps are counted by their reason:
    // a plant released for a 'step' trigger (not a clearance release, not a settle step)
    const wallX = 0.2;
    const homeR = v3(0.4, SOLE, 0);
    const blocked = (o: { debug?: FootDebug; blockerMoveM?: number; homeMoveM?: number }) => {
      const plan = newFootPlan(P, R);
      const all: Ev[] = [];
      const stands: { t: number; at: Vec3 }[] = [];
      let blocker = v3(0.55, 0, 0);
      let home = { left: HOME.left, right: homeR };
      let t = 0;
      initFeet(plan, pose({ ...HOME }), input(t, { others: [blocker], debug: o.debug }), []);
      const MOVE = 240 * 3;
      for (let k = 0; k < 240 * 4; k++) {
        t += DT;
        // after 3 s the body that held the leg moves off along the side line (taking its near side along), or the home moves
        if (k === MOVE && o.blockerMoveM) blocker = add(blocker, v3(0, 0, o.blockerMoveM));
        if (k === MOVE && o.homeMoveM) home = { left: HOME.left, right: add(homeR, v3(0, 0, o.homeMoveM)) };
        const wall = k >= MOVE && (o.blockerMoveM ?? 0) > P.settleTriggerM ? Infinity : wallX;
        const n = all.length;
        substep(plan, input(t, { home, others: [blocker], debug: o.debug }), all, (a) => {
          const r = { ...a.right };
          const held = r.x > wall;
          if (held) r.x = wall;
          return pose({ left: a.left, right: r }, { right: held ? 1 : 0 });
        });
        // where each right plant stands (its heel: the footprint the home is measured from)
        if (all.slice(n).some((e) => e.side === 'right' && e.type === 'footPlant')) stands.push({ t, at: { ...plan.feet.right.heelW! } });
      }
      const right = all.filter((e) => e.side === 'right' && e.t > 0.01);
      const reason = (e: Ev): string | undefined => (e.data as { reason?: string }).reason;
      return {
        // the planted foot's re-steps: released for a step trigger after the first (held-off) step has landed
        firstPlant: right.find((e) => e.type === 'footPlant'),
        steps: (from: number, to: number) => right.filter((e) => e.type === 'footRelease' && reason(e) === 'step' && e.t > from && e.t < to),
        others: right.filter((e) => e.type === 'footRelease' && reason(e) !== 'step'),
        plants: stands.filter((p) => p.t > 0.01),
        moveT: MOVE * DT,
      };
    };
    const records: [string, () => void][] = [
      [
        'held off: one step lands where the leg got to, then no re-step while the home and the body stay put; the fault re-steps into it about every 0.36 s, each landing where it started',
        () => {
          const fixed = blocked({});
          expect(fixed.firstPlant, 'the held-off step lands').toBeDefined();
          const t0 = fixed.firstPlant!.t;
          // it landed where the leg got to, at the body's near side: short of its home by more than the step trigger
          const at0 = fixed.plants[0].at;
          expect(fixed.plants[0].t).toBe(t0);
          expect(Math.abs(at0.x - wallX)).toBeLessThanOrEqual(P.plantTolM);
          expect(homeR.x - at0.x).toBeGreaterThan(P.stepTriggerM);
          expect(fixed.steps(t0, 4).map((e) => e.t.toFixed(4)), 're-steps (reason step) toward the blocked home').toEqual([]);
          expect(fixed.others).toEqual([]);
          expect(fixed.plants).toHaveLength(1);
          // the fault put back: the same held-off landing, then re-steps. Only re-steps with reason 'step' are counted (a
          // plant released for a step trigger): the fault alone gives them, about one every 0.36 s
          const fault = blocked({ debug: { noBlockedMemory: true } });
          expect(fault.plants[0]).toEqual(fixed.plants[0]);
          const re = fault.steps(t0, 4);
          expect(re.length).toBeGreaterThan(5);
          expect(fault.others).toEqual([]);
          // unnecessary: every re-step lands within the plant tolerance of where the held-off step had landed
          expect(fault.plants.length).toBeGreaterThanOrEqual(re.length);
          for (const p of fault.plants) expect(Math.hypot(p.at.x - at0.x, p.at.z - at0.z), p.t.toFixed(4)).toBeLessThanOrEqual(P.plantTolM);
        },
      ],
      [
        'the body that held it moves off by more than settleTriggerM: the foot steps home at once and plants there',
        () => {
          const r = blocked({ blockerMoveM: 0.2 });
          const after = r.steps(r.moveT - 1e-9, 4);
          expect(after.length).toBe(1);
          expect(after[0].t - r.moveT).toBeLessThanOrEqual(2 * DT + 1e-9);
          const last = r.plants[r.plants.length - 1];
          expect(last.t).toBeGreaterThan(after[0].t);
          expect(Math.hypot(last.at.x - homeR.x, last.at.z - homeR.z)).toBeLessThan(P.settleTriggerM);
        },
      ],
      [
        'the body moves by less than settleTriggerM: the home stays blocked, no step',
        () => {
          const r = blocked({ blockerMoveM: 0.05 });
          expect(r.steps(r.firstPlant!.t, 4)).toEqual([]);
        },
      ],
      [
        'the home itself moves on by more than settleTriggerM: the memory goes, and the foot steps toward the new home',
        () => {
          const r = blocked({ homeMoveM: 0.2 });
          const after = r.steps(r.moveT - 1e-9, 4);
          expect(after.length).toBeGreaterThan(0);
          expect(after[0].t - r.moveT).toBeLessThanOrEqual(2 * DT + 1e-9);
        },
      ],
    ];
    await rows(records, ([n]) => n, ([, f]) => f());
  });
});

describe('plan 08 pass 2: idle and walking', () => {
  passTest('L3-F13 and L3-F15: standing still has no stepping, root offset or arm chatter; stops settle on existing plants and stay; the fitted posture keeps the supplied stance and converts valid', [STANDS_STILL, SETTLE_PLANTS, FITTED]);
  passTest('plan 13e: the idle cycle plays by its weight (the stance fade, 0 out of free supported movement), the head within the cycle; standing idle, no foot leaves its plant: every model-body L3 fixture, L3-F13 and L3-F15', [IDLE_WEIGHT, IDLE_PLANTS]);
  passTest('L3-F14: a free arm swings visibly at a walk, carry and ready keep their assignment; a walk starts and stops over steps; walk, run and stop stay valid', [ARM_SWING, WALK_STEPS, WALK_VALID]);
  passTest('plan 13d: a constant 6.6 m/s run keeps the full stride from the first substep: L3-F16-sprint', [FULL_STRIDE]);
  passTest('L3-F17: a run start goes foot by foot, the strides growing, through the walk into the run: every L3-F17 fixture', [RUN_START]);
});

describe('plan 08 pass 3: contact integration', () => {
  passTest('no shared stance reset: anchors held at entry stay, every target finite, whatever the phase: every L3-F1 fixture', [ANCHORS]);
  passTest('temporary airborne recovery: probe support lost in the named mode and regained, feet airborne, no support force in the air, no conversion: every L3-F9-lift fixture', [LIFT_RECOVERY]);
  passTest('a labelled conversion or a loss of probe support in the named mode is an audited, irreversible fall: every L3-F9-convert and L3-F9-noProbe fixture, and the low runner in contact', [AUDITED_FALL]);
  passTest('the defender converts on the measured sign of its bob: the L3-F10 rising and falling holds', [DEFENDER_BOB]);
  passTest('plan 13d known limits gone (plan 14): the L3-F9 one-arm defenders and L3-F1-falling convert at their labelled conversion', [DEFENDER_13F]);
  passTest(
    'contact entry: preparation unwinds with no contact (L3-F2); the mode follows the first observed contact within a tick (L3-F3); legs keep stepping in contact and tackles end as their copies do (L3-F4/F5)',
    [PREP_UNWINDS, FOLLOWS_CONTACT, KEEP_STEPPING],
  );
  passTest(
    'hold and exit: a stationary hold settles (L3-F6); a saturating load released does not launch (L3-F6/F7); contact clears from every run phase and side (L3-F7); a recontact in exit is named and audited (L3-F8)',
    [HOLD_SETTLES, NO_LAUNCH, CLEARS, RECONTACT],
  );
  passTest(
    'conversions: a player below stays a support-budget regression (L3-F9); either or both convert with retention (L3-F10); a genuine bad candidate is rejected with the safe fallback (L3-F11)',
    [PLAYER_BELOW, RETAINED, BAD_CANDIDATE],
  );
  passTest(
    'held arms: real palm holds keep the anchor and arm segments within Gate 2 through entry and remap within Gate 4; real forearm clamps keep the segments and end only for an engine reason',
    [PALM_HOLDS, CLAMPS],
  );
  passTest('negative control: the retention measures fail a stretched limb and a shifted anchor, and the wrong player has no hold', [RETENTION_BITES]);
});

// ---------------------------------------------------------------------------------------------------------------------
// The carried ball (plan 08a, plan 10d D1(a)): what tests/ball-carry.test.ts checked on runs of registered L3 fixtures

describe('ladder tracked defects (rule 7)', () => {
  // Mechanisms that exist before the ladder rung whose moved trajectories reached them (docs/open/contact-motion/
  // prerequisites-ladder.md, open defects). Each test resumes from a full-state capture of the fixture shortly before the
  // defect (tests/state.ts, tests/data/state; how to capture and when to regenerate: tests/README.md), so a later rung
  // that moves the fixture's trajectory before that point does not move the test, and a twin can resume the same state
  // with a change off. Each fails once the defect is gone from that state. Both are resolved and no live check sets
  // either aside: LEG_IN_RAGDOLL since the 8m flip (exception retired at 9g), HOLD_CLEARANCE_REPLANT since the 10d
  // leg-guard flip (retired at 10e). Their captures' tests stay as the pre-flip record of each defect and the twin,
  // without the fix, of rungs 6 and 7 resolving the same states (below).
  // (captured before the visible flip and the ladder 10 leg-guard flip: resumed under the profile they ran under)
  const resumed = async (capture: string, opts: SimOptions = {}) =>
    runSim(await resumeState(loadState(`tests/data/state/${capture}.json.gz`), { def: preV3(preFlip(FIX(capture.split('@')[0]))), opts }));
  it('a posed leg held inside the runner\'s ragdoll, the defender\'s conversion rejected for it (L3-F4-oneArm, L3-F1-phase2, L4-F10-wrap-off)', async () => {
    // captured with R a ragdoll and D supported beside it, 2 ticks before D's posed legs pass the conversion tolerance
    // (12 substeps from 1.200 s on the L3 fixtures, 8 from 1.271 s on L4-F10-wrap-off at rung 4b), D converting at 1.30 s
    await rows(['L3-F4-oneArm@70', 'L3-F1-phase2@70', 'L4-F10-wrap-off@74'], (c) => c, async (c) => {
      const id = c.split('@')[0];
      const tol = FIX(id).ragdoll!.validation.penetrationTolM;
      // the deepest posed-leg clearance of D against the other bodies, per substep while R is a ragdoll and D supported
      let run0 = 0;
      let longest = 0;
      const sim = await resumed(c, {
        onSubstep: (s) => {
          const D = s.players.find((p) => p.id === 'D')!;
          const R = s.players.find((p) => p.id === 'R')!;
          if (!R.rag || D.rag || D.controlMode !== 'supported' || !D.pose) return;
          const lc = D.pose.limbClearance;
          run0 = Math.max(lc.leftLeg ?? 0, lc.rightLeg ?? 0) > tol ? run0 + 1 : 0;
          longest = Math.max(longest, run0);
        },
      });
      const rej = sim.events.filter((e) => e.type === 'handoffRejected');
      const R = sim.players.find((p) => p.id === 'R')!;
      const solver = sim.def.solver;
      sim.dispose();
      expect(rej.map((e) => e.playerId), id).toEqual(['D']);
      expect(LEG_IN_RAGDOLL.is(rej[0].data), `${id} ${JSON.stringify(rej[0].data?.worstExternal)}`).toBe(true);
      expect(R.representation, id).toBe('ragdoll');
      // held there, not met in the last tick: D's posed legs past the conversion tolerance for longer than one tick
      expect(longest, id).toBeGreaterThan(solver.substeps);
    });
  }, 120000);

  it('under physical legs (LEG_GUARD_V3, resumed as a variant) the same states convert: the posed legs never held past the tolerance over a tick', async () => {
    // Rung 6: what the physical supported legs do from the LEG_IN_RAGDOLL captures (the test above is the twin: the
    // captured profile reproduces the rejection). D's legs meet R's ragdoll in the solve and the guard keeps the posed
    // legs clear of it, so no run of D's posed legs past the conversion tolerance lasts a tick and D's conversion is
    // accepted. Measured (rung 6): no substep past the tolerance at all, 1.20 / 1.20 / 1.02 cm at most.
    await rows(['L3-F4-oneArm@70', 'L3-F1-phase2@70', 'L4-F10-wrap-off@74'], (c) => c, async (c) => {
      const id = c.split('@')[0];
      const def = { ...preFlip(FIX(id)), legGuard: LEG_GUARD_V3 };
      const tol = def.ragdoll!.validation.penetrationTolM;
      let run0 = 0;
      let longest = 0;
      const sim = await runSim(
        await resumeState(loadState(`tests/data/state/${c}.json.gz`), {
          def,
          variant: ['legGuard'],
          opts: {
            onSubstep: (s) => {
              const D = s.players.find((p) => p.id === 'D')!;
              const R = s.players.find((p) => p.id === 'R')!;
              if (!R.rag || D.rag || D.controlMode !== 'supported' || !D.pose) return;
              const lc = D.pose.limbClearance;
              run0 = Math.max(lc.leftLeg ?? 0, lc.rightLeg ?? 0) > tol ? run0 + 1 : 0;
              longest = Math.max(longest, run0);
            },
          },
        }),
      );
      const rej = sim.events.filter((e) => e.type === 'handoffRejected');
      const D = sim.players.find((p) => p.id === 'D')!;
      const legNs = sim.legLedger?.get('D')?.impulseNs ?? 0;
      const solver = sim.def.solver;
      sim.dispose();
      expect(rej.map((e) => `${e.playerId} ${JSON.stringify(e.data?.worstExternal)}`), id).toEqual([]);
      expect(D.handoff?.outcome, id).toBe('accepted');
      expect(longest, id).toBeLessThanOrEqual(solver.substeps);
      // D's legs met R in the solve
      expect(legNs, id).toBeGreaterThan(0);
    });
  }, 120000);

  it('a held player\'s planted foot released by its clearance solve and planted again, in a stationary hold (L3-F6-hold, L3-F6-holdMirror)', async () => {
    // captured in the stationary hold before the counted window (after 3.5 s): L3-F6-hold at 3.600 s, 0.1 s before R's
    // left foot's first clearance release in it; L3-F6-holdMirror at 3.500 s, inside R's right foot's release cycle
    await rows(['L3-F6-hold@216', 'L3-F6-holdMirror@210'], (c) => c, async (c) => {
      const id = c.split('@')[0];
      const sim = await resumed(c);
      const tracked = ['R', 'D'].map((pid) => HOLD_CLEARANCE_REPLANT.replants(sim, pid, 3.5).length);
      const releases = sim.events.filter((e) => e.type === 'footRelease' && e.t > 3.5 && (e.data as { reason?: string }).reason === 'clearance');
      const still = sim.players.every((p) => p.controlMode === 'supported');
      sim.dispose();
      expect(still, id).toBe(true);
      expect(releases.length, id).toBeGreaterThan(0);
      // more re-plants after a clearance release than the hold's one settle plant
      expect(Math.max(...tracked), id).toBeGreaterThan(1);
    });
  }, 120000);

  it('under the swept guard (LEG_GUARD_V2, V3: resumed as a variant) rung 7 keeps the same holds\' plants: no clearance release, no re-plant; the twin without it keeps the cycle', async () => {
    // Rung 7 (the planted primary pose, knee-pole first): the released foot's leg is obstructed where it stands (its
    // primary placement past HARD_OK) and the ordinary choice takes an offset, which leaves the anchor. With rung 7 the
    // leg turns its knee to another pole about the planted foot, its sole kept on the anchor, and back once the primary
    // is clear at its own knee. The twin is the same state resumed with PoseDebug.noPlantedPole. Measured (rung 7): no
    // release and no plant after 3.5 s; the knee at a knee pole for 56 (hold, R left) and 210 + 15 (holdMirror, R right and
    // D left) substeps, the shown pole turning at most at the L3 rate, the planted feature within 0.2 mm; the twin as
    // captured (3 releases and 2 plants; 4 and 4)
    const caps = ['L3-F6-hold@216', 'L3-F6-holdMirror@210'];
    await rows(caps.flatMap((c) => (['V2', 'V3'] as const).flatMap((g) => [false, true].map((fault) => ({ c, g, fault })))), (x) => `${x.c} ${x.g}${x.fault ? ' noPlantedPole' : ''}`, async ({ c, g, fault }) => {
      const id = c.split('@')[0];
      const def = { ...preFlip(FIX(id)), legGuard: g === 'V2' ? LEG_GUARD_V2 : LEG_GUARD_V3 };
      // per planted leg and substep: at a knee pole (pose memory index >= 10), the shown pole's turn (body frame), the plant's feature error
      let atPole = 0;
      let maxTurn = 0;
      let maxErr = 0;
      const last = new Map<string, Vec3>();
      const sim = await runSim(
        await resumeState(loadState(`tests/data/state/${c}.json.gz`), {
          def,
          variant: ['legGuard'],
          ...(fault ? { faults: { pose: { noPlantedPole: true } } } : {}),
          opts: {
            onSubstep: (s) => {
              for (const p of s.players)
                for (const side of ['left', 'right'] as const) {
                  const m = p.poseMemory;
                  const key = `${p.id}.${side}`;
                  const k = `${side}Leg`;
                  if (m[`${k}:p:x`] === undefined) continue;
                  const pole = norm(v3(m[`${k}:p:x`], m[`${k}:p:y`], m[`${k}:p:z`]));
                  const f = p.feet?.feet[side];
                  if (f?.mode === 'planted' && !f.tentative) {
                    if (m[k] >= 10) atPole++;
                    maxErr = Math.max(maxErr, f.featureErrM);
                    const q = last.get(key);
                    if (q) maxTurn = Math.max(maxTurn, dist(q, pole));
                  }
                  last.set(key, pole);
                }
            },
          },
        }),
      );
      const ev = sim.events.filter((e) => e.t > 3.5);
      const releases = ev.filter((e) => e.type === 'footRelease' && (e.data as { reason?: string }).reason === 'clearance').length;
      const plants = ev.filter((e) => e.type === 'footPlant').length;
      const tracked = ['R', 'D'].map((pid) => HOLD_CLEARANCE_REPLANT.replants(sim, pid, 3.5).length);
      const still = sim.players.every((p) => p.controlMode === 'supported');
      const dt = sim.physics.dt;
      sim.dispose();
      expect(still, id).toBe(true);
      if (fault) {
        // the cycle, as captured
        expect(releases, id).toBeGreaterThan(0);
        expect(Math.max(...tracked), id).toBeGreaterThan(1);
        expect(atPole, id).toBe(0);
        return;
      }
      expect([releases, plants], id).toEqual([0, 0]);
      expect(atPole, id).toBeGreaterThan(0);
      // the planted feet on their anchors within the footwork tolerance; the knee pole turning within the L3 rate
      expect(maxErr, id).toBeLessThanOrEqual(def.footwork!.plantTolM);
      expect(maxTurn, id).toBeLessThanOrEqual(CONT_L3_RADPS * dt + 1e-9);
    });
  }, 240000);
});

describe('the carried ball over the L3 pass (plan 08a, plan 10d D1(a))', () => {
  passTest('contact and recontact: ownership changes under the 1 cm same-time limit, the ball included, on the achieved arm', [CARRY_AUDIT], () => {
    let boundaries = 0;
    for (const r of CARRY_BOUNDARIES.values()) boundaries += r.boundaries;
    expect(boundaries).toBeGreaterThan(30);
  });

  passTest('the rule reference, the drawn ball and the official spot agree; the spot stays frozen', [RULE_REF], () => {
    const withEnding = RULE_FIXTURES.map(FIX);
    expect(withEnding.length).toBeGreaterThan(10);
    let endings = 0;
    for (const def of withEnding.slice(0, 12)) {
      expect(def.rules!.ballSource, def.id).toBe('carryPose');
      if (RULE_REF_SPOT.get(def.id)) endings++;
    }
    expect(endings).toBeGreaterThan(0);
  });

  passTest(
    'every L3 rule fixture draws the seated ball; on every tick of every one the drawn ball, the rule reference and the evidence agree, and the spot is the ball at the ending and stays frozen',
    [ONE_BALL],
    () => {
      const defs = RULE_FIXTURES.map(FIX);
      expect(defs.length).toBeGreaterThanOrEqual(20);
      for (const d of defs) expect(d.rules!.ballSource, d.id).toBe('carryPose');
      let ticks = 0;
      let seated = 0;
      let endings = 0;
      for (const id of RULE_FIXTURES) {
        const e = ONE_BALL_SEEN.get(id)!;
        ticks += e.ticks;
        seated += e.seated;
        if (e.ending) endings++;
      }
      expect(ticks).toBeGreaterThan(2000);
      expect(seated).toBeGreaterThan(0.9 * ticks);
      expect(endings).toBeGreaterThanOrEqual(15);
    },
  );
});
