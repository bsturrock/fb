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
import type { ArmIntent, ArmSide, FlatStance, PlayerId, PlayerIntent, StanceRequest } from '../contracts';
import type { BodyProfile, MotorProfile } from '../profiles';
import { sideSignX } from '../profiles';
import type { PlayerSetup } from '../fixture';
import type { HingeLimits } from '../hinge';
import type { BlockBase } from '../block-base';
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
  /**
   * Plan 16, the punch as a strike (a profile with `strike`): which punch he is on (default 0). The move (load, strike,
   * drive) starts again from wherever he is whenever this changes: a brain re-punches by counting it up.
   */
  punch?: number;
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
  /** Plan 16 (the base): each foot this much (m) further out than the standing stance (`StanceRequest.widthAddM`; absent 0). */
  widthAddM?: number;
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
  /**
   * A palm not on him goes back to the ready point and punches from there once within `tolM` of it (a punch from below,
   * from a hanging arm, meets his chest too steep to be born); a palm come off goes back at once, and a punch not on him
   * `retryS` after it left goes back.
   */
  rearm: { tolM: number; retryS: number };
  stance: BlockStance;
  /** The hip hinge's bounds under the block (the stance's hinge request). */
  hinge: HingeLimits;
  /** The engaged state leaves after this long (s) with nothing holding between the two men. */
  engage: { lostS: number };
  /** Plan 16 (the base, block-base.ts): what his feet give him while engaged; absent, nothing (the stance as asked). */
  base?: BlockBase;
  /** Plan 16, the punch as a strike (`BlockStrike`); absent, the hands go on from the ready point as they reach him. */
  strike?: BlockStrike;
  /** Plan 16, flat feet (`FlatStance`, asked with his stance throughout the block); absent, the feet under the hips. */
  flat?: FlatStance;
}

/** Plan 16, the punch's phases: hands in and hips down (`load`), the arms' explosive extension (`strike`), then the drive. */
export type PunchPhase = 'load' | 'strike' | 'drive';

/**
 * The punch in progress (`BlockState.punch`, a profile with a strike): which punch (`n`, the request's `punch`), its
 * phase and when that began (s), and how deep this one loads (`depth`, 0..1 of the load stance's change, from his speed
 * as the load began).
 */
export interface PunchState {
  n: number;
  phase: PunchPhase;
  since: number;
  depth: number;
  /** Striking: when a palm first landed on him (s; absent: not yet). */
  onT?: number;
}

/**
 * Plan 16, the punch as a strike (`BlockProfile.strike`): a timed move, so the palms hit his chest while the arms are
 * still extending. The load: the hands in at his own chest, low (`load.hands`, in his frame as `BlockProfile.ready` is),
 * the hips and knees down (`load.stance`); loaded, he keeps closing, to `load.closeGapM` of chest gap in place of the
 * approach's hold gap (and with no palm on, closer than `strike.minReachM` from his shoulders to his man's chest, he
 * steps back at the approach's backing speed, whatever the phase: a strike cannot land from there). The load begins inside `loadGapM` of chest gap (at once engaged), or earlier closing on him: when
 * the gap would be the punch gap after the load and `strike.leadS` at the closing speed now. The strike is thrown when
 * the hands are loaded (within `load.tolM`, after `load.minS` times the load's depth) and his chest will be within
 * `strike.contactM` of the shoulders (mean over the two arms, shoulder to the aim's point on his chest's surface) after
 * `strike.leadS` (the hands' travel from the load point) at the closing speed now, and not closer than `strike.minReachM`:
 * a partial extension, so the palms land on bent arms. Striking: both arms at once from the load point onto the profile's aim (low to high) at the arm's top
 * speed; the hips rising and the trunk and lean going into him (`strike.stance`). A palm that lands is the palm push
 * (arms.ts), its held length asked to the arm's full reach at the speed the palm was extending as it landed (at least
 * `strike.extendMps`): the rest of the extension drives through him, so the hit's force is the strut's, from the hand's
 * own speed and the man behind it. The drive follows `strike.throughS` after the first palm landed, or as soon as the
 * landed palms come off (the profile's stance, aim and length: the engaged block as without a strike, its own hands
 * re-arming), and lasts until the punch number changes. With no palm landed, a free arm out to `strike.straightM` or
 * `strike.maxS` gone, the strike missed and he loads again. A man moving as the load begins loads less, and more briefly:
 * the stance's change (load and strike) and the load's least time are scaled from 1 standing to `load.movingDepth` at
 * `load.movingMps` and faster. The same move starts again whenever the request's `punch` changes.
 *
 * The hit's force is the palm push's (the strut between the two men through the shared allocator, equal and opposite at
 * the patch, capped by the elbow's torque at the request's effort and the allocator's ceilings): its work is the arm's,
 * counted where every applied force's is. No impulse is added. Every pose input of the punch is here and in the
 * profile's own stance (`punchPose`), so authored poses can replace them.
 */
export interface BlockStrike {
  id: string;
  loadGapM: number;
  load: { minS: number; tolM: number; closeGapM: number; closeMps: number; hands: { forwardM: number; x: number; y: number }; stance: BlockStance; movingMps: number; movingDepth: number };
  strike: { contactM: number; minReachM: number; leadS: number; throughS: number; maxS: number; straightM: number; stance: BlockStance; extendMps: number };
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
 * The first block (plan 16, 2026-11-17): closes at a walk (1.5 m/s, braked at 2.5 m/s2) to 0.62 m between the torso
 * boxes' fronts, punches from 0.80 (from his ready point; palms are born 0.60-0.71 m from the shoulder, near the 0.70 m
 * reach, and refused closer in: the arm line too steep on a pitched chest), and stands at about 0.66-0.70 with the palms
 * on. Engaged at effort 1 he presses at 0.4 m/s (a stalled man: 160 N), drives at 0.8 (320 N), and holding pushes back
 * 2 m/s per metre he has given up to 0.8. The stance: 8 deg of lean, 12 more of trunk pitch on the hinge with 4 cm of
 * hip drop, the root at 0.84 m (of 0.89 standing), the right foot 0.24 m behind the left. Hands: `BLOCK_V1_HANDS`
 * (`lengthM` is the default for a placement without one). Lost 0.4 s after the last hold.
 */
export const BLOCK_V1: BlockProfile = {
  id: 'block-v1',
  approach: { mps: 1.5, gainPerS: 3, holdGapM: 0.62, brakeMps2: 2.5, backMps: 0.5 },
  punchGapM: 0.8,
  lengthM: 0.62,
  pressMps: 0.4,
  driveMps: 0.4,
  hold: { gainPerS: 2, maxMps: 0.8 },
  ready: { forwardM: 0.22, x: 0.14, y: 0.42 },
  hands: BLOCK_V1_HANDS,
  rearm: { tolM: 0.1, retryS: 0.6 },
  stance: { leanDeg: 8, hingeDeg: 12, dropM: 0.04, heightM: 0.84, staggerM: 0.24 },
  hinge: { maxDeg: 20, rateDegPerS: 60, accelDegPerS2: 300, maxDropM: 0.06, dropRateMps: 0.2 },
  engage: { lostS: 0.4 },
};

/**
 * Plan 16, the first strike (no registered fixture has it yet). The load begins from 1.1 m of chest gap (0.3 outside the
 * punch gap); hands 6 cm ahead of the chest, 13 cm off its centre, 0.30 m up his frame (below both aims, so the strike
 * goes low to high), the root asked down to 0.78 (of the stance's 0.84) with 6 cm of hip drop, 14 deg of trunk pitch and
 * 6 of lean, for at least 0.3 s, closing to 0.5 m of chest gap; a man at 1.5 m/s or more loads 40 % as deep and as long.
 * The strike is thrown for the palms to land at 0.60 m from the shoulder (of the arm's 0.72 reach: about 70 deg of elbow
 * flexion, inside the push's 75 deg give), 0.1 s ahead (the hands' travel at the arm's 4 m/s); the root back up to 0.84
 * with no drop, 18 deg of pitch and 12 of lean; the drive 0.12 s after the first palm lands. Missed: a free arm out to
 * 0.69 m, or 0.4 s gone. Closer than 0.5 m from shoulder to chest (about 95 deg of elbow at contact, past which the
 * push's birth refuses a collapsed arm) he steps back.
 */
export const BLOCK_STRIKE_V1: BlockStrike = {
  id: 'strike-v1',
  loadGapM: 1.1,
  load: { minS: 0.3, tolM: 0.08, closeGapM: 0.5, closeMps: 0.6, hands: { forwardM: 0.06, x: 0.13, y: 0.3 }, stance: { leanDeg: 6, hingeDeg: 14, dropM: 0.06, heightM: 0.78, staggerM: 0.24 }, movingMps: 1.5, movingDepth: 0.4 },
  strike: { contactM: 0.6, minReachM: 0.5, leadS: 0.1, throughS: 0.12, maxS: 0.4, straightM: 0.69, stance: { leanDeg: 8, hingeDeg: 14, dropM: 0, heightM: 0.84, staggerM: 0.24 }, extendMps: 3 },
};

/** Plan 16, the punch as a strike: a block profile with `strike`, under an id that names it. */
export const withStrike = (p: BlockProfile, strike: BlockStrike): BlockProfile => ({ ...p, id: `${p.id}+${strike.id}`, strike });

/**
 * Plan 16 (the base): a block profile with a base (block-base.ts) and its stance `widthAddM` (m per foot) wider, under an
 * id that names both.
 */
export const withBase = (p: BlockProfile, base: BlockBase, widthAddM: number): BlockProfile => ({ ...p, id: `${p.id}+${base.id}+w${Math.round(widthAddM * 100)}`, stance: { ...p.stance, widthAddM }, base });

/** The lowest root height (m) a block profile's stances ask for: the stance's, the load's and the strike's height less their hip drop. */
export const lowRootOf = (p: BlockProfile): number =>
  Math.min(...[p.stance, ...(p.strike ? [p.strike.load.stance, p.strike.strike.stance] : [])].map((s) => s.heightM - Math.min(s.dropM, p.hinge.maxDropM)));

/**
 * Plan 16, flat feet: a block profile whose stance stands on flat feet (`flat`, for the lowest root its stances ask,
 * `lowRootOf`), its stagger (the stance's, the load's and the strike's) `staggerM`, under an id that names both.
 */
export const withFlat = (p: BlockProfile, flat: FlatStance, staggerM: number): BlockProfile => ({
  ...p,
  id: `${p.id}+${flat.id}+s${Math.round(staggerM * 100)}`,
  flat: { ...flat, lowRootM: lowRootOf(p) },
  stance: { ...p.stance, staggerM },
  ...(p.strike ? { strike: { ...p.strike, load: { ...p.strike.load, stance: { ...p.strike.load.stance, staggerM } }, strike: { ...p.strike.strike, stance: { ...p.strike.strike.stance, staggerM } } } } : {}),
});

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
  /** The block's base (its profile's; absent without one), read by the feet while he is engaged. */
  base?: BlockBase;
  /** Plan 16: the punch in progress (a profile with a strike; his controller's, from his request). */
  punch?: PunchState;
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
  req: { request: BlockRequest; profile: BlockProfile; punch?: PunchState } | undefined,
  on: boolean,
  t: number,
  fault?: BlockDebug,
): { st: BlockState | undefined; change: { from: BlockPhase | null; to: BlockPhase | null } | null } {
  if (!req) return { st: undefined, change: st ? { from: st.phase, to: null } : null };
  const fresh = !st || st.target !== req.request.target;
  const s: BlockState = fresh ? { target: req.request.target, phase: 'approach', since: t, lastOnT: -Infinity, hinge: req.profile.hinge, ...(req.profile.base ? { base: req.profile.base } : {}) } : st!;
  const from = fresh ? null : s.phase;
  if (on) s.lastOnT = t;
  if (req.punch) s.punch = { ...req.punch };
  else if (s.punch) delete s.punch;
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

/** How deep a punch loads (0..1 of the load stance's change) for a man moving at `speedMps` as the load begins. */
export const punchDepth = (K: BlockStrike, speedMps: number): number => 1 - (1 - K.load.movingDepth) * clamp(speedMps / K.load.movingMps, 0, 1);

/**
 * The punch's stance now (every pose input of the move in one place): the profile's stance, moved toward the load's or
 * the strike's by the punch's depth; the drive (and a block without a strike, or no punch yet) stands in the profile's.
 */
export function punchPose(P: BlockProfile, pu: PunchState | undefined): BlockStance {
  const K = P.strike;
  if (!K || !pu || pu.phase === 'drive') return P.stance;
  const to: BlockStance = pu.phase === 'load' ? K.load.stance : K.strike.stance;
  const S = P.stance;
  const m = (a: number, b: number) => a + (b - a) * pu.depth;
  return { ...S, leanDeg: m(S.leanDeg, to.leanDeg), hingeDeg: m(S.hingeDeg, to.hingeDeg), dropM: m(S.dropM, to.dropM), heightM: m(S.heightM, to.heightM), staggerM: m(S.staggerM, to.staggerM) };
}

/** What the punch's phases read each decision (`nextPunch`). */
export interface PunchCues {
  t: number;
  /** The request's punch number (`BlockRequest.punch`, default 0). */
  serial: number;
  /** The chest gap (m) and how fast it closes (m/s, + closing); engaged with his man (the engaged state). */
  gap: number;
  closingMps: number;
  engaged: boolean;
  /** Shoulder to the aim's point on his chest (m, the mean of the two arms). */
  reachM: number;
  /** Both palms within `load.tolM` of the load point; a palm on him; a free arm out to `strike.straightM`. */
  loaded: boolean;
  anyOn: boolean;
  straight: boolean;
  /** His own speed (m/s). */
  speedMps: number;
}

/**
 * One decision of the punch (`BlockStrike`): a new punch number starts the move again; none yet, the load begins inside
 * the load gap (or engaged, or closing on him); loaded and in range (not closer than `strike.minReachM`), the strike;
 * landed, the drive `strike.throughS` after (or when the palms come off sooner); missed (none landed, and a free arm
 * straight or the strike's time gone), the load again. The drive lasts until the punch number changes. Returns the punch now (undefined: none begun).
 */
export function nextPunch(K: BlockStrike, punchGapM: number, pu: PunchState | undefined, c: PunchCues): PunchState | undefined {
  const cur = pu && pu.n === c.serial ? pu : undefined;
  const closing = Math.max(0, c.closingMps);
  if (!cur) {
    const depth = punchDepth(K, c.speedMps);
    return c.engaged || c.gap <= K.loadGapM || c.gap - closing * (K.load.minS * depth + K.strike.leadS) <= punchGapM ? { n: c.serial, phase: 'load', since: c.t, depth } : undefined;
  }
  const age = c.t - cur.since + 1e-9;
  if (cur.phase === 'load' && age >= K.load.minS * cur.depth && c.loaded && c.reachM >= K.strike.minReachM && c.reachM - closing * K.strike.leadS <= K.strike.contactM) return { ...cur, phase: 'strike', since: c.t };
  if (cur.phase === 'strike') {
    const onT = cur.onT ?? (c.anyOn ? c.t : undefined);
    // landed: the drive once through (or once the palms came off: the block's own hands re-arm them)
    if (onT !== undefined && (!c.anyOn || c.t - onT + 1e-9 >= K.strike.throughS)) return { n: cur.n, phase: 'drive', since: c.t, depth: cur.depth };
    if (onT === undefined && (c.straight || age >= K.strike.maxS)) return { n: cur.n, phase: 'load', since: c.t, depth: punchDepth(K, c.speedMps) };
    if (onT !== undefined && cur.onT === undefined) return { ...cur, onT };
  }
  return cur;
}

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
  /** Per arm: when its punch left the ready point (null: not punching). */
  private punchedAt: Record<ArmSide, number | null> = { left: null, right: null };
  /** Per arm: its palm was on him at the last decision. */
  private wasOn: Record<ArmSide, boolean> = { left: false, right: false };
  /** Striking (a profile with a strike), per arm: its shoulder-to-palm length at the last decision and when (s), and how fast it was extending while free (m/s). */
  private armLen: Record<ArmSide, { m: number; t: number } | null> = { left: null, right: null };
  private hitMps: Record<ArmSide, number> = { left: 0, right: 0 };

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
    // the punch as a strike (a profile with one): its phase from the last (his engaged state's) and what holds now
    const K = P.strike;
    const handPoint = (side: ArmSide, h: { forwardM: number; x: number; y: number }): Vec3 =>
      add(me.position, qRot(me.rotation, v3(sideSignX(myBody, side) * h.x, h.y, frontOf(myBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1)) + h.forwardM)));
    const hands = R.hands ?? P.hands.default;
    const aim = P.hands[hands];
    // a palm's aim on him (world): my right hand on his left side (his frame), the side across from it, `depth` into his chest
    const aimPoint = (side: ArmSide, depth: number): Vec3 =>
      add(him.position, qRot(him.rotation, v3(sideSignX(hisBody, side === 'right' ? 'left' : 'right') * aim.x, aim.y, frontOf(hisBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1)) - depth)));
    let pu: PunchState | undefined;
    const reachM = SIDES.reduce((m, side) => m + (obs?.[side] ? len(sub(aimPoint(side, 0), obs[side]!.shoulderWorld)) : Infinity), 0) / SIDES.length;
    if (K) {
      const was = ctx.observed.block?.[ctx.self];
      const armOf = (side: ArmSide) => (obs?.[side] ? len(sub(obs[side]!.palmContactWorld, obs[side]!.shoulderWorld)) : 0);
      pu = nextPunch(K, P.punchGapM, was?.target === R.target ? was.punch : undefined, {
        t: ctx.t,
        serial: R.punch ?? 0,
        gap,
        closingMps: dot(sub(horiz(me.linearVelocity), horiz(him.linearVelocity)), dir),
        engaged: phase === 'engaged',
        reachM,
        loaded: SIDES.every((side) => !!obs?.[side] && len(sub(obs[side]!.palmContactWorld, handPoint(side, K.load.hands))) <= K.load.tolM),
        anyOn: SIDES.some((side) => !!obs?.[side]?.pushId),
        straight: SIDES.some((side) => !obs?.[side]?.pushId && armOf(side) >= K.strike.straightM),
        speedMps: len(horiz(me.linearVelocity)),
      });
      // striking, each free arm's extension speed (the speed its palm lands at); otherwise none
      for (const side of SIDES) {
        const L = armOf(side);
        const prev = this.armLen[side];
        if (pu?.phase === 'strike' && !obs?.[side]?.pushId && prev && ctx.t > prev.t) this.hitMps[side] = Math.max(0, (L - prev.m) / (ctx.t - prev.t));
        else if (pu?.phase !== 'strike') this.hitMps[side] = 0;
        this.armLen[side] = { m: L, t: ctx.t };
      }
    }
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
      // (loaded and striking, he closes on to the load's gap: the punch is thrown from range, not walked on)
      // (loaded or striking, to the load's gap; a strike profile's man closer than a strike lands from steps back)
      const left = gap - (K && pu && pu.phase !== 'drive' ? K.load.closeGapM : A.holdGapM);
      const loaded = !!K && !!pu && pu.phase !== 'drive';
      const close = left > 0 ? Math.min(loaded ? K!.load.closeMps : A.mps, A.gainPerS * left, Math.sqrt(2 * A.brakeMps2 * left)) : Math.max(-A.backMps, A.gainPerS * left);
      // the gap closes at that speed, his own part of it counted (he follows a man moving off, gives ground to one coming on)
      along = K && pu && pu.phase !== 'drive' && reachM < K.strike.minReachM ? -A.backMps : Math.max(-A.backMps, close + dot(hv, dir));
    }
    const vel = add(scale(dir, along), across);
    // the hands: up while closing, punched on from the punch gap (or engaged), pulled back to re-arm when one came off
    const punch = phase === 'engaged' || gap <= P.punchGapM;
    const arms: Partial<Record<ArmSide, ArmIntent>> = {};
    for (const side of SIDES) {
      const out = sideSignX(myBody, side);
      const o = obs?.[side];
      // the strike's load and strike: both arms together (the drive is the block's own hands, below)
      if (K && pu?.phase !== 'drive') {
        if (pu?.phase !== 'strike') {
          // no punch yet: up at the ready point; loading: in at his chest, low
          this.punchedAt[side] = null;
          this.wasOn[side] = false;
          arms[side] = { action: 'reach', targetWorld: pu ? handPoint(side, K.load.hands) : handPoint(side, P.ready) };
          continue;
        }
        // striking: a palm in flight since the strike began (the drive's re-arm counts from it)
        if (o?.pushId || this.punchedAt[side] === null) this.punchedAt[side] = o?.pushId ? ctx.t : pu.since;
        this.wasOn[side] = !!o?.pushId;
        const pole = aim.pole ? { poleLocal: v3(out * aim.pole.x, aim.pole.y, aim.pole.z) } : {};
        arms[side] = { action: 'push', targetWorld: aimPoint(side, aim.depthM), push: { effort, extendMps: Math.max(K.strike.extendMps, this.hitMps[side]) }, ...pole };
        continue;
      }
      // ready: in front of his own chest
      const readyLocal = v3(out * P.ready.x, P.ready.y, frontOf(myBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1)) + P.ready.forwardM);
      const readyWorld = add(me.position, qRot(me.rotation, readyLocal));
      // a palm come off goes back to ready at once; a punch not on him by `retryS` too
      if (o?.pushId) this.punchedAt[side] = ctx.t;
      else if (this.wasOn[side] || (this.punchedAt[side] !== null && ctx.t - this.punchedAt[side]! > P.rearm.retryS)) this.punchedAt[side] = null;
      this.wasOn[side] = !!o?.pushId;
      if (punch && this.punchedAt[side] === null && o && o.action === 'reach' && o.armedForFreshContact && len(sub(o.palmContactWorld, readyWorld)) <= P.rearm.tolM) this.punchedAt[side] = ctx.t;
      if (!punch || this.punchedAt[side] === null) {
        arms[side] = { action: 'reach', targetWorld: readyWorld };
        continue;
      }
      // my right hand on his left side (his frame): the side across from it
      const hx = sideSignX(hisBody, side === 'right' ? 'left' : 'right') * aim.x;
      const front = frontOf(hisBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1));
      const targetWorld = add(him.position, qRot(him.rotation, v3(hx, aim.y, front - aim.depthM)));
      const pole = aim.pole ? { poleLocal: v3(out * aim.pole.x, aim.pole.y, aim.pole.z) } : {};
      arms[side] = { action: 'push', targetWorld, push: { effort, lengthM: aim.lengthM ?? P.lengthM }, ...pole };
    }
    const S = K ? punchPose(P, pu) : P.stance;
    const stance: StanceRequest = { heightM: S.heightM, staggerM: S.staggerM, ...(S.widthAddM ? { widthAddM: S.widthAddM } : {}), ...(P.flat ? { flat: P.flat } : {}) };
    return {
      locomotion: { desiredVelocityWorld: vel, desiredFacingWorld: dir, effort, yawEffort: 1, stance },
      arms,
      posture: { leanDirWorld: dir, leanRad: rad(S.leanDeg), hinge: { rad: rad(S.hingeDeg), dropM: S.dropM } },
      block: { request: { ...R }, profile: P, ...(pu ? { punch: pu } : {}) },
      debug: { phase: `block:${phase}`, gap, along, hands, ...(K ? { punch: pu?.phase ?? null, reachM } : {}) },
    };
  }

  exportParams(tickS: number): unknown {
    return { kind: 'block', request: this.spec.request, fromS: this.spec.fromS ?? 0, fromTick: Math.round((this.spec.fromS ?? 0) / tickS), profile: this.profile };
  }
}
