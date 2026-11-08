// Plan 08 probe: handoff outcomes over every L3 fixture (accepted, rejected, audit failures). Usage: vite-node scripts/probe/p08-handoffs.ts
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const tally: Record<string, number> = {};
const rej: string[] = [];
let n = 0;
for (const def of allFixtures().filter((d) => d.id.startsWith('L3-'))) {
  const sim = await Simulation.create(def);
  while (!sim.done) sim.stepTick();
  n++;
  for (const e of sim.events as any[]) {
    if (/handoff|transfer/i.test(e.type ?? e.kind ?? e.name ?? '')) {
      const k = e.type ?? e.kind ?? e.name;
      tally[k] = (tally[k] ?? 0) + 1;
      if (/Rejected|Failure/.test(k)) rej.push(`${def.id} ${JSON.stringify(e).slice(0, 170)}`);
    }
  }
  sim.dispose();
}
console.log(n, JSON.stringify(tally));
console.log(rej.join('\n'));
