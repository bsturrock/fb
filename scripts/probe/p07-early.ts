// Plan 07 probe: foot events of one fixture up to a time. Usage: vite-node scripts/probe/p07-early.ts <id> <toS>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const [id, to] = process.argv.slice(2);
const sim = await Simulation.create(allFixtures().find((d) => d.id === id)!);
while (!sim.done && sim.t < +to) sim.stepTick();
for (const e of sim.events) if (e.type.startsWith('foot')) console.log(e.t.toFixed(4), e.tick, e.type, JSON.stringify(e.data));
