// Probe: core height, grounded flicker, speed and lean of the model runner in G3-F1-M (pose inputs for run clips).
import { Simulation } from '../../src/sim/simulation';
import { modelFixtures } from '../../src/sim/fixtures/model';
const def = modelFixtures().find((d) => d.id === (process.argv[2] ?? 'G3-F1-M'))!;
const sim = await Simulation.create(def);
let ungrounded = 0;
while (!sim.done) {
  sim.stepTick();
  const pl = sim.players[0];
  const row = sim.trace[sim.trace.length - 1].players[pl.id];
  if (!row.g) ungrounded++;
  if (sim.tick % 15 === 0) {
    const lm = pl.pose!.jointLandmarksWorld;
    console.log(sim.t.toFixed(2), 'y', row.p[1].toFixed(4), 'v', Math.hypot(row.v[0], row.v[2]).toFixed(3), 'g', row.g, 'lean', row.lean?.deg, 'hipL.y', lm.leftHip.y.toFixed(3), 'ankL.y', lm.leftAnkle.y.toFixed(3));
  }
}
console.log('ungrounded ticks', ungrounded, 'of', sim.tick);
