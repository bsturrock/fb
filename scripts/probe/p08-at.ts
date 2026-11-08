// Plan 08 review probe: every audited number of one fixture's boundaries in a time window.
// Usage: vite-node scripts/probe/p08-at.ts <fixture id> <from> <to> [player]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const [id, a, b, who] = process.argv.slice(2);
const sim = await Simulation.create(allFixtures().find((d) => d.id === id)!, { transitionAudit: true });
while (!sim.done) sim.stepTick();
for (const d of sim.transitionDeltas) {
  if (d.t < Number(a) - 1e-9 || d.t > Number(b) + 1e-9 || (who && d.playerId !== who)) continue;
  const top = Object.entries(d.by).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([k, v]) => `${k} ${(v * 100).toFixed(3)}`).join(', ');
  const rawTop = Object.entries(d.rawBy).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, v]) => `${k} ${(v * 100).toFixed(3)}`).join(', ');
  console.log(`${d.t.toFixed(5)} ${d.playerId} delta ${(d.deltaM * 100).toFixed(3)} ${d.landmark} raw ${(d.rawM * 100).toFixed(3)} cont ${(d.continuedM * 100).toFixed(3)} jump ${JSON.stringify(d.requestJumpM)} stop ${JSON.stringify(d.stepStopM)}\n   ${d.from}\n   ${d.to}\n   by ${top}\n   raw ${rawTop}`);
}
sim.dispose();
