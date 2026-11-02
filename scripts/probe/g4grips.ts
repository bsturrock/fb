// F4/F10 per-arm evidence: grip/clamp events from the conversion on (remap, passive link, release reason), first
// releases only, and the per-grip max anchor error while a passive or remapped grip lives.
import { Simulation } from '../../src/sim/simulation';
import { gate4Fixtures } from '../../src/sim/fixtures/gate4';
for (const def of gate4Fixtures().filter((f) => /^G4-F(4|10)-/.test(f.id))) {
  const sim = await Simulation.create(def);
  while (!sim.done) sim.stepTick();
  const conv = sim.events.find((e) => e.type === 'representation');
  const t0 = conv ? conv.t : 0;
  const lines = sim.events.filter((e) => e.t >= t0 - 1e-9 && e.t <= t0 + 1.2 && /grip|Grip|clampRemap|clampEnd|passive|palm|representation|handoffRejected/.test(e.type))
    .filter((e, i, a) => !(e.type === 'clampEnd' && a.findIndex((x) => x.type === 'clampEnd' && x.data?.arm === e.data?.arm) !== i))
    .map((e) => `   ${e.t.toFixed(4)} ${e.type} ${e.playerId ?? ''} ${JSON.stringify(e.data).replace(/"point":\[[^\]]*\],?/g, '').slice(0, 170)}`);
  console.log(`== ${def.id}  result ${sim.result}  grips at end ${sim.arms?.grips.size}`);
  console.log(lines.slice(0, 12).join('\n'));
  sim.dispose();
}
