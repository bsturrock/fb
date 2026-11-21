// Plan 16 (blocking), design item 3: the BL family. Two `defender`s on the player model block each other with the block
// controller (controllers/block.ts) and the palm push (PALM_PUSH_BLOCK); no ball, no rules. Built from L3-F6-hold's package
// as its fixture file makes it (the model body, motor, solver, balance, suspension, the composed feet and clips, the
// ragdoll and the family base profiles); `registered` (fixtures/index.ts) names the layers the family takes on top.
// A is at -z facing +z, B at +z facing -z (B's lateral offset on world x).
import type { FixtureDef, PlayerSetup } from '../fixture';
import { BLOCK_STRIKE_V1, BLOCK_STRIKE_V2, BLOCK_STRIKE_V5, GAZE_V1, LEAN_IN_V2, LEAN_IN_V5, LEAN_IN_V6, BLOCK_V1, chestShiftM, preSnapKey, withAimThrough, withAthletic, withFollowThrough, withLanes, LANES_V1, LANES_TOPS, SHOULDER_TOPS_HIGH_M, LANE_TIE_V1, withLaneTie, withUnder, UNDER_V1, withBase, withContest, withGaze, withLeanIn, withStrike, type AthleticStance, type BlockHands, type BlockIntent, type BlockProfile, type BlockStrike, type LeanGeometry, type LeanInStance, type PreSnapStance } from '../controllers/block';
import { BASE_V2, CONTEST_V1, CONTEST_V2, INSIDE_LEVERAGE, BURST_TAPER_BEATEN, withArmsGive, withBurstTaper, withInsideLeverage, withLowUnheld, type BlockContest } from '../block-base';
import { PALM_PUSH_V1, withUpperArmClearance, type PalmPushProfile } from '../profiles';
import { v3 } from '../vec';
import { mirrorZ } from './handoff-contact';
import { l3f6 } from './transitions';

export interface BlockMan {
  effort: number;
  intent: BlockIntent;
  hands?: BlockHands;
  /** He starts blocking at this time (s; default 0: set in his stance from the reset). */
  fromS?: number;
  /** He walks in: his speed at t = 0 toward the other (m/s). */
  walkInMps?: number;
  profile?: BlockProfile;
  /** Plan 16 (p35): his profile on this athletic stance (`withAthletic`), derived on the scene's leg (`legOf`). */
  athletic?: AthleticStance;
  /** Plan 16 (p38): his profile on this lean-in stance (`withLeanIn`), derived on the scene's leg (`legOf`; in place of `athletic`). */
  leanIn?: LeanInStance;
  /**
   * Plan 16 (p39): his pre-snap stance (`BlockRequest.stance`), held from the reset until `fromS` (the snap). Set in it from
   * the reset when his profile has it (`BlockProfile.preSnap`).
   */
  stance?: PreSnapStance;
}

/**
 * Plan 16 (p35): a scene's body for the athletic stance (`StanceGeometry`): the ragdoll profile's thigh, shin and sole, the
 * body's hip and torso box, the joint range's ankle; for the lean-in (p38, `LeanGeometry`) the shoe's toe tip ahead of the
 * ankle and its length.
 */
export function legOf(def: FixtureDef, body: PlayerSetup['body']): LeanGeometry {
  const R = def.ragdoll!;
  if (body.kind === 'legacyCapsule') throw new Error('the athletic stance needs the compound body');
  const c = body.compound.torso.center;
  return { thighM: R.lengths.thigh, shinM: R.lengths.shin, soleM: R.shoe.belowAnkleM + R.shoe.halfExtents.y, hipUpM: body.hipRight.y, chestUpM: c.y, chestAheadM: c.z, dorsiDeg: def.jointRange!.ankle.dorsiDeg, toeM: R.shoe.forwardM + R.shoe.halfExtents.z, shoeM: 2 * R.shoe.halfExtents.z, thighRM: R.radii.thigh, palmRM: R.radii.palm, ...(def.armProfile ? { reachM: def.armProfile.maxReachM } : {}) };
}

/** A man's block profile: his own (default BLOCK_V1), on his lean-in or athletic stance when he has one. */
export const profileOf = (m: BlockMan, def: FixtureDef, body: PlayerSetup['body']): BlockProfile =>
  m.leanIn ? withLeanIn(m.profile ?? BLOCK_V1, m.leanIn, legOf(def, body)) : m.athletic ? withAthletic(m.profile ?? BLOCK_V1, m.athletic, legOf(def, body)) : (m.profile ?? BLOCK_V1);

/** The set stance's trunk pitch of a man's own stance (lean-in or athletic; none: his profile's). */
const setTrunkDeg = (m: BlockMan): number | null => (m.leanIn ? m.leanIn.set.trunkDeg : m.athletic ? m.athletic.set.trunkDeg : null);

export interface BlockSceneOpts {
  id: string;
  title: string;
  A: BlockMan;
  B: BlockMan;
  /** Origin to origin at t = 0 (m; default 1.1: 0.67 m between the torso boxes' fronts, inside the punch gap) and B's lateral offset (m). */
  sepM?: number;
  offsetX?: number;
  durationS: number;
  /** Plan 16 (p44): the palm push's patch where the shown palm rests on his surface (`PalmPushProfile.seat`; absent: the landmark's projection). */
  seat?: boolean;
  /**
   * Plan 16 (p44): the upper arm in the arms' self-clearance (`withUpperArmClearance`), and his own body never ending a
   * held push (`PalmPushProfile.ownBodyKeeps`: under the upper arm's clearance an elbow the push presses against his ribs
   * would otherwise release it).
   */
  upperArm?: boolean;
  /**
   * Plan 16 (p45): the palm push's arm line judged against his chest as it stands in his engaged stance
   * (`PalmPushProfile.stanceCone`, `refDeg` the men's set trunk, the shallower of the two): fired out pitched deeper, his
   * man's palms meet his chest as they would at that stance.
   */
  stanceCone?: boolean;
  /** Plan 16 (p45): both men's palms aimed through their point on his man's chest, along the arm's line (`BlockProfile.aimThrough`). */
  aimThrough?: boolean;
  /**
   * Plan 16 (p45): both men following through (`BlockProfile.followThrough`), the hit's punch parting them only while
   * the striker's arms extend (`ContestHit.untilStraight`): `withFollowThrough`.
   */
  followThrough?: boolean;
  /** Plan 16 (p45): both men on the inside lane, won by who gets there (`BlockProfile.lanes`, LANES_V1), in place of their hands. */
  lanes?: boolean;
  /** Plan 16 (p45): both men's contests with the inside lane's leverage (`BlockContest.inside`, INSIDE_LEVERAGE). */
  insideLeverage?: boolean;
  /** Plan 16 (p46): both men's winner of the hit staying low and the man it beat staying up (`BlockProfile.under`, UNDER_V1, on a man's lean-in). */
  stayLow?: boolean;
  /** Plan 16 (p46): with `lanes`, the outside palms on the tops of his shoulders (LANES_TOPS), the palm push's band raised to them (SHOULDER_TOPS_HIGH_M). */
  shoulderTops?: boolean;
  /** Plan 16 (p46): a palm push folded past its collapse kept on, at no force, to FOLD_KEEPS_DEG (`PalmPushProfile.foldKeeps`). */
  foldKeeps?: boolean;
  /** Plan 16 (p46): both men's arms giving as they are stood up (`BlockContest.armsGive`, `withArmsGive`). */
  armsGive?: boolean;
  /** Plan 16 (p46): with `lanes`, the lane's call with a tie (LANE_TIE_V1, `withLaneTie`): level reach and height, the man driving has the inside. */
  laneTie?: boolean;
  /** Plan 16 (p46): both men's burst tapering once the hit has beaten his man (`BlockContest.burstTaper`, BURST_TAPER_BEATEN, `withBurstTaper`). */
  burstTaper?: boolean;
  /** Plan 16 (p46): how low each man is read without the beaten man's held lift (`BlockContest.lowUnheld`, `withLowUnheld`). */
  lowUnheld?: boolean;
}

/** Plan 16 (p46): the elbow's flexion a folded palm push is kept to (deg; the elbow folds to about 145): past it his forearm is against his upper arm, his palms at his own shoulders. */
export const FOLD_KEEPS_DEG = 130;

/**
 * The palm push the BL men use: PALM_PUSH_V1 with a wider cone for the arm line (born from 0.6, kept to 0.45; V1 0.8 and
 * 0.65). Under hands on a man pitched forward in his stance meet his chest 45-50 deg off its normal (facing 0.64-0.66),
 * which V1 refuses: a palm come off could not go back on (p31).
 */
export const PALM_PUSH_BLOCK: PalmPushProfile = { ...PALM_PUSH_V1, bornFacingDot: 0.6, keepFacingDot: 0.45 };

/**
 * The palm push of a scene (p35): PALM_PUSH_BLOCK, its arm line cone widened (born and kept) by however much deeper the
 * athletic men's set stance pitches the chest than their profile's own (each man's chest the other's palms meet).
 */
const palmWidenDeg = (o: BlockSceneOpts): number =>
  Math.max(...[o.A, o.B].map((m) => (setTrunkDeg(m) !== null ? setTrunkDeg(m)! - ((m.profile ?? BLOCK_V1).stance.leanDeg + (m.profile ?? BLOCK_V1).stance.hingeDeg) : 0)));
/** The men's set trunk (deg from vertical; the shallower of the two): a man's own stance's, or his profile's lean and hinge. */
const setTrunkOf = (o: BlockSceneOpts): number => Math.min(...[o.A, o.B].map((m) => setTrunkDeg(m) ?? (m.profile ?? BLOCK_V1).stance.leanDeg + (m.profile ?? BLOCK_V1).stance.hingeDeg));
function palmPushOf(o: BlockSceneOpts): PalmPushProfile {
  const more = palmWidenDeg(o);
  const P = { ...PALM_PUSH_BLOCK, ...(o.seat ? { seat: true } : {}), ...(o.upperArm ? { ownBodyKeeps: true } : {}), ...(o.stanceCone ? { stanceCone: { refDeg: setTrunkOf(o) } } : {}), ...(o.shoulderTops ? { band: { ...PALM_PUSH_BLOCK.band, highM: SHOULDER_TOPS_HIGH_M } } : {}), ...(o.foldKeeps ? { foldKeeps: { maxFlexDeg: FOLD_KEEPS_DEG } } : {}) };
  if (more <= 0) return P;
  const wider = (dot: number) => Math.cos(Math.acos(dot) + (more * Math.PI) / 180);
  return { ...P, bornFacingDot: wider(P.bornFacingDot), keepFacingDot: wider(P.keepFacingDot) };
}

const source = (): FixtureDef => l3f6().find((d) => d.id === 'L3-F6-hold')!;

function man(id: 'A' | 'B', o: BlockSceneOpts, m: BlockMan, template: PlayerSetup, def: FixtureDef): PlayerSetup {
  const sign = id === 'A' ? 1 : -1;
  const sep = o.sepM ?? sepOf(o, def, template.body);
  const P0 = profileOf(m, def, template.body);
  const P1 = o.aimThrough ? withAimThrough(P0) : P0;
  const P2 = o.followThrough ? withFollowThrough(P1) : P1;
  const L0 = o.shoulderTops ? LANES_TOPS : LANES_V1;
  const P3 = o.lanes ? withLanes(P2, o.laneTie ? withLaneTie(L0, LANE_TIE_V1) : L0) : P2;
  const P4 = o.insideLeverage && P3.contest ? { ...P3, id: `${P3.id}+inside-x${INSIDE_LEVERAGE}`, contest: withInsideLeverage(P3.contest, INSIDE_LEVERAGE) } : P3;
  const P5 = o.stayLow && m.leanIn ? withUnder(P4, UNDER_V1, m.leanIn, legOf(def, template.body)) : P4;
  const P6 = o.armsGive && P5.contest ? { ...P5, id: `${P5.id}+arms-give`, contest: withArmsGive(P5.contest) } : P5;
  const P7 = o.burstTaper && P6.contest ? { ...P6, id: `${P6.id}+burst-taper`, contest: withBurstTaper(P6.contest, BURST_TAPER_BEATEN) } : P6;
  const P = o.lowUnheld && P7.contest ? { ...P7, id: `${P7.id}+low-unheld`, contest: withLowUnheld(P7.contest) } : P7;
  const set = (m.fromS ?? 0) <= 0 && !m.walkInMps;
  // (p39: a man in a pre-snap stance is set in it from the reset)
  const pre = m.stance && !m.walkInMps ? P.preSnap?.[preSnapKey(m.stance)] : undefined;
  const S0 = pre ?? (set ? P.stance : undefined);
  return {
    ...template,
    id,
    role: 'defender',
    initial: {
      x: id === 'B' ? (o.offsetX ?? 0) : 0,
      z: (-sign * sep) / 2,
      yawDeg: id === 'A' ? 0 : 180,
      ...(m.walkInMps ? { velocity: v3(0, 0, sign * m.walkInMps) } : {}),
      // set in his stance's height, feet square: a reset into the stagger slides the rear plant 5.8 cm on the first
      // substep (p31); the stance request staggers them from there
      ...(S0 ? { stance: { heightM: S0.heightM, staggerM: 0, ...(S0.widthAddM ? { widthAddM: S0.widthAddM } : {}), ...(P.flat ? { flat: P.flat } : {}) } } : {}),
    },
    arms: { enabled: { left: true, right: true }, mode: { left: 'forearmClamp', right: 'forearmClamp' }, acquisition: false, closeEffortScale: 1 },
    controller: {
      kind: 'block',
      request: { target: id === 'A' ? 'B' : 'A', effort: m.effort, intent: m.intent, ...(m.hands ? { hands: m.hands } : {}), ...(m.stance ? { stance: m.stance } : {}) },
      ...(m.fromS ? { fromS: m.fromS } : {}),
      ...(m.profile || m.athletic || m.leanIn || o.aimThrough || o.followThrough || o.lanes || o.insideLeverage || o.stayLow || o.armsGive || o.burstTaper || o.lowUnheld ? { profile: P } : {}),
    },
  };
}

/**
 * The scene's start separation (`BlockSceneOpts.sepM`; default 1.1): with athletic men, wider by what their set stance's
 * deeper pitch brings each chest nearer than the profile's own (`chestShiftM`), so the pitched chests meet as before.
 */
function sepOf(o: BlockSceneOpts, def: FixtureDef, body: PlayerSetup['body']): number {
  const more = (m: BlockMan) => {
    const t = setTrunkDeg(m);
    if (t === null) return 0;
    const G = legOf(def, body);
    const p = m.profile ?? BLOCK_V1;
    return chestShiftM(G, t) - chestShiftM(G, p.stance.leanDeg + p.stance.hingeDeg);
  };
  return 1.1 + more(o.A) + more(o.B);
}

/** One BL scene from L3-F6-hold's package: two blocking defenders, no ball, no rules, no wrap. */
export function blockScene(o: BlockSceneOpts, base: FixtureDef = source()): FixtureDef {
  const D = base.players.find((p) => p.id === 'D')!;
  const { brace: _brace, carry: _carry, rules: _rules, wrap: _wrap, diagnostics: _diag, ...rest } = base;
  return {
    ...rest,
    id: o.id,
    milestone: 'BL',
    title: o.title,
    notes: 'Plan 16 blocking: two defenders on the player model, the block controller (block-v1, on a base when its profile has one) and the palm push (palm-push-v1, its arm line cone widened for a pitched chest); no ball, no rules.',
    // the arm profile's id names the widened cone, the seat and the hold over his own body (one id, one set of values)
    armProfile: { ...base.armProfile!, id: `${base.armProfile!.id}+palm-push-block${palmWidenDeg(o) > 0 ? `+wider${Math.round(palmWidenDeg(o) * 10) / 10}` : ''}${o.seat ? '+seat' : ''}${o.upperArm ? '+own-body-keeps' : ''}${o.stanceCone ? `+stance-cone${setTrunkOf(o)}` : ''}${o.shoulderTops ? `+band-top${SHOULDER_TOPS_HIGH_M}` : ''}${o.foldKeeps ? `+fold-keeps${FOLD_KEEPS_DEG}` : ''}`, palmPush: palmPushOf(o) },
    ...(o.upperArm ? { selfClearance: withUpperArmClearance(rest.selfClearance!) } : {}),
    durationS: o.durationS,
    area: { halfX: 8, halfZ: 8 },
    focus: { A: 'B', B: 'A' },
    players: [man('A', o, o.A, D, base), man('B', o, o.B, D, base)],
  };
}

/** The harder scenes' block: the drive asks 1 m/s more engaged (1.4 m/s at effort 1). */
export const BLOCK_V1_HARD: BlockProfile = { ...BLOCK_V1, id: 'block-v1-hard', driveMps: 1 };
/** The same without the hip hinge (the trunk over the hips, 8 deg of lean): the push at shoulder height tips a man back (p30). */
export const BLOCK_V1_HARD_NO_HINGE: BlockProfile = { ...BLOCK_V1_HARD, id: 'block-v1-hard-no-hinge', stance: { ...BLOCK_V1.stance, hingeDeg: 0, dropM: 0 } };

/**
 * The BL men's base (p32): BASE_V2 (the stance covers the pressure the balance asks for; the balance holds what the
 * planted feet give) with the stance 3 cm wider per foot (the owner, 2026-11-17: feet under the hips, "maybe slightly
 * wider, not super wide").
 */
export const based = (p: BlockProfile = BLOCK_V1): BlockProfile => withBase(p, BASE_V2, 0.03);
/**
 * Plan 16 (p37): a BL man's block on the contest (CONTEST_V1: his push and hold decide who moves; no base, so his balance
 * is the supported model's own), punching with the strike (`K`, default BLOCK_STRIKE_V1), the stance 3 cm wider per foot
 * as on the base; p42: on the contest `C` (default CONTEST_V1).
 */
export const contested = (p: BlockProfile = BLOCK_V1, K: BlockStrike = BLOCK_STRIKE_V1, C: BlockContest = CONTEST_V1): BlockProfile => withContest(withStrike({ ...p, stance: { ...p.stance, widthAddM: 0.03 } }, K), C);
/**
 * A BL man (p39): his block on the contest (`contested`), on the low lean-in (LEAN_IN_V2: the ankle's 38 deg in a block,
 * hips 0.82 m set, 0.75 loaded; p38's LEAN_IN_V1 stood him at 0.90), striking with BLOCK_STRIKE_V2 (p40: engaged and held
 * off at arm's length he strikes from there; on V1 he stayed loaded), or the strike `K` (p41: the men set before the snap
 * on BLOCK_STRIKE_V3, the fire-out; p42 on BLOCK_STRIKE_V4 with CONTEST_V2, the hit; p43 on BLOCK_STRIKE_V5, the load
 * on his shoulders), on the contest `C` (default CONTEST_V1).
 */
const hold = (effort: number, hands: 'under' | 'over', profile?: BlockProfile, K: BlockStrike = BLOCK_STRIKE_V2, C: BlockContest = CONTEST_V1): BlockMan => ({ effort, intent: 'hold', hands, profile: contested(profile, K, C), leanIn: LEAN_IN_V2 });
const drive = (effort: number, hands: 'under' | 'over', profile?: BlockProfile, K: BlockStrike = BLOCK_STRIKE_V2, C: BlockContest = CONTEST_V1): BlockMan => ({ effort, intent: 'drive', hands, profile: contested(profile, K, C), leanIn: LEAN_IN_V2 });
/**
 * A BL man set before the snap (p40): on LEAN_IN_V4 (LEAN_IN_V2 with its two-point set and three-point stances), set in
 * `stance` from the reset, his block from the snap at `snapS`; p43: his eyes on his man (GAZE_V1); p44: on LEAN_IN_V5
 * (a three-point's down hand reaching the turf in front of his knee), and a man in the two-point on LEAN_IN_V6 (V5 with
 * the two-point set on its own feet).
 */
const setIn = (m: BlockMan, kind: 'two-point' | 'three-point', side: 'offense' | 'defense', snapS: number): BlockMan => ({ ...m, profile: withGaze(m.profile ?? BLOCK_V1, GAZE_V1), leanIn: kind === 'two-point' ? LEAN_IN_V6 : LEAN_IN_V5, stance: { kind, side }, fromS: snapS });

/**
 * The BL scenes (A's hands under, B's over, in every one; every man on the contest, `contested`, striking with
 * BLOCK_STRIKE_V2 (before p40 V1), on the low lean-in LEAN_IN_V2, his feet behind his hips; the two set before the snap,
 * F9 and F10, on BLOCK_STRIKE_V5 and CONTEST_V2 from p43, the load on his shoulders, from p44 the landing palm seated
 * on his chest (`seat`), from p45 the palms aimed through their point on his chest (`aimThrough`), the arm line
 * judged against a pitched chest as at the stance (`stanceCone`), the follow-through (`followThrough`) and the inside
 * lane won by who gets there (`lanes`, in place of A's under and B's over hands) and its leverage (`insideLeverage`), from p46
 * the winner driving from under once his hit is through (`stayLow`) and the outside palms on the tops of the shoulders
 * (`shoulderTops`), the beaten man's arms giving and kept on (`foldKeeps`, `armsGive`)
 * and the lane's call with a tie (`laneTie`); from p44
 * every scene with the upper arm in the arms' self-clearance and a held push kept over his own body (`upperArm`); p42 on BLOCK_STRIKE_V4, the hit
 * taken by the hands; before p42 on BLOCK_STRIKE_V3 and CONTEST_V1). Before p39 on the tall lean-in LEAN_IN_V1, before p38 on the athletic stance ATHLETIC_V2 with flat feet, before p37 on BASE_V2 (`based`) with no athletic stance.
 */
export const BL_SCENES: BlockSceneOpts[] = [
  { id: 'BL-F1-even', title: 'Even match, standing: both hold at effort 0.5 from 1.1 m apart, 9 s', A: hold(0.5, 'under'), B: hold(0.5, 'over'), durationS: 9, upperArm: true },
  { id: 'BL-F2-walkIn', title: 'Even match, A walks in at 1.5 m/s from 3 m onto B, who sets at 1 s; both hold at effort 0.5, 9 s', A: { ...hold(0.5, 'under'), walkInMps: 1.5 }, B: { ...hold(0.5, 'over'), fromS: 1 }, sepM: 3, durationS: 9, upperArm: true },
  { id: 'BL-F3-blockerDrives', title: 'Blocker stronger: A drives at effort 1, B holds at effort 0.4, 9 s', A: drive(1, 'under'), B: hold(0.4, 'over'), durationS: 9, upperArm: true },
  { id: 'BL-F4-defenderStronger', title: 'Defender stronger: B drives at effort 1, A drives at effort 0.4, 9 s', A: drive(0.4, 'under'), B: drive(1, 'over'), durationS: 9, upperArm: true },
  { id: 'BL-F5-offCentre', title: 'Off centre by half a man: B 0.25 m to the side, both hold at effort 0.5, 9 s', A: hold(0.5, 'under'), B: hold(0.5, 'over'), offsetX: 0.25, durationS: 9, upperArm: true },
  { id: 'BL-F7-hard', title: 'Harder: both drive at effort 1 asking 1.4 m/s, 9 s (the stance holds it)', A: drive(1, 'under', BLOCK_V1_HARD), B: drive(1, 'over', BLOCK_V1_HARD), durationS: 9, upperArm: true },
  { id: 'BL-F8-hardNoHinge', title: 'Harder without the hip hinge: both drive at effort 1 asking 1.4 m/s, 9 s (the push at shoulder height tips them)', A: drive(1, 'under', BLOCK_V1_HARD_NO_HINGE), B: drive(1, 'over', BLOCK_V1_HARD_NO_HINGE), durationS: 9, upperArm: true },
  {
    id: 'BL-F9-threePoint',
    title: 'Three-point against three-point: A on offense, B on defense, set from the reset 2 m apart, the snap at 3.3 s (about 1 s set), both firing out at it; A drives, B holds, both at effort 0.5, 8 s',
    A: setIn(drive(0.5, 'under', undefined, BLOCK_STRIKE_V5, CONTEST_V2), 'three-point', 'offense', 3.3),
    B: setIn(hold(0.5, 'over', undefined, BLOCK_STRIKE_V5, CONTEST_V2), 'three-point', 'defense', 3.3),
    sepM: 2,
    durationS: 8,
    seat: true,
    aimThrough: true,
    stanceCone: true,
    followThrough: true,
    lanes: true,
    insideLeverage: true,
    stayLow: true,
    shoulderTops: true,
    foldKeeps: true,
    armsGive: true,
    laneTie: true,
    upperArm: true,
  },
  {
    id: 'BL-F10-twoPointVsThree',
    title: 'Two-point set against a three-point defender: A in the two-point set, B in the three-point defense, 2 m apart, the snap at 3.3 s, both firing out at it; A drives, B holds, both at effort 0.5, 8 s',
    A: setIn(drive(0.5, 'under', undefined, BLOCK_STRIKE_V5, CONTEST_V2), 'two-point', 'offense', 3.3),
    B: setIn(hold(0.5, 'over', undefined, BLOCK_STRIKE_V5, CONTEST_V2), 'three-point', 'defense', 3.3),
    sepM: 2,
    durationS: 8,
    seat: true,
    aimThrough: true,
    stanceCone: true,
    followThrough: true,
    lanes: true,
    insideLeverage: true,
    stayLow: true,
    shoulderTops: true,
    foldKeeps: true,
    armsGive: true,
    laneTie: true,
    upperArm: true,
  },
];

/** The BL family: the scenes, and the off-centre one mirrored (BL-F6). */
export const blockingFixtures = (base?: FixtureDef): FixtureDef[] => {
  const defs = BL_SCENES.map((o) => blockScene(o, base));
  const off = defs.find((d) => d.id === 'BL-F5-offCentre')!;
  return [...defs.slice(0, 5), { ...mirrorZ(off), id: 'BL-F6-offCentreMirror', title: 'Off centre by half a man, mirrored (B 0.25 m to the side), both hold at effort 0.5, 9 s' }, ...defs.slice(5)];
};
