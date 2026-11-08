// Plan 08 probe: a following foot's request, offset and rate around a time.
// Usage: vite-node scripts/probe/p08-req.ts <id> <player> <side> <from> <to>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const [id, player, side, a, b] = process.argv.slice(2);
const s = side as 'left' | 'right';
const f3 = (v: { x: number; y: number; z: number }): string => `${v.x.toFixed(4)} ${v.y.toFixed(4)} ${v.z.toFixed(4)}`;
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, {
  transitionAudit: true,
  onSubstep: (S) => {
    if (S.t < Number(a) - 1e-9 || S.t > Number(b) + 1e-9) return;
    const pl = S.players.find((p) => p.id === player)!;
    const f = pl.feet!.feet[s];
    const c = pl.proxy.body.translation();
    console.log(`t ${S.t.toFixed(4)} ${f.mode}/${f.source} req ${f3(f.lastRequest ?? { x: 0, y: 0, z: 0 })} rv ${f3(f.requestV)} off ${f3(f.offset)} offV ${f3(f.offsetV)} tgt ${f3(f.target)} ctrl ${pl.controlMode} core ${c.x.toFixed(4)} ${c.y.toFixed(4)} ${c.z.toFixed(4)}`);
  },
});
while (!sim.done) sim.stepTick();
sim.dispose();
