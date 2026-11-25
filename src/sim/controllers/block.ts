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
import type { ArmIntent, ArmSide, FlatStance, HeadGaze, HeadUp, PlayerId, PlayerIntent, PushRequest, StanceRequest } from '../contracts';
import type { BodyProfile, MotorProfile } from '../profiles';
import { armSeatWorld, shoulderLocal, sideSignX } from '../profiles';
import type { PlayerSetup } from '../fixture';
import type { HingeLimits } from '../hinge';
import { legForThigh, legShape, newContest, withBeaten, type BlockBase, type BlockContest, type ContestState, type GiveGround, type GiveState } from '../block-base';
import type { Controller, ControllerContext } from './base';
import { clamp, cross, dot, horiz, len, levelForwardOf, norm, qFromAxisAngle, qInvRot, qRot, rad, scale, sub, add, addScaled, v3, type Vec3 } from '../vec';

/** What the block does once engaged: hold his ground (push back as he is moved) or drive his man back. */
export type BlockIntent = 'hold' | 'drive';
/**
 * Where his hands go on the other man: `under`, low and inside on his chest with the elbows down, the arms under the other
 * man's; `over`, together high on his upper chest, the arms over the other man's. A pair needs one of each: two men's arms
 * at one height share a lane and pass through each other (plan 16 p31).
 */
export type BlockHands = 'under' | 'over';

/** Plan 16 (p45): which lane a man's hands have against his man's (`BlockLanes`). */
export type BlockLane = 'inside' | 'outside';

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
  /**
   * Plan 16 (p50), the hand fight (a profile with `handFight.swipe`): the swipes he is asked for (`SwipeRequest`), each
   * once, in order per hand. Absent: none.
   */
  swipes?: SwipeRequest[];
  /**
   * Plan 16 (p52), the re-punch (a profile with `handFight.rePunch`): the re-punches he is asked for (`RePunchRequest`), each
   * once, in order per hand. Absent: none.
   */
  rePunches?: RePunchRequest[];
  /**
   * Plan 16 (p53): his side of the ball (`blockSide`; absent, his pre-snap stance's). Under a hand fight with sides
   * (`BlockHandFight.sides`) the offense's hands hold and the defense's strike.
   */
  side?: BlockSide;
}

/** Plan 16 (p53): a blocker's side of the ball. */
export type BlockSide = 'offense' | 'defense';
/** Plan 16 (p53): his side (`BlockRequest.side`, else his pre-snap stance's; undefined: neither). */
export const blockSide = (R: BlockRequest): BlockSide | undefined => R.side ?? R.stance?.side;

/**
 * Plan 16 (p50): a swipe asked of a blocker (`BlockRequest.swipes`): from `atS` (s), once he is engaged with his punch
 * through and that hand at home, his hand `hand` chops down and out through his man's arm `at` (absent: the one across
 * from it, on the same side of the field: my right hand at his left arm). Whether it meets the arm is the arms' own.
 */
export interface SwipeRequest {
  atS: number;
  hand: ArmSide;
  at?: ArmSide;
}

/**
 * Plan 16 (p52): a re-punch asked of a blocker (`BlockRequest.rePunches`): from `atS` (s), once he is engaged with his punch
 * through and that hand at home, his hand `hand` comes off his man, loads low by his ribs and punches back on him inside
 * his man's arm on that side (`HandRePunch`). Whether it gets inside is the gap's and the arms' own.
 */
export interface RePunchRequest {
  atS: number;
  hand: ArmSide;
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
  /**
   * Plan 16 (p44), a hand down on the turf: its place stands in front of his knee by this much (m) beyond the thigh's and
   * the palm's radius, the knee as it stands in the set; and while the turf there is beyond his reach the hand asks the
   * lowest point over it his arm reaches (`front`, derived by `leanInStances`). He is set at his stance's height from the
   * reset, his trunk upright and tipping in at the stance's pace: the turf under his shoulder beyond his reach, the hand
   * reaching for it hung straight down onto his squatting thigh, through it (10-14 cm in for the first second). Over the
   * place in front of the knee it hangs clear of the thigh and comes down to the turf as his trunk goes down; in the set
   * the place ahead of his shoulder is the further one, and the turf within reach. Absent: none.
   */
  kneeClearM?: number;
  /** Derived (p44, from `kneeClearM`): the place stands at least `aheadM` ahead of his root along his facing (m), and the hand no lower than his arm's reach `reachM` from his shoulder. */
  front?: { aheadM: number; reachM: number };
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
  /**
   * Plan 16 (p54): the palm on his upper arm on his side across from it (my right hand on his left arm), not on his body:
   * its ball's centre `seatM` from the arm's line, `t` of the way from his shoulder to his elbow, turned `angDeg` from
   * straight out from his midline toward his up about the arm (`armSeatWorld`), aimed `depthM` on beyond it along the line
   * from my shoulder (the palm's contact point is ahead of its ball); the push asks to stay there (`PushRequest.onArm`; the
   * arm profile's `PalmPushProfile.onArm`). His arm unobserved, and for the strike's range, `y` and `x` on his body as
   * without it.
   */
  onArm?: { t: number; angDeg: number; seatM: number };
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
  /** Plan 16 (p43), his eyes on his man (`BlockGaze`); absent, the head on the trunk (in a pre-snap stance, its head up). */
  gaze?: BlockGaze;
  /**
   * Plan 16 (p45): a palm's aim (`HandAim`) is its point on his chest's front (`y` up his frame, `x` off its centre line)
   * and `depthM` on beyond it along the line from my shoulder through it, not `depthM` into his chest along its normal.
   * Why: a palm from above his chest (in his frame: he is pitched toward me, or lower) aimed into it along its normal meets
   * his chest above its aim by the depth times the slant (8 cm at 55-65 deg: 11-17 cm), off the top of his chest plate
   * (BL-F10-twoPointVsThree: the over hands' aim 0.55 m up his frame, his chest met at 0.64-0.69, outside the push's band,
   * and slid on over his shoulders); along the line from the shoulder it meets him at its aim. Absent: along the normal.
   */
  aimThrough?: true;
  /**
   * Plan 16 (p45): engaged with a palm on his man, his request toward him counts his man's own speed away from him, on
   * top of his press and his drive or hold: a man whose man is knocked off follows him through, feet driving, and does not
   * pull up. Why: on his press and drive alone (0.4 m/s at effort 0.5) the winner of the first collision brakes to it as
   * his man is knocked off at 1.4-1.7 m/s; their chests part past his arms' reach. Absent: his request alone.
   */
  followThrough?: true;
  /**
   * Plan 16 (p48): engaged with a palm or forearm against his man and no push on (his arms folded between the chests, a
   * push ended as it folded), he holds or drives as with his hands on: his arms are a frame, and he does not back off to
   * arm's length. Why: a man whose man has come on into his chest cannot get there while his man follows him, and backed
   * off at his back-off speed with his palms against his man, never clear enough to re-arm: in BL-F2-walkIn under the full
   * set B's outside palms fold under A's walk-in and end at 1.71 s; B backs off at 0.5 m/s with A's helmet in his chest and
   * A following, 4 m in 7 s, his palms on 3 % of the time, and never anchors. Absent: only a palm push holds him there.
   */
  frame?: true;
  /** Plan 16 (p45): the inside lane, won by who gets there (`BlockLanes`); absent, the request's placement (`hands`). */
  lanes?: BlockLanes;
  /** Plan 16 (p46): the winner of the hit stays low and the man it beat stays up (`BlockUnder`); absent, neither. */
  under?: BlockUnder;
  /** Plan 16 (p47): he runs in (`BlockRunIn`); absent, he closes at the approach's speed, braked to its gap. */
  runIn?: BlockRunIn;
  /** Plan 16 (p50): the hand fight, each hand with its own state (`BlockHandFight`, `BlockState.hands`); absent, none. */
  handFight?: BlockHandFight;
}

/**
 * Plan 16 (p50), the hand fight (`BlockProfile.handFight`): each of his hands has its own state (`HandState`,
 * `BlockState.hands`), kept with his engaged state. Each hand's lane is his own lane's (the inside lane's call,
 * `BlockLanes`, gives both of his hands theirs), and his arms aim each hand by its own lane; what each hand is doing is
 * his controller's (home, or striking with his punch). With nothing more asked of the hands than that, he blocks exactly
 * as without it: the state wraps the lane and the strike, so the moves that act on one hand (a swipe, a re-fit, a
 * re-punch for the inside) can be built on it.
 */
export interface BlockHandFight {
  id: string;
  /** Plan 16 (p50): the swipe (`HandSwipe`, asked by `BlockRequest.swipes`); absent, none. */
  swipe?: HandSwipe;
  /** Plan 16 (p50): a hand knocked off his man by a swipe (`HandKnock`); absent, a knock only ends its push. */
  knock?: HandKnock;
  /** Plan 16 (p50): the re-fit of a knocked hand (`HandRefit`); absent, a knocked hand goes back on as the block's own hands do. */
  refit?: HandRefit;
  /**
   * Plan 16 (p50): what a hand knocked off his man costs him in the contest once its knock is over and until it is back on
   * him (a share of his capacity, his `ContestState.leverage`); absent, nothing. While knocked it costs its knock's `cut`.
   */
  offCut?: number;
  /** Plan 16 (p51): the body in the hand fight (`HandBody`); absent, the hands move alone. */
  body?: HandBody;
  /**
   * Plan 16 (p52): the re-punch (`HandRePunch`, asked by `BlockRequest.rePunches`), and with it the inside lane's leverage
   * counted per hand (`lanesLeverage`); absent, none, and the leverage his own lane's.
   */
  rePunch?: HandRePunch;
  /**
   * Plan 16 (p53): the hands have a side (`HandSides`, the man's `blockSide`): the offense's hands hold, the defense's
   * re-punch strikes; with it the contest's inside leverage is counted from the holds and the defense's hands inside
   * (`sidedLeverage`). Absent, the re-punch as p52's (either man's for the inside).
   */
  sides?: HandSides;
}

/**
 * Plan 16 (p53), the hands have a side (`BlockHandFight.sides`; user, 2026-11-24: the defense's re-punch is to push the
 * lineman back and break his grip, the offense's to re-establish a good hold on the inside of the chest). The re-punch's
 * way, its wash and its lanes are p52's (`HandRePunch`) for both; what it is for, and what it does, is the man's side's:
 * - the offense's hand on his man's chest inside his frame, his man in front of him and square, has a hold (`HandHold`);
 * - the defense's re-punch, landed, is a strike (`HandStrike`): his contest bursts through it as a strike's does, so the
 *   blocker is knocked back and stood up; its way through the blocker's arm washes that hand off (its hold with it); a
 *   blocker stood up past the hold's `breakLevel` loses every hold he has;
 * - the offense's re-punch, the same way (loaded tight to his ribs, inside onto the chest plate), from a hand whose hold
 *   was broken or that never had one, holds again as it lands (a new push);
 * - either man's re-punch landed has him back under: his load and punch reset how far he is beaten (the contest's
 *   `beaten`) to what his stood level has over his man's then.
 * The defense's hands never hold.
 */
export interface HandSides {
  hold: HandHold;
  strike: HandStrike;
}

/**
 * Plan 16 (p53), the offense's hold (`HandSides.hold`, NFL Rule 12-1-3: a grip on the chest plate inside the frame with
 * the defender square in front is the legal block; it becomes holding when he gets off the blocker's centre and the hands
 * keep him). A hand has a hold (`HandState.hold`) while: his man is offense, his hand's palm push is on his man and
 * pushing (not folded), the patch inside his man's frame
 * (in his man's body frame within `frameM` of his centre line and no higher than `topM`: the chest plate, not the shoulder
 * tops), his man in front of him (within `frontDeg` of his heading) and square to him (facing him within `squareDeg`), and
 * he is not stood up past `breakLevel` (his contest's level). It forms on a push as those hold (once per push: a hold
 * ended does not form again on the same push; a new push, re-fitted or re-punched, holds again). It ends at once when
 * the push ends (a knock, a wash, past his reach) or he is stood up past `breakLevel` (broken); when the other conditions
 * end it is given up `letGoS` later, and kept until then: a hold kept outside them is holding, counted
 * (`BlockState.holdingS`, the snapshot's and the summary's `holding`; no penalty, no behaviour).
 * While it holds, his push may pull (`PushRequest.hold`): past its rest length by more than `slackM`, the strut's spring
 * and damper in tension, at most `tensionN` times his push's effort: the hand stays on and resists his man separating or
 * slipping off. And it controls his man in the contest: his man's capacity's share is the inside leverage's
 * (`BlockContest.inside`) 1 / sqrt(L) per hold on him (two 1 / L, one 1 / sqrt(L), none 1), in place of the lanes'.
 */
export interface HandHold {
  frameM: number;
  topM: number;
  frontDeg: number;
  squareDeg: number;
  breakLevel: number;
  letGoS: number;
  tensionN: number;
  slackM: number;
}

/**
 * Plan 16 (p53), the defense's strike (`HandSides.strike`): his re-punch landed on the blocker (`BlockState.struckT`), for
 * `s` seconds his contest is striking (as his punch's strike and its burst: his push to the burst's, carried by the hit
 * while his palms are on; its force-velocity line run on to the burst's speed), so the blocker is knocked back, and by
 * that stood up. No force of its own.
 */
export interface HandStrike {
  s: number;
}

/**
 * Plan 16 (p51), the body in the hand fight (`BlockHandFight.body`). The swiper's trunk turns with his swing, ahead of
 * his hand as a thrower's does: his swinging shoulder back `swing.backDeg` over the wind-up's first half, then forward
 * through to `swing.thruDeg` by the chop's middle (`SwipeArc`), his trunk `swing.dipDeg` further over onto the hinge
 * and leaned `swing.rollDeg` to that side with it, held to the chop's end, then back to none over the re-fit's path time
 * (`HandRefit.path.s`) as his hand goes back on. These are what is asked of his facing and lean, which follow late.
 * The knocked man, the support he leaned on gone from that side, falls into it: that shoulder forward `knock.turnDeg` and
 * down (his body leaned `knock.rollDeg` to that side), as his hand is carried (`HandKnock.carry`), then back to none over
 * the same time. Turned is his facing turned about the vertical, leaned his balance's lean (the two added); no force of
 * its own: what it does to the contest is what his body's motion does.
 */
export interface HandBody {
  swing: { backDeg: number; thruDeg: number; dipDeg: number; rollDeg: number };
  knock: { turnDeg: number; rollDeg: number };
}

/**
 * Plan 16 (p50), the swipe (`BlockHandFight.swipe`): his hand leaves his man and goes up over the arm it is for, to `aboveM`
 * over the point `alongF` of the way down that forearm from its elbow to its wrist and `outM` out from between them (the
 * raise: until within `tolM` of it, at most `raiseS`), then chops down and out through it, to `downM` under that point and
 * `throughOutM` out (the chop: the point fixed as it begins; until within `tolM`, at most `chopS`). The chop meets the arm
 * when his palm's ball comes within `hitTolM` of that forearm's capsule as shown (the simulation's, `handContacts`):
 * that hand of his man is knocked. Then his hand is at home again (the block's own hands put it back on).
 */
export interface HandSwipe {
  alongF: number;
  aboveM: number;
  outM: number;
  downM: number;
  throughOutM: number;
  tolM: number;
  raiseS: number;
  chopS: number;
  hitTolM: number;
  /** Plan 16 (p51): the swipe as one fluid move along its own timed arc (`SwipeArc`), in place of the raise and chop above; absent, those. */
  arc?: SwipeArc;
}

/**
 * Plan 16 (p51), the swipe as one fluid move (`HandSwipe.arc`). Each part is a curve whose time is eased in and out
 * (minimum jerk: no constant-speed straight runs, no instant turns), its points in his level frame (his body's heading,
 * upright) at that shoulder. The wind-up (`windS`): the hand leaves his man, lifted `liftM` over the straight way, and
 * loads `windUpM` over his shoulder, `windFwdM` ahead of it and `windOutM` out from it (up by his ear, the elbow up and
 * out). The chop (`chopS`): from there down over the point on his man's forearm (`HandSwipe.alongF`; `skimM` over it, on
 * the side the chop comes from) at its middle, where it is fastest, and on past it to the follow-through's end,
 * `thruDownM` under his shoulder, `thruOutM` out from it and `thruFwdM` ahead; the forearm's point is the live one until
 * the chop meets it, then held where it met, and the knock it gives is along the line to the follow-through's end. Then the
 * hand goes back onto his man as a re-fit does (`HandRefit.path`). While it moves the palm's top speed is `mps` (the curve
 * sets its pace; the arm's everyday top speed would cut it).
 */
export interface SwipeArc {
  windS: number;
  windUpM: number;
  windFwdM: number;
  windOutM: number;
  liftM: number;
  chopS: number;
  thruDownM: number;
  thruOutM: number;
  thruFwdM: number;
  mps: number;
  /** (m: about a palm's and a forearm's thickness, so the palm meets the arm's top, not its middle) */
  skimM: number;
  /**
   * The upper arm's top twist rate through the swipe (rad/s, `ArmIntent.twistRadPs`; a ballistic strike's, under a
   * thrower's). The hand passes close in front of his shoulder, which turns the upper arm about itself fast; held to the
   * everyday rate (the joint range's 12) the twist window turned the elbow about the shoulder-to-palm line instead, over
   * or under it in one frame (a snap of the shoulder, 65-130 rad/s).
   */
  twistRadPs: number;
}

/**
 * Plan 16 (p50), a knocked hand (`BlockHandFight.knock`): his palm push on that hand ends (reason `knocked`) and for `s`
 * (s) the hand is driven on from where the chop met it, `m` along the chop's line off his forearm. With his push ended
 * (the support he leaned on gone) his trunk drops `dropDeg` more onto the hinge, the hand costs him `cut` of his
 * capacity in the contest (`ContestState.leverage`), and (`opens`) the man whose swipe knocked it drives into the opening
 * until it is back on him: his contest bursts as a strike's does (`BlockContest.burst`). Then it is at home again.
 */
export interface HandKnock {
  m: number;
  s: number;
  dropDeg: number;
  cut: number;
  opens?: boolean;
  /**
   * Plan 16 (p50, with `refit`): the hand driven `offM` off his man too, along the line from his man to him (knocked down
   * and out along his man's front, a palm stays on him and could not go back on: the arms' own withdrawal rule); absent, none.
   */
  offM?: number;
  /**
   * Plan 16 (p51): the hand carried along its knock as a struck thing is: fastest as the chop meets it, slowing to rest at
   * the knock's end (the way covered 1 - (1 - u)^3 of the whole at u of its time), its palm's top speed `mps`; absent, it
   * goes for the knock's end point at the arm's own pace.
   */
  carry?: { mps: number };
}

/**
 * Plan 16 (p50), the re-fit (`BlockHandFight.refit`): his knocked hand, its knock over, goes straight back up onto his
 * man at its own lane's aim (the inside lane's: his chest plate), its push extending at `extendMps`, while his other hand
 * stays home; on him again, it is at home. Not on him by `s` (s), it goes back on as the block's own hands do (from the
 * ready point).
 */
export interface HandRefit {
  s: number;
  extendMps: number;
  /**
   * Plan 16 (p51): the way back on as one eased curve (minimum jerk over `s` seconds) from where the hand was as the re-fit
   * began to its aim, coming in along the line from his shoulder to the aim as a punch lands and bowed `bowM` out to his
   * side, its palm's top speed `mps`; a swipe's own hand comes back the same way from its follow-through (`SwipeArc`).
   * Absent, straight at the aim at the arm's pace.
   */
  path?: { s: number; bowM: number; mps: number };
}

/** Plan 16 (p50): the first hand fight (`BlockHandFight`): each hand's own state, nothing asked of it yet. */
export const HANDS_V1: BlockHandFight = { id: 'hands-v1' };

/**
 * Plan 16 (p50): the swipe and the knock (`BlockHandFight`). The chop goes for the middle of his forearm from 9 cm over it,
 * through to 16 cm under it and 14 cm out (raise at most 0.14 s, chop at most 0.16 s: at the arm's 4 m/s, the swipe takes
 * about 0.1-0.3 s), riding his arm down once it meets it; a knocked hand is driven 20 cm on for 0.15 s, his trunk 6 deg
 * further over. A knocked hand costs him half his capacity, then until it is back on his man 30 %.
 */
export const HANDS_V2: BlockHandFight = {
  id: 'hands-v2',
  swipe: { alongF: 0.55, aboveM: 0.09, outM: 0.02, downM: 0.16, throughOutM: 0.14, tolM: 0.04, raiseS: 0.14, chopS: 0.16, hitTolM: 0.015 },
  knock: { m: 0.2, s: 0.15, dropDeg: 6, cut: 0.5, opens: true },
  offCut: 0.3,
};

/**
 * Plan 16 (p50): HANDS_V2 and the re-fit (`HandRefit`): the knocked hand, driven 12 cm off his man as well, straight back
 * on at its aim within 0.4 s, its push extending at 3 m/s (the strike's pace).
 */
export const HANDS_V3: BlockHandFight = { ...HANDS_V2, id: 'hands-v3', knock: { ...HANDS_V2.knock!, offM: 0.12 }, refit: { s: 0.4, extendMps: 3 } };

/**
 * Plan 16 (p51): HANDS_V3 with the swipe as one fluid move (`SwipeArc`): a 0.14 s wind-up to 20 cm over the shoulder, 15
 * cm ahead of it and 4 cm out, a 0.18 s chop over his man's forearm at its fastest and on to 50 cm under the shoulder, 22
 * cm out and 35 cm ahead, then back onto him along an eased curve in 0.17 s (`HandRefit.path`); the knocked hand carried
 * 30 cm over 0.15 s, fastest as it is struck (`HandKnock.carry`), and re-fitted along the same kind of curve.
 */
export const HANDS_V4: BlockHandFight = {
  ...HANDS_V3,
  id: 'hands-v4',
  swipe: { ...HANDS_V3.swipe!, arc: { windS: 0.14, windUpM: 0.2, windFwdM: 0.15, windOutM: 0.04, liftM: 0.06, chopS: 0.18, thruDownM: 0.5, thruOutM: 0.22, thruFwdM: 0.35, mps: 10, skimM: 0.1, twistRadPs: 50 } },
  knock: { ...HANDS_V3.knock!, m: 0.3, s: 0.15, carry: { mps: 9 } },
  refit: { ...HANDS_V3.refit!, path: { s: 0.17, bowM: 0.06, mps: 10 } },
};

/**
 * Plan 16 (p52), the re-punch (`BlockHandFight.rePunch`): a hand without the inside taken off his man and punched back on
 * him inside his man's arm on that side, so the inside is won per hand. The load (`loadS`): the hand leaves his man and is
 * drawn back and down along an eased curve (minimum jerk) bowed `load.outM` out to his side and `load.backM` back toward
 * him, to `load.downM` under his shoulder, `load.fwdM` ahead of it and `load.inM` in from it (his level frame at that
 * shoulder: by his ribs), the elbow's pole `load.pole` (down and back: tight to his ribs). The punch (`punchS`): from where
 * the hand is, up and in along an eased curve through the point under his man's forearm on that side (`pass`: `alongF`
 * of the way from its elbow to its wrist, `downM` under it and `inM` toward the two men's middle) onto `aim` (his chest
 * plate under and inside his arms), its push extending at `extendMps`; on him, the hand is at home and stays on `aim`; not
 * on him `landS` after the punch's time, it re-fits from where it is (`HandRefit.path`). While it moves the palm's top
 * speed is `mps`. The gap: as the punch begins, its way (sampled) must keep `clearM` (a palm's and an arm's thickness)
 * from his man's upper arm on that side (shoulder to elbow; his forearm is what the punch moves) as observed; closed (his
 * elbow tight in to his chest), the punch goes onto his own lane's aim (the outside) and nothing changes hands. The wash:
 * the punching palm's ball or forearm coming within `hitTolM` of his man's forearm on that side as shown (the
 * simulation's `handContacts`), or landing on him, knocks that hand (`HandKnock`: its push ended, carried along `wash`,
 * up, out to his man's side and back toward his man, a direction: off the puncher's body, so it can go back on him; it
 * opens nothing, `HandKnockFact.wash`) and its lane is the outside; the punching hand's the inside. While the hand is off
 * his man it costs him the hand fight's `offCut`. `body` (with `HandBody`): his shoulder on that side `backDeg` back and
 * his trunk `dipDeg` further over as the hand loads, then through to `thruDeg` by the punch's end, the dip held, both back
 * to none over the re-fit's path time from when it landed.
 */
export interface HandRePunch {
  /** the punch's aim on his man (`HandAim`, his frame), under and inside his arms: his chest plate as high as the punch reaches */
  aim: HandAim;
  loadS: number;
  load: { downM: number; fwdM: number; inM: number; outM: number; backM: number; pole: Vec3 };
  punchS: number;
  pass: { alongF: number; downM: number; inM: number };
  landS: number;
  extendMps: number;
  mps: number;
  clearM: number;
  hitTolM: number;
  wash: { up: number; out: number; back: number };
  body?: { backDeg: number; thruDeg: number; dipDeg: number };
}

/** Plan 16 (p51): a man's level frame at one shoulder (`BlockController.levelAt`): the shoulder (world), his heading and his left (horizontal), and out on that side. */
export interface LevelFrame {
  sh: Vec3;
  fwd: Vec3;
  left: Vec3;
  out: Vec3;
}

/** Plan 16 (p51): a world point in a level frame (x his left, y up, z his heading; m from the shoulder), and back. */
export const levelLocal = (L: LevelFrame, p: Vec3): Vec3 => {
  const d = sub(p, L.sh);
  return v3(dot(d, L.left), d.y, dot(d, L.fwd));
};
export const levelWorld = (L: LevelFrame, l: Vec3): Vec3 => add(addScaled(addScaled(L.sh, L.left, l.x), L.fwd, l.z), v3(0, l.y, 0));

/** Plan 16 (p51, `SwipeArc`): the wind-up's load and the follow-through's end in a level frame at the swinging shoulder (world). */
export const arcWind = (L: LevelFrame, A: SwipeArc): Vec3 => add(addScaled(addScaled(L.sh, L.out, A.windOutM), L.fwd, A.windFwdM), v3(0, A.windUpM, 0));
export const arcThrough = (L: LevelFrame, A: SwipeArc): Vec3 => add(addScaled(addScaled(L.sh, L.out, A.thruOutM), L.fwd, A.thruFwdM), v3(0, -A.thruDownM, 0));

/** Plan 16 (p51): the minimum-jerk ease of a move's time `u` (0..1): 0 at 0, 1 at 1, at rest and not accelerating at both ends. */
export const easeMinJerk = (u: number): number => {
  const x = clamp(u, 0, 1);
  return x * x * x * (10 + x * (6 * x - 15));
};

/** Plan 16 (p51): the point `s` (0..1) of the quadratic curve from `a` to `b` pulled toward `q`. */
export const curveAt = (a: Vec3, q: Vec3, b: Vec3, s: number): Vec3 => add(add(scale(a, (1 - s) * (1 - s)), scale(q, 2 * s * (1 - s))), scale(b, s * s));

/** Plan 16 (p51): the pull of a quadratic curve from `a` to `b` that passes through `m` at its middle. */
export const curveThrough = (a: Vec3, m: Vec3, b: Vec3): Vec3 => sub(scale(m, 2), scale(add(a, b), 0.5));

/**
 * Plan 16 (p51): HANDS_V4 with the body in it (`HandBody`), as asked: the swiper's swinging shoulder 6 deg back, then 10
 * deg through, his trunk 6 deg further over and 4 deg to that side; the knocked man's shoulder 16 deg forward and 8 deg
 * down. His body follows late and less (in the pass rush about 3 deg more through than without, the knocked shoulder
 * about 6 deg more forward, half of it back by the time his hand is on again).
 */
export const HANDS_V5: BlockHandFight = { ...HANDS_V4, id: 'hands-v5', body: { swing: { backDeg: 6, thruDeg: 10, dipDeg: 6, rollDeg: 4 }, knock: { turnDeg: 16, rollDeg: 8 } } };

/**
 * Plan 16 (p52): HANDS_V5 with the re-punch (`HandRePunch`): the hand drawn back in 0.18 s, bowed 14 cm out and 6 cm back,
 * to 30 cm under the shoulder, 12 cm ahead and 4 cm in, the elbow down and back; punched in 0.16 s through 12 cm under his
 * man's forearm's middle and 4 cm in onto his chest plate 46 cm up and 10 cm out (the inside lane's 36 is past the reach of
 * a man held off at arm's length by a pitched man's long arms; at its 7 cm out, the arm line from a man's left shoulder to
 * a man turned by his first re-punch faced his chest at 0.55, under the push's 0.6, and the hand stayed off him), its push
 * extending at 3 m/s, at most 9 m/s; landing within 0.12 s
 * more; the way clear of his upper arm by 10 cm; his man's hand washed up, out and back off him as the arms come within
 * 4 cm (the forearms meet as the punch arrives: met at contact, the punching forearm went 7 cm into his before his moved);
 * his shoulder 8 deg back and his trunk 5 deg over as it loads, 12 deg through as it punches, the dip held until it lands.
 */
export const HANDS_V6: BlockHandFight = {
  ...HANDS_V5,
  id: 'hands-v6',
  rePunch: {
    loadS: 0.18,
    aim: { y: 0.46, x: 0.1, depthM: 0.08, pole: v3(0, -1, 0.1), lengthM: 0.64 },
    load: { downM: 0.3, fwdM: 0.12, inM: 0.04, outM: 0.14, backM: 0.06, pole: v3(0, -1, -0.5) },
    punchS: 0.16,
    pass: { alongF: 0.5, downM: 0.12, inM: 0.04 },
    landS: 0.12,
    extendMps: 3,
    mps: 9,
    clearM: 0.1,
    hitTolM: 0.04,
    wash: { up: 0.5, out: 0.5, back: 0.7 },
    body: { backDeg: 8, thruDeg: 12, dipDeg: 5 },
  },
};

/**
 * Plan 16 (p53): HANDS_V6 with the hands' sides (`HandSides`). The hold: the patch within 17 cm of his man's centre line
 * and no higher than 0.58 m up his frame (the chest plate; the shoulder tops, 0.62-0.65, are outside it), his man within
 * 35 deg of his heading and facing him within 45, broken stood up past 0.5, given up 0.12 s after its conditions end;
 * its pull past 6 cm over its rest (near his full reach) at most 300 N at effort 1. The strike: his contest striking for 0.25 s from the landing
 * (the contest's burst window). The wash mostly out (up 0.2, out 1, back 0.4: p52's up 0.5, out 0.5, back 0.7 carried the
 * three-point man's arm, on the blocker's shoulder top, back over his own shoulder to straight up, where its twist turns
 * over in a frame).
 */
export const HANDS_V7: BlockHandFight = {
  ...HANDS_V6,
  id: 'hands-v7',
  rePunch: { ...HANDS_V6.rePunch!, wash: { up: 0.2, out: 1, back: 0.4 } },
  sides: {
    hold: { frameM: 0.17, topM: 0.58, frontDeg: 35, squareDeg: 45, breakLevel: 0.5, letGoS: 0.12, tensionN: 300, slackM: 0.06 },
    strike: { s: 0.25 },
  },
};

/**
 * Plan 16 (p53, `HandHold`): his man in front of him and square to him: his man's centre (`hisP`, world) within
 * `frontDeg` of his heading `myFwd` (horizontal) from `myP`, his man's heading `hisFwd` within `squareDeg` of facing him.
 */
export function squareInFront(H: HandHold, myP: Vec3, myFwd: Vec3, hisP: Vec3, hisFwd: Vec3): boolean {
  const u = norm(horiz(sub(hisP, myP)), myFwd);
  return dot(u, norm(horiz(myFwd), myFwd)) >= Math.cos(rad(H.frontDeg)) - 1e-12 && -dot(u, norm(horiz(hisFwd), hisFwd)) >= Math.cos(rad(H.squareDeg)) - 1e-12;
}

/** Plan 16 (p53, `HandHold`): a patch inside his man's frame, as a point in his man's body frame (x lateral, y up from his origin). */
export const inFrame = (H: HandHold, local: Vec3): boolean => Math.abs(local.x) <= H.frameM && local.y <= H.topM;

/** Plan 16 (p53, `HandHold`): what one hand's hold reads besides its last state: its push on his man (`id`; absent, none), folded, and the patch inside his frame. */
export interface HoldFacts {
  on: boolean;
  folded: boolean;
  push?: string;
  inFrame: boolean;
}

/** Plan 16 (p53, `HandHold`): what every hand of his reads: the rule, his side offense, his man square in front, his stood level. */
export interface HoldMan {
  rule: HandHold;
  offense: boolean;
  front: boolean;
  level: number;
}

/** Plan 16 (p53): why a hold ended (`nextHold`): its push ended or changed, he was stood up past the break, or he gave it up. */
export type HoldEnd = 'off' | 'stood' | 'givenUp';

/**
 * Plan 16 (p53, `HandHold`): one substep of a hand's hold (`HandState.hold`, `holdEnded`) from its last state `was`, its
 * facts `f` and his `M`, at `t`: kept while its conditions hold; ended at once when its push ends or changes or he is
 * stood up past the break; when the other conditions end, kept (`kept`: outside them) until `letGoS` after, then given up;
 * formed on a push whose hold has not ended, as its conditions hold and he is not stood past the break (`began`). `keeps`
 * (the fault, `BlockDebug.holdKeeps`): never given up.
 */
export function nextHold(was: Pick<HandState, 'hold' | 'holdEnded'> | undefined, f: HoldFacts, M: HoldMan, t: number, keeps = false): { hold?: HandHoldState; holdEnded?: string; began?: true; ended?: HoldEnd; kept?: true } {
  const legal = M.offense && f.on && !f.folded && f.inFrame && M.front;
  const h = was?.hold;
  const done = was?.holdEnded;
  if (h) {
    if (!f.on || f.push !== h.push) return { holdEnded: h.push, ended: 'off' };
    if (M.level >= M.rule.breakLevel) return { holdEnded: h.push, ended: 'stood' };
    if (legal) return { hold: { since: h.since, push: h.push } };
    const offT = h.offT ?? t;
    if (!keeps && t - offT >= M.rule.letGoS - 1e-9) return { holdEnded: h.push, ended: 'givenUp' };
    return { hold: { since: h.since, push: h.push, offT }, kept: true };
  }
  if (legal && f.push !== undefined && f.push !== done && M.level < M.rule.breakLevel) return { hold: { since: t, push: f.push }, ...(done !== undefined ? { holdEnded: done } : {}), began: true };
  return done !== undefined ? { holdEnded: done } : {};
}

/**
 * Plan 16 (p53, `HandSides`): his capacity's share by the inside, counted from his man's hands `his` (`L` the inside
 * leverage): a man on defense loses 1 / sqrt(L) per hold of his man's on him; a man on offense, per hand of his man's on
 * him inside (on, its lane the inside: a strike's hand locked out on his chest). Two 1 / L, one 1 / sqrt(L), none 1.
 */
export function sidedLeverage(side: BlockSide, his: Record<ArmSide, HandState> | undefined, L: number): number {
  const n = his ? SIDES.filter((s) => (side === 'defense' ? !!his[s].hold : his[s].on && his[s].lane === 'inside')).length : 0;
  return n === 2 ? 1 / L : n === 1 ? 1 / Math.sqrt(L) : 1;
}

/** Plan 16 (p52, `HandRePunch`): the load's point (world) in a level frame at the loading shoulder. */
export const rePunchLoad = (L: LevelFrame, RP: HandRePunch): Vec3 => add(addScaled(addScaled(L.sh, L.out, -RP.load.inM), L.fwd, RP.load.fwdM), v3(0, -RP.load.downM, 0));

/** Plan 16 (p52, `HandRePunch`): the load's way from `from` to the load point `to`: its pull, bowed out and back toward him (level frame at that shoulder). */
export const rePunchLoadPull = (L: LevelFrame, RP: HandRePunch, from: Vec3, to: Vec3): Vec3 => addScaled(addScaled(scale(add(from, to), 0.5), L.out, RP.load.outM), L.fwd, -RP.load.backM);

/**
 * Plan 16 (p52, `HandRePunch`): the point the punch passes under his man's forearm (elbow `elbowW` to wrist `wristW`):
 * `pass.alongF` of the way along it, `pass.downM` under it and `pass.inM` along `inW` (toward the two men's middle).
 */
export const rePunchPass = (RP: HandRePunch, elbowW: Vec3, wristW: Vec3, inW: Vec3): Vec3 => add(addScaled(addScaled(elbowW, sub(wristW, elbowW), RP.pass.alongF), inW, RP.pass.inM), v3(0, -RP.pass.downM, 0));

/**
 * Plan 16 (p52, `HandRePunch`): how clear the way `a` (start) through `m` (its middle) to `b` (end) keeps of the arm
 * segments `segs` (m): the least distance of 16 points along it, past its start, to any of them. The gap is open when this
 * is at least the re-punch's `clearM`.
 */
export function punchClearM(a: Vec3, m: Vec3, b: Vec3, segs: [Vec3, Vec3][]): number {
  const q = curveThrough(a, m, b);
  let least = Infinity;
  for (let i = 1; i <= 16; i++) {
    const p = curveAt(a, q, b, i / 16);
    for (const [s0, s1] of segs) {
      const ab = sub(s1, s0);
      const u = clamp(dot(sub(p, s0), ab) / Math.max(1e-12, dot(ab, ab)), 0, 1);
      least = Math.min(least, len(sub(p, addScaled(s0, ab, u))));
    }
  }
  return least;
}

/**
 * Plan 16 (p52, `BlockHandFight.rePunch`): the inside lane's leverage `L` (`BlockContest.inside.leverage`) counted per
 * hand: both of his hands outside, his capacity's share 1/L (the outside man's, as before); one, 1/sqrt(L); none, 1.
 */
export function lanesLeverage(H: Record<ArmSide, HandState>, L: number): number {
  const n = SIDES.filter((s) => H[s].lane === 'outside').length;
  return n === 2 ? 1 / L : n === 1 ? 1 / Math.sqrt(L) : 1;
}

/**
 * Plan 16 (p51, `HandBody`): what his hands ask of his body now: his turn (deg; + his right shoulder forward, his heading
 * turned to his left), his trunk's extra hinge (deg) and his lean to his right (deg; + his right side down), from his
 * hands' intents now and their states (a knock his state has that ended a push). Nothing without the body.
 */
export function handsBody(F: BlockHandFight, hands: Partial<Record<ArmSide, HandIntent>>, was: Partial<Record<ArmSide, HandState>> | undefined, t: number): { turnDeg: number; dipDeg: number; rollDeg: number } {
  const out = { turnDeg: 0, dipDeg: 0, rollDeg: 0 };
  const Bd = F.body;
  if (!Bd) return out;
  const A = F.swipe?.arc;
  const back = F.refit?.path?.s ?? 0;
  const W = Bd.swing;
  for (const side of SIDES) {
    const h = hands[side];
    const sg = side === 'right' ? 1 : -1;
    // the swing, the trunk ahead of the hand: back over the wind-up's first half, then through by the chop's middle (where
    // the hand meets his man's arm), held to the chop's end, then back to none
    if (A && h?.doing === 'swiping' && h.swipe) {
      const s = t - h.since;
      const tb = A.windS / 2;
      const e = s < tb ? 0 : easeMinJerk((s - tb) / (A.windS / 2 + A.chopS / 2));
      out.turnDeg += sg * (s < tb ? -W.backDeg * easeMinJerk(s / tb) : -W.backDeg + (W.backDeg + W.thruDeg) * e);
      out.dipDeg += W.dipDeg * e;
      out.rollDeg += sg * W.rollDeg * e;
    } else if (h?.swungT !== undefined && back > 0 && t - h.swungT < back) {
      const r = 1 - easeMinJerk((t - h.swungT) / back);
      out.turnDeg += sg * W.thruDeg * r;
      out.dipDeg += W.dipDeg * r;
      out.rollDeg += sg * W.rollDeg * r;
    }
    // (p52, the re-punch: the shoulder back and the trunk over as the hand loads, then through as it punches and up out
    // of the dip; back to none from when it landed)
    const RP = F.rePunch;
    const RB = RP?.body;
    if (RP && RB && h?.doing === 'repunching' && h.rePunch) {
      const w = h.rePunch;
      const e = easeMinJerk((t - w.stageT) / (w.stage === 'load' ? RP.loadS : RP.punchS));
      out.turnDeg += sg * (w.stage === 'load' ? -RB.backDeg * e : -RB.backDeg + (RB.backDeg + RB.thruDeg) * e);
      out.dipDeg += RB.dipDeg * (w.stage === 'load' ? e : 1);
    } else if (RB && h?.punchedT !== undefined && back > 0 && t - h.punchedT < back) {
      const r = 1 - easeMinJerk((t - h.punchedT) / back);
      out.turnDeg += sg * RB.thruDeg * r;
      out.dipDeg += RB.dipDeg * r;
    }
    // the knock: into the side it left, as the hand is carried, then back to none
    const k = was?.[side]?.knock;
    if (k?.ended && F.knock && t >= k.t) {
      const u = (t - k.t) / F.knock.s;
      const c = u < 1 ? 1 - (1 - u) ** 3 : back > 0 ? 1 - easeMinJerk((t - k.t - F.knock.s) / back) : 0;
      out.turnDeg += sg * Bd.knock.turnDeg * c;
      out.rollDeg += sg * Bd.knock.rollDeg * c;
    }
  }
  return out;
}

/** Plan 16 (p50): a block profile with the hand fight `H` (`handFight`), under an id that names it. */
export const withHandFight = (p: BlockProfile, H: BlockHandFight): BlockProfile => ({ ...p, id: `${p.id}+${H.id}`, handFight: H });

/**
 * Plan 16 (p50): what one hand is doing (`HandState.doing`): at home (on his man, or on its way to him as the block's own
 * hands go), striking with his punch, swiping at his man's arm (`HandSwipe`), knocked off him (`HandKnock`), or going
 * straight back on him after a knock (`HandRefit`).
 */
export type HandDoing = 'home' | 'striking' | 'swiping' | 'knocked' | 'refitting' | 'repunching';

/** Plan 16 (p50): where a hand is on his man (`HandState.where`): on his chest (the inside lane), on his shoulder (the outside). */
export type HandWhere = 'chest' | 'shoulder';

/**
 * Plan 16 (p50), one hand's state in the hand fight (`BlockState.hands`). His controller's part (`HandIntent`): what it is
 * doing and since when (s). The simulation's part, from what holds: `on`, a palm push of this hand on his man; `pushing`,
 * on and not folded past its collapse (kept on at no force); `where` it is on him (null: off him); its `lane` (absent:
 * not yet called).
 */
export interface HandState extends HandIntent {
  on: boolean;
  pushing: boolean;
  where: HandWhere | null;
  lane?: BlockLane;
  /** Plan 16 (p50): the last knock this hand took (`HandKnockFact`, the simulation's: a swipe met this arm); absent, none. */
  knock?: HandKnockFact;
  /** Plan 16 (p50): swiping, when its chop last met his man's arm (s, the simulation's); absent, never. */
  hit?: number;
  /** Plan 16 (p53, `HandHold`): this hand's hold on his man (the simulation's); absent, none. */
  hold?: HandHoldState;
  /** Plan 16 (p53, `HandHold`): the push whose hold last ended (it does not form again on that push); absent, none yet. */
  holdEnded?: string;
}

/** Plan 16 (p53, `HandHold`): a hold (`HandState.hold`): since when (s), on which palm push (its id), and when its conditions ended while it is kept (s; absent, they hold). */
export interface HandHoldState {
  since: number;
  push: string;
  offT?: number;
}

/**
 * Plan 16 (p50): a knock (`HandState.knock`): when (s), the chop's line off his forearm (unit, world), his palm where it
 * met him, by whom, whether it ended his palm push on him (`ended`: the support he leaned on lost; a hand not on him is
 * only driven aside); when the hand was first back on his man after it (`backT`; absent, not yet).
 */
export interface HandKnockFact {
  t: number;
  dirW: Vec3;
  palmW: Vec3;
  by: PlayerId;
  ended: boolean;
  backT?: number;
  /** Plan 16 (p52): a re-punch's wash (`HandRePunch`), which opens nothing to the man who washed it (`openedBy`); absent, a swipe's knock. */
  wash?: true;
  /** Plan 16 (p53, a hand fight with sides): the elbow pole a washed arm's pose had at the wash (owner-local), its carry's elbow turned from it; absent, from the inside lane's (p52's). */
  poleL?: Vec3;
}

/**
 * Plan 16 (p50): a hand's state as his controller has it (`PlayerIntent.block.hands`): what it is doing, since when (s);
 * how many of its swipes he has begun (`swipes`; absent none), the swipe it is in (`swipe`), the last knock it took
 * (`knockT`, its time).
 */
export interface HandIntent {
  doing: HandDoing;
  since: number;
  swipes?: number;
  swipe?: HandSwipeState;
  knockT?: number;
  /** Plan 16 (p51, `HandRefit.path`): re-fitting, where his palm was as the re-fit began (his level frame from that shoulder: x his left, y up, z forward; m). */
  fromL?: Vec3;
  /** Plan 16 (p51, `HandBody`): when his last swipe's chop ended (s), kept from then. */
  swungT?: number;
  /** Plan 16 (p52, `HandRePunch`): how many of its re-punches he has begun (absent none), the re-punch it is in, and when its last one ended (s; with `HandBody`), kept from then. */
  rePunches?: number;
  rePunch?: HandRePunchState;
  punchedT?: number;
}

/**
 * Plan 16 (p52): a re-punch under way (`HandIntent.rePunch`): its request (`n`, of this hand's), its stage (the load, the
 * punch) and since when (s), where his palm was as the stage began (his level frame from that shoulder, as
 * `HandIntent.fromL`); punching, whether the gap was open as it began (`inside`: the punch goes inside his man's arm).
 */
export interface HandRePunchState {
  n: number;
  stage: 'load' | 'punch';
  stageT: number;
  fromL?: Vec3;
  inside?: boolean;
}

/**
 * Plan 16 (p50): a swipe under way (`HandIntent.swipe`): its request (`n`, of this hand's), his man's arm it is for, its
 * stage (the raise over it, the chop through it) and since when (s); the chop's end point (world, fixed as it begins).
 */
export interface HandSwipeState {
  n: number;
  at: ArmSide;
  stage: 'raise' | 'chop';
  stageT: number;
  throughW?: Vec3;
  /** Plan 16 (p50): once the chop met his arm, his palm off that forearm's point as it met it (world): the chop rides his arm down from there. */
  rideW?: Vec3;
  /** Plan 16 (p51, `SwipeArc`): where his palm was as the swipe began (his level frame from that shoulder, as `HandIntent.fromL`). */
  fromL?: Vec3;
  /** Plan 16 (p51, `SwipeArc`): once the chop met his arm, that forearm's point as it met it (world): the arc goes on through it. */
  hitOnW?: Vec3;
}

/**
 * Plan 16 (p50): what a hand's next decision reads besides its last state (`nextHand`): the hand fight, the swipe due now
 * for it (its request's index and his man's arm; given only when he may begin it), and, swiping, how far his palm is from
 * the raise's point (m) and from the chop's end, and where the chop would end if it began now (world).
 */
export interface HandStep {
  fight: BlockHandFight;
  due?: { n: number; at: ArmSide };
  raiseLeftM?: number;
  chopLeftM?: number;
  throughW?: Vec3;
  /** the chop met his arm: his palm off that forearm's point now (world), to ride it from */
  rideW?: Vec3;
  /** Plan 16 (p51): his palm now in his level frame from that shoulder (as `HandIntent.fromL`); and swiping, the point on his man's forearm now (world). */
  palmL?: Vec3;
  onW?: Vec3;
  /** Plan 16 (p52): the re-punch due now for it (its request's index; given only when he may begin it), and, loading, whether the punch's gap is open now. */
  rePunchDue?: { n: number };
  gapOpen?: boolean;
}

/**
 * Plan 16 (p50): one decision of what a hand is doing (`HandIntent`) from what it did (`prev`, the last substep's state;
 * undefined: none yet) and his punch now: striking while his punch is in its strike, else home. `since` is when it began.
 */
export function nextHand(prev: HandState | HandIntent | undefined, pu: PunchState | undefined, t: number, H?: HandStep): HandIntent {
  const keep = { ...(prev?.swipes ? { swipes: prev.swipes } : {}), ...(prev?.knockT !== undefined ? { knockT: prev.knockT } : {}), ...(prev?.swungT !== undefined ? { swungT: prev.swungT } : {}), ...(prev?.rePunches ? { rePunches: prev.rePunches } : {}), ...(prev?.punchedT !== undefined ? { punchedT: prev.punchedT } : {}) };
  const F = H?.fight;
  const was = prev as HandState | undefined;
  // (p50: knocked, by a knock his state has that he has not taken yet, then for the knock's time)
  if (F?.knock && was?.knock && was.knock.t > (prev?.knockT ?? -Infinity)) return { doing: 'knocked', since: was.knock.t, ...keep, knockT: was.knock.t };
  if (F?.knock && prev?.doing === 'knocked' && t - prev.since < F.knock.s - 1e-9) return { doing: 'knocked', since: prev.since, ...keep };
  // (p50, `refit`: its knock over, straight back on; on him, or past the re-fit's time, at home; p51, `refit.path`: from
  // where the hand is as it begins)
  if (F?.refit && prev?.doing === 'knocked') return { doing: 'refitting', since: t, ...keep, ...(F.refit.path && H?.palmL ? { fromL: H.palmL } : {}) };
  if (F?.refit && prev?.doing === 'refitting' && !was?.on && t - prev.since < F.refit.s - 1e-9) return { doing: 'refitting', since: prev.since, ...keep, ...(prev.fromL ? { fromL: prev.fromL } : {}) };
  // (p52, `rePunch`: the load for its time, then the punch, inside if its gap is open as it begins; on him, at home; not on
  // him by the punch's and the landing's time, back on him from where it is)
  const RP = F?.rePunch;
  if (RP && prev?.doing === 'repunching' && prev.rePunch) {
    const w = prev.rePunch;
    if (w.stage === 'load') {
      if (t - w.stageT < RP.loadS - 1e-9) return { doing: 'repunching', since: prev.since, ...keep, rePunch: w };
      return { doing: 'repunching', since: prev.since, ...keep, rePunch: { n: w.n, stage: 'punch', stageT: t, inside: H?.gapOpen ?? false, ...(H?.palmL ? { fromL: H.palmL } : {}) } };
    }
    const done = F!.body ? { punchedT: t } : {};
    if (was?.on) return { doing: 'home', since: t, ...keep, ...done };
    if (t - w.stageT < RP.punchS + RP.landS - 1e-9) return { doing: 'repunching', since: prev.since, ...keep, rePunch: w };
    if (F!.refit) return { doing: 'refitting', since: t, ...keep, ...done, ...(F!.refit.path && H?.palmL ? { fromL: H.palmL } : {}) };
    return { doing: 'home', since: t, ...keep, ...done };
  }
  if (RP && H?.rePunchDue) return { doing: 'repunching', since: t, ...keep, rePunches: H.rePunchDue.n + 1, rePunch: { n: H.rePunchDue.n, stage: 'load', stageT: t, ...(H.palmL ? { fromL: H.palmL } : {}) } };
  // (p50: swiping, the raise over his arm then the chop through it; done, at home)
  const S = F?.swipe;
  if (S?.arc && prev?.doing === 'swiping' && prev.swipe) {
    // (p51, `arc`: the wind-up and the chop each for its time; the forearm's point held once the chop meets it; done,
    // back on him along the re-fit's path, or at home)
    const A = S.arc;
    const w = prev.swipe;
    if (w.stage === 'raise') return { doing: 'swiping', since: prev.since, ...keep, swipe: t - w.stageT >= A.windS - 1e-9 ? { n: w.n, at: w.at, stage: 'chop', stageT: t, ...(H?.throughW ? { throughW: H.throughW } : {}) } : w };
    const met = was?.hit !== undefined && was.hit >= prev.since;
    const sw = met && !w.hitOnW && H?.onW ? { ...w, hitOnW: H.onW } : w;
    if (t - w.stageT < A.chopS - 1e-9) return { doing: 'swiping', since: prev.since, ...keep, swipe: sw };
    // (p51, `body`: when it ended, for the body's way back)
    const swung = F!.body ? { swungT: t } : {};
    if (F!.refit?.path) return { doing: 'refitting', since: t, ...keep, ...swung, ...(H?.palmL ? { fromL: H.palmL } : {}) };
    const doing: HandDoing = pu?.phase === 'strike' ? 'striking' : 'home';
    return { doing, since: t, ...keep, ...swung };
  } else if (S && prev?.doing === 'swiping' && prev.swipe) {
    const w = prev.swipe;
    if (w.stage === 'raise') {
      if ((H!.raiseLeftM ?? Infinity) <= S.tolM || t - w.stageT >= S.raiseS - 1e-9) return { doing: 'swiping', since: prev.since, ...keep, swipe: { n: w.n, at: w.at, stage: 'chop', stageT: t, ...(H!.throughW ? { throughW: H!.throughW } : {}) } };
      return { doing: 'swiping', since: prev.since, ...keep, swipe: w };
    }
    const met = was?.hit !== undefined && was.hit >= prev.since;
    const ride = met && !w.rideW && H!.rideW ? { ...w, rideW: H!.rideW } : w;
    if (!((!met && (H!.chopLeftM ?? Infinity) <= S.tolM) || t - w.stageT >= S.chopS - 1e-9)) return { doing: 'swiping', since: prev.since, ...keep, swipe: ride };
  } else if (S && H?.due) return { doing: 'swiping', since: t, ...keep, swipes: H.due.n + 1, swipe: { n: H.due.n, at: H.due.at, stage: 'raise', stageT: t, ...(S.arc && H.palmL ? { fromL: H.palmL } : {}) } };
  const doing: HandDoing = pu?.phase === 'strike' ? 'striking' : 'home';
  return { doing, since: prev && prev.doing === doing ? prev.since : t, ...keep };
}

/**
 * Plan 16 (p50, `HandKnock.opens`): his man `his` has a hand knocked off him by `me`'s swipe (its push ended) and not yet
 * back on him: the opening `me` drives into.
 */
export function openedBy(me: PlayerId, his: Record<ArmSide, HandState> | undefined, F: BlockHandFight | undefined): boolean {
  return !!F?.knock?.opens && !!his && SIDES.some((s) => !his[s].on && his[s].knock?.by === me && his[s].knock!.ended && his[s].knock!.backT === undefined && !his[s].knock!.wash);
}

/**
 * Plan 16 (p50): his capacity's share his hands leave him in the contest (`BlockHandFight`; 1 without one): each knocked
 * hand's `knock.cut` off it, each hand knocked off him and not yet back on `offCut`.
 */
export function handsLeverage(H: Record<ArmSide, HandState> | undefined, F: BlockHandFight | undefined): number {
  // (a knock that ended no push costs nothing: no support was on it)
  if (!H || !F) return 1;
  let x = 1;
  for (const s of SIDES) {
    const h = H[s];
    // (p52, `rePunch`: a hand off him to re-punch costs what a hand knocked off him does)
    if (F.rePunch && h.doing === 'repunching' && !h.on && F.offCut !== undefined) {
      x *= 1 - F.offCut;
      continue;
    }
    if (!h.knock?.ended) continue;
    if (h.doing === 'knocked' && F.knock) x *= 1 - F.knock.cut;
    else if (h.knock.backT === undefined && !h.on && F.offCut !== undefined) x *= 1 - F.offCut;
  }
  return x;
}

/** Plan 16 (p50): what holds of one hand on his man this substep (`advanceHands`): its palm push on him, and that push folded past its collapse. */
export interface HandFacts {
  on: boolean;
  folded: boolean;
}

/**
 * Plan 16 (p50): one substep of a blocker's hands (`BlockState.hands`, a profile with `handFight`) from what they were
 * (`prev`; undefined: none yet), what his controller asks of each (`intents`; absent, as `nextHand` with no punch), what
 * holds of each (`facts`) and his lane (`lane`, the call's; absent: not yet). A hand's lane is his once called, and kept;
 * on, it is on his chest (inside, or a placement without lanes) or his shoulder (outside). `uncalled` (the fault,
 * `BlockDebug.handsLaneUncalled`): no hand is given his lane.
 */
export function advanceHands(prev: Record<ArmSide, HandState> | undefined, intents: Partial<Record<ArmSide, HandIntent>> | undefined, facts: Record<ArmSide, HandFacts>, lane: BlockLane | undefined, t: number, uncalled = false): Record<ArmSide, HandState> {
  const one = (side: ArmSide): HandState => {
    const was = prev?.[side];
    const i = intents?.[side] ?? nextHand(was, undefined, t);
    const L = was?.lane ?? (uncalled ? undefined : lane);
    const f = facts[side];
    return { ...i, on: f.on, pushing: f.on && !f.folded, where: f.on ? (L === 'outside' ? 'shoulder' : 'chest') : null, ...(L ? { lane: L } : {}), ...(was?.knock ? { knock: f.on && was.knock.backT === undefined && t > was.knock.t ? { ...was.knock, backT: t } : was.knock } : {}), ...(was?.hit !== undefined ? { hit: was.hit } : {}) };
  };
  return { left: one('left'), right: one('right') };
}

/**
 * Plan 16 (p47), the run-in: closing on his man (not yet engaged), loading and striking, he goes at `mps` toward him
 * whatever the gap: not braked to the approach's hold gap or the load's, not slowed to the load's
 * closing speed, not stepping back when closer than the strike's least reach. He runs through the hit; engaged with a palm
 * on, the block as ever. His load is the strike's for a man moving (`load.movingDepth`), so less pronounced, and his feet
 * are the free locomotion's (his run) until he is engaged. Why: the approach brakes at 2.5 m/s2 to the load's gap and,
 * loaded, closes at 0.6 m/s, so a man running in at 3 m/s met his man at 1.65 (a run-in experiment, the set man firing out
 * of his two-point): no momentum in the hit.
 */
export interface BlockRunIn {
  id: string;
  mps: number;
}

/**
 * Plan 16 (p46): the winner stays low (`BlockProfile.under`, on a contest that keeps the hit's outcome,
 * `BlockContest.beaten`). Once his hit is through (in his drive, the contest's `burst.s` into it; a block without a
 * strike, at once), the man whose man the hit beat more than him drives from under: his stance goes from the drive's to
 * `stance` by how far his man is beaten past him over `span` (0..1, from the snapshot: `beaten` of each), so his hips
 * sink low behind his hands and his trunk comes in while his man is up. The man the hit beat stays up: his stood-up
 * posture (the contest's stood stance, `BlockContest.stood`) at least `lift` times how far he is beaten, for as long as it
 * holds (his man's palms on him), not only while he is knocked. Posture only: the contest's capacities are as they are
 * (being lower counts there through the hips, `BlockContest.low`, so the man under drives the stood-up man on). Why: the
 * strike's rise (hips up into the strike's stance from the landing) and the drive's stance are both men's, so the winner
 * rose 7-8 cm with the loser and ended 4-5 cm under him at 0.3 s after contact, and level with him once the stood level
 * had released by 1 s (BL-F9-threePoint, BL-F10-twoPointVsThree). Why not during the hit: a stance that sinks while the
 * strike's rise still carries his hips up (0.7-0.8 m/s) unloads his suspension, and with it his drive's traction, for the
 * rest of the burst (the loser knocked back 0.04-0.07 m in 0.4 s in place of 0.12-0.17).
 */
export interface BlockUnder {
  id: string;
  stance: BlockStance;
  span: number;
  lift: number;
}

/** Plan 16 (p46): the winner's stance driving from under (`BlockUnder`), over the lean-in's planted feet: its thigh's slope below horizontal and its trunk (`withUnder`). */
export interface UnderSpec extends TrunkPose {
  id: string;
  thighDeg: number;
  span: number;
  lift: number;
}

/**
 * Plan 16 (p46): the first under stance. On the BL body over the lean-in's planted feet (the lean-in's ankle): the thigh
 * 48 deg below horizontal, hips 0.767 m over the ground (the set stance's 0.815, the load's 0.754), the rear foot on its
 * ball at 7.6 deg; the trunk at 28 deg (the set stance's 20), 8 of it lean. Full under once his man is beaten half way
 * past him; the beaten man held at 0.6 of the stood-up stance's rise per unit beaten (about 5-6 cm of hips).
 */
export const UNDER_V1: UnderSpec = { id: 'under-v1', thighDeg: 48, trunkDeg: 28, leanDeg: 8, span: 0.5, lift: 0.6 };

/**
 * Plan 16 (p43), his eyes on his man (`BlockProfile.gaze`): in his pre-snap stance and blocking, the head on his man's
 * head (`PostureIntent.gaze`), the neck extended at most as far as his pre-snap stance's head goes (`PreSnapPose.head`,
 * its `maxDeg`: the extension the stance shows) or `maxDeg` without one. Why: the stance's head up is a rule on the
 * trunk's own pitch, asked only until the snap; at the snap the head fell onto a trunk still pitched 90 deg (the face from
 * 40 deg below the horizon to 90 in one tick, BL-F9-threePoint) and came up only as the trunk did (on the turf for the
 * first 0.2 s, still 50-70 deg down at 0.25 s). Looking at a point bounds the same extension in the stance (the stance's
 * head is unchanged there) and keeps it through the fire-out, easing off only as the trunk rises.
 */
export interface BlockGaze {
  id: string;
  maxDeg: number;
}

/** Plan 16 (p43): the first gaze, the neck at most 50 deg extended without a stance's own (the three-point offense's). */
export const GAZE_V1: BlockGaze = { id: 'gaze-v1', maxDeg: 50 };

/** Plan 16 (p43): a block profile with his eyes on his man (`BlockGaze`), under an id that names it. */
export const withGaze = (p: BlockProfile, gaze: BlockGaze): BlockProfile => ({ ...p, id: `${p.id}+${gaze.id}`, gaze });

/** Plan 16 (p47): the first run-in (`BlockRunIn`): 3 m/s, a lineman climbing to a second-level block. */
export const RUN_IN_V1: BlockRunIn = { id: 'run-in-v1', mps: 3 };
/** Plan 16 (p47): a block profile that runs in (`BlockRunIn`), under an id that names it. */
export const withRunIn = (p: BlockProfile, R: BlockRunIn): BlockProfile => ({ ...p, id: `${p.id}+${R.id}`, runIn: R });

/** Plan 16 (p45): a block profile whose palms aim through their point on his chest along the arm's line (`aimThrough`), under an id that names it. */
export const withAimThrough = (p: BlockProfile): BlockProfile => ({ ...p, id: `${p.id}+aim-through`, aimThrough: true });
/**
 * Plan 16 (p45): a block profile that follows through (`followThrough`), its hit's punch parting the pair only while his
 * arms extend (`ContestHit.untilStraight`; a profile without a hit as it is), under ids that name it.
 */
/** Plan 16 (p48): a block profile whose arms against his man hold him there as his hands on (`frame`), under an id that names it. */
export const withFrame = (p: BlockProfile): BlockProfile => ({ ...p, id: `${p.id}+frame`, frame: true });
/**
 * Plan 16 (p49): how far the BL men's set stances toe their plants out (deg, per stance; `withToeOut`). The two-point set
 * at 20 brings his knees over his ankles (8.7 cm inside them straight); the defense three-point at 10 puts them 3 cm
 * outside. Deeper the plants do not hold: past 10 in the defense three-point and past 5 in the offense three-point (hips
 * 0.71 m) the planted feet slide off their anchors as he sinks into the stance (9-50 cm in BL-F9-threePoint at 10-20).
 * The offense three-point is not toed out: at 5 its knees came 2.5 cm out only (6 cm inside the ankles) and his hip,
 * already folded past its range at the snap, folded 5 deg further (36 deg past it, BL-F9-threePoint A at 3.3 s).
 */
export const TOE_OUT_DEG: Partial<Record<PreSnapKey, number>> = { 'two-point': 20, 'three-point-defense': 10 };
/**
 * Plan 16 (p49): a block profile whose pre-snap stances (`preSnap`) toe his plants out by `deg` (each stance's flat feet,
 * its own or the profile's, with `FlatStance.toeOutDeg`; a stance with neither as it is), under ids that name it. His
 * block's own stance (`flat`, after the snap) is not toed out.
 */
export function withToeOut(p: BlockProfile, deg: Partial<Record<PreSnapKey, number>>): BlockProfile {
  if (!p.preSnap) return p;
  const pre: NonNullable<BlockProfile['preSnap']> = {};
  for (const [k, S] of Object.entries(p.preSnap) as [PreSnapKey, PreSnapPose][]) {
    const F = S.flat ?? p.flat;
    const d = deg[k];
    pre[k] = F && d ? { ...S, flat: { ...F, id: `${F.id}+toe-out${d}`, toeOutDeg: d } } : S;
  }
  return { ...p, id: `${p.id}+toe-out`, preSnap: pre };
}
/** Plan 16 (p45): a block profile on the inside lane `L` (`lanes`), under an id that names it. */
export const withLanes = (p: BlockProfile, L: BlockLanes): BlockProfile => ({ ...p, id: `${p.id}+${L.id}`, lanes: L });
export const withFollowThrough = (p: BlockProfile): BlockProfile => ({
  ...p,
  id: `${p.id}+follow-through`,
  followThrough: true,
  ...(p.contest?.hit ? { contest: { ...p.contest, id: `${p.contest.id}+until-straight`, hit: { ...p.contest.hit, untilStraight: true } } } : {}),
});

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
  load: {
    minS: number;
    tolM: number;
    closeGapM: number;
    closeMps: number;
    hands: { forwardM: number; x: number; y: number };
    stance: BlockStance;
    movingMps: number;
    movingDepth: number;
    /**
     * Plan 16 (p43): the load point (`hands`, in his own frame) is placed for the loaded trunk he is asked (the load
     * stance's lean and hinge, `stance`; firing, the fire's `trunkDeg`); while his trunk is pitched deeper than that the
     * point keeps its place on his shoulders as in that trunk (his frame turned back up about his level lateral axis,
     * about the shoulder), not in at a chest that faces the turf, and the elbow goes to `pole` (owner-local direction from
     * the shoulder in that trunk, x outward, mirrored per arm; asked first, `ArmIntent.poleLocal`). Why: out of a
     * three-point (the trunk at 90-96 deg, rising at 300 deg/s) the point in his own frame lies between his belly and his
     * thighs, and the arms went there through the thighs (forearm and palm 8-11 cm in the thigh for the first 0.25 s,
     * BL-F9-threePoint); with the point on his shoulders but the elbow at the last pole the arm took (back along a trunk
     * facing the turf) the upper arm swept 4-10 cm through the thigh instead. Absent: in his own frame however deep, the
     * arm's own pole.
     */
    onShoulders?: { pole: Vec3 };
  };
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
    /**
     * Plan 16 (p48), with `engagedReachM`: loaded and within this (m) of the load's close gap (`load.closeGapM`, where his
     * closing stops: the approach brakes him onto it, never through it), he strikes from there once his man's chest is
     * within `engagedReachM`, as engaged. Why: two loaded men stopped at their close gaps, nothing yet between them, wait
     * for a `contactM` neither can reach (BL-F8-hardNoHinge under the full set with the lane called on the strike: both at
     * a 0.675 m gap, 0.61 m from his man's chest against 0.6, loaded for the whole 9 s, the lane never called). Absent: at
     * the close gap only `contactM`'s rule.
     */
    atLoadGapM?: number;
    /**
     * Plan 16 (p42): striking, his hips stay at the load's height until a palm lands (the trunk comes up to the strike's
     * as the hands go), and rise into the strike's from the landing: the hips roll up and forward at contact, not as the
     * hands leave. Absent: the strike's stance from the throw.
     */
    riseOnLand?: true;
    /** Plan 16 (p42): striking and in his drive, his hinge has the hips' own torque, up to this (`HingeLimits.hipNm`). */
    hipNm?: number;
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
/**
 * Plan 16 (p45): the inside lane, won and not assigned (`BlockProfile.lanes`, in place of the request's placement). Both
 * men's palms aim at the centre of his chest, inside on the chest plate with the elbows in (`inside`), until the lane is
 * called: as the first man's palm comes within `callM` of his man's chest, the man whose palms are then nearer his man's
 * chest has the inside (he gets there first: his timing, his reach), and his man's palms go outside (`outside`: the
 * shoulder fronts, the elbows out), his forearms outside and over the inside man's (`decideLane`). Called before the
 * palms land, the outside man's hands go outside in the last of their flight, not through the inside man's forearms. The
 * lane is each man's own, kept with his engaged state (`BlockState.lane`), and can change hands later (a re-punch, not
 * built). The aims are each arm's one task (the push's target and elbow pole); the arm's source pose and its final pass
 * are as they are.
 */
export interface BlockLanes {
  id: string;
  inside: HandAim;
  outside: HandAim;
  callM: number;
  /** Plan 16 (p46): what counts as level at the call (`decideLane`): palms within `reachM` of each other, hips within `hipM`. Absent: any difference decides. */
  tie?: LaneTie;
  /**
   * Plan 16 (p48): the lane is called only once a strike is thrown (`decideLane`'s `onStrike`): a man's palms count only
   * while his strike is thrown (his punch in its strike or its drive, as the last substep left it) or on his man, so the
   * call waits for the first thrown palm within `callM`, and the man who got there with a strike has the inside. A true
   * tie (both thrown, level by the tie's reach and height, both driving or both holding) goes to the man with the
   * greater effort, then, last, to the man whose id sorts first: a stated, fixed rule, the same in either player order.
   * Why: men set inside `callM` of each other (the older BL scenes, 1.1 m apart) had the lane called from their ready
   * hands at rest 0.08-0.19 s in, before either struck, by palms 1e-10 m and hips 1e-7 m apart (BL-F1-even,
   * BL-F7-hard). Absent: called from the palms wherever they are.
   */
  onStrike?: true;
}

/** Plan 16 (p46): the call's tie (`BlockLanes.tie`, `decideLane`), m. */
export interface LaneTie {
  reachM: number;
  hipM: number;
}

/** One man's palms against his man as the lane is called (`decideLane`): how far his nearer palm is short of his man's chest (m, along the line between them; 0 with a palm on him), his hips' height (m), and (p46) whether he is driving (his request's intent). */
export interface LaneTouch {
  awayM: number;
  hipM: number;
  drives?: boolean;
  /** Plan 16 (p48, `BlockLanes.onStrike`): his strike is thrown (his punch in its strike or drive) or a palm is on his man; his request's effort; his id. */
  thrown?: boolean;
  effort?: number;
  id?: PlayerId;
}

/**
 * Plan 16 (p45): the lane my palms win against his (`BlockLanes`), once either man's is within `callM` of his man's
 * chest (none before): the man whose palm is nearer his man's chest has the inside; level, the lower man; alike, none
 * yet. With a tie (p46, `tie`): nearer by more than `reachM`; else lower by more than `hipM`; else the man driving over
 * the man holding (he is throwing his hands, the other catching with his; a stated rule: level reach and height leave
 * nothing in the bodies to decide it, and a millimetre of either is the substep's noise, BL-F9-threePoint at 1 mm);
 * else, both driving or both holding, as without one.
 *
 * Called on the strike (p48, `onStrike`, `BlockLanes.onStrike`): a man whose strike is not thrown is as far as never
 * (`thrown`), so none until a thrown palm is within `callM`; then nearer (by more than the tie's `reachM`, any without
 * one), lower (by more than its `hipM`), the man driving over the man holding, the greater effort, and last the man whose
 * id sorts first. Never undefined once called: the last two are a true tie's stated rule, the same in either order.
 */
export function decideLane(mine: LaneTouch, his: LaneTouch, callM: number, tie?: LaneTie, onStrike?: boolean): BlockLane | undefined {
  if (onStrike) {
    const a = mine.thrown ? mine.awayM : Infinity;
    const b = his.thrown ? his.awayM : Infinity;
    if (Math.min(a, b) > callM) return undefined;
    const by = (m: boolean): BlockLane => (m ? 'inside' : 'outside');
    if (!(Math.abs(a - b) <= (tie?.reachM ?? 0))) return by(a < b);
    if (Math.abs(mine.hipM - his.hipM) > (tie?.hipM ?? 0)) return by(mine.hipM < his.hipM);
    if (!!mine.drives !== !!his.drives) return by(!!mine.drives);
    if ((mine.effort ?? 0) !== (his.effort ?? 0)) return by((mine.effort ?? 0) > (his.effort ?? 0));
    const [x, y] = [mine.id ?? '', his.id ?? ''];
    return x === y ? undefined : by(x < y);
  }
  if (Math.min(mine.awayM, his.awayM) > callM) return undefined;
  if (tie) {
    if (Math.abs(mine.awayM - his.awayM) > tie.reachM) return mine.awayM < his.awayM ? 'inside' : 'outside';
    if (Math.abs(mine.hipM - his.hipM) > tie.hipM) return mine.hipM < his.hipM ? 'inside' : 'outside';
    if (!!mine.drives !== !!his.drives) return mine.drives ? 'inside' : 'outside';
  }
  if (mine.awayM !== his.awayM) return mine.awayM < his.awayM ? 'inside' : 'outside';
  if (mine.hipM !== his.hipM) return mine.hipM < his.hipM ? 'inside' : 'outside';
  return undefined;
}

/**
 * Plan 16 (p45): the lanes the BL men use. Inside: palms low on the chest plate either side of his centre line (0.36 m
 * up, 7 cm out), the elbows down under the shoulders, the under hands' 0.64 m of arm. Outside: palms on the front of his
 * shoulders (0.56 m up, 15 cm out), the elbows out and a little up, over the inside man's forearms (0.58 m of arm). Called
 * as the first palm is 0.6 m short of his man's chest, before either lands (a later call leaves the outside man's
 * forearms through the inside man's as they go outside, BL-F10-twoPointVsThree).
 */
export const LANES_V1: BlockLanes = {
  id: 'lanes-v1',
  inside: { y: 0.36, x: 0.07, depthM: 0.08, pole: v3(0, -1, 0.1), lengthM: 0.64 },
  outside: { y: 0.56, x: 0.15, depthM: 0.08, pole: v3(1, 0.3, 0), lengthM: 0.58 },
  callM: 0.6,
};

/**
 * Plan 16 (p46): LANES_V1 with the outside palms on the tops of his shoulders (0.65 m up, 13 cm out: the top front of
 * the shoulder pads, beside his neck), over the inside man's upper arms. On the fronts of the shoulders (LANES_V1, 0.56
 * m) the inside man's arms, reaching out level to his man's chest from shoulders the same width, fill the space in
 * front of them: the outside palms sat 5-7 cm into the top of his upper arms and the forearms 5-7 cm through them
 * (BL-F10-twoPointVsThree, BL-F9-threePoint). The patch is then above the palm push's band (PALM_PUSH_V1 to 0.58 m): a
 * scene on these lanes raises it (`SHOULDER_TOPS_HIGH_M`).
 */
export const LANES_TOPS: BlockLanes = { ...LANES_V1, id: 'lanes-tops-v1', outside: { ...LANES_V1.outside, y: 0.65, x: 0.13 } };
/** Plan 16 (p46): the palm push's band top for LANES_TOPS (m above his origin): the outside patch lands 0.62-0.63 m up, under the torso box's top (0.69). */
export const SHOULDER_TOPS_HIGH_M = 0.66;
/**
 * Plan 16 (p54): LANES_V1 with the outside palms on the outside of the inside man's upper arms near his elbows (`onArm`,
 * 0.85 of the way from his shoulder, turned 30 deg up from straight out, the palm ball resting on the drawn arm 13.5 cm
 * from its line), the elbows out. On the tops of his shoulders (LANES_TOPS) they rest beside his neck under his facemask:
 * in profile a hand in the facemask (the palm 3 cm into to 6 cm clear of his helmet, facemask and neck, the median of a
 * scene), and a foul. His elbows cannot come in far enough to clear the front of his shoulders for them (his arms near
 * straight to his man's chest, the upper arm level, the elbow within 11 cm of where it is). The arm at 0.54 m, the palms
 * resting there at about no force: longer, they push down on his arms and pitch both heads down onto the hands (0.57 m)
 * and throw him forward past his feet (0.6 m).
 */
export const LANES_ARM: BlockLanes = { ...LANES_V1, id: 'lanes-arm-v1', outside: { ...LANES_V1.outside, depthM: 0.04, lengthM: 0.54, onArm: { t: 0.85, angDeg: 30, seatM: 0.135 } } };

/**
 * Plan 16 (p46): the call's tie (`BlockLanes.tie`): palms within 2 cm of each other (half a palm ball: neither is there
 * first), hips within 1 cm.
 */
export const LANE_TIE_V1: LaneTie = { reachM: 0.02, hipM: 0.01 };
export const withLaneTie = (L: BlockLanes, T: LaneTie): BlockLanes => ({ ...L, id: `${L.id}+tie`, tie: T });
/** Plan 16 (p48): lanes called only once a strike is thrown, with a true tie's stated rule (`BlockLanes.onStrike`), under an id that names it. */
export const withLaneOnStrike = (L: BlockLanes): BlockLanes => ({ ...L, id: `${L.id}+on-strike`, onStrike: true });

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

/** Plan 16 (p48): how near his load's close gap (m) a loaded man strikes from it within his engaged reach (`strike.atLoadGapM`): 2 cm, the approach's brake stopping him on it to 1 mm in BL-F8. */
export const STRIKE_AT_LOAD_GAP_M = 0.02;
/** Plan 16 (p48): a strike thrown from the load's close gap (`BlockStrike.strike.atLoadGapM`), under an id that names it. */
export const withStrikeAtLoadGap = (K: BlockStrike, m: number): BlockStrike => ({ ...K, id: `${K.id}+at-load-gap${m}`, strike: { ...K.strike, atLoadGapM: m } });

/**
 * Plan 16 (p41): BLOCK_STRIKE_V2 with the fire-out (`BlockFire`): out of a pre-snap stance he goes at 2 m/s, the hips
 * low, the trunk brought up to 45 deg at 300 deg/s (1500 deg/s2, the hips adding up to 400 N m beyond the balance's cap)
 * and on to the strike's as it is thrown. No registered fixture has it yet.
 */
export const BLOCK_STRIKE_V3: BlockStrike = { ...BLOCK_STRIKE_V2, id: 'strike-v3', fire: { mps: 2, trunkDeg: 45, pace: { rateDegPerS: 300, accelDegPerS2: 1500, hipNm: 400 } } };

/**
 * Plan 16 (p42): V3 thrown from 0.66 m of reach (the palms land on bent arms, about 65-80 deg at the elbow), the hips low
 * until a palm lands (`riseOnLand`), and striking and driving the hinge with the hips' own torque up to 400 N m (the
 * trunk kept inclined under his man's palms on his upper chest). For the contest's hit (CONTEST_V2).
 */
export const BLOCK_STRIKE_V4: BlockStrike = { ...BLOCK_STRIKE_V3, id: 'strike-v4', strike: { ...BLOCK_STRIKE_V3.strike, contactM: 0.66, riseOnLand: true, hipNm: 400 } };

/**
 * Plan 16 (p43): V4 with the load on his shoulders (`load.onShoulders`): out of a three-point the hands come off the turf
 * and up under his shoulders to the load as his trunk rises, not in between his chest and his thighs, the elbows out, down
 * and back in the loaded trunk (the arm's rest pole there), outside the thighs.
 */
export const BLOCK_STRIKE_V5: BlockStrike = { ...BLOCK_STRIKE_V4, id: 'strike-v5', load: { ...BLOCK_STRIKE_V4.load, onShoulders: { pole: v3(1, -0.6, -0.4) } } };

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
  /**
   * Plan 16 (p44): the two-point set before the snap on its own feet, a set stance as a three-point's (`ThreePointSpec`:
   * the feet placed for its own thigh slope, width and stagger, its trunk, hands, head and pace), in place of `twoPoint`
   * (a stance over the load's planted feet: the lean-in's narrow base and stagger). Absent: `twoPoint`.
   */
  twoPointSet?: ThreePointSpec;
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
export type LeanGeometry = StanceGeometry & { toeM: number; shoeM: number; /** The drawn thigh's and palm's radii and the arm's reach (m; p44, a hand's `kneeClearM`). */ thighRM?: number; palmRM?: number; reachM?: number };

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
  /** The two-point set on its own feet (p44; a stance with `twoPointSet`), with its hips' height over the ground (m). */
  twoPointSet?: PreSnapPose & { overGroundM: number };
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
    // (p44: a hand in front of the knee as it stands in the set, the thigh at its slope ahead of the hips)
    const kneeM = Lt.thighM * Math.cos(r(T.thighDeg));
    const hand = (H: PreSnapHand): PreSnapHand => (H.kneeClearM !== undefined && L0.thighRM !== undefined && L0.palmRM !== undefined && L0.reachM !== undefined ? { ...H, front: { aheadM: kneeM + L0.thighRM + L0.palmRM + H.kneeClearM, reachM: L0.reachM } } : H);
    const hands = Object.fromEntries(Object.entries(T.hands).map(([k, H]) => [k, hand(H!)])) as ThreePointSpec['hands'];
    return { leanDeg: T.leanDeg, hingeDeg: T.trunkDeg - T.leanDeg, dropM: 0, heightM, staggerM: T.staggerM, widthAddM: T.widthAddM, flat, lowM: heightM, hands, head: T.head, pace: T.pace, overGroundM };
  };
  const tp = S.threePoint;
  return {
    stance: stance('set'),
    load,
    strike: stance('strike'),
    stood: stance('stood'),
    ...(S.twoPoint ? { twoPoint: stance('twoPoint') } : {}),
    ...(tp ? { threePoint: { ...(tp.offense ? { offense: three(tp.offense) } : {}), ...(tp.defense ? { defense: three(tp.defense) } : {}) } } : {}),
    ...(S.twoPointSet ? { twoPointSet: three(S.twoPointSet) } : {}),
    flat: { id: S.id, marginDeg: 0, stepPastDeg: 0, ...S.flat, lowRootM: load.heightM, ball: { ...S.ball }, ...(S.ankleDeg !== undefined ? { dorsiDeg: S.ankleDeg } : {}) },
    aheadM,
    hips,
  };
}

/** A derived set stance as a pre-snap pose (its hips' height over the ground dropped). */
const strip = (t: PreSnapPose & { overGroundM: number }): PreSnapPose => {
  const { overGroundM: _o, ...rest } = t;
  return rest;
};

/** Plan 16 (p40): a lean-in's three-point stances as pre-snap poses (`BlockProfile.preSnap`). */
function threePointPoses(d: LeanInDerived): Partial<Record<PreSnapKey, PreSnapPose>> {
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
  const tp = [...Object.values(d.threePoint ?? {}), ...(d.twoPointSet ? [d.twoPointSet] : [])].map(({ overGroundM: _o, ...t }) => t);
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
    ...(d.twoPoint || d.threePoint || d.twoPointSet ? { preSnap: { ...p.preSnap, ...(d.twoPointSet ? { 'two-point': strip(d.twoPointSet) } : d.twoPoint ? { 'two-point': { ...d.twoPoint, ...w } } : {}), ...threePointPoses(d) } } : {}),
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
 * Plan 16 (p46): a block profile on its lean-in `S` (the one `withLeanIn` derived it on, leg `L`) whose winner stays low
 * (`BlockUnder`): the under stance `U` over the lean-in's planted feet (`standOver` at the stance's ankle, the root the
 * hips' height less the hip's over the origin at its trunk; the profile's width), its contest keeping the hit's outcome
 * (`withBeaten`), under ids that name both. A profile without a contest is returned as it is.
 */
export function withUnder(p: BlockProfile, U: UnderSpec, S: LeanInStance, L0: LeanGeometry): BlockProfile {
  if (!p.contest) return p;
  const r = (d: number) => (d * Math.PI) / 180;
  const L = S.ankleDeg === undefined ? L0 : { ...L0, dorsiDeg: S.ankleDeg };
  const o = standOver(L, leanInStances(S, L0).aheadM, r(U.thighDeg));
  const stance: BlockStance = { leanDeg: U.leanDeg, hingeDeg: U.trunkDeg - U.leanDeg, dropM: 0, heightM: o.overGroundM - L.hipUpM * Math.cos(r(U.trunkDeg)), staggerM: S.staggerM, ...(p.stance.widthAddM ? { widthAddM: p.stance.widthAddM } : {}) };
  return { ...p, id: `${p.id}+${U.id}`, under: { id: U.id, stance, span: U.span, lift: U.lift }, contest: withBeaten(p.contest), hinge: { ...p.hinge, maxDeg: Math.max(p.hinge.maxDeg, stance.hingeDeg) } };
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
 * Plan 16 (p44): LEAN_IN_V4 with each three-point's down hand reaching the turf in front of his knee (`PreSnapHand.kneeClearM`,
 * 2 cm beyond the thigh's and the palm's radius, the knee as it stands in the set): getting set from standing, his shoulder
 * over his hips, the hand reaching for the turf under the shoulder hung straight down through his thigh (10-14 cm in for
 * the first second). The stances themselves as V4: once his trunk is down the turf ahead of his shoulder is in front of
 * the knee.
 */
export const LEAN_IN_V5: LeanInStance = {
  ...LEAN_IN_V4,
  id: 'lean-in-v5',
  threePoint: Object.fromEntries(
    Object.entries(LEAN_IN_V4.threePoint!).map(([k, T]) => [k, { ...T!, hands: { ...T!.hands, right: { ...T!.hands.right!, kneeClearM: 0.02 } } }]),
  ) as LeanInStance['threePoint'],
};

/**
 * Plan 16 (p44): LEAN_IN_V5 with the two-point set on its own feet (`twoPointSet`), from the reference photos (worktree
 * `.scratch/refs/two-point/`): a wide base (each foot 12 cm out) with an 8 cm stagger, both feet flat ahead of the hips
 * (the flat rule, stepping only past 2 deg over the ankle's range), the thigh 40 deg below horizontal, so the hips sink
 * (0.74 m in BL-F10-twoPointVsThree, knees 80-85 deg, the ankles 19 cm ahead of the hips under a 43 deg trunk); the trunk
 * at 40 deg (6 of it lean), chest and head up; both hands ready in front of the knees at about the knees' height, a little
 * inside the shoulders (`kneeClearM`: in front of the knee as it stands in the set). Getting set at the three-point's
 * pace. V5's `twoPoint` (over the lean-in's planted feet: 37 cm apart, 24 cm stagger, trunk 28, hands at 0.93 m) is not
 * used; the three-point stances are V5's.
 */
export const LEAN_IN_V6: LeanInStance = {
  ...LEAN_IN_V5,
  id: 'lean-in-v6',
  twoPointSet: {
    thighDeg: 40,
    pitchDeg: 0,
    stepDeg: 2,
    staggerM: 0.08,
    widthAddM: 0.12,
    trunkDeg: 40,
    leanDeg: 6,
    hands: { right: { forwardM: 0.2, x: -0.1, upM: 0.55, kneeClearM: 0.02 }, left: { forwardM: 0.2, x: -0.1, upM: 0.55, kneeClearM: 0.02 } },
    head: { freeDeg: 30, maxDeg: 45 },
    pace: { rateDegPerS: 45, accelDegPerS2: 90 },
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
  /** Plan 16 (p45): his lane against his man (a profile with `lanes`), once won or lost (`decideLane`); absent, not yet. */
  lane?: BlockLane;
  /** Plan 16 (p50): each of his hands' own state (a profile with `handFight`, `HandState`); absent without one. */
  hands?: Record<ArmSide, HandState>;
  /** Plan 16 (p53, `HandHold`): how long his hands have kept holds outside a hold's conditions (s, summed over his hands; a hand fight with sides); absent without one. */
  holdingS?: number;
  /** Plan 16 (p53, `HandStrike`): when his last strike landed (a defense re-punch on his man, s); absent, none. */
  struckT?: number;
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
  /** Plan 16 (p50) fault, the hand fight: his hands are never given his lane (`HandState.lane`), so each aims inside whatever the call. */
  handsLaneUncalled?: boolean;
  /** Plan 16 (p50) fault, the swipe: its chop never meets his man's arm (`handContacts`), so no hand is knocked. */
  swipeMisses?: boolean;
  /** Plan 16 (p50) fault, the knock: a knocked hand costs him nothing in the contest (`handsLeverage`) and opens nothing to his man (`openedBy`). */
  knockFree?: boolean;
  /** Plan 16 (p52) fault, the re-punch: a punch inside washes nothing (`handContacts`): his man's hand stays and no lane changes. */
  rePunchNoWash?: boolean;
  /** Plan 16 (p53) faults, the hold: a hold is never given up (`nextHold`'s `keeps`), so it keeps a man leaving his frame for as long as its push lasts. */
  holdKeeps?: boolean;
  /** The holds control nothing in the contest (`sidedLeverage`): the leverage the lanes', as p52's. */
  holdNoControl?: boolean;
  /** Plan 16 (p53) fault, the strike: a defense re-punch's landing is no strike (his contest does not burst through it, no hit). */
  strikeFree?: boolean;
  /** Plan 16 (p53) fault, the re-load: a re-punch landed leaves how far he is beaten as it was. */
  reloadFree?: boolean;
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
  // (p48: or loaded at his load's close gap, `strike.atLoadGapM`)
  const atGap = K.strike.atLoadGapM !== undefined && c.gap <= K.load.closeGapM + K.strike.atLoadGapM;
  const inRange = c.reachM - closing * K.strike.leadS <= K.strike.contactM || (K.strike.engagedReachM !== undefined && (c.engaged || atGap) && c.reachM <= K.strike.engagedReachM);
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

/** Plan 16 (p43): the loaded trunk (deg from vertical) a punch asks: firing, the fire's; otherwise the load stance's lean and hinge. */
const loadTrunkDeg = (K: BlockStrike, pu: PunchState | undefined): number => (K.fire && pu?.fire ? K.fire.trunkDeg : K.load.stance.leanDeg + K.load.stance.hingeDeg);

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

  /**
   * Plan 16 (p50), the hand fight: what his hand `side` does now (`nextHand`) from its last state, his punch and what he
   * observes: the swipe due for it (`BlockRequest.swipes`, the next of this hand's once its time has come, given while he
   * is engaged with his punch through and the hand at home) and, swiping, his palm against the swipe's points.
   */
  private handNow(ctx: ControllerContext, side: ArmSide, prev: HandState | undefined, pu: PunchState | undefined, phase: BlockPhase, dir: Vec3, mine: Vec3, his: Vec3): HandIntent {
    const F = this.profile.handFight!;
    const R = this.spec.request;
    const S = F.swipe;
    const palm = ctx.observed.arms[ctx.self]?.[side]?.palmContactWorld;
    // (p51: his palm in his level frame, for a move that starts from where the hand is)
    const L = (F.refit?.path || S?.arc || F.rePunch) && palm ? this.levelAt(ctx, side) : null;
    const palmL = L && palm ? levelLocal(L, palm) : undefined;
    const free = phase === 'engaged' && (!this.profile.strike || pu?.phase === 'drive') && (prev?.doing ?? 'home') === 'home';
    // (p52, `rePunch`: the re-punch due for it, and loading, whether its punch's gap is open)
    const rp = F.rePunch ? this.rePunchStep(ctx, side, prev, free, dir, mine, his) : {};
    if (!S) return nextHand(prev, pu, ctx.t, { fight: F, ...(palmL ? { palmL } : {}), ...rp });
    const mineReq = (R.swipes ?? []).filter((w) => w.hand === side).sort((a, b) => a.atS - b.atS);
    const n = prev?.swipes ?? 0;
    const req = mineReq[n];
    const due = req && free && ctx.t + 1e-9 >= req.atS ? { n, at: req.at ?? (side === 'right' ? 'left' : 'right') } : undefined;
    const w = prev?.doing === 'swiping' ? prev.swipe : undefined;
    const pts = w ? this.swipePoints(ctx, w.at, dir, mine, his) : null;
    // (p51, `arc`: the chop's line, for the knock it gives, is toward the follow-through's end)
    const through = S.arc && L ? arcThrough(L, S.arc) : pts?.through;
    // (a swipe due first)
    const { rePunchDue, ...rpRest } = rp as Pick<HandStep, 'rePunchDue' | 'gapOpen'>;
    return nextHand(prev, pu, ctx.t, {
      fight: F,
      ...(due ? { due } : rePunchDue ? { rePunchDue } : {}),
      ...rpRest,
      ...(w && palm && pts && through ? { raiseLeftM: len(sub(pts.above, palm)), throughW: through, rideW: sub(palm, pts.on) } : {}),
      ...(w?.throughW && palm ? { chopLeftM: len(sub(w.throughW, palm)) } : {}),
      ...(palmL ? { palmL } : {}),
      ...(S.arc && pts ? { onW: pts.on } : {}),
    });
  }

  /**
   * Plan 16 (p52, `HandRePunch`): for his hand `side`, the re-punch due now (`BlockRequest.rePunches`, the next of this
   * hand's once its time has come, given while he may begin one: `free`), and while it loads, whether its punch's gap is
   * open: the punch's way from where the hand is to the inside aim through the point under his man's forearm keeps the
   * re-punch's `clearM` of that arm (`punchClearM`).
   */
  private rePunchStep(ctx: ControllerContext, side: ArmSide, prev: HandState | undefined, free: boolean, dir: Vec3, mine: Vec3, his: Vec3): Pick<HandStep, 'rePunchDue' | 'gapOpen'> {
    const RP = this.profile.handFight!.rePunch!;
    const reqs = (this.spec.request.rePunches ?? []).filter((w) => w.hand === side).sort((a, b) => a.atS - b.atS);
    const n = prev?.rePunches ?? 0;
    const req = reqs[n];
    const out: Pick<HandStep, 'rePunchDue' | 'gapOpen'> = {};
    if (req && free && ctx.t + 1e-9 >= req.atS) out.rePunchDue = { n };
    if (prev?.doing === 'repunching' && prev.rePunch?.stage === 'load') {
      const way = this.punchWay(ctx, side, true, dir, mine, his);
      const a = ctx.observed.arms[this.spec.request.target]?.[side === 'right' ? 'left' : 'right'];
      out.gapOpen = !!way && !!a && punchClearM(way.from, way.pass, way.to, [[a.shoulderWorld, a.elbowWorld]]) >= RP.clearM;
    }
    return out;
  }

  /**
   * Plan 16 (p52, `HandRePunch`): the punch's way for his hand `side` (world): from where the hand is, through the point
   * under his man's forearm on that side, onto the inside lane's aim (`inside`), or straight onto his own lane's aim. Null:
   * unobserved.
   */
  private punchWay(ctx: ControllerContext, side: ArmSide, inside: boolean, dir: Vec3, mine: Vec3, his: Vec3, from?: Vec3): { from: Vec3; pass: Vec3; to: Vec3 } | null {
    const RP = this.profile.handFight!.rePunch!;
    const a = ctx.observed.arms[this.spec.request.target]?.[side === 'right' ? 'left' : 'right'];
    const o = ctx.observed.arms[ctx.self]?.[side];
    const f = from ?? o?.palmContactWorld;
    const to = this.punchAims?.[side][inside ? 'inside' : 'own'];
    if (!a || !f || !to) return null;
    if (!inside) return { from: f, pass: scale(add(f, to), 0.5), to };
    const lat = v3(dir.z, 0, -dir.x);
    const mid = scale(add(mine, his), 0.5);
    const at = addScaled(a.elbowWorld, sub(a.wristWorld, a.elbowWorld), RP.pass.alongF);
    const inW = scale(lat, dot(sub(at, mid), lat) >= 0 ? -1 : 1);
    return { from: f, pass: rePunchPass(RP, a.elbowWorld, a.wristWorld, inW), to };
  }

  /**
   * Plan 16 (p52, `HandRePunch`): where the re-punching hand is asked to be now: loading, along the load's curve from where it
   * began to the load point by his ribs; punching, along the punch's curve from where it began (through the point under his
   * man's forearm when inside) onto its aim. Null: unobserved.
   */
  private rePunchTarget(ctx: ControllerContext, side: ArmSide, w: HandRePunchState, dir: Vec3, mine: Vec3, his: Vec3): Vec3 | null {
    const RP = this.profile.handFight!.rePunch!;
    const L = this.levelAt(ctx, side);
    if (!L) return null;
    const from = w.fromL ? levelWorld(L, w.fromL) : undefined;
    if (w.stage === 'load') {
      const W = rePunchLoad(L, RP);
      const F0 = from ?? W;
      return curveAt(F0, rePunchLoadPull(L, RP, F0, W), W, easeMinJerk((ctx.t - w.stageT) / RP.loadS));
    }
    const way = this.punchWay(ctx, side, !!w.inside, dir, mine, his, from ?? rePunchLoad(L, RP));
    if (!way) return null;
    return curveAt(way.from, curveThrough(way.from, way.pass, way.to), way.to, easeMinJerk((ctx.t - w.stageT) / RP.punchS));
  }

  /** Plan 16 (p52): this decision's aims on his man for each hand (world): the re-punch's (`inside`) and its own lane's, set by `decide`. */
  private punchAims: Record<ArmSide, { inside: Vec3; own: Vec3 }> | null = null;

  /**
   * Plan 16 (p51): his level frame at his shoulder `side` as observed: the shoulder, his body's heading and his left (both
   * horizontal), and which of those sideways is out on that side. Null: unobserved.
   */
  private levelAt(ctx: ControllerContext, side: ArmSide): LevelFrame | null {
    const me = ctx.observed.bodies[ctx.self];
    const o = ctx.observed.arms[ctx.self]?.[side];
    if (!me || !o) return null;
    const fwd = levelForwardOf(me.rotation);
    const left = v3(fwd.z, 0, -fwd.x);
    return { sh: o.shoulderWorld, fwd, left, out: dot(sub(o.shoulderWorld, me.position), left) >= 0 ? left : scale(left, -1) };
  }

  /**
   * Plan 16 (p51, `SwipeArc`): where the swiping hand is asked to be now: the wind-up's curve from where it began to its
   * load over his shoulder, or the chop's from there through his man's forearm point to the follow-through's end. Null:
   * unobserved.
   */
  private arcTarget(ctx: ControllerContext, side: ArmSide, A: SwipeArc, w: HandSwipeState, dir: Vec3, mine: Vec3, his: Vec3): Vec3 | null {
    const L = this.levelAt(ctx, side);
    if (!L) return null;
    const W = arcWind(L, A);
    if (w.stage === 'raise') {
      const P0 = w.fromL ? levelWorld(L, w.fromL) : W;
      return curveAt(P0, add(scale(add(P0, W), 0.5), v3(0, A.liftM, 0)), W, easeMinJerk((ctx.t - w.stageT) / A.windS));
    }
    const T = arcThrough(L, A);
    const C0 = w.hitOnW ?? this.swipePoints(ctx, w.at, dir, mine, his)?.on;
    const C = C0 ? addScaled(C0, norm(sub(W, C0), v3(0, 1, 0)), A.skimM) : null;
    return curveAt(W, C ? curveThrough(W, C, T) : scale(add(W, T), 0.5), T, easeMinJerk((ctx.t - w.stageT) / A.chopS));
  }

  /**
   * Plan 16 (p50, `HandSwipe`): the swipe's points on his man's arm `at` as observed: over its forearm's point and out
   * from between the two men (the raise), and under and out of it (the chop's end). Null: that arm unobserved.
   */
  private swipePoints(ctx: ControllerContext, at: ArmSide, dir: Vec3, mine: Vec3, his: Vec3): { on: Vec3; above: Vec3; through: Vec3 } | null {
    const S = this.profile.handFight!.swipe!;
    const a = ctx.observed.arms[this.spec.request.target]?.[at];
    if (!a) return null;
    const f = addScaled(a.elbowWorld, sub(a.wristWorld, a.elbowWorld), S.alongF);
    const lat = v3(dir.z, 0, -dir.x);
    const mid = scale(add(mine, his), 0.5);
    const off = dot(sub(f, mid), lat);
    const out = scale(lat, off >= 0 ? 1 : -1);
    return { on: f, above: add(addScaled(f, out, S.outM), v3(0, S.aboveM, 0)), through: add(addScaled(f, out, S.throughOutM), v3(0, -S.downM, 0)) };
  }

  /**
   * Plan 16 (p50): a hand's target while the hand fight has its arm: swiping, the raise's point over his man's arm, then the
   * chop's end; knocked, driven on from where the chop met it along the chop's line (`HandKnock.m`). Null: none observed.
   */
  private handTarget(ctx: ControllerContext, side: ArmSide, hi: HandIntent, prev: HandState | undefined, dir: Vec3, mine: Vec3, his: Vec3): Vec3 | null {
    const F = this.profile.handFight!;
    if (hi.doing === 'knocked') {
      const k = prev?.knock;
      if (!k || !F.knock) return null;
      const end = addScaled(addScaled(k.palmW, k.dirW, F.knock.m), dir, -(F.knock.offM ?? 0));
      // (p51, `carry`: on the way there, fastest as it is struck)
      if (!F.knock.carry) return end;
      const u = clamp((ctx.t - k.t) / F.knock.s, 0, 1);
      return add(k.palmW, scale(sub(end, k.palmW), 1 - (1 - u) ** 3));
    }
    const w = hi.swipe;
    if (!w) return null;
    if (F.swipe?.arc) return this.arcTarget(ctx, side, F.swipe.arc, w, dir, mine, his);
    // (met: on his forearm's point as it is driven, his palm where it met it, pressed on down the chop's line)
    if (w.stage === 'chop' && w.rideW) {
      const p = this.swipePoints(ctx, w.at, dir, mine, his);
      const k = (ctx.observed.block?.[this.spec.request.target]?.hands?.[w.at] as HandState | undefined)?.knock;
      return p ? addScaled(add(p.on, w.rideW), k?.dirW ?? norm(sub(p.through, p.on)), 0.03) : w.throughW ?? null;
    }
    if (w.stage === 'chop' && w.throughW) return w.throughW;
    return this.swipePoints(ctx, w.at, dir, mine, his)?.above ?? null;
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
      return pre && me ? this.preSnap(ctx, pre, me, him) : stand('block:waiting');
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
    // (p43, `load.onShoulders`: the load point and the elbow on his shoulders as in the loaded trunk he is asked,
    // `trunkDeg`, when his is deeper; the frame turned back up about his level lateral axis, about the shoulder)
    const loadArm = (side: ArmSide, Kl: BlockStrike['load'], trunkDeg: number): { targetWorld: Vec3; poleLocal?: Vec3 } => {
      const lp = handPoint(side, Kl.hands);
      const L = Kl.onShoulders;
      if (!L) return { targetWorld: lp };
      const up = qRot(me.rotation, v3(0, 1, 0));
      const F = levelForwardOf(me.rotation);
      const over = Math.max(0, Math.atan2(dot(up, F), up.y) - rad(trunkDeg));
      const back = qFromAxisAngle(norm(cross(v3(0, 1, 0), F)), -over);
      const sh = add(me.position, qRot(me.rotation, shoulderLocal(myBody, side)));
      const pole = qInvRot(me.rotation, qRot(back, qRot(me.rotation, v3(sideSignX(myBody, side) * L.pole.x, L.pole.y, L.pole.z))));
      return over > 0 ? { targetWorld: add(sh, qRot(back, sub(lp, sh))), poleLocal: pole } : { targetWorld: lp };
    };
    const hands = R.hands ?? P.hands.default;
    // (p45, `lanes`: the inside until he has lost it, from the snapshot)
    const lane = P.lanes ? ctx.observed.block?.[ctx.self]?.lane : undefined;
    const aim = P.lanes ? P.lanes[lane ?? 'inside'] : P.hands[hands];
    // (p50, `handFight`: each hand's own state from the snapshot, and its aim by its own lane)
    const HF = P.handFight;
    const wasHands = HF && ctx.observed.block?.[ctx.self]?.target === R.target ? ctx.observed.block[ctx.self].hands : undefined;
    // (p52, `rePunch`: a hand that won the inside by a re-punch kept on the re-punch's aim)
    const aimOf = (side: ArmSide): HandAim => (HF?.rePunch && wasHands?.[side]?.lane === 'inside' && wasHands[side].rePunches ? HF.rePunch.aim : HF && P.lanes ? P.lanes[wasHands?.[side]?.lane ?? 'inside'] : aim);
    // a palm's aim on him (world): my right hand on his left side (his frame), the side across from it, `depth` into his chest
    // (p45, `aimThrough`: the point on his chest, `depth` on beyond it along the line from my shoulder)
    const aimPointOf = (side: ArmSide, aim: HandAim, depth: number): Vec3 => {
      // (p54, `onArm`: the seat on his upper arm as observed, `depth` on beyond it along the line from my shoulder)
      const hs: ArmSide = side === 'right' ? 'left' : 'right';
      const ha = aim.onArm ? ctx.observed.arms[R.target]?.[hs] : undefined;
      if (aim.onArm && ha) {
        const seat = armSeatWorld(ha.shoulderWorld, ha.elbowWorld, him.rotation, sideSignX(hisBody, hs), aim.onArm);
        const sh = obs?.[side]?.shoulderWorld;
        return addScaled(seat.ball, sh ? norm(sub(seat.ball, sh), scale(seat.normal, -1)) : scale(seat.normal, -1), depth);
      }
      const hx = sideSignX(hisBody, side === 'right' ? 'left' : 'right') * aim.x;
      const front = frontOf(hisBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1));
      if (!P.aimThrough) return add(him.position, qRot(him.rotation, v3(hx, aim.y, front - depth)));
      const at = add(him.position, qRot(him.rotation, v3(hx, aim.y, front)));
      const sh = obs?.[side]?.shoulderWorld;
      const line = sh ? sub(at, sh) : v3();
      return addScaled(at, len(line) > 1e-6 ? norm(line) : qRot(him.rotation, v3(0, 0, -1)), depth);
    };
    const aimPoint = (side: ArmSide, depth: number): Vec3 => aimPointOf(side, aimOf(side), depth);
    // (p54, `onArm`: the push asked onto his arm on his side across from mine)
    const onArmOf = (side: ArmSide, aim: HandAim): Pick<PushRequest, 'onArm'> => (aim.onArm ? { onArm: { target: R.target, side: side === 'right' ? 'left' : 'right', ...aim.onArm } } : {});
    // (p52, `rePunch`: a punch's aim, the inside lane's or its own)
    const RPa = HF?.rePunch?.aim;
    const aims = (side: ArmSide) => ({ inside: aimPointOf(side, RPa!, RPa!.depthM), own: aimPointOf(side, aimOf(side), aimOf(side).depthM) });
    this.punchAims = RPa ? { left: aims('left'), right: aims('right') } : null;
    let pu: PunchState | undefined;
    // (p54: the strike's range to his body, an aim on his arm as its point on his body)
    const reachM = SIDES.reduce((m, side) => m + (obs?.[side] ? len(sub(aimPointOf(side, { ...aimOf(side), onArm: undefined }, 0), obs[side]!.shoulderWorld)) : Infinity), 0) / SIDES.length;
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
        loaded: SIDES.every((side) => !!obs?.[side] && len(sub(obs[side]!.palmContactWorld, loadArm(side, K.load, loadTrunkDeg(K, was?.target === R.target ? was.punch : undefined)).targetWorld)) <= K.load.tolM),
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
    // (p46, the contest's `armsGive`: his palms' effort, given as he is stood up)
    const pushEffort = P.contest?.armsGive ? effort * (1 - sl) : effort;
    let along: number;
    // (p48, `frame`: his arms against his man hold him there as his hands on)
    const framed = !!P.frame && SIDES.some((side) => obs?.[side]?.touchingTarget === R.target);
    if (phase === 'engaged' && (handOn || framed)) {
      const mine = horiz(me.position);
      if (!this.anchor || dot(sub(mine, this.anchor), dir) > 0) this.anchor = mine;
      const given = Math.max(0, dot(sub(this.anchor, mine), dir));
      const extra = R.intent === 'drive' ? P.driveMps : Math.min(P.hold.gainPerS * given, P.hold.maxMps - P.pressMps);
      along = effort * (P.pressMps + Math.max(0, extra));
      // (pushed past his base, his weight going back, he has no drive into his man)
      if (gl > 0) along *= 1 - gl;
      // (p45, `followThrough`: and his man's own speed away from him: he does not pull up as his man is knocked off)
      if (P.followThrough) along += Math.max(0, dot(hv, dir));
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
      // (p47, `runIn`: running in, at his own speed whatever the gap)
      if (P.runIn && phase !== 'engaged') along = P.runIn.mps;
    }
    const vel = add(scale(dir, along), across);
    // the hands: up while closing, punched on from the punch gap (or engaged), pulled back to re-arm when one came off
    const punch = phase === 'engaged' || gap <= P.punchGapM;
    // (p50, `handFight`: what each hand is doing, for his engaged state; a swipe or a knocked hand takes its arm)
    const handIntents = HF ? { left: this.handNow(ctx, 'left', wasHands?.left, pu, phase, dir, me.position, him.position), right: this.handNow(ctx, 'right', wasHands?.right, pu, phase, dir, me.position, him.position) } : undefined;
    const arms: Partial<Record<ArmSide, ArmIntent>> = {};
    for (const side of SIDES) {
      const out = sideSignX(myBody, side);
      const o = obs?.[side];
      const hi = handIntents?.[side];
      if (hi?.doing === 'repunching' && HF?.rePunch && hi.rePunch) {
        // (p52, the re-punch: loading, off him and drawn back low, the elbow tight; punching, a push along its way onto its
        // aim, the block's own hands counting its punch from the punch)
        const RP = HF.rePunch;
        const w = hi.rePunch;
        const T = this.rePunchTarget(ctx, side, w, dir, me.position, him.position) ?? o?.palmContactWorld ?? me.position;
        if (w.stage === 'load') {
          this.punchedAt[side] = null;
          this.wasOn[side] = false;
          arms[side] = { action: 'reach', targetWorld: T, poleLocal: v3(out * RP.load.pole.x, RP.load.pole.y, RP.load.pole.z), speedMps: RP.mps };
          continue;
        }
        if (this.punchedAt[side] === null) this.punchedAt[side] = ctx.t;
        this.wasOn[side] = !!o?.pushId;
        const aim = w.inside ? RP.aim : aimOf(side);
        const pole = aim.pole ? { poleLocal: v3(out * aim.pole.x, aim.pole.y, aim.pole.z) } : {};
        arms[side] = { action: 'push', targetWorld: T, push: { effort: pushEffort, lengthM: aim.lengthM ?? P.lengthM, extendMps: RP.extendMps, ...onArmOf(side, aim) }, ...pole, speedMps: RP.mps };
        continue;
      }
      if (hi?.doing === 'refitting' && HF?.refit) {
        // (straight back on at its aim; the block's own hands count its punch from the re-fit)
        if (this.punchedAt[side] === null) this.punchedAt[side] = ctx.t;
        this.wasOn[side] = !!o?.pushId;
        const aim = aimOf(side);
        const pole = aim.pole ? { poleLocal: v3(out * aim.pole.x, aim.pole.y, aim.pole.z) } : {};
        const aimW = aimPoint(side, aim.depthM);
        // (p51, `refit.path`: along an eased curve from where it began, bowed out to his side)
        const RP = HF.refit.path;
        const L = RP && hi.fromL ? this.levelAt(ctx, side) : null;
        const from = L && hi.fromL ? levelWorld(L, hi.fromL) : null;
        // (finishing along the line from his shoulder to the aim, as a punch lands; half the way back along it)
        const pull = RP && L && from ? addScaled(addScaled(aimW, norm(sub(aimW, L.sh), L.fwd), -0.5 * len(sub(aimW, from))), L.out, RP.bowM) : aimW;
        const targetWorld = RP && L && from ? curveAt(from, pull, aimW, easeMinJerk((ctx.t - hi.since) / RP.s)) : aimW;
        arms[side] = { action: 'push', targetWorld, push: { effort: pushEffort, lengthM: aim.lengthM ?? P.lengthM, extendMps: HF.refit.extendMps, ...onArmOf(side, aim) }, ...pole, ...(RP ? { speedMps: RP.mps } : {}) };
        continue;
      }
      if (hi && (hi.doing === 'swiping' || hi.doing === 'knocked')) {
        // (the block's own hands take it back from the ready point once it is done)
        this.punchedAt[side] = null;
        this.wasOn[side] = false;
        // (p51: the arc's and the carried knock's own pace; the arc's own twist rate)
        const mps = hi.doing === 'swiping' ? HF?.swipe?.arc?.mps : HF?.knock?.carry?.mps;
        const arc = hi.doing === 'swiping' ? HF?.swipe?.arc : undefined;
        // (p52: a washed hand's elbow turned from the inside lane's to its new lane's over the carry, so neither the wash nor
        // the re-fit onto that lane swings it round at once)
        const wk = hi.doing === 'knocked' ? wasHands?.[side]?.knock : undefined;
        const p0 = wk?.poleL ? v3(out * wk.poleL.x, wk.poleL.y, wk.poleL.z) : P.lanes?.inside.pole;
        const p1 = aimOf(side).pole;
        const wu = wk?.wash && HF?.knock ? easeMinJerk((ctx.t - wk.t) / HF.knock.s) : 0;
        const wp = wk?.wash && p0 && p1 ? add(scale(p0, 1 - wu), scale(p1, wu)) : undefined;
        arms[side] = { action: 'reach', targetWorld: this.handTarget(ctx, side, hi, wasHands?.[side], dir, me.position, him.position) ?? o?.palmContactWorld ?? me.position, ...(mps !== undefined ? { speedMps: mps } : {}), ...(arc ? { twistRadPs: arc.twistRadPs } : {}), ...(wp ? { poleLocal: v3(out * wp.x, wp.y, wp.z) } : {}) };
        continue;
      }
      // the strike's load and strike: both arms together (the drive is the block's own hands, below)
      if (K && pu?.phase !== 'drive') {
        if (pu?.phase !== 'strike') {
          // no punch yet: up at the ready point; loading: in at his chest, low
          this.punchedAt[side] = null;
          this.wasOn[side] = false;
          arms[side] = pu ? { action: 'reach', ...loadArm(side, K.load, loadTrunkDeg(K, pu)) } : { action: 'reach', targetWorld: handPoint(side, P.ready) };
          continue;
        }
        // striking: a palm in flight since the strike began (the drive's re-arm counts from it)
        if (o?.pushId || this.punchedAt[side] === null) this.punchedAt[side] = o?.pushId ? ctx.t : pu.since;
        this.wasOn[side] = !!o?.pushId;
        const aim = aimOf(side);
        const pole = aim.pole ? { poleLocal: v3(out * aim.pole.x, aim.pole.y, aim.pole.z) } : {};
        arms[side] = { action: 'push', targetWorld: aimPoint(side, aim.depthM), push: { effort: pushEffort, extendMps: Math.max(K.strike.extendMps, this.hitMps[side]), ...onArmOf(side, aim) }, ...pole };
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
      const aim = aimOf(side);
      const targetWorld = aimPoint(side, aim.depthM);
      const pole = aim.pole ? { poleLocal: v3(out * aim.pole.x, aim.pole.y, aim.pole.z) } : {};
      // (p53, `sides`: a hand with a hold on him, as his engaged state has it, may pull: at most the hold's tension at his
      // push's effort)
      const HH = HF?.sides?.hold;
      const held = HH && wasHands?.[side]?.hold ? { hold: { capN: HH.tensionN * pushEffort, slackM: HH.slackM } } : {};
      arms[side] = { action: 'push', targetWorld, push: { effort: pushEffort, lengthM: aim.lengthM ?? P.lengthM, ...held, ...onArmOf(side, aim) }, ...pole };
    }
    // (p42, `strike.riseOnLand`: striking, he stays in the load's stance until a palm lands; the rise is from the landing)
    const low = !!K?.strike.riseOnLand && pu?.phase === 'strike' && pu.onT === undefined;
    const S01 = K ? punchPose(P, pu) : P.stance;
    const SL = low ? punchPose(P, { ...pu!, phase: 'load' }) : S01;
    const S00 = low ? { ...S01, heightM: SL.heightM, dropM: SL.dropM } : S01;
    // (p41, the fire-out: loaded, the trunk at the fire's, low)
    const S0f = fire && pu?.phase === 'load' ? { ...S00, hingeDeg: Math.max(0, fire.trunkDeg - S00.leanDeg) } : S00;
    // (p46, `under`: once his hit is through, driving from under by how far it beat his man past him; the man it beat held
    // up by it)
    const U = P.under;
    const beat = (id: PlayerId): number => (U ? (ctx.observed.block?.[id]?.beaten ?? 0) : 0);
    const through = !K || (pu?.phase === 'drive' && ctx.t - pu.since + 1e-9 >= (P.contest?.burst.s ?? 0));
    const uw = U && through ? clamp((beat(R.target) - beat(ctx.self)) / U.span, 0, 1) : 0;
    const S0 = uw > 0 ? { ...S0f, leanDeg: S0f.leanDeg + (U!.stance.leanDeg - S0f.leanDeg) * uw, hingeDeg: S0f.hingeDeg + (U!.stance.hingeDeg - S0f.hingeDeg) * uw, dropM: S0f.dropM + (U!.stance.dropM - S0f.dropM) * uw, heightM: S0f.heightM + (U!.stance.heightM - S0f.heightM) * uw } : S0f;
    const slU = U ? Math.max(sl, U.lift * beat(ctx.self)) : sl;
    // (p36, giving ground: stood up by how far he is pushed past his base; p37, the contest: by how hard he is knocked back,
    // hips up and trunk up)
    const S1 = gl > 0 ? { ...S0, heightM: S0.heightM + gl * P.give!.riseM } : S0;
    const S = slU > 0 ? { ...S1, heightM: S1.heightM + slU * P.contest!.stood.riseM, hingeDeg: Math.max(0, S1.hingeDeg - slU * P.contest!.stood.trunkDeg) } : S1;
    // (p41, firing: his feet's frame level, as in the stance he comes out of)
    const stance = this.stanceRequest(fire && P.flat ? { ...S, flat: { ...P.flat, level: true } } : S);
    // (p43: his eyes on his man, the neck's range his pre-snap stance's)
    const gaze = this.gazeOn(ctx, R.stance ? P.preSnap?.[preSnapKey(R.stance)] : undefined, him);
    const hinged = HF?.knock && SIDES.some((side) => handIntents?.[side].doing === 'knocked' && wasHands?.[side]?.knock?.ended) ? S.hingeDeg + HF.knock.dropDeg : S.hingeDeg;
    // (p51, `body`: his trunk turned, hinged and leaned with his hands)
    const HB = HF?.body && handIntents ? handsBody(HF, handIntents, wasHands, ctx.t) : null;
    const leftOf = v3(dir.z, 0, -dir.x);
    const facing = HB ? add(scale(dir, Math.cos(rad(HB.turnDeg))), scale(leftOf, Math.sin(rad(HB.turnDeg)))) : dir;
    const leanV = HB ? add(scale(dir, rad(S.leanDeg)), scale(leftOf, -rad(HB.rollDeg))) : null;
    return {
      locomotion: { desiredVelocityWorld: vel, desiredFacingWorld: facing, effort, yawEffort: 1, stance },
      arms,
      posture: { leanDirWorld: leanV ? norm(leanV, dir) : dir, leanRad: leanV ? len(leanV) : rad(S.leanDeg), hinge: { rad: rad(HB ? hinged + HB.dipDeg : hinged), dropM: S.dropM }, ...(gaze ? { gaze } : {}) },
      block: { request: { ...R }, profile: P, ...(pu ? { punch: pu } : {}), ...(handIntents ? { hands: handIntents } : {}), ...(fire ? { hinge: { ...P.hinge, ...fire.pace } } : K?.strike.hipNm && pu && pu.phase !== 'load' ? { hinge: { ...P.hinge, hipNm: K.strike.hipNm } } : {}) },
      debug: { phase: `block:${phase}`, gap, along, hands, ...(K ? { punch: pu?.phase ?? null, reachM } : {}), ...(fire ? { fire: true } : {}), ...(P.lanes ? { lane: lane ?? null } : {}), ...(U ? { under: uw } : {}) },
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
  private preSnap(ctx: ControllerContext, S: PreSnapPose, me: ControllerContext['observed']['bodies'][string], him?: ControllerContext['observed']['bodies'][string]): PlayerIntent {
    const P = this.profile;
    // (p43: his eyes on his man, in place of the stance's head up)
    const gaze = this.gazeOn(ctx, S, him);
    const myBody = ctx.bodies[ctx.self];
    const lateral = norm(horiz(qRot(me.rotation, v3(1, 0, 0))), v3(1, 0, 0));
    const hand = (side: ArmSide): ArmIntent => {
      const H = S.hands?.[side];
      const out = sideSignX(myBody, side);
      if (!H) return { action: 'reach', targetWorld: add(me.position, qRot(me.rotation, v3(out * P.ready.x, P.ready.y, frontOf(myBody, { x: 0, y: 0, z: 0, w: 1 }, v3(0, 0, 1)) + P.ready.forwardM))) };
      const sh = add(me.position, qRot(me.rotation, shoulderLocal(myBody, side)));
      const at0 = add(add(sh, scale(this.lastFacing, H.forwardM)), scale(lateral, out * H.x));
      let at = v3(at0.x, H.upM, at0.z);
      // (p44: in front of his knee, and no lower than he reaches there)
      if (H.front) {
        const lead = dot(sub(at, me.position), this.lastFacing);
        if (lead < H.front.aheadM) at = addScaled(at, this.lastFacing, H.front.aheadM - lead);
        const h = len(horiz(sub(at, sh)));
        if (h < H.front.reachM) at = v3(at.x, Math.max(at.y, sh.y - Math.sqrt(H.front.reachM * H.front.reachM - h * h)), at.z);
      }
      return { action: 'reach', targetWorld: at, ...(H.pole ? { poleLocal: v3(out * H.pole.x, H.pole.y, H.pole.z) } : {}) };
    };
    return {
      locomotion: { desiredVelocityWorld: v3(), desiredFacingWorld: this.lastFacing, effort: 1, stance: this.stanceRequest(S) },
      arms: { left: hand('left'), right: hand('right') },
      posture: { leanDirWorld: this.lastFacing, leanRad: rad(S.leanDeg), hinge: { rad: rad(S.hingeDeg), dropM: S.dropM }, ...(gaze ? { gaze } : S.head ? { headUp: S.head } : {}) },
      block: { request: { ...this.spec.request }, profile: P, ...(S.pace ? { hinge: { ...P.hinge, ...S.pace } } : {}) },
      debug: { phase: 'block:set' },
    };
  }

  /**
   * Plan 16 (p43): his eyes on his man (a profile with `gaze`): on his man's head, the neck's range his pre-snap stance's
   * head (`S`, when he has one) or the gaze's own. Undefined without a gaze or a man.
   */
  private gazeOn(ctx: ControllerContext, S: PreSnapPose | undefined, him: ControllerContext['observed']['bodies'][string] | undefined): HeadGaze | undefined {
    const G = this.profile.gaze;
    if (!G || !him) return undefined;
    return { atWorld: add(him.position, qRot(him.rotation, ctx.bodies[this.spec.request.target].headCenter)), maxDeg: S?.head?.maxDeg ?? G.maxDeg };
  }

  exportParams(tickS: number): unknown {
    return { kind: 'block', request: this.spec.request, fromS: this.spec.fromS ?? 0, fromTick: Math.round((this.spec.fromS ?? 0) / tickS), profile: this.profile };
  }
}
