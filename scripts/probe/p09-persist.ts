// Plan 09 review: longest continuous run past the envelope tolerance, per fall fixture (top entries).
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
const rows: [number, string][] = [];
for (const def of fallFixtures()) {
  if (def.id.startsWith('L4-F1-')) continue;
  const s = await Simulation.create(def, { trace: false });
  s.runToEnd();
  for (const p of s.players) for (const e of p.rag?.envelope ?? []) rows.push([e.maxOverRunS, `${def.id} ${p.id} ${e.jointId} max ${e.maxOverDeg.toFixed(1)}`]);
  s.dispose();
}
rows.sort((a, b) => b[0] - a[0]);
for (const [r, k] of rows.slice(0, Number(process.argv[2] ?? 6))) console.log(r.toFixed(3), k);
