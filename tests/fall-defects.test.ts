import { describe, expect, it } from 'vitest';
import type { FallEpisode } from '../src/sim/fall-response';
import { FALL_L4 } from '../src/sim/profiles';
import { isGround } from '../src/sim/contracts';
import type { Simulation } from '../src/sim/simulation';
import { FIX, preOwnLegs } from './helpers';
import { loadState, resumeState } from './state';

// Ladder 9c, tracked defects (rule 7) of the fall response reached by own-leg contact's moved trajectories (the
// exceptions in tests/falls.test.ts), each on a capture taken under the own-leg flip's registration, a little before
// the defect. The twin with own-leg contact taken off every ragdoll from the same state (its self shapes stay in the
// world, massless, and the filter passes none of their pairs) shows the same defect: reached, not made by it. Each test
// fails once its defect is gone from that state; it is then to be turned into the fix's test.

/** Resume `cap`; `ownLegs: false` takes own-leg contact off every ragdoll from there (the profile as before it). */
async function resume(file: string, ownLegs: boolean, opts = {}): Promise<Simulation> {
  const cap = loadState(file);
  if (ownLegs) return resumeState(cap, { opts });
  const sim = await resumeState(cap, { def: preOwnLegs(FIX(cap.fixture)), variant: ['ragdoll'], opts });
  for (const p of sim.players) {
    if (!p.rag) continue;
    delete p.rag.selfLegs;
    p.rag.profile = sim.def.ragdoll!;
  }
  return sim;
}

// IMPACT_OVER_POWER: L4-F3-run-on, D falls only under own-leg contact (R's legs moved before 0.7 s); landing at 1.625 s,
// the solve after substep 390 jolts both hips and the left knee while their fall effort acts: 183 W realized against
// the 135 W cap (+5%), tagged an impact. D's own legs take no impulse in that solve. Captured at the end of tick 96
// (1.600 s). Twin, own-leg contact off from there: the same substep over the cap (169 W), an impact. Fault twin: the
// legs' effort held off in that one substep (what the impact guard is for) and nothing is over the cap.
describe('tracked defect IMPACT_OVER_POWER (L4-F3-run-on, from 1.600 s)', () => {
  const CAP = 'tests/data/state/L4-F3-run-on@96.json.gz';
  // the substep whose solve takes the landing (its request at sim.steps 390), audited at 1.6292 s
  const STEP = 390;

  async function landing(ownLegs: boolean, holdLegs = false) {
    const sim = await resume(CAP, ownLegs);
    const F = sim.fall!;
    if (holdLegs) {
      const request = F.request.bind(F);
      F.request = (ep, contacts, arms) => {
        request(ep, contacts, arms);
        if (ep.playerId === 'D' && sim.steps === STEP) ep.cmds = ep.cmds.filter((c) => !/Hip|Knee/.test(c.joint.id));
      };
    }
    while (!sim.done) sim.stepTick();
    const r = (sim.exportFixture() as any).fallEffort.D;
    const ev = sim.events.filter((e) => e.type === 'fallEffortOver' && e.playerId === 'D').map((e) => ({ t: +e.t.toFixed(4), impact: e.data?.impact }));
    sim.dispose();
    return { r, ev };
  }

  it('the landing substep is over the power cap, an impact, with own-leg contact and without it; with the legs\' effort held off in it, nothing is', async () => {
    for (const ownLegs of [true, false]) {
      const { r, ev } = await landing(ownLegs);
      expect(ev, `own legs ${ownLegs}`).toEqual([{ t: 1.6292, impact: true }]);
      expect(r.overPowerSubsteps, `own legs ${ownLegs}`).toBe(1);
      expect(r.impactPowerSubsteps, `own legs ${ownLegs}`).toBe(1);
      expect(r.peakImpactW, `own legs ${ownLegs}`).toBeGreaterThan(FALL_L4.power.maxPositiveW * (1 + FALL_L4.power.toleranceFraction));
    }
    const held = await landing(true, true);
    expect(held.ev).toEqual([]);
    expect(held.r.overPowerSubsteps).toBe(0);
  }, 120000);
});

// BRACE_EXPIRED_OBSTRUCTED: L4-F5-twoClamp-on, D's right brace is still seeking when its response's window ends (2.2
// s) with its forearm on R's left shin: missed `expired`. falls.test.ts's rule (a miss is obstructed exactly when a
// seeking brace pressed on another body within the shortest prediction horizon) reads it obstructed; the core-down path
// would say so (it reads the response's own obstruction record, set in that same substep), the end-of-window path does
// not read it. Before the flip the same miss had its last such contact 0.104 s before (outside the 0.1 s horizon).
// Captured at the end of tick 126 (2.100 s). Twin, own-leg contact off from there: the same. Fault twin: the window's
// end reading the obstruction as the core-down path does, and the rule holds.
describe('tracked defect BRACE_EXPIRED_OBSTRUCTED (L4-F5-twoClamp-on, from 2.100 s)', () => {
  const CAP = 'tests/data/state/L4-F5-twoClamp-on@126.json.gz';
  const W = FALL_L4.brace.horizonS[0];

  async function rightMiss(ownLegs: boolean, readObstruction = false) {
    let seek: number | undefined;
    const onSubstep = (x: Simulation) => {
      const p = x.byId.get('D')!;
      const a = p.fall?.arms.right;
      if (!a || a.task !== 'brace' || a.brace !== 'seek' || x.arms?.retained('D', 'right')) return;
      for (const c of x.contacts) {
        if (c.impulse <= 0) continue;
        for (const [own, o] of [[c.a, c.b], [c.b, c.a]] as const) {
          if (own.playerId !== 'D' || own.side !== 'right' || (own.region !== 'palm' && own.region !== 'forearm') || isGround(o) || o.playerId === 'D') continue;
          const held = !!o.playerId && !!o.side && (o.region === 'palm' || o.region === 'forearm') && !!x.arms?.retained(o.playerId, o.side);
          if (!held) seek = x.t;
        }
      }
    };
    const sim = await resume(CAP, ownLegs, { onSubstep });
    if (readObstruction) {
      const F = sim.fall! as unknown as { missBrace: (ep: FallEpisode, a: { obstructedAtS: number | null }, reason: string) => void };
      const miss = F.missBrace.bind(F);
      F.missBrace = (ep, a, reason) => miss(ep, a, reason === 'expired' && a.obstructedAtS !== null && sim.t - a.obstructedAtS <= W + 1e-9 ? 'obstructed' : reason);
    }
    while (!sim.done) sim.stepTick();
    const m = sim.events.filter((e) => e.type === 'braceMiss' && e.playerId === 'D' && e.data?.arm === 'right');
    sim.dispose();
    return m.map((e) => ({ t: +e.t.toFixed(4), reason: e.data?.reason, near: seek !== undefined && e.t - seek <= W + 1e-9 }));
  }

  it('the right brace\'s window ends while it presses on R: missed as expired, with own-leg contact and without it; read as the core-down path reads it, obstructed', async () => {
    for (const ownLegs of [true, false]) expect(await rightMiss(ownLegs), `own legs ${ownLegs}`).toEqual([{ t: 2.2, reason: 'expired', near: true }]);
    expect(await rightMiss(true, true)).toEqual([{ t: 2.2, reason: 'obstructed', near: true }]);
  }, 120000);
});
