// Plan 16 (blocking), design item 3: the BL family. Two `defender`s on the player model block each other with the block
// controller (controllers/block.ts) and the palm push (PALM_PUSH_BLOCK); no ball, no rules. Built from L3-F6-hold's package
// as its fixture file makes it (the model body, motor, solver, balance, suspension, the composed feet and clips, the
// ragdoll and the family base profiles); `registered` (fixtures/index.ts) names the layers the family takes on top.
// A is at -z facing +z, B at +z facing -z (B's lateral offset on world x).
import type { FixtureDef, PlayerSetup } from '../fixture';
import { BLOCK_STRIKE_V1, BLOCK_V1, chestShiftM, withAthletic, withBase, withContest, withStrike, type AthleticStance, type BlockHands, type BlockIntent, type BlockProfile, type StanceGeometry } from '../controllers/block';
import { BASE_V2, CONTEST_V1 } from '../block-base';
import { PALM_PUSH_V1, type PalmPushProfile } from '../profiles';
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
}

/** Plan 16 (p35): a scene's body for the athletic stance (`StanceGeometry`): the ragdoll profile's thigh, shin and sole, the body's hip and torso box, the joint range's ankle. */
export function legOf(def: FixtureDef, body: PlayerSetup['body']): StanceGeometry {
  const R = def.ragdoll!;
  if (body.kind === 'legacyCapsule') throw new Error('the athletic stance needs the compound body');
  const c = body.compound.torso.center;
  return { thighM: R.lengths.thigh, shinM: R.lengths.shin, soleM: R.shoe.belowAnkleM + R.shoe.halfExtents.y, hipUpM: body.hipRight.y, chestUpM: c.y, chestAheadM: c.z, dorsiDeg: def.jointRange!.ankle.dorsiDeg };
}

/** A man's block profile: his own (default BLOCK_V1), on his athletic stance when he has one. */
export const profileOf = (m: BlockMan, def: FixtureDef, body: PlayerSetup['body']): BlockProfile => (m.athletic ? withAthletic(m.profile ?? BLOCK_V1, m.athletic, legOf(def, body)) : (m.profile ?? BLOCK_V1));

export interface BlockSceneOpts {
  id: string;
  title: string;
  A: BlockMan;
  B: BlockMan;
  /** Origin to origin at t = 0 (m; default 1.1: 0.67 m between the torso boxes' fronts, inside the punch gap) and B's lateral offset (m). */
  sepM?: number;
  offsetX?: number;
  durationS: number;
}

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
function palmPushOf(o: BlockSceneOpts): PalmPushProfile {
  const more = Math.max(...[o.A, o.B].map((m) => (m.athletic ? m.athletic.set.trunkDeg - ((m.profile ?? BLOCK_V1).stance.leanDeg + (m.profile ?? BLOCK_V1).stance.hingeDeg) : 0)));
  if (more <= 0) return PALM_PUSH_BLOCK;
  const wider = (dot: number) => Math.cos(Math.acos(dot) + (more * Math.PI) / 180);
  return { ...PALM_PUSH_BLOCK, bornFacingDot: wider(PALM_PUSH_BLOCK.bornFacingDot), keepFacingDot: wider(PALM_PUSH_BLOCK.keepFacingDot) };
}

const source = (): FixtureDef => l3f6().find((d) => d.id === 'L3-F6-hold')!;

function man(id: 'A' | 'B', o: BlockSceneOpts, m: BlockMan, template: PlayerSetup, def: FixtureDef): PlayerSetup {
  const sign = id === 'A' ? 1 : -1;
  const sep = o.sepM ?? sepOf(o, def, template.body);
  const P = profileOf(m, def, template.body);
  const set = (m.fromS ?? 0) <= 0 && !m.walkInMps;
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
      ...(set ? { stance: { heightM: P.stance.heightM, staggerM: 0, ...(P.stance.widthAddM ? { widthAddM: P.stance.widthAddM } : {}), ...(P.flat ? { flat: P.flat } : {}) } } : {}),
    },
    arms: { enabled: { left: true, right: true }, mode: { left: 'forearmClamp', right: 'forearmClamp' }, acquisition: false, closeEffortScale: 1 },
    controller: {
      kind: 'block',
      request: { target: id === 'A' ? 'B' : 'A', effort: m.effort, intent: m.intent, ...(m.hands ? { hands: m.hands } : {}) },
      ...(m.fromS ? { fromS: m.fromS } : {}),
      ...(m.profile || m.athletic ? { profile: P } : {}),
    },
  };
}

/**
 * The scene's start separation (`BlockSceneOpts.sepM`; default 1.1): with athletic men, wider by what their set stance's
 * deeper pitch brings each chest nearer than the profile's own (`chestShiftM`), so the pitched chests meet as before.
 */
function sepOf(o: BlockSceneOpts, def: FixtureDef, body: PlayerSetup['body']): number {
  const more = (m: BlockMan) => {
    if (!m.athletic) return 0;
    const G = legOf(def, body);
    const p = m.profile ?? BLOCK_V1;
    return chestShiftM(G, m.athletic.set.trunkDeg) - chestShiftM(G, p.stance.leanDeg + p.stance.hingeDeg);
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
    armProfile: { ...base.armProfile!, id: `${base.armProfile!.id}+palm-push-block`, palmPush: palmPushOf(o) },
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
 * is the supported model's own), punching with the strike, the stance 3 cm wider per foot as on the base (no fixture
 * has it yet).
 */
export const contested = (p: BlockProfile = BLOCK_V1): BlockProfile => withContest(withStrike({ ...p, stance: { ...p.stance, widthAddM: 0.03 } }, BLOCK_STRIKE_V1), CONTEST_V1);
/** A BL man's block (p33): on his base (`based`), punching with the strike (BLOCK_STRIKE_V1: load, strike, drive). */
const struck = (p?: BlockProfile): BlockProfile => withStrike(based(p), BLOCK_STRIKE_V1);
const hold = (effort: number, hands: 'under' | 'over', profile?: BlockProfile): BlockMan => ({ effort, intent: 'hold', hands, profile: struck(profile) });
const drive = (effort: number, hands: 'under' | 'over', profile?: BlockProfile): BlockMan => ({ effort, intent: 'drive', hands, profile: struck(profile) });

/** The BL scenes (A's hands under, B's over, in every one; every man on his base, `based`, and striking, BLOCK_STRIKE_V1). */
export const BL_SCENES: BlockSceneOpts[] = [
  { id: 'BL-F1-even', title: 'Even match, standing: both hold at effort 0.5 from 1.1 m apart, 9 s', A: hold(0.5, 'under'), B: hold(0.5, 'over'), durationS: 9 },
  { id: 'BL-F2-walkIn', title: 'Even match, A walks in at 1.5 m/s from 3 m onto B, who sets at 1 s; both hold at effort 0.5, 9 s', A: { ...hold(0.5, 'under'), walkInMps: 1.5 }, B: { ...hold(0.5, 'over'), fromS: 1 }, sepM: 3, durationS: 9 },
  { id: 'BL-F3-blockerDrives', title: 'Blocker stronger: A drives at effort 1, B holds at effort 0.4, 9 s', A: drive(1, 'under'), B: hold(0.4, 'over'), durationS: 9 },
  { id: 'BL-F4-defenderStronger', title: 'Defender stronger: B drives at effort 1, A drives at effort 0.4, 9 s', A: drive(0.4, 'under'), B: drive(1, 'over'), durationS: 9 },
  { id: 'BL-F5-offCentre', title: 'Off centre by half a man: B 0.25 m to the side, both hold at effort 0.5, 9 s', A: hold(0.5, 'under'), B: hold(0.5, 'over'), offsetX: 0.25, durationS: 9 },
  { id: 'BL-F7-hard', title: 'Harder: both drive at effort 1 asking 1.4 m/s, 9 s (the stance holds it)', A: drive(1, 'under', BLOCK_V1_HARD), B: drive(1, 'over', BLOCK_V1_HARD), durationS: 9 },
  { id: 'BL-F8-hardNoHinge', title: 'Harder without the hip hinge: both drive at effort 1 asking 1.4 m/s, 9 s (the push at shoulder height tips them)', A: drive(1, 'under', BLOCK_V1_HARD_NO_HINGE), B: drive(1, 'over', BLOCK_V1_HARD_NO_HINGE), durationS: 9 },
];

/** The BL family: the scenes, and the off-centre one mirrored (BL-F6). */
export const blockingFixtures = (base?: FixtureDef): FixtureDef[] => {
  const defs = BL_SCENES.map((o) => blockScene(o, base));
  const off = defs.find((d) => d.id === 'BL-F5-offCentre')!;
  return [...defs.slice(0, 5), { ...mirrorZ(off), id: 'BL-F6-offCentreMirror', title: 'Off centre by half a man, mirrored (B 0.25 m to the side), both hold at effort 0.5, 9 s' }, ...defs.slice(5)];
};
