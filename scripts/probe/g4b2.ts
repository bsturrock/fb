// G4-B probe: fast wrap approaches under the Gate 4 profile; which produce a runner support loss with a genuine wrap?
import { Simulation } from '../../src/sim/simulation';
import * as G2 from '../../src/sim/fixtures/gate2';
import * as G3 from '../../src/sim/fixtures/gate3';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
for (const appr of [4, 6]) for (const vr of [2, 3]) for (const drive of [0.3, 2]) for (const band of [0.22, 0.0]) {
  const lean = 12;
  const base = G3.balancedVariant(G2.wrapFixture({
    id: `W-a${appr}-r${vr}-d${drive}-b${band}`, title: 'probe',
    wrap: { approachSpeedMps: appr, closingGainPerS: 40, driveInMps: drive, approachLeanDeg: lean, bandYLocal: band, finish: { dirWorld: v3(0, 0, 1), speedMps: appr, leanDeg: 12, repositionMps: 0.8 } },
    runner: [{ fromS: 0, velocity: v3(vr, 0, 0), facing: v3(1, 0, 0), effort: 0.8 }],
    defenderStart: { x: -vr * 0.55 - 0.2, z: -appr * 0.55 - 0.3, yawDeg: 0 },
    durationS: 2.5,
  }));
  const def: FixtureDef = { ...base, gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4 };
  def.players.find((p) => p.id === 'R')!.initial.velocity = v3(vr, 0, 0);
  def.players.find((p) => p.id === 'D')!.initial.velocity = v3(0, 0, appr);
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
  const wrapAtLoss: string[] = [];
  for (const e of sim.events.filter((e) => e.type === 'lossOfSupport' && e.playerId === 'R')) {
    const row = sim.trace.find((r) => r.t >= e.t - 1e-9);
    wrapAtLoss.push(String(row?.players.D?.wrap));
  }
  const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
  const rej = sim.events.filter((e) => e.type === 'handoffRejected').map((e) => `${e.playerId}:${e.data!.reasons}`);
  console.log(def.id.padEnd(26), sim.result.padEnd(18), 'loss', loss.join(',').padEnd(14), 'wrapAtLoss', wrapAtLoss.join(','), 'wraps', ws.join(','), rej.length ? 'REJ ' + rej.join(' ') : '', sim.players.map((p) => p.id + ':' + p.representation).join(' '));
  sim.dispose();
}
