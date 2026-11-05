// Probe (plan 06 pass 2): sampled leg solve stages per tick (world y and body-local z of request, foot-IK target and
// lifted target; floor depth left). Usage: vite-node scripts/probe/l1-ik.ts <id> <side> <t0> <t1> [player]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { POSE_DEBUG } from '../../src/sim/pose';
const [id, side, t0s, t1s, whoA] = process.argv.slice(2);
const who = whoA ?? 'R';
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
POSE_DEBUG.on = true;
while (!sim.done && sim.t < Number(t1s)) {
  sim.stepTick();
  if (sim.t < Number(t0s)) continue;
  const d = POSE_DEBUG.legs[`${who}:${side}`];
  const pl = sim.players.find((p) => p.id === who)!;
  const x0 = pl.pose!.segments.core.originWorld.x;
  const f = (v: { x: number; y: number }) => `x${(v.x - x0).toFixed(3)} y${v.y.toFixed(3)}`;
  console.log(sim.t.toFixed(3), 'req', f(d.request), 'ik', f(d.ik), 'lift', f(d.lifted), 'left', d.floorLeft.toFixed(3), 'ankle', f(pl.pose!.jointLandmarksWorld[`${side}Ankle`]), 'knee', pl.pose!.hingeDeg[`${side}Knee`].toFixed(1));
}
