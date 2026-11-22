// Plan 16 (p46): his burst tapers once the hit has stood his man up (`BlockContest.burstTaper`, BURST_TAPER_BEATEN,
// `withBurstTaper`, `contestCapacity`'s `burstShare`). The capacity on constructed inputs; then a state captured in
// BL-F9-threePoint in reversed player order at 3.70 s, just before the contact (B down at 4.26 s, overpowered, as the
// scene ran with the fold kept and the arms giving), resumed with the taper and, as the twin, without. With fault twins.
import { describe, expect, it } from 'vitest';
import { CONTEST_V2, contestCapacity } from '../src/sim/block-base';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p46), the burst tapers once the hit has beaten his man', () => {
  it("the capacity: the share of his burst over his push he still has, all of it as without a share, none his push; never past his drive's bound; a burst under his push is his push whatever the share", () => {
    const K = CONTEST_V2;
    const inp = { effort: 0.5, lowM: 0, feet: 1, level: 0, anchored: true, leverage: 1, driveCapN: 2000, burstN: Infinity };
    const full = contestCapacity(K, inp).pushN;
    const base = K.pushN * 0.5;
    expect(full, 'no share: the burst').toBeCloseTo(K.burst.pushN * 0.5, 9);
    expect(contestCapacity(K, { ...inp, burstShare: 1 }).pushN, 'all of it').toBeCloseTo(full, 9);
    expect(contestCapacity(K, { ...inp, burstShare: 0 }).pushN, 'none: his push').toBeCloseTo(base, 9);
    expect(contestCapacity(K, { ...inp, burstShare: 0.25 }).pushN, 'a quarter').toBeCloseTo(base + 0.25 * (full - base), 9);
    expect(contestCapacity(K, { ...inp, burstShare: 1, driveCapN: 300 }).pushN, "his drive's bound").toBeCloseTo(300, 9);
    expect(contestCapacity(K, { ...inp, burstN: 100, burstShare: 0.5 }).pushN, 'a burst under his push').toBeCloseTo(base, 9);
    // (the hold and the brake are not the burst's)
    expect(contestCapacity(K, { ...inp, burstShare: 0 }).holdN).toBe(contestCapacity(K, inp).holdN);
    expect(contestCapacity(K, { ...inp, burstShare: 0 }).brakeN).toBe(contestCapacity(K, inp).brakeN);
  });

  const CAPTURE_S = 3.7;
  const END_S = 5.6;
  const scene = (taper: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    return blockScene({ ...s, id: 'BL-T-burst-taper', durationS: END_S + 0.1, burstTaper: taper, lowUnheld: false, palmSlide: false, laneOnStrike: false, frame: false, heldByPush: false, strikeAtLoadGap: false, toeOut: false }, FIX('L3-F6-hold'));
  };
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(false), { reverseOrder: true });
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Out {
    falls: string[];
    /** B's longest overpowered clock (s), how far he is moved back by 0.4 s after contact (m), A's push capacity's highest 0.28-0.38 s after it (N) */
    overS: number;
    bBack04: number;
    aPushLate: number;
  }
  async function run(taper: boolean): Promise<Out> {
    // (a twin's change: both men's block profiles)
    const sim = await resumeState(await captured(), { def: scene(taper), ...(taper ? { variant: ['players.0.controller.profile', 'players.1.controller.profile'] } : {}) });
    const n0 = sim.events.length;
    const out: Out = { falls: [], overS: 0, bBack04: 0, aPushLate: 0 };
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    let t0: number | null = null;
    let z0 = 0;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      if (a.rag || b.rag) continue;
      if (t0 === null && a.block?.phase === 'engaged' && b.block?.phase === 'engaged') {
        t0 = sim.t;
        z0 = b.proxy.body.translation().z;
      }
      const c = b.block?.contest;
      if (t0 === null || !c) continue;
      if (c.overT != null) out.overS = Math.max(out.overS, sim.t - c.overT);
      // (B faces -z from +z: back is +z)
      if (sim.t - t0 <= 0.4) out.bBack04 = b.proxy.body.translation().z - z0;
      if (sim.t - t0 >= 0.28 && sim.t - t0 <= 0.38) out.aPushLate = Math.max(out.aPushLate, a.block!.contest!.pushN);
    }
    for (const e of sim.events.slice(n0)) if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    sim.dispose();
    return out;
  }

  it("reversed BL-F9-threePoint from just before the contact: with the taper A's burst runs down once B is stood up, B is still knocked back by the hit, his overpowered clock stays under 0.2 s and nobody falls; fault twin: the full burst knocks B back again at the end of its window and he goes down overpowered", async () => {
    const on = await run(true);
    const off = await run(false);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    expect(on.overS, "on: B's longest overpowered clock (s)").toBeLessThanOrEqual(0.2);
    expect(on.bBack04, 'on: B knocked back by 0.4 s (m)').toBeGreaterThan(0.1);
    expect(on.aPushLate, "on: A's push late in the window, against the full burst's").toBeLessThan(0.75 * off.aPushLate);
    expect(off.falls, 'fault: B down overpowered').toEqual(['B:contest:overpowered']);
  }, 180_000);
});
