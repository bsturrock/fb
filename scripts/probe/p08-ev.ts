// Plan 08 probe: foot events of one player in a time window.
// Usage: vite-node scripts/probe/p08-ev.ts <id> <player> <from s> <to s>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const [id, player, a, b] = process.argv.slice(2);
const sim = await Simulation.create(allFixtures().find((d) => d.id === id)!);
while (!sim.done) sim.stepTick();
for (const e of sim.events) if (e.playerId === player && e.t >= Number(a) && e.t <= Number(b)) console.log(e.t.toFixed(4), e.type, JSON.stringify(e.data ?? {}).slice(0, 170));
sim.dispose();
