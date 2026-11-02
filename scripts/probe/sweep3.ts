// Sweep G3-F3 collision speed x defender lean: peak lean per player and loss events.
import { Simulation } from '../../src/sim/simulation';
import * as G3 from '../../src/sim/fixtures/gate3';
const speeds = (process.argv[2] ?? '1.5,2,3,4,5').split(',').map(Number);
const leans = (process.argv[3] ?? '0,6,12').split(',').map(Number);
for (const lean of leans)
  for (const v of speeds) {
    const sim = await Simulation.create(G3.g3f3Collision(v, `v${v}-l${lean}`, lean));
    const peak: Record<string, number> = {};
    while (!sim.done) {
      sim.stepTick();
      for (const pl of sim.players) peak[pl.id] = Math.max(peak[pl.id] ?? 0, pl.balance.theta * 57.3);
    }
    const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}:${e.data!.reason}`);
    const first = sim.events.find((e) => e.type === 'contactBegin');
    console.log(`lean ${lean} v ${v}: ${sim.result} contact ${first?.t ?? '-'} peak D ${peak.D.toFixed(1)} R ${peak.R.toFixed(1)} loss ${loss.join(' ') || '-'}`);
  }
