// Plan 07 probe: handoffs of a footwork fixture with and without its footwork profile. Usage: vite-node scripts/probe/p07-nofeet-handoffs.ts <id>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const def = allFixtures().find((d) => d.id === process.argv[2])!;
for (const [n, d] of [['on', def], ['off', { ...def, footwork: undefined }]] as const) {
  const sim = await Simulation.create(d);
  while (!sim.done) sim.stepTick();
  console.log(n, sim.result, sim.events.filter((e) => e.type === 'representation' || e.type === 'handoffRejected').map((e) => `${e.t.toFixed(3)} ${e.playerId} ${e.type === 'representation' ? 'accepted' : `rejected ${e.data?.reasons}`}`).join(', '));
  sim.dispose();
}
