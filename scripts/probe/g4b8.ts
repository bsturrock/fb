// G4-B probe: line-run wrap tackle, vary defender line speed / runner speed for a failed or partial attempt.
import { Simulation } from '../../src/sim/simulation';
import * as G3 from '../../src/sim/fixtures/gate3';
import { armsSetup } from '../../src/sim/fixtures/gate2';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
for (const [vd, vr] of [[3, 4], [4, 4], [5, 4], [5, 6], [4, 6], [7, 6]]) {
  const def: FixtureDef = { ...G3.g3f3Side(vr, 'x', vd), gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4, id: `L-d${vd}-r${vr}`, durationS: 3 };
  const D = def.players.find((p) => p.id === 'D')!;
  D.controller = { kind: 'wrapAttempt', plan: { left: 'wrap', right: 'wrap' }, approachSpeedMps: vd, closingGainPerS: 1000, matchRunnerVelocity: false, interceptLead: true, driveInMps: vd, approachLeanDeg: 12, approachVelocityWorld: v3(0, 0, vd), finish: { dirWorld: v3(0, 0, 1), speedMps: vd, leanDeg: 12, repositionMps: 0, minProgressMps: -100 } } as any;
  D.arms = armsSetup('forearmClamp', 'forearmClamp', { acquisition: false });
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
  const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
  const rej = sim.events.filter((e) => e.type === 'handoffRejected').map((e) => `${e.playerId}:${e.data!.reasons}`);
  const R = sim.trace.at(-1)!.players.R;
  console.log(def.id.padEnd(10), sim.result.padEnd(19), 'loss', loss.join(',').padEnd(14), 'wraps', ws.join(',').padEnd(40), rej.join(' '), sim.players.map((p) => p.id + ':' + p.representation).join(' '), 'R end p', R.p.map((x) => x.toFixed(1)).join(','), 'v', R.v.map((x) => x.toFixed(1)).join(','));
  sim.dispose();
}
