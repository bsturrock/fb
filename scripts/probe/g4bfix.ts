// Run every G4-B fixture and print the handoff / grip / clamp event story.
import { SIM_DEFAULTS, Simulation } from '../../src/sim/simulation';
SIM_DEFAULTS.ledgers = true; // reads the ledgers (plan 10c: off by default)
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const only = process.argv[2];
for (const def of gate4Fixtures().filter((d) => d.milestone === 'G4-B' && (!only || d.id.includes(only)))) {
  const sim = await Simulation.create(def);
  (sim as any).arms && ((sim as any).arms.keepLedger = true);
  sim.runToEnd();
  const ws: string[] = [];
  let last = '';
  for (const r of sim.trace) { const w = String(r.players.D?.wrap); if (w !== last) { ws.push(`${r.t.toFixed(2)}:${w}`); last = w; } }
  console.log('==', def.id, sim.result, JSON.stringify(sim.counts()), 'wrap', ws.join(' '));
  for (const e of sim.events.filter((e) => ['gripBegin', 'gripRelease', 'gripRemap', 'gripPassive', 'clampRemap', 'representation', 'handoffRejected', 'lossOfSupport', 'numericalFailure', 'trialEnd'].includes(e.type) || (e.type === 'clampEnd' && e.data!.reason !== 'contactLost')))
    console.log('   ', e.t.toFixed(3), e.type, e.playerId, JSON.stringify(e.data ?? {}).slice(0, 220));
  const ce = sim.events.filter((e) => e.type === 'clampEnd' && e.data!.reason === 'contactLost').length;
  const conv = def.diagnostics?.conversions?.[0]?.atS ?? 0;
  const L = (sim as any).arms?.ledger ?? [];
  const kinds: Record<string, number> = {};
  for (const x of L.filter((x: any) => x.tick / 60 >= conv - 1e-9)) kinds[`${x.owner}:${x.arm}:${x.kind}`] = (kinds[`${x.owner}:${x.arm}:${x.kind}`] ?? 0) + 1;
  console.log('    contactLost clampEnds', ce, 'ledger from', conv, JSON.stringify(kinds));
  sim.dispose();
}
