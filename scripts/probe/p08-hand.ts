// Plan 08 probe: the handoff candidates of a fixture: every attempt, accepted or rejected, with its external penetration.
// Usage: vite-node scripts/probe/p08-hand.ts <id>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const def = allFixtures().find((d) => d.id === process.argv[2])!;
const sim = await Simulation.create(def, {});
sim.runToEnd();
for (const e of sim.events) {
  if (e.type === 'handoffRejected') console.log(e.t.toFixed(4), e.playerId, 'rejected', JSON.stringify(e.data?.worstExternal), e.data?.maxNewExternalPenetrationM);
  if (e.type === 'representation') console.log(e.t.toFixed(4), e.playerId, 'converted', JSON.stringify((e.data?.candidate as Record<string, unknown>)?.worstExternal), (e.data?.candidate as Record<string, unknown>)?.maxNewExternalPenetrationM);
}
sim.dispose();
