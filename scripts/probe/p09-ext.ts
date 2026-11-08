// Plan 09 review: per joint, the speed change along the applied torque that the torque itself does not explain.
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
import { FallResponse } from '../../src/sim/fall-response';
import { relativeOmega } from '../../src/sim/ragdoll';
import { dot, len, scale, sub } from '../../src/sim/vec';
const [id, joint, from, to] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5]];
const def = fallFixtures().find((d) => d.id === id)!;
const orig = FallResponse.prototype.audit;
FallResponse.prototype.audit = function (ep) {
  for (const { entry, cmd } of ep.applied) {
    if (cmd.joint.id !== joint || entry.step < from || entry.step > to) continue;
    const wPost = relativeOmega(ep.rag, cmd.joint);
    const u = entry.appliedNm > 0 ? scale(entry.onChild, 1 / entry.appliedNm) : wPost;
    const own = (entry.appliedNm * this.host.dt) / cmd.inertia;
    console.log(`s${entry.step} ${cmd.task ?? ''} ${entry.appliedNm.toFixed(1)}Nm pre ${dot(cmd.wPre, u).toFixed(2)} post ${dot(wPost, u).toFixed(2)} own ${own.toFixed(2)} ext ${(dot(sub(wPost, cmd.wPre), u) - own).toFixed(2)} |dw| ${len(sub(wPost, cmd.wPre)).toFixed(2)} pred ${entry.predictedW.toFixed(1)}`);
  }
  return orig.call(this, ep);
};
const sim = await Simulation.create(def, { trace: false });
sim.runToEnd();
sim.dispose();
