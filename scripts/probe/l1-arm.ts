// Probe (plan 06): free-arm swing candidates (depth / soft per ARM_ALTS index) per tick for one fixture.
// Usage: vite-node scripts/probe/l1-arm.ts <id> [player] [side]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { POSE_DEBUG } from '../../src/sim/pose';
const id = process.argv[2] ?? 'L1-F1-sprint';
const who = process.argv[3] ?? 'R';
const side = process.argv[4] ?? 'left';
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
POSE_DEBUG.on = true;
while (!sim.done && sim.t < 1) {
  sim.stepTick();
  const row = sim.trace[sim.trace.length - 1].players[who];
  const c = POSE_DEBUG.last[`${who}:${side}Arm`];
  if (sim.tick % 2 === 0 && c && row.run) console.log(sim.t.toFixed(3), 'u', row.run.u.toFixed(3), c.map((x) => `${x.i}:${x.depth.toFixed(3)}/${x.soft.toFixed(3)}`).join(' '));
}
