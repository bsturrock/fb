import { Simulation } from '../../src/sim/simulation';
import { asL4, tippedFall } from '../../src/sim/fixtures/falls';
import { externalTwistRad, relativeOmega, swingExcess, swingTwistOf } from '../../src/sim/ragdoll';
import { qConj, qMul, len, dot } from '../../src/sim/vec';
const def = asL4(tippedFall({ id: 'x', dir: 'back', role: 'runner' }), 'x', 't');
const sim = await Simulation.create(def, { trace: false });
const deg = (r: number) => (r * 180) / Math.PI;
let prev = 0;
for (let i = 0; i < 180; i++) {
  sim.stepTick();
  const rag = sim.players[0].rag;
  if (!rag?.envelope) continue;
  const e = rag.envelope.find((x) => x.jointId === 'leftShoulder')!;
  const j = rag.joints.find((x) => x.id === 'leftShoulder')!;
  const E = rag.profile.envelope!.shoulder;
  const st = swingTwistOf(qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation()));
  const lim = st.swingRad - swingExcess(E, st.dir, j.sideSign!).rad;
  const az = deg(Math.atan2(st.dir.x * j.sideSign!, st.dir.z));
  const w = relativeOmega(rag, j);
  const tw = deg(externalTwistRad(E, st.twistRad, j.sideSign!));
  const dJ = e.passivePositiveJ - prev;
  prev = e.passivePositiveJ;
  if (e.passivePositiveJ > 0 && (dJ > 0.2 || i % 6 === 0))
    console.log(`t${sim.t.toFixed(3)} swing ${deg(st.swingRad).toFixed(1)} lim ${deg(lim).toFixed(1)} az ${az.toFixed(0)} tw ${tw.toFixed(1)} slack ${deg(e.swingSlack).toFixed(1)} |tq| ${len(e.torque).toFixed(0)} |w| ${len(w).toFixed(1)} P ${dot(e.torque, w).toFixed(0)} +J ${e.passivePositiveJ.toFixed(1)} -J ${e.passiveNegativeJ.toFixed(1)}`);
}
sim.dispose();
