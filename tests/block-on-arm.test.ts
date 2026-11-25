// Plan 16 (p54): the outside palms on the outside of the inside man's upper arms near his elbows (`BlockSceneOpts.outsideOnArm`,
// LANES_ARM, `HandAim.onArm`, `PushRequest.onArm`, `PalmPushProfile.onArm`, ON_ARM, `armSeatWorld`), in place of the tops of
// his shoulders beside his neck (LANES_TOPS: in profile a hand in his facemask). The seat on constructed arms; then states
// captured on the newer set shortly before the hit in BL-F1-even (standing) and at the snap in BL-F10-twoPointVsThree,
// resumed on his arms and, as the twin, on the tops of his shoulders: no outside palm reads at the inside man's helmet,
// facemask or neck in profile, the palms rest on his arms (not into them) and stay there, nobody falls. Then the patch's
// end as his arm is no longer asked to push (A's re-punch loading, BL-F10 on HANDS_V6), and his arm read as the substep
// began (either player order within 1 mm). Fault twins: the shoulder tops, a seat sunk into his arm, a patch kept on an
// arm that loads, his arm read as the other player's step left it.
import { describe, expect, it } from 'vitest';
import { HANDS_V6, LANES_ARM, LANES_TOPS } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, type BlockSceneOpts } from '../src/sim/fixtures/blocking';
import type { PhysicalPose } from '../src/sim/pose';
import { armSeatWorld, DEFAULT_POSE_PROFILE, type RagdollProfile } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { add, dot, len, norm, qRot, sub, v3, type Vec3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { depth, drawnShapes } from './visible';
import { FIX } from './helpers';

// his helmet (its ball), his facemask (the chin bar's bottom front to the brow, 4 cm) and his neck (its base to his head's
// centre, 6.5 cm); the facemask in his head's frame (m from the helmet's centre)
const CHIN = v3(0, -0.13, 0.2);
const BROW = v3(0, 0.02, 0.21);
const segD = (p: Vec3, a: Vec3, b: Vec3): number => {
  const d = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / Math.max(1e-12, dot(d, d))));
  return len(sub(p, add(a, v3(d.x * t, d.y * t, d.z * t))));
};
/**
 * A palm ball's clearance (centre `c`, radius `r`) from his helmet, facemask and neck in profile: in the plane of the
 * horizontal line between the men (`line`) and the vertical (m; below zero it overlaps them there).
 */
function faceGap(c: Vec3, r: number, his: PhysicalPose, R: RagdollProfile, line: Vec3): number {
  const P2 = (q: Vec3): Vec3 => v3(dot(q, line), q.y, 0);
  const lm = his.jointLandmarksWorld;
  const hq = his.segments.head.rotationWorld;
  const hc = lm.headCenter;
  const p = P2(c);
  return Math.min(len(sub(p, P2(hc))) - R.radii.head, segD(p, P2(add(hc, qRot(hq, CHIN))), P2(add(hc, qRot(hq, BROW)))) - 0.04, segD(p, P2(lm.neck), P2(hc)) - 0.065) - r;
}

describe('plan 16 (p54), the outside palms on his arms', () => {
  it('the seat: on the arm t of the way from shoulder to elbow, seatM from its line, turned angDeg from straight out toward up about it; fault twin: the turn not taken about the arm', () => {
    const S = v3(0.2, 1.3, 0);
    const E = v3(0.2, 1.4, 0.3);
    const q = { x: 0, y: 0, z: 0, w: 1 };
    const ax = norm(sub(E, S));
    const seat = (angDeg: number) => armSeatWorld(S, E, q, 1, { t: 0.85, angDeg, seatM: 0.135 });
    for (const angDeg of [0, 30, 90]) {
      const { ball, normal } = seat(angDeg);
      const foot = add(S, v3((E.x - S.x) * 0.85, (E.y - S.y) * 0.85, (E.z - S.z) * 0.85));
      expect(len(sub(ball, foot))).toBeCloseTo(0.135, 9);
      expect(dot(normal, ax)).toBeCloseTo(0, 9);
    }
    // straight out at 0 (his +x here), up off the arm at 90, between at 30 (more out than up)
    expect(seat(0).normal).toEqual(v3(1, 0, 0));
    expect(seat(90).normal.x).toBeCloseTo(0, 9);
    expect(seat(90).normal.y).toBeGreaterThan(0.9);
    expect(seat(30).normal.x).toBeGreaterThan(seat(30).normal.y);
    expect(seat(30).normal.y).toBeGreaterThan(0.4);
    // (fault twin: the turn's direction not taken about the arm: off the arm's surface where the arm slopes)
    const a = (30 * Math.PI) / 180;
    const d0 = v3(Math.cos(a), Math.sin(a), 0);
    expect(Math.abs(dot(d0, ax))).toBeGreaterThan(0.1);
  });

  const DT = 1 / 60;
  const rowOf = (id: string): BlockSceneOpts => BL_SCENES.find((x) => x.id === id)!;
  type Lanes = 'arm' | 'tops' | 'sunk';
  // (the sunk twin: the palm ball's centre 10 cm from his arm's line, into his drawn arm)
  const SUNK = { ...LANES_ARM.outside, onArm: { ...LANES_ARM.outside.onArm!, seatM: 0.1 } };
  const VARIANT = ['players.0.controller.profile.lanes', 'players.1.controller.profile.lanes'];
  function scene(id: string, lanes: Lanes, end: number, extra: Partial<BlockSceneOpts> = {}): FixtureDef {
    const on = blockScene({ ...rowOf(id), id: `BL-T-onArm-${id}`, durationS: end + 0.1, outsideOnArm: true, ...extra }, FIX('L3-F6-hold'));
    if (lanes === 'arm') return on;
    // the twins: the outside lane on the tops of his shoulders (as the scene ran before), or sunk into his arm; nothing else
    const outside = lanes === 'tops' ? LANES_TOPS.outside : SUNK;
    return { ...on, players: on.players.map((p) => (p.controller?.kind === 'block' ? { ...p, controller: { ...p.controller, profile: { ...p.controller.profile!, lanes: { ...p.controller.profile!.lanes!, outside } } } } : p)) } as FixtureDef;
  }
  const caps = new Map<string, StateCapture>();
  async function captured(key: string, def: FixtureDef, at: number): Promise<StateCapture> {
    const c = caps.get(key);
    if (c) return c;
    const sim = await Simulation.create(def);
    while (sim.t < at - 1e-9) sim.stepTick();
    const cap = captureState(sim);
    caps.set(key, cap);
    sim.dispose();
    return cap;
  }

  interface Face {
    /** the outside man and his lane */
    outside?: string;
    lane?: string;
    /** while engaged: his palms' least clearance from the inside man's helmet, facemask and neck in profile (m), and the time any is under 4 cm (s) */
    gapMin: number;
    under4S: number;
    /** the share of his hands' engaged time held on the inside man; the regions they were born on; the deepest in his drawn upper arms (m) */
    heldShare: number;
    regions: string[];
    intoArmM: number;
    falls: string[];
  }
  const faces = new Map<string, Face>();
  async function face(id: string, lanes: Lanes, at: number, end: number): Promise<Face> {
    const k = `${id}:${lanes}@${at}-${end}`;
    if (!faces.has(k)) faces.set(k, await faceRun(id, lanes, at, end));
    return faces.get(k)!;
  }
  async function faceRun(id: string, lanes: Lanes, at: number, end: number): Promise<Face> {
    const cap = await captured(`${id}@${at}`, scene(id, 'arm', end), at);
    const sim = await resumeState(cap, { def: scene(id, lanes, end), variant: lanes === 'arm' ? [] : VARIANT });
    const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    const out: Face = { gapMin: Infinity, under4S: 0, heldShare: 0, regions: [], intoArmM: 0, falls: [] };
    let eng = 0;
    let ev = sim.events.length;
    const born: [string, string][] = [];
    while (!sim.done && sim.t < end - 1e-9) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}@${e.t.toFixed(2)}`);
        if (e.type === 'pushBegin') born.push([e.playerId ?? '', (e.data as { region: string }).region]);
      }
      const [a, b] = sim.players;
      if (a.rag || b.rag || !a.pose || !b.pose) continue;
      const o = a.block?.lane === 'outside' ? a : b.block?.lane === 'outside' ? b : null;
      if (!o || o.block?.phase !== 'engaged') continue;
      const i = o === a ? b : a;
      out.outside = o.id;
      out.lane = o.block.lane;
      const d = sub(i.proxy.body.translation(), o.proxy.body.translation());
      const line = norm(v3(d.x, 0, d.z));
      const mine = drawnShapes(o.pose!, o.body, R);
      const his = drawnShapes(i.pose!, i.body, R).filter((s) => s.cls === 'upperArm' || s.cls === 'upperArmD');
      let under = false;
      for (const side of ['left', 'right'] as const) {
        const palm = mine.find((s) => s.cls === 'palm' && s.side === side)!;
        const g = faceGap(palm.c!, palm.r, i.pose!, R, line);
        out.gapMin = Math.min(out.gapMin, g);
        if (g < 0.04) under = true;
        if (sim.arms?.pushOf(o.id, side)) out.heldShare += 0.5;
        for (const s of his) out.intoArmM = Math.max(out.intoArmM, depth(palm, s));
      }
      if (under) out.under4S += DT;
      eng++;
    }
    out.heldShare /= Math.max(1, eng);
    out.regions = born.filter(([p]) => p === out.outside).map(([, r]) => r);
    sim.dispose();
    return out;
  }

  it.each([
    ['BL-F1-even', 0.2, 2.7],
    ['BL-F10-twoPointVsThree', 3.3, 5.8],
  ])("%s resumed from before the hit: the outside man's palms on the inside man's arms, never within 4 cm of his helmet, facemask or neck in profile, on his arms for most of the time and less than 3 cm into them; nobody falls; fault twin: on the tops of his shoulders, overlapping them in profile or within 2 cm, under 4 cm for 0.25 s or more", async (id, at, end) => {
    const on = await face(id, 'arm', at, end);
    expect(on.lane, 'on: an outside man').toBe('outside');
    expect(new Set(on.regions), 'on: born on his arms').toEqual(new Set(['arm']));
    expect(on.gapMin, 'on: the palms clear of his face and neck').toBeGreaterThanOrEqual(0.04);
    expect(on.heldShare, 'on: the palms on his arms').toBeGreaterThan(0.8);
    expect(on.intoArmM, 'on: resting on his arms, not into them').toBeLessThan(0.03);
    expect(on.falls, 'on: nobody falls').toEqual([]);
    const tops = await face(id, 'tops', at, end);
    expect(tops.lane, 'twin: an outside man').toBe('outside');
    expect(tops.gapMin, 'fault: the palms at his face and neck').toBeLessThan(0.02);
    expect(tops.under4S, 'fault: the palms at his face and neck, for long').toBeGreaterThan(0.25);
  }, 300_000);

  it("the seat on his arm's surface: BL-F10 resumed at the snap, the palms less than 3 cm into his drawn upper arms; fault twin: the seat 10 cm from the arm's line, 4 cm or more into them", async () => {
    const on = await face('BL-F10-twoPointVsThree', 'arm', 3.3, 5.8);
    expect(on.intoArmM).toBeLessThan(0.03);
    const sunk = await face('BL-F10-twoPointVsThree', 'sunk', 3.3, 5.8);
    expect(sunk.intoArmM).toBeGreaterThanOrEqual(0.04);
  }, 300_000);

  const F10 = 'BL-F10-twoPointVsThree';
  const RP_AT = 4.6;
  // (BL-F10 on HANDS_V6, A re-punching his right hand: it loads, drawn back off B, then punches back on him)
  const rePunchScene = (): FixtureDef => scene(F10, 'arm', 5.6, { handFight: HANDS_V6, A: { ...rowOf(F10).A, rePunches: [{ atS: RP_AT, hand: 'right' }] } });
  interface Left {
    /** B's left hand (on A's right arm): its push's ends after the re-punch is asked, and its births on A's arm after them */
    ends: { t: number; reason: string }[];
    bornAgain: number | null;
    falls: string[];
  }
  // (run from the start: a capture resumes without the arm system's fault switches)
  async function left(keeps: boolean): Promise<Left> {
    const sim = await Simulation.create(rePunchScene(), keeps ? { debug: { arm: { pushOnArmKeeps: true } } } : {});
    const out: Left = { ends: [], bornAgain: null, falls: [] };
    let ev = sim.events.length;
    while (!sim.done && sim.t < 5.6 - 1e-9) {
      sim.stepTick();
      for (; ev < sim.events.length; ev++) {
        const e = sim.events[ev];
        const d = e.data as { arm?: string; reason?: string; region?: string; onArm?: string };
        if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}@${e.t.toFixed(2)}`);
        if (e.playerId !== 'B' || d.arm !== 'left' || e.t < RP_AT) continue;
        if (e.type === 'pushEnd') out.ends.push({ t: e.t, reason: d.reason! });
        if (e.type === 'pushBegin' && out.ends.length && d.region === 'arm' && d.onArm === 'right' && out.bornAgain === null) out.bornAgain = e.t;
      }
    }
    sim.dispose();
    return out;
  }

  it("the patch ends as his arm is no longer asked to push: BL-F10 on HANDS_V6, A re-punching his right at 4.6 s: B's left comes off A's right arm as it loads (`armLeft`), and is on it again once it pushes; fault twin: kept on it, carried with his loading arm until past reach", async () => {
    const r = await left(false);
    expect(r.ends[0]?.reason, "B's left off A's loading arm").toBe('armLeft');
    expect(r.ends[0].t).toBeLessThan(RP_AT + 0.1);
    expect(r.bornAgain, "B's left on A's right arm again").not.toBeNull();
    expect(r.falls).toEqual([]);
    // (fault twin: kept on it, carried with his loading arm until it is past reach)
    const k = await left(true);
    expect(k.ends[0]?.reason).not.toBe('armLeft');
    expect(k.ends[0].t).toBeGreaterThan(r.ends[0].t);
  }, 300_000);

  it("his arm read as the substep began: BL-F1 in either player order, the men and their palms within 1 mm to 1.0 s (0.4 s on from the outside palms' landing on his arms; the orders' float sums part them from the landing on); fault twin: read as the other player's step left it, they part by more than 4 mm", async () => {
    const END = 1.0;
    const def = scene('BL-F1-even', 'arm', END);
    async function trace(reverseOrder: boolean, live: boolean): Promise<{ xs: number[]; armBorn: number }> {
      const sim = await Simulation.create(def, { reverseOrder, ...(live ? { debug: { arm: { pushOnArmLive: true } } } : {}) });
      const xs: number[] = [];
      let armBorn = 0;
      let ev = 0;
      while (!sim.done && sim.t < END - 1e-9) {
        sim.stepTick();
        for (; ev < sim.events.length; ev++) if (sim.events[ev].type === 'pushBegin' && (sim.events[ev].data as { region?: string }).region === 'arm') armBorn++;
        for (const id of ['A', 'B']) {
          const p = sim.players.find((x) => x.id === id)!;
          const t = p.proxy.body.translation();
          xs.push(t.x, t.y, t.z);
          for (const s of ['leftPalm', 'rightPalm'] as const) {
            const c = p.pose!.jointLandmarksWorld[s];
            xs.push(c.x, c.y, c.z);
          }
        }
      }
      sim.dispose();
      return { xs, armBorn };
    }
    const apart = (a: number[], b: number[]): number => a.reduce((m, x, k) => Math.max(m, Math.abs(x - b[k])), 0);
    const fwd = await trace(false, false);
    const rev = await trace(true, false);
    expect(fwd.armBorn, 'palms born on his arms').toBeGreaterThan(0);
    expect(rev.xs.length).toBe(fwd.xs.length);
    expect(apart(fwd.xs, rev.xs)).toBeLessThan(0.001);
    // (fault twin: his arm read live, the player stepped first moving it for the other)
    const liveF = await trace(false, true);
    const liveR = await trace(true, true);
    expect(apart(liveF.xs, liveR.xs)).toBeGreaterThan(0.004);
  }, 300_000);
});
