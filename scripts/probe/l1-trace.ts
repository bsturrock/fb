// Probe (plan 06 pass 2): one leg of R per tick: playback weight/phase/speed, request, foot-IK target, ankle, memory, ankle pitch.
// Usage: vite-node scripts/probe/l1-trace.ts <id> <side> <t0> <t1>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { poseProbe } from '../../src/sim/debug';
const PROBE = poseProbe({ on: true });
const [id, side, t0, t1] = process.argv.slice(2);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, { debug: { poseProbe: PROBE } });
while (!sim.done && sim.t < Number(t1)) {
  sim.stepTick();
  if (sim.t < Number(t0)) continue;
  const pl = sim.players.find((p) => p.id === 'R')!;
  const d = PROBE.legs[`R:${side}`];
  const a = pl.pose!.jointLandmarksWorld[`${side}Ankle`];
  const x0 = pl.pose!.segments.core.originWorld.x;
  console.log(sim.t.toFixed(3), 'w', pl.run?.w.toFixed(3), 'u', pl.run?.u.toFixed(3), 'spd', pl.run?.speed.toFixed(2), 'req', d ? `${(d.request.x - x0).toFixed(3)},${d.request.y.toFixed(3)}` : '-', 'ik', d ? `${(d.ik.x - x0).toFixed(3)},${d.ik.y.toFixed(3)}` : '-', 'ankle', `${(a.x - x0).toFixed(3)},${a.y.toFixed(3)}`, 'mem', JSON.stringify(pl.poseMemory), 'pitch', pl.pose!.anklePitchDeg?.[side as 'left']?.toFixed(1));
}
