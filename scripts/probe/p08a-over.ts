// Plan 08a probe: every L3 boundary over 1 cm, with its largest landmarks, in both comparisons.
import { allFixtures } from '../../src/sim/fixtures/index';
import { Simulation } from '../../src/sim/simulation';
let n = 0, total = 0, peak = 0;
for (const def of allFixtures().filter((d) => d.milestone === 'L3')) {
  const sim = await Simulation.create(def, { transitionAudit: true });
  sim.runToEnd();
  for (const x of sim.transitionDeltas) {
    total++;
    peak = Math.max(peak, x.deltaM);
    if (x.deltaM <= 0.01) continue;
    n++;
    const k = (o: Record<string, number>) => Object.entries(o).filter(([, v]) => v > 0.004).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([q, v]) => `${q} ${(v * 100).toFixed(2)}`).join(' ');
    console.log(def.id, x.t.toFixed(4), x.playerId, 'delta', (x.deltaM * 100).toFixed(2), 'raw', (x.rawM * 100).toFixed(2), x.from, '>', x.to);
    console.log('   by', k(x.by), ' raw', k(x.rawBy));
  }
  sim.dispose();
}
console.log('total', total, 'over', n, 'peak', peak.toFixed(5));
process.exit(0);
