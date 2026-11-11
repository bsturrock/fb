// Full check: the L4 matrix (ported from the old tree's .scratch/cmp/l4mx.ts). Every fixture with a fall-response
// profile, both body orders, shard i of n: the run's result and, per player, its conversion time, end mode and the
// fall-response effort audit (every scalar of the episode's stats as the tree has them: peak audited power, substeps
// over the power cap, work over its cap, impact-guard held substeps, ...; `fall: null` for a player with no episode).
// JSON lines {k, id, rev, ...} to the output file (k = registry index, for the merge's order). Env ONLY=<regex>.
import { writeFileSync } from 'node:fs';
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { round, shardArgs } from './lib';

const { i, n, out } = shardArgs();
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

/** Scalars of the stats, nested records flattened (`peakNm.knee`), keys sorted. */
function flat(o: Record<string, unknown>, pre = '', into: Record<string, unknown> = {}): Record<string, unknown> {
  for (const key of Object.keys(o).sort()) {
    const v = o[key];
    if (typeof v === 'number') into[pre + key] = round(v);
    else if (typeof v === 'boolean' || typeof v === 'string' || v === null) into[pre + key] = v;
    else if (v && typeof v === 'object' && !Array.isArray(v)) flat(v as Record<string, unknown>, `${pre}${key}.`, into);
  }
  return into;
}

const all = allFixtures();
const lines: string[] = [];
for (let k = 0; k < all.length; k++) {
  const d = all[k];
  if (!d.fallResponse || k % n !== i || (only && !only.test(d.id))) continue;
  for (const rev of [false, true]) {
    const sim = await Simulation.create(d, rev ? { reverseOrder: true } : {});
    sim.runToEnd();
    const pl: Record<string, unknown> = {};
    for (const p of [...sim.players].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)))
      pl[p.id] = { conv: p.handoff ? round(p.handoff.t) : null, mode: p.controlMode, fall: p.fall ? flat(p.fall.stats as unknown as Record<string, unknown>) : null };
    lines.push(JSON.stringify({ k, id: d.id, rev, result: sim.result, pl }));
    sim.dispose();
  }
}
writeFileSync(out, lines.map((l) => l + '\n').join(''));
