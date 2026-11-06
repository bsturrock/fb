// Plan 07 probe: per pose call (substep) trace of one leg in the body frame between two times.
// Usage: vite-node scripts/probe/p07-legtrace.ts <fixture> <player:leftLeg> <fromS> <toS>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { POSE_DEBUG } from '../../src/sim/pose';
import type { Vec3 } from '../../src/sim/vec';

const [id, key, a, b] = process.argv.slice(2);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const f = (v: unknown) => (v && typeof v === 'object' && 'x' in (v as object) ? `${(v as Vec3).x.toFixed(3)},${(v as Vec3).y.toFixed(3)},${(v as Vec3).z.toFixed(3)}` : String(v));
POSE_DEBUG.trace = (k, r) => {
  if (k !== key || sim.t < +a || sim.t > +b) return;
  console.log(sim.t.toFixed(4), Object.entries(r).map(([n, v]) => `${n} ${f(v)}`).join('  '));
};
while (!sim.done && sim.t <= +b) sim.stepTick();
