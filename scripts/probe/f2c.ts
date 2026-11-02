import { Simulation } from '../../src/sim/simulation';
import { g1f2 } from '../../src/sim/fixtures/gate1';
const sim = await Simulation.create(g1f2('compound'));
for (let i = 0; i < 70; i++) { sim.stepTick(); }
for (let i = 0; i < 6; i++) { sim.stepTick(); const r = sim.trace.at(-1)!; console.log(r.t, r.players.D.p, r.players.D.v, r.players.R.p, 'gap', sim.pairGap['D|R'], 'contacts', sim.contacts.filter(c=>c.a.playerId && c.b.playerId).map(c=>`${c.a.playerId}.${c.a.region}-${c.b.playerId}.${c.b.region} ${c.points.length} ${c.points[0].dist.toFixed(4)}`), Object.values(sim.contactObs).map(x=>x.length)); }
