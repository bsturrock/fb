// Full check: the passive-energy matrix (ladder rung 7g; tests/passive-energy.ts). Every L3, L4 and HC fixture with a
// ragdoll profile, both body orders, shard i of n: per player whose ragdoll ran, its solves, the solves that gained more
// than INJECTION_J with no other player touching it (injecting), their total gain, the largest such gain, its solve
// and time, the segments that touched static ground and one of its own shapes in that solve (the pinch), the largest
// gain of a solve with no contact at all (the bookkeeping's floor), and every injecting solve as [solve, J, pinch, the
// largest loss of the tick before it (a rebound follows an impact), 1 if it had any contact impulse else 0]. Observation
// only: the meter changes nothing in a run.
// JSON lines {k, id, rev, ...} to the output file (k = registry index, for the merge's order). Env ONLY=<regex>.
// The rows come from scripts/check/meters.ts (the runs the full check's workers make, with only this matrix's meters).
import { writeFileSync } from 'node:fs';
import { runMatrix } from './meters';
import { shardArgs } from './lib';

const { i, n, out } = shardArgs();
const { lines } = await runMatrix('energymx', i, n);
writeFileSync(out, lines.map((l) => l + '\n').join(''));
