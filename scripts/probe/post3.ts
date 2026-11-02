// Post-loss behaviour: grips/clamps, ledger, drive per tick around the loss.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { balancedVariant } from '../../src/sim/fixtures/gate3';
const id = process.argv[2];
const every = Number(process.argv[3] ?? 3);
let def = allFixtures().find((f) => f.id === id);
if (!def && id.endsWith('-balanced')) def = balancedVariant(allFixtures().find((f) => f.id === id.replace(/-balanced$/, ''))!);
const sim = await Simulation.create(def!);
while (!sim.done) {
  sim.stepTick();
  if (sim.tick % every) continue;
  const parts = [sim.t.toFixed(3)];
  for (const pl of sim.players) {
    const a = pl.applied;
    let arm = '';
    for (const side of ['left', 'right'] as const) {
      const f = sim.arms?.lastForce.get(`${pl.id}:${side}`);
      const g = sim.arms?.obs(pl.id)?.[side];
      if (g?.enabled) arm += ` ${side[0]}:${g.gripId ? 'G' : g.clampContactId ? 'C' : '-'}${f ? Math.round(f.actual) : 0}/${f ? Math.round(f.allocated) : 0}`;
      if (g?.gripId) arm += `(L${sim.arms!.grips.get(g.gripId)!.desiredLengthM.toFixed(3)})`;
    }
    parts.push(`${pl.id} ${pl.controlMode[0]}${pl.grounded ? 'g' : 'A'} th ${(pl.balance.theta * 57.3).toFixed(1)} drv ${Math.hypot(a.drive.x, a.drive.z).toFixed(0)}/${a.driveCap.toFixed(0)} tau ${Math.hypot(a.supportTorque.x, a.supportTorque.y, a.supportTorque.z).toFixed(0)}${arm} p(${pl.proxy.body.translation().x.toFixed(2)},${pl.proxy.body.translation().y.toFixed(2)},${pl.proxy.body.translation().z.toFixed(2)})`);
  }
  console.log(parts.join(' | '));
}
for (const e of sim.events.filter((e) => ['lossOfSupport', 'controlMode', 'gripBegin', 'gripRelease', 'clampBegin', 'clampEnd'].includes(e.type))) console.log(e.t, e.type, e.playerId, JSON.stringify(e.data).slice(0, 200));
