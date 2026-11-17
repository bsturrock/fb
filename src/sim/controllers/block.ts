// Plan 16 (blocking), design items 2 and 3: the block controller and the engaged state. A behaviour a brain can pick: it
// takes a small request (whom to block, how hard, hold ground or drive), and from what it observes it turns to and closes
// on its man, brings the hands up, punches both palms onto his chest or the fronts of his shoulders (the palm push,
// arms.ts) and keeps them there at arm's length, pushing for as long as it runs. It assumes no fixture-wide profile and
// no run length: it can start at any time, and a brain stops it by running another controller in its place (its arms
// then go to rest and every push ends at no force; the engaged state goes with the request).
//
// The engaged state (`BlockState`, `PlayerRuntime.block`) is the player's own, kept by the simulation from his request
// and what holds between him and his man (a palm push either way, or their bodies touching), with hysteresis: it enters
// at once and leaves only after `engage.lostS` with nothing holding. The feet regime and the hip hinge read it, so neither
// follows a flickering contact.
import type { ArmIntent, ArmSide, PlayerId, PlayerIntent, StanceRequest } from '../contracts';
import type { BodyProfile, MotorProfile } from '../profiles';
import { sideSignX } from '../profiles';
import type { PlayerSetup } from '../fixture';
import type { HingeLimits } from '../hinge';
import type { Controller, ControllerContext } from './base';
import { clamp, dot, horiz, len, norm, qRot, rad, scale, sub, add, v3, type Vec3 } from '../vec';

/** What the block does once engaged: hold his ground (push back as he is moved) or drive his man back. */
export type BlockIntent = 'hold' | 'drive';
/**
 * Where his hands go on the other man: `under`, low and inside on his chest with the elbows down, the arms under the other
 * man's; `over`, together high on his upper chest, the arms over the other man's. A pair needs one of each: two men's arms
 * at one height share a lane and pass through each other (plan 16 p31).
 */
export type BlockHands = 'under' | 'over';

/**
 * What a fixture (or later a player's brain) hands the block controller: whom to block, how hard (`effort` 0..1: his
 * push and his drive), and what he does once engaged. `hands` (default the profile's) is where his palms go.
 */
export interface BlockRequest {
  target: PlayerId;
  effort: number;
  intent: BlockIntent;
  hands?: BlockHands;
}

/** The engaged state's phases: closing on his man, engaged with him, or engaged before and now lost. */
export type BlockPhase = 'approach' | 'engaged' | 'lost';

/**
 * The block's stance, one request the simulation's existing pieces carry out (an authored stance pose can take its
 * place as a whole): a whole-body lean toward the man (`leanDeg`, the balance profile's posture cap bounds it), the trunk
 * pitched beyond it on the hip hinge (`hingeDeg`, with the hinge's hip drop `dropM`; bounded by `BlockProfile.hinge`),
 * and the suspension's stance request: root height (`heightM`, knees bent) and the feet's stagger (`staggerM`, the left
 * foot forward of the right by it: the right foot back).
 */
export interface BlockStance {
  leanDeg: number;
  hingeDeg: number;
  dropM: number;
  heightM: number;
  staggerM: number;
}

/** A palm's aim on the other man, in his frame: height above his origin, distance off his centre line, depth from his chest's front (into him). */
export interface HandAim {
  y: number;
  x: number;
  depthM: number;
  /** The elbow's pole (owner-local direction from the shoulder; x outward from his midline, mirrored per arm), tried first. */
  pole?: Vec3;
  /** The arm's length for this placement (shoulder to palm, m; default the profile's `lengthM`). */
  lengthM?: number;
}

/** How a block closes, punches, holds and stands (`BlockSpec.profile`). */
export interface BlockProfile {
  id: string;
  /**
   * Closing speed (m/s) toward the man until the chest gap is `holdGapM`: min(mps, gainPerS x the gap still to close,
   * the speed the pair can stop from at `brakeMps2`; his man's own speed along the line counted in it); inside it (or
   * engaged with no hand on) he backs off, at most `backMps`. The gap is between the torso boxes' fronts as the proxies
   * stand (unpitched).
   */
  approach: { mps: number; gainPerS: number; holdGapM: number; brakeMps2: number; backMps: number };
  /** The palms punch from this chest-to-chest gap (m) on, and push at this arm length (shoulder to palm, m). */
  punchGapM: number;
  lengthM: number;
  /**
   * Engaged, the request toward the man at effort 1 (m/s, times the effort): always `pressMps`; driving, `driveMps` more;
   * holding, `hold.gainPerS` per metre he has been moved back from where he engaged, up to `hold.maxMps` in all.
   */
  pressMps: number;
  driveMps: number;
  hold: { gainPerS: number; maxMps: number };
  /** The hands while closing (own frame): palms `forwardM` ahead of his chest, `x` off his centre line, at height `y`. */
  ready: { forwardM: number; x: number; y: number };
  /** The palms' aims by placement, and the default placement. */
  hands: Record<BlockHands, HandAim> & { default: BlockHands };
  /** A palm come off pulls back this far in front of the man's chest (m) to re-arm before it punches again. */
  recoverM: number;
  stance: BlockStance;
  /** The hip hinge's bounds under the block (the stance's hinge request). */
  hinge: HingeLimits;
  /** The engaged state leaves after this long (s) with nothing holding between the two men. */
  engage: { lostS: number };
}

/**
 * Over and under (plan 16 p31). Two men's hands at one height share a lane: their forearms pass 12 cm through each other
 * (the drawn arms are 6-10 cm thick on a 23 cm half chest, so lanes side by side cannot clear), and hands on the fronts
 * of the shoulders land in the other man's upper arms (8-9 cm). Under: palms 0.36 m up his chest, 9 cm off its centre,
 * the elbows down (a pole below the shoulder), at 0.64 m of arm. Over: palms together on his upper chest (0.55 m up,
 * 3.5 cm off the centre), at 0.57 m. Both pairs of hands go on square and half a man off centre, the two men's push forces
 * within 30 %. Not solved: at arm's length the over man's forearms still lie 8-9 cm in the under man's (a known defect;
 * arms avoid bodies, not other arms). Lower under hands (0.33 m) clear it to 4 cm only from a close start, and are not
 * born off centre (the arm line too steep on his chest, `notFacing`).
 */
export const BLOCK_V1_HANDS: BlockProfile['hands'] = {
  default: 'under',
  under: { y: 0.36, x: 0.09, depthM: 0.08, pole: v3(0.2, -1, 0.1), lengthM: 0.64 },
  over: { y: 0.55, x: 0.035, depthM: 0.08, lengthM: 0.57 },
};

/**
 * The first block (plan 16, 2026-11-17): closes at a walk (1.5 m/s), punches from a 0.45 m chest gap, pushes at 0.62 m
 * of arm (of 0.70 reach: the elbows a little bent, about 0.35 m chest to chest). Engaged at effort 1 he presses at 0.4
 * m/s (a stalled man: 160 N), drives at 0.8 (320 N), and holding pushes back 2 m/s per metre he has given up to 0.8.
 * The stance: 8 deg of lean, 12 more of trunk pitch on the hinge with 4 cm of hip drop, the root at 0.84 m (of 0.89
 * standing), the right foot 0.24 m behind the left. Hands: `BLOCK_V1_HANDS` (`lengthM` is the default for a placement without one). Lost 0.4 s after the last hold.
 */
export const BLOCK_V1: BlockProfile = {
  id: 'block-v1',
  approach: { mps: 1.5, gainPerS: 3, holdGapM: 0.65, brakeMps2: 2.5, backMps: 0.5 },
  punchGapM: 0.8,
  lengthM: 0.62,
  pressMps: 0.4,
  driveMps: 0.4,
  hold: { gainPerS: 2, maxMps: 0.8 },
  ready: { forwardM: 0.22, x: 0.14, y: 0.42 },
  hands: BLOCK_V1_HANDS,
  recoverM: 0.12,
  stance: { leanDeg: 8, hingeDeg: 12, dropM: 0.04, heightM: 0.84, staggerM: 0.24 },
  hinge: { maxDeg: 20, rateDegPerS: 60, accelDegPerS2: 300, maxDropM: 0.06, dropRateMps: 0.2 },
  engage: { lostS: 0.4 },
};

/**
 * A fixture's block (`ControllerSpec` kind `block`): the request, from `fromS` (default 0; before it he stands where he
 * is, facing as he started, arms at rest), under `profile` (default BLOCK_V1).
 */
export interface BlockSpec {
  kind: 'block';
  request: BlockRequest;
  fromS?: number;
  profile?: BlockProfile;
}

/** The player's engaged state (`PlayerRuntime.block`), kept by the simulation (`advanceBlockState`). */
export interface BlockState {
  target: PlayerId;
  phase: BlockPhase;
  /** When the phase began (s), and when something last held between him and his man (s; -Infinity: never). */
  since: number;
  lastOnT: number;
  /** The block's hinge bounds (its profile's), for the hinge his stance asks for. */
  hinge: HingeLimits;
}

/** The engaged state's fault switches (`SimDebug.block`; tests' negative controls). */
export interface BlockDebug {
  /** Fault: the engaged state is what holds this substep (no hysteresis), as a state derived from a solved contact would be. */
  fromContact?: boolean;
  /** Fault: the feet regime does not read the engaged state (only the solved contact and the arms' holds). */
  feetIgnore?: boolean;
}

/**
 * One substep of a player's engaged state from his block request (undefined: he is not blocking) and whether anything
 * holds between him and his man now (`on`). Returns the state (undefined without a request) and the phase change, if any.
 */
export function advanceBlockState(
  st: BlockState | undefined,
  req: { request: BlockRequest; profile: BlockProfile } | undefined,
  on: boolean,
  t: number,
  fault?: BlockDebug,
): { st: BlockState | undefined; change: { from: BlockPhase | null; to: BlockPhase | null } | null } {
  if (!req) return { st: undefined, change: st ? { from: st.phase, to: null } : null };
  const fresh = !st || st.target !== req.request.target;
  const s: BlockState = fresh ? { target: req.request.target, phase: 'approach', since: t, lastOnT: -Infinity, hinge: req.profile.hinge } : st!;
  const from = fresh ? null : s.phase;
  if (on) s.lastOnT = t;
  let to: BlockPhase = s.phase;
  if (on) to = 'engaged';
  else if (s.phase === 'engaged' && (fault?.fromContact || t - s.lastOnT >= req.profile.engage.lostS - 1e-9)) to = 'lost';
  if (to !== s.phase) {
    s.phase = to;
    s.since = t;
  }
  return { st: s, change: fresh || from !== s.phase ? { from, to: s.phase } : null };
}

const SIDES: ArmSide[] = ['left', 'right'];

/** Horizontal distance from a body's origin to its torso box's face along world direction d (m). */
function frontOf(body: BodyProfile, q: { x: number; y: number; z: number; w: number }, d: Vec3): number {
  if (body.kind === 'legacyCapsule') return body.legacy.radius;
  const h = body.compound.torso.halfExtents;
  const c = body.compound.torso.center;
  const rx = qRot(q, v3(1, 0, 0));
  const rz = qRot(q, v3(0, 0, 1));
  return Math.abs(dot(d, rx)) * h.x + Math.abs(dot(d, rz)) * h.z + dot(d, rz) * c.z;
}

/**
 * The block controller (`BlockSpec`). Every substep, undelayed: faces his man and follows him sideways; closes on him to
 * the hold gap; brings the hands up while closing and punches them onto him from the punch gap; engaged (his state, from
 * the snapshot) presses, drives or holds his ground by the request; a palm come off pulls back to re-arm and punches
 * again. His stance is asked throughout.
 */
export class BlockController implements Controller {
  readonly kind = 'block';
  readonly observationDelayS = 0;
  readonly decisionIntervalS = 0;
  readonly profile: BlockProfile;
  private lastFacing: Vec3;
  /** Holding: where he engaged (world), moved on with him as he gains ground (null while not engaged). */
  private anchor: Vec3 | null = null;

  constructor(
    readonly spec: BlockSpec,
    readonly setup: PlayerSetup,
    readonly motor: MotorProfile,
  ) {
    this.profile = spec.profile ?? BLOCK_V1;
    const y = rad(setup.initial.yawDeg);
    this.lastFacing = v3(Math.sin(y), 0, Math.cos(y));
  }

  decide(ctx: ControllerContext): PlayerIntent {
    const P = this.profile;
    const R = this.spec.request;
    const me = ctx.observed.bodies[ctx.self];
    const him = ctx.observed.bodies[R.target];
    const stand = (phase: string): PlayerIntent => ({ locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: this.lastFacing, effort: 1 }, debug: { phase } });
    if (ctx.t + 1e-9 < (this.spec.fromS ?? 0)) return stand('block:waiting');
    // his man gone or down: the block is over (no request; the arms rest, every push ends)
    if (!me || !him || him.controlMode !== 'supported' || him.representation !== 'proxy') {
      this.anchor = null;
      return stand('block:over');
    }
    const effort = clamp(R.effort, 0, 1);
    const d = horiz(sub(him.position, me.position));
    const dist = len(d);
    const dir = norm(d, this.lastFacing);
    this.lastFacing = dir;
    const myBody = ctx.bodies[ctx.self];
    const hisBody = ctx.bodies[R.target];
    const gap = dist - frontOf(myBody, me.rotation, dir) - frontOf(hisBody, him.rotation, scale(dir, -1));
    const phase: BlockPhase = ctx.observed.block?.[ctx.self]?.target === R.target ? ctx.observed.block[ctx.self].phase : 'approach';
    // his sideways motion across the line between them, matched (re-fit when he moves sideways)
    const hv = horiz(him.linearVelocity);
    const across = sub(hv, scale(dir, dot(hv, dir)));
    const obs = ctx.observed.arms[ctx.self];
    const handOn = SIDES.some((side) => !!obs?.[side]?.pushId);
    let along: number;
    if (phase === 'engaged' && handOn) {
      const mine = horiz(me.position);
      if (!this.anchor || dot(sub(mine, this.anchor), dir) > 0) this.anchor = mine;
      const given = Math.max(0, dot(sub(this.anchor, mine), dir));
      const extra = R.intent === 'drive' ? P.driveMps : Math.min(P.hold.gainPerS * given, P.hold.maxMps - P.pressMps);
      along = effort * (P.pressMps + Math.max(0, extra));
    } else {
      // closing (or engaged chest to chest, no hand on: back to arm's length)
      this.anchor = null;
      const A = P.approach;
      const left = gap - A.holdGapM;
      const close = left > 0 ? Math.min(A.mps, A.gainPerS * left, Math.sqrt(2 * A.brakeMps2 * left)) : Math.max(-A.backMps, A.gainPerS * left);
      // the gap closes at that speed, his own part of it counted (he follows a man moving off, gives ground to one coming on)
      along = Math.max(-A.backMps, close + dot(hv, dir));
    }
    const vel = add(scale(dir, along), across);
    // the hands: up while closing, punched on from the punch gap (or engaged), pulled back to re-arm when one came off
    const hands = R.hands ?? P.hands.default;
    const aim = P.hands[hands];
    const punch = phase === 'engaged' || gap <= P.punchGapM;
    const arms: Partial<Record<ArmSide, ArmIntent>> = {};
    for (const side of SIDES) {
      const out = sideSignX(myBody, side);
      if (!punch) {
        // ready: in front of his own chest
        const local = v3(out * P.ready.x, P.ready.y, frontOf(myBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1)) + P.ready.forwardM);
        arms[side] = { action: 'reach', targetWorld: add(me.position, qRot(me.rotation, local)) };
        continue;
      }
      // my right hand on his left side (his frame): the side across from it
      const hx = sideSignX(hisBody, side === 'right' ? 'left' : 'right') * aim.x;
      const front = frontOf(hisBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1));
      const o = obs?.[side];
      const rearm = !!o && !o.pushId && !o.armedForFreshContact;
      const z = rearm ? front + P.recoverM : front - aim.depthM;
      const targetWorld = add(him.position, qRot(him.rotation, v3(hx, aim.y, z)));
      const pole = aim.pole ? { poleLocal: v3(out * aim.pole.x, aim.pole.y, aim.pole.z) } : {};
      arms[side] = rearm ? { action: 'reach', targetWorld } : { action: 'push', targetWorld, push: { effort, lengthM: aim.lengthM ?? P.lengthM }, ...pole };
    }
    const S = P.stance;
    const stance: StanceRequest = { heightM: S.heightM, staggerM: S.staggerM };
    return {
      locomotion: { desiredVelocityWorld: vel, desiredFacingWorld: dir, effort, yawEffort: 1, stance },
      arms,
      posture: { leanDirWorld: dir, leanRad: rad(S.leanDeg), hinge: { rad: rad(S.hingeDeg), dropM: S.dropM } },
      block: { request: { ...R }, profile: P },
      debug: { phase: `block:${phase}`, gap, along, hands },
    };
  }

  exportParams(tickS: number): unknown {
    return { kind: 'block', request: this.spec.request, fromS: this.spec.fromS ?? 0, fromTick: Math.round((this.spec.fromS ?? 0) / tickS), profile: this.profile };
  }
}
