import { describe, expect, it } from 'vitest';
import { HIP_STOPS_L4_V1, hipStopsFor, sideSignX, withHipStops, type HipStopProfile } from '../src/sim/profiles';
import { add, cross, qRot, scale, sub, v3, vc } from '../src/sim/vec';
import { create, FIX, pace } from './helpers';
import { HUMAN_RANGES, jointAngles } from './visible';

// Ladder rung 8k: an L4 ragdoll's hips take the 8d box with the approach zone (`hipStopsFor`: HIP_STOPS_V2, as on L3 and
// HC), not the 8g backstop outside the L4 soft envelope (HIP_STOPS_L4_V1), so its ab/adduction is the human range. Opt-in
// with the hip stops; no fixture uses them.
const RAD = Math.PI / 180;
const SIDES = ['left', 'right'] as const;
/** The human range and the implausible margin past it (tests/visible.ts HUMAN_RANGES). */
const HUMAN = { abduction: 45, adduction: 30 } as const;
const margin = (dof: 'abduction' | 'adduction'): number => HUMAN[dof] + HUMAN_RANGES.find((x) => x.joint === 'Hip' && x.dof === dof)!.implausible;

// A lone L4 ragdoll in zero gravity, muscles off (L4-F1-hipSwing's rig, its loads removed). From 0.1 s (converted at
// 0.02 s, at rest) each leg is set swinging about its hip at 4 rad/s, as one rigid piece (thigh and shin), from hanging
// toward an azimuth where the L4 envelope's boundary reads its largest ab/adduction in the visible measure: the left 63
// deg across the midline from forward (50.7 there), the right 75 deg out (70.6). Its peak over the next second, in the
// visible measure (tests/visible.ts).
const SWING = { left: -63, right: 75 } as const;
const W0 = 4;
async function swung(S: HipStopProfile) {
  const d = FIX('L4-F1-hipSwing');
  const s = await create({ ...d, ragdoll: withHipStops(d.ragdoll!, S), diagnostics: { ...d.diagnostics, limitLoads: [], jointLoads: [] } }, { trace: false });
  const p = s.players[0];
  while (s.t < 0.1 - 1e-9) s.stepTick();
  const rag = p.rag!;
  const core = rag.bodies.core;
  for (const side of SIDES) {
    const sx = sideSignX(p.body, side);
    const a = SWING[side] * RAD;
    const j = rag.joints.find((x) => x.id === `${side}Hip`)!;
    const hip = add(vc(core.translation()), qRot(core.rotation(), j.anchorParentLocal));
    // about the axis that turns the hanging thigh (-Y) toward (sx sin a, 0, cos a): -Y cross that direction
    const w = qRot(core.rotation(), scale(v3(-Math.cos(a), 0, sx * Math.sin(a)), W0));
    for (const b of [rag.bodies[`${side}Thigh`], rag.bodies[`${side}Shin`]]) {
      b.setAngvel(w, true);
      b.setLinvel(cross(w, sub(vc(b.worldCom()), hip)), true);
    }
  }
  const out = { leftAdd: 0, rightAbd: 0, zoneDeg: 0 };
  while (s.t < 1.1 - 1e-9) {
    s.stepTick();
    await pace();
    const J = jointAngles(p.pose!, p.body);
    out.leftAdd = Math.max(out.leftAdd, -J.leftHip.abd);
    out.rightAbd = Math.max(out.rightAbd, J.rightHip.abd);
  }
  out.zoneDeg = Math.max(0, ...(rag.hipStops?.map((h) => h.approach?.maxDepthDeg ?? 0) ?? []));
  expect(s.fall).toBeNull();
  s.dispose();
  return out;
}

describe('ladder rung 8k: an L4 ragdoll\'s hips under the stops it takes (constructed)', () => {
  it('a leg swung across the midline and one swung out, both flexed: under the box with the zone each is stopped inside the human ab/adduction by the zone; under the 8g backstop (fault twin) the soft envelope stops them past the implausible margins', async () => {
    const r = FIX('L4-F1-hipSwing').ragdoll!;
    expect(r.envelope?.hip).toBeDefined();
    const on = await swung(hipStopsFor(r));
    expect(on.leftAdd).toBeLessThan(HUMAN.adduction);
    expect(on.rightAbd).toBeLessThan(HUMAN.abduction);
    expect(on.zoneDeg).toBeGreaterThan(0);
    const off = await swung(HIP_STOPS_L4_V1);
    expect(off.leftAdd).toBeGreaterThan(margin('adduction'));
    expect(off.rightAbd).toBeGreaterThan(margin('abduction'));
  }, 120000);
});
