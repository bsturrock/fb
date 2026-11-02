// G4-F10 probe: canonical forearm wrap (G2-F5 layout, balanced, Gate 4 profile); diagnostic conversions while wrapped.
import { Simulation } from '../../src/sim/simulation';
import * as G2 from '../../src/sim/fixtures/gate2';
import * as G3 from '../../src/sim/fixtures/gate3';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
const at = Number(process.argv[2] ?? 1.2);
for (const who of [[], ['R'], ['D'], ['R', 'D']]) {
  const b = G3.balancedVariant(G2.g2f5());
  const def: FixtureDef = { ...b, id: `F10-${who.join('') || 'none'}`, gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4, durationS: 2.6, diagnostics: { conversions: who.map((p) => ({ playerId: p as any, atS: at })) } };
  const sim = await Simulation.create(def);
  (sim as any).arms && ((sim as any).arms.keepLedger = true);
  sim.runToEnd();
  const ws: string[] = [];
  let last = '';
  for (const r of sim.trace) { const w = String(r.players.D.wrap); if (w !== last) { ws.push(`${r.t.toFixed(2)}:${w}`); last = w; } }
  console.log('==', def.id, sim.result, JSON.stringify(sim.counts()), 'wrap', ws.join(' '));
  for (const e of sim.events.filter((e) => ['gripBegin', 'gripRelease', 'gripRemap', 'gripPassive', 'clampRemap', 'representation', 'handoffRejected', 'lossOfSupport', 'numericalFailure'].includes(e.type) || (e.type === 'clampEnd' && e.data!.reason !== 'contactLost')))
    console.log('   ', e.t.toFixed(3), e.type, e.playerId, JSON.stringify(e.data ?? {}).slice(0, 200));
  const ce = sim.events.filter((e) => e.type === 'clampEnd' && e.data!.reason === 'contactLost').length;
  const L = (sim as any).arms?.ledger ?? [];
  const after = L.filter((x: any) => x.tick * (1 / 60) >= at - 1e-9);
  const kinds: Record<string, number> = {};
  for (const x of after) kinds[`${x.owner}:${x.arm}:${x.kind}`] = (kinds[`${x.owner}:${x.arm}:${x.kind}`] ?? 0) + 1;
  console.log('    contactLost clampEnds', ce, 'ledger after conversion', JSON.stringify(kinds));
  sim.dispose();
}
