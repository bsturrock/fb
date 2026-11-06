// Plan 07 probe: largest supported-pose (proxy) hinge angles per fixture against the ragdoll limits, and every
// hingeLimit candidate rejection. Usage: vite-node scripts/probe/p07-hinge-sweep.ts [fixture id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { RAGDOLL_G4 } from '../../src/sim/profiles';

const re = process.argv[2] ? new RegExp(process.argv[2]) : null;
const t0 = Date.now();
let n = 0;
for (const def of allFixtures()) {
  if (re && !re.test(def.id)) continue;
  const sim = await Simulation.create(def, { trace: false });
  const L = (def.ragdoll ?? RAGDOLL_G4).limitsDeg;
  let knee = 0;
  let elbow = 0;
  let kAt = '';
  let eAt = '';
  while (!sim.done) {
    sim.stepTick();
    for (const p of sim.players) {
      if (p.rag || !p.pose) continue;
      for (const s of ['left', 'right']) {
        if (p.pose.hingeDeg[`${s}Knee`] > knee) { knee = p.pose.hingeDeg[`${s}Knee`]; kAt = `${p.id}:${s}@${sim.t.toFixed(3)}`; }
        if (p.pose.hingeDeg[`${s}Elbow`] > elbow) { elbow = p.pose.hingeDeg[`${s}Elbow`]; eAt = `${p.id}:${s}@${sim.t.toFixed(3)}`; }
      }
    }
  }
  const rej = sim.events.filter((e) => e.type === 'handoffRejected' && String((e.data as { reasons: string }).reasons).includes('hingeLimit')).map((e) => `${e.playerId}@${e.t}`);
  const flag = knee > L.knee[1] || elbow > L.elbow[1] ? ' OVER' : '';
  console.log(`${def.id.padEnd(40)} knee ${knee.toFixed(1)} (${kAt}) elbow ${elbow.toFixed(1)} (${eAt})${flag}${rej.length ? ` hingeLimit ${rej.join(',')}` : ''}`);
  sim.dispose();
  n++;
}
console.log(`${n} fixtures, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
