import { allFixtures } from '../../src/sim/fixtures/index';
import { Simulation } from '../../src/sim/simulation';
for (const id of process.argv.slice(2)) {
  const sim = await Simulation.create(allFixtures().find((f) => f.id === id)!);
  sim.runToEnd();
  const L = sim.arms!.ledger;
  const bySteps = new Map<number, number>();
  for (const e of L) bySteps.set(e.step, (bySteps.get(e.step) ?? 0) + e.actual);
  let minScale = 1, maxSum = 0, maxPair = 0, maxConeExcess = -Infinity, maxXT = 0, maxOver = -Infinity, frictionNoN = 0;
  for (const e of L) {
    minScale = Math.min(minScale, e.sharedScale);
    maxPair = Math.max(maxPair, e.pairSum);
    if (e.kind === 'clamp') { maxConeExcess = Math.max(maxConeExcess, e.tangentActual - e.frictionCap); maxXT = Math.max(maxXT, e.xT); if (e.normalActual === 0 && e.tangentActual > 0) frictionNoN++; }
    if (e.kind === 'hold') maxOver = Math.max(maxOver, e.actual - e.allocated);
  }
  for (const v of bySteps.values()) maxSum = Math.max(maxSum, v);
  const rel = sim.events.filter((e) => /gripRelease|clampEnd/.test(e.type)).map((e) => `${e.t.toFixed(3)}:${e.data!.arm}:${e.data!.reason}`).join(' ');
  const wr = [...new Set(sim.trace.map((r) => r.players.D.wrap))].join(',');
  console.log(id, `entries ${L.length} minShared ${minScale.toFixed(3)} maxSum ${maxSum.toFixed(2)} maxPair ${maxPair.toExponential(1)} coneExcess ${maxConeExcess.toFixed(4)} maxXT ${maxXT.toFixed(4)} holdOverAlloc ${maxOver.toFixed(4)} frictionNoN ${frictionNoN}`);
  console.log('   wrap', wr, '| releases', rel.slice(0, 400));
}
