// Free-form Gate 3 experiments: side hit on a running runner (vary defender speed / lean / offset).
import { Simulation } from '../../src/sim/simulation';
import { base3, bodyG3 } from '../../src/sim/fixtures/gate3';
import { v3 } from '../../src/sim/vec';
const cases: [number, number, number, number][] = [];
for (const vd of (process.argv[2] ?? "7").split(",").map(Number)) for (const lean of [12]) for (const vr of (process.argv[3] ?? "1,2,3,4").split(",").map(Number)) cases.push([vd, lean, vr, 0]);
for (const [vd, lean, vr] of cases) {
  // runner runs +X from x=-2; defender comes from -Z aimed to meet at x=0
  const tMeet = 2 / Math.max(vr, 1e-9);
  const dz = vr > 0 ? -vd * Math.min(tMeet, 0.6) - 0.35 : -1.5;
  const rx = vr > 0 ? -vr * Math.min(tMeet, 0.6) : 0;
  const def = base3({
    id: 'exp', milestone: 'x', title: 'x', durationS: 2.5, focus: { D: 'R' },
    players: [
      { id: 'D', role: 'defender', body: bodyG3(), initial: { x: 0, z: dz, yawDeg: 0, velocity: v3(0, 0, vd), leanDeg: lean, leanDirWorld: v3(0, 0, 1) }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(0, 0, vd), facing: v3(0, 0, 1), posture: { leanDeg: lean } }] } },
      { id: 'R', role: 'runner', body: bodyG3(), initial: { x: rx, z: 0, yawDeg: 90, velocity: v3(vr, 0, 0) }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(vr, 0, 0), facing: v3(1, 0, 0) }] } },
    ],
  });
  const sim = await Simulation.create(def);
  const peak: Record<string, number> = {};
  while (!sim.done) { sim.stepTick(); for (const pl of sim.players) peak[pl.id] = Math.max(peak[pl.id] ?? 0, pl.balance.theta * 57.3); }
  const loss = sim.events.filter((e) => e.type === 'lossOfSupport').map((e) => `${e.playerId}@${e.t.toFixed(2)}`);
  const c = sim.events.filter((e) => e.type === 'contactRegion').slice(0, 3).map((e) => `${e.playerId}:${e.data!.own}>${e.data!.otherClass}@y${(e.data!.point as number[])[1].toFixed(2)} J${e.data!.impulse}`);
  console.log(`vd ${vd} lean ${lean} vr ${vr}: peak D ${peak.D.toFixed(1)} R ${peak.R.toFixed(1)} loss ${loss.join(' ') || '-'} | ${c.join(' ')}`);
}
