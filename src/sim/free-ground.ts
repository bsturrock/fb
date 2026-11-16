// Plan 15 (contact footwork), free ground: "may a leg stand here". The ground minus the footprints of the other
// players' bodies and legs, and the whole leg standing on a place clear of their parts, each moved along its motion over
// a horizon (the step's remaining time: a foot lands at a place on the ground, so the parts move by their own velocity),
// and the nearest free place to a wanted one within reach of a hip. Pure and deterministic:
// - a footprint is a body part's span below the top of the stepping player's shin, projected onto the ground: a convex
//   outline (one point for a ball, a capsule's segment, a box's outline) with a radius, and its velocity;
// - a foot asks with its own radius (a disc over its shoe) and, so the legs never cross, a side wall: the line of its
//   other foot, which it keeps a separation to its own side of; and with its leg: the leg (thigh, shin, shoe) that would
//   stand on a place, which must be clear of every part by a skin (Rapier's contact query, as the leg guard asks it)
//   and inside its joint ranges (the stepping player's own, asked of the place);
// - a place is free when it is clear of every moved footprint by the footprint's radius plus the foot's, on its side of
//   the wall, and its leg stands there (clear and in range). Nothing else decides whether a place is blocked;
// - places are ordered by how deep the foot stands in the other players (`depthAt`: 0 free), and the least deep within
//   reach is the one a foot takes (`leastDeep`: the nearest free place when there is one).
// The adapter from a simulation (`bodyParts`, `groundFor`) reads each player's parts once per substep: a supported or
// falling player's proxy colliders and published limbs (his pose of the last substep), a ragdoll's segment colliders.
import RAPIER from '@dimforge/rapier3d-compat';
import type { ArmSide, PlayerId } from './contracts';
import { poseLimbShapes, type PhysicalPose, type PoseShape } from './pose';
import type { RagdollProfile } from './profiles';
import { addScaled, dist, len, qFromUnitVectors, qRot, scale, sub, v3, vc, type Quat, type Vec3 } from './vec';

/** A point or direction on the ground plane. */
export interface Pt {
  x: number;
  z: number;
}

/**
 * One body part's footprint: a convex outline on the ground (one point: a ball's centre; two: a capsule's segment; more:
 * a box's outline, counter-clockwise), the radius about it (m), and its velocity (m/s).
 */
export interface Footprint {
  pts: Pt[];
  r: number;
  v: Pt;
  key: string;
}

export interface FreeGround {
  prints: Footprint[];
  /** The parts themselves, for the whole leg (absent: the footprints only). */
  parts?: Part[];
}

/**
 * The foot that asks: its radius on the ground (m), the side wall of its other foot (`p` the other foot's point, `n` the
 * unit direction of this foot's own side): a free point lies at least `sepM` along `n` from `p`; and its leg: the shapes
 * (thigh, shin, shoe, in that order) of the leg standing on a place (its point on the ground), which must be clear of
 * every part by `skinM`, and whether that leg is inside its joint ranges there (absent: always). The place under the
 * hip is the leg's most natural: a leg out of range anywhere is out of range there too.
 */
export interface FootQuery {
  clearM: number;
  wall?: { p: Pt; n: Pt; sepM: number };
  leg?: { at: (p: Vec3) => PoseShape[]; skinM: number; inRange?: (p: Vec3) => boolean };
}

const EPS = 1e-9;
/** How far inside a boundary a point may lie and still be free (m): rounding only. */
const TOL = 1e-7;
const sub2 = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, z: a.z - b.z });
const add2 = (a: Pt, b: Pt, s = 1): Pt => ({ x: a.x + b.x * s, z: a.z + b.z * s });
const dot2 = (a: Pt, b: Pt): number => a.x * b.x + a.z * b.z;
const cross2 = (a: Pt, b: Pt): number => a.x * b.z - a.z * b.x;
const len2 = (a: Pt): number => Math.hypot(a.x, a.z);
const pt = (p: Vec3): Pt => ({ x: p.x, z: p.z });

/** Distance from `p` to segment a-b. */
function segDist(p: Pt, a: Pt, b: Pt): number {
  const d = sub2(b, a);
  const L = dot2(d, d);
  const t = L > 0 ? Math.max(0, Math.min(1, dot2(sub2(p, a), d) / L)) : 0;
  return len2(sub2(p, add2(a, d, t)));
}

/** Distance from `p` to a convex outline (0 inside it). */
export function outlineDist(pts: Pt[], p: Pt): number {
  if (pts.length === 1) return len2(sub2(p, pts[0]));
  if (pts.length === 2) return segDist(p, pts[0], pts[1]);
  let inside = true;
  let d = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (cross2(sub2(b, a), sub2(p, a)) < 0) inside = false;
    d = Math.min(d, segDist(p, a, b));
  }
  return inside ? 0 : d;
}

/** Signed distance from `p` to a convex outline: inside it, less than zero by its distance to the edge. */
function outlineSigned(pts: Pt[], p: Pt): number {
  const d = outlineDist(pts, p);
  if (d > 0 || pts.length < 3) return d;
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) m = Math.min(m, segDist(p, pts[i], pts[(i + 1) % pts.length]));
  return -m;
}

/** A footprint where its motion puts it `horizonS` from now. */
const moved = (f: Footprint, horizonS: number): Pt[] => (horizonS === 0 ? f.pts : f.pts.map((p) => add2(p, f.v, horizonS)));

/** May a foot (`q`) stand at `p` (its point on the ground, y ignored) `horizonS` from now. */
export function isFree(g: FreeGround, p: Vec3, horizonS: number, q: FootQuery): boolean {
  const x = pt(p);
  if (q.wall && dot2(sub2(x, q.wall.p), q.wall.n) < q.wall.sepM - TOL) return false;
  for (const f of g.prints) if (outlineDist(moved(f, horizonS), x) < f.r + q.clearM - TOL) return false;
  return !q.leg || ((!q.leg.inRange || q.leg.inRange(p)) && !legHit(g, q.leg.at(p), horizonS, q.leg.skinM));
}

/**
 * How deep a foot (`q`) stands at `p` `horizonS` from now (m): 0 where it is free (`isFree`), otherwise how far its shoe
 * is past its clearance into the deepest moved footprint, or its leg past its skin into the deepest part, whichever is
 * more; Infinity where it is no place at all (across the wall, or its leg out of range).
 */
export function depthAt(g: FreeGround, p: Vec3, horizonS: number, q: FootQuery): number {
  const x = pt(p);
  if (q.wall && dot2(sub2(x, q.wall.p), q.wall.n) < q.wall.sepM - TOL) return Infinity;
  if (q.leg?.inRange && !q.leg.inRange(p)) return Infinity;
  let d = 0;
  for (const f of g.prints) d = Math.max(d, f.r + q.clearM - outlineSigned(moved(f, horizonS), x));
  if (q.leg) {
    const hit = legHit(g, q.leg.at(p), horizonS, q.leg.skinM);
    if (hit) d = Math.max(d, q.leg.skinM - hit.gap);
  }
  return d > TOL ? d : 0;
}

/** A disc's samples for the depth searches: `first`, its centre, then its rings and spokes. */
function discSamples(c: Pt, r: number, first: Pt): Pt[] {
  const out: Pt[] = [first, c];
  for (let i = 1; i <= DEEP_RINGS; i++)
    for (let k = 0; k < DEEP_SPOKES; k++) {
      const a = (2 * Math.PI * k) / DEEP_SPOKES;
      out.push({ x: c.x + ((r * i) / DEEP_RINGS) * Math.sin(a), z: c.z + ((r * i) / DEEP_RINGS) * Math.cos(a) });
    }
  return out;
}

/** How the least-deep search samples the reach disc where no place is free: rings about the hip, spokes on each. */
const DEEP_RINGS = 4;
const DEEP_SPOKES = 12;
/** How many halvings move the least-deep sample toward the want. */
const DEEP_HALVINGS = 6;

/**
 * The place within `reachM` of `hip` (horizontal) where a foot (`q`) stands least deep (`depthAt`) `horizonS` from now,
 * and its depth: among the places within `equalM` of the least depth, one within `shortM` of the hip (a short step)
 * first, then the nearest `want`; null when no place within reach is in range. With free ground within reach it is the
 * nearest free place (`nearestFree`, depth 0), within the short step first; otherwise the least depth is read from a
 * sample of the disc (the want, the place under the hip, rings and spokes), the first of the samples within `equalM` of
 * it taken in that order, and moved toward the want as far as its depth stays within `equalM` of the least.
 */
export function leastDeep(g: FreeGround, want: Vec3, hip: Vec3, shortM: number, reachM: number, horizonS: number, q: FootQuery, equalM: number): { p: Vec3; depthM: number } | null {
  const free = nearestFree(g, want, hip, Math.min(shortM, reachM), horizonS, q) ?? (reachM > shortM ? nearestFree(g, want, hip, reachM, horizonS, q) : null);
  if (free) return { p: free, depthM: 0 };
  const H = pt(hip);
  const W = pt(want);
  const at = (c: Pt): Vec3 => v3(c.x, want.y, c.z);
  const depth = (c: Pt): number => (len2(sub2(c, H)) > reachM + TOL ? Infinity : depthAt(g, at(c), horizonS, q));
  const samples = discSamples(H, reachM, W);
  const ds = samples.map(depth);
  const least = Math.min(...ds);
  if (!Number.isFinite(least)) return null;
  const long = (c: Pt): number => (len2(sub2(c, H)) > shortM + TOL ? 1 : 0);
  let bi = -1;
  for (let i = 0; i < samples.length; i++) {
    if (ds[i] > least + equalM) continue;
    const c = samples[i];
    if (bi < 0 || long(c) < long(samples[bi]) || (long(c) === long(samples[bi]) && len2(sub2(c, W)) < len2(sub2(samples[bi], W)))) bi = i;
  }
  let a = samples[bi];
  let da = ds[bi];
  let b = W;
  for (let i = 0; i < DEEP_HALVINGS && bi !== 0; i++) {
    const m = { x: 0.5 * (a.x + b.x), z: 0.5 * (a.z + b.z) };
    const dm = depth(m);
    if (dm <= least + equalM) [a, da] = [m, dm];
    else b = m;
  }
  return { p: at(a), depthM: da };
}

// The boundary pieces of the region a point may not enter (each footprint dilated by its radius and the foot's), the
// reach circle and the wall: circles (an outline's corners) and lines (its edges pushed out; the wall, unbounded).
type Piece = { kind: 'circle'; c: Pt; R: number } | { kind: 'line'; a: Pt; b: Pt; bounded: boolean };

function piecesOf(pts: Pt[], R: number): Piece[] {
  const out: Piece[] = pts.map((c) => ({ kind: 'circle', c, R }));
  if (pts.length === 2) {
    const d = sub2(pts[1], pts[0]);
    const L = len2(d);
    if (L > EPS) {
      const n = { x: (d.z / L) * R, z: (-d.x / L) * R };
      out.push({ kind: 'line', a: add2(pts[0], n), b: add2(pts[1], n), bounded: true }, { kind: 'line', a: add2(pts[0], n, -1), b: add2(pts[1], n, -1), bounded: true });
    }
  } else if (pts.length > 2)
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const d = sub2(b, a);
      const L = len2(d);
      if (L <= EPS) continue;
      // (counter-clockwise: the outside of an edge is to its right)
      const n = { x: (d.z / L) * R, z: (-d.x / L) * R };
      out.push({ kind: 'line', a: add2(a, n), b: add2(b, n), bounded: true });
    }
  return out;
}

/** The nearest point of a piece to `x`. */
function project(pc: Piece, x: Pt): Pt {
  if (pc.kind === 'circle') {
    const d = sub2(x, pc.c);
    const L = len2(d);
    return L > EPS ? add2(pc.c, d, pc.R / L) : { x: pc.c.x + pc.R, z: pc.c.z };
  }
  const d = sub2(pc.b, pc.a);
  const L = dot2(d, d);
  let t = L > 0 ? dot2(sub2(x, pc.a), d) / L : 0;
  if (pc.bounded) t = Math.max(0, Math.min(1, t));
  return add2(pc.a, d, t);
}

/** Where two pieces cross (none, one or two points). */
function meet(p: Piece, q: Piece): Pt[] {
  if (p.kind === 'circle' && q.kind === 'circle') {
    const d = sub2(q.c, p.c);
    const D = len2(d);
    if (D < EPS || D > p.R + q.R || D < Math.abs(p.R - q.R)) return [];
    const a = (p.R * p.R - q.R * q.R + D * D) / (2 * D);
    const h = Math.sqrt(Math.max(0, p.R * p.R - a * a));
    const m = add2(p.c, d, a / D);
    const n = { x: -d.z / D, z: d.x / D };
    return [add2(m, n, h), add2(m, n, -h)];
  }
  if (p.kind === 'line' && q.kind === 'line') {
    const r = sub2(p.b, p.a);
    const s = sub2(q.b, q.a);
    const den = cross2(r, s);
    if (Math.abs(den) < EPS) return [];
    const w = sub2(q.a, p.a);
    const t = cross2(w, s) / den;
    const u = cross2(w, r) / den;
    if ((p.bounded && (t < -EPS || t > 1 + EPS)) || (q.bounded && (u < -EPS || u > 1 + EPS))) return [];
    return [add2(p.a, r, t)];
  }
  const c = (p.kind === 'circle' ? p : q) as Extract<Piece, { kind: 'circle' }>;
  const l = (p.kind === 'line' ? p : q) as Extract<Piece, { kind: 'line' }>;
  const d = sub2(l.b, l.a);
  const f = sub2(l.a, c.c);
  const A = dot2(d, d);
  if (A < EPS) return [];
  const B = 2 * dot2(f, d);
  const C = dot2(f, f) - c.R * c.R;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out: Pt[] = [];
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) if (!l.bounded || (t >= -EPS && t <= 1 + EPS)) out.push(add2(l.a, d, t));
  return out;
}

/** How many places the whole leg is tried at before a search gives up (each a cut of the ground, see `cutOf`). */
const LEG_TRIES = 8;

/**
 * The nearest point to `want` (its point on the ground) that a foot (`q`) may stand on `horizonS` from now, within
 * `reachM` of `hip` (horizontal); null when there is none. On the ground it is exact (`nearestOnGround`); a place whose
 * leg is out of its range is cut from the ground beyond the range's edge toward the hip (`rangeCut`), one whose leg is
 * not clear by the part it meets (`cutOf`), and the search asked again, at most LEG_TRIES times.
 */
export function nearestFree(g: FreeGround, want: Vec3, hip: Vec3, reachM: number, horizonS: number, q: FootQuery): Vec3 | null {
  if (!q.leg) return nearestOnGround(g.prints, want, hip, reachM, horizonS, q);
  const inRange = q.leg.inRange;
  const under = v3(hip.x, want.y, hip.z);
  if (inRange && !inRange(under)) return null;
  const prints = [...g.prints];
  for (let i = 0; i < LEG_TRIES; i++) {
    const p = nearestOnGround(prints, want, hip, reachM, horizonS, q);
    if (!p) return null;
    if (inRange && !inRange(p)) {
      prints.push(rangeCut(inRange, p, under, q));
      continue;
    }
    const shapes = q.leg.at(p);
    const hit = legHit(g, shapes, horizonS, q.leg.skinM);
    if (!hit) return p;
    prints.push(cutOf(hit, shapes, p, hip, q));
  }
  return null;
}

/** A range cut's extent (m): far larger than a step, so the cut is the ground beyond a line. */
const RANGE_CUT_M = 3;

/**
 * The ground a leg out of its range at `p` cannot stand on: beyond the range's edge, the line through two points of that
 * edge (each found by halving a ray from the place under the hip, which is in range: the ray to `p` and one turned an
 * eighth of a radian either way), the side away from the hip; across the first ray where no turned one finds an edge. A cut only
 * steers the search, which verifies the next place.
 */
function rangeCut(inRange: (p: Vec3) => boolean, p: Vec3, under: Vec3, q: FootQuery): Footprint {
  const H = pt(under);
  const at = (c: Pt): Vec3 => v3(c.x, p.y, c.z);
  const edge = (to: Pt): Pt => {
    let a = H;
    let b = to;
    for (let i = 0; i < 12; i++) {
      const m = { x: 0.5 * (a.x + b.x), z: 0.5 * (a.z + b.z) };
      if (inRange(at(m))) a = m;
      else b = m;
    }
    return a;
  };
  const d = sub2(pt(p), H);
  const L = len2(d);
  const u = L > 1e-9 ? { x: d.x / L, z: d.z / L } : { x: 1, z: 0 };
  const b1 = edge(pt(p));
  const c = Math.cos(0.125);
  const sn = Math.sin(0.125);
  const far = [add2(H, { x: d.x * c - d.z * sn, z: d.x * sn + d.z * c }), add2(H, { x: d.x * c + d.z * sn, z: -d.x * sn + d.z * c })].find((f) => !inRange(at(f)));
  const t0 = far ? sub2(edge(far), b1) : null;
  const t = t0 && len2(t0) > 1e-6 ? { x: t0.x / len2(t0), z: t0.z / len2(t0) } : { x: -u.z, z: u.x };
  // (the line's normal, away from the hip)
  const n = t.z * u.x - t.x * u.z >= 0 ? { x: t.z, z: -t.x } : { x: -t.z, z: t.x };
  const o = add2(b1, n, q.clearM);
  const corners = [add2(o, t, -RANGE_CUT_M), add2(o, t, RANGE_CUT_M)];
  return { pts: hull([...corners, ...corners.map((x) => add2(x, n, 2 * RANGE_CUT_M))]), r: 0, v: { x: 0, z: 0 }, key: 'range' };
}

/**
 * The nearest point to `want` on the ground: clear of the footprints `prints`, on its side of the wall, within reach.
 * Exact: the nearest point of the free region within reach is `want` itself, the nearest point of one boundary piece, or
 * a point where two pieces cross; every such candidate is tested and the nearest free one taken (the first of equals, in
 * a fixed order).
 */
function nearestOnGround(prints: Footprint[], want: Vec3, hip: Vec3, reachM: number, horizonS: number, q: FootQuery): Vec3 | null {
  const x = pt(want);
  const H = pt(hip);
  const near: { pts: Pt[]; R: number }[] = [];
  for (const f of prints) {
    const pts = moved(f, horizonS);
    const R = f.r + q.clearM;
    // (a footprint whose dilated region does not reach the reach disc changes nothing in it)
    if (outlineDist(pts, H) < R + reachM) near.push({ pts, R });
  }
  const ok = (c: Pt): boolean => {
    if (len2(sub2(c, H)) > reachM + TOL) return false;
    if (q.wall && dot2(sub2(c, q.wall.p), q.wall.n) < q.wall.sepM - TOL) return false;
    for (const f of near) if (outlineDist(f.pts, c) < f.R - TOL) return false;
    return true;
  };
  const at = (c: Pt): Vec3 => v3(c.x, want.y, c.z);
  if (ok(x)) return at(x);
  const pieces: Piece[] = [{ kind: 'circle', c: H, R: reachM }];
  if (q.wall) {
    const w = q.wall;
    const o = add2(w.p, w.n, w.sepM);
    pieces.push({ kind: 'line', a: o, b: add2(o, { x: -w.n.z, z: w.n.x }), bounded: false });
  }
  for (const f of near) pieces.push(...piecesOf(f.pts, f.R));
  let best: Pt | null = null;
  let bestD = Infinity;
  const consider = (c: Pt): void => {
    const d = len2(sub2(c, x));
    if (d < bestD - 1e-12 && ok(c)) {
      best = c;
      bestD = d;
    }
  };
  for (const pc of pieces) consider(project(pc, x));
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) for (const c of meet(pieces[i], pieces[j])) consider(c);
  return best ? at(best) : null;
}

// ---------------------------------------------------------------------------------------------------- the whole leg

/** A shape as Rapier queries it: its shape, centre and rotation, bounding radius about the centre, and its girth (m). */
interface Solid {
  shape: RAPIER.Shape;
  c: Vec3;
  q: Quat;
  R: number;
  girth: number;
}
const NO_TURN: Quat = { x: 0, y: 0, z: 0, w: 1 };

function solidOf(s: PartShape | PoseShape): Solid {
  if (s.kind === 'ball') return { shape: new RAPIER.Ball(s.r), c: s.c, q: NO_TURN, R: s.r, girth: s.r };
  if (s.kind === 'box') return { shape: new RAPIER.Cuboid(s.he.x, s.he.y, s.he.z), c: s.c, q: s.q, R: len(s.he), girth: Math.min(s.he.x, s.he.y, s.he.z) };
  const d = sub(s.b, s.a);
  const L = len(d);
  const c = addScaled(s.a, d, 0.5);
  if (L < 1e-6) return { shape: new RAPIER.Ball(s.r), c, q: NO_TURN, R: s.r, girth: s.r };
  return { shape: new RAPIER.Capsule(L / 2, s.r), c, q: qFromUnitVectors(v3(0, 1, 0), scale(d, 1 / L)), R: L / 2 + s.r, girth: s.r };
}

/** Each part's solid, built once (a part is read for every foot of every player in its substep). */
const partSolids = new WeakMap<Part, Solid>();
const solidOfPart = (p: Part): Solid => {
  let s = partSolids.get(p);
  if (!s) partSolids.set(p, (s = solidOf(p.shape)));
  return s;
};

/** Where a leg meets a part: the gap (m, < 0 inside), which leg shape, its point there and the part's outward normal. */
export interface LegHit {
  gap: number;
  i: number;
  point: Vec3;
  normal: Vec3;
  girth: number;
}

/** The leg's (`shapes`) nearest approach to a part `horizonS` from now closer than `skinM` (the least gap); null when none is. */
export function legHit(g: FreeGround, shapes: PoseShape[], horizonS: number, skinM: number): LegHit | null {
  if (!g.parts?.length) return null;
  let worst: LegHit | null = null;
  for (let i = 0; i < shapes.length; i++) {
    const a = solidOf(shapes[i]);
    for (const p of g.parts) {
      const b = solidOfPart(p);
      const c = horizonS === 0 ? b.c : v3(b.c.x + p.v.x * horizonS, b.c.y, b.c.z + p.v.z * horizonS);
      if (dist(a.c, c) > a.R + b.R + skinM) continue;
      const r = b.shape.contactShape(c, b.q, a.shape, a.c, a.q, skinM);
      if (r && r.distance < skinM && (!worst || r.distance < worst.gap)) worst = { gap: r.distance, i, point: vc(r.point2), normal: vc(r.normal1), girth: a.girth + b.girth };
    }
  }
  return worst;
}

/** How far past the skin a cut puts the next place (m): so the search does not stop at the linearised edge. */
const CUT_MARGIN = 0.005;

/**
 * The ground a leg standing at `p` cannot stand on for the part it meets (`hit`): a disc in place space. A point of the
 * leg moves with the place by about `alpha` of the place's move (the shoe as far; along the shin from a half at the knee
 * to all at the ankle; along the thigh from none at the hip to a half at the knee), so the place must move about
 * (skin - gap) / alpha along the part's normal to clear it; the disc is the pair's girth / alpha across, with `p` that far
 * inside it along the normal. The search verifies the next place; a cut only steers it.
 */
function cutOf(hit: LegHit, shapes: PoseShape[], p: Vec3, hip: Vec3, q: FootQuery): Footprint {
  let alpha = 1;
  const sh = shapes[hit.i];
  if (hit.i < 2 && sh.kind === 'capsule') {
    const d = sub(sh.b, sh.a);
    const L2 = d.x * d.x + d.y * d.y + d.z * d.z;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((hit.point.x - sh.a.x) * d.x + (hit.point.y - sh.a.y) * d.y + (hit.point.z - sh.a.z) * d.z) / L2)) : 0;
    alpha = hit.i === 0 ? Math.max(0.1, t / 2) : (1 + t) / 2;
  }
  const n = { x: hit.normal.x, z: hit.normal.z };
  const m = len2(n);
  const out = sub2(pt(p), pt(hip));
  const dir = m > 1e-3 ? { x: n.x / m, z: n.z / m } : len2(out) > 1e-6 ? { x: out.x / len2(out), z: out.z / len2(out) } : { x: 1, z: 0 };
  const move = (q.leg!.skinM - hit.gap + CUT_MARGIN) / (alpha * Math.max(m, 0.3));
  const rho = Math.max(hit.girth / alpha, move + 0.01);
  return { pts: [add2(pt(p), dir, -(rho - move))], r: Math.max(0, rho - q.clearM), v: { x: 0, z: 0 }, key: 'leg' };
}

// ---------------------------------------------------------------------------------------------------- footprints

/** A body part in the world: a capsule (segment and radius), a ball or a box, with the world velocity of its centre. */
export type PartShape = { kind: 'capsule'; a: Vec3; b: Vec3; r: number } | { kind: 'ball'; c: Vec3; r: number } | { kind: 'box'; c: Vec3; he: Vec3; q: Quat };
export interface Part {
  shape: PartShape;
  v: Vec3;
  key: string;
}

/** Convex hull of ground points, counter-clockwise (monotone chain; collinear points dropped). */
function hull(ps: Pt[]): Pt[] {
  const s = [...ps].sort((a, b) => a.x - b.x || a.z - b.z);
  if (s.length < 3) return s;
  const half = (it: Pt[]): Pt[] => {
    const h: Pt[] = [];
    for (const p of it) {
      while (h.length >= 2 && cross2(sub2(h[h.length - 1], h[h.length - 2]), sub2(p, h[h.length - 2])) <= 0) h.pop();
      h.push(p);
    }
    h.pop();
    return h;
  };
  return [...half(s), ...half([...s].reverse())];
}

/**
 * The footprint of one part for a stepping player whose shin reaches up to `ceilingY`: the part's span that comes down
 * to the shin (a capsule's segment cut where its underside passes the ceiling; a ball or box that comes below it),
 * projected onto the ground; null when the part stays above. It moves at the part's velocity.
 */
export function footprintOf(p: Part, ceilingY: number): Footprint | null {
  const v = { x: p.v.x, z: p.v.z };
  const s = p.shape;
  if (s.kind === 'ball') return s.c.y - s.r > ceilingY ? null : { pts: [pt(s.c)], r: s.r, v, key: p.key };
  if (s.kind === 'capsule') {
    const top = ceilingY + s.r;
    let { a, b } = s;
    if (a.y > top && b.y > top) return null;
    const cut = (u: Vec3, w: Vec3): Vec3 => (u.y <= top ? u : { x: w.x + ((u.x - w.x) * (top - w.y)) / (u.y - w.y), y: top, z: w.z + ((u.z - w.z) * (top - w.y)) / (u.y - w.y) });
    [a, b] = [cut(a, b), cut(b, a)];
    const A = pt(a);
    const B = pt(b);
    return { pts: len2(sub2(A, B)) > 1e-6 ? [A, B] : [A], r: s.r, v, key: p.key };
  }
  // (the box cut at the ceiling: its corners below it and the points where its edges cross it; corner i has bit 0 for
  // +x, bit 1 for +y, bit 2 for +z, an edge joins corners one bit apart)
  const cs: Vec3[] = [];
  for (let i = 0; i < 8; i++) {
    const o = qRot(s.q, v3((i & 1 ? 1 : -1) * s.he.x, (i & 2 ? 1 : -1) * s.he.y, (i & 4 ? 1 : -1) * s.he.z));
    cs.push({ x: s.c.x + o.x, y: s.c.y + o.y, z: s.c.z + o.z });
  }
  const below: Pt[] = [];
  for (let i = 0; i < 8; i++) {
    const u = cs[i];
    if (u.y <= ceilingY) below.push(pt(u));
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const w = cs[i | bit];
      if (u.y <= ceilingY === w.y <= ceilingY) continue;
      const t = (ceilingY - u.y) / (w.y - u.y);
      below.push({ x: u.x + (w.x - u.x) * t, z: u.z + (w.z - u.z) * t });
    }
  }
  return below.length ? { pts: hull(below), r: 0, v, key: p.key } : null;
}

/** Free ground for a stepping player (shin top `ceilingY`) among the other players' parts: their footprints and themselves. */
export function groundOf(parts: Part[], ceilingY: number): FreeGround {
  const prints: Footprint[] = [];
  for (const p of parts) {
    const f = footprintOf(p, ceilingY);
    if (f) prints.push(f);
  }
  return { prints, parts };
}

// ---------------------------------------------------------------------------------------------------- the simulation

/** What the adapter reads of a player. */
export interface PartsPlayer {
  id: PlayerId;
  rag: { colliders: { collider: RAPIER.Collider; segment: string }[] } | null;
  proxy: { body: RAPIER.RigidBody; colliders: RAPIER.Collider[] };
  pose: PhysicalPose | null;
  body: { kind: string };
  /** The player's foot plan: a composed one measures each achieved ankle's velocity (`ankleV`), which its leg moves at. */
  feet: { initialized: boolean; profile: { compose?: unknown }; feet: Record<ArmSide, { ankleV: Vec3 }> } | null;
}

/** A Rapier collider as a part (capsule along its local y, ball, cuboid; other shapes are not body parts). */
function colliderPart(c: RAPIER.Collider, key: string): Part | null {
  const p = vc(c.translation());
  const q = { ...c.rotation() };
  const b = c.parent();
  const v = b ? vc(b.velocityAtPoint(p)) : v3();
  const T = RAPIER.ShapeType;
  const sh = c.shape;
  if (sh.type === T.Ball) return { shape: { kind: 'ball', c: p, r: (sh as RAPIER.Ball).radius }, v, key };
  if (sh.type === T.Capsule) {
    const k = sh as RAPIER.Capsule;
    const h = qRot(q, v3(0, k.halfHeight, 0));
    return { shape: { kind: 'capsule', a: { x: p.x - h.x, y: p.y - h.y, z: p.z - h.z }, b: { x: p.x + h.x, y: p.y + h.y, z: p.z + h.z }, r: k.radius }, v, key };
  }
  if (sh.type === T.Cuboid) return { shape: { kind: 'box', c: p, he: vc((sh as RAPIER.Cuboid).halfExtents), q }, v, key };
  return null;
}

/** A pose shape as a part moving at `v`. */
function poseShapePart(s: PoseShape, v: Vec3, key: string): Part {
  if (s.kind === 'ball') return { shape: { kind: 'ball', c: s.c, r: s.r }, v, key };
  if (s.kind === 'box') return { shape: { kind: 'box', c: s.c, he: s.he, q: s.q }, v, key };
  return { shape: { kind: 'capsule', a: s.a, b: s.b, r: s.r }, v, key };
}

/**
 * Every player's parts this substep, read once before any pose of the substep is built (so no player reads another's
 * pose of the same substep, and the body order cannot change what anyone sees): a ragdoll's segment colliders; a proxy's
 * colliders (support capsule, torso, pelvis, head) and its published limbs, the shin and shoe of each leg moving at that
 * ankle's measured velocity (its foot plan's, composed), every other part at the proxy's velocity there.
 */
export function bodyParts(players: readonly PartsPlayer[], R: RagdollProfile): Map<PlayerId, Part[]> {
  const out = new Map<PlayerId, Part[]>();
  for (const o of players) {
    const parts: Part[] = [];
    if (o.rag) {
      for (const c of o.rag.colliders) {
        const p = colliderPart(c.collider, `${o.id}:${c.segment}`);
        if (p) parts.push(p);
      }
    } else {
      for (const c of o.proxy.colliders) {
        const p = colliderPart(c, `${o.id}:proxy`);
        if (p) parts.push(p);
      }
      if (o.pose && o.body.kind === 'upperBodyCompound') {
        const legs = o.feet?.initialized && o.feet.profile.compose ? o.feet.feet : null;
        for (const s of poseLimbShapes(R, o.pose)) {
          const side: ArmSide = s.key.startsWith('left') ? 'left' : 'right';
          const at = s.kind === 'capsule' ? { x: 0.5 * (s.a.x + s.b.x), y: 0.5 * (s.a.y + s.b.y), z: 0.5 * (s.a.z + s.b.z) } : s.c;
          const v = legs && /Shin$|Shoe$/.test(s.key) ? legs[side].ankleV : vc(o.proxy.body.velocityAtPoint(at));
          parts.push(poseShapePart(s, v, `${o.id}:${s.key}`));
        }
      }
    }
    out.set(o.id, parts);
  }
  return out;
}

/** Free ground for player `id` (shin top `ceilingY`): every other player's parts of `parts`. */
export function groundFor(parts: Map<PlayerId, Part[]>, id: PlayerId, ceilingY: number): FreeGround {
  const others: Part[] = [];
  for (const [k, ps] of parts) if (k !== id) others.push(...ps);
  return groundOf(others, ceilingY);
}
