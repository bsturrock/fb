// Plan 07 closeout item 4 probe: physical effect of the braking stance on every fixture that uses SUSPENSION_L2_BRAKE.
// Each runs with its support (braking stance) and with SUSPENSION_L2 swapped in (everything else identical). Per
// fixture and player: the first time the solved root differs (> 1e-9 m), the largest blend b, the lowest root height
// (probe) with and without, the largest root height and horizontal position differences, the end position difference,
// result and conversion times. Usage: vite-node scripts/probe/p07-brakedelta.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { SUSPENSION_L2, SUSPENSION_L2_BRAKE } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';

const re = new RegExp(process.argv[2] ?? '.');
type Row = { t: number; p: Record<string, { x: number; y: number; z: number; h: number; b: number; rag: boolean }> };
async function run(def: FixtureDef): Promise<{ rows: Row[]; result: string; conv: Record<string, number> }> {
  const sim = await Simulation.create(def);
  const rows: Row[] = [];
  while (!sim.done) {
    sim.stepTick();
    const r: Row = { t: sim.t, p: {} };
    for (const pl of sim.players) {
      const c = pl.rag ? pl.rag.bodies.core.translation() : pl.proxy.body.translation();
      r.p[pl.id] = { x: c.x, y: c.y, z: c.z, h: pl.sus && !pl.rag ? pl.sus.probe.heightM : NaN, b: pl.sus?.brakeB ?? 0, rag: !!pl.rag };
    }
    rows.push(r);
  }
  const conv: Record<string, number> = {};
  for (const e of sim.events) if (e.type === 'representation' && e.playerId && conv[e.playerId] === undefined) conv[e.playerId] = e.t;
  const result = String(sim.result);
  sim.dispose();
  return { rows, result, conv };
}
const f3 = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : '—');
console.log('| Fixture (player) | First difference s | Max b | Lowest h without / with (m) | Max height diff cm | Max horizontal diff cm | End diff cm | Result | Conversion s without / with |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const def of allFixtures()) {
  if (def.support !== SUSPENSION_L2_BRAKE || !re.test(def.id)) continue;
  const a = await run({ ...def, support: SUSPENSION_L2 });
  const b = await run(def);
  for (const id of Object.keys(b.rows[0].p)) {
    let first = -1;
    let maxB = 0;
    let lowA = Infinity;
    let lowB = Infinity;
    let dh = 0;
    let dx = 0;
    const n = Math.min(a.rows.length, b.rows.length);
    for (let i = 0; i < n; i++) {
      const pa = a.rows[i].p[id];
      const pb = b.rows[i].p[id];
      maxB = Math.max(maxB, pb.b);
      if (Number.isFinite(pa.h)) lowA = Math.min(lowA, pa.h);
      if (Number.isFinite(pb.h)) lowB = Math.min(lowB, pb.h);
      const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
      if (first < 0 && d > 1e-9) first = b.rows[i].t;
      if (!pa.rag && !pb.rag) {
        dh = Math.max(dh, Math.abs(pa.y - pb.y));
        dx = Math.max(dx, Math.hypot(pa.x - pb.x, pa.z - pb.z));
      }
    }
    const ea = a.rows[a.rows.length - 1].p[id];
    const eb = b.rows[b.rows.length - 1].p[id];
    const end = Math.hypot(ea.x - eb.x, ea.y - eb.y, ea.z - eb.z);
    console.log(
      `| ${def.id} (${id}) | ${first < 0 ? 'identical' : f3(first)} | ${f3(maxB, 3)} | ${f3(lowA)} / ${f3(lowB)} | ${f3(dh * 100, 2)} | ${f3(dx * 100, 2)} | ${f3(end * 100, 2)} | ${a.result}${a.result !== b.result ? ` → ${b.result}` : ''} | ${a.conv[id] !== undefined || b.conv[id] !== undefined ? `${f3(a.conv[id] ?? NaN)} / ${f3(b.conv[id] ?? NaN)}` : '—'} |`,
    );
  }
}
