// Per-tick limb clearance of R before its support loss in the line-wrap tackle (both arms, no finish).
import { Simulation } from '../../src/sim/simulation';
import * as G3 from '../../src/sim/fixtures/gate3';
import { armsSetup } from '../../src/sim/fixtures/gate2';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
import { POSE_DEBUG } from '../../src/sim/pose';
POSE_DEBUG.on = true;
const def: FixtureDef = { ...G3.g3f3Side(4, 'loss'), gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4, id: 'probe' };
const D = def.players.find((p) => p.id === 'D')!;
D.controller = { kind: 'wrapAttempt', plan: { left: 'wrap', right: 'wrap' }, approachSpeedMps: 7, closingGainPerS: 1000, matchRunnerVelocity: false, interceptLead: true, driveInMps: 7, approachLeanDeg: 12, approachVelocityWorld: v3(0, 0, 7) } as any;
D.arms = armsSetup('forearmClamp', 'forearmClamp', { acquisition: false });
const sim = await Simulation.create(def);
while (!sim.done) {
  sim.stepTick();
  const R = sim.players.find((p) => p.id === 'R')!;
  if (sim.t > 0.8 && sim.t < 1.1 && R.pose) console.log(sim.t.toFixed(3), R.representation, JSON.stringify(R.pose.limbClearance), sim.trace.at(-1)!.players.D.wrap, (POSE_DEBUG.last['R:rightArm'] ?? []).map((c) => c.depth.toFixed(3)).join(' '));
}
