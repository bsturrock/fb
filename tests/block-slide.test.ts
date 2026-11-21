// Plan 16 (p47): a held palm's patch slides on to its aim (`PalmPushProfile.slide`, `BlockSceneOpts.palmSlide`,
// PALM_SLIDE). A state captured in BL-F10-twoPointVsThree at the snap (3.3 s; the full p46 set, so A has the inside and
// B the outside, his palms aimed at the tops of A's shoulders), resumed with the slide and, as the twin, without. With
// its fault twin.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { qInvRot, sub } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { depth, drawnShapes } from './visible';
import { FIX } from './helpers';

describe('plan 16 (p47), a held palm slides on to its aim', () => {
  const CAPTURE_S = 3.3;
  const END_S = 6.3;
  function scene(slide: boolean, highM?: number): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    const d = blockScene({ ...s, id: 'BL-T-slide', durationS: END_S + 0.1, palmSlide: slide }, FIX('L3-F6-hold'));
    if (highM === undefined) return d;
    const P = d.armProfile!.palmPush!;
    return { ...d, armProfile: { ...d.armProfile!, palmPush: { ...P, band: { ...P.band, highM } } } };
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
  interface Out {
    lane?: string;
    /** over the 2 s after contact: the deepest B's drawn palms are in A's drawn upper arms (m), the mean, the time past 1 cm (s) */
    palmM: number;
    palmMeanM: number;
    palmOverS: number;
    /** B's patches on A, height in A's frame (m): the lower of the two 0.3 s after contact, the highest at any time */
    y03: number;
    yMax: number;
    /** each man's palms on his man over the 2 s after contact (s) */
    onA: number;
    onB: number;
    falls: string[];
  }
  async function run(slide: boolean, highM?: number): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(slide, highM), ...(slide ? { variant: ['armProfile'] } : {}) });
    const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    const arms = sim.arms!;
    const n0 = sim.events.length;
    const out: Out = { palmM: 0, palmMeanM: 0, palmOverS: 0, y03: NaN, yMax: -Infinity, onA: 0, onB: 0, falls: [] };
    const [a, b] = sim.players;
    let t0: number | null = null;
    let n = 0;
    let last = sim.t;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const dt = sim.t - last;
      last = sim.t;
      if (a.rag || b.rag || !a.pose || !b.pose) continue;
      if (t0 === null && (a.block?.phase === 'engaged' || b.block?.phase === 'engaged')) t0 = sim.t;
      if (t0 === null || sim.t - t0 > 2) continue;
      const ta = a.proxy.body.translation();
      const qa = a.proxy.body.rotation();
      const ys: number[] = [];
      for (const s of ['left', 'right'] as const) {
        const pu = arms.pushOf('B', s);
        if (pu?.targetId === 'A') ys.push(qInvRot(qa, sub(pu.pointWorld, { x: ta.x, y: ta.y, z: ta.z })).y);
      }
      if (ys.length) out.yMax = Math.max(out.yMax, ...ys);
      if (Number.isNaN(out.y03) && sim.t - t0 >= 0.3 - 1e-9) out.y03 = ys.length === 2 ? Math.min(...ys) : -Infinity;
      if (['left', 'right'].some((s) => arms.pushOf('A', s as 'left')?.targetId === 'B')) out.onA += dt;
      if (['left', 'right'].some((s) => arms.pushOf('B', s as 'left')?.targetId === 'A')) out.onB += dt;
      const his = drawnShapes(a.pose, a.body, R).filter((s) => s.cls === 'upperArm' || s.cls === 'upperArmD');
      let pd = 0;
      for (const x of drawnShapes(b.pose, b.body, R).filter((s) => s.cls === 'palm')) for (const y of his) pd = Math.max(pd, depth(x, y));
      out.palmM = Math.max(out.palmM, pd);
      out.palmMeanM += pd;
      if (pd > 0.01) out.palmOverS += dt;
      n++;
    }
    out.palmMeanM /= Math.max(1, n);
    for (const e of sim.events.slice(n0)) {
      if (e.type === 'blockLane' && e.playerId === 'B') out.lane = (e.data as { lane: string }).lane;
      if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    }
    sim.dispose();
    return out;
  }

  it("the fire-out resumed from the snap: B, outside, lands his palms on A's upper chest and they ride up onto the tops of his shoulders (both at least 0.62 m up A's frame 0.3 s after contact, never past the band's 0.66), over A's upper arms: in the 2 s after contact on average under 0.5 cm into them, past 1 cm for under 0.3 s; both men's palms on for 1.9 s or more, nobody falls; fault twin: the palms stay where they landed (0.58 m or lower), 2 cm into A's upper arms on average, past 1 cm for 1.5 s or more", async () => {
    const on = await run(true);
    expect(on.lane, 'on: B outside').toBe('outside');
    expect(on.y03, "on: B's palms on the tops of A's shoulders").toBeGreaterThanOrEqual(0.62);
    expect(on.yMax, 'on: within the band').toBeLessThanOrEqual(0.66 + 1e-9);
    expect(on.palmMeanM, 'on: palms over the upper arms (mean)').toBeLessThan(0.005);
    expect(on.palmOverS, 'on: palms past 1 cm into the upper arms (s)').toBeLessThan(0.3);
    expect(on.onA, "on: A's palms on (s)").toBeGreaterThanOrEqual(1.9);
    expect(on.onB, "on: B's palms on (s)").toBeGreaterThanOrEqual(1.9);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    const off = await run(false);
    expect(off.lane, 'twin: B outside').toBe('outside');
    expect(off.y03, "fault: B's palms where they landed").toBeLessThanOrEqual(0.58);
    expect(off.palmMeanM, 'fault: palms in the upper arms (mean)').toBeGreaterThanOrEqual(0.02);
    expect(off.palmOverS, 'fault: palms past 1 cm into the upper arms (s)').toBeGreaterThanOrEqual(1.5);
  }, 180_000);

  it("the band holds the slide: with the band's top at 0.62 m B's palms ride up to it and stop there", async () => {
    const lo = await run(true, 0.62);
    expect(lo.yMax, 'at most the band top').toBeLessThanOrEqual(0.62 + 1e-9);
    expect(lo.yMax, 'up to it').toBeGreaterThanOrEqual(0.61);
  }, 180_000);
});
