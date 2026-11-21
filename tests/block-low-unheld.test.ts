// Plan 16 (p46): how low each man is, read without the beaten man's held lift (`BlockContest.lowUnheld`,
// `withLowUnheld`). A state captured in BL-F10-twoPointVsThree half a second after the contact (the burst tapering: B
// stood up by A's hit, his posture held up while A's palms are on him), resumed with the contest reading B's hips less
// that lift and, as the twin, as posed. With its fault twin.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p46), the low factor without the held lift', () => {
  const CAPTURE_S = 4.28;
  const END_S = 6;
  const scene = (unheld: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    return blockScene({ ...s, id: 'BL-T-low-unheld', durationS: END_S + 0.1, burstTaper: true, lowUnheld: unheld, palmSlide: false }, FIX('L3-F6-hold'));
  };
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(false));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Out {
    falls: string[];
    /** B's mean push and hold capacity and A's mean push capacity over the 0.5 s after the capture (N) */
    bCap: number;
    aCap: number;
    /** B's speed back 1 s after the capture (m/s), how far he is moved back from the capture to its end (m) */
    bV1: number;
    bBack: number;
    /** B's posed hips over A's, least, while A's palms are on him (m) */
    hipsOver: number;
  }
  async function run(unheld: boolean): Promise<Out> {
    // (a twin's change: both men's block profiles)
    const sim = await resumeState(await captured(), { def: scene(unheld), ...(unheld ? { variant: ['players.0.controller.profile', 'players.1.controller.profile'] } : {}) });
    const n0 = sim.events.length;
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    const hip = (p: typeof a): number => (p.pose!.jointLandmarksWorld.leftHip.y + p.pose!.jointLandmarksWorld.rightHip.y) / 2;
    const t0 = sim.t;
    const z0 = b.proxy.body.translation().z;
    const out: Out = { falls: [], bCap: 0, aCap: 0, bV1: 0, bBack: 0, hipsOver: Infinity };
    let n = 0;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      if (a.rag || b.rag) continue;
      if (sim.t - t0 <= 0.5) {
        out.bCap += b.block!.contest!.pushN + b.block!.contest!.holdN;
        out.aCap += a.block!.contest!.pushN;
        n++;
      }
      // (B faces -z from +z: back is +z)
      if (Math.abs(sim.t - t0 - 1) < 1e-3) out.bV1 = b.proxy.body.linvel().z;
      out.bBack = b.proxy.body.translation().z - z0;
      if ((['left', 'right'] as const).some((s) => sim.arms!.pushOf('A', s)?.targetId === 'B')) out.hipsOver = Math.min(out.hipsOver, hip(b) - hip(a));
    }
    out.bCap /= n;
    out.aCap /= n;
    for (const e of sim.events.slice(n0)) if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    sim.dispose();
    return out;
  }

  it("half a second after the contact: read without his held lift B pushes and holds with more and A pushes with less, B slows and anchors sooner and is moved back less; his posture is as before, held up over A's while A's palms are on him; nobody falls; fault twin: read as posed, B is run back on", async () => {
    const on = await run(true);
    const off = await run(false);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    expect(off.falls, 'fault: nobody falls').toEqual([]);
    expect(on.bCap, "on: B's capacity against the twin's").toBeGreaterThan(1.05 * off.bCap);
    expect(on.aCap, "on: A's against the twin's").toBeLessThan(off.aCap);
    expect(on.bBack, 'on: B moved back less (m)').toBeLessThan(off.bBack - 0.04);
    expect(on.bV1, "on: B's speed back 1 s on (m/s)").toBeLessThan(off.bV1);
    expect(on.hipsOver, "on: B's hips over A's while A's palms are on (m)").toBeGreaterThan(0.06);
  }, 180_000);
});
