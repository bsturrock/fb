import { readGlb, accessor, imagePng, texel, nodeWorld } from '../model/glb';
const g = readGlb('models/bew-v6.glb');
const { names } = nodeWorld(g);
const joints = g.json.skins[0].joints.map((i: number) => names[i].replace('mixamorig:', ''));
for (const [mi, imi] of [[0, 0], [1, 1]]) {
  const prim = g.json.meshes[mi].primitives[0];
  const P = accessor(g, prim.attributes.POSITION), UV = accessor(g, prim.attributes.TEXCOORD_0), J = accessor(g, prim.attributes.JOINTS_0), Wt = accessor(g, prim.attributes.WEIGHTS_0);
  const png = imagePng(g, imi);
  const colors = new Map<string, number>();
  const dom = new Map<string, number>();
  const byColorBone = new Map<string, number>();
  for (let i = 0; i < P.count; i++) {
    const c = texel(png, UV.data[i * 2], UV.data[i * 2 + 1]);
    colors.set(c, (colors.get(c) ?? 0) + 1);
    let bi = 0; for (let k = 1; k < 4; k++) if (Wt.data[i * 4 + k] > Wt.data[i * 4 + bi]) bi = k;
    const b = joints[J.data[i * 4 + bi]];
    dom.set(b, (dom.get(b) ?? 0) + 1);
    byColorBone.set(c + ':' + b, (byColorBone.get(c + ':' + b) ?? 0) + 1);
  }
  console.log('mesh', mi, 'colors', [...colors].sort((a, b) => b[1] - a[1]).slice(0, 14));
  console.log('dominant', [...dom].sort((a, b) => b[1] - a[1]));
  console.log('colour:bone', [...byColorBone].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}=${v}`).join(' '));
}
