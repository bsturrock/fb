// F3/F7/F11 completion matrix: profile, result label, ending kind/time/region/source, influence, ball spot.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
for (const def of gate4Fixtures().filter((f) => /^G4-F(3|7|11)-/.test(f.id))) {
  const sim = await Simulation.create(def);
  while (!sim.done) sim.stepTick();
  const e: any = sim.ending;
  const g = sim.events.filter((x) => x.type === 'groundTouch').map((x) => `${x.data?.region}${x.data?.eligible ? '*' : ''}@${x.t.toFixed(2)}`).slice(0, 5).join(' ');
  const gw = sim.events.find((x) => x.type === 'groundWithoutInfluence');
  console.log(`${def.id.padEnd(26)} ${String(def.rules?.id ?? '-').replace('rules-g4-', '').padEnd(28)} ${String(sim.result).padEnd(20)} ${e ? `${e.kind} @${e.t.toFixed(3)} ${e.region ?? ''} ${e.source ?? ''} spot (${[e.ballSpot.x, e.ballSpot.y, e.ballSpot.z].map((v: number) => v.toFixed(2)).join(",")})` : '-'}  | touches ${g || '-'}${gw ? ` | groundWithoutInfluence@${gw.t.toFixed(2)}` : ''}`);
  sim.dispose();
}
