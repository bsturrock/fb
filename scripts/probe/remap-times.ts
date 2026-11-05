// Probe: clampRemap and representation events of the model wrap tackle.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const def = allFixtures().find((f) => f.id === (process.argv[2] ?? 'G4-F3-twoArm-M'))!;
const sim = await Simulation.create(def);
sim.runToEnd();
for (const e of sim.events.filter((e) => ['clampRemap', 'representation', 'lossOfSupport', 'handoffRejected', 'ruleEnding'].includes(e.type))) console.log(e.t, e.type, e.playerId, JSON.stringify(e.data).slice(0, 160));
console.log(sim.players.map((p) => [p.id, p.handoff?.outcome, p.handoff?.t]));
