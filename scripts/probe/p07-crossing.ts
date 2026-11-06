// Plan 07 closeout item 3 probe: foot states around the clip-to-procedural crossing of a run stop. Per tick (or substep
// with --sub): clip weight, speed, per foot mode/source/drag, step progress, shoe gap, ankle height, target height,
// stance flag; and the foot events in the window. Usage: vite-node scripts/probe/p07-crossing.ts [id] [from] [to] [--sub]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { playbackStance } from '../../src/sim/run-clip';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const id = pos[0] ?? 'L2-F3-runStop';
const from = Number(pos[1] ?? 2.9);
const to = Number(pos[2] ?? 3.6);
const def = allFixtures().find((d) => d.id === id)!;
const sim = await Simulation.create(def);
const f3 = (x: number): string => x.toFixed(3);
while (!sim.done && sim.t < to) {
  sim.stepTick();
  if (sim.t < from) continue;
  const p = sim.players[0];
  if (!p.feet || p.rag) continue;
  const v = p.proxy.body.linvel();
  const st = p.run && def.runClips ? playbackStance(p.run, def.runClips) : null;
  const one = (s: 'left' | 'right'): string => {
    const f = p.feet!.feet[s];
    const m = f.mode === 'planted' ? 'P' : f.mode === 'airborne' ? 'A' : f.source === 'step' ? `S${f.drag ? 'd' : ''}${(f.durS > 0 ? Math.min(1, f.elapsedS / f.durS) : 0).toFixed(2)}` : 'F';
    return `${s[0]} ${m.padEnd(6)} gap ${f3(f.gapM)} ank ${f3(f.ankleW.y)} tg ${f3(f.target.y)} st ${st ? (st[s] ? 1 : 0) : '-'}`;
  };
  console.log(`${f3(sim.t)} w ${f3(p.run?.w ?? 0)} v ${f3(Math.hypot(v.x, v.z))} | ${one('left')} | ${one('right')}`);
}
for (const e of sim.events.filter((x) => x.type.startsWith('foot') && x.t >= from && x.t <= to)) console.log(`  ${e.t.toFixed(5)} ${e.type} ${JSON.stringify(e.data)}`);
sim.dispose();
