// Probe: limb cross-section extents (relative to the bone axis) in a mid-segment slab, per axis direction.
import * as THREE from 'three';
import { accessor, nodeWorld, readGlb } from '../model/glb';
const g = readGlb('models/bew-v6.glb');
const { world, names } = nodeWorld(g);
const jn: string[] = g.json.skins[0].joints.map((i: number) => names[i].replace('mixamorig:', ''));
const prim = g.json.meshes[0].primitives[0];
const P = accessor(g, prim.attributes.POSITION), J = accessor(g, prim.attributes.JOINTS_0), W = accessor(g, prim.attributes.WEIGHTS_0);
const jp = (n: string) => new THREE.Vector3().setFromMatrixPosition(world[names.indexOf('mixamorig:' + n)]);
for (const [bone, child] of [['LeftArm', 'LeftForeArm'], ['LeftForeArm', 'LeftHand'], ['LeftUpLeg', 'LeftLeg'], ['LeftLeg', 'LeftFoot']]) {
  const a = jp(bone), b = jp(child), ab = b.clone().sub(a), l2 = ab.lengthSq();
  const d = ab.clone().normalize();
  // two perpendicular directions: e1 = component of +Z (or +Y for vertical limbs) perpendicular to d
  const ref = Math.abs(d.y) > 0.7 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const e1 = ref.clone().sub(d.clone().multiplyScalar(ref.dot(d))).normalize();
  const e2 = new THREE.Vector3().crossVectors(d, e1);
  for (const [u0, u1] of [[0.3, 0.45], [0.5, 0.65], [0.7, 0.85]]) {
    const s1: number[] = [], s2: number[] = [];
    let n = 0;
    for (let i = 0; i < P.count; i++) {
      const p = new THREE.Vector3(P.data[i * 3], P.data[i * 3 + 1], P.data[i * 3 + 2]);
      const u = p.clone().sub(a).dot(ab) / l2;
      if (u < u0 || u >= u1) continue;
      let bi = 0; for (let k = 1; k < 4; k++) if (W.data[i * 4 + k] > W.data[i * 4 + bi]) bi = k;
      if (jn[J.data[i * 4 + bi]] !== bone) continue;
      const r = p.clone().sub(a.clone().addScaledVector(ab, u));
      s1.push(r.dot(e1)); s2.push(r.dot(e2)); n++;
    }
    const mm = (x: number[]) => `${Math.min(...x).toFixed(3)}..${Math.max(...x).toFixed(3)}`;
    console.log(bone.padEnd(12), `u ${u0}-${u1} n ${n}`, 'e1', mm(s1), 'e2', mm(s2), 'e1=', e1.toArray().map((x) => x.toFixed(2)).join(','));
  }
  console.log(bone, 'a', a.toArray().map((x) => x.toFixed(3)).join(','), 'b', b.toArray().map((x) => x.toFixed(3)).join(','));
}
