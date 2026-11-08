// Plan 09 review: every substep whose realized positive effort power passes 150 W, and what made it.
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
const only = process.argv[2];
for (const def of fallFixtures()) {
  if (only && !def.id.includes(only)) continue;
  const sim = await Simulation.create(def, { trace: false });
  sim.runToEnd();
  if (!sim.fall) { sim.dispose(); continue; }
  const by = new Map<string, typeof sim.fall.ledger>();
  for (const e of sim.fall.ledger) {
    const k = `${e.owner}@${e.step}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(e);
  }
  for (const [k, rows] of by) {
    const pos = rows.reduce((s, e) => s + Math.max(0, e.realizedW), 0);
    const pred = rows.reduce((s, e) => s + e.predictedW, 0);
    if (pos <= 150) continue;
    console.log(`${def.id} ${k} t ${rows[0].t.toFixed(4)} realized+ ${pos.toFixed(1)} predicted ${pred.toFixed(1)}`);
    for (const e of rows.filter((x) => Math.abs(x.realizedW) > 5)) console.log(`   ${e.joint} ${e.task ?? ''} ${e.appliedNm.toFixed(1)}Nm ps ${e.powerScale.toFixed(2)} pred ${e.predictedW.toFixed(1)} real ${e.realizedW.toFixed(1)}`);
  }
  sim.dispose();
}
