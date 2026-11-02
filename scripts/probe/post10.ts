// F10 posture trace: requested/desired/actual lean, deviation, runner progress.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const id = process.argv[2];
const every = Number(process.argv[3] ?? 6);
const def = allFixtures().find((f) => f.id === id)!;
const sim = await Simulation.create(def);
let maxLean = 0;
while (!sim.done) {
  sim.stepTick();
  const D = sim.players.find((p) => p.id === 'D')!;
  const R = sim.players.find((p) => p.id === 'R')!;
  const post = (Math.acos(Math.min(1, D.balance.desiredUp.y)) * 180) / Math.PI;
  maxLean = Math.max(maxLean, (D.balance.theta * 180) / Math.PI);
  if (sim.tick % every) continue;
  const rt = R.proxy.body.translation(), dt = D.proxy.body.translation();
  const rv = R.proxy.body.linvel();
  console.log(`${sim.t.toFixed(2)} D ${D.intent?.debug?.finish ?? ''} post ${post.toFixed(1)} lean ${((D.balance.theta * 180) / Math.PI).toFixed(1)} tau ${D.applied.balanceCapped ? Math.hypot(D.applied.balanceCapped.x, D.applied.balanceCapped.z).toFixed(0) : '-'} | R lean ${((R.balance.theta * 180) / Math.PI).toFixed(1)} drv ${Math.hypot(R.applied.drive.x, R.applied.drive.z).toFixed(0)} v(${rv.x.toFixed(2)},${rv.z.toFixed(2)}) p(${rt.x.toFixed(2)},${rt.z.toFixed(2)}) D p(${dt.x.toFixed(2)},${dt.z.toFixed(2)}) ${sim.arms?.wrap.get('D')?.status}`);
}
console.log('max D lean', maxLean.toFixed(1));
for (const e of sim.events.filter((e) => e.type === 'lossOfSupport')) console.log(e.t, e.playerId, JSON.stringify(e.data).slice(0, 120));
