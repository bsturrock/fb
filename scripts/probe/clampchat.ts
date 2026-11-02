// Count clamp begin/end events for a Gate 3 wrap fixture at substeps 1/2/4.
import { Simulation } from '../../src/sim/simulation';
import * as G3 from '../../src/sim/fixtures/gate3';
for (const sub of [1, 2, 4]) {
  for (const mk of [() => G3.g3f9(false), () => G3.g3f10(12)]) {
    const def = mk();
    def.solver = { ...def.solver, substeps: sub };
    const sim = await Simulation.create(def);
    sim.runToEnd();
    const ends = sim.events.filter((e) => e.type === 'clampEnd');
    const reasons: Record<string, number> = {};
    for (const e of ends) reasons[String(e.data!.reason)] = (reasons[String(e.data!.reason)] ?? 0) + 1;
    const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
    console.log('sub', sub, def.id.padEnd(18), 'clampEnd', ends.length, JSON.stringify(reasons), 'wrap', ws.join(','), 'loss', sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => e.playerId + '@' + e.t.toFixed(2)).join(','));
    sim.dispose();
  }
}
