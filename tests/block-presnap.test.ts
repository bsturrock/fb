// Plan 16 (p39): the pre-snap stance (BlockRequest.stance, BlockProfile.preSnap): the two-point set on the low lean-in
// (LEAN_IN_V3), held from the reset until the snap (BlockSpec.fromS), then the block from it. No registered fixture has it.
import { describe, expect, it } from 'vitest';
import { BLOCK_V1, LEAN_IN_V2, LEAN_IN_V3, leanInStances, preSnapKey, withLeanIn, type PreSnapStance } from '../src/sim/controllers/block';
import type { FixtureDef } from '../src/sim/fixture';
import { BL_SCENES, blockScene, legOf } from '../src/sim/fixtures/blocking';
import { Simulation } from '../src/sim/simulation';
import { qRot, v3 } from '../src/sim/vec';
import { FIX } from './helpers';

const L = legOf(FIX('L3-F6-hold'), FIX('L3-F6-hold').players.find((p) => p.id === 'D')!.body);
const TWO: PreSnapStance = { kind: 'two-point', side: 'offense' };

describe('plan 16 (p39), the two-point set (LEAN_IN_V3 on the BL body)', () => {
  it('stands over the load\'s planted feet with the hips sunk (below 0.80 m, within 3 cm over the load\'s), the knees bent past 80 deg, the rear foot near flat (heel under 3.5 cm) and the trunk at 25 deg; a profile on it has the stance, its hinge bound covering it; fault twin: LEAN_IN_V2 has none', () => {
    const d = leanInStances(LEAN_IN_V3, { ...L, dorsiDeg: LEAN_IN_V3.ankleDeg! });
    const h = d.hips.twoPoint!;
    expect(d.twoPoint).toBeDefined();
    expect(h.overGroundM).toBeLessThan(0.8);
    expect(h.overGroundM - d.hips.load.overGroundM).toBeGreaterThanOrEqual(0);
    expect(h.overGroundM - d.hips.load.overGroundM).toBeLessThan(0.03);
    expect(L.shoeM * Math.sin((h.pitchDeg * Math.PI) / 180)).toBeLessThan(0.035);
    expect(d.twoPoint!.leanDeg + d.twoPoint!.hingeDeg).toBe(25);
    // the knee: the rear shin at the range plus the foot's pitch, the thigh's slope
    expect(90 - LEAN_IN_V3.twoPoint!.thighDeg + LEAN_IN_V3.ankleDeg! + h.pitchDeg).toBeGreaterThan(80);
    const P = withLeanIn(BLOCK_V1, LEAN_IN_V3, L);
    expect(P.preSnap?.[preSnapKey(TWO)]?.heightM).toBeCloseTo(d.twoPoint!.heightM, 6);
    expect(P.hinge.maxDeg).toBeGreaterThanOrEqual(d.twoPoint!.hingeDeg);
    // fault twin
    expect(leanInStances(LEAN_IN_V2, L).twoPoint).toBeUndefined();
    expect(withLeanIn(BLOCK_V1, LEAN_IN_V2, L).preSnap).toBeUndefined();
  });
});

interface Held {
  /** Per man, before the snap (0.8-1.0 s): the lowest and highest hips (drawn hip joints), the least and most body pitch from vertical (deg), the lowest wrist (m). */
  pre: Record<string, { hipLo: number; hipHi: number; pitchLo: number; pitchHi: number; wristLo: number }>;
  /** Per man: a foot left the ground before the snap; when his load began (s). */
  stepped: Record<string, boolean>;
  loadT: Record<string, number>;
  fell: boolean;
}

async function held(def: FixtureDef, snapS: number): Promise<Held> {
  const r: Held = { pre: {}, stepped: {}, loadT: {}, fell: false };
  let sim!: Simulation;
  sim = await Simulation.create(def, {
    onSubstep: () => {
      for (const p of sim.players) {
        if (p.rag || p.controlMode !== 'supported') {
          r.fell = true;
          continue;
        }
        if (!p.pose || !p.feet) continue;
        if (sim.t < snapS - 1e-9 && (p.feet.feet.left.mode === 'swing' || p.feet.feet.right.mode === 'swing')) r.stepped[p.id] = true;
        if (p.block?.punch?.phase === 'load' && r.loadT[p.id] === undefined) r.loadT[p.id] = sim.t;
        if (sim.t < snapS - 0.2 || sim.t >= snapS - 1e-9) continue;
        const J = p.pose.jointLandmarksWorld;
        const hip = (J.leftHip.y + J.rightHip.y) / 2;
        const up = qRot(p.proxy.body.rotation() as never, v3(0, 1, 0));
        const pitch = (Math.acos(Math.max(-1, Math.min(1, up.y))) * 180) / Math.PI;
        const m = (r.pre[p.id] ??= { hipLo: Infinity, hipHi: -Infinity, pitchLo: Infinity, pitchHi: -Infinity, wristLo: Infinity });
        m.hipLo = Math.min(m.hipLo, hip);
        m.hipHi = Math.max(m.hipHi, hip);
        m.pitchLo = Math.min(m.pitchLo, pitch);
        m.pitchHi = Math.max(m.pitchHi, pitch);
        m.wristLo = Math.min(m.wristLo, J.leftWrist.y, J.rightWrist.y);
      }
    },
  });
  sim.runToEnd();
  sim.dispose();
  return r;
}

/** BL-F1-even's men on LEAN_IN_V3, the snap at 1 s, 0.92 m apart (the set takes each man's hips 9 cm back). */
const fromSet = (stance: PreSnapStance | undefined): FixtureDef => {
  const o = BL_SCENES.find((x) => x.id === 'BL-F1-even')!;
  const m = (x: typeof o.A) => ({ ...x, leanIn: LEAN_IN_V3, fromS: 1, ...(stance ? { stance } : {}) });
  return blockScene({ ...o, A: m(o.A), B: m(o.B), sepM: 0.92, durationS: 1.4 }, FIX('L3-F6-hold'));
};

describe('plan 16 (p39), the pre-snap stance held until the snap', () => {
  it('BL-F1-even\'s men in the two-point set, the snap at 1 s (1.4 s): before the snap each holds his hips at the set\'s height (within 2 cm) and his trunk at 22-29 deg, his hands up at the ready point and both feet down; at the snap he loads at once, and nobody falls; fault twin: no stance in the request, he stands tall and upright until the snap', async () => {
    const P = withLeanIn(BLOCK_V1, LEAN_IN_V3, L);
    const setHip = P.preSnap!['two-point']!.heightM + L.hipUpM * Math.cos((25 * Math.PI) / 180);
    const on = await held(fromSet(TWO), 1);
    expect(on.fell).toBe(false);
    for (const id of ['A', 'B']) {
      const m = on.pre[id];
      const say = `${id}: hips ${m.hipLo.toFixed(3)}-${m.hipHi.toFixed(3)} (set ${setHip.toFixed(3)}) pitch ${m.pitchLo.toFixed(1)}-${m.pitchHi.toFixed(1)} wrist ${m.wristLo.toFixed(2)} load ${on.loadT[id]}`;
      expect(Math.abs(m.hipLo - setHip), say).toBeLessThan(0.02);
      expect(Math.abs(m.hipHi - setHip), say).toBeLessThan(0.02);
      expect(m.pitchLo, say).toBeGreaterThan(22);
      expect(m.pitchHi, say).toBeLessThan(29);
      expect(m.wristLo, say).toBeGreaterThan(0.85);
      expect(on.stepped[id], say).toBeUndefined();
      expect(on.loadT[id], say).toBeGreaterThanOrEqual(1 - 1e-9);
      expect(on.loadT[id], say).toBeLessThan(1.05);
    }
    // fault twin: no stance in the request
    const off = await held(fromSet(undefined), 1);
    for (const id of ['A', 'B']) {
      const m = off.pre[id];
      expect(m.hipLo, `${id} twin hips ${m.hipLo.toFixed(3)}`).toBeGreaterThan(0.88);
      expect(m.pitchHi, `${id} twin pitch ${m.pitchHi.toFixed(1)}`).toBeLessThan(5);
    }
  });
});
