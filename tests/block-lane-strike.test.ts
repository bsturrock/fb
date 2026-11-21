// Plan 16 (p48): the lane called only once a strike is thrown, with a true tie's stated rule (`BlockLanes.onStrike`,
// `withLaneOnStrike`, `decideLane`). The rule on constructed cases; then BL-F1-even (two men set 1.1 m apart, inside the
// call's 0.6 m from the reset) on the set BL-F9-threePoint runs, with the call on the strike, in both player orders. With
// its fault twins: called wherever the palms are, the lane goes from the ready hands at rest, before either man strikes,
// by a palm 1e-10 m nearer.
import { describe, expect, it } from 'vitest';
import { decideLane, LANE_TIE_V1, type LaneTouch } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { FIX } from './helpers';

describe('plan 16 (p48), the lane called once a strike is thrown', () => {
  const C = 0.6;
  const T = LANE_TIE_V1;
  it('the rule: none until a thrown palm is within the call; one thrown, his; both, nearer, lower, the driver, the greater effort, then the id that sorts first; the two men always opposite; fault twin: called at rest, 1e-10 m decides', () => {
    // (BL-F1-even's call from the ready hands at rest, 0.08 s in: A 1.6e-10 m further, 1.2e-7 m higher)
    const a: LaneTouch = { awayM: 0.5996011865861548, hipM: 0.7675035, drives: false, thrown: false, effort: 0.5, id: 'A' };
    const b: LaneTouch = { awayM: 0.5996011864287403, hipM: 0.7675034, drives: false, thrown: false, effort: 0.5, id: 'B' };
    expect(decideLane(a, b, C, T, true), 'at rest: none').toBeUndefined();
    expect(decideLane(a, b, C, T), 'fault: called at rest, by the 1e-10 m').toBe('outside');
    // (one thrown: his, though his palm is further than the other's resting hands)
    expect(decideLane({ ...a, thrown: true, awayM: 0.59 }, { ...b, awayM: 0.4 }, C, T, true), 'thrown first').toBe('inside');
    expect(decideLane({ ...b, awayM: 0.4 }, { ...a, thrown: true, awayM: 0.59 }, C, T, true)).toBe('outside');
    expect(decideLane({ ...a, thrown: true, awayM: 0.65 }, b, C, T, true), 'thrown, not within the call').toBeUndefined();
    // (a palm on him is thrown, at 0)
    expect(decideLane({ ...a, thrown: true, awayM: 0 }, { ...b, thrown: true, awayM: 0.1 }, C, T, true), 'on him').toBe('inside');
    // (both thrown: the bodies first, then the stated rule)
    const ta = { ...a, thrown: true };
    const tb = { ...b, thrown: true };
    const pair = (x: LaneTouch, y: LaneTouch) => [decideLane(x, y, C, T, true), decideLane(y, x, C, T, true)];
    expect(pair({ ...ta, awayM: 0.57 }, tb), 'nearer by 3 cm').toEqual(['inside', 'outside']);
    expect(pair({ ...tb, hipM: 0.75 }, ta), 'lower by 1.8 cm').toEqual(['inside', 'outside']);
    expect(pair({ ...tb, drives: true }, ta), 'level: the driver').toEqual(['inside', 'outside']);
    expect(pair({ ...tb, effort: 1 }, ta), 'level, both holding: the greater effort').toEqual(['inside', 'outside']);
    expect(pair(ta, tb), 'a true tie: the id that sorts first').toEqual(['inside', 'outside']);
    expect(pair(tb, ta), 'whichever is asked first').toEqual(['outside', 'inside']);
    expect(decideLane(ta, tb, C, T), 'fault: as before, the 1e-10 m').toBe('outside');
    // (without a tie: any difference of reach or height decides, as without the call on the strike)
    expect(decideLane(ta, tb, C, undefined, true), 'no tie: nearer by 1.6e-10 m').toBe('outside');
  });

  // BL-F1-even with the set BL-F9-threePoint runs (seat, lanes, tie, ... the slide), the call on the strike or not
  const scene = (onStrike: boolean): FixtureDef => {
    const { id: _i, title: _t, A: _a, B: _b, sepM: _s, durationS: _d, ...set } = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    const f1 = BL_SCENES.find((x) => x.id === 'BL-F1-even')!;
    return blockScene({ ...f1, ...set, id: 'BL-T-lane-strike', durationS: 1, laneOnStrike: onStrike }, FIX('L3-F6-hold'));
  };
  interface Out {
    lanes: Record<string, { lane: string; t: number }>;
    /** when each man's first strike was thrown (s, the substep its punch's strike began) */
    struck: Record<string, number>;
  }
  async function run(onStrike: boolean, reverseOrder: boolean): Promise<Out> {
    const sim = await Simulation.create(scene(onStrike), { reverseOrder });
    const out: Out = { lanes: {}, struck: {} };
    while (!sim.done) {
      sim.stepTick();
      for (const p of sim.players) if (p.block?.punch?.phase === 'strike' && out.struck[p.id] === undefined) out.struck[p.id] = p.block.punch.since;
    }
    for (const e of sim.events) if (e.type === 'blockLane' && e.playerId) out.lanes[e.playerId] = { lane: (e.data as { lane: string }).lane, t: e.t };
    sim.dispose();
    return out;
  }

  it('BL-F1-even, both orders: the lane is called once each, opposite, no earlier than the first strike is thrown, A inside (level reach, height, intent and effort: the stated tie), the same lanes in either order; fault twin: called from the hands at rest, before either man strikes', async () => {
    for (const rev of [false, true]) {
      const on = await run(true, rev);
      const la = on.lanes.A, lb = on.lanes.B;
      expect(la && lb, `on (rev ${rev}): called for both`).toBeTruthy();
      expect([la.lane, lb.lane], `on (rev ${rev}): A inside, B outside`).toEqual(['inside', 'outside']);
      const first = Math.min(on.struck.A ?? Infinity, on.struck.B ?? Infinity);
      expect(Number.isFinite(first), `on (rev ${rev}): a strike is thrown`).toBe(true);
      // (his punch as the last substep left it: the call comes a substep after the strike is thrown, or later)
      expect(Math.min(la.t, lb.t), `on (rev ${rev}): after the first strike is thrown`).toBeGreaterThan(first);
      const off = await run(false, rev);
      expect(Math.min(off.lanes.A.t, off.lanes.B.t), `fault (rev ${rev}): called before any strike`).toBeLessThan(Math.min(off.struck.A ?? Infinity, off.struck.B ?? Infinity) - 0.2);
    }
  }, 120_000);
});
