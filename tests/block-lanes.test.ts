// Plan 16 (p45): the inside lane, won and not assigned (`BlockProfile.lanes`, LANES_V1, `decideLane`). The rule on
// constructed cases; then a state captured in BL-F9-threePoint at the snap (3.3 s; lanes on), both men firing out, A's
// under hands and B's over hands crossing forearm through forearm as assigned (before p45), resumed with the lanes, without
// them (as assigned), and with the lane called late (as the first palm lands). With its fault twins.
import { describe, expect, it } from 'vitest';
import { decideLane, LANES_V1 } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { qInvRot, sub } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { depth, drawnShapes } from './visible';
import { FIX } from './helpers';

describe('plan 16 (p45), the inside lane', () => {
  it('the rule: none until a palm is within the call; then the man whose palm is nearer his man has the inside, the higher of the two if so; level, the lower man; alike, none', () => {
    const C = 0.6;
    expect(decideLane({ awayM: 0.7, hipM: 0.7 }, { awayM: 0.8, hipM: 0.8 }, C), 'none within the call').toBeUndefined();
    // (the nearer man higher: a rule taking the lower man first would give him the outside)
    expect(decideLane({ awayM: 0.5, hipM: 0.8 }, { awayM: 0.55, hipM: 0.7 }, C)).toBe('inside');
    expect(decideLane({ awayM: 0.55, hipM: 0.7 }, { awayM: 0.5, hipM: 0.8 }, C)).toBe('outside');
    expect(decideLane({ awayM: 0, hipM: 0.8 }, { awayM: 0.2, hipM: 0.7 }, C), 'on him').toBe('inside');
    // (his palm far beyond the call, mine within it: still nearer)
    expect(decideLane({ awayM: 0.59, hipM: 0.8 }, { awayM: 2, hipM: 0.7 }, C)).toBe('inside');
    expect(decideLane({ awayM: 0.5, hipM: 0.7 }, { awayM: 0.5, hipM: 0.8 }, C), 'level: the lower man').toBe('inside');
    expect(decideLane({ awayM: 0.5, hipM: 0.8 }, { awayM: 0.5, hipM: 0.7 }, C)).toBe('outside');
    expect(decideLane({ awayM: 0.5, hipM: 0.7 }, { awayM: 0.5, hipM: 0.7 }, C), 'alike').toBeUndefined();
  });

  const CAPTURE_S = 3.3;
  const END_S = 4.8;
  type Mode = 'lanes' | 'assigned' | 'late';
  function scene(mode: Mode): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    // (the p45 leverage off: the lanes as they first came)
    const d = blockScene({ ...s, id: 'BL-T-lanes', durationS: END_S + 0.1, lanes: true, insideLeverage: false, stayLow: false, shoulderTops: false, foldKeeps: false, armsGive: false, laneTie: false, burstTaper: false, lowUnheld: false, palmSlide: false, laneOnStrike: false, frame: false, heldByPush: false, strikeAtLoadGap: false, toeOut: false }, FIX('L3-F6-hold'));
    if (mode === 'lanes') return d;
    // a twin: the lanes off (the request's hands), or called as the first palm lands
    return {
      ...d,
      players: d.players.map((p) => {
        if (p.controller?.kind !== 'block') return p;
        const P = p.controller.profile!;
        return { ...p, controller: { ...p.controller, profile: { ...P, lanes: mode === 'assigned' ? undefined : { ...LANES_V1, callM: 0.02 } } } };
      }),
    } as FixtureDef;
  }
  let cap: StateCapture | undefined;
  async function captured(): Promise<StateCapture> {
    if (cap) return cap;
    const sim = await Simulation.create(scene('lanes'));
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    cap = captureState(sim);
    sim.dispose();
    return cap;
  }
  interface Out {
    /** each man's lane and when it was called (s), and his first palm push on his man (s) and how far off his man's centre line it was born (m, the mean of his palms then) */
    lane: Record<string, { lane: string; t: number } | undefined>;
    born: Record<string, { t: number; offM: number } | undefined>;
    /** the deepest one man's drawn forearm or palm is in the other's (m) */
    crossM: number;
  }
  async function run(mode: Mode): Promise<Out> {
    // (a twin's change: the lanes)
    const variant = mode === 'lanes' ? [] : ['players.0.controller.profile.lanes', 'players.1.controller.profile.lanes'];
    const sim = await resumeState(await captured(), { def: scene(mode), variant });
    const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    const n0 = sim.events.length;
    const out: Out = { lane: {}, born: {}, crossM: 0 };
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      const [a, b] = sim.players;
      for (const p of [a, b]) {
        const o = p === a ? b : a;
        if (out.born[p.id]) continue;
        const off = (['left', 'right'] as const).map((s) => sim.arms!.pushOf(p.id, s)).filter((pu) => pu?.targetId === o.id).map((pu) => Math.abs(qInvRot(o.proxy.body.rotation(), sub(pu!.pointWorld, o.proxy.body.translation())).x));
        if (off.length) out.born[p.id] = { t: sim.t, offM: off.reduce((x, y) => x + y, 0) / off.length };
      }
      if (a.rag || b.rag || !a.pose || !b.pose) continue;
      const fa = drawnShapes(a.pose, a.body, R).filter((s) => s.cls === 'forearm' || s.cls === 'palm');
      const fb = drawnShapes(b.pose, b.body, R).filter((s) => s.cls === 'forearm' || s.cls === 'palm');
      for (const x of fa) for (const y of fb) out.crossM = Math.max(out.crossM, depth(x, y));
    }
    for (const e of sim.events.slice(n0)) if (e.type === 'blockLane' && e.playerId) out.lane[e.playerId] = { lane: (e.data as { lane: string }).lane, t: e.t };
    sim.dispose();
    return out;
  }

  it("the fire-out resumed from the snap with the lanes: the lane is called once each, opposite, before either man's palms land; the outside man's palms land 10 cm or more off his man's centre line, the inside man's within it, and no forearm goes 2 cm into the other man's; fault twins: as assigned, or called as the first palm lands, forearms cross 8 cm or more", async () => {
    const on = await run('lanes');
    const la = on.lane.A, lb = on.lane.B;
    expect(la && lb, 'on: called for both').toBeTruthy();
    expect([la!.lane, lb!.lane].sort(), 'on: opposite lanes').toEqual(['inside', 'outside']);
    const first = Math.min(on.born.A?.t ?? Infinity, on.born.B?.t ?? Infinity);
    expect(Math.max(la!.t, lb!.t), 'on: called before either lands').toBeLessThan(first);
    const inside = la!.lane === 'inside' ? 'A' : 'B';
    const outside = inside === 'A' ? 'B' : 'A';
    expect(on.born[outside]!.offM, 'on: outside palms wide').toBeGreaterThanOrEqual(0.1);
    expect(on.born[inside]!.offM, 'on: inside palms within').toBeLessThan(0.1);
    expect(on.crossM, 'on: no forearm through forearm').toBeLessThan(0.02);
    // (as assigned: A's under hands through B's over hands, 10.6 cm; called late: the outside man's hands going outside
    // through the inside man's forearms as they land, 11.6 cm)
    for (const mode of ['assigned', 'late'] as const) {
      const off = await run(mode);
      expect(off.crossM, `fault (${mode}): forearms cross`).toBeGreaterThanOrEqual(0.08);
    }
  }, 180_000);
});
