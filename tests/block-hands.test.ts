// Plan 16 (p50), the hand fight's first slice: each of a blocker's hands with its own state (`BlockProfile.handFight`,
// HANDS_V1, `BlockState.hands`, `advanceHands`). The rule on constructed inputs (on, pushing, where, the lane kept once
// called), then BL-F10-twoPointVsThree (A in the two-point set, B in the defense three-point, the snap at 3.3 s; A wins
// the inside, B's palms on A's shoulder tops) with the hand fight on and off: with nothing asked of the hands, both men
// move exactly as without it, every body and limb landmark to the bit, and each hand's state reads what holds (striking
// in the strike, then on, A's on B's chest in the inside lane, B's on A's shoulders in the outside). Fault twin: the
// hands never given his lane (`BlockDebug.handsLaneUncalled`) aim B's palms inside, and the men move differently.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { advanceHands, nextHand, type HandState } from '../src/sim/controllers/block';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import type { ArmSide } from '../src/sim/contracts';
import { FIX } from './helpers';

const on = { on: true, folded: false };
const off = { on: false, folded: false };

describe('plan 16 (p50), each hand with its own state', () => {
  it('a hand reads on, pushing and where from what holds, and keeps its lane once called; fault twin: uncalled, no lane', () => {
    const h0 = advanceHands(undefined, undefined, { left: off, right: off }, undefined, 1);
    expect(h0.left).toEqual({ doing: 'home', since: 1, on: false, pushing: false, where: null });
    const h1 = advanceHands(h0, { left: nextHand(h0.left, { phase: 'strike' } as never, 2), right: nextHand(h0.right, undefined, 2) }, { left: on, right: { on: true, folded: true } }, 'outside', 2);
    expect(h1.left).toEqual({ doing: 'striking', since: 2, on: true, pushing: true, where: 'shoulder', lane: 'outside' });
    // folded past its collapse: on at no force
    expect(h1.right).toEqual({ doing: 'home', since: 1, on: true, pushing: false, where: 'shoulder', lane: 'outside' });
    // the lane is kept once called, whatever the call reads later
    const h2 = advanceHands(h1, undefined, { left: on, right: off }, 'inside', 3);
    expect(h2.left.lane).toBe('outside');
    expect(h2.left.where).toBe('shoulder');
    expect(h2.right.where).toBe(null);
    // the inside lane, and a placement without lanes, put a hand on his chest
    expect(advanceHands(undefined, undefined, { left: on, right: on }, 'inside', 0).left.where).toBe('chest');
    expect(advanceHands(undefined, undefined, { left: on, right: on }, undefined, 0).left.where).toBe('chest');
    // fault twin: never given his lane, the outside hand reads on his chest
    const u = advanceHands(undefined, undefined, { left: on, right: on }, 'outside', 0, true);
    expect(u.left.lane).toBeUndefined();
    expect(u.left.where).toBe('chest');
  });

  const SNAP_S = 3.3;
  const scene = (handFight: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    return blockScene({ ...s, id: 'BL-T-hands', durationS: SNAP_S + 2.5, handFight }, FIX('L3-F6-hold'));
  };
  interface Run {
    /** every tick: both men's root and every pose landmark, rounded to nothing */
    frames: string[];
    /** per man and hand: ticks striking, ticks on, and where it was on at the end */
    hands: Record<string, Record<ArmSide, { striking: number; on: number; where: HandState['where']; lane?: string }>>;
    lanes: Record<string, string | undefined>;
  }
  async function run(handFight: boolean, uncalled = false): Promise<Run> {
    const sim = await Simulation.create(scene(handFight), uncalled ? { debug: { block: { handsLaneUncalled: true } } } : {});
    const frames: string[] = [];
    const hands: Run['hands'] = {};
    while (!sim.done) {
      sim.stepTick();
      const f: unknown[] = [];
      for (const p of sim.players) {
        f.push(p.proxy.body.translation(), p.proxy.body.rotation(), p.pose?.jointLandmarksWorld);
        const H = p.block?.hands;
        if (!H) continue;
        const m = (hands[p.id] ??= { left: { striking: 0, on: 0, where: null }, right: { striking: 0, on: 0, where: null } });
        for (const s of ['left', 'right'] as const) {
          if (H[s].doing === 'striking') m[s].striking++;
          if (H[s].on) m[s].on++;
          m[s].where = H[s].where;
          m[s].lane = H[s].lane;
        }
      }
      frames.push(JSON.stringify(f));
    }
    const lanes = Object.fromEntries(sim.players.map((p) => [p.id, p.block?.lane]));
    sim.dispose();
    return { frames, hands, lanes };
  }

  it('BL-F10 with the hand fight and nothing asked of the hands moves exactly as without; each hand reads what holds; fault twin: hands without his lane move B differently', async () => {
    const without = await run(false);
    const withH = await run(true);
    expect(withH.frames.length).toBe(without.frames.length);
    const firstDiff = withH.frames.findIndex((f, i) => f !== without.frames[i]);
    expect(firstDiff).toBe(-1);
    expect(without.hands).toEqual({});
    expect(withH.lanes).toEqual({ A: 'inside', B: 'outside' });
    for (const id of ['A', 'B'])
      for (const s of ['left', 'right'] as const) {
        const h = withH.hands[id][s];
        expect(h.striking, `${id} ${s}`).toBeGreaterThan(0);
        expect(h.on, `${id} ${s}`).toBeGreaterThan(100);
        expect(h.lane).toBe(withH.lanes[id]);
      }
    // A on B's chest, B on A's shoulders, at the end
    expect([withH.hands.A.left.where, withH.hands.A.right.where]).toEqual(['chest', 'chest']);
    expect([withH.hands.B.left.where, withH.hands.B.right.where]).toEqual(['shoulder', 'shoulder']);
    // fault twin
    const bad = await run(true, true);
    expect(bad.frames.findIndex((f, i) => f !== without.frames[i])).toBeGreaterThan(0);
    expect(bad.hands.B.left.lane).toBeUndefined();
    expect(bad.hands.B.left.where === 'shoulder' || bad.hands.B.right.where === 'shoulder').toBe(false);
  }, 120_000);
});
