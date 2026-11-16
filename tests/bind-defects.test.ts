// Contact motion polish 1.4 (the bound-legs fall, WRAP_V8), tracked defects (rule 5) its flip reached: mechanisms the
// bind's moved trajectories run into, each on a full-state capture a little before it (tests/data/state; how to capture:
// tests/README.md). Each test pins the defect present in its captured state and fails once the defect is gone from it
// (it then becomes the fix's test, with its fault twin: (a) since the shoulder twist flip). The twin shows the cause: the
// same state with the bind off (WRAP_V7, `preWrapV8`).
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { SHOULDER_TWIST_ANAT_V2, withShoulderTwistLimit } from '../src/sim/profiles';
import type { Simulation } from '../src/sim/simulation';
import { asCaptured, create, FIX, preForwardFall, preSteps, preShoulderTwist, preWrapV8, preWrapV9, preWrapV10, preWrapV11, preWrapV12, preWrapV13 } from './runs';
import { loadState, resumeState } from './state';
import { jointAngles } from './visible';

/** R's ragdoll left shoulder twist past the 100 deg human range, to the run's end: the peak, its time, the swing there, seconds past 30. */
function ragdollShoulderTwist(sim: Simulation) {
  const R = sim.byId.get('R')!;
  const out = { peak: 0, at: 0, swing: 0, impS: 0 };
  while (!sim.done) {
    sim.stepTick();
    if (!R.pose || R.representation !== 'ragdoll') continue;
    const m = jointAngles(R.pose, R.body).leftShoulder;
    const ex = Math.abs(m.rot) - 100;
    if (ex > 30) out.impS += sim.def.solver.outerTickS;
    if (ex > out.peak) Object.assign(out, { peak: ex, at: sim.t, swing: m.swing });
  }
  return out;
}

describe('contact motion polish 1.4, the bound-legs fall: tracked defects (rule 5)', () => {
  // (a) L3-F19-rear: the high rear wrap. While the tackler drives on his secure hold the carrier's bind clock runs
  // (a foot stranded, clause (b), 0.72 to 1.80 s) and leans him toward his travel; he is never bound (he keeps
  // planting) and the ordinary envelope takes him at 1.871 s (1.892 s under WRAP_V7). His ragdoll's left shoulder,
  // the arm raised (swing about 132 deg), then twists 80 deg past range at 2.57 s, over 30 past for 0.33 s; under V7
  // from the start it peaks at 30 deg past and never beyond. Captured at 1.800 s, the clock still running; twin, the
  // bind off (WRAP_V7) from there: the same twist, 76 deg past, 0.35 s. Reached by the moved trajectory, not made or
  // worsened by the bind. The fault twin: V7 from the start, which never reaches it, fails the pin.
  // (polish 4, the forward-fall flip: the fault twin is V7 from the start as it ran, the carrier's fall before the plan,
  // `preForwardFall`. With the plan V7 from the start reaches the twist too, 80 deg past at 2.67 s, 0.52 s: the plan's
  // moved trajectory reaching it. From the capture the plan does not worsen it: 64 deg past, 0.23 s, against 80 and 0.33
  // without; the bind off with the plan 48 deg, 0.23 s. The registered run, plan on, peaks 14 deg past, under 30.)
  // Fixed by the shoulder twist flip (p19, SHOULDER_TWIST_ANAT_V2 registered: the limit reads the anatomical twist of a
  // raised arm and is stepped on the arm's own inertia): from the same state the arm is never 30 deg past until the
  // run's last frames (29 deg at its end, 2.70 s, the arm swinging up as he lands), never 60. Now the fix's test: the
  // fault twin is the capture's own profile, plan 09's limit, as above. (V7 from the start is the run as it ran, before
  // the shoulder twist flip too: under the flip it peaks 12 deg past.)
  it('RAISED_ARM_TWIST gone (L3-F19-rear, from 1.800 s): under the registered shoulder twist limit the fallen carrier\'s raised ragdoll left arm never twists 60 deg past range; the fault twin (plan 09\'s limit, the capture\'s) twists it over 60 past, with the bind and without it from the same state; V7 from the start stays under 30', async () => {
    const cap = loadState('tests/data/state/L3-F19-rear@108.json.gz');
    const def = asCaptured(cap);
    expect(def.wrap?.bind).toBeDefined();
    expect(def.ragdoll!.shoulderTwistLimit).toBeUndefined();
    expect(FIX(cap.fixture).ragdoll!.shoulderTwistLimit).toBe(SHOULDER_TWIST_ANAT_V2);
    const look = async (d: FixtureDef, variant?: string[]) => {
      const sim = await resumeState(cap, variant ? { def: d, variant } : { def: d });
      const out = ragdollShoulderTwist(sim);
      sim.dispose();
      return out;
    };
    const pinned = (r: { peak: number; impS: number }): boolean => r.peak > 60 && r.impS > 0.1;
    const fixed = await look({ ...def, ragdoll: withShoulderTwistLimit(def.ragdoll!, SHOULDER_TWIST_ANAT_V2) }, ['ragdoll']);
    expect(fixed.peak, JSON.stringify(fixed)).toBeLessThan(60);
    expect(fixed.impS, JSON.stringify(fixed)).toBeLessThan(0.1);
    // the fault twin
    const on = await look(def);
    const off = await look(preWrapV8(def), ['wrap']);
    const v7Sim = await create(preForwardFall(preWrapV8(preWrapV9(preWrapV10(preWrapV11(preWrapV12(preWrapV13(preShoulderTwist(preSteps(FIX('L3-F19-rear')))))))))));
    // (plan 15 step 4: and before the stepping flip: V7 from the start as sampled)
    const v7 = ragdollShoulderTwist(v7Sim);
    v7Sim.dispose();
    const said = JSON.stringify({ fixed, on, off, v7 });
    expect(off.peak, said).toBeGreaterThan(0);
    expect(pinned(on), said).toBe(true);
    expect(pinned(off), said).toBe(true);
    expect(pinned(v7), said).toBe(false);
    expect(v7.peak, said).toBeLessThan(30);
  }, 120000);
});
