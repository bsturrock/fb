// Why does the model-geometry forearm clamp end every substep? Log the post-step final solve around the churn.
import { Simulation } from '../../src/sim/simulation';
import { ArmSystem } from '../../src/sim/arms';
import { g2f5 } from '../../src/sim/fixtures/gate2';
import { balancedVariant } from '../../src/sim/fixtures/gate3';
import { asG4 } from '../../src/sim/fixtures/gate4';
import { asModel } from '../../src/sim/fixtures/model';
const proto = ArmSystem.prototype as any;
const orig = proto.solveArm;
const seg = proto.segmentHit;
let log = false;
let calls: string[] = [];
proto.segmentHit = function (a: any, b: any, r: number, obs: any, tol: number, poses: any) {
  const h = seg.call(this, a, b, r, obs, tol, poses);
  if (log) calls.push(`r${r.toFixed(3)}:${h ? `${h.obstacle.playerId}.${h.obstacle.part}.${h.obstacle.region}@${h.distance.toFixed(4)}` : '-'}`);
  return h;
};
proto.solveArm = function (...args: any[]) {
  calls = [];
  const s = orig.apply(this, args);
  if (log && args[1].side === 'right') console.log(`  solve valid=${s.valid} worst=${s.worst ? `${s.worst.obstacle.part}.${s.worst.obstacle.region}@${s.worst.distance.toFixed(4)}` : '-'} fa=${s.forearmHit ? s.forearmHit.distance.toFixed(4) : 'null'} | ${calls.join(' ')}`);
  return s;
};
const def = asModel(asG4(balancedVariant(g2f5(), 'G4-M'), { id: 'G2-F5', milestone: 'G4-M', title: '' }));
const sim = await Simulation.create(def);
const n0 = sim.events.length;
while (sim.t < 1.49) sim.stepTick();
log = true;
const from = sim.events.length;
for (let i = 0; i < 1; i++) {
  console.log(`tick t=${sim.t.toFixed(4)}`);
  sim.stepTick();
}
log = false;
console.log(sim.events.slice(from).filter((e) => /clamp/.test(e.type)).map((e) => `${e.t}:${e.type}:${JSON.stringify(e.data)}`).join('\n'));
void n0;
