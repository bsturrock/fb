// Plan 16 (blocking), "Left" item 1: the base. Legs stay posed (owner's ruling): what a blocker's feet give him is read
// from his posed, planted feet, never from load-bearing legs.
//
// The support force acts at one point under the body (the pivot's ground point, support-runtime.ts); the balance torque
// on top of it is the same as moving that force's centre of pressure by cross(up, torque) / weight. A real foot can carry
// the centre of pressure only where it stands. So:
// - Where (the stance, the stepping model's home): an engaged blocker's foot wants to stand where it covers the centre of
//   pressure his balance asks for, with a margin. A push that needs the pressure behind him moves his rear foot's home
//   back (a step back to brace), one that needs it ahead moves his front foot's home forward; with the pressure inside
//   the feet the homes are the stance's.
// - How much (`resist`): what a man in a block can hold against a push is what his base gives, his weight times how far
//   his planted soles reach from the support's ground point (read from his posed planted feet). His balance torque about
//   the push line's level normal is held within weight x the reach behind him (a push toward him) and weight x the reach
//   ahead; about the line, within weight x the reach to either side. No moment from a foot in a step, none beyond weight
//   x reach; the torque is only limited, never set, and nothing is added.
import type { ArmSide, FlatStance } from './contracts';
import type { FootPlan } from './footwork';
import { clamp, cross, dot, qRot, scale, add, v3, UP, type Vec3 } from './vec';

/** A planted sole's corner within this of its lowest corner touches the ground (m). */
export const SOLE_TOUCH_M = 0.01;

const SIDES: ArmSide[] = ['left', 'right'];

/**
 * A block profile's base (`BlockProfile.base`; absent: none, the stance and the balance as before). `brace`: the feet's
 * homes cover the centre of pressure the balance asks for, the base reaching `marginM` (m) beyond it along the push line.
 */
export interface BlockBase {
  id: string;
  brace?: { marginM: number };
  /** The balance torque is held to what the base gives (`limitToBase`) in place of the balance profile's fixed ceiling. */
  resist?: true;
  /**
   * Plan 16 (p35, `BASE_V3`): what the base gives is read from the soles and his centre of mass (`copBounds`), not as a
   * reach from the support's ground point; a planted heel up no more than `loadHeelM` on a foot pitched no more than
   * `loadPitchDeg` bears weight (`soleContacts`). Absent: BASE_V2's reading.
   */
  soles?: { loadHeelM: number; loadPitchDeg: number };
}

/**
 * The first base (plan 16, p32): the base reaches 8 cm beyond the centre of pressure the balance asks for (some 70 N m
 * at the model body's 88 kg). The model body's heel is 9 cm behind the ankle and its toe 21 cm ahead, so a man holding his
 * 8 deg lean against a light push (the pressure ahead of his hips) keeps his stance; a push that needs the pressure
 * behind his rear heel brings that foot back once its home is a step (the model's 12 cm) away.
 */
export const BASE_V1: BlockBase = { id: 'base-v1', brace: { marginM: 0.08 } };

/**
 * The base that resists (plan 16, p32): BASE_V1's stance, and the balance held to what the planted feet give in place of
 * the fixed 240 N m (`resist`).
 */
export const BASE_V2: BlockBase = { ...BASE_V1, id: 'base-v2', resist: true };

/**
 * The base read from the soles (plan 16, p35): BASE_V2, its reading `copBounds` (the centre of pressure within the touching
 * soles, or under his centre of mass), and a planted heel within the viewer's limit for a foot on the ground (3 cm up,
 * the foot pitched 10 deg at most) bearing weight. Why the heel: the drawn ankle stops at 25 deg of dorsiflexion and its
 * heel lifts past that (heel lift, plan 12), about 0.5 cm a degree on the model's 30 cm shoe; a loaded ankle gives some
 * 5-10 deg more than its unloaded range, so a heel within 3 cm (about 6 deg past it) is one his weight would press down.
 */
export const BASE_V3: BlockBase = { ...BASE_V2, id: 'base-v3', soles: { loadHeelM: 0.03, loadPitchDeg: 10 } };

/**
 * The first flat stance (plan 16, p34; `FlatStance`): each foot ahead of its hip where the shin over a flat foot leans
 * 5 deg inside the ankle's range (20 of 25 deg); planted, it steps once the shin leans 4 deg past the range (the heel
 * about 2 cm up on the model's 30 cm shoe). The feet stay put until a step gains 16 cm (the stepping model's own: 12),
 * so a man moved steps a committed 15-25 cm, not a patter of short ones; his want leads the hips by half the capture
 * point's lead (a man in a block is held by his man, not running: the full lead makes every step long and early).
 */
export const FLAT_V1: FlatStance = { id: 'flat-v1', marginDeg: 5, stepPastDeg: 4, coverM: 0.16, captureK: 0.5 };

/** Plan 16 (p36): the first giving ground (no registered fixture has it yet). */
export const GIVE_V1: GiveGround = { id: 'give-v1', fullM: 0.15, attackS: 0.03, releaseS: 0.2, riseM: 0.08 };

/**
 * Plan 16 (p36), giving ground (`BlockProfile.give`): how far a man in a block is pushed past his base, and his posture
 * for it. While engaged on a base that resists, his balance may ask the centre of pressure behind what his base gives
 * (`limitToBase` holding that part); how far behind (`GiveState.excessM`: the asked moment past the base's back over his
 * weight) is followed by a level (0..1 of `fullM`), rising within `attackS` and falling within `releaseS`. The level is
 * his controller's (the snapshot's `block[id].give`): it stands him up (his stance's hips `riseM` higher at level 1) and
 * takes the drive out of his request (none at level 1). Posture and request only: the base, the balance and the drive's
 * bounds are unchanged, so it neither pushes nor holds him. Stepping back for it is not part of it.
 */
export interface GiveGround {
  id: string;
  /** The excess (m) at which the level is full. */
  fullM: number;
  /** The level's time constants rising and falling (s). */
  attackS: number;
  releaseS: number;
  /** His stance's hips raised by this (m) at level 1. */
  riseM: number;
}

/** A man's giving ground (`BlockState.give`, a profile with `give`): the asked pressure's excess behind his base (m) and its level (0..1). */
export interface GiveState {
  excessM: number;
  level: number;
}

/**
 * One substep of giving ground: `demandNm` the balance torque's part that needs the pressure behind his support (about
 * up x u, positive tipping him toward his man), `backNm` what his base gives there (`BaseMoments.back`; 0 with no base),
 * his weight `weightN`. The level follows clamp(excess / fullM, 0, 1) at its attack or release.
 */
export function advanceGive(st: GiveState, G: GiveGround, demandNm: number, backNm: number, weightN: number, dt: number): void {
  st.excessM = Math.max(0, demandNm - backNm) / weightN;
  const want = clamp(st.excessM / G.fullM, 0, 1);
  const tau = want > st.level ? G.attackS : G.releaseS;
  st.level += (want - st.level) * (1 - Math.exp(-dt / tau));
}

/**
 * Plan 16 (p37), the contest (`BlockProfile.contest`): who is moved in a block, how far and how fast, is decided by what
 * each man can push and hold with, not by a tipping moment about his feet. A man engaged in a block stands on the
 * supported model's ordinary balance (its fixed ceiling, the one every supported player has: no base clamp), so a hit
 * moves him rather than tips him; the along-line part of his ground force (the drive) is his contest force in place of
 * the velocity servo's, the servo keeping only what is across the line:
 * - his push (`contestForce`): his effort's force toward his man on a force-velocity line, all of it standing or moved
 *   back, none at the speed his request asks along the line (over at least `spanMps`), braking past it; never more than
 *   his drive's own bound (the motor's force at his effort, lean and traction), so it adds nothing the drive could not;
 * - his hold: while he is moved away from his man (and asks to go toward him), a damper on that speed, reaching his hold
 *   capacity at `holdMps` and `ecc.x` times it at `ecc.mps` (legs braking a motion are stronger than legs making one, as
 *   muscle lengthening is): what his planted stance resists with. It only opposes his motion, so it only ever takes energy.
 * Both are his capacity (`contestCapacity`): the push `pushN` times his effort (while he strikes, from the throw to
 * `burst.s` into the drive after it, up to `burst.pushN` times it but no more than his palms put on his man: he explodes
 * out of his stance through his hands, his legs behind them; braking, never more than `pushN`'s), the hold `holdN` times
 * (`holdFloor` + the rest times his effort); both times how low he is against his man (lower wins: 1 + `low.perM` x his man's
 * hips' height less his, within `low.min`..`low.max`), his feet (`contestFeet`: both planted within the flat limit `set`
 * all of it, one planted and one in a step `oneFoot`, a planted foot past the limit half a foot's), how far he is stood
 * up, and his `leverage` (1: none; p45, an outside man's less, `inside`).
 * His hold needs him anchored: a planted foot within the limit and his legs' lean within `anchorLeanDeg`.
 *
 * Stood up (`ContestState.level`, 0..1): followed from how hard he is knocked back (his centre of mass's acceleration
 * away from his man, `stood.knockMps2`: 0 at the first, 1 at the second), rising within `attackS` and falling within
 * `releaseS`. At level 1 his hold is cut by `holdCut` and his push by `pushCut`; his controller stands him up (hips `riseM`
 * higher, trunk `trunkDeg` more upright). A hit that outdoes what he holds knocks him back, stands him up and so moves him
 * further; once it is through, he slows, the level falls, and he re-anchors. A steady drive accelerates nobody, so it
 * stands nobody up.
 *
 * He goes down (`ContestState.down`, read by the balance's loss) when: his centre of mass is more than `fall.behindM`
 * behind his feet along the line for `fall.outrunS` (his steps cannot keep them under him); stood up past
 * `fall.overLevel` and moved away faster than `fall.overMps`, his man's push more than `fall.overMargin` past what he
 * pushes and holds with, for `fall.overS` (overpowered); or his legs' lean past `anchorLeanDeg` for `fall.leanS` (no
 * rigid lean beyond the envelope he is anchored in).
 */
export interface BlockContest {
  id: string;
  pushN: number;
  /** (p42: `mps`, bursting with his palms' force on his man, his push's force-velocity line runs to at least this speed times his effort, m/s; absent, his request's.) */
  burst: { pushN: number; s: number; mps?: number };
  holdN: number;
  holdFloor: number;
  spanMps: number;
  holdMps: number;
  ecc: { x: number; mps: number };
  low: { perM: number; min: number; max: number };
  set: { heelM: number; pitchDeg: number };
  oneFoot: number;
  anchorLeanDeg: number;
  stood: { knockMps2: [number, number]; attackS: number; releaseS: number; holdCut: number; pushCut: number; riseM: number; trunkDeg: number };
  fall: { behindM: number; outrunS: number; overLevel: number; overMps: number; overMargin: number; overS: number; leanS: number };
  /** Plan 16 (p42), the hit (`ContestHit`); absent, none: the pair's closing is the bodies' and the palm struts'. */
  hit?: ContestHit;
  /**
   * Plan 16 (p45): the inside lane's leverage (`BlockProfile.lanes`, `BlockState.lane`): the outside man's capacity, push
   * and hold, over `leverage` (his `ContestState.leverage`, 1 / it), after his drive's bound; the inside man's, and both
   * before a lane is called, as they are. His hands on top of his man's shoulders push down on them as much as back,
   * his man's under his chest lift it: of what the outside man's legs give, part is lost. So the inside wins the hit and
   * the drive after it between men of the same effort, the man lower (`low`) the drive's too. Why after the bound: the
   * burst runs at both men's drive bound, which a factor before it does not reach (BL-F9-threePoint,
   * BL-F10-twoPointVsThree). Absent: none.
   */
  inside?: { leverage: number };
  /**
   * Plan 16 (p46): the hit's outcome kept (`ContestState.beaten`): how far he is stood up past his man (his level less
   * his man's), its peak held while his man's palms are on him, released as the stood level releases once they are off.
   * What it is for: the stood level follows the knock (it releases 0.3 s after he stops being knocked back), while the
   * man the hit beat stays beaten as long as his man's hands are on him (they are under his chest; the re-punch that
   * would win them back is not built). The block's posture reads it (`BlockProfile.under`); his capacity does not.
   * Absent: none.
   */
  beaten?: true;
  /**
   * Plan 16 (p46): his arms give as he is stood up: his palms push with his effort times one less his stood level
   * (`withArmsGive`). Knocked back, the man the hit beat kept pushing his man off with his palms at his full effort: the
   * winner, slowed by the hit, was pushed out of his own reach while the loser's palms stayed on (BL-F9-threePoint, A's
   * palms off 0.22-0.35 s; BL-F10-twoPointVsThree with folded pushes kept on). A man not stood up pushes as before.
   * Absent: his effort.
   */
  armsGive?: true;
  /**
   * Plan 16 (p46): his burst tapers once the hit has stood his man up: in his drive, with his man beaten past him by at
   * least this (his man's `beaten`), what his burst has over his push (`burst`) runs down to nothing over the drive's
   * `burst.s` (`contestCapacity`'s `burstShare`). Why: the burst ran full to the end of its window and, once the man it
   * had beaten could no longer push him out of his reach (`armsGive`), knocked him back a second time 0.25-0.35 s after
   * the contact (the winner's push 544 N against 150 he pushed and held with): the stood level back up from 0.55 to
   * 0.85, the overpowered clock run to 0.29-0.30 s of its 0.3 (BL-F9-threePoint in reversed order down at 0.48 s after
   * the contact), the loser run back 1 m in 12 steps and anchored only at 1.8-2 s. An even hit (neither beaten) bursts
   * as before. Absent: the burst full through its window.
   */
  burstTaper?: number;
  /**
   * Plan 16 (p46): how low each man is (`low`) read without the hit's held lift: the beaten man's hips less what his
   * posture holds them up by past his stood level (`BlockUnder.lift` times his `beaten`, less his level, times
   * `stood.riseM`). Why: the posture holds the man the hit beat up for as long as his man's hands are on him
   * (`BlockProfile.under`), and the contest read those hips as his being high: once his stood level had settled he still
   * pushed and held with 0.8 of what he had against the winner's 1.2 (hips 10 cm apart), and was run back on after the
   * burst, anchored only 1.45-1.55 s after the contact (BL-F9-threePoint, BL-F10-twoPointVsThree, the burst tapering).
   * What being stood up costs him is the stood level's, which cuts his push and hold and releases; the held lift shows
   * it. The winner's own sink under him counts. Absent: the hips as posed.
   */
  lowUnheld?: true;
}

/**
 * Plan 16 (p42), the hit (`BlockContest.hit`): the first collision's closing taken by the hands, not by the bodies meeting.
 * While a strike is on between two men engaged with each other (either man's punch striking, or into its drive by less
 * than `burst.s`) and a palm push is on between them, a force pair along the line between their centres of mass: the
 * pair's reduced mass times their closing speed over `tauS`, at most `maxN`, only while they close. The closing counts the
 * punch: a man striking with his palms on his man drives the pair apart at up to `punchMps` times his effort, so the hit
 * runs on until they part at that speed (the arms' extension). Who takes it is the contest's: the man with the larger
 * push capacity holds his part with his legs (his capacity over his man's, less 1, over `winX`, at most all of it: that
 * part is not put on him), and the other takes the hit; an even meeting (equal capacities) shares it and both stop.
 * While his palms are on his man, his burst is not limited by his palms' force (the hit carries what they put on him).
 */
export interface ContestHit {
  tauS: number;
  maxN: number;
  /** The winner's part of the hit his legs hold: his push capacity over his man's, less 1, over this (at most all). */
  winX: number;
  /** The punch: a man striking with his palms on his man drives the pair apart at up to this times his effort (m/s; absent, 0). */
  punchMps?: number;
  /**
   * Plan 16 (p45): the punch drives the pair apart only while his arms extend: its parting speed times the share of their
   * extension his arms still have (from the length each palm landed at to the arm's reach, the least of his palms on his
   * man), nothing once they are straight. Why: at `punchMps` times his effort to the end, a punch landed at 0.65 m of arm
   * (born on the first touch, BlockProfile.aimThrough) parts the pair on past the arms' reach, the chests 0.55-0.6 m
   * apart, and the winner's palms come off out of reach 0.17-0.26 s after the contact (`unreachable`), back on 0.2-0.3 s
   * later (BL-F9-threePoint, BL-F10-twoPointVsThree). Absent: to the end.
   */
  untilStraight?: true;
}

/**
 * The hit's force pair (`ContestHit`) between men a and b, along the line from a to b: `F` the hit, `onA` its force on a
 * (at most 0) and `onB` on b (at least 0), less the part the winner's legs hold. `closingMps` the pair's closing speed,
 * `punchMps` the punch's parting speed (the larger of the two men's), `pushA`/`pushB` their push capacities now (`pushB`
 * absent: b has no contest, and neither holds a part). Not closing: none.
 */
export function hitPair(H: ContestHit, massKg: number, closingMps: number, punchMps: number, pushA: number, pushB?: number): { F: number; onA: number; onB: number } {
  const c = closingMps + punchMps;
  if (c <= 0) return { F: 0, onA: 0, onB: 0 };
  const F = Math.min(H.maxN, (massKg * c) / H.tauS);
  const win = (x: number, y: number): number => (x > y && y > 0 ? clamp((x / y - 1) / H.winX, 0, 1) : x > y ? 1 : 0);
  const wa = pushB === undefined ? 0 : win(pushA, pushB);
  const wb = pushB === undefined ? 0 : win(pushB, pushA);
  return { F, onA: -F * (1 - wa), onB: F * (1 - wb) };
}

/** Why the contest took a man down (`ContestState.down`). */
export type ContestDown = 'outrun' | 'overpowered' | 'pastAnchor';

/**
 * A man's contest (`BlockState.contest`, a profile with `contest`), kept by the motor step while he is engaged: how far he
 * is stood up, whether he is anchored, this substep's capacity and force along the line (N, + toward his man) and its
 * parts, his speed along it last substep (m/s), the fall clauses' clocks (s; null: not holding) and, once one trips, why.
 */
export interface ContestState {
  level: number;
  anchored: boolean;
  /** Inside hands and leverage (plan 16 item 3): a factor on his capacity, 1 until something sets it. */
  leverage: number;
  pushN: number;
  holdN: number;
  forceN: number;
  pushF: number;
  holdF: number;
  vPrev: number | null;
  outrunT: number | null;
  overT: number | null;
  leanT: number | null;
  down?: ContestDown;
  /** Plan 16 (p42, a contest with `hit`): the hit's force on him last substep (N, along the line; absent or 0: none). */
  hitN?: number;
  /** Plan 16 (p46, a contest with `beaten`): how far the hit has him beaten (0..1; absent: not yet kept). */
  beaten?: number;
}

/** A fresh contest state. */
export const newContest = (): ContestState => ({ level: 0, anchored: false, leverage: 1, pushN: 0, holdN: 0, forceN: 0, pushF: 0, holdF: 0, vPrev: null, outrunT: null, overT: null, leanT: null });

/** Plan 16 (p45): a contest with the inside lane's leverage `x` (`BlockContest.inside`), under an id that names it. */
export const withInsideLeverage = (C: BlockContest, x: number): BlockContest => ({ ...C, id: `${C.id}+inside-x${x}`, inside: { leverage: x } });

/** Plan 16 (p46): a contest that keeps the hit's outcome (`BlockContest.beaten`), under an id that names it. */
export const withBeaten = (C: BlockContest): BlockContest => ({ ...C, id: `${C.id}+beaten`, beaten: true });
export const withArmsGive = (C: BlockContest): BlockContest => ({ ...C, id: `${C.id}+arms-give`, armsGive: true });
export const withBurstTaper = (C: BlockContest, beaten: number): BlockContest => ({ ...C, id: `${C.id}+burst-taper${beaten}`, burstTaper: beaten });
export const withLowUnheld = (C: BlockContest): BlockContest => ({ ...C, id: `${C.id}+low-unheld`, lowUnheld: true });

/**
 * Plan 16 (p46, `BlockContest.beaten`): one substep of how far the hit has him beaten, from what it was (`b0`; undefined:
 * none yet), his stood level and his man's, and whether his man's palms are on him: his level past his man's, its peak
 * held while those palms are on him, released at `releaseS` toward it once they are off.
 */
export function nextBeaten(b0: number | undefined, level: number, hisLevel: number, held: boolean, dt: number, releaseS: number): number {
  const past = Math.max(0, level - hisLevel);
  const b = b0 ?? 0;
  return held ? Math.max(b, past) : Math.max(past, b * Math.exp(-dt / releaseS));
}

/**
 * Plan 16 (p45): the inside lane's leverage the BL men use (`BlockContest.inside`): the outside man keeps two thirds of
 * what his legs give: in BL-F10-twoPointVsThree the inside man of the same effort knocks him back 0.56 m in the first
 * second and drives him 0.13 m in the next three; at 2, 0.97 m and 0.6 m more.
 */
export const INSIDE_LEVERAGE = 1.5;

/** Plan 16 (p46): how far his man is beaten past him when the BL men's burst starts to taper (`BlockContest.burstTaper`): half stood up past him. */
export const BURST_TAPER_BEATEN = 0.5;

/** Plan 16 (p37): the first contest (no registered fixture has it yet). */
export const CONTEST_V1: BlockContest = {
  id: 'contest-v1',
  pushN: 300,
  burst: { pushN: 1000, s: 0.25 },
  holdN: 250,
  holdFloor: 0.3,
  spanMps: 0.2,
  holdMps: 0.05,
  ecc: { x: 2.5, mps: 0.3 },
  low: { perM: 2, min: 0.8, max: 1.25 },
  set: { heelM: 0.03, pitchDeg: 10 },
  oneFoot: 0.7,
  anchorLeanDeg: 20,
  stood: { knockMps2: [0.5, 2.5], attackS: 0.03, releaseS: 0.3, holdCut: 0.9, pushCut: 0.8, riseM: 0.08, trunkDeg: 10 },
  fall: { behindM: 0.25, outrunS: 0.3, overLevel: 0.3, overMps: 0.5, overMargin: 1, overS: 0.3, leanS: 0.1 },
};

/**
 * Plan 16 (p42): CONTEST_V1 with the hit (`ContestHit`: the pair's closing taken over 0.02 s, at most 3000 N, the winner
 * holding all his part at twice his man's push capacity, the punch parting them at 1 m/s times effort) and the burst
 * running on to 2 m/s times effort.
 */
export const CONTEST_V2: BlockContest = { ...CONTEST_V1, id: 'contest-v2', burst: { ...CONTEST_V1.burst, mps: 2 }, hit: { tauS: 0.02, maxN: 3000, winX: 1, punchMps: 1 } };

/**
 * How much of his feet a man in a block stands on (0..1, `BlockContest`): each foot planted with its heel within
 * `set.heelM` of the ground and its sole pitched no more than `set.pitchDeg` counts 1, planted past that a half, in a step
 * nothing; the better foot carries `oneFoot` of it, the other the rest (a man stepping drives off his stance foot).
 * `setFeet`: how many planted feet are within the limit. The heel as `soleContacts` reads it (its middle above the
 * sole's lowest corner).
 */
export function contestFeet(plan: FootPlan, K: BlockContest): { share: number; setFeet: number } {
  const { he, centerFoot } = plan.shoe;
  const w: Record<ArmSide, number> = { left: 0, right: 0 };
  let setFeet = 0;
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode !== 'planted') continue;
    const cs: Vec3[] = [];
    for (const x of [-he.x, he.x]) for (const z of [centerFoot.z - he.z, centerFoot.z + he.z]) cs.push(add(f.ankleW, qRot(f.footQ, v3(x, centerFoot.y - he.y, z))));
    const low = Math.min(...cs.map((c) => c.y));
    const pitch = Math.asin(clamp(qRot(f.footQ, v3(0, 0, 1)).y, -1, 1));
    const set = Math.abs(pitch) <= (K.set.pitchDeg * Math.PI) / 180 && (cs[0].y + cs[2].y) / 2 - low <= K.set.heelM;
    w[s] = set ? 1 : 0.5;
    if (set) setFeet++;
  }
  return { share: Math.max(w.left, w.right) * K.oneFoot + Math.min(w.left, w.right) * (1 - K.oneFoot), setFeet };
}

/**
 * A man's contest capacity (N): his push and his hold (`BlockContest`). `lowM`: his man's hips' height less his (m, +:
 * he is lower); `feet` his feet's share (`contestFeet`); `level` how far he is stood up; `anchored` (no hold without);
 * `leverage` (1: none; at most 1, on what he has after his drive's bound: p45, `inside`); `driveCapN` his drive's own
 * bound (the push never past it); `burstN` while he strikes, the force his palms put on his man (N; 0 otherwise);
 * `burstShare` (p46, `burstTaper`) the share of what his burst has over his push that he still has (0..1; absent, all).
 * `brakeN`: his push braking (his ordinary push, never the burst).
 */
export function contestCapacity(K: BlockContest, inp: { effort: number; lowM: number; feet: number; level: number; anchored: boolean; leverage: number; driveCapN: number; burstN: number; burstShare?: number }): { pushN: number; brakeN: number; holdN: number } {
  const e = clamp(inp.effort, 0, 1);
  const k = clamp(1 + K.low.perM * inp.lowM, K.low.min, K.low.max) * clamp(inp.feet, 0, 1);
  const lev = clamp(inp.leverage, 0, 1);
  const L = clamp(inp.level, 0, 1);
  const own = 1 - K.stood.pushCut * L;
  const brakeN = Math.min(K.pushN * e * k * own, Math.max(0, inp.driveCapN)) * lev;
  const base = K.pushN * e * k * own;
  const burst = Math.min(K.burst.pushN * e * k * own, inp.burstN);
  const pushN = Math.min(inp.burstShare === undefined ? Math.max(base, burst) : Math.max(base, base + (burst - base) * inp.burstShare), Math.max(0, inp.driveCapN)) * lev;
  const holdN = inp.anchored ? K.holdN * (K.holdFloor + (1 - K.holdFloor) * e) * k * (1 - K.stood.holdCut * L) * lev : 0;
  return { pushN: Math.max(0, pushN), brakeN: Math.max(0, brakeN), holdN: Math.max(0, holdN) };
}

/**
 * The contest's force along the line to his man (N, + toward him) at his speed `v` along it (m/s, + toward him) and the
 * speed his request asks `vWant` (m/s): his push on its force-velocity line plus his hold while he is moved away (his
 * request toward his man). `holdPushes` (a fault, `SimDebug.block.contestHoldPushes`): the hold pushes him toward his man
 * whatever his motion.
 */
export function contestForce(K: BlockContest, cap: { pushN: number; brakeN: number; holdN: number }, v: number, vWant: number, holdPushes = false): { F: number; push: number; hold: number } {
  const span = Math.max(Math.abs(vWant), K.spanMps);
  const x = clamp((vWant - v) / span, -1, 1);
  const push = x * (x >= 0 ? cap.pushN : cap.brakeN);
  // (moved away faster than he asks: his request's own speed away from his man is his, not the hold's)
  const back = Math.max(0, Math.min(0, vWant) - v);
  const ecc = back <= K.holdMps ? back / K.holdMps : 1 + (K.ecc.x - 1) * clamp((back - K.holdMps) / Math.max(1e-6, K.ecc.mps - K.holdMps), 0, 1);
  const hold = holdPushes ? cap.holdN : cap.holdN * ecc;
  return { F: push + hold, push, hold };
}

/**
 * One substep of a man's contest state after the solve before it: `v` his speed along the line (m/s, + toward his man),
 * `behindM` how far his centre of mass is behind his feet along it (m, + behind), `margin` his man's push over what he
 * pushes and holds with, less 1, `leanRad` his legs' lean, at time `t`. The level follows his knock-back (his acceleration
 * away from his man since the last substep); the fall clauses run their clocks and, once one has held its time, `down`
 * says which (and stays).
 */
export function advanceContest(st: ContestState, K: BlockContest, inp: { v: number; behindM: number; margin: number; leanRad: number }, t: number, dt: number): void {
  // (only his speed away from his man growing: a man stopped in his charge is not knocked back)
  const knock = st.vPrev === null ? 0 : Math.max(0, (Math.max(0, -inp.v) - Math.max(0, -st.vPrev)) / dt);
  st.vPrev = inp.v;
  const [k0, k1] = K.stood.knockMps2;
  const want = clamp((knock - k0) / (k1 - k0), 0, 1);
  const tau = want > st.level ? K.stood.attackS : K.stood.releaseS;
  st.level += (want - st.level) * (1 - Math.exp(-dt / tau));
  if (st.down) return;
  const F = K.fall;
  const clock = (on: boolean, since: number | null): number | null => (on ? (since ?? t) : null);
  st.outrunT = clock(inp.behindM > F.behindM, st.outrunT);
  st.overT = clock(st.level >= F.overLevel && -inp.v > F.overMps && inp.margin > F.overMargin, st.overT);
  st.leanT = clock(inp.leanRad > (K.anchorLeanDeg * Math.PI) / 180, st.leanT);
  const held = (since: number | null, s: number): boolean => since !== null && t - since >= s - 1e-9;
  if (held(st.leanT, F.leanS)) st.down = 'pastAnchor';
  else if (held(st.overT, F.overS)) st.down = 'overpowered';
  else if (held(st.outrunT, F.outrunS)) st.down = 'outrun';
}

/**
 * The centre of pressure (world, on the ground) the balance torque `tau` asks for: the support's ground point `pivot`
 * moved by cross(up, tau) / weight (a torque about the push line's level normal moves it along the line, one about the
 * line moves it across). Horizontal only; `weightN` > 0.
 */
export function neededCop(pivot: Vec3, tau: Vec3, weightN: number): Vec3 {
  const r = scale(cross(UP, v3(tau.x, 0, tau.z)), 1 / weightN);
  return v3(pivot.x + r.x, pivot.y, pivot.z + r.z);
}

/**
 * Foot `s`'s home (world ankle place) for an engaged blocker whose rear foot is `rear`, along the push line `u` (unit,
 * horizontal, toward his man): the rear foot's home goes back until its heel (`heelM` behind the ankle) is `marginM`
 * behind the needed centre of pressure `cop`, the front foot's forward until its toe (`toeM` ahead of the ankle) is
 * `marginM` ahead of it; neither moves the other way, and nothing moves across the line.
 */
export function braceHome(home: Vec3, s: ArmSide, rear: ArmSide, u: Vec3, cop: Vec3, heelM: number, toeM: number, marginM: number): Vec3 {
  const h = dot(v3(home.x, 0, home.z), u);
  const c = dot(v3(cop.x, 0, cop.z), u);
  const move = s === rear ? Math.min(0, c - marginM + heelM - h) : Math.max(0, c + marginM - toeM - h);
  return move === 0 ? home : add(home, scale(u, move));
}

/**
 * The ground-touching sole of the planted feet (world points): each planted foot's shoe as last shown (`ankleW`,
 * `footQ`), the corners of its sole within `touchM` of its lowest corner (a planted foot is on the ground where it is
 * lowest, though a pose may show it a little off). A heel shown lifted leaves the toe's corners, a foot on an edge that
 * edge's; a foot that is not planted gives nothing.
 */
export function soleContacts(plan: FootPlan, touchM: number, load?: BlockBase['soles']): Vec3[] {
  const out: Vec3[] = [];
  const { he, centerFoot } = plan.shoe;
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode !== 'planted') continue;
    const cs: Vec3[] = [];
    for (const x of [-he.x, he.x]) for (const z of [centerFoot.z - he.z, centerFoot.z + he.z]) cs.push(add(f.ankleW, qRot(f.footQ, v3(x, centerFoot.y - he.y, z))));
    const low = Math.min(...cs.map((c) => c.y));
    // (plan 16, `BlockBase.soles`: a heel within the limit bears weight, the whole sole with it; the heel's height is its
    // middle's, cs[0] and cs[2] its corners, above the sole's lowest corner, so a foot rolled onto an edge reads its lift)
    const pitch = Math.asin(clamp(qRot(f.footQ, v3(0, 0, 1)).y, -1, 1));
    const bears = !!load && Math.abs(pitch) <= (load.loadPitchDeg * Math.PI) / 180 && (cs[0].y + cs[2].y) / 2 - low <= load.loadHeelM;
    for (const c of cs) if (bears || c.y - low <= touchM) out.push(c);
  }
  return out;
}

/**
 * Plan 16 (p35, `BlockBase.soles`): what the base gives, read from the soles and his centre of mass. The identity: the
 * support force W at its ground point `pivot` and the balance torque tau act on him as W at the centre of pressure
 * pivot + (up x tau) / W (`neededCop`), and the ground can push only where a sole touches it. So the centre of pressure is
 * held within the touching soles' extent along the push line `u` and across it; and where his weight's own ground point
 * (`com`, his centre of mass on the ground) lies off them (a foot in a step, a stance behind its heels), it may stay under
 * it. Held toward that extent, the pressure only ever comes toward his centre of mass along each line: the moment of the
 * ground's force about his centre of mass is only ever reduced, never added to. Returned as `BaseMoments` about the support's
 * ground point for `limitToBase` (W times the reach of that extent behind, ahead and to each side of `pivot`), signed: a
 * side the extent does not reach past the ground point is negative (the pressure must stay on the other side of it).
 * Read from the centre of mass (`comBase`), these are the moments he can resist a push with from his feet.
 */
export function copBounds(points: Vec3[], pivot: Vec3, com: Vec3, u: Vec3, weightN: number): BaseMoments {
  const a = cross(UP, u);
  const at = (p: Vec3) => ({ along: dot(v3(p.x - pivot.x, 0, p.z - pivot.z), u), across: dot(v3(p.x - pivot.x, 0, p.z - pivot.z), a) });
  const c = at(com);
  let lo = c.along;
  let hi = c.along;
  let right = c.across;
  let left = c.across;
  for (const p of points) {
    const r = at(p);
    lo = Math.min(lo, r.along);
    hi = Math.max(hi, r.along);
    right = Math.min(right, r.across);
    left = Math.max(left, r.across);
  }
  return { back: -weightN * lo, front: weightN * hi, left: weightN * left, right: -weightN * right };
}

/**
 * Plan 16 (p35): the moments his feet give against a push, from his centre of mass `com` (N m): weight times how far the
 * touching soles reach behind it, ahead of it and to either side along the push line `u` (0 where none reaches past it).
 */
export function comBase(points: Vec3[], com: Vec3, u: Vec3, weightN: number): BaseMoments {
  return baseMoments(points, com, u, weightN);
}

/**
 * What the base gives (N m): weight times how far the contacts reach from the support's ground point `pivot`, behind and
 * ahead along the push line `u` (unit, horizontal, toward his man), and to either side of it (`left` along up x u, his
 * left facing his man); none where nothing reaches (no contacts: all 0).
 */
export interface BaseMoments {
  back: number;
  front: number;
  left: number;
  right: number;
}

export function baseMoments(points: Vec3[], pivot: Vec3, u: Vec3, weightN: number): BaseMoments {
  const a = cross(UP, u);
  const m: BaseMoments = { back: 0, front: 0, left: 0, right: 0 };
  for (const p of points) {
    const r = v3(p.x - pivot.x, 0, p.z - pivot.z);
    const along = dot(r, u);
    const across = dot(r, a);
    m.front = Math.max(m.front, weightN * along);
    m.back = Math.max(m.back, -weightN * along);
    m.left = Math.max(m.left, weightN * across);
    m.right = Math.max(m.right, -weightN * across);
  }
  return m;
}

/**
 * Plan 16 (flat feet, `FlatStance`): how far (m, along the facing; negative: behind) an ankle must stand ahead of its hip
 * for the shin over a flat foot to lean forward no more than `shinRad`, the hip `hipM` above the ankle, the leg of
 * thigh `thighM` and shin `shinM` bent in the sagittal plane. The shin leans less the further ahead the ankle stands, so
 * any place at least this far ahead is within the lean. With the shin at the lean the knee is `shinM` up it from the
 * ankle, and the hip a thigh above the knee: behind the ankle by thigh x sin(thigh angle) less shin x sin(lean). A hip
 * the thigh cannot reach down to at that lean (too low or too high) takes the nearest the thigh can.
 */
export function flatAheadM(thighM: number, shinM: number, hipM: number, shinRad: number): number {
  const c = clamp((hipM - shinM * Math.cos(shinRad)) / thighM, -1, 1);
  return thighM * Math.sqrt(1 - c * c) - shinM * Math.sin(shinRad);
}

/**
 * Plan 16 (p38, the lean-in): where (m, along the facing; negative: behind) the ankle over a foot's flat footprint (the
 * plan's plant, its sole on the ground under the ankle) stands ahead of its hip for the foot to stand on its ball, pitched
 * `pitchRad` heel up about its toe tip (the pose's plant pivot: the lowest sole corner on the footprint's anchor) with the
 * shin leaning the ankle's range `rangeRad` plus that pitch, the hip `hipOverGroundM` above the ground. The ankle is
 * `soleM` above a flat sole and `toeM` behind the toe tip; pitched, it rises to soleM cos + toeM sin and stands ahead of
 * the flat ankle by toeM (1 - cos) + soleM sin. A place further back lifts the heel further.
 */
export function ballAheadM(thighM: number, shinM: number, hipOverGroundM: number, rangeRad: number, pitchRad: number, soleM: number, toeM: number): number {
  const up = soleM * Math.cos(pitchRad) + toeM * Math.sin(pitchRad);
  return flatAheadM(thighM, shinM, hipOverGroundM - up, rangeRad + pitchRad) - (toeM * (1 - Math.cos(pitchRad)) + soleM * Math.sin(pitchRad));
}

/**
 * Plan 16 (p38): the shin's forward lean (rad) of the sagittal leg (thigh `thighM`, shin `shinM`, the knee forward) from
 * a hip `hipM` above its ankle to that ankle `aheadM` ahead of it (negative: behind), as over a flat foot.
 */
export function shinForAnkleRad(thighM: number, shinM: number, aheadM: number, hipM: number): number {
  const D = Math.hypot(aheadM, hipM);
  return Math.atan2(-aheadM, hipM) + Math.acos(clamp((shinM * shinM + D * D - thighM * thighM) / (2 * shinM * D), -1, 1));
}

/**
 * Plan 16 (p35, the athletic stance): a sagittal leg of thigh `thighM` and shin `shinM`, the thigh sloping `thighRad`
 * below horizontal from the hip forward to the knee, the shin leaning `shinRad` forward from the ankle up to the knee: the
 * ankle's place ahead of the hip (m; negative behind) and the hip's height above the ankle (m).
 */
export function legShape(thighM: number, shinM: number, thighRad: number, shinRad: number): { aheadM: number; upM: number } {
  return { aheadM: thighM * Math.cos(thighRad) - shinM * Math.sin(shinRad), upM: thighM * Math.sin(thighRad) + shinM * Math.cos(shinRad) };
}

/** The same leg over an ankle `aheadM` in front of the hip with its shin leaning `shinRad`: the thigh's slope (rad) and the hip's height above the ankle (m). */
export function legForShin(thighM: number, shinM: number, aheadM: number, shinRad: number): { thighRad: number; upM: number } {
  const thighRad = Math.acos(clamp((aheadM + shinM * Math.sin(shinRad)) / thighM, -1, 1));
  return { thighRad, upM: legShape(thighM, shinM, thighRad, shinRad).upM };
}

/** The same leg over an ankle `aheadM` in front of the hip with its thigh sloping `thighRad`: the shin's lean (rad) and the hip's height above the ankle (m). */
export function legForThigh(thighM: number, shinM: number, aheadM: number, thighRad: number): { shinRad: number; upM: number } {
  const shinRad = Math.asin(clamp((thighM * Math.cos(thighRad) - aheadM) / shinM, -1, 1));
  return { shinRad, upM: legShape(thighM, shinM, thighRad, shinRad).upM };
}

/** The forward lean (rad) of the shin from the ankle up to the knee, along the horizontal heading `dir` (unit). */
export function shinLeanRad(knee: Vec3, ankle: Vec3, dir: Vec3): number {
  const d = { x: knee.x - ankle.x, y: knee.y - ankle.y, z: knee.z - ankle.z };
  return Math.atan2(d.x * dir.x + d.z * dir.z, d.y);
}

/** The largest moment the base gives in any direction (N m): the balance's scalar ceiling under it. */
export const baseCeiling = (m: BaseMoments): number => Math.max(m.back, m.front, m.left, m.right);

/**
 * A balance torque held to what the base gives: its part about a = up x u (positive tips him toward his man, so it needs
 * the pressure behind the ground point: `back`) within [-front, back], its part about u (positive needs the pressure to
 * his left) within [-right, left]; the vertical part as it is. `saturated`: a part was held.
 */
export function limitToBase(tau: Vec3, m: BaseMoments, u: Vec3): { torque: Vec3; saturated: boolean } {
  const a = cross(UP, u);
  const p = dot(tau, a);
  const r = dot(tau, u);
  const pc = clamp(p, -m.front, m.back);
  const rc = clamp(r, -m.right, m.left);
  if (pc === p && rc === r) return { torque: tau, saturated: false };
  return { torque: add(tau, add(scale(a, pc - p), scale(u, rc - r))), saturated: true };
}
