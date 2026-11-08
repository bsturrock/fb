// Plan 07 probe: RH-F6-oneArm defender legs before the late conversion: probe status / ground used by the legs, hip,
// ankle request and achieved ankle, knee angle, frames' relative twist vs the published hinge angle.
import { Simulation } from '../../src/sim/simulation';
import { rhf6 } from '../../src/sim/fixtures/ride-height';
import { poseProbe } from '../../src/sim/debug';
const PROBE = poseProbe({ on: true });
import { qConj, qMul } from '../../src/sim/vec';
import { twistX } from '../../src/sim/ragdoll';

const def = rhf6().find((d) => d.id === (process.argv[2] ?? 'RH-F6-oneArm'))!;
const pid = process.argv[3] ?? 'D';
const from = Number(process.argv[4] ?? 1.3);
const sim = await Simulation.create(def, { debug: { poseProbe: PROBE } });
const f = (x: number) => x.toFixed(3);
while (!sim.done && sim.t < 1.52) {
  sim.stepTick();
  const D = sim.players.find((p) => p.id === pid)!;
  if (sim.t < from || !D.pose || D.rag) continue;
  const pr = D.sus!.probe;
  const lm = D.pose.jointLandmarksWorld;
  const s = 'right';
  const dbg = PROBE.legs[`${pid}:${s}`];
  const rel = qMul(qConj(D.pose.segments.rightThigh.rotationWorld), D.pose.segments.rightShin.rotationWorld);
  console.log(
    sim.t.toFixed(4), D.controlMode, pr.status, pr.surface, 'gy', f(pr.groundY), 'h', f(pr.heightM),
    'root', f(D.proxy.body.translation().y), 'lean', (D.balance.theta * 57.3).toFixed(1),
    'hipR', f(lm.rightHip.y), 'ankR', f(lm.rightAnkle.y), 'req', dbg ? f(dbg.request.y) : '-', 'knee', D.pose.hingeDeg.rightKnee.toFixed(1), 'twist', (twistX(rel) * 57.2958).toFixed(1),
    'leftKnee', D.pose.hingeDeg.leftKnee.toFixed(1), 'hipL', f(lm.leftHip.y),
  );
}
