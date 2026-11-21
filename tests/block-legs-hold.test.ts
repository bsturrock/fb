// Plan 16 (p47): the winner's legs hold at most his push capacity of the hit (`ContestHit.legsHold`, `withLegsHold`). (a)
// The force pair on a constructed hit. (b) The run-in (block-run-in.test.ts's scene, A running in): a state captured at
// 3.9 s, just before A meets B, resumed with both men's contest on the rule and, as the twin, without. With fault twins.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { blockScene, contested, type BlockMan } from '../src/sim/fixtures/blocking';
import { BLOCK_STRIKE_V5, BLOCK_V1, GAZE_V1, LEAN_IN_V6, RUN_IN_V1, withGaze, withRunIn } from '../src/sim/controllers/block';
import { CONTEST_V2, hitPair, withLegsHold } from '../src/sim/block-base';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, v3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p47), what the winner\'s legs hold of the hit', () => {
  it('a 3000 N hit on a man pushing with 438 N against one pushing with nothing: with the rule he holds 438 N and takes the rest; fault twin: he holds all of it', () => {
    const H = CONTEST_V2.hit!;
    const on = hitPair(withLegsHold(CONTEST_V2).hit!, 55, 2.6, 0, 0, 438);
    expect(on.F).toBe(3000);
    expect(on.onA, 'on: the runner takes all of it').toBeCloseTo(-3000, 6);
    expect(on.onB, 'on: the set man takes all but his 438 N').toBeCloseTo(2562, 6);
    const off = hitPair(H, 55, 2.6, 0, 0, 438);
    expect(off.onA).toBeCloseTo(-3000, 6);
    expect(off.onB, 'fault: the set man takes none').toBe(0);
    // an even meeting is as before: both take it
    expect(hitPair(withLegsHold(CONTEST_V2).hit!, 55, 2, 0, 300, 300)).toEqual(hitPair(H, 55, 2, 0, 300, 300));
  });

  const CAPTURE_S = 3.9;
  const END_S = 5.2;
  function scene(legs: boolean): FixtureDef {
    const C = legs ? withLegsHold(CONTEST_V2) : CONTEST_V2;
    const step = { ...BLOCK_STRIKE_V5, id: 'strike-v5-step-test', fire: { ...BLOCK_STRIKE_V5.fire!, mps: 0.7 } };
    const A: BlockMan = { effort: 0.5, intent: 'drive', hands: 'under', profile: withGaze(contested(withRunIn(BLOCK_V1, RUN_IN_V1), BLOCK_STRIKE_V5, C), GAZE_V1), leanIn: LEAN_IN_V6, fromS: 1.5 };
    const B: BlockMan = { effort: 0.5, intent: 'hold', hands: 'over', profile: withGaze(contested(BLOCK_V1, step, C), GAZE_V1), leanIn: LEAN_IN_V6, stance: { kind: 'two-point', side: 'defense' }, fromS: 3.3 };
    return blockScene({ id: 'BL-T-legs-hold', title: 'legs hold', A, B, sepM: 8, durationS: END_S + 0.1, seat: true, aimThrough: true, stanceCone: true, followThrough: true, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: true, foldKeeps: true, armsGive: true, laneTie: true, burstTaper: true, lowUnheld: true, palmSlide: true, upperArm: true }, FIX('L3-F6-hold'));
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(false));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  /** After the contact: A's speed toward B at 0.15 s (m/s), B's ground given at 0.4 s (m), A's ground taken at 1 s (m), falls. */
  async function run(on: boolean): Promise<{ a015: number; b04: number; a1: number; falls: string[] }> {
    const sim = await resumeState(await captured(), { def: scene(on), ...(on ? { variant: ['players.0.controller.profile', 'players.1.controller.profile'] } : {}) });
    const [a, b] = sim.players;
    const n0 = sim.events.length;
    let t0: number | null = null;
    let u = v3(0, 0, 1);
    let za = 0;
    let zb = 0;
    const out = { a015: NaN, b04: NaN, a1: NaN, falls: [] as string[] };
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      if (a.rag || b.rag) break;
      const ta = a.proxy.body.translation();
      const tb = b.proxy.body.translation();
      if (t0 === null && a.block?.phase === 'engaged') {
        t0 = sim.t;
        u = norm(v3(tb.x - ta.x, 0, tb.z - ta.z));
        za = dot(v3(ta.x, 0, ta.z), u);
        zb = dot(v3(tb.x, 0, tb.z), u);
      }
      if (t0 === null) continue;
      const r = sim.t - t0;
      const va = a.proxy.body.linvel();
      if (Number.isNaN(out.a015) && r >= 0.15 - 1e-9) out.a015 = dot(v3(va.x, 0, va.z), u);
      if (Number.isNaN(out.b04) && r >= 0.4 - 1e-9) out.b04 = dot(v3(tb.x, 0, tb.z), u) - zb;
      if (Number.isNaN(out.a1) && r >= 1 - 1e-9) out.a1 = dot(v3(ta.x, 0, ta.z), u) - za;
    }
    for (const e of sim.events.slice(n0)) if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    sim.dispose();
    return out;
  }

  it("the run-in resumed just before the hit: A, running in at 2.6 m/s, is still going forward at 0.3 m/s or more 0.15 s after the contact, B is knocked back 0.2 m or more by 0.4 s, A has taken 0.25 m or more by 1 s, nobody falls; fault twin: B holds all of the hit, A is driven back (0.5 m/s or more away from B at 0.15 s) and B is not knocked back (under 0.05 m)", async () => {
    const on = await run(true);
    expect(on.a015, "on: A's speed toward B at 0.15 s").toBeGreaterThanOrEqual(0.3);
    expect(on.b04, 'on: B knocked back by 0.4 s').toBeGreaterThanOrEqual(0.2);
    expect(on.a1, 'on: A forward by 1 s').toBeGreaterThanOrEqual(0.25);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    const off = await run(false);
    expect(off.a015, "fault: A's speed toward B at 0.15 s").toBeLessThanOrEqual(-0.5);
    expect(off.b04, 'fault: B not knocked back').toBeLessThan(0.05);
  }, 180_000);
});
