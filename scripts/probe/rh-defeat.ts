// Probe (plan 06a, user request 2026-11-05): can balance still be defeated? Tackles (RH-F6 pairs), side hits and lean
// capacity (rhf6Defeat) under the frozen suspension, the first implementation and the legacy capsule-floor support (the
// same definition without `support`). Per player: first loss of support (time, reason), handoff outcome; peak lean and
// the peak pivot tipping torque (suspension) while supported.
// Usage: vite-node scripts/probe/rh-defeat.ts [rh id regex]
import { Simulation } from '../../src/sim/simulation';
import { rhf6, rhf6Defeat } from '../../src/sim/fixtures/ride-height';
import { SUSPENSION_RH } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const first = { ...SUSPENSION_RH, balanceCeiling: 'appliedLoad', application: { pivot: 'probeDepth', excess: 'atPivot' } } as const;

async function run(def: FixtureDef): Promise<string> {
  const sim = await Simulation.create(def);
  const peak: Record<string, { lean: number; tip: number; fm: number }> = {};
  for (const p of sim.players) peak[p.id] = { lean: 0, tip: 0, fm: 0 };
  while (!sim.done) {
    sim.stepTick();
    for (const p of sim.players) {
      if (p.rag || p.controlMode !== 'supported') continue;
      const k = peak[p.id];
      k.lean = Math.max(k.lean, (p.balance.theta * 180) / Math.PI);
      if (p.sus) {
        k.tip = Math.max(k.tip, Math.hypot(p.sus.tipTorqueNm.x, p.sus.tipTorqueNm.z));
        k.fm = Math.max(k.fm, p.sus.comN);
      }
    }
  }
  const out = sim.players.map((p) => {
    const l = sim.events.find((e) => e.type === 'lossOfSupport' && e.playerId === p.id);
    const h = p.handoff;
    const k = peak[p.id];
    return (
      `${p.id} ${l ? `loss ${l.t.toFixed(3)} (${String(l.data?.reason)})` : 'up'}${h ? ` ${h.outcome}${h.report.reasons.length ? `(${h.report.reasons.join(',')})` : ''}` : ''}` +
      ` lean<=${k.lean.toFixed(1)}${p.sus ? ` tip<=${k.tip.toFixed(0)} N m Fm<=${k.fm.toFixed(0)} N` : ''}`
    );
  });
  const r = `${String(sim.result).padEnd(19)} ${out.join('; ')}`;
  sim.dispose();
  return r;
}

const cases = [...rhf6().filter((d) => !/idleRunBrake|simultaneous/.test(d.id)), ...rhf6Defeat()];
for (const def of cases) {
  if (filter && !filter.test(def.id)) continue;
  console.log(`\n${def.id}`);
  console.log(`  frozen       ${await run(def)}`);
  console.log(`  first impl.  ${await run({ ...def, support: first })}`);
  console.log(`  legacy       ${await run({ ...def, support: undefined })}`);
}
