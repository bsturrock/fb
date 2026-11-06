// Plan 07 probe: footwork enabled vs disabled. Each footwork fixture runs with and without its footwork profile (same
// support profile and requests); per tick, every player's root translation/rotation and velocities, support force and
// drive/balance records must match bit for bit until the first representation change (conversion). Reports the first
// mismatch, the conversion tick, and differing rule observations / results.
// Usage: vite-node scripts/probe/p07-invariance.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import type { FixtureDef } from '../../src/sim/fixture';

const filt = process.argv.slice(2).find((a) => !a.startsWith('--'));
const re = new RegExp(filt ?? '^L2-');

function phys(sim: Simulation): string {
  return sim.players
    .map((pl) => {
      if (pl.rag) return `${pl.id}:rag`;
      const b = pl.proxy.body;
      const t = b.translation();
      const r = b.rotation();
      const v = b.linvel();
      const w = b.angvel();
      const a = pl.applied;
      return [pl.id, t.x, t.y, t.z, r.x, r.y, r.z, r.w, v.x, v.y, v.z, w.x, w.y, w.z, pl.sus?.appliedN ?? 0, pl.controlMode, pl.grounded, JSON.stringify(a)].join(',');
    })
    .join('|');
}

async function run(def: FixtureDef): Promise<{ rows: string[]; conv: number; result: string; ruleRows: string[]; events: string[] }> {
  const sim = await Simulation.create(def);
  const rows: string[] = [];
  const ruleRows: string[] = [];
  let conv = -1;
  while (!sim.done) {
    sim.stepTick();
    if (conv < 0 && sim.players.some((p) => p.rag || p.handoff)) conv = sim.tick;
    rows.push(phys(sim));
  }
  for (const r of sim.trace) if (r.rule) ruleRows.push(JSON.stringify(r.rule));
  const events = sim.events.filter((e) => !e.type.startsWith('foot')).map((e) => `${e.tick}:${e.type}:${e.playerId ?? ''}`);
  return { rows, conv, result: sim.result, ruleRows, events };
}

let bad = 0;
for (const def of allFixtures()) {
  if (!re.test(def.id) || !def.footwork) continue;
  const on = await run(def);
  const off = await run({ ...def, footwork: undefined });
  const conv = [on.conv, off.conv].filter((c) => c >= 0);
  const until = conv.length ? Math.min(...conv) : Infinity;
  let first = -1;
  const n = Math.min(on.rows.length, off.rows.length);
  for (let i = 0; i < n; i++) {
    if (i + 1 >= until) break;
    if (on.rows[i] !== off.rows[i]) {
      first = i + 1;
      break;
    }
  }
  const evDiff = on.events.join(';') !== off.events.join(';');
  const ruleDiff = on.ruleRows.join(';') !== off.ruleRows.join(';');
  if (first >= 0) bad++;
  console.log(
    `${def.id.padEnd(22)} ticks ${on.rows.length}/${off.rows.length} conv ${on.conv}/${off.conv} physics ${first < 0 ? 'identical' : `DIFFER at tick ${first}`}${until < Infinity ? ' (to conversion)' : ''} result ${on.result}/${off.result} events ${evDiff ? 'differ' : 'same'} rules ${ruleDiff ? 'differ' : 'same'}`,
  );
}
console.log(bad ? `${bad} fixture(s) with a physics difference` : 'all identical before conversion');
