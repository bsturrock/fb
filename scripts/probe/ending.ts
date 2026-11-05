// Probe: print the rule ending event (full data) of one fixture.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const def = allFixtures().find((f) => f.id === process.argv[2])!;
const sim = await Simulation.create(def);
sim.runToEnd();
for (const e of sim.events.filter((e) => ['ruleEnding', 'groundTouch', 'sidelineTouch'].includes(e.type))) console.log(e.t, e.type, JSON.stringify(e.data));
