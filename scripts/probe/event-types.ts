// Probe: event type counts and summary keys of one fixture.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const def = allFixtures().find((f) => f.id === (process.argv[2] ?? 'G4-F3-twoArm'))!;
const sim = await Simulation.create(def);
sim.runToEnd();
const c: Record<string, number> = {};
for (const e of sim.events) c[e.type] = (c[e.type] ?? 0) + 1;
console.log(c);
console.log(Object.keys(sim.summary() as any));
