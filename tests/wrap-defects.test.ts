// Contact motion M3, tracked defects (rule 5) the wrap flip reached: mechanisms the flip's moved trajectories run into,
// each on a full-state capture a little before it (tests/data/state; how to capture: tests/README.md). Each test pins the
// defect present in its captured state and fails once the defect is gone from it (it then becomes the fix's test, with
// its fault twin). A capture under the wrap cannot be resumed without it (the defender's controller holds its profile,
// read from the definition), so the twin is the run before the flip constructed to reach the same moment: where the
// defect is there too, the flip reaches it and does not make it. The defects and their dispositions:
// docs/handoff/contact-motion-m3.md, "Tracked defects".
import { describe, expect, it } from 'vitest';
import { DEFAULT_POSE_PROFILE } from '../src/sim/profiles';
import type { Simulation } from '../src/sim/simulation';
import type { FixtureDef } from '../src/sim/fixture';
import { asCaptured, create, FIX, preWrap } from './runs';
import { loadState, resumeState } from './state';
import { depth, drawnShapes } from './visible';

/** Per tick to `untilS`, the deepest the supported carrier's right upper arm (drawn) goes into the defender's drawn trunk. */
function armInDefender(sim: Simulation, untilS: number): { m: number; t: number; ticks: number } {
  const R = sim.byId.get('R')!;
  const D = sim.byId.get('D')!;
  const prof = sim.def.ragdoll ?? DEFAULT_POSE_PROFILE;
  let m = 0;
  let t = NaN;
  let ticks = 0;
  while (!sim.done && sim.t < untilS - 1e-9) {
    sim.stepTick();
    if (!R.pose || !D.pose || R.controlMode !== 'supported' || D.representation !== 'proxy') continue;
    const arm = drawnShapes(R.pose, R.body, prof).filter((s) => s.key.startsWith('rightUpperArm'));
    const trunk = drawnShapes(D.pose, D.body, prof).filter((s) => s.cls === 'trunk');
    const d = Math.max(0, ...arm.flatMap((a) => trunk.map((b) => depth(a, b))));
    if (d > 0.1) ticks++;
    if (d > m) [m, t] = [d, sim.t];
  }
  return { m, t, ticks };
}

/** `d` with the defender's arms off from `s` (no arm work: no early clamp to slow him). */
const armsOffAt = (d: FixtureDef, s: number): FixtureDef => ({
  ...d,
  players: d.players.map((p) => (p.id === 'D' && p.controller.kind === 'wrapAttempt' ? { ...p, controller: { ...p.controller, armsOffAfterS: s } } : p)),
});

describe('contact motion M3 tracked defects (rule 5)', () => {
  // (a) The supported carrier's upper arm, on its clip's swing, goes 10 to 11 cm into the defender's drawn trunk as they
  // meet (the met-arm rule keeps a met forearm and hand out of another body; the upper arm's queries against other
  // trunks are culled). HC-F1-mirror and HC-F1-lowMirror, both orders, under the wrap: 0.67 s to 0.85 s, before and
  // through proxy contact at 0.758 s. Before the flip the defender's early clamp on the carrier's front slows his
  // arrival, and the same arm goes 5.3 cm in. HC-F1-mirror as registered, captured at 0.650 s: 11.4 cm at most. Twin, the
  // run before the flip with the defender's arms off from 0.3 s (no early clamp, the same arrival): 11.2 cm. Reached.
  it('CARRIER_ARM_IN_DEFENDER (HC-F1-mirror, from 0.650 s): the supported carrier\'s right upper arm passes 10 cm into the defender\'s drawn trunk by 0.95 s, under the wrap and before it with no early clamp; before it as registered, 5 to 10 cm', async () => {
    const cap = loadState('tests/data/state/HC-F1-mirror@39.json.gz');
    const def = asCaptured(cap);
    expect(def.wrap).toBeDefined();
    const on = armInDefender(await resumeState(cap, { def }), 0.95);
    const twin = armInDefender(await create(armsOffAt(preWrap(FIX('HC-F1-mirror')), 0.3), {}), 0.95);
    const before = armInDefender(await create(preWrap(FIX('HC-F1-mirror')), {}), 0.95);
    const said = `wrap ${on.m.toFixed(3)} at ${on.t.toFixed(3)}, twin ${twin.m.toFixed(3)} at ${twin.t.toFixed(3)}, before ${before.m.toFixed(3)}`;
    expect(on.m, said).toBeGreaterThan(0.1);
    expect(twin.m, said).toBeGreaterThan(0.1);
    expect(before.m, said).toBeGreaterThan(0.05);
    expect(before.m, said).toBeLessThan(0.1);
  }, 60000);
});
