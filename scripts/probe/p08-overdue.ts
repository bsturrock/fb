// Plan 08 probe: feet that lose support on a step past its time: stored motion and the target's speed on the next substeps.
// Usage: vite-node scripts/probe/p08-overdue.ts <id regex>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { dist, len } from '../../src/sim/vec';

const hz = (v: { x: number; y: number; z: number }): { x: number; y: number; z: number } => ({ x: v.x, y: 0, z: v.z });
for (const def of allFixtures().filter((d) => new RegExp(process.argv[2] ?? '^L3-').test(d.id))) {
  const was = new Map<string, { mode: string; source: string; late: boolean; moveV: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } }>();
  const left = new Map<string, number>();
  const sim = await Simulation.create(def, {
    onSubstep: (s) => {
      for (const pl of s.players)
        for (const side of ['left', 'right'] as const) {
          const f = pl.feet?.feet[side];
          if (!f || pl.rag) continue;
          const k = `${pl.id}:${side}`;
          const p = was.get(k);
          if (p && p.mode === 'swing' && p.source === 'step' && f.mode === 'airborne' && f.source === 'step' && p.late) left.set(k, 4);
          const n = left.get(k) ?? 0;
          if (p && n > 0) {
            console.log(def.id, s.t.toFixed(4), k, 'moved', (len(p.moveV)).toFixed(2), 'target', (dist(hz(f.target), hz(p.target)) / s.dt).toFixed(2), 'stepV', len(hz(f.stepV)).toFixed(2));
            left.set(k, n - 1);
          }
          was.set(k, { mode: f.mode, source: f.source, late: f.elapsedS >= f.durS, moveV: { ...f.moveV }, target: { ...f.target } });
        }
    },
  });
  while (!sim.done) sim.stepTick();
  sim.dispose();
}
