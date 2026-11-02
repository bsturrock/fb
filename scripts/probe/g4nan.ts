import { Simulation } from '../../src/sim/simulation';
import * as G4 from '../../src/sim/fixtures/gate4';
const sim = await Simulation.create(G4.g4f11HeldUp());
for (let i = 0; i < 10; i++) sim.stepTick();
const b = sim.players.find((p) => p.id === 'R')!.proxy.body;
b.setTranslation({ x: NaN, y: 1, z: 0 }, true);
console.log('after set', b.linvel());
sim.stepTick();
console.log('after step', b.translation(), b.linvel(), sim.result);
