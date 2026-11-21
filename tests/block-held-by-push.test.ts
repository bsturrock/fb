// Plan 16 (p48): the hit's outcome held only while his man's palms push (`BlockContest.heldByPush`, `withHeldByPush`).
// A state captured in BL-F8-hardNoHinge under the full set of the newer runs (the set BL-F9-threePoint runs, the lane
// called as they close) at 1.2 s, B having won the hit from the outside, his palms on A's shoulders and about to fold
// past their collapse (at 1.27 s), resumed with both men's contests holding the hit's outcome only while the palms push
// and, as the twin, while they are on. With its fault twin: B's folded palms, on at no force, hold A beaten and B low
// under him while A's palms press on B's chest; B tips forward past his anchor's lean and falls (`pastAnchor`, 2.0 s).
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p48), the hit held only while the palms push', () => {
  const CAPTURE_S = 1.2;
  const END_S = 3;
  const scene = (held: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F8-hardNoHinge')!;
    return blockScene({ ...s, id: 'BL-T-held-by-push', durationS: END_S + 0.1, seat: true, aimThrough: true, stanceCone: true, followThrough: true, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: true, foldKeeps: true, armsGive: true, laneTie: true, burstTaper: true, lowUnheld: true, palmSlide: true, laneOnStrike: false, upperArm: true, heldByPush: held }, FIX('L3-F6-hold'));
  };
  const caps = new Map<boolean, StateCapture>();
  async function captured(rev: boolean): Promise<StateCapture> {
    if (caps.has(rev)) return caps.get(rev)!;
    const sim = await Simulation.create(scene(false), { reverseOrder: rev });
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    caps.set(rev, captureState(sim));
    sim.dispose();
    return caps.get(rev)!;
  }
  interface Out {
    /** the share of the resumed run B's palm pushes on A are on and every one of them folded past its collapse */
    foldedShare: number;
    /** A's beaten level at the end, or as B falls (0..1) */
    beatenEnd: number;
    /** the most B's body leans from upright while supported (deg) */
    leanDeg: number;
    falls: string[];
  }
  async function run(held: boolean, rev: boolean): Promise<Out> {
    const sim = await resumeState(await captured(rev), { def: scene(held), ...(held ? { variant: ['players.0.controller.profile', 'players.1.controller.profile'] } : {}) });
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    const n0 = sim.events.length;
    const out: Out = { foldedShare: 0, beatenEnd: 0, leanDeg: 0, falls: [] };
    let n = 0;
    let folded = 0;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      // (until either man goes down)
      if (a.rag || b.rag || a.controlMode !== 'supported' || b.controlMode !== 'supported' || sim.events.slice(n0).some((e) => e.type === 'lossOfSupport')) break;
      n++;
      const on = (['left', 'right'] as const).filter((s) => sim.arms!.pushOf('B', s)?.targetId === 'A');
      if (on.length > 0 && on.every((s) => sim.arms!.pushFolded('B', s))) folded++;
      out.beatenEnd = a.block?.contest?.beaten ?? 0;
      out.leanDeg = Math.max(out.leanDeg, (b.balance.theta * 180) / Math.PI);
    }
    out.foldedShare = folded / Math.max(1, n);
    for (const e of sim.events.slice(n0)) if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    sim.dispose();
    return out;
  }

  it("BL-F8-hardNoHinge under the full set, both orders, resumed as B's palms fold on A's shoulders: they stay on folded; held by the push, A's beaten level falls away, B leans no more than 15 deg (his anchor allows 20) and nobody falls; fault twin: held by the folded palms, A stays beaten, B tips past his anchor and falls (pastAnchor)", async () => {
    for (const rev of [false, true]) {
      const on = await run(true, rev);
      expect(on.foldedShare, `on (rev ${rev}): B's palms on A folded`).toBeGreaterThan(0.8);
      expect(on.beatenEnd, `on (rev ${rev}): A no longer beaten`).toBeLessThan(0.05);
      expect(on.leanDeg, `on (rev ${rev}): B's lean, 11 deg at most`).toBeLessThan(15);
      expect(on.falls, `on (rev ${rev}): nobody falls`).toEqual([]);
      const off = await run(false, rev);
      expect(off.foldedShare, `fault (rev ${rev}): B's palms on A folded`).toBeGreaterThan(0.8);
      expect(off.beatenEnd, `fault (rev ${rev}): A held beaten`).toBeGreaterThan(0.2);
      expect(off.falls, `fault (rev ${rev}): B tips and falls`).toEqual(['B:contest:pastAnchor']);
    }
  }, 180_000);
});
