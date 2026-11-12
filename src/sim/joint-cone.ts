// Plan 12 (moved from ragdoll.ts): the shoulder and hip swing cone of a `JointEnvelope`, in the parent (core) frame. One
// cone serves the ragdoll's soft envelope (plan 09), the fall response's brace clamp, and under a joint-range profile the
// supported pose and the arm-task arms, so every arm source measures the same range.
import type { JointEnvelope, ShoulderTwistProfile } from './profiles';
import { add, clamp, cross, dot, len, norm, qFromAxisAngle, qFromUnitVectors, qInvRot, qMul, qRot, scale, smooth, sub, v3, wrapPi, type Quat, type Vec3 } from './vec';

const REF = v3(0, -1, 0);

/** Where a parent-frame limb direction sits in the joint's swing cone: distance `d` from the centre, boundary radius there. */
function coneAt(E: JointEnvelope, dir: Vec3, sideSign: number): { c: Vec3; p: Vec3; d: number; sinD: number; R: number; dR: number } {
  const t = (E.cone.tiltDeg * Math.PI) / 180;
  const a = (E.cone.towardDeg * Math.PI) / 180;
  const h = v3(sideSign * Math.sin(a), 0, Math.cos(a));
  const c = add(scale(REF, Math.cos(t)), scale(h, Math.sin(t)));
  const u = add(scale(REF, -Math.sin(t)), scale(h, Math.cos(t)));
  const cosD = Math.max(-1, Math.min(1, dot(dir, c)));
  const p = sub(dir, scale(c, cosD));
  const sinD = len(p);
  const Ra = (E.cone.alongDeg * Math.PI) / 180;
  const Rb = (E.cone.acrossDeg * Math.PI) / 180;
  const cs = sinD > 1e-9 ? dot(p, u) / sinD : 1;
  const sn = sinD > 1e-9 ? dot(p, cross(c, u)) / sinD : 0;
  const R = 1 / Math.sqrt((cs * cs) / (Ra * Ra) + (sn * sn) / (Rb * Rb));
  return { c, p, d: Math.acos(cosD), sinD, R, dR: -(R ** 3) * sn * cs * (1 / (Rb * Rb) - 1 / (Ra * Ra)) };
}

/**
 * How far a limb direction is past the swing boundary (rad, negative inside), to first order a true angular distance,
 * and the unit parent-frame rotation axis that raises it fastest. The restoring torque follows this gradient, so it
 * derives from a potential: a limb cannot slide sideways into a deep error for free and then be paid to leave it.
 */
export function swingExcess(E: JointEnvelope, dir: Vec3, sideSign: number): { rad: number; axis: Vec3 } {
  const { c, d, sinD, R, dR } = coneAt(E, dir, sideSign);
  if (sinD < 1e-6) return { rad: d - R, axis: v3() };
  const radial = norm(cross(c, dir), v3(1, 0, 0));
  const g = sub(radial, scale(cross(dir, radial), dR / Math.max(sinD, 0.05)));
  const n = len(g);
  return { rad: (d - R) / n, axis: scale(g, 1 / n) };
}

/** Parent-frame swing range (deg) along one azimuth about the hanging limb (0 forward, 90 out, 180 back, -90 in). */
export function swingExtentDeg(E: JointEnvelope, azimuthDeg: number): number {
  const a = (azimuthDeg * Math.PI) / 180;
  for (let deg = 0; deg < 180; deg += 0.25) {
    const th = (deg * Math.PI) / 180;
    if (swingExcess(E, v3(Math.sin(th) * Math.sin(a), -Math.cos(th), Math.sin(th) * Math.cos(a)), 1).rad > 0) return deg;
  }
  return 180;
}

/** A parent-frame limb direction pulled inside the swing cone by `marginRad`, along the line from the cone's centre. */
export function clampDirToEnvelope(E: JointEnvelope, dir: Vec3, sideSign: number, marginRad: number): Vec3 {
  const { c, p, d, sinD, R } = coneAt(E, dir, sideSign);
  const r = R - marginRad;
  if (d <= r || sinD < 1e-9) return dir;
  return add(scale(c, Math.cos(r)), scale(p, Math.sin(r) / sinD));
}

/**
 * Plan 14: a parent-frame limb direction eased inside the swing cone: unchanged up to `kneeRad` before the boundary less
 * `marginRad`, then its distance from the cone's centre compressed toward that limit (exponentially, slope 1 where it
 * starts), so a request that runs past the cone bends smoothly onto it instead of turning a corner there.
 */
export function easeDirIntoEnvelope(E: JointEnvelope, dir: Vec3, sideSign: number, marginRad: number, kneeRad: number): Vec3 {
  const { c, p, d, sinD, R } = coneAt(E, dir, sideSign);
  const r0 = R - marginRad - kneeRad;
  if (d <= r0 || sinD < 1e-9) return dir;
  const r = r0 + kneeRad * (1 - Math.exp(-(d - r0) / kneeRad));
  return add(scale(c, Math.cos(r)), scale(p, Math.sin(r) / sinD));
}

/**
 * Plan 12: how far a parent-frame upper-arm direction is behind the body's side line (the coronal plane), deg: positive
 * behind, whatever the elevation. The core frame's +Z is forward.
 */
export const behindDeg = (dir: Vec3): number => (Math.asin(Math.max(-1, Math.min(1, -dir.z / Math.max(len(dir), 1e-12)))) * 180) / Math.PI;

/**
 * Contact motion M1: the external twist (rad, positive external on either side, from the envelope's neutral) of a limb
 * frame built as `hingeChain` builds it: +Y from the distal joint toward the proximal one, X the hinge axis. `dir` is the
 * limb direction (proximal to distal joint) and `hinge` its hinge axis, both unit and in the parent (core) frame. The
 * measure is the ragdoll envelope's (`swingTwistOf` and `externalTwistRad`): the swing is the shortest arc from the
 * hanging limb, the twist what is left about the limb.
 */
export function limbTwistRad(E: JointEnvelope, dir: Vec3, hinge: Vec3, sideSign: number): number {
  // X = swing * rotY(tw) * (1, 0, 0), and rotY(tw) * (1, 0, 0) = (cos tw, 0, -sin tw)
  const v = qInvRot(qFromUnitVectors(REF, dir), hinge);
  return wrapPi(sideSign * (Math.atan2(-v.z, v.x) - (E.neutralTwistDeg * Math.PI) / 180));
}

/** An arm's direction and hinge axis (unit, core frame) from a shoulder, elbow and distal point (world); null when straight. */
function armFrame(coreQ: Quat, sh: Vec3, elbow: Vec3, end: Vec3): { dir: Vec3; hinge: Vec3 } | null {
  const dA = sub(elbow, sh);
  const dB = sub(end, elbow);
  const la = len(dA);
  const lb = len(dB);
  if (la < 1e-9 || lb < 1e-9) return null;
  const c = cross(dA, dB);
  const lc = len(c) / (la * lb);
  if (lc < 1e-6) return null;
  return { dir: qInvRot(coreQ, scale(dA, 1 / la)), hinge: qInvRot(coreQ, scale(c, 1 / (lc * la * lb))) };
}

/** The upper arm's external twist (rad) for a shoulder, elbow and distal point (world), or null for a straight arm. */
export function armTwistRad(E: JointEnvelope, coreQ: Quat, sh: Vec3, elbow: Vec3, end: Vec3, sideSign: number): number | null {
  const f = armFrame(coreQ, sh, elbow, end);
  return f ? limbTwistRad(E, f.dir, f.hinge, sideSign) : null;
}

/** Ladder 11d: the anatomical twist's reference above horizontal, 35 deg forward of the hanging limb (sagittal plane). */
const ANAT_REF = v3(0, -Math.cos((35 * Math.PI) / 180), Math.sin((35 * Math.PI) / 180));
const ANAT_REF_Q = qFromUnitVectors(REF, ANAT_REF);
/** Ladder 11d: the limb height (unit direction +Y, about 33 deg above horizontal) from which the anatomical twist is the reference's alone. */
export const ANAT_BLEND_Y = 0.55;

/**
 * Ladder 11d: the external twist (rad) measured so that it is regular through an upper arm pointing straight up. The
 * envelope's measure (`limbTwistRad`) takes the swing as the shortest arc from the hanging limb; straight up that arc is a
 * half turn about an axis that turns with the limb's azimuth, so near vertical a small rotation of the limb changes the
 * reading by up to tan(swing / 2) times as much (46 at the plan 12 cone's tip). At and below horizontal this is exactly
 * the envelope's measure; above, it blends (a smoothstep in the limb's height up to `ANAT_BLEND_Y`) into the twist left
 * after the shortest arc from the hanging limb to `ANAT_REF` and from there to the limb. The two differ by a function of
 * the direction alone, regular below `ANAT_BLEND_Y`, so the blend is continuous; its one singular direction is the
 * reference's opposite, 35 deg behind straight up, outside the shoulder cone. A turn about the limb changes either
 * measure by the same angle.
 */
export function limbAnatomicalTwistRad(E: JointEnvelope, dir: Vec3, hinge: Vec3, sideSign: number): number {
  const w = smooth(dir.y / ANAT_BLEND_Y);
  const v0 = qInvRot(qFromUnitVectors(REF, dir), hinge);
  let t = Math.atan2(-v0.z, v0.x);
  if (w > 0) {
    const v1 = qInvRot(qMul(qFromUnitVectors(ANAT_REF, dir), ANAT_REF_Q), hinge);
    const tr = Math.atan2(-v1.z, v1.x);
    t = w >= 1 ? tr : t - w * wrapPi(t - tr);
  }
  return wrapPi(sideSign * (t - (E.neutralTwistDeg * Math.PI) / 180));
}

/**
 * Ladder 13a: the scale that turns an excess of the anatomical twist (`limbAnatomicalTwistRad`) at limb direction `dir`
 * (unit, parent frame) into, to first order, the turn that removes it: the twist's fastest rate per radian of turn is
 * 1 / cos(half the angle from its reference), so the scale is that cosine, blended as the measure blends. Up to horizontal
 * it is plan 09's cos(swing / 2) (the swing from the hanging limb); from `ANAT_BLEND_Y` up, cos(half the angle from
 * `ANAT_REF`), 0 only at the measure's one singular direction, the reference's opposite.
 */
export function anatomicalTwistReach(dir: Vec3): number {
  const r0 = Math.sqrt(Math.max(0, (1 - dir.y) / 2));
  const w = smooth(dir.y / ANAT_BLEND_Y);
  if (w <= 0) return r0;
  const r1 = Math.sqrt(Math.max(0, (1 + dot(dir, ANAT_REF)) / 2));
  return r0 + w * (r1 - r0);
}

/** Ladder 11d: an arm twist measure (envelope, core rotation, shoulder, elbow, distal point, side: rad, null when straight). */
export type ArmTwistMeasure = (E: JointEnvelope, coreQ: Quat, sh: Vec3, elbow: Vec3, end: Vec3, sideSign: number) => number | null;

/** Ladder 11d: the upper arm's anatomical external twist (`limbAnatomicalTwistRad`), or null for a straight arm. */
export function armAnatomicalTwistRad(E: JointEnvelope, coreQ: Quat, sh: Vec3, elbow: Vec3, end: Vec3, sideSign: number): number | null {
  const f = armFrame(coreQ, sh, elbow, end);
  return f ? limbAnatomicalTwistRad(E, f.dir, f.hinge, sideSign) : null;
}

/**
 * Contact motion M1: the allowed external twist this step, as [lo, hi] (rad) about the middle of the envelope's twist
 * range: that range less `marginDeg`, and within `maxRateRadPs * dtS` of the previous shown twist. When the previous twist
 * is further outside than one step, the window is the one point one step toward the range.
 */
export function twistWindow(E: JointEnvelope, T: ShoulderTwistProfile, prevRad: number | null, dtS: number): { mid: number; lo: number; hi: number } {
  const mid = (((E.twistDeg[0] + E.twistDeg[1]) / 2) * Math.PI) / 180;
  const h = (((E.twistDeg[1] - E.twistDeg[0]) / 2 - T.marginDeg) * Math.PI) / 180;
  if (prevRad === null || !(dtS > 0)) return { mid, lo: -h, hi: h };
  const p = wrapPi(prevRad - mid);
  const d = T.maxRateRadPs * dtS;
  if (p + d < -h) return { mid, lo: p + d, hi: p + d };
  if (p - d > h) return { mid, lo: p - d, hi: p - d };
  return { mid, lo: Math.max(-h, p - d), hi: Math.min(h, p + d) };
}

/**
 * Contact motion M1: the elbow turned about the shoulder-to-end line (the end, and so the reach, unchanged) until the
 * upper arm's external twist is inside `win`, by the smallest turn. A twist inside is unchanged; a straight arm (no bend
 * plane) is returned as given. `twistRad` is the twist shown after the fit. `measure`: the twist `win` is in (ladder 11d).
 */
/** Contact motion M1: `fitElbowTwist` stops once the fitted twist is this close to its window (rad). */
export const TWIST_FIT_TOL_RAD = 1e-5;

export function fitElbowTwist(E: JointEnvelope, coreQ: Quat, sh: Vec3, elbow: Vec3, end: Vec3, sideSign: number, win: { mid: number; lo: number; hi: number }, measure: ArmTwistMeasure = armTwistRad, maxMoveM = Infinity): { elbow: Vec3; twistRad: number | null; turned: boolean } {
  const t0 = measure(E, coreQ, sh, elbow, end, sideSign);
  if (t0 === null) return { elbow, twistRad: null, turned: false };
  const u0 = wrapPi(t0 - win.mid);
  if (u0 >= win.lo - 1e-9 && u0 <= win.hi + 1e-9) return { elbow, twistRad: t0, turned: false };
  const target = clamp(u0, win.lo, win.hi);
  const axis = norm(sub(end, sh), v3(0, -1, 0));
  const off = sub(elbow, sh);
  const at = (phi: number): Vec3 => add(sh, qRot(qFromAxisAngle(axis, phi), off));
  const f = (phi: number): number | null => {
    const t = measure(E, coreQ, sh, at(phi), end, sideSign);
    return t === null ? null : wrapPi(t - win.mid - target);
  };
  // Newton on the turn angle (the twist changes by about one radian per radian of turn, either sign)
  let phi = 0;
  let fp = wrapPi(u0 - target);
  let best = { phi: 0, err: Math.abs(fp) };
  for (let i = 0; i < 8 && Math.abs(fp) > TWIST_FIT_TOL_RAD; i++) {
    const h = 1e-4;
    const f1 = f(phi + h);
    if (f1 === null) break;
    const g = wrapPi(f1 - fp) / h;
    if (Math.abs(g) < 0.05) break;
    phi += clamp(-fp / g, -Math.PI / 2, Math.PI / 2);
    const fn = f(phi);
    if (fn === null) break;
    fp = fn;
    if (Math.abs(fp) < best.err) best = { phi, err: Math.abs(fp) };
  }
  if (best.phi === 0) return { elbow, twistRad: t0, turned: false };
  // ladder 12b: the elbow moves at most `maxMoveM` about the line (a folded arm's short line: the twist hardly follows
  // the turn there, and the fit swung the elbow 38 cm in one substep, HC-F3-lowRunner)
  const hM = len(sub(off, scale(axis, dot(off, axis))));
  const lim = maxMoveM / Math.max(hM, 0.02);
  const e = at(clamp(best.phi, -lim, lim));
  return { elbow: e, twistRad: measure(E, coreQ, sh, e, end, sideSign), turned: true };
}

/** Ladder 11d: limb heights (unit direction +Y) over which `guardEnvelopeTwist` lets go of the range. */
const GUARD_FADE_Y: [number, number] = [0.3, ANAT_BLEND_Y];

/**
 * Ladder 11d: with the window in the anatomical measure, the envelope's own twist (`armTwistRad`, the ragdoll's limit) kept
 * inside `range` where that measure is regular. Above horizontal the two measures part, so an arm held at the window's
 * edge could stand past the ragdoll's range by their difference; there the elbow is turned (the end kept) back into the
 * range in the envelope's measure. The range widens by up to a half turn between the `GUARD_FADE_Y` heights (a
 * smoothstep), so the guard lets go continuously before the envelope's measure turns singular overhead.
 */
export function guardEnvelopeTwist(E: JointEnvelope, coreQ: Quat, sh: Vec3, elbow: Vec3, end: Vec3, sideSign: number, range: { mid: number; lo: number; hi: number }): { elbow: Vec3; turned: boolean } {
  const fr = armFrame(coreQ, sh, elbow, end);
  if (!fr || fr.dir.y <= 0 || fr.dir.y >= GUARD_FADE_Y[1]) return { elbow, turned: false };
  const wide = Math.PI * smooth((fr.dir.y - GUARD_FADE_Y[0]) / (GUARD_FADE_Y[1] - GUARD_FADE_Y[0]));
  const f = fitElbowTwist(E, coreQ, sh, elbow, end, sideSign, { mid: range.mid, lo: range.lo - wide, hi: range.hi + wide });
  return { elbow: f.elbow, turned: f.turned };
}

/**
 * Contact motion M1: the distal end turned about the upper arm (shoulder to elbow) until the twist is inside `win`: the
 * upper arm's direction, and so its swing and the cone, unchanged; the end moves. For an arm the cone has already turned
 * off its target, after `fitElbowTwist` and the cone have left the twist just outside the window.
 */
export function turnForearmTwist(E: JointEnvelope, coreQ: Quat, sh: Vec3, elbow: Vec3, end: Vec3, sideSign: number, win: { mid: number; lo: number; hi: number }, measure: ArmTwistMeasure = armTwistRad): Vec3 {
  const t0 = measure(E, coreQ, sh, elbow, end, sideSign);
  if (t0 === null) return end;
  const u0 = wrapPi(t0 - win.mid);
  const dl = clamp(u0, win.lo, win.hi) - u0;
  if (Math.abs(dl) < 1e-9) return end;
  const axis = norm(sub(elbow, sh), v3(0, -1, 0));
  // the twist is about the limb's +Y (toward the shoulder), signed external by side: a turn of -side * dl about the
  // shoulder-to-elbow axis raises the external twist by dl
  return add(elbow, qRot(qFromAxisAngle(axis, -sideSign * dl), sub(end, elbow)));
}

/**
 * Ladder 11b: the ankle turned about the thigh (hip to knee) until the thigh's axial rotation (`armTwistRad`'s measure:
 * the hinge chain's frames are the same for an arm and a leg) is inside the envelope's twist range less `marginDeg`: the
 * thigh unchanged, the ankle off its target. A rotation inside the range is unchanged, unless the previous shown leg was
 * turned (`held`): then it is reached from `prevRad` (the previous shown rotation) at most `maxRateRadPs * dtS` per call,
 * so a leg let go by the range turns back at that rate. One outside is read on its branch within half a turn of
 * `prevRad`, so a rotation near half a turn from the range's middle goes to the edge it left by rather than to the edge
 * its sign gives that step, and is brought to the range at most `maxRateRadPs * dtS` from `prevRad`. `held` in the
 * result: the ankle was turned.
 */
export function fitThighTwist(E: JointEnvelope, T: ShoulderTwistProfile, coreQ: Quat, hip: Vec3, knee: Vec3, ankle: Vec3, sideSign: number, prevRad: number | null, held: boolean, dtS: number): { ankle: Vec3; held: boolean } {
  const t0 = armTwistRad(E, coreQ, hip, knee, ankle, sideSign);
  if (t0 === null) return { ankle, held: false };
  const mid = (((E.twistDeg[0] + E.twistDeg[1]) / 2) * Math.PI) / 180;
  const h = (((E.twistDeg[1] - E.twistDeg[0]) / 2 - T.marginDeg) * Math.PI) / 180;
  let u0 = wrapPi(t0 - mid);
  if (Math.abs(u0) <= h && !(held && prevRad !== null)) return { ankle, held: false };
  let target = clamp(u0, -h, h);
  if (prevRad !== null) {
    const r = wrapPi(prevRad - mid);
    u0 = r + wrapPi(u0 - r);
    target = clamp(u0, -h, h);
    if (dtS > 0) target = clamp(target, r - T.maxRateRadPs * dtS, r + T.maxRateRadPs * dtS);
  }
  const dl = target - u0;
  if (Math.abs(dl) < 1e-9) return { ankle, held: false };
  const axis = norm(sub(knee, hip), v3(0, -1, 0));
  // as `turnForearmTwist`: a turn of -side * dl about the hip-to-knee axis raises the external rotation by dl
  return { ankle: add(knee, qRot(qFromAxisAngle(axis, -sideSign * dl), sub(ankle, knee))), held: true };
}
