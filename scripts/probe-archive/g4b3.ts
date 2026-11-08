// Trace one fast wrap approach: D/R velocities, gap, R lean and balance torque around contact.
import { Simulation } from '../../src/sim/simulation';
import * as G2 from '../../src/sim/fixtures/gate2';
import * as G3 from '../../src/sim/fixtures/gate3';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
const appr = Number(process.argv[2] ?? 6), vr = Number(process.argv[3] ?? 3);
const base = G3.balancedVariant(G2.wrapFixture({
  id: 'W', title: 'probe',
  wrap: { approachSpeedMps: appr, closingGainPerS: 40, driveInMps: 2, approachLeanDeg: 12, finish: { dirWorld: v3(0, 0, 1), speedMps: appr, leanDeg: 12, repositionMps: 0.8 } },
  runner: [{ fromS: 0, velocity: v3(vr, 0, 0), facing: v3(1, 0, 0), effort: 0.8 }],
  defenderStart: { x: -vr * 0.55 - 0.2, z: -appr * 0.55 - 0.3, yawDeg: 0 },
  durationS: 1.6,
}));
const def: FixtureDef = { ...base, gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4 };
def.players.find((p) => p.id === 'R')!.initial.velocity = v3(vr, 0, 0);
def.players.find((p) => p.id === 'D')!.initial.velocity = v3(0, 0, appr);
const sim = await Simulation.create(def);
sim.runToEnd();
for (const r of sim.trace.filter((_, i) => i % 3 === 0)) {
  const d = r.players.D, R = r.players.R;
  console.log(r.t.toFixed(2), 'D p', d.p.map((x) => x.toFixed(2)).join(','), 'v', d.v.map((x) => x.toFixed(1)).join(','), 'R p', R.p.map((x) => x.toFixed(2)).join(','), 'v', R.v.map((x) => x.toFixed(1)).join(','), 'Rlean', R.lean?.deg.toFixed(1), 'tau', R.lean?.tauB.toFixed(0), 'Dlean', d.lean?.deg.toFixed(1), d.wrap, d.ph);
}
