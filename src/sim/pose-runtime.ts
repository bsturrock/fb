// Plan 10f (F9): the pose runtime, moved out of simulation.ts: each substep's sim-owned physical pose from the solved
// state (run-clip samples, walking arm swing, the foot plan's requests and observation, limb clearance against the
// other players' published limbs, the carry arm).
import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerId, SegmentId } from './contracts';
import { ARM_G2, DEFAULT_POSE_PROFILE, hipLocal, sideSignX } from './profiles';
import { buildProxyPose, legRequestLocal, poseLimbShapes, type PoseClearance, type PoseShape, type ProxyPoseInput } from './pose';
import { CARRY_ARM } from './carry';
import { idleStanceFade, idleTarget, idleWeight, idleWidthAddM, sampleIdle, type LocomotionProfile } from './locomotion';
import { initFeet, observeFeet, planFeet, releaseFeet, type FootEvent, type FootPlanInput } from './footwork';
import { colliderWorldPose, externalFromColliders, ragdollPose, SEGMENTS, type ExternalShape } from './ragdoll';
import { boxSeg, cullGeom, geomNear, LEG_HULL_EPS_M, solvedImpulses, trunkContact, trunkPieces, type CullGeom, type LegHull, type TrunkHit } from './physics';
import { playbackArmMean, playbackWidthAddM, playbackStance, shownSample, playbackSwingProgress, sampleRunClip, playbackSample, retargetSample, type RunPlayback } from './run-clip';
import type { ArmSide } from './contracts';
import { type Vec3, add, v3, vc, horiz, len, norm, qRot, sub, forwardOf, dot, clamp, qInvRot, addScaled, toWorld, smooth, scale, qFromUnitVectors, qFromAxisAngle, qMul, qNormalize, qConj, cross, type Quat } from './vec';
import { auditInput, keepLandmarks, recordTransition, type AuditHost } from './transition-audit';
import type { Simulation, PlayerRuntime } from './simulation';

/** What the pose runtime reads and writes on the simulation. */
export type PoseHost = AuditHost &
  Pick<
    Simulation,
    | 'activeColliders'
    | 'advanceLocomotion'
    | 'arms'
    | 'auditPrev'
    | 'coreBody'
    | 'def'
    | 'emit'
    | 'footInput'
    | 'idlePhaseOf'
    | 'obstacleColliders'
    | 'opts'
    | 'physics'
    | 'players'
    | 'poseClearance'
    | 'poseOf'
    | 'suspension'
    | 't'
  >;

// ------------------------------------------------------------------ Gate 4: sim-owned physical pose
export function updatePoses(host: PoseHost, dt: number): void {
  const R = host.def.ragdoll;
  // plan 07a: every player's published limbs before any pose of host substep is built (order independent)
  const limbs = publishedLimbs(host);
  for (const pl of host.players) {
    if (pl.rag) {
      pl.pose = ragdollPose(pl.rag);
      if (pl.feet) {
        const ev: FootEvent[] = [];
        releaseFeet(pl.feet, 'ragdoll', host.t, ev);
        emitFeet(host, pl, ev);
      }
      continue;
    }
    if (pl.body.kind !== 'upperBodyCompound') {
      pl.pose = null;
      continue;
    }
    const b = pl.proxy.body;
    const v = vc(b.linvel());
    const sp = len(horiz(v));
    // plan 06 order (legacy support): the locomotion phase advances here, after the solve; plan 06a (suspension):
    // it advanced before the support force of host substep and is only read here
    if (!pl.sus) host.advanceLocomotion(pl, dt);
    const core = host.poseOf(pl);
    const localV = qInvRot(core.q, v3(v.x, 0, v.z));
    const RP = R ?? DEFAULT_POSE_PROFILE;
    // plan 06: run-clip playback from solved travel (once per substep); the procedural gait is the bounded fallback
    let sampled: ReturnType<typeof retargetSample> | undefined;
    const P = host.def.runClips;
    if (pl.run && P) {
      const st = pl.run;
      // the sampled request is built at every weight (0 = the procedural targets through the same continuous leg
      // solve), so the clip fades in and out without a solver switch
      if (!pl.rag) sampled = sampledLimbsOf(host, pl, st, core);
    }
    const armObs = host.arms?.obs(pl.id);
    const arms = armObs
      ? Object.fromEntries(
          // disabled arms have no solved chain: they take the procedural pose
          (['left', 'right'] as ArmSide[])
            .filter((s) => armObs[s]?.enabled)
            .map((s) => [s, { shoulder: armObs[s]!.shoulderWorld, elbow: armObs[s]!.elbowWorld, wrist: armObs[s]!.wristWorld, palm: armObs[s]!.palmContactWorld }]),
        )
      : undefined;
    const poseIn: ProxyPoseInput = {
      playerId: pl.id,
      body: pl.body,
      ragdoll: RP,
      pose: core,
      gait: pl.gait,
      speed: pl.grounded && pl.controlMode === 'supported' ? sp : 0,
      arms,
      readyHands: !!pl.intent.debug?.readyHands,
      carriesBall: pl.setup.role === 'runner',
      ...(host.def.carry ? { carry: host.def.carry } : {}),
      ...(host.def.jointRange ? { jointRange: host.def.jointRange } : {}),
      localVelDir: sp > 0.2 ? v3(localV.x / sp, 0, localV.z / sp) : v3(0, 0, 1),
      clearance: R ? host.poseClearance(pl, limbs) : undefined,
      memory: pl.poseMemory,
      sampled,
      ground: pl.sus
        ? { y: pl.sus.probe.valid || Number.isFinite(pl.sus.probe.heightM) ? pl.sus.probe.groundY : 0, staggerM: pl.sus.staggerM, ...(pl.controlMode === 'falling' ? { bodyRelative: true } : {}) }
        : undefined,
      dtS: dt,
      handoffPossible: !!host.def.ragdoll && !pl.rag && !pl.handoff,
      ...(host.def.legGuard?.sweep ? { legSweep: true } : {}),
      ...(host.def.legGuard?.sweep && host.def.legGuard.ownLegs ? { legOwn: host.def.legGuard.ownLegs } : {}),
      ...(host.def.selfClearance?.seamSettle ? { selfSeam: true } : {}),
      ...(host.def.selfClearance?.upperArm ? { selfUpperArm: true } : {}),
      ...(host.def.selfClearance?.clipArmSwing ? { clipArmSwing: true } : {}),
      ...(host.def.locomotion ? { loco: { profile: host.def.locomotion, brakeB: pl.sus?.brakeB ?? 0, swing: walkSwing(pl, host.def.locomotion, core, sp, dt), contactW: pl.loco?.braceW ?? 0, ...idleOf(host, pl, sp) } } : {}),
      ...(host.opts.debug?.pose ? { debug: host.opts.debug.pose } : {}),
      ...(host.opts.debug?.poseProbe ? { probe: host.opts.debug.poseProbe } : {}),
    };
    // plan 07: the foot plan reads the solved state and host substep's ordinary leg requests, writes foot requests for
    // the same leg solve, then observes the achieved pose (pose only)
    const fp = pl.feet;
    let ftIn: FootPlanInput | null = null;
    const ev: FootEvent[] = [];
    if (fp && poseIn.ground) {
      poseIn.ground.fixedGait = true;
      ftIn = host.footInput(pl, poseIn, sampled, dt);
      poseIn.feet = fp.initialized ? planFeet(fp, ftIn, ev) : {};
    }
    const oldIn = host.opts.transitionAudit && ftIn ? auditInput(host, pl, poseIn, ftIn) : null;
    pl.pose = buildProxyPose(poseIn);
    if (host.def.legGuard?.physicalLegs) syncPhysicalLegs(host, pl);
    if (oldIn) recordTransition(host, pl, oldIn, poseIn, pl.pose);
    if (host.opts.transitionAudit) keepLandmarks(host, pl, poseIn, pl.pose);
    if (fp && ftIn) {
      if (!fp.initialized) initFeet(fp, pl.pose, ftIn, ev);
      else observeFeet(fp, pl.pose, ftIn.soleM, ftIn.groundY, ev, ftIn.t, ftIn.debug);
      emitFeet(host, pl, ev);
      const prev = host.auditPrev.get(pl.id);
      if (prev && host.opts.transitionAudit) prev.plan = structuredClone(fp);
    }
  }
}

// ------------------------------------------------------------------ contact motion: physical supported legs (rung 6)
/**
 * Contact motion prerequisite (`LegGuardProfile.physicalLegs`): a supported proxy's physical legs, rigid parts of its
 * body, so another body's contact on them is a contact on the proxy (the solver applies it once, equal and opposite).
 */
export interface PhysicalLegs {
  colliders: RAPIER.Collider[];
  /** Pose shape key per collider (`leftThigh`, `leftShin`, `leftShoe`, ...). */
  keys: string[];
  /**
   * Each collider's placement on the body before and after the last pose (body frame): the animated move. The impact
   * guard's closing speeds read it as a material-point move (legPointMove), the leg ledger as the capsule surface's advance
   * (legSurfaceAdvance; a shoe's material-point move). A capsule (thigh, shin) keeps its last frame carried by the swing
   * of its axis, without the twist about the axis that its placement from the world up axis takes (see syncPhysicalLegs).
   */
  prev: LegPlace[];
  now: LegPlace[];
  enabled: boolean;
  /**
   * Per collider: in the solve. A leg turns on only where it is clear of every body it meets (`legClear`), so the solve
   * never starts from a leg placed inside a body; once on it stays on while the legs are live.
   */
  on: boolean[];
}

/**
 * A physical leg's placement on its body (body frame): its frame, and for a capsule (along local Y) the half length of
 * its segment, the hull's end centres at `p` -/+ `h` along the axis.
 */
export interface LegPlace {
  p: Vec3;
  q: Quat;
  h?: number;
}

const RAGDOLL_SEGMENTS = new Set<string>(SEGMENTS);
/**
 * Whether a collider tag is a ragdoll segment collider (`<segment>:<region>`, ragdoll.ts): not a proxy's (torso, pelvis,
 * head, support capsule, support guard), a ragdoll's self-clearance shape or a physical leg.
 */
export function isRagdollSegment(t: { key: string }): boolean {
  const i = t.key.indexOf(':');
  return i > 0 && RAGDOLL_SEGMENTS.has(t.key.slice(0, i));
}

/**
 * Whether a collider (by its tag) is one a physical leg of `owner` meets in the solve (the contact hook, `addLegCollider`):
 * a segment collider of another player's ragdoll, and nothing else. Not another player's proxy (supported or falling:
 * torso, pelvis, head, support capsule or guard; supported against supported stays the proxy collision's and the pose
 * guards'), a ragdoll's self-clearance shapes, another physical leg, the floor or an obstacle. The physical legs are
 * there to stop a ragdoll passing into a supported player's legs.
 */
export function legMeets(t: { playerId: PlayerId | null; key: string } | undefined, owner: PlayerId): boolean {
  return !!t && t.playerId !== null && t.playerId !== owner && isRagdollSegment(t);
}

/** Depth (m) past which a leg coming on is not clear of a body it meets. */
const PHYS_LEG_ON_M = 0.001;
/** Prediction (m) of the coming-on query: the gap within which a closing body is read. */
const PHYS_LEG_ON_PREDICTION_M = 0.05;
/**
 * Whether leg collider `c` (at its body's pose now) is clear of every body it meets within PHYS_LEG_ON_M, also over the
 * coming substep: its gap less the closing at the contact over `aheadS`, the other body moving or stopped (the leg
 * guard's prediction). A leg that would come on into a strike stays off.
 */
function legClear(host: PoseHost, pl: PlayerRuntime, c: RAPIER.Collider, aheadS: number): boolean {
  const b = pl.proxy.body;
  const bp = b.translation();
  const bq = b.rotation();
  for (const o of host.players) {
    if (o === pl) continue;
    for (const k of host.activeColliders(o)) {
      if (!k.isEnabled() || !legMeets(host.physics.tags.get(k.handle), pl.id)) continue;
      const r = c.shape.contactShape(bp, bq, k.shape, k.translation(), k.rotation(), PHYS_LEG_ON_PREDICTION_M);
      if (!r) continue;
      const n = vc(r.normal1);
      const vSelf = dot(vc(b.velocityAtPoint(r.point1)), n);
      const vOther = dot(vc(k.parent()!.velocityAtPoint(r.point2)), n);
      if (r.distance - Math.max(0, vSelf - vOther, vSelf) * aheadS < -PHYS_LEG_ON_M) return false;
    }
  }
  return true;
}

const LEG_KEYS = ['leftThigh', 'leftShin', 'leftShoe', 'rightThigh', 'rightShin', 'rightShoe'];

/**
 * A pose leg shape's convex hull in the body frame (`LegHull`): the collider's geometry, the collider itself at the body
 * origin so that it adds nothing to the body's mass properties.
 */
export function legHull(s: PoseShape, bp: Vec3, bq: Quat): LegHull {
  const E = LEG_HULL_EPS_M;
  const pts: Vec3[] = [];
  const toBody = (w: Vec3): Vec3 => qInvRot(bq, sub(w, bp));
  if (s.kind === 'capsule') {
    const a = toBody(s.a);
    const b = toBody(s.b);
    const d = norm(sub(b, a), v3(0, 1, 0));
    const u = norm(cross(d, Math.abs(d.x) < 0.9 ? v3(1, 0, 0) : v3(0, 0, 1)), v3(0, 0, 1));
    const w = cross(d, u);
    for (const e of [a, b]) for (const su of [-1, 1]) for (const sw of [-1, 1]) pts.push(add(e, add(scale(u, su * E), scale(w, sw * E))));
    return { points: new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])), r: s.r - E };
  }
  if (s.kind === 'box') {
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(toBody(add(s.c, qRot(s.q, v3(sx * s.he.x, sy * s.he.y, sz * s.he.z)))));
    return { points: new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])), r: 0 };
  }
  const c = toBody(s.c);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(add(c, v3(sx * E, sy * E, sz * E)));
  return { points: new Float32Array(pts.flatMap((p) => [p.x, p.y, p.z])), r: s.r - E };
}

/**
 * The body-frame move, over the last pose step, of the leg material point now at `pBody` (body frame) on leg `i`: the
 * point taken into the leg's own frame at its current placement and back out at its previous one.
 */
export function legPointMove(L: Pick<PhysicalLegs, 'prev' | 'now'>, i: number, pBody: Vec3): Vec3 {
  const u = qInvRot(L.now[i].q, sub(pBody, L.now[i].p));
  return sub(pBody, add(L.prev[i].p, qRot(L.prev[i].q, u)));
}

/** Distance of `p` from a capsule placement's segment (all body frame). */
export function capsuleSegDist(p: Vec3, c: LegPlace): number {
  const d = qRot(c.q, v3(0, 1, 0));
  const r = sub(p, c.p);
  return len(sub(r, scale(d, clamp(dot(r, d), -c.h!, c.h!))));
}

/**
 * How far capsule leg `i`'s surface advanced, over the last pose step, at the point `pBody` (body frame): the point's
 * distance from the previous segment less its distance from the current one (the radius, the same in both, cancels).
 * Frame-free: it reads neither the frame's twist about the axis nor a material point carried by it (a material point
 * on the surface moved by D misses the surface's advance along the normal by about |D| times the axis swing).
 */
export function legSurfaceAdvance(L: Pick<PhysicalLegs, 'prev' | 'now'>, i: number, pBody: Vec3): number {
  return capsuleSegDist(pBody, L.prev[i]) - capsuleSegDist(pBody, L.now[i]);
}

/** The body-frame placement of a pose leg shape (a capsule along its local Y, or a box): the leg's own frame. */
function legPlacement(s: PoseShape, bp: Vec3, bq: Quat): LegPlace {
  if (s.kind === 'capsule') {
    const d = sub(s.b, s.a);
    const l = len(d);
    const qw = l > 1e-9 ? qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l)) : { x: 0, y: 0, z: 0, w: 1 };
    return { p: qInvRot(bq, sub(addScaled(s.a, d, 0.5), bp)), q: qNormalize(qMul(qConj(bq), qw)), h: 0.5 * l };
  }
  if (s.kind === 'box') return { p: qInvRot(bq, sub(s.c, bp)), q: qNormalize(qMul(qConj(bq), s.q)) };
  return { p: qInvRot(bq, sub(s.c, bp)), q: { x: 0, y: 0, z: 0, w: 1 } };
}

/**
 * Whether a player's legs are physical this substep: a supported proxy (no handoff) of a physical-legs profile, and
 * (D2) only while it stands on static ground. Players are never ground. Under the suspension: while its support probe
 * finds support-eligible static ground (`ok`) within the suspension's travel under it: not a player (`obstructed`),
 * not `none` or `beyondTravel` (up on another player or lifted), and (ladder 10b) not a refused surface or normal
 * (`invalidSurface`, `invalidNormal`): such a proxy has no support and sinks to its bottom-out, and its legs would stand
 * it on whatever body they meet, as they would over a player (L3-F9-noProbe-prep D, kicked up 1.45 m/s by R's pelvis
 * on its shin over the strip). Without the suspension there is no probe, and no suspension does not mean eligible: the
 * legacy support stands on static ground only while its support capsule rests on the floor collider (`grounded`, from
 * `supportContact`: the low region, an upward normal, the floor only, never a player).
 */
export function physicalLegsLive(host: Pick<PoseHost, 'def' | 'suspension' | 'opts'>, pl: PlayerRuntime): boolean {
  if (!host.def.legGuard?.physicalLegs || pl.rag || pl.handoff || pl.controlMode !== 'supported' || !host.def.ragdoll) return false;
  const S = host.suspension;
  const pr = pl.sus?.probe;
  if (!S || !pr) return pl.grounded;
  if (pr.heightM > S.probeMaxM) return false;
  if (pr.status === 'ok') return true;
  return !!host.opts.debug?.pose?.legsOnRefused && (pr.status === 'invalidSurface' || pr.status === 'invalidNormal');
}

/**
 * The physical legs follow the achieved pose (built after this substep's solve, used by the next): created on the first
 * live pose, placed on the body from the pose's leg shapes, disabled once they are not live (`physicalLegsLive`). A leg
 * comes on only clear of every body it meets (`legClear`). The previous placement is kept for the animated move.
 */
export function syncPhysicalLegs(host: PoseHost, pl: PlayerRuntime): void {
  if (!physicalLegsLive(host, pl) || !pl.pose) {
    disablePhysicalLegs(pl);
    return;
  }
  const b = pl.proxy.body;
  const bp = vc(b.translation());
  const bq = { ...b.rotation() };
  const shapes = poseLimbShapes(host.def.ragdoll!, pl.pose).filter((x) => LEG_KEYS.includes(x.key));
  const place = shapes.map((x) => legPlacement(x, bp, bq));
  const hulls = shapes.map((x) => legHull(x, bp, bq));
  if (!pl.legs) {
    const cs = shapes.map((x, i) => {
      const region = x.key.endsWith('Thigh') ? 'thigh' : x.key.endsWith('Shin') ? 'shin' : 'shoe';
      return host.physics.addLegCollider(b, pl.id, (x.key.endsWith('Shoe') ? x.key.replace('Shoe', 'Shin') : x.key) as SegmentId, region, hulls[i], x.key);
    });
    for (const c of cs) c.setEnabled(false);
    pl.legs = { colliders: cs, keys: shapes.map((x) => x.key), prev: place, now: place, enabled: false, on: cs.map(() => false) };
  } else pl.legs.colliders.forEach((c, i) => host.physics.reshapeLeg(c, hulls[i]));
  const L = pl.legs;
  // The animated move's frames. A capsule (thigh, shin) is the same shape at any twist about its axis, and its placement
  // frame from the world up axis (legPlacement) is singular for a leg pointing straight down: under its hip a thigh's frame
  // turned 18-90 degrees about the axis in substeps its axis swung 0.5-2.3 degrees, and a move read through it took the
  // twist for the leg surface moving into what it touched (the old tree: 1.03 J at 9.9 N s in one substep of
  // L3-F1-phase6, a guard closing speed of 38.8 m/s in L4-F9-prep where the surface moved at 1.8). A continuing capsule
  // keeps its last frame carried by the swing of its axis (no twist): the move is the surface's own.
  const moved = shapes.map((x, i) => {
    if (!L.enabled || x.kind !== 'capsule') return place[i];
    const q0 = L.now[i].q;
    return { p: place[i].p, q: qNormalize(qMul(qFromUnitVectors(qRot(q0, v3(0, 1, 0)), qRot(place[i].q, v3(0, 1, 0))), q0)), h: place[i].h };
  });
  L.prev = L.enabled ? L.now : moved;
  L.now = moved;
  L.enabled = true;
  L.colliders.forEach((c, i) => {
    if (L.on[i] || !legClear(host, pl, c, host.def.legGuard!.aheadS)) return;
    c.setEnabled(true);
    L.on[i] = true;
    // a leg coming on has no animated move yet
    L.prev[i] = L.now[i];
  });
}

/**
 * At a conversion (after the switch): each new ragdoll stands where its player's pose stood, and another player's
 * physical leg in the solve can lie inside one of its colliders, a body the leg never met as a proxy (`legMeets`). The
 * next solve would start from that overlap and resolve it on the whole proxy at once. Such a leg (deeper than
 * PHYS_LEG_ON_M in a collider of the new ragdolls) leaves the solve and comes on again like any leg, once clear
 * (`syncPhysicalLegs`). A leg merely near the new body, or closing on it, stays on: meeting it is what the leg is for.
 */
export function legsOffInsideConverted(host: Pick<PoseHost, 'players'>, converted: PlayerRuntime[]): void {
  // (the new ragdolls' collider poses from their bodies, as the candidate validation reads them)
  const shapes = converted.flatMap((x) => (x.rag ? x.rag.colliders.map((c) => ({ shape: c.collider.shape, pose: colliderWorldPose(x.rag!, c) })) : []));
  if (!shapes.length) return;
  for (const o of host.players) {
    const L = o.legs;
    if (!L?.enabled || converted.includes(o)) continue;
    const bp = o.proxy.body.translation();
    const bq = o.proxy.body.rotation();
    L.colliders.forEach((c, i) => {
      if (!L.on[i]) return;
      if (!shapes.some((k) => (c.shape.contactShape(bp, bq, k.shape, k.pose.p, k.pose.q, 0)?.distance ?? 0) < -PHYS_LEG_ON_M)) return;
      c.setEnabled(false);
      L.on[i] = false;
    });
  }
}

/** Physical legs off (kept on the body, out of the solve): not live, or the proxy leaves the supported mode. */
export function disablePhysicalLegs(pl: PlayerRuntime): void {
  if (!pl.legs?.enabled) return;
  for (const c of pl.legs.colliders) c.setEnabled(false);
  pl.legs.enabled = false;
  pl.legs.on.fill(false);
}

/**
 * The leg ledger (observation only), per player: what the physical legs' contacts did in the solves so far. `impulseNs`
 * and `maxLoadN` are the solver's normal impulse on the leg colliders (the same impulse acts on the proxy, opposite on
 * the other body). `injectedJ` is the work the legs' animated move (the pose placing them anew on the body between
 * solves, which the solver sees as a teleport) did on the other bodies: per loaded contact point the normal impulse
 * times how far the leg advanced there (a capsule: its surface, legSurfaceAdvance; a shoe: the material point's move
 * along the normal), positive when the leg was placed into the other body; `absorbedJ` the negative part. `maxDepthM` is
 * the deepest leg contact a solve started from, split by the solve's impulse at the point: loaded (> 0) and unloaded.
 */
export interface LegLedger {
  /** Solves with a leg impulse. */
  substeps: number;
  impulseNs: number;
  maxLoadN: number;
  /** The largest one-solve leg impulse (N s) and its solve's time. */
  maxStepNs: number;
  maxStepAt: number | null;
  injectedJ: number;
  absorbedJ: number;
  maxStepInjectedJ: number;
  maxDepthM: number;
  maxLoadedDepthM: number;
  loadedAt: LegDepthAt | null;
  maxUnloadedDepthM: number;
  unloadedAt: LegDepthAt | null;
  /** Solves with at least one unloaded leg contact point (negative distance, zero impulse). */
  unloadedSubsteps: number;
  /** Normal impulse per other collider (`player:key`, N s). */
  byOther: Record<string, number>;
}

/** Where a leg ledger depth was read: the solve's time (s), the leg (pose key) and the other collider (`player:key`). */
export interface LegDepthAt {
  t: number;
  leg: string;
  other: string;
}

export function newLegLedger(): LegLedger {
  return { substeps: 0, impulseNs: 0, maxLoadN: 0, maxStepNs: 0, maxStepAt: null, injectedJ: 0, absorbedJ: 0, maxStepInjectedJ: 0, maxDepthM: 0, maxLoadedDepthM: 0, loadedAt: null, maxUnloadedDepthM: 0, unloadedAt: null, unloadedSubsteps: 0, byOther: {} };
}

/**
 * After each solve (a physical-legs profile only): the physical legs' contacts into each player's leg ledger
 * (`Simulation.legLedger`, made on the first call). The solve's manifolds are read, never changed.
 */
export function observePhysicalLegs(host: Pick<PoseHost, 'physics' | 'players' | 't'> & { legLedger?: Map<PlayerId, LegLedger> }): void {
  const W = host.physics.world;
  const dt = host.physics.dt;
  const ledgers = (host.legLedger ??= new Map());
  for (const pl of host.players) {
    const L = pl.legs;
    if (!L?.enabled) continue;
    const bq = { ...pl.proxy.body.rotation() };
    let led = ledgers.get(pl.id);
    if (!led) ledgers.set(pl.id, (led = newLegLedger()));
    let stepImp = 0;
    let stepInj = 0;
    let stepUnloaded = false;
    L.colliders.forEach((c, i) => {
      W.contactPairsWith(c, (o) => {
        const tag = host.physics.tags.get(o.handle);
        const key = tag ? `${tag.playerId}:${tag.key}` : '?';
        W.contactPair(c, o, (m, flipped) => {
          const nw = vc(m.normal());
          const n = flipped ? scale(nw, -1) : nw;
          const J = host.physics.solver.solvedImpulses ? solvedImpulses(m, host.physics.colliderPose(flipped ? o : c), host.physics.colliderPose(flipped ? c : o)) : null;
          for (let k = 0; k < m.numContacts(); k++) {
            const ji = J ? J[k] : m.contactImpulse(k);
            const d = m.contactDist(k);
            if (ji <= 0 && d >= 0) continue;
            led!.maxDepthM = Math.max(led!.maxDepthM, -d);
            stepImp += ji;
            if (ji > 0) {
              if (-d > led!.maxLoadedDepthM) {
                led!.maxLoadedDepthM = -d;
                led!.loadedAt = { t: host.t, leg: L.keys[i], other: key };
              }
            } else {
              stepUnloaded = true;
              if (-d > led!.maxUnloadedDepthM) {
                led!.maxUnloadedDepthM = -d;
                led!.unloadedAt = { t: host.t, leg: L.keys[i], other: key };
              }
            }
            led!.byOther[key] = (led!.byOther[key] ?? 0) + ji;
            // the contact point on the leg (its collider frame: the body frame) and how far the pose advanced the leg there
            const lp = flipped ? m.localContactPoint2(k) : m.localContactPoint1(k);
            if (!lp || ji <= 0) continue;
            const w = ji * (L.now[i].h !== undefined ? legSurfaceAdvance(L, i, vc(lp)) : dot(n, qRot(bq, legPointMove(L, i, vc(lp)))));
            if (w > 0) stepInj += w;
            else led!.absorbedJ += -w;
          }
        });
      });
    });
    if (stepImp > 0) led.substeps++;
    if (stepUnloaded) led.unloadedSubsteps++;
    led.impulseNs += stepImp;
    led.maxLoadN = Math.max(led.maxLoadN, stepImp / dt);
    if (stepImp > led.maxStepNs) {
      led.maxStepNs = stepImp;
      led.maxStepAt = host.t;
    }
    led.injectedJ += stepInj;
    led.maxStepInjectedJ = Math.max(led.maxStepInjectedJ, stepInj);
  }
}

/** Plan 13e: the idle cycle at the player's phase and its weight (a locomotion profile with a cycle only). */
function idleOf(host: PoseHost, pl: PlayerRuntime, sp: number): { idle?: { sample: ReturnType<typeof sampleIdle>; w: number } } {
  const C = host.def.locomotion?.idle.cycle;
  if (!C || !pl.loco) return {};
  const w = idleWeight(pl.loco, idleTarget(sp, pl.loco.mode === 'free' && pl.grounded && pl.controlMode === 'supported'));
  return { idle: { sample: sampleIdle(C, host.idlePhaseOf(pl)), w } };
}

/** The clip's limb requests of a playback at the solved root. */
export function sampledLimbsOf(host: PoseHost, pl: PlayerRuntime, st: RunPlayback, core: ProxyPoseInput['pose']): ReturnType<typeof retargetSample> {
  const P = host.def.runClips!;
  const composed = !!pl.feet?.profile.compose;
  return retargetSample(composed ? shownSample(st, P) : (playbackSample(st, P) ?? sampleRunClip(P.clips[st.k], st.u)), composed ? (st.wF ?? smooth(st.w)) : st.w, pl.body, host.def.ragdoll ?? DEFAULT_POSE_PROFILE, core, st.heading, {
    armSwing: P.armSwing,
    carrySwing: P.carrySwing,
    restToe: P.clips[st.k].restToe,
    armMean: playbackArmMean(st, P),
    ...(P.stanceWidthAddM ? { widthAddM: playbackWidthAddM(st, P) } : {}),
    ...(st.stride !== undefined ? { strideScale: st.stride, ...(P.walk ? { carryShare: clamp(st.pos, 0, 1) } : {}) } : {}),
    ...(st.lift !== undefined ? { lift: st.lift } : {}),
    ...(host.def.carry ? { carryRaw: true } : {}),
    // plan 14: the composed pose's upright core takes the clip's free arms as the clip shows them (ground frame)
    ...(composed ? { groundArms: host.def.jointRange ? { shoulder: host.def.jointRange.shoulder } : {} } : {}),
  });
}

/**
 * Plan 10c C2: the arm the ball is actually on: the ragdoll's carried-ball segment (the 08a seat), else the pose's
 * carry arm of a ball carrier (`carriesBall`); null for a player without the ball.
 */
export function carrySideOf(pl: PlayerRuntime): ArmSide | null {
  const seg = pl.rag?.landmarks.carriedBall?.seg;
  if (seg) return seg.startsWith('left') ? 'left' : 'right';
  return pl.setup.role === 'runner' ? CARRY_ARM : null;
}

/**
 * Plan 08 walking arm swing (-1..1, + = right foot ahead): the achieved feet's fore-aft spread along the body, low-pass
 * filtered (the planner's steps are not continuous), faded in with the supported travel speed.
 */
export function walkSwing(pl: PlayerRuntime, P: LocomotionProfile, core: ProxyPoseInput['pose'], speed: number, dt: number): number {
  const fp = pl.feet;
  if (!fp || !fp.initialized) return 0;
  const fwd = forwardOf(core.q);
  const fwdH = norm(v3(fwd.x, 0, fwd.z), v3(0, 0, 1));
  const d = dot(sub(fp.feet.right.ankleW, fp.feet.left.ankleW), fwdH);
  const W = P.walk;
  const supported = pl.grounded && pl.controlMode === 'supported';
  const want = supported ? clamp(d / W.strideM, -1, 1) * smooth((speed - W.fadeMps[0]) / (W.fadeMps[1] - W.fadeMps[0])) : 0;
  const st = pl.loco!;
  st.swing += (want - st.swing) * (dt > 0 ? 1 - Math.exp(-dt / W.tauS) : 0);
  return st.swing;
}

/** Foot planner input from the solved state, the support probe and control mode, and the pose path's requests. */
export function footInputOf(host: PoseHost, pl: PlayerRuntime, inp: ProxyPoseInput, sampled: ProxyPoseInput['sampled'], dt: number): FootPlanInput {
  const R = inp.ragdoll;
  const core = inp.pose;
  const b = pl.proxy.body;
  const v = vc(b.linvel());
  const soleM = R.shoe.belowAnkleM + R.shoe.halfExtents.y;
  const gy = inp.ground!.y;
  const fwd = forwardOf(core.q);
  const fwdH = norm(v3(fwd.x, 0, fwd.z), v3(0, 0, 1));
  const rw = qRot(core.q, v3(sideSignX(pl.body, 'right'), 0, 0));
  const rightW = norm(v3(rw.x, 0, rw.z), v3(1, 0, 0));
  const hips = {} as FootPlanInput['hips'];
  const home = {} as FootPlanInput['home'];
  const request = {} as FootPlanInput['request'];
  for (const s of ['left', 'right'] as ArmSide[]) {
    const hip = toWorld(core, hipLocal(pl.body, s));
    hips[s] = hip;
    const st = (s === 'left' ? 0.5 : -0.5) * (inp.ground?.staggerM ?? 0);
    // plan 08: the fitted idle stance opens as the travel stops (the same width as the ordinary request)
    const wide = inp.loco ? idleWidthAddM(inp.loco.profile, pl.body, s) * (s === 'left' ? -1 : 1) * idleStanceFade(inp.speed) : 0;
    // plan 13e: the home leaves out the idle sway's displacement (the feet stay where the body stood)
    const sw = (!host.opts.debug?.foot?.swayInHome && pl.swayM) || v3();
    home[s] = v3(hip.x + fwdH.x * st + rightW.x * wide - sw.x, gy + soleM, hip.z + fwdH.z * st + rightW.z * wide - sw.z);
    request[s] = toWorld(core, legRequestLocal(inp, s));
  }
  const P = host.def.runClips;
  let clip: FootPlanInput['clip'] = null;
  if (pl.run && P && pl.run.w > 0 && sampled) {
    const contact = {} as NonNullable<FootPlanInput['clip']>['contact'];
    for (const s of ['left', 'right'] as ArmSide[]) {
      const c = sampled.legs[s].contact;
      contact[s] = c ? { weight: c.weight, rollF: c.rollF, toeZ: c.toeZ } : null;
    }
    clip = { weight: pl.run.w, headingRad: pl.run.heading, stance: playbackStance(pl.run, P), contact, swingP: playbackSwingProgress(pl.run, P) };
  }
  const sus = pl.sus!;
  return {
    t: host.t,
    dt,
    core,
    vel: v3(v.x, 0, v.z),
    yawRate: b.angvel().y,
    supported: pl.controlMode === 'supported' && sus.probe.valid,
    falling: pl.controlMode === 'falling',
    ragdoll: !!pl.rag,
    groundY: gy,
    hips,
    home,
    request,
    clip,
    soleM,
    // reactive plants: the toe pivot of the footprint midway between the shoe centre and its tip (no clip toe base)
    toeM: R.shoe.forwardM + 0.5 * R.shoe.halfExtents.z,
    rightW,
    sideSign: { left: -1, right: 1 },
    brakeB: sus.brakeB,
    contactHold: pl.loco?.mode === 'contact',
    others: host.players.filter((o) => o !== pl).map((o) => {
      const c = host.coreBody(o).translation();
      return v3(c.x, 0, c.z);
    }),
    ...(host.def.jointRange ? { heelLift: true } : {}),
    ...(host.opts.debug?.foot ? { debug: host.opts.debug.foot } : {}),
  };
}

export function emitFeet(host: PoseHost, pl: PlayerRuntime, ev: FootEvent[]): void {
  for (const e of ev) host.emit(e.type, pl.id, { side: e.side, ...e.data });
}

/** Prediction (m) of the clearance's depth queries: a pair within it reads its gap (or depth). */
const DEPTH_PREDICTION_M = 0.02;

/**
 * Supported-state limb constraints for the procedural pose: penetration of candidate limb shapes against other
 * players' active colliders, diagnostic obstacles and opponents' achieved query-arm segments (external), and of
 * forearm/palm against the player's own torso/pelvis (self).
 */
export function poseClearanceOf(host: PoseHost, pl: PlayerRuntime, limbs?: Map<PlayerId, ExternalShape[]>): PoseClearance {
  const ext: ExternalShape[] = [];
  const soft: ExternalShape[] = [];
  for (const o of host.players) {
    if (o === pl) continue;
    ext.push(...liveExternals(host.activeColliders(o), () => o.id));
    // plan 07a (ground-relative poses): another player's published limbs are physical for host player's procedural
    // limbs while that player can still convert (they become its ragdoll colliders at the switch, possibly in the same
    // batch); a ragdoll's limbs are already active colliders
    if (pl.sus && limbs && host.def.ragdoll && !o.rag && !o.handoff) {
      const ls = limbs.get(o.id);
      if (ls) ext.push(...ls);
    }
    const ao = host.arms?.obs(o.id);
    if (ao && !o.rag)
      for (const sd of ['left', 'right'] as ArmSide[]) {
        const a = ao[sd];
        if (!a || !a.enabled) continue;
        const A = host.def.armProfile ?? ARM_G2;
        for (const sh of [capsuleShape(a.shoulderWorld, a.elbowWorld, A.upperArmRadiusM), capsuleShape(a.elbowWorld, a.wristWorld, A.forearmRadiusM)]) if (sh) soft.push({ key: `${o.id}:arm`, ...sh });
      }
  }
  ext.push(...liveExternals(host.obstacleColliders, () => 'obstacle'));
  const own: ExternalShape[] = [];
  for (const c of pl.proxy.colliders) {
    const t = host.physics.tags.get(c.handle);
    if (t && (t.region === 'torso' || t.region === 'pelvis')) own.push({ key: t.region, shape: c.shape, pose: { p: vc(c.translation()), q: { ...c.rotation() } }, collider: c });
  }
  // arm self-clearance: the measured trunk pieces at the proxy pose, for the arms' self shapes only
  const SC = host.def.selfClearance;
  const trunk = SC ? trunkPieces(pl.body) : null;
  const bodyPose = { p: vc(pl.proxy.body.translation()), q: { ...pl.proxy.body.rotation() } };
  // plan 13a: a pair farther apart than the query's prediction (bounding spheres, then enclosing capsules) returns
  // nothing, so it is not queried, and a limb's Rapier shape is built only once some pair survives (exact: depth and push
  // read only returns)
  const geoms = new Map<ExternalShape, CullGeom>();
  const geomOf = (e: ExternalShape): CullGeom => {
    let g = geoms.get(e);
    if (!g) geoms.set(e, (g = cullGeom(e.shape, e.pose.p, e.pose.q)));
    return g;
  };
  // contact motion prerequisite (ladder rung 1), exact repeats: within one pose build the checks ask the same query more
  // than once (a step's shapes are rebuilt by each check; the leg guard asks the plain externals and then them with the
  // moved ones). A query is the pose shape (by value), the external shape (the object: its collider or its pose, fixed
  // within the build, see liveExternals) and the prediction; the same query has the same answer, so each is asked once
  // and its answer reused. The answers live with this clearance, built for one player's pose in one substep (the
  // transition audit's replays of that pose read the same answers) and dropped with it: nothing is reused across substeps
  const answers = new Map<ExternalShape, Map<string, RAPIER.ShapeContact | null>>();
  const contact = (sk: string, q: { shape: RAPIER.Shape; pose: { p: Vec3; q: Quat } }, e: ExternalShape, prediction: number): RAPIER.ShapeContact | null => {
    let m = answers.get(e);
    if (!m) answers.set(e, (m = new Map()));
    const k = `${prediction}|${sk}`;
    let r = m.get(k);
    if (r === undefined) m.set(k, (r = e.collider ? e.collider.contactShape(q.shape, q.pose.p, q.pose.q, prediction) : e.shape.contactShape(e.pose.p, e.pose.q, q.shape, q.pose.p, q.pose.q, prediction)));
    return r;
  };
  const depth = (shapes: PoseShape[], against: ExternalShape[]): number => {
    let d = 0;
    for (const s of shapes) {
      const b = poseCullGeom(s);
      const sk = poseShapeKey(s);
      let q: ReturnType<typeof poseShapeToRapier> | undefined;
      for (const e of against) {
        if (!geomNear(geomOf(e), b, DEPTH_PREDICTION_M)) continue;
        if (q === undefined) q = poseShapeToRapier(s);
        if (!q) break;
        const r = contact(sk, q, e, DEPTH_PREDICTION_M);
        if (r) d = Math.max(d, -r.distance);
      }
    }
    return d;
  };
  // the push reads penetrating contacts only (distance < 0), and a returned penetrating contact does not depend on the
  // query's prediction (the prediction only admits separated pairs; tests/harness.test.ts checks it on random pairs of every
  // shape kind), so the push asks at the depth checks' prediction: the push of a shape the depth check measured (each
  // push-out step's) reuses that answer. Only pairs that can penetrate are asked (the cull at 0)
  // (a tolerance per external shape, `tolOf`: per shape the deepest excess over its own tolerance)
  const pushAgainst = (shapes: PoseShape[], toleranceM: number, against: ExternalShape[], tolOf?: (e: ExternalShape) => number): Vec3 => {
    const v = v3();
    for (const s of shapes) {
      const b = poseCullGeom(s);
      const sk = poseShapeKey(s);
      let q: ReturnType<typeof poseShapeToRapier> | undefined;
      let best: { d: number; n: Vec3 } | null = null;
      for (const e of against) {
        if (!geomNear(geomOf(e), b, 0)) continue;
        if (q === undefined) q = poseShapeToRapier(s);
        if (!q) break;
        const r = contact(sk, q, e, DEPTH_PREDICTION_M);
        if (!r || !(r.distance < 0)) continue;
        if (tolOf) {
          const x = -r.distance - tolOf(e);
          if (!best || x > best.d) best = { d: x, n: vc(r.normal1) };
        } else if (!best || -r.distance > best.d) best = { d: -r.distance, n: vc(r.normal1) };
      }
      if (best) Object.assign(v, addScaled(v, best.n, Math.max(0, tolOf ? best.d : best.d - toleranceM)));
    }
    return v;
  };
  const push = (shapes: PoseShape[], toleranceM = 0): Vec3 => pushAgainst(shapes, toleranceM, ext);
  // plan 13f (a leg-guard profile): every external collider on a moving body, moved by its motion relative to the posing
  // player over the profile's prediction time (its point velocity at the collider centre less the player's own there;
  // its rotation by its body's angular velocity). Static colliders and published limbs (poses: no velocity) stay as they
  // are, so they are measured by the plain query. Built on the first leg query of the pose
  const LG = host.def.legGuard;
  // contact motion (`physicalLegs`, live): the shapes the physical legs meet in the solve (the contact hook, `legMeets`):
  // another player's ragdoll segment colliders (not a proxy's, the floor, obstacles or published limbs: a supported or
  // falling proxy's parts keep the HARD_OK checks alone), with their predicted copies (`met`) and, for each on a moving
  // body, the same body stopped (`stopped`): moved by the posing player's own motion only. The solve can stop the other body (a body on the
  // floor stops on it, and gives way to nothing), so a physical leg clears it there as well (D1). Only the physical-leg
  // target reads these; the HARD_OK checks keep the 13f prediction alone
  const legsLive = physicalLegsLive(host, pl);
  const meets = (e: ExternalShape): boolean => legsLive && !!e.collider && legMeets(host.physics.tags.get(e.collider.handle), pl.id);
  const met = new Set<ExternalShape>();
  const stopped: ExternalShape[] = [];
  let ahead: ExternalShape[] | null = null;
  const aheadOf = (): ExternalShape[] => {
    if (ahead) return ahead;
    ahead = [];
    if (host.opts.debug?.pose?.noLegAhead) return ahead;
    const self = pl.proxy.body;
    for (const e of ext) {
      const b = e.collider?.parent();
      if (!b || b.isFixed()) continue;
      const dv = sub(vc(b.velocityAtPoint(e.pose.p)), vc(self.velocityAtPoint(e.pose.p)));
      const w = vc(b.angvel());
      const wl = len(w);
      const q = wl > 1e-9 ? qNormalize(qMul(qFromAxisAngle(scale(w, 1 / wl), wl * LG!.aheadS), e.pose.q)) : e.pose.q;
      const a = { key: `${e.key}@ahead`, shape: e.shape, pose: { p: addScaled(e.pose.p, dv, LG!.aheadS), q } };
      ahead.push(a);
      if (meets(e)) {
        met.add(a);
        // fault (PoseDebug.noLegStop): the met bodies are taken to keep moving as the prediction has them
        if (!host.opts.debug?.pose?.noLegStop) stopped.push({ key: `${e.key}@stopped`, shape: e.shape, pose: { p: addScaled(e.pose.p, vc(self.velocityAtPoint(e.pose.p)), -LG!.aheadS), q: e.pose.q } });
      }
    }
    return ahead;
  };
  // the push from whichever is deeper, per shape: the plain and the moved colliders together
  // contact motion prerequisite (`LegGuardProfile.sweep`): the physical colliders alone (live colliders and obstacles;
  // another supported player's published limbs carry none), what a conversion validates
  let phys: ExternalShape[] | null = null;
  const physOf = (): ExternalShape[] => (phys ??= ext.filter((e) => !!e.collider));
  let metShapes: { here: ExternalShape[]; ahead: ExternalShape[]; all: Set<ExternalShape> } | null = null;
  const metOf = (): NonNullable<typeof metShapes> => {
    if (metShapes) return metShapes;
    const A = aheadOf();
    const here = ext.filter(meets);
    const ah = A.filter((a) => met.has(a));
    return (metShapes = { here, ahead: ah, all: new Set([...here, ...ah, ...stopped]) });
  };
  const legAhead = LG
    ? {
        external: (shapes: PoseShape[]) => Math.max(depth(shapes, ext), depth(shapes, aheadOf())),
        push: (shapes: PoseShape[], toleranceM = 0) => pushAgainst(shapes, toleranceM, [...ext, ...aheadOf()]),
        physical: (shapes: PoseShape[]) => Math.max(depth(shapes, physOf()), depth(shapes, aheadOf())),
        ...(legsLive
          ? {
              // the bodies the physical legs meet: where they stand, where the prediction puts them, and stopped
              met: (shapes: PoseShape[]) => {
                const M = metOf();
                return Math.max(depth(shapes, M.here), depth(shapes, M.ahead), depth(shapes, stopped));
              },
              // the push to `metToleranceM` against those, to `toleranceM` against every other shape
              pushMet: (shapes: PoseShape[], toleranceM: number, metToleranceM: number) => {
                const M = metOf();
                return pushAgainst(shapes, toleranceM, [...ext, ...aheadOf(), ...stopped], (e) => (M.all.has(e) ? metToleranceM : toleranceM));
              },
            }
          : {}),
      }
    : undefined;
  // arm self-clearance: depth beyond the profile tolerance (skin contact is clear) and the separating move from the trunk.
  // The deepest trunk contact of a shape (the trunk at the player's pose, fixed within the build) is kept per shape like the
  // other answers; the push reads penetrating hits only, so it asks at the depth's prediction and reuses its answer: the
  // deepest hit, when it penetrates, is the same at either prediction (each piece's penetrating contact is, and a piece the
  // larger prediction adds is separated), and when it does not, no piece penetrates
  const trunkAnswers = new Map<string, TrunkHit | null>();
  const trunkHits = (shapes: PoseShape[], each: (h: TrunkHit) => void): void => {
    for (const s of shapes) {
      const sk = poseShapeKey(s);
      let h = trunkAnswers.get(sk);
      if (h === undefined) {
        const q = poseShapeToRapier(s);
        if (!q) continue;
        const bd = poseShapeBound(s);
        trunkAnswers.set(sk, (h = trunkContact(trunk!, bodyPose, q.shape, q.pose.p, q.pose.q, bd.c, bd.r, DEPTH_PREDICTION_M)));
      }
      if (h) each(h);
    }
  };
  const body = (shapes: PoseShape[]): number => {
    let d = 0;
    trunkHits(shapes, (h) => (d = Math.max(d, -h.distance)));
    return Math.max(0, d - SC!.toleranceM);
  };
  const bodyPush = (shapes: PoseShape[]): Vec3 => {
    const v = v3();
    trunkHits(shapes, (h) => {
      if (h.distance < 0) Object.assign(v, addScaled(v, h.normal1, Math.max(0, -h.distance - SC!.toleranceM)));
    });
    return v;
  };
  return { external: (shapes) => depth(shapes, ext), soft: (shapes) => depth(shapes, soft), self: (shapes) => depth(shapes, own), push, ...(trunk ? { body, bodyPush } : {}), ...(legAhead ? { legs: legAhead } : {}) };
}

/**
 * Plan 07a: candidate-equivalent limb and shoe shapes of every non-ragdoll player's published pose (the pose of the
 * last substep), keyed `<id>:<segment>`. Read once before the poses of a substep are built, so no player sees another
 * player's pose of the same substep (player order cannot decide who yields).
 */
export function publishedLimbs(host: PoseHost): Map<PlayerId, ExternalShape[]> {
  const out = new Map<PlayerId, ExternalShape[]>();
  const R = host.def.ragdoll;
  if (!R || !host.suspension) return out;
  for (const o of host.players) {
    if (o.rag || !o.pose || o.body.kind !== 'upperBodyCompound') continue;
    const ls: ExternalShape[] = [];
    for (const s of poseLimbShapes(R, o.pose)) {
      const q = poseShapeToRapier(s);
      if (q) ls.push({ key: `${o.id}:${s.key}`, shape: q.shape, pose: q.pose });
    }
    out.set(o.id, ls);
  }
  return out;
}

function capsuleShape(a: Vec3, b: Vec3, r: number): { shape: RAPIER.Shape; pose: { p: Vec3; q: Quat } } | null {
  const d = sub(b, a);
  const l = len(d);
  if (l < 1e-6) return { shape: new RAPIER.Ball(r), pose: { p: a, q: { x: 0, y: 0, z: 0, w: 1 } } };
  return { shape: new RAPIER.Capsule(l / 2, r), pose: { p: addScaled(a, d, 0.5), q: qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l)) } };
}

/**
 * Plan 13a: externals of live colliders that keep their collider, so the clearance queries convert only the pose shape
 * (the clearance is built and queried within one pose build; no physics step moves the colliders in between).
 */
function liveExternals(cs: RAPIER.Collider[], keyOf: (c: RAPIER.Collider) => string): ExternalShape[] {
  return externalFromColliders(cs, keyOf).map((e, i) => ({ ...e, collider: cs[i] }));
}

/** Cull geometry of a pose shape (plan 13a): bounding sphere, enclosing capsule (exact for a ball or capsule) and box. */
function poseCullGeom(s: PoseShape): CullGeom {
  if (s.kind === 'ball') return { c: s.c, r: s.r, seg: { a: s.c, b: s.c, r: s.r } };
  if (s.kind === 'box') return { c: s.c, r: len(s.he), seg: boxSeg(s.c, s.he, s.q), box: { c: s.c, he: s.he, q: s.q } };
  return { c: scale(add(s.a, s.b), 0.5), r: 0.5 * len(sub(s.b, s.a)) + s.r, seg: { a: s.a, b: s.b, r: s.r } };
}

/**
 * A pose shape's query identity: its kind and every number its Rapier shape and pose are built from (poseShapeToRapier),
 * exactly (-0 kept apart from 0).
 */
function poseShapeKey(s: PoseShape): string {
  const n = (x: number): string => (Object.is(x, -0) ? '-0' : String(x));
  if (s.kind === 'ball') return `b${n(s.c.x)},${n(s.c.y)},${n(s.c.z)},${n(s.r)}`;
  if (s.kind === 'box') return `x${n(s.c.x)},${n(s.c.y)},${n(s.c.z)},${n(s.he.x)},${n(s.he.y)},${n(s.he.z)},${n(s.q.x)},${n(s.q.y)},${n(s.q.z)},${n(s.q.w)}`;
  return `c${n(s.a.x)},${n(s.a.y)},${n(s.a.z)},${n(s.b.x)},${n(s.b.y)},${n(s.b.z)},${n(s.r)}`;
}

/** Bounding sphere of a pose shape. */
function poseShapeBound(s: PoseShape): { c: Vec3; r: number } {
  if (s.kind === 'ball') return { c: s.c, r: s.r };
  if (s.kind === 'box') return { c: s.c, r: len(s.he) };
  return { c: scale(add(s.a, s.b), 0.5), r: 0.5 * len(sub(s.b, s.a)) + s.r };
}

function poseShapeToRapier(s: PoseShape): { shape: RAPIER.Shape; pose: { p: Vec3; q: Quat } } | null {
  if (s.kind === 'ball') return { shape: new RAPIER.Ball(s.r), pose: { p: s.c, q: { x: 0, y: 0, z: 0, w: 1 } } };
  if (s.kind === 'box') return { shape: new RAPIER.Cuboid(s.he.x, s.he.y, s.he.z), pose: { p: s.c, q: s.q } };
  return capsuleShape(s.a, s.b, s.r);
}
