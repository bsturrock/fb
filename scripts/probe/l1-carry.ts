// Probe (plan 06 pass 2): clear ball-carry holds on the model geometry. Grid of authored-frame carry palms (mapped by
// proceduralLocal) and elbow poles; self (own torso/pelvis) depth of the forearm/palm and external depth.
// Usage: vite-node scripts/probe/l1-carry.ts
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { armShapes, proceduralLocal, twoBone } from '../../src/sim/pose';
import { shoulderLocal, sideSignX } from '../../src/sim/profiles';
import { qRot, toWorld, v3 } from '../../src/sim/vec';
const def = allFixtures().find((d) => d.id === 'L1-F1-fastRun')!;
const sim = await Simulation.create(def);
while (sim.t < 0.5) sim.stepTick();
const pl = sim.players[0];
const R = def.ragdoll!;
const C = (sim as unknown as { poseClearance(p: unknown): { self(s: unknown[]): number } }).poseClearance(pl);
const core = { p: pl.pose!.segments.core.originWorld, q: pl.pose!.segments.core.rotationWorld };
const sx = sideSignX(pl.body, 'right');
const sh = toWorld(core, shoulderLocal(pl.body, 'right'));
const rows: string[] = [];
for (const y of [0.0, 0.08, 0.16, 0.24, 0.32])
  for (const x of [0.13, 0.2, 0.27, 0.34])
    for (const z of [0.12, 0.2, 0.28, 0.36])
      for (const [pn, pole] of [['backOut', v3(0.6 * sx, -0.5, -0.6)], ['back', v3(0.3 * sx, -0.3, -1)], ['out', v3(1 * sx, -0.3, -0.2)]] as const) {
        const palmL = proceduralLocal(pl.body, 'right', v3(x * sx, y, z));
        const r = twoBone(sh, toWorld(core, palmL), R.lengths.upperArm, R.lengths.forearm + R.lengths.palmExtension, qRot(core.q, pole));
        const wrist = { x: r.mid.x + (r.end.x - r.mid.x) * (R.lengths.forearm / (R.lengths.forearm + R.lengths.palmExtension)), y: r.mid.y + (r.end.y - r.mid.y) * (R.lengths.forearm / (R.lengths.forearm + R.lengths.palmExtension)), z: r.mid.z + (r.end.z - r.mid.z) * (R.lengths.forearm / (R.lengths.forearm + R.lengths.palmExtension)) };
        const shapes = armShapes(R, 'right', sh, r.mid, wrist, r.end);
        const self = C.self(shapes.slice(1));
        const selfUpper = C.self(shapes.slice(0, 1));
        rows.push(`${self.toFixed(3)} up ${selfUpper.toFixed(3)} palm(${x},${y},${z}) ${pn} reached ${r.reached}`);
      }
rows.sort();
console.log(rows.filter((r) => r.startsWith('0.000')).join('\n'));
