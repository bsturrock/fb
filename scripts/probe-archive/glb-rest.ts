// Probe: world-space rest joints of a GLB (node transforms), bone axes, and bind/rest agreement.
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
const buf = readFileSync(process.argv[2] ?? 'models/bew-v6.glb');
const jl = buf.readUInt32LE(12);
const json = JSON.parse(buf.subarray(20, 20 + jl).toString());
const binStart = 20 + jl + 8;
const bin = buf.subarray(binStart);
const nodes = json.nodes as any[];
const parent = new Map<number, number>();
nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => parent.set(c, i)));
const local = nodes.map((n) => {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(...(n.translation ?? [0, 0, 0])), new THREE.Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new THREE.Vector3(...(n.scale ?? [1, 1, 1])));
  return m;
});
const world: THREE.Matrix4[] = [];
const W = (i: number): THREE.Matrix4 => {
  if (world[i]) return world[i];
  const p = parent.get(i);
  world[i] = p === undefined ? local[i].clone() : W(p).clone().multiply(local[i]);
  return world[i];
};
const f = (v: THREE.Vector3) => `(${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)})`;
nodes.forEach((n, i) => {
  if (!n.name.startsWith('mixamorig')) return;
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  W(i).decompose(p, q, s);
  const ax = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(q);
  console.log(n.name.replace('mixamorig:', '').padEnd(18), f(p), 'Y', f(ax(0, 1, 0)), 'X', f(ax(1, 0, 0)));
});
// inverse bind matrices vs world rest
const skin = json.skins[0];
const acc = json.accessors[skin.inverseBindMatrices];
const bv = json.bufferViews[acc.bufferView];
const arr = new Float32Array(bin.buffer, bin.byteOffset + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0), acc.count * 16);
let maxErr = 0;
skin.joints.forEach((j: number, k: number) => {
  const ibm = new THREE.Matrix4().fromArray(arr, k * 16);
  const prod = W(j).clone().multiply(ibm);
  const id = new THREE.Matrix4();
  for (let e = 0; e < 16; e++) maxErr = Math.max(maxErr, Math.abs(prod.elements[e] - id.elements[e]));
});
console.log('max |world*IBM - I| =', maxErr.toExponential(3), 'joints', skin.joints.length, 'skeleton root', skin.skeleton);
