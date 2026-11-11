// Full check: the passive-energy matrix (ladder rung 7g; tests/passive-energy.ts). Every L3, L4 and HC fixture with a
// ragdoll profile, both body orders, shard i of n: per player whose ragdoll ran, its solves, the solves that gained more
// than INJECTION_J with no other player touching it (injecting), their total gain, the largest such gain, its solve
// and time, the segments that touched static ground and one of its own shapes in that solve (the pinch), the largest
// gain of a solve with no contact at all (the bookkeeping's floor), and every injecting solve as [solve, J, pinch, the
// largest loss of the tick before it (a rebound follows an impact), 1 if it had any contact impulse else 0]. Observation
// only: the meter changes nothing in a run.
// JSON lines {k, id, rev, ...} to the output file (k = registry index, for the merge's order). Env ONLY=<regex>.
import { writeFileSync } from 'node:fs';
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { passiveEnergyMeter } from '../../tests/passive-energy';
import { ENERGY_FAMILIES, familyOf, round, shardArgs } from './lib';

const { i, n, out } = shardArgs();
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const all = allFixtures();
const lines: string[] = [];
for (let k = 0; k < all.length; k++) {
  const d = all[k];
  if (!d.ragdoll || !ENERGY_FAMILIES.includes(familyOf(d.id)) || k % n !== i || (only && !only.test(d.id))) continue;
  for (const rev of [false, true]) {
    const sim = await Simulation.create(d, rev ? { reverseOrder: true } : {});
    const meter = passiveEnergyMeter(sim);
    sim.runToEnd();
    const pl: Record<string, unknown> = {};
    for (const [id, r] of [...meter.runs()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      pl[id] = {
        solves: r.solves,
        injecting: r.injecting,
        injectedJ: round(r.injectedJ, 3),
        maxJ: round(r.maxJ, 3),
        maxStep: r.maxStep,
        maxAt: r.maxAt == null ? null : round(r.maxAt),
        maxPinch: r.maxPinch?.join(',') || null,
        quietMaxJ: round(r.quietMaxJ, 3),
        over: r.over.map((o) => [o.step, round(o.J, 3), o.pinch.join(',') || null, round(o.priorLossJ, 3), o.contact ? 1 : 0]),
      };
    lines.push(JSON.stringify({ k, id: d.id, rev, pl }));
    meter.restore();
    sim.dispose();
  }
}
writeFileSync(out, lines.map((l) => l + '\n').join(''));
