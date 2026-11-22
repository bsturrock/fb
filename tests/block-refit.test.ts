// Plan 16 (p50), the hand fight's re-fit (`BlockHandFight.refit`, HANDS_V3; `nextHand`): a knocked hand, its knock over,
// goes straight back up onto his man at its own lane's aim while his other hand stays home, instead of back through the
// ready point (the block's own hands). The rule on constructed inputs, then the pass rush built on BL-F10-twoPointVsThree
// (A holds in the two-point set at 0.5, B drives from the defense three-point at 0.55; A has the inside) resumed from a
// capture shortly before B's right hand swipes at A's left arm, with the re-fit and, as the fault twin, without it: with
// it A's left hand, its knock over, pushes straight for B's chest and is back on it within 0.3 s; without, it is first
// pulled back to the ready point and is back on later. A's right hand stays on throughout either way.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { HANDS_V2, HANDS_V3, nextHand, type HandState } from '../src/sim/controllers/block';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { v3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

const home = (o: Partial<HandState> = {}): HandState => ({ doing: 'home', since: 0, on: false, pushing: false, where: null, lane: 'inside', ...o });

describe('plan 16 (p50), the re-fit', () => {
  it('a knocked hand re-fits once its knock is over, until it is on him or past its time; fault twin: without the re-fit it is home', () => {
    const F = HANDS_V3;
    const k = { t: 2, dirW: v3(0, -1, 0), palmW: v3(), by: 'B', ended: true };
    const end = 2 + F.knock!.s;
    const r = nextHand(home({ doing: 'knocked', since: 2, knockT: 2, knock: k }), undefined, end, { fight: F });
    expect(r).toEqual({ doing: 'refitting', since: end, knockT: 2 });
    expect(nextHand(home({ ...r, knock: k }), undefined, end + 0.1, { fight: F }).doing).toBe('refitting');
    // on him: home
    expect(nextHand(home({ ...r, knock: k, on: true }), undefined, end + 0.1, { fight: F })).toEqual({ doing: 'home', since: end + 0.1, knockT: 2 });
    // past its time: home (the block's own hands)
    expect(nextHand(home({ ...r, knock: k }), undefined, end + F.refit!.s, { fight: F }).doing).toBe('home');
    // fault twin: without the re-fit, the knock over, home
    expect(nextHand(home({ doing: 'knocked', since: 2, knockT: 2, knock: k }), undefined, end, { fight: HANDS_V2 }).doing).toBe('home');
  });

  const SWIPE_S = 4.25;
  const CAPTURE_S = 4.15;
  const END_S = 4.95;
  const scene = (refit: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    return blockScene({ ...s, id: 'BL-T-refit', durationS: END_S + 0.1, A: { ...s.A, intent: 'hold', effort: 0.5 }, B: { ...s.B, intent: 'drive', effort: 0.55, swipes: [{ atS: SWIPE_S, hand: 'right' }] }, handFight: refit ? HANDS_V3 : HANDS_V2 }, FIX('L3-F6-hold'));
  };
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(true));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Out {
    knocked: boolean;
    /** A's left hand: back on after its knock ended (s), and where; substeps it was pulled back to the ready point after its knock ended (his arm's intent a reach) */
    backAfterS: number | null;
    where: string | null;
    toReady: number;
    /** A's right palm push ended in the window */
    rightEnded: boolean;
  }
  async function run(refit: boolean): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(refit), ...(refit ? {} : { variant: ['players.0.controller.profile', 'players.1.controller.profile'] }) });
    const a = sim.players.find((p) => p.id === 'A')!;
    const P = HANDS_V3;
    const out: Out = { knocked: false, backAfterS: null, where: null, toReady: 0, rightEnded: false };
    let knockT: number | null = null;
    let ev = sim.events.length;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        const d = e.data as { arm?: string; reason?: string };
        if (e.playerId !== 'A') continue;
        if (e.type === 'pushEnd' && d.arm === 'left' && d.reason === 'knocked') {
          out.knocked = true;
          knockT = e.t;
        }
        if (e.type === 'pushEnd' && d.arm === 'right') out.rightEnded = true;
        if (e.type === 'pushBegin' && d.arm === 'left' && knockT !== null && out.backAfterS === null) out.backAfterS = e.t - knockT - P.knock!.s;
      }
      const h = a.block?.hands?.left;
      if (knockT !== null && out.backAfterS !== null && out.where === null && h?.on) out.where = h.where;
      if (knockT !== null && out.backAfterS === null && sim.t > knockT + P.knock!.s + 1e-9 && a.intent.arms?.left?.action === 'reach') out.toReady++;
    }
    sim.dispose();
    return out;
  }

  it('the pass rush: the knocked hand, its knock over, straight back on his chest within 0.3 s, the other hand home; fault twin: without the re-fit, through the ready point and later', async () => {
    const on = await run(true);
    const off = await run(false);
    for (const o of [on, off]) {
      expect(o.knocked).toBe(true);
      expect(o.rightEnded).toBe(false);
      expect(o.backAfterS).not.toBeNull();
    }
    expect(on.backAfterS!).toBeGreaterThan(0);
    expect(on.backAfterS!).toBeLessThanOrEqual(0.3);
    expect(on.where).toBe('chest');
    expect(off.backAfterS!).toBeGreaterThan(on.backAfterS! + 0.03);
    expect(on.toReady).toBe(0);
    expect(off.toReady).toBeGreaterThan(0);
  }, 120_000);
});
