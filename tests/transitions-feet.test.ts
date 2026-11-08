// Plan 08 (L3): locomotion transitions and automatic tackle integration. The composed foot planner (start, brake, settle),
// the fitted idle and procedural walking arms, the per-player locomotion mode (free, preparation, contact, exit) and the
// transition audit. L2, HC and every earlier fixture keep their paths; each L3 fixture opts in under its own id.
import { afterEach, describe, expect, it } from 'vitest';
import { Simulation } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { FOOTWORK_L3 } from '../src/sim/footwork';
import { dist, horiz, len, sub, type Vec3 } from '../src/sim/vec';
import { runSim } from './helpers';
import { SIDES, FIX, each } from './transitions-shared';


// a long file of synchronous runs: let the runner's messages through between tests
afterEach(() => new Promise<void>((done) => setTimeout(done)));

describe('plan 08 foot limits at every actual substep', () => {
  const LIFT = FOOTWORK_L3.swing.maxLiftRateMps;
  const REJOIN = FOOTWORK_L3.rejoinMps;
  const SW = FOOTWORK_L3.swing;
  type Seen = { lift: number; offset: number; nLift: number; nOffset: number; ownerChanges: number; gap: number; gapLevel: number; gapStepY: number; nStepReseeds: number; nCarried: number; carriedStat: number; carriedFlat: number };
  /**
   * The vertical target speed and the offset recovery speed from outside the planner, between two substeps of one seed: a step
   * also from the substep it takes over without a reseed (a carried leg), or changes mode on its path. `carriedStat` and
   * `carriedFlat` are how far the planner's own record of that first update is from what it published, vertically and level.
   */
  const measure = async (d: FixtureDef): Promise<{ sim: Simulation; seen: Seen }> => {
    const seen: Seen = { lift: 0, offset: 0, nLift: 0, nOffset: 0, ownerChanges: 0, gap: 0, gapLevel: 0, gapStepY: 0, nStepReseeds: 0, nCarried: 0, carriedStat: 0, carriedFlat: 0 };
    const last = new Map<string, { source: string; mode: string; target: Vec3; offset: Vec3; seeds: number; solved: Vec3; recoord: boolean; speed: number }>();
    const sim = await Simulation.create(d, {
      onSubstep: (s) => {
        for (const pl of s.players)
          for (const side of SIDES) {
            const f = pl.feet?.feet[side];
            // a converted player has no planner update: its stored rates are the last substep's, nothing moves the plan
            if (!f || pl.rag) continue;
            const k = `${pl.id}:${side}`;
            const p = last.get(k);
            const v = pl.proxy.body.linvel();
            const speed = Math.hypot(v.x, v.z);
            const same = !!p && p.seeds === f.seeds && !p.recoord && !f.rejoin;
            if (p && same && f.mode !== 'planted') {
              if (f.source === 'step') {
                const rate = Math.abs(f.target.y - p.target.y) / s.dt;
                seen.lift = Math.max(seen.lift, rate);
                seen.nLift++;
                if (p.source !== 'step') {
                  seen.nCarried++;
                  seen.carriedStat = Math.max(seen.carriedStat, Math.abs(f.liftRateMps - rate));
                  seen.carriedFlat = Math.max(seen.carriedFlat, Math.abs(f.speedMps - len(horiz(sub(f.target, p.target))) / s.dt));
                }
              } else if (f.source === 'follow' && p.source === 'follow' && p.mode === f.mode && !f.wait) {
                // relative to the moving request; a request jump or seam is a change of coordinates the offset takes up
                seen.offset = Math.max(seen.offset, len(sub(sub(f.offset, p.offset), f.seamOffset)) / s.dt);
                seen.nOffset++;
              }
            } else if (p && p.seeds !== f.seeds) {
              // a reseed keeps the foot: the new owner's target starts one substep from the achieved foot. Level: within the
              // step speed cap at the body's travel speed (the fastest any owner moves a target, plan 10b), as a fraction of
              // it; a step's height within the lift cap. A follow owner's height is the request's; a plant's is the floor
              seen.ownerChanges++;
              seen.gap = Math.max(seen.gap, dist(f.target, p.solved));
              const cap = (SW.maxSpeedMps + SW.travelSpeedK * Math.max(speed, p.speed)) * s.dt;
              seen.gapLevel = Math.max(seen.gapLevel, len(horiz(sub(f.target, p.solved))) / cap);
              if (f.source === 'step' && f.mode !== 'planted') {
                seen.nStepReseeds++;
                seen.gapStepY = Math.max(seen.gapStepY, Math.abs(f.target.y - p.solved.y) / (LIFT * s.dt));
              }
            }
            last.set(k, { source: f.source, mode: f.mode, target: { ...f.target }, offset: { ...f.offset }, seeds: f.seeds, solved: { ...f.solvedW }, recoord: f.rejoin || f.wait, speed });
          }
      },
    });
    await runSim(sim);
    return { sim, seen };
  };
  const counters = (sim: Simulation): { lift: number; offset: number; margin: number } => ({
    lift: Math.max(...sim.players.map((p) => p.feet?.stats.liftRateMps ?? 0)),
    offset: Math.max(...sim.players.map((p) => p.feet?.stats.offsetDecayMps ?? 0)),
    margin: Math.min(...sim.players.map((p) => p.feet?.stats.stepCapMarginMps ?? Infinity)),
  });

  each(/^L3-/, 'vertical target and offset recovery stay inside their limits, measured inside the planner and from outside', async (d) => {
    const { sim, seen } = await measure(d);
    const c = counters(sim);
    expect(c.lift, d.id).toBeLessThanOrEqual(LIFT + 1e-6);
    expect(c.offset, d.id).toBeLessThanOrEqual(REJOIN + 1e-6);
    expect(seen.lift, d.id).toBeLessThanOrEqual(LIFT + 1e-6);
    expect(seen.offset, d.id).toBeLessThanOrEqual(REJOIN + 1e-6);
    expect(seen.gap, d.id).toBeLessThan(0.1);
    expect(seen.gapLevel, d.id).toBeLessThanOrEqual(1 + 1e-9);
    expect(seen.gapStepY, d.id).toBeLessThanOrEqual(1 + 1e-9);
    expect(seen.carriedStat, d.id).toBeLessThan(1e-6);
    expect(seen.carriedFlat, d.id).toBeLessThan(1e-6);
    expect(c.margin, d.id).toBeGreaterThanOrEqual(-1e-9);
    sim.dispose();
  });

  it('a carried handover is under the bound from its first update, and the planner records that update', async () => {
    // the follow path these legs came off was going down at 3.25 m/s (phase3) and 2.85 m/s (phase0) when a step took them over
    for (const id of ['L3-F1-phase3', 'L3-F1-phase0', 'L3-F1-low']) {
      const { sim, seen } = await measure(FIX(id));
      expect(seen.nCarried, id).toBeGreaterThan(0);
      expect(seen.lift, id).toBeGreaterThan(0.9 * LIFT);
      expect(seen.lift, id).toBeLessThanOrEqual(LIFT + 1e-6);
      sim.dispose();
    }
  }, 30000);

  it('the reported overruns run again: the limits are reached there, not avoided', async () => {
    for (const id of ['L3-F16-runStop', 'L3-F14-walkRunStop', 'L3-F7-phase0']) {
      const { sim, seen } = await measure(FIX(id));
      const c = counters(sim);
      expect(seen.nLift, id).toBeGreaterThan(100);
      expect(seen.nOffset, id).toBeGreaterThan(100);
      expect(seen.ownerChanges, id).toBeGreaterThan(4);
      expect(Math.max(c.lift, seen.lift), id).toBeGreaterThan(0.9 * LIFT);
      sim.dispose();
    }
  }, 60000);
});

