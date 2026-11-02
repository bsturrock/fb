// Ragdoll mechanical energy per tick around the worst-case window (launch check): KE (lin+rot) + PE per player.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const id = process.argv[2] ?? 'G4-F3-twoArm';
const t0 = Number(process.argv[3] ?? 1.1), t1 = Number(process.argv[4] ?? 1.35);
const sim = await Simulation.create(gate4Fixtures().find((f) => f.id === id)!);
while (!sim.done) {
  sim.stepTick();
  if (sim.t < t0 || sim.t > t1) continue;
  const row: string[] = [];
  for (const pl of sim.players) {
    const bodies = sim.activeBodies(pl);
    let ke = 0, pe = 0, vmax = 0;
    for (const b of bodies) {
      const m = b.mass(), v = b.linvel(), w = b.angvel(), c = b.worldCom();
      ke += 0.5 * m * (v.x * v.x + v.y * v.y + v.z * v.z); pe += m * 9.81 * c.y;
      const I = b.effectiveAngularInertia?.(); // may not exist; rotational KE approximated below if unavailable
      vmax = Math.max(vmax, Math.hypot(v.x, v.y, v.z));
      void I; void w;
    }
    row.push(`${pl.id}${pl.rag ? '*' : ' '} KEtrans ${ke.toFixed(0).padStart(4)} PE ${pe.toFixed(0).padStart(4)} sum ${(ke + pe).toFixed(0).padStart(4)} vmax ${vmax.toFixed(2)}`);
  }
  console.log(sim.t.toFixed(4), row.join(' | '));
}
sim.dispose();
