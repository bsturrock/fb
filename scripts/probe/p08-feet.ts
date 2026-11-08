// Plan 08 probe: why feet step in a fixture: release reasons and step reasons per player over a window, speed and body sway.
// Usage: vite-node scripts/probe/p08-feet.ts <fixture id> [from] [to]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const [id, from, to] = process.argv.slice(2);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, { transitionAudit: true });
const a = Number(from ?? 0); const b = Number(to ?? 99);
let n = 0;
while (!sim.done) {
  sim.stepTick();
  if (sim.t >= a && sim.t <= b && n++ % 30 === 0) for (const pl of sim.players) {
    if (pl.rag) continue;
    const v = pl.proxy.body.linvel(); const w = pl.proxy.body.angvel(); const p = pl.proxy.body.translation();
    console.log(sim.t.toFixed(2), pl.id, 'p', p.x.toFixed(2), p.z.toFixed(2), 'v', Math.hypot(v.x, v.z).toFixed(2), 'wy', w.y.toFixed(2), 'loco', pl.loco?.mode, 'L', pl.feet?.feet.left.mode, 'R', pl.feet?.feet.right.mode);
  }
}
for (const e of sim.events.filter((x) => (x.type === 'footSwing' || x.type === 'footRelease') && x.t >= a && x.t <= b)) console.log(e.t.toFixed(3), e.playerId, e.type, JSON.stringify(e.data).slice(0, 100));
sim.dispose();
