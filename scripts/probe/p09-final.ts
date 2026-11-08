// Headline numbers for the plan 09 handoff: limits, work, power and decisions over every L4 fixture.
import { Simulation } from '../../src/sim/simulation';
import { fallFixtures } from '../../src/sim/fixtures/falls';
let maxOver = [0, ''] as [number, string];
let maxRun = [0, ''] as [number, string];
let maxOff = [0, ''] as [number, string];
let peakP = [0, ''] as [number, string];
let peakW = [0, ''] as [number, string];
let peakImp = [0, ''] as [number, string];
let overPower = 0;
let overWork = 0;
let impactMax = [0, ''] as [number, string];
let hinge = [0, ''] as [number, string];
let reverse = [0, ''] as [number, string];
let responses = 0;
let held = 0;
let heldBody = 0;
let active = 0;
const counts: Record<string, number> = {};
const bump = (a: [number, string], v: number, id: string): void => {
  if (v > a[0]) { a[0] = v; a[1] = id; }
};
for (const def of fallFixtures()) {
  if (def.id.startsWith('L4-F1-') || def.id === process.argv[2]) continue;
  const s = await Simulation.create(def, { trace: false });
  s.runToEnd();
  const ex = s.exportFixture() as any;
  for (const [pid, l] of Object.entries(ex.jointLimits ?? {}) as [string, any][]) {
    for (const j of l.envelope.joints) {
      bump(maxOver, j.maxOverDeg, `${def.id} ${pid} ${j.joint}`);
      bump(maxRun, j.maxOverRunS, `${def.id} ${pid} ${j.joint}`);
    }
    bump(hinge, l.hinges.maxOverDeg, `${def.id} ${pid}`);
    bump(reverse, l.hinges.maxReverseDeg, `${def.id} ${pid}`);
  }
  for (const p of s.players) if (p.rag) bump(maxOff, p.ragStats?.maxSpeed ?? 0, `${def.id} ${p.id}`);
  for (const [pid, f] of Object.entries(ex.fallEffort ?? {}) as [string, any][]) {
    responses++;
    bump(peakP, f.peakPositiveW, `${def.id} ${pid}`);
    bump(peakW, f.positiveWorkJ, `${def.id} ${pid}`);
    bump(peakImp, f.peakImpactW, `${def.id} ${pid}`);
    bump(impactMax, f.impactPowerSubsteps, `${def.id} ${pid}`);
    overPower += f.overPowerSubsteps;
    held += f.heldSubsteps;
    heldBody += f.heldBodySubsteps;
    active += f.activeSubsteps;
    overWork += f.overWork ? 1 : 0;
  }
  for (const e of s.events) {
    if (e.type === 'braceContact') counts[`contact ${(e.data as any).part}`] = (counts[`contact ${(e.data as any).part}`] ?? 0) + 1;
    if (e.type === 'braceMiss') counts[`miss ${(e.data as any).reason}`] = (counts[`miss ${(e.data as any).reason}`] ?? 0) + 1;
  }
  s.dispose();
}
console.log({ responses, held, heldBody, active, maxOver, maxRun, hinge, reverse, peakP, peakW, peakImp, impactMax, overPower, overWork, counts });
