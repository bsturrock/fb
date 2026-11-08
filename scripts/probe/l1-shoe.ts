// Probe (plan 06 pass 2): stance shoe geometry per tick: shin lean along travel (deg, + = knee ahead of ankle), the
// lowest shoe corner (front/back, in/out) and its height, ankle height. Usage: vite-node scripts/probe/l1-shoe.ts <id> <side> <t0> <t1> [player]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { poseProbe } from '../../src/sim/debug';
const PROBE = poseProbe({ on: true });
import { qRot, v3 } from '../../src/sim/vec';
import { footFrame } from '../../src/sim/pose';
import { RAGDOLL_G4 } from '../../src/sim/profiles';
const [id, side, t0s, t1s, whoA] = process.argv.slice(2);
const who = whoA ?? 'R';
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, { debug: { poseProbe: PROBE } });
while (!sim.done && sim.t < Number(t1s)) {
  sim.stepTick();
  if (sim.t < Number(t0s)) continue;
  const pl = sim.players.find((p) => p.id === who)!;
  const pose = pl.pose!;
  const qs = pose.segments[`${side}Shin` as 'leftShin'].rotationWorld;
  const q = footFrame(pose, side as 'left');
  const down = qRot(qs, v3(0, -1, 0));
  const lean = (Math.atan2(-down.x, -down.y) * 180) / Math.PI;
  const H = (sim.ragdollProfile ?? RAGDOLL_G4).shoe.halfExtents;
  const c = pose.jointLandmarksWorld[`${side}Shoe`];
  let low = 9, name = '';
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const p = qRot(q, v3(sx * H.x, -H.y, sz * H.z));
    const y = c.y + p.y;
    if (y < low) { low = y; name = `${sz > 0 ? 'front' : 'back'}${sx > 0 ? '+x' : '-x'}`; }
  }
  const d = PROBE.legs[`${who}:${side}`];
  console.log(sim.t.toFixed(3), 'lean', lean.toFixed(1), 'low', name, low.toFixed(3), 'ankle y', pose.jointLandmarksWorld[`${side}Ankle`].y.toFixed(3), 'ik y', d.ik.y.toFixed(3), 'lift', (d.lifted.y - d.ik.y).toFixed(3), 'hipDist', Math.hypot(d.lifted.x - pose.jointLandmarksWorld[`${side}Hip`].x, d.lifted.y - pose.jointLandmarksWorld[`${side}Hip`].y, d.lifted.z - pose.jointLandmarksWorld[`${side}Hip`].z).toFixed(3), 'achDist', Math.hypot(pose.jointLandmarksWorld[`${side}Ankle`].x - pose.jointLandmarksWorld[`${side}Hip`].x, pose.jointLandmarksWorld[`${side}Ankle`].y - pose.jointLandmarksWorld[`${side}Hip`].y, pose.jointLandmarksWorld[`${side}Ankle`].z - pose.jointLandmarksWorld[`${side}Hip`].z).toFixed(3), 'knee', pose.hingeDeg[`${side}Knee`].toFixed(1), 'pitch', (pose.anklePitchDeg?.[side as 'left'] ?? 0).toFixed(1));
}
