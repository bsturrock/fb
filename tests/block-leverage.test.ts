// Plan 16 (p45): the inside lane's leverage (`BlockContest.inside`, INSIDE_LEVERAGE, `contestCapacity`'s `leverage`). The
// capacity on constructed cases; then a state captured in BL-F10-twoPointVsThree at the snap (3.3 s; the lanes and the
// leverage on), A winning the inside and B going outside onto A's shoulders, B's palms landing 0.02 s before A's and so
// winning the hit, resumed with the leverage and without it. With its fault twins.
import { describe, expect, it } from 'vitest';
import { contestCapacity, CONTEST_V2, INSIDE_LEVERAGE } from '../src/sim/block-base';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, sub, v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p45), the inside lane\'s leverage', () => {
  it("the capacity: an outside man's push, brake and hold over the leverage, after his drive's bound (a burst at the bound cut too); none, as before", () => {
    const base = { effort: 0.5, lowM: 0, feet: 1, level: 0, anchored: true, driveCapN: 350 };
    for (const burstN of [0, Infinity]) {
      const one = contestCapacity(CONTEST_V2, { ...base, leverage: 1, burstN });
      const cut = contestCapacity(CONTEST_V2, { ...base, leverage: 1 / INSIDE_LEVERAGE, burstN });
      // (bursting, the push is at the drive's bound: a factor before the bound would leave it there)
      if (burstN) expect(one.pushN, 'at the bound').toBe(350);
      for (const k of ['pushN', 'brakeN', 'holdN'] as const) expect(cut[k], `${k} (burst ${burstN})`).toBeCloseTo(one[k] / INSIDE_LEVERAGE, 9);
    }
  });

  const CAPTURE_S = 3.3;
  const END_S = 5.3;
  function scene(on: boolean): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    const d = blockScene({ ...s, id: 'BL-T-leverage', durationS: END_S + 0.1, lanes: true, insideLeverage: true, stayLow: false, shoulderTops: false }, FIX('L3-F6-hold'));
    if (on) return d;
    // a twin keeps the capture's profile ids, the leverage off
    return {
      ...d,
      players: d.players.map((p) => {
        if (p.controller?.kind !== 'block') return p;
        const P = p.controller.profile!;
        return { ...p, controller: { ...p.controller, profile: { ...P, contest: { ...P.contest!, inside: undefined } } } };
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
  interface Man {
    lane: string | undefined;
    /** how far he is stood up at most in the 0.4 s after contact (0..1), how far he is moved toward his man by 1 s after it (m, - back), his hips' rise over the 0.4 s (m), and when after contact he is last moved back faster than 0.1 m/s (s) */
    stood: number;
    moveM: number;
    riseM: number;
    backT: number;
  }
  async function run(on: boolean): Promise<{ men: Record<string, Man>; falls: string[] }> {
    const sim = await resumeState(await captured(), { def: scene(on) });
    const n0 = sim.events.length;
    const men: Record<string, Man> = {};
    let t0: number | null = null;
    let u = v3(0, 0, 1);
    const x0: Record<string, number> = {};
    const hip0: Record<string, number> = {};
    const H = (p: Vec3) => v3(p.x, 0, p.z);
    const hipY = (p: (typeof sim.players)[number]): number => (p.pose!.jointLandmarksWorld.leftHip.y + p.pose!.jointLandmarksWorld.rightHip.y) / 2;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const [a, b] = sim.players;
      if (a.rag || b.rag || !a.pose || !b.pose) continue;
      if (t0 === null && (a.block?.phase === 'engaged' || b.block?.phase === 'engaged')) {
        t0 = sim.t;
        u = norm(sub(H(b.proxy.body.translation()), H(a.proxy.body.translation())));
        for (const p of [a, b]) {
          x0[p.id] = dot(H(p.proxy.body.translation()), u);
          hip0[p.id] = hipY(p);
          men[p.id] = { lane: undefined, stood: 0, moveM: 0, riseM: 0, backT: 0 };
        }
      }
      if (t0 === null) continue;
      const rel = sim.t - t0;
      for (const p of [a, b]) {
        const sg = p === a ? 1 : -1;
        const m = men[p.id];
        m.lane = p.block?.lane;
        if (rel <= 0.4) {
          m.stood = Math.max(m.stood, p.block?.contest?.level ?? 0);
          m.riseM = Math.max(m.riseM, hipY(p) - hip0[p.id]);
        }
        if (rel <= 1) m.moveM = sg * (dot(H(p.proxy.body.translation()), u) - x0[p.id]);
        if (sg * dot(H(p.proxy.body.linvel()), u) < -0.1) m.backT = rel;
      }
    }
    const falls = sim.events.slice(n0).filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}:${(e.data as { reason?: string }).reason}`);
    sim.dispose();
    return { men, falls };
  }

  it("the fire-out resumed from the snap with the leverage: the outside man B takes the hit, stood up (hips 3 cm or more over the inside man's rise) and knocked back 0.3 m or more by 1 s, the inside man A not stood up and not moved back; B anchors within 1.5 s, nobody falls; fault twin: without it, B's palms landing first win the hit, A is stood up and knocked back", async () => {
    const on = await run(true);
    const { A, B } = on.men;
    expect([A.lane, B.lane], 'on: A inside').toEqual(['inside', 'outside']);
    expect(B.stood, 'on: B stood up').toBeGreaterThanOrEqual(0.5);
    expect(A.stood, 'on: A not').toBeLessThan(0.1);
    expect(B.riseM - A.riseM, 'on: B rises over A').toBeGreaterThanOrEqual(0.03);
    expect(B.moveM, 'on: B knocked back').toBeLessThanOrEqual(-0.3);
    expect(A.moveM, 'on: A not moved back').toBeGreaterThanOrEqual(0);
    expect(B.backT, 'on: B anchors').toBeLessThan(1.5);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    // (without: A stood up to 0.79 and moved back 0.13 m by 1 s, B forward 0.29 m)
    const off = await run(false);
    expect(off.men.A.stood, 'fault: A stood up').toBeGreaterThanOrEqual(0.5);
    expect(off.men.A.moveM, 'fault: A knocked back').toBeLessThan(-0.05);
    expect(off.men.B.moveM, 'fault: B not').toBeGreaterThan(0);
  }, 180_000);
});
