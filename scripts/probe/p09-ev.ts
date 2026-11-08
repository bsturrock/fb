import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
const id = process.argv[2];
const pat = new RegExp(process.argv[3] ?? '.');
const sim = await Simulation.create(fallFixtures().find((d) => d.id === id)!, { trace: false });
sim.runToEnd();
for (const e of sim.events) if (pat.test(e.type)) console.log(e.t.toFixed(3), e.type, e.playerId ?? '', JSON.stringify(e.data).slice(0, 150));
sim.dispose();
