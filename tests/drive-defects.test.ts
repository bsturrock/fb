// Contact motion polish 1.2 (the drive, WRAP_V5), tracked defects (rule 5) its flip reached: mechanisms the drive's moved
// trajectories run into, each on a full-state capture a little before it (tests/data/state; how to capture:
// tests/README.md). Each test pins the defect present in its captured state and fails once the defect is gone from it
// (it then becomes the fix's test, with its fault twin). The twin shows the cause: the same state with the drive off, and
// the run before the flip reaching the same mechanism. The defects and their dispositions: docs/handoff/contact-motion-m3.md,
// "The drive".
import { describe, expect, it } from 'vitest';
import type { FixtureDef } from '../src/sim/fixture';
import { JOINT_RANGE_V3 } from '../src/sim/profiles';
import { SEGMENTS } from '../src/sim/ragdoll';
import type { Simulation } from '../src/sim/simulation';
import { asCaptured, create, FIX, preHipTwist, preWrapV5, preWrapV7, preWrapV8, preWrapV9, preWrapV10 } from './runs';
import { loadState, resumeState } from './state';
import { jointAngles } from './visible';

/** D's supported right hip twist past the 45 deg human range to `untilS`: the peak, its time, seconds past 30, the foot's variant there. */
function supportedHipTwist(sim: Simulation, fromS: number, untilS: number) {
  const D = sim.byId.get('D')!;
  const out = { peak: 0, at: 0, impS: 0, variant: 0, up: true };
  while (!sim.done && sim.t < untilS - 1e-9) {
    sim.stepTick();
    if (sim.t < fromS || !D.pose || D.representation === 'ragdoll' || D.controlMode !== 'supported') continue;
    const m = jointAngles(D.pose, D.body).rightHip;
    if (m.swing > 150) continue;
    const ex = Math.abs(m.rot) - 45;
    if (ex > 30) out.impS += sim.def.solver.outerTickS;
    if (ex > out.peak) Object.assign(out, { peak: ex, at: sim.t, variant: D.feet?.feet.right.variant ?? 0 });
  }
  out.up = !D.handoff;
  return out;
}

/** R's left shoulder twist past the 100 deg human range, to the run's end: the peak, the swing there, seconds past 30. */
function overheadTwist(sim: Simulation) {
  const R = sim.byId.get('R')!;
  const out = { peak: 0, at: 0, swing: 0, impS: 0, lastEx: 0, lastSwing: 0 };
  while (!sim.done) {
    sim.stepTick();
    if (!R.pose || R.representation !== 'ragdoll') continue;
    const m = jointAngles(R.pose, R.body).leftShoulder;
    const ex = Math.abs(m.rot) - 100;
    if (ex > 30) out.impS += sim.def.solver.outerTickS;
    if (ex > out.peak) Object.assign(out, { peak: ex, at: sim.t, swing: m.swing });
    out.lastEx = ex;
    out.lastSwing = m.swing;
  }
  return out;
}

describe('contact motion polish 1.2 tracked defects (rule 5)', () => {
  // (a) L4-F9-transferFailed (the validation profile allowing 1 %: R's conversion at 0.613 s is a labelled failed
  // transfer, his ragdoll diagnostic state with no response). Reversed order under the drive: D goes down with him at
  // 0.621 s (the takedown; 0.912 s before the flip) and R's passive left arm is thrown overhead (swing 176 deg from
  // hanging) with its twist 70 to 79 deg past the human range from 1.2 s to the end. Toward the swing pole the soft
  // swing-twist envelope's twist term (scaled by cos(swing / 2), src/sim/ragdoll.ts) fades, so an arm lying overhead
  // keeps the twist it lands with (inferred from the swing; not isolated). Captured at 1.000 s (both ragdolls); twin,
  // WRAP_V4 from there: the same run to the last digit (once both are ragdolls the drive reads nothing). Before the flip
  // the forward order reaches the same: the arm overhead (swing 146 deg), 79 deg past at 1.72 s, 73 deg at the end.
  // Reached, not made.
  it('OVERHEAD_TWIST_UNHELD (L4-F9-transferFailed reversed, from 1.000 s): a passive ragdoll arm thrown overhead keeps its shoulder twist over 60 deg past range to the end, with the drive and without it from the same state, the bodies identical; before the flip the forward order holds the same', async () => {
    const cap = loadState('tests/data/state/L4-F9-transferFailed~rev@60.json.gz');
    const def = asCaptured(cap);
    expect(def.wrap?.drive).toBeDefined();
    const look = async (d: FixtureDef, variant?: string[]) => {
      const sim = await resumeState(cap, variant ? { def: d, variant } : { def: d });
      const out = overheadTwist(sim);
      expect(sim.byId.get('R')!.handoff?.outcome).toBe('transferFailed');
      const bodies = sim.players.map((p) => SEGMENTS.map((s) => Object.values(p.rag!.bodies[s].translation()).join(',')).join(';')).join('|');
      sim.dispose();
      return { ...out, bodies };
    };
    const on = await look(def);
    const off = await look(preWrapV5(def), ['wrap']);
    const said = JSON.stringify({ ...on, bodies: undefined });
    expect(on.peak, said).toBeGreaterThan(60);
    expect(Math.min(on.swing, on.lastSwing), said).toBeGreaterThan(140);
    expect(on.impS, said).toBeGreaterThan(4);
    expect(on.lastEx, said).toBeGreaterThan(60);
    expect(off.bodies).toBe(on.bodies);
    const bSim = await create(preWrapV5(preWrapV7(preWrapV8(preWrapV9(preWrapV10(FIX('L4-F9-transferFailed')))))), {});
    const before = overheadTwist(bSim);
    bSim.dispose();
    const bSaid = JSON.stringify(before);
    expect(before.peak, bSaid).toBeGreaterThan(60);
    expect(Math.min(before.swing, before.lastSwing), bSaid).toBeGreaterThan(140);
    expect(before.impS, bSaid).toBeGreaterThan(4);
  }, 120000);

  // (b) L3-F5-dragMirror reversed: the drive holds from 0.575 s and ends at 0.850 s with the hold lost (he stays up; the
  // carrier goes down at 1.129 s, 0.829 s before the flip). Stepping on past the fallen carrier, the defender's right
  // swing foot takes a high clearance variant (9) over him, its target close above the hip, and the knee, placed from a
  // pole, turns sideways and back: the supported right hip twist runs 111 deg past range from 1.65 to 1.93 s, his shin
  // crossing the carrier's. The ladder 11b mechanism (tests/hip-twist.test.ts: a foot target close beside or above the
  // hip turns the knee back). Captured at 1.500 s (under JOINT_RANGE_V2); twin, WRAP_V4 from there: the same. Before the
  // drive flip L3-F1-phase1 reaches the same (D's right swing foot in clearance variant 8, 125 deg past at 0.85 s).
  // Reached, not made. Fixed by the 11b thigh-rotation flip (JOINT_RANGE_V3 registered, the thigh's rotation bounded):
  // from the same state inside the range, and L3-F1-phase1 as before the drive flip too. Now the fix's test: the fault
  // twin is the capture's own profile, V2, which turns the knee back as above.
  it('CLEARANCE_KNEE_TURNS_BACK gone (L3-F5-dragMirror reversed, from 1.500 s): under the registered thigh-rotation bound the clearance step keeps the hip twist within range; the fault twin (JOINT_RANGE_V2) turns the knee back over 60 deg past range, with the drive and without it from the same state, and before the drive flip L3-F1-phase1 the same', async () => {
    const cap = loadState('tests/data/state/L3-F5-dragMirror~rev@90.json.gz');
    const def = asCaptured(cap);
    expect(def.wrap?.drive).toBeDefined();
    expect(def.jointRange?.id).toBe('joint-range-v2');
    expect(FIX(cap.fixture).jointRange).toBe(JOINT_RANGE_V3);
    const look = async (d: FixtureDef, variant?: string[]) => {
      const sim = await resumeState(cap, variant ? { def: d, variant } : { def: d });
      const out = supportedHipTwist(sim, 1.5, 2.2);
      sim.dispose();
      return out;
    };
    const on = await look(def);
    const off = await look(preWrapV5(def), ['wrap']);
    const bound = await look({ ...def, jointRange: JOINT_RANGE_V3 }, ['jointRange', 'ragdoll']);
    const said = JSON.stringify({ on, off, bound });
    expect(on.peak, said).toBeGreaterThan(60);
    expect(on.impS, said).toBeGreaterThan(0.2);
    expect(on.variant, said).toBeGreaterThanOrEqual(8);
    expect(on.up, said).toBe(true);
    expect(off, said).toEqual(on);
    expect(bound.peak, said).toBeLessThan(30);
    const phase1 = async (d: FixtureDef) => {
      const sim = await create(preWrapV5(preWrapV7(preWrapV8(preWrapV9(preWrapV10(d))))), {});
      const out = supportedHipTwist(sim, 0.6, 0.95);
      sim.dispose();
      return out;
    };
    const before = await phase1(preHipTwist(FIX('L3-F1-phase1')));
    const registered = await phase1(FIX('L3-F1-phase1'));
    const bSaid = JSON.stringify({ before, registered });
    expect(before.peak, bSaid).toBeGreaterThan(60);
    expect(before.variant, bSaid).toBeGreaterThanOrEqual(8);
    expect(registered.peak, bSaid).toBeLessThan(30);
  }, 120000);
});
