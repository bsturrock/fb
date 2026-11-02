// Which target regions do Gate 2/3 palm holds land on?
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
for (const def of allFixtures().filter((d) => d.gate === 2 || d.gate === 3)) {
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const g = sim.events.filter((e) => e.type === 'gripBegin');
  const regions = g.map((e) => `${e.data!.region ?? e.data!.targetRegion ?? '?'}`);
  if (g.length) console.log(def.id.padEnd(28), g.length, [...new Set(regions)].join(','));
  sim.dispose();
}
