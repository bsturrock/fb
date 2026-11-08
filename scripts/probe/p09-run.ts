// Plan 09 review: one joint's envelope state over a fall, each limit apart (fixture id and joint id as arguments).
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
import { envelopeMoments, rangeTwistRad, relativeOmega, swingTwistOf } from '../../src/sim/ragdoll';
import { len, qConj, qMul } from '../../src/sim/vec';
const [id, joint, pid] = [process.argv[2], process.argv[3], process.argv[4] ?? 'R'];
const def = fallFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, { trace: false });
const deg = (r: number): number => (r * 180) / Math.PI;
while (!sim.done) {
  sim.stepTick();
  const rag = sim.players.find((p) => p.id === pid)!.rag;
  const e = rag?.envelope?.find((x) => x.jointId === joint);
  if (!rag || !e || e.overDeg < 2) continue;
  const j = rag.joints.find((x) => x.id === joint)!;
  const E = j.kind === 'hip' ? rag.profile.envelope!.hip : rag.profile.envelope!.shoulder;
  const q = qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation());
  const st = swingTwistOf(q);
  const M = envelopeMoments(E, q, j.sideSign!, e, { x: 0, y: 0, z: 0 });
  console.log(`t${sim.t.toFixed(3)} over ${e.overDeg.toFixed(1)} run ${e.overRunS.toFixed(3)} swingEx ${deg(M.swing.excess).toFixed(1)} hiEx ${deg(M.hi.excess).toFixed(1)} loEx ${deg(M.lo.excess).toFixed(1)} swing ${deg(st.swingRad).toFixed(0)} tw ${deg(rangeTwistRad(E, st.twistRad, j.sideSign!)).toFixed(0)} |tq| ${len(e.torque).toFixed(0)} |w| ${len(relativeOmega(rag, j)).toFixed(1)} slack ${deg(e.swingSlack + e.twistSlackHi + e.twistSlackLo).toFixed(1)}`);
}
sim.dispose();
