// Plan 16 (p52), the re-punch (`BlockHandFight.rePunch`, `HandRePunch`, HANDS_V6; `nextHand`'s re-punching, `punchClearM`,
// `lanesLeverage`, `handsLeverage`, `openedBy`, the simulation's `handContacts`): a hand without the inside comes off his
// man, loads low by his ribs and punches back on him inside his man's arm, washing that arm out, so the inside is won per
// hand and the contest's leverage follows each hand's lane. The rules on constructed inputs (the stages and their times,
// the per-hand leverage, the gap, a wash opening nothing), then BL-F13-rePunch with its first re-punch only (B's right hand
// at 3.9 s; A drives with the inside, B outside), resumed from a capture shortly before it: the hand draws back
// and down, punches under A's left forearm onto his chest under his arms, A's left hand is washed off B and goes back on
// him outside, the lanes and the leverage change hands on that side. Fault twins: the man's lane alone, no re-punch in the
// fight, a way through his upper arm, a wash that opens, a punch that washes nothing (no lane changes, no leverage), a
// punch without the load (no draw-back), the gap closed (the punch lands outside, nothing changes hands).
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { HANDS_V5, HANDS_V6, handsLeverage, lanesLeverage, nextHand, openedBy, punchClearM, type BlockHandFight, type HandState } from '../src/sim/controllers/block';
import { INSIDE_LEVERAGE } from '../src/sim/block-base';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, qInvRot, sub, v3, type Vec3 } from '../src/sim/vec';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { captureState, resumeState, type StateCapture } from './state';
import { depth, drawnShapes, jointQuats, qAngle, SNAP_RADPS } from './visible';
import { FIX } from './helpers';

const F = HANDS_V6;
const RP = F.rePunch!;
const home = (o: Partial<HandState> = {}): HandState => ({ doing: 'home', since: 0, on: true, pushing: true, where: 'shoulder', lane: 'outside', ...o });

describe('plan 16 (p52), the re-punch', () => {
  it('a re-punch loads for its time, then punches (inside when its gap is open), at home once on him, else re-fitted from where it is; fault twin: no re-punch in the fight', () => {
    const t0 = 2;
    const from = v3(-0.05, -0.1, 0.55);
    const a = nextHand(home(), undefined, t0, { fight: F, rePunchDue: { n: 0 }, palmL: from });
    expect(a).toEqual({ doing: 'repunching', since: t0, rePunches: 1, rePunch: { n: 0, stage: 'load', stageT: t0, fromL: from } });
    // (fault twin: without the re-punch in the fight, a due is nothing)
    expect(nextHand(home(), undefined, t0, { fight: HANDS_V5, rePunchDue: { n: 0 }, palmL: from }).doing).toBe('home');
    // the load runs its time wherever the hand is, then the punch, inside as the gap is when it begins
    const off = { on: false, pushing: false, where: null };
    expect(nextHand(home({ ...a, ...off }), undefined, t0 + RP.loadS - 0.01, { fight: F, gapOpen: true }).rePunch!.stage).toBe('load');
    const lp = v3(0.04, -0.3, 0.12);
    const p = nextHand(home({ ...a, ...off }), undefined, t0 + RP.loadS, { fight: F, gapOpen: true, palmL: lp });
    expect(p).toEqual({ doing: 'repunching', since: t0, rePunches: 1, rePunch: { n: 0, stage: 'punch', stageT: t0 + RP.loadS, inside: true, fromL: lp } });
    expect(nextHand(home({ ...a, ...off }), undefined, t0 + RP.loadS, { fight: F, gapOpen: false }).rePunch!.inside).toBe(false);
    // on him: at home, the time it landed kept for the body's way back
    const tp = t0 + RP.loadS + 0.1;
    expect(nextHand(home({ ...p }), undefined, tp, { fight: F })).toEqual({ doing: 'home', since: tp, rePunches: 1, punchedT: tp });
    // not on him by the punch's and the landing's time: re-fitted from where it is
    expect(nextHand(home({ ...p, ...off }), undefined, t0 + RP.loadS + RP.punchS + RP.landS - 0.01, { fight: F }).doing).toBe('repunching');
    const end = v3(0.02, -0.2, 0.5);
    const tr = t0 + RP.loadS + RP.punchS + RP.landS;
    expect(nextHand(home({ ...p, ...off }), undefined, tr, { fight: F, palmL: end })).toEqual({ doing: 'refitting', since: tr, rePunches: 1, punchedT: tr, fromL: end });
  });

  it('the leverage per hand: both outside 1/L, one 1/sqrt(L), none 1; a hand off him to re-punch costs the off cut; a wash opens nothing; fault twins: the man lane alone, no re-punch in the fight, a knock that opens', () => {
    const L = INSIDE_LEVERAGE;
    const hs = (l: 'inside' | 'outside', r: 'inside' | 'outside'): Record<'left' | 'right', HandState> => ({ left: home({ lane: l }), right: home({ lane: r }) });
    expect(lanesLeverage(hs('outside', 'outside'), L)).toBe(1 / L);
    expect(lanesLeverage(hs('inside', 'outside'), L)).toBeCloseTo(1 / Math.sqrt(L), 12);
    expect(lanesLeverage(hs('inside', 'inside'), L)).toBe(1);
    // (fault twin: the man's lane alone, an outside man with one hand inside still at 1/L)
    const manLane = (lane: 'inside' | 'outside') => (lane === 'outside' ? 1 / L : 1);
    expect(manLane('outside')).not.toBeCloseTo(lanesLeverage(hs('inside', 'outside'), L), 3);
    // a hand off him re-punching: the off cut; on him again, nothing
    const rp = { left: home(), right: home({ doing: 'repunching', since: 1, on: false, pushing: false, where: null, rePunch: { n: 0, stage: 'load', stageT: 1 } }) };
    expect(handsLeverage(rp, F)).toBeCloseTo(1 - F.offCut!, 12);
    expect(handsLeverage({ ...rp, right: { ...rp.right, on: true } }, F)).toBe(1);
    // (fault twin: without the re-punch in the fight it costs nothing)
    expect(handsLeverage(rp, HANDS_V5)).toBe(1);
    // a washed hand off him opens nothing to the man who washed it; a knock does
    const k = { t: 1, dirW: v3(0, 1, 0), palmW: v3(), by: 'B', ended: true };
    const his = (wash: boolean) => ({ left: home({ on: false, knock: { ...k, ...(wash ? { wash: true as const } : {}) } }), right: home() });
    expect(openedBy('B', his(true), F)).toBe(false);
    expect(openedBy('B', his(false), F)).toBe(true);
  });

  it('the gap: the way keeps clear of his upper arm lying beside it, not of one lying across it; fault twin: no arm, no gap', () => {
    const a = v3(0, 1.0, 0);
    const m = v3(0.05, 0.95, 0.3);
    const b = v3(0.05, 1.05, 0.6);
    const beside: [Vec3, Vec3][] = [[v3(0.25, 1.2, 0.8), v3(0.25, 1.15, 0.45)]];
    const across: [Vec3, Vec3][] = [[v3(-0.2, 0.97, 0.3), v3(0.3, 0.97, 0.3)]];
    expect(punchClearM(a, m, b, beside)).toBeGreaterThanOrEqual(RP.clearM);
    expect(punchClearM(a, m, b, across)).toBeLessThan(RP.clearM);
    expect(punchClearM(a, m, b, [])).toBe(Infinity);
  });

  const RE_S = 3.9;
  const CAPTURE_S = 3.8;
  const END_S = 4.7;
  const DT = 1 / 60;
  const scene = (H: BlockHandFight): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F13-rePunch')!;
    return blockScene({ ...s, id: 'BL-T-rePunch', durationS: END_S + 0.1, handFight: H, B: { ...s.B, rePunches: [{ atS: RE_S, hand: 'right' }] } }, FIX('L3-F6-hold'));
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
    /** B's right palm: drawn back toward him from where it began (m) and lowest under his shoulder (m) */
    backM: number;
    lowM: number;
    /** the punch thrown inside; A's left arm washed; B's hand landed on A (s after the re-punch began) and where (A's core frame) */
    inside: boolean | null;
    washed: boolean;
    landedS: number | null;
    landA: Vec3 | null;
    /** A's left shoulder then (his core frame) */
    shA: Vec3 | null;
    /** the lanes after: B's right, A's left; their leverage once A's hand is back on */
    bLane: string | undefined;
    aLane: string | undefined;
    aBackS: number | null;
    levA: number;
    levB: number;
    /** B's right forearm into A's left arm, most (m); drawn joints faster than a snap; falls */
    faArmM: number;
    snaps: number;
    falls: number;
  }
  async function run(H: BlockHandFight, faults?: { rePunchNoWash?: boolean }): Promise<Out> {
    const sim = await resumeState(await captured(), { def: scene(H), ...(H === F ? {} : { variant: ['players.0.controller.profile', 'players.1.controller.profile'] }), ...(faults ? { faults: { block: faults } } : {}) });
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    const out: Out = { backM: 0, lowM: 0, inside: null, washed: false, landedS: null, landA: null, shA: null, bLane: undefined, aLane: undefined, aBackS: null, levA: 0, levB: 0, faArmM: 0, snaps: 0, falls: 0 };
    let t0: number | null = null;
    let washT: number | null = null;
    let p0: Vec3 | null = null;
    let fwd: Vec3 | null = null;
    let ev = sim.events.length;
    const prevQ = new Map<string, ReturnType<typeof jointQuats>>();
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        const d = e.data as { arm?: string; inside?: boolean; landed?: boolean; reason?: string; hand?: string };
        if (e.type === 'handRePunch' && e.playerId === 'B') t0 = e.t;
        if (e.type === 'handRePunchThrown' && e.playerId === 'B') out.inside = !!d.inside;
        if (e.type === 'handWash' && e.playerId === 'B' && (d as { at?: string }).at === 'left') {
          out.washed = true;
          washT = e.t;
        }
        if (e.type === 'pushBegin' && e.playerId === 'B' && d.arm === 'right' && t0 !== null && out.landedS === null) {
          out.landedS = e.t - t0;
          out.landA = qInvRot(a.pose!.segments.core.rotationWorld, sub(b.pose!.jointLandmarksWorld.rightPalm, a.pose!.segments.core.originWorld));
          out.shA = qInvRot(a.pose!.segments.core.rotationWorld, sub(a.pose!.jointLandmarksWorld.leftShoulder, a.pose!.segments.core.originWorld));
        }
        if (e.type === 'pushBegin' && e.playerId === 'A' && d.arm === 'left' && washT !== null && out.aBackS === null) out.aBackS = e.t - washT;
        if (e.type === 'lossOfSupport') out.falls++;
      }
      for (const p of [a, b]) {
        const Q = jointQuats(p.pose!);
        const q0 = prevQ.get(p.id);
        if (q0) for (const [j, q] of Object.entries(Q)) if (qAngle(q0[j], q) / DT > SNAP_RADPS) out.snaps++;
        prevQ.set(p.id, Q);
      }
      if (t0 === null || out.landedS !== null) continue;
      const P = { ...b.pose!.jointLandmarksWorld.rightPalm };
      if (!p0) {
        p0 = P;
        const f = sub(a.proxy.body.translation(), b.proxy.body.translation());
        fwd = norm(v3(f.x, 0, f.z));
      }
      out.backM = Math.max(out.backM, dot(sub(p0, P), fwd!));
      out.lowM = Math.max(out.lowM, b.pose!.jointLandmarksWorld.rightShoulder.y - P.y);
      const fa = drawnShapes(b.pose!, b.body, R).find((s) => s.cls === 'forearm' && s.side === 'right')!;
      for (const s of drawnShapes(a.pose!, a.body, R)) if (s.side === 'left' && (s.cls === 'upperArm' || s.cls === 'upperArmD' || s.cls === 'forearm')) out.faArmM = Math.max(out.faArmM, depth(fa, s));
    }
    out.bLane = b.block?.hands?.right.lane;
    out.aLane = a.block?.hands?.left.lane;
    out.levA = a.block?.contest?.leverage ?? 0;
    out.levB = b.block?.contest?.leverage ?? 0;
    sim.dispose();
    return out;
  }

  it('BL-F13 with B re-punching his right: drawn back low, punched under A\'s forearm onto his chest under his arms, A\'s left washed off and back on outside, the inside and the leverage changed on that side; fault twins: a punch that washes nothing, one without the load, the gap closed', async () => {
    const on = await run(F);
    // loaded: back toward him and low by his ribs
    expect(on.backM).toBeGreaterThan(0.3);
    expect(on.lowM).toBeGreaterThan(0.3);
    // punched inside, A's left arm washed, landed on A's chest under his arm and inside it: nearer his middle than his
    // shoulder, at least 10 cm under it (his core frame)
    expect(on.inside).toBe(true);
    expect(on.washed).toBe(true);
    expect(on.landedS).not.toBeNull();
    expect(on.landedS!).toBeLessThan(RP.loadS + RP.punchS + RP.landS);
    expect(on.landA!.y).toBeLessThan(on.shA!.y - 0.1);
    expect(Math.abs(on.landA!.x)).toBeLessThan(Math.abs(on.shA!.x));
    // the inside changed hands on that side, A's hand back on him outside, both men one hand in and one out
    expect(on.bLane).toBe('inside');
    expect(on.aLane).toBe('outside');
    expect(on.aBackS).not.toBeNull();
    expect(on.aBackS!).toBeLessThan(0.4);
    expect(on.levA).toBeCloseTo(1 / Math.sqrt(INSIDE_LEVERAGE), 6);
    expect(on.levB).toBeCloseTo(1 / Math.sqrt(INSIDE_LEVERAGE), 6);
    // the arms meet as the punch arrives (no more than a few centimetres, at the wash); no snap; nobody falls
    expect(on.faArmM).toBeLessThan(0.05);
    expect(on.snaps).toBe(0);
    expect(on.falls).toBe(0);

    // fault twin: a punch that washes nothing: A's hand stays on, no lane changes, B still the outside man
    const noWash = await run(F, { rePunchNoWash: true });
    expect(noWash.washed).toBe(false);
    expect(noWash.bLane).toBe('outside');
    expect(noWash.aLane).toBe('inside');
    expect(noWash.levB).toBeCloseTo(1 / INSIDE_LEVERAGE, 6);
    expect(noWash.levA).toBe(1);
    // fault twin: the punch without the load (the load point held out at his man, for one substep): the hand comes back
    // only as far as the punch's way under his man's forearm takes it
    const noLoad = await run({ ...F, rePunch: { ...RP, loadS: 0.02, load: { ...RP.load, downM: 0, fwdM: 0.45, outM: 0, backM: 0 } } });
    expect(noLoad.backM).toBeLessThan(0.2);
    // fault twin: the gap closed (no way clear enough): the punch goes onto his own lane's aim, nothing changes hands
    const closed = await run({ ...F, rePunch: { ...RP, clearM: 1 } });
    expect(closed.inside).toBe(false);
    expect(closed.washed).toBe(false);
    expect(closed.bLane).toBe('outside');
    expect(closed.aLane).toBe('inside');
    expect(closed.landA === null || closed.landA.y > 0.55).toBe(true);
  }, 240_000);
});
