// G4-B probe: wrap-and-anchor tackles (defender wraps from the flank, then holds the runner's run direction).
import { Simulation } from '../../src/sim/simulation';
import * as G2 from '../../src/sim/fixtures/gate2';
import * as G3 from '../../src/sim/fixtures/gate3';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
import type { ArmPlan } from '../../src/sim/controllers/wrap';
const tr = process.argv[2];
for (const vr of [3, 5]) for (const band of [0.22, -0.05, -0.12]) for (const plan of [['wrap', 'wrap'], ['none', 'wrap']] as [ArmPlan, ArmPlan][]) {
  const id = `A-r${vr}-b${band}-${plan.join('/')}`;
  const base = G3.balancedVariant(G2.wrapFixture({
    id, title: 'probe',
    wrap: { plan: { left: plan[0], right: plan[1] }, approachSpeedMps: 4, bandYLocal: band, finish: { dirWorld: v3(-1, 0, 0), speedMps: 0, leanDeg: 12, repositionMps: 0, minProgressMps: -100 } },
    runner: [{ fromS: 0, velocity: v3(vr, 0, 0), facing: v3(1, 0, 0), effort: 1 }],
    defenderStart: { x: 0.2, z: -1.2, yawDeg: 0 },
    durationS: 3,
  }));
  const def: FixtureDef = { ...base, gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4 };
  def.players.find((p) => p.id === 'R')!.initial.velocity = v3(vr, 0, 0);
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
  const wrapAtLoss: string[] = [];
  for (const e of sim.events.filter((e) => e.type === 'lossOfSupport' && e.playerId === 'R')) wrapAtLoss.push(String(sim.trace.find((r) => r.t >= e.t - 1e-9)?.players.D?.wrap));
  const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
  const peak = Math.max(...sim.trace.filter((r) => r.players.R.mode === 'supported').map((r) => r.players.R.lean?.deg ?? 0));
  const ev = sim.events.filter((e) => ['handoffRejected', 'gripRemap', 'gripPassive', 'clampRemap', 'handoffAuditFailure', 'numericalFailure'].includes(e.type)).map((e) => `${e.t.toFixed(2)} ${e.type} ${e.playerId}`);
  console.log(id.padEnd(26), sim.result.padEnd(19), 'loss', loss.join(',').padEnd(14), 'peakLeanR', peak.toFixed(1).padStart(5), 'wrapAtLoss', wrapAtLoss.join(',').padEnd(11), 'wraps', ws.join(','), ev.join(' | '));
  if (tr === id)
    for (const r of sim.trace.filter((x, i) => i % 3 === 0 && x.t > 0.2 && x.t < 2.0)) {
      const d = r.players.D, Rr = r.players.R;
      console.log('   ', r.t.toFixed(3), 'D p', d.p.map((x) => x.toFixed(2)).join(','), 'v', d.v.map((x) => x.toFixed(1)).join(','), 'R p', Rr.p.map((x) => x.toFixed(2)).join(','), 'v', Rr.v.map((x) => x.toFixed(1)).join(','), 'Rlean', Rr.lean?.deg.toFixed(1), 'tau', Rr.lean?.tauB.toFixed(0), 'Dlean', d.lean?.deg.toFixed(1), d.wrap, d.ph ?? '');
    }
  sim.dispose();
}
