// Plan 16 (p46): a folded palm push kept on (`PalmPushProfile.foldKeeps`, `BlockSceneOpts.foldKeeps`, FOLD_KEEPS_DEG).
// A state captured in BL-F10-twoPointVsThree at the snap (3.3 s; the lanes, their leverage, the under stance and the
// outside palms on the tops of the shoulders on: B's palms land bent on A's shoulders and fold under A's hit), resumed
// with folded pushes kept and, as the twin, ended at the collapse. With its fault twin.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, FOLD_KEEPS_DEG } from '../src/sim/fixtures/blocking';
import { PALM_PUSH_V1 } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { dot, len, sub } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p46), a folded palm push kept on', () => {
  const CAPTURE_S = 3.3;
  const END_S = 6.3;
  const scene = (keeps: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    return blockScene({ ...s, id: 'BL-T-fold', durationS: END_S + 0.1, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: true, outsideOnArm: false, foldKeeps: keeps, armsGive: false, laneTie: false, burstTaper: false, lowUnheld: false, palmSlide: false, laneOnStrike: false, frame: false, heldByPush: false, strikeAtLoadGap: false, toeOut: false }, FIX('L3-F6-hold'));
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
    /** B's palm pushes on A ended in the 2 s after contact (s after it, why) */
    ends: { t: number; why: string }[];
    /** how long B has a palm on A in those 2 s (s), and the most his elbows fold while one is (deg) */
    onS: number;
    flexDeg: number;
    falls: string[];
  }
  async function run(keeps: boolean): Promise<Out> {
    // (a twin's change: the arm profile's palm push)
    const sim = await resumeState(await captured(), { def: scene(keeps), ...(keeps ? {} : { variant: ['armProfile'] }) });
    const n0 = sim.events.length;
    const out: Out = { ends: [], onS: 0, flexDeg: 0, falls: [] };
    let t0: number | null = null;
    let tPrev = sim.t;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const dt = sim.t - tPrev;
      tPrev = sim.t;
      const [a, b] = sim.players;
      if (a.rag || b.rag) continue;
      if (t0 === null && (a.block?.phase === 'engaged' || b.block?.phase === 'engaged')) t0 = sim.t;
      if (t0 === null || sim.t - t0 > 2) continue;
      let on = false;
      for (const side of ['left', 'right'] as const) {
        if (sim.arms!.pushOf('B', side)?.targetId !== 'A') continue;
        on = true;
        const o = sim.arms!.obs('B')?.[side];
        if (!o) continue;
        const u = sub(o.shoulderWorld, o.elbowWorld);
        const w = sub(o.palmContactWorld, o.elbowWorld);
        out.flexDeg = Math.max(out.flexDeg, 180 - (Math.acos(Math.max(-1, Math.min(1, dot(u, w) / (len(u) * len(w))))) * 180) / Math.PI);
      }
      if (on) out.onS += dt;
    }
    for (const e of sim.events.slice(n0)) {
      if (e.type === 'pushEnd' && e.playerId === 'B' && t0 !== null && e.t - t0 <= 2) out.ends.push({ t: e.t - t0, why: (e.data as { reason: string }).reason });
      if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    }
    sim.dispose();
    return out;
  }

  it("the fire-out resumed from the snap: B's palms fold under A's hit past the collapse and stay on A, never ending at it, a palm on 1.98 s of the 2 s after contact, his elbows folded no further than the bound; nobody falls; fault twin: ended at the collapse, both come off within 0.05 s of contact", async () => {
    const on = await run(true);
    expect(on.ends.filter((e) => e.why === 'collapsed'), 'on: never ended at the collapse').toEqual([]);
    expect(on.flexDeg, 'on: folded past the collapse').toBeGreaterThan(PALM_PUSH_V1.collapseFlexDeg);
    expect(on.flexDeg, 'on: to the bound').toBeLessThanOrEqual(FOLD_KEEPS_DEG);
    expect(on.onS, 'on: his palms on').toBeGreaterThanOrEqual(1.98);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    // (ended: both at 0.01 s, off to 0.13 s)
    const off = await run(false);
    const col = off.ends.filter((e) => e.why === 'collapsed');
    expect(col.length, 'fault: both collapsed').toBe(2);
    expect(Math.max(...col.map((e) => e.t)), 'fault: at once').toBeLessThan(0.05);
  }, 180_000);
});
