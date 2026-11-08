// Plan 09 review: for every substep whose realized positive effort power passes the tolerated ceiling, the contacts
// on that player solved in it, marked new when the same pair had no contact the substep before.
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
import { FallResponse } from '../../src/sim/fall-response';
const CEIL = 157.5;
for (const def of fallFixtures()) {
  const sim = await Simulation.create(def, { trace: false });
  const s = sim as any;
  const orig = s.physics.collectContacts.bind(s.physics);
  let prev = new Map<string, number>();
  let cur = new Map<string, number>();
  s.physics.collectContacts = () => {
    const cs = orig();
    prev = cur;
    cur = new Map(cs.map((c: any) => [`${c.a.playerId ?? ''}:${c.a.key}-${c.b.playerId ?? ''}:${c.b.key}`, c.impulse]));
    return cs;
  };
  const rows: string[] = [];
  const audit = FallResponse.prototype.audit;
  (sim as any).fall && ((sim as any).fall.audit = function (ep: any) {
    audit.call(this, ep);
    const realized = ep.applied.reduce((a: number, { entry }: any) => a + Math.max(0, entry.realizedW), 0);
    if (realized > CEIL) rows.push(`${def.id} ${ep.playerId}@${this.host.steps} ${realized.toFixed(0)}W`);
  });
  // contacts are collected after audit in the same substep: report them on the next collect
  const orig2 = s.physics.collectContacts;
  s.physics.collectContacts = () => {
    const cs = orig2();
    while (rows.length) {
      const r = rows.shift()!;
      const pid = r.split(' ')[1].split('@')[0];
      const mine = [...cur].filter(([k]) => k.includes(`${pid}:`)).map(([k, J]) => `${prev.has(k) ? '' : 'NEW '}${k} ${J.toFixed(1)}`);
      console.log(r, '|', mine.join(' ; '));
    }
    return cs;
  };
  sim.runToEnd();
  sim.dispose();
}
