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

/** Collision-group membership bit of static ground (turf and obstacles) when a suspension player exists. */
export const GROUP_STATIC = 0x0001;
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

  constructor(readonly solver: SolverProfile) {
    this.world = new RAPIER.World({ x: 0, y: solver.gravityY, z: 0 });
    this.dt = solver.outerTickS / solver.substeps;
    this.world.timestep = this.dt;
    this.world.numSolverIterations = solver.solverIterations;
    this.floorBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
    this.floorCollider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(40, 0.5, 40)
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
