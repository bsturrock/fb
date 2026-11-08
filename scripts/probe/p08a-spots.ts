// Plan 08a probe: every L3 rule fixture and handoff with the carry against the earlier palm hold: ending, ball spot, handoffs.
import { allFixtures } from '../../src/sim/fixtures/index';
import type { FixtureDef } from '../../src/sim/fixture';
import { Simulation } from '../../src/sim/simulation';
import { dist } from '../../src/sim/vec';
const held = (d: FixtureDef): FixtureDef => ({ ...d, carry: undefined, ...(d.rules ? { rules: { ...d.rules, ballSource: 'carryPalm' as const } } : {}) });
const go = async (d: FixtureDef) => {
  const sim = await Simulation.create(d);
  sim.runToEnd();
  const out = {
    kind: sim.ending?.kind ?? null,
    t: sim.ending?.t ?? null,
    spot: sim.ending?.ballSpot ?? null,
    hand: sim.players.filter((p) => p.handoff).map((p) => `${p.id}:${p.handoff!.outcome}@${p.handoff!.t.toFixed(3)}`).join(' '),
  };
  sim.dispose();
  return out;
};
let spots = 0, moved = 0, sum = 0, peak = 0, hands = 0, kinds = 0, acc = 0, rej = 0;
const lines: string[] = [];
for (const def of allFixtures().filter((d) => d.milestone === 'L3')) {
  const [a, b] = [await go(held(def)), await go(def)];
  acc += (b.hand.match(/accepted/g) ?? []).length;
  rej += (b.hand.match(/rejected/g) ?? []).length;
  if (a.kind !== b.kind) { kinds++; lines.push(`${def.id} ending ${a.kind} > ${b.kind}`); }
  if (a.spot && b.spot) {
    spots++;
    const d = dist(a.spot, b.spot);
    sum += d;
    peak = Math.max(peak, d);
    if (d > 1e-6) moved++;
    lines.push(`${def.id} ${b.kind} spot ${d.toFixed(3)} t ${a.t?.toFixed(3)} > ${b.t?.toFixed(3)}`);
  }
  if (a.hand !== b.hand) { hands++; lines.push(`${def.id} handoff [${a.hand}] > [${b.hand}]`); }
}
console.log(lines.join('\n'));
console.log(`spots ${spots} moved ${moved} mean ${(sum / Math.max(1, spots)).toFixed(3)} peak ${peak.toFixed(3)}; ending kinds changed ${kinds}; handoff records changed ${hands}; accepted ${acc} rejected ${rej}`);
process.exit(0);
