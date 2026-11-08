// Plan 08 probe: both feet's owners every N substeps over a window.
// Usage: vite-node scripts/probe/p08-feet2.ts <id> <player> <from> <to> [every]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const [id, player, a, b, every] = process.argv.slice(2);
const N = Number(every ?? 6);
let n = 0;
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def, {
  onSubstep: (S) => {
    if (S.t < Number(a) || S.t > Number(b) || n++ % N) return;
    const pl = S.players.find((p) => p.id === player)!;
    const line = (['left', 'right'] as const).map((s) => {
      const f = pl.feet!.feet[s];
      const i = pl.pose?.legInfo?.[s];
      return `${s[0]} ${f.mode}/${f.source}${f.wait ? '+w' : ''}${f.carried ? '+carried' : ''} var ${i?.variant} dep ${Math.hypot(f.solvedW.x - f.target.x, f.solvedW.y - f.target.y, f.solvedW.z - f.target.z).toFixed(3)} gap ${f.gapM.toFixed(3)} el ${f.elapsedS.toFixed(2)}/${f.durS.toFixed(2)} y ${f.ankleW.y.toFixed(2)}`;
    });
    console.log(S.t.toFixed(3), pl.loco?.mode, line.join(' | '));
  },
});
while (!sim.done) sim.stepTick();
sim.dispose();
