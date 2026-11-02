// Probe: joint separation / hinge overshoot vs outer substeps and iterations.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
import { anchorErrors, hingeAngles } from '../../src/sim/ragdoll';
for (const [sub, it] of [[1, 4], [2, 4], [4, 4], [2, 8], [4, 2]] as const) {
  for (const def of gate4Fixtures().filter((d) => /F1|F2/.test(d.id))) {
    def.solver = { ...def.solver, substeps: sub, solverIterations: it };
    const sim = await Simulation.create(def);
    let worst = 0, worstJ = '', over = 0;
    for (;;) {
      sim.stepTick();
      const r = sim.players[0].rag;
      if (r) {
        for (const [j, m] of Object.entries(anchorErrors(r))) if (m > worst) { worst = m; worstJ = j; }
        const h = hingeAngles(r);
        for (const jj of r.joints) if (jj.limitsRad) {
          const a = (h[jj.id] * Math.PI) / 180;
          over = Math.max(over, ((jj.limitsRad[0] - a) * 180) / Math.PI, ((a - jj.limitsRad[1]) * 180) / Math.PI);
        }
      }
      if (sim.result !== 'running' || sim.t >= def.durationS - 1e-9) break;
    }
    console.log(`sub${sub} it${it}`, def.id.padEnd(22), 'sep', (worst * 1000).toFixed(1), worstJ.padEnd(13), 'limitOver', over.toFixed(1), 'deg pen', ((sim.players[0].ragStats?.maxFloorPenM ?? 0) * 1000).toFixed(1));
    sim.dispose();
  }
}
