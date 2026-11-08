// Plan 08 probe: which L3 fixtures have a referee ending, and the request seams taken up by following feet.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

for (const def of allFixtures().filter((d) => d.id.startsWith('L3-'))) {
  let seams = 0;
  let max = 0;
  let at = 0;
  const sim = await Simulation.create(def, {
    onSubstep: (S) => {
      for (const pl of S.players)
        for (const s of ['left', 'right'] as const) {
          const f = pl.feet?.feet[s];
          if (!f || pl.rag) continue;
          const m = Math.hypot(f.seamOffset.x, f.seamOffset.y, f.seamOffset.z);
          if (m > 0.005) {
            seams++;
            if (m > max) {
              max = m;
              at = S.t;
            }
          }
        }
    },
  });
  sim.runToEnd();
  if (seams || sim.rules?.ending) console.log(def.id, 'seams', seams, max.toFixed(3), at.toFixed(4), 'ending', sim.rules?.ending?.kind ?? '-', sim.rules?.ending?.t?.toFixed?.(3) ?? '');
  sim.dispose();
}
