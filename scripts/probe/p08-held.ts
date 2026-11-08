// Plan 08 review probe: every carried handover of the L3 fixtures on the ground: how far the old path's ankle and the new one are
// apart, and how much the step's caps took off the old path's motion that substep.
// Usage: vite-node scripts/probe/p08-held.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { dist } from '../../src/sim/vec';

const re = new RegExp(process.argv[2] ?? '^L3-');
const rows: { gap: number; s: string }[] = [];
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const was = new Map<string, boolean>();
  const sim = await Simulation.create(def, {
    transitionAudit: true,
    onSubstep: (s) => {
      for (const pl of s.players)
        for (const side of ['left', 'right'] as const) {
          const f = pl.feet?.feet[side];
          if (!f || pl.rag) continue;
          const k = `${pl.id}:${side}`;
          if (was.get(k) === false && f.carried) {
            const x = s.transitionDeltas.filter((b) => b.playerId === pl.id).at(-1);
            if (x && Math.abs(x.t - s.t) < 1e-9) {
              const gap = dist(x.legs[side].old.ankle, x.legs[side].now.ankle);
              const vy = f.requestWasV.y + f.offsetV.y;
              const cut = Math.max(0, Math.abs(vy) - 1.5) * s.dt;
              rows.push({ gap, s: `${(gap * 100).toFixed(3)} cut ${(cut * 100).toFixed(3)} ${def.id} ${s.t.toFixed(4)} ${k} ${f.mode} vy ${vy.toFixed(3)} var ${x.legs[side].old.variant}/${x.legs[side].now.variant} delta ${(x.deltaM * 100).toFixed(3)} raw ${(x.rawM * 100).toFixed(3)}` });
            }
          }
          was.set(k, f.carried);
        }
    },
  });
  while (!sim.done) sim.stepTick();
  sim.dispose();
}
rows.sort((a, b) => b.gap - a.gap);
console.log(`carried handovers ${rows.length}`);
for (const r of rows.slice(0, 40)) console.log(r.s);
