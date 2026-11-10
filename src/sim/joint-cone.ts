// Plan 12 (moved from ragdoll.ts): the shoulder and hip swing cone of a `JointEnvelope`, in the parent (core) frame. One
// cone serves the ragdoll's soft envelope (plan 09), the fall response's brace clamp, and under a joint-range profile the
// supported pose and the arm-task arms, so every arm source measures the same range.
import type { JointEnvelope } from './profiles';
import { add, cross, dot, len, norm, scale, sub, v3, type Vec3 } from './vec';

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
