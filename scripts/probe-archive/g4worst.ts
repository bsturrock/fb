// Worst-case drill-down: per-tick joint separation / segment speed for one fixture's ragdolls (default G4-F3-twoArm).
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
import { anchorErrors } from '../../src/sim/ragdoll';
const id = process.argv[2] ?? 'G4-F3-twoArm';
const def = gate4Fixtures().find((f) => f.id === id)!;
const sim = await Simulation.create(def);
const worst: { t: number; pl: string; j: string; e: number }[] = [];
while (!sim.done) {
  sim.stepTick();
  for (const pl of sim.players) {
    if (!pl.rag) continue;
    const ae = anchorErrors(pl.rag);
    const [j, e] = Object.entries(ae).sort((a, b) => b[1] - a[1])[0];
    if (e > 0.008) worst.push({ t: sim.t, pl: pl.id, j, e });
  }
}
for (const w of worst) console.log(w.t.toFixed(4), w.pl, w.j, (w.e * 1000).toFixed(1), 'mm');
console.log(sim.result, sim.ending?.kind, sim.ending?.t);
for (const e of sim.events.filter((e) => ['handoff', 'lossOfSupport', 'gripReleased', 'clampReleased', 'ruleEnding'].includes(e.type))) console.log(e.t.toFixed(4), e.type, e.playerId, JSON.stringify(e.data).slice(0, 160));
sim.dispose();
