import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
for (const def of fallFixtures()) {
  const sim = await Simulation.create(def, { trace: false });
  sim.runToEnd();
  const lim = (sim.exportFixture() as any).jointLimits ?? {};
  for (const [id, l] of Object.entries(lim) as any) { const m = Math.max(0, ...l.envelope.joints.map((j: any) => j.startOutsideDeg)); if (m > 0.5) console.log(def.id, id, m.toFixed(1)); }
  sim.dispose();
}
