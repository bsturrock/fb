// Plain-object vector, quaternion and 3x3 matrix math. SI units, Y up, local +Z forward, local +X anatomical right.

export type Vec3 = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };
/** Row-major 3x3 matrix. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const V0: Readonly<Vec3> = Object.freeze({ x: 0, y: 0, z: 0 });
export const UP: Readonly<Vec3> = Object.freeze({ x: 0, y: 1, z: 0 });

export const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
export const vc = (a: Vec3): Vec3 => ({ x: a.x, y: a.y, z: a.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const addScaled = (a: Vec3, b: Vec3, s: number): Vec3 => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
export const neg = (a: Vec3): Vec3 => ({ x: -a.x, y: -a.y, z: -a.z });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const lenSq = (a: Vec3): number => a.x * a.x + a.y * a.y + a.z * a.z;
export const len = (a: Vec3): number => Math.sqrt(lenSq(a));
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
export const horiz = (a: Vec3): Vec3 => ({ x: a.x, y: 0, z: a.z });
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
/** Normalize with a zero guard; returns `fallback` (default zero) when the length is below eps. */
export function norm(a: Vec3, fallback: Vec3 = V0, eps = 1e-9): Vec3 {
  const l = len(a);
  return l > eps ? scale(a, 1 / l) : vc(fallback);
}
export function clampLen(a: Vec3, max: number): Vec3 {
  const l = len(a);
  if (max <= 0) return v3();
  return l > max ? scale(a, max / l) : vc(a);
}
export const isFiniteVec = (a: Vec3): boolean => Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z);
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const deg = (r: number): number => (r * 180) / Math.PI;
export const rad = (d: number): number => (d * Math.PI) / 180;

/** Signed angle (rad) rotating horizontal direction a to b about +Y. Rotating +Z by +90 deg gives +X. */
export function signedAngleY(a: Vec3, b: Vec3): number {
  const ah = horiz(a);
  const bh = horiz(b);
  return Math.atan2(cross(ah, bh).y, dot(ah, bh));
}
/** Horizontal heading of a direction: atan2(x, z); +Z is 0. */
export const headingOf = (d: Vec3): number => Math.atan2(d.x, d.z);
export const dirFromHeading = (h: number): Vec3 => ({ x: Math.sin(h), y: 0, z: Math.cos(h) });

// ---------- quaternions ----------
export const qIdentity = (): Quat => ({ x: 0, y: 0, z: 0, w: 1 });
export const qc = (q: Quat): Quat => ({ x: q.x, y: q.y, z: q.z, w: q.w });
export function qMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}
export const qConj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w);
  return l > 1e-12 ? { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l } : qIdentity();
}
export function qRot(q: Quat, v: Vec3): Vec3 {
  // v' = q v q*
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}
export const qInvRot = (q: Quat, v: Vec3): Vec3 => qRot(qConj(q), v);
export function qFromAxisAngle(axis: Vec3, angle: number): Quat {
  const a = norm(axis, { x: 0, y: 1, z: 0 });
  const s = Math.sin(angle / 2);
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(angle / 2) };
}
export const qFromYaw = (yaw: number): Quat => qFromAxisAngle(UP, yaw);
/** Shortest rotation taking unit vector a to unit vector b. */
export function qFromUnitVectors(a: Vec3, b: Vec3): Quat {
  const d = dot(a, b);
  if (d < -0.999999) {
    let axis = cross({ x: 1, y: 0, z: 0 }, a);
    if (len(axis) < 1e-6) axis = cross({ x: 0, y: 1, z: 0 }, a);
    return qFromAxisAngle(axis, Math.PI);
  }
  const c = cross(a, b);
  return qNormalize({ x: c.x, y: c.y, z: c.z, w: 1 + d });
}
/** Rotation whose local axes (X, Y, Z) map to the given orthonormal world axes. */
export function qFromBasis(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3): Quat {
  const m00 = xAxis.x, m01 = yAxis.x, m02 = zAxis.x;
  const m10 = xAxis.y, m11 = yAxis.y, m12 = zAxis.y;
  const m20 = xAxis.z, m21 = yAxis.z, m22 = zAxis.z;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s };
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s };
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s };
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s };
  }
  return qNormalize(q);
}
export const forwardOf = (q: Quat): Vec3 => qRot(q, { x: 0, y: 0, z: 1 });
export const upOf = (q: Quat): Vec3 => qRot(q, { x: 0, y: 1, z: 0 });
export const rightOf = (q: Quat): Vec3 => qRot(q, { x: 1, y: 0, z: 0 });
/** Heading (rad) of the body's local forward projected on the floor plane. */
export const yawOf = (q: Quat): number => headingOf(forwardOf(q));
/** Rotation angle (rad) of q relative to identity, 0..pi. */
export function qAngle(q: Quat): number {
  const w = clamp(Math.abs(q.w), 0, 1);
  return 2 * Math.acos(w);
}

// ---------- pose transforms ----------
export interface Pose {
  p: Vec3;
  q: Quat;
}
export const toWorld = (pose: Pose, local: Vec3): Vec3 => add(pose.p, qRot(pose.q, local));
export const toLocal = (pose: Pose, world: Vec3): Vec3 => qInvRot(pose.q, sub(world, pose.p));

// ---------- 3x3 matrices ----------
export const m3Identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function m3FromQuat(q: Quat): Mat3 {
  const { x, y, z, w } = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}
export function m3Mul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0) as Mat3;
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[i * 3 + k] * b[k * 3 + j];
      r[i * 3 + j] = s;
    }
  return r;
}
export const m3T = (a: Mat3): Mat3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
export const m3Vec = (a: Mat3, v: Vec3): Vec3 => ({
  x: a[0] * v.x + a[1] * v.y + a[2] * v.z,
  y: a[3] * v.x + a[4] * v.y + a[5] * v.z,
  z: a[6] * v.x + a[7] * v.y + a[8] * v.z,
});
export const m3Add = (a: Mat3, b: Mat3): Mat3 => a.map((x, i) => x + b[i]) as Mat3;
export const m3Scale = (a: Mat3, s: number): Mat3 => a.map((x) => x * s) as Mat3;
export const m3Diag = (d: Vec3): Mat3 => [d.x, 0, 0, 0, d.y, 0, 0, 0, d.z];
export function m3Det(a: Mat3): number {
  return (
    a[0] * (a[4] * a[8] - a[5] * a[7]) - a[1] * (a[3] * a[8] - a[5] * a[6]) + a[2] * (a[3] * a[7] - a[4] * a[6])
  );
}
export function m3Inverse(a: Mat3): Mat3 | null {
  const det = m3Det(a);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    (a[4] * a[8] - a[5] * a[7]) * inv,
    (a[2] * a[7] - a[1] * a[8]) * inv,
    (a[1] * a[5] - a[2] * a[4]) * inv,
    (a[5] * a[6] - a[3] * a[8]) * inv,
    (a[0] * a[8] - a[2] * a[6]) * inv,
    (a[2] * a[3] - a[0] * a[5]) * inv,
    (a[3] * a[7] - a[4] * a[6]) * inv,
    (a[1] * a[6] - a[0] * a[7]) * inv,
    (a[0] * a[4] - a[1] * a[3]) * inv,
  ];
}
/** Parallel-axis term m * ((r.r) I - r r^T). */
export function m3ParallelAxis(m: number, r: Vec3): Mat3 {
  const rr = dot(r, r);
  return [
    m * (rr - r.x * r.x), -m * r.x * r.y, -m * r.x * r.z,
    -m * r.y * r.x, m * (rr - r.y * r.y), -m * r.y * r.z,
    -m * r.z * r.x, -m * r.z * r.y, m * (rr - r.z * r.z),
  ];
}
/** World inertia tensor from principal inertia, principal frame (local), and body rotation. */
export function worldInertia(principal: Vec3, principalFrame: Quat, bodyRot: Quat): Mat3 {
  const R = m3FromQuat(qMul(bodyRot, principalFrame));
  return m3Mul(m3Mul(R, m3Diag(principal)), m3T(R));
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function closestOnSegment(p: Vec3, a: Vec3, b: Vec3): { point: Vec3; t: number } {
  const ab = sub(b, a);
  const l2 = lenSq(ab);
  const t = l2 > 1e-12 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return { point: addScaled(a, ab, t), t };
}

export const round = (x: number, d = 4): number => {
  const k = 10 ** d;
  return Math.round(x * k) / k;
};
export const rv = (v: Vec3, d = 4): [number, number, number] => [round(v.x, d), round(v.y, d), round(v.z, d)];
