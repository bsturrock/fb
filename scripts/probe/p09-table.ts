import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
const pat = process.argv[2] ? new RegExp(process.argv[2]) : /./;
for (const def of fallFixtures()) {
  if (!pat.test(def.id)) continue;
  const sim = await Simulation.create(def, { trace: false });
  sim.runToEnd();
  const ex = sim.exportFixture() as any;
  const ev = (t: string) => sim.events.filter((e) => e.type === t);
  const lim = ex.jointLimits ?? {};
  const rows = Object.entries(lim).map(([id, l]: any) => {
    const env = l.envelope.joints;
    const worst = env.reduce((a: any, b: any) => (b.maxOverRunS > a.maxOverRunS ? b : a));
    return `${id}: over ${Math.max(0, ...env.map((j: any) => j.maxOverDeg)).toFixed(1)} run ${worst.maxOverRunS.toFixed(2)}@${worst.joint} start ${Math.max(0, ...env.map((j: any) => j.startOutsideDeg)).toFixed(0)} p+ ${env.reduce((s: number, j: any) => s + j.passivePositiveJ, 0).toFixed(1)} p- ${env.reduce((s: number, j: any) => s + j.passiveNegativeJ, 0).toFixed(1)} hinge ${l.hinges.maxOverDeg}/${l.hinges.maxReverseDeg}`;
  });
  const fall = Object.entries(ex.fallEffort ?? {}).map(([id, f]: any) => `${id}: tasks ${f.tasks.left}/${f.tasks.right} brace ${f.brace.left}/${f.brace.right} W ${f.positiveWorkJ.toFixed(1)} Wn ${f.negativeWorkJ.toFixed(1)} P ${f.peakPositiveW.toFixed(0)} over ${f.overPowerSubsteps} imp ${f.impactPowerSubsteps}@${f.peakImpactW.toFixed(0)} chg ${f.taskChanges} exh ${f.exhausted} last ${f.lastEffortS.toFixed(2)}`);
  const seq = sim.events.filter((e) => ['fallResponse', 'fallTask', 'braceContact', 'braceMiss', 'fallExhausted', 'fallEffortOver'].includes(e.type)).map((e: any) => (e.type === 'fallTask' ? `${e.data.arm}:${e.data.from}>${e.data.to}(${e.data.reason})` : e.type === 'braceMiss' ? `miss:${e.data.arm}:${e.data.reason}` : e.type === 'braceContact' ? `brace:${e.data.arm}:${e.data.part}@${e.data.tS}` : e.type === 'fallResponse' ? `begin:${e.playerId}:${e.data.tasks.left}/${e.data.tasks.right}` : e.type));
  console.log(`${def.id} result ${sim.result} end ${ex.ruleEnding ? `${ex.ruleEnding.kind}@${ex.ruleEnding.t.toFixed(2)} ${JSON.stringify(ex.ruleEnding.evidence).slice(0, 180)}` : '-'} rej ${ev('conversionRejected').length + ev('handoffRejected').length}\n   ${rows.join(' | ')}\n   ${fall.join(' | ')}\n   ${seq.join(' ')}`);
  sim.dispose();
}
