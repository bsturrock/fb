// Plan 08 closeout probe: every boundary over 1 cm of the L3 fixtures, by landmark family and what differs at it.
// Usage: vite-node scripts/probe/p08-over.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { add, dist, len, scale, sub, type Vec3 } from '../../src/sim/vec';

const re = new RegExp(process.argv[2] ?? '^L3-');
const rows: string[] = [];
let smooth = 0;
let rawOver = 0;
const fam = new Map<string, number>();
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const hist = new Map<string, Vec3[]>();
  const d2 = new Map<string, number>();
  const sim = await Simulation.create(def, {
    transitionAudit: true,
    onSubstep: (s) => {
      for (const pl of s.players)
        for (const [n, p] of Object.entries(pl.pose?.jointLandmarksWorld ?? {})) {
          const h = hist.get(`${pl.id}:${n}`) ?? [];
          h.push(p);
          if (h.length > 3) h.shift();
          hist.set(`${pl.id}:${n}`, h);
          if (h.length === 3) d2.set(`${s.t.toFixed(4)}:${pl.id}:${n}`, len(sub(add(h[2], h[0]), scale(h[1], 2))));
        }
    },
  });
  while (!sim.done) sim.stepTick();
  for (const d of sim.transitionDeltas) {
    if (d.rawM > 0.01) rawOver++;
    if (d.deltaM <= 0.01) continue;
    const kink = d2.get(`${d.t.toFixed(4)}:${d.playerId}:${d.landmark}`) ?? -1;
    if (kink <= 0.01) smooth++;
    const name = d.landmark.replace(/^(left|right)/, '');
    fam.set(name, (fam.get(name) ?? 0) + 1);
    const leg = (['left', 'right'] as const).map((s) => {
      const l = d.legs[s];
      return `${s[0]}:${l.old.kind}>${l.now.kind} req ${(dist(l.old.request, l.now.request) * 100).toFixed(1)} ank ${(dist(l.old.ankle, l.now.ankle) * 100).toFixed(1)} v${l.old.variant}>${l.now.variant} sole ${(l.now.soleO - l.old.soleO).toFixed(2)}`;
    });
    rows.push(`${(d.deltaM * 100).toFixed(1).padStart(4)} raw ${(d.rawM * 100).toFixed(1).padStart(4)} d2 ${(kink * 100).toFixed(1).padStart(4)} ${def.id} ${d.t.toFixed(4)} ${d.playerId} ${d.landmark} | ${leg.join(' | ')} | ${d.to}`);
  }
  sim.dispose();
}
console.log(`raw over ${rawOver}; over ${rows.length}, achieved second difference within 1 cm ${smooth}`);
console.log([...fam].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
for (const r of rows.sort((a, b) => parseFloat(b) - parseFloat(a))) console.log(r);
