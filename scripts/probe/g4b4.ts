// G4-B probe: side hits that run at the runner with a wrap arm plan (Gate 4 profile).
import { Simulation } from '../../src/sim/simulation';
import * as G2 from '../../src/sim/fixtures/gate2';
import * as G3 from '../../src/sim/fixtures/gate3';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
import type { ArmPlan } from '../../src/sim/controllers/wrap';
const verbose = process.argv[2] === 'v';
const fin = Number(process.argv[4] ?? 7);
const flean = Number(process.argv[5] ?? 12);
for (const [plan, vd, vr, band] of [
  [['wrap', 'wrap'], 7, 4, 0.22], [['wrap', 'wrap'], 6, 3, 0.22], [['wrap', 'wrap'], 7, 4, 0.0], [['wrap', 'wrap'], 7, 2, 0.22],
  [['none', 'wrap'], 7, 4, 0.22], [['none', 'wrap'], 6, 3, 0.0], [['wrap', 'none'], 7, 4, 0.22], [['wrap', 'none'], 7, 3, 0.0],
] as [[ArmPlan, ArmPlan], number, number, number][]) {
  const tMeet = Math.min(2 / vr, 0.6);
  const base = G3.balancedVariant(G2.wrapFixture({
    id: `H-${plan.join('/')}-d${vd}-r${vr}-b${band}`, title: 'probe',
    wrap: { plan: { left: plan[0], right: plan[1] }, approachSpeedMps: vd, closingGainPerS: 1000, matchRunnerVelocity: false, interceptLead: true, driveInMps: 0, approachLeanDeg: 12, bandYLocal: band, finish: { dirWorld: v3(0, 0, 1), speedMps: fin, leanDeg: flean, repositionMps: 0.8 } },
    runner: [{ fromS: 0, velocity: v3(vr, 0, 0), facing: v3(1, 0, 0), effort: 1 }],
    defenderStart: { x: 0, z: -vd * tMeet - 0.35, yawDeg: 0 },
    durationS: 2.5,
  }));
  const def: FixtureDef = { ...base, gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4 };
  const R = def.players.find((p) => p.id === 'R')!;
  R.initial = { ...R.initial, x: -vr * tMeet, velocity: v3(vr, 0, 0) };
  const D = def.players.find((p) => p.id === 'D')!;
  D.initial = { ...D.initial, velocity: v3(0, 0, vd), leanDeg: 12, leanDirWorld: v3(0, 0, 1) };
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
  const wrapAtLoss: string[] = [];
  for (const e of sim.events.filter((e) => e.type === 'lossOfSupport' && e.playerId === 'R')) wrapAtLoss.push(String(sim.trace.find((r) => r.t >= e.t - 1e-9)?.players.D?.wrap));
  const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
  const ev = sim.events.filter((e) => ['handoffRejected', 'gripRemap', 'gripPassive', 'clampRemap', 'handoffAuditFailure', 'numericalFailure'].includes(e.type)).map((e) => `${e.t.toFixed(2)} ${e.type} ${e.playerId} ${JSON.stringify(e.data).slice(0, 140)}`);
  const ends = sim.events.filter((e) => e.type === 'clampEnd' && e.data!.reason !== 'contactLost').map((e) => `${e.t.toFixed(2)} ${e.data!.reason}`);
  console.log(def.id.padEnd(34), sim.result.padEnd(19), 'loss', loss.join(',').padEnd(14), 'wrapAtLoss', wrapAtLoss.join(',').padEnd(11), 'wraps', ws.join(','), sim.players.map((p) => p.id + ':' + p.representation).join(' '));
  if (verbose) for (const x of [...ev, ...ends]) console.log('     ', x);
  if (process.argv[3] && def.id.includes(process.argv[3]))
    for (const r of sim.trace.filter((_, i) => i % 3 === 0 && _.t > 0.2 && _.t < 1.3)) {
      const d = r.players.D, Rr = r.players.R;
      console.log('   ', r.t.toFixed(2), 'D p', d.p.map((x) => x.toFixed(2)).join(','), 'v', d.v.map((x) => x.toFixed(1)).join(','), 'R p', Rr.p.map((x) => x.toFixed(2)).join(','), 'v', Rr.v.map((x) => x.toFixed(1)).join(','), 'Rlean', Rr.lean?.deg.toFixed(1), 'tau', Rr.lean?.tauB.toFixed(0), 'Dlean', d.lean?.deg.toFixed(1), d.wrap, d.ph);
    }
  sim.dispose();
}
