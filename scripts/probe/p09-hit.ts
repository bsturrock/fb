// Plan 09 review: the contacts on one player's segments in the substeps around an effort overrun.
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
const [id, pid, from, to] = [process.argv[2], process.argv[3], +process.argv[4], +process.argv[5]];
const def = fallFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, { trace: false });
const s = sim as any;
const orig = s.physics.collectContacts.bind(s.physics);
s.physics.collectContacts = () => {
  const cs = orig();
  if (s.steps >= from && s.steps <= to) {
    const mine = cs.filter((c: any) => c.a.playerId === pid || c.b.playerId === pid).map((c: any) => `${c.a.playerId ?? ''}:${c.a.key}-${c.b.playerId ?? ''}:${c.b.key} J${c.impulse.toFixed(1)}`);
    console.log(`s${s.steps} ${mine.join(' | ')}`);
  }
  return cs;
};
sim.runToEnd();
sim.dispose();
