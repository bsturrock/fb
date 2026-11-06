// Plan 07 probe (L2-F15): loaded player. Per tick for the carrier B: applied/commanded support force (BW), split,
// saturation, guard, probe; the A-B contact normal impulse rate (contact load, N); B's lean and balance torque; A's
// probe status and support force (must be 0 while obstructed/falling). Usage: vite-node scripts/probe/p07-loaded.ts [id]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const id = process.argv[2] ?? 'L2-F15-playerBelow';
const every = Number(process.argv[3] ?? 3);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const W = 981;
let maxA = 0;
let satB = 0;
let botB = 0;
let peakLoad = 0;
const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : String(x));
while (!sim.done) {
  sim.stepTick();
  const A = sim.players.find((p) => p.id === 'A')!;
  const B = sim.players.find((p) => p.id === 'B')!;
  // contact load: normal impulse between A and B in the last substep over the substep length
  let imp = 0;
  for (const c of sim.contacts) if ((c.a.playerId === 'A' && c.b.playerId === 'B') || (c.a.playerId === 'B' && c.b.playerId === 'A')) for (const p of c.points) imp += p.impulse ?? 0;
  const load = imp / sim.physics.dt;
  peakLoad = Math.max(peakLoad, load);
  if (A.sus) maxA = Math.max(maxA, A.sus.appliedN);
  const s = B.sus!;
  if (s.saturated === 'max') satB++;
  if (s.bottomed) botB++;
  if (sim.tick % every === 0)
    console.log(
      `${f(sim.t)} A ${A.rag ? 'rag' : A.controlMode} ${A.sus?.probe.status ?? '-'} F ${f(A.sus?.appliedN ?? 0, 0)} | B h ${f(s.probe.heightM)} F ${f(s.appliedN / W, 2)}BW Fc ${f(s.commandedN / W, 2)} Fp ${f(s.pivotN / W, 2)} Fm ${f(s.comN / W, 2)} sat ${s.saturated} bot ${s.bottomed ? 1 : 0} ${s.probe.status} lean ${f((B.balance.theta * 180) / Math.PI, 1)} tauB ${f(Math.hypot(B.applied.supportTorque.x, B.applied.supportTorque.z), 0)} | contact ${f(load, 0)} N`,
    );
}
console.log(`result ${sim.summary().result}; A max support force while not valid-supported ${f(maxA, 1)} N; B saturated ${satB} ticks, bottomed ${botB}; peak A-B contact load ${f(peakLoad, 0)} N (${f(peakLoad / W, 2)} BW)`);
for (const e of sim.events) if (['lossOfSupport', 'handoffRejected', 'representation', 'controlMode', 'supportProbe'].includes(e.type)) console.log(`  ${f(e.t)} ${e.type}@${e.playerId} ${JSON.stringify(e.data).slice(0, 160)}`);
