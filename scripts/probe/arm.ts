// Usage: vite-node scripts/probe/arm.ts <fixtureId> [every]
import { allFixtures } from '../../src/sim/fixtures/index';
import { Simulation } from '../../src/sim/simulation';
const id = process.argv[2];
const every = Number(process.argv[3] ?? 6);
const def = allFixtures().find((f) => f.id === id)!;
const sim = await Simulation.create(def);
sim.runToEnd();
for (const e of sim.events) if (!['grounded', 'contactRegion'].includes(e.type)) console.log(e.t.toFixed(3), e.type, e.playerId ?? '', JSON.stringify(e.data));
for (const row of sim.trace) {
  if (row.tick % every) continue;
  const d = row.players.D;
  const r = row.players.R;
  const arms = Object.entries(d.arm ?? {}).map(([k, a]) => `${k[0]}:${a!.ph}/${a!.id ?? '-'} F${a!.F} N${a!.N} Ft${a!.Ft} ok${a!.ok} palm(${a!.palm.map((x) => x.toFixed(2)).join(',')})`).join(' | ');
  console.log(row.t.toFixed(3), `D p(${d.p[0].toFixed(2)},${d.p[2].toFixed(2)}) v(${d.v[0].toFixed(2)},${d.v[2].toFixed(2)})`, `R p(${r.p[0].toFixed(2)},${r.p[2].toFixed(2)}) v(${r.v[0].toFixed(2)},${r.v[2].toFixed(2)}) yaw${(r.yaw*57.3).toFixed(0)}`, d.wrap ?? '', arms);
}
console.log(sim.result, 'minGap', sim.minPairGap, 'ledger', sim.arms?.ledger.length);
