// Plan 07 review closeout probe: touchdown proposals vs confirmed plants vs sustained intervals per fixture and player,
// failed proposals (reasons, largest measured error), per-foot sustained durations and eligible stance coverage, the
// largest held error and the largest release-sample error. Markdown rows; --events lists the plant events.
// Usage: vite-node scripts/probe/p07-confirm.ts [id regex] [--events]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import type { ArmSide } from '../../src/sim/contracts';

const args = process.argv.slice(2);
const re = new RegExp(args.find((a) => !a.startsWith('--')) ?? '^L2-');
const verbose = args.includes('--events');
const SIDES: ArmSide[] = ['left', 'right'];
const q = (xs: number[]): string => {
  const a = [...xs].sort((x, y) => x - y);
  return a.length ? `${a[0].toFixed(3)}/${a[Math.floor(a.length / 2)].toFixed(3)}/${a[a.length - 1].toFixed(3)}` : '—';
};
console.log('| Fixture (player) | Proposals | Confirmed | Failed (reasons; max err cm) | Sustained L/R | Sustained s L (min/med/max) | Sustained s R | Eligible stance planted L/R | Held err max (cm) | Release-sample err max (cm) |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const def of allFixtures()) {
  if (!re.test(def.id) || !def.footwork) continue;
  const sim = await Simulation.create(def);
  sim.runToEnd();
  for (const p of sim.players) {
    if (!p.feet) continue;
    const ev = sim.events.filter((e) => e.playerId === p.id && e.type.startsWith('foot'));
    const st = p.feet.stats;
    const dur: Record<ArmSide, number[]> = { left: [], right: [] };
    const open: Partial<Record<ArmSide, number>> = {};
    let relErr = 0;
    for (const e of ev) {
      const s = e.data!.side as ArmSide;
      if (e.type === 'footPlant') open[s] = e.t;
      else if (e.type === 'footRelease') {
        if ((e.data!.solves as number) >= 1) dur[s].push(e.t - open[s]!);
        relErr = Math.max(relErr, e.data!.featureErrM as number);
        delete open[s];
      }
    }
    for (const s of SIDES) if (open[s] !== undefined && p.feet.feet[s].solves >= 1) dur[s].push(sim.t - open[s]!);
    const why: Record<string, number> = {};
    for (const e of ev.filter((x) => x.type === 'footPlantFailed')) why[String(e.data!.reason)] = (why[String(e.data!.reason)] ?? 0) + 1;
    const cov = (s: ArmSide): string => (st.cover[s].eligibleS > 0 ? `${((100 * st.cover[s].plantedS) / st.cover[s].eligibleS).toFixed(0)}%` : '—');
    const fw = Object.entries(why).map(([k, n]) => `${k} ${n}`).join(', ');
    console.log(
      `| ${def.id} (${p.id}) | ${st.attempts} | ${st.confirmed} | ${st.failed}${st.failed ? ` (${fw}; ${(st.failedErrM * 100).toFixed(2)})` : ''} | ${dur.left.length}/${dur.right.length} | ${q(dur.left)} | ${q(dur.right)} | ${cov('left')} / ${cov('right')} | ${(st.plantErrM * 100).toFixed(2)} | ${relErr ? (relErr * 100).toFixed(2) : '—'} |`,
    );
    if (verbose) for (const e of ev.filter((x) => x.type !== 'footSwing')) console.log(`   ${e.t.toFixed(4)} ${e.type} ${JSON.stringify(e.data)}`);
  }
  sim.dispose();
}
