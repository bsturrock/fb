// Plan 13a probe: wall time of every tick of the fixtures matching a regex (headless `stepTick`).
// Usage: vite-node scripts/probe/p13-ticktime.ts <id regex> [worst ticks to list, default 12] [quiet]
// quiet: one line per fixture (ticks, mean, p95, max, ticks over the 16.7 ms frame budget), slowest first.
import { performance } from 'node:perf_hooks';
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const re = new RegExp(process.argv[2] ?? 'L4-F10-wrap-on');
const top = Number(process.argv[3] ?? 12);
const quiet = process.argv[4] === 'quiet';
const BUDGET_MS = 1000 / 60;
const rows: { id: string; n: number; mean: number; p95: number; max: number; over: number }[] = [];
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const sim = await Simulation.create(def);
  const ticks: { t: number; ms: number; modes: string }[] = [];
  while (!sim.done) {
    const t0 = performance.now();
    sim.stepTick();
    ticks.push({ t: sim.t, ms: performance.now() - t0, modes: sim.players.map((p) => `${p.id}:${p.representation}/${p.controlMode}`).join(' ') });
  }
  const ms = ticks.map((r) => r.ms).sort((a, b) => a - b);
  const row = { id: def.id, n: ms.length, mean: ms.reduce((a, b) => a + b, 0) / ms.length, p95: ms[Math.floor(ms.length * 0.95)], max: ms[ms.length - 1], over: ms.filter((x) => x > BUDGET_MS).length };
  rows.push(row);
  if (!quiet) {
    console.log(`== ${def.id} ticks ${row.n} mean ${row.mean.toFixed(2)} p95 ${row.p95.toFixed(2)} max ${row.max.toFixed(2)} over ${BUDGET_MS.toFixed(1)} ms ${row.over}`);
    for (const r of [...ticks].sort((a, b) => b.ms - a.ms).slice(0, top)) console.log(`  t ${r.t.toFixed(3)} ${r.ms.toFixed(2)} ms  ${r.modes}`);
  }
  sim.dispose();
}
if (quiet) for (const r of rows.sort((x, y) => y.max - x.max)) console.log(`${r.id.padEnd(34)} n ${r.n} mean ${r.mean.toFixed(2)} p95 ${r.p95.toFixed(2)} max ${r.max.toFixed(2)} over ${r.over}`);
