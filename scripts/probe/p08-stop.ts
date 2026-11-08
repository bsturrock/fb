// Plan 08 probe (pass 1): stop timeline and limb motion. For a fixture: foot events, largest one-tick second differences of
// knee/ankle/elbow/wrist in the body frame with their first displacement, and a compact tick table in a window.
// Usage: vite-node scripts/probe/p08-stop.ts <fixture id regex> [--table from to] [--runstop brakeS]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { runStop } from '../../src/sim/fixtures/footwork';
import { add, len, qConj, qRot, scale, sub, type Vec3 } from '../../src/sim/vec';
import type { FixtureDef } from '../../src/sim/fixture';

const args = process.argv.slice(2);
const opt = (k: string): string | null => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const table = args.includes('--table') ? [Number(args[args.indexOf('--table') + 1]), Number(args[args.indexOf('--table') + 2])] : null;
const brake = opt('--runstop');
const re = new RegExp(args[0]);
const defs: FixtureDef[] = brake ? [runStop(`stop${brake}`, Number(brake), true)] : allFixtures().filter((d) => re.test(d.id));
const names = ['leftAnkle', 'rightAnkle', 'leftKnee', 'rightKnee', 'leftWrist', 'rightWrist', 'leftElbow', 'rightElbow'];
for (const def of defs) {
  const sim = await Simulation.create(def);
  const hist: Record<string, Vec3[]> = {};
  const peaks: { d: number; first: number; t: number; k: string }[] = [];
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) {
      if (pl.rag || !pl.pose) continue;
      const b = pl.proxy.body; const o = b.translation(); const q = b.rotation(); const qi = qConj({ x: q.x, y: q.y, z: q.z, w: q.w });
      for (const n of names) {
        const k = `${pl.id}:${n}`; const p = qRot(qi, sub(pl.pose.jointLandmarksWorld[n], o));
        const h = (hist[k] ??= []); h.push(p); if (h.length > 3) h.shift();
        if (h.length === 3) peaks.push({ d: len(add(sub(h[2], scale(h[1], 2)), h[0])), first: Math.max(len(sub(h[2], h[1])), len(sub(h[1], h[0]))), t: sim.t, k });
      }
      if (table && sim.t >= table[0] && sim.t <= table[1]) {
        const v = b.linvel(); const f = pl.feet!;
        const one = (s: 'left' | 'right'): string => { const x = f.feet[s]; const l = pl.pose!.jointLandmarksWorld[`${s}Ankle`]; return `${x.mode === 'planted' ? (x.tentative ? 'p' : 'P') : x.source === 'step' ? `S${(x.elapsedS / x.durS).toFixed(2)}` : x.wait ? 'W' : 'F'} ${(l.x - o.x).toFixed(2)},${l.y.toFixed(2)}`; };
        console.log(sim.t.toFixed(3), 'v', Math.hypot(v.x, v.z).toFixed(2), 'h', o.y.toFixed(3), 'w', (pl.run?.w ?? 0).toFixed(2), 'u', (pl.run?.u ?? 0).toFixed(3), 'rate', (pl.run?.rate ?? 0).toFixed(2), 'bk', (pl.sus?.brakeB ?? 0).toFixed(2), '|', one('left'), '|', one('right'));
      }
    }
  }
  console.log(`== ${def.id} ${sim.result} t ${sim.t.toFixed(2)}`);
  peaks.sort((a, b) => b.d - a.d);
  const seen: number[] = [];
  for (const p of peaks) {
    if (seen.length >= 10) break;
    if (seen.some((t) => Math.abs(t - p.t) < 0.03)) continue;
    seen.push(p.t);
    console.log(`  ${p.t.toFixed(3)} ${p.k} 2nd ${(p.d * 100).toFixed(1)} cm first ${(p.first * 100).toFixed(1)} cm`);
  }
  for (const e of sim.events.filter((x) => x.type.startsWith('foot'))) console.log('  ', e.t.toFixed(4), e.playerId, e.type, JSON.stringify(e.data).slice(0, 130));
  sim.dispose();
}
