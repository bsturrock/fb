// Gate 3 summary: per fixture, loss events, peak lean, peak balance torque, saturation share, wrap statuses.
import { Simulation } from '../../src/sim/simulation';
import { gate3Fixtures } from '../../src/sim/fixtures/gate3';
for (const def of gate3Fixtures()) {
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const out: string[] = [def.id.padEnd(30), sim.result.padEnd(20)];
  for (const pl of sim.players) {
    const L = sim.trace.map((r) => r.players[pl.id].lean!).filter(Boolean);
    const sup = sim.trace.filter((r) => r.players[pl.id].mode === 'supported').map((r) => r.players[pl.id].lean!);
    out.push(`${pl.id}: peak ${Math.max(...sup.map((l) => l.deg)).toFixed(1)}° tau ${Math.max(...L.map((l) => l.tauB)).toFixed(0)}`);
  }
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(3)} ${e.data!.reason} ${Number(e.data!.leanDeg).toFixed(1)}/${Number(e.data!.projectedLeanDeg).toFixed(1)}`);
  out.push(loss.length ? `LOSS ${loss.join(', ')}` : 'no loss');
  const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
  if (ws.length) out.push(`wrap {${ws.join(',')}}`);
  console.log(out.join(' | '));
}
