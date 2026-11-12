import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Simulation } from '../src/sim/simulation';
import { FALL_L4, type FallResponseProfile } from '../src/sim/profiles';
import { headPlantHost } from '../src/sim/fixtures/head-plant';
import { applySeed } from './seed';

const SEED = JSON.parse(readFileSync(new URL('./data/l4-f9-low-headplant-326.json', import.meta.url), 'utf8'));
const HOST_STEP = 48;

async function seeded(P: FallResponseProfile) {
  const sim: any = await Simulation.create(headPlantHost(P), { trace: false });
  const orig = sim.stepSubstep.bind(sim);
  let done = false;
  let headNs = 0;
  sim.stepSubstep = (i: number) => {
    if (sim.steps === HOST_STEP && !done) {
      applySeed(sim, 'R', SEED);
      done = true;
    }
    orig(i);
    if (done) for (const c of sim.contacts) if ((c.a.playerId === 'R' && c.a.part === 'head') || (c.b.playerId === 'R' && c.b.part === 'head')) headNs = Math.max(headNs, c.impulse);
  };
  while (sim.steps < HOST_STEP + 16) sim.stepTick();
  const s = sim.players[0].fall.stats;
  sim.dispose();
  return { over: s.overPowerSubsteps, peakW: s.peakPositiveW, headNs };
}

describe('L4 impact guard: a resting head loaded through its neck (L4-F9-low head plant, seeded)', () => {
  it('the seed reproduces the plant: the head takes a large impulse at rest', async () => {
    const off: FallResponseProfile = { ...FALL_L4, id: `${FALL_L4.id}-noResidual`, impactGuard: { ...FALL_L4.impactGuard, jointResidual: undefined } };
    const r = await seeded(off);
    expect(r.headNs).toBeGreaterThan(40);
    // without the joint residual the guard misses it (the gap this regression pins)
    expect(r.over).toBeGreaterThan(0);
  });
  it('FALL_L4 holds the body through it and stays under the power ceiling', async () => {
    const r = await seeded(FALL_L4);
    expect(r.headNs).toBeGreaterThan(40);
    expect(r.over).toBe(0);
    expect(r.peakW).toBeLessThanOrEqual(FALL_L4.power.maxPositiveW * (1 + FALL_L4.power.toleranceFraction));
  });
});
