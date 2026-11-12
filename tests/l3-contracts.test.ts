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
// L3_SHARDS=<n> sets the number of shard processes (default: a quarter of the cores, at most 4; on the 8-core M2 two
// shards gave the shortest suite, 74-78 s, against 80-81 s with three and 84 s with four); 0 runs the pass in this
// process (to debug a check).
import { fork, type ChildProcess } from 'node:child_process';
import { availableParallelism, setPriority } from 'node:os';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { SimOptions, TransitionDelta } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { allFixtures } from '../src/sim/fixtures/index';
import { FOOTWORK_L2, FOOTWORK_L3, stepAccelLimits } from '../src/sim/footwork';
import { breathe, FIX, rows } from './helpers';
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
  HOLD_SETTLES,
  KEEP_STEPPING,
  LANDINGS,
  LIFT,
  LIFT_RECOVERY,
  mergeRecords,
  NO_LAUNCH,
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
  WALK_STEPS,
  WALK_VALID,
  type Watch,
} from './l3-pass';
import type { ArmSide } from '../src/sim/contracts';
import type { FootDebug } from '../src/sim/debug';
import { initFeet, newFootPlan, observeFeet, planFeet, type FootEvent, type FootPlan, type FootPlanInput } from '../src/sim/footwork';
import type { FootRequest, PhysicalPose } from '../src/sim/pose';
import { add, v3, type Vec3 } from '../src/sim/vec';

// ---------------------------------------------------------------------------------------------------------------------
// The pass

const FILTER = process.env.L3_CONTRACTS ? new RegExp(process.env.L3_CONTRACTS) : null;
const NOTE = FILTER ? ` (narrowed: L3_CONTRACTS=${process.env.L3_CONTRACTS})` : '';
const PASS = L3(/^L3-/).filter((d) => !FILTER || FILTER.test(d.id));
const SHARDS = Math.min(PASS.length, process.env.L3_SHARDS !== undefined ? Number(process.env.L3_SHARDS) : Math.max(1, Math.min(4, Math.floor(availableParallelism() / 4))));
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
    'the boundary records: a landing is compared with its old path as it is; the raw difference and what was set aside are kept; a jump the offset took up is not corrected twice',
    [RAW_KEPT, NOT_TWICE, LANDINGS],
  );

  it('the boundary records, controlled: a reseed that keeps mode and source is a boundary; a step that loses support is compared with its old path as it is', async () => {
    // no L3 run has either any more (tests/l3-pass.ts reseedCovered, stepAsIsCovered): each is made where its run shows the
    // situation, a plant mid-stance released by its solve, a step mid-swing over a strip the probe finds no support on
    await rows(
      [
        [RESEED, reseedCovered],
        [STEP_AS_IS, stepAsIsCovered],
      ] as const,
      ([n]) => n,
      async ([, f]) => {
        const fails = await f();
        expect(fails, fails.join('\n')).toEqual([]);
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

  it('negative control: a known old/new pose difference over 1 cm still fails (a new foot owner shown off its path)', async () => {
    // the audit check itself (AUDIT), on the free 6.6 m/s run of one player (L3-F16-sprint): passes as it is, and with every
    // composed leg whose foot owner changed starting its continuity step 3 cm off the shown path (PoseDebug.ownerChangeJumpM)
    // it reports each such boundary over 1 cm, the old owner's continuation kept as it was. (Before contact motion D4-D6 the
    // control was the 10b crossing heading fault put back on L3-F7-loadRelease, D's left ankle 1.30 cm at 0.575 s: D's left
    // foot is no longer a following foot at that crossing, and the fault moves no boundary there past 0.65 cm. The pose's
    // composed continuity bounds a departure to 0.875 cm a substep, so a fault in a foot request alone no longer shows.)
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
    // nothing set aside (user ruling 2026-11-10): every boundary over 1 cm raw is still over 1 cm after the correction; and
    // a boundary whose reference took no request jump out (transition-audit.ts sets requestJumpM exactly where it moves a
    // reference foot's offset) is compared as it is, its measure exactly the raw difference. Under this fault a new owner's
    // step can also carry a 0.2-3 mm request jump, which the reference takes out, so those measures differ from raw
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
      expect(seen.steps).toBeGreaterThan(30000);
      expect(seen.stored).toBeGreaterThan(30000);
      expect(seen.chaseStarts).toBeGreaterThan(5);
      expect(seen.chaseInside).toBeGreaterThan(100);
      expect(seen.requests).toBeGreaterThan(30000);
    },
  );

  it(`the continuity records: a step out of time while moving slows within its limit; a continued step is given the time its acceleration limit needs${NOTE}`, async () => {
    const of = async (id: string): Promise<Continuity> => {
      const kept = CONT.get(id);
      if (kept) return kept;
      const c = continuity(FIX(id), { steps: 0, stored: 0, chaseStarts: 0, chaseReseeds: 0, chaseInside: 0, requests: 0 });
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
    const fresh = (): ContinuitySeen => ({ steps: 0, stored: 0, chaseStarts: 0, chaseReseeds: 0, chaseInside: 0, requests: 0 });
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
  // and shoe: what the rule decides does not depend on any run reaching the case (the natural samples, L3-F7-phase50 D left
  // 0.575 s and L3-F6-hold / L3-F4-gripOwner, are gone since contact motion M1 and D4-D6 changed those runs). The solve
  // is synthetic: flat shoes at the requested ankles, except where a row says what the shown leg does instead.
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
  const hzLen = (v: Vec3): number => Math.hypot(v.x, v.z);

  it('an inherited foot settling over one substep plants while it still moves, and the plant fails (constructed crossing; was L3-F7-phase50 D left 0.575 s)', async () => {
    // the 13e fix measures an inherited foot's settling over an arrival (C.arriveS), not one substep: before it, a shoe
    // still sliding passed the plant tolerance in one substep and planted (L3-F16-stop1.9's right foot at 0.33 m/s;
    // L3-F7-phase50 D's left at the contact-entry crossing, 1.78 m/s, its plant failed on the slide at 0.575 s). Since
    // contact motion M1 D's left foot is planted at that crossing (no inherited foot, no proposal either way), so the
    // crossing is constructed: a left foot leaves its clip stance and follows a request sliding along the ground at v0;
    // then a contact hold takes the clip away (the clip-to-procedural crossing) while the shoe still slides. The shown
    // shoe under a plant request stops no faster than the planner's own step acceleration limit (C.stepAccelMps2): the
    // leg does not stop a sliding foot in one substep (which an exact solve would)
    const C = P.compose!;
    const A = C.stepAccelMps2;
    const slide = (v0: number, debug?: FootDebug) => {
      const plan = newFootPlan(P, R);
      const all: Ev[] = [];
      const contact = { weight: 1, rollF: 0, toeZ: TOE };
      const clip = (left: boolean): FootPlanInput['clip'] => ({ weight: 1, headingRad: 0, stance: { left, right: true }, contact: { left: left ? contact : null, right: contact } });
      // the left starts 14 cm behind its home: the slide ends about there (no settle trigger in the way)
      const start = add(HOME.left, v3(0, 0, -0.14));
      let t = 0;
      initFeet(plan, pose({ left: start, right: HOME.right }), input(t, { request: { left: start }, clip: clip(true), debug }), []);
      let req = { ...start };
      let v = 0;
      let shown: Vec3 | null = null;
      let shownV = v3();
      let cross = { t: -1, v: 0, proposed: false };
      for (let k = 0; k < 240; k++) {
        t += DT;
        // stance for longer than landWithinS (a younger plant is held), then the left's request slides, reaching v0 by
        // the crossing at substep 60
        const inStance = k < 40;
        if (!inStance && k < 60) {
          v = Math.min(v0, v + 40 * DT);
          req = add(req, v3(0, 0, v * DT));
        }
        const hold = k >= 60;
        const f = plan.feet.left;
        const before = { inherited: f.mode === 'swing' && f.source === 'follow', v: hzLen(f.ankleV) };
        substep(plan, input(t, { request: { left: req }, clip: clip(inStance), contactHold: hold, debug }), all, (a, out) => {
          if (out.left.kind === 'plant' && shown) {
            const sp = hzLen(shownV);
            const nv = Math.max(0, sp - A * DT);
            shownV = sp > 0 ? v3((shownV.x / sp) * nv, 0, (shownV.z / sp) * nv) : v3();
            a.left = v3(shown.x + shownV.x * DT, SOLE, shown.z + shownV.z * DT);
          } else if (shown) shownV = v3((a.left.x - shown.x) / DT, 0, (a.left.z - shown.z) / DT);
          shown = a.left;
          return pose(a);
        });
        if (k === 60) cross = { t, v: before.v, proposed: before.inherited && all.some((e) => e.t === t && e.side === 'left' && (e.type === 'footPlant' || e.type === 'footPlantFailed')) };
      }
      const left = all.filter((e) => e.side === 'left' && e.t > 0.01);
      return { cross, left, plants: left.filter((e) => e.type === 'footPlant'), slid: left.filter((e) => (e.type === 'footRelease' || e.type === 'footPlantFailed') && (e.data as { reason?: string }).reason === 'slide') };
    };
    await rows(
      [1.5, 1.8, 2.2],
      (v0) => `v0 ${v0} m/s`,
      (v0) => {
        // the shoe is still moving faster than the plant tolerance over an arrival (and within it over one substep)
        const fixed = slide(v0);
        expect(fixed.cross.v * C.arriveS).toBeGreaterThan(P.plantTolM);
        expect(fixed.cross.v * DT).toBeLessThanOrEqual(P.plantTolM);
        // the fix: no proposal at the crossing, the swing continues as a step; the foot plants once it has arrived, and no
        // plant fails on a slide
        expect(fixed.cross.proposed, `a plant proposed at the crossing, the shoe at ${fixed.cross.v.toFixed(2)} m/s`).toBe(false);
        expect(fixed.left.some((e) => e.t === fixed.cross.t && e.type === 'footSwing' && (e.data as { reason?: string }).reason === 'continue')).toBe(true);
        expect(fixed.slid.map((e) => `${e.type} ${e.t.toFixed(4)}`), 'plants failed on a slide').toEqual([]);
        expect(fixed.plants.length).toBeGreaterThan(0);
        // the fault put back: it plants at the crossing while it slides, and that plant fails on the slide within an arrival
        const fault = slide(v0, { settleOneSubstep: true });
        expect(fault.cross.v).toBeCloseTo(fixed.cross.v, 9);
        expect(fault.cross.proposed).toBe(true);
        expect(fault.slid.length).toBeGreaterThan(0);
        expect(fault.slid[0].t - fault.cross.t).toBeGreaterThanOrEqual(0);
        expect(fault.slid[0].t - fault.cross.t).toBeLessThanOrEqual(C.arriveS);
      },
    );
  });

  it('the idle sway in the planner home takes a late settle step at the end of a stop (L3-F16-stop2.9)', async () => {
    // the 13e fix leaves the integrated sway out of the home: with it in, the swaying root drags the home past the
    // settle trigger 0.18 s before the end
    const def = FIX('L3-F16-stop2.9');
    expect(await failsOf(SETTLES, def, {})).toEqual([]);
    expect((await failsOf(SETTLES, def, { debug: { foot: { swayInHome: true } } })).join(' ')).toMatch(/expected 0\.1\d+ to be greater than 0\.4/);
  }, 60000);

  it('a foot held off its home by another body re-steps toward it in a stationary hold, and steps home once that body moves off (constructed hold; was L3-F6-hold and L3-F4-gripOwner)', async () => {
    // the 13e fix keeps the home the held-off step could not reach (FootState.blockedW): the planted foot takes no step or
    // settle step toward it while the home and the body that held it stay put, and lets it go when either moves more than
    // settleTriggerM. Without it a defender's foot re-stepped into the runner about every 0.3 s, each step landing about
    // where it started (L3-F6-holdMirror before M1, then L3-F6-hold). The natural fault run now shows it only in part:
    // with noBlockedMemory L3-F6-hold's defender re-steps (footRelease 'step') at 2.54, 3.03, 3.30 and 4.80 s, but two of
    // its three plants after 3.5 s follow planted-leg clearance releases (3.875 s, 4.475 s), a pose path contact motion
    // D6 changes; and L3-F4-gripOwner's runner no longer has a held-off step at all since M1 (its left steps at 1.67 s
    // after a clearance release). So the hold is constructed, on the planner alone: a still body whose right home moves
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
