// Plan 07 closeout item 3 probe: largest one-tick second difference |p(t) - 2p(t-1) + p(t-2)| of the knee and ankle
// landmarks (proxy frame, while the proxy is shown), before item 3 (debug switches legacyEntry + noQuick) and with it, split
// into before the brake (2.6 s for L2-F3), brake..3.6 s and after; plus the count over 6 cm per window. Quick steps
// trade drags for higher foot accelerations. Usage: vite-node scripts/probe/p07-accel.ts
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { add, len, qConj, qRot, scale, sub, type Vec3 } from '../../src/sim/vec';
const ids = ['L2-F3-runStop', 'L2-F3-runStopHard', 'L2-F7-shove', 'L2-F6-hop', 'L2-F8-outOfRange', 'L2-F11-fastRun'];
for (const id of ids) for (const legacy of [true, false]) {
  const def = allFixtures().find((d) => d.id === id)!;
  const sim = await Simulation.create(def, { debug: { foot: { legacyEntry: legacy, noQuick: legacy } } });
  const hist: Record<string, Vec3[]> = {};
  const win = [0, 0, 0]; const at = [0, 0, 0]; const n3 = [0, 0, 0];
  const brake = id.startsWith('L2-F3') ? 2.6 : 1e9;
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) {
      if (pl.rag || !pl.pose) continue;
      const b = pl.proxy.body; const o = b.translation(); const q = b.rotation(); const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
      for (const n of ['leftAnkle', 'rightAnkle', 'leftKnee', 'rightKnee']) {
        const k = pl.id + n; const p = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], o));
        const h = (hist[k] ??= []); h.push(p); if (h.length > 3) h.shift();
        if (h.length === 3) {
          const d = len(add(sub(h[2], scale(h[1], 2)), h[0]));
          const w = sim.t < brake ? 0 : sim.t < 3.6 ? 1 : 2;
          if (d > win[w]) { win[w] = d; at[w] = sim.t; }
          if (d > 0.06) n3[w]++;
        }
      }
    }
  }
  console.log(`${id.padEnd(18)} ${legacy ? 'old  ' : 'item3'} max2nd cm: before-brake ${(win[0] * 100).toFixed(1)}@${at[0].toFixed(3)} brake..3.6 ${(win[1] * 100).toFixed(1)}@${at[1].toFixed(3)} after ${(win[2] * 100).toFixed(1)}@${at[2].toFixed(3)}  >6cm ${n3.join('/')}`);
  sim.dispose();
}
