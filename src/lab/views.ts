// Presentation: maps solved simulation state (and the sim-owned physical pose) to low-poly meshes and debug
// overlays. Nothing here writes to the simulation.
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { RAPIER } from '../sim/physics';
import type { PlayerRuntime } from '../sim/simulation';
import { carriedBall, footFrame, type PhysicalPose } from '../sim/pose';
import { RAGDOLL_G4, shoulderLocal, type RagdollProfile } from '../sim/profiles';
import { createFootball, forwardBallQ } from './football';
import type { PlayerModel } from './player-model';
import type { Pose, Vec3 } from '../sim/vec';
import { toWorld } from '../sim/vec';

export const PALETTES: Record<string, Record<'runner' | 'defender', { jersey: number; pants: number; helmet: number; skin: number }>> = {
  default: {
    runner: { jersey: 0xc8323c, pants: 0xe8e8e8, helmet: 0x9c1f28, skin: 0xb98a6a },
    defender: { jersey: 0x2d5fb8, pants: 0xd8c27a, helmet: 0x1d3f80, skin: 0x8d6248 },
  },
  alt: {
    runner: { jersey: 0x2f8f4e, pants: 0xf0f0f0, helmet: 0x1f6036, skin: 0xb98a6a },
    defender: { jersey: 0xe0a020, pants: 0x303030, helmet: 0x8a6010, skin: 0x8d6248 },
  },
};

const tv = (v: Vec3): THREE.Vector3 => new THREE.Vector3(v.x, v.y, v.z);
const UPY = new THREE.Vector3(0, 1, 0);

function std(color: number, flat = true): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.05, flatShading: flat });
}

/** Cylinder of unit height (Y) placed between two world points. */
class Limb {
  readonly mesh: THREE.Mesh;
  constructor(radiusTop: number, radiusBottom: number, mat: THREE.Material) {
    const g = new THREE.CylinderGeometry(radiusTop, radiusBottom, 1, 7);
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.castShadow = true;
  }
  set(a: Vec3, b: Vec3): void {
    const va = tv(a);
    const vb = tv(b);
    const d = vb.clone().sub(va);
    const l = d.length();
    this.mesh.position.copy(va).addScaledVector(d, 0.5);
    if (l > 1e-6) this.mesh.quaternion.setFromUnitVectors(UPY, d.divideScalar(l).negate());
    this.mesh.scale.set(1, Math.max(l, 1e-3), 1);
  }
}

function arrow(color: number): THREE.ArrowHelper {
  const a = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, color, 0.12, 0.07);
  (a.line.material as THREE.LineBasicMaterial).depthTest = false;
  (a.cone.material as THREE.MeshBasicMaterial).depthTest = false;
  a.renderOrder = 10;
  return a;
}

function setArrow(a: THREE.ArrowHelper, from: Vec3, vec: Vec3, scale: number, minLen = 0.02): void {
  const l = Math.hypot(vec.x, vec.y, vec.z) * scale;
  if (l < minLen) {
    a.visible = false;
    return;
  }
  a.visible = true;
  a.position.set(from.x, from.y, from.z);
  a.setDirection(new THREE.Vector3(vec.x, vec.y, vec.z).normalize());
  a.setLength(l, Math.min(0.15, l * 0.35), Math.min(0.08, l * 0.2));
}

function marker(color: number, r: number, opacity = 0.9): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(r, 10, 8),
    new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthTest: false }),
  );
  m.renderOrder = 11;
  return m;
}

/** Wireframe meshes built from the actual Rapier collider shapes (mesh/collider agreement check). */
export function colliderMesh(c: RAPIER.Collider): THREE.Object3D {
  const mat = new THREE.MeshBasicMaterial({ color: 0x7cfc9a, wireframe: true, transparent: true, opacity: 0.55, depthTest: false });
  let g: THREE.BufferGeometry;
  switch (c.shapeType()) {
    case RAPIER.ShapeType.Ball:
      g = new THREE.SphereGeometry(c.radius(), 12, 8);
      break;
    case RAPIER.ShapeType.Capsule:
      g = new THREE.CapsuleGeometry(c.radius(), 2 * c.halfHeight(), 4, 10);
      break;
    case RAPIER.ShapeType.Cuboid: {
      const h = c.halfExtents() ?? { x: 0.05, y: 0.05, z: 0.05 };
      g = new THREE.BoxGeometry(2 * h.x, 2 * h.y, 2 * h.z);
      break;
    }
    default:
      g = new THREE.SphereGeometry(0.05);
  }
  const m = new THREE.Mesh(g, mat);
  m.renderOrder = 9;
  return m;
}

export interface OverlayFlags {
  overlays: boolean;
  colliders: boolean;
  /** Diagnostic primitive body (capsules/boxes from the pose) instead of the supplied model, where a model exists. */
  primitives: boolean;
}

/**
 * Release the GPU resources a view owns: every geometry and material under `root`, except subtrees in `skip` (shared
 * asset resources such as a cached GLB clone, released by their own owner). Removal from the scene alone frees nothing.
 */
export function disposeOwned(root: THREE.Object3D, skip: ReadonlySet<THREE.Object3D> = new Set()): void {
  const visit = (o: THREE.Object3D): void => {
    if (skip.has(o)) return;
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
    for (const c of o.children) visit(c);
  };
  visit(root);
}

/** One player's meshes and overlays. Rebuilt on every reset (engine handles change). */
export class PlayerView {
  readonly root = new THREE.Group();
  /** Primitive body (diagnostic view when a model is shown; the only body for the authored profiles). */
  private readonly prim = new THREE.Group();
  private readonly core = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoes: THREE.Mesh[] = [];
  private readonly limbs: Record<string, Limb> = {};
  private readonly joints: THREE.Mesh[] = [];
  private readonly mats: { jersey: THREE.MeshStandardMaterial; pants: THREE.MeshStandardMaterial; helmet: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial };
  private colliderMeshes: { c: RAPIER.Collider; m: THREE.Object3D }[] = [];
  private readonly ovl = new THREE.Group();
  readonly aVel = arrow(0xffffff);
  readonly aReq = arrow(0xffd23f);
  readonly aDrive = arrow(0xff4d4d);
  readonly aFacing = arrow(0x4da6ff);
  readonly aReqFacing = arrow(0x66ffee);
  readonly aLeverage = arrow(0xff9a2e);
  private readonly groundRing: THREE.Mesh;
  private readonly patches: Record<'left' | 'right', THREE.Mesh> = { left: marker(0xffffff, 1, 0.15), right: marker(0xffffff, 1, 0.15) };
  private readonly predictedHip = marker(0xff4dff, 0.07);
  private readonly aimMarker = marker(0xffd23f, 0.05);
  private readonly label: CSS2DObject;
  private readonly labelEl: HTMLDivElement;
  readonly ball: THREE.Group | null;

  constructor(
    readonly pl: PlayerRuntime,
    palette: string,
    colliders: RAPIER.Collider[],
    /**
     * Draw the runner's cosmetic ball at the achieved ball-arm palm. False whenever a rule profile exists: the rule
     * overlay then draws the only ball, at the observer's carry reference (review finding 3).
     */
    ownBall = true,
    /** Pose geometry profile (shoe box, limb radii of a measured body); the authored primitives keep their sizes. */
    ragdoll: RagdollProfile = RAGDOLL_G4,
    /** Supplied-model clone driven from the pose (measured bodies only); owned and disposed by this view. */
    readonly model: PlayerModel | null = null,
  ) {
    const role = pl.setup.role;
    const pal = (PALETTES[palette] ?? PALETTES.default)[role];
    this.mats = { jersey: std(pal.jersey), pants: std(pal.pants), helmet: std(pal.helmet), skin: std(pal.skin) };
    this.root.add(this.prim);
    this.prim.add(this.core);
    if (model) this.root.add(model.root);
    const body = pl.body;
    if (body.kind === 'legacyCapsule') {
      const { radius, halfHeight } = body.legacy;
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(radius, 2 * halfHeight, 4, 10), this.mats.jersey);
      m.castShadow = true;
      this.core.add(m);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.2), this.mats.helmet);
      nose.position.set(0, 0.45, radius);
      this.core.add(nose);
    } else {
      const g = body.compound;
      const torso = new THREE.Mesh(new THREE.BoxGeometry(2 * g.torso.halfExtents.x, 2 * g.torso.halfExtents.y, 2 * g.torso.halfExtents.z), this.mats.jersey);
      torso.position.set(g.torso.center.x, g.torso.center.y, g.torso.center.z);
      const pelvis = new THREE.Mesh(new THREE.BoxGeometry(2 * g.pelvis.halfExtents.x, 2 * g.pelvis.halfExtents.y, 2 * g.pelvis.halfExtents.z), this.mats.pants);
      pelvis.position.set(g.pelvis.center.x, g.pelvis.center.y, g.pelvis.center.z);
      // head group: origin at the neck pivot (head segment frame); the bind rotation equals the core rotation
      const hc = { x: body.headCenter.x - body.neck.x, y: body.headCenter.y - body.neck.y, z: body.headCenter.z - body.neck.z };
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(g.head.radius, 1), this.mats.helmet);
      head.position.set(hc.x, hc.y, hc.z);
      const mask = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.06, 0.04), std(0x222222));
      mask.position.set(hc.x, hc.y - 0.04, hc.z + g.head.radius * 0.95);
      const neckLen = Math.max(0.01, g.head.center.y - g.head.radius - (g.torso.center.y + g.torso.halfExtents.y)) + 0.04;
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, neckLen, 7), this.mats.skin);
      neck.position.set(0, (g.head.center.y - g.head.radius + g.torso.center.y + g.torso.halfExtents.y) / 2 - body.neck.y, 0);
      for (const m of [torso, pelvis]) {
        m.castShadow = true;
        this.core.add(m);
      }
      for (const m of [head, mask, neck]) {
        m.castShadow = true;
        this.head.add(m);
      }
      this.prim.add(this.head);
      const he = ragdoll.shoe.halfExtents;
      for (let i = 0; i < 2; i++) {
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(2 * he.x, 2 * he.y, 2 * he.z), this.mats.helmet);
        shoe.castShadow = true;
        this.shoes.push(shoe);
        this.prim.add(shoe);
      }
      const r = ragdoll.radii;
      const measured = !!body.measured;
      const limbDefs: [string, number, number, THREE.Material][] = measured
        ? [
            ['leftUpperArm', r.upperArm, r.upperArm, this.mats.jersey],
            ['rightUpperArm', r.upperArm, r.upperArm, this.mats.jersey],
            ['leftForearm', r.forearm, r.forearm, this.mats.skin],
            ['rightForearm', r.forearm, r.forearm, this.mats.skin],
            ['leftThigh', r.thigh, r.thigh, this.mats.pants],
            ['rightThigh', r.thigh, r.thigh, this.mats.pants],
            ['leftShin', r.shin, r.shin, this.mats.pants],
            ['rightShin', r.shin, r.shin, this.mats.pants],
          ]
        : [
            // arm radii follow the physical query capsules (ARM_G2: upper arm 0.055, forearm 0.045)
            ['leftUpperArm', 0.058, 0.052, this.mats.jersey],
            ['rightUpperArm', 0.058, 0.052, this.mats.jersey],
            ['leftForearm', 0.047, 0.042, this.mats.skin],
            ['rightForearm', 0.047, 0.042, this.mats.skin],
            ['leftThigh', 0.085, 0.065, this.mats.pants],
            ['rightThigh', 0.085, 0.065, this.mats.pants],
            ['leftShin', 0.065, 0.055, this.mats.pants],
            ['rightShin', 0.065, 0.055, this.mats.pants],
          ];
      for (const [k, a, b, mat] of limbDefs) {
        this.limbs[k] = new Limb(a, b, mat);
        this.prim.add(this.limbs[k].mesh);
      }
      for (let i = 0; i < 2; i++) {
        const hand = new THREE.Mesh(new THREE.IcosahedronGeometry(measured ? r.palm : 0.042, 1), this.mats.skin);
        this.joints.push(hand);
        this.prim.add(hand);
      }
    }
    this.ball = role === 'runner' && ownBall ? createFootball() : null;
    if (this.ball) this.root.add(this.ball);
    this.syncColliders(colliders);
    // overlays
    this.groundRing = new THREE.Mesh(
      new THREE.RingGeometry(0.36, 0.42, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x44ff66, transparent: true, opacity: 0.8 }),
    );
    for (const o of [this.aVel, this.aReq, this.aDrive, this.aFacing, this.aReqFacing, this.aLeverage, this.groundRing, this.patches.left, this.patches.right, this.predictedHip, this.aimMarker])
      this.ovl.add(o);
    for (const s of ['left', 'right'] as const) this.patches[s].scale.setScalar(pl.body.shoulderPatchRadiusM);
    this.root.add(this.ovl);
    this.labelEl = document.createElement('div');
    this.labelEl.className = 'tag';
    this.label = new CSS2DObject(this.labelEl);
    this.root.add(this.label);
  }

  /** Rebuild the collider wireframes for the active representation (proxy or ragdoll). */
  syncColliders(colliders: RAPIER.Collider[]): void {
    for (const { m } of this.colliderMeshes) {
      this.root.remove(m);
      disposeOwned(m);
    }
    this.colliderMeshes = colliders.map((c) => {
      const m = colliderMesh(c);
      this.root.add(m);
      return { c, m };
    });
  }

  setPalette(name: string): void {
    const pal = (PALETTES[name] ?? PALETTES.default)[this.pl.setup.role];
    this.model?.setPalette(`${name}:${this.pl.setup.role}`, pal);
    this.mats.jersey.color.setHex(pal.jersey);
    this.mats.pants.color.setHex(pal.pants);
    this.mats.helmet.color.setHex(pal.helmet);
    this.mats.skin.color.setHex(pal.skin);
  }

  update(
    core: { p: Vec3; q: { x: number; y: number; z: number; w: number } },
    pose: PhysicalPose | null,
    flags: OverlayFlags,
    bulk: { com: Vec3; v: Vec3 },
  ): void {
    const showModel = !!this.model && !!pose && !flags.primitives;
    this.prim.visible = !showModel;
    if (this.model) {
      this.model.root.visible = showModel;
      if (showModel) this.model.update(pose!);
    }
    this.core.position.set(core.p.x, core.p.y, core.p.z);
    this.core.quaternion.set(core.q.x, core.q.y, core.q.z, core.q.w);
    const hs = pose?.segments.head;
    if (hs) {
      this.head.position.copy(tv(hs.originWorld));
      this.head.quaternion.set(hs.rotationWorld.x, hs.rotationWorld.y, hs.rotationWorld.z, hs.rotationWorld.w);
    }
    const lm = pose?.jointLandmarksWorld;
    if (lm && pose && this.limbs.leftUpperArm) {
      ;(['left', 'right'] as const).forEach((s, i) => {
        this.limbs[`${s}UpperArm`].set(lm[`${s}Shoulder`], lm[`${s}Elbow`]);
        this.limbs[`${s}Forearm`].set(lm[`${s}Elbow`], lm[`${s}Wrist`]);
        this.limbs[`${s}Thigh`].set(lm[`${s}Hip`], lm[`${s}Knee`]);
        this.limbs[`${s}Shin`].set(lm[`${s}Knee`], lm[`${s}Ankle`]);
        const shin = pose.segments[`${s}Shin`];
        if (lm[`${s}Shoe`] && shin) {
          this.shoes[i].position.copy(tv(lm[`${s}Shoe`]));
          const fq = footFrame(pose, s);
          this.shoes[i].quaternion.set(fq.x, fq.y, fq.z, fq.w);
        }
      });
      this.joints[0].position.copy(tv(lm.leftHand ?? lm.leftPalm));
      this.joints[1].position.copy(tv(lm.rightHand ?? lm.rightPalm));
    }
    if (this.ball) {
      const seated = carriedBall(pose);
      const bp = seated?.p ?? (lm?.rightPalm ? lm.rightPalm : toWorld(core, { x: 0.2, y: 0.25, z: 0.25 }));
      const bq = seated?.q ?? forwardBallQ(core.q);
      this.ball.position.copy(tv(bp));
      this.ball.quaternion.set(bq.x, bq.y, bq.z, bq.w);
    }
    for (const { c, m } of this.colliderMeshes) {
      m.visible = flags.colliders;
      if (!flags.colliders) continue;
      const t = c.translation();
      const r = c.rotation();
      m.position.set(t.x, t.y, t.z);
      m.quaternion.set(r.x, r.y, r.z, r.w);
    }
    this.ovl.visible = flags.overlays;
    this.label.visible = flags.overlays;
    if (!flags.overlays) return;
    const pl = this.pl;
    const com = bulk.com;
    const v = bulk.v;
    const a = pl.applied;
    const base = { x: com.x, y: 0.05, z: com.z };
    setArrow(this.aVel, base, { x: v.x, y: 0, z: v.z }, 0.35);
    setArrow(this.aReq, { x: com.x, y: 0.1, z: com.z }, a.requestedVelocity, 0.35);
    setArrow(this.aDrive, { x: com.x, y: 0.15, z: com.z }, a.drive, 1 / 1000);
    const fwd = toWorld({ p: { x: 0, y: 0, z: 0 }, q: core.q }, { x: 0, y: 0, z: 1 });
    setArrow(this.aFacing, { x: core.p.x, y: 1.85, z: core.p.z }, fwd, 0.6);
    setArrow(this.aReqFacing, { x: core.p.x, y: 1.9, z: core.p.z }, pl.intent.locomotion.desiredFacingWorld, 0.5);
    (this.groundRing.material as THREE.MeshBasicMaterial).color.setHex(pl.grounded ? 0x44ff66 : 0xff4444);
    this.groundRing.position.set(com.x, 0.012, com.z);
    const dbg = pl.intent.debug ?? {};
    const sel = (dbg.selectedShoulder as 'left' | 'right' | undefined) ?? pl.setup.selectedShoulder;
    for (const s of ['left', 'right'] as const) {
      const show = pl.body.kind === 'upperBodyCompound' && !!sel;
      this.patches[s].visible = show;
      if (!show) continue;
      this.patches[s].position.copy(tv(toWorld(core, shoulderLocal(pl.body, s))));
      const m = this.patches[s].material as THREE.MeshBasicMaterial;
      m.color.setHex(s === sel ? 0xffd23f : 0xffffff);
      m.opacity = s === sel ? 0.3 : 0.08;
    }
    const ph = dbg.predictedHip as Vec3 | undefined;
    this.predictedHip.visible = !!ph;
    if (ph) this.predictedHip.position.set(ph.x, 0.9, ph.z);
    const aim = dbg.aim as Vec3 | undefined;
    this.aimMarker.visible = !!aim;
    if (aim) this.aimMarker.position.set(aim.x, 0.05, aim.z);
    const lev = dbg.leverageLat as Vec3 | undefined;
    if (lev && ph) setArrow(this.aLeverage, { x: ph.x, y: 0.9, z: ph.z }, lev, 0.6);
    else this.aLeverage.visible = false;
    const lines = [`${pl.id}${pl.grounded ? '' : ' (air)'}`];
    if (dbg.phase) lines.push(String(dbg.phase));
    this.labelEl.textContent = lines.join('\n');
    this.label.position.set(core.p.x, core.p.y + 1.25, core.p.z);
  }

  dispose(): void {
    for (const { m } of this.colliderMeshes) disposeOwned(m);
    // the model clone's geometry and materials are the asset cache's; the clone releases its own skeletons
    disposeOwned(this.root, this.model ? new Set([this.model.root]) : new Set());
    this.model?.dispose();
    this.labelEl.remove();
  }
}

/** Pool of contact-point markers. */
export class ContactMarkers {
  readonly group = new THREE.Group();
  private pool: THREE.Mesh[] = [];
  set(points: { p: Vec3; color: number }[], visible: boolean): void {
    this.group.visible = visible;
    while (this.pool.length < points.length) {
      const m = marker(0xff3030, 0.035);
      this.pool.push(m);
      this.group.add(m);
    }
    this.pool.forEach((m, i) => {
      m.visible = i < points.length;
      if (i < points.length) {
        m.position.copy(tv(points[i].p));
        (m.material as THREE.MeshBasicMaterial).color.setHex(points[i].color);
      }
    });
  }
}

// ---------------------------------------------------------------- Gate 2 arm overlays
export interface ArmOverlaySide {
  palm: Vec3;
  requested: Vec3 | null;
  phase: string;
  /** Grip anchor and outward normal on the target (verified surface hold). */
  anchor: { p: Vec3; n: Vec3; tension: number; ceiling: number } | null;
  /** Forearm clamp contact on the target. */
  clamp: { p: Vec3; n: Vec3; normalN: number; tangent: Vec3 } | null;
  /** Wrap azimuth ray origin (target centre at band height) when classified with a basis. */
  azFrom: Vec3 | null;
  azDeg: number | null;
  label: string;
}

function line(color: number): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)]);
  const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 }));
  l.renderOrder = 12;
  l.frustumCulled = false;
  return l;
}

function setLine(l: THREE.Line, a: Vec3, b: Vec3): void {
  const pos = l.geometry.getAttribute('position') as THREE.BufferAttribute;
  pos.setXYZ(0, a.x, a.y, a.z);
  pos.setXYZ(1, b.x, b.y, b.z);
  pos.needsUpdate = true;
  l.visible = true;
}

class ArmSideOverlay {
  readonly g = new THREE.Group();
  private readonly req = marker(0xffd23f, 0.028, 0.85);
  private readonly reqLine = line(0xffd23f);
  private readonly palm = marker(0x5dff7a, 0.02);
  private readonly anchor = marker(0xff4dff, 0.03);
  private readonly anchorN = arrow(0xff4dff);
  private readonly link = line(0xffffff);
  private readonly clampPt = marker(0xff9a2e, 0.03);
  private readonly clampN = arrow(0xff9a2e);
  private readonly clampT = arrow(0x66ffee);
  private readonly az = line(0x66ffee);
  private readonly labelEl = document.createElement('div');
  private readonly label = new CSS2DObject(this.labelEl);
  constructor() {
    this.labelEl.className = 'tag arm';
    for (const o of [this.req, this.reqLine, this.palm, this.anchor, this.anchorN, this.link, this.clampPt, this.clampN, this.clampT, this.az, this.label]) this.g.add(o);
  }
  set(d: ArmOverlaySide | null): void {
    this.g.visible = !!d;
    this.label.visible = !!d;
    if (!d) return;
    this.palm.position.copy(tv(d.palm));
    this.req.visible = !!d.requested;
    this.reqLine.visible = !!d.requested;
    if (d.requested) {
      this.req.position.copy(tv(d.requested));
      setLine(this.reqLine, d.palm, d.requested);
    }
    const a = d.anchor;
    this.anchor.visible = !!a;
    this.link.visible = !!a;
    if (a) {
      this.anchor.position.copy(tv(a.p));
      setArrow(this.anchorN, a.p, a.n, 0.18);
      setLine(this.link, d.palm, a.p);
      const k = Math.min(1, a.tension / Math.max(1, a.ceiling));
      (this.link.material as THREE.LineBasicMaterial).color.setRGB(1, 1 - k, 1 - k);
    } else this.anchorN.visible = false;
    const c = d.clamp;
    this.clampPt.visible = !!c;
    if (c) {
      this.clampPt.position.copy(tv(c.p));
      setArrow(this.clampN, c.p, { x: -c.n.x * c.normalN, y: -c.n.y * c.normalN, z: -c.n.z * c.normalN }, 1 / 1000, 0.01);
      setArrow(this.clampT, c.p, c.tangent, 1 / 1000, 0.01);
    } else {
      this.clampN.visible = false;
      this.clampT.visible = false;
    }
    const pt = c?.p ?? a?.p ?? null;
    if (d.azFrom && pt) setLine(this.az, d.azFrom, { x: pt.x, y: d.azFrom.y, z: pt.z });
    else this.az.visible = false;
    this.labelEl.textContent = d.label;
    this.label.position.set(d.palm.x, d.palm.y + 0.12, d.palm.z);
  }
  dispose(): void {
    this.labelEl.remove();
  }
}

/** Requested/achieved hand targets, grip anchor + normal, tension link, clamp contact + forces, wrap azimuth rays. */
export class ArmOverlay {
  readonly root = new THREE.Group();
  private readonly sides = { left: new ArmSideOverlay(), right: new ArmSideOverlay() };
  constructor() {
    this.root.add(this.sides.left.g, this.sides.right.g);
  }
  update(d: Partial<Record<'left' | 'right', ArmOverlaySide>>, visible: boolean): void {
    this.root.visible = visible;
    for (const s of ['left', 'right'] as const) this.sides[s].set(visible ? (d[s] ?? null) : null);
  }
  dispose(): void {
    disposeOwned(this.root);
    this.sides.left.dispose();
    this.sides.right.dispose();
  }
}

export interface BalanceOverlayData {
  com: Vec3;
  bodyUp: Vec3;
  desiredUp: Vec3;
  leanDeg: number;
  projectedDeg: number;
  envelopeDeg: number;
  falling: boolean;
  label: string;
}

/** Actual body up (coloured by projected lean vs envelope), world up, desired posture up, and a lean label. */
export class BalanceOverlay {
  readonly root = new THREE.Group();
  private readonly worldUp = arrow(0xffffff);
  private readonly bodyUp = arrow(0x5dff7a);
  private readonly desired = arrow(0x6aa8ff);
  private readonly labelEl = document.createElement('div');
  private readonly label = new CSS2DObject(this.labelEl);
  constructor() {
    this.labelEl.className = 'tag bal';
    this.root.add(this.worldUp, this.bodyUp, this.desired, this.label);
  }
  update(d: BalanceOverlayData, visible: boolean): void {
    this.root.visible = visible;
    this.label.visible = visible;
    if (!visible) return;
    setArrow(this.worldUp, d.com, { x: 0, y: 1, z: 0 }, 0.9);
    setArrow(this.bodyUp, d.com, d.bodyUp, 0.9);
    const k = Math.min(1, d.projectedDeg / d.envelopeDeg);
    (this.bodyUp.line.material as THREE.LineBasicMaterial).color.setRGB(0.36 + 0.64 * k, 1 - 0.7 * k, 0.48 * (1 - k));
    (this.bodyUp.cone.material as THREE.MeshBasicMaterial).color.setRGB(0.36 + 0.64 * k, 1 - 0.7 * k, 0.48 * (1 - k));
    const dl = Math.acos(Math.min(1, d.desiredUp.y));
    if (dl > 1e-3 && !d.falling) setArrow(this.desired, d.com, d.desiredUp, 0.7);
    else this.desired.visible = false;
    this.labelEl.textContent = d.label;
    this.labelEl.classList.toggle('falling', d.falling);
    this.label.position.set(d.com.x, d.com.y + 0.85, d.com.z);
  }
  dispose(): void {
    disposeOwned(this.root);
    this.labelEl.remove();
  }
}

// ---------------------------------------------------------------- Gate 4 rule observer overlay (cosmetic)
/**
 * The only cosmetic ball whenever a rule profile exists, drawn at the observer's simulation-owned carry reference (no
 * collision, no fumble authority); the frozen official event spot once a referee ending is recorded (never moved
 * afterwards); and the configured sideline plane as a ground line.
 */
export class RuleOverlay {
  readonly root = new THREE.Group();
  private readonly ball: THREE.Group;
  private readonly spot: THREE.Group;

  constructor(sideline: { outwardNormal: Vec3; offsetM: number } | null) {
    this.ball = createFootball();
    this.root.add(this.ball);
    this.spot = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd400, side: THREE.DoubleSide }));
    ring.position.y = 0.006;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.6, 8), new THREE.MeshBasicMaterial({ color: 0xffd400 }));
    pole.position.y = 0.8;
    this.spot.add(ring, pole);
    this.spot.visible = false;
    this.root.add(this.spot);
    if (sideline) {
      // plane dot(p, n) = offset drawn as a 40 m line on the ground
      const n = sideline.outwardNormal;
      const t = { x: -n.z, z: n.x };
      const m = new THREE.Mesh(new THREE.PlaneGeometry(40, 0.1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      m.position.set(n.x * sideline.offsetM, 0.005, n.z * sideline.offsetM);
      m.rotation.y = -Math.atan2(t.z, t.x);
      this.root.add(m);
    }
  }

  update(ball: Pose, spot: Vec3 | null): void {
    this.ball.position.copy(tv(ball.p));
    this.ball.quaternion.set(ball.q.x, ball.q.y, ball.q.z, ball.q.w);
    this.spot.visible = !!spot;
    if (spot) this.spot.position.set(spot.x, 0, spot.z);
  }

  dispose(): void {
    disposeOwned(this.root);
  }
}
