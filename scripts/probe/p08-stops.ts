// Plan 08 closeout probe: the stop report of the full-stop cases: brake to rest, distance, last step, coverage, failed plants, support load, end.
// Usage: vite-node scripts/probe/p08-stops.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2] ?? '^L3-F16-|^L3-F14-walkRun');
console.log('fixture                         brake  speed0 restT  dist  lastStep fails attempts cov%   load  endX   endSpeed end');
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def);
  const ctl = def.players[0].controller;
  const segs = ctl.kind === 'script' ? ctl.segments : [];
  const brake = [...segs].reverse().find((g) => g.velocity && Math.hypot(g.velocity.x, g.velocity.z) < 0.01 && g.fromS > 0.2)?.fromS ?? null;
  let v0 = 0;
  let x0 = 0;
  let rest: number | null = null;
  let distM = 0;
  let load = 0;
  let endT = 0;
  while (!sim.done) {
    sim.stepTick();
    const R = sim.players[0];
    endT = sim.t;
    if (R.rag) break;
    const p = R.proxy.body.translation();
    const v = R.proxy.body.linvel();
    const s = Math.hypot(v.x, v.z);
    if (brake !== null && sim.t <= brake + 1e-9) { v0 = s; x0 = p.x; }
    if (brake !== null && sim.t > brake) {
      if (rest === null && s < 0.05) { rest = sim.t; distM = Math.abs(p.x - x0); }
      if (s >= 0.05) rest = null;
    }
    load = Math.max(load, R.sus?.appliedN ?? 0);
  }
  const R = sim.players[0];
  const st = R.feet!.stats;
  const steps = sim.events.filter((e) => e.type === 'footPlant' && e.playerId === R.id);
  const last = steps.length ? steps[steps.length - 1].t : -1;
  const p = R.rag ? { x: NaN } : R.proxy.body.translation();
  const v = R.rag ? { x: NaN, z: NaN } : R.proxy.body.linvel();
  const c = st.cover;
  const el = c.left.eligibleS + c.right.eligibleS;
  const cov = el > 0 ? (100 * (c.left.plantedS + c.right.plantedS)) / el : 0;
  console.log(`${def.id.padEnd(30)} ${(brake ?? -1).toFixed(2).padStart(6)} ${v0.toFixed(2).padStart(6)} ${rest === null ? '  none' : rest.toFixed(2).padStart(6)} ${distM.toFixed(2).padStart(5)} ${last.toFixed(3).padStart(8)} ${String(st.failed).padStart(5)} ${String(st.attempts).padStart(6)} ${cov.toFixed(1).padStart(6)} ${load.toFixed(0).padStart(5)} ${p.x.toFixed(2).padStart(7)} ${Math.hypot(v.x, v.z).toFixed(3).padStart(7)} ${endT.toFixed(2)} of ${def.durationS}`);
  sim.dispose();
}
