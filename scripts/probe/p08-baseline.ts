// Plan 08 probe: the model baseline's rejected handoffs and clamp churn (docs/handoff/gate4.md) against the RH copies and the
// L3 compositions of the same tackles. One line per fixture: result, end time, accepted/rejected handoffs, clamp begins/ends.
// Usage: vite-node scripts/probe/p08-baseline.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const groups: string[][] = [
  ['G4-F3-twoArm-M', 'RH-F6-twoArm', 'L3-F4-twoArm'],
  ['G4-F3-oneArm-M', 'RH-F6-oneArm', 'L3-F4-oneArm'],
  ['G4-F3-failed-M', 'RH-F6-failed', 'L3-F5-drag'],
  ['G4-F10-simultaneous-M', 'RH-F6-simultaneous', 'L3-F10-both'],
  ['RH-F6-sideLoss', 'L3-F3-side'],
  ['RH-F6-sideRecover', 'L3-F3-recover'],
  ['L2-F14-oneArmFeet', 'L3-F1-phase0'],
  ['G2-F5-M'],
];
const n = (s: Simulation, t: string, id?: string): number => s.events.filter((e) => e.type === t && (!id || e.playerId === id)).length;
for (const g of groups) {
  for (const id of g) {
    const def = allFixtures().find((d) => d.id === id);
    if (!def) { console.log(id.padEnd(24), 'missing'); continue; }
    const sim = await Simulation.create(def);
    sim.runToEnd();
    const hand = sim.events.filter((e) => e.type === 'handoff' || e.type === 'handoffRejected').map((e) => `${e.type === 'handoff' ? 'ok' : 'REJ'}:${e.playerId}@${e.t.toFixed(2)}${e.type === 'handoffRejected' ? `(${(e.data as { reasons: string }).reasons} ${(((e.data as { maxNewExternalPenetrationM: number }).maxNewExternalPenetrationM) * 1000).toFixed(0)}mm)` : ''}`);
    const ty = [...new Set(sim.events.map((e) => e.type))].filter((t) => /clamp/i.test(t));
    console.log(id.padEnd(24), String(sim.result).padEnd(20), sim.t.toFixed(2), 'clamp', ty.map((t) => `${t}:${n(sim, t)}`).join(' '), hand.join(' '));
    sim.dispose();
  }
  console.log('');
}
