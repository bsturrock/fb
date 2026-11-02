// Hand-brace search: defender pushes the runner from behind into a waist-high diagnostic bench.
import { Simulation } from '../../src/sim/simulation';
import { base4, bodyG4 } from '../../src/sim/fixtures/gate4';
import { RULES_FOOTBALL } from '../../src/sim/profiles';
import { v3 } from '../../src/sim/vec';
for (const h of [0.7, 0.8, 0.9]) for (const push of [1.5, 3]) {
  const def = base4({
    id: `bench-${h}-${push}`, milestone: 'x', title: '', durationS: 4,
    rules: RULES_FOOTBALL('R', { sideline: false, progress: false }),
    obstacles: [{ id: 'bench', center: v3(0.45, h / 2, 0), halfExtents: v3(0.15, h / 2, 1.2) }],
    players: [
      { id: 'R', role: 'runner', body: bodyG4(), initial: { x: 0, z: 0, yawDeg: 90 }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(), facing: v3(1, 0, 0) }] } },
      { id: 'D', role: 'defender', body: bodyG4(), initial: { x: -0.75, z: 0, yawDeg: 90 }, controller: { kind: 'script', segments: [{ fromS: 0, velocity: v3(push, 0, 0), facing: v3(1, 0, 0), effort: 1 }, { fromS: 1.2, velocity: v3(), facing: v3(1, 0, 0), effort: 1 }] } },
    ],
  });
  const sim = await Simulation.create(def);
  sim.runToEnd();
  const ev = sim.events.filter((e) => ['groundTouch', 'ruleEnding', 'lossOfSupport', 'handoffRejected', 'influenceBegin'].includes(e.type)).map((e) => `${e.t.toFixed(2)}:${e.type}:${e.playerId}:${(e.data as any).region ?? (e.data as any).reasons ?? (e.data as any).kind ?? ''}`);
  console.log(h, push, sim.result, ev.join(' '));
  sim.dispose();
}
