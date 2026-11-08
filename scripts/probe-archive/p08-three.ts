// Plan 08 review probe: one leg's three poses at one boundary: live, the old composition, the reference (old with its own snaps out).
// Usage: vite-node scripts/probe/p08-three.ts <fixture id> <player> <t> <left|right>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { POSE_DEBUG } from '../../src/sim/pose';
import type { Vec3 } from '../../src/sim/vec';

const [id, who, at, side] = process.argv.slice(2);
const t0 = Number(at);
const f3 = (v: Vec3 | null | undefined): string => (v ? `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}` : '-');
let got: Record<string, unknown>[] = [];
POSE_DEBUG.trace = (key, r) => {
  if (key === `${who}:${side}Leg`) got.push(r);
};
const sim = await Simulation.create(allFixtures().find((d) => d.id === id)!, {
  transitionAudit: true,
  onSubstep: (s) => {
    if (Math.abs(s.t - t0) < 1e-5) {
      got.forEach((r, i) => {
        const x = r as { v: number; base: Vec3; dc: Vec3 | null; shown: Vec3 | null; ankle: Vec3; chosenAnkle: Vec3; depth: number; chosenDepth: number; fb: unknown; cont: { al: number; a0: number; dd: number; push: number } | null };
        console.log(`${['live', 'old', 'reference'][i] ?? i} v ${x.v} base ${f3(x.base)} dc ${f3(x.dc)} shown ${f3(x.shown)} ankle ${f3(x.ankle)} chosen ${f3(x.chosenAnkle)} depth ${x.depth.toFixed(4)}/${x.chosenDepth.toFixed(4)} cont ${JSON.stringify(x.cont)} fb ${x.fb}`);
      });
      const f = s.byId.get(who)!.feet!.feet[side as 'left' | 'right'];
      console.log(`target ${f3(f.target)} mode ${f.mode}/${f.source} seeds ${f.seeds} carried ${f.carried} ownN ${f.ownN} el ${f.elapsedS.toFixed(4)}/${f.durS.toFixed(4)} moveV ${f3(f.moveV)}`);
    }
    got = [];
  },
});
while (!sim.done) sim.stepTick();
for (const d of sim.transitionDeltas) if (Math.abs(d.t - t0) < 1e-5 && d.playerId === who) console.log(`delta ${(d.deltaM * 100).toFixed(3)} raw ${(d.rawM * 100).toFixed(3)} ${d.landmark}`);
sim.dispose();
