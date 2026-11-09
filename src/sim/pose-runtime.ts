// Plan 10f (F9): the pose runtime, moved out of simulation.ts: each substep's sim-owned physical pose from the solved
// state (run-clip samples, walking arm swing, the foot plan's requests and observation, limb clearance against the
// other players' published limbs, the carry arm).
import RAPIER from '@dimforge/rapier3d-compat';
import type { PlayerId } from './contracts';
import { ARM_G2, DEFAULT_POSE_PROFILE, hipLocal, sideSignX } from './profiles';
import { buildProxyPose, legRequestLocal, poseLimbShapes, type PoseClearance, type PoseShape, type ProxyPoseInput } from './pose';
import { CARRY_ARM } from './carry';
import { idleStanceFade, idleWidthAddM, type LocomotionProfile } from './locomotion';
import { initFeet, observeFeet, planFeet, releaseFeet, type FootEvent, type FootPlanInput } from './footwork';
import { externalFromColliders, ragdollPose, type ExternalShape } from './ragdoll';
import { boxSeg, cullGeom, geomNear, trunkContact, trunkPieces, type CullGeom, type TrunkHit } from './physics';
import { playbackArmMean, playbackWidthAddM, playbackStance, shownSample, playbackSwingProgress, sampleRunClip, playbackSample, retargetSample, type RunPlayback } from './run-clip';
import type { ArmSide } from './contracts';
import { type Vec3, add, v3, vc, horiz, len, norm, qRot, sub, forwardOf, dot, clamp, qInvRot, addScaled, toWorld, smooth, scale, qFromUnitVectors, type Quat } from './vec';
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
    | 'def'
    | 'emit'
    | 'footInput'
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
      ...(host.def.locomotion ? { loco: { profile: host.def.locomotion, brakeB: pl.sus?.brakeB ?? 0, swing: walkSwing(pl, host.def.locomotion, core, sp, dt), contactW: pl.loco?.braceW ?? 0 } } : {}),
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
    if (oldIn) recordTransition(host, pl, oldIn, poseIn, pl.pose);
    if (host.opts.transitionAudit) keepLandmarks(host, pl, poseIn, pl.pose);
    if (fp && ftIn) {
      if (!fp.initialized) initFeet(fp, pl.pose, ftIn, ev);
      else observeFeet(fp, pl.pose, ftIn.soleM, ftIn.groundY, ev, ftIn.t);
      emitFeet(host, pl, ev);
      const prev = host.auditPrev.get(pl.id);
      if (prev && host.opts.transitionAudit) prev.plan = structuredClone(fp);
    }
  }
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
    ...(st.stride !== undefined ? { strideScale: st.stride, carryShare: clamp(st.pos, 0, 1) } : {}),
    ...(host.def.carry ? { carryRaw: true } : {}),
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
    home[s] = v3(hip.x + fwdH.x * st + rightW.x * wide, gy + soleM, hip.z + fwdH.z * st + rightW.z * wide);
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
    ...(host.def.jointRange ? { heelLift: true } : {}),
    ...(host.opts.debug?.foot ? { debug: host.opts.debug.foot } : {}),
  };
}

export function emitFeet(host: PoseHost, pl: PlayerRuntime, ev: FootEvent[]): void {
  for (const e of ev) host.emit(e.type, pl.id, { side: e.side, ...e.data });
}

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
  const depth = (shapes: PoseShape[], against: ExternalShape[]): number => {
    let d = 0;
    for (const s of shapes) {
      const b = poseCullGeom(s);
      let q: ReturnType<typeof poseShapeToRapier> | undefined;
      for (const e of against) {
        if (!geomNear(geomOf(e), b, 0.02)) continue;
        if (q === undefined) q = poseShapeToRapier(s);
        if (!q) break;
        const r = e.collider ? e.collider.contactShape(q.shape, q.pose.p, q.pose.q, 0.02) : e.shape.contactShape(e.pose.p, e.pose.q, q.shape, q.pose.p, q.pose.q, 0.02);
        if (r) d = Math.max(d, -r.distance);
      }
    }
    return d;
  };
  const push = (shapes: PoseShape[], toleranceM = 0): Vec3 => {
    const v = v3();
    for (const s of shapes) {
      const b = poseCullGeom(s);
      let q: ReturnType<typeof poseShapeToRapier> | undefined;
      let best: { d: number; n: Vec3 } | null = null;
      for (const e of ext) {
        if (!geomNear(geomOf(e), b, 0)) continue;
        if (q === undefined) q = poseShapeToRapier(s);
        if (!q) break;
        const r = e.collider ? e.collider.contactShape(q.shape, q.pose.p, q.pose.q, 0) : e.shape.contactShape(e.pose.p, e.pose.q, q.shape, q.pose.p, q.pose.q, 0);
        if (r && r.distance < 0 && (!best || -r.distance > best.d)) best = { d: -r.distance, n: vc(r.normal1) };
      }
      if (best) Object.assign(v, addScaled(v, best.n, Math.max(0, best.d - toleranceM)));
    }
    return v;
  };
  // arm self-clearance: depth beyond the profile tolerance (skin contact is clear) and the separating move from the trunk
  const trunkHits = (shapes: PoseShape[], prediction: number, each: (h: TrunkHit) => void): void => {
    for (const s of shapes) {
      const q = poseShapeToRapier(s);
      if (!q) continue;
      const bd = poseShapeBound(s);
      const h = trunkContact(trunk!, bodyPose, q.shape, q.pose.p, q.pose.q, bd.c, bd.r, prediction);
      if (h) each(h);
    }
  };
  const body = (shapes: PoseShape[]): number => {
    let d = 0;
    trunkHits(shapes, 0.02, (h) => (d = Math.max(d, -h.distance)));
    return Math.max(0, d - SC!.toleranceM);
  };
  const bodyPush = (shapes: PoseShape[]): Vec3 => {
    const v = v3();
    trunkHits(shapes, 0, (h) => {
      if (h.distance < 0) Object.assign(v, addScaled(v, h.normal1, Math.max(0, -h.distance - SC!.toleranceM)));
    });
    return v;
  };
  return { external: (shapes) => depth(shapes, ext), soft: (shapes) => depth(shapes, soft), self: (shapes) => depth(shapes, own), push, ...(trunk ? { body, bodyPush } : {}) };
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
