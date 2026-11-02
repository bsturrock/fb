// Run Gate 1/2 fixtures in the balanced profile and summarise lean / loss / wrap.
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { balancedVariant } from '../../src/sim/fixtures/gate3';
const ids = process.argv.slice(2);
for (const id of ids) {
  const base = allFixtures().find((f) => f.id === id)!;
  const sim = await Simulation.create(balancedVariant(base));
  const peak: Record<string, number> = {};
  const wraps = new Set<string>();
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) peak[pl.id] = Math.max(peak[pl.id] ?? 0, pl.balance.theta * 57.3);
    const w = sim.arms?.wrap.get('D');
    if (w) wraps.add(w.status);
  }
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}:${(e.data!.relevantContactAndGripIds as string[]).filter((x) => !x.startsWith('contact')).join('+')}`);
  const rel = sim.events.filter((e) => e.type === 'gripRelease' || e.type === 'clampEnd').length;
  console.log(`${id}-balanced ${sim.result} peak ${Object.entries(peak).map(([k, v]) => `${k} ${v.toFixed(1)}`).join(' ')} loss ${loss.join(' ') || '-'} wrap ${[...wraps].join(',')} releases ${rel}`);
}
