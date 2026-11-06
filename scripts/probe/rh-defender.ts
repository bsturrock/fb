// Probe (plan 06a, user request 2026-11-05): the isolated defender runs (RH-F6-defenderRun-*) under the frozen
// suspension (legacy pivot, excess load through the COM, nominal-weight balance ceiling), the two superseded suspension
// models (first implementation; decision 1 alone), and the legacy capsule-floor support.
// Per run: control mode at the end, first loss of support, strides, speed, peak and mean lean (after 0.5 s), balance cap
// (min/mean) and the share of supported substep-ticks with the balance torque at its cap, load range.
// Usage: vite-node scripts/probe/rh-defender.ts
import { Simulation } from '../../src/sim/simulation';
import { RH_F6_DEFENDER_PHASES, rhf6DefenderRun } from '../../src/sim/fixtures/ride-height';
import { SUSPENSION_RH } from '../../src/sim/profiles';
import type { FixtureDef } from '../../src/sim/fixture';

const f = (x: number, d = 3): string => (Number.isFinite(x) ? x.toFixed(d) : '-');
const mean = (a: number[]): number => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

async function measure(def: FixtureDef): Promise<string> {
  const sim = await Simulation.create(def);
  const pl = sim.players[0];
  const lean: number[] = [];
  const cap: number[] = [];
  const load: number[] = [];
  const speed: number[] = [];
  let sat = 0;
  let n = 0;
  let peak = 0;
  while (!sim.done) {
    sim.stepTick();
    if (pl.rag || pl.controlMode !== 'supported') continue;
    const k = sim.bulk(pl);
    const deg = (pl.balance.theta * 180) / Math.PI;
    if (sim.t >= 0.5) {
      lean.push(deg);
      peak = Math.max(peak, deg);
      speed.push(Math.hypot(k.v.x, k.v.z));
    }
    cap.push(pl.applied.balanceCap);
    if (pl.sus) load.push(pl.sus.appliedN / (pl.mass.massKg * 9.81));
    n++;
    if (pl.applied.balanceSaturated) sat++;
  }
  const loss = sim.events.find((e) => e.type === 'lossOfSupport' && e.playerId === pl.id);
  const stride = def.runClips && pl.run ? def.runClips.clips[pl.run.k].record.cycleS / Math.max(pl.run.rate, 1e-6) : NaN;
  const out =
    `${pl.controlMode.padEnd(9)} loss ${loss ? `${f(loss.t)} (${String(loss.data?.reason)})` : '-       '}  strides ${f(sim.t / stride, 1)}  speed ${f(mean(speed), 2)} m/s  ` +
    `lean peak ${f(peak, 1)} mean ${f(mean(lean), 1)} deg  bal cap ${f(Math.min(...cap), 0)}..${f(mean(cap), 0)} N m  at cap ${f((100 * sat) / Math.max(n, 1), 0)}%` +
    (load.length ? `  load ${f(Math.min(...load), 2)}..${f(Math.max(...load), 2)} BW` : '');
  sim.dispose();
  return out;
}

for (const p of RH_F6_DEFENDER_PHASES) {
  const def = rhf6DefenderRun(p);
  console.log(`\n${def.id}`);
  const first = { ...SUSPENSION_RH, balanceCeiling: 'appliedLoad', application: { pivot: 'probeDepth', excess: 'atPivot' } } as const;
  console.log(`  frozen                      ${await measure(def)}`);
  console.log(`  first implementation        ${await measure({ ...def, support: first })}`);
  console.log(`  nominal ceiling, probe depth ${await measure({ ...def, support: { ...first, balanceCeiling: 'nominalWeight' } })}`);
  console.log(`  legacy capsule floor        ${await measure({ ...def, support: undefined })}`);
}
