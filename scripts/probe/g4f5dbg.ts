import { Simulation } from '../../src/sim/simulation';
import * as G4 from '../../src/sim/fixtures/gate4';
const sim = await Simulation.create(G4.g4f5Standing());
const seen = new Map<string, number>();
while (!sim.done) { sim.stepTick(); for (const c of sim.contacts) if (c.a.playerId && c.a.playerId === c.b.playerId) { const k = `${c.a.key}/${c.b.key} pts=${c.points.length} imp=${c.impulse.toFixed(3)}`; seen.set(k, (seen.get(k) ?? 0) + 1); } }
console.log([...seen].slice(0, 10));
