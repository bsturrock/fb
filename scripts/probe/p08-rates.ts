// Plan 08 closeout probe: the declared foot limits at every actual substep of the L3 fixtures, measured from outside the
// planner: a step's vertical target speed and a following foot's offset recovery speed, between two substeps of one owner
// (a reseed changes coordinates, not the foot: the world target and achieved ankle are reported across it), and the
// planner's own counters, which are taken inside the update, also when the foot changes owner that substep. Between two
// substeps of one seed: a step also from the substep it takes over without a reseed.
// Usage: vite-node scripts/probe/p08-rates.ts [id regex]
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';
import { dist, len, sub, type Vec3 } from '../../src/sim/vec';

const re = new RegExp(process.argv[2] ?? '^L3-');
const worst = { lift: 0, offset: 0, statLift: 0, statOffset: 0, target: 0, ankle: 0 };
const fast: string[] = [];
for (const def of allFixtures().filter((d) => re.test(d.id))) {
  const last = new Map<string, { source: string; mode: string; target: Vec3; offset: Vec3; ankle: Vec3; reseed: boolean; seeds: number }>();
  const m = { lift: 0, offset: 0, target: 0, ankle: 0, at: '', ankleAt: '' };
  const sim = await Simulation.create(def, {
    onSubstep: (s) => {
      const dt = s.dt;
      for (const pl of s.players)
        for (const side of ['left', 'right'] as const) {
          const f = pl.feet?.feet[side];
          if (!f || pl.rag) continue;
          const k = `${pl.id}:${side}`;
          const p = last.get(k);
          const ankle = f.ankleW;
          if (p) {
            m.target = Math.max(m.target, f.mode === 'planted' ? 0 : dist(f.target, p.target) / dt);
            const v = dist(ankle, p.ankle) / dt;
            if (v > m.ankle) {
              m.ankle = v;
              m.ankleAt = `${s.t.toFixed(4)} ${k} ${p.mode}/${p.source}>${f.mode}/${f.source}`;
            }
            if (p.seeds === f.seeds && !p.reseed && !f.rejoin) {
              // (a step also from the substep it takes over without a reseed, a carried leg)
              if (f.source === 'step' && f.mode !== 'planted') {
                const r = Math.abs(f.target.y - p.target.y) / dt;
                if (r > m.lift) [m.lift, m.at] = [r, `${s.t.toFixed(4)} ${k}`];
              } else if (p.source === 'follow' && p.mode === f.mode && f.source === 'follow' && !f.wait && f.mode !== 'planted') {
                // relative to the moving request; a request jump (a change of coordinates the offset absorbs) moves nothing
                m.offset = Math.max(m.offset, len(sub(sub(f.offset, p.offset), f.seamOffset)) / dt);
              }
            }
          }
          last.set(k, { source: f.source, mode: f.mode, target: { ...f.target }, offset: { ...f.offset }, ankle: { ...ankle }, reseed: f.rejoin || f.wait, seeds: f.seeds });
        }
    },
  });
  while (!sim.done) sim.stepTick();
  let sl = 0;
  let so = 0;
  for (const pl of sim.players) {
    sl = Math.max(sl, pl.feet?.stats.liftRateMps ?? 0);
    so = Math.max(so, pl.feet?.stats.offsetDecayMps ?? 0);
  }
  worst.lift = Math.max(worst.lift, m.lift);
  worst.offset = Math.max(worst.offset, m.offset);
  worst.statLift = Math.max(worst.statLift, sl);
  worst.statOffset = Math.max(worst.statOffset, so);
  worst.target = Math.max(worst.target, m.target);
  worst.ankle = Math.max(worst.ankle, m.ankle);
  if (m.lift > 1.5 + 1e-6 || m.offset > 1.5 + 1e-6 || sl > 1.5 + 1e-6 || so > 1.5 + 1e-6) fast.push(`${def.id} lift ${m.lift.toFixed(3)} (${m.at}) offset ${m.offset.toFixed(3)} stats ${sl.toFixed(3)} ${so.toFixed(3)}`);
  if (process.argv[3]) console.log(`${m.ankle.toFixed(2).padStart(6)} ${def.id.padEnd(26)} ${m.ankleAt} lift ${m.lift.toFixed(3)} offset ${m.offset.toFixed(3)} stats ${sl.toFixed(3)} ${so.toFixed(3)} target ${m.target.toFixed(2)}`);
  sim.dispose();
}
console.log(`worst lift ${worst.lift.toFixed(4)} offset ${worst.offset.toFixed(4)} stats ${worst.statLift.toFixed(4)} ${worst.statOffset.toFixed(4)} target ${worst.target.toFixed(2)} ankle ${worst.ankle.toFixed(2)} m/s`);
console.log(`over the limits: ${fast.length}`);
for (const l of fast.slice(0, 20)) console.log(l);
