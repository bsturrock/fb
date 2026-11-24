// Plan 16 (p53), the hands have a side (`BlockHandFight.sides`, `HandSides`, `HandHold`, `HandStrike`, HANDS_V7;
// `nextHold`, `inFrame`, `squareInFront`, `sidedLeverage`; the simulation's `advanceSides`, `PushRequest.hold`, the
// contest's strike): the offense's hand on his man's chest inside the frame, his man square in front, holds (its push
// may pull, and his man loses leverage per hold); the defense's re-punch landed is a strike (his contest strikes and the
// hit runs: the blocker knocked back and stood up, which breaks his holds); either man's re-punch landed has him back
// under. The rules on constructed inputs (a hold's forming, keeping, breaking and giving up; the frame and the front;
// the leverage by holds against the lanes'), then BL-F13-rePunch (the pass-rush set: A two-point offense holds at 0.5 with
// his hands inside, B three-point defense rushes at 0.6, his hands outside), its first exchange resumed from captures: B's re-punch breaks A's grip
// and drives him back; A's re-punches put his holds back and stop B; a hold kept on a man leaving the front is counted
// as holding. Fault twins: a hold for the defense, a patch on the shoulder top, a push whose hold ended, the lanes'
// leverage, no pull, no strike, no re-load, no control, a hold never given up.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { HANDS_V7, inFrame, lanesLeverage, nextHold, sidedLeverage, squareInFront, type BlockHandFight, type HandState, type HoldMan } from '../src/sim/controllers/block';
import { INSIDE_LEVERAGE } from '../src/sim/block-base';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, v3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { jointQuats, qAngle, SNAP_RADPS } from './visible';
import { FIX } from './helpers';

const F = HANDS_V7;
const HD = F.sides!.hold;
const L = INSIDE_LEVERAGE;
const home = (o: Partial<HandState> = {}): HandState => ({ doing: 'home', since: 0, on: true, pushing: true, where: 'chest', lane: 'inside', ...o });
const man = (o: Partial<HoldMan> = {}): HoldMan => ({ rule: HD, offense: true, front: true, level: 0, ...o });
const on = { on: true, folded: false, push: 'A:left:p1', inFrame: true };

describe('plan 16 (p53), the hands have a side', () => {
  it('a hold forms on a push inside the frame with his man square in front; never for the defense, on the shoulder top, folded, or again on a push whose hold ended', () => {
    const a = nextHold(undefined, on, man(), 3);
    expect(a).toEqual({ hold: { since: 3, push: 'A:left:p1' }, began: true });
    // (fault twins: each condition alone)
    expect(nextHold(undefined, on, man({ offense: false }), 3).hold).toBeUndefined();
    expect(nextHold(undefined, { ...on, inFrame: false }, man(), 3).hold).toBeUndefined();
    expect(nextHold(undefined, { ...on, folded: true }, man(), 3).hold).toBeUndefined();
    expect(nextHold(undefined, on, man({ front: false }), 3).hold).toBeUndefined();
    expect(nextHold(undefined, on, man({ level: HD.breakLevel }), 3).hold).toBeUndefined();
    // a push whose hold ended holds no more; a new push does
    expect(nextHold({ holdEnded: 'A:left:p1' }, on, man(), 4)).toEqual({ holdEnded: 'A:left:p1' });
    expect(nextHold({ holdEnded: 'A:left:p1' }, { ...on, push: 'A:left:p2' }, man(), 4)).toEqual({ hold: { since: 4, push: 'A:left:p2' }, holdEnded: 'A:left:p1', began: true });
  });

  it('a hold ends at once with its push or stood up past the break; outside its conditions it is kept (holding) for the let-go time, then given up; fault twin: never given up', () => {
    const h = { hold: { since: 3, push: 'A:left:p1' } };
    expect(nextHold(h, { ...on, on: false, push: undefined }, man(), 4)).toEqual({ holdEnded: 'A:left:p1', ended: 'off' });
    expect(nextHold(h, { ...on, push: 'A:left:p2' }, man(), 4)).toEqual({ holdEnded: 'A:left:p1', ended: 'off' });
    expect(nextHold(h, on, man({ level: HD.breakLevel }), 4)).toEqual({ holdEnded: 'A:left:p1', ended: 'stood' });
    expect(nextHold(h, on, man(), 4)).toEqual({ hold: { since: 3, push: 'A:left:p1' } });
    // his man off the front: kept, counted, from when it began
    const k1 = nextHold(h, on, man({ front: false }), 4);
    expect(k1).toEqual({ hold: { since: 3, push: 'A:left:p1', offT: 4 }, kept: true });
    expect(nextHold(k1, on, man({ front: false }), 4 + HD.letGoS - 0.01)).toEqual({ hold: { since: 3, push: 'A:left:p1', offT: 4 }, kept: true });
    expect(nextHold(k1, on, man({ front: false }), 4 + HD.letGoS)).toEqual({ holdEnded: 'A:left:p1', ended: 'givenUp' });
    // back in front before the let-go: a clean hold again
    expect(nextHold(k1, on, man(), 4.05)).toEqual({ hold: { since: 3, push: 'A:left:p1' } });
    // (fault twin: never given up)
    expect(nextHold(k1, on, man({ front: false }), 9, true).kept).toBe(true);
  });

  it('the frame is the chest plate (within its half width of his centre line, no higher than its top), the front a cone ahead and facing back; fault twins: the shoulder top, wide, off to the side, turned away', () => {
    expect(inFrame(HD, v3(0.12, 0.42, 0.22))).toBe(true);
    expect(inFrame(HD, v3(0.13, 0.65, 0.2))).toBe(false);
    expect(inFrame(HD, v3(0.2, 0.42, 0.22))).toBe(false);
    const me = v3(0, 0, -0.5);
    const fwd = v3(0, 0, 1);
    expect(squareInFront(HD, me, fwd, v3(0.3, 0, 0.7), v3(0, 0, -1))).toBe(true);
    // off to the side past the cone
    const side = Math.tan(((HD.frontDeg + 5) * Math.PI) / 180) * 1.2;
    expect(squareInFront(HD, me, fwd, v3(side, 0, 0.7), v3(0, 0, -1))).toBe(false);
    // turned away from him past square
    const r = ((HD.squareDeg + 5) * Math.PI) / 180;
    expect(squareInFront(HD, me, fwd, v3(0, 0, 0.7), v3(Math.sin(r), 0, -Math.cos(r)))).toBe(false);
  });

  it('the leverage by side: the defense loses per hold of his man on him, the offense per hand of his man on him inside; fault twin: the lanes', () => {
    const his = (l: Partial<HandState>, r: Partial<HandState>): Record<'left' | 'right', HandState> => ({ left: home(l), right: home(r) });
    const H = { since: 1, push: 'p' };
    expect(sidedLeverage('defense', his({ hold: H }, { hold: H }), L)).toBe(1 / L);
    expect(sidedLeverage('defense', his({ hold: H }, {}), L)).toBeCloseTo(1 / Math.sqrt(L), 12);
    expect(sidedLeverage('defense', his({}, {}), L)).toBe(1);
    expect(sidedLeverage('offense', his({ lane: 'inside' }, { lane: 'outside' }), L)).toBeCloseTo(1 / Math.sqrt(L), 12);
    expect(sidedLeverage('offense', his({ lane: 'inside', on: false }, { lane: 'outside' }), L)).toBe(1);
    // (fault twin: his own lanes: a defense man outside with both, his man's hands inside but stood off his holds, keeps
    // all he has by the holds, only two thirds by the lanes)
    const mine = his({ lane: 'outside' }, { lane: 'outside' });
    expect(sidedLeverage('defense', his({}, {}), L)).not.toBeCloseTo(lanesLeverage(mine, L), 3);
  });

  // BL-F13's first exchange: B re-punches his right at 5.0 s; A re-punches his right at 5.7 and his left at 6.3
  const s13 = BL_SCENES.find((x) => x.id === 'BL-F13-rePunch')!;
  const DT = 1 / 60;
  // (`still`: nobody re-punches)
  const scene = (H: BlockHandFight, still = false): FixtureDef =>
    blockScene({ ...s13, id: still ? 'BL-T-sidesStill' : 'BL-T-sides', durationS: 7.1, handFight: H, ...(still ? { A: { ...s13.A, rePunches: [] }, B: { ...s13.B, rePunches: [] } } : {}) }, FIX('L3-F6-hold'));
  const caps = new Map<string, StateCapture>();
  async function captured(at: number, still: boolean): Promise<StateCapture> {
    const c = caps.get(`${at}:${still}`);
    if (c) return c;
    const sim = await Simulation.create(scene(F, still));
    while (sim.t < at - 1e-9) sim.stepTick();
    const cap = captureState(sim);
    caps.set(`${at}:${still}`, cap);
    sim.dispose();
    return cap;
  }
  interface Run {
    /** holds begun and ended per hand (A's), in order: `left+`, `right-stood` */
    holds: string[];
    strikes: number;
    /** A's and B's centres along B's line to A from the start (m, + toward A's back: A driven back) */
    aBackM: number;
    bOnM: number;
    /** A's stood level, most; B's beaten just after his re-punch landed; B's leverage, least after his strike */
    aLevelMax: number;
    bBeatenLanded: number | null;
    bLevMin: number;
    /** each man's leverage and A's holds at the end; B held ever; the pull: A's push in tension, most (N) */
    aLev: number;
    bLev: number;
    aHeld: string;
    bHeld: boolean;
    pullN: number;
    holdingA: number;
    /** B's way toward A over the last 0.3 s (m) */
    bLateM: number;
    snaps: number;
    falls: number;
  }
  async function run(at: number, end: number, o: { H?: BlockHandFight; faults?: Record<string, boolean>; shove?: { t: number; x: number } } = {}): Promise<Run> {
    const H = o.H ?? F;
    const faults = o.faults ? { block: o.faults } : undefined;
    const still = !!o.shove;
    const sim = await resumeState(await captured(at, still), { def: scene(H, still), ...(H === F ? {} : { variant: ['players.0.controller.profile', 'players.1.controller.profile'] }), ...(faults ? { faults } : {}) });
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    const u = norm(v3(a.proxy.body.translation().x - b.proxy.body.translation().x, 0, a.proxy.body.translation().z - b.proxy.body.translation().z));
    const a0 = dot(a.proxy.body.translation(), u);
    const b0 = dot(b.proxy.body.translation(), u);
    const out: Run = { holds: [], strikes: 0, aBackM: 0, bOnM: 0, aLevelMax: 0, bBeatenLanded: null, bLevMin: 1, aLev: 0, bLev: 0, aHeld: '', bHeld: false, pullN: 0, holdingA: 0, bLateM: 0, snaps: 0, falls: 0 };
    let bLate: number | null = null;
    let ev = sim.events.length;
    let struckT: number | null = null;
    let shoved = false;
    const prevQ = new Map<string, ReturnType<typeof jointQuats>>();
    while (!sim.done && sim.t < end - 1e-9) {
      if (o.shove && !shoved && sim.t >= o.shove.t - 1e-9) {
        shoved = true;
        b.proxy.body.applyImpulse({ x: o.shove.x, y: 0, z: 0 }, true);
      }
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        const d = e.data as { hand?: string; why?: string };
        if (e.type === 'handHold' && e.playerId === 'A') out.holds.push(`${d.hand}+`);
        if (e.type === 'handHoldEnd' && e.playerId === 'A') out.holds.push(`${d.hand}-${d.why}`);
        if ((e.type === 'handHold' || e.type === 'handHoldEnd') && e.playerId === 'B') out.bHeld = true;
        if (e.type === 'handStrike' && e.playerId === 'B') {
          out.strikes++;
          struckT = e.t;
        }
        if (e.type === 'lossOfSupport') out.falls++;
      }
      if (struckT !== null && out.bBeatenLanded === null) out.bBeatenLanded = b.block?.contest?.beaten ?? null;
      if (struckT !== null) out.bLevMin = Math.min(out.bLevMin, b.block?.contest?.leverage ?? 1);
      out.aLevelMax = Math.max(out.aLevelMax, a.block?.contest?.level ?? 0);
      if (bLate === null && sim.t >= end - 0.3 - 1e-9) bLate = dot(b.proxy.body.translation(), u);
      for (const s of ['left', 'right'] as const) {
        const f = sim.arms?.lastForce.get(`A:${s}`);
        if (f && f.kind === 'push' && f.target === 'B') out.pullN = Math.max(out.pullN, dot(f.forceOnTarget, u));
      }
      for (const p of [a, b]) {
        const Q = jointQuats(p.pose!);
        const q0 = prevQ.get(p.id);
        if (q0) for (const [j, q] of Object.entries(Q)) if (qAngle(q0[j], q) / DT > SNAP_RADPS) out.snaps++;
        prevQ.set(p.id, Q);
      }
    }
    out.aBackM = dot(a.proxy.body.translation(), u) - a0;
    out.bOnM = dot(b.proxy.body.translation(), u) - b0;
    out.bLateM = dot(b.proxy.body.translation(), u) - (bLate ?? b0);
    out.aLev = a.block?.contest?.leverage ?? 0;
    out.bLev = b.block?.contest?.leverage ?? 0;
    out.aHeld = (['left', 'right'] as const).map((s) => (a.block?.hands?.[s].hold ? s[0] : '-')).join('');
    out.holdingA = a.block?.holdingS ?? 0;
    sim.dispose();
    return out;
  }

  it("B's re-punch through A's left arm onto his chest: that hold off with the wash, the strike stands A up and breaks his other hold, A driven back, B back under; fault twins: no strike, no re-load, the lanes' leverage", async () => {
    const r = await run(4.9, 5.8);
    expect(r.strikes).toBe(1);
    expect(r.holds).toEqual(['left-off', 'right-stood']);
    expect(r.aLevelMax).toBeGreaterThan(0.8);
    expect(r.aBackM).toBeGreaterThan(0.2);
    expect(r.bBeatenLanded!).toBeLessThan(0.05);
    // the holds gone, B has all his leverage; the defense never holds; nothing kept outside a hold's conditions
    expect(r.bLev).toBe(1);
    expect(r.bHeld).toBe(false);
    expect(r.holdingA).toBe(0);
    expect(r.snaps).toBe(0);
    expect(r.falls).toBe(0);
    // (fault twin: no strike: A not stood up, his right hold not broken, not driven back)
    const free = await run(4.9, 5.8, { faults: { strikeFree: true } });
    expect(free.aLevelMax).toBeLessThan(0.5);
    expect(free.holds).not.toContain('right-stood');
    expect(free.aBackM).toBeLessThan(0.05);
    // (fault twin: no re-load: B as beaten after his re-punch as before it)
    expect((await run(4.9, 5.8, { faults: { reloadFree: true } })).bBeatenLanded!).toBeGreaterThan(0.3);
    // (fault twin: the lanes' leverage: B, one hand in and one out, still short of all of it with A's holds broken)
    expect((await run(4.9, 5.8, { faults: { holdNoControl: true } })).bLev).toBeCloseTo(1 / Math.sqrt(L), 6);
  }, 300_000);

  it("A's re-punches inside B's arms onto his chest: both holds back, B at 1/L and stopped; fault twin: the gap closed (onto his own lane's aim on the shoulder tops, no hold there)", async () => {
    const r = await run(5.65, 7.0);
    expect(r.holds).toEqual(['right+', 'left+']);
    expect(r.aHeld).toBe('lr');
    expect(r.bLev).toBeCloseTo(1 / L, 6);
    expect(r.bLateM).toBeLessThan(0);
    expect(r.bHeld).toBe(false);
    expect(r.holdingA).toBe(0);
    expect(r.snaps).toBe(0);
    expect(r.falls).toBe(0);
    const closed = await run(5.65, 7.0, { H: { ...F, rePunch: { ...F.rePunch!, clearM: 1 } } });
    expect(closed.aHeld).not.toBe('lr');
    expect(closed.bLev).toBeGreaterThan(1 / L + 0.1);
    expect(closed.bLateM).toBeGreaterThan(0.015);
  }, 300_000);

  it("a hold's push pulls as his man is parted past its slack, at most its tension at the push's effort; fault twin: no tension", async () => {
    const r = await run(3.9, 4.1);
    expect(r.pullN).toBeGreaterThan(50);
    expect(r.pullN).toBeLessThanOrEqual(HD.tensionN * s13.A.effort + 1e-6);
    expect((await run(3.9, 4.1, { H: { ...F, sides: { ...F.sides!, hold: { ...HD, tensionN: 0 } } } })).pullN).toBeLessThanOrEqual(1e-9);
  }, 300_000);

  it('holding: a hold kept on a man shoved off the front (the front narrowed to 1 deg) counts for its let-go time per hand, then is given up; fault twin: never given up', async () => {
    const narrow = { ...F, sides: { ...F.sides!, hold: { ...HD, frontDeg: 1 } } };
    const r = await run(4.9, 5.6, { H: narrow, shove: { t: 5.0, x: 80 } });
    expect(r.holds).toEqual(['left-givenUp', 'right-givenUp']);
    expect(r.holdingA).toBeGreaterThan(2 * HD.letGoS - 1e-9);
    expect(r.holdingA).toBeLessThan(2 * HD.letGoS + 0.05);
    const keeps = await run(4.9, 5.6, { H: narrow, shove: { t: 5.0, x: 80 }, faults: { holdKeeps: true } });
    expect(keeps.aHeld).toBe('lr');
    expect(keeps.holdingA).toBeGreaterThan(0.5);
  }, 300_000);
});
