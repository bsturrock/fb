// Plan 08 probe: one line per fixture: result, stop time and travel, peak limb second difference (body frame) with its
// time, steps after the brake, last foot event, and end residuals. Usage: vite-node scripts/probe/p08-sweep.ts <id regex> [fromS]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { add, len, qConj, qRot, scale, sub, type Vec3 } from '../../src/sim/vec';

const re = new RegExp(process.argv[2]);
const from = Number(process.argv[3] ?? 0);
const names = ['leftAnkle', 'rightAnkle', 'leftKnee', 'rightKnee', 'leftWrist', 'rightWrist', 'leftElbow', 'rightElbow'];
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def);
  const hist: Record<string, Vec3[]> = {};
  let peak = { d: 0, t: 0, k: '' };
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) {
      if (pl.rag || !pl.pose) continue;
      const b = pl.proxy.body; const o = b.translation(); const q = b.rotation(); const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
      for (const n of names) {
        const k = `${pl.id}:${n}`; const p = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], o));
        const h = (hist[k] ??= []); h.push(p); if (h.length > 3) h.shift();
        if (h.length === 3 && sim.t >= from) { const d = len(add(sub(h[2], scale(h[1], 2)), h[0])); if (d > peak.d) peak = { d, t: sim.t, k }; }
      }
    }
  }
  const ev = sim.events.filter((e) => e.type === 'footPlant' || e.type === 'footSwing' || e.type === 'footPlantFailed');
  const fails = ev.filter((e) => e.type === 'footPlantFailed').length;
  const plants = ev.filter((e) => e.type === 'footPlant');
  const last = ev.at(-1);
  const hand = sim.events.filter((e) => /andoff|invalid/.test(e.type)).map((e) => `${e.type}@${e.t.toFixed(2)}`).join(' ');
  console.log(def.id.padEnd(30), String(sim.result).padEnd(10), `peak ${(peak.d * 100).toFixed(1)}cm @${peak.t.toFixed(2)} ${peak.k.slice(2)}`.padEnd(38), `plants ${plants.length} fail ${fails} last ${last?.t.toFixed(2)}`, hand);
  sim.dispose();
}
