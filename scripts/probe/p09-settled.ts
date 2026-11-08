// L4-F1: largest excursion past each limit over the last 0.4 s of the stated load, and the peak of the whole run.
import { Simulation } from '../../src/sim/simulation';
import { LIMIT_TIMES, fallFixtures } from '../../src/sim/fixtures/falls';
for (const def of fallFixtures()) {
  if (!def.id.startsWith('L4-F1-')) continue;
  const s = await Simulation.create(def, { trace: false });
  const settled: Record<string, number> = {};
  while (!s.done && s.t < LIMIT_TIMES.loadS[1] - 1e-9) {
    s.stepTick();
    if (s.t < LIMIT_TIMES.loadS[1] - 0.4) continue;
    for (const e of s.players[0].rag?.envelope ?? []) settled[e.jointId] = Math.max(settled[e.jointId] ?? 0, e.overDeg);
  }
  const peak = Object.fromEntries((s.players[0].rag?.envelope ?? []).map((e) => [e.jointId, e.maxOverDeg.toFixed(2)]));
  console.log(def.id, Object.entries(settled).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' '), '| peak', JSON.stringify(peak), '| hinge', JSON.stringify(s.players[0].ragStats));
  s.dispose();
}
