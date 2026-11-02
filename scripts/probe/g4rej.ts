import { Simulation } from '../../src/sim/simulation';
import { lineTackle } from '../../src/sim/fixtures/gate4';
for (const vd of [2, 2.5]) {
  const sim = await Simulation.create(lineTackle({ id: 'x', title: '', plan: { left: 'none', right: 'wrap' }, vd, vr: 4 }));
  sim.runToEnd();
  for (const e of sim.events.filter((e) => ['handoffRejected', 'representation', 'lossOfSupport', 'ruleObserverDisabled'].includes(e.type))) console.log(vd, e.t, e.type, e.playerId, JSON.stringify(e.data).slice(0, 600));
}
