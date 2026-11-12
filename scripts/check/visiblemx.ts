// Full check: the visible-quality matrix (ladder rung 8c; tests/visible.ts, definitions in scripts/check/README.md).
// Every L3, L4 and HC fixture with a ragdoll profile, both body orders, shard i of n: every drawn frame (the published
// pose after each outer tick, 60 Hz) of every player, split ragdoll / supported: joint seconds past the human range by
// joint and direction, own bone-axis crossings, own-body overlap in deep events, cross-player leg overlap, frame-to-frame
// joint snaps, the knee at its stop, the worst event of each column with its time, and the hips at each conversion.
// Informational: compare.ts reports it, no invariant reads it. Observation only: the meter changes nothing in a run.
// JSON lines {k, id, rev, ...} to the output file (k = registry index, for the merge's order). Env ONLY=<regex>.
// The rows come from scripts/check/meters.ts (the runs the full check's workers make, with only this matrix's meters).
import { writeFileSync } from 'node:fs';
import { runMatrix } from './meters';
import { shardArgs } from './lib';

const { i, n, out } = shardArgs();
const { lines } = await runMatrix('visiblemx', i, n);
writeFileSync(out, lines.map((l) => l + '\n').join(''));
