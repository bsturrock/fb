// Plan 07 probe: every RH fixture under the 06a support (SUSPENSION_RH) and the repaired one (SUSPENSION_L2), same
// requests. Reports whether the traces are identical, the substeps on which the recovery bound was active, and the
// first divergence plus outcome / loss-of-support / handoff deltas.
// Usage: vite-node scripts/probe/p07-support-delta.ts [rh id regex]
import { Simulation } from '../../src/sim/simulation';
import { rideHeightFixtures } from '../../src/sim/fixtures/ride-height';
import { SUSPENSION_L2 } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';

const re = process.argv[2] ? new RegExp(process.argv[2]) : null;
const run = async (def: FixtureDef) => {
  const sim = await Simulation.create(def);
  let active = 0;
  while (!sim.done) {
    sim.stepTick();
    for (const p of sim.players) if (p.sus && Number.isFinite(p.sus.approachLimitMps)) active++;
  }
  const ev = sim.events.filter((e) => ['lossOfSupport', 'handoffRejected', 'representation'].includes(e.type)).map((e) => `${e.playerId}:${e.type === 'lossOfSupport' ? `loss(${(e.data as { reason: string }).reason})` : e.type === 'handoffRejected' ? `rej(${(e.data as { reasons: string }).reasons})` : 'rag'}@${e.t.toFixed(3)}`);
  const tr = sim.trace.map((r) => JSON.stringify(r.players, (k, v) => (k === 'vl' ? undefined : v)));
  const out = { result: String(sim.summary().result), ev, tr, active };
  sim.dispose();
  return out;
};
for (const def of rideHeightFixtures()) {
  if (re && !re.test(def.id)) continue;
  const a = await run(def);
  const b = await run({ ...def, support: SUSPENSION_L2 });
  let first = -1;
  for (let i = 0; i < Math.max(a.tr.length, b.tr.length); i++) if (a.tr[i] !== b.tr[i]) { first = i; break; }
  console.log(`${def.id.padEnd(26)} ${first < 0 ? 'identical' : `diverges tick ${first}`}  bound-active ${b.active}  ${a.result}${a.result !== b.result ? ` -> ${b.result}` : ''}`);
  if (a.ev.join() !== b.ev.join()) console.log(`   06a: ${a.ev.join(' ')}\n   L2 : ${b.ev.join(' ')}`);
}
