// Plan 16 (p51), the swipe as one fluid move (`HandSwipe.arc`, `HandKnock.carry`, `HandRefit.path`, HANDS_V4;
// `nextHand`, `easeMinJerk`, `curveAt`, `curveThrough`; the arms' `ArmIntent.speedMps`). The rules on constructed inputs
// (the ease at rest at both ends, the curve through its middle point; a swipe's wind-up and chop each for its time, the
// forearm's point held once the chop meets it, then back on him from where the hand is; a knocked hand re-fitted from
// where it is), then the pass rush BL-F12-passRush with its first swipe only (A holds in the two-point set at 0.5, B
// rushes from the defense three-point at 0.55; B's right hand swipes at A's left arm at 4.25 s), resumed from a capture
// shortly before it: the hand winds up over his shoulder, chops through A's forearm at speed in the middle of the chop
// and on well past it, and flows back onto A without going through the ready point, smoothly; A's knocked hand is carried
// away fastest as it is struck and comes back on smoothly. Fault twins: the p50 swipe (HANDS_V3: no wind-up, contact at
// once at the arm's pace, the ready point, jerks), the arc at the arm's everyday pace (contact slower), the arc without
// the path back (the ready point, jerks), the knock without the carry (a hard stop).
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { HANDS_V3, HANDS_V4, curveAt, curveThrough, easeMinJerk, levelLocal, levelWorld, nextHand, type BlockHandFight, type HandState } from '../src/sim/controllers/block';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { len, scale, sub, v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

const F = HANDS_V4;
const A = F.swipe!.arc!;
const home = (o: Partial<HandState> = {}): HandState => ({ doing: 'home', since: 0, on: true, pushing: true, where: 'chest', lane: 'inside', ...o });

describe('plan 16 (p51), the swipe as one fluid move', () => {
  it('the ease is at rest at both ends and the curve passes through its middle point; fault twins: a linear time, the middle point as the pull', () => {
    expect(easeMinJerk(0)).toBe(0);
    expect(easeMinJerk(1)).toBe(1);
    expect(easeMinJerk(0.5)).toBeCloseTo(0.5, 12);
    expect(easeMinJerk(-1)).toBe(0);
    expect(easeMinJerk(2)).toBe(1);
    const atRest = (f: (u: number) => number) => {
      const h = 1e-4;
      return Math.abs(f(h) - f(0)) / h < 1e-3 && Math.abs(f(1) - f(1 - h)) / h < 1e-3;
    };
    expect(atRest(easeMinJerk)).toBe(true);
    expect(atRest((u) => u)).toBe(false);
    const a = v3(0, 1, 0);
    const m = v3(0.2, 0.5, 0.3);
    const b = v3(0.1, 0, 0.6);
    expect(len(sub(curveAt(a, curveThrough(a, m, b), b, 0), a))).toBeLessThan(1e-12);
    expect(len(sub(curveAt(a, curveThrough(a, m, b), b, 1), b))).toBeLessThan(1e-12);
    expect(len(sub(curveAt(a, curveThrough(a, m, b), b, 0.5), m))).toBeLessThan(1e-12);
    expect(len(sub(curveAt(a, m, b, 0.5), m))).toBeGreaterThan(0.05);
    // the level frame there and back
    const L = { sh: v3(1, 1.4, 2), fwd: v3(0.6, 0, 0.8), left: v3(0.8, 0, -0.6), out: v3(-0.8, 0, 0.6) };
    const p = v3(1.3, 0.9, 2.4);
    expect(len(sub(levelWorld(L, levelLocal(L, p)), p))).toBeLessThan(1e-12);
  });

  it('a swipe winds up and chops each for its time, holds the forearm point it met, then goes back on him from where it is; fault twins: the p50 raise ends at its point, no path back is home', () => {
    const t0 = 1;
    const from = v3(-0.1, -0.15, 0.5);
    const a = nextHand(home(), undefined, t0, { fight: F, due: { n: 0, at: 'left' }, palmL: from });
    expect(a).toEqual({ doing: 'swiping', since: t0, swipes: 1, swipe: { n: 0, at: 'left', stage: 'raise', stageT: t0, fromL: from } });
    const through = v3(0.3, 0.6, 0.4);
    // the wind-up runs its time wherever the hand is
    expect(nextHand({ ...home(), ...a }, undefined, t0 + A.windS - 0.01, { fight: F, raiseLeftM: 0, throughW: through }).swipe!.stage).toBe('raise');
    // (fault twin: the p50 raise ends once the hand is at its point)
    expect(nextHand({ ...home(), ...a }, undefined, t0 + 0.02, { fight: HANDS_V3, raiseLeftM: 0, throughW: through }).swipe!.stage).toBe('chop');
    const tc = t0 + A.windS;
    const c = nextHand({ ...home(), ...a }, undefined, tc, { fight: F, throughW: through });
    expect(c.swipe).toEqual({ n: 0, at: 'left', stage: 'chop', stageT: tc, throughW: through });
    // met: the forearm's point as it met it, held from then
    const on1 = v3(0.3, 1.0, 0.2);
    const on2 = v3(0.3, 0.9, 0.25);
    const h = nextHand({ ...home(), ...c, hit: tc + 0.05 }, undefined, tc + 0.06, { fight: F, onW: on1 });
    expect(h.swipe!.hitOnW).toEqual(on1);
    const h2 = nextHand({ ...home(), ...h, hit: tc + 0.05 }, undefined, tc + 0.08, { fight: F, onW: on2 });
    expect(h2.swipe!.hitOnW).toEqual(on1);
    // (a hit from an earlier swipe is not this one's: the point stays live)
    expect(nextHand({ ...home(), ...c, hit: t0 - 0.5 }, undefined, tc + 0.06, { fight: F, onW: on1 }).swipe!.hitOnW).toBeUndefined();
    // the chop runs its time, then back on him from where the hand is, along the re-fit's path, until on him
    expect(nextHand({ ...home(), ...h2, hit: tc + 0.05, on: false }, undefined, tc + A.chopS - 0.01, { fight: F, chopLeftM: 0 }).doing).toBe('swiping');
    const end = v3(-0.05, -0.5, 0.35);
    const r = nextHand({ ...home(), ...h2, hit: tc + 0.05, on: false }, undefined, tc + A.chopS, { fight: F, palmL: end });
    expect(r).toEqual({ doing: 'refitting', since: tc + A.chopS, swipes: 1, fromL: end });
    expect(nextHand({ ...home(), ...r, on: false }, undefined, tc + A.chopS + 0.05, { fight: F })).toEqual({ doing: 'refitting', since: tc + A.chopS, swipes: 1, fromL: end });
    expect(nextHand({ ...home(), ...r, on: true }, undefined, tc + A.chopS + 0.1, { fight: F })).toEqual({ doing: 'home', since: tc + A.chopS + 0.1, swipes: 1 });
    // (fault twin: without the path back, home: the block's own hands, through the ready point)
    const noPath: BlockHandFight = { ...F, refit: { ...F.refit!, path: undefined } };
    expect(nextHand({ ...home(), ...h2, hit: tc + 0.05, on: false }, undefined, tc + A.chopS, { fight: noPath, palmL: end }).doing).toBe('home');
  });

  it('a knocked hand, its knock over, re-fits from where it is; fault twin: the p50 re-fit has no start', () => {
    const k = { t: 2, dirW: v3(0, -1, 0), palmW: v3(), by: 'B', ended: true };
    const pl = v3(0.05, -0.4, 0.3);
    const end = 2 + F.knock!.s;
    expect(nextHand(home({ doing: 'knocked', since: 2, knockT: 2, knock: k, on: false }), undefined, end, { fight: F, palmL: pl })).toEqual({ doing: 'refitting', since: end, knockT: 2, fromL: pl });
    expect(nextHand(home({ doing: 'knocked', since: 2, knockT: 2, knock: k, on: false }), undefined, 2 + HANDS_V3.knock!.s, { fight: HANDS_V3, palmL: pl })).toEqual({ doing: 'refitting', since: 2 + HANDS_V3.knock!.s, knockT: 2 });
  });

  const SWIPE_S = 4.25;
  const CAPTURE_S = 4.15;
  const END_S = 4.95;
  const DT = 1 / 60;
  const scene = (H: BlockHandFight): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F12-passRush')!;
    return blockScene({ ...s, id: 'BL-T-swipeArc', durationS: END_S + 0.1, B: { ...s.B, swipes: [{ atS: SWIPE_S, hand: 'right' }] }, handFight: H }, FIX('L3-F6-hold'));
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
  interface Out {
    /** B's right palm: most over where it began (m); the chop meeting A's arm (s after the swipe began), how fast the palm was then (m/s); how far it went on under where it met (m) */
    riseM: number;
    knockAfterS: number | null;
    knockMps: number;
    pastM: number;
    /** back on A (s after the swipe began); steps it was sent to the ready point (his arm's intent a reach, the hand at home); the most frame-to-frame change of its velocity until back on (m/s²) */
    backOnS: number | null;
    toReady: number;
    maxAcc: number;
    /** A's left palm: how far carried while knocked (m), the most change of its velocity once it is moving (m/s²); back on after the knock (s) */
    carriedM: number;
    knockAcc: number;
    aBackS: number | null;
    /** A's right palm push ended in the window */
    rightEnded: boolean;
  }
  async function run(H: BlockHandFight): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(H), ...(H === F ? {} : { variant: ['players.0.controller.profile', 'players.1.controller.profile'] }) });
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    const out: Out = { riseM: 0, knockAfterS: null, knockMps: 0, pastM: 0, backOnS: null, toReady: 0, maxAcc: 0, carriedM: 0, knockAcc: 0, aBackS: null, rightEnded: false };
    let t0: number | null = null;
    let knockT: number | null = null;
    let start: Vec3 | null = null;
    let met: Vec3 | null = null;
    let prev: Vec3 | null = null;
    let prevV: Vec3 | null = null;
    let kFrom: Vec3 | null = null;
    let kPrev: Vec3 | null = null;
    let kPrevV: Vec3 | null = null;
    let kFrames = 0;
    let ended = false;
    let ev = sim.events.length;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        const d = e.data as { arm?: string; reason?: string };
        if (e.type === 'handSwipe' && e.playerId === 'B') t0 = e.t;
        if (e.type === 'handKnock' && knockT === null && t0 !== null) {
          knockT = e.t;
          out.knockAfterS = e.t - t0;
        }
        if (e.type === 'handSwipeEnd' && e.playerId === 'B') ended = true;
        if (e.type === 'pushBegin' && e.playerId === 'B' && d.arm === 'right' && t0 !== null && out.backOnS === null) out.backOnS = e.t - t0;
        if (e.type === 'pushBegin' && e.playerId === 'A' && d.arm === 'left' && knockT !== null && out.aBackS === null) out.aBackS = e.t - knockT;
        if (e.type === 'pushEnd' && e.playerId === 'A' && d.arm === 'right') out.rightEnded = true;
      }
      if (t0 === null) continue;
      const P = { ...b.pose!.jointLandmarksWorld.rightPalm };
      start ??= P;
      const v = prev ? scale(sub(P, prev), 1 / DT) : null;
      if (out.backOnS === null) {
        out.riseM = Math.max(out.riseM, P.y - start.y);
        if (v && prevV) out.maxAcc = Math.max(out.maxAcc, len(scale(sub(v, prevV), 1 / DT)));
        if (ended && b.block?.hands?.right?.doing === 'home' && b.intent.arms?.right?.action === 'reach') out.toReady++;
      }
      if (knockT !== null && !met) {
        met = P;
        out.knockMps = v ? len(v) : 0;
      }
      if (met && out.backOnS === null) out.pastM = Math.max(out.pastM, met.y - P.y);
      prev = P;
      prevV = v;
      const K = { ...a.pose!.jointLandmarksWorld.leftPalm };
      if (knockT !== null && a.block?.hands?.left?.doing === 'knocked') {
        kFrom ??= K;
        out.carriedM = Math.max(out.carriedM, len(sub(K, kFrom)));
        const kv = kPrev ? scale(sub(K, kPrev), 1 / DT) : null;
        if (kv && kPrevV && ++kFrames > 1) out.knockAcc = Math.max(out.knockAcc, len(scale(sub(kv, kPrevV), 1 / DT)));
        kPrev = K;
        kPrevV = kv;
      }
    }
    sim.dispose();
    return out;
  }

  it('the pass rush: the hand winds up, chops through his forearm at speed in the middle of the chop and on past it, and flows back on him smoothly; his knocked hand is carried off and comes back on; fault twins: the p50 swipe, the arm at its everyday pace, no path back, no carry', async () => {
    const on = await run(F);
    // the wind-up: up over where it began
    expect(on.riseM).toBeGreaterThan(0.15);
    // contact in the chop, not as it starts, and at speed
    expect(on.knockAfterS).not.toBeNull();
    expect(on.knockAfterS!).toBeGreaterThan(A.windS + 0.04);
    expect(on.knockAfterS!).toBeLessThan(A.windS + A.chopS - 0.04);
    expect(on.knockMps).toBeGreaterThan(6);
    // the follow-through well past his arm
    expect(on.pastM).toBeGreaterThan(0.15);
    // back on him within the film's hands-off time, not through the ready point, and smoothly
    expect(on.backOnS).not.toBeNull();
    expect(on.backOnS!).toBeLessThanOrEqual(0.45);
    expect(on.toReady).toBe(0);
    expect(on.maxAcc).toBeLessThan(200);
    // his knocked hand: carried off, without a hard stop, and back on him within 0.3 s; his other hand on throughout
    expect(on.carriedM).toBeGreaterThan(0.2);
    expect(on.knockAcc).toBeLessThan(120);
    expect(on.aBackS).not.toBeNull();
    expect(on.aBackS!).toBeLessThanOrEqual(0.3);
    expect(on.rightEnded).toBe(false);

    // fault twin: the p50 swipe: no wind-up, contact as the chop starts at the arm's pace, the ready point, jerks
    const v3s = await run(HANDS_V3);
    expect(v3s.riseM).toBeLessThan(0.05);
    expect(v3s.knockAfterS!).toBeLessThan(A.windS);
    expect(v3s.knockMps).toBeLessThan(5);
    expect(v3s.pastM).toBeLessThan(0.15);
    expect(v3s.toReady).toBeGreaterThan(0);
    expect(v3s.maxAcc).toBeGreaterThan(200);
    // fault twin: the arc at the arm's everyday pace: the hand falls behind its arc and meets his arm slower (here not at all)
    const slow = await run({ ...F, swipe: { ...F.swipe!, arc: { ...A, mps: 4 } } });
    expect(slow.knockMps).toBeLessThan(4.5);
    // fault twin: no path back: the ready point, a jerk
    const noPath = await run({ ...F, refit: { ...F.refit!, path: undefined } });
    expect(noPath.toReady).toBeGreaterThan(0);
    expect(noPath.maxAcc).toBeGreaterThan(200);
    // fault twin: the knock without the carry: a hard stop
    const noCarry = await run({ ...F, knock: { ...F.knock!, carry: undefined } });
    expect(noCarry.knockAcc).toBeGreaterThan(150);
  }, 180_000);
});
