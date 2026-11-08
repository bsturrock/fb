// Plan 08 review probe: which L3 fixtures have a player the walking ramp would have held on a request after a referee ending.
// Usage: vite-node scripts/probe/p08-whistles.ts
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { len } from '../../src/sim/vec';

let endings = 0;
const held: string[] = [];
for (const def of allFixtures().filter((d) => d.id.startsWith('L3-') && d.runClips?.walk)) {
  const was = new Map<string, number>();
  let called = false;
  const sim = await Simulation.create(def, {
    onSubstep: (s) => {
      if (s.rules?.ending && !called) {
        called = true;
        endings++;
        for (const pl of s.players) {
          const v = was.get(pl.id) ?? 0;
          if (pl.controlMode === 'supported' && pl.loco?.mode === 'free' && v > 0 && v <= def.runClips!.walk!.requestMps[1]) held.push(`${def.id} ${s.t.toFixed(3)} ${pl.id} ${v.toFixed(3)}`);
        }
      }
      for (const pl of s.players) was.set(pl.id, len(pl.walkRequest ?? { x: 0, y: 0, z: 0 }));
    },
  });
  while (!sim.done) sim.stepTick();
  sim.dispose();
}
console.log(`L3 referee endings ${endings}, players the ramp would have held ${held.length}`);
for (const h of held) console.log(h);
