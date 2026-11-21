// Plan 16 (p46): the outside palms on the tops of his shoulders (`BlockSceneOpts.shoulderTops`, LANES_TOPS,
// SHOULDER_TOPS_HIGH_M). A state captured in BL-F10-twoPointVsThree at the snap (3.3 s; the lanes, their leverage and
// the under stance on, so A has the inside and B the outside), resumed with the outside palms on the tops of A's
// shoulders and, as the twin, on their fronts (LANES_V1, the band to 0.58 m). With its fault twin.
import { describe, expect, it } from 'vitest';
import { LANES_V1 } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, PALM_PUSH_BLOCK } from '../src/sim/fixtures/blocking';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { captureState, resumeState, type StateCapture } from './state';
import { depth, drawnShapes } from './visible';
import { FIX } from './helpers';

describe('plan 16 (p46), the outside palms on the tops of the shoulders', () => {
  const CAPTURE_S = 3.3;
  const END_S = 6.3;
  function scene(tops: boolean): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    const d = blockScene({ ...s, id: 'BL-T-tops', durationS: END_S + 0.1, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: true, foldKeeps: false, armsGive: false, laneTie: false, burstTaper: false, lowUnheld: false, palmSlide: false }, FIX('L3-F6-hold'));
    if (tops) return d;
    // a twin: the outside palms on the fronts of his shoulders, the band as before (resumed as a variant at the lanes)
    return {
      ...d,
      armProfile: { ...d.armProfile!, palmPush: { ...d.armProfile!.palmPush!, band: { ...PALM_PUSH_BLOCK.band } } },
      players: d.players.map((p) => (p.controller?.kind === 'block' ? { ...p, controller: { ...p.controller, profile: { ...p.controller.profile!, lanes: LANES_V1 } } } : p)),
    } as FixtureDef;
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
  interface Out {
    /** B's lane; the height of his palms' patches on A as they are born (m in A's frame, the lowest) */
    lane?: string;
    bornY: number;
    /** over the 2 s after contact: the deepest B's drawn palm and forearm are in A's drawn upper arms (m), and the palm's mean */
    palmM: number;
    palmMeanM: number;
    forearmM: number;
    falls: string[];
  }
  async function run(tops: boolean): Promise<Out> {
    const variant = tops ? [] : ['players.0.controller.profile.lanes', 'players.1.controller.profile.lanes'];
    const sim = await resumeState(await captured(), { def: scene(tops), variant });
    const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    const n0 = sim.events.length;
    const out: Out = { bornY: Infinity, palmM: 0, palmMeanM: 0, forearmM: 0, falls: [] };
    let t0: number | null = null;
    let n = 0;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const [a, b] = sim.players;
      if (a.rag || b.rag || !a.pose || !b.pose) continue;
      if (t0 === null && (a.block?.phase === 'engaged' || b.block?.phase === 'engaged')) t0 = sim.t;
      if (t0 === null || sim.t - t0 > 2) continue;
      const his = drawnShapes(a.pose, a.body, R).filter((s) => s.cls === 'upperArm' || s.cls === 'upperArmD');
      const mine = drawnShapes(b.pose, b.body, R);
      let pd = 0;
      for (const x of mine.filter((s) => s.cls === 'palm')) for (const y of his) pd = Math.max(pd, depth(x, y));
      for (const x of mine.filter((s) => s.cls === 'forearm')) for (const y of his) out.forearmM = Math.max(out.forearmM, depth(x, y));
      out.palmM = Math.max(out.palmM, pd);
      out.palmMeanM += pd;
      n++;
    }
    out.palmMeanM /= Math.max(1, n);
    for (const e of sim.events.slice(n0)) {
      if (e.type === 'blockLane' && e.playerId === 'B') out.lane = (e.data as { lane: string }).lane;
      if (e.type === 'pushBegin' && e.playerId === 'B') out.bornY = Math.min(out.bornY, (e.data as { yLocal: number }).yLocal);
      if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    }
    sim.dispose();
    return out;
  }

  it("the fire-out resumed from the snap: B, outside, lands his palms on the tops of A's shoulders (born 5 cm or more higher on him than on their fronts), over A's upper arms: in the 2 s after contact his palms at most 3 cm into them (0.5 cm on average) and his forearms at most 1.5 cm; nobody falls; fault twin: on the fronts of the shoulders, the palms 5 cm or more into them and the forearms 4 cm or more", async () => {
    const on = await run(true);
    expect(on.lane, 'on: B outside').toBe('outside');
    expect(on.palmM, 'on: palms over the upper arms').toBeLessThan(0.03);
    expect(on.palmMeanM, 'on: palms over the upper arms (mean)').toBeLessThan(0.005);
    expect(on.forearmM, 'on: forearms over the upper arms').toBeLessThan(0.015);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    // (on the fronts: the palms 7.3 cm into the top of A's upper arms, 6.1 on average, the forearms 4.6 cm)
    const off = await run(false);
    expect(off.lane, 'twin: B outside').toBe('outside');
    // (the patches as born, in A's frame: 0.49 m up on the fronts, 0.56 on the tops)
    expect(on.bornY - off.bornY, "on: on the tops of A's shoulders, higher").toBeGreaterThanOrEqual(0.05);
    expect(off.palmM, 'fault: palms in the upper arms').toBeGreaterThanOrEqual(0.05);
    expect(off.forearmM, 'fault: forearms in the upper arms').toBeGreaterThanOrEqual(0.04);
  }, 180_000);
});
