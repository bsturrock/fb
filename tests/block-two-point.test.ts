// Plan 16 (p44): the two-point set on its own feet (LEAN_IN_V6's `twoPointSet`). BL-F10-twoPointVsThree's A (offense, in
// the two-point) set from the reset on LEAN_IN_V6 and, the twin, on LEAN_IN_V5 (the set over the lean-in's planted feet:
// a narrow base, the trunk at 28 deg, the hands high). The other man (B, the defense three-point) as the scene has him.
import { describe, expect, it } from 'vitest';
import { LEAN_IN_V5, LEAN_IN_V6, leanInStances, type LeanInStance } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, legOf } from '../src/sim/fixtures/blocking';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { dot, norm, sub, v3, type Vec3 } from '../src/sim/vec';
import { depth, drawnShapes } from './visible';
import { FIX } from './helpers';

describe('plan 16 (p44), the two-point set on its own feet', () => {
  const SNAP = 3.3;
  // (from the reset he widens his feet to the set's base in two short steps, by 0.33 s; as his trunk tips in, his hips go
  // back over his feet and the front foot steps back once, landing by 1.3 s, as the three-point men's feet do getting set:
  // tracked; set from SET_S)
  const SET_S = 1.5;
  function scene(L: LeanInStance): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F10-twoPointVsThree')!;
    return blockScene({ ...s, id: 'BL-T-two-point', A: { ...s.A, leanIn: L }, durationS: SNAP - 0.05 }, FIX('L3-F6-hold'));
  }
  interface SetShape {
    trunkDeg: number;
    hipsM: number;
    kneeDeg: number[];
    anklesApartM: number;
    staggerM: number;
    soleDeg: number;
    handsAheadM: number;
    armInThighM: number;
    plants: number;
    fell: boolean;
  }
  /** A's set, averaged over the last 0.5 s before the snap; the deepest any piece of his arms is in his own thighs getting set; his foot plants after SET_S. */
  async function run(L: LeanInStance): Promise<SetShape> {
    const sim = await Simulation.create(scene(L));
    const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    const D = 180 / Math.PI;
    const mid = (a: Vec3, b: Vec3) => v3((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    const flex = (a: Vec3, b: Vec3, c: Vec3) => 180 - Math.acos(Math.max(-1, Math.min(1, dot(norm(sub(a, b)), norm(sub(c, b)))))) * D;
    const rows: number[][] = [];
    let armInThighM = 0;
    let fell = false;
    while (!sim.done) {
      sim.stepTick();
      const A = sim.players.find((p) => p.id === 'A')!;
      const B = sim.players.find((p) => p.id === 'B')!;
      if (A.rag || A.controlMode !== 'supported') fell = true;
      if (fell || !A.pose || !B.pose || !A.sus) continue;
      const P = A.pose.jointLandmarksWorld;
      const sh = drawnShapes(A.pose, A.body, R);
      for (const a of sh.filter((x) => x.cls === 'upperArmD' || x.cls === 'forearm' || x.cls === 'palm')) for (const b of sh.filter((x) => x.cls === 'thigh')) armInThighM = Math.max(armInThighM, depth(a, b));
      if (sim.t < SNAP - 0.5) continue;
      const gy = A.sus.probe.groundY;
      const toB = sub(B.pose.jointLandmarksWorld.leftHip, P.leftHip);
      const f = norm(v3(toB.x, 0, toB.z));
      const hip = mid(P.leftHip, P.rightHip);
      const tv = sub(mid(P.leftShoulder, P.rightShoulder), hip);
      const knee = Math.max(dot(P.leftKnee, f), dot(P.rightKnee, f));
      const sole = Math.max(...(['left', 'right'] as const).map((s) => Math.abs(A.pose!.legInfo?.[s]?.soleAngle ?? 0))) * D;
      rows.push([
        Math.atan2(dot(tv, f), tv.y) * D,
        hip.y - gy,
        flex(P.leftHip, P.leftKnee, P.leftAnkle),
        flex(P.rightHip, P.rightKnee, P.rightAnkle),
        Math.hypot(P.leftAnkle.x - P.rightAnkle.x, P.leftAnkle.z - P.rightAnkle.z),
        Math.abs(dot(sub(P.leftAnkle, P.rightAnkle), f)),
        sole,
        Math.min(dot(P.leftPalm, f), dot(P.rightPalm, f)) - knee,
      ]);
    }
    const plants = sim.events.filter((e) => e.playerId === 'A' && e.type === 'footPlant' && e.t > SET_S).length;
    sim.dispose();
    const m = (i: number) => rows.reduce((s, r) => s + r[i], 0) / rows.length;
    return { trunkDeg: m(0), hipsM: m(1), kneeDeg: [m(2), m(3)], anklesApartM: m(4), staggerM: m(5), soleDeg: Math.max(...rows.map((r) => r[6])), handsAheadM: m(7), armInThighM, plants, fell };
  }

  it("the stance: V5 with a two-point set of its own (flat feet, wide, a small stagger, its trunk and hands), V5's three-point stances unchanged", () => {
    const def = FIX('L3-F6-hold');
    const L = legOf(def, def.players.find((p) => p.id === 'D')!.body);
    const d6 = leanInStances(LEAN_IN_V6, L);
    const d5 = leanInStances(LEAN_IN_V5, L);
    const t = d6.twoPointSet!;
    expect(t.flat?.level).toBe(true);
    expect(t.flat?.ball).toBeUndefined();
    expect(t.widthAddM).toBe(0.12);
    expect(t.staggerM).toBe(0.08);
    expect(t.leanDeg + t.hingeDeg).toBe(40);
    expect(d5.twoPointSet).toBeUndefined();
    for (const k of ['offense', 'defense'] as const) {
      const { flat: f6, ...s6 } = d6.threePoint![k]!;
      const { flat: f5, ...s5 } = d5.threePoint![k]!;
      expect(s6, k).toEqual(s5);
      expect({ ...f6!, id: '' }, k).toEqual({ ...f5!, id: '' });
    }
  });

  it('set from the reset on V6 the two-point man stands wide and flat, hips sunk, knees bent, the trunk at 35-45 deg, both hands ready in front of his knees and clear of his thighs, without a step; fault twin: on V5 he stands narrow and upright', async () => {
    const on = await run(LEAN_IN_V6);
    expect(on.fell, 'on: stands').toBe(false);
    expect(on.anklesApartM, 'on: wide').toBeGreaterThanOrEqual(0.5);
    expect(on.staggerM, 'on: a small stagger').toBeLessThanOrEqual(0.12);
    expect(on.soleDeg, 'on: both feet flat').toBeLessThanOrEqual(2);
    expect(on.hipsM, 'on: hips sunk').toBeLessThanOrEqual(0.76);
    for (const k of on.kneeDeg) {
      expect(k, 'on: knees bent').toBeGreaterThanOrEqual(75);
      expect(k, 'on: knees bent').toBeLessThanOrEqual(100);
    }
    expect(on.trunkDeg, 'on: trunk').toBeGreaterThanOrEqual(35);
    expect(on.trunkDeg, 'on: trunk').toBeLessThanOrEqual(45);
    expect(on.handsAheadM, 'on: hands in front of his knees').toBeGreaterThanOrEqual(0.05);
    expect(on.armInThighM, 'on: arms clear of his thighs').toBeLessThanOrEqual(0.01);
    expect(on.plants, 'on: no step while set').toBe(0);
    const off = await run(LEAN_IN_V5);
    expect(off.anklesApartM, 'fault: narrow').toBeLessThan(0.45);
    expect(off.trunkDeg, 'fault: upright').toBeLessThan(35);
  }, 120_000);
});
