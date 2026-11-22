// Plan 16 (p48): a strike thrown from the load's close gap within the engaged reach (`BlockStrike.strike.atLoadGapM`,
// `withStrikeAtLoadGap`, STRIKE_AT_LOAD_GAP_M). The rule on constructed punches; then BL-F8-hardNoHinge under the full set
// of the newer runs with the lane called on the strike, in both player orders. With its fault twins: two loaded men
// stopped at their close gaps 1 cm outside `contactM` never strike, and the lane is never called.
import { describe, expect, it } from 'vitest';
import { BLOCK_STRIKE_V2, nextPunch, STRIKE_AT_LOAD_GAP_M, withStrikeAtLoadGap, type BlockStrike, type PunchCues, type PunchState } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { FIX, WITHOUT_NEWER } from './helpers';

describe('plan 16 (p48), the strike from the load gap', () => {
  // (BL-F8-hardNoHinge's: the lean-in's close gap, 0.675 m)
  const K0: BlockStrike = { ...BLOCK_STRIKE_V2, load: { ...BLOCK_STRIKE_V2.load, closeGapM: 0.675 } };
  const K = withStrikeAtLoadGap(K0, STRIKE_AT_LOAD_GAP_M);
  const loaded: PunchState = { n: 0, phase: 'load', since: 0, depth: 1 };
  // (both men's at 1.5 s: stopped at 0.675 m, 0.616 m from his man's chest, loaded, nothing between them)
  const at: PunchCues = { t: 1.5, serial: 0, gap: 0.675, closingMps: 0, engaged: false, reachM: 0.616, loaded: true, anyOn: false, straight: false, speedMps: 0 };
  it('the rule: loaded at the close gap, his man within the engaged reach, he strikes; not past 2 cm from it, nor past the reach, nor unloaded; fault twin: he stays loaded', () => {
    expect(nextPunch(K, 0.8, loaded, at)?.phase, 'at the gap').toBe('strike');
    expect(nextPunch(K, 0.8, loaded, { ...at, gap: 0.675 + 0.019 })?.phase, 'within 2 cm of it').toBe('strike');
    expect(nextPunch(K, 0.8, loaded, { ...at, gap: 0.675 + 0.021 })?.phase, 'further').toBe('load');
    expect(nextPunch(K, 0.8, loaded, { ...at, reachM: 0.67 })?.phase, 'past the engaged reach').toBe('load');
    expect(nextPunch(K, 0.8, loaded, { ...at, loaded: false })?.phase, 'not loaded').toBe('load');
    expect(nextPunch(K0, 0.8, loaded, at)?.phase, 'fault: loaded at the gap, waiting for contactM').toBe('load');
  });

  // BL-F8-hardNoHinge under the full set of the newer runs, the lane called on the strike
  const scene = (atGap: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F8-hardNoHinge')!;
    return blockScene({ ...s, ...WITHOUT_NEWER, id: 'BL-T-strike-load-gap', durationS: 3, seat: true, aimThrough: true, stanceCone: true, followThrough: true, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: true, foldKeeps: true, armsGive: true, laneTie: true, burstTaper: true, lowUnheld: true, palmSlide: true, laneOnStrike: true, upperArm: true, strikeAtLoadGap: atGap }, FIX('L3-F6-hold'));
  };
  interface Out {
    /** each man's first strike (s), and his lane's call (s) */
    struck: Record<string, number>;
    lanes: Record<string, number>;
    falls: string[];
  }
  async function run(atGap: boolean, reverseOrder: boolean): Promise<Out> {
    const sim = await Simulation.create(scene(atGap), { reverseOrder });
    const out: Out = { struck: {}, lanes: {}, falls: [] };
    while (!sim.done) {
      sim.stepTick();
      for (const p of sim.players) if (p.block?.punch?.phase === 'strike' && out.struck[p.id] === undefined) out.struck[p.id] = p.block.punch.since;
    }
    for (const e of sim.events) {
      if (e.type === 'blockLane' && e.playerId) out.lanes[e.playerId] = e.t;
      if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    }
    sim.dispose();
    return out;
  }

  it('BL-F8-hardNoHinge under the full set, the lane on the strike, both orders: both men strike from their close gaps by 1.5 s and the lane is called; nobody falls; fault twin: neither strikes in 3 s, no lane', async () => {
    for (const rev of [false, true]) {
      const on = await run(true, rev);
      expect(Math.max(on.struck.A ?? Infinity, on.struck.B ?? Infinity), `on (rev ${rev}): both struck`).toBeLessThan(1.5);
      expect(Object.keys(on.lanes).sort(), `on (rev ${rev}): the lane called`).toEqual(['A', 'B']);
      expect(on.falls, `on (rev ${rev}): nobody falls`).toEqual([]);
      const off = await run(false, rev);
      expect(off.struck, `fault (rev ${rev}): no strike`).toEqual({});
      expect(off.lanes, `fault (rev ${rev}): no lane`).toEqual({});
    }
  }, 120_000);
});
