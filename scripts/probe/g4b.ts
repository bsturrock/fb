// G4-B probe: Gate 3 contact scenarios under the Gate 4 profile (ragdoll + SOLVER_G4); sweep the wrap finish.
import { Simulation } from '../../src/sim/simulation';
import * as G3 from '../../src/sim/fixtures/gate3';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
const asG4 = (d: FixtureDef, tag = ''): FixtureDef => ({ ...d, id: d.id + tag, gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4 });
const cases: FixtureDef[] = [
  asG4(G3.g3f3Side(4, 'loss')),
  asG4(G3.g3f3Side(2, 'recover')),
  asG4(G3.g3f9(false)),
  asG4(G3.g3f9Partial('fail', G3.partialRunner(1.1))),
  asG4(G3.g3f9Partial('improve', G3.partialRunner())),
];
for (const [sp, lean] of [[4, 12], [5, 15], [6, 20]]) {
  const d = asG4(G3.g3f9(false), `-fin${sp}-${lean}`);
  const D = d.players.find((p) => p.id === 'D')!;
  (D.controller as any).finish = { dirWorld: v3(0, 0, 1), speedMps: sp, leanDeg: lean, repositionMps: 0.8 };
  cases.push(d);
}
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
for (const def of cases) {
  if (filter && !filter.test(def.id)) continue;
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const ev = sim.events.filter((e) => ['lossOfSupport', 'representation', 'handoffRejected', 'handoffAuditFailure', 'gripRemap', 'gripPassive', 'gripRelease', 'clampRemap', 'numericalFailure', 'practiceOutOfBounds'].includes(e.type));
  console.log('==', def.id, sim.result, 't', sim.t.toFixed(2), JSON.stringify(sim.counts()));
  for (const e of ev) console.log('   ', e.t.toFixed(3), e.type, e.playerId, JSON.stringify(e.data ?? {}).slice(0, 260));
  const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
  console.log('    wrap', ws.join(','), 'reps', sim.players.map((p) => `${p.id}:${p.representation}`).join(' '), 'ragStats', sim.players.map((p) => p.ragStats ? `${p.id} sep ${(p.ragStats.maxAnchorErrM * 1000).toFixed(1)} pen ${(p.ragStats.maxFloorPenM * 1000).toFixed(1)} over ${p.ragStats.maxHingeOverDeg.toFixed(1)} rev ${p.ragStats.maxHingeReverseDeg.toFixed(1)}` : '').join(' '));
  sim.dispose();
}
