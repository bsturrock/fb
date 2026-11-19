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
import type { ArmIntent, ArmSide, FlatStance, HeadUp, PlayerId, PlayerIntent, StanceRequest } from '../contracts';
import type { BodyProfile, MotorProfile } from '../profiles';
import { shoulderLocal, sideSignX } from '../profiles';
import type { PlayerSetup } from '../fixture';
import type { HingeLimits } from '../hinge';
import { legForThigh, legShape, newContest, type BlockBase, type BlockContest, type ContestState, type GiveGround, type GiveState } from '../block-base';
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
  /**
   * Plan 16 (p39): his pre-snap stance (`PreSnapStance`). He holds it from the reset until the snap (`BlockSpec.fromS`)
   * and fires out of it into the block. Under a profile without that stance (`BlockProfile.preSnap`) he stands until the
   * snap as without one.
   */
  stance?: PreSnapStance;
}

/** Plan 16 (p39): a lineman's pre-snap stance and his side of the ball. */
export interface PreSnapStance {
  kind: 'two-point' | 'three-point';
  side: 'offense' | 'defense';
}

/** Plan 16 (p39): which of a profile's pre-snap stances (`BlockProfile.preSnap`) a request's stance is: the two-point set is one stance on either side. */
export type PreSnapKey = 'two-point' | 'three-point-offense' | 'three-point-defense';
export const preSnapKey = (s: PreSnapStance): PreSnapKey => (s.kind === 'two-point' ? 'two-point' : s.side === 'offense' ? 'three-point-offense' : 'three-point-defense');

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

/**
 * Plan 16 (p40): a hand's place in a pre-snap stance, in his level frame (his facing, upright): `forwardM` ahead of his
 * shoulder on that side, `x` out from it (+ away from his midline), `upM` above the turf (the field's plane, y 0), the
 * reach's target (the reach stops the palm's ball about its radius over its target: a palm on the turf asks about 0). Its
 * elbow's pole (`ArmIntent.poleLocal`, x outward, mirrored per arm), if any.
 */
export interface PreSnapHand {
  forwardM: number;
  x: number;
  upM: number;
  pole?: Vec3;
}

/**
 * Plan 16 (p40): a pre-snap stance's pose (`BlockProfile.preSnap`): its block stance (height, stagger, width, lean,
 * hinge) and what a set lineman needs beyond the block's own: his feet (`flat`, in place of the profile's), the lowest
 * root it may ask (`lowM`, StanceRequest.lowM: a three-point's hips stand below the suspension's floor), each hand's
 * place (`hands`; a hand absent goes to the ready point) and the head up (`head`; absent, the head on the trunk).
 */
export interface PreSnapPose extends BlockStance {
  /** The hip hinge's pace getting into it (in place of the block's: a deep trunk pitched fast overruns the balance). */
  pace?: Pick<HingeLimits, 'rateDegPerS' | 'accelDegPerS2'>;
  flat?: FlatStance;
  lowM?: number;
  hands?: Partial<Record<ArmSide, PreSnapHand>>;
  head?: HeadUp;
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
  /** Plan 16 (p36), giving ground (block-base.ts `GiveGround`, read while engaged on a base that resists); absent, none. */
  give?: GiveGround;
  /** Plan 16 (p37), the contest (block-base.ts `BlockContest`): engaged, his drive along the line is his push and hold; absent, the drive's servo. */
  contest?: BlockContest;
  /**
   * Plan 16 (p39), the pre-snap stances he can hold (`BlockRequest.stance`) and each one's pose: the block stance asked
   * until the snap (his hands at the ready point, `ready`; his feet as `flat` places them). Absent: none.
   */
  preSnap?: Partial<Record<PreSnapKey, PreSnapPose>>;
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
  /**
   * Plan 16 (p41): this punch is his fire-out (`BlockStrike.fire`), from the snap out of his pre-snap stance until a
   * strike lands (a missed one loads again, still firing). While it is, his feet are the block's contact stepping (the
   * simulation's `retained`), not the free locomotion's.
   */
  fire?: true;
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
  strike: {
    contactM: number;
    minReachM: number;
    leadS: number;
    throughS: number;
    maxS: number;
    straightM: number;
    stance: BlockStance;
    extendMps: number;
    /**
     * Plan 16 (p40): engaged (something already holds between the two men: the other man's palms on him, or their
     * bodies), loaded, he strikes from where he is once his man's chest is within this reach (m, as `contactM` is
     * measured), not waiting for his closing to bring it within `contactM`: held off at arm's length by the other man's
     * hands he can close no further, and would stay loaded for the whole block. Absent: only `contactM`'s rule.
     */
    engagedReachM?: number;
  };
  /** Plan 16 (p41): the fire-out (`BlockFire`); absent, the first punch out of a pre-snap stance is any other punch. */
  fire?: BlockFire;
}

/**
 * Plan 16 (p41), the fire-out: a man set in a pre-snap stance (`BlockRequest.stance`, one his profile holds) loads at the
 * snap wherever his man is, and that first punch is his fire-out (`PunchState.fire`) until a strike lands. Firing:
 * - his feet are the block's contact stepping, not the free locomotion's (the simulation's `retained`): no walking start
 *   ramp and no run clip, whose running height (0.87-0.90 m) the suspension took as his speed rose and stood him up out
 *   of the stance whatever the stance asked (p40's parked fire-out: the root at 0.92 against a 0.725 target); his feet's
 *   frame is level (`FlatStance.level`), as in the stance he comes out of, so the planter reads his deep pitch as his;
 * - he goes at his own `mps` toward his man (braked as the approach brakes, on the gap to the load's), whatever his man
 *   does: both men firing close at twice it (the load's `closeMps` is the gap's);
 * - loaded, the load's stance with the trunk at `trunkDeg` from vertical (the hips at the load's height, the back flat
 *   and low); striking, the strike's (the hips and the trunk up through the contact);
 * - his hip hinge moves at `pace` (with the hips' own torque, `HingeLimits.hipNm`), in place of the block's.
 */
export interface BlockFire {
  mps: number;
  trunkDeg: number;
  pace: Pick<HingeLimits, 'rateDegPerS' | 'accelDegPerS2' | 'hipNm'>;
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

/**
 * Plan 16 (p40): BLOCK_STRIKE_V1, and engaged he strikes from where he is once his man's chest is within 0.66 m of his
 * shoulders (`strike.engagedReachM`; 3 cm inside the miss's straight arm, so the palms land before it reads straight).
 * Why: a loaded man whose man has struck first is held at arm's length by those palms (BL-F1's men from a two-point set
 * 1.1 m apart: the under man's chest-to-aim reach settles at 0.62-0.69 m, never inside `contactM`'s 0.6 at a closing
 * speed of 0), so he never closes into range and stays loaded with his hands at his own chest for the whole block (p40,
 * the fire-out deadlock; the same in BL-F8, where the man held off is run back 4.5 m without a palm on).
 */
export const BLOCK_STRIKE_V2: BlockStrike = { ...BLOCK_STRIKE_V1, id: 'strike-v2', strike: { ...BLOCK_STRIKE_V1.strike, engagedReachM: 0.66 } };

/**
 * Plan 16 (p41): BLOCK_STRIKE_V2 with the fire-out (`BlockFire`): out of a pre-snap stance he goes at 2 m/s, the hips
 * low, the trunk brought up to 45 deg at 300 deg/s (1500 deg/s2, the hips adding up to 400 N m beyond the balance's cap)
 * and on to the strike's as it is thrown. No registered fixture has it yet.
 */
export const BLOCK_STRIKE_V3: BlockStrike = { ...BLOCK_STRIKE_V2, id: 'strike-v3', fire: { mps: 2, trunkDeg: 45, pace: { rateDegPerS: 300, accelDegPerS2: 1500, hipNm: 400 } } };

/** Plan 16 (p37): a block profile whose engaged drive is the contest (`BlockContest`), under an id that names it. */
export const withContest = (p: BlockProfile, contest: BlockContest): BlockProfile => ({ ...p, id: `${p.id}+${contest.id}`, contest });

/** Plan 16 (p36): a block profile that gives ground (`GiveGround`), under an id that names it. */
export const withGive = (p: BlockProfile, give: GiveGround): BlockProfile => ({ ...p, id: `${p.id}+${give.id}`, give });

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
 * Plan 16 (p35): the body the athletic stance is derived on (m): thigh, shin, the ankle's height over the ground (the
 * sole), the hip above the body's origin, the torso box's centre above and ahead of it; the ankle's dorsiflexion range (deg).
 */
export interface StanceGeometry {
  thighM: number;
  shinM: number;
  soleM: number;
  hipUpM: number;
  chestUpM: number;
  chestAheadM: number;
  dorsiDeg: number;
}

/**
 * How much nearer (m) a body pitched `trunkDeg` forward brings its torso box's front than it stands unpitched (the chest
 * gaps are measured unpitched, at the origin's height).
 */
export const chestShiftM = (G: StanceGeometry, trunkDeg: number): number => {
  const t = (trunkDeg * Math.PI) / 180;
  return G.chestUpM * Math.sin(t) + G.chestAheadM * Math.cos(t) - G.chestAheadM;
};

/** One phase of the athletic stance: the trunk's pitch from vertical (deg), `leanDeg` of it the whole-body lean, the rest on the hip hinge. */
export interface TrunkPose {
  trunkDeg: number;
  leanDeg: number;
}

/**
 * Plan 16 (p35): the athletic stance, every pose input of a block's stance in this one object (an authored stance replaces
 * it whole). The load, the deepest, places the feet: the rear shin over its flat foot leans `load.shinDeg` (within the
 * ankle's range: the flat stance's margin is what is left of it) with the thigh sloping `load.thighDeg` below horizontal,
 * the front foot `staggerM` ahead. Over those same planted feet the set stance (the hold and the drive) stands to a thigh
 * at `set.thighDeg` and the strike rises to one at `strike.thighDeg`: hips back, knees bent, shins forward within the
 * range. Every height follows from those angles and the leg (`athleticStances`); none is set per scene. The trunk is
 * pitched well forward (hips back, shoulders toward the toes), `leanDeg` of it the whole-body lean and the rest on the hip
 * hinge, which moves at `hinge` (the stance is reached from upright within the load). `flat`: the flat stance's stepping.
 */
export interface AthleticStance {
  id: string;
  set: TrunkPose & { thighDeg: number };
  load: TrunkPose & { thighDeg: number; shinDeg: number };
  strike: TrunkPose & { thighDeg: number };
  staggerM: number;
  hinge: Pick<HingeLimits, 'rateDegPerS' | 'accelDegPerS2'>;
  flat: Pick<FlatStance, 'stepPastDeg' | 'coverM' | 'captureK' | 'braceDeg'>;
}

/**
 * Plan 16 (p35): the first athletic stance (no registered fixture has it yet). The load's thigh at 45 deg and the rear
 * shin at 23 (2 deg inside the ankle's 25) place the feet; the set stance stands to a 52 deg thigh and the strike rises to
 * 58 over them; the trunk at 30 deg (28 striking), 6 of it lean (8 striking). The brace may take the rear foot back to
 * where its shin leans 5 deg past the range (the heel about 1.5 cm up, inside the viewer's 3 cm); a plant steps once its
 * shin leans 10 past (the heel well up). Deeper trunks bring the heads together before the hands reach (42 deg: the men
 * engage head to head, no palm on) and leave the flat feet nothing behind the centre of mass to hold the pitch with.
 */
export const ATHLETIC_V1: AthleticStance = {
  id: 'athletic-v1',
  set: { thighDeg: 52, trunkDeg: 30, leanDeg: 6 },
  load: { thighDeg: 45, shinDeg: 23, trunkDeg: 30, leanDeg: 6 },
  strike: { thighDeg: 58, trunkDeg: 28, leanDeg: 8 },
  staggerM: 0.1,
  hinge: { rateDegPerS: 120, accelDegPerS2: 300 },
  flat: { stepPastDeg: 10, coverM: 0.16, captureK: 0.5, braceDeg: 5 },
};

/**
 * Plan 16 (p37): ATHLETIC_V1's legs with the trunk at 20 deg in every phase (the BL block's own 8 of lean and 12 of
 * hinge), the lean as before. On two chests pitched 30 deg toward each other the under hands (0.37 m up the chest) and the
 * over hands (0.53) land 11 cm apart in height, and the forearms pass through each other for the whole block (8-9 cm
 * deep, against 2 on the BL block); at 20 they stay about as apart as on the BL block. The inside lane (item 3) is the
 * real answer to forearm through forearm; the deeper trunk can come back with it. With the contest the trunk no longer
 * holds the pitch over the flat feet (BASE_V3's concern), so nothing else asks for 30.
 */
export const ATHLETIC_V2: AthleticStance = {
  ...ATHLETIC_V1,
  id: 'athletic-v2',
  set: { ...ATHLETIC_V1.set, trunkDeg: 20 },
  load: { ...ATHLETIC_V1.load, trunkDeg: 20 },
  strike: { ...ATHLETIC_V1.strike, trunkDeg: 20 },
};

/** What an athletic stance comes to on a leg (`athleticStances`): the three block stances, the flat stance, and where the rear ankle stands ahead of its hip (m). */
export interface AthleticDerived {
  stance: BlockStance;
  load: BlockStance;
  strike: BlockStance;
  flat: FlatStance;
  aheadM: number;
}

/**
 * The athletic stance on a leg: the rear ankle `aheadM` ahead of its hip (`legShape` of the load's thigh and shin); each
 * phase's root height the hip's height above that ankle (its own thigh over the same ankle) plus the sole, less the hip's
 * height over the origin at that trunk pitch; the hinge the trunk's pitch less the lean, no hip drop (the height is the
 * drop). The flat stance places the feet for the load (its shin lean, `lowRootM` its root), so they stay planted from the
 * set stance down through the load and up through the strike.
 */
export function athleticStances(A: AthleticStance, L: StanceGeometry): AthleticDerived {
  const r = (d: number) => (d * Math.PI) / 180;
  const low = legShape(L.thighM, L.shinM, r(A.load.thighDeg), r(A.load.shinDeg));
  const a = low.aheadM;
  const set = legForThigh(L.thighM, L.shinM, a, r(A.set.thighDeg));
  const strike = legForThigh(L.thighM, L.shinM, a, r(A.strike.thighDeg));
  const root = (upM: number, t: TrunkPose) => upM + L.soleM - L.hipUpM * Math.cos(r(t.trunkDeg));
  const stance = (upM: number, t: TrunkPose): BlockStance => ({ leanDeg: t.leanDeg, hingeDeg: t.trunkDeg - t.leanDeg, dropM: 0, heightM: root(upM, t), staggerM: A.staggerM });
  const load = stance(low.upM, A.load);
  return {
    stance: stance(set.upM, A.set),
    load,
    strike: stance(strike.upM, A.strike),
    flat: { id: A.id, marginDeg: L.dorsiDeg - A.load.shinDeg, ...A.flat, lowRootM: load.heightM },
    aheadM: a,
  };
}

/**
 * Plan 16 (p35): a block profile on an athletic stance (`athleticStances` on the leg `L`): its stance, the strike's load
 * and strike stances and its flat feet derived from `A` (the stance's width kept), the hinge's bound raised to the deepest
 * hinge asked, under an id that names it.
 */
export function withAthletic(p: BlockProfile, A: AthleticStance, L: StanceGeometry): BlockProfile {
  const d = athleticStances(A, L);
  const w = p.stance.widthAddM ? { widthAddM: p.stance.widthAddM } : {};
  const maxDeg = Math.max(p.hinge.maxDeg, d.stance.hingeDeg, ...(p.strike ? [d.load.hingeDeg, d.strike.hingeDeg] : []));
  // every chest gap wider by what the deeper pitch brings the two chests nearer than the profile's own stance's
  const s0 = -2 * (chestShiftM(L, A.set.trunkDeg) - chestShiftM(L, p.stance.leanDeg + p.stance.hingeDeg));
  return {
    ...p,
    id: `${p.id}+${A.id}`,
    approach: { ...p.approach, holdGapM: p.approach.holdGapM - s0 },
    punchGapM: p.punchGapM - s0,
    stance: { ...d.stance, ...w },
    hinge: { ...p.hinge, ...A.hinge, maxDeg },
    flat: d.flat,
    ...(p.strike ? { strike: { ...p.strike, loadGapM: p.strike.loadGapM - s0, load: { ...p.strike.load, closeGapM: p.strike.load.closeGapM - s0, stance: { ...d.load, ...w } }, strike: { ...p.strike.strike, stance: { ...d.strike, ...w } } } } : {}),
  };
}

/**
 * Plan 16 (p38): the lean-in stance, every pose input of a block's stance in this one object (an authored stance replaces
 * it whole). The feet stand behind the hips and the body inclines into his man: the load places them, the rear foot on its
 * ball (`ball.pitchDeg` heel up about its toe, its shin at the ankle's range plus that pitch) under a thigh sloping
 * `load.thighDeg` below horizontal, the front foot `staggerM` ahead. Over those same planted feet the set stance (the hold
 * and the drive), the strike and the stood-up stance (knocked back: the contest's stood level) stand to their own thigh
 * slopes, each foot as flat as the ankle's range lets it. Every height follows from those angles and the leg
 * (`leanInStances`); none is set per scene. The trunk is pitched into him, `leanDeg` of it the whole-body lean and the rest
 * on the hip hinge, moving at `hinge`. `ball.stepDeg`: the viewer's limit for a foot on its ball (a plant past it steps,
 * landing where it would stand at `ball.landDeg`, under the hips; within it the contest counts the foot as set);
 * `ball.aheadCoverM`: how far ahead of its want a plant may stand before it steps back (FlatStance.ball). `flat`: the
 * stepping's dead zone and capture lead under the stance. `ankleDeg` (p39): the ankle's dorsiflexion range under the
 * stance (`FlatStance.dorsiDeg`; the owner's ruling: about 38 deg for a loaded ankle in a block), every height derived on
 * it; absent, the leg's (the joint range profile's 25). `twoPoint` (p39): the two-point set before the snap
 * (`BlockProfile.preSnap`), standing to its own thigh slope over the same planted feet; absent, none.
 */
export interface LeanInStance {
  id: string;
  ankleDeg?: number;
  ball: { pitchDeg: number; stepDeg: number; landDeg: number; aheadCoverM: number };
  load: TrunkPose & { thighDeg: number };
  set: TrunkPose & { thighDeg: number };
  strike: TrunkPose & { thighDeg: number };
  stood: TrunkPose & { thighDeg: number };
  twoPoint?: TrunkPose & { thighDeg: number };
  /** Plan 16 (p40): the three-point stances before the snap (`ThreePointSpec`, `BlockProfile.preSnap`); absent, none. */
  threePoint?: Partial<Record<'offense' | 'defense', ThreePointSpec>>;
  staggerM: number;
  hinge: Pick<HingeLimits, 'rateDegPerS' | 'accelDegPerS2'>;
  flat: Pick<FlatStance, 'coverM' | 'captureK'>;
}

/**
 * Plan 16 (p40): a three-point stance on a lean-in (`LeanInStance.threePoint`), on its own feet: the rear foot (the down
 * hand's side, the right: the stagger is the left foot's lead) on its ball at `pitchDeg` under the thigh at `thighDeg`
 * below horizontal, its shin at the stance's ankle range (`ankleDeg`; absent the lean-in's) plus the pitch, the front foot
 * `staggerM` ahead of it, each foot `widthAddM` out; a plant pitched past `stepDeg` steps. The trunk at `trunkDeg` from
 * vertical (`leanDeg` of it whole-body lean, the rest on the hip hinge); the hands (`PreSnapHand`) and the head up. The
 * hips' height follows from the leg (`leanInStances`), the root's from the trunk; the stance asks that root below the
 * suspension's floor (`PreSnapPose.lowM`).
 */
export interface ThreePointSpec extends TrunkPose {
  thighDeg: number;
  pitchDeg: number;
  stepDeg: number;
  ankleDeg?: number;
  staggerM: number;
  widthAddM: number;
  hands: Partial<Record<ArmSide, PreSnapHand>>;
  head: HeadUp;
  pace: Pick<HingeLimits, 'rateDegPerS' | 'accelDegPerS2'>;
}

/** The leg's geometry the lean-in is derived on: the stance geometry, the ankle's distance behind the shoe's toe tip and the shoe's length (m). */
export type LeanGeometry = StanceGeometry & { toeM: number; shoeM: number };

/** What a lean-in stance comes to on a leg (`leanInStances`): the four block stances, the flat stance (with its ball), where the rear ankle stands ahead of its hip (m; negative behind), and each phase's hip height over the ground and rear foot pitch (deg). */
export interface LeanInDerived {
  stance: BlockStance;
  load: BlockStance;
  strike: BlockStance;
  stood: BlockStance;
  /** The two-point set (p39; a stance with `twoPoint`). */
  twoPoint?: BlockStance;
  /** The three-point stances (p40; a stance with `threePoint`), each with its hips' height over the ground (m). */
  threePoint?: Partial<Record<'offense' | 'defense', PreSnapPose & { overGroundM: number }>>;
  flat: FlatStance;
  aheadM: number;
  hips: Record<'load' | 'set' | 'strike' | 'stood', { overGroundM: number; pitchDeg: number }> & { twoPoint?: { overGroundM: number; pitchDeg: number } };
}

/**
 * The hip's height over the ground (m) of a leg whose thigh slopes `thighRad` below horizontal over a foot whose flat
 * footprint's ankle stands `aheadM` ahead of the hip, the foot as flat as the ankle's range lets it (pitched heel up
 * about its toe just enough for the shin to lean the range plus the pitch), and that pitch (rad).
 */
export function standOver(L: LeanGeometry, aheadM: number, thighRad: number): { overGroundM: number; pitchRad: number } {
  const range = (L.dorsiDeg * Math.PI) / 180;
  const at = (p: number) => {
    const fwd = L.toeM * (1 - Math.cos(p)) + L.soleM * Math.sin(p);
    const leg = legForThigh(L.thighM, L.shinM, aheadM + fwd, thighRad);
    return { f: leg.shinRad - (range + p), overGroundM: leg.upM + L.soleM * Math.cos(p) + L.toeM * Math.sin(p) };
  };
  const flat = at(0);
  if (flat.f <= 0) return { overGroundM: flat.overGroundM, pitchRad: 0 };
  let lo = 0;
  let hi = Math.PI / 4;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid).f > 0) lo = mid;
    else hi = mid;
  }
  return { overGroundM: at(hi).overGroundM, pitchRad: hi };
}

/**
 * The lean-in on a leg (on the stance's ankle range, `ankleDeg`, when it has one; the flat stance then asks it): the load's rear foot on its ball at `ball.pitchDeg` under the load's thigh places the rear ankle
 * (`legShape`, the shin at the range plus the pitch; the flat footprint's ankle that far behind the pitched one); every
 * phase's hips stand over that ankle at its thigh (`standOver`), its root height the hip's over the ground less the hip's
 * height over the origin at that trunk pitch; the hinge the trunk's pitch less the lean, no hip drop. The flat stance
 * stands the feet there (`FlatStance.ball`, `lowRootM` the load's root), so they stay planted from the set stance down
 * through the load, up through the strike and up again when he is stood up.
 */
export function leanInStances(S: LeanInStance, L0: LeanGeometry): LeanInDerived {
  const r = (d: number) => (d * Math.PI) / 180;
  // (p39: on the stance's own ankle range, when it has one)
  const L = S.ankleDeg === undefined ? L0 : { ...L0, dorsiDeg: S.ankleDeg };
  const p = r(S.ball.pitchDeg);
  const low = legShape(L.thighM, L.shinM, r(S.load.thighDeg), r(L.dorsiDeg) + p);
  const aheadM = low.aheadM - (L.toeM * (1 - Math.cos(p)) + L.soleM * Math.sin(p));
  const over = (thighDeg: number) => {
    const o = standOver(L, aheadM, r(thighDeg));
    return { overGroundM: o.overGroundM, pitchDeg: (o.pitchRad * 180) / Math.PI };
  };
  const hips: LeanInDerived['hips'] = {
    load: { overGroundM: low.upM + L.soleM * Math.cos(p) + L.toeM * Math.sin(p), pitchDeg: S.ball.pitchDeg },
    ...(Object.fromEntries((['set', 'strike', 'stood'] as const).map((k) => [k, over(S[k].thighDeg)])) as Record<'set' | 'strike' | 'stood', { overGroundM: number; pitchDeg: number }>),
    ...(S.twoPoint ? { twoPoint: over(S.twoPoint.thighDeg) } : {}),
  };
  const stance = (k: 'load' | 'set' | 'strike' | 'stood' | 'twoPoint'): BlockStance => {
    const t = S[k]!;
    return { leanDeg: t.leanDeg, hingeDeg: t.trunkDeg - t.leanDeg, dropM: 0, heightM: hips[k]!.overGroundM - L.hipUpM * Math.cos(r(t.trunkDeg)), staggerM: S.staggerM };
  };
  const load = stance('load');
  // (p40: a three-point stance on its own feet, its rear foot on its ball under its thigh)
  const three = (T: ThreePointSpec): PreSnapPose & { overGroundM: number } => {
    const Lt = T.ankleDeg === undefined ? L : { ...L0, dorsiDeg: T.ankleDeg };
    const pt = r(T.pitchDeg);
    const sh = legShape(Lt.thighM, Lt.shinM, r(T.thighDeg), r(Lt.dorsiDeg) + pt);
    const overGroundM = sh.upM + Lt.soleM * Math.cos(pt) + Lt.toeM * Math.sin(pt);
    const heightM = overGroundM - Lt.hipUpM * Math.cos(r(T.trunkDeg));
    // (a pitch of 0: the flat rule, both feet flat ahead of the hips, a plant stepping past `stepDeg` over the range)
    const flat: FlatStance = T.pitchDeg > 0 ? { id: S.id, marginDeg: 0, stepPastDeg: 0, ...S.flat, lowRootM: heightM, ball: { ...S.ball, pitchDeg: T.pitchDeg, stepDeg: T.stepDeg }, dorsiDeg: Lt.dorsiDeg, level: true } : { id: S.id, marginDeg: 0, stepPastDeg: T.stepDeg, ...S.flat, lowRootM: heightM, dorsiDeg: Lt.dorsiDeg, level: true };
    return { leanDeg: T.leanDeg, hingeDeg: T.trunkDeg - T.leanDeg, dropM: 0, heightM, staggerM: T.staggerM, widthAddM: T.widthAddM, flat, lowM: heightM, hands: T.hands, head: T.head, pace: T.pace, overGroundM };
  };
  const tp = S.threePoint;
  return {
    stance: stance('set'),
    load,
    strike: stance('strike'),
    stood: stance('stood'),
    ...(S.twoPoint ? { twoPoint: stance('twoPoint') } : {}),
    ...(tp ? { threePoint: { ...(tp.offense ? { offense: three(tp.offense) } : {}), ...(tp.defense ? { defense: three(tp.defense) } : {}) } } : {}),
    flat: { id: S.id, marginDeg: 0, stepPastDeg: 0, ...S.flat, lowRootM: load.heightM, ball: { ...S.ball }, ...(S.ankleDeg !== undefined ? { dorsiDeg: S.ankleDeg } : {}) },
    aheadM,
    hips,
  };
}

/** Plan 16 (p40): a lean-in's three-point stances as pre-snap poses (`BlockProfile.preSnap`). */
function threePointPoses(d: LeanInDerived): Partial<Record<PreSnapKey, PreSnapPose>> {
  const strip = (t: PreSnapPose & { overGroundM: number }): PreSnapPose => {
    const { overGroundM: _o, ...rest } = t;
    return rest;
  };
  const T = d.threePoint ?? {};
  return { ...(T.offense ? { 'three-point-offense': strip(T.offense) } : {}), ...(T.defense ? { 'three-point-defense': strip(T.defense) } : {}) };
}

/**
 * Plan 16 (p38): a block profile on a lean-in stance (`leanInStances` on the leg `L`): its stance, the strike's load and
 * strike stances and its flat feet (with the ball) derived from `S` (the stance's width kept), the hinge's bound raised to
 * the deepest hinge asked, every chest gap wider by what the deeper pitch brings the chests nearer (as `withAthletic`);
 * on the contest, the stood-up level raising the hips and the trunk to the stood-up stance's (`stood.riseM` the root's
 * rise, `stood.trunkDeg` the hinge's fall), and a foot on its ball within the stance's limit counting as set. Under an id
 * that names it (and the contest's, which names both).
 */
export function withLeanIn(p: BlockProfile, S: LeanInStance, L: LeanGeometry): BlockProfile {
  const d = leanInStances(S, L);
  const w = p.stance.widthAddM ? { widthAddM: p.stance.widthAddM } : {};
  const tp = Object.values(d.threePoint ?? {}).map(({ overGroundM: _o, ...t }) => t);
  const maxDeg = Math.max(p.hinge.maxDeg, d.stance.hingeDeg, ...(p.strike ? [d.load.hingeDeg, d.strike.hingeDeg] : []), ...(d.twoPoint ? [d.twoPoint.hingeDeg] : []), ...tp.map((t) => t.hingeDeg));
  const s0 = -2 * (chestShiftM(L, S.set.trunkDeg) - chestShiftM(L, p.stance.leanDeg + p.stance.hingeDeg));
  const heelM = (deg: number) => L.shoeM * Math.sin((deg * Math.PI) / 180);
  return {
    ...p,
    id: `${p.id}+${S.id}`,
    approach: { ...p.approach, holdGapM: p.approach.holdGapM - s0 },
    punchGapM: p.punchGapM - s0,
    stance: { ...d.stance, ...w },
    hinge: { ...p.hinge, ...S.hinge, maxDeg },
    flat: d.flat,
    ...(d.twoPoint || d.threePoint ? { preSnap: { ...p.preSnap, ...(d.twoPoint ? { 'two-point': { ...d.twoPoint, ...w } } : {}), ...threePointPoses(d) } } : {}),
    ...(p.strike ? { strike: { ...p.strike, loadGapM: p.strike.loadGapM - s0, load: { ...p.strike.load, closeGapM: p.strike.load.closeGapM - s0, stance: { ...d.load, ...w } }, strike: { ...p.strike.strike, stance: { ...d.strike, ...w } } } } : {}),
    ...(p.contest
      ? {
          contest: {
            ...p.contest,
            id: `${p.contest.id}+${S.id}`,
            set: { heelM: Math.max(p.contest.set.heelM, heelM(S.ball.stepDeg)), pitchDeg: Math.max(p.contest.set.pitchDeg, S.ball.stepDeg) },
            stood: { ...p.contest.stood, riseM: d.stood.heightM - d.stance.heightM, trunkDeg: d.stance.hingeDeg - d.stood.hingeDeg },
          },
        }
      : {}),
  };
}

/**
 * Plan 16 (p38): the lean-in, the user's A (two men inclined into each other, a line from the helmet down the back to the
 * hips and on to feet behind the hips). Derived on the BL body (thigh 0.43, shin 0.45, the ankle's 25 deg):
 * - The load: the thigh 64 deg below horizontal, the rear foot on its ball at 10 deg (heel 5 cm up), its flat footprint's
 *   ankle 9 cm behind the hips, the front foot 8 cm ahead of it (both behind the hips); hips 0.90 m over the ground.
 * - The set stance (the hold and the drive) 66 deg, the strike 70 (it rises 1.3 cm, its rear foot down to 5 deg),
 *   the stood-up stance 72 with the trunk at 14 (hips 0.92). Knees bent 45-65 deg through the block.
 * - The trunk at 20 deg in every phase but the stood-up one (ATHLETIC_V2's reason: at 30 the forearms pass through each
 *   other), 6-8 of it whole-body lean.
 * Limits: the feet can stand behind the hips only as far as the ankle's 25 deg and a rear foot on its ball let them, so
 * the hips stand near their standing height (a lower lean-in needs some 35 deg of ankle). The ball's limit is 14 deg
 * (heel 7.4 cm up on the 30 cm shoe), not the flat feet's 10 deg and 3 cm: in close-ups the foot reads as on its ball (the
 * ball and toes flat on the ground, the heel lifted, a lineman's drive foot), not on its toes (the tiptoe defect is some
 * 30 deg on the toe tip). A plant past it steps and lands at 2 deg, under the hips; one more than 7 cm ahead of its want
 * steps back. Support: the stance asks the whole root height (`StanceRequest.heightWhole`: no contact preparation drop
 * under it), the hinge pivots about the support point under his centre of mass as before, and the feet are posed to the
 * plan: the stance changes only the suspension's targets, no force of its own.
 */
export const LEAN_IN_V1: LeanInStance = {
  id: 'lean-in-v1',
  ball: { pitchDeg: 10, stepDeg: 14, landDeg: 2, aheadCoverM: 0.07 },
  load: { thighDeg: 64, trunkDeg: 20, leanDeg: 6 },
  set: { thighDeg: 66, trunkDeg: 20, leanDeg: 8 },
  strike: { thighDeg: 70, trunkDeg: 20, leanDeg: 8 },
  stood: { thighDeg: 72, trunkDeg: 14, leanDeg: 6 },
  staggerM: 0.08,
  hinge: { rateDegPerS: 120, accelDegPerS2: 300 },
  flat: { coverM: 0.12, captureK: 0.5 },
};

/**
 * Plan 16 (p39): the low lean-in, LEAN_IN_V1 on the ankle's range in a block (`ankleDeg` 38, the owner's ruling
 * 2026-11-18: the loaded ankle bends to about 38 deg while blocking). Derived on the BL body:
 * - The load: the thigh 46 deg below horizontal, the rear foot on its ball at 9 deg (heel 4.8 cm up), its flat
 *   footprint's ankle 4.7 cm behind the hips, the front foot 7 cm ahead of it; hips 0.754 m over the ground (the root at
 *   0.725, inside the suspension's lowest 0.72); knees bent about 90 deg.
 * - The set stance (the hold and the drive) 56 deg: hips 0.815 (V1 0.904), the rear foot nearly flat (1.6 deg), knees
 *   about 74; the load sinks 6.1 cm from it (V1 0.8). The strike 66: hips 0.889, 13.5 cm over the load, both feet flat
 *   (the rise of the punch, low to high). The stood-up stance 70 with the trunk at 14 (hips 0.915).
 * - The trunk at 20 deg in every phase but the stood-up one, 6-8 of it whole-body lean, as V1.
 * The cost of low: with the ankle at 38 the feet stand behind the hips by less than on V1's tall stance (the feet's
 * mid-point 1 cm behind the hips, V1 5 cm). A deeper ball takes the feet further back but lifts the load's heel past the
 * ball's limit as the loaded man closes on his planted feet (10 deg: 14.3-15.2 deg in the BL probes; 9: 13.2-13.5).
 */
export const LEAN_IN_V2: LeanInStance = {
  id: 'lean-in-v2',
  ankleDeg: 38,
  ball: { pitchDeg: 9, stepDeg: 14, landDeg: 2, aheadCoverM: 0.07 },
  load: { thighDeg: 46, trunkDeg: 20, leanDeg: 6 },
  set: { thighDeg: 56, trunkDeg: 20, leanDeg: 8 },
  strike: { thighDeg: 66, trunkDeg: 20, leanDeg: 8 },
  stood: { thighDeg: 70, trunkDeg: 14, leanDeg: 6 },
  staggerM: 0.07,
  hinge: { rateDegPerS: 120, accelDegPerS2: 300 },
  flat: { coverM: 0.12, captureK: 0.5 },
};

/**
 * Plan 16 (p39): LEAN_IN_V2 with the two-point set before the snap (`twoPoint`): over the load's planted feet the thigh
 * 50 deg below horizontal (hips 0.78 m, 2.6 cm over the load's: the fire-out barely sinks), knees about 84 deg, the rear
 * foot near flat (6 deg, the heel 3 cm up), the trunk at 25 deg (6 of it lean), the hands at the ready point. Getting
 * set from the reset takes about 0.7 s (the hinge's 300 deg/s2), the hips going 9 cm back as the trunk pitches. Limit: a
 * deeper trunk takes the hips further back over the planted feet, past the ball's 7 cm cover, and the rear foot steps in
 * the stance (28 deg: one man; 35: both, at 0.6 s); a deeper set needs its own feet under the hips, the snap's first step
 * taking them back.
 */
export const LEAN_IN_V3: LeanInStance = { ...LEAN_IN_V2, id: 'lean-in-v3', twoPoint: { thighDeg: 50, trunkDeg: 25, leanDeg: 6 } };

/**
 * Plan 16 (p40): LEAN_IN_V3 with the three-point stances before the snap (`threePoint`, `ThreePointSpec`), authored from
 * geometry against the reference photos (the offense FBX clip agrees: hips 0.66 m of a 0.91 m standing hip, trunk 80
 * deg, knees 82, a wide base, the down-hand foot 5 cm back; the defense clip's hips sit below its shoulders, against the
 * photos, and is not used). Derived on the BL body, the right hand down, the right foot back:
 * - Offense: both feet flat ahead of the hips (the flat rule at the stance's root: shins at the ankle's 38 deg), the
 *   thigh 33 deg below horizontal (hips 0.69 m, knees about 90), a wide base (each foot 12 cm out: 0.56 m between the
 *   ankles), an 8 cm stagger; the trunk at 90 deg (hips level with the shoulders, the back flat); the down hand under
 *   the shoulder and 10 cm inside it, on the turf; the off hand back by the thigh; the head up 50 deg.
 * - Defense: the rear foot on its ball (12 deg; the heel 8 cm up) under a thigh at 52 deg (hips 0.78 m), the front foot
 *   30 cm ahead (heel to toe), the base narrow (0.32 m); the trunk at 96 (hips 8 cm over the shoulders); the down hand
 *   12 cm ahead of the shoulder on the turf, the off hand cocked; the head up 55.
 * Getting set takes the hinge at 45 deg/s (90 deg/s2; `pace`): at the block's 120 and 300 the trunk overruns the
 * balance's 240 N m and he falls past 55 deg. The feet and the yaw read his level forward (`FlatStance.level`): past
 * 85 deg of pitch the body's own forward vanishes and the planner and yaw servo turned him round. Limits: no weight on
 * the hand (the down arm is a reach; his centre of mass stands over his feet), so the defense's weight is not forward;
 * a trunk past 90 deg is held only in a stance with level feet.
 */
export const LEAN_IN_V4: LeanInStance = {
  ...LEAN_IN_V3,
  id: 'lean-in-v4',
  threePoint: {
    offense: {
      thighDeg: 33,
      pitchDeg: 0,
      stepDeg: 2,
      staggerM: 0.08,
      widthAddM: 0.12,
      trunkDeg: 90,
      leanDeg: 6,
      hands: { right: { forwardM: 0.05, x: -0.1, upM: 0.004 }, left: { forwardM: -0.3, x: 0, upM: 0.5 } },
      head: { freeDeg: 30, maxDeg: 50 },
      pace: { rateDegPerS: 45, accelDegPerS2: 90 },
    },
    defense: {
      thighDeg: 52,
      pitchDeg: 12,
      stepDeg: 18,
      staggerM: 0.3,
      widthAddM: 0,
      trunkDeg: 96,
      leanDeg: 6,
      hands: { right: { forwardM: 0.12, x: -0.08, upM: -0.01 }, left: { forwardM: -0.1, x: 0.05, upM: 0.45 } },
      head: { freeDeg: 30, maxDeg: 55 },
      pace: { rateDegPerS: 45, accelDegPerS2: 90 },
    },
  },
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
  /** The block's base (its profile's; absent without one), read by the feet while he is engaged. */
  base?: BlockBase;
  /** Plan 16: the punch in progress (a profile with a strike; his controller's, from his request). */
  punch?: PunchState;
  /** Plan 16 (p36): his giving ground (a profile with `give`), kept by the motor step from his balance and his base. */
  give?: GiveState & { profile: GiveGround };
  /** Plan 16 (p37): his contest (a profile with `contest`), kept by the motor step while he is engaged. */
  contest?: ContestState & { profile: BlockContest };
}

/** The engaged state's fault switches (`SimDebug.block`; tests' negative controls). */
export interface BlockDebug {
  /** Fault: the engaged state is what holds this substep (no hysteresis), as a state derived from a solved contact would be. */
  fromContact?: boolean;
  /** Fault: the feet regime does not read the engaged state (only the solved contact and the arms' holds). */
  feetIgnore?: boolean;
  /** Plan 16 (p37) faults, the contest: his hold pushes him toward his man whatever his motion (`contestForce`). */
  contestHoldPushes?: boolean;
  /** The contest reads every man's capacity at effort 1. */
  contestEffortBlind?: boolean;
  /** The contest's fall clauses never take him down. */
  contestNoFall?: boolean;
  /** Plan 16 (p41) fault: a fire-out's feet are the free locomotion's (the walking start ramp and the run clip), as before p41. */
  fireFree?: boolean;
}

/**
 * One substep of a player's engaged state from his block request (undefined: he is not blocking) and whether anything
 * holds between him and his man now (`on`). Returns the state (undefined without a request) and the phase change, if any.
 */
export function advanceBlockState(
  st: BlockState | undefined,
  req: { request: BlockRequest; profile: BlockProfile; punch?: PunchState; hinge?: HingeLimits } | undefined,
  on: boolean,
  t: number,
  fault?: BlockDebug,
): { st: BlockState | undefined; change: { from: BlockPhase | null; to: BlockPhase | null } | null } {
  if (!req) return { st: undefined, change: st ? { from: st.phase, to: null } : null };
  const fresh = !st || st.target !== req.request.target;
  const s: BlockState = fresh ? { target: req.request.target, phase: 'approach', since: t, lastOnT: -Infinity, hinge: req.profile.hinge, ...(req.profile.base ? { base: req.profile.base } : {}), ...(req.profile.give ? { give: { profile: req.profile.give, excessM: 0, level: 0 } } : {}), ...(req.profile.contest ? { contest: { ...newContest(), profile: req.profile.contest } } : {}) } : st!;
  // (p40: the hinge's bounds as asked now: a pre-snap pose's own pace, then the profile's)
  const hb = req.hinge ?? req.profile.hinge;
  if (s.hinge !== hb) s.hinge = hb;
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
  /** Plan 16 (p41): he is out of his pre-snap stance on his first punch (number 0) under a strike with `fire` (it loads at once, as his fire-out). */
  fired?: boolean;
}

/**
 * One decision of the punch (`BlockStrike`): a new punch number starts the move again; none yet, the load begins inside
 * the load gap (or engaged, or closing on him); loaded and in range (not closer than `strike.minReachM`; engaged, within
 * `strike.engagedReachM` when the profile has it), the strike;
 * landed, the drive `strike.throughS` after (or when the palms come off sooner); missed (none landed, and a free arm
 * straight or the strike's time gone), the load again. The drive lasts until the punch number changes. Returns the punch now (undefined: none begun).
 */
export function nextPunch(K: BlockStrike, punchGapM: number, pu: PunchState | undefined, c: PunchCues): PunchState | undefined {
  const cur = pu && pu.n === c.serial ? pu : undefined;
  const closing = Math.max(0, c.closingMps);
  if (!cur) {
    const depth = punchDepth(K, c.speedMps);
    // (p41, the fire-out: out of his pre-snap stance he loads at the snap, wherever his man is)
    if (c.fired) return { n: c.serial, phase: 'load', since: c.t, depth, fire: true };
    return c.engaged || c.gap <= K.loadGapM || c.gap - closing * (K.load.minS * depth + K.strike.leadS) <= punchGapM ? { n: c.serial, phase: 'load', since: c.t, depth } : undefined;
  }
  const age = c.t - cur.since + 1e-9;
  // (p40: engaged, in his arm's reach, he throws it from there: `strike.engagedReachM`)
  const inRange = c.reachM - closing * K.strike.leadS <= K.strike.contactM || (K.strike.engagedReachM !== undefined && c.engaged && c.reachM <= K.strike.engagedReachM);
  if (cur.phase === 'load' && age >= K.load.minS * cur.depth && c.loaded && c.reachM >= K.strike.minReachM && inRange) return { ...cur, phase: 'strike', since: c.t };
  if (cur.phase === 'strike') {
    const onT = cur.onT ?? (c.anyOn ? c.t : undefined);
    // landed: the drive once through (or once the palms came off: the block's own hands re-arm them)
    if (onT !== undefined && (!c.anyOn || c.t - onT + 1e-9 >= K.strike.throughS)) return { n: cur.n, phase: 'drive', since: c.t, depth: cur.depth };
    if (onT === undefined && (c.straight || age >= K.strike.maxS)) return { n: cur.n, phase: 'load', since: c.t, depth: punchDepth(K, c.speedMps), ...(cur.fire ? { fire: true as const } : {}) };
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
    if (ctx.t + 1e-9 < (this.spec.fromS ?? 0)) {
      // (p39: in his pre-snap stance, when he has one, until the snap)
      const pre = R.stance ? P.preSnap?.[preSnapKey(R.stance)] : undefined;
      return pre && me ? this.preSnap(ctx, pre, me) : stand('block:waiting');
    }
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
        ...(K.fire && R.stance && P.preSnap?.[preSnapKey(R.stance)] && (R.punch ?? 0) === 0 ? { fired: true } : {}),
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
    // (p36, giving ground: his level, from the snapshot; 0 without `give`)
    const gl = P.give ? (ctx.observed.block?.[ctx.self]?.give ?? 0) : 0;
    // (p37, the contest: how far he is stood up, from the snapshot; 0 without `contest`)
    const sl = P.contest ? (ctx.observed.block?.[ctx.self]?.stood ?? 0) : 0;
    // (p41, the fire-out: his punch out of his pre-snap stance until a strike lands)
    const fire = K?.fire && pu?.fire && pu.phase !== 'drive' ? K.fire : undefined;
    let along: number;
    if (phase === 'engaged' && handOn) {
      const mine = horiz(me.position);
      if (!this.anchor || dot(sub(mine, this.anchor), dir) > 0) this.anchor = mine;
      const given = Math.max(0, dot(sub(this.anchor, mine), dir));
      const extra = R.intent === 'drive' ? P.driveMps : Math.min(P.hold.gainPerS * given, P.hold.maxMps - P.pressMps);
      along = effort * (P.pressMps + Math.max(0, extra));
      // (pushed past his base, his weight going back, he has no drive into his man)
      if (gl > 0) along *= 1 - gl;
    } else {
      // closing (or engaged chest to chest, no hand on: back to arm's length)
      this.anchor = null;
      const A = P.approach;
      // (loaded and striking, he closes on to the load's gap: the punch is thrown from range, not walked on)
      // (loaded or striking, to the load's gap; a strike profile's man closer than a strike lands from steps back)
      const left = gap - (K && pu && pu.phase !== 'drive' ? K.load.closeGapM : A.holdGapM);
      const loaded = !!K && !!pu && pu.phase !== 'drive';
      const close = left > 0 ? Math.min(fire ? fire.mps : loaded ? K!.load.closeMps : A.mps, A.gainPerS * left, Math.sqrt(2 * A.brakeMps2 * left)) : Math.max(-A.backMps, A.gainPerS * left);
      // the gap closes at that speed, his own part of it counted (he follows a man moving off, gives ground to one coming
      // on); firing, that is his own speed (p41)
      along = K && pu && pu.phase !== 'drive' && reachM < K.strike.minReachM ? -A.backMps : Math.max(-A.backMps, fire ? close : close + dot(hv, dir));
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
    const S00 = K ? punchPose(P, pu) : P.stance;
    // (p41, the fire-out: loaded, the trunk at the fire's, low)
    const S0 = fire && pu?.phase === 'load' ? { ...S00, hingeDeg: Math.max(0, fire.trunkDeg - S00.leanDeg) } : S00;
    // (p36, giving ground: stood up by how far he is pushed past his base; p37, the contest: by how hard he is knocked back,
    // hips up and trunk up)
    const S1 = gl > 0 ? { ...S0, heightM: S0.heightM + gl * P.give!.riseM } : S0;
    const S = sl > 0 ? { ...S1, heightM: S1.heightM + sl * P.contest!.stood.riseM, hingeDeg: Math.max(0, S1.hingeDeg - sl * P.contest!.stood.trunkDeg) } : S1;
    // (p41, firing: his feet's frame level, as in the stance he comes out of)
    const stance = this.stanceRequest(fire && P.flat ? { ...S, flat: { ...P.flat, level: true } } : S);
    return {
      locomotion: { desiredVelocityWorld: vel, desiredFacingWorld: dir, effort, yawEffort: 1, stance },
      arms,
      posture: { leanDirWorld: dir, leanRad: rad(S.leanDeg), hinge: { rad: rad(S.hingeDeg), dropM: S.dropM } },
      block: { request: { ...R }, profile: P, ...(pu ? { punch: pu } : {}), ...(fire ? { hinge: { ...P.hinge, ...fire.pace } } : {}) },
      debug: { phase: `block:${phase}`, gap, along, hands, ...(K ? { punch: pu?.phase ?? null, reachM } : {}), ...(fire ? { fire: true } : {}) },
    };
  }

  /**
   * The suspension's stance request for one of his block stances (on his flat feet, the whole root height on a ball; a
   * pre-snap pose's own feet and floor, p40, in place of the profile's).
   */
  private stanceRequest(S: BlockStance & Pick<PreSnapPose, 'flat' | 'lowM'>): StanceRequest {
    const flat = S.flat ?? this.profile.flat;
    return { heightM: S.heightM, staggerM: S.staggerM, ...(S.widthAddM ? { widthAddM: S.widthAddM } : {}), ...(flat ? { flat } : {}), ...(flat?.ball ? { heightWhole: true } : {}), ...(S.lowM !== undefined ? { lowM: S.lowM } : {}) };
  }

  /**
   * Plan 16 (p39): before the snap, in his pre-snap stance `S` (`BlockProfile.preSnap`): standing where he is, facing as he
   * started, his stance (height, stagger, width, flat feet), lean and hinge asked, both hands at the ready point. He asks to
   * block (the engaged state's request), so the hinge has his block's bounds; nothing moves him toward his man. (p40: a
   * pose's own feet, floor, hands and head as it asks: a hand at its place in his level frame, `PreSnapHand`.)
   */
  private preSnap(ctx: ControllerContext, S: PreSnapPose, me: ControllerContext['observed']['bodies'][string]): PlayerIntent {
    const P = this.profile;
    const myBody = ctx.bodies[ctx.self];
    const lateral = norm(horiz(qRot(me.rotation, v3(1, 0, 0))), v3(1, 0, 0));
    const hand = (side: ArmSide): ArmIntent => {
      const H = S.hands?.[side];
      const out = sideSignX(myBody, side);
      if (!H) return { action: 'reach', targetWorld: add(me.position, qRot(me.rotation, v3(out * P.ready.x, P.ready.y, frontOf(myBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1)) + P.ready.forwardM))) };
      const sh = add(me.position, qRot(me.rotation, shoulderLocal(myBody, side)));
      const at = add(add(sh, scale(this.lastFacing, H.forwardM)), scale(lateral, out * H.x));
      return { action: 'reach', targetWorld: v3(at.x, H.upM, at.z), ...(H.pole ? { poleLocal: v3(out * H.pole.x, H.pole.y, H.pole.z) } : {}) };
    };
    return {
      locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: this.lastFacing, effort: 1, stance: this.stanceRequest(S) },
      arms: { left: hand('left'), right: hand('right') },
      posture: { leanDirWorld: this.lastFacing, leanRad: rad(S.leanDeg), hinge: { rad: rad(S.hingeDeg), dropM: S.dropM }, ...(S.head ? { headUp: S.head } : {}) },
      block: { request: { ...this.spec.request }, profile: P, ...(S.pace ? { hinge: { ...P.hinge, ...S.pace } } : {}) },
      debug: { phase: 'block:set' },
    };
  }

  exportParams(tickS: number): unknown {
    return { kind: 'block', request: this.spec.request, fromS: this.spec.fromS ?? 0, fromTick: Math.round((this.spec.fromS ?? 0) / tickS), profile: this.profile };
  }
}
