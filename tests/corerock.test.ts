import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/simulation';
import { asL4, tippedFall } from '../src/sim/fixtures/falls';
import { FALL_L4, type FallResponseProfile } from '../src/sim/profiles';
import { applySeed } from './seed';

// R's ragdoll and fall episode three solves before its core, rocking on one torso corner, slaps the far corner down
// (tipped forward fall, 3.5 m/s, 40 deg, 0.5 rad/s, captured on the closest-point guard). The host is the same fixture;
// the seed replaces its state at HOST_STEP. The first host solve rebuilds the contact manifolds from the seeded poses.
// Reproduced on the ladder (rung 4b): before the slap's solve the core's closest point reads no closing, the manifold's
// far corner closes at 3.5 m/s; the solve takes 56 N s through the core and, on the closest point alone, the response
// realizes 219 W against 157.5
const SEED = JSON.parse(readFileSync(new URL('./data/l4-tipped-forward-core-rock-105.json', import.meta.url), 'utf8'));
const HOST_STEP = 48;
const CLOSEST: FallResponseProfile = { ...FALL_L4, id: `${FALL_L4.id}-closestPoint`, impactGuard: { ...FALL_L4.impactGuard, manifoldPoints: undefined } };
const CEILING = FALL_L4.power.maxPositiveW * (1 + FALL_L4.power.toleranceFraction);

async function seeded(P: FallResponseProfile) {
  const G = P.impactGuard;
  const sim: any = await Simulation.create(asL4(tippedFall({ id: 'corerock-host', dir: 'forward', speedMps: 3.5, leanDeg: 40, spinRad: 0.5 }), 'corerock-host', 'host', P), { trace: false });
  const orig = sim.stepSubstep.bind(sim);
  let done = false;
  // per solve after the seed: the core's largest contact impulse, and its closing read before the solve at the closest
  // point and over the manifold
  const solves: { coreNs: number; closest: number; manifold: number }[] = [];
  sim.stepSubstep = (i: number) => {
    if (sim.steps === HOST_STEP && !done) {
      applySeed(sim, 'R', SEED);
      done = true;
    }
    const rag = sim.players[0].rag;
    const read = (m: boolean): number => (done ? (sim.closingSpeeds(rag, G.lookaheadSubsteps * sim.dt, G.predictionM, G.skinM, !!G.jointResidual, m).core ?? 0) : 0);
    const pre = { closest: read(false), manifold: read(true) };
    orig(i);
    if (!done) return;
    let coreNs = 0;
    for (const c of sim.contacts) if ((c.a.playerId === 'R' && c.a.part === 'core') || (c.b.playerId === 'R' && c.b.part === 'core')) coreNs = Math.max(coreNs, c.impulse);
    solves.push({ coreNs, ...pre });
  };
  while (sim.steps < HOST_STEP + 12) sim.stepTick();
  const s = sim.players[0].fall.stats;
  sim.dispose();
  const slap = solves.findIndex((x) => x.coreNs > 40);
  return { over: s.overPowerSubsteps, peakW: s.peakPositiveW, solves, slap };
}

describe('L4 impact guard: a core rocking on a torso corner (tipped forward fall, seeded)', () => {
  it('the seed reproduces the slap: the core takes a large impulse while its closest point does not close', async () => {
    const r = await seeded(CLOSEST);
    // after the first seeded solve: its manifold is the seeded state's, not the host's
    expect(r.slap).toBeGreaterThanOrEqual(1);
    const x = r.solves[r.slap];
    expect(x.coreNs).toBeGreaterThan(40);
    // before that solve the closest point reads under the guard speed, the far corner closes faster than the body speed
    expect(x.closest).toBeLessThanOrEqual(CLOSEST.impactGuard.closingMPerS);
    expect(x.manifold).toBeGreaterThan(CLOSEST.impactGuard.bodyClosingMPerS);
    // nothing over the guard impulse in the solve before it, so the impulse rule cannot hold the slap's solve either
    expect(r.solves[r.slap - 1].coreNs).toBeLessThanOrEqual(CLOSEST.impactGuard.impulseNs);
    // the closest point alone misses it and the response goes over the power ceiling (the gap this regression pins)
    expect(r.over).toBeGreaterThan(0);
    expect(r.peakW).toBeGreaterThan(CEILING);
  });
  it('FALL_L4 reads every manifold point, holds the body through it and stays under the power ceiling', async () => {
    const r = await seeded(FALL_L4);
    expect(r.slap).toBeGreaterThanOrEqual(1);
    expect(r.solves[r.slap].coreNs).toBeGreaterThan(40);
    expect(r.over).toBe(0);
    expect(r.peakW).toBeLessThanOrEqual(CEILING);
  });
});
