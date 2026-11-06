// Plan 07 probe: foot modes every 0.1 s and foot events after 2.5 s for one fixture. Usage: vite-node scripts/probe/p07-events.ts <id>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const def = allFixtures().find((d) => d.id === process.argv[2])!;
const sim = await Simulation.create(def);
let last = -1;
while (!sim.done) {
  sim.stepTick();
  const p = sim.players[0];
  if (Math.floor(sim.t * 10) !== last) {
    last = Math.floor(sim.t * 10);
    const v = p.proxy.body.linvel();
    if (sim.t > 2.5) console.log(sim.t.toFixed(2), 'v', Math.hypot(v.x, v.z).toFixed(2), 'L', p.feet!.feet.left.mode, 'R', p.feet!.feet.right.mode);
  }
}
for (const e of sim.events) if (e.type.startsWith('foot') && e.t > 2.5) console.log(e.t.toFixed(3), e.type, e.data?.side ?? '', JSON.stringify(e.data));
