// Probe: per-joint separation time series for one fixture at the declared solver.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
import { anchorErrors } from '../../src/sim/ragdoll';
import { len, vc } from '../../src/sim/vec';
const re = new RegExp(process.argv[2] ?? 'spin');
for (const def of gate4Fixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def);
  let over = 0;
  for (;;) {
    sim.stepTick();
    const r = sim.players[0].rag;
    if (r) {
      const ae = anchorErrors(r);
      const [j, m] = Object.entries(ae).sort((a, b) => b[1] - a[1])[0];
      if (m > 0.01) {
        over++;
        const sp = Object.fromEntries(Object.entries(r.bodies).map(([k, b]) => [k, len(vc(b.linvel())).toFixed(1)]));
        console.log(sim.t.toFixed(3), j, (m * 1000).toFixed(1), 'mm', JSON.stringify(sp));
      }
    }
    if (sim.result !== 'running' || sim.t >= def.durationS - 1e-9) break;
  }
  console.log(def.id, 'frames >10mm', over);
  sim.dispose();
}
