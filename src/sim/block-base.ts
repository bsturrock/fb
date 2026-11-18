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
import type { ArmSide } from './contracts';
import { cross, dot, scale, add, v3, UP, type Vec3 } from './vec';

/**
 * A block profile's base (`BlockProfile.base`; absent: none, the stance and the balance as before). `brace`: the feet's
 * homes cover the centre of pressure the balance asks for, the base reaching `marginM` (m) beyond it along the push line.
 */
export interface BlockBase {
  id: string;
  brace?: { marginM: number };
}

/**
 * The first base (plan 16, p32): the base reaches 8 cm beyond the centre of pressure the balance asks for (some 70 N m
 * at the model body's 88 kg). The model body's heel is 9 cm behind the ankle and its toe 21 cm ahead, so a man holding his
 * 8 deg lean against a light push (the pressure ahead of his hips) keeps his stance; a push that needs the pressure
 * behind his rear heel brings that foot back once its home is a step (the model's 12 cm) away.
 */
export const BASE_V1: BlockBase = { id: 'base-v1', brace: { marginM: 0.08 } };

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
