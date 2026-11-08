// Gate 3 outcome summary at a given substep count (argv[2]); compares emergent outcomes across solver settings.
import { Simulation } from '../../src/sim/simulation';
import { gate3Fixtures } from '../../src/sim/fixtures/gate3';
const sub = Number(process.argv[2] ?? 1);
for (const def of gate3Fixtures()) {
  def.solver = { ...def.solver, substeps: sub };
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
  const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
  console.log(def.id.padEnd(34), sim.result.padEnd(14), loss.length ? `LOSS ${loss.join(',')}` : 'no loss', ws.length ? `wrap {${ws.join(',')}}` : '');
  sim.dispose();
}
