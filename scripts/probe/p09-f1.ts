import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
import { externalTwistRad, relativeOmega, swingExcess, swingTwistOf } from '../../src/sim/ragdoll';
import { len, qConj, qMul } from '../../src/sim/vec';
const deg = (r: number) => (r * 180) / Math.PI;
const sim = await Simulation.create(fallFixtures().find((d) => d.id === process.argv[2])!, { trace: false });
const name = process.argv[3];
for (let i = 0; !sim.done; i++) {
  sim.stepTick();
  const rag = sim.players[0].rag;
  if (!rag?.envelope || i % 12) continue;
  const e = rag.envelope.find((x) => x.jointId === name)!;
  const j = rag.joints.find((x) => x.id === name)!;
  const E = (j.kind === 'hip' ? rag.profile.envelope!.hip : rag.profile.envelope!.shoulder)!;
  const st = swingTwistOf(qMul(qConj(rag.bodies[j.parent].rotation()), rag.bodies[j.child].rotation()));
  console.log(`t${sim.t.toFixed(2)} dir ${st.dir.x.toFixed(2)},${st.dir.y.toFixed(2)},${st.dir.z.toFixed(2)} swing ${deg(st.swingRad).toFixed(1)} ex ${deg(swingExcess(E, st.dir, j.sideSign!).rad).toFixed(1)} tw ${deg(externalTwistRad(E, st.twistRad, j.sideSign!)).toFixed(1)} |tq| ${len(e.torque).toFixed(1)} |w| ${len(relativeOmega(rag, j)).toFixed(2)} over ${e.overDeg.toFixed(1)}/${e.maxOverDeg.toFixed(1)} +J ${e.passivePositiveJ.toFixed(1)} -J ${e.passiveNegativeJ.toFixed(1)}`);
}
sim.dispose();
