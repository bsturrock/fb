// Plan 08 probe: one block per fixture: result, mode changes and handoffs per player, transition audit, limb peak.
// Usage: vite-node scripts/probe/p08-contact.ts <id regex>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2]);
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def, { transitionAudit: true });
  while (!sim.done) sim.stepTick();
  const modes = sim.events.filter((e) => e.type === 'locoMode').map((e) => `${e.t.toFixed(2)} ${e.playerId} ${(e.data as { to: string }).to}(${(e.data as { reason: string }).reason})`);
  const hand = sim.events.filter((e) => /handoff|invalid|Rejected|fall/i.test(e.type)).map((e) => `${e.type}:${e.playerId}@${e.t.toFixed(2)}`);
  const top = [...sim.transitionDeltas].sort((a, b) => b.deltaM - a.deltaM).slice(0, 2).map((d) => `${(d.deltaM * 100).toFixed(1)}cm@${d.t.toFixed(2)} ${d.playerId} ${d.landmark} [${d.from} > ${d.to}]`);
  const pl = sim.events.filter((e) => e.type === 'footPlant').length;
  console.log(`${def.id} ${sim.result} t ${sim.t.toFixed(2)} plants ${pl} transitions ${sim.transitionDeltas.length}`);
  console.log('   modes', modes.join(' | ').slice(0, 420));
  if (hand.length) console.log('   hand ', hand.join(' ').slice(0, 300));
  console.log('   audit', top.join('  ').slice(0, 300));
  sim.dispose();
}
