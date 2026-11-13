// Contact motion polish 1.2 (the ride-down, WRAP_V7), tracked defects (rule 5) its flip reached: mechanisms the ride's
// moved trajectories run into, each on a full-state capture a little before it (tests/data/state; how to capture:
// tests/README.md). Each test pins the defect present in its captured state and fails once the defect is gone from it
// (it then becomes the fix's test, with its fault twin). The twin shows the cause: the same state with the ride off
// (WRAP_V5), and the bound or condition the mechanism needs changed.
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { JOINT_RANGE_V3 } from '../src/sim/profiles';
import type { Simulation } from '../src/sim/simulation';
import { asCaptured, preWrapV7 } from './runs';
import { loadState, resumeState, type StateCapture } from './state';
import { jointAngles } from './visible';

/** D's posed right hip twist past the 45 deg human range to `untilS`: the peak, its time, seconds past 30, the right foot's variant there, whether D is still supported at the end. */
function supportedHipTwist(sim: Simulation, untilS: number) {
  const D = sim.byId.get('D')!;
  const out = { peak: 0, at: 0, impS: 0, variant: 0 };
  while (!sim.done && sim.t < untilS - 1e-9) {
    sim.stepTick();
    if (!D.pose || D.representation === 'ragdoll' || D.controlMode !== 'supported') continue;
    const m = jointAngles(D.pose, D.body).rightHip;
    const ex = Math.abs(m.rot) - 45;
    if (ex > 30) out.impS += sim.def.solver.outerTickS;
    if (ex > out.peak) Object.assign(out, { peak: ex, at: sim.t, variant: D.feet?.feet.right.variant ?? 0 });
  }
  return out;
}

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

async function hipTwin(cap: StateCapture, untilS: number) {
  const def = asCaptured(cap);
  expect(def.wrap?.ride).toBeDefined();
  const look = async (d: FixtureDef, variant?: string[]) => {
    const sim = await resumeState(cap, variant ? { def: d, variant } : { def: d });
    const out = supportedHipTwist(sim, untilS);
    sim.dispose();
    return out;
  };
  return {
    on: await look(def),
    off: await look(preWrapV7(def), ['wrap']),
    bound: await look({ ...def, jointRange: JOINT_RANGE_V3 }, ['jointRange', 'ragdoll']),
  };
}

describe('contact motion polish 1.2, the ride-down: tracked defects (rule 5)', () => {
  // (a) L3-F1-phase1: the hit fells the carrier at 0.550 s; riding, the tackler stays supported and steps on past him
  // (he converted at 0.588 s under WRAP_V5). His right swing foot takes a high clearance variant (8, then 9) over the
  // fallen carrier and the knee, placed from a pole, turns sideways and back: the posed right hip twist 91 deg past range
  // from 0.72 to 0.88 s, then his conversion. The ladder 11b mechanism, tracked since the drive flip as
  // CLEARANCE_KNEE_TURNS_BACK (tests/drive-defects.test.ts (b)): before the drive flip this same fixture reached it, 125
  // deg past at 0.85 s. Captured at 0.667 s; twin, WRAP_V5 from there: he converts at once (0.671 s) and never takes the
  // step; JOINT_RANGE_V3 (the thigh's rotation bounded, used by no fixture yet) from there: inside the range. Reached by
  // the ride keeping him on his feet, not made or worsened by it.
  it('CLEARANCE_KNEE_TURNS_BACK (L3-F1-phase1, from 0.667 s): riding past the felled carrier, a swing foot lifted in a clearance variant turns the knee back, the posed hip twist over 60 deg past range; the ride off converts him before the step; within range under the thigh-rotation bound', async () => {
    const r = await hipTwin(loadState('tests/data/state/L3-F1-phase1@40.json.gz'), 0.95);
    const said = JSON.stringify(r);
    expect(r.on.peak, said).toBeGreaterThan(60);
    expect(r.on.impS, said).toBeGreaterThan(0.1);
    expect(r.on.variant, said).toBeGreaterThanOrEqual(8);
    expect(r.off.peak, said).toBeLessThan(15);
    expect(r.bound.peak, said).toBeLessThan(30);
  }, 120000);

  // (b) L3-F5-dragMirror reversed: riding after the carrier's conversion (0.817 s), both his swing feet in clearance
  // variant 9 over the carrier, the posed right hip twist 71 deg past range for 0.05 s (1.18 to 1.22 s), just before his
  // conversion at 1.225 s (his ragdoll keeps 44 deg past to 1.45 s). Captured at 1.133 s; twin, WRAP_V5 from there: the
  // same mechanism and worse (91 deg past, 0.067 s; he stays up, as under V5 from the start, where it comes at 1.65 to
  // 1.93 s, drive-defects (b)); JOINT_RANGE_V3 from there: inside the range. Reached, not made.
  it('CLEARANCE_KNEE_TURNS_BACK (L3-F5-dragMirror reversed, from 1.133 s): the riding tackler\'s clearance step over the downed carrier turns his knee back, over 60 deg past range; the ride off from the same state does the same or worse; within range under the thigh-rotation bound', async () => {
    const r = await hipTwin(loadState('tests/data/state/L3-F5-dragMirror~rev@68.json.gz'), 1.3);
    const said = JSON.stringify(r);
    expect(r.on.peak, said).toBeGreaterThan(60);
    expect(r.on.variant, said).toBeGreaterThanOrEqual(8);
    expect(r.off.peak, said).toBeGreaterThanOrEqual(r.on.peak);
    expect(r.bound.peak, said).toBeLessThan(30);
  }, 120000);

  // (c) L3-F1-phase5 reversed: the carrier converted at 0.554 s; his passive right arm is thrown overhead (swing about
  // 157 deg from hanging) and keeps its shoulder twist 60 to 79 deg past range from 0.97 to 1.38 s. The mechanism of
  // OVERHEAD_TWIST_UNHELD (tests/drive-defects.test.ts (a): toward the swing pole the swing-twist envelope's twist term
  // fades). Captured at 0.783 s, the tackler still riding; twin, WRAP_V5 from there (he stays up): the same twist, 79 deg
  // past for the same 0.43 s. Reached by the moved trajectory, not made by the ride.
  it('OVERHEAD_TWIST_UNHELD (L3-F1-phase5 reversed, from 0.783 s): the carrier\'s passive arm overhead keeps its shoulder twist over 60 deg past range, with the ride and without it from the same state', async () => {
    const cap = loadState('tests/data/state/L3-F1-phase5~rev@47.json.gz');
    const def = asCaptured(cap);
    expect(def.wrap?.ride).toBeDefined();
    const look = async (d: FixtureDef, variant?: string[]) => {
      const sim = await resumeState(cap, variant ? { def: d, variant } : { def: d });
      const out = ragdollShoulderTwist(sim);
      sim.dispose();
      return out;
    };
    const on = await look(def);
    const off = await look(preWrapV7(def), ['wrap']);
    const said = JSON.stringify({ on, off });
    for (const r of [on, off]) {
      expect(r.peak, said).toBeGreaterThan(60);
      expect(r.swing, said).toBeGreaterThan(140);
      expect(r.impS, said).toBeGreaterThan(0.3);
    }
  }, 120000);
});
