// Probe: run fixtures matching a pattern (default the G4-M model set) and print result, handoffs, grips and ending.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
const re = new RegExp(process.argv[2] ?? '-M$');
for (const def of allFixtures()) {
  if (!re.test(def.id)) continue;
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const s: any = sim.summary();
  const hs = sim.players.filter((p: any) => p.handoff).map((p: any) => [p.id, p.handoff]).map(([id, h]: any) =>
    `${id}:${h.outcome}@${h.t.toFixed(3)}${h.report.ok ? '' : `[${h.report.reasons.join(',')} pen ${h.report.maxNewExternalPenetrationM.toFixed(3)} ${JSON.stringify(h.report.worstExternal)}]`}${h.audit ? ` dE ${h.audit.energyDeltaJ.toFixed(2)}/${h.audit.energyGainLimitJ.toFixed(1)} P ${h.audit.linearRelErr.toExponential(1)} L ${h.audit.angularRelErr.toExponential(1)}` : ''}`);
  const ev = (t: string) => sim.events.filter((e) => e.type === t);
  const grips = ev('gripBegin').length + ev('gripAcquired').length, rel = [...ev('gripEnd'), ...ev('gripReleased')].map((e: any) => `${e.t.toFixed(2)}:${e.data?.reason}`);
  const clamps = ev('clampBegin').length;
  const ending = ev('ruleEnding')[0] ?? ev('ending')[0];
  console.log(def.id.padEnd(30), String(s.result).padEnd(18), hs.join(' | ') || '-', `grips ${grips} rel [${rel.join(' ')}] clamps ${clamps}`, ending ? `ending ${(ending as any).t.toFixed(2)} ${JSON.stringify((ending as any).data).slice(0, 120)}` : '');
  sim.dispose();
}
