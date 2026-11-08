// Plan 08a: the carry on the supplied mesh. The player is skinned on the CPU from the published pose through the rig adapter
// and measured against the ball (adapted from sim-6 src/rig/carryProbe.ts): gaps are signed (m), > 0 clear of the ball,
// < 0 inside it. Start from the donor's tolerances (tests/ballCarry.test.ts).
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { glbScene } from '../scripts/model/glb-scene';
import { RigAdapter, cloneRig } from '../src/lab/rig-adapter';
import { FOOTBALL, createFootball } from '../src/lab/football';
import { MODEL_CALIBRATION as C } from '../src/sim/model/profiles';
import { allFixtures } from '../src/sim/fixtures/index';
import { Simulation } from '../src/sim/simulation';
import { carriedBall, type PhysicalPose } from '../src/sim/pose';
import { add, qRot, v3, type Pose, type Vec3 } from '../src/sim/vec';
import { runSim } from './helpers';

const PARTS = ['torso', 'upper', 'fore', 'hand'] as const;
type Part = (typeof PARTS)[number];
type Gaps = { gap: Record<Part, number>; rear: number; front: number; tip: number };

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
    return { gap, rear, front, tip };
  };
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

const worst = (rows: Gaps[]) => ({
  torso: Math.min(...rows.map((r) => r.gap.torso)),
  upper: Math.min(...rows.map((r) => r.gap.upper)),
  fore: Math.min(...rows.map((r) => r.gap.fore)),
  foreMax: Math.max(...rows.map((r) => r.gap.fore)),
  front: Math.max(...rows.map((r) => r.front)),
  tip: Math.max(...rows.map((r) => r.tip)),
});

describe('plan 08a mesh seating', () => {
  const measure = probe();

  it('sits on the mesh through a run cycle, standing and walking', async () => {
    const run = await poses('L3-F16-sprint', 1.6, 2.4, 6);
    const stand = await poses('L3-F13-carrier', 1, 2, 60);
    const walk = await poses('L3-F14-carrier', 1.4, 2.5, 18);
    const fast = await poses('L3-F16-runStop', 1.6, 2.4, 6);
    for (const [name, set] of [['sprint', run], ['fast run', fast], ['stand', stand], ['walk', walk]] as const) {
      const w = worst(set.map((p) => measure(p, carriedBall(p)!)));
      console.log(`[seat] ${name} n=${set.length} ${JSON.stringify(Object.fromEntries(Object.entries(w).map(([k, v]) => [k, Math.round(v * 1000) / 1000])))}`);
      expect(w.torso, name).toBeGreaterThan(-0.08);
      expect(w.upper, name).toBeGreaterThan(-0.1);
      expect(w.fore, name).toBeGreaterThan(-0.05);
      expect(w.foreMax, name).toBeLessThan(0.02);
      expect(w.front, name).toBeLessThan(0.02);
      expect(w.tip, name).toBeLessThan(0.04);
    }
  }, 120000);

  it('a shifted ball or a wrong hand rotation fails the seating checks', async () => {
    const [p] = await poses('L3-F13-carrier', 2, 2.1, 60);
    const ok = (g: Gaps): boolean => g.gap.torso > -0.08 && g.gap.upper > -0.1 && g.gap.fore > -0.05 && g.gap.fore < 0.02 && g.front < 0.02 && g.tip < 0.04;
    const ball = carriedBall(p)!;
    expect(ok(measure(p, ball))).toBe(true);
    const by = (l: Vec3): Pose => ({ p: add(ball.p, qRot(ball.q, l)), q: ball.q });
    expect(ok(measure(p, by(v3(0, 0.1, 0))))).toBe(false); // along the axis, past the hand
    expect(ok(measure(p, by(v3(0, -0.08, 0))))).toBe(false); // back toward the elbow
    expect(ok(measure(p, by(v3(0, 0, -0.09))))).toBe(false); // out off the forearm
    // the hand flexed the wrong way, or not at all, and the palm rolled away from the ball
    expect(ok(measure({ ...p, carry: { ...p.carry!, flexRad: -p.carry!.flexRad } }, ball))).toBe(false);
    expect(ok(measure({ ...p, carry: { ...p.carry!, flexRad: 0 } }, ball))).toBe(false);
    expect(ok(measure({ ...p, carry: { ...p.carry!, rollRad: p.carry!.rollRad + Math.PI } }, ball))).toBe(false);
  }, 60000);

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
