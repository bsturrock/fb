// Plan 16 (p37), the contest (block-base.ts `BlockContest`, CONTEST_V1, `contestFeet`, `contestCapacity`,
// `contestForce`, `advanceContest`; motor-step.ts `contestDrive`; controllers/block.ts `withContest`; fixtures/blocking.ts
// `contested`): who is moved in a block, how far and how fast, decided by each man's push and hold. The capacity and
// the force on constructed inputs; then constructed scenes from the BL family's package (fixtures/blocking.ts
// `blockScene` on L3-F6-hold's definition), every man on the contest, his athletic stance (ATHLETIC_V1) and the strike.
// Each case has its fault twin: a capacity blind to his feet and to being stood up, a hold that pushes, equal
// capacities, the drive's velocity servo and a level that never releases, the sole clamp of a base (BASE_V3), no fall.
import { describe, expect, it } from 'vitest';
import { advanceContest, BASE_V3, CONTEST_V1, contestCapacity, contestFeet, contestForce, newContest, type BlockContest } from '../src/sim/block-base';
import { ATHLETIC_V1, BLOCK_STRIKE_V1, BLOCK_V1, withBase, withStrike, type BlockProfile } from '../src/sim/controllers/block';
import type { ArmSide } from '../src/sim/contracts';
import type { SimDebug } from '../src/sim/debug';
import type { FixtureDef } from '../src/sim/fixture';
import { BLOCK_V1_HARD, blockScene, contested, type BlockMan } from '../src/sim/fixtures/blocking';
import type { FootPlan } from '../src/sim/footwork';
import { Simulation } from '../src/sim/simulation';
import { qFromAxisAngle, v3 } from '../src/sim/vec';
import { FIX } from './helpers';

const DT = 1 / 240;
const rad = (d: number) => (d * Math.PI) / 180;

/** A two-foot plan for `contestFeet` (the model's shoe): each foot planted flat, planted with its sole pitched `deg`, or in a step. */
const plan = (left: 'flat' | 'swing' | number, right: 'flat' | 'swing' | number): FootPlan => {
  const foot = (s: ArmSide, f: 'flat' | 'swing' | number) => ({
    mode: f === 'swing' ? 'swing' : 'planted',
    ankleW: v3(s === 'left' ? 0.15 : -0.15, 0.09, 0),
    footQ: typeof f === 'number' ? qFromAxisAngle(v3(1, 0, 0), rad(f)) : { x: 0, y: 0, z: 0, w: 1 },
  });
  return { shoe: { he: v3(0.05, 0.035, 0.13), centerFoot: v3(0, -0.055, 0.05) }, feet: { left: foot('left', left), right: foot('right', right) } } as unknown as FootPlan;
};

const cap = (K: BlockContest, p: FootPlan, level: number) => {
  const f = contestFeet(p, K);
  return contestCapacity(K, { effort: 0.6, lowM: 0, feet: f.share, level, anchored: f.setFeet > 0, leverage: 1, driveCapN: 1e4, burstN: 0 });
};

interface Tick {
  t: number;
  z: Record<string, number>;
  lean: Record<string, number>;
  sup: Record<string, boolean>;
  /** His speed along the line to his man that his contest's force was found at (m/s, + toward him), the force, its push and hold, his push capacity, the drive's bound, the overpowered clock. */
  c: Record<string, { v: number; F: number; push: number; hold: number; pushN: number; driveCap: number; overT: number | null } | null>;
}
interface Run {
  ticks: Tick[];
  /** The first palm push either way (s). */
  tc: number;
  falls: { id: string; t: number; reason: string }[];
}

/** Runs a scene to its end, a row per tick. */
async function run(def: FixtureDef, debug?: SimDebug): Promise<Run> {
  const sim = await Simulation.create(def, debug ? { debug } : {});
  const ticks: Tick[] = [];
  const falls: Run['falls'] = [];
  let tc = NaN;
  let ev = 0;
  try {
    while (!sim.done) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev] as { type: string; t: number; playerId: string; data: { reason?: string } };
        if (e.type === 'pushBegin' && Number.isNaN(tc)) tc = e.t;
        if (e.type === 'lossOfSupport') falls.push({ id: e.playerId, t: e.t, reason: e.data.reason ?? '' });
      }
      const row: Tick = { t: sim.t, z: {}, lean: {}, sup: {}, c: {} };
      for (const pl of sim.players) {
        row.z[pl.id] = sim.coreBody(pl).translation().z;
        row.sup[pl.id] = pl.controlMode === 'supported';
        row.lean[pl.id] = row.sup[pl.id] ? pl.balance.theta : NaN;
        const c = pl.block?.contest;
        row.c[pl.id] = c && c.vPrev !== null && row.sup[pl.id] ? { v: c.vPrev, F: c.forceN, push: c.pushF, hold: c.holdF, pushN: c.pushN, driveCap: pl.applied.driveCap, overT: c.overT } : null;
      }
      ticks.push(row);
    }
  } finally {
    sim.dispose();
  }
  return { ticks, tc, falls };
}

const at = (r: Run, t: number): Tick => r.ticks.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b), r.ticks[0]);
/** How far a man moved away from his man between two times (m; A starts at -z, B at +z). */
const back = (r: Run, id: 'A' | 'B', t0: number, t1: number): number => (id === 'B' ? 1 : -1) * (at(r, t1).z[id] - at(r, t0).z[id]);
const peakLean = (r: Run, id: string): number => Math.max(...r.ticks.map((x) => (x.sup[id] ? x.lean[id] : 0)));

const reg = (): FixtureDef => FIX('L3-F6-hold');
const man = (effort: number, intent: 'hold' | 'drive', hands: 'under' | 'over', profile: BlockProfile, more: Partial<BlockMan> = {}): BlockMan => ({ effort, intent, hands, profile, athletic: ATHLETIC_V1, ...more });
const scene = (A: BlockMan, B: BlockMan, durationS: number, more: { sepM?: number } = {}): FixtureDef => blockScene({ id: 'BL-T-contest', title: 'plan 16 the contest (test)', A, B, durationS, ...more }, reg());
/** As BL-F1-even: both hold at effort 0.5. As BL-F3-blockerDrives: A drives at effort 1, B holds at effort 0.4. */
const even = (P: BlockProfile = contested()): FixtureDef => scene(man(0.5, 'hold', 'under', P), man(0.5, 'hold', 'over', P), 3);
const uneven = (PA: BlockProfile = contested(), PB: BlockProfile = PA): FixtureDef => scene(man(1, 'drive', 'under', PA), man(0.4, 'hold', 'over', PB), 3);
/** The drive's velocity servo in place of the contest (the same strike and stance). */
const SERVO = withStrike({ ...BLOCK_V1, stance: { ...BLOCK_V1.stance, widthAddM: 0.03 } }, BLOCK_STRIKE_V1);
let unevenRun: Promise<Run> | null = null;
const unevenOnce = (): Promise<Run> => (unevenRun ??= run(uneven()));

describe('plan 16, the contest (CONTEST_V1)', () => {
  it('(a) his capacity: both feet planted flat holds and pushes most; one foot in a step, a planted heel past the flat limit, or stood up, less; a capacity blind to his feet and to being stood up (fault twin) the same for all', () => {
    const blind: BlockContest = { ...CONTEST_V1, id: 'test-contest-blind', oneFoot: 1, set: { heelM: 1, pitchDeg: 90 }, stood: { ...CONTEST_V1.stood, holdCut: 0, pushCut: 0 } };
    for (const [K, sees] of [
      [CONTEST_V1, true],
      [blind, false],
    ] as const) {
      const planted = cap(K, plan('flat', 'flat'), 0);
      expect(planted.holdN, `hold, both feet planted flat (${K.id})`).toBeGreaterThan(100);
      for (const [what, c] of [
        ['one foot in a step', cap(K, plan('flat', 'swing'), 0)],
        ['a planted heel 25 deg up', cap(K, plan('flat', 25), 0)],
        ['stood up (level 1)', cap(K, plan('flat', 'flat'), 1)],
      ] as const) {
        if (sees) {
          expect(c.holdN, `hold, ${what}`).toBeLessThan(0.9 * planted.holdN);
          expect(c.pushN, `push, ${what}`).toBeLessThan(0.9 * planted.pushN);
        } else {
          expect(c.holdN, `hold, ${what}, blind`).toBeCloseTo(planted.holdN, 6);
          expect(c.pushN, `push, ${what}, blind`).toBeCloseTo(planted.pushN, 6);
        }
      }
    }
    // in the air (no planted foot) he is not anchored and holds nothing
    expect(cap(CONTEST_V1, plan('swing', 'swing'), 0).holdN, 'hold, both feet in a step').toBe(0);
  });

  it('(b) no work from nowhere: his hold only ever opposes his motion beyond his request and his push stays within his capacity, on every speed and request, and in a drive (as BL-F3) every substep with the hold under 0 W and the push within the drive bound; a hold that pushes (fault twin) does positive work', async () => {
    const c = { pushN: 300, brakeN: 200, holdN: 150 };
    for (let v = -1.5; v <= 1.5; v += 0.05)
      for (const want of [-0.3, 0, 0.16, 0.8, 1.4]) {
        const f = contestForce(CONTEST_V1, c, v, want);
        expect(f.hold * (v - Math.min(0, want)), `hold power beyond his request at v ${v.toFixed(2)}, want ${want}`).toBeLessThanOrEqual(1e-9);
        expect(Math.abs(f.push), `push at v ${v.toFixed(2)}, want ${want}`).toBeLessThanOrEqual(c.pushN + 1e-9);
        expect(f.push, `braking at v ${v.toFixed(2)}, want ${want}`).toBeGreaterThanOrEqual(-c.brakeN - 1e-9);
        expect(contestForce(CONTEST_V1, c, v, want, true).hold, 'the fault: the hold pushes whatever his motion').toBe(c.holdN);
      }
    for (const [debug, pushes] of [
      [undefined, false],
      [{ block: { contestHoldPushes: true } }, true],
    ] as const) {
      const r = debug ? await run(uneven(), debug) : await unevenOnce();
      let holdWork = 0;
      let maxHoldW = -Infinity;
      for (const x of r.ticks)
        for (const id of ['A', 'B']) {
          const c2 = x.c[id];
          if (!c2) continue;
          // (a tick's sample of the substep that ends it; the hold's power is its force times his speed along the line)
          maxHoldW = Math.max(maxHoldW, c2.hold * c2.v);
          holdWork += Math.max(0, c2.hold * c2.v) / 60;
          expect(c2.push, `push within the drive's bound at ${x.t.toFixed(2)} (${id})`).toBeLessThanOrEqual(c2.driveCap + 1e-6);
        }
      if (pushes) expect(holdWork, 'positive work by a hold that pushes (J)').toBeGreaterThan(5);
      else {
        expect(maxHoldW, 'the hold power, most of any tick (W)').toBeLessThanOrEqual(1e-6);
        expect(holdWork, 'positive work by the hold (J)').toBe(0);
      }
    }
  }, 240_000);

  it('(c) an even pair (as BL-F1) moves little; uneven (as BL-F3) the weaker is moved back more than 0.2 m in 3 s; uneven with equal capacities (fault twin: the capacity blind to effort) moves little', async () => {
    const e = await run(even());
    for (const id of ['A', 'B'] as const) expect(Math.abs(back(e, id, 0, 3)), `travel, even (${id}, m)`).toBeLessThan(0.1);
    const u = await unevenOnce();
    expect(back(u, 'B', 0, 3), 'the weaker man moved back, uneven (m)').toBeGreaterThan(0.2);
    const blind = await run(uneven(), { block: { contestEffortBlind: true } });
    expect(back(blind, 'B', 0, 3), 'the weaker man moved back, equal capacities (m)').toBeLessThan(0.1);
    expect(e.falls.length + u.falls.length, 'falls, even and uneven').toBe(0);
  }, 300_000);

  it('(d) the first collision is the main move: uneven, the weaker man goes back further in the second after first contact than in the second after it; with the drive servo or a level that never releases (fault twins) the next second goes further', async () => {
    const stuck: BlockProfile = { ...contested(), contest: { ...CONTEST_V1, id: 'test-contest-stuck', stood: { ...CONTEST_V1.stood, releaseS: 100 } } };
    for (const [what, r, main] of [
      ['contest', await unevenOnce(), true],
      ['servo', await run(uneven(SERVO)), false],
      ['never released', await run(uneven(stuck)), false],
    ] as const) {
      expect(Number.isFinite(r.tc), `first contact (${what})`).toBe(true);
      const first = back(r, 'B', r.tc, r.tc + 1);
      const next = back(r, 'B', r.tc + 1, r.tc + 2);
      if (main) {
        expect(first, 'the first second (m)').toBeGreaterThan(0.12);
        expect(first, 'the first second against the next (m)').toBeGreaterThan(2 * next);
      } else expect(next, `the next second against the first (${what}, m)`).toBeGreaterThan(first);
    }
  }, 300_000);

  it('(e) a planted flat man is moved, not tipped: uneven, the weaker man goes back more than 0.2 m with his legs within 12 deg and stays up; on the sole clamp of a base (fault twin: BASE_V3) he planks past the anchor and goes down', async () => {
    const u = await unevenOnce();
    expect(back(u, 'B', 0, 3), 'moved back (m)').toBeGreaterThan(0.2);
    expect(peakLean(u, 'B'), "his legs' lean, most (deg)").toBeLessThan(rad(12));
    expect(u.falls.filter((f) => f.id === 'B'), 'his falls').toEqual([]);
    const sole = await run(uneven(contested(), withBase(contested(), BASE_V3, 0.03)));
    expect(peakLean(sole, 'B'), "his legs' lean on the sole clamp, most (deg)").toBeGreaterThan(rad(CONTEST_V1.anchorLeanDeg));
    expect(sole.falls.find((f) => f.id === 'B')?.reason, 'his fall on the sole clamp').toBe('contest:pastAnchor');
  }, 300_000);

  it('(f) overpowered, he goes down as a ragdoll: run over at 3 m/s at effort 0 by a hard drive, the overpowered clause takes him down, supported at most a substep past its clock and never past the anchor longer than its time; with no fall (fault twin) he is run back supported, overpowered, past 1 s', async () => {
    const run3 = (debug?: SimDebug) =>
      run(scene(man(1, 'drive', 'under', contested(BLOCK_V1_HARD), { walkInMps: 3 }), man(0, 'hold', 'over', contested()), 4, { sepM: 3.5 }), debug);
    for (const [debug, falls] of [
      [undefined, true],
      [{ block: { contestNoFall: true } }, false],
    ] as const) {
      const r = await run3(debug);
      // the longest he stays supported with the overpowered clause holding
      let over = 0;
      for (const x of r.ticks) if (x.sup.B && x.c.B?.overT != null) over = Math.max(over, x.t - x.c.B.overT);
      let past = 0;
      let run0: number | null = null;
      for (const x of r.ticks) {
        const beyond = x.sup.B && x.lean.B > rad(CONTEST_V1.anchorLeanDeg);
        if (beyond) run0 ??= x.t;
        else run0 = null;
        if (run0 !== null) past = Math.max(past, x.t - run0);
      }
      expect(past, 'supported past the anchor, longest (s)').toBeLessThanOrEqual(CONTEST_V1.fall.leanS + 2 / 60);
      if (falls) {
        const f = r.falls.find((x) => x.id === 'B');
        expect(f?.reason, 'his fall').toBe('contest:overpowered');
        expect(over, 'supported with the clause holding, longest (s)').toBeLessThanOrEqual(CONTEST_V1.fall.overS + 1 / 60);
        expect(at(r, f!.t + 0.1).sup.B, 'supported 0.1 s after his fall').toBe(false);
      } else expect(over, 'supported with the clause holding, longest, no fall (s)').toBeGreaterThan(1);
    }
  }, 300_000);

  it('(g) the clauses on constructed motion: knocked back at 4 m/s2 the level goes past 0.9 within 0.1 s and under 0.1 within 1 s of it ending; a steady drive stands nobody up; leaned 25 deg he is down past the anchor in under 0.2 s, 19 deg never; a lean clause that waits 1 s (fault twin) is not down by 0.2 s', () => {
    const K = CONTEST_V1;
    const st = newContest();
    let v = 0;
    let t = 0;
    const step = (dv: number, lean = 0, Kx: BlockContest = K, s = st) => {
      v += dv * DT;
      t += DT;
      advanceContest(s, Kx, { v, behindM: 0, margin: -1, leanRad: rad(lean) }, t, DT);
    };
    for (let i = 0; i < 0.1 / DT; i++) step(-4);
    expect(st.level, 'level after 0.1 s at 4 m/s2 back').toBeGreaterThan(0.9);
    for (let i = 0; i < 1 / DT; i++) step(0);
    expect(st.level, 'level 1 s after (a steady speed back)').toBeLessThan(0.1);
    expect(st.down, 'down after the knock').toBeUndefined();
    const leaned = (deg: number, Kx: BlockContest) => {
      const s = newContest();
      v = 0;
      for (let i = 0; i < 0.2 / DT; i++) step(0, deg, Kx, s);
      return s.down;
    };
    expect(leaned(25, K), 'leaned 25 deg for 0.2 s').toBe('pastAnchor');
    expect(leaned(19, K), 'leaned 19 deg for 0.2 s').toBeUndefined();
    expect(leaned(25, { ...K, id: 'test-contest-slow-lean', fall: { ...K.fall, leanS: 1 } }), 'leaned 25 deg for 0.2 s, the clause waiting 1 s').toBeUndefined();
  });
});
