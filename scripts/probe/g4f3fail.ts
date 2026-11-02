// Search a failed/partial F3 variant: same lineTackle code, different defender line speed / arms.
import { Simulation } from '../../src/sim/simulation';
import { lineTackle } from '../../src/sim/fixtures/gate4';
for (const vd of [2, 2.5, 3, 3.5, 4]) for (const plan of [{ left: 'wrap', right: 'wrap' }, { left: 'none', right: 'wrap' }] as const) {
  const def = lineTackle({ id: `fail-${vd}-${plan.left}`, title: '', plan: { ...plan }, vd, vr: 4 });
  const sim = await Simulation.create(def);
  sim.runToEnd();
  let last = ''; const ws: string[] = [];
  for (const r of sim.trace) { const w = String(r.players.D?.wrap); if (w !== last) { ws.push(`${r.t.toFixed(2)}:${w}`); last = w; } }
  const R = sim.players.find((p) => p.id === 'R')!;
  const c = sim.bulk(R);
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
  console.log(vd, plan.left, sim.result, sim.t.toFixed(2), 'R', c.com.x.toFixed(2), c.com.z.toFixed(2), 'v', c.v.x.toFixed(2), c.v.z.toFixed(2), R.controlMode, 'loss', loss.join(' '), '|', ws.slice(0, 8).join(' '));
  sim.dispose();
}
