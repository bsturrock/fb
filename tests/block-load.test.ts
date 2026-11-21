// Plan 16 (p43): the load on his shoulders (`BlockStrike.load.onShoulders`, BLOCK_STRIKE_V5). A state captured just before
// the snap in BL-F9-threePoint's set (both men in a three-point, on BLOCK_STRIKE_V5 and CONTEST_V2, their eyes on each
// other), resumed with the load on his shoulders and without it (V4's: the load point in his own frame however deep his
// trunk, the arm's own pole). With its fault twin.
import { describe, expect, it } from 'vitest';
import { CONTEST_V2 } from '../src/sim/block-base';
import { BLOCK_STRIKE_V5, GAZE_V1, withGaze, type BlockStrike } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, contested } from '../src/sim/fixtures/blocking';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { depth, drawnShapes } from './visible';
import { FIX } from './helpers';

describe('plan 16 (p43), the load on his shoulders', () => {
  const SNAP = 3.3;
  function scene(onShoulders: boolean): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    // the twin keeps the strike's id (the capture's), its load in his own frame
    const K: BlockStrike = onShoulders ? BLOCK_STRIKE_V5 : { ...BLOCK_STRIKE_V5, load: { ...BLOCK_STRIKE_V5.load, onShoulders: undefined } };
    const m = (x: typeof s.A) => ({ ...x, profile: withGaze(contested(undefined, K, CONTEST_V2), GAZE_V1) });
    return blockScene({ ...s, id: 'BL-T-load', A: m(s.A), B: m(s.B), durationS: 3.7, stayLow: false, shoulderTops: false, foldKeeps: false, armsGive: false, laneTie: false, burstTaper: false, lowUnheld: false, palmSlide: false, laneOnStrike: false }, FIX('L3-F6-hold'));
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(true));
    while (sim.t < SNAP - 0.05 - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  /** Per man: the deepest any arm piece (drawn upper arm, forearm, palm) is in either of his own thighs from 0.05 to 0.3 s after the snap (m). */
  async function run(onShoulders: boolean): Promise<Record<string, number>> {
    const sim = await resumeState(await captured(), { def: scene(onShoulders), variant: onShoulders ? [] : ['players.0.controller.profile.strike.load.onShoulders', 'players.1.controller.profile.strike.load.onShoulders'] });
    const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    const r: Record<string, number> = {};
    while (!sim.done && sim.t < SNAP + 0.3) {
      sim.stepTick();
      // (the stance's own hands until they leave the turf and the thigh)
      if (sim.t < SNAP + 0.05 - 1e-9) continue;
      for (const p of sim.players) {
        if (p.rag || !p.pose) continue;
        const sh = drawnShapes(p.pose, p.body, R);
        const thighs = sh.filter((s) => s.cls === 'thigh');
        let d = 0;
        for (const a of sh.filter((s) => s.cls === 'upperArmD' || s.cls === 'forearm' || s.cls === 'palm')) for (const b of thighs) d = Math.max(d, depth(a, b));
        r[p.id] = Math.max(r[p.id] ?? 0, d);
      }
    }
    sim.dispose();
    return r;
  }

  it("the captured set resumed with the load on his shoulders: from 0.05 to 0.3 s after the snap no arm piece of either man is more than 1 cm in his own thighs; fault twin: with the load point in his own frame (V4's) each man's arms go 8 cm or more into his thighs", async () => {
    const on = await run(true);
    for (const id of ['A', 'B']) expect(on[id], `on: ${id}'s arms outside his thighs`).toBeLessThanOrEqual(0.01);
    const off = await run(false);
    for (const id of ['A', 'B']) expect(off[id], `fault: ${id}'s arms in his thighs`).toBeGreaterThanOrEqual(0.08);
  }, 120_000);
});
