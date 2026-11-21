// Plan 16 (p46): his arms give as he is stood up (`BlockContest.armsGive`, `withArmsGive`, `BlockSceneOpts.armsGive`). A
// state captured in BL-F9-threePoint at the snap (3.3 s; the lanes, their leverage, the under stance, the outside palms
// on the tops of the shoulders and folded pushes kept on: B's palms stay on A's shoulders as A's hit knocks him back),
// resumed with B's arms giving as he is stood up and, as the twin, pushing at his full effort. With its fault twin.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p46), the arms give as he is stood up', () => {
  const CAPTURE_S = 3.3;
  const END_S = 6.3;
  const scene = (give: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    return blockScene({ ...s, id: 'BL-T-give-arms', durationS: END_S + 0.1, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: true, foldKeeps: true, armsGive: give, laneTie: false, burstTaper: false, lowUnheld: false }, FIX('L3-F6-hold'));
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
    /** each man's palm pushes ended in the 2 s after contact (s after it, why), and how long he has a palm on his man then (s) */
    ends: Record<string, { t: number; why: string }[]>;
    onS: Record<string, number>;
    /** how far B is moved back by 1 s after contact (m) */
    bBack1: number;
    falls: string[];
  }
  async function run(give: boolean): Promise<Out> {
    // (a twin's change: both men's block profiles)
    const sim = await resumeState(await captured(), { def: scene(give), ...(give ? {} : { variant: ['players.0.controller.profile', 'players.1.controller.profile'] }) });
    const n0 = sim.events.length;
    const out: Out = { ends: { A: [], B: [] }, onS: { A: 0, B: 0 }, bBack1: 0, falls: [] };
    let t0: number | null = null;
    let z0 = 0;
    let tPrev = sim.t;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const dt = sim.t - tPrev;
      tPrev = sim.t;
      const [a, b] = sim.players;
      if (a.rag || b.rag) continue;
      if (t0 === null && (a.block?.phase === 'engaged' || b.block?.phase === 'engaged')) {
        t0 = sim.t;
        z0 = b.proxy.body.translation().z;
      }
      if (t0 === null || sim.t - t0 > 2) continue;
      for (const [p, o] of [['A', 'B'], ['B', 'A']] as const) if ((['left', 'right'] as const).some((s) => sim.arms!.pushOf(p, s)?.targetId === o)) out.onS[p] += dt;
      // (B faces -z from +z: back is +z)
      if (sim.t - t0 <= 1) out.bBack1 = b.proxy.body.translation().z - z0;
    }
    for (const e of sim.events.slice(n0)) {
      if (e.type === 'pushEnd' && e.playerId && t0 !== null && e.t - t0 <= 2) out.ends[e.playerId]?.push({ t: e.t - t0, why: (e.data as { reason: string }).reason });
      if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    }
    sim.dispose();
    return out;
  }

  it("the fire-out resumed from the snap: B, stood up by A's hit, his palms kept on A's shoulders, gives with his arms; A's palms stay on B throughout the 2 s after contact (none ends), and B is driven back farther by 1 s; nobody falls; fault twin: at his full effort B's palms push A out of reach, both of A's ending within 0.3 s", async () => {
    const on = await run(true);
    const off = await run(false);
    expect(on.ends.A, "on: A's palms never come off").toEqual([]);
    expect(on.onS.A, "on: A's palms on").toBeGreaterThanOrEqual(1.98);
    expect(on.onS.B, "on: B's palms on").toBeGreaterThanOrEqual(1.98);
    expect(on.bBack1, 'on: B driven back farther').toBeGreaterThan(off.bBack1);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    // (at his full effort: both of A's out of reach at 0.22 s, back on at 0.35 s)
    const out = off.ends.A.filter((e) => e.why === 'unreachable');
    expect(out.length, "fault: A's palms out of reach").toBe(2);
    expect(Math.max(...out.map((e) => e.t)), 'fault: in the hit').toBeLessThan(0.3);
  }, 180_000);
});
