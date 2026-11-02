// Probe: ragdoll joint separation vs solver iterations (F2 cases).
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
import { anchorErrors } from '../../src/sim/ragdoll';
for (const iters of [4, 8, 16]) {
  for (const pgs of [1, 2]) {
    for (const def of gate4Fixtures().filter((d) => /F1|F2/.test(d.id))) {
      def.solver = { ...def.solver, solverIterations: iters };
      const sim = await Simulation.create(def);
      sim.physics.world.numInternalPgsIterations = pgs;
      let worst = 0, worstT = 0, last = 0;
      for (;;) {
        sim.stepTick();
        const r = sim.players[0].rag;
        if (r) {
          const m = Math.max(...Object.values(anchorErrors(r)));
          if (m > worst) { worst = m; worstT = sim.t; }
          last = m;
        }
        if (sim.result !== "running" || sim.t >= def.durationS - 1e-9) break;
      }
      console.log(`it${iters} pgs${pgs}`, def.id.padEnd(22), 'worst', (worst * 1000).toFixed(1), 'mm @', worstT.toFixed(2), 'final', (last * 1000).toFixed(2), 'mm', 'pen', ((sim.players[0].ragStats?.maxFloorPenM ?? 0) * 1000).toFixed(1));
      sim.dispose();
    }
  }
}
