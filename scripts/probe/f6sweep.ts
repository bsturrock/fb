import { wrapFixture } from '../../src/sim/fixtures/gate2';
import { Simulation } from '../../src/sim/simulation';
import { v3 } from '../../src/sim/vec';
const jog = [{ fromS: 0, velocity: v3(1, 0, 0), facing: v3(1, 0, 0), effort: 0.5 }];
const cases: [string, object][] = [];
for (const g of [0.35, 0.4, 0.45, 0.5]) cases.push([`gap${g}`, { contactGapM: g, driveInMps: 0, engageGapM: g + 0.15 }]);
for (const a of [-0.6, -0.4, 0.5, 0.6, 0.7]) cases.push([`aim${a}`, { aimLateralM: a }]);
for (const [name, wrap] of cases) {
  const sim = await Simulation.create(wrapFixture({ id: 'x', title: 'x', wrap: wrap as never, runner: jog as never }));
  sim.runToEnd();
  const st = new Set(sim.trace.map((r) => r.players.D.wrap));
  const clamps = sim.events.filter((e) => e.type === 'clampBegin').map((e) => e.data!.arm).join('');
  console.log(name, [...st].join(','), 'clampBegins', clamps.length, 'L', (clamps.match(/left/g) || []).length, 'R', (clamps.match(/right/g) || []).length, 'gap', sim.minPairGap.toFixed(2));
}
