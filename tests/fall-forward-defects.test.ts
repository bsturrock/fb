// Contact motion polish 4 (p17), the forward-fall flip (FALL_REACT_V3 on L3 and HC, FALL_L4_V2 on L4): tracked defects
// (rule 5) its moved trajectories reach, each on a full-state capture a little before it (tests/data/state; how to
// capture: tests/README.md). Each test pins the defect present with the plan and fails once it is gone from the state
// (it then becomes the fix's test, with its fault twin). The twin shows the cause: the same state with the plan off
// (`preForwardFall`, the fall response as before the flip, resumed as a `fallResponse` variant).
import { describe, expect, it } from 'vitest';
import type { Simulation } from '../src/sim/simulation';
import { asCaptured, preForwardFall } from './runs';
import { loadState, resumeState } from './state';
import { jointQuats, qAngle, SNAP_RADPS } from './visible';

/** Resume `path` with the forward-fall plan on (as registered) or off, run `f` on it to the end. */
async function twin<T>(path: string, on: boolean, f: (sim: Simulation) => T): Promise<T> {
  const cap = loadState(path);
  const def = asCaptured(cap);
  expect(def.fallResponse?.forward, path).toBeDefined();
  const sim = await resumeState(cap, on ? { def } : { def: preForwardFall(def), variant: ['fallResponse'] });
  const out = f(sim);
  sim.dispose();
  return out;
}

/** The drawn speed of a player's joint between consecutive frames in one representation, to the end: its peak (rad/s) and time. */
function drawnSpeed(sim: Simulation, id: string, joint: string): { peak: number; at: number } {
  const p = sim.byId.get(id)!;
  const out = { peak: 0, at: 0 };
  let prev: { rep: string; q: ReturnType<typeof jointQuats> } | null = null;
  let t = sim.t;
  while (!sim.done) {
    sim.stepTick();
    const dt = sim.t - t;
    t = sim.t;
    if (!p.pose) continue;
    const q = jointQuats(p.pose);
    if (prev && prev.rep === p.representation) {
      const w = qAngle(prev.q[joint], q[joint]) / dt;
      if (w > out.peak) Object.assign(out, { peak: w, at: sim.t });
    }
    prev = { rep: p.representation, q };
  }
  return out;
}

/** A player's fall-response power to the end: the peak realized, its substeps over the tolerance, whether he fell forward. */
function power(sim: Simulation, id: string): { peakW: number; over: number; impact: number; forward: boolean; capW: number } {
  while (!sim.done) sim.stepTick();
  const r = (sim.exportFixture().fallEffort as Record<string, { peakPositiveW: number; overPowerSubsteps: number; impactPowerSubsteps: number }>)[id];
  const P = sim.def.fallResponse!.power;
  const forward = sim.events.some((e) => e.type === 'fallResponse' && e.playerId === id && e.data?.forward === true);
  return { peakW: r.peakPositiveW, over: r.overPowerSubsteps, impact: r.impactPowerSubsteps, forward, capW: P.maxPositiveW * (1 + P.toleranceFraction) };
}

const FRAME = 1 / 60 + 1e-6;

describe('contact motion polish 4, the forward-fall flip: tracked defects (rule 5)', () => {
  // (a) HC-F3-mirror: the carrier converts at 0.833 s and falls forward; the tackler stays up (supported). At 1.283 s
  // his supported right elbow turns 62 rad/s in one drawn frame (59 deg), the one supported snap the flip added. From the
  // capture at 0.800 s, before the switch, the plan off: the same elbow jumps in the same frame, 41 rad/s, under the bar.
  // From the capture at 1.233 s, the plan running, off from there: the same 62 rad/s. No fall profile drives a supported
  // elbow, and the plan's torques over the last 50 ms do not make it: an existing jump of the tackler's arm, reached
  // harder by the carrier's laid-out trajectory, not made by the plan. The fault twin: the plan off from 0.800 s, under 60.
  it('SUPPORTED_ELBOW_SNAP (HC-F3-mirror, from 0.800 s and 1.233 s): the upright tackler\'s right elbow snaps past 60 rad/s at 1.283 s with the plan, 41 without it from before the switch; off from 1.233 s it still snaps', async () => {
    const on = await twin('tests/data/state/HC-F3-mirror@48.json.gz', true, (s) => drawnSpeed(s, 'D', 'rightElbow'));
    const off = await twin('tests/data/state/HC-F3-mirror@48.json.gz', false, (s) => drawnSpeed(s, 'D', 'rightElbow'));
    const late = await twin('tests/data/state/HC-F3-mirror@74.json.gz', false, (s) => drawnSpeed(s, 'D', 'rightElbow'));
    const said = JSON.stringify({ on, off, late });
    const pinned = (r: { peak: number }): boolean => r.peak > SNAP_RADPS;
    expect(pinned(on), said).toBe(true);
    expect(pinned(late), said).toBe(true);
    expect(pinned(off), said).toBe(false);
    // the same jump without the plan: the same frame, over half the bar
    expect(off.peak, said).toBeGreaterThan(SNAP_RADPS / 2);
    expect(Math.abs(off.at - on.at), said).toBeLessThanOrEqual(FRAME);
    expect(Math.abs(late.at - on.at), said).toBeLessThanOrEqual(FRAME);
  }, 120000);

  // (c) L3-F1-phase7: the carrier converts at 0.558 s and does not fall forward (no plan episode); the tackler converts
  // at 0.879 s and does. At 0.971 s an impact through the carrier's protect elbow (137 W realized on 94 planned) and his
  // legs puts 179 W through his effort, one substep over the 157.5 W tolerance. From the capture at 0.867 s, before the
  // tackler's switch, the plan off: 149 W, just under the 150 W cap. The carrier's joints are not the plan's (he has no
  // forward episode): an impact of his protect arm reached on the trajectory the tackler's lay-out moved. A trend line,
  // as (b). The fault twin: the plan off, under the tolerance.
  it('PROTECT_ELBOW_IMPACT_POWER (L3-F1-phase7, from 0.867 s): the carrier, not falling forward, passes the power tolerance in an impact once the tackler lays out; without the plan he stays just under the cap', async () => {
    const on = await twin('tests/data/state/L3-F1-phase7@52.json.gz', true, (s) => power(s, 'R'));
    const off = await twin('tests/data/state/L3-F1-phase7@52.json.gz', false, (s) => power(s, 'R'));
    const said = JSON.stringify({ on, off });
    expect(on.forward, said).toBe(false);
    expect(on.over, said).toBeGreaterThan(0);
    expect(on.impact, said).toBeGreaterThan(0);
    expect(on.peakW, said).toBeGreaterThan(on.capW);
    expect(off.over, said).toBe(0);
    expect(off.peakW, said).toBeLessThanOrEqual(off.capW);
    expect(off.peakW, said).toBeGreaterThan(off.capW / 1.1);
  }, 120000);
});
