import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/simulation';
import { FALL_L4, type FallResponseProfile } from '../src/sim/profiles';
import { headPlantHost } from '../src/sim/fixtures/head-plant';
import { applySeed } from './seed';

// L4-F9-low's runner (intermediate pose) four solves before its head plant: R's ragdoll and fall episode at step 326 of
// L4-F9-low, captured where no contact of the last solve was over the guard impulse. The host is L4-F9-low's runner alone
// (src/sim/fixtures/head-plant.ts); the seed replaces its state at HOST_STEP. Reproduced on the ladder (rung 4a): the head
// touches down with 9.75 N s (under the 10 N s impulse rule) and is at rest, its own closing 0.004 m/s; the last solve
// left the core descending at the neck, 1.08 m/s along the contact normal, and the next solve takes 54.4 N s through the
// resting head. Without the joint residual the guard does not see it and the elbows realize 177.3 W against 157.5
const SEED = JSON.parse(readFileSync(new URL('./data/l4-f9-low-headplant-326.json', import.meta.url), 'utf8'));
const HOST_STEP = 48;
const OFF: FallResponseProfile = { ...FALL_L4, id: `${FALL_L4.id}-noResidual`, impactGuard: { ...FALL_L4.impactGuard, jointResidual: undefined } };
const CEILING = FALL_L4.power.maxPositiveW * (1 + FALL_L4.power.toleranceFraction);

async function seeded(P: FallResponseProfile) {
  const G = P.impactGuard;
  const sim: any = await Simulation.create(headPlantHost(P), { trace: false });
  const orig = sim.stepSubstep.bind(sim);
  let done = false;
  // per solve after the seed: the head's largest contact impulse, and its closing read before the solve without and with
  // the joint residual
  const solves: { headNs: number; own: number; res: number }[] = [];
  sim.stepSubstep = (i: number) => {
    if (sim.steps === HOST_STEP && !done) {
      applySeed(sim, 'R', SEED);
      done = true;
    }
    const rag = sim.players[0].rag;
    const read = (r: boolean): number => (done ? (sim.closingSpeeds(rag, G.lookaheadSubsteps * sim.dt, G.predictionM, G.skinM, r).head ?? 0) : 0);
    const pre = { own: read(false), res: read(true) };
    orig(i);
    if (!done) return;
    let headNs = 0;
    for (const c of sim.contacts) if ((c.a.playerId === 'R' && c.a.part === 'head') || (c.b.playerId === 'R' && c.b.part === 'head')) headNs = Math.max(headNs, c.impulse);
    solves.push({ headNs, ...pre });
  };
  while (sim.steps < HOST_STEP + 16) sim.stepTick();
  const s = sim.players[0].fall.stats;
  sim.dispose();
  const plant = solves.findIndex((x) => x.headNs > 40);
  const touch = solves.findIndex((x) => x.headNs > 0);
  return { over: s.overPowerSubsteps, peakW: s.peakPositiveW, solves, plant, touch };
}

describe('L4 impact guard: a resting head loaded through its neck (L4-F9-low head plant, seeded)', () => {
  it('the seed reproduces the plant: a head touch under the impulse rule, then a large impulse at rest that only the joint residual closes', async () => {
    const r = await seeded(OFF);
    expect(r.plant, 'a head impulse over 40 N s').toBeGreaterThan(0);
    // the head first touches down in an earlier solve, under the impulse rule, so the rule cannot hold the plant's solve
    expect(r.touch).toBeGreaterThanOrEqual(0);
    expect(r.touch).toBeLessThan(r.plant);
    for (const x of r.solves.slice(r.touch, r.plant)) expect(x.headNs).toBeLessThanOrEqual(OFF.impactGuard.impulseNs);
    // before the plant's solve the head is at rest on its own (under the guard speed); with its neck's residual it closes
    // faster than the guard speed
    const p = r.solves[r.plant];
    expect(p.own).toBeLessThanOrEqual(OFF.impactGuard.closingMPerS);
    expect(p.res).toBeGreaterThan(OFF.impactGuard.closingMPerS);
    // without the joint residual the guard misses it and the response goes over the power ceiling (the gap this pins)
    expect(r.over).toBeGreaterThan(0);
    expect(r.peakW).toBeGreaterThan(CEILING);
  });
  it('FALL_L4 holds the body through it and stays under the power ceiling', async () => {
    const r = await seeded(FALL_L4);
    expect(r.plant).toBeGreaterThan(0);
    expect(r.solves[r.plant].headNs).toBeGreaterThan(40);
    expect(r.over).toBe(0);
    expect(r.peakW).toBeLessThanOrEqual(CEILING);
  });
});
