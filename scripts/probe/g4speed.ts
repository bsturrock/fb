// Peak segment speed per ragdoll body with time (where does the fixture's maximum come from?).
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const id = process.argv[2] ?? 'G4-F3-twoArm';
const sim = await Simulation.create(gate4Fixtures().find((f) => f.id === id)!);
let best = { v: 0, t: 0, seg: '', pl: '' };
let entry = new Map<string, number>();
while (!sim.done) {
  sim.stepTick();
  for (const pl of sim.players) {
    if (!pl.rag) continue;
    if (!entry.has(pl.id)) { entry.set(pl.id, sim.t); const v = Object.values(pl.rag.bodies).map((b) => Math.hypot(b.linvel().x, b.linvel().y, b.linvel().z)); console.log('entry', pl.id, sim.t.toFixed(4), 'max seg v', Math.max(...v).toFixed(2)); }
    for (const [sid, b] of Object.entries(pl.rag.bodies)) { const l = b.linvel(); const v = Math.hypot(l.x, l.y, l.z); if (v > best.v) best = { v, t: sim.t, seg: sid, pl: pl.id }; }
  }
}
console.log('peak (tick-end)', best.pl, best.seg, best.v.toFixed(2), 'm/s at', best.t.toFixed(4), ' ragStats vmax', sim.players.map((p) => p.ragStats?.maxSpeed.toFixed(2)).join(','));
sim.dispose();
