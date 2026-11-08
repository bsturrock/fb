// Plan 08 probe: transition audit detail: the largest boundaries of a fixture with the leg and arm landmark differences.
// Usage: vite-node scripts/probe/p08-audit.ts <id regex> [count]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2]);
const n = Number(process.argv[3] ?? 5);
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def, { transitionAudit: true });
  while (!sim.done) sim.stepTick();
  const ds = [...sim.transitionDeltas].sort((a, b) => b.deltaM - a.deltaM);
  console.log(`== ${def.id} boundaries ${ds.length} over 1 cm ${ds.filter((d) => d.deltaM > 0.01).length}`);
  for (const d of ds.slice(0, n)) {
    const f = (k: string): string => `${k}:${((d.by[k] ?? 0) * 100).toFixed(1)}`;
    console.log(` ${d.t.toFixed(3)} ${d.playerId} ${(d.deltaM * 100).toFixed(1)} ${d.landmark} ${['leftKnee', 'leftAnkle', 'rightKnee', 'rightAnkle', 'leftElbow', 'rightElbow'].map(f).join(' ')} [${d.from} > ${d.to}]`);
  }
  sim.dispose();
}
