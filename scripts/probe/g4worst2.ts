// When does each ragdoll's substep-level max joint separation grow (ragStats is sampled every substep)?
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const id = process.argv[2] ?? 'G4-F3-twoArm';
const sim = await Simulation.create(gate4Fixtures().find((f) => f.id === id)!);
const last = new Map<string, number>();
while (!sim.done) {
  sim.stepTick();
  for (const pl of sim.players) {
    const s = pl.ragStats; if (!s) continue;
    if (s.maxAnchorErrM > (last.get(pl.id) ?? 0) + 0.002) {
      console.log(sim.t.toFixed(4), pl.id, 'max sep', (s.maxAnchorErrM * 1000).toFixed(1), 'mm  vmax', s.maxSpeed.toFixed(2), ' contacts:', sim.contacts.filter((c) => (c.a.playerId === pl.id || c.b.playerId === pl.id)).map((c) => `${c.a.playerId ?? ''}:${c.a.region}-${c.b.playerId ?? ''}:${c.b.region}`).join(' '));
      last.set(pl.id, s.maxAnchorErrM);
    }
  }
}
console.log(sim.events.filter((e) => /handoff|ragdoll|convert/i.test(e.type)).map((e) => `${e.t.toFixed(4)} ${e.type} ${e.playerId}`).join('\n'));
sim.dispose();
