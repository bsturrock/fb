// Probe (plan 06): pose-memory (chosen limb variants) histogram of a fixture, per player and limb.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const def = allFixtures().find((d) => d.id === (process.argv[2] ?? 'G3-F1-M'))!;
const sim = await Simulation.create(def);
const hist: Record<string, Record<number, number>> = {};
while (!sim.done) {
  sim.stepTick();
  for (const pl of sim.players) for (const [k, v] of Object.entries(pl.poseMemory)) ((hist[`${pl.id}:${k}`] ??= {})[v] = (hist[`${pl.id}:${k}`]?.[v] ?? 0) + 1);
}
console.log(def.id, JSON.stringify(hist));
