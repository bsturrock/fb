// Plan 16 (p46): the winner stays low (`BlockProfile.under`, UNDER_V1, `withUnder`) on a contest that keeps the hit's
// outcome (`BlockContest.beaten`, `nextBeaten`). The kept outcome on constructed cases; then a state captured in
// BL-F10-twoPointVsThree at the snap (3.3 s; the lanes and their leverage on, so A has the inside and wins the hit),
// resumed with the under stance and without it. With their fault twins.
import { describe, expect, it } from 'vitest';
import { nextBeaten } from '../src/sim/block-base';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, sub, v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p46), the winner stays low', () => {
  it("the kept outcome: how far he is stood up past his man, its peak held while his man's palms are on him, released at the stood level's pace once they are off; fault twin: not held, it falls with the stood level", () => {
    const dt = 1 / 240;
    const run = (held: (t: number) => boolean): number[] => {
      let b: number | undefined;
      const out: number[] = [];
      for (let i = 0; i < 480; i++) {
        const t = i * dt;
        // (stood up to 0.9 at once, released over 0.3 s; his man never stood up)
        const level = 0.9 * Math.exp(-t / 0.3);
        b = nextBeaten(b, level, 0, held(t), dt, 0.3);
        out.push(b);
      }
      return out;
    };
    const on = run((t) => t < 1);
    expect(on[0], 'his level past his man').toBeCloseTo(0.9, 9);
    expect(on[239], 'held at the peak while the palms are on').toBeCloseTo(0.9, 9);
    // (off at 1 s: released from the peak at the level's 0.3 s)
    expect(on[479], 'released once they are off').toBeCloseTo(0.9 * Math.exp(-(479 - 239) * dt / 0.3), 2);
    // (his man stood up as far as he is: not beaten past him)
    expect(nextBeaten(undefined, 0.5, 0.5, true, dt, 0.3), 'level with his man').toBe(0);
    const off = run(() => false);
    expect(off[239], 'fault: not held, released with the level').toBeLessThan(0.1);
  });

  const CAPTURE_S = 3.3;
  const END_S = 6.3;
  function scene(under: boolean): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    const d = blockScene({ ...s, id: 'BL-T-under', durationS: END_S + 0.1, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: false, foldKeeps: false, armsGive: false }, FIX('L3-F6-hold'));
    if (under) return d;
    // a twin: the under stance off (resumed as a variant at that path; the kept outcome still kept, unread)
    return {
      ...d,
      players: d.players.map((p) => {
        if (p.controller?.kind !== 'block') return p;
        return { ...p, controller: { ...p.controller, profile: { ...p.controller.profile!, under: undefined } } };
      }),
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
    /** per man: his hips over the ground at 0.3 s after contact (m), their mean from 0.6 to 2 s (m), his trunk's mean pitch then (deg), how far he is moved toward his man by 0.35 s and by 2 s (m, - back) */
    men: Record<string, { hip03: number; hip: number; trunkDeg: number; move035: number; move2: number }>;
    /** the most A is beaten (0..1) */
    aBeaten: number;
    falls: string[];
  }
  async function run(under: boolean): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(under), ...(under ? {} : { variant: ['players.0.controller.profile.under', 'players.1.controller.profile.under'] }) });
    const n0 = sim.events.length;
    let t0: number | null = null;
    let u = v3(0, 0, 1);
    const H = (p: Vec3) => v3(p.x, 0, p.z);
    const x0: Record<string, number> = {};
    const acc: Record<string, { hip03: number; hipS: number; trS: number; n: number; move035: number; move2: number }> = {};
    let aBeaten = 0;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const [a, b] = sim.players;
      if (a.rag || b.rag || !a.pose || !b.pose) continue;
      if (t0 === null && (a.block?.phase === 'engaged' || b.block?.phase === 'engaged')) {
        t0 = sim.t;
        u = norm(sub(H(b.proxy.body.translation()), H(a.proxy.body.translation())));
        for (const p of [a, b]) {
          x0[p.id] = dot(H(p.proxy.body.translation()), u);
          acc[p.id] = { hip03: 0, hipS: 0, trS: 0, n: 0, move035: 0, move2: 0 };
        }
      }
      if (t0 === null) continue;
      const rel = sim.t - t0;
      aBeaten = Math.max(aBeaten, a.block?.contest?.beaten ?? 0);
      for (const p of [a, b]) {
        const sg = p === a ? 1 : -1;
        const L = p.pose!.jointLandmarksWorld;
        const hipY = (L.leftHip.y + L.rightHip.y) / 2 - p.sus!.probe.groundY;
        const hip = v3((L.leftHip.x + L.rightHip.x) / 2, (L.leftHip.y + L.rightHip.y) / 2, (L.leftHip.z + L.rightHip.z) / 2);
        const sh = v3((L.leftShoulder.x + L.rightShoulder.x) / 2, (L.leftShoulder.y + L.rightShoulder.y) / 2, (L.leftShoulder.z + L.rightShoulder.z) / 2);
        const tv = sub(sh, hip);
        const m = acc[p.id];
        const x = sg * (dot(H(p.proxy.body.translation()), u) - x0[p.id]);
        if (rel <= 0.3 + 1e-9) m.hip03 = hipY;
        if (rel <= 0.35 + 1e-9) m.move035 = x;
        if (rel <= 2 + 1e-9) m.move2 = x;
        if (rel >= 0.6 && rel <= 2) {
          m.hipS += hipY;
          m.trS += (Math.atan2(sg * dot(tv, u), tv.y) * 180) / Math.PI;
          m.n++;
        }
      }
    }
    const falls = sim.events.slice(n0).filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}:${(e.data as { reason?: string }).reason}`);
    sim.dispose();
    const men: Out['men'] = {};
    for (const [id, m] of Object.entries(acc)) men[id] = { hip03: m.hip03, hip: m.hipS / m.n, trunkDeg: m.trS / m.n, move035: m.move035, move2: m.move2 };
    return { men, aBeaten, falls };
  }

  it("the fire-out resumed from the snap with the under stance: the hit as without it (both men's ground by 0.35 s within 1 mm), then A, who won it, drives from under, his hips 7 cm or more below B's from 0.6 to 2 s after contact and his trunk pitched 24 deg or more, B held up 3 cm or more over his set stance's hips; nobody falls; fault twin: without it, A's hips come back up level with B's (within 2 cm)", async () => {
    const on = await run(true);
    const off = await run(false);
    const { A, B } = on.men;
    for (const id of ['A', 'B']) expect(Math.abs(on.men[id].move035 - off.men[id].move035), `the hit unchanged (${id})`).toBeLessThan(1e-3);
    expect(on.aBeaten, 'A, the winner, not beaten').toBeLessThan(0.1);
    expect(B.hip - A.hip, 'on: A under B').toBeGreaterThanOrEqual(0.07);
    expect(A.trunkDeg, "on: A's trunk in").toBeGreaterThanOrEqual(24);
    // (B's set stance: hips 0.815 m over the ground on the BL body)
    expect(B.hip, 'on: B held up').toBeGreaterThanOrEqual(0.815 + 0.03);
    expect(B.move2, 'on: B driven back').toBeLessThan(off.men.B.move2);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    // (without: A's hips 0.815, B's 0.818 from 0.6 to 2 s)
    expect(Math.abs(off.men.B.hip - off.men.A.hip), 'fault: level').toBeLessThan(0.02);
  }, 180_000);
});
