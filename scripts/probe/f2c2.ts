import { Simulation } from '../../src/sim/simulation';
import { g1f2 } from '../../src/sim/fixtures/gate1';
const sim = await Simulation.create(g1f2('compound'));
for (let i = 0; i < 75; i++) sim.stepTick();
const w = sim.physics.world;
const D = sim.byId.get('D')!, R = sim.byId.get('R')!;
for (const ca of D.proxy.colliders) {
  w.contactPairsWith(ca, (cb) => {
    w.contactPair(ca, cb, (m, flipped) => {
      const tag = sim.physics.tags.get(cb.handle);
      console.log(sim.physics.tags.get(ca.handle)?.region, '->', tag?.playerId, tag?.region, 'flipped', flipped, 'n', m.numContacts(), 'solver', m.numSolverContacts(), [...Array(m.numContacts())].map((_, i) => m.contactDist(i).toFixed(5)));
    });
  });
}
console.log('R colliders', R.proxy.colliders.map(c => c.handle));
