// Plan 08 probe: reach releases of a fixture inside the landing window, with what the event carries.
// Usage: vite-node scripts/probe/p08-fresh.ts <id regex>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { FOOTWORK_L3 } from '../../src/sim/footwork';

const landing = Math.round(FOOTWORK_L3.compose!.landWithinS * 240);
for (const def of allFixtures().filter((d) => new RegExp(process.argv[2] ?? '^L3-').test(d.id))) {
  const sim = await Simulation.create(def);
  while (!sim.done) sim.stepTick();
  for (const e of sim.events) if (e.type === 'footRelease' && e.data!.reason === 'reach' && Number(e.data!.solves) < landing) console.log(def.id, e.t.toFixed(4), e.playerId, JSON.stringify(e.data));
  sim.dispose();
}
