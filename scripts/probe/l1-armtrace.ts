// Probe (plan 06 pass 2): one arm of R per tick (body-local palm, residual, memory, playback weight).
// Usage: vite-node scripts/probe/l1-armtrace.ts <id> <side> <t0> <t1>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { qInvRot, sub } from '../../src/sim/vec';
const [id, side, t0, t1] = process.argv.slice(2);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
while (!sim.done && sim.t < Number(t1)) {
  sim.stepTick();
  if (sim.t < Number(t0)) continue;
  const pl = sim.players.find((p) => p.id === 'R')!;
  const c = pl.pose!.segments.core;
  const p = qInvRot(c.rotationWorld, sub(pl.pose!.jointLandmarksWorld[`${side}Palm`], c.originWorld));
  const e = qInvRot(c.rotationWorld, sub(pl.pose!.jointLandmarksWorld[`${side}Elbow`], c.originWorld));
  console.log(sim.t.toFixed(3), 'w', pl.run?.w.toFixed(3), 'spd', pl.run?.speed.toFixed(2), 'u', pl.run?.u.toFixed(3), 'bl', pl.run?.blend.toFixed(3), 'k', pl.run?.k, 'hd', pl.run?.heading.toFixed(3), 'rate', pl.run?.rate.toFixed(3), 'palm', `${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`, 'elbow', `${e.x.toFixed(3)},${e.y.toFixed(3)},${e.z.toFixed(3)}`, 'res', (pl.pose!.targetResidualM?.[`${side}Arm`] ?? 0).toFixed(3), 'mem', JSON.stringify(pl.poseMemory));
}
