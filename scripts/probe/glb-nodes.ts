// Probe: GLB scene nodes (name, parent, TRS) and world scale per joint.
import * as THREE from 'three';
import { nodeWorld, readGlb } from '../model/glb';
const g = readGlb('models/bew-v6.glb');
const { world, parent, names } = nodeWorld(g);
(g.json.nodes as any[]).forEach((n, i) => {
  const s = new THREE.Vector3();
  world[i].decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  if (i < 6 || n.mesh !== undefined || Math.abs(s.x - 1) > 1e-4) console.log(i, n.name, 'parent', parent[i] !== undefined ? names[parent[i]!] : '-', 'mesh', n.mesh, 'skin', n.skin, 'T', n.translation?.map((x: number) => x.toFixed(3)), 'R', n.rotation?.map((x: number) => x.toFixed(3)), 'S', n.scale, 'worldScale', s.toArray().map((x) => x.toFixed(4)));
});
console.log('scenes', JSON.stringify(g.json.scenes), 'skins', g.json.skins.map((s: any) => ({ skeleton: s.skeleton, n: s.joints.length })));
console.log('materials', JSON.stringify(g.json.materials));
console.log('textures', JSON.stringify(g.json.textures), 'samplers', JSON.stringify(g.json.samplers), 'images', JSON.stringify(g.json.images.map((i: any) => ({ name: i.name, mimeType: i.mimeType }))));
console.log('meshes', JSON.stringify(g.json.meshes.map((m: any) => ({ name: m.name, extras: m.extras, weights: m.weights, prims: m.primitives.map((p: any) => ({ attrs: Object.keys(p.attributes), targets: p.targets?.length, material: p.material })) }))));
