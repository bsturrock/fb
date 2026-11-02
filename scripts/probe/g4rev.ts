// Solver-order sensitivity: each Gate 4 fixture run in fixture order vs reversed player/transition order.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
for (const def of gate4Fixtures()) {
  const a = await Simulation.create(def); a.runToEnd();
  const b = await Simulation.create(def, { reverseOrder: true }); b.runToEnd();
  let maxD = 0, firstT: number | null = null;
  for (let i = 0; i < Math.min(a.trace.length, b.trace.length); i++) for (const id of Object.keys(a.trace[i].players)) {
    const p = a.trace[i].players[id].p, q = b.trace[i].players[id]?.p; if (!q) continue;
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d > 1e-6 && firstT === null) firstT = a.trace[i].t; maxD = Math.max(maxD, d);
  }
  const ea = a.ending, eb = b.ending;
  console.log(def.id.padEnd(30), a.result.padEnd(20), b.result.padEnd(20), ea ? `${ea.kind}@${ea.t}` : '-', eb ? `${eb.kind}@${eb.t}` : '-', 'maxD', maxD.toFixed(4), 'firstDiffT', firstT);
  a.dispose(); b.dispose();
}
