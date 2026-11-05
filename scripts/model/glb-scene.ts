// Node-side Three.js scene from the committed GLB (tests only; the lab uses GLTFLoader): node hierarchy with rest TRS,
// bones, and the skinned meshes with positions, skin attributes, morph targets and default weights, bound with the
// file's inverse bind matrices the way GLTFLoader binds them. No textures or materials beyond a placeholder.
import * as THREE from 'three';
import { accessor, readGlb, type GlbFile } from './glb';

export function glbScene(path = 'models/bew-v6.glb'): { scene: THREE.Group; glb: GlbFile } {
  const g = readGlb(path);
  const nodes = g.json.nodes as any[];
  const skin = g.json.skins[0];
  const jointSet = new Set<number>(skin.joints);
  const objs: THREE.Object3D[] = nodes.map((n, i) => {
    const o = jointSet.has(i) ? new THREE.Bone() : new THREE.Object3D();
    // GLTFLoader's node naming (PropertyBinding.sanitizeNodeName: 'mixamorig:Hips' -> 'mixamorigHips')
    o.name = THREE.PropertyBinding.sanitizeNodeName(n.name);
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  nodes.forEach((n, i) => (n.children ?? []).forEach((c: number) => objs[i].add(objs[c])));
  const scene = new THREE.Group();
  for (const r of g.json.scenes[0].nodes as number[]) scene.add(objs[r]);
  scene.updateMatrixWorld(true);
  const ibm = accessor(g, skin.inverseBindMatrices);
  const bones = (skin.joints as number[]).map((j) => objs[j] as THREE.Bone);
  const inverses = bones.map((_, k) => new THREE.Matrix4().fromArray(ibm.data.slice(k * 16, k * 16 + 16)));
  nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    const mesh = g.json.meshes[n.mesh];
    const prim = mesh.primitives[0];
    const geo = new THREE.BufferGeometry();
    const attr = (k: string, name: string): void => {
      const a = accessor(g, prim.attributes[k]);
      geo.setAttribute(name, new THREE.Float32BufferAttribute(a.data, a.size));
    };
    attr('POSITION', 'position');
    attr('NORMAL', 'normal');
    attr('TEXCOORD_0', 'uv');
    attr('JOINTS_0', 'skinIndex');
    attr('WEIGHTS_0', 'skinWeight');
    geo.setIndex(accessor(g, prim.indices).data);
    if (prim.targets) {
      geo.morphAttributes.position = prim.targets.map((t: any) => {
        const a = accessor(g, t.POSITION);
        return new THREE.Float32BufferAttribute(a.data, 3);
      });
      geo.morphTargetsRelative = true;
    }
    const sm = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
    sm.name = THREE.PropertyBinding.sanitizeNodeName(n.name);
    if (prim.targets) {
      sm.updateMorphTargets();
      const names: string[] = mesh.extras?.targetNames ?? [];
      sm.morphTargetDictionary = Object.fromEntries(names.map((nm, k) => [nm, k]));
      (mesh.weights ?? []).forEach((w: number, k: number) => (sm.morphTargetInfluences![k] = w));
    }
    // GLTFLoader binds before the mesh joins its parent: bind matrix = the mesh node's own matrix (identity here)
    sm.updateMatrix();
    sm.bind(new THREE.Skeleton(bones, inverses), sm.matrix.clone());
    objs[i].parent!.add(sm);
    objs[i].removeFromParent();
  });
  scene.updateMatrixWorld(true);
  return { scene, glb: g };
}
