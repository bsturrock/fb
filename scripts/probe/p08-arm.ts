// Plan 08 closeout probe: one arm at actual substeps: palm displacement and second difference (world), its candidate, continuity and contact weight.
// Usage: vite-node scripts/probe/p08-arm.ts <fixture id> <player> <left|right> <from> <to>
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { POSE_DEBUG } from '../../src/sim/pose';
import { len, sub, type Vec3 } from '../../src/sim/vec';
const [id, who, side, from, to] = process.argv.slice(2);
const def = allFixtures().find((d) => d.id === id)!;
let row: Record<string, unknown> | null = null;
let fresh = false;
POSE_DEBUG.trace = (key, r) => {
  if (key === `${who}:${side}Arm` && !fresh) { row = r as Record<string, unknown>; fresh = true; }
};
const h: Vec3[] = [];
const sim = await Simulation.create(def, {
  onSubstep: (s) => {
    fresh = false;
    const P = s.byId.get(who)!;
    if (!P.pose) return;
    const p = P.pose.jointLandmarksWorld[`${side}Palm`];
    h.push(p);
    if (h.length > 3) h.shift();
    if (s.t < Number(from) || s.t > Number(to) || h.length < 3 || !row) return;
    const dx = len(sub(h[2], h[1]));
    const d2 = len(sub(sub(h[2], h[1]), sub(h[1], h[0])));
    const r = row as { v: number; cont: Record<string, number> | null; dc: Vec3; shown: Vec3 | null };
    console.log(s.t.toFixed(4), P.loco?.mode, 'cW', P.loco?.contactW?.toFixed(3), 'dx', (dx * 100).toFixed(2), 'd2', (d2 * 100).toFixed(2), 'v', r.v, 'al', r.cont?.al?.toFixed(3), 'a0', r.cont?.a0?.toFixed(3), 'push', r.cont?.push?.toFixed(4), 'dc', len(r.dc).toFixed(3), 'shown', r.shown ? len(r.shown).toFixed(3) : '-');
  },
});
while (!sim.done) sim.stepTick();
sim.dispose();
