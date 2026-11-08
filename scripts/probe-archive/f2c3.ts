import { Simulation } from '../../src/sim/simulation';
import { g1f2, g1f4 } from '../../src/sim/fixtures/gate1';
import { SOLVER_G1 } from '../../src/sim/profiles';
for (const ccd of [true, false]) for (const mk of [() => g1f2('compound'), () => g1f4({ kind: 'compound' })]) {
  const def = mk(); def.solver = { ...SOLVER_G1, ccd };
  const sim = await Simulation.create(def);
  for (let i = 0; i < 100; i++) sim.stepTick();
  const w = sim.physics.world;
  const D = sim.byId.get('D')!;
  const out: string[] = [];
  for (const ca of D.proxy.colliders) w.contactPairsWith(ca, (cb) => w.contactPair(ca, cb, (m) => {
    const t = sim.physics.tags.get(cb.handle); if (!t?.playerId) return;
    if (m.numContacts()) out.push(`${sim.physics.tags.get(ca.handle)?.region}-${t.region} d=${m.contactDist(0).toFixed(4)} sd=${m.numSolverContacts() ? m.solverContactDist(0).toFixed(4) : '-'} J=${m.contactImpulse(0).toFixed(3)}`);
  }));
  console.log(def.id, 'ccd', ccd, 'gap', sim.pairGap['D|R'].toExponential(2), out.join(' | '));
}
