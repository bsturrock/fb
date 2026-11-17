// Contact motion polish 1.2 (the ride-down, WRAP_V7), tracked defects (rule 5) its flip reached: mechanisms the ride's
// moved trajectories run into, each on a full-state capture a little before it (tests/data/state; how to capture:
// tests/README.md). Each test pins the defect present in its captured state and fails once the defect is gone from it
// (it then becomes the fix's test, with its fault twin: (c) since the shoulder twist flip). The twin shows the cause:
// the same state with the bound or condition the mechanism needs changed. Plan 15 step 5b: the capture, taken on the
// reactive planner, resumes with the contact stepping model taking over the feet (`asCaptured`'s footwork variant).
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { SHOULDER_TWIST_ANAT_V2, withShoulderTwistLimit } from '../src/sim/profiles';
import type { Simulation } from '../src/sim/simulation';
import { asCaptured, FIX } from './runs';
import { loadState, resumeState } from './state';
import { jointAngles } from './visible';

/** R's ragdoll right shoulder twist past the 100 deg human range, to the run's end: the peak, the swing there, seconds past 30. */
function ragdollShoulderTwist(sim: Simulation) {
  const R = sim.byId.get('R')!;
  const out = { peak: 0, at: 0, swing: 0, impS: 0 };
  while (!sim.done) {
    sim.stepTick();
    if (!R.pose || R.representation !== 'ragdoll') continue;
    const m = jointAngles(R.pose, R.body).rightShoulder;
    const ex = Math.abs(m.rot) - 100;
    if (ex > 30) out.impS += sim.def.solver.outerTickS;
    if (ex > out.peak) Object.assign(out, { peak: ex, at: sim.t, swing: m.swing });
  }
  return out;
}

describe('contact motion polish 1.2, the ride-down: tracked defects (rule 5)', () => {
  // (c) L3-F1-phase5 reversed: the carrier converted at 0.554 s; his passive right arm is thrown overhead (swing about
  // 157 deg from hanging) and keeps its shoulder twist 60 to 79 deg past range from 0.97 to 1.38 s. The mechanism of
  // OVERHEAD_TWIST_UNHELD (tests/drive-defects.test.ts (a): toward the swing pole the swing-twist envelope's twist term
  // fades). Captured at 0.783 s, the tackler still riding; twin, WRAP_V5 from there (he stays up): the same twist, 79 deg
  // past for the same 0.43 s. Reached by the moved trajectory, not made by the ride. Fixed by the shoulder twist flip (p19,
  // SHOULDER_TWIST_ANAT_V2 registered): from the same state the arm no longer goes overhead (swing at most 110 deg) and
  // peaks 6 deg past. Now the fix's test: the fault twin is the capture's own profile, plan 09's limit, as above (on the
  // model's feet: 80 deg past, swing 163 deg, 0.43 s).
  it('OVERHEAD_TWIST_UNHELD gone (L3-F1-phase5 reversed, from 0.783 s): under the registered shoulder twist limit the carrier\'s passive arm never goes 30 deg past range; the fault twin (plan 09\'s limit, the capture\'s) keeps it overhead over 60 deg past', async () => {
    const cap = loadState('tests/data/state/L3-F1-phase5~rev@47.json.gz');
    const def = asCaptured(cap, undefined, ['footwork']);
    expect(def.wrap?.ride).toBeDefined();
    expect(def.ragdoll!.shoulderTwistLimit).toBeUndefined();
    expect(FIX(cap.fixture).ragdoll!.shoulderTwistLimit).toBe(SHOULDER_TWIST_ANAT_V2);
    const look = async (d: FixtureDef, variant?: string[]) => {
      const sim = await resumeState(cap, variant ? { def: d, variant } : { def: d });
      const out = ragdollShoulderTwist(sim);
      sim.dispose();
      return out;
    };
    const fixed = await look({ ...def, ragdoll: withShoulderTwistLimit(def.ragdoll!, SHOULDER_TWIST_ANAT_V2) }, ['footwork', 'ragdoll']);
    expect(fixed.peak, JSON.stringify(fixed)).toBeLessThan(30);
    expect(fixed.impS, JSON.stringify(fixed)).toBe(0);
    // the fault twin
    const on = await look(def, ['footwork']);
    const said = JSON.stringify({ on });
    expect(on.peak, said).toBeGreaterThan(60);
    expect(on.swing, said).toBeGreaterThan(140);
    expect(on.impS, said).toBeGreaterThan(0.3);
  }, 120000);
});
