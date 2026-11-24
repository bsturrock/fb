// Plan 16 (p51), the body in the hand fight (`BlockHandFight.body`, `HandBody`, HANDS_V5; `handsBody`, `nextHand`'s
// `swungT`): the swiper's trunk turns with his swing, ahead of his hand, dips onto the hinge and leans to the swinging
// side, and comes back as his hand goes back on; the knocked man falls into the side his hand left, that shoulder forward
// and down, and comes back as his hand re-fits. The rule on constructed inputs, then BL-F12-passRush with its first swipe
// only (B's right hand at A's left arm at 4.25 s), resumed from a capture shortly before it, with the body and, as the
// fault twin, without it (HANDS_V4): with it B's right shoulder comes further forward and lower through the chop, and
// A's left shoulder comes forward with the knock and goes back as his hand is back on, his hands off no longer for it.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { HANDS_V4, HANDS_V5, handsBody, nextHand, type BlockHandFight, type HandIntent, type HandState } from '../src/sim/controllers/block';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

const F = HANDS_V5;
const A = F.swipe!.arc!;
const W = F.body!.swing;
const K = F.body!.knock;
const back = F.refit!.path!.s;
const home = (o: Partial<HandState> = {}): HandState => ({ doing: 'home', since: 0, on: true, pushing: true, where: 'chest', lane: 'inside', ...o });
const idle: HandIntent = { doing: 'home', since: 0 };
const none = (o: { turnDeg: number; dipDeg: number; rollDeg: number }) => {
  expect(o.turnDeg).toBeCloseTo(0, 9);
  expect(o.dipDeg).toBeCloseTo(0, 9);
  expect(o.rollDeg).toBeCloseTo(0, 9);
};

describe('plan 16 (p51), the body in the hand fight', () => {
  it("the swiper's trunk: back over the wind-up's first half, through by the chop's middle, back to none after; mirrored for the left; fault twin: without the body, nothing", () => {
    const t0 = 1;
    const sw = (s: number, side: 'left' | 'right' = 'right'): HandIntent => ({ doing: 'swiping', since: t0, swipes: 1, swipe: { n: 0, at: side === 'right' ? 'left' : 'right', stage: s < A.windS ? 'raise' : 'chop', stageT: s < A.windS ? t0 : t0 + A.windS } });
    const at = (s: number, side: 'left' | 'right' = 'right') => handsBody(F, { [side]: sw(s, side), [side === 'right' ? 'left' : 'right']: idle }, undefined, t0 + s);
    expect(at(0)).toEqual({ turnDeg: 0, dipDeg: 0, rollDeg: 0 });
    // (+ his right shoulder forward; + his right side down)
    expect(at(A.windS / 2).turnDeg).toBeCloseTo(-W.backDeg, 9);
    const mid = at(A.windS + A.chopS / 2);
    expect(mid.turnDeg).toBeCloseTo(W.thruDeg, 9);
    expect(mid.dipDeg).toBeCloseTo(W.dipDeg, 9);
    expect(mid.rollDeg).toBeCloseTo(W.rollDeg, 9);
    expect(at(A.windS + A.chopS - 0.01).turnDeg).toBeCloseTo(W.thruDeg, 9);
    expect(at(A.windS + A.chopS / 2, 'left').turnDeg).toBeCloseTo(-W.thruDeg, 9);
    expect(at(A.windS + A.chopS / 2, 'left').rollDeg).toBeCloseTo(-W.rollDeg, 9);
    // after the chop, back to none over the path's time
    const t1 = t0 + A.windS + A.chopS;
    const after = (t: number) => handsBody(F, { right: { doing: 'refitting', since: t1, swipes: 1, swungT: t1 }, left: idle }, undefined, t);
    expect(after(t1).turnDeg).toBeCloseTo(W.thruDeg, 9);
    expect(after(t1 + back / 2).turnDeg).toBeCloseTo(W.thruDeg / 2, 9);
    none(after(t1 + back));
    // fault twin: without the body
    expect(handsBody(HANDS_V4, { right: sw(A.windS + A.chopS / 2), left: idle }, undefined, t0 + A.windS + A.chopS / 2)).toEqual({ turnDeg: 0, dipDeg: 0, rollDeg: 0 });
  });

  it("the knocked man: that shoulder forward and down as his hand is carried, back to none after; fault twin: a knock that ended no push", () => {
    const k = { t: 2, dirW: v3(0, -1, 0), palmW: v3(), by: 'B', ended: true };
    const was = (kk: typeof k) => ({ left: home({ on: false, knock: kk }), right: home() });
    const hands = { left: { doing: 'knocked', since: 2, knockT: 2 } as HandIntent, right: idle };
    const end = handsBody(F, hands, was(k), 2 + F.knock!.s);
    // (his left shoulder forward: + is his right's; his left side down: + is his right's)
    expect(end.turnDeg).toBeCloseTo(-K.turnDeg, 9);
    expect(end.rollDeg).toBeCloseTo(-K.rollDeg, 9);
    expect(end.dipDeg).toBe(0);
    expect(handsBody(F, hands, was(k), 2 + F.knock!.s / 2).turnDeg).toBeLessThan(-K.turnDeg / 2);
    expect(handsBody(F, hands, was(k), 2 + F.knock!.s + back / 2).turnDeg).toBeCloseTo(-K.turnDeg / 2, 9);
    none(handsBody(F, hands, was(k), 2 + F.knock!.s + back));
    // fault twin: a knock on a hand that was not on him
    expect(handsBody(F, hands, was({ ...k, ended: false }), 2 + F.knock!.s)).toEqual({ turnDeg: 0, dipDeg: 0, rollDeg: 0 });
  });

  it("a swipe's end is kept (swungT) with the body; fault twin: without it, none", () => {
    const t0 = 1;
    const tc = t0 + A.windS;
    const c: HandState = { ...home(), doing: 'swiping', since: t0, swipes: 1, swipe: { n: 0, at: 'left', stage: 'chop', stageT: tc }, on: false };
    const r = nextHand(c, undefined, tc + A.chopS, { fight: F, palmL: v3() });
    expect(r).toEqual({ doing: 'refitting', since: tc + A.chopS, swipes: 1, swungT: tc + A.chopS, fromL: v3() });
    expect(nextHand({ ...home(), ...r, on: true }, undefined, tc + A.chopS + 0.1, { fight: F })).toEqual({ doing: 'home', since: tc + A.chopS + 0.1, swipes: 1, swungT: tc + A.chopS });
    expect(nextHand(c, undefined, tc + A.chopS, { fight: HANDS_V4, palmL: v3() }).swungT).toBeUndefined();
  });

  const SWIPE_S = 4.25;
  const CAPTURE_S = 4.15;
  const END_S = 5.15;
  const scene = (H: BlockHandFight): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F12-passRush')!;
    return blockScene({ ...s, id: 'BL-T-swipeBody', durationS: END_S + 0.1, B: { ...s.B, swipes: [{ atS: SWIPE_S, hand: 'right' }] }, handFight: H }, FIX('L3-F6-hold'));
  };
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene(F));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  /** the shoulder line's heading about the vertical (deg, left to right shoulder) */
  const line = (L: Record<string, Vec3>) => (Math.atan2(L.rightShoulder.x - L.leftShoulder.x, L.rightShoulder.z - L.leftShoulder.z) * 180) / Math.PI;
  const wrap = (d: number) => ((d + 540) % 360) - 180;
  interface Out {
    /** B's right shoulder: most forward (deg of his shoulder line from the swipe's start) and most down (m) */
    bFwdDeg: number;
    bDropM: number;
    /** A's left shoulder: most forward (deg) and when (s after the swipe began); how far forward still 0.8 s after the swipe began */
    aFwdDeg: number;
    aFwdAtS: number;
    aEndDeg: number;
    /** B's right hand back on (s after the swipe began), A's left (s after the knock); anyone down */
    bBackS: number | null;
    aBackS: number | null;
    falls: number;
  }
  async function run(H: BlockHandFight): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(H), ...(H === F ? {} : { variant: ['players.0.controller.profile', 'players.1.controller.profile'] }) });
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    const out: Out = { bFwdDeg: 0, bDropM: 0, aFwdDeg: 0, aFwdAtS: 0, aEndDeg: 0, bBackS: null, aBackS: null, falls: 0 };
    let t0: number | null = null;
    let knockT: number | null = null;
    let b0 = 0;
    let a0 = 0;
    let bY0 = 0;
    let ev = sim.events.length;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        const d = e.data as { arm?: string };
        if (e.type === 'handSwipe' && e.playerId === 'B') {
          t0 = e.t;
          b0 = line(b.pose!.jointLandmarksWorld);
          a0 = line(a.pose!.jointLandmarksWorld);
          bY0 = b.pose!.jointLandmarksWorld.rightShoulder.y;
        }
        if (e.type === 'handKnock' && knockT === null) knockT = e.t;
        if (e.type === 'pushBegin' && e.playerId === 'B' && d.arm === 'right' && t0 !== null && out.bBackS === null) out.bBackS = e.t - t0;
        if (e.type === 'pushBegin' && e.playerId === 'A' && d.arm === 'left' && knockT !== null && out.aBackS === null) out.aBackS = e.t - knockT;
        if (/fall|ragdoll|overpowered/i.test(e.type)) out.falls++;
      }
      if (t0 === null) continue;
      // (B faces -z: his right shoulder forward turns his line's heading up; A faces +z: his left shoulder forward turns it down)
      out.bFwdDeg = Math.max(out.bFwdDeg, wrap(line(b.pose!.jointLandmarksWorld) - b0));
      out.bDropM = Math.max(out.bDropM, bY0 - b.pose!.jointLandmarksWorld.rightShoulder.y);
      const af = -wrap(line(a.pose!.jointLandmarksWorld) - a0);
      if (af > out.aFwdDeg) {
        out.aFwdDeg = af;
        out.aFwdAtS = sim.t - t0;
      }
      if (sim.t - t0 <= 0.8 + 1e-9) out.aEndDeg = af;
    }
    sim.dispose();
    return out;
  }

  it("the pass rush: the swiper's shoulder further forward and down through the chop; the knocked man's shoulder comes forward and goes back as his hand is back on; fault twin: without the body", async () => {
    const on = await run(F);
    const off = await run(HANDS_V4);
    expect(on.bFwdDeg).toBeGreaterThan(off.bFwdDeg + 2);
    expect(on.bDropM).toBeGreaterThan(off.bDropM + 0.015);
    expect(on.aFwdDeg).toBeGreaterThan(5);
    expect(off.aFwdDeg).toBeLessThan(4);
    // the most of it after the knock, and back to under half by 0.8 s
    expect(on.aFwdAtS).toBeGreaterThan(A.windS + A.chopS / 2);
    expect(on.aEndDeg).toBeLessThan(on.aFwdDeg / 2);
    // the hands no longer off for it; nobody down
    for (const o of [on, off]) {
      expect(o.bBackS).not.toBeNull();
      expect(o.bBackS!).toBeLessThanOrEqual(0.45);
      expect(o.aBackS).not.toBeNull();
      expect(o.aBackS!).toBeLessThanOrEqual(0.3);
      expect(o.falls).toBe(0);
    }
  }, 120_000);
});
