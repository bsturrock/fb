// Plan 08 probe: handoff rejections and step-failure events of a fixture.
// Usage: vite-node scripts/probe/p08-rej.ts <id>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const id = process.argv[2];
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, {});
sim.runToEnd();
for (const e of sim.events) if (/handoffRejected|handoffAudit|footPlantFailed|representation/.test(e.type)) console.log(e.t.toFixed(4), e.playerId, e.type, JSON.stringify(e.data).slice(0, 400));
sim.dispose();
