// Gate 3 balance probe: vite-node scripts/probe/bal.ts <fixtureId|f2:<deg>[:radius]> [every]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import * as G3 from '../../src/sim/fixtures/gate3';
import { upperBodyCompound } from '../../src/sim/profiles';

const arg = process.argv[2] ?? 'G3-F2';
const every = Number(process.argv[3] ?? 6);
let def = allFixtures().find((f) => f.id === arg);
if (!def && arg.startsWith('f2:')) {
  const [, d, r] = arg.split(':');
  def = G3.g3f2(Number(d));
  if (r) for (const p of def.players) p.body = { ...upperBodyCompound(), supportRadiusM: Number(r) };
}
if (!def) throw new Error('no fixture ' + arg);
const sim = await Simulation.create(def);
for (const pl of sim.players) console.log(pl.id, 'mass', pl.mass.massKg.toFixed(2), 'localCom', JSON.stringify(pl.mass.localCom), 'I', JSON.stringify(pl.mass.principalInertia));
const rows: string[] = [];
const each = () => {
  if (sim.tick % every !== 0) return;
  const parts = [sim.t.toFixed(3)];
  for (const pl of sim.players) {
    const a = pl.applied;
    parts.push(`${pl.id} ${pl.controlMode[0]}${pl.grounded ? 'g' : 'A'} lean ${(pl.balance.theta * 57.2958).toFixed(2)} rate ${pl.balance.outwardRate.toFixed(3)} proj ${(pl.balance.projected * 57.2958).toFixed(1)} tauReq ${Math.hypot(a.balanceRequested.x, a.balanceRequested.z).toFixed(0)} cap ${a.balanceCap.toFixed(0)} tau ${Math.hypot(a.supportTorque.x, a.supportTorque.z).toFixed(0)} y ${pl.proxy.body.translation().y.toFixed(3)} vx ${pl.proxy.body.linvel().x.toFixed(2)} drv ${Math.hypot(a.drive.x, a.drive.z).toFixed(0)}/${a.driveCap.toFixed(0)}`);
  }
  rows.push(parts.join(' | '));
};
each();
while (!sim.done) {
  sim.stepTick();
  each();
}
console.log(rows.join('\n'));
for (const e of sim.events.filter((e) => !['grounded'].includes(e.type))) console.log(e.t, e.type, e.playerId ?? '', JSON.stringify(e.data));
