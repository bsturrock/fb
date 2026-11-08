// Plan 08 probe: free and carry arm in the body frame over a window, with the pose memory's chosen procedural variants.
// Usage: vite-node scripts/probe/p08-arms.ts <fixture id> <from> <to> [every]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { qConj, qRot, sub } from '../../src/sim/vec';

const [id, from, to, every] = process.argv.slice(2);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
let n = 0;
while (!sim.done) {
  sim.stepTick();
  const pl = sim.players[0];
  if (sim.t < Number(from) || sim.t > Number(to) || !pl.pose) continue;
  if (n++ % Number(every ?? 3)) continue;
  const b = pl.proxy.body; const o = b.translation(); const q = b.rotation(); const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
  const L = (k: string) => { const p = qRot(qi, sub(pl.pose!.jointLandmarksWorld[k], o)); return `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`; };
  const m = pl.poseMemory as unknown as Record<string, unknown>;
  const keys = Object.keys(m).filter((k) => /Arm/.test(k) && typeof m[k] === 'number');
  console.log(sim.t.toFixed(3), 'w', (pl.run?.w ?? 0).toFixed(2), 'bk', (pl.sus?.brakeB ?? 0).toFixed(2), 'L', L('leftElbow'), L('leftWrist'), 'R', L('rightElbow'), L('rightWrist'), keys.map((k) => `${k}=${m[k]}`).join(' '));
}
sim.dispose();
