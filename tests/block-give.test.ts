// Plan 16 (p36), giving ground (block-base.ts `GiveGround`, GIVE_V1, `advanceGive`; controllers/block.ts `withGive`): how
// far a man in a block is pushed past his base, followed by a level, and his posture and request for it (stood up, his
// drive taken out). The level on constructed demands; the controller's answer to a level shown it; then constructed
// scenes from the BL family's package (fixtures/blocking.ts `blockScene` on L3-F6-hold's definition). Each case has its
// fault twin: a level read with no base, a level that never releases, a level read by a profile without `give`, a
// scene whose man has no base, the hard drive against the even hold.
import { describe, expect, it } from 'vitest';
import { advanceGive, BASE_V2, BASE_V3, GIVE_V1, type GiveGround, type GiveState } from '../src/sim/block-base';
import type { Controller, ControllerContext } from '../src/sim/controllers/base';
import { BLOCK_V1, withBase, withGive, type BlockProfile } from '../src/sim/controllers/block';
import type { ArmSide, PlayerIntent } from '../src/sim/contracts';
import type { FixtureDef } from '../src/sim/fixture';
import { BLOCK_V1_HARD, blockScene, type BlockMan } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, v3 } from '../src/sim/vec';
import { FIX, runSim } from './helpers';

const SIDES: ArmSide[] = ['left', 'right'];
const W = 867;
const DT = 1 / 240;

/** Runs the level for `s` seconds at a constant demand and base (N m), from `st`. */
const hold = (st: GiveState, G: GiveGround, demandNm: number, backNm: number, s: number): GiveState => {
  for (let i = 0; i < Math.round(s / DT); i++) advanceGive(st, G, demandNm, backNm, W, DT);
  return st;
};
const fresh = (): GiveState => ({ excessM: 0, level: 0 });

const man = (profile: BlockProfile, effort: number, intent: 'hold' | 'drive', hands: 'under' | 'over'): BlockMan => ({ effort, intent, hands, profile });
const scene = (P: BlockProfile, effort: number, intent: 'hold' | 'drive', durationS: number): FixtureDef =>
  blockScene({ id: 'BL-T-give', title: 'plan 16 giving ground (test)', A: man(P, effort, intent, 'under'), B: man(P, effort, intent, 'over'), durationS }, FIX('L3-F6-hold'));

/** A controller that answers twice from one context, its level shown as 0 and as 1; it acts on the first (the tests' wrapper). */
const twice = (inner: Controller, seen: (i0: PlayerIntent, i1: PlayerIntent, ctx: ControllerContext) => void): Controller =>
  Object.assign(Object.create(Object.getPrototypeOf(inner)), inner, {
    decide: (ctx: ControllerContext) => {
      const at = (g: number): ControllerContext => {
        const b = ctx.observed.block?.[ctx.self];
        return b ? { ...ctx, observed: { ...ctx.observed, block: { ...ctx.observed.block, [ctx.self]: { ...b, give: g } } } } : ctx;
      };
      const i1 = inner.decide.call(inner, at(1));
      const i0 = inner.decide.call(inner, at(0));
      seen(i0, i1, ctx);
      return i0;
    },
  });

describe('plan 16, giving ground (GIVE_V1)', () => {
  it('(a) the level: inside his base it stays 0; pushed past it, it follows the excess over fullM within its attack and is never past 1; the same demand read with no base (fault twin) raises it', () => {
    const inside = hold(fresh(), GIVE_V1, 90, 100, 1);
    expect(inside.level, 'level inside the base').toBe(0);
    expect(inside.excessM, 'excess inside the base (m)').toBe(0);
    const noBase = hold(fresh(), GIVE_V1, 90, 0, 1);
    expect(noBase.excessM, 'excess, the same demand read with no base (m)').toBeCloseTo(90 / W, 9);
    expect(noBase.level, 'level, the same demand read with no base').toBeGreaterThan(0.5);
    // 0.1 m past the base: two thirds of fullM (0.15), reached within 3 attacks
    const past = hold(fresh(), GIVE_V1, 100 + 0.1 * W, 100, 3 * GIVE_V1.attackS);
    expect(past.excessM, 'excess 0.1 m past the base (m)').toBeCloseTo(0.1, 9);
    expect(past.level, 'level after 3 attacks, 0.1 m past').toBeGreaterThan(0.9 * (0.1 / GIVE_V1.fullM));
    expect(hold(past, GIVE_V1, 100 + 0.1 * W, 100, 1).level, 'level held 1 s at 0.1 m past').toBeCloseTo(0.1 / GIVE_V1.fullM, 6);
    expect(hold(fresh(), GIVE_V1, 100 + 2 * W, 100, 2).level, 'level 2 m past the base').toBeLessThanOrEqual(1);
  });

  it('(b) a short hit releases: 0.1 s at 0.3 m past his base takes the level past 0.9, and 0.5 s back inside it is under 0.1; a level that never releases (fault twin: releaseS 10 s) is still past 0.5', () => {
    for (const [G, releases] of [
      [GIVE_V1, true],
      [{ ...GIVE_V1, id: 'test-give-held', releaseS: 10 }, false],
    ] as const) {
      const st = hold(fresh(), G, 100 + 0.3 * W, 100, 0.1);
      expect(st.level, `level at the hit's end (${G.id})`).toBeGreaterThan(0.9);
      hold(st, G, 50, 100, 0.5);
      if (releases) expect(st.level, 'level 0.5 s after the hit').toBeLessThan(0.1);
      else expect(st.level, 'level 0.5 s after the hit, never released').toBeGreaterThan(0.5);
    }
  });

  it("(c) his answer: engaged with a palm on, shown level 1 he asks his stance's hips riseM higher and no drive into his man, never more than at level 0; a profile without `give` shown the same level (fault twin) keeps his stance and drive", async () => {
    for (const [P, gives] of [
      [withGive(withBase(BLOCK_V1_HARD, BASE_V2, 0.03), GIVE_V1), true],
      [withBase(BLOCK_V1_HARD, BASE_V2, 0.03), false],
    ] as const) {
      const sim = await Simulation.create(scene(P, 1, 'drive', 2.5), {});
      const A = sim.players.find((p) => p.id === 'A')!;
      const r = { n: 0, riseMax: -Infinity, riseMin: Infinity, along0: -Infinity, along1: -Infinity, more: 0 };
      A.controller = twice(A.controller, (i0, i1, ctx) => {
        // (engaged with a palm on: his drive; chest to chest with none on he backs to arm's length, as without `give`)
        if (ctx.observed.block?.A?.phase !== 'engaged' || !SIDES.some((s) => !!ctx.observed.arms.A?.[s]?.pushId)) return;
        const me = ctx.observed.bodies.A.position;
        const to = ctx.observed.bodies.B.position;
        const u = norm(v3(to.x - me.x, 0, to.z - me.z));
        const rise = i1.locomotion.stance!.heightM! - i0.locomotion.stance!.heightM!;
        const a0 = dot(i0.locomotion.desiredVelocityWorld, u);
        const a1 = dot(i1.locomotion.desiredVelocityWorld, u);
        r.n++;
        r.riseMax = Math.max(r.riseMax, rise);
        r.riseMin = Math.min(r.riseMin, rise);
        r.along0 = Math.max(r.along0, a0);
        r.along1 = Math.max(r.along1, a1);
        if (a1 > Math.max(0, a0) + 1e-9) r.more++;
      });
      await runSim(sim, Infinity);
      sim.dispose();
      expect(r.n, 'engaged decisions').toBeGreaterThan(100);
      expect(r.along0, "drive into his man at level 0 (m/s)").toBeGreaterThan(0.5);
      if (!gives) {
        expect(r.riseMax, 'stance raised, no give').toBe(0);
        expect(r.riseMin, 'stance lowered, no give').toBe(0);
        expect(r.along1, 'drive into his man shown level 1, no give (m/s)').toBeGreaterThan(0.5);
        continue;
      }
      expect(r.riseMax, 'stance raised at level 1 (m)').toBeCloseTo(GIVE_V1.riseM, 9);
      expect(r.riseMin, 'stance raised at level 1, least (m)').toBeCloseTo(GIVE_V1.riseM, 9);
      expect(r.along1, 'drive into his man at level 1 (m/s)').toBeLessThanOrEqual(1e-9);
      expect(r.more, 'decisions asking more into his man at level 1 than at 0').toBe(0);
    }
  }, 180_000);

  it('(d) in the hard drive (as BL-F7-hard) on flat-foot bearing (BASE_V3) the level goes past 0.5, read from the base; with no base (fault twin) it stays 0; in an even hold at effort 0.5 (as BL-F1-even) on BASE_V2 it stays 0 (the hard drive its twin)', async () => {
    const top = async (P: BlockProfile, effort: number, intent: 'hold' | 'drive'): Promise<Record<string, number>> => {
      const r: Record<string, number> = {};
      let sim!: Simulation;
      sim = await Simulation.create(scene(P, effort, intent, 3.5), {
        onSubstep: () => {
          for (const p of sim.players) if (p.block?.give) r[p.id] = Math.max(r[p.id] ?? 0, p.block.give.level);
        },
      });
      await runSim(sim, Infinity);
      sim.dispose();
      return r;
    };
    const hard = await top(withGive(withBase(BLOCK_V1_HARD, BASE_V3, 0.03), GIVE_V1), 1, 'drive');
    expect(Math.max(hard.A, hard.B), 'highest level, hard drive on BASE_V3').toBeGreaterThan(0.5);
    const none = await top(withGive(BLOCK_V1_HARD, GIVE_V1), 1, 'drive');
    expect(Math.max(none.A ?? 0, none.B ?? 0), 'highest level, hard drive with no base').toBe(0);
    const even = await top(withGive(withBase(BLOCK_V1, BASE_V2, 0.03), GIVE_V1), 0.5, 'hold');
    expect(Math.max(even.A, even.B), 'highest level, even hold on BASE_V2').toBe(0);
  }, 240_000);
});
