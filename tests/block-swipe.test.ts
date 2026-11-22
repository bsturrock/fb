// Plan 16 (p50), the hand fight's swipe and knock (`BlockHandFight.swipe`, `.knock`, HANDS_V2; `BlockRequest.swipes`,
// `nextHand`, `handsLeverage`, `openedBy`; the simulation's `handContacts`, `ArmSystem.knock`). The rules on constructed
// inputs (a swipe begun when due, its raise and chop, a miss and a hit; a knock taken, held and done; what a knocked hand
// costs and what it opens, only when it ended a push), then a pass rush built on BL-F10-twoPointVsThree (A holds in the
// two-point set, B drives from the defense three-point; A has the inside), resumed from a capture shortly before B's
// right hand swipes at A's left arm: the chop meets the arm, A's palm push on it ends knocked, his hand is driven away and
// comes back on within the film's 0.1-0.4 s, he is cut in the contest while it is off and B bursts into the opening.
// Fault twins: the chop never meets the arm (no knock, the push holds), and the knock free in the contest (no cut, no
// burst: B gains less ground).
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { HANDS_V2, handsLeverage, nextHand, openedBy, type HandState } from '../src/sim/controllers/block';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { len, sub, v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

const F = HANDS_V2;
const S = F.swipe!;
const home = (o: Partial<HandState> = {}): HandState => ({ doing: 'home', since: 0, on: true, pushing: true, where: 'chest', lane: 'inside', ...o });

describe('plan 16 (p50), the swipe and the knock', () => {
  it('a swipe begins when due, raises over his arm and chops through it; a miss ends at its point, a hit rides to its time; fault twin: no swipe without the hand fight', () => {
    const t0 = 1;
    const a = nextHand(home(), undefined, t0, { fight: F, due: { n: 0, at: 'left' } });
    expect(a).toEqual({ doing: 'swiping', since: t0, swipes: 1, swipe: { n: 0, at: 'left', stage: 'raise', stageT: t0 } });
    // (without a swipe in the hand fight a due request is nothing)
    expect(nextHand(home(), undefined, t0, { fight: { id: 'x' }, due: { n: 0, at: 'left' } }).doing).toBe('home');
    // the raise holds until within its tolerance (or its time), then the chop to the point given then
    const through = v3(0, 0.8, 0.3);
    expect(nextHand({ ...home(), ...a }, undefined, t0 + 0.02, { fight: F, raiseLeftM: S.tolM + 0.01, throughW: through }).swipe!.stage).toBe('raise');
    const c = nextHand({ ...home(), ...a }, undefined, t0 + 0.03, { fight: F, raiseLeftM: S.tolM - 0.01, throughW: through });
    expect(c.swipe).toEqual({ n: 0, at: 'left', stage: 'chop', stageT: t0 + 0.03, throughW: through });
    expect(nextHand({ ...home(), ...a }, undefined, t0 + S.raiseS, { fight: F, raiseLeftM: 1, throughW: through }).swipe!.stage).toBe('chop');
    // a miss: the chop at its point is done, the hand at home, its swipe counted
    const m = nextHand({ ...home(), ...c }, undefined, t0 + 0.06, { fight: F, chopLeftM: S.tolM - 0.01 });
    expect(m).toEqual({ doing: 'home', since: t0 + 0.06, swipes: 1 });
    // a hit: it rides his arm from where it met it, to the chop's time, wherever its point
    const ride = v3(0.01, 0.09, 0);
    const h = nextHand({ ...home(), ...c, hit: t0 + 0.04 }, undefined, t0 + 0.05, { fight: F, chopLeftM: 0, rideW: ride });
    expect(h.doing).toBe('swiping');
    expect(h.swipe!.rideW).toEqual(ride);
    expect(nextHand({ ...home(), ...h, hit: t0 + 0.04 }, undefined, t0 + 0.03 + S.chopS, { fight: F, chopLeftM: 0 }).doing).toBe('home');
    // a hit from an earlier swipe is not this one's
    expect(nextHand({ ...home(), ...c, hit: t0 - 0.5 }, undefined, t0 + 0.06, { fight: F, chopLeftM: 0 }).doing).toBe('home');
  });

  it('a knock is taken once, held for its time, then home; it costs and opens only when it ended a push, until the hand is back on; fault twin: a knock that ended nothing', () => {
    const k = { t: 2, dirW: v3(0, -1, 0), palmW: v3(), by: 'B', ended: true };
    const a = nextHand(home({ knock: k }), undefined, 2.01, { fight: F });
    expect(a).toEqual({ doing: 'knocked', since: 2, knockT: 2 });
    expect(nextHand(home({ ...a, knock: k }), undefined, 2 + F.knock!.s - 0.01, { fight: F }).doing).toBe('knocked');
    const b = nextHand(home({ ...a, knock: k }), undefined, 2 + F.knock!.s, { fight: F });
    expect(b).toEqual({ doing: 'home', since: 2 + F.knock!.s, knockT: 2 });
    // (taken: the same knock does not knock it again)
    expect(nextHand(home({ ...b, knock: k }), undefined, 2.5, { fight: F }).doing).toBe('home');
    const H = (l: Partial<HandState>) => ({ left: home(l), right: home() });
    expect(handsLeverage(H({ doing: 'knocked', on: false, knock: k }), F)).toBeCloseTo(1 - F.knock!.cut, 12);
    expect(handsLeverage(H({ on: false, knock: k }), F)).toBeCloseTo(1 - F.offCut!, 12);
    expect(handsLeverage(H({ on: true, knock: { ...k, backT: 2.3 } }), F)).toBe(1);
    expect(handsLeverage(H({ on: false, knock: { ...k, backT: 2.3 } }), F)).toBe(1);
    expect(openedBy('B', H({ on: false, knock: k }), F)).toBe(true);
    expect(openedBy('C', H({ on: false, knock: k }), F)).toBe(false);
    expect(openedBy('B', H({ on: true, knock: { ...k, backT: 2.3 } }), F)).toBe(false);
    // fault twin: a knock on a hand that was not on him ends nothing, costs nothing, opens nothing
    const free = { ...k, ended: false };
    expect(handsLeverage(H({ doing: 'knocked', on: false, knock: free }), F)).toBe(1);
    expect(openedBy('B', H({ on: false, knock: free }), F)).toBe(false);
  });

  const SWIPE_S = 4.3;
  const CAPTURE_S = 4.2;
  const END_S = 4.9;
  const scene = (): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    return blockScene({ ...s, id: 'BL-T-swipe', durationS: END_S + 0.1, A: { ...s.A, intent: 'hold', effort: 0.5 }, B: { ...s.B, intent: 'drive', effort: 0.6, swipes: [{ atS: SWIPE_S, hand: 'right' }] }, handFight: HANDS_V2 }, FIX('L3-F6-hold'));
  };
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene());
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Out {
    knocks: number;
    /** A's left palm push: how it ended in the window, when it was back on (s after the knock) */
    endReason: string | null;
    offS: number | null;
    /** how far A's left palm went from where the chop met it (m), and B's palm's least gap to A's left forearm (m) */
    movedM: number;
    /** A's contest leverage, least in the window; B's contest push capacity, most while the hand is off */
    aLevMin: number;
    bPushMax: number;
    /** B's ground toward A over 0.5 s from the swipe (m) */
    bGainM: number;
  }
  async function run(faults?: { swipeMisses?: boolean; knockFree?: boolean }): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(), ...(faults ? { faults: { block: faults } } : {}) });
    const n0 = sim.events.length;
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    const out: Out = { knocks: 0, endReason: null, offS: null, movedM: 0, aLevMin: Infinity, bPushMax: 0, bGainM: 0 };
    let met: Vec3 | null = null;
    let knockT: number | null = null;
    let bz0: number | null = null;
    let ev = n0;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        const d = e.data as { arm?: string; reason?: string };
        if (e.type === 'handKnock') {
          out.knocks++;
          knockT = e.t;
          met = { ...a.pose!.jointLandmarksWorld.leftPalm };
        }
        if (e.type === 'pushEnd' && e.playerId === 'A' && d.arm === 'left' && out.endReason === null) out.endReason = d.reason ?? null;
        if (e.type === 'pushBegin' && e.playerId === 'A' && d.arm === 'left' && knockT !== null && out.offS === null) out.offS = e.t - knockT;
      }
      if (sim.t + 1e-9 >= SWIPE_S && bz0 === null) bz0 = b.proxy.body.translation().z;
      if (bz0 !== null && sim.t <= SWIPE_S + 0.5 + 1e-9) out.bGainM = bz0 - b.proxy.body.translation().z;
      if (met) out.movedM = Math.max(out.movedM, len(sub(a.pose!.jointLandmarksWorld.leftPalm, met)));
      if (sim.t >= SWIPE_S) out.aLevMin = Math.min(out.aLevMin, a.block!.contest!.leverage);
      if (knockT !== null && out.offS === null) out.bPushMax = Math.max(out.bPushMax, b.block!.contest!.pushN);
    }
    sim.dispose();
    return out;
  }

  it('the pass rush: the chop meets his arm and knocks his push off, his hand driven away and back on in 0.1-0.4 s, cut in the contest and opened to B; fault twins: a chop that never meets (nothing), a knock free in the contest (less ground)', async () => {
    const on = await run();
    expect(on.knocks).toBe(1);
    expect(on.endReason).toBe('knocked');
    expect(on.offS).not.toBeNull();
    expect(on.offS!).toBeGreaterThanOrEqual(0.1);
    expect(on.offS!).toBeLessThanOrEqual(0.4);
    expect(on.movedM).toBeGreaterThan(0.15);
    expect(on.aLevMin).toBeCloseTo(1 - F.knock!.cut, 6);
    // fault twin: the chop never meets his arm
    const miss = await run({ swipeMisses: true });
    expect(miss.knocks).toBe(0);
    expect(miss.endReason).toBeNull();
    expect(miss.aLevMin).toBe(1);
    // fault twin: the knock free in the contest
    const free = await run({ knockFree: true });
    expect(free.knocks).toBe(1);
    expect(free.endReason).toBe('knocked');
    expect(free.aLevMin).toBe(1);
    expect(on.bPushMax).toBeGreaterThan(1.5 * free.bPushMax);
    expect(on.bGainM).toBeGreaterThan(free.bGainM + 0.01);
  }, 120_000);
});
