// G4-F4 probe: two front palm holds (G2-F4 layout, balanced), diagnostic conversions of R / D / both at 0.9 s.
import { Simulation } from '../../src/sim/simulation';
import * as G2 from '../../src/sim/fixtures/gate2';
import * as G3 from '../../src/sim/fixtures/gate3';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
for (const who of [['R'], ['D'], ['R', 'D']]) {
  const b = G3.balancedVariant(G2.g2f4());
  const def: FixtureDef = { ...b, id: `F4-${who.join('')}`, gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4, durationS: 2.5, diagnostics: { conversions: who.map((p) => ({ playerId: p as any, atS: 0.9 })) } };
  const R = def.players.find((p) => p.id === 'R')!;
  if (R.controller.kind === 'script') R.controller.segments = [{ fromS: 0, velocity: v3(), facing: v3(0, 0, -1) }];
  const sim = await Simulation.create(def);
  sim.runToEnd();
  console.log('==', def.id, sim.result, JSON.stringify(sim.counts()));
  for (const e of sim.events.filter((e) => ['gripBegin', 'gripRelease', 'gripRemap', 'gripPassive', 'representation', 'handoffRejected', 'lossOfSupport', 'numericalFailure'].includes(e.type)))
    console.log('   ', e.t.toFixed(3), e.type, e.playerId, JSON.stringify(e.data ?? {}).slice(0, 300));
  sim.dispose();
}
