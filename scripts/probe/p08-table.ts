// Plan 08 closeout probe: the transition table of the handoff: boundaries by scenario and by kind, on the corrected same-time
// measure, with the raw difference and the achieved motion beside it.
import { Simulation, type TransitionDelta } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const by = new Map<string, { n: number; over: number; max: number; raw: number }>();
const kinds = new Map<string, { n: number; over: number; max: number }>();
let raw = 0;
let jump = 0;
let stop = 0;
let cont = 0;
let contPass = 0;
let carried = 0;
const all: TransitionDelta[] = [];
for (const def of allFixtures().filter((d) => d.id.startsWith('L3-'))) {
  const sim = await Simulation.create(def, { transitionAudit: true });
  sim.runToEnd();
  const k = def.id.split('-')[1];
  const r = by.get(k) ?? { n: 0, over: 0, max: 0, raw: 0 };
  for (const x of sim.transitionDeltas) {
    all.push(x);
    r.n++;
    if (x.deltaM > 0.01) r.over++;
    r.max = Math.max(r.max, x.deltaM);
    if (x.rawM > 0.01) {
      r.raw++;
      raw++;
      if (Math.max(...Object.values(x.requestJumpM)) > 0) jump++;
      else if (Math.max(...Object.values(x.stepStopM)) > 0) stop++;
      else carried++;
    }
    if (x.continuedM > 0.01) {
      cont++;
      if (x.deltaM <= 0.01) contPass++;
    }
    const a = x.from.split('|');
    const b = x.to.split('|');
    const parts: string[] = [];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) parts.push(`${a[i]}>${b[i]}`);
    const key = parts.sort().join(' + ') || '(same)';
    const q = kinds.get(key) ?? { n: 0, over: 0, max: 0 };
    q.n++;
    if (x.deltaM > 0.01) q.over++;
    q.max = Math.max(q.max, x.deltaM);
    kinds.set(key, q);
  }
  by.set(k, r);
  sim.dispose();
}
for (const [k, r] of [...by].sort((p, q) => Number(p[0].slice(1)) - Number(q[0].slice(1)))) console.log(`${k} ${r.over}/${r.n} max ${(r.max * 100).toFixed(2)} raw ${r.raw}`);
console.log(`all ${all.filter((x) => x.deltaM > 0.01).length}/${all.length} max ${(Math.max(...all.map((x) => x.deltaM)) * 100).toFixed(2)} raw over ${raw}: request jump ${jump}, step stop ${stop}, neither ${carried}; achieved over ${cont}, passing ${contPass}`);
for (const [k, q] of [...kinds].sort((p, r) => r[1].n - p[1].n).slice(0, 12)) console.log(`${q.over}/${q.n} ${(q.max * 100).toFixed(2)} ${k}`);
