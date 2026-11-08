// Mean knee angle over time for the L4-F2 twins (argument: id regex).
import { Simulation } from '../../src/sim/simulation';
import { hingeAngles } from '../../src/sim/ragdoll';
import { fallFixtures } from '../../src/sim/fixtures/falls';
const pat = new RegExp(process.argv[2] ?? '^L4-F2');
const times = [0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1, 1.5, 2.5];
console.log('fixture'.padEnd(26), times.map((t) => String(t).padStart(11)).join(''));
for (const def of fallFixtures()) {
  if (!pat.test(def.id)) continue;
  const s = await Simulation.create(def, { trace: false });
  const row: string[] = [];
  for (const t of times) {
    while (!s.done && s.t < t - 1e-9) s.stepTick();
    const h = hingeAngles(s.players[0].rag!);
    row.push(`${h.leftKnee.toFixed(0)}/${h.rightKnee.toFixed(0)}`.padStart(11));
  }
  console.log(def.id.padEnd(26), row.join(''));
  s.dispose();
}
