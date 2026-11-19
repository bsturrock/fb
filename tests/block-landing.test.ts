// Plan 16 (p44): the palm push's patch where the shown palm rests on his surface (`PalmPushProfile.seat`). A state
// captured in BL-F9-threePoint (both men on BLOCK_STRIKE_V5, CONTEST_V2, GAZE_V1, the seat on) just after A's palms land
// on B and before B's land on A (B's forearms meet A's pitched chest 65 deg off its normal, his palm ball 1.2 cm in with
// the landmark still 1.1 cm off the surface), resumed with the seat and without it (the patch at the landmark's
// projection, as before p44). With its fault twin.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p44), the landing palm seated on his chest', () => {
  // (A's palms land at 3.7875 s, B's from 3.825)
  const CAPTURE_S = 3.8;
  function scene(seat: boolean): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    // the twin keeps the arm profile's id (the capture's), its patch at the landmark's projection
    const d = blockScene({ ...s, id: 'BL-T-landing', durationS: 4.4, seat: true }, FIX('L3-F6-hold'));
    return seat ? d : { ...d, armProfile: { ...d.armProfile!, palmPush: { ...d.armProfile!.palmPush!, seat: undefined } } };
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(true));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  /** B's palm pushes on A begun in the 0.1 s from the capture: per push, how long it held within 0.4 s of its birth and why it ended. */
  async function run(seat: boolean): Promise<{ arm: string; heldS: number; end: string | null }[]> {
    const sim = await resumeState(await captured(), { def: scene(seat) });
    const n0 = sim.events.length;
    while (!sim.done && sim.t < CAPTURE_S + 0.5 - 1e-9) sim.stepTick();
    const ev = sim.events.slice(n0).filter((e) => e.playerId === 'B');
    const out = ev
      .filter((e) => e.type === 'pushBegin' && e.t <= CAPTURE_S + 0.1)
      .map((b) => {
        const id = (b.data as { push: string }).push;
        const e = ev.find((x) => x.type === 'pushEnd' && (x.data as { push: string }).push === id && x.t <= b.t + 0.4);
        return { arm: (b.data as { arm: string }).arm, heldS: e ? e.t - b.t : 0.4, end: e ? (e.data as { reason: string }).reason : null };
      });
    sim.dispose();
    return out;
  }

  it("the captured landing resumed with the seat: both of B's palms land on A's chest and hold for 0.4 s; fault twin: with the patch at the landmark's projection both are released within a substep, the palm shown past the arm's surface tolerance (invalidPose)", async () => {
    const on = await run(true);
    expect(on.map((p) => p.arm).sort(), 'on: both palms land').toEqual(['left', 'right']);
    for (const p of on) expect(p, `on: ${p.arm} held`).toEqual({ arm: p.arm, heldS: 0.4, end: null });
    const off = await run(false);
    expect(off.map((p) => p.arm).sort(), 'fault: both palms land').toEqual(['left', 'right']);
    for (const p of off) {
      expect(p.end, `fault: ${p.arm} released`).toBe('invalidPose');
      expect(p.heldS, `fault: ${p.arm} at once`).toBeLessThan(0.01);
    }
  }, 120_000);
});
