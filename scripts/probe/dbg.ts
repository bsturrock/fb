// Usage: vite-node scripts/probe/dbg.ts <fixtureId> [every]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { rv } from '../../src/sim/vec';
const id = process.argv[2]; const every = Number(process.argv[3] ?? 6);
const def = allFixtures().find((f) => f.id === id)!;
const sim = await Simulation.create(def);
while (!sim.done) {
  sim.stepTick();
  if (sim.tick % every) continue;
  const D = sim.byId.get('D')!; const R = sim.byId.get('R');
  const dbg = D.intent.debug ?? {};
  const fmt = (x: unknown) => (x && typeof x === 'object' && 'x' in (x as object) ? rv(x as any, 2).join(',') : typeof x === 'number' ? (x as number).toFixed(2) : String(x));
  console.log(sim.t.toFixed(2), 'D', rv(D.proxy.body.translation(), 2).join(','), 'v', rv(D.proxy.body.linvel(), 2).join(','), 'R', R ? rv(R.proxy.body.translation(), 2).join(',') : '', 'gap', fmt(sim.pairGap['D|R']), ['phase', 'aim', 'gap', 'fitCompatible', 'shoulderLanding', 'headClearance', 'approach'].map((k) => `${k}=${fmt(dbg[k])}`).join(' '), 'req', rv(D.applied.requestedVelocity, 2).join(','), 'F', rv(D.applied.drive, 0).join(','), (sim.contactObs.D ?? []).map((c) => c.ownClass + '>' + c.otherClass).join(';'));
}
