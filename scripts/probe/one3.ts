import { Simulation } from '../../src/sim/simulation';
import * as G3 from '../../src/sim/fixtures/gate3';
const [v, lean, every] = (process.argv[2] ?? '1.5,12,3').split(',').map(Number);
const sim = await Simulation.create(G3.g3f3Collision(v, 'x', lean));
const pr = () => {
  const out = [sim.t.toFixed(3)];
  for (const pl of sim.players) {
    const a = pl.applied;
    const b = pl.proxy.body;
    out.push(`${pl.id} ${pl.controlMode[0]}${pl.grounded ? 'g' : 'A'} th ${(pl.balance.theta * 57.3).toFixed(1)} r ${pl.balance.outwardRate.toFixed(2)} req ${Math.hypot(a.balanceRequested.x, a.balanceRequested.z).toFixed(0)} tau ${Math.hypot(a.supportTorque.x, a.supportTorque.z).toFixed(0)} vz ${b.linvel().z.toFixed(2)} w ${b.angvel().x.toFixed(2)} drv ${a.drive.z.toFixed(0)} up(${pl.balance.desiredUp.z.toFixed(3)})`);
  }
  console.log(out.join(' | '));
};
while (!sim.done && sim.t < 2.5) {
  sim.stepTick();
  if (sim.tick % every === 0) pr();
}
