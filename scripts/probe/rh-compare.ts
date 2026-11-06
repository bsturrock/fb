// Probe (plan 06a RH-F6): legacy capsule-floor vs suspension support on the same requests. Per player, up to its first
// handoff (or the end): first contact, first loss of support, COM height mean/range, speed at first contact, peak lean,
// mean |balance torque| and mean balance cap, mean drive cap, mean support load (suspension) -- then the outcome.
// Usage: vite-node scripts/probe/rh-compare.ts [rh-id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { RH_F6_PAIRS } from '../../src/sim/fixtures/ride-height';

const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const all = new Map(allFixtures().map((d) => [d.id, d]));
const f = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : '-');
const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

async function measure(id: string) {
  const sim = await Simulation.create(all.get(id)!);
  const out: Record<string, { comY: number[]; lean: number; tauB: number[]; cap: number[]; drive: number[]; load: number[]; contactT: number; speedAtContact: number }> = {};
  for (const pl of sim.players) out[pl.id] = { comY: [], lean: 0, tauB: [], cap: [], drive: [], load: [], contactT: NaN, speedAtContact: NaN };
  while (!sim.done) {
    sim.stepTick();
    for (const pl of sim.players) {
      if (pl.rag || pl.controlMode !== 'supported') continue;
      const o = out[pl.id];
      const k = sim.bulk(pl);
      o.comY.push(k.com.y);
      o.lean = Math.max(o.lean, (pl.balance.theta * 180) / Math.PI);
      o.tauB.push(Math.hypot(pl.applied.balanceCapped.x, pl.applied.balanceCapped.y, pl.applied.balanceCapped.z));
      o.cap.push(pl.applied.balanceCap);
      o.drive.push(pl.applied.driveCap);
      if (pl.sus) o.load.push(pl.sus.appliedN / (pl.mass.massKg * 9.81));
      if (!Number.isFinite(o.contactT) && (sim.contactObs[pl.id]?.length ?? 0) > 0) {
        o.contactT = sim.t;
        o.speedAtContact = Math.hypot(k.v.x, k.v.z);
      }
    }
  }
  const ev = (type: string, pid: string) => sim.events.find((e) => e.type === type && e.playerId === pid);
  const res = {
    result: sim.result,
    players: sim.players.map((pl) => {
      const o = out[pl.id];
      const loss = ev('lossOfSupport', pl.id);
      const h = pl.handoff;
      return (
        `${pl.id}: contact ${f(o.contactT)} s @ ${f(o.speedAtContact, 2)} m/s  loss ${loss ? `${f(loss.t)} (${String(loss.data?.reason)})` : '-'}  ` +
        `handoff ${h ? `${h.outcome}@${f(h.t)}${h.report.reasons.length ? `(${h.report.reasons.join(',')})` : ''}` : '-'}  ` +
        `COM y ${f(mean(o.comY))} (${f(Math.min(...o.comY))}..${f(Math.max(...o.comY))})  peak lean ${f(o.lean, 1)} deg  ` +
        `|tauB| ${f(mean(o.tauB), 0)} / cap ${f(mean(o.cap), 0)} N m  drive cap ${f(mean(o.drive), 0)} N${o.load.length ? `  load ${f(Math.min(...o.load), 2)}..${f(Math.max(...o.load), 2)} BW` : ''}`
      );
    }),
  };
  sim.dispose();
  return res;
}

for (const [rid, lid] of Object.entries(RH_F6_PAIRS)) {
  if (filter && !filter.test(rid)) continue;
  const a = await measure(lid);
  const b = await measure(rid);
  console.log(`\n${lid}  ->  ${rid}\n  legacy     ${a.result}\n    ${a.players.join('\n    ')}\n  suspension ${b.result}\n    ${b.players.join('\n    ')}`);
}
