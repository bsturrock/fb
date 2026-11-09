// Plan 13f: every L3, L4 and HC conversion (accepted, rejected or failed in transfer) with its new external depth: the
// candidate's deepest new overlap against another body and the parts, its trigger and outcome. Lists those over the
// pose leg guard's 1.2 cm (the near-limit table) and every rejection; `--all` prints every conversion.
// Usage: npx vite-node scripts/probe/p13-near-limit.ts [fixture regex] [--reversed] [--no-leg-guard] [--all]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import type { FixtureDef } from '../../src/sim/fixture';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const re = new RegExp(args.find((a) => !a.startsWith('--')) ?? '^(L3|L4|HC)-');
const GUARD_M = 0.012;
const rows: string[] = [];
const near: string[] = [];
const rejected: string[] = [];
for (const def0 of allFixtures().filter((d) => re.test(d.id))) {
  const def: FixtureDef = flags.has('--no-leg-guard') ? ({ ...def0, legGuard: undefined } as FixtureDef) : def0;
  const sim = await Simulation.create(def, flags.has('--reversed') ? { reverseOrder: true } : {});
  while (!sim.done) sim.stepTick();
  for (const pl of sim.players) {
    const h = pl.handoff;
    if (!h) continue;
    const r = h.report;
    const w = r.worstExternal;
    const line = `${def.id.padEnd(28)} ${pl.id.padEnd(2)} ${h.t.toFixed(3)} ${h.reason.padEnd(13)} ${h.outcome.padEnd(14)} new ${(r.maxNewExternalPenetrationM * 100).toFixed(2)} cm${w ? ` ${w.own} in ${w.other ?? '?'}` : ''}${r.reasons.length ? ` [${r.reasons.join(',')}]` : ''}`;
    rows.push(line);
    if (r.maxNewExternalPenetrationM > GUARD_M) near.push(line);
    if (h.outcome !== 'accepted') rejected.push(line);
  }
  sim.dispose();
}
if (flags.has('--all')) for (const l of rows) console.log(l);
console.log(`\n${rows.length} conversions; over ${GUARD_M * 100} cm new depth (${near.length}):`);
for (const l of near) console.log(`  ${l}`);
console.log(`not accepted (${rejected.length}):`);
for (const l of rejected) console.log(`  ${l}`);
