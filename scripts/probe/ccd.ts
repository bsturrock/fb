import { Simulation } from '../../src/sim/simulation';
import { g1f6Impact, g1f2, g1f4 } from '../../src/sim/fixtures/gate1';
for (const soft of [0, 0.3, 0.6]) for (const pred of [0.002, 0.05]) {
  const res: string[] = [];
  for (const mk of [() => g1f6Impact('legacy', 8), () => g1f6Impact('compound', 8), () => g1f2('compound'), () => g1f4({ kind: 'compound' })]) {
    const sim = await Simulation.create(mk());
    sim.physics.world.integrationParameters.normalizedPredictionDistance = pred;
    for (const p of sim.players) p.proxy.body.setSoftCcdPrediction(soft);
    sim.runToEnd();
    const last = sim.trace.at(-1)!.players;
    res.push(`${sim.def.id}: minGap ${sim.minPairGap.toFixed(3)} vD ${last.D.v[0].toFixed(2)} vR ${last.R.v[0].toFixed(2)}`);
  }
  console.log('soft', soft, 'pred', pred, '|', res.join(' | '));
}
