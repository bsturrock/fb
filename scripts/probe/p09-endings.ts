import { Simulation } from '../../src/sim/simulation';
import { asL4, shoved } from '../../src/sim/fixtures/falls';
const out = new Map<string, string[]>();
for (const dir of ['side', 'sideLeft', 'obliqueLeft'] as const)
  for (const leanDeg of [15, 30, 50])
    for (const spinRad of [1.5, 4])
      for (const speedMps of [2, 4])
        for (const on of [true, false]) {
          const sim = await Simulation.create(asL4(shoved({ dir, leanDeg, spinRad, speedMps, atS: 0.15 }), 'x', 't', on ? undefined : null), { trace: false });
          sim.runToEnd();
          const r = (sim.exportFixture() as any).ruleEnding;
          const k = r ? `${r.kind}:${r.evidence.region}` : sim.result;
          out.set(k, [...(out.get(k) ?? []), `${dir}/${leanDeg}/${spinRad}/${speedMps}/${on ? 'on' : 'off'}@${r?.t.toFixed(2)}`]);
          sim.dispose();
        }
for (const [k, v] of out) console.log(k, v.length, v.filter((x) => k.endsWith('elbow') || k.endsWith('knee') || x.includes('on@')).slice(0, 12).join(' '));
