// Full check: the L4 matrix (ported from the old tree's .scratch/cmp/l4mx.ts). Every fixture with a fall-response
// profile, both body orders, shard i of n: the run's result and, per player, its conversion time, end mode and the
// fall-response effort audit (every scalar of the episode's stats as the tree has them: peak audited power, substeps
// over the power cap, work over its cap, impact-guard held substeps, ...; `fall: null` for a player with no episode).
// JSON lines {k, id, rev, ...} to the output file (k = registry index, for the merge's order). Env ONLY=<regex>.
// The rows come from scripts/check/meters.ts (the runs the full check's workers make, with only this matrix's meters).
import { writeFileSync } from 'node:fs';
import { runMatrix } from './meters';
import { shardArgs } from './lib';

const { i, n, out } = shardArgs();
const { lines } = await runMatrix('l4mx', i, n);
writeFileSync(out, lines.map((l) => l + '\n').join(''));
