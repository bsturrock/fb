// G4-B probe: G3-F3-side-loss geometry with the defender's controller swapped for wrapAttempt variants.
import { Simulation } from '../../src/sim/simulation';
import * as G3 from '../../src/sim/fixtures/gate3';
import { armsSetup } from '../../src/sim/fixtures/gate2';
import { RAGDOLL_G4, SOLVER_G4 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { v3 } from '../../src/sim/vec';
const variants: [string, any, any][] = [
  ['script', null, null],
  ['wrapNone', { plan: { left: 'none', right: 'none' } }, null],
  ['wrapBoth', { plan: { left: 'wrap', right: 'wrap' } }, armsSetup('forearmClamp', 'forearmClamp', { acquisition: false })],
  ['wrapBothFin7', { plan: { left: 'wrap', right: 'wrap' }, finish: { dirWorld: v3(0, 0, 1), speedMps: 7, leanDeg: 12, repositionMps: 0 } }, armsSetup('forearmClamp', 'forearmClamp', { acquisition: false })],
  ['wrapRightFin7', { plan: { left: 'none', right: 'wrap' }, finish: { dirWorld: v3(0, 0, 1), speedMps: 7, leanDeg: 12, repositionMps: 0 } }, armsSetup(null, 'forearmClamp', { acquisition: false })],
  ['lineBoth', { plan: { left: 'wrap', right: 'wrap' }, approachVelocityWorld: v3(0, 0, 7), finish: { dirWorld: v3(0, 0, 1), speedMps: 7, leanDeg: 12, repositionMps: 0, minProgressMps: -100 } }, armsSetup('forearmClamp', 'forearmClamp', { acquisition: false })],
  ['lineRight', { plan: { left: 'none', right: 'wrap' }, approachVelocityWorld: v3(0, 0, 7), finish: { dirWorld: v3(0, 0, 1), speedMps: 7, leanDeg: 12, repositionMps: 0, minProgressMps: -100 } }, armsSetup(null, 'forearmClamp', { acquisition: false })],
  ['lineLeft', { plan: { left: 'wrap', right: 'none' }, approachVelocityWorld: v3(0, 0, 7), finish: { dirWorld: v3(0, 0, 1), speedMps: 7, leanDeg: 12, repositionMps: 0, minProgressMps: -100 } }, armsSetup('forearmClamp', null, { acquisition: false })],
  ['lineBothNoFin', { plan: { left: 'wrap', right: 'wrap' }, approachVelocityWorld: v3(0, 0, 7) }, armsSetup('forearmClamp', 'forearmClamp', { acquisition: false })],
  ['wrapBothLow', { plan: { left: 'wrap', right: 'wrap' }, bandYLocal: -0.05, finish: { dirWorld: v3(0, 0, 1), speedMps: 7, leanDeg: 12, repositionMps: 0 } }, armsSetup('forearmClamp', 'forearmClamp', { acquisition: false })],
];
for (const vr of [4, 3]) for (const [tag, wrap, arms] of variants) {
  const def: FixtureDef = { ...G3.g3f3Side(vr, 'loss'), gate: 4, solver: SOLVER_G4, ragdoll: RAGDOLL_G4, id: `S-${tag}-r${vr}` };
  const D = def.players.find((p) => p.id === 'D')!;
  if (wrap) {
    D.controller = { kind: 'wrapAttempt', approachSpeedMps: 7, closingGainPerS: 1000, matchRunnerVelocity: false, interceptLead: true, driveInMps: Number(process.argv[2] ?? 7), approachLeanDeg: 12, ...wrap } as any;
    if (arms) D.arms = arms;
  }
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
  const wrapAtLoss: string[] = [];
  for (const e of sim.events.filter((e) => e.type === 'lossOfSupport' && e.playerId === 'R')) wrapAtLoss.push(String(sim.trace.find((r) => r.t >= e.t - 1e-9)?.players.D?.wrap));
  const ws = [...new Set(sim.trace.map((r) => r.players.D?.wrap).filter(Boolean))];
  const peak = Math.max(...sim.trace.filter((r) => r.players.R.mode === 'supported').map((r) => r.players.R.lean?.deg ?? 0));
  const firstC = sim.events.find((e) => e.type === 'contactBegin');
  const dv = firstC ? sim.trace.find((r) => r.t >= firstC.t - 1e-9)?.players.D.v : null;
  console.log(def.id.padEnd(20), sim.result.padEnd(19), 'loss', loss.join(',').padEnd(14), 'peakLeanR', peak.toFixed(1).padStart(5), 'wrapAtLoss', wrapAtLoss.join(',').padEnd(11), 'wraps', ws.join(','), 'Dv@contact', dv?.map((x) => x.toFixed(1)).join(','), firstC?.t.toFixed(2));
  if (process.argv[3] === 'ev' && /line/.test(def.id)) {
    for (const e of sim.events.filter((e) => ['lossOfSupport', 'representation', 'handoffRejected', 'handoffAuditFailure', 'gripRemap', 'gripPassive', 'gripRelease', 'clampRemap', 'numericalFailure', 'practiceOutOfBounds'].includes(e.type) || (e.type === 'clampEnd' && e.data!.reason !== 'contactLost')))
      console.log('     ', e.t.toFixed(3), e.type, e.playerId, JSON.stringify(e.data ?? {}).slice(0, e.type === "handoffRejected" ? 600 : 220));
    console.log('      reps', sim.players.map((p) => `${p.id}:${p.representation}`).join(' '), 'counts', JSON.stringify(sim.counts()), sim.players.map((p) => p.ragStats ? `${p.id} sep ${(p.ragStats.maxAnchorErrM * 1000).toFixed(1)} pen ${(p.ragStats.maxFloorPenM * 1000).toFixed(1)} over ${p.ragStats.maxHingeOverDeg.toFixed(1)} rev ${p.ragStats.maxHingeReverseDeg.toFixed(1)}` : '').join(' '));
  }
  if (process.argv[3] && def.id === process.argv[3])
    for (const r of sim.trace.filter((x, i) => i % 2 === 0 && x.t > 0.44 && x.t < 1.0)) {
      const d = r.players.D, Rr = r.players.R;
      console.log('   ', r.t.toFixed(3), 'D p', d.p.map((x) => x.toFixed(2)).join(','), 'v', d.v.map((x) => x.toFixed(1)).join(','), 'R v', Rr.v.map((x) => x.toFixed(1)).join(','), 'Rlean', Rr.lean?.deg.toFixed(1), 'tau', Rr.lean?.tauB.toFixed(0), 'Dlean', d.lean?.deg.toFixed(1), d.ph ?? '');
    }
  sim.dispose();
}
// (trace mode) argv[3] = variant tag to trace
