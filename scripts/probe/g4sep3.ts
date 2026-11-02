// Probe: joint separation vs ragdoll CCD settings.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
import { anchorErrors } from '../../src/sim/ragdoll';
for (const [ccd, soft] of [[true, 0.3], [false, 0.3], [false, 0], [true, 0]] as const) {
  for (const def of gate4Fixtures().filter((d) => /F1|F2/.test(d.id))) {
    const sim = await Simulation.create(def);
    let worst = 0, worstJ = '';
    for (;;) {
      sim.stepTick();
      const r = sim.players[0].rag;
      if (r && !(r as any)._patched) {
        for (const b of Object.values(r.bodies)) { b.enableCcd(ccd); b.setSoftCcdPrediction(soft); }
        (r as any)._patched = true;
      }
      if (r) for (const [j, m] of Object.entries(anchorErrors(r))) if (m > worst) { worst = m; worstJ = j; }
      if (sim.result !== 'running' || sim.t >= def.durationS - 1e-9) break;
    }
    console.log(`ccd ${ccd} soft ${soft}`, def.id.padEnd(22), 'worst', (worst * 1000).toFixed(1), worstJ, 'pen', ((sim.players[0].ragStats?.maxFloorPenM ?? 0) * 1000).toFixed(1));
    sim.dispose();
  }
}
