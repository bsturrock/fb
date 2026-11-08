// Plan 08 walk probe: one line per sample of a walking fixture: speed, clip weight and blend, height, feet; then plants.
// Usage: vite-node scripts/probe/p08-walk.ts <fixture id> [from] [to] [every n ticks]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const [id, from, to, every] = process.argv.slice(2);
const def = allFixtures().find((d) => d.id === id)!;
const a = Number(from ?? 0);
const b = Number(to ?? 99);
const N = Number(every ?? 6);
const sim = await Simulation.create(def);
const R = sim.players[0];
const name = (f: { mode: string; source?: string; wait?: boolean }): string => (f.mode === 'planted' ? 'P' : f.mode === 'swing' ? (f.source === 'step' ? 'S' : f.wait ? 'W' : 'F') : 'A');
let n = 0;
while (!sim.done) {
  sim.stepTick();
  if (R.rag || !R.pose || sim.t < a || sim.t > b || n++ % N) continue;
  const j = R.pose.jointLandmarksWorld;
  const v = R.proxy.body.linvel();
  const s = Math.hypot(v.x, v.z);
  const fx = v.x / (s || 1);
  const fz = v.z / (s || 1);
  const hipX = (j.leftHip.x + j.rightHip.x) / 2;
  const hipZ = (j.leftHip.z + j.rightHip.z) / 2;
  const fore = (p: { x: number; z: number }): string => ((p.x - hipX) * fx + (p.z - hipZ) * fz).toFixed(2).padStart(5);
  const L = R.feet!.feet.left;
  const Rt = R.feet!.feet.right;
  const run = R.run as unknown as { w: number; pos: number; u: number; rate: number };
  console.log(`${sim.t.toFixed(3)} v ${s.toFixed(2)} y ${R.proxy.body.translation().y.toFixed(3)} w ${run?.w.toFixed(2)} pos ${run?.pos.toFixed(2)} u ${run?.u.toFixed(2)} rate ${run?.rate.toFixed(2)} | L ${name(L)} ${fore(j.leftAnkle)} ${j.leftAnkle.y.toFixed(2)} off ${Math.hypot(L.offset.x, L.offset.y, L.offset.z).toFixed(2)} | R ${name(Rt)} ${fore(j.rightAnkle)} ${j.rightAnkle.y.toFixed(2)} off ${Math.hypot(Rt.offset.x, Rt.offset.y, Rt.offset.z).toFixed(2)}`);
}
const st = R.feet!.stats;
const c = st.cover;
const el = c.left.eligibleS + c.right.eligibleS;
console.log(`plants tried ${st.attempts} failed ${st.failed}, coverage ${(100 * (c.left.plantedS + c.right.plantedS) / (el || 1)).toFixed(1)}%, result ${sim.result} ${sim.t.toFixed(2)}`);
for (const e of sim.events.filter((x) => (x.type === 'footPlant' || x.type === 'footPlantFailed' || x.type === 'footRelease') && x.playerId === R.id && x.t >= a && x.t <= b)) console.log(e.t.toFixed(3), e.type, JSON.stringify(e.data).slice(0, 90));
sim.dispose();
