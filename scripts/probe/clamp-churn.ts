// Clamp begin/end churn: model-geometry G2 wraps vs the same balanced Gate 4 variant on authored geometry.
import { Simulation } from '../../src/sim/simulation';
import { g2f2, g2f5, g2f11 } from '../../src/sim/fixtures/gate2';
import { balancedVariant } from '../../src/sim/fixtures/gate3';
import { asG4 } from '../../src/sim/fixtures/gate4';
import { asModel } from '../../src/sim/fixtures/model';
for (const mk of [g2f2, g2f5, g2f11]) {
  const authored = asG4(balancedVariant(mk(), 'G4-M'), { id: mk().id, milestone: 'G4-M', title: mk().title });
  for (const def of [authored, asModel(authored)]) {
    const sim = await Simulation.create(def);
    sim.runToEnd();
    const c = (t: string) => sim.events.filter((e) => e.type === t).length;
    const rel = sim.events.filter((e) => e.type === 'gripRelease').map((e) => `${e.t}:${(e.data as any).reason}`);
    const ends = sim.events.filter((e) => e.type === 'clampEnd');
    const firstEnd = ends[0]?.t;
    console.log(def.id.padEnd(12), 'clampBegin', c('clampBegin'), 'clampEnd', c('clampEnd'), 'firstEnd', firstEnd, 'gripRelease', rel.join(' '), 'wrap', sim.events.filter((e) => e.type === 'wrapStatus').map((e) => `${e.t}:${(e.data as any).status}`).join(' '));
    sim.dispose();
  }
}
