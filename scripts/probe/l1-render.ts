// Probe (plan 06 pass 3): what the lab draws. (1) World-space core motion per tick (second difference of position,
// per-tick rotation change). (2) The lab frame loop emulated at a display rate: FixedStepDriver ticks, interpolated
// core (alpha) and the follow camera target (current-tick COM); the drawn core relative to the camera target, per frame.
// Usage: vite-node scripts/probe/l1-render.ts <id> [hz] [player]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { FixedStepDriver } from '../../src/sim/driver';
import { len, sub, qAngle, qConj, qMul, type Vec3 } from '../../src/sim/vec';
const id = process.argv[2] ?? 'L1-F1-fastRun';
const hz = Number(process.argv[3] ?? 120);
const who = process.argv[4] ?? 'R';
const def = allFixtures().find((d) => d.id === id)!;
const stat = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return `med ${s[s.length >> 1].toFixed(4)} p90 ${s[Math.floor(s.length * 0.9)].toFixed(4)} max ${s[s.length - 1].toFixed(4)}`; };
const dd = (a: Vec3, b: Vec3, c: Vec3) => len({ x: c.x - 2 * b.x + a.x, y: c.y - 2 * b.y + a.y, z: c.z - 2 * b.z + a.z });
{
  const sim = await Simulation.create(def);
  const P: Vec3[] = [];
  const rot: number[] = [];
  let pq = null as null | { x: number; y: number; z: number; w: number };
  while (!sim.done) {
    sim.stepTick();
    const pl = sim.players.find((p) => p.id === who)!;
    if (!pl.pose || pl.rag) break;
    const c = pl.pose.segments.core;
    P.push({ ...c.originWorld });
    if (pq) rot.push((qAngle(qMul(qConj(pq), c.rotationWorld)) * 180) / Math.PI);
    pq = { ...c.rotationWorld };
  }
  const acc: number[] = [];
  for (let i = 1; i < P.length - 1; i++) acc.push(dd(P[i - 1], P[i], P[i + 1]));
  console.log('core position second difference per tick (m):', stat(acc));
  console.log('core rotation change per tick (deg):', stat(rot));
  const yv: number[] = [];
  for (let i = 1; i < P.length; i++) yv.push(Math.abs(P[i].y - P[i - 1].y));
  console.log('core height change per tick (m):', stat(yv));
}
{
  const sim = await Simulation.create(def);
  const drv = new FixedStepDriver(def.solver.outerTickS, def.solver.maxTicksPerFrame);
  let prev = null as null | Vec3;
  const rel: Vec3[] = [];
  const drawn: Vec3[] = [];
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  while (!sim.done && sim.t < 2.5) {
    const wall = 1 / hz + (rnd() - 0.5) * 0.0004; // rAF timestamps jitter a little
    const n = drv.frame(wall);
    for (let i = 0; i < n && !sim.done; i++) {
      prev = { ...sim.players.find((p) => p.id === who)!.pose!.segments.core.originWorld };
      sim.stepTick();
    }
    const pl = sim.players.find((p) => p.id === who)!;
    if (!pl.pose || pl.rag || !prev) continue;
    const cur = pl.pose.segments.core.originWorld;
    const a = drv.alpha();
    const d = { x: prev.x + (cur.x - prev.x) * a, y: prev.y + (cur.y - prev.y) * a, z: prev.z + (cur.z - prev.z) * a };
    const cam = sim.bulk(pl).com;
    drawn.push(d);
    rel.push(sub(d, { x: cam.x, y: d.y, z: cam.z }));
  }
  const accR: number[] = [];
  const accD: number[] = [];
  for (let i = 1; i < rel.length - 1; i++) {
    accR.push(dd(rel[i - 1], rel[i], rel[i + 1]));
    accD.push(dd(drawn[i - 1], drawn[i], drawn[i + 1]));
  }
  const xs = rel.map((r) => r.x);
  console.log(`lab emulation at ${hz} Hz:`);
  console.log('  drawn core in the world, second difference per frame (m):', stat(accD));
  console.log('  drawn core relative to the follow camera, second difference per frame (m):', stat(accR));
  console.log('  drawn core relative to the camera, x range (m):', Math.min(...xs).toFixed(4), Math.max(...xs).toFixed(4));
}
