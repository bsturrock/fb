import { describe, expect, it } from 'vitest';
import type { FallEpisode } from '../src/sim/fall-response';
import { FALL_L4, withSelfTrunkBody, type FallResponseProfile } from '../src/sim/profiles';
import { isGround } from '../src/sim/contracts';
import type { Simulation } from '../src/sim/simulation';
import { FIX, preOwnLegs } from './helpers';
import { loadState, resumeState } from './state';

// Ladder 9c, defects (rule 7) of the fall response reached by own-leg contact's moved trajectories, each on a capture
// taken under the own-leg flip's registration, a little before the defect. The twin with own-leg contact taken off
// every ragdoll from the same state (its self shapes stay in the world, massless, and the filter passes none of their
// pairs) shows the same defect: reached, not made by it. A tracked defect's test (its exception in tests/falls.test.ts)
// fails once the defect is gone from that state; it is then turned into the fix's test, with the fault twin.

/**
 * Resume `cap`; `ownLegs: false` takes own-leg contact off every ragdoll from there (the profile as before it); `fall`
 * resumes under another fall-response profile (a variant at `fallResponse`).
 */
async function resume(file: string, ownLegs: boolean, opts = {}, fall?: (p: FallResponseProfile) => FallResponseProfile): Promise<Simulation> {
  const cap = loadState(file);
  let def = FIX(cap.fixture);
  if (!ownLegs) def = preOwnLegs(def);
  if (fall) def = { ...def, fallResponse: fall(def.fallResponse!) };
  const variant = [...(ownLegs ? [] : ['ragdoll']), ...(fall ? ['fallResponse'] : [])];
  const sim = await resumeState(cap, { def, variant, opts });
  if (!ownLegs)
    for (const p of sim.players) {
      if (!p.rag) continue;
      delete p.rag.selfLegs;
      p.rag.profile = sim.def.ragdoll!;
    }
  return sim;
}

// IMPACT_OVER_POWER: L4-F3-run-on, D falls only under own-leg contact (R's legs moved before 0.7 s). D's core lands
// (1.604-1.613 s) and swings its right forearm into its own trunk: closing at 3.6 m/s before the solve after substep
// 390, the guard holds that arm only (plan 11: an own-trunk hit is the arm's), the solve takes 40 N s through the trunk,
// the core turns 1.7 rad/s and both hips and the left knee, their effort acting, realize 183 W against the 150 W cap
// (+5%), tagged an impact. D's own legs take no impulse in that solve. Captured at the end of tick 96 (1.600 s). Twin, own-
// leg contact off from there: the same substep over the cap (169 W, 38 N s), an impact. Fault twin: the legs' effort held
// off in that one substep, and nothing is over the cap. The fix (ladder 9f, `impactGuard.selfTrunkBody`, off): an own-
// trunk hit faster than the body speed holds the body, there in substeps 389 and 390, and nothing is over the cap.
describe('tracked defect IMPACT_OVER_POWER (L4-F3-run-on, from 1.600 s)', () => {
  const CAP = 'tests/data/state/L4-F3-run-on@96.json.gz';
  // the substep whose solve takes the hit (its request at sim.steps 390), audited at 1.6292 s
  const STEP = 390;

  async function landing(ownLegs: boolean, o: { holdLegs?: boolean; selfTrunkBody?: boolean } = {}) {
    const sim = await resume(CAP, ownLegs, {}, o.selfTrunkBody ? withSelfTrunkBody : undefined);
    const F = sim.fall!;
    const G = F.P.impactGuard;
    const request = F.request.bind(F);
    let atStep: { cmds: string[]; selfTrunk: Partial<Record<string, number>> } | null = null;
    F.request = (ep, contacts, arms) => {
      request(ep, contacts, arms);
      if (ep.playerId !== 'D' || sim.steps !== STEP) return;
      if (o.holdLegs) ep.cmds = ep.cmds.filter((c) => !/Hip|Knee/.test(c.joint.id));
      const selfTrunk: Partial<Record<string, number>> = {};
      sim.closingSpeeds(ep.rag, G.lookaheadSubsteps * sim.dt, G.predictionM, G.skinM, !!G.jointResidual, !!G.manifoldPoints, selfTrunk);
      atStep = { cmds: ep.cmds.map((c) => c.joint.id), selfTrunk };
    };
    while (!sim.done) sim.stepTick();
    const r = (sim.exportFixture() as any).fallEffort.D;
    const ev = sim.events.filter((e) => e.type === 'fallEffortOver' && e.playerId === 'D').map((e) => ({ t: +e.t.toFixed(4), impact: e.data?.impact }));
    sim.dispose();
    return { r, ev, atStep: atStep! };
  }

  it('the hit substep is over the power cap, an impact, with own-leg contact and without it; with the legs\' effort held off in it, nothing is; with selfTrunkBody the body holds there and nothing is', async () => {
    const P = FALL_L4.power;
    for (const ownLegs of [true, false]) {
      const { r, ev, atStep } = await landing(ownLegs);
      expect(ev, `own legs ${ownLegs}`).toEqual([{ t: 1.6292, impact: true }]);
      expect(r.overPowerSubsteps, `own legs ${ownLegs}`).toBe(1);
      expect(r.impactPowerSubsteps, `own legs ${ownLegs}`).toBe(1);
      expect(r.peakImpactW, `own legs ${ownLegs}`).toBeGreaterThan(P.maxPositiveW * (1 + P.toleranceFraction));
      // the right forearm closes on the own trunk faster than the body speed, and only its arm is held
      expect(atStep.selfTrunk.rightForearm!, `own legs ${ownLegs}`).toBeGreaterThan(FALL_L4.impactGuard.bodyClosingMPerS);
      expect(atStep.cmds, `own legs ${ownLegs}`).toEqual(['leftKnee', 'rightKnee', 'leftHip', 'rightHip']);
      const fixed = await landing(ownLegs, { selfTrunkBody: true });
      expect(fixed.atStep.cmds, `own legs ${ownLegs}, selfTrunkBody`).toEqual([]);
      expect(fixed.ev, `own legs ${ownLegs}, selfTrunkBody`).toEqual([]);
      expect(fixed.r.overPowerSubsteps, `own legs ${ownLegs}, selfTrunkBody`).toBe(0);
      expect(fixed.r.peakPositiveW, `own legs ${ownLegs}, selfTrunkBody`).toBeLessThanOrEqual(P.maxPositiveW * (1 + P.toleranceFraction));
    }
    const held = await landing(true, { holdLegs: true });
    expect(held.ev).toEqual([]);
    expect(held.r.overPowerSubsteps).toBe(0);
  }, 180000);
});

// BRACE_EXPIRED_OBSTRUCTED, fixed at ladder 9e: L4-F5-twoClamp-on, D's right brace is still seeking when its response's
// window ends (2.2 s) with its forearm on R's left shin. falls.test.ts's rule (a miss is obstructed exactly when a
// seeking brace pressed on another body within the shortest prediction horizon) reads it obstructed, and so does the
// core-down path (from the response's own obstruction record, set in that same substep); the end-of-window path did not
// read the record and missed it as `expired`. Before the own-leg flip the same miss had its last such contact 0.104 s
// before (outside the 0.1 s horizon). Captured at the end of tick 126 (2.100 s), under the own-leg flip. Fault twin: the
// end-of-window path as before 9e (an obstruction there missed as `expired`), with own-leg contact and without it.
describe('BRACE_EXPIRED_OBSTRUCTED, fixed: a brace pressed on a body when the window ends is obstructed (L4-F5-twoClamp-on, from 2.100 s)', () => {
  const CAP = 'tests/data/state/L4-F5-twoClamp-on@126.json.gz';
  const W = FALL_L4.brace.horizonS[0];

  async function rightMiss(ownLegs: boolean, fault = false) {
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
    if (fault) {
      // the end-of-window path (the episode is done when it misses a brace) without the obstruction record
      const F = sim.fall! as unknown as { missBrace: (ep: FallEpisode, a: unknown, reason: string) => void };
      const miss = F.missBrace.bind(F);
      F.missBrace = (ep, a, reason) => miss(ep, a, ep.done && reason === 'obstructed' ? 'expired' : reason);
    }
    while (!sim.done) sim.stepTick();
    const m = sim.events.filter((e) => e.type === 'braceMiss' && e.playerId === 'D' && e.data?.arm === 'right');
    sim.dispose();
    return m.map((e) => ({ t: +e.t.toFixed(4), reason: e.data?.reason, near: seek !== undefined && e.t - seek <= W + 1e-9 }));
  }

  it('the right brace\'s window ends while it presses on R: missed as obstructed, with own-leg contact and without it; the end-of-window path without the obstruction misses it as expired', async () => {
    for (const ownLegs of [true, false]) {
      expect(await rightMiss(ownLegs), `own legs ${ownLegs}`).toEqual([{ t: 2.2, reason: 'obstructed', near: true }]);
      expect(await rightMiss(ownLegs, true), `fault, own legs ${ownLegs}`).toEqual([{ t: 2.2, reason: 'expired', near: true }]);
    }
  }, 120000);
});
