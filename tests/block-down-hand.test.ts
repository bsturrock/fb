// Plan 16 (p44): the three-point's down hand reaching the turf in front of his knee (`PreSnapHand.kneeClearM`, LEAN_IN_V5).
// BL-F9-threePoint's two men (both in a three-point: A on offense, B on defense) are set at their stance's height from the
// reset, their trunks upright and tipping in at the stance's pace; the hand reaching for the turf under the shoulder hung
// straight down through the squatting thigh. The same scene from the reset on LEAN_IN_V5 and, the twin, on LEAN_IN_V4.
import { describe, expect, it } from 'vitest';
import { LEAN_IN_V4, LEAN_IN_V5, leanInStances, type LeanInStance } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, legOf } from '../src/sim/fixtures/blocking';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import { Simulation } from '../src/sim/simulation';
import { depth, drawnShapes } from './visible';
import { FIX } from './helpers';

describe('plan 16 (p44), the down hand in front of his knee', () => {
  const SET_S = 1.6;
  const SNAP = 3.3;
  function scene(L: LeanInStance): FixtureDef {
    const s = BL_SCENES.find((x) => x.id === 'BL-F9-threePoint')!;
    return blockScene({ ...s, id: 'BL-T-down-hand', A: { ...s.A, leanIn: L }, B: { ...s.B, leanIn: L }, durationS: SNAP - 0.05, stayLow: false, shoulderTops: false, foldKeeps: false, armsGive: false }, FIX('L3-F6-hold'));
  }
  /** Per man: the deepest his down (right) arm's drawn pieces (upper arm, forearm, palm) are in his own thighs getting set (to SET_S; m), and where his right palm stands in the set (just before the snap). */
  async function run(L: LeanInStance): Promise<Record<string, { deep: number; palm: { x: number; y: number; z: number } }>> {
    const sim = await Simulation.create(scene(L));
    const R = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
    const r: Record<string, { deep: number; palm: { x: number; y: number; z: number } }> = {};
    while (!sim.done) {
      sim.stepTick();
      for (const p of sim.players) {
        if (p.rag || !p.pose) continue;
        const o = (r[p.id] ??= { deep: 0, palm: { x: 0, y: 0, z: 0 } });
        o.palm = { ...p.pose.jointLandmarksWorld.rightPalm };
        if (sim.t > SET_S) continue;
        const sh = drawnShapes(p.pose, p.body, R);
        for (const a of sh.filter((s) => (s.cls === 'upperArmD' || s.cls === 'forearm' || s.cls === 'palm') && s.side === 'right')) for (const b of sh.filter((s) => s.cls === 'thigh')) o.deep = Math.max(o.deep, depth(a, b));
      }
    }
    sim.dispose();
    return r;
  }

  it('the stance: V4 with each three-point\'s down hand in front of the knee as it stands in the set by 2 cm beyond the thigh and the palm, no lower than the arm reaches; the stances themselves V4\'s', () => {
    const def = FIX('L3-F6-hold');
    const L = legOf(def, def.players.find((p) => p.id === 'D')!.body);
    const d5 = leanInStances(LEAN_IN_V5, L);
    const d4 = leanInStances(LEAN_IN_V4, L);
    for (const k of ['offense', 'defense'] as const) {
      const T = LEAN_IN_V4.threePoint![k]!;
      const { hands: h5, ...s5 } = d5.threePoint![k]!;
      const { hands: h4, ...s4 } = d4.threePoint![k]!;
      // (the flat stance named by its lean-in)
      expect({ ...s5, flat: { ...s5.flat!, id: '' } }, k).toEqual({ ...s4, flat: { ...s4.flat!, id: '' } });
      expect(h5!.left, k).toEqual(h4!.left);
      expect(h5!.right!.front!.aheadM, k).toBeCloseTo(L.thighM * Math.cos((T.thighDeg * Math.PI) / 180) + L.thighRM! + L.palmRM! + 0.02, 9);
      expect(h5!.right!.front!.reachM, k).toBe(def.armProfile!.maxReachM);
      expect(h4!.right!.front, k).toBeUndefined();
    }
  });

  it("getting set from the reset on V5 neither man's down arm is more than 1 cm in his own thighs, and in the set his down palm stands where V4's does (within 1 cm); fault twin: on V4 each man's down arm goes 8 cm or more into his thigh", async () => {
    const on = await run(LEAN_IN_V5);
    const off = await run(LEAN_IN_V4);
    for (const id of ['A', 'B']) {
      expect(on[id].deep, `on: ${id}'s down arm outside his thighs`).toBeLessThanOrEqual(0.01);
      expect(off[id].deep, `fault: ${id}'s down arm in his thigh`).toBeGreaterThanOrEqual(0.08);
      const a = on[id].palm;
      const b = off[id].palm;
      expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z), `${id}'s palm in the set`).toBeLessThan(0.01);
    }
  }, 120_000);
});
