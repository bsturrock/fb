// Gate 4-A probe: run the G4 fixtures and print handoff audits and ragdoll stats.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
for (const def of gate4Fixtures()) {
  if (filter && !filter.test(def.id)) continue;
  const sim = await Simulation.create(def);
  sim.runToEnd();
  console.log('==', def.id, sim.result, 't', sim.t.toFixed(3), 'counts', JSON.stringify(sim.counts()));
  for (const e of sim.events.filter((e) => ['representation', 'handoffRejected', 'handoffAuditFailure', 'controlMode', 'numericalFailure', 'practiceOutOfBounds', 'lossOfSupport'].includes(e.type)))
    console.log('  ', e.t, e.type, e.playerId, JSON.stringify(e.data).slice(0, 900));
  for (const pl of sim.players) {
    console.log('  ', pl.id, pl.representation, 'ragStats', JSON.stringify(pl.ragStats), 'com', sim.bulk(pl).com, 'v', sim.bulk(pl).v);
    if (pl.pose) console.log('    hinge', JSON.stringify(pl.pose.hingeDeg), 'fallback', pl.pose.straightFallback.join(','), 'clear', JSON.stringify(pl.pose.limbClearance));
  }
  sim.dispose();
}
