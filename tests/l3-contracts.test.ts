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
import type { SimOptions } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { FOOTWORK_L2, FOOTWORK_L3, stepAccelLimits } from '../src/sim/footwork';
import { breathe, FIX as REGISTERED, preBraceV2, preWrapV5, preWrapV7, preWrapV8, preWrapV9, preWrapV10, preWrapV11, preWrapV12, preWrapV13, rows } from './helpers';
import { L3 } from './transitions-shared';
import {
  ANCHORS,
  ARM_SWING,
  AUDITED_FALL,
  BAD_CANDIDATE,
  BRAKE,
  C,
  CHECKS,
  CLAMPS,
  CARRY_AUDIT,
  CARRY_BOUNDARIES,
  CLEARS,
  continuity,
  COPIED,
  COPIES,
  COPY_IDS,
  covers,
  DEFENDER_13F,
  DEFENDER_BOB,
  FIRST,
  FITTED,
  IDLE_PLANTS,
  IDLE_WEIGHT,
  type FixturePass,
  FOLLOWS_CONTACT,
  FREE_ARMS,
  HOLD_SETTLES,
  holdsEndedEarly,
  KEEP_STEPPING,
  LIFT_RECOVERY,
  mergeRecords,
  NO_LAUNCH,
  noneSeen,
  OFF_GROUND,
  ONE_BALL,
  ONE_BALL_SEEN,
  ONE_FOOT,
  PALM_HOLDS,
  passFixture,
  PLANT_ROOT,
  PLANT_SEEN,
  plantRootBreaches,
  POP_M,
  PLAYER_BELOW,
  PREP_UNWINDS,
  REACH_AT,
  RECONTACT,
  type Records,
  RESEED,
  RESEED_SAMPLE,
  DEFENDER_13F_SAMPLE,
  reseedCovered,
  RETAINED,
  RETENTION_BITES,
  ROOT_M,
  ROOT_PEAK,
  RULE_FIXTURES,
  RULE_REF,
  RULE_REF_SPOT,
  FULL_STRIDE,
  RUN_START,
  runWatched,
  SETTLE_PLANTS,
  SETTLES,
  SLIDE_M,
  STANDS_STILL,
  STEP_AS_IS,
  stepAsIsCovered,
  STOP_MOTOR,
  TOE_OFF,
  WALK_STEPS,
  WALK_VALID,
  type Watch,
} from './l3-pass';

// Plan 15 step 5b: the L3 fixtures as registered, on the contact stepping model. The reactive planner's contracts went
// with it (foot limits, foot-target continuity, the planner's handovers and faults, the still feet, the transition
// audit's gate over every fixture; docs/handoff/plan15.md lists them); the model's own rules are tests/contact-steps.test.ts'
const FIX = REGISTERED;

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

/**
 * Ladder 15: the fine measures the gates no longer judge, printed one line per L3 fixture family (L3-F1 ... L3-F17) from
 * the per-fixture records: `line` makes a family's text from its fixtures' records.
 */
function printByFamily<T>(what: string, m: Map<string, T>, line: (xs: [string, T][]) => string): void {
  const fam = new Map<string, [string, T][]>();
  for (const [id, r] of m) {
    const f = id.split('-').slice(0, 2).join('-');
    fam.set(f, [...(fam.get(f) ?? []), [id, r]]);
  }
  const keys = [...fam.keys()].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)));
  console.log(`${what}\n${keys.map((k) => `  ${k}: ${line(fam.get(k)!)}`).join('\n')}`);
}
const cm = (m: number): string => `${(m * 100).toFixed(2)} cm`;
const worstOf = <T,>(xs: [string, T][], v: (r: T) => number): [string, T] => xs.reduce((a, x) => (v(x[1]) > v(a[1]) ? x : a));

describe('plan 08 transition audit', () => {
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

  it('B3 fault put back: with the clip heading snapping to the travel direction, the leg request jumps at contact', async () => {
    // before 10b the sampled clip's heading took the travel direction in one substep, so a collision that turned the
    // travel turned the leg request with it: up to 4.45 cm in L3-F8-recontact (D2 left 0.829 s), 116 substeps over 1 cm
    // across L3. The heading now follows at the planner's follow rate (run-clips headingRadPerS)
    const d = FIX('L3-F8-recontact');
    expect(d.runClips?.headingRadPerS).toBe(18);
    const fresh = noneSeen;
    const c = continuity(d, fresh());
    await runOne(d, c.watch, { transitionAudit: true });
    const now = c.out;
    expect(now.requestDD).toEqual([]);
    const snapDef = { ...d, runClips: { ...d.runClips!, headingRadPerS: undefined } };
    const snap = continuity(snapDef, fresh());
    await runOne(snapDef, snap.watch, { transitionAudit: true });
    expect(Math.max(...snap.out.requestDD.map((r) => r.d))).toBeGreaterThan(0.03);
  }, 60000);
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
  passTest("plan 13d known limits gone (plan 14): the L3-F9 one-arm defenders' and L3-F1-falling's conversions are accepted, none rejected", [DEFENDER_13F]);
  it('plan 13d known limits gone (plan 14), natural sample: the L3-F9 one-arm defenders and L3-F1-falling convert at their labelled conversion (taken before CARRIER_BRACE_V2)', async () => {
    // under V2 L3-F9-defenderRising's D loses support at 0.796 s, before its label: the sample is kept as it was taken.
    // (The drive flip: under WRAP_V5 these defenders take their carriers down before their labels; the sample is in the
    // runs before it, `preWrapV5` after the ride-down's `preWrapV7` and the bound-legs fall's `preWrapV8`)
    const fails: string[] = [];
    const rep = (m: string): void => void fails.push(m);
    for (const id of DEFENDER_13F_SAMPLE.fixtures as string[]) {
      const def = preBraceV2(preWrapV5(preWrapV7(preWrapV8(preWrapV9(preWrapV10(preWrapV11(preWrapV12(preWrapV13(FIX(id))))))))));
      await runWatched(def, [{ w: DEFENDER_13F_SAMPLE.watch(def, rep), fail: rep }], { transitionAudit: true });
    }
    expect(fails).toEqual([]);
  }, 120000);
  passTest(
    'contact entry: preparation unwinds with no contact (L3-F2); the mode follows the first observed contact within a tick (L3-F3); legs keep stepping in contact and tackles end as their copies do (L3-F4/F5)',
    [PREP_UNWINDS, FOLLOWS_CONTACT, KEEP_STEPPING],
  );
  passTest(
    'hold and exit: a stationary hold settles (L3-F6); a saturating load released does not launch (L3-F6/F7); contact clears from every run phase and side (L3-F7); a recontact in exit is named and audited (L3-F8)',
    [HOLD_SETTLES, NO_LAUNCH, CLEARS, RECONTACT],
  );
  // ladder 15: the visible bar for feet and root replaced the pinned plant failures (L3-F14-lateral's one, under a 3.5 cm
  // slide; L3-F16-kick's two; none on the stops and the other walks) and root heights (L3-F6-saturated under 0.913 m, the
  // others under 0.91); the failed plants, slides, drifts and root errors are printed
  passTest(`no skate (a plant sliding over ${SLIDE_M * 100} cm): every L3 fixture; no launch (a supported root over ${ROOT_M * 100} cm above its target with a plant under it): the released saturating loads`, [PLANT_ROOT], () => {
    printByFamily('plants and root (ladder 15 meter): failed plants and their largest slide, the largest plant drift, the largest root error over target', PLANT_SEEN, (xs) => {
      const [hzAt, hz] = worstOf(xs, (r) => r.failedHzM);
      const [, dr] = worstOf(xs, (r) => r.driftM);
      const [upAt, up] = worstOf(xs, (r) => r.rootUpM);
      return `${xs.reduce((a, [, r]) => a + r.failed, 0)} failed (largest slide ${cm(hz.failedHzM)}, ${hzAt}), drift ${cm(dr.driftM)} (${dr.at}), root ${cm(up.rootUpM)} over (${upAt})`;
    });
    console.log(`root peaks (ladder 15 meter): ${[...ROOT_PEAK].map(([id, y]) => `${id} ${y.toFixed(4)} m`).join('; ')}`);
  });
  it('no skate, no launch, constructed: a failed plant\'s slide, a plant\'s drift and a root over its target, each just past its gate, fail the rule; just inside, pass', () => {
    // the fault twin of PLANT_ROOT on records the test makes (the rule reads the record only; tests/l3-pass.ts plantRoot
    // makes it from the run): L3-F14-lateral's recorded failed plant (3.36 cm, a pass) and each part at 1 mm either side
    const inside = { failed: [{ hzM: 0.0336, at: 'L3-F14-lateral R left 1.1417' }], drift: { m: SLIDE_M - 0.001, at: 'd' }, rootUp: { m: ROOT_M - 0.001, at: 'r' } };
    expect(plantRootBreaches(inside)).toEqual([]);
    expect(plantRootBreaches({ ...inside, failed: [...inside.failed, { hzM: SLIDE_M + 0.001, at: 'f' }] })).toEqual(['f: a plant failed on a 5.10 cm slide (over 5 cm)']);
    expect(plantRootBreaches({ ...inside, drift: { m: SLIDE_M + 0.001, at: 'd' } })).toEqual(['d: a plant slid 5.10 cm (over 5 cm)']);
    expect(plantRootBreaches({ ...inside, rootUp: { m: ROOT_M + 0.001, at: 'r' } })).toEqual(["r: the root 10.10 cm over its support's target (over 10 cm)"]);
    expect(plantRootBreaches({ ...inside, rootUp: { m: ROOT_M + 0.001, at: 'r' } }, false)).toEqual([]);
  });
  passTest(
    'conversions: a player below stays a support-budget regression (L3-F9); either or both convert with retention (L3-F10); a genuine bad candidate is rejected with the safe fallback (L3-F11)',
    [PLAYER_BELOW, RETAINED, BAD_CANDIDATE],
  );
  passTest(
    'held arms: real palm holds keep the anchor and arm segments within Gate 2 through entry and remap within Gate 4; real forearm clamps keep the segments and end only for an engine reason',
    [PALM_HOLDS, CLAMPS],
  );
  it('held arms, the side wrap as a wrap (L3-F4-twoArm under WRAP_V11 with no request: a hit since the hit flip, which clamps nothing): real forearm clamps keep the segments and end only for an engine reason. The twin, the registered hit: no clamp, the watch fails', async () => {
    const watched = async (d: FixtureDef): Promise<string[]> => {
      const fails: string[] = [];
      const c = CHECKS.find((x) => x.name === CLAMPS)!;
      await runWatched(d, [{ w: c.watch(d, (m) => fails.push(m)), fail: (m) => fails.push(m) }]);
      return fails;
    };
    const d = preWrapV12(preWrapV13(FIX('L3-F4-twoArm')));
    expect(d.wrap!.hit).toBeUndefined();
    expect(await watched(d)).toEqual([]);
    const twin = await watched(FIX('L3-F4-twoArm'));
    expect(twin.join('\n')).toMatch(/expected 0 to be greater than 0/);
  }, 120000);
  it('held arms, constructed: a hold ended before the conversion or with no reason is reported, and one ended in the conversion\'s own step after it is not', () => {
    // ladder 18e: the fault twin of `holdsEndedEarly` (the palm holds' end rule above), on event lists the test makes. The
    // rule was each release strictly after the conversion's time; since the met-arm flip a hold may end in the
    // conversion's own step, after it (L3-F4-gripTarget D's left at 0.900 s, its arm meeting the ragdoll's forearm)
    const rep = { type: 'representation', t: 0.9, data: { from: 'proxy', to: 'ragdoll' } };
    const rel = (t: number, grip: string, reason?: string) => ({ type: 'gripRelease', t, data: { grip, ...(reason ? { reason } : {}) } });
    expect(holdsEndedEarly([rep, rel(0.9, 'D:left:g2', 'invalidPose'), rel(1.17, 'D:right:g1', 'invalidPose')])).toEqual([]);
    expect(holdsEndedEarly([rel(0.9, 'D:left:g2', 'invalidPose'), rep])).toEqual(['0.9000 D:left:g2']);
    expect(holdsEndedEarly([rel(0.5, 'D:left:g2', 'voluntary'), rep, rel(1.17, 'D:right:g1', 'invalidPose')])).toEqual(['0.5000 D:left:g2']);
    expect(holdsEndedEarly([rep, rel(1.17, 'D:right:g1')])).toEqual(['1.1700 D:right:g1']);
    expect(holdsEndedEarly([rel(1.17, 'D:right:g1', 'invalidPose')])).toEqual(['1.1700 D:right:g1']);
  });
  passTest('negative control: the retention measures fail a stretched limb and a shifted anchor, and the wrong player has no hold', [RETENTION_BITES]);
});

// ---------------------------------------------------------------------------------------------------------------------
// The carried ball (plan 08a, plan 10d D1(a)): what tests/ball-carry.test.ts checked on runs of registered L3 fixtures

describe('the carried ball over the L3 pass (plan 08a, plan 10d D1(a))', () => {
  passTest(`contact and recontact: ownership changes with no pop of the ball (${POP_M * 100} cm), on the achieved arm`, [CARRY_AUDIT], () => {
    // (ladder 15: the limit was 1 cm and the boundaries a floor of 30; the ball's boundaries are printed)
    let boundaries = 0;
    for (const r of CARRY_BOUNDARIES.values()) boundaries += r.boundaries;
    expect(boundaries).toBeGreaterThan(0);
    console.log(`carried ball at the boundaries (ladder 15 meter): ${[...CARRY_BOUNDARIES].map(([id, r]) => `${id} ${r.boundaries} boundaries, largest ${cm(r.ball)}`).join('; ')}`);
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
      // (ladder 15: at least one tick and one ending, printed; they were floors of 2000 ticks and 15 endings)
      console.log(`the drawn ball (ladder 15 meter): ${ticks} ticks, ${seated} seated, ${endings} endings over ${RULE_FIXTURES.length} rule fixtures`);
      expect(ticks).toBeGreaterThan(0);
      expect(seated).toBeGreaterThan(0.9 * ticks);
      expect(endings).toBeGreaterThan(0);
    },
  );
});
