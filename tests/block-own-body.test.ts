// Plan 16 (p44): his own body never ends a held palm push (`PalmPushProfile.ownBodyKeeps`). Under the upper arm's
// self-clearance (`SelfClearanceProfile.upperArm`) the held arm's pose is invalid when every pose it can show has the
// upper arm's distal half in his own trunk past the tolerance; the push pressing his elbow against his ribs then released
// the palm, and he struck again on a straight arm. A state captured in BL-F9-threePoint (the seat and the upper arm's
// clearance on, `BlockSceneOpts.upperArm`) with both of B's palms held on A's chest, shortly before that release, resumed
// with the rule and without it (the twin keeps the capture's arm profile id). With its fault twin.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p44), a held push kept over his own body', () => {
  // (B's palms land at 3.8375 s; without the rule both are released at 4.0958)
  const CAPTURE_S = 4.05;
  const END_S = 4.4;
  function scene(keep: boolean): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    // (the scene as at p44, the p45 landing on a pitched chest, follow-through, lanes and leverage off: the captured moment is p44's)
    const d = blockScene({ ...s, id: 'BL-T-own-body', durationS: END_S + 0.1, seat: true, upperArm: true, aimThrough: false, stanceCone: false, followThrough: false, lanes: false, insideLeverage: false, stayLow: false, shoulderTops: false, foldKeeps: false, armsGive: false, laneTie: false, burstTaper: false, lowUnheld: false, palmSlide: false }, FIX('L3-F6-hold'));
    return keep ? d : { ...d, armProfile: { ...d.armProfile!, palmPush: { ...d.armProfile!.palmPush!, ownBodyKeeps: undefined } } };
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
  /** B's pushes held at the capture: per arm, its id then, why it ended (null: held to END_S) and when. */
  async function run(keep: boolean): Promise<{ arm: string; held: boolean; end: string | null; t: number | null }[]> {
    const sim = await resumeState(await captured(), { def: scene(keep) });
    const arms = sim.arms!;
    const at = (['left', 'right'] as const).map((side) => ({ side, id: arms.pushOf('B', side)?.id }));
    const n0 = sim.events.length;
    while (!sim.done && sim.t < END_S - 1e-9) sim.stepTick();
    const out = at.map(({ side, id }) => {
      const e = sim.events.slice(n0).find((x) => x.type === 'pushEnd' && (x.data as { push: string }).push === id);
      return { arm: side, held: !!id, end: e ? (e.data as { reason: string }).reason : null, t: e ? e.t : null };
    });
    sim.dispose();
    return out;
  }

  it("the captured hold resumed with the rule: both of B's palms stay on A's chest to 0.35 s later; fault twin: without it both are released at once for his own body (invalidPose)", async () => {
    const on = await run(true);
    for (const p of on) expect(p, `on: ${p.arm}`).toEqual({ arm: p.arm, held: true, end: null, t: null });
    const off = await run(false);
    for (const p of off) {
      expect(p.held, `fault: ${p.arm} held at the capture`).toBe(true);
      expect(p.end, `fault: ${p.arm} released`).toBe('invalidPose');
      expect(p.t!, `fault: ${p.arm} within 0.1 s`).toBeLessThan(CAPTURE_S + 0.1);
    }
  }, 120_000);
});
