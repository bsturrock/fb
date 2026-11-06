// Plan 07 probe: every handoff (accepted / rejected, reasons, worst external, depths) per fixture.
// Usage: vite-node scripts/probe/p07-handoffs.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2] ?? '^RH-|^L2-');
for (const def of allFixtures()) {
  if (!re.test(def.id) || !def.ragdoll) continue;
  const sim = await Simulation.create(def);
  while (!sim.done) sim.stepTick();
  const ev = sim.events.filter((e) => e.type === 'handoffRejected' || e.type === 'representation');
  console.log(`${def.id.padEnd(24)} ${ev.map((e) => `${e.t.toFixed(3)} ${e.playerId} ${e.type === 'handoffRejected' ? `REJECTED ${e.data?.reasons} ext ${e.data?.maxNewExternalPenetrationM} ${JSON.stringify(e.data?.worstExternal)} floor ${e.data?.floorPenetrationM} lm ${e.data?.maxLandmarkErrM}` : 'accepted'}`).join(' | ') || '-'}`);
  sim.dispose();
}
