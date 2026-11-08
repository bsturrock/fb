// Plan 08a: the carry on the supplied mesh. The player is skinned on the CPU from the published pose through the rig adapter
// and measured against the ball (adapted from sim-6 src/rig/carryProbe.ts): gaps are signed (m), > 0 clear of the ball,
// < 0 inside it. Start from the donor's tolerances (tests/ballCarry.test.ts).
//
// Plan 10d D2: the seating checks are tight enough that a ball shifted 3-5 cm along or across its axis, tilted 30 degrees,
// rolled 90 degrees about its own axis, or a hand rolled or flexed off it fails at every measured pose, and none of those
// fails on the tip alone. The donor's axis-offset and blend-against-rise checks are back, on the drawn (rig) forearm.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { glbScene } from '../scripts/model/glb-scene';
import { RigAdapter, cloneRig } from '../src/lab/rig-adapter';
import { FOOTBALL, createFootball } from '../src/lab/football';
import { CARRY_L3 } from '../src/sim/carry';
import { MODEL_CALIBRATION as C } from '../src/sim/model/profiles';
import { allFixtures } from '../src/sim/fixtures/index';
import { Simulation } from '../src/sim/simulation';
import { carriedBall, type PhysicalPose } from '../src/sim/pose';
import { add, qFromAxisAngle, qInvRot, qMul, qRot, v3, type Pose, type Vec3 } from '../src/sim/vec';
import { runSim } from './helpers';

const PARTS = ['torso', 'upper', 'fore', 'hand'] as const;
type Part = (typeof PARTS)[number];
/**
 * One pose on the mesh. `axisOff`: the ball's long axis off the drawn forearm (elbow to wrist bone) less the seat's
 * authored tilt (rad; the donor bounds it above, here both ways). `laces`: the forearm's azimuth about the ball's long axis from the laces (+Z, which the seat turns
 * out toward the forearm; rad). `palm`: the hand's thinnest axis (its palm normal) off the ball's radial direction at the
 * hand (rad); a hand rolled off the ball turns it toward the ball's axis.
 */
type Gaps = { gap: Record<Part, number>; rear: number; front: number; tip: number; axisOff: number; laces: number; palm: number; foreDir: Vec3 };

const partOf = (bone: string): Part | null =>
  /^(Hips|Spine|Spine1|Spine2|Neck)$/.test(bone) ? 'torso' : bone === 'RightArm' ? 'upper' : bone === 'RightForeArm' ? 'fore' : /^RightHand/.test(bone) ? 'hand' : null;

function probe() {
  const { scene } = glbScene();
  const rig = cloneRig(scene);
  const adapter = new RigAdapter(rig.bones, C);
  const m = rig.meshes.find((x) => x.geometry.attributes.position.count > 2000)!;
  const geo = m.geometry;
  const J = geo.attributes.skinIndex;
  const W = geo.attributes.skinWeight;
  const names = m.skeleton.bones.map((b) => b.name.replace('mixamorig', ''));
  const idx = Object.fromEntries(PARTS.map((p) => [p, [] as number[]])) as Record<Part, number[]>;
  for (let i = 0; i < geo.attributes.position.count; i++) {
    let best = 0;
    let bw = -1;
    for (let k = 0; k < 4; k++) {
      const x = W.getComponent(i, k);
      if (x > bw) [bw, best] = [x, J.getComponent(i, k)];
    }
    const p = partOf(names[best]);
    if (p) idx[p].push(i);
  }
  const { halfM: HALF, radiusM: RADIUS } = FOOTBALL;
  const profile = (u: number): number => RADIUS * Math.sin(Math.acos(Math.max(-1, Math.min(1, -u / HALF)))) ** 1.3;
  const v = new THREE.Vector3();
  return (pose: PhysicalPose, ball: Pose): Gaps => {
    adapter.apply(pose);
    rig.root.updateMatrixWorld(true);
    const p0 = new THREE.Vector3(ball.p.x, ball.p.y, ball.p.z);
    const inv = new THREE.Quaternion(ball.q.x, ball.q.y, ball.q.z, ball.q.w).invert();
    /** A vertex in the ball's frame. */
    const local = (i: number): THREE.Vector3 => m.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(m.matrixWorld).sub(p0).applyQuaternion(inv);
    const centroid = (ids: number[]): THREE.Vector3 => ids.reduce((c, i) => c.add(local(i)), new THREE.Vector3()).multiplyScalar(1 / ids.length);
    const gap = {} as Record<Part, number>;
    let rear = Infinity;
    let front = Infinity;
    let tip = Infinity;
    for (const part of PARTS) {
      let min = Infinity;
      for (const i of idx[part]) {
        m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
        const l = v.sub(p0).applyQuaternion(inv);
        const r = Math.hypot(l.x, l.z);
        const u = l.y;
        const d = Math.abs(u) < HALF ? r - profile(u) : Math.hypot(r, Math.abs(u) - HALF);
        min = Math.min(min, d);
        if (part === 'upper' && u < -0.06) rear = Math.min(rear, d);
        if (part === 'hand' && u > 0.06) front = Math.min(front, d);
        if (part === 'hand') tip = Math.min(tip, Math.hypot(r, u - HALF));
      }
      gap[part] = min;
    }
    // the drawn forearm: elbow to wrist bone, its axis against the ball's beyond the seat's tilt
    const elbow = new THREE.Vector3().setFromMatrixPosition(rig.bones.RightForeArm.matrixWorld);
    const fore = new THREE.Vector3().setFromMatrixPosition(rig.bones.RightHand.matrixWorld).sub(elbow).normalize();
    const axis = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(ball.q.x, ball.q.y, ball.q.z, ball.q.w));
    const axisOff = Math.acos(Math.min(1, Math.abs(axis.dot(fore)))) - Math.abs(pose.carry!.tiltRad);
    // the laces: the forearm's vertex centroid about the ball's axis
    const fc = centroid(idx.fore);
    const laces = Math.atan2(Math.abs(fc.x), fc.z);
    // the palm: the hand vertices' thinnest axis against the ball's radial direction at the hand centroid
    const hc = centroid(idx.hand);
    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const i of idx.hand) {
      const l = local(i).sub(hc);
      const d = [l.x, l.y, l.z];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) cov[3 * a + b] += d[a] * d[b];
    }
    const thin = thinnestAxis(cov);
    const palm = Math.acos(Math.min(1, Math.abs(thin.dot(new THREE.Vector3(hc.x, 0, hc.z).normalize()))));
    return { gap, rear, front, tip, axisOff, laces, palm, foreDir: v3(fore.x, fore.y, fore.z) };
  };
}

/** The eigenvector of a symmetric 3x3 matrix (row-major) with the smallest eigenvalue (Jacobi rotations). */
function thinnestAxis(m: number[]): THREE.Vector3 {
  const A = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
  const V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(A[p][q]) < 1e-15) continue;
      const th = 0.5 * Math.atan2(2 * A[p][q], A[q][q] - A[p][p]);
      const c = Math.cos(th);
      const s = Math.sin(th);
      for (let k = 0; k < 3; k++) [A[k][p], A[k][q]] = [c * A[k][p] - s * A[k][q], s * A[k][p] + c * A[k][q]];
      for (let k = 0; k < 3; k++) [A[p][k], A[q][k]] = [c * A[p][k] - s * A[q][k], s * A[p][k] + c * A[q][k]];
      for (let k = 0; k < 3; k++) [V[k][p], V[k][q]] = [c * V[k][p] - s * V[k][q], s * V[k][p] + c * V[k][q]];
    }
  }
  const j = [0, 1, 2].reduce((a, b) => (A[b][b] < A[a][a] ? b : a), 0);
  return new THREE.Vector3(V[0][j], V[1][j], V[2][j]).normalize();
}

const FIX = (id: string) => allFixtures().find((d) => d.id === id)!;

/** Published poses of the carrier through a fixture window, every `every` substeps. */
async function poses(id: string, from: number, to: number, every: number): Promise<PhysicalPose[]> {
  const out: PhysicalPose[] = [];
  let n = 0;
  const sim = await Simulation.create(FIX(id), {
    onSubstep: (s) => {
      const R = s.players.find((p) => p.setup.role === 'runner')!;
      if (s.t >= from && s.t <= to && R.pose && n++ % every === 0) out.push(structuredClone(R.pose));
    },
  });
  await runSim(sim);
  sim.dispose();
  return out;
}

/**
 * The seating checks that fail at one pose (none: seated). The donor's (torso, upper arm, tip) and its axis offset, with
 * the forearm, hand and front tightened to contact: the forearm and hand both on the ball and neither deep in it, the
 * fingers on it ahead of the centre, the elbow end tucked against the upper arm, the laces out toward the forearm and the
 * palm on the ball.
 */
function unseated(g: Gaps): string[] {
  const bad: string[] = [];
  if (!(g.gap.torso > -0.08)) bad.push('torso');
  if (!(g.gap.upper > -0.1)) bad.push('upper');
  if (!(g.gap.fore > -0.035 && g.gap.fore < 0)) bad.push('fore');
  if (!(g.gap.hand > -0.02 && g.gap.hand < 0)) bad.push('hand');
  if (!(g.front < 0)) bad.push('front');
  if (!(g.tip < 0.04)) bad.push('tip');
  if (!(g.rear < 0)) bad.push('rear');
  if (!(Math.abs(g.axisOff) < 0.02)) bad.push('axis');
  if (!(g.laces < 0.1)) bad.push('laces');
  if (!(g.palm < 1.0)) bad.push('palm');
  return bad;
}

const corr = (a: number[], b: number[]): number => {
  const m = (x: number[]): number => x.reduce((p, q) => p + q, 0) / x.length;
  const [ma, mb] = [m(a), m(b)];
  let n = 0;
  let da = 0;
  let db = 0;
  a.forEach((x, i) => {
    n += (x - ma) * (b[i] - mb);
    da += (x - ma) ** 2;
    db += (b[i] - mb) ** 2;
  });
  return n / Math.sqrt(da * db);
};

type Control = (p: PhysicalPose, ball: Pose) => [PhysicalPose, Pose];
const shift = (l: Vec3): Control => (p, b) => [p, { p: add(b.p, qRot(b.q, l)), q: b.q }];
const turn = (axis: Vec3, rad: number): Control => (p, b) => [p, { p: b.p, q: qMul(b.q, qFromAxisAngle(axis, rad)) }];
const seat = (f: (c: NonNullable<PhysicalPose['carry']>) => Partial<NonNullable<PhysicalPose['carry']>>): Control => (p, b) => [{ ...p, carry: { ...p.carry!, ...f(p.carry!) } }, b];
const X = v3(1, 0, 0);
const Y = v3(0, 1, 0);
const Z = v3(0, 0, 1);

/** Wrong seats, each with the check that must catch it (beyond any other that also does). */
const CONTROLS: [string, Control, string[]][] = [
  ...[0.03, 0.05, -0.03, -0.05].flatMap((d): [string, Control, string[]][] => [
    [`sideways across the axis ${d * 100} cm`, shift(v3(d, 0, 0)), []],
    [`along the axis ${d * 100} cm`, shift(v3(0, d, 0)), []],
    [`across the axis toward the forearm ${d * 100} cm`, shift(v3(0, 0, d)), []],
  ]),
  ['along the axis past the hand 10 cm', shift(v3(0, 0.1, 0)), []],
  ['back toward the elbow 8 cm', shift(v3(0, -0.08, 0)), []],
  ['out off the forearm 9 cm', shift(v3(0, 0, -0.09)), []],
  // about z the axis leaves the seat's tilt plane; about x it stays in it, and where the seat's own tilt is about half of
  // 30 degrees the turned axis is off the forearm by the seat's tilt again (the hand and palm checks catch it there)
  ...([1, -1] as const).flatMap((s): [string, Control, string[]][] => [
    [`tilted ${s * 30} deg about x`, turn(X, (s * Math.PI) / 6), []],
    [`tilted ${s * 30} deg about z`, turn(Z, (s * Math.PI) / 6), ['axis']],
  ]),
  ['rolled 90 deg about its own axis', turn(Y, Math.PI / 2), ['laces']],
  ['hand rolled +90 deg', seat((c) => ({ rollRad: c.rollRad + Math.PI / 2 })), ['palm']],
  ['hand rolled -90 deg', seat((c) => ({ rollRad: c.rollRad - Math.PI / 2 })), ['palm']],
  ['hand rolled 180 deg', seat((c) => ({ rollRad: c.rollRad + Math.PI })), []],
  ['hand without roll', seat(() => ({ rollRad: 0 })), ['palm']],
  ['the legacy rig (no hand roll or flex)', seat(() => ({ handW: 0 })), ['palm']],
  ['hand flexed the wrong way', seat((c) => ({ flexRad: -c.flexRad })), []],
  ['hand not flexed', seat(() => ({ flexRad: 0 })), []],
];

describe('plan 08a mesh seating', () => {
  const measure = probe();
  const sets: Promise<[string, PhysicalPose[]][]> = (async () => [
    ['sprint', await poses('L3-F16-sprint', 1.6, 2.4, 6)],
    ['fast run', await poses('L3-F16-runStop', 1.6, 2.4, 6)],
    ['stand', await poses('L3-F13-carrier', 1, 2, 60)],
    ['walk', await poses('L3-F14-carrier', 1.4, 2.5, 18)],
  ])();

  it('sits on the mesh through a run cycle, standing and walking; the donor swing on the drawn forearm', async () => {
    for (const [name, set] of await sets) {
      expect(set.length, name).toBeGreaterThan(4);
      const rows = set.map((p) => measure(p, carriedBall(p)!));
      const lo = (f: (g: Gaps) => number): number => Math.round(Math.min(...rows.map(f)) * 1000) / 1000;
      const hi = (f: (g: Gaps) => number): number => Math.round(Math.max(...rows.map(f)) * 1000) / 1000;
      console.log(
        `[seat] ${name} n=${set.length} torso ${lo((g) => g.gap.torso)} upper ${lo((g) => g.gap.upper)} fore ${lo((g) => g.gap.fore)}..${hi((g) => g.gap.fore)}` +
          ` hand ${lo((g) => g.gap.hand)}..${hi((g) => g.gap.hand)} front ${hi((g) => g.front)} tip ${hi((g) => g.tip)} rear ${hi((g) => g.rear)}` +
          ` axisOff ${lo((g) => g.axisOff)}..${hi((g) => g.axisOff)} laces ${hi((g) => g.laces)} palm ${hi((g) => g.palm)}`,
      );
      rows.forEach((g, i) => expect(unseated(g), `${name} pose ${i}`).toEqual([]));
      if (name === 'stand' || name === 'walk') continue;
      // the donor's swing: through a run cycle the seat blends from the back key to the forward key and the drawn
      // forearm rises coming forward (the forward key's is higher)
      const blend = set.map((p) => p.carry!.tiltRad / CARRY_L3.fwd.tilt);
      const rise = set.map((p, i) => qInvRot(p.segments.core.rotationWorld, rows[i].foreDir).y);
      expect(Math.min(...blend), name).toBeLessThan(0.05);
      expect(Math.max(...blend), name).toBeGreaterThan(0.95);
      expect(corr(blend, rise), name).toBeGreaterThan(0.7);
    }
  }, 120000);

  it('a shifted, tilted or rolled ball, or a hand rolled or flexed off it, fails at every pose and not on the tip alone', async () => {
    let n = 0;
    for (const [label, wrong, catches] of CONTROLS) {
      for (const [name, set] of await sets) {
        for (const [i, p] of set.entries()) {
          const [pp, ball] = wrong(p, carriedBall(p)!);
          const bad = unseated(measure(pp, ball));
          expect(bad.filter((k) => k !== 'tip'), `${label}: ${name} pose ${i}`).not.toEqual([]);
          for (const k of catches) expect(bad, `${label}: ${name} pose ${i}`).toContain(k);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(20 * 70);
  }, 240000);

  it('the shared football keeps the donor\'s shape: long axis +Y, half-length 0.14 m, radius 0.085 m', () => {
    const body = new THREE.Box3().setFromObject(createFootball().children[0]);
    expect(FOOTBALL).toEqual({ halfM: 0.14, radiusM: 0.085 });
    expect(body.max.y).toBeCloseTo(FOOTBALL.halfM, 3);
    expect(body.min.y).toBeCloseTo(-FOOTBALL.halfM, 3);
    expect(Math.max(body.max.x, body.max.z)).toBeCloseTo(FOOTBALL.radiusM, 2);
  });

  it('the rested palm lies along the forearm segment\'s hinge axis (where the seat roll starts)', () => {
    // the hand mesh's thin axis is the segment's hinge axis: rolling from there is what carry.ts calls the seat side
    const { scene } = glbScene();
    const rig = cloneRig(scene);
    const m = rig.meshes.find((x) => x.geometry.attributes.position.count > 2000)!;
    const hand = m.skeleton.bones.indexOf(rig.bones.RightHand);
    const S = m.geometry.attributes.skinIndex;
    const W = m.geometry.attributes.skinWeight;
    rig.root.updateMatrixWorld(true);
    const q = C.segmentRest.rightForearm;
    const inv = new THREE.Quaternion(q[0], q[1], q[2], q[3]).normalize().invert();
    const origin = new THREE.Vector3(...C.frame.origin);
    const wrist = new THREE.Vector3(...C.landmarks.rightWrist);
    const v = new THREE.Vector3();
    let x = 0;
    let z = 0;
    let n = 0;
    for (let i = 0; i < m.geometry.attributes.position.count; i++) {
      let best = 0;
      let bw = -1;
      for (let k = 0; k < 4; k++) if (W.getComponent(i, k) > bw) [bw, best] = [W.getComponent(i, k), S.getComponent(i, k)];
      if (best !== hand) continue;
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld).sub(origin).sub(wrist).applyQuaternion(inv);
      x += v.x * v.x;
      z += v.z * v.z;
      n++;
    }
    expect(n).toBeGreaterThan(50);
    // thin across the palm (X), wide across the knuckles (Z): the palm normal lies along the hinge axis
    expect(Math.sqrt(x / n)).toBeLessThan(0.7 * Math.sqrt(z / n));
  });
});
