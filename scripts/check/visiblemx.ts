// Full check: the visible-quality matrix (ladder rung 8c; tests/visible.ts, definitions in scripts/check/README.md).
// Every L3, L4 and HC fixture with a ragdoll profile, both body orders, shard i of n: every drawn frame (the published
// pose after each outer tick, 60 Hz) of every player, split ragdoll / supported: joint seconds past the human range by
// joint and direction, own bone-axis crossings, own-body overlap in deep events, cross-player leg overlap, frame-to-frame
// joint snaps, the knee at its stop, the worst event of each column with its time, and the hips at each conversion.
// Informational: compare.ts reports it, no invariant reads it. Observation only: the meter changes nothing in a run.
// JSON lines {k, id, rev, ...} to the output file (k = registry index, for the merge's order). Env ONLY=<regex>.
import { writeFileSync } from 'node:fs';
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { idleBaseline, VisibleMeter } from '../../tests/visible';
import { ENERGY_FAMILIES, familyOf, shardArgs } from './lib';

const { i, n, out } = shardArgs();
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const all = allFixtures();
const idle = all.find((d) => d.id === 'L3-F13-free');
if (!idle) throw new Error('visiblemx: the idle baseline fixture L3-F13-free is gone');
const base = await idleBaseline(idle);
const lines: string[] = [];
for (let k = 0; k < all.length; k++) {
  const d = all[k];
  if (!d.ragdoll || !ENERGY_FAMILIES.includes(familyOf(d.id)) || k % n !== i || (only && !only.test(d.id))) continue;
  for (const rev of [false, true]) {
    const sim = await Simulation.create(d, rev ? { reverseOrder: true } : {});
    const meter = new VisibleMeter(sim, base);
    while (!sim.done) {
      sim.stepTick();
      meter.frame();
    }
    lines.push(JSON.stringify({ k, id: d.id, rev, ...meter.finish() }));
    sim.dispose();
  }
}
writeFileSync(out, lines.map((l) => l + '\n').join(''));
