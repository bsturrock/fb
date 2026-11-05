// Probe: per-bone rotation mismatch (rad) between segment x correction and the posed bone world rotation, over a run.
import * as THREE from 'three';
import { glbScene } from '../model/glb-scene';
import { cloneRig, RigAdapter, RIG_MAP } from '../../src/lab/rig-adapter';
import { MODEL_CALIBRATION } from '../../src/sim/model/profiles';
import { Simulation } from '../../src/sim/simulation';
import { modelFixtures } from '../../src/sim/fixtures/model';
const { scene } = glbScene();
const rig = cloneRig(scene);
rig.root.updateMatrixWorld(true);
const ad = new RigAdapter(rig.bones, MODEL_CALIBRATION);
const sim = await Simulation.create(modelFixtures().find((f) => f.id === 'G4-F4-simultaneous-M')!);
const rot = (mx: THREE.Matrix4): THREE.Quaternion => { const r = new THREE.Quaternion(); mx.decompose(new THREE.Vector3(), r, new THREE.Vector3()); return r; };
const worst: Record<string, { a: number; t: number; rep: string; id: string }> = {};
while (!sim.done) {
  sim.stepTick();
  for (const pl of sim.players) {
    const pose = pl.pose!;
    ad.apply(pose);
    rig.root.updateMatrixWorld(true);
    for (const m of RIG_MAP) {
      const q = pose.segments[m.segment].rotationWorld;
      const want = new THREE.Quaternion(q.x, q.y, q.z, q.w).multiply(rot(ad.correction(m.bone)));
      const a = 2 * Math.acos(Math.min(1, Math.abs(want.dot(rot(rig.bones[m.bone].matrixWorld)))));
      if (!worst[m.bone] || a > worst[m.bone].a) worst[m.bone] = { a, t: sim.t, rep: pl.representation, id: pl.id };
    }
  }
}
for (const [b, w] of Object.entries(worst)) console.log(b.padEnd(12), w.a.toExponential(2), w.t.toFixed(3), w.rep, w.id);
