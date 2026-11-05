// Probe: limb radius distribution along each bone axis (bone-dominant vertices), to choose the fit window.
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
  const bins: number[][] = Array.from({ length: 10 }, () => []);
  const binsW: number[][] = Array.from({ length: 10 }, () => []);
  for (let i = 0; i < P.count; i++) {
    const p = new THREE.Vector3(P.data[i * 3], P.data[i * 3 + 1], P.data[i * 3 + 2]);
    const u = p.clone().sub(a).dot(ab) / l2;
    if (u < 0 || u >= 1) continue;
    const r = p.clone().sub(a.clone().addScaledVector(ab, u)).length();
    if (r > 0.25) continue;
    let bi = 0; for (let k = 1; k < 4; k++) if (W.data[i * 4 + k] > W.data[i * 4 + bi]) bi = k;
    const dom = jn[J.data[i * 4 + bi]];
    // any vertex with weight > 0.5 on the bone, or dominant
    let w = 0; for (let k = 0; k < 4; k++) if (jn[J.data[i * 4 + k]] === bone) w += W.data[i * 4 + k];
    if (dom === bone) bins[Math.floor(u * 10)].push(r);
    if (w > 0.9) binsW[Math.floor(u * 10)].push(r);
  }
  const med = (x: number[]) => { const s = [...x].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)].toFixed(3) : '-'; };
  console.log(bone.padEnd(12), 'dominant', bins.map((x) => `${med(x)}(${x.length})`).join(' '));
  console.log(''.padEnd(12), 'w>0.9   ', binsW.map((x) => `${med(x)}(${x.length})`).join(' '));
}
