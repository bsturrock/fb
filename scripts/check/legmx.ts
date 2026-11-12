// Full check: the leg matrix (ported from the old tree's .scratch/cmp/legmx.ts). Every fixture with a leg-guard profile,
// both body orders, shard i of n: the run's result and, per player, its conversion time and end mode, the largest
// one-substep player-player contact impulse on the player and on its leg colliders (from the solve's contact records),
// and the leg ledger (largest one-substep leg impulse and when, substeps with an impulse while ungrounded, totals) --
// reported as "absent" on a tree without one. JSON lines {k, id, rev, ...} to the output file (k = registry index, for
// the merge's order). Env ONLY=<regex> limits the fixtures; LEGV2=1 runs them under LEG_GUARD_V2 (a tree that has it).
// The same runs count Rapier shape queries per tick (tests/runs.ts shapeQueryCounter, the counting of the plan 13a budget
// test; counting never changes a result): the most in one tick and when, one JSON line per row to `<output>.q`.
// The rows come from scripts/check/meters.ts (the runs the full check's workers make, with only this matrix's meters).
import { writeFileSync } from 'node:fs';
import * as profiles from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';
import { runMatrix } from './meters';
import { shardArgs } from './lib';

const { i, n, out } = shardArgs();
const v2 = (profiles as Record<string, unknown>).LEG_GUARD_V2;
if (process.env.LEGV2 && !v2) {
  console.error('LEGV2 is set but this tree has no LEG_GUARD_V2');
  process.exit(2);
}
const variant = (d: FixtureDef): FixtureDef => (process.env.LEGV2 ? { ...d, legGuard: v2 as FixtureDef['legGuard'] } : d);
const { lines, queries } = await runMatrix('legmx', i, n, variant);
writeFileSync(out, lines.map((l) => l + '\n').join(''));
writeFileSync(`${out}.q`, queries.map((l) => l + '\n').join(''));
