// Plan 08 closeout probe: the boundaries the 2026-11-06 reviews named, as the audit reads them now. Largest same-time delta and
// raw difference of any boundary of that player within one tick of the named time; a missing line means no boundary is left there.
// Usage: vite-node scripts/probe/p08-review.ts
import { Simulation } from '../../src/sim/simulation';
import { allFixtures } from '../../src/sim/fixtures/index';

const named: [string, number, string, string][] = [
  ['L3-F1-phase0', 0.479167, 'D', 'leftAnkle'],
  ['L3-F1-phase1', 0.483333, 'D', 'leftKnee'],
  ['L3-F1-phase1', 0.491667, 'D', 'leftKnee'],
  ['L3-F1-phase6', 0.479167, 'D', 'leftKnee'],
  ['L3-F1-phase7', 1.120833, 'D', 'leftPalm'],
  ['L3-F3-side', 0.466667, 'D', 'leftShoe'],
  ['L3-F4-twoArm', 0.475, 'D', 'rightKnee'],
  ['L3-F3-side', 0.320833, 'R', 'rightShoe'],
  ['L3-F1-phase5', 0.479167, 'D', 'rightKnee'],
  ['L3-F1-phase5', 0.4875, 'D', 'rightAnkle'],
  ['L3-F9-noProbe-contact', 0.55, 'D', 'leftAnkle'],
];
for (const id of [...new Set(named.map((n) => n[0]))]) {
  const sim = await Simulation.create(allFixtures().find((d) => d.id === id)!, { transitionAudit: true });
  while (!sim.done) sim.stepTick();
  for (const [, t, who, mark] of named.filter((n) => n[0] === id)) {
    const near = sim.transitionDeltas.filter((d) => d.playerId === who && Math.abs(d.t - t) < 1 / 60 + 1e-6);
    const at = near.filter((d) => Math.abs(d.t - t) < 1e-4);
    const worst = (l: typeof near): string => {
      if (!l.length) return 'none';
      const d = [...l].sort((a, b) => b.deltaM - a.deltaM)[0];
      return `${d.t.toFixed(4)} ${(d.deltaM * 100).toFixed(2)} ${d.landmark} raw ${(d.rawM * 100).toFixed(2)} ${mark} ${((d.by[mark] ?? 0) * 100).toFixed(2)} jump ${JSON.stringify(d.requestJumpM)}`;
    };
    console.log(`${id} ${t.toFixed(4)} ${who} ${mark}: at ${worst(at)}; within a tick ${worst(near)}`);
  }
  sim.dispose();
}
for (const id of ['L3-F4-twoArm', 'L3-F6-hold', 'L3-F10-both', 'L3-F4-gripTarget', 'L3-F4-gripOwner', 'L3-F4-gripBoth']) {
  const sim = await Simulation.create(allFixtures().find((d) => d.id === id)!);
  while (!sim.done) sim.stepTick();
  const c: Record<string, number> = {};
  for (const e of sim.events) if (/^(clamp|grip)/.test(e.type)) c[e.type] = (c[e.type] ?? 0) + 1;
  console.log(id, JSON.stringify(c));
  sim.dispose();
}
