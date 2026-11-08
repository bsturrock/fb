// Largest envelope slack per fixture and joint, right after each conversion.
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
for (const def of fallFixtures()) {
  const s = await Simulation.create(def, { trace: false });
  const best = new Map<string, [number, number, number]>();
  while (!s.done) {
    s.stepTick();
    for (const p of s.players)
      for (const e of p.rag?.envelope ?? []) {
        const k = `${p.id}:${e.jointId}`;
        const b = best.get(k) ?? [0, 0, 0];
        best.set(k, [Math.max(b[0], e.swingSlack), Math.max(b[1], e.twistSlackLo), Math.max(b[2], e.twistSlackHi)]);
      }
  }
  const rows = [...best].filter(([, v]) => Math.max(...v) > 0.02).map(([k, v]) => `${k} swing ${v[0].toFixed(3)} lo ${v[1].toFixed(3)} hi ${v[2].toFixed(3)}`);
  if (rows.length) console.log(def.id, rows.join(' | '));
  s.dispose();
}
