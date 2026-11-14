// BodyAndContact arm authority (Gate 2). Controllers request arm actions; this module owns achieved arm geometry,
// palm surface holds (grips), forearm clamps, the shared per-owner arm-force budget and the force pairs applied to
// both bodies. Arms are query-only shapes: they never push bodies except through the bounded laws below.
//
// Query implementation: Rapier Shape.contactShape against the opponents' actual collider shapes.
//  - Palm sweep (owner frame): subdivided so the palm moves <= queryStepM per check (4 m/s * dt = 0.067 m -> 4 checks).
//  - Relative body motion: after each solve the opponent's motion relative to the owner is replayed in subdivisions
//    of <= queryStepM against the palm; a palm overtaken by the opponent is pushed to the exterior, never tunnelled.
//  - Arm segments (upper arm, forearm) are validated at the end pose of every subdivision and after every solve.
//    Maximum unchecked displacement: palm 0.02 m; segments are only skipped if the relative body motion exceeds the
//    thinnest obstacle (~0.26 m) in one substep (> 15 m/s at 1/60 s), outside every fixture.
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArmIntent, ArmSide, BodyPartId, ColliderRegion, ContactRec, PlayerId, SegmentId } from './contracts';
import type { ArmProfile, ArmSetup, BodyProfile, FallLinkProfile, JointRangeProfile, RagdollProfile, RetentionMode, RideHoldProfile, SelfClearanceProfile } from './profiles';
import { landmarkWorld, poseOfRb, type Ragdoll } from './ragdoll';
import { shoulderLocal, sideSignX } from './profiles';
import { armSelfShapes, twoBone } from './pose';
import { armAnatomicalTwistRad, armTwistRad, fitElbowTwist, swingExcess, twistWindow } from './joint-cone';
import { cullGeom, geomNear, isSupportedLeg, trunkContact, trunkPieces, type TrunkHit, type TrunkPiece } from './physics';
import {
  add, addScaled, clamp, composePose, cross, dot, horiz, len, moveToward, norm, qAngleBetween, qFromUnitVectors, qInvRot, qRot, qSlerp,
  relPose, round, rv, scale, sub, toLocal, toWorld, v3, vc, UP, type Pose, type Quat, type Vec3,
} from './vec';

export type ArmPhase = 'rest' | 'reach' | 'close' | 'hold' | 'recover' | 'physical';
export type ReleaseReason = 'voluntary' | 'unreachable' | 'invalidPose' | 'lostTarget' | 'overload' | 'invalidSurface' | 'separation' | 'playEnded';
export type WrapStatus = 'noHold' | 'oneArmHold' | 'twoArmHold' | 'wrapped';

export interface Grip {
  id: string;
  ownerId: PlayerId;
  arm: ArmSide;
  targetId: PlayerId;
  targetPart: BodyPartId;
  targetPointLocal: Vec3;
  targetNormalLocal: Vec3;
  desiredLengthM: number;
  overloadExposureS: number;
  createdAtTick: number;
  /** Gate 4: passive palm-to-target retention after the owner became a ragdoll (palm landmark on the forearm body). */
  passive?: { ownerPart: SegmentId; ownerPointLocal: Vec3; since: number };
}

export interface ClampContact {
  id: string;
  ownerId: PlayerId;
  arm: ArmSide;
  targetId: PlayerId;
  targetPart: BodyPartId;
  forearmParameter: number;
  pointWorld: Vec3;
  outwardNormalWorld: Vec3;
  tangentElasticDisplacementM: Vec3;
  normalForceN: number;
  tangentForceN: Vec3;
}

/** Published arm observation (snapshot / presentation). */
export interface ArmObs {
  side: ArmSide;
  enabled: boolean;
  mode: RetentionMode;
  phase: ArmPhase;
  action: ArmIntent['action'];
  shoulderWorld: Vec3;
  elbowWorld: Vec3;
  wristWorld: Vec3;
  palmContactWorld: Vec3;
  requestedWorld: Vec3 | null;
  wantedWorld: Vec3;
  gripId: string | null;
  clampContactId: string | null;
  clampNormalN: number;
  armedForFreshContact: boolean;
  touchingTarget: PlayerId | null;
  obstructed: boolean;
  poseValid: boolean;
  poseErrorM: number;
  lastRelease: { reason: ReleaseReason; t: number } | null;
}

export interface ForceLedgerEntry {
  tick: number;
  step: number;
  owner: PlayerId;
  arm: ArmSide;
  kind: 'hold' | 'clamp' | 'passive' | 'link';
  id: string;
  target: PlayerId;
  /** Hold: raw tension; clamp: magnitude of the requested (cone-limited) force vector. */
  raw: number;
  demand: number;
  actual: number;
  allocated: number;
  sharedScale: number;
  normalRequested: number;
  normalActual: number;
  tangentWanted: number;
  tangentActual: number;
  frictionCap: number;
  forceOnTarget: Vec3;
  pointOnTarget: Vec3;
  forceOnOwner: Vec3;
  pointOnOwner: Vec3;
  exposure: number;
  xT: number;
}

/** Plan 09: joint torque an arm asks for this substep, allocated with grasp tension before either is applied. */
export interface ArmEffortDemand {
  shoulderNm: number;
  elbowNm: number;
}

/** Plan 09: one arm's share of the owner budget in one substep (shared with `ForceLedgerEntry`'s grasp entry). */
export interface EffortLedgerEntry {
  tick: number;
  step: number;
  owner: PlayerId;
  arm: ArmSide;
  shoulderNm: number;
  elbowNm: number;
  /** Conservative force equivalent of the torque demand (N). */
  equivalentN: number;
  /** This arm's allocated grasp tension (N): allocated first, as with no effort (plan 10c). */
  graspN: number;
  /** Scale on this arm's torque demand from the room its grasp leaves under the per-arm ceiling, and from the room all grasps leave in the owner budget. */
  armFactor: number;
  sharedScale: number;
  /** Allocated grasp plus allocated effort equivalent (N). */
  allocatedN: number;
  perArmN: number;
  ownerBudgetN: number;
}

export interface ArmHostPlayer {
  id: PlayerId;
  body: BodyProfile;
  rb: RAPIER.RigidBody;
  colliders: RAPIER.Collider[];
  arms?: ArmSetup;
  armIntent?: Partial<Record<ArmSide, ArmIntent>>;
  /** Gate 3: owner lost support. Arms become passive: no new acquisitions, no voluntary action, frozen references. */
  falling?: boolean;
  /** Gate 4: active ragdoll (segment bodies); `rb` is then its core body. */
  ragdoll?: Ragdoll | null;
  /** Plan 09: this substep's arm torque demands (accepted ragdoll owners only). */
  armEffort?: Partial<Record<ArmSide, ArmEffortDemand>>;
  /** Contact motion polish 1.2: a supported owner riding the carrier down (`PlayerIntent.ride`; the ride hold's). */
  riding?: boolean;
  /** Polish 2.1, the hold through the whistle: a supported owner whose request asks his takedown (converted next substep). */
  leaving?: boolean;
}

export interface ArmHost {
  players(): ArmHostPlayer[];
  regionOf(c: RAPIER.Collider): { playerId: PlayerId | null; region: ColliderRegion } | undefined;
  dt: number;
  tick: number;
  steps: number;
  t: number;
  emit(type: string, playerId: PlayerId | undefined, data: Record<string, unknown>): void;
  reverseOrder: boolean;
  /** Solved manifolds of the last step (physical forearm classification for ragdoll owners). */
  contacts(): ContactRec[];
}

interface Obstacle {
  playerId: PlayerId;
  part: BodyPartId;
  region: ColliderRegion;
  collider: RAPIER.Collider;
  shape: RAPIER.Shape;
  /** Collider pose relative to its body. */
  local: Pose;
  rb: RAPIER.RigidBody;
  /** Arm self-clearance: a piece of the owner's own measured trunk (never a grip, clamp or touch target). */
  self?: true;
}

interface Hit {
  distance: number;
  pointTarget: Vec3;
  normal: Vec3; // target -> query
  pointQuery: Vec3;
  obstacle: Obstacle;
}

interface ArmPoseSolve {
  elbow: Vec3;
  wrist: Vec3;
  palm: Vec3;
  pole: Vec3; // local
  valid: boolean;
  worst: Hit | null;
  palmHit: Hit | null;
  forearmHit: Hit | null;
}

interface ArmRt {
  side: ArmSide;
  sx: number;
  enabled: boolean;
  mode: RetentionMode;
  phase: ArmPhase;
  action: ArmIntent['action'];
  palmLocal: Vec3;
  wantedLocal: Vec3;
  poleLocal: Vec3;
  /** Contact motion polish 1.1: the request's elbow pole (`ArmIntent.poleLocal`), tried first; absent without one. */
  poleHint?: Vec3;
  prevElbowLocal: Vec3;
  prevWristLocal: Vec3;
  prevWantedElbowLocal: Vec3;
  prevWantedWristLocal: Vec3;
  solve: ArmPoseSolve | null;
  requestedWorld: Vec3 | null;
  gripId: string | null;
  clamp: (ClampContact & { obstacleKey: string; pointTargetLocal: Vec3 }) | null;
  armed: boolean;
  needOpen: boolean;
  withdrawFrom: PlayerId | null;
  obstructed: boolean;
  poseErrorM: number;
  touching: PlayerId | null;
  lastRelease: { reason: ReleaseReason; t: number } | null;
  clampSerial: number;
  /** Plan 09: a forearm hold kept physically after its owner converted: the time it lapses without a solved contact. */
  contactHoldUntil: number | null;
  /**
   * Contact motion M3 (`pressCarried`): the clamp a forearm hold was carried from, on the target body it held: the patch
   * (point and outward normal, that body's frame) and the forearm parameter it held at. Set at the owner's switch, kept
   * while the hold lasts and its target keeps its representation (absent or null: none).
   */
  carried?: { targetId: PlayerId; part: BodyPartId; pointLocal: Vec3; normalLocal: Vec3; u: number } | null;
  /**
   * Contact motion polish 1.2, the ride hold (`ArmSystem.rideHold`): the riding owner's clamp on a ragdoll carrier as a
   * patch on the part it holds (point, outward normal and the wanted palm in that part's frame; the forearm parameter),
   * the time its contact memory lapses, when it began and its overload exposure (absent or null: none).
   */
  ride?: RidePatch | null;
  /**
   * Polish 1.2, the ride hold: the riding owner's last clamp that lapsed for lost contact and when (the post-step palm
   * push-out lifts a pressing forearm off the surface every substep or two), for the carrier's conversion to carry.
   */
  rideLast?: { c: NonNullable<ArmRt['clamp']>; t: number } | null;
  /** Contact motion polish 2.1, the fall link (`ArmSystem.fallLink`): the forearm clamp carried as a link (absent or null: none). */
  link?: FallLink | null;
  /**
   * Polish 2.1, the hold through the whistle (`FallLinkProfile.throughEnding`): the referee's ending kept this arm's clamp
   * and ride patch (its owner riding the carrier down then), until his own switch or the ride's end (absent: not kept).
   */
  kept?: boolean;
}

/**
 * Polish 2.1, the fall link: the clamp's point on the owner's ragdoll forearm (`ownerPart`'s frame) and on the body part
 * of the target it held (`part`'s frame; the outward normal there), the forearm parameter it held at, when it began, its
 * overload exposure and its largest force so far.
 */
interface FallLink {
  id: string;
  targetId: PlayerId;
  part: BodyPartId;
  pointLocal: Vec3;
  normalLocal: Vec3;
  ownerPart: SegmentId;
  ownerPointLocal: Vec3;
  u: number;
  since: number;
  overloadExposureS: number;
  peakN: number;
  /** `FallLinkProfile.onArm`: the rest length, the gap between his arm and the patch not yet closed (absent: zero). */
  restM?: number;
}

interface RidePatch {
  targetId: PlayerId;
  part: BodyPartId;
  region: ColliderRegion;
  pointLocal: Vec3;
  normalLocal: Vec3;
  wantLocal: Vec3;
  u: number;
  until: number;
  since: number;
  exposureS: number;
}

const SIDES: ArmSide[] = ['left', 'right'];
const ELIGIBLE: ColliderRegion[] = ['torso', 'pelvis', 'support', 'capsule'];


export class ArmSystem {
  readonly grips = new Map<string, Grip>();
  /** Ledger of every retention force pair (one entry per active arm per substep). */
  ledger: ForceLedgerEntry[] = [];
  /** Plan 10c (C7): set by the simulation from `SimOptions.ledgers` (off by default). */
  keepLedger = false;
  readonly wrap = new Map<PlayerId, { status: WrapStatus; target: PlayerId | null; azimuthDeg: Partial<Record<ArmSide, number>>; basis: { near: Vec3; side: Vec3 } | null; reasons: string[] }>();
  private readonly arms = new Map<PlayerId, Record<ArmSide, ArmRt>>();
  /**
   * Contact motion M1: the arm-task substep (counted by preStep, so a substep's reach and its post-step solve share it)
   * and each arm's twist when the substep began: every solve of a substep is windowed around that one twist, so the
   * twist turns at most one rate step per substep however often the arm is solved and committed within it.
   */
  private twSubstep = 0;
  private readonly twAnchor = new Map<string, { substep: number; rad: number | null }>();
  private obstacles = new Map<PlayerId, Obstacle[]>();
  /** Arm self-clearance: each owner's measured trunk pieces (body frame), when the profile is on. */
  private readonly trunk = new Map<PlayerId, { pieces: TrunkPiece[]; obstacles: Obstacle[] }>();
  /** Body poses at the start of the substep, keyed by engine body handle (proxy or ragdoll segment). */
  private prePoses = new Map<number, Pose>();
  private gripSerial = 0;
  private wrapBasis = new Map<string, { near: Vec3; side: Vec3 }>();
  private readonly palmBall: RAPIER.Ball;
  /** Last substep's per-owner budget bookkeeping (for audits and UI). */
  lastAllocation = new Map<PlayerId, { sumDemand: number; scale: number; sumActual: number }>();
  /** Last substep's ledger entry per `owner:side`. */
  lastForce = new Map<string, ForceLedgerEntry>();
  /** Plan 09: arm torque allocation, one entry per arm with a demand per substep. */
  effortLedger: EffortLedgerEntry[] = [];
  /** Plan 09: this substep's scale on each arm's torque demand, per owner (set by `preStep`). */
  readonly effortScale = new Map<PlayerId, Record<ArmSide, number>>();
  /** Plan 09: how long a forearm hold survives without a solved contact (0: no physical holds are tracked). */
  holdMemoryS = 0;
  /** Contact motion M3: a forearm hold keeps the patch of the clamp it was carried from, for a fall response's press (`pressTarget`). */
  declare pressCarried?: boolean;
  /** Contact motion polish 1.2, the ride hold (`WrapRide.hold`; `noBreak`: the fault twin without its break rules). */
  declare rideHold?: RideHoldProfile & { noBreak?: boolean };
  /** Contact motion polish 2.1, the fall link (`WrapProfile.fallLink`; `noBreak`: the fault twin without its break rules). */
  declare fallLink?: FallLinkProfile & { noBreak?: boolean };

  constructor(
    readonly host: ArmHost,
    readonly profile: ArmProfile,
    /** Owner arm budget fraction once the owner is falling (Gate 3 balance profile). */
    readonly fallingBudgetFraction = 0.35,
    /** Gate 4 passive palm retention for ragdoll owners (absent = no ragdoll profile). */
    readonly passive?: RagdollProfile['passiveGrip'],
    /** Arm self-clearance (absent = arms ignore their own body): each arm's self shapes stay out of its owner's trunk. */
    readonly selfClearance?: SelfClearanceProfile,
    /** Plan 12 joint range (absent = no shoulder range): a pole whose upper arm is past the shoulder cone is invalid. */
    readonly jointRange?: JointRangeProfile,
  ) {
    this.palmBall = new RAPIER.Ball(profile.palmRadiusM);
    for (const pl of host.players()) {
      this.buildObstacles(pl);
      const T = selfClearance ? trunkPieces(pl.body) : null;
      if (T && pl.body.measured?.handTipM !== undefined && pl.colliders[0])
        this.trunk.set(pl.id, {
          pieces: T,
          obstacles: T.map((pc) => ({ playerId: pl.id, part: 'core', region: 'torso', collider: pl.colliders[0], shape: pc.shape, local: { p: v3(), q: { x: 0, y: 0, z: 0, w: 1 } }, rb: pl.rb, self: true })),
        });
      if (!pl.arms) continue;
      const rec = {} as Record<ArmSide, ArmRt>;
      for (const side of SIDES) {
        // the owner body's measured side basis (authored bodies: right = +X)
        const sx = sideSignX(pl.body, side);
        const rest = this.restLocal(side);
        rec[side] = {
          side,
          sx,
          enabled: pl.arms.enabled[side],
          mode: pl.arms.mode[side],
          phase: 'rest',
          action: 'rest',
          palmLocal: rest,
          wantedLocal: { ...rest },
          poleLocal: v3(sx, -0.6, -0.4),
          prevElbowLocal: v3(),
          prevWristLocal: v3(),
          prevWantedElbowLocal: v3(),
          prevWantedWristLocal: v3(),
          solve: null,
          requestedWorld: null,
          gripId: null,
          clamp: null,
          armed: true,
          needOpen: false,
          withdrawFrom: null,
          obstructed: false,
          poseErrorM: 0,
          touching: null,
          lastRelease: null,
          clampSerial: 0,
          contactHoldUntil: null,
        };
      }
      this.arms.set(pl.id, rec);
      this.wrap.set(pl.id, { status: 'noHold', target: null, azimuthDeg: {}, basis: null, reasons: [] });
    }
    // initial achieved poses
    for (const pl of host.players()) {
      const rec = this.arms.get(pl.id);
      if (!rec) continue;
      const pose = poseOfRb(pl.rb);
      for (const side of SIDES) {
        const a = rec[side];
        a.solve = this.solveArm(pl, a, pose, a.palmLocal, this.opponents(pl.id));
        this.storePrevLocal(a, pose);
      }
    }
  }

  /** Query obstacles for a player's active colliders, each attached to its own body (proxy or ragdoll segment). */
  private buildObstacles(pl: ArmHostPlayer): void {
    const obs: Obstacle[] = [];
    for (const c of pl.colliders) {
      const tag = this.host.regionOf(c);
      if (!tag) continue;
      const rc = pl.ragdoll?.colliders.find((x) => x.collider === c);
      const rb = rc ? pl.ragdoll!.bodies[rc.segment] : pl.rb;
      obs.push({
        playerId: pl.id,
        part: rc ? rc.segment : 'core',
        region: tag.region,
        collider: c,
        shape: c.shape,
        local: rc ? rc.local : relPose(poseOfRb(rb), { p: vc(c.translation()), q: { ...c.rotation() } }),
        rb,
      });
    }
    this.obstacles.set(pl.id, obs);
  }

  /** Body carrying a body part of a player (the proxy for every part, or the ragdoll segment). */
  private partBody(pl: ArmHostPlayer, part: BodyPartId): RAPIER.RigidBody {
    return pl.ragdoll ? pl.ragdoll.bodies[part] : pl.rb;
  }

  private prePose(rb: RAPIER.RigidBody): Pose {
    return this.prePoses.get(rb.handle) ?? poseOfRb(rb);
  }

  restLocal(side: ArmSide): Vec3 {
    const r = this.profile.restPalmRight;
    return v3(side === 'right' ? r.x : -r.x, r.y, r.z);
  }

  private opponents(owner: PlayerId): Obstacle[] {
    const out: Obstacle[] = [];
    for (const [id, obs] of this.obstacles) if (id !== owner) out.push(...obs);
    return out;
  }

  private obstaclePose(o: Obstacle, bodyPose?: Pose): Pose {
    return composePose(bodyPose ?? poseOfRb(o.rb), o.local);
  }

  private player(id: PlayerId): ArmHostPlayer | undefined {
    return this.host.players().find((p) => p.id === id);
  }

  // ---------------------------------------------------------------- queries
  private query(shape: RAPIER.Shape, pos: Vec3, rot: Quat, obstacles: Obstacle[], prediction: number, poses?: Map<Obstacle, Pose>): Hit | null {
    let best: Hit | null = null;
    const qg = cullGeom(shape, pos, rot);
    for (const o of obstacles) {
      const op = poses?.get(o) ?? this.obstaclePose(o);
      // plan 13a: beyond the prediction the query returns nothing, so the pair is not queried
      if (!geomNear(cullGeom(o.shape, op.p, op.q), qg, prediction)) continue;
      const r = o.shape.contactShape(op.p, op.q, shape, pos, rot, prediction);
      if (!r) continue;
      if (!best || r.distance < best.distance)
        best = { distance: r.distance, pointTarget: vc(r.point1), normal: vc(r.normal1), pointQuery: vc(r.point2), obstacle: o };
    }
    return best;
  }

  private segmentHit(a: Vec3, b: Vec3, radius: number, obstacles: Obstacle[], prediction: number, poses?: Map<Obstacle, Pose>): Hit | null {
    const d = sub(b, a);
    const l = len(d);
    if (l < 1e-6) return this.query(new RAPIER.Ball(radius), a, { x: 0, y: 0, z: 0, w: 1 }, obstacles, prediction, poses);
    const cap = new RAPIER.Capsule(l / 2, radius);
    const rot = qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l));
    return this.query(cap, addScaled(a, d, 0.5), rot, obstacles, prediction, poses);
  }

  private palmCenter(palm: Vec3, wrist: Vec3): Vec3 {
    return addScaled(palm, norm(sub(palm, wrist), v3(0, -1, 0)), -this.profile.palmRadiusM);
  }

  private poleCandidates(a: ArmRt): Vec3[] {
    const s = a.sx;
    return [a.poleLocal, v3(s, -0.6, -0.4), v3(s, 0, -0.1), v3(s, 0.6, -0.2), v3(s * 0.4, -1, 0), v3(s, -0.4, 0.6)];
  }

  /** Two-bone pose for a palm landmark (owner-local), testing exterior pole alternatives against obstacles. */
  private solveArm(pl: ArmHostPlayer, a: ArmRt, ownerPose: Pose, palmLocal: Vec3, obstacles: Obstacle[], poses?: Map<Obstacle, Pose>, fixedPalmWorld?: Vec3): ArmPoseSolve {
    const P = this.profile;
    const sW = toWorld(ownerPose, shoulderLocal(pl.body, a.side));
    const target = fixedPalmWorld ?? toWorld(ownerPose, palmLocal);
    const tol = P.surfaceTolM;
    const J = this.jointRange;
    let best: ArmPoseSolve | null = null;
    let bestDepth = Infinity;
    let bestOver = Infinity;
    // contact motion M1 (a twist profile): each pole's elbow is turned about the shoulder-to-palm line into the twist
    // window: the range, within one rate step of the arm's twist when this substep began (the range alone before there
    // is one). Nothing outside it is tried: collision-free end poses do not make a continuous path between them, so a
    // palm the window cannot reach validly gets the least bad pose inside it, and the callers' obstruction handling
    // stalls or retreats the reach (`reach`, the post-step push-out) or releases a held hand (`invalidPose`), instead of
    // the elbow turning around the obstacle in one step
    const TW = J?.shoulderTwist;
    // ladder 11d: the measure the window is in (`ShoulderTwistProfile.anatomical`)
    const twM = TW?.anatomical ? armAnatomicalTwistRad : armTwistRad;
    const wins: ({ mid: number; lo: number; hi: number } | null)[] = [];
    if (TW) {
      const key = `${pl.id}:${a.side}`;
      let anchor = this.twAnchor.get(key);
      if (!anchor || anchor.substep !== this.twSubstep) {
        const prev = a.solve && len(sub(a.prevWristLocal, a.prevElbowLocal)) > 1e-9 ? twM(J!.shoulder, { x: 0, y: 0, z: 0, w: 1 }, shoulderLocal(pl.body, a.side), a.prevElbowLocal, a.prevWristLocal, a.sx) : null;
        this.twAnchor.set(key, (anchor = { substep: this.twSubstep, rad: prev }));
      }
      wins.push(twistWindow(J!.shoulder, TW, anchor.rad, this.host.dt));
    } else wins.push(null);
    // fitted poles often land on the same elbow (the window's edge): each elbow is judged once
    const tried: Vec3[] = [];
    // and within a pass the elbow nearest the last committed one is judged first, so a pass that has to leave the window
    // keeps the elbow where it can (the pole order alone could take the far side of the circle: 0.64 m in one tick)
    const prevElbow = TW && a.solve ? toWorld(ownerPose, a.prevElbowLocal) : null;
    const solves = (win: { mid: number; lo: number; hi: number } | null): { poleL: Vec3; mid: Vec3; end: Vec3 }[] => {
      const out = this.poleCandidates(a).map((poleL) => {
        const r = twoBone(sW, target, P.upperArmM, P.forearmM + P.palmExtensionM, qRot(ownerPose.q, poleL), P.maxReachM);
        return { poleL, mid: win ? fitElbowTwist(J!.shoulder, ownerPose.q, sW, r.mid, r.end, a.sx, win, twM).elbow : r.mid, end: r.end };
      });
      if (prevElbow) out.sort((x, y) => len(sub(x.mid, prevElbow)) - len(sub(y.mid, prevElbow)));
      // contact motion polish 1.1: the requested pole ahead of every alternative (the window bounds its turn)
      if (a.poleHint) {
        const r = twoBone(sW, target, P.upperArmM, P.forearmM + P.palmExtensionM, qRot(ownerPose.q, a.poleHint), P.maxReachM);
        out.unshift({ poleL: a.poleHint, mid: win ? fitElbowTwist(J!.shoulder, ownerPose.q, sW, r.mid, r.end, a.sx, win, twM).elbow : r.mid, end: r.end });
      }
      return out;
    };
    for (const win of wins) for (const { poleL, ...r } of solves(win)) {
      if (TW) {
        if (tried.some((e) => len(sub(e, r.mid)) < 1e-4)) continue;
        tried.push(r.mid);
      }
      const wrist = add(r.mid, scale(sub(r.end, r.mid), P.forearmM / (P.forearmM + P.palmExtensionM)));
      const up = this.segmentHit(sW, r.mid, P.upperArmRadiusM, obstacles, tol + 0.01, poses);
      const fa = this.segmentHit(r.mid, wrist, P.forearmRadiusM, obstacles, tol + 0.01, poses);
      const pc = this.query(this.palmBall, this.palmCenter(r.end, wrist), { x: 0, y: 0, z: 0, w: 1 }, obstacles, tol + 0.01, poses);
      const self = this.selfHit(pl, ownerPose, sW, r.mid, wrist, r.end);
      let worst: Hit | null = null;
      for (const h of [up, fa, pc, self]) if (h && (!worst || h.distance < worst.distance)) worst = h;
      // plan 12: an upper arm past the shoulder cone (owner core frame) is invalid, as a hit is
      const over = J ? swingExcess(J.shoulder, qInvRot(ownerPose.q, norm(sub(r.mid, sW), v3(0, -1, 0))), a.sx).rad : 0;
      const valid = (!worst || worst.distance >= -tol) && over <= 0;
      const s: ArmPoseSolve = { elbow: r.mid, wrist, palm: r.end, pole: poleL, valid, worst, palmHit: pc, forearmHit: fa };
      if (valid) return s;
      if (J) {
        // the least bad: by depth past the surface tolerance, then by range excess
        const depth = worst ? Math.max(0, -worst.distance - tol) : 0;
        if (!best || depth < bestDepth - 1e-9 || (Math.abs(depth - bestDepth) <= 1e-9 && over < bestOver)) {
          best = s;
          bestDepth = depth;
          bestOver = over;
        }
      } else if (!best || (worst && best.worst && worst.distance > best.worst.distance)) best = s;
    }
    return best!;
  }

  /**
   * Arm self-clearance: the deepest contact of the arm's self shapes (forearm over its joint extent, palm, fingers; under
   * ladder 13c's `upperArm` the upper arm's distal half first) with the owner's trunk at `ownerPose`, its distance shifted
   * so the shared validity rule (>= -surfaceTolM) accepts exactly the profile's skin-contact tolerance. Null when the
   * profile is off or nothing is near.
   */
  private selfHit(pl: ArmHostPlayer, ownerPose: Pose, shoulder: Vec3, elbow: Vec3, wrist: Vec3, palm: Vec3): Hit | null {
    const T = this.trunk.get(pl.id);
    if (!T || !this.selfClearance) return null;
    const P = this.profile;
    const I = { x: 0, y: 0, z: 0, w: 1 };
    let best: Hit | null = null;
    const upper = this.selfClearance.upperArm ? { shoulder, r: P.forearmRadiusM } : undefined;
    for (const s of armSelfShapes({ forearm: P.forearmRadiusM, palm: P.palmRadiusM }, pl.body.measured!.handTipM!, 'arm', elbow, wrist, palm, upper)) {
      let h: TrunkHit | null = null;
      if (s.kind === 'ball') h = trunkContact(T.pieces, ownerPose, new RAPIER.Ball(s.r), s.c, I, s.c, s.r, P.surfaceTolM + 0.01);
      else if (s.kind === 'capsule') {
        const d = sub(s.b, s.a);
        const l = len(d);
        const mid = addScaled(s.a, d, 0.5);
        h = l < 1e-6
          ? trunkContact(T.pieces, ownerPose, new RAPIER.Ball(s.r), s.a, I, s.a, s.r, P.surfaceTolM + 0.01)
          : trunkContact(T.pieces, ownerPose, new RAPIER.Capsule(l / 2, s.r), mid, qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / l)), mid, l / 2 + s.r, P.surfaceTolM + 0.01);
      }
      if (h && (!best || h.distance < best.distance)) best = { distance: h.distance, pointTarget: h.point1, normal: h.normal1, pointQuery: h.point2, obstacle: T.obstacles[h.piece] };
    }
    if (best) best.distance += this.selfClearance.toleranceM - P.surfaceTolM;
    return best;
  }

  private clampShell(pl: ArmHostPlayer, side: ArmSide, p: Vec3): Vec3 {
    const s = shoulderLocal(pl.body, side);
    const d = sub(p, s);
    const l = len(d);
    const lo = this.profile.minReachM;
    const hi = this.profile.maxReachM;
    if (l < 1e-9) return add(s, v3(0, -lo, 0));
    return addScaled(s, d, clamp(l, lo, hi) / l);
  }

  private storePrevLocal(a: ArmRt, ownerPose: Pose): void {
    if (!a.solve) return;
    a.prevElbowLocal = toLocal(ownerPose, a.solve.elbow);
    a.prevWristLocal = toLocal(ownerPose, a.solve.wrist);
  }

  // ---------------------------------------------------------------- stage 5-7: before the solve
  preStep(): void {
    this.twSubstep++;
    const host = this.host;
    const dt = host.dt;
    const P = this.profile;
    const players = host.players();
    this.prePoses.clear();
    this.lastForce.clear();
    this.effortScale.clear();
    for (const pl of players) {
      this.prePoses.set(pl.rb.handle, poseOfRb(pl.rb));
      if (pl.ragdoll) for (const rb of Object.values(pl.ragdoll.bodies)) this.prePoses.set(rb.handle, poseOfRb(rb));
    }
    const order = players; // already reversed by the simulation when reverseOrder is set
    const sides = host.reverseOrder ? [...SIDES].reverse() : SIDES;
    for (const pl of order) {
      const rec = this.arms.get(pl.id);
      const effort = pl.ragdoll ? pl.armEffort : undefined;
      if (!rec && !effort) continue;
      const ownerPose = this.prePose(pl.rb);
      const obstacles = this.opponents(pl.id);
      type Demand = { a: ArmRt; kind: 'hold' | 'clamp' | 'passive' | 'link'; vec: Vec3; raw: number; normalReq: number; ftWanted: Vec3; ftCone: Vec3; frictionSat: boolean; grip?: Grip; link?: FallLink; n?: Vec3; p: Vec3; s?: Vec3; target: PlayerId; id: string; rbT: RAPIER.RigidBody; rbO: RAPIER.RigidBody };
      const demands: Demand[] = [];
      const falling = !!pl.falling;
      if (rec) for (const side of sides) {
        if (pl.ragdoll) {
          // Physical arm (Gate 4): no query arm, no closing force; only a surviving palm grasp as a passive link.
          const a = rec[side];
          if (!a.enabled) continue;
          a.phase = 'physical';
          a.action = 'rest';
          // polish 2.1, the fall link: a tension-only spring-damper from the forearm's point to the patch (`n` and the force
          // pair as the passive link's below), its break rules at the substep's start (overload is the allocator's)
          const L = a.link;
          if (L && this.fallLink) {
            const K = this.fallLink;
            const tgt = this.player(L.targetId);
            if (!tgt) this.endLink(pl, a, 'lostTarget');
            else {
              const rbT = this.partBody(tgt, L.part);
              const rbO = pl.ragdoll.bodies[L.ownerPart];
              const pT = toWorld(this.prePose(rbT), L.pointLocal);
              const pO = toWorld(this.prePose(rbO), L.ownerPointLocal);
              const e = sub(pT, pO);
              const d = len(e);
              const why = this.linkBreak(pl, a, pT, d);
              if (why) this.endLink(pl, a, why);
              else {
                let raw = 0;
                let n = v3();
                // (`onArm`: the rest length takes in the slack as the gap closes, never lets it out; slack, no force)
                if (L.restM !== undefined && d < L.restM) L.restM = d;
                const rest = L.restM ?? 0;
                if (d > 1e-6) {
                  n = scale(e, 1 / d);
                  const sep = dot(sub(vc(rbT.velocityAtPoint(pT)), vc(rbO.velocityAtPoint(pO))), n);
                  raw = Math.max(0, K.stiffness * (d - rest) + K.damping * sep);
                }
                demands.push({ a, kind: 'link', vec: scale(n, -raw), raw, normalReq: 0, ftWanted: v3(), ftCone: v3(), frictionSat: false, link: L, n, p: pT, s: pO, target: L.targetId, id: L.id, rbT, rbO });
              }
            }
          }
          const g = a.gripId ? this.grips.get(a.gripId) : undefined;
          if (!g || !g.passive) continue;
          const tgt = this.player(g.targetId);
          if (!tgt) {
            this.release(pl, a, 'lostTarget', ownerPose);
            continue;
          }
          const rbT = this.partBody(tgt, g.targetPart);
          const rbO = pl.ragdoll.bodies[g.passive.ownerPart];
          const pT = toWorld(this.prePose(rbT), g.targetPointLocal);
          const pO = toWorld(this.prePose(rbO), g.passive.ownerPointLocal);
          const e = sub(pT, pO);
          const d = len(e);
          const K = this.passive!;
          if (d > K.maxSeparationM) {
            this.release(pl, a, 'separation', ownerPose);
            continue;
          }
          let raw = 0;
          let n = v3();
          if (d > 1e-6) {
            n = scale(e, 1 / d);
            const sep = dot(sub(vc(rbT.velocityAtPoint(pT)), vc(rbO.velocityAtPoint(pO))), n);
            raw = Math.max(0, K.stiffness * d + K.damping * sep);
          }
          // `n` points from the owner's palm to the target point, the same sense as a hold's shoulder-to-anchor `n`: the
          // shared allocator applies -n * actual to the target (toward the palm) and +n * actual to the owner's palm.
          demands.push({ a, kind: 'passive', vec: scale(n, -raw), raw, normalReq: 0, ftWanted: v3(), ftCone: v3(), frictionSat: false, grip: g, n, p: pT, s: pO, target: g.targetId, id: g.id, rbT, rbO });
          continue;
        }
        const a = rec[side];
        if (!a.enabled) continue;
        // polish 2.1, the hold through the whistle: an arm the referee's ending kept (`endPlay`) holds on while its owner
        // rides on (or leaves his support for the takedown, or falls into it); stopping without his switch, it lets go
        if (a.kept && !this.keeps(pl, a)) this.unkeep(pl, a, 'playEnded');
        if (a.kept && !a.clamp && !a.ride) a.kept = false;
        const kept = !!a.kept;
        // A falling owner's arms are passive: requests are ignored (diagnostics only), the last action is frozen and
        // existing relationships are kept only while the normal checks allow; nothing new is acquired.
        // (polish 2.1: so are a kept arm's, its elbow pole as last asked; the ride patch carries its wanted palm)
        const frozen = falling || kept;
        const requested = pl.armIntent?.[side] ?? { action: 'rest' as const, targetWorld: v3() };
        const intent: ArmIntent = frozen ? { action: a.action === 'pull' ? 'close' : a.action, targetWorld: v3() } : requested;
        if (!kept) {
          if (intent.poleLocal) a.poleHint = { ...intent.poleLocal };
          else if (a.poleHint) delete a.poleHint;
        }
        const prevAction = a.action;
        a.action = intent.action;
        const closing = kept || (falling ? !!a.clamp : intent.action === 'close' || intent.action === 'pull');
        if (!closing) a.needOpen = false;
        if (!frozen) a.requestedWorld = intent.action === 'rest' || intent.action === 'release' ? null : { ...intent.targetWorld };
        // ---------------- held palm: validate before any force
        if (a.gripId) {
          const g = this.grips.get(a.gripId)!;
          const tgt = this.player(g.targetId);
          const sW = toWorld(ownerPose, shoulderLocal(pl.body, side));
          let reason: ReleaseReason | null = null;
          if (!tgt) reason = 'lostTarget';
          else if (!falling && (intent.action === 'release' || intent.action === 'rest' || intent.action === 'reach')) reason = 'voluntary';
          let pW = sW;
          if (!reason && tgt) {
            const tp = this.prePose(this.partBody(tgt, g.targetPart));
            pW = toWorld(tp, g.targetPointLocal);
            const nW = qRot(tp.q, g.targetNormalLocal);
            const L = len(sub(pW, sW));
            const nn = norm(sub(pW, sW));
            const vS = vc(pl.rb.velocityAtPoint(sW));
            const vP = vc(this.partBody(tgt, g.targetPart).velocityAtPoint(pW));
            const predicted = L + Math.max(0, dot(sub(vP, vS), nn)) * dt;
            if (L > P.maxReachM + P.hold.reachTolM || predicted > P.maxReachM + P.hold.reachTolM) reason = 'unreachable';
            else if (dot(nW, sub(sW, pW)) <= 0) reason = 'invalidSurface';
            else {
              const sol = this.solveArm(pl, a, ownerPose, a.palmLocal, obstacles, undefined, pW);
              if (!sol.valid) reason = 'invalidPose';
              else a.solve = sol;
            }
          }
          if (reason) {
            this.release(pl, a, reason, ownerPose);
          } else if (tgt) {
            const g2 = g;
            if (!falling && intent.action === 'pull') g2.desiredLengthM = Math.max(Math.max(P.hold.minDesiredLengthM, P.minReachM), g2.desiredLengthM - P.hold.pullSpeedMps * dt);
            const L = len(sub(pW, sW));
            const n = norm(sub(pW, sW), v3(1, 0, 0));
            const vS = vc(pl.rb.velocityAtPoint(sW));
            const rbT = this.partBody(tgt, g2.targetPart);
            const vP = vc(rbT.velocityAtPoint(pW));
            const ext = L - g2.desiredLengthM;
            const sep = dot(sub(vP, vS), n);
            const raw = ext <= 0 ? 0 : Math.max(0, P.hold.stiffness * ext + P.hold.damping * sep);
            a.palmLocal = toLocal(ownerPose, pW);
            a.wantedLocal = { ...a.palmLocal };
            a.phase = 'hold';
            demands.push({ a, kind: 'hold', vec: scale(n, -raw), raw, normalReq: 0, ftWanted: v3(), ftCone: v3(), frictionSat: false, grip: g2, n, p: pW, s: sW, target: g2.targetId, id: g2.id, rbT, rbO: pl.rb });
            continue;
          }
        }
        // ---------------- free arm: collision-aware reach in the owner frame
        // (polish 1.2, the ride hold: a patch still held carries the wanted palm with the part it holds, and the palm
        // follows at the arm's top speed)
        let rp = a.ride ?? null;
        if (rp && !closing) rp = this.endRide(pl, a, 'voluntary');
        if (rp && this.rideOff(pl, rp, a)) rp = this.endRide(pl, a, 'rideEnded');
        if (rp) a.wantedLocal = toLocal(ownerPose, toWorld(this.prePose(this.partBody(this.player(rp.targetId)!, rp.part)), rp.wantLocal));
        const clamped = !!a.clamp;
        const speed = clamped ? P.clamp.stationRateMps : P.maxEndpointSpeedMps;
        const targetLocal = a.requestedWorld ? toLocal(ownerPose, a.requestedWorld) : this.restLocal(side);
        // falling owner: the closing/reach reference stays frozen in the owner frame (no active tracking); a kept arm's too
        // (with its ride patch, on the part it holds)
        if (!frozen) a.wantedLocal = this.clampShell(pl, side, moveToward(a.wantedLocal, targetLocal, speed * dt));
        this.reach(pl, a, ownerPose, obstacles, (rp ? P.maxEndpointSpeedMps : speed) * dt);
        // phase
        if (!a.armed) a.phase = 'recover';
        else if (intent.action === 'rest' || intent.action === 'release') a.phase = 'rest';
        else if (intent.action === 'reach') a.phase = 'reach';
        else a.phase = 'close';
        // withdrawal / rearm
        if (!a.armed && a.withdrawFrom) {
          const sol = a.solve!;
          const wObs = (this.obstacles.get(a.withdrawFrom) ?? []).filter((o) => o.playerId === a.withdrawFrom);
          const h = this.query(this.palmBall, this.palmCenter(sol.palm, sol.wrist), { x: 0, y: 0, z: 0, w: 1 }, wObs, P.hold.withdrawM + 0.01);
          if (!h || h.distance >= P.hold.withdrawM) a.withdrawFrom = null;
        }
        if (!a.armed && !a.withdrawFrom && !a.needOpen) {
          a.armed = true;
          host.emit('armRearmed', pl.id, { arm: side });
        }
        // ---------------- palm grip birth (surfaceHold)
        const sol = a.solve!;
        const tol = P.surfaceTolM;
        if (!falling && !this.ended && a.mode === 'surfaceHold' && closing && a.armed && pl.arms?.acquisition !== false && sol.valid && sol.palmHit && sol.palmHit.distance <= tol && ELIGIBLE.includes(sol.palmHit.obstacle.region)) {
          const h = sol.palmHit;
          const tgt = this.player(h.obstacle.playerId)!;
          const tp = this.prePose(tgt.rb);
          const tpPart = this.prePose(h.obstacle.rb);
          const sW = toWorld(ownerPose, shoulderLocal(pl.body, side));
          // anchor = the target surface point under the achieved palm-contact landmark
          const proj = h.obstacle.collider.projectPoint(sol.palm, false);
          const anchor = proj ? vc(proj.point) : h.pointTarget;
          const L = len(sub(anchor, sW));
          const palmDir = norm(sub(sol.palm, sol.wrist));
          const facing = dot(palmDir, scale(h.normal, -1));
          const yLocal = toLocal(tp, anchor).y;
          const inBand = yLocal >= P.wrap.bandLowM && yLocal <= P.wrap.bandHighM;
          const why: string[] = [];
          if (L > P.maxReachM + P.hold.reachTolM) why.push('unreachable');
          if (facing < P.hold.palmFacingMinDot) why.push('palmNotFacing');
          if (!inBand) why.push('outsideBand');
          if (dot(h.normal, sub(sW, anchor)) <= 0) why.push('farSide');
          if (why.length === 0) {
            const id = `${pl.id}:${side}:g${++this.gripSerial}`;
            const g: Grip = {
              id,
              ownerId: pl.id,
              arm: side,
              targetId: tgt.id,
              targetPart: h.obstacle.part,
              targetPointLocal: toLocal(tpPart, anchor),
              targetNormalLocal: qInvRot(tpPart.q, h.normal),
              desiredLengthM: L,
              overloadExposureS: 0,
              createdAtTick: host.tick,
            };
            this.grips.set(id, g);
            a.gripId = id;
            a.phase = 'hold';
            a.palmLocal = toLocal(ownerPose, anchor);
            a.wantedLocal = { ...a.palmLocal };
            host.emit('gripBegin', pl.id, { arm: side, grip: id, target: tgt.id, region: h.obstacle.region, point: rv(anchor), lengthM: round(L, 4), facing: round(facing, 3), yLocal: round(yLocal, 3), palmGap: round(h.distance, 4) });
            const sW2 = sW;
            const n = norm(sub(anchor, sW2));
            demands.push({ a, kind: 'hold', vec: v3(), raw: 0, normalReq: 0, ftWanted: v3(), ftCone: v3(), frictionSat: false, grip: g, n, p: anchor, s: sW2, target: tgt.id, id, rbT: h.obstacle.rb, rbO: pl.rb });
            continue;
          } else if (prevAction !== intent.action || this.host.steps % 30 === 0) {
            host.emit('gripRejected', pl.id, { arm: side, target: tgt.id, reasons: why.join(','), point: rv(anchor) });
          }
        }
        // ---------------- forearm clamp (forearmClamp mode, closing, actual contact)
        const effort = (pl.arms?.closeEffortScale ?? 1) * clamp(falling ? 1 : intent.closeEffort ?? 1, 0, 1);
        let fh = sol.forearmHit;
        // a falling owner keeps only an existing clamp on the same patch (no fresh clamp)
        const sameClamp = !!a.clamp && !!fh && a.clamp.obstacleKey === `${fh.obstacle.playerId}:${fh.obstacle.part}:${fh.obstacle.region}`;
        let live = (!this.ended || kept) && a.mode === 'forearmClamp' && closing && effort > 0 && !!fh && fh.distance <= tol && ELIGIBLE.includes(fh.obstacle.region) && (!frozen || sameClamp);
        // (polish 2.1: a kept arm holds the patch it had at the ending; a contact farther along is no hold of it, and the
        // ride patch stands in for it)
        if (live && kept && len(sub(a.clamp!.pointTargetLocal, toLocal(this.prePose(fh!.obstacle.rb), fh!.pointTarget))) > P.clamp.patchJumpM) live = false;
        // polish 1.2, the ride hold: its contact memory (the arm touching the carrier anywhere, his own arm between them
        // included), its break rules, and the patch in place of a forearm contact that is not an eligible surface of his
        if (rp && effort <= 0) rp = this.endRide(pl, a, 'noEffort');
        if (rp) {
          if (a.touching === rp.targetId) rp.until = host.t + this.rideHold!.memoryS;
          if (live && fh!.obstacle.playerId !== rp.targetId) rp = this.endRide(pl, a, 'retarget');
          else if (!live) {
            const why = this.rideBreak(pl, a, rp, ownerPose, sol, true);
            fh = why ? null : this.rideHit(rp, sol);
            if (!fh) rp = this.endRide(pl, a, why ?? 'lostTarget');
          }
        }
        if ((live || rp) && fh) {
          const tgt = this.player(fh.obstacle.playerId)!;
          const rbT = fh.obstacle.rb;
          const tp = this.prePose(rbT);
          const n = fh.normal;
          const pT = fh.pointTarget;
          // forearm parameter of the contact along elbow->wrist
          const ew = sub(sol.wrist, sol.elbow);
          const u = clamp(dot(sub(fh.pointQuery, sol.elbow), ew) / Math.max(1e-9, dot(ew, ew)), 0, 1);
          const qA = addScaled(sol.elbow, ew, u);
          // wanted (unobstructed) pose at the same parameter
          const sW = toWorld(ownerPose, shoulderLocal(pl.body, side));
          const wTarget = toWorld(ownerPose, a.wantedLocal);
          const wr = twoBone(sW, wTarget, P.upperArmM, P.forearmM + P.palmExtensionM, qRot(ownerPose.q, sol.pole), P.maxReachM);
          const wWrist = add(wr.mid, scale(sub(wr.end, wr.mid), P.forearmM / (P.forearmM + P.palmExtensionM)));
          const qW = addScaled(wr.mid, sub(wWrist, wr.mid), u);
          const closingError = clamp(dot(sub(qA, qW), n), 0, P.clamp.maxClosingErrorM);
          // velocities: target material point vs owner-relative arm motion (bounded by the station rate)
          const vT = vc(rbT.velocityAtPoint(pT));
          const qALocalPrev = addScaled(a.prevElbowLocal, sub(a.prevWristLocal, a.prevElbowLocal), u);
          const qALocalNow = toLocal(ownerPose, qA);
          const armMotion = qRot(ownerPose.q, scale(sub(qALocalNow, qALocalPrev), 1 / dt));
          const vArm = add(vc(pl.rb.velocityAtPoint(qA)), armMotion);
          const qWLocalPrev = addScaled(a.prevWantedElbowLocal, sub(a.prevWantedWristLocal, a.prevWantedElbowLocal), u);
          const qWLocalNow = toLocal(ownerPose, qW);
          const vGoal = add(vc(pl.rb.velocityAtPoint(qW)), qRot(ownerPose.q, scale(sub(qWLocalNow, qWLocalPrev), 1 / dt)));
          const closingSpeed = Math.max(0, -dot(sub(vGoal, vT), n));
          const Nreq = effort * Math.max(0, P.clamp.normalStiffness * closingError + P.clamp.normalDamping * closingSpeed);
          a.prevWantedElbowLocal = toLocal(ownerPose, wr.mid);
          a.prevWantedWristLocal = toLocal(ownerPose, wWrist);
          // compliant friction with elastic memory
          const key = `${tgt.id}:${fh.obstacle.part}:${fh.obstacle.region}`;
          const pTLocal = toLocal(tp, pT);
          let xT = v3();
          const fresh = !a.clamp || a.clamp.obstacleKey !== key || len(sub(a.clamp.pointTargetLocal, pTLocal)) > P.clamp.patchJumpM;
          if (frozen && fresh) {
            // patch jump while falling would be a new acquisition: end the clamp instead (polish 2.1: and a kept arm's
            // ride patch with it)
            if (a.clamp) host.emit('clampEnd', pl.id, { arm: side, clamp: a.clamp.id, reason: 'contactLost', gap: round(fh.distance, 4) });
            a.clamp = null;
            if (kept) this.endRide(pl, a, 'contactLost');
            continue;
          }
          if (!fresh && a.clamp) xT = a.clamp.tangentElasticDisplacementM;
          xT = sub(xT, scale(n, dot(xT, n)));
          const vRel = sub(vT, vArm);
          const vTan = sub(vRel, scale(n, dot(vRel, n)));
          xT = addScaled(xT, vTan, dt);
          const ftWanted = scale(xT, -P.clamp.tangentStiffness);
          const cap = P.clamp.mu * Nreq;
          const ftw = len(ftWanted);
          const sat = ftw > cap;
          const ftCone = sat ? (ftw > 1e-12 ? scale(ftWanted, cap / ftw) : v3()) : ftWanted;
          if (Nreq <= 0) xT = v3();
          else if (sat) xT = scale(ftCone, -1 / P.clamp.tangentStiffness);
          if (fresh) {
            a.clampSerial++;
            host.emit('clampBegin', pl.id, { arm: side, target: tgt.id, region: fh.obstacle.region, point: rv(pT), u: round(u, 3), closingError: round(closingError, 4), gap: round(fh.distance, 4) });
          }
          const id = `${pl.id}:${side}:c${a.clampSerial}`;
          a.clamp = {
            id,
            ownerId: pl.id,
            arm: side,
            targetId: tgt.id,
            targetPart: fh.obstacle.part,
            forearmParameter: u,
            pointWorld: pT,
            outwardNormalWorld: n,
            tangentElasticDisplacementM: xT,
            normalForceN: Nreq,
            tangentForceN: ftCone,
            obstacleKey: key,
            pointTargetLocal: pTLocal,
          };
          // polish 1.2, the ride hold: riding, a clamp on a ragdoll carrier is (or stays) a patch on the part it holds
          if (this.rideHold && pl.riding && !falling && tgt.ragdoll) {
            a.ride = {
              targetId: tgt.id,
              part: fh.obstacle.part,
              region: fh.obstacle.region,
              pointLocal: pTLocal,
              normalLocal: qInvRot(tp.q, n),
              wantLocal: toLocal(tp, toWorld(ownerPose, a.wantedLocal)),
              u,
              until: live ? host.t + this.rideHold.memoryS : rp!.until,
              since: rp?.since ?? host.t,
              exposureS: rp?.exposureS ?? 0,
            };
            if (!rp) host.emit('rideHoldBegin', pl.id, { arm: side, clamp: id, target: tgt.id, part: fh.obstacle.part, region: fh.obstacle.region, from: 'clamp' });
          }
          a.phase = 'hold';
          const vec = add(scale(n, -Nreq), ftCone);
          demands.push({ a, kind: 'clamp', vec, raw: len(vec), normalReq: Nreq, ftWanted, ftCone, frictionSat: sat, p: pT, target: tgt.id, id, n, rbT, rbO: pl.rb });
        } else {
          if (a.clamp) {
            host.emit('clampEnd', pl.id, { arm: side, clamp: a.clamp.id, reason: !closing && !falling ? 'voluntary' : effort <= 0 ? 'noEffort' : 'contactLost', gap: fh ? round(fh.distance, 4) : null });
            a.clamp = null;
          }
          // keep the wanted-pose history current
          const sW = toWorld(ownerPose, shoulderLocal(pl.body, side));
          const wr = twoBone(sW, toWorld(ownerPose, a.wantedLocal), P.upperArmM, P.forearmM + P.palmExtensionM, qRot(ownerPose.q, sol.pole), P.maxReachM);
          a.prevWantedElbowLocal = toLocal(ownerPose, wr.mid);
          a.prevWantedWristLocal = toLocal(ownerPose, add(wr.mid, scale(sub(wr.end, wr.mid), P.forearmM / (P.forearmM + P.palmExtensionM))));
        }
      }
      // ---------------- shared per-owner vector budget (reduced while the owner is falling)
      const budgetScale = pl.ragdoll ? this.passive?.budgetFraction ?? this.fallingBudgetFraction : falling ? this.fallingBudgetFraction : 1;
      // polish 2.1, the fall link: its own budget fraction (its per-arm ceiling, and the owner budget the larger of the
      // two); every other demand and the arm torque keep theirs
      const linkScale = this.fallLink && demands.some((d) => d.kind === 'link') ? this.fallLink.budgetFraction : null;
      const baseBudget = P.hold.ownerBudgetN * budgetScale;
      const ownerBudget = linkScale === null ? baseBudget : P.hold.ownerBudgetN * Math.max(budgetScale, linkScale);
      const perArm = Math.min(P.hold.perArmCeilingN, baseBudget);
      const linkArm = linkScale === null ? perArm : Math.min(P.hold.perArmCeilingN, P.hold.ownerBudgetN * linkScale);
      const ceilOf = (d: Demand): number => (d.kind === 'link' ? linkArm : perArm);
      let sumDemand = 0;
      const capScales = demands.map((d) => {
        const m = len(d.vec);
        const cl = ceilOf(d);
        const c = m > cl ? cl / m : 1;
        sumDemand += m * c;
        return c;
      });
      // the grasp's allocation: the per-demand ceiling and one shared scale over the grasps alone
      const shared = sumDemand > ownerBudget ? ownerBudget / sumDemand : 1;
      // Plan 09: arm torque joins the same budget. Conservative force equivalent per arm: shoulder torque / upper arm
      // plus elbow torque / forearm. Plan 10c (U4, grasp first): it takes only what the grasps leave, the arm's ceiling
      // less its grasp and the owner budget less all of them, so a hold never loses tension to its own arm's effort and
      // its overload exposure comes from the grasp alone.
      const armFactor: Record<ArmSide, number> = { left: 1, right: 1 };
      const grasp: Record<ArmSide, number> = { left: 0, right: 0 };
      const equiv: Record<ArmSide, number> = { left: 0, right: 0 };
      let effortShared = 1;
      let sumActual = 0;
      if (effort) {
        demands.forEach((d, i) => (grasp[d.a.side] += len(d.vec) * capScales[i] * shared));
        let sumEquiv = 0;
        for (const side of SIDES) {
          const e = effort[side];
          equiv[side] = e ? e.shoulderNm / P.upperArmM + e.elbowNm / P.forearmM : 0;
          // (a link's arm: what its ceiling leaves, never more than the arm's own room without it)
          const room = linkScale === null ? Math.max(0, perArm - grasp[side]) : Math.max(0, Math.min(perArm, (demands.some((d) => d.kind === 'link' && d.a.side === side) ? linkArm : perArm) - grasp[side]));
          armFactor[side] = equiv[side] > room ? room / equiv[side] : 1;
          sumEquiv += equiv[side] * armFactor[side];
        }
        const ownerRoom = linkScale === null ? Math.max(0, ownerBudget - grasp.left - grasp.right) : Math.max(0, Math.min(baseBudget, ownerBudget - grasp.left - grasp.right));
        effortShared = sumEquiv > ownerRoom ? ownerRoom / sumEquiv : 1;
        sumDemand += sumEquiv;
        this.effortScale.set(pl.id, { left: armFactor.left * effortShared, right: armFactor.right * effortShared });
        for (const side of SIDES) {
          const e = effort[side];
          if (!e) continue;
          const effortN = equiv[side] * armFactor[side] * effortShared;
          sumActual += effortN;
          if (this.keepLedger)
            this.effortLedger.push({ tick: host.tick, step: host.steps, owner: pl.id, arm: side, shoulderNm: e.shoulderNm, elbowNm: e.elbowNm, equivalentN: equiv[side], graspN: grasp[side], armFactor: armFactor[side], sharedScale: effortShared, allocatedN: grasp[side] + effortN, perArmN: perArm, ownerBudgetN: ownerBudget });
        }
      }
      demands.forEach((d, i) => {
        const f = capScales[i] * shared;
        let forceOnTarget: Vec3;
        let pointOwner: Vec3;
        let allocated = 0;
        let actual = 0;
        let normalActual = 0;
        let ftActual = v3();
        if (d.kind === 'hold' || d.kind === 'passive' || d.kind === 'link') {
          const g: { overloadExposureS: number } = d.link ?? d.grip!;
          const cl = ceilOf(d);
          const demand = Math.min(d.raw, cl);
          actual = demand * shared;
          allocated = shared < 1 ? actual : cl;
          if (d.link) d.link.peakN = Math.max(d.link.peakN, actual);
          forceOnTarget = scale(d.n!, -actual);
          pointOwner = d.s!;
          // overload exposure (guard zero capacity)
          const excess = allocated > 1e-9 ? Math.max(0, d.raw / allocated - 1) : d.raw > 1e-9 ? Infinity : 0;
          if (excess === 0) g.overloadExposureS = Math.max(0, g.overloadExposureS - P.hold.overloadRecoveryPerS * this.host.dt);
          else g.overloadExposureS += Math.min(excess, 1e6) * this.host.dt;
        } else {
          forceOnTarget = scale(d.vec, f);
          pointOwner = d.p;
          actual = len(forceOnTarget);
          allocated = actual;
          normalActual = d.normalReq * f;
          ftActual = scale(d.ftCone, f);
          const c = d.a.clamp!;
          c.normalForceN = normalActual;
          c.tangentForceN = ftActual;
          if (f < 1 || d.frictionSat) c.tangentElasticDisplacementM = normalActual > 0 ? scale(ftActual, -1 / P.clamp.tangentStiffness) : v3();
          // polish 1.2, the ride hold: the grip's overload exposure on the patch (demand past the ceilings)
          const rp = d.a.ride;
          if (rp) {
            const excess = f > 1e-9 ? 1 / f - 1 : d.raw > 1e-9 ? Infinity : 0;
            if (excess === 0) rp.exposureS = Math.max(0, rp.exposureS - P.hold.overloadRecoveryPerS * this.host.dt);
            else rp.exposureS += Math.min(excess, 1e6) * this.host.dt;
          }
        }
        const forceOnOwner = scale(forceOnTarget, -1);
        if (actual > 0) {
          d.rbT.addForceAtPoint(forceOnTarget, d.p, true);
          d.rbO.addForceAtPoint(forceOnOwner, pointOwner, true);
        }
        sumActual += actual;
        const entry: ForceLedgerEntry = {
            tick: this.host.tick,
            step: this.host.steps,
            owner: pl.id,
            arm: d.a.side,
            kind: d.kind,
            id: d.id,
            target: d.target,
            raw: d.raw,
            demand: Math.min(len(d.vec), ceilOf(d)),
            actual,
            allocated,
            sharedScale: shared,
            normalRequested: d.normalReq,
            normalActual,
            tangentWanted: len(d.ftWanted),
            tangentActual: len(ftActual),
            frictionCap: P.clamp.mu * normalActual,
            forceOnTarget,
            pointOnTarget: d.p,
            forceOnOwner,
            pointOnOwner: pointOwner,
            exposure: (d.link ?? d.grip)?.overloadExposureS ?? 0,
          xT: d.a.clamp ? len(d.a.clamp.tangentElasticDisplacementM) : 0,
        };
        this.lastForce.set(`${pl.id}:${d.a.side}`, entry);
        if (this.keepLedger) this.ledger.push(entry);
      });
      this.lastAllocation.set(pl.id, { sumDemand, scale: shared, sumActual });
      // overload releases take effect from the next substep (force already applied this substep was within budget)
      for (const d of demands) {
        if ((d.kind === 'hold' || d.kind === 'passive') && d.grip && d.grip.overloadExposureS >= P.hold.overloadThresholdS && d.a.gripId === d.grip.id) {
          this.release(pl, d.a, 'overload', ownerPose);
        }
        if (d.kind === 'clamp' && d.a.ride && d.a.ride.exposureS >= P.hold.overloadThresholdS && !this.rideHold?.noBreak) this.endRide(pl, d.a, 'overload', true);
        if (d.kind === 'link' && d.a.link === d.link && d.link!.overloadExposureS >= P.hold.overloadThresholdS && !this.fallLink?.noBreak) this.endLink(pl, d.a, 'overload');
      }
    }
  }

  /** Collision-aware palm sweep in the owner frame with one slide along the blocking surface. */
  private reach(pl: ArmHostPlayer, a: ArmRt, ownerPose: Pose, obstacles: Obstacle[], maxStep: number): void {
    const P = this.profile;
    const startSolve = this.solveArm(pl, a, ownerPose, a.palmLocal, obstacles);
    const cand = this.clampShell(pl, a.side, moveToward(a.palmLocal, a.wantedLocal, maxStep));
    const startWorst = startSolve.worst ? startSolve.worst.distance : Infinity;
    if (!startSolve.valid) {
      // Already overlapping (an opponent moved into the arm): accept only moves that reduce the overlap.
      const s2 = this.solveArm(pl, a, ownerPose, cand, obstacles);
      const w2 = s2.worst ? s2.worst.distance : Infinity;
      if (s2.valid || w2 > startWorst) {
        a.palmLocal = cand;
        a.solve = s2;
      } else a.solve = startSolve;
      a.obstructed = true;
      a.poseErrorM = Math.max(0, -(a.solve.worst?.distance ?? 0) - P.surfaceTolM);
      a.poleLocal = a.solve.pole;
      a.touching = this.touchId(a.solve);
      this.storePrevLocal(a, ownerPose);
      return;
    }
    let blocked: Hit | null = null;
    const sweep = (from: Vec3, to: Vec3): { at: Vec3; solve: ArmPoseSolve } => {
      const d = len(sub(to, from));
      const n = Math.max(1, Math.ceil(d / P.queryStepM));
      let last = from;
      let lastSolve = startSolve;
      for (let i = 1; i <= n; i++) {
        const q = add(from, scale(sub(to, from), i / n));
        const s = this.solveArm(pl, { ...a, poleLocal: lastSolve.pole }, ownerPose, q, obstacles);
        if (s.valid) {
          last = q;
          lastSolve = s;
          continue;
        }
        // bisect to the contact surface
        let lo = last;
        let hi = q;
        for (let k = 0; k < 4; k++) {
          const mid = scale(add(lo, hi), 0.5);
          const sm = this.solveArm(pl, { ...a, poleLocal: lastSolve.pole }, ownerPose, mid, obstacles);
          if (sm.valid) {
            lo = mid;
            lastSolve = sm;
          } else {
            hi = mid;
            blocked = sm.worst;
          }
        }
        blocked = blocked ?? s.worst;
        return { at: lo, solve: lastSolve };
      }
      return { at: last, solve: lastSolve };
    };
    let r = sweep(a.palmLocal, cand);
    a.obstructed = false;
    if (blocked) {
      a.obstructed = true;
      const nL = qInvRot(ownerPose.q, (blocked as Hit).normal);
      const rem = sub(cand, r.at);
      const into = dot(rem, nL);
      const slide = into < 0 ? sub(rem, scale(nL, into)) : rem;
      if (len(slide) > 1e-4) {
        blocked = null;
        const to = this.clampShell(pl, a.side, add(r.at, slide));
        const r2 = sweep(r.at, to);
        r = r2;
      }
    }
    a.palmLocal = r.at;
    a.solve = r.solve;
    a.poleLocal = r.solve.pole;
    a.poseErrorM = 0;
    a.touching = this.touchId(r.solve);
    this.storePrevLocal(a, ownerPose);
  }

  private touchId(s: ArmPoseSolve): PlayerId | null {
    const tol = this.profile.surfaceTolM;
    for (const h of [s.palmHit, s.forearmHit]) if (h && h.distance <= tol) return h.obstacle.playerId;
    return null;
  }

  /** Referee ending was recorded: no new acquisitions from now on. */
  ended = false;

  /**
   * Referee ending (Gate 4 rule observer): every grip and forearm clamp ends ('playEnded') so no active arm shortening
   * or closing force continues, and nothing new is acquired. Physical bodies keep colliding and settling.
   *
   * The one exception (contact motion polish 2.1, the hold through the whistle, `FallLinkProfile.throughEnding`; no
   * fixture has it): a supported owner riding the carrier down at the ending is mid-takedown, still on him, and his
   * clamps and ride patches are kept (`ArmRt.kept`) under their own rules but this one, his requests frozen as a falling
   * owner's are, until his own switch carries them on as links (`linkBegin`) or he stops riding without it ('playEnded'
   * then, `keeps`). Their closing force goes through the same allocator, ceilings and ledger as before the ending. Nothing
   * new is acquired after it, by him or anyone.
   */
  endPlay(): void {
    if (this.ended) return;
    this.ended = true;
    for (const pl of this.host.players()) {
      const rec = this.arms.get(pl.id);
      if (!rec) continue;
      const ownerPose: Pose = { p: vc(pl.rb.translation()), q: { ...pl.rb.rotation() } };
      const keep = !!this.fallLink?.throughEnding && !!pl.riding && !pl.falling && !pl.ragdoll;
      for (const side of SIDES) {
        const a = rec[side];
        a.contactHoldUntil = null;
        if (keep && (a.clamp || a.ride)) {
          a.kept = true;
          this.host.emit('holdThroughEnding', pl.id, { arm: side, clamp: a.clamp?.id ?? null, ride: !!a.ride, target: a.clamp?.targetId ?? a.ride?.targetId ?? null });
        }
        if (a.ride && !a.kept) this.endRide(pl, a, 'playEnded');
        if (a.gripId) this.release(pl, a, 'playEnded', ownerPose);
        if (a.clamp && !a.kept) {
          this.host.emit('clampEnd', pl.id, { arm: side, clamp: a.clamp.id, reason: 'playEnded', gap: null });
          a.clamp = null;
        }
      }
    }
  }

  /**
   * Polish 2.1, the hold through the whistle: whether an arm the ending kept still holds on (his own switch not yet come):
   * its owner riding, or leaving his support for the takedown that converts him next substep, or falling into it.
   */
  private keeps(pl: ArmHostPlayer, a: ArmRt): boolean {
    return !!a.kept && this.ended && !pl.ragdoll && (!!pl.riding || !!pl.leaving || !!pl.falling);
  }

  /** Polish 2.1: a kept arm's hold ends with the play's end after all (he stopped riding without converting) or his switch. */
  private unkeep(pl: ArmHostPlayer, a: ArmRt, reason: 'playEnded' | null): void {
    a.kept = false;
    if (!reason) return;
    if (a.ride) this.endRide(pl, a, reason);
    if (a.clamp) {
      this.host.emit('clampEnd', pl.id, { arm: a.side, clamp: a.clamp.id, reason, gap: null });
      a.clamp = null;
    }
  }

  private release(pl: ArmHostPlayer, a: ArmRt, reason: ReleaseReason, ownerPose: Pose): void {
    const g = a.gripId ? this.grips.get(a.gripId) : undefined;
    if (!g) return;
    this.grips.delete(g.id);
    a.gripId = null;
    a.armed = false;
    a.needOpen = true;
    a.withdrawFrom = g.targetId;
    a.lastRelease = { reason, t: this.host.t };
    a.phase = 'recover';
    if (a.solve) a.palmLocal = this.clampShell(pl, a.side, toLocal(ownerPose, a.solve.palm));
    a.wantedLocal = { ...a.palmLocal };
    this.host.emit('gripRelease', pl.id, { arm: a.side, grip: g.id, reason, exposure: round(g.overloadExposureS, 4), heldTicks: this.host.tick - g.createdAtTick });
  }

  // ---------------------------------------------------------------- stage 9-10: after the solve
  postStep(): void {
    const P = this.profile;
    const host = this.host;
    const players = host.players();
    for (const pl of players) {
      const rec = this.arms.get(pl.id);
      if (!rec) continue;
      const ownerPre = this.prePose(pl.rb);
      const ownerPost = poseOfRb(pl.rb);
      const obstacles = this.opponents(pl.id);
      if (pl.ragdoll) {
        this.postStepPhysical(pl, rec, ownerPost);
        continue;
      }
      for (const side of SIDES) {
        const a = rec[side];
        if (!a.enabled) continue;
        if (a.gripId) {
          const g = this.grips.get(a.gripId)!;
          const tgt = this.player(g.targetId);
          if (!tgt) {
            this.release(pl, a, 'lostTarget', ownerPost);
          } else {
            const tp = poseOfRb(this.partBody(tgt, g.targetPart));
            const pW = toWorld(tp, g.targetPointLocal);
            const sW = toWorld(ownerPost, shoulderLocal(pl.body, side));
            const L = len(sub(pW, sW));
            if (L > P.maxReachM + P.hold.reachTolM) this.release(pl, a, 'unreachable', ownerPost);
            else if (dot(qRot(tp.q, g.targetNormalLocal), sub(sW, pW)) <= 0) this.release(pl, a, 'invalidSurface', ownerPost);
            else {
              const sol = this.solveArm(pl, a, ownerPost, a.palmLocal, obstacles, undefined, pW);
              if (!sol.valid) this.release(pl, a, 'invalidPose', ownerPost);
              else {
                a.solve = sol;
                a.poleLocal = sol.pole;
                a.palmLocal = toLocal(ownerPost, pW);
                this.storePrevLocal(a, ownerPost);
                continue;
              }
            }
          }
        }
        // Free arm: replay the opponents' motion relative to the owner against the palm (no query tunnelling).
        const poses = new Map<Obstacle, Pose>();
        const relPre = new Map<Obstacle, Pose>();
        const relPost = new Map<Obstacle, Pose>();
        let maxDisp = 0;
        for (const o of obstacles) {
          const pre = this.prePoses.get(o.rb.handle);
          const bodyPost = poseOfRb(o.rb);
          const rp = relPose(ownerPre, composePose(pre ?? bodyPost, o.local));
          const rq = relPose(ownerPost, composePose(bodyPost, o.local));
          relPre.set(o, rp);
          relPost.set(o, rq);
          maxDisp = Math.max(maxDisp, len(sub(rq.p, rp.p)) + qAngleBetween(rp.q, rq.q) * 0.6);
        }
        const n = Math.max(1, Math.ceil(maxDisp / P.queryStepM));
        let palm = a.palmLocal;
        const identity: Pose = { p: v3(), q: { x: 0, y: 0, z: 0, w: 1 } };
        for (let k = 1; k <= n; k++) {
          for (const o of obstacles) {
            const rp = relPre.get(o)!;
            const rq = relPost.get(o)!;
            poses.set(o, { p: add(rp.p, scale(sub(rq.p, rp.p), k / n)), q: qSlerp(rp.q, rq.q, k / n) });
          }
          const wristL = a.solve ? toLocal(ownerPre, a.solve.wrist) : palm;
          const pc = this.palmCenter(palm, wristL);
          const h = this.query(this.palmBall, toWorld(identity, pc), identity.q, obstacles, 0.001, poses);
          if (h && h.distance < 0) palm = addScaled(palm, h.normal, -h.distance + 0.001);
        }
        palm = this.clampShell(pl, side, palm);
        // final pose against the solved bodies; push out along the deepest overlap if still invalid
        let sol = this.solveArm(pl, a, ownerPost, palm, obstacles);
        for (let it = 0; it < 3 && !sol.valid && sol.worst; it++) {
          const nL = qInvRot(ownerPost.q, sol.worst.normal);
          palm = this.clampShell(pl, side, addScaled(palm, nL, -sol.worst.distance + 0.002));
          sol = this.solveArm(pl, a, ownerPost, palm, obstacles);
        }
        a.palmLocal = palm;
        a.solve = sol;
        a.poleLocal = sol.pole;
        a.poseErrorM = sol.valid ? 0 : Math.max(0, -(sol.worst?.distance ?? 0) - P.surfaceTolM);
        a.touching = this.touchId(sol);
        if (a.clamp && (!sol.forearmHit || sol.forearmHit.distance > P.surfaceTolM)) {
          // polish 1.2, the ride hold: the patch keeps the clamp through lost contact, within its break rules
          const why = a.ride ? this.rideBreak(pl, a, a.ride, ownerPost, sol, false) : null;
          if (a.ride && !why) a.touching = a.ride.targetId;
          else {
            if (a.ride) this.endRide(pl, a, why!);
            else if (this.rideHold && pl.riding) a.rideLast = { c: a.clamp, t: host.t };
            // actual separation: pressure and friction stop now; memory cleared
            host.emit('clampEnd', pl.id, { arm: side, clamp: a.clamp.id, reason: 'contactLost', gap: sol.forearmHit ? round(sol.forearmHit.distance, 4) : null });
            a.clamp = null;
          }
        }
        this.storePrevLocal(a, ownerPost);
      }
      this.classifyWrap(pl, rec, ownerPost);
    }
  }

  // ---------------------------------------------------------------- wrap classification (observational)
  private classifyWrap(pl: ArmHostPlayer, rec: Record<ArmSide, ArmRt>, ownerPose: Pose): void {
    const P = this.profile;
    const active: { side: ArmSide; target: PlayerId; point: Vec3; a: ArmRt; physical?: boolean }[] = [];
    for (const side of SIDES) {
      const a = rec[side];
      if (!a.enabled) continue;
      if (a.gripId) {
        const g = this.grips.get(a.gripId)!;
        const tgt = this.player(g.targetId);
        if (tgt) active.push({ side, target: g.targetId, point: toWorld(poseOfRb(this.partBody(tgt, g.targetPart)), g.targetPointLocal), a });
      } else if (pl.ragdoll) {
        // physical forearm/palm (Gate 4): current solved manifolds with an opponent and real normal loading only
        const m = this.physicalArmContact(pl, side);
        if (m) active.push({ side, target: m.target, point: m.point, a, physical: true });
      } else if (a.clamp && a.clamp.normalForceN > P.wrap.minClampNormalN) {
        active.push({ side, target: a.clamp.targetId, point: a.clamp.pointWorld, a });
      }
    }
    const prev = this.wrap.get(pl.id)!;
    let status: WrapStatus = 'noHold';
    let target: PlayerId | null = null;
    const az: Partial<Record<ArmSide, number>> = {};
    const reasons: string[] = [];
    let basis: { near: Vec3; side: Vec3 } | null = null;
    if (active.length === 1) {
      status = 'oneArmHold';
      target = active[0].target;
    } else if (active.length === 2) {
      if (active[0].target !== active[1].target) {
        status = 'oneArmHold';
        target = active[0].target;
        reasons.push('differentTargets');
      } else {
        target = active[0].target;
        const tgt = this.player(target)!;
        const tp = poseOfRb(tgt.rb);
        const shMid = scale(add(toWorld(ownerPose, shoulderLocal(pl.body, 'left')), toWorld(ownerPose, shoulderLocal(pl.body, 'right'))), 0.5);
        const key = `${pl.id}|${target}`;
        const nearRaw = horiz(sub(shMid, tp.p));
        if (len(nearRaw) > 1e-3) {
          const near = norm(nearRaw);
          basis = { near, side: norm(cross(near, UP)) };
          this.wrapBasis.set(key, basis);
        } else basis = this.wrapBasis.get(key) ?? null;
        status = 'twoArmHold';
        if (!basis) reasons.push('noBasis');
        else {
          for (const c of active) {
            const r = horiz(sub(c.point, tp.p));
            az[c.side] = (Math.atan2(dot(r, basis.side), dot(r, basis.near)) * 180) / Math.PI;
          }
          const l = az.left ?? 0;
          const rr = az.right ?? 0;
          if (Math.sign(l) === Math.sign(rr) || l === 0 || rr === 0) reasons.push('sameSide');
          if (Math.abs(l) < P.wrap.azimuthMinDeg || Math.abs(rr) < P.wrap.azimuthMinDeg) reasons.push('azimuth');
          for (const c of active) {
            const y = toLocal(tp, c.point).y;
            if (y < P.wrap.bandLowM || y > P.wrap.bandHighM) reasons.push(`band:${c.side}`);
            if (!c.physical && !pl.ragdoll && !c.a.solve?.valid) reasons.push(`pose:${c.side}`);
            if (c.a.gripId && !pl.ragdoll) {
              const sW = toWorld(ownerPose, shoulderLocal(pl.body, c.side));
              if (len(sub(c.point, sW)) > P.maxReachM + P.hold.reachTolM) reasons.push(`reach:${c.side}`);
            }
          }
          if (reasons.length === 0) status = 'wrapped';
        }
      }
    }
    if (status !== prev.status) {
      this.host.emit('wrapStatus', pl.id, { status, from: prev.status, target, azimuthDeg: Object.fromEntries(Object.entries(az).map(([k, v]) => [k, round(v as number, 1)])), reasons: reasons.join(',') });
    }
    this.wrap.set(pl.id, { status, target, azimuthDeg: az, basis, reasons });
  }

  // ---------------------------------------------------------------- Gate 4: physical arms and representation changes
  /** Achieved arm landmarks of a ragdoll owner, read from its forearm/upper-arm bodies (no query solve). */
  private physicalSolve(pl: ArmHostPlayer, a: ArmRt): void {
    const r = pl.ragdoll!;
    a.solve = {
      elbow: landmarkWorld(r, `${a.side}Elbow`),
      wrist: landmarkWorld(r, `${a.side}Wrist`),
      palm: landmarkWorld(r, `${a.side}Palm`),
      pole: a.poleLocal,
      valid: true,
      worst: null,
      palmHit: null,
      forearmHit: null,
    };
  }

  /** Strongest current manifold between a ragdoll owner's forearm/palm colliders and an opponent (normal loading). */
  private physicalArmContact(pl: ArmHostPlayer, side: ArmSide): { target: PlayerId; point: Vec3; impulse: number } | null {
    const P = this.profile;
    const minImp = P.wrap.minClampNormalN * this.host.dt;
    let best: { target: PlayerId; point: Vec3; impulse: number } | null = null;
    for (const c of this.host.contacts()) {
      for (const [own, other] of [[c.a, c.b], [c.b, c.a]] as const) {
        if (own.playerId !== pl.id || own.side !== side || (own.region !== 'forearm' && own.region !== 'palm')) continue;
        if (!other.playerId || other.playerId === pl.id) continue;
        // contact motion: a supported proxy's physical leg is not a grip surface: a grip anchors on the proxy's body, which
        // the shown leg moves across, so the hand would hold a point the leg has left
        if (isSupportedLeg(other)) continue;
        if (c.impulse < minImp) continue;
        let pt = c.points[0].pointWorld;
        let bi = -1;
        for (const p of c.points) if (p.impulse > bi) {
          bi = p.impulse;
          pt = p.pointWorld;
        }
        if (!best || c.impulse > best.impulse) best = { target: other.playerId, point: pt, impulse: c.impulse };
      }
    }
    return best;
  }

  private postStepPhysical(pl: ArmHostPlayer, rec: Record<ArmSide, ArmRt>, ownerPost: Pose): void {
    const K = this.passive;
    for (const side of SIDES) {
      const a = rec[side];
      if (!a.enabled) continue;
      const g = a.gripId ? this.grips.get(a.gripId) : undefined;
      if (g?.passive && K) {
        const tgt = this.player(g.targetId);
        if (!tgt) this.release(pl, a, 'lostTarget', ownerPost);
        else {
          const pT = toWorld(poseOfRb(this.partBody(tgt, g.targetPart)), g.targetPointLocal);
          const pO = toWorld(poseOfRb(pl.ragdoll!.bodies[g.passive.ownerPart]), g.passive.ownerPointLocal);
          if (len(sub(pT, pO)) > K.maxSeparationM) this.release(pl, a, 'separation', ownerPost);
        }
      }
      // polish 2.1, the fall link: its target gone, or stretched past its separation after the solve
      const L = a.link;
      if (L && this.fallLink) {
        const tgt = this.player(L.targetId);
        if (!tgt) this.endLink(pl, a, 'lostTarget');
        else if (!this.fallLink.noBreak && len(sub(toWorld(poseOfRb(this.partBody(tgt, L.part)), L.pointLocal), toWorld(poseOfRb(pl.ragdoll!.bodies[L.ownerPart]), L.ownerPointLocal))) > this.fallLink.maxSeparationM) this.endLink(pl, a, 'separation');
      }
      this.physicalSolve(pl, a);
      const touch = this.physicalArmContact(pl, side);
      a.touching = touch?.target ?? null;
      if (a.contactHoldUntil !== null) {
        if (this.host.t > a.contactHoldUntil) a.contactHoldUntil = null;
        else if (touch) a.contactHoldUntil = this.host.t + this.holdMemoryS;
        if (a.contactHoldUntil === null && a.carried) a.carried = null;
      }
    }
    this.classifyWrap(pl, rec, ownerPost);
  }

  /** World anchors of every grip/clamp involving `ids`, captured before their representation changes. */
  captureRelations(ids: PlayerId[]): Map<string, { anchor: Vec3; normal: Vec3; palm: Vec3 | null }> {
    const out = new Map<string, { anchor: Vec3; normal: Vec3; palm: Vec3 | null }>();
    for (const g of this.grips.values()) {
      if (!ids.includes(g.ownerId) && !ids.includes(g.targetId)) continue;
      const tgt = this.player(g.targetId);
      if (!tgt) continue;
      const tp = poseOfRb(this.partBody(tgt, g.targetPart));
      const a = this.arms.get(g.ownerId)?.[g.arm];
      out.set(g.id, { anchor: toWorld(tp, g.targetPointLocal), normal: qRot(tp.q, g.targetNormalLocal), palm: a?.solve ? { ...a.solve.palm } : null });
    }
    // polish 2.1, the fall link: a converting owner's clamps (the point on the body it holds, as that body is now) and the
    // links on a converting target (keys of their own, so nothing else reads them)
    if (this.fallLink)
      for (const pl of this.host.players()) {
        const rec = this.arms.get(pl.id);
        if (!rec) continue;
        for (const side of SIDES) {
          const a = rec[side];
          const c = a.clamp;
          const ct = c && ids.includes(pl.id) ? this.player(c.targetId) : undefined;
          if (c && ct) {
            const tp = poseOfRb(this.partBody(ct, c.targetPart));
            out.set(`${c.id}:link`, { anchor: toWorld(tp, c.pointTargetLocal), normal: c.outwardNormalWorld, palm: null });
          }
          const L = a.link;
          const lt = L && ids.includes(L.targetId) ? this.player(L.targetId) : undefined;
          if (L && lt) {
            const tp = poseOfRb(this.partBody(lt, L.part));
            out.set(L.id, { anchor: toWorld(tp, L.pointLocal), normal: qRot(tp.q, L.normalLocal), palm: null });
          }
        }
      }
    return out;
  }

  /**
   * Remap relationships once after an atomic representation switch (section 10). Target conversions move each grip
   * anchor to the new segment that carries the same world point (verified on an eligible surface within the surface
   * tolerance, otherwise released). Owner conversions end virtual forearm clamps before the first ragdoll step and
   * turn surviving palm grips into passive palm-to-target links on the forearm body. Both resolve against the same
   * pre-switch snapshot.
   */
  onRepresentationChange(switched: PlayerId[], captured: Map<string, { anchor: Vec3; normal: Vec3; palm: Vec3 | null }>): void {
    const P = this.profile;
    const host = this.host;
    for (const pl of host.players()) if (switched.includes(pl.id)) this.buildObstacles(pl);
    const grips = [...this.grips.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (const g of grips) {
      const cap = captured.get(g.id);
      if (!cap) continue;
      const owner = this.player(g.ownerId)!;
      const a = this.arms.get(g.ownerId)![g.arm];
      // ---- target became a ragdoll: same world anchor on its new segment, verified on an eligible surface
      if (switched.includes(g.targetId)) {
        const tgt = this.player(g.targetId)!;
        let best: { o: Obstacle; d: number } | null = null;
        for (const o of this.obstacles.get(tgt.id) ?? []) {
          if (!ELIGIBLE.includes(o.region)) continue;
          const pr = o.collider.projectPoint(cap.anchor, false);
          if (!pr) continue;
          const d = len(sub(vc(pr.point), cap.anchor)) * (pr.isInside ? -1 : 1);
          if (!best || Math.abs(d) < Math.abs(best.d)) best = { o, d };
        }
        const from = g.targetPart;
        if (!best || Math.abs(best.d) > P.surfaceTolM) {
          host.emit('gripRemap', g.ownerId, { grip: g.id, target: g.targetId, ok: false, surfaceDistM: best ? round(best.d, 5) : null, from, to: best?.o.part ?? null });
          this.release(owner, a, 'invalidSurface', poseOfRb(owner.rb));
          continue;
        }
        const sp = poseOfRb(best.o.rb);
        g.targetPart = best.o.part;
        g.targetPointLocal = toLocal(sp, cap.anchor);
        g.targetNormalLocal = qInvRot(sp.q, cap.normal);
        const back = toWorld(poseOfRb(best.o.rb), g.targetPointLocal);
        host.emit('gripRemap', g.ownerId, { grip: g.id, target: g.targetId, ok: true, from, to: g.targetPart, region: best.o.region, surfaceDistM: round(best.d, 5), anchorErrM: round(len(sub(back, cap.anchor)), 8), exposureS: round(g.overloadExposureS, 4) });
      }
      // ---- owner became a ragdoll: active shortening stops; the palm landmark is mapped onto the forearm body
      if (switched.includes(g.ownerId) && owner.ragdoll && this.grips.has(g.id)) {
        const part = `${g.arm}Forearm` as SegmentId;
        const lmk = owner.ragdoll.landmarks[`${g.arm}Palm`];
        const fb = owner.ragdoll.bodies[part];
        const palmW = toWorld(poseOfRb(fb), lmk.local);
        const tgt = this.player(g.targetId)!;
        const anchorW = toWorld(poseOfRb(this.partBody(tgt, g.targetPart)), g.targetPointLocal);
        const gap = len(sub(anchorW, palmW));
        if (!this.passive || gap > this.passive.maxSeparationM) {
          host.emit('gripPassive', g.ownerId, { grip: g.id, ok: false, palmGapM: round(gap, 5) });
          this.release(owner, a, 'separation', poseOfRb(owner.rb));
          continue;
        }
        g.passive = { ownerPart: part, ownerPointLocal: { ...lmk.local }, since: host.t };
        host.emit('gripPassive', g.ownerId, { grip: g.id, ok: true, ownerPart: part, palmGapM: round(gap, 5), palmShiftM: cap.palm ? round(len(sub(palmW, cap.palm)), 6) : null, exposureS: round(g.overloadExposureS, 4) });
      }
    }
    // ---- clamps
    for (const pl of host.players()) {
      const rec = this.arms.get(pl.id);
      if (!rec) continue;
      for (const side of SIDES) {
        const a = rec[side];
        // contact motion M3: a carried patch is on the body its target had (the hold itself goes on by solved contact)
        if (a.carried && switched.includes(a.carried.targetId)) a.carried = null;
        // polish 2.1, the fall link: a target converting after its owner carries it to his new body at the same point
        if (a.link && switched.includes(a.link.targetId)) this.linkRemap(pl, a, captured.get(a.link.id));
        // polish 1.2: the ride hold ends with the owner's switch (the clamp is carried below) or its target's
        if (a.ride && (switched.includes(pl.id) || switched.includes(a.ride.targetId))) this.endRide(pl, a, switched.includes(pl.id) ? 'ownerRagdoll' : 'targetSwitched');
        // (and a riding owner's clamp on the carrier that lapsed within the ride's contact memory is the hold his
        // conversion carries, when its point is on his new body)
        const last = a.rideLast;
        if (last) a.rideLast = null;
        if (!a.clamp && last && this.rideHold && pl.riding && !pl.falling && !this.ended && !switched.includes(pl.id) && switched.includes(last.c.targetId) && host.t - last.t <= this.rideHold.memoryS + 1e-9) {
          a.clamp = last.c;
          this.rideRemap(pl, a);
          if (!a.ride) a.clamp = null;
          else host.emit('clampBegin', pl.id, { arm: side, target: a.clamp.targetId, region: a.ride.region, point: rv(a.clamp.pointWorld), u: round(a.clamp.forearmParameter, 3), closingError: 0, gap: null, ride: true });
        }
        if (!a.clamp) continue;
        if (switched.includes(pl.id)) {
          // owner converted: the virtual closing normal/friction force stops before the first ragdoll step
          host.emit('clampEnd', pl.id, { arm: side, clamp: a.clamp.id, reason: 'ownerRagdoll', gap: null });
          // contact motion M3: the patch the hold presses on, unless its target switched in the same batch
          const tgt = this.pressCarried && this.holdMemoryS > 0 && !switched.includes(a.clamp.targetId) ? this.player(a.clamp.targetId) : undefined;
          if (tgt) {
            const cap = captured.get(a.clamp.id);
            const tp = poseOfRb(this.partBody(tgt, a.clamp.targetPart));
            a.carried = { targetId: tgt.id, part: a.clamp.targetPart, pointLocal: toLocal(tp, cap?.anchor ?? a.clamp.pointWorld), normalLocal: qInvRot(tp.q, cap?.normal ?? a.clamp.outwardNormalWorld), u: a.clamp.forearmParameter };
          }
          // polish 2.1, the fall link: the clamp goes on as a link from his ragdoll forearm
          if (this.fallLink) this.linkBegin(pl, a, a.clamp, switched, captured.get(`${a.clamp.id}:link`));
          a.clamp = null;
          // plan 09: the physical forearm carries the hold on, for as long as solved contact keeps it alive
          if (this.holdMemoryS > 0) a.contactHoldUntil = host.t + this.holdMemoryS;
        } else if (switched.includes(a.clamp.targetId)) {
          // target converted: the supported owner's query forearm is requeried against the new segments next substep;
          // only a continuing contact on the same part/region keeps its elastic history
          host.emit('clampRemap', pl.id, { arm: side, clamp: a.clamp.id, key: a.clamp.obstacleKey, target: a.clamp.targetId });
          // polish 1.2, the ride hold: a riding owner's clamp goes on as a patch on the carrier's new body
          // (polish 2.1: an arm the ending kept too: the hold he has, on the carrier's new body)
          if (this.rideHold && pl.riding && !pl.falling && (!this.ended || this.keeps(pl, a)) && !a.ride) this.rideRemap(pl, a);
        }
      }
      if (switched.includes(pl.id)) {
        for (const side of SIDES) {
          const a = rec[side];
          a.phase = 'physical';
          a.requestedWorld = null;
          a.armed = false;
          // (polish 2.1: an arm the ending kept has carried its hold on, above)
          if (a.kept) this.unkeep(pl, a, null);
          this.physicalSolve(pl, a);
        }
      }
    }
  }

  // ---------------------------------------------------------------- polish 1.2: the ride hold
  /**
   * The ride hold's end: the ride over (a supported riding owner, a ragdoll target, play on) or the patch gone. (Polish
   * 2.1: an arm the ending kept, play on or not, and riding or leaving his support for the takedown that converts him.)
   */
  private rideOff(pl: ArmHostPlayer, rp: RidePatch, a: ArmRt): boolean {
    const kept = !!a.kept && this.keeps(pl, a);
    return !this.rideHold || !(pl.riding || kept) || !!pl.falling || (this.ended && !kept) || !this.player(rp.targetId)?.ragdoll;
  }

  /**
   * The ride hold's break rules (null: it holds): the ride over; no contact with the carrier for `memoryS`; the patch out
   * of the arm's reach (farther from the shoulder than `maxReachM` and the hold's tolerance, plus the forearm's radius: the
   * patch is on the body's surface); the patch more than `separationM` from the forearm's surface. At the substep's start
   * (`pre`, the arm's pose of this substep) or after the solve. Overload is the allocator's.
   */
  private rideBreak(pl: ArmHostPlayer, a: ArmRt, rp: RidePatch, ownerPose: Pose, sol: ArmPoseSolve, pre: boolean): string | null {
    if (this.rideOff(pl, rp, a)) return 'rideEnded';
    if (this.rideHold!.noBreak) return null;
    if (this.host.t > rp.until + 1e-9) return 'contactLost';
    const P = this.profile;
    const rb = this.partBody(this.player(rp.targetId)!, rp.part);
    const pW = toWorld(pre ? this.prePose(rb) : poseOfRb(rb), rp.pointLocal);
    if (len(sub(pW, toWorld(ownerPose, shoulderLocal(pl.body, a.side)))) > P.maxReachM + P.hold.reachTolM + P.forearmRadiusM) return 'unreachable';
    if (segmentDistance(pW, sol.elbow, sol.wrist) - P.forearmRadiusM > this.rideHold!.separationM) return 'separation';
    return null;
  }

  /** The ride hold's patch as the clamp's forearm hit (this substep's start): its point and normal, the forearm at its parameter. */
  private rideHit(rp: RidePatch, sol: ArmPoseSolve): Hit | null {
    const o = (this.obstacles.get(rp.targetId) ?? []).find((x) => x.part === rp.part && x.region === rp.region);
    if (!o) return null;
    const sp = this.prePose(o.rb);
    const pW = toWorld(sp, rp.pointLocal);
    const nW = qRot(sp.q, rp.normalLocal);
    const qA = addScaled(sol.elbow, sub(sol.wrist, sol.elbow), rp.u);
    return { distance: dot(sub(qA, pW), nW) - this.profile.forearmRadiusM, pointTarget: pW, normal: nW, pointQuery: qA, obstacle: o };
  }

  /** Ends an arm's ride patch (and, `endClamp`, the clamp it kept). Returns null (the caller's patch). */
  private endRide(pl: ArmHostPlayer, a: ArmRt, reason: string, endClamp = false): null {
    const rp = a.ride;
    if (!rp) return null;
    a.ride = null;
    this.host.emit('rideHoldEnd', pl.id, { arm: a.side, target: rp.targetId, part: rp.part, reason, heldS: round(this.host.t - rp.since, 4), exposureS: round(rp.exposureS, 4) });
    if (endClamp && a.clamp) {
      this.host.emit('clampEnd', pl.id, { arm: a.side, clamp: a.clamp.id, reason: 'rideHold', gap: null });
      a.clamp = null;
    }
    return null;
  }

  /**
   * At the carrier's conversion, a riding owner's clamp on him goes to the nearest eligible surface of his ragdoll at the
   * clamp's point (within `remapM`; beyond it the clamp is requeried as before), as a ride patch on that segment.
   */
  private rideRemap(pl: ArmHostPlayer, a: ArmRt): void {
    const c = a.clamp!;
    const tgt = this.player(c.targetId);
    if (!tgt?.ragdoll) return;
    const best = this.nearestSurface(tgt.id, c.pointWorld);
    const ok = !!best && Math.abs(best.d) <= this.rideHold!.remapM;
    this.host.emit('rideHoldRemap', pl.id, { arm: a.side, clamp: c.id, target: tgt.id, ok, from: c.targetPart, to: best?.o.part ?? null, region: best?.o.region ?? null, surfaceDistM: best ? round(best.d, 5) : null });
    if (!ok || !best) return;
    const sp = poseOfRb(best.o.rb);
    const pL = toLocal(sp, best.p);
    c.targetPart = best.o.part;
    c.obstacleKey = `${tgt.id}:${best.o.part}:${best.o.region}`;
    c.pointTargetLocal = pL;
    a.ride = {
      targetId: tgt.id,
      part: best.o.part,
      region: best.o.region,
      pointLocal: pL,
      normalLocal: qInvRot(sp.q, c.outwardNormalWorld),
      wantLocal: toLocal(sp, toWorld(poseOfRb(pl.rb), a.wantedLocal)),
      u: c.forearmParameter,
      until: this.host.t + this.rideHold!.memoryS,
      since: this.host.t,
      exposureS: 0,
    };
  }

  // ---------------------------------------------------------------- polish 2.1: the fall link
  /** The nearest eligible surface of `tgt`'s colliders to `pW` (signed: negative inside), or null. */
  private nearestSurface(tgt: PlayerId, pW: Vec3): { o: Obstacle; d: number; p: Vec3 } | null {
    let best: { o: Obstacle; d: number; p: Vec3 } | null = null;
    for (const o of this.obstacles.get(tgt) ?? []) {
      if (!ELIGIBLE.includes(o.region)) continue;
      const pr = o.collider.projectPoint(pW, false);
      if (!pr) continue;
      const d = len(sub(vc(pr.point), pW)) * (pr.isInside ? -1 : 1);
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { o, d, p: vc(pr.point) };
    }
    return best;
  }

  /**
   * At the owner's switch, his clamp `c` as a link: its point (`cap`, captured before the switch) in the
   * frames of the body it held (a target converting in the same batch: the nearest eligible surface of his new body,
   * within `remapM`) and of the owner's ragdoll forearm, which must be within `maxSeparationM` of it. Zero length.
   */
  private linkBegin(pl: ArmHostPlayer, a: ArmRt, c: { id: string; targetId: PlayerId; targetPart: BodyPartId; forearmParameter: number }, switched: PlayerId[], cap: { anchor: Vec3; normal: Vec3 } | undefined): void {
    const K = this.fallLink!;
    const tgt = this.player(c.targetId);
    const r = pl.ragdoll;
    if (!tgt || !r || !cap) return;
    let part = c.targetPart;
    let rb = this.partBody(tgt, part);
    if (switched.includes(tgt.id)) {
      const best = this.nearestSurface(tgt.id, cap.anchor);
      if (!best || Math.abs(best.d) > K.remapM) {
        this.host.emit('fallLinkBegin', pl.id, { arm: a.side, clamp: c.id, target: tgt.id, ok: false, reason: 'targetSwitched', surfaceDistM: best ? round(best.d, 5) : null });
        return;
      }
      part = best.o.part;
      rb = best.o.rb;
    }
    const ownerPart = `${a.side}Forearm` as SegmentId;
    const gap = segmentDistance(cap.anchor, landmarkWorld(r, `${a.side}Elbow`), landmarkWorld(r, `${a.side}Wrist`)) - this.profile.forearmRadiusM;
    if (gap > K.maxSeparationM) {
      this.host.emit('fallLinkBegin', pl.id, { arm: a.side, clamp: c.id, target: tgt.id, ok: false, reason: 'separation', gapM: round(gap, 5) });
      return;
    }
    const tp = poseOfRb(rb);
    // (`onArm`: his end on the drawn forearm and hand, the gap left to the patch its rest length)
    const on = K.onArm ? this.armSurface(r, a.side, cap.anchor) : null;
    a.link = {
      id: `${c.id}:link`,
      targetId: tgt.id,
      part,
      pointLocal: toLocal(tp, cap.anchor),
      normalLocal: qInvRot(tp.q, cap.normal),
      ownerPart,
      ownerPointLocal: toLocal(poseOfRb(r.bodies[ownerPart]), on?.p ?? cap.anchor),
      u: c.forearmParameter,
      since: this.host.t,
      overloadExposureS: 0,
      peakN: 0,
      ...(on ? { restM: on.d } : {}),
    };
    this.host.emit('fallLinkBegin', pl.id, { arm: a.side, clamp: c.id, link: a.link.id, target: tgt.id, ok: true, part, ownerPart, u: round(c.forearmParameter, 3), gapM: round(gap, 5), ...(on ? { offArmM: round(on.d, 5) } : {}) });
  }

  /**
   * Polish 2.1 (`FallLinkProfile.onArm`): the point of the ragdoll's forearm and hand as drawn (the forearm capsule, elbow
   * to wrist, and the palm ball at the hand) nearest `pW`, and how far outside them `pW` lies (0 and `pW`: on or in them).
   */
  private armSurface(r: Ragdoll, side: ArmSide, pW: Vec3): { p: Vec3; d: number } {
    const R = r.profile.radii;
    const e = landmarkWorld(r, `${side}Elbow`);
    const ew = sub(landmarkWorld(r, `${side}Wrist`), e);
    const onAxis = addScaled(e, ew, clamp(dot(sub(pW, e), ew) / Math.max(1e-12, dot(ew, ew)), 0, 1));
    const hand = landmarkWorld(r, `${side}Hand`);
    const [c, rad] = len(sub(pW, hand)) - R.palm < len(sub(pW, onAxis)) - R.forearm ? [hand, R.palm] : [onAxis, R.forearm];
    const off = sub(pW, c);
    const d = len(off) - rad;
    return d <= 0 ? { p: pW, d: 0 } : { p: addScaled(c, off, rad / len(off)), d };
  }

  /** The link's break rules at the substep's start (null: it holds): stretched past `maxSeparationM`; the patch out of reach of the ragdoll's shoulder. */
  private linkBreak(pl: ArmHostPlayer, a: ArmRt, pT: Vec3, d: number): string | null {
    const K = this.fallLink!;
    if (K.noBreak) return null;
    if (d > K.maxSeparationM) return 'separation';
    const P = this.profile;
    if (len(sub(pT, landmarkWorld(pl.ragdoll!, `${a.side}Shoulder`))) > P.maxReachM + P.hold.reachTolM + P.forearmRadiusM) return 'unreachable';
    return null;
  }

  /** A target converting after the owner: the link's point (`cap`) on the nearest eligible surface of his new body within `remapM`, else it ends. */
  private linkRemap(pl: ArmHostPlayer, a: ArmRt, cap: { anchor: Vec3; normal: Vec3 } | undefined): void {
    const L = a.link!;
    const best = cap ? this.nearestSurface(L.targetId, cap.anchor) : null;
    const ok = !!cap && !!best && Math.abs(best.d) <= this.fallLink!.remapM;
    this.host.emit('fallLinkRemap', pl.id, { arm: a.side, link: L.id, target: L.targetId, ok, from: L.part, to: best?.o.part ?? null, surfaceDistM: best ? round(best.d, 5) : null });
    if (!ok || !best || !cap) {
      this.endLink(pl, a, 'targetSwitched');
      return;
    }
    const sp = poseOfRb(best.o.rb);
    L.part = best.o.part;
    L.pointLocal = toLocal(sp, cap.anchor);
    L.normalLocal = qInvRot(sp.q, cap.normal);
  }

  private endLink(pl: ArmHostPlayer, a: ArmRt, reason: string): void {
    const L = a.link;
    if (!L) return;
    a.link = null;
    this.host.emit('fallLinkEnd', pl.id, { arm: a.side, link: L.id, target: L.targetId, part: L.part, reason, heldS: round(this.host.t - L.since, 4), exposureS: round(L.overloadExposureS, 4), peakN: round(L.peakN, 1) });
  }

  /** Polish 2.1: the player a fall link of this arm holds (null: none). */
  linkOf(id: PlayerId, side: ArmSide): PlayerId | null {
    return this.arms.get(id)?.[side].link?.targetId ?? null;
  }

  // ---------------------------------------------------------------- observation
  obs(id: PlayerId): Partial<Record<ArmSide, ArmObs>> | undefined {
    const rec = this.arms.get(id);
    const pl = this.player(id);
    if (!rec || !pl) return undefined;
    const pose = poseOfRb(pl.rb);
    const out: Partial<Record<ArmSide, ArmObs>> = {};
    for (const side of SIDES) {
      const a = rec[side];
      if (pl.ragdoll) this.physicalSolve(pl, a);
      const s = a.solve!;
      out[side] = {
        side,
        enabled: a.enabled,
        mode: a.mode,
        phase: a.phase,
        action: a.action,
        shoulderWorld: pl.ragdoll ? landmarkWorld(pl.ragdoll, `${side}Shoulder`) : toWorld(pose, shoulderLocal(pl.body, side)),
        elbowWorld: s.elbow,
        wristWorld: s.wrist,
        palmContactWorld: s.palm,
        requestedWorld: a.requestedWorld,
        wantedWorld: toWorld(pose, a.wantedLocal),
        gripId: a.gripId,
        clampContactId: a.clamp?.id ?? null,
        clampNormalN: a.clamp?.normalForceN ?? 0,
        armedForFreshContact: a.armed,
        touchingTarget: a.touching,
        obstructed: a.obstructed,
        poseValid: s.valid,
        poseErrorM: a.poseErrorM,
        lastRelease: a.lastRelease,
      };
    }
    return out;
  }

  /**
   * Plan 09: the hold this ragdoll owner's arm still has. A palm grip keeps its passive link; a forearm hold is the
   * clamp the arm had at conversion, kept by solved contact. Nothing here starts a new hold.
   */
  retained(id: PlayerId, side: ArmSide): 'grip' | 'link' | 'contact' | null {
    const a = this.arms.get(id)?.[side];
    if (!a) return null;
    if (a.gripId && this.grips.get(a.gripId)?.passive) return 'grip';
    // polish 2.1: a fall link holds while it lives, whatever solved contact does
    if (a.link) return 'link';
    return a.contactHoldUntil !== null ? 'contact' : null;
  }

  /**
   * Contact motion M3: where a retained forearm hold of `id` presses: the patch of the clamp it was carried from, on its
   * target as that body is now (world point and the unit normal into it), and the forearm parameter it held at. Null
   * when the arm holds no carried forearm hold (`pressCarried` off, a grip, a lapsed hold, a target that switched).
   */
  pressTarget(id: PlayerId, side: ArmSide): { point: Vec3; into: Vec3; u: number } | null {
    const a = this.arms.get(id)?.[side];
    // polish 2.1: a fall link's patch while it lives (with `pressCarried`, the press the hold has)
    const c = a?.link && this.pressCarried ? a.link : a?.contactHoldUntil !== null ? a?.carried : null;
    const tgt = c ? this.player(c.targetId) : undefined;
    if (!c || !tgt) return null;
    const tp = poseOfRb(this.partBody(tgt, c.part));
    return { point: toWorld(tp, c.pointLocal), into: scale(qRot(tp.q, c.normalLocal), -1), u: c.u };
  }

  clampOf(id: PlayerId, side: ArmSide): ClampContact | null {
    return this.arms.get(id)?.[side].clamp ?? null;
  }

  hasArms(id: PlayerId): boolean {
    return this.arms.has(id);
  }
}

/** Distance from a point to the segment a-b. */
function segmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 > 1e-12 ? clamp(dot(sub(p, a), d) / l2, 0, 1) : 0;
  return len(sub(p, addScaled(a, d, t)));
}
