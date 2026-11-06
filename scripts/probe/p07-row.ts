// Plan 07 probe: final player state and event count of one fixture (compare against an evidence row).
// Usage: vite-node scripts/probe/p07-row.ts <id>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const sim = await Simulation.create(allFixtures().find((d) => d.id === process.argv[2])!);
while (!sim.done) sim.stepTick();
console.log(sim.players.map((p) => `${p.id} ${p.rag ? 'rag' : 'proxy'} ${JSON.stringify(p.rag ? p.rag.bodies?.core?.translation?.() ?? '' : p.proxy.body.translation())}`).join(' | '), 'events', sim.events.filter((e) => e.type !== 'grounded').length, sim.events.filter((e) => e.type === 'representation' || e.type === 'handoffRejected').map((e) => `${e.t.toFixed(3)} ${e.playerId} ${e.type}`).join(', '));
