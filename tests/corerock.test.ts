import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/simulation';
import { asL4, tippedFall } from '../src/sim/fixtures/falls';
import { FALL_L4, type FallResponseProfile } from '../src/sim/profiles';
import { applySeed } from './seed';

// R's ragdoll and fall episode three solves before its core, rocking on one torso corner, slaps the far corner down
// (tipped forward fall, 3.5 m/s, 40 deg, 0.5 rad/s, on the closest-point guard). The host is the same fixture; the seed
// replaces its state. The first host solve rebuilds the contact manifolds from the seeded poses
const SEED = JSON.parse(readFileSync(new URL('./data/l4-tipped-forward-core-rock-105.json', import.meta.url), 'utf8'));
const HOST_STEP = 48;
const CLOSEST: FallResponseProfile = { ...FALL_L4, id: `${FALL_L4.id}-closestPoint`, impactGuard: { ...FALL_L4.impactGuard, manifoldPoints: undefined } };

async function seeded(P: FallResponseProfile) {
  const G = P.impactGuard;
  const sim: any = await Simulation.create(asL4(tippedFall({ id: 'corerock-host', dir: 'forward', speedMps: 3.5, leanDeg: 40, spinRad: 0.5 }), 'corerock-host', 'host', P), { trace: false });
  const orig = sim.stepSubstep.bind(sim);
  let done = false;
  let coreNs = 0;
  let at: { closest: number; manifold: number } | null = null;
  sim.stepSubstep = (i: number) => {
    if (sim.steps === HOST_STEP && !done) {
      applySeed(sim, 'R', SEED);
      done = true;
    }
    // the core's closing as the guard reads it before this solve, at the closest point and over the manifold
    const rag = sim.players[0].rag;
    const read = (m: boolean) => sim.closingSpeeds(rag, G.lookaheadSubsteps * sim.dt, G.predictionM, G.skinM, !!G.jointResidual, m).core ?? 0;
    const pre = done ? { closest: read(false), manifold: read(true) } : null;
    orig(i);
    if (!done) return;
    for (const c of sim.contacts)
      if (((c.a.playerId === 'R' && c.a.part === 'core') || (c.b.playerId === 'R' && c.b.part === 'core')) && c.impulse > coreNs) {
        coreNs = c.impulse;
        at = pre;
      }
  };
  while (sim.steps < HOST_STEP + 12) sim.stepTick();
  const s = sim.players[0].fall.stats;
  sim.dispose();
  return { over: s.overPowerSubsteps, peakW: s.peakPositiveW, coreNs, at: at! };
}

describe('L4 impact guard: a core rocking on a torso corner (tipped forward fall, seeded)', () => {
  it('the seed reproduces the slap: the core takes a large impulse while its closest point separates', async () => {
    const r = await seeded(CLOSEST);
    expect(r.coreNs).toBeGreaterThan(40);
    // before that solve the closest point reads under the guard speed, the far corner closes faster than the body speed
    expect(r.at.closest).toBeLessThanOrEqual(CLOSEST.impactGuard.closingMPerS);
    expect(r.at.manifold).toBeGreaterThan(CLOSEST.impactGuard.bodyClosingMPerS);
    // the closest point alone misses it (the gap this regression pins)
    expect(r.over).toBeGreaterThan(0);
  });
  it('FALL_L4 reads every manifold point, holds the body through it and stays under the power ceiling', async () => {
    const r = await seeded(FALL_L4);
    expect(r.coreNs).toBeGreaterThan(40);
    expect(r.over).toBe(0);
    expect(r.peakW).toBeLessThanOrEqual(FALL_L4.power.maxPositiveW * (1 + FALL_L4.power.toleranceFraction));
  });
});
