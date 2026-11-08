// Plan 08 closeout probe: the largest boundaries of one transition kind. Usage: vite-node scripts/probe/p08-kinds.ts <kind regex> [id regex] [count]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const pat = new RegExp(process.argv[2]); const re = new RegExp(process.argv[3] ?? '^L3-'); const n = Number(process.argv[4] ?? 8);
const kinds = (from: string, to: string): string => { const a = from.split(' '); const b = to.split(' '); const o: string[] = []; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) o.push(`${a[i]}>${b[i]}`); return o.sort().join(' + '); };
const out: { id: string; t: number; p: string; d: number; lm: string; k: string }[] = [];
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def, { transitionAudit: true });
  while (!sim.done) sim.stepTick();
  for (const d of sim.transitionDeltas) { const k = kinds(d.from, d.to); if (pat.test(k) && d.deltaM > 0.01) out.push({ id: def.id, t: d.t, p: d.playerId, d: d.deltaM, lm: d.landmark, k }); }
  sim.dispose();
}
out.sort((a, b) => b.d - a.d);
for (const o of out.slice(0, n)) console.log((o.d * 100).toFixed(1), o.id, o.t.toFixed(4), o.p, o.lm, o.k);
console.log('count', out.length);
