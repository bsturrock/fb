// Plan 07 probe: plant churn and limb snaps with and without the limb continuity (POSE_DEBUG.noContinuity). Per
// fixture: plants, plants released in the same substep (plantedS 0), planted drift max, and snaps over 10 cm (body-frame
// second difference of knee/ankle/elbow/wrist per tick) before any ragdoll. Usage: vite-node scripts/probe/p07-churn.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { POSE_DEBUG } from '../../src/sim/pose';
import { add, len, qConj, qRot, scale, sub, type Vec3 } from '../../src/sim/vec';

const re = new RegExp(process.argv[2] ?? '^L2-|^RH-');
const J = ['leftKnee', 'leftAnkle', 'rightKnee', 'rightAnkle', 'leftElbow', 'leftWrist', 'rightElbow', 'rightWrist'];
async function run(id: string, off: boolean) {
  POSE_DEBUG.noContinuity = off;
  const sim = await Simulation.create(allFixtures().find((d) => d.id === id)!);
  const hist: Record<string, Record<string, Vec3>[]> = {};
  let snaps = 0;
  let worst = 0;
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) {
      if (pl.rag || !pl.pose) continue;
      const b = pl.proxy.body;
      const qi = qConj({ ...b.rotation() });
      const o = b.translation();
      const cur: Record<string, Vec3> = {};
      for (const n of J) cur[n] = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], o));
      const h = (hist[pl.id] ??= []);
      h.push(cur);
      if (h.length >= 3) {
        const [a, m] = [h[h.length - 3], h[h.length - 2]];
        for (const n of J) {
          const d2 = len(add(sub(cur[n], scale(m[n], 2)), a[n]));
          worst = Math.max(worst, d2);
          if (d2 > 0.1) snaps++;
        }
      }
    }
  }
  const plants = sim.events.filter((e) => e.type === 'footPlant').length;
  const churn = sim.events.filter((e) => e.type === 'footRelease' && (e.data?.plantedS as number) === 0).length;
  const rej = sim.events.filter((e) => e.type === 'handoffRejected').map((e) => e.playerId).join(',');
  const drift = Math.max(0, ...sim.players.map((p) => p.feet?.stats.plantErrM ?? 0));
  sim.dispose();
  return `plants ${String(plants).padStart(3)} churn ${String(churn).padStart(3)} drift ${(drift * 100).toFixed(2)}cm snaps>10cm ${String(snaps).padStart(3)} worst ${(worst * 100).toFixed(0).padStart(3)}cm rejected [${rej}]`;
}
for (const def of allFixtures()) {
  if (!re.test(def.id) || !def.support) continue;
  console.log(`${def.id.padEnd(22)} off: ${await run(def.id, true)}\n${''.padEnd(22)} on:  ${await run(def.id, false)}`);
}
