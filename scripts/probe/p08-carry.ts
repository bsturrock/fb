// Plan 08 review probe: the vertical target speed of every foot whose target was published by a step owner, across every substep
// that keeps its seed: the first carried update, a step's change of mode. Follow-to-step without a reseed is a carried handover.
// Usage: vite-node scripts/probe/p08-carry.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import type { Vec3 } from '../../src/sim/vec';

const re = new RegExp(process.argv[2] ?? '^L3-');
const rows: { r: number; s: string }[] = [];
let carried = 0;
let total = 0;
let worstFlat = -Infinity;
let worstAt = '';
const wide: string[] = [];
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const last = new Map<string, { source: string; mode: string; target: Vec3; seeds: number; carried: boolean }>();
  const sim = await Simulation.create(def, {
    onSubstep: (s) => {
      for (const pl of s.players)
        for (const side of ['left', 'right'] as const) {
          const f = pl.feet?.feet[side];
          if (!f || pl.rag) continue;
          const k = `${pl.id}:${side}`;
          const p = last.get(k);
          if (p && f.seeds === p.seeds && f.source === 'step' && f.mode !== 'planted' && !f.rejoin && (p.source !== 'step' || p.mode !== f.mode)) {
            const r = Math.abs(f.target.y - p.target.y) / s.dt;
            const v = pl.proxy.body.linvel();
            const cap = 3.5 + 2.5 * Math.hypot(v.x, v.z);
            const flat = Math.hypot(f.target.x - p.target.x, f.target.z - p.target.z) / s.dt;
            if (flat - cap > worstFlat) [worstFlat, worstAt] = [flat - cap, `${def.id} ${s.t.toFixed(4)} ${k} ${flat.toFixed(2)} of ${cap.toFixed(2)}`];
            if (flat > cap) wide.push(`${(flat - cap).toFixed(3)} ${def.id} ${s.t.toFixed(4)} ${k} ${p.mode}/${p.source}>${f.mode}/${f.source} carried ${f.carried} flat ${flat.toFixed(2)} cap ${cap.toFixed(2)}`);
            total++;
            if (f.carried) carried++;
            if (r > 1.5 + 1e-6) rows.push({ r, s: `${r.toFixed(3)} ${def.id} ${s.t.toFixed(4)} ${k} ${p.mode}/${p.source}>${f.mode}/${f.source} carried ${f.carried} stat ${f.liftRateMps.toFixed(3)} stepVy ${f.stepV.y.toFixed(3)}` });
          }
          last.set(k, { source: f.source, mode: f.mode, target: { ...f.target }, seeds: f.seeds, carried: f.carried });
        }
    },
  });
  while (!sim.done) sim.stepTick();
  sim.dispose();
}
rows.sort((a, b) => b.r - a.r);
console.log(`unmeasured step starts ${total}, carried ${carried}, over 1.5 m/s ${rows.length}; horizontal speed against its cap, closest: ${worstFlat.toFixed(2)} m/s ${worstAt}`);
for (const r of rows) console.log(r.s);
console.log(`over the horizontal cap ${wide.length}`);
for (const w of wide) console.log(w);
