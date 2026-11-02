// SOLVER_G4 justification re-check with self-collision truly off: worst ragdoll joint separation / hinge excursion /
// floor penetration per fixture under 1x1/60 vs 2x1/120 vs 4x1/240 substeps.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
import { SOLVER_G1, SOLVER_G4 } from '../../src/sim/profiles';
const variants = [{ ...SOLVER_G1 }, { ...SOLVER_G4, id: 'x2', substeps: 2 }, SOLVER_G4];
for (const def of gate4Fixtures()) {
  const cells: string[] = [];
  for (const solver of variants) {
    const sim = await Simulation.create({ ...def, solver });
    while (!sim.done) sim.stepTick();
    let sep = 0, over = 0, rev = 0, pen = 0, n = 0, rej = 0;
    for (const pl of sim.players) {
      if (!pl.handoff) continue;
      if (!pl.handoff.accepted) { rej++; continue; }
      const s = pl.ragStats!; n++;
      sep = Math.max(sep, s.maxAnchorErrM); over = Math.max(over, s.maxHingeOverDeg); rev = Math.max(rev, s.maxHingeReverseDeg); pen = Math.max(pen, s.maxFloorPenM);
    }
    cells.push(n || rej ? `${solver.substeps}x: n${n}${rej ? ` rej${rej}` : ''} sep ${(sep * 1000).toFixed(1)} over ${over.toFixed(1)} rev ${rev.toFixed(1)} pen ${(pen * 1000).toFixed(1)} ${sim.result}` : `${solver.substeps}x: - ${sim.result}`);
    sim.dispose();
  }
  console.log(def.id.padEnd(28), cells.join(' | '));
}
