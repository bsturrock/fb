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
 * The first flat stance (plan 16, p34; `FlatStance`): each foot ahead of its hip where the shin over a flat foot leans
 * 5 deg inside the ankle's range (20 of 25 deg); planted, it steps once the shin leans 4 deg past the range (the heel
 * about 2 cm up on the model's 30 cm shoe). The feet stay put until a step gains 16 cm (the stepping model's own: 12),
 * so a man moved steps a committed 15-25 cm, not a patter of short ones; his want leads the hips by half the capture
 * point's lead (a man in a block is held by his man, not running: the full lead makes every step long and early).
 */
export const FLAT_V1: FlatStance = { id: 'flat-v1', marginDeg: 5, stepPastDeg: 4, coverM: 0.16, captureK: 0.5 };

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
export function soleContacts(plan: FootPlan, touchM: number): Vec3[] {
  const out: Vec3[] = [];
  const { he, centerFoot } = plan.shoe;
  for (const s of SIDES) {
    const f = plan.feet[s];
    if (f.mode !== 'planted') continue;
    const cs: Vec3[] = [];
    for (const x of [-he.x, he.x]) for (const z of [centerFoot.z - he.z, centerFoot.z + he.z]) cs.push(add(f.ankleW, qRot(f.footQ, v3(x, centerFoot.y - he.y, z))));
    const low = Math.min(...cs.map((c) => c.y));
    for (const c of cs) if (c.y - low <= touchM) out.push(c);
  }
  return out;
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
