// Probe (plan 06a RH-F6): attribute legacy-vs-suspension outcome deltas by suspension variants (same requests): bob,
// standing height, force application (pivot, excess load) and the superseded models.
// Usage: vite-node scripts/probe/rh-variant.ts <fixture-id>
import { Simulation } from '../../src/sim/simulation';
import { rideHeightFixtures } from '../../src/sim/fixtures/ride-height';
import { SUSPENSION_RH, type SuspensionSupport } from '../../src/sim/profiles';

const id = process.argv[2] ?? 'RH-F6-twoArm';
const base = rideHeightFixtures().find((d) => d.id === id)!;
const variants: [string, Partial<SuspensionSupport>][] = [
  ['frozen', {}],
  ['no bob (maxDownAccelG 0)', { run: { ...SUSPENSION_RH.run, maxDownAccelG: 0 } }],
  ['bob <= 0.5 g', { run: { ...SUSPENSION_RH.run, maxDownAccelG: 0.5 } }],
  ['standing 0.95 (legacy height)', { standingHeightM: 0.95 }],
  ['legacy pivot, all load at pivot', { application: { pivot: 'legacyHemisphere', excess: 'atPivot' } }],
  ['probe depth, excess through COM', { application: { pivot: 'probeDepth', excess: 'throughCom' } }],
  ['decision 1 alone (probe depth)', { application: { pivot: 'probeDepth', excess: 'atPivot' } }],
  ['first implementation', { application: { pivot: 'probeDepth', excess: 'atPivot' }, balanceCeiling: 'appliedLoad' }],
];
for (const [name, over] of variants) {
  const def = { ...base, support: { ...SUSPENSION_RH, ...over } };
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const ev = sim.events.filter((e) => ['lossOfSupport', 'handoffRejected', 'contactBegin'].includes(e.type)).slice(0, 5).map((e) => `${e.t.toFixed(3)}:${e.type}@${e.playerId}`);
  console.log(name.padEnd(32), String(sim.summary().result).padEnd(16), ev.join(' '));
  sim.dispose();
}
