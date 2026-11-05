// Supplied player model (models/bew-v6.glb) for Presentation: one cached load, per-player clones with independent
// bones and morph weights, shared geometry, palette-recoloured textures and materials cached per (palette, role), and
// the rig adapter that drives the clone from the simulation-owned pose. Nothing here writes to the simulation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import GLB_URL from '../../models/bew-v6.glb?url';
import { MODEL_CALIBRATION } from '../sim/model/profiles';
import type { PhysicalPose } from '../sim/pose';
import { REQUIRED_BONES, RigAdapter, boneKey, cloneRig } from './rig-adapter';

export { GLB_URL };

export interface ModelPalette {
  jersey: number;
  pants: number;
  helmet: number;
  skin: number;
}

/** Atlas key colours (models/rig.md) replaced by a palette; every other texel (gloves, shoes, facemask) is kept. */
function keyMap(p: ModelPalette): { body: Map<number, number>; helmet: Map<number, number> } {
  const k = MODEL_CALIBRATION.keyColors;
  const hex = (s: string): number => parseInt(s, 16);
  return {
    body: new Map([
      [hex(k.jersey), p.jersey],
      [hex(k.socks), p.jersey],
      [hex(k.pants), p.pants],
      [hex(k.skin), p.skin],
    ]),
    helmet: new Map([[hex(k.helmetShell), p.helmet]]),
  };
}

/** Copy of `src` whose exact key-colour texels are replaced (own Source; sampler, flip and colour space copied). */
function recolor(src: THREE.Texture, map: Map<number, number>): THREE.Texture {
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    const to = map.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
    if (to === undefined) continue;
    px[i] = (to >> 16) & 255;
    px[i + 1] = (to >> 8) & 255;
    px[i + 2] = to & 255;
  }
  ctx.putImageData(data, 0, 0);
  const t = src.clone();
  t.source = new THREE.Source(canvas);
  t.needsUpdate = true;
  return t;
}

/** The loaded asset: source scene (never rendered), and per-palette materials. Owns all shared GPU resources. */
export class ModelAsset {
  private static pending: Promise<ModelAsset> | null = null;
  private static current: ModelAsset | null = null;
  private readonly mats = new Map<string, { body: THREE.Material; helmet: THREE.Material; textures: THREE.Texture[] }>();
  private readonly instances = new Set<PlayerModel>();
  retired = false;

  private constructor(
    readonly scene: THREE.Group,
    readonly body: THREE.SkinnedMesh,
    readonly helmet: THREE.SkinnedMesh,
  ) {}

  /** Load once (cached); a failed load clears the cache so a later call can retry. */
  static load(url: string = GLB_URL): Promise<ModelAsset> {
    if (ModelAsset.current && !ModelAsset.current.retired) return Promise.resolve(ModelAsset.current);
    if (!ModelAsset.pending)
      ModelAsset.pending = new GLTFLoader()
        .loadAsync(url)
        .then((gltf) => {
          const meshes: THREE.SkinnedMesh[] = [];
          gltf.scene.traverse((o) => {
            if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh);
          });
          const body = meshes.find((m) => (m.morphTargetDictionary ? 'heavy' in m.morphTargetDictionary : false));
          const helmet = meshes.find((m) => m !== body);
          if (!body || !helmet) throw new Error(`model: expected body and helmet skinned meshes, found ${meshes.length}`);
          const found = new Set<string>();
          gltf.scene.traverse((o) => {
            const k = (o as THREE.Bone).isBone ? boneKey(o.name) : null;
            if (k) found.add(k);
          });
          for (const b of REQUIRED_BONES) if (!found.has(b)) throw new Error(`model: bone ${b} missing`);
          const a = new ModelAsset(gltf.scene, body, helmet);
          ModelAsset.current = a;
          return a;
        })
        .finally(() => {
          ModelAsset.pending = null;
        });
    return ModelAsset.pending;
  }

  /** Materials for a palette key (cached; copied from the asset's materials only where the palette differs). */
  materials(key: string, p: ModelPalette): { body: THREE.Material; helmet: THREE.Material } {
    let m = this.mats.get(key);
    if (!m) {
      const km = keyMap(p);
      const mk = (src: THREE.MeshStandardMaterial, map: Map<number, number>): { mat: THREE.Material; tex: THREE.Texture } => {
        const tex = recolor(src.map!, map);
        const mat = src.clone();
        mat.map = tex;
        return { mat, tex };
      };
      const b = mk(this.body.material as THREE.MeshStandardMaterial, km.body);
      const h = mk(this.helmet.material as THREE.MeshStandardMaterial, km.helmet);
      m = { body: b.mat, helmet: h.mat, textures: [b.tex, h.tex] };
      this.mats.set(key, m);
    }
    return m;
  }

  instantiate(key: string, p: ModelPalette): PlayerModel {
    if (this.retired) throw new Error('model: asset retired');
    const inst = new PlayerModel(this, key, p);
    this.instances.add(inst);
    return inst;
  }

  /** @internal */
  released(inst: PlayerModel): void {
    this.instances.delete(inst);
  }

  get liveInstances(): number {
    return this.instances.size;
  }

  /** Release every shared resource (geometry, source and palette textures, materials). Live instances are disposed. */
  retire(): void {
    if (this.retired) return;
    for (const i of [...this.instances]) i.dispose();
    this.retired = true;
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.map?.dispose();
      mat.dispose();
    });
    for (const m of this.mats.values()) {
      m.body.dispose();
      m.helmet.dispose();
      m.textures.forEach((t) => t.dispose());
    }
    this.mats.clear();
    if (ModelAsset.current === this) ModelAsset.current = null;
  }
}

/** One player's clone: independent skeleton and morph weights; geometry and materials shared through the asset. */
export class PlayerModel {
  readonly root: THREE.Object3D;
  readonly bones: Record<string, THREE.Bone>;
  readonly meshes: THREE.SkinnedMesh[];
  readonly adapter: RigAdapter;
  private disposed = false;

  constructor(
    readonly asset: ModelAsset,
    paletteKey: string,
    palette: ModelPalette,
  ) {
    const c = cloneRig(asset.scene);
    this.root = c.root;
    this.bones = c.bones;
    this.meshes = c.meshes;
    this.setPalette(paletteKey, palette);
    this.adapter = new RigAdapter(this.bones, MODEL_CALIBRATION);
  }

  setPalette(key: string, p: ModelPalette): void {
    const mats = this.asset.materials(key, p);
    for (const m of this.meshes) m.material = m.geometry === this.asset.body.geometry ? mats.body : mats.helmet;
  }

  update(pose: PhysicalPose): void {
    this.adapter.apply(pose);
  }

  /** Release this clone's own resources (its skeletons' bone textures); shared geometry/materials stay with the asset. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const m of this.meshes) m.skeleton.dispose();
    this.asset.released(this);
  }
}
