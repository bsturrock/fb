// Plan 08 closeout probe: the audit by scenario group, what the raw boundaries set aside, carried feet, achieved motion.
// Usage: vite-node scripts/probe/p08-groups.ts
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const groups = new Map<string, { n: number; over: number; peak: number; raw: number }>();
const all = { n: 0, over: 0, peak: 0, raw: 0, jump: 0, stop: 0, neither: 0, cont: 0, carried: 0, carriedPeak: 0, carriedRaw: 0, carriedCont: 0, carriedContPeak: 0, stopFired: 0, reseedOnly: 0 };
for (const def of allFixtures().filter((d) => d.id.startsWith('L3-'))) {
  const g = def.id.split('-')[1];
  const r = groups.get(g) ?? { n: 0, over: 0, peak: 0, raw: 0 };
  // a boundary with a carried foot: its comparison is the old path as it is (the audit's own test of it)
  const withCarried = new Set<object>();
  let seen = 0;
  const sim = await Simulation.create(def, {
    transitionAudit: true,
    onSubstep: (s) => {
      for (const d of s.transitionDeltas.slice(seen)) {
        const f = s.byId.get(d.playerId)?.feet?.feet;
        if (f?.left.carried || f?.right.carried) withCarried.add(d);
      }
      seen = s.transitionDeltas.length;
    },
  });
  while (!sim.done) sim.stepTick();
  for (const d of sim.transitionDeltas) {
    r.n++;
    if (d.deltaM > 0.01) r.over++;
    r.peak = Math.max(r.peak, d.deltaM);
    const jump = Math.max(...Object.values(d.requestJumpM));
    const stop = Math.max(...Object.values(d.stepStopM));
    if (stop > 0) all.stopFired++;
    if (d.from.replace(/#\d+/g, '') === d.to.replace(/#\d+/g, '')) all.reseedOnly++;
    if (d.rawM > 0.01) {
      r.raw++;
      if (jump > 0) all.jump++;
      else if (stop > 0) all.stop++;
      else all.neither++;
    }
    if (d.continuedM > 0.01) all.cont++;
    if (withCarried.has(d)) {
      all.carried++;
      all.carriedPeak = Math.max(all.carriedPeak, d.deltaM);
      if (d.rawM > 0.01) all.carriedRaw++;
      if (d.continuedM > 0.01) all.carriedCont++;
      all.carriedContPeak = Math.max(all.carriedContPeak, d.continuedM);
    }
  }
  groups.set(g, r);
  sim.dispose();
}
for (const [g, r] of groups) {
  console.log(`| ${g} | ${r.over}/${r.n} | ${(r.peak * 100).toFixed(2)} cm | ${r.raw} |`);
  all.n += r.n;
  all.over += r.over;
  all.peak = Math.max(all.peak, r.peak);
  all.raw += r.raw;
}
console.log(JSON.stringify(all));
