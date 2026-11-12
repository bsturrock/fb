// BodyAndContact physics adapter: the only module that owns Rapier handles. Player identity lives in tags, never in
// engine handles (handles change after reset or ragdoll conversion).
import RAPIER from '@dimforge/rapier3d-compat';
import type { ColliderRegion, ColliderTag, ContactRec, ContactPointRec, PlayerId, BodyPartId, ArmSide } from './contracts';
import type { BodyProfile, CombineRule, SolverProfile, StanceProfile, SuspensionSupport } from './profiles';
import { add, qRot, sub, type Pose, type Quat, type Vec3, v3, vc, dot, neg, qInvRot } from './vec';

let ready: Promise<void> | null = null;
/** Initialise the Rapier WASM module once per process. */
export function initPhysics(): Promise<void> {
  if (!ready) ready = RAPIER.init();
  return ready;
}
export { RAPIER };

/** The engine version reported by the loaded Rapier module (valid after initPhysics). */
export const rapierVersion = (): string => RAPIER.version();

const combine = (r: CombineRule): RAPIER.CoefficientCombineRule => RAPIER.CoefficientCombineRule[r];

export interface ProxyBody {
  body: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  support: RAPIER.Collider;
  /** Support shape geometry in its own frame. */
  supportShape: { radius: number; halfHeight: number };
  /**
   * Suspension support only (plan 06a): massless guard ball on the body axis, the bump stop and the falling contact with
   * static ground. Not in `colliders` (it lies inside the support capsule; contacts with players are filtered out).
   */
  guard?: RAPIER.Collider;
}

/** Arm self-clearance: one measured trunk piece (body frame) with its bounding sphere and its query collider. */
export interface TrunkPiece {
  /** Rapier shape (tests and probes: `Shape.contactShape` rebuilds the hull on every call, so the runtime never uses it). */
  shape: RAPIER.ConvexPolyhedron;
  /** Parentless collider in a private, never-stepped query world: built once, posed per query. */
  collider: RAPIER.Collider;
  center: Vec3;
  radius: number;
  /** Plan 13a: capsule (body frame) enclosing the piece's body-frame box, for the cull. */
  seg: { a: Vec3; b: Vec3; r: number };
}

let queryWorld: RAPIER.World | null = null;
const trunkCache = new WeakMap<Vec3[][], TrunkPiece[]>();
/**
 * Arm self-clearance: a body's measured trunk pieces in the body frame (the proxy body and the ragdoll core share it),
 * built once per trunk; null for a body without a measured trunk. The query colliders live in a private world that is
 * never stepped, so they never meet the simulation's bodies.
 */
export function trunkPieces(body: BodyProfile): TrunkPiece[] | null {
  const h = body.measured?.trunkHull;
  if (!h) return null;
  let s = trunkCache.get(h);
  if (!s) {
    queryWorld ??= new RAPIER.World({ x: 0, y: 0, z: 0 });
    s = h.map((pts) => {
      const lo = v3(Infinity, Infinity, Infinity);
      const hi = v3(-Infinity, -Infinity, -Infinity);
      for (const p of pts) {
        lo.x = Math.min(lo.x, p.x); lo.y = Math.min(lo.y, p.y); lo.z = Math.min(lo.z, p.z);
        hi.x = Math.max(hi.x, p.x); hi.y = Math.max(hi.y, p.y); hi.z = Math.max(hi.z, p.z);
      }
      const center = v3(0.5 * (lo.x + hi.x), 0.5 * (lo.y + hi.y), 0.5 * (lo.z + hi.z));
      const radius = Math.max(...pts.map((p) => Math.hypot(p.x - center.x, p.y - center.y, p.z - center.z)));
      const flat = new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z]));
      const desc = RAPIER.ColliderDesc.convexHull(flat);
      if (!desc) throw new Error('trunkPieces: degenerate trunk piece');
      const seg = boxSeg(center, v3(0.5 * (hi.x - lo.x), 0.5 * (hi.y - lo.y), 0.5 * (hi.z - lo.z)), { x: 0, y: 0, z: 0, w: 1 });
      return { shape: new RAPIER.ConvexPolyhedron(flat, null), collider: queryWorld!.createCollider(desc), center, radius, seg };
    });
    trunkCache.set(h, s);
  }
  return s;
}

/** The trunk pieces' shapes alone (probes and tests). */
export function trunkShapes(body: BodyProfile): RAPIER.ConvexPolyhedron[] | null {
  return trunkPieces(body)?.map((p) => p.shape) ?? null;
}

export interface TrunkHit {
  distance: number;
  /** Separating direction on the trunk (out of the trunk, towards the query shape). */
  normal1: Vec3;
  point1: Vec3;
  point2: Vec3;
  /** Trunk piece index. */
  piece: number;
}

/**
 * Deepest contact of one query shape (world pose, bounding sphere `bc`/`br`) with a body's trunk pieces at `bodyPose`,
 * within `prediction`; pieces whose bounding sphere is farther than that are skipped.
 */
export function trunkContact(pieces: TrunkPiece[], bodyPose: Pose, shape: RAPIER.Shape, pos: Vec3, rot: Quat, bc: Vec3, br: number, prediction: number): TrunkHit | null {
  let best: TrunkHit | null = null;
  let seg: CullGeom['seg'] | null | undefined;
  for (let i = 0; i < pieces.length; i++) {
    const pc = pieces[i];
    const c = add(bodyPose.p, qRot(bodyPose.q, pc.center));
    const dx = c.x - bc.x;
    const dy = c.y - bc.y;
    const dz = c.z - bc.z;
    const reach = pc.radius + br + prediction;
    if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
    // plan 13a: the piece's enclosing capsule against the query shape's (exact: beyond it the query returns null)
    if (seg === undefined) seg = cullGeom(shape, pos, rot).seg ?? null;
    if (seg) {
      const sr = pc.seg.r + seg.r + prediction + CULL_SLACK_M;
      const a = add(bodyPose.p, qRot(bodyPose.q, pc.seg.a));
      const b = add(bodyPose.p, qRot(bodyPose.q, pc.seg.b));
      if (segmentDistanceSq(a, b, seg.a, seg.b) > sr * sr) continue;
    }
    pc.collider.setTranslation(bodyPose.p);
    pc.collider.setRotation(bodyPose.q);
    const r = pc.collider.contactShape(shape, pos, rot, prediction);
    if (r && (!best || r.distance < best.distance)) best = { distance: r.distance, normal1: vc(r.normal1), point1: vc(r.point1), point2: vc(r.point2), piece: i };
  }
  return best;
}

// ------------------------------------------------------------------ plan 13a: query culling
/**
 * Slack (m) added to every cull distance. Rapier computes in single precision, so a reported distance can sit a few
 * micrometres inside the exact one at field coordinates; 0.1 mm keeps a cull from ever skipping a pair the query would
 * have returned, at no measurable cost.
 */
export const CULL_SLACK_M = 1e-4;

const radiusCache = new WeakMap<RAPIER.Shape, number | null>();
/**
 * Bounding-sphere radius of a Rapier shape about its own origin: ball, capsule (half height + radius) and cuboid
 * (half-extent length); null for any other kind, which is always queried. Cached per shape object (Rapier caches a
 * collider's shape object, so a collider's radius is computed once).
 */
export function shapeRadius(shape: RAPIER.Shape): number | null {
  let r = radiusCache.get(shape);
  if (r === undefined) {
    const T = RAPIER.ShapeType;
    if (shape.type === T.Ball) r = (shape as RAPIER.Ball).radius;
    else if (shape.type === T.Capsule) r = (shape as RAPIER.Capsule).halfHeight + (shape as RAPIER.Capsule).radius;
    else if (shape.type === T.Cuboid) {
      const h = (shape as RAPIER.Cuboid).halfExtents;
      r = Math.hypot(h.x, h.y, h.z);
    } else r = null;
    radiusCache.set(shape, r);
  }
  return r;
}

/**
 * Whether a shape query between two bounding spheres can return anything: false only when the spheres are farther apart
 * than `prediction` (plus CULL_SLACK_M), where the query returns null. A null radius (unbounded kind) is always near.
 */
export function boundsNear(ac: Vec3, ar: number | null, bc: Vec3, br: number | null, prediction: number): boolean {
  if (ar === null || br === null) return true;
  const dx = ac.x - bc.x;
  const dy = ac.y - bc.y;
  const dz = ac.z - bc.z;
  const reach = ar + br + prediction + CULL_SLACK_M;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/**
 * A shape's cull geometry at a pose: its bounding sphere and a capsule (segment and radius; a = b for a ball) enclosing
 * it: the shape itself for a ball or a capsule, the box's longest axis for a cuboid. Two shapes are at least as far
 * apart as their capsules' segment distance less both radii.
 */
export interface CullGeom {
  c: Vec3;
  r: number | null;
  seg?: { a: Vec3; b: Vec3; r: number };
  /** A cuboid's own box, for the tighter box test against a round shape. */
  box?: { c: Vec3; he: Vec3; q: Quat };
}

/** Capsule enclosing a box (centre, half extents, rotation): its longest axis, radius the other two half extents' length. */
export function boxSeg(c: Vec3, he: Vec3, q: Quat): { a: Vec3; b: Vec3; r: number } {
  const axis = he.x >= he.y && he.x >= he.z ? v3(he.x, 0, 0) : he.y >= he.z ? v3(0, he.y, 0) : v3(0, 0, he.z);
  const r = he.x >= he.y && he.x >= he.z ? Math.hypot(he.y, he.z) : he.y >= he.z ? Math.hypot(he.x, he.z) : Math.hypot(he.x, he.y);
  const h = qRot(q, axis);
  return { a: sub(c, h), b: add(c, h), r };
}

/** Cull geometry of a Rapier shape placed at `p`, `q` (a capsule's axis is its local y). */
export function cullGeom(shape: RAPIER.Shape, p: Vec3, q: Quat): CullGeom {
  const T = RAPIER.ShapeType;
  if (shape.type === T.Ball) {
    const r = (shape as RAPIER.Ball).radius;
    return { c: p, r, seg: { a: p, b: p, r } };
  }
  if (shape.type === T.Capsule) {
    const k = shape as RAPIER.Capsule;
    const h = qRot(q, v3(0, k.halfHeight, 0));
    return { c: p, r: k.halfHeight + k.radius, seg: { a: sub(p, h), b: add(p, h), r: k.radius } };
  }
  if (shape.type === T.Cuboid) {
    const he = (shape as RAPIER.Cuboid).halfExtents;
    return { c: p, r: shapeRadius(shape), seg: boxSeg(p, he, q), box: { c: p, he, q } };
  }
  return { c: p, r: shapeRadius(shape) };
}

/**
 * Whether a shape query between two placed shapes can return anything: false when their bounding spheres, or for two
 * round shapes their segments less both radii, are farther apart than `prediction` plus CULL_SLACK_M.
 */
export function geomNear(x: CullGeom, y: CullGeom, prediction: number): boolean {
  if (!boundsNear(x.c, x.r, y.c, y.r, prediction)) return false;
  if (!x.seg || !y.seg) return true;
  const reach = x.seg.r + y.seg.r + prediction + CULL_SLACK_M;
  if (segmentDistanceSq(x.seg.a, x.seg.b, y.seg.a, y.seg.b) > reach * reach) return false;
  // a box against a ball or capsule: the box against the box-frame bounds of the other's segment
  const round = (g: CullGeom): boolean => !g.box && !!g.seg;
  if (x.box && round(y)) return boxSegNear(x.box, y.seg!, prediction);
  if (y.box && round(x)) return boxSegNear(y.box, x.seg!, prediction);
  return true;
}

/**
 * Whether a box and a capsule (segment and radius) can be within `prediction` (plus CULL_SLACK_M): their distance is at
 * least that between the box and the segment's bounds in the box frame, less the radius.
 */
function boxSegNear(box: { c: Vec3; he: Vec3; q: Quat }, seg: { a: Vec3; b: Vec3; r: number }, prediction: number): boolean {
  const a = qInvRot(box.q, sub(seg.a, box.c));
  const b = qInvRot(box.q, sub(seg.b, box.c));
  const gap = (lo: number, hi: number, h: number): number => (lo > h ? lo - h : hi < -h ? -h - hi : 0);
  const gx = gap(Math.min(a.x, b.x), Math.max(a.x, b.x), box.he.x);
  const gy = gap(Math.min(a.y, b.y), Math.max(a.y, b.y), box.he.y);
  const gz = gap(Math.min(a.z, b.z), Math.max(a.z, b.z), box.he.z);
  const reach = seg.r + prediction + CULL_SLACK_M;
  return gx * gx + gy * gy + gz * gz <= reach * reach;
}

const unit = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
/** Squared distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection 5.1.9). */
export function segmentDistanceSq(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1x = q1.x - p1.x, d1y = q1.y - p1.y, d1z = q1.z - p1.z;
  const d2x = q2.x - p2.x, d2y = q2.y - p2.y, d2z = q2.z - p2.z;
  const rx = p1.x - p2.x, ry = p1.y - p2.y, rz = p1.z - p2.z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  const EPS = 1e-12;
  let s = 0;
  let t = 0;
  if (a <= EPS) {
    if (e > EPS) t = unit(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= EPS) s = unit(-c / a);
    else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom > 0 ? unit((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = unit(-c / a);
      } else if (t > 1) {
        t = 1;
        s = unit((b - c) / a);
      }
    }
  }
  const dx = rx + d1x * s - d2x * t;
  const dy = ry + d1y * s - d2y * t;
  const dz = rz + d1z * s - d2z * t;
  return dx * dx + dy * dy + dz * dz;
}

/** Default half size of the static floor (m): the practice area of every fixture fits well inside it. */
export const FLOOR_HALF_M = 40;

/** Collision-group membership bit of static ground (turf and obstacles) when a suspension player exists. */
export const GROUP_STATIC = 0x0001;
/** Contact motion experiment (`LegGuardProfile.physicalLegs`): a supported proxy's physical leg colliders. */
export const GROUP_LEGS = 0x0002;
/** Tag key prefix of a physical leg collider (not a contact record: its contacts are read by the leg ledger). */
export const PHYS_LEG_KEY = 'physLeg';
/**
 * A leg shape as a convex hull in its body's frame: points and a rounding radius. A capsule is a thin box around its
 * segment (half-width `LEG_HULL_EPS_M`) rounded by the radius less that width; a box its eight corners.
 */
export interface LegHull {
  points: Float32Array;
  r: number;
}
export const LEG_HULL_EPS_M = 2e-4;
/**
 * A supported proxy's physical leg collider (contact motion). Its contacts are ordinary contact records (fall response,
 * contact observation, rules, evidence all see them); a consumer that must not use one says so where it filters.
 */
export const isSupportedLeg = (tag: { key: string }): boolean => tag.key.startsWith(PHYS_LEG_KEY);
/** Rapier interaction groups: 16 membership bits (high half) and 16 filter bits (low half), unsigned. */
export const interactionGroups = (membership: number, filter: number): number => ((((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0);

/** One vertical ground probe: the nearest listed collider below a point. */
export interface GroundHit {
  collider: RAPIER.Collider;
  /** Vertical distance from the probe origin to the hit (m). */
  distM: number;
  pointWorld: Vec3;
  normal: Vec3;
}

export interface MassReport {
  massKg: number;
  localCom: Vec3;
  principalInertia: Vec3;
  principalFrame: Quat;
}

export class PhysicsWorld {
  readonly world: RAPIER.World;
  readonly floorBody: RAPIER.RigidBody;
  readonly floorCollider: RAPIER.Collider;
  readonly tags = new Map<number, ColliderTag>();
  readonly dt: number;
  private hooks: RAPIER.PhysicsHooks | undefined;
  /**
   * Rapier 0.21 (compat) passes physics hooks to the pipeline only through stepWithEvents, i.e. when an event queue is
   * given to World.step; without one the hooks object is silently ignored. The queue is cleared after every step.
   */
  private hookEvents: RAPIER.EventQueue | undefined;

  /**
   * `floorHalfM`: the static floor's half size (m, square). Plan 14: the run lab's long area needs more than the 40 m
   * every other fixture uses.
   */
  constructor(
    readonly solver: SolverProfile,
    floorHalfM = FLOOR_HALF_M,
  ) {
    this.world = new RAPIER.World({ x: 0, y: solver.gravityY, z: 0 });
    this.dt = solver.outerTickS / solver.substeps;
    this.world.timestep = this.dt;
    this.world.numSolverIterations = solver.solverIterations;
    this.floorBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.floorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(floorHalfM, 0.5, floorHalfM)
        .setFriction(solver.passiveFriction)
        .setFrictionCombineRule(combine(solver.passiveFrictionCombine))
        .setRestitution(solver.restitution)
        .setRestitutionCombineRule(combine(solver.restitutionCombine)),
      this.floorBody,
    );
    this.tags.set(this.floorCollider.handle, { playerId: null, part: 'floor', region: 'floor', key: 'floor' });
  }

  /** Optional identity-based contact filter (used by ragdolls for same-owner self pairs). */
  setContactFilter(filter: ((a: ColliderTag, b: ColliderTag) => boolean) | null): void {
    if (!filter) {
      this.hooks = undefined;
      this.hookEvents?.free();
      this.hookEvents = undefined;
      return;
    }
    this.hookEvents ??= new RAPIER.EventQueue(false);
    this.hooks = {
      filterContactPair: (h1: number, h2: number) => {
        const a = this.tags.get(h1);
        const b = this.tags.get(h2);
        if (!a || !b) return RAPIER.SolverFlags.COMPUTE_IMPULSE;
        return filter(a, b) ? RAPIER.SolverFlags.COMPUTE_IMPULSE : null;
      },
      filterIntersectionPair: () => true,
    } as RAPIER.PhysicsHooks;
  }

  step(): void {
    this.world.step(this.hookEvents, this.hooks);
    this.hookEvents?.clear();
  }

  /** True once dispose() has freed the engine world. */
  disposed = false;

  /** Free the engine world (idempotent: a second call does nothing). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.hookEvents?.free();
    this.hookEvents = undefined;
    this.world.free();
    this.tags.clear();
  }

  private colliderDesc(desc: RAPIER.ColliderDesc, massKg: number, support: boolean): RAPIER.ColliderDesc {
    const s = this.solver;
    return desc
      .setMass(massKg)
      .setFriction(support ? s.supportedSupportFriction : s.passiveFriction)
      .setFrictionCombineRule(combine(support ? s.supportedSupportCombine : s.passiveFrictionCombine))
      .setRestitution(s.restitution)
      .setRestitutionCombineRule(combine(s.restitutionCombine));
  }

  addTag(c: RAPIER.Collider, playerId: PlayerId, part: BodyPartId, region: ColliderRegion, key: string, side?: ArmSide): void {
    this.tags.set(c.handle, { playerId, part, region, key, side });
  }

  /** Create one dynamic standing proxy per the body profile. Total mass is set once through collider masses. */
  createProxy(playerId: PlayerId, profile: BodyProfile, stance: StanceProfile, pose: Pose, suspension?: SuspensionSupport): ProxyBody {
    const s = this.solver;
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.p.x, pose.p.y, pose.p.z)
      .setRotation(pose.q)
      .setCanSleep(s.sleeping)
      .setCcdEnabled(s.ccd)
      .setSoftCcdPrediction(s.softCcdPredictionM)
      .setLinearDamping(s.linearDamping)
      .setAngularDamping(s.angularDamping);
    if (stance.rotation === 'pitchRollLocked') desc.enabledRotations(false, true, false);
    const body = this.world.createRigidBody(desc);
    const colliders: RAPIER.Collider[] = [];
    let support: RAPIER.Collider;
    let supportShape: { radius: number; halfHeight: number };
    if (profile.kind === 'legacyCapsule') {
      const { radius, halfHeight } = profile.legacy;
      support = this.world.createCollider(
        this.colliderDesc(RAPIER.ColliderDesc.capsule(halfHeight, radius), profile.massKg, true),
        body,
      );
      this.addTag(support, playerId, 'core', 'capsule', 'capsule');
      colliders.push(support);
      supportShape = { radius, halfHeight };
    } else {
      const g = profile.compound;
      const f = profile.massFractions;
      const m = profile.massKg;
      support = this.world.createCollider(
        this.colliderDesc(RAPIER.ColliderDesc.capsule(g.support.halfHeight, g.support.radius), m * f.support, true).setTranslation(
          g.support.center.x,
          g.support.center.y,
          g.support.center.z,
        ),
        body,
      );
      this.addTag(support, playerId, 'core', 'support', 'support');
      const torso = this.world.createCollider(
        this.colliderDesc(
          RAPIER.ColliderDesc.cuboid(g.torso.halfExtents.x, g.torso.halfExtents.y, g.torso.halfExtents.z),
          m * f.torso,
          false,
        ).setTranslation(g.torso.center.x, g.torso.center.y, g.torso.center.z),
        body,
      );
      this.addTag(torso, playerId, 'core', 'torso', 'torso');
      const pelvis = this.world.createCollider(
        this.colliderDesc(
          RAPIER.ColliderDesc.cuboid(g.pelvis.halfExtents.x, g.pelvis.halfExtents.y, g.pelvis.halfExtents.z),
          m * f.pelvis,
          false,
        ).setTranslation(g.pelvis.center.x, g.pelvis.center.y, g.pelvis.center.z),
        body,
      );
      this.addTag(pelvis, playerId, 'core', 'pelvis', 'pelvis');
      const head = this.world.createCollider(
        this.colliderDesc(RAPIER.ColliderDesc.ball(g.head.radius), m * f.head, false).setTranslation(
          g.head.center.x,
          g.head.center.y,
          g.head.center.z,
        ),
        body,
      );
      this.addTag(head, playerId, 'head', 'head', 'head');
      colliders.push(support, torso, pelvis, head);
      supportShape = { radius: g.support.radius, halfHeight: g.support.halfHeight };
    }
    let guard: RAPIER.Collider | undefined;
    if (suspension) {
      if (profile.kind !== 'upperBodyCompound') throw new Error(`suspension support needs an upper-body compound (${profile.id})`);
      // The support capsule keeps its geometry and mass (player-player body collision and mass properties unchanged)
      // but no longer touches static ground: the suspension, not floor contact, holds the root height.
      support.setCollisionGroups(interactionGroups(0xffff, 0xffff & ~GROUP_STATIC));
      // Massless guard: bottom `bottomM` below the origin; it meets static ground only when the suspension is overcome
      // (bump stop) or disabled (falling). Contacts with players are filtered by the simulation's contact hook.
      const G = suspension.guard;
      guard = this.world.createCollider(
        this.colliderDesc(RAPIER.ColliderDesc.ball(G.radiusM), 0, true)
          .setTranslation(0, -G.bottomM + G.radiusM, 0)
          .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS),
        body,
      );
      this.addTag(guard, playerId, 'core', 'support', 'supportGuard');
    }
    body.recomputeMassPropertiesFromColliders();
    return { body, colliders, support, supportShape, guard };
  }

  /**
   * Contact motion: one massless physical leg collider on a supported proxy's body. Its shape carries the pose shape's
   * geometry in the body frame (`legHull`), the collider itself at the body origin with zero mass properties: Rapier
   * skips exactly-zero mass properties in a body's sum, so the body's mass, centre of mass and inertia stay bitwise what
   * they were (an offset or rotated massless collider re-rounds the f32 inertia). It meets other players' bodies only:
   * GROUP_LEGS excludes other leg colliders (and ground a suspension marks static); the simulation's contact hook
   * excludes the floor and obstacles in every fixture, support guards, and other proxies' support capsules (a supported
   * proxy's stand-in for its legs: leg on leg stays the pose guard's).
   * Colliders of one body never meet each other, so the proxy's own trunk is excluded too. Reshaped by `syncPhysicalLegs`.
   */
  addLegCollider(body: RAPIER.RigidBody, playerId: PlayerId, part: BodyPartId, region: ColliderRegion, hull: LegHull, key: string): RAPIER.Collider {
    const desc = (hull.r > 0 ? RAPIER.ColliderDesc.roundConvexHull(hull.points, hull.r) : RAPIER.ColliderDesc.convexHull(hull.points))!;
    const c = this.world.createCollider(
      this.colliderDesc(desc, 0, false)
        .setMassProperties(0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0, w: 1 })
        .setCollisionGroups(interactionGroups(GROUP_LEGS, 0xffff & ~GROUP_STATIC & ~GROUP_LEGS))
        .setActiveHooks(RAPIER.ActiveHooks.FILTER_CONTACT_PAIRS),
      body,
    );
    this.addTag(c, playerId, part, region, `${PHYS_LEG_KEY}:${key}`);
    return c;
  }

  /** A leg collider's new geometry (body frame). */
  reshapeLeg(c: RAPIER.Collider, hull: LegHull): void {
    c.setShape(hull.r > 0 ? new RAPIER.RoundConvexPolyhedron(hull.points, undefined, hull.r) : new RAPIER.ConvexPolyhedron(hull.points, undefined));
  }

  /** Static ground (turf, obstacles) joins GROUP_STATIC so a suspension support capsule can exclude it. */
  markStatic(c: RAPIER.Collider): void {
    c.setCollisionGroups(interactionGroups(GROUP_STATIC, 0xffff));
  }

  /**
   * Nearest collider straight below `origin` among `targets` (the caller passes static ground and, to detect an
   * obstructing player, other players' bodies; never the probing player's own colliders), searched to `maxDistM`.
   */
  groundProbe(origin: Vec3, maxDistM: number, targets: RAPIER.Collider[]): GroundHit | null {
    const ray = new RAPIER.Ray({ x: origin.x, y: origin.y, z: origin.z }, { x: 0, y: -1, z: 0 });
    let best: GroundHit | null = null;
    for (const c of targets) {
      const hit = c.castRayAndGetNormal(ray, maxDistM, true);
      if (!hit || (best && hit.timeOfImpact >= best.distM)) continue;
      best = { collider: c, distM: hit.timeOfImpact, pointWorld: v3(origin.x, origin.y - hit.timeOfImpact, origin.z), normal: vc(hit.normal) };
    }
    return best;
  }

  removeBody(body: RAPIER.RigidBody): void {
    const n = body.numColliders();
    for (let i = 0; i < n; i++) this.tags.delete(body.collider(i).handle);
    this.world.removeRigidBody(body);
  }

  massReport(body: RAPIER.RigidBody): MassReport {
    return {
      massKg: body.mass(),
      localCom: vc(body.localCom()),
      principalInertia: vc(body.principalInertia()),
      principalFrame: { ...body.principalInertiaLocalFrame() },
    };
  }

  /** Switch the support shape between supported (motor-owned traction) and passive friction. */
  setSupportFriction(c: RAPIER.Collider, supported: boolean): void {
    const s = this.solver;
    c.setFriction(supported ? s.supportedSupportFriction : s.passiveFriction);
    c.setFrictionCombineRule(combine(supported ? s.supportedSupportCombine : s.passiveFrictionCombine));
  }

  colliderPose(c: RAPIER.Collider): Pose {
    return { p: vc(c.translation()), q: { ...c.rotation() } };
  }

  /**
   * Every force-bearing manifold involving at least one player collider, oriented from `a` to `b`, where `a` is
   * the collider with the lower handle. Speculative points (no impulse, no penetration beyond `touchDistM`) are
   * skipped. One record per collider pair: when a pair has several manifolds, only the one with the most kept points
   * is returned (the first of equals); the others' points and impulse are dropped.
   */
  collectContacts(): ContactRec[] {
    const out: ContactRec[] = [];
    const seen = new Set<string>();
    const touch = this.solver.touchDistM;
    for (const [h, tag] of this.tags) {
      if (tag.playerId === null) continue;
      const c1 = this.world.getCollider(h);
      if (!c1) continue;
      this.world.contactPairsWith(c1, (c2) => {
        const lo = Math.min(c1.handle, c2.handle);
        const hi = Math.max(c1.handle, c2.handle);
        const k = `${lo}:${hi}`;
        if (seen.has(k)) return;
        seen.add(k);
        const ca = this.world.getCollider(lo);
        const cb = this.world.getCollider(hi);
        const ta = this.tags.get(lo);
        const tb = this.tags.get(hi);
        if (!ta || !tb) return;
        // arm self-clearance pairs (one ragdoll's forearm on its own trunk) are internal: never a contact record
        if (ta.key.startsWith('self') && tb.key.startsWith('self')) return;
        let best: ContactRec | null = null;
        this.world.contactPair(ca, cb, (m, flipped) => {
          const pts: ContactPointRec[] = [];
          const s1 = flipped ? cb : ca;
          const p1 = this.colliderPose(s1);
          let imp = 0;
          for (let i = 0; i < m.numContacts(); i++) {
            const d = m.contactDist(i);
            const ji = m.contactImpulse(i);
            // Real contact = the solver applied a normal impulse, or clear penetration. Manifold distances are
            // narrow-phase values and can read slightly positive for resting contact, so they alone are not used.
            if (!(ji > 1e-7 || d <= touch)) continue;
            const lp = m.localContactPoint1(i);
            if (!lp) continue;
            const pw = add(p1.p, qRot(p1.q, lp));
            imp += ji;
            pts.push({ pointWorld: pw, dist: d, impulse: ji });
          }
          if (pts.length === 0) return;
          // Local normal 1 is the outward normal of shape 1; express it from a toward b.
          const ln1 = m.localNormal1();
          let n = qRot(p1.q, ln1);
          if (flipped) n = neg(n);
          const rec: ContactRec = { a: ta, b: tb, normalAB: n, points: pts, impulse: imp };
          if (!best || rec.points.length > best.points.length) best = rec;
        });
        if (best) out.push(best);
      });
    }
    return out;
  }

  /** Closest-surface distance between two collider sets (negative = penetration) with witness points. */
  closestBetween(
    as: RAPIER.Collider[],
    bs: RAPIER.Collider[],
    maxDist = 50,
  ): { distance: number; pointA: Vec3; pointB: Vec3; normalA: Vec3; ca: RAPIER.Collider; cb: RAPIER.Collider } | null {
    let best: { distance: number; pointA: Vec3; pointB: Vec3; normalA: Vec3; ca: RAPIER.Collider; cb: RAPIER.Collider } | null =
      null;
    for (const a of as)
      for (const b of bs) {
        const r = a.contactCollider(b, maxDist);
        if (!r) continue;
        if (!best || r.distance < best.distance)
          best = { distance: r.distance, pointA: vc(r.point1), pointB: vc(r.point2), normalA: vc(r.normal1), ca: a, cb: b };
      }
    return best;
  }

  /**
   * Geometric clearance of a support capsule's lowest point above the floor plane (Y = 0). Used only at reset,
   * when contact manifolds are stale until the next solve (e.g. an airborne start lifted after settling).
   */
  supportClearance(support: RAPIER.Collider, shape: { radius: number; halfHeight: number }): number {
    const pose = this.colliderPose(support);
    const a = add(pose.p, qRot(pose.q, { x: 0, y: shape.halfHeight, z: 0 }));
    const b = add(pose.p, qRot(pose.q, { x: 0, y: -shape.halfHeight, z: 0 }));
    return Math.min(a.y, b.y) - shape.radius;
  }

  /** Supporting floor contact for a support collider (normal from support toward player, lower-region rule). */
  supportContact(
    support: RAPIER.Collider,
    supportShape: { radius: number; halfHeight: number },
    playerCom: Vec3,
  ): { supporting: boolean; anyFloor: boolean; normalUpDot: number; pointWorld: Vec3 | null; localY: number | null } {
    const s = this.solver;
    let res = { supporting: false, anyFloor: false, normalUpDot: 0, pointWorld: null as Vec3 | null, localY: null as number | null };
    const pose = this.colliderPose(support);
    this.world.contactPair(support, this.floorCollider, (m, flipped) => {
      const floorIsFirst = flipped; // contactPair(support, floor): shape1 = support unless flipped
      const sh1 = floorIsFirst ? this.floorCollider : support;
      const p1 = this.colliderPose(sh1);
      // normal1 is shape 1's outward normal: floor-first already points floor -> player; otherwise flip.
      let n = qRot(p1.q, m.localNormal1());
      if (!floorIsFirst) n = neg(n);
      // Defensive: the support normal must point toward the player's COM side of the contact.
      if (m.numContacts() > 0) {
        const lp0 = m.localContactPoint1(0);
        if (lp0 && dot(n, sub(playerCom, add(p1.p, qRot(p1.q, lp0)))) < 0) n = neg(n);
      }
      for (let i = 0; i < m.numContacts(); i++) {
        const d = m.contactDist(i);
        if (d > s.supportRegionTolM && !(m.contactImpulse(i) > 1e-7)) continue;
        const lp = m.localContactPoint1(i);
        if (!lp) continue;
        const pw = add(p1.p, qRot(p1.q, lp));
        res.anyFloor = true;
        const local = qInvRot(pose.q, sub(pw, pose.p));
        const upDot = n.y;
        const lowRegion = local.y <= -supportShape.halfHeight + s.supportRegionTolM;
        if (upDot > s.groundNormalMinDotUp && lowRegion) {
          res = { supporting: true, anyFloor: true, normalUpDot: upDot, pointWorld: pw, localY: local.y };
        } else if (!res.supporting) {
          res.normalUpDot = upDot;
          res.pointWorld = pw;
          res.localY = local.y;
        }
      }
    });
    return res;
  }
}
