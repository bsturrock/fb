// Plan 16 (p48): his arms against his man hold him there as his hands on (`BlockProfile.frame`, `withFrame`). A state
// captured in BL-F2-walkIn under the full set of the newer runs (the set BL-F9-threePoint runs, the lane on the strike) at
// 1.6 s, as A walks in on B and B's outside palms fold under him (they end, folded, at 1.71 s), resumed with both men's
// arms framing and, as the twin, without. With its fault twin: B backs off to arm's length with his palms against A and A
// following, never clear of him.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { dot, len, norm, sub, v3 } from '../src/sim/vec';
import { captureState, resumeState, type StateCapture } from './state';
import { FIX } from './helpers';

describe('plan 16 (p48), the arms against his man a frame', () => {
  const CAPTURE_S = 1.6;
  const END_S = 4;
  const scene = (frame: boolean): FixtureDef => {
    const s = BL_SCENES.find((x) => x.id === 'BL-F2-walkIn')!;
    return blockScene({ ...s, id: 'BL-T-frame', durationS: END_S + 0.1, seat: true, aimThrough: true, stanceCone: true, followThrough: true, lanes: true, insideLeverage: true, stayLow: true, shoulderTops: true, foldKeeps: true, armsGive: true, laneTie: true, burstTaper: true, lowUnheld: true, palmSlide: true, laneOnStrike: true, upperArm: true, frame }, FIX('L3-F6-hold'));
  };
  const caps = new Map<boolean, StateCapture>();
  async function captured(rev: boolean): Promise<StateCapture> {
    if (caps.has(rev)) return caps.get(rev)!;
    const sim = await Simulation.create(scene(false), { reverseOrder: rev });
    while (sim.t < CAPTURE_S - 1e-9) sim.stepTick();
    caps.set(rev, captureState(sim));
    sim.dispose();
    return caps.get(rev)!;
  }
  interface Out {
    /** B's ground given from the capture to the end (m, along the line from A) */
    givenM: number;
    /** B's mean speed away from A over the last second (m/s) */
    lastMps: number;
    /** the share of the last second B's palm or forearm is against A, a push on or not */
    againstShare: number;
    /** B's pushes on A that ended folded (`collapsed`) after the capture */
    folded: number;
    falls: string[];
  }
  async function run(frame: boolean, rev: boolean): Promise<Out> {
    const sim = await resumeState(await captured(rev), { def: scene(frame), ...(frame ? { variant: ['players.0.controller.profile', 'players.1.controller.profile'] } : {}) });
    const a = sim.players.find((p) => p.id === 'A')!;
    const b = sim.players.find((p) => p.id === 'B')!;
    const n0 = sim.events.length;
    const flat = (p: typeof a) => {
      const t = p.proxy.body.translation();
      return v3(t.x, 0, t.z);
    };
    const u = norm(sub(flat(b), flat(a)));
    const z0 = dot(flat(b), u);
    let n = 0;
    let against = 0;
    let away = 0;
    while (!sim.done && sim.t < END_S - 1e-9) {
      sim.stepTick();
      if (a.rag || b.rag) break;
      if (sim.t < END_S - 1 - 1e-9) continue;
      const w = sub(flat(b), flat(a));
      const vb = b.proxy.body.linvel();
      away += dot(v3(vb.x, 0, vb.z), len(w) > 1e-9 ? norm(w) : u);
      const o = sim.arms!.obs('B');
      if ((['left', 'right'] as const).some((s) => o?.[s]?.touchingTarget === 'A')) against++;
      n++;
    }
    const out: Out = { givenM: dot(flat(b), u) - z0, lastMps: away / Math.max(1, n), againstShare: against / Math.max(1, n), folded: 0, falls: [] };
    for (const e of sim.events.slice(n0)) {
      if (e.type === 'pushEnd' && e.playerId === 'B' && (e.data as { reason: string }).reason === 'collapsed') out.folded++;
      if (e.type === 'lossOfSupport') out.falls.push(`${e.playerId}:${(e.data as { reason?: string }).reason}`);
    }
    sim.dispose();
    return out;
  }

  it("BL-F2-walkIn under the full set, both orders, resumed as B's palms fold under A's walk-in: they end folded and B's palms stay against A; framed, he holds there, stopping within 0.1 m/s and giving under 0.6 m; nobody falls; fault twin: he backs off to arm's length at 0.5 m/s with his palms against A, more than 1 m", async () => {
    for (const rev of [false, true]) {
      const on = await run(true, rev);
      expect(on.folded, `on (rev ${rev}): B's palms end folded`).toBeGreaterThan(0);
      expect(on.againstShare, `on (rev ${rev}): his palms against A`).toBeGreaterThan(0.9);
      expect(on.lastMps, `on (rev ${rev}): he holds there`).toBeLessThan(0.1);
      expect(on.givenM, `on (rev ${rev}): what he gives`).toBeLessThan(0.6);
      expect(on.falls, `on (rev ${rev}): nobody falls`).toEqual([]);
      const off = await run(false, rev);
      expect(off.folded, `fault (rev ${rev}): B's palms end folded`).toBeGreaterThan(0);
      expect(off.againstShare, `fault (rev ${rev}): his palms against A`).toBeGreaterThan(0.9);
      expect(off.lastMps, `fault (rev ${rev}): backing off`).toBeGreaterThan(0.45);
      expect(off.givenM, `fault (rev ${rev}): run back`).toBeGreaterThan(1);
    }
  }, 180_000);
});
