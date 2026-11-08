// Plan 08 probe: transition audit summary of every L3 fixture matching the regex: boundaries, over 1 cm, the largest.
// Usage: vite-node scripts/probe/p08-audit-all.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2] ?? '^L3-');
const hist = new Map<string, { n: number; over: number; max: number }>();
const kinds = (from: string, to: string): string => {
  const a = from.split(' ');
  const b = to.split(' ');
  const out: string[] = [];
  // (a foot's reseed count is its identity, not its kind)
  const kind = (x: string): string => x.replace(/#\d+/, '');
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) out.push(kind(a[i]) === kind(b[i]) ? `reseed ${kind(a[i])}` : `${kind(a[i])}>${kind(b[i])}`);
  return out.sort().join(' + ');
};
let total = 0;
let over = 0;
let rawOver = 0;
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def, { transitionAudit: true });
  while (!sim.done) sim.stepTick();
  const ds = [...sim.transitionDeltas].sort((a, b) => b.deltaM - a.deltaM);
  const n = ds.filter((d) => d.deltaM > 0.01).length;
  rawOver += ds.filter((d) => d.rawM > 0.01).length;
  for (const d of ds) {
    const k = kinds(d.from, d.to);
    const h = hist.get(k) ?? { n: 0, over: 0, max: 0 };
    h.n++;
    if (d.deltaM > 0.01) h.over++;
    h.max = Math.max(h.max, d.deltaM);
    hist.set(k, h);
  }
  total += ds.length;
  over += n;
  const d = ds[0];
  console.log(`${def.id.padEnd(26)} ${String(ds.length).padStart(4)} ${String(n).padStart(3)} ${d ? `${(d.deltaM * 100).toFixed(1).padStart(5)} ${d.t.toFixed(3)} ${d.playerId} ${d.landmark} [${d.from} > ${d.to}]` : ''}`);
  sim.dispose();
}
console.log(`total ${total} over 1 cm ${over} (raw, before the reference's own corrections: ${rawOver})`);
for (const [k, h] of [...hist].sort((a, b) => b[1].over - a[1].over).slice(0, 24)) console.log(`${String(h.over).padStart(4)}/${String(h.n).padEnd(4)} ${(h.max * 100).toFixed(1).padStart(5)} ${k}`);
