// Plan 08 review probe: spans with no foot planted or near the ground while moving, and how close together consecutive landings of different
// feet are. A skipped stance is a long span; two legs reaching out together are two landings almost at once.
// Usage: vite-node scripts/probe/p08-gaps.ts [id regex] [min span s] [min speed m/s]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2] ?? '^L3-');
const minS = Number(process.argv[3] ?? 0.2);
const minV = Number(process.argv[4] ?? 3);
let n = 0;
let hit = 0;
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  n++;
  const sim = await Simulation.create(def);
  const open: Record<string, { t0: number; t1: number; sp: number; contact: boolean } | null> = {};
  const found: string[] = [];
  const close = (id: string): void => {
    const c = open[id];
    if (c && c.t1 - c.t0 >= minS && c.sp >= minV) found.push(`${id} ${c.t0.toFixed(2)}+${(c.t1 - c.t0).toFixed(2)}s ${c.sp.toFixed(1)}m/s${c.contact ? ' contact' : ''}`);
    open[id] = null;
  };
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) {
      if (pl.rag || !pl.feet) { close(pl.id); continue; }
      const j = pl.pose?.jointLandmarksWorld;
      const low = !j || Math.min(j.leftAnkle.y, j.rightAnkle.y) < 0.2; // a foot in the clip's stance on the ground counts: the eye sees no gap
      if (low || pl.feet.feet.left.mode === 'planted' || pl.feet.feet.right.mode === 'planted') { close(pl.id); continue; }
      const v = pl.proxy.body.linvel();
      const s = Math.hypot(v.x, v.z);
      const c = (open[pl.id] ??= { t0: sim.t, t1: sim.t, sp: s, contact: false });
      c.t1 = sim.t;
      c.sp = Math.max(c.sp, s);
      if (pl.loco?.mode === 'contact') c.contact = true;
    }
  }
  for (const id of Object.keys(open)) close(id);
  // landings of different feet closer than this are one landing as far as the eye can tell
  const plants = sim.events.filter((e) => e.type === 'footPlant');
  const close2: string[] = [];
  for (const pid of new Set(plants.map((e) => e.playerId))) {
    const ps = plants.filter((e) => e.playerId === pid);
    for (let i = 1; i < ps.length; i++) {
      const a = ps[i - 1]!;
      const b = ps[i]!;
      if (b.t > 0.2 && b.data?.side !== a.data?.side && b.t - a.t < 0.1) close2.push(`${pid} ${a.t.toFixed(2)}+${(b.t - a.t).toFixed(3)}`);
    }
  }
  if (found.length || close2.length) {
    hit++;
    console.log(`${def.id}: ${found.join(' | ')}${close2.length ? `  TOGETHER ${close2.join(' , ')}` : ''}`);
  }
  sim.dispose();
}
console.log(`scanned ${n}, with hits ${hit}`);
